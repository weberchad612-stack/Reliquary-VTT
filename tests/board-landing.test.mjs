// Landing pages (kind "landing": the adventure's cover, where the party waits while players join) and the GM's
// "move the party" commands in the map menu (board/travel.js), with each PC's last square on a battle map.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { travelMenu, parseTravelId, gmMovePlan, returnMaps, travelPlan, BACK, START } from '../board/travel.js';
import { prepareMove, fits, canStep } from '../engine/movement/movement.js';
import { blockersAt } from '../engine/tokens/occupancy.js';
import { validate } from '../tools/validate.mjs';

const ENGINE = { fits, canStep, blockersAt };
const MAPS = [
  { id: 'cover', name: 'The Adventure', kind: 'landing', links: [] },
  { id: 'keep', name: 'Keep', start: [[5, 5], [6, 5]], grid: { cols: 12, rows: 12 }, links: [] },
  { id: 'town', name: 'Town', kind: 'area', links: [] },
];
const labels = (item) => (item.items || []).map((i) => i.label || '--');

test('landing: players on it see the other maps but cannot go; elsewhere it is not listed for them', () => {
  const on = travelMenu({ maps: MAPS, view: 'player', current: 'cover', discovered: ['keep', 'town'] })[0];
  assert.equal(on.label, 'The Adventure');
  assert.deepEqual(on.items.map((i) => [i.label, !!i.disabled]), [['The Adventure', true], ['Keep', true], ['Town', true]]);
  assert.equal(on.items[1].hint, 'The GM moves the party from here');
  const off = travelMenu({ maps: MAPS, view: 'player', current: 'town', discovered: ['keep', 'cover'] })[0];
  assert.deepEqual(off.items.map((i) => i.label), ['Keep', 'Town'], 'the landing page is GM-only');
  assert.equal(travelPlan({ maps: MAPS, from: 'keep', toMap: 'cover', tokens: {} }).cells, null, 'no squares');
});

test('landing: the GM moves the party from the menu, but not while previewing', () => {
  const gm = travelMenu({ maps: MAPS, view: 'gm', current: 'cover' })[0].items;
  assert.equal(gm[0].tag, 'party here');
  assert.equal(gm[0].items, undefined, 'the party is here: preview only');
  assert.deepEqual(labels(gm[1]), ['Whole map', 'Starting area', '--', 'Move the party to the starting area']);
  assert.deepEqual(parseTravelId(gm[1].items[3].id), { kind: 'bring', map: 'keep', link: START });
  assert.deepEqual(labels(gm[2]), ['Preview', 'Move the party here']);
  const back = travelMenu({ maps: MAPS, view: 'gm', current: 'keep', returns: [] })[0].items;
  assert.deepEqual(labels(back[0]), ['Preview', 'Move the party here'], 'back to the landing page');
  assert.deepEqual(labels(back[1]), ['Whole map', 'Starting area'], 'no move to the map the party is on');
  const prev = travelMenu({ maps: MAPS, view: 'gm', current: 'cover', bring: false })[0].items;
  assert.ok(!labels(prev[1]).includes('Move the party to the starting area'));
  const ret = travelMenu({ maps: MAPS, view: 'gm', current: 'cover', returns: ['keep'] })[0].items[1];
  assert.deepEqual(labels(ret).slice(3), ['Move the party back where it left', 'Move the party to the starting area']);
  assert.deepEqual(parseTravelId(ret.items[3].id), { kind: 'bring', map: 'keep', link: BACK });
});

test('landing: leaving a battle map keeps each PC\'s square; coming back puts each PC on its own', () => {
  const pm = prepareMove([], {}, { cols: 12, rows: 12 });
  const keepTokens = { a: { name: 'Amiri', kind: 'pc', x: 2, y: 3 }, b: { name: 'Ezren', kind: 'pc', x: 8, y: 1 }, f: { name: 'Rat', kind: 'foe', x: 1, y: 1 } };
  const off = gmMovePlan({ maps: MAPS, from: 'keep', toMap: 'cover', tokens: keepTokens });
  assert.deepEqual(off.updates, [
    { id: 'a', data: { map: 'cover', last_square: { keep: [2, 3] } } },
    { id: 'b', data: { map: 'cover', last_square: { keep: [8, 1] } } },
  ], 'only PCs travel');
  const onCover = Object.fromEntries(off.updates.map((u) => [u.id, { ...keepTokens[u.id], ...u.data }]));
  assert.deepEqual(returnMaps(onCover), ['keep']);
  assert.deepEqual(returnMaps({ ...onCover, c: { name: 'Kyra', kind: 'pc', x: 0, y: 0 } }), [], 'every PC must have a square there');
  const back = gmMovePlan({ maps: MAPS, from: 'cover', toMap: 'keep', how: BACK, tokens: onCover, pm, occupants: [{ id: 'f', x: 8, y: 1, kind: 'foe' }], engine: ENGINE });
  assert.deepEqual(back.unplaced, []);
  const at = Object.fromEntries(back.updates.map((u) => [u.id, [u.data.x, u.data.y]]));
  assert.deepEqual(at.a, [2, 3], 'its own square');
  assert.notDeepEqual(at.b, [8, 1], 'a foe stands there now: the nearest free square');
  assert.deepEqual(back.updates[0].data.last_square, { keep: [2, 3] }, 'leaving a landing page keeps what was kept');
  const start = gmMovePlan({ maps: MAPS, from: 'cover', toMap: 'keep', how: START, tokens: onCover, pm, engine: ENGINE });
  assert.deepEqual(start.updates.map((u) => [u.data.x, u.data.y]), [[5, 5], [6, 5]]);
});

test('validator: a landing page is a picture only, and nothing links to it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-'));
  fs.cpSync('examples/sample-pack', dir, { recursive: true });
  const ld = path.join(dir, 'maps', 'cover');
  fs.mkdirSync(ld);
  fs.copyFileSync(path.join(dir, 'maps/sample-village/sample-village.webp'), path.join(ld, 'cover.webp'));
  const m = { id: 'cover', name: 'Cover', kind: 'landing', image: { file: 'cover.webp', w: 1000, h: 760 } };
  fs.writeFileSync(path.join(ld, 'map.json'), JSON.stringify(m));
  const pf = path.join(dir, 'pack.json'), pack = JSON.parse(fs.readFileSync(pf, 'utf8'));
  pack.maps = ['cover', ...pack.maps];
  fs.writeFileSync(pf, JSON.stringify(pack));
  const msgs = () => { const r = validate(dir); return [...r.errors, ...r.warnings].map((x) => x.msg).join('\n'); };
  assert.equal(msgs(), '');
  fs.writeFileSync(path.join(ld, 'map.json'), JSON.stringify({ ...m, places: [] }));
  assert.match(msgs(), /places|false schema|must NOT/i, 'no places on a landing page');
  fs.writeFileSync(path.join(ld, 'map.json'), JSON.stringify(m));
  const cf = path.join(dir, 'maps/sample-crypt/map.json'), crypt = JSON.parse(fs.readFileSync(cf, 'utf8'));
  crypt.links[0] = { ...crypt.links[0], to_map: 'cover', to_link: undefined };
  fs.writeFileSync(cf, JSON.stringify(crypt));
  assert.match(msgs(), /leads to a landing page/);
});
