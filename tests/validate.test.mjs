import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, doorwayClearance, DOORWAY_END_SLACK, DOORWAY_MIN_CELLS } from '../tools/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'examples', 'sample-pack');
const SAVE = path.join(ROOT, 'examples', 'sample-save');
const HERO = 'tok-s4rmvlg6';   // the sample save's torch-bearer

/** Copy the sample pack and save into a temp dir, apply a change, and validate. */
function withCopy(change) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rvtt-'));
  fs.cpSync(PACK, path.join(tmp, 'pack'), { recursive: true });
  fs.cpSync(SAVE, path.join(tmp, 'save'), { recursive: true });
  const crypt = path.join(tmp, 'pack', 'maps', 'sample-crypt');
  const edit = (file, fn) => {
    const p = path.join(crypt, file);
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    fn(d);
    fs.writeFileSync(p, JSON.stringify(d));
  };
  const editState = (fn) => {
    const p = path.join(tmp, 'save', 'maps', 'sample-crypt.json');
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    fn(d);
    fs.writeFileSync(p, JSON.stringify(d));
  };
  change({ edit, editState, crypt });
  const report = validate(path.join(tmp, 'pack'), { save: path.join(tmp, 'save') });
  fs.rmSync(tmp, { recursive: true, force: true });
  return report;
}

const seg = (d, id) => d.segs.find((s) => s.id === id);
const errorText = (r) => r.errors.map((e) => e.msg).join('\n');

function expectError(change, pattern) {
  const r = withCopy(change);
  assert.match(errorText(r), pattern, `expected an error matching ${pattern}; got:\n${errorText(r) || '(no errors)'}`);
}

test('sample pack and save are valid with no warnings', () => {
  const r = validate(PACK, { save: SAVE });
  assert.equal(r.errors.length, 0, errorText(r));
  assert.equal(r.warnings.length, 0, r.warnings.map((w) => w.msg).join('\n'));
});

test('a single map folder can be validated on its own', () => {
  const r = validate(path.join(PACK, 'maps', 'sample-stairwell'));
  assert.equal(r.errors.length, 0, errorText(r));
});

test('endpoint off the 1/8 cell grid', () => {
  expectError(({ edit }) => edit('walls.json', (d) => { seg(d, 'w-curtain').b = [9, 3.1]; }), /not on the 1\/8 cell grid/);
});

test('endpoint outside the grid', () => {
  expectError(({ edit }) => edit('walls.json', (d) => { seg(d, 'w-east').b = [12, 11]; }), /outside the 12x10 grid/);
});

test('zero-length segment', () => {
  expectError(({ edit }) => edit('walls.json', (d) => { seg(d, 'w-curtain').b = [9, 0.5]; }), /zero length/);
});

test('duplicate segment id', () => {
  expectError(({ edit }) => edit('walls.json', (d) => { seg(d, 'w-curtain').id = 'w-north'; }), /duplicate segment id/);
});

test('duplicate door id', () => {
  expectError(({ edit }) => edit('walls.json', (d) => { seg(d, 'w-vault-door').door.id = 'd01'; }), /door id "d01" is already used/);
});

test('door segment without door data', () => {
  expectError(({ edit }) => edit('walls.json', (d) => { delete seg(d, 'w-hall-door').door; }), /must have required property 'door'/);
});

test('door data on a non-door segment', () => {
  expectError(({ edit }) => edit('walls.json', (d) => { seg(d, 'w-north').door = { id: 'x1' }; }), /must NOT be valid/);
});

test('unknown wall type', () => {
  expectError(({ edit }) => edit('walls.json', (d) => { seg(d, 'w-north').t = 'brick'; }), /must be equal to one of the allowed values/);
});

test('movement override must be 0 or 20', () => {
  expectError(({ edit }) => edit('walls.json', (d) => { seg(d, 'w-north').move = 10; }), /\/move: must be equal to one of the allowed values/);
});

test('arrow slit without a proximity distance', () => {
  expectError(({ edit }) => edit('walls.json', (d) => { delete seg(d, 'w-slit').prox; }), /sight uses proximity but prox\.sight/);
});

test('missing image file', () => {
  expectError(({ crypt }) => fs.rmSync(path.join(crypt, 'sample-crypt.png')), /image file "sample-crypt.png" not found/);
});

test('link to a map that is not in the pack', () => {
  expectError(({ edit }) => edit('map.json', (d) => { d.links[0].to_map = 'nowhere'; }), /target map "nowhere" is not in this pack/);
});

test('link cell outside the grid', () => {
  expectError(({ edit }) => edit('map.json', (d) => { d.links[0].at = [[12, 0]]; }), /cell \(12, 0\) is outside the grid/);
});

test('state: unknown door id', () => {
  expectError(({ editState }) => editState((d) => { d.doors.d99 = { state: 'open' }; }), /doors\.d99: no such door/);
});

