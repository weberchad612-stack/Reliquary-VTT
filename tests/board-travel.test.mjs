// Travel between maps and the map menu (board/travel.js), the build stamp, and the entrance-pair check.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { travelMenu, parseTravelId, travelPlan, planArrival, isKnown, partnerOf } from '../board/travel.js';
import { prepareMove, fits, canStep } from '../engine/movement/movement.js';
import { blockersAt } from '../engine/tokens/occupancy.js';
import { buildInfo } from '../tools/bundle.mjs';
import { validate } from '../tools/validate.mjs';

const ENGINE = { fits, canStep, blockersAt };
const MAPS = [
  { id: 'crypt', name: 'Crypt', links: [
    { id: 'down', label: 'Stairs down', at: [[1, 1]], to_map: 'well', to_link: 'up', arrive: [[1, 1], [2, 1]], found: true },
    { id: 'chute', label: 'Chute', at: [[5, 5]], to_map: 'well', arrive: [[5, 5]] },
  ] },
  { id: 'well', name: 'Stairwell', links: [{ id: 'up', label: 'Stairs up', at: [[0, 0]], to_map: 'crypt', to_link: 'down', arrive: [[1, 1]] }] },
  { id: 'vault', name: 'Vault', links: [] },
];
const ids = (def) => def[0].items.map((m) => [m.label, m.tag || null, m.items.map((i) => i.sep ? '--' : `${i.label}${i.tag ? ' (' + i.tag + ')' : ''}${i.disabled ? ' [off]' : ''}`)]);

test('travel: the GM sees every map and every entrance, unfound ones marked', () => {
  const def = travelMenu({ maps: MAPS, view: 'gm', current: 'crypt' });
  assert.equal(def[0].label, 'Crypt');
  assert.deepEqual(ids(def), [
    ['Crypt', 'party here', ['Whole map', '--', 'Stairs down', 'Chute (not found)']],
    ['Stairwell', null, ['Whole map', '--', 'Stairs up (not found)']],
    ['Vault', null, ['Whole map']],
  ]);
  assert.deepEqual(parseTravelId(def[0].items[1].items[2].id), { kind: 'view', map: 'well', link: 'up' });
  // while previewing, the menu is named after the map on screen
  const prev = travelMenu({ maps: MAPS, view: 'gm', current: 'crypt', shown: 'well' });
  assert.equal(prev[0].label, 'Stairwell');
  assert.equal(prev[0].items[1].tag, 'previewing');
});

test('travel: players see discovered maps (and their own) with known entrances only', () => {
  let def = travelMenu({ maps: MAPS, view: 'player', current: 'crypt' });
  assert.deepEqual(ids(def), [['Crypt', 'here', ['Stairs down → unexplored']]]);
  assert.deepEqual(parseTravelId(def[0].items[0].items[0].id), { kind: 'go', map: 'crypt', link: 'down' });
  def = travelMenu({ maps: MAPS, view: 'player', current: 'crypt', discovered: ['well', 'vault'], linksFound: { well: ['up'], crypt: ['chute'] } });
  assert.deepEqual(ids(def), [
    ['Crypt', 'here', ['Stairs down → Stairwell', 'Chute → Stairwell (not linked) [off]']],
    ['Stairwell', null, ['Stairs up']],
    ['Vault', null, ['No known entrances [off]']],
  ]);
  assert.ok(isKnown('crypt', MAPS[0].links[0]) && !isKnown('well', MAPS[1].links[0]) && isKnown('well', MAPS[1].links[0], { well: ['up'] }));
  assert.equal(partnerOf(MAPS[0].links[0], MAPS).link.id, 'up');
  assert.equal(partnerOf(MAPS[0].links[1], MAPS), null);
});