test('state: secret door open before it is found', () => {
  expectError(({ editState }) => editState((d) => { d.doors.s01 = { state: 'open' }; }), /cannot be open before it is found/);
});

test('state: explored point off the 1/8 cell grid', () => {
  expectError(({ editState }) => editState((d) => { d.explored.polys[0][1] = [6.1, 0]; }), /explored\.polys\[0\]: point \(6\.1, 0\) is not on the 1\/8 cell grid/);
});

test('state: unknown link id', () => {
  expectError(({ editState }) => editState((d) => { d.links_found.push('secret-tunnel'); }), /links_found: no such link "secret-tunnel"/);
});

test('state: token outside the grid', () => {
  expectError(({ editState }) => editState((d) => { d.tokens[HERO] = { x: 12, y: 0 }; }), /tokens\.tok-s4rmvlg6: cell \(12, 0\) is outside the grid/);
});

test('warning, not error: override equal to the default', () => {
  const r = withCopy(({ edit }) => edit('walls.json', (d) => { seg(d, 'w-window').sight = 0; }));
  assert.equal(r.errors.length, 0, errorText(r));
  assert.match(r.warnings.map((w) => w.msg).join('\n'), /sight override equals the "window" default/);
});

// Doorway check: a 1-cell door at x 5..6 on the line y = 3, in a wall with faces at y 2.75 and 3.25.
const door = { id: 'd', t: 'door', a: [4.875, 3], b: [6.125, 3], door: { id: 'd1' } };
const jambs = [
  { id: 'n1', t: 'solid', a: [2, 2.75], b: [5, 2.75] }, { id: 'n2', t: 'solid', a: [5, 2.75], b: [5, 3.25] },
  { id: 's1', t: 'solid', a: [2, 3.25], b: [5, 3.25] },
  { id: 'n3', t: 'solid', a: [6, 2.75], b: [9, 2.75] }, { id: 'n4', t: 'solid', a: [6, 2.75], b: [6, 3.25] },
  { id: 's3', t: 'solid', a: [6, 3.25], b: [9, 3.25] },
];
const passes = (c) => c.clear >= Math.max(DOORWAY_MIN_CELLS, c.length - DOORWAY_END_SLACK);

test('doorway check: square jambs leave the opening clear', () => {
  const c = doorwayClearance(door, [door, ...jambs], 80);
  assert.ok(Math.abs(c.clear - 1) < 0.05, `clear ${c.clear}`);
  assert.ok(passes(c));
});

test('doorway check: a wall face running along the door line pinches it shut', () => {
  const pinch = { id: 'p', t: 'solid', a: [5, 3.1], b: [6, 3.1] };
  const c = doorwayClearance(door, [door, ...jambs, pinch], 80);
  assert.ok(c.clear < 0.1, `clear ${c.clear}`);
  assert.ok(!passes(c));
});

test('doorway check: jambs funnelling in toward the door bar pinch it', () => {
  const funnel = [{ id: 'f1', t: 'solid', a: [5, 2.75], b: [5.3, 3] }, { id: 'f2', t: 'solid', a: [6, 3.25], b: [5.7, 3] }];
  const c = doorwayClearance(door, [door, ...jambs, ...funnel], 80);
  assert.ok(!passes(c), `clear ${c.clear}`);
});

test('doorway check: walls that do not block movement are ignored', () => {
  const eth = { id: 'e', t: 'ethereal', a: [5, 3.1], b: [6, 3.1] };
  assert.ok(passes(doorwayClearance(door, [door, ...jambs, eth], 80)));
});

test('double door: pair must name an existing door', () => {
  expectError(({ edit }) => edit('walls.json', (d) => { seg(d, 'w-cell-door-n').door.pair = 'nope'; }), /pair "nope" is not a door/);
});

test('double door: both leaves must name each other', () => {
  expectError(({ edit }) => edit('walls.json', (d) => { seg(d, 'w-cell-door-s').door.pair = 'd01'; }), /does not name "d04"|does not name "d03"/);
});

test('double door: leaves must meet end to end on one line', () => {
  expectError(({ edit }) => edit('walls.json', (d) => { const s = seg(d, 'w-cell-door-s'); s.a = [6, 7.5]; }), /meet end to end/);
});

test('door hinge and swing take only their named values', () => {
  expectError(({ edit }) => edit('walls.json', (d) => { seg(d, 'w-hall-door').door.swing = 'north'; }), /swing|enum|allowed/i);
});

test('double door: a small bend at the middle (grid snapping on a diagonal) is allowed', () => {
  const r = withCopy(({ edit }) => edit('walls.json', (d) => { seg(d, 'w-cell-door-n').a = [6.125, 6]; }));
  assert.doesNotMatch(errorText(r), /meet end to end/);
});

// ---- terrain ----
const warnText = (r) => r.warnings.map((e) => e.msg).join('\n');

test('terrain: unknown kind is a schema error', () => {
  expectError(({ edit }) => edit('terrain.json', (d) => { d.areas[0].kind = 'lava'; }), /kind|enum|allowed/i);
});

test('terrain: an area needs cells or rects', () => {
  expectError(({ edit }) => edit('terrain.json', (d) => { delete d.areas[0].rects; }), /cells|rects|anyOf/i);
});

test('terrain: squares outside the grid', () => {
  expectError(({ edit }) => edit('terrain.json', (d) => { d.areas[0].rects = [[11, 9, 3, 1]]; }), /outside the 12x10 grid/);
});

test('terrain: duplicate area ids', () => {
  expectError(({ edit }) => edit('terrain.json', (d) => { d.areas[1].id = 't01'; }), /duplicate area id/);
});

test('terrain: the file named in map.json must exist', () => {
  expectError(({ edit }) => edit('map.json', (d) => { d.terrain = 'missing.json'; }), /terrain file "missing.json" not found/);
});

test('terrain: checks without a DC and save-only fields in a pack are warned about', () => {
  const r = withCopy(({ edit }) => edit('terrain.json', (d) => { delete d.areas[2].dc; d.areas[0].until = 'later'; }));
  assert.match(warnText(r), /uneven areas usually give the DC/);
  assert.match(warnText(r), /belong to temporary terrain in a save/);
});

test('terrain: the save can only switch off areas that exist', () => {
  expectError(({ editState }) => editState((d) => { d.terrain_off = ['t09']; }), /terrain_off: no terrain area "t09"/);
});

test('terrain: temporary areas need their own ids', () => {
  expectError(({ editState }) => editState((d) => { d.terrain[0].id = 't01'; }), /id already used/);
});

test('terrain: terrain_on must name an existing area', () => {
  expectError(({ editState }) => editState((d) => { d.terrain_on = ['nope']; }), /terrain_on: no terrain area "nope"/);
});

test('terrain: terrain_on for an area that is already active is warned about', () => {
  const r = withCopy(({ editState }) => editState((d) => { d.terrain_on = ['t01']; }));
  assert.match(warnText(r), /already active/);
});

test('terrain: switching on an area that starts off is fine', () => {
  const r = withCopy(({ editState }) => editState((d) => { d.terrain_on = ['t04']; }));
  assert.equal(errorText(r), '');
  assert.doesNotMatch(warnText(r), /terrain_on/);
});

// ---- lighting ----

test('lighting: unknown light preset', () => {
  expectError(({ edit }) => edit('lighting.json', (d) => { d.lights[1].preset = 'candel'; }), /unknown light preset "candel"/);
});

test('lighting: a light outside the grid', () => {
  expectError(({ edit }) => edit('lighting.json', (d) => { d.lights[0].at = [30, 4]; }), /light l01: position .* outside the grid/);
});

test('lighting: region squares outside the grid', () => {
  expectError(({ edit }) => edit('lighting.json', (d) => { d.regions[0].rects = [[10, 9, 4, 4]]; }), /lighting region r01: .*outside the 12x10 grid/);
});

test('lighting: a region level must be sky, bright, dim or dark', () => {
  expectError(({ edit }) => edit('lighting.json', (d) => { d.regions[0].level = 'gloomy'; }), /level|enum|allowed/i);
});

test('lighting: the save can only switch lights the map has', () => {
  expectError(({ editState }) => editState((d) => { d.lights = { l09: { on: true } }; }), /lights.l09: no light "l09"/);
});

test('lighting: a carried light needs a known preset', () => {
  expectError(({ editState }) => editState((d) => { d.tokens[HERO].light = { preset: 'lamp' }; }), /tokens.tok-s4rmvlg6.light: unknown light preset "lamp"/);
});

test('lighting: the lighting file named in map.json must exist', () => {
  expectError(({ edit }) => edit('map.json', (d) => { d.lighting = 'none.json'; }), /lighting file "none.json" not found/);
});

test('lighting colour and intensity: valid values pass, bad ones and unknown regions are caught', () => {
  const ok = withCopy(({ edit, editState }) => {
    edit('lighting.json', (d) => { d.lights[0].colour = '#ff8800'; d.lights[0].intensity = 40; d.regions[0].colour = 'none'; });
    editState((d) => { d.lights = { l01: { colour: '#00ff00', intensity: 20 } }; d.regions = { r01: { intensity: 50 } }; d.light_colour = { on: false, strength: 40 }; });
  });
  assert.equal(errorText(ok), '');
  expectError(({ edit }) => edit('lighting.json', (d) => { d.lights[0].colour = 'orange'; }), /colour/);
  expectError(({ edit }) => edit('lighting.json', (d) => { d.regions[0].intensity = 150; }), /intensity/);
  expectError(({ editState }) => editState((d) => { d.regions = { r99: { intensity: 50 } }; }), /regions\.r99: no lighting region/);
});