test('travel: taking an entrance goes to its partner, and the way back becomes known', () => {
  const tokens = { k: { name: 'Kerra', kind: 'pc', x: 1, y: 1 }, p: { name: 'Pip', kind: 'pc', x: 2, y: 2 }, o: { name: 'Ogre', kind: 'foe', x: 5, y: 5 }, d: { name: 'Dead', kind: 'pc', dead: true, x: 3, y: 3 } };
  const through = travelPlan({ maps: MAPS, from: 'crypt', toMap: 'crypt', linkId: 'down', tokens });
  assert.equal(through.target.map.id, 'well');
  assert.equal(through.target.link.id, 'up');
  assert.deepEqual(through.found, { well: ['up'], crypt: ['down'] });
  assert.deepEqual(through.cells, [[1, 1], [2, 1]], "the crypt link's arrive cells, which are on the stairwell");
  assert.deepEqual(through.travellers.map((t) => t.id), ['k', 'p'], 'living PCs only, by name');
  const direct = travelPlan({ maps: MAPS, from: 'crypt', toMap: 'well', linkId: 'up', tokens });
  assert.equal(direct.via, null);
  assert.deepEqual(direct.cells, [[1, 1], [2, 1]], 'arriving at the stairs up: where the stairs down lead');
  const unpaired = travelPlan({ maps: [...MAPS.slice(0, 2), { id: 'vault', name: 'Vault', links: [{ id: 'hatch', label: 'Hatch', at: [[3, 3]], to_map: 'crypt', arrive: [[0, 0]] }] }], from: 'crypt', toMap: 'vault', linkId: 'hatch', tokens });
  assert.deepEqual(unpaired.cells, [[3, 3]], 'no partner: at the entrance itself');
  assert.deepEqual(direct.found, { well: ['up'], crypt: ['down'] });
  // arriving somewhere unrelated to where the party was: only the arrival entrance is marked
  const far = travelPlan({ maps: MAPS, from: 'vault', toMap: 'well', linkId: 'up', tokens });
  assert.deepEqual(far.found, { well: ['up'] });
  assert.equal(travelPlan({ maps: MAPS, from: 'crypt', toMap: 'crypt', linkId: 'chute', tokens }), null, 'an unpaired entrance goes nowhere');
});

// A 6 x 4 room with a wall splitting off its east column, a door-less gap at the bottom.
const GRID = { cell_px: 50, origin_px: [0, 0], cols: 6, rows: 4, feet_per_cell: 5 };
const SEGS = [
  { id: 'n', a: [0, 0], b: [6, 0], t: 'solid' }, { id: 'e', a: [6, 0], b: [6, 4], t: 'solid' },
  { id: 's', a: [6, 4], b: [0, 4], t: 'solid' }, { id: 'w', a: [0, 4], b: [0, 0], t: 'solid' },
  { id: 'split', a: [2, 0], b: [2, 4], t: 'solid' },
];

test('arrival: arrival squares first, then the nearest walkable squares; never through a wall', () => {
  const pm = prepareMove(SEGS, {}, GRID);
  const travellers = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((id) => ({ id, size: 1 }));
  const { placed, unplaced } = planArrival({ pm, cells: [[0, 0], [1, 0]], travellers, engine: ENGINE });
  assert.deepEqual(placed.slice(0, 2).map((p) => [p.x, p.y]), [[0, 0], [1, 0]]);
  assert.equal(placed.length, 8, 'the west part holds 8 squares');
  assert.ok(placed.every((p) => p.x < 2), 'nobody lands beyond the wall');
  assert.deepEqual(unplaced, ['i']);
  assert.equal(new Set(placed.map((p) => p.x + ',' + p.y)).size, 8, 'one creature per square');
  // a creature on an arrival square pushes the party outward
  const r = planArrival({ pm, cells: [[0, 0]], travellers: [{ id: 'a', size: 1 }], occupants: [{ id: 'o', kind: 'foe', x: 0, y: 0, size: 1 }], engine: ENGINE });
  assert.deepEqual(r.placed.map((p) => [p.x, p.y]), [[1, 0]]);
});

test('build stamp: a version that sorts by time, the commit, and whether it was dirty', () => {
  const b = buildInfo(new Date(2026, 10, 10, 17, 22));
  assert.equal(b.version, 'v26.11.10-1722');
  assert.ok(buildInfo(new Date(2026, 10, 10, 17, 23)).version > b.version);
  assert.ok(buildInfo(new Date(2027, 0, 1, 0, 0)).version > b.version);
  assert.equal(typeof b.dirty, 'boolean');
  assert.ok(b.commit === null || /^[0-9a-f]{4,}$/.test(b.commit));
});

test('validator: entrances should pair up and lead back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pairs-'));
  fs.cpSync('examples/sample-pack', dir, { recursive: true });
  const msgs = () => { const r = validate(dir); return [...r.errors, ...r.warnings].map((m) => m.msg || String(m)).join('\n'); };
  assert.doesNotMatch(msgs(), /to_link|lead back/);
  const f = path.join(dir, 'maps/sample-crypt/map.json');
  const m = JSON.parse(fs.readFileSync(f, 'utf8'));
  delete m.links[0].to_link;
  fs.writeFileSync(f, JSON.stringify(m));
  assert.match(msgs(), /no to_link/);
  m.links[0].to_link = 'nowhere';
  fs.writeFileSync(f, JSON.stringify(m));
  assert.match(msgs(), /to_link "nowhere" is not an entrance/);
});
