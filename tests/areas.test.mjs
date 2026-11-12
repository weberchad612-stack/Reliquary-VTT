import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  areaDistance, burstCells, coneCells, emanationCells, lineCells, aimArea, effectBlockers, reachedCells,
  buildArea, tokensInCells, cornerDistance, describeArea, clearPath,
} from '../engine/areas/areas.js';
import { gridDistance } from '../engine/measure/measure.js';
import { PF2E_SYSTEM } from '../rulesets/pf2e/system.js';

const key = (cells) => new Set(cells.map(([c, r]) => c + ',' + r));
const has = (cells, c, r) => key(cells).has(c + ',' + r);

test('areaDistance matches the old board (max + floor(min/2)) and gridDistance for whole squares', () => {
  for (let a = 0; a <= 8; a++) for (let b = 0; b <= 8; b++) {
    assert.equal(areaDistance(a, b), Math.max(a, b) + Math.floor(Math.min(a, b) / 2));
    assert.equal(areaDistance(a, b), gridDistance(a, b, [1, 2]));
  }
  assert.equal(areaDistance(3, 1.5), 3); // half squares count no diagonal extra until whole
  assert.equal(areaDistance(4, 4, [1]), 4); // D&D-style diagonals
});

test('burst sizes follow the rules: 10 ft covers 12 squares, 15 ft 24, 20 ft 44 (no duplicates)', () => {
  for (const [R, n] of [[1, 4], [2, 12], [3, 24], [4, 44]]) {
    const c = burstCells(10, 10, R);
    assert.equal(c.length, n, `R=${R}`);
    assert.equal(key(c).size, n);
  }
  const b = burstCells(10, 10, 2);
  assert.ok(has(b, 10, 10) && has(b, 9, 9) && has(b, 11, 9) && !has(b, 11, 11));
});

test('cones: diagonal 15 ft matches a burst quadrant; orthogonal grows away from the caster', () => {
  const ne = coneCells(5, 5, 1, 3);
  assert.equal(ne.length, 6);
  assert.ok(ne.every(([c, r]) => c >= 5 && r < 5));
  const n = coneCells(5, 5, 0, 3);
  assert.ok(n.every(([, r]) => r < 5), 'north cone is above the origin');
  assert.ok(has(n, 4, 4) && has(n, 5, 4));
  const e = coneCells(5, 5.5, 2, 2); // east from a half-square origin
  assert.ok(e.every(([c]) => c >= 5));
  assert.ok(has(e, 5, 5));
  assert.equal(key(coneCells(5, 5, 4, 6)).size, coneCells(5, 5, 4, 6).length);
});

test('emanation surrounds the space but leaves it out; large creatures reach from every edge', () => {
  const e = emanationCells({ x: 5, y: 5, size: 1 }, 1);
  assert.equal(e.length, 8);
  assert.ok(!has(e, 5, 5));
  const big = emanationCells({ x: 5, y: 5, size: 2 }, 1);
  assert.equal(big.length, 12);
  assert.ok(!has(big, 6, 6) && has(big, 7, 7) && has(big, 4, 4));
  assert.equal(emanationCells({ x: 5, y: 5, size: 1 }, 2).length, 20); // 5x5 minus the centre and the 4 far corners
});

test('lines: straight east covers R squares; width adds squares side by side', () => {
  const l = lineCells(6, 5.5, 0, 6);
  assert.equal(l.length, 6);
  assert.ok(l.every(([, r]) => r === 5));
  assert.equal(lineCells(6, 5, 0, 4, 2).length, 8);
});

test('aimArea snaps cones to 8 directions and slides the origin along the caster edge', () => {
  const caster = { x: 10, y: 10, size: 1 };
  const north = aimArea('cone', caster, 10.9, 6, { R: 3 });
  assert.equal(north.dir, 0);
  assert.deepEqual(north.origin, [11, 10]);
  const east = aimArea('cone', caster, 15, 10.5, { R: 3 });
  assert.equal(east.dir, 2);
  assert.deepEqual(east.origin, [11, 10.5]);
  const se = aimArea('cone', caster, 14, 14, { R: 3 });
  assert.equal(se.dir, 3);
  assert.deepEqual(se.origin, [11, 11]);
  assert.equal(aimArea('cone', caster, 10.5, 10.5, { R: 3 }), null, 'too close to choose');
  const burst = aimArea('burst', null, 20.2, 7.8, { R: 2 });
  assert.deepEqual(burst.origin, [20, 8]);
  const em = aimArea('emanation', caster, 0, 0, { R: 2 });
  assert.equal(em.cells.length, 20);
  const line = aimArea('line', caster, 20, 10.5, { R: 6 });
  assert.deepEqual(line.origin, [11, 10.5]);
  assert.equal(line.angle, 0);
});

const wall = (id, a, b, t = 'solid', extra = {}) => ({ id, a, b, t, ...extra });

test('effectBlockers: windows and closed doors block, grates and open doors do not', () => {
  const segs = [
    wall('w', [0, 0], [1, 0]),
    wall('g', [0, 1], [1, 1], 'grate'),
    wall('glass', [0, 2], [1, 2], 'window'),
    wall('d', [0, 3], [1, 3], 'door', { door: { id: 'd1' } }),
    wall('e', [0, 4], [1, 4], 'ethereal'),
  ];
  const ids = (st) => effectBlockers(segs, st, PF2E_SYSTEM.areas.lineOfEffect).map((s) => s.id).sort();
  assert.deepEqual(ids({}), ['d', 'glass', 'w']);
  assert.deepEqual(ids({ doors: { d1: { state: 'open' } } }), ['glass', 'w']);
});

test('a wall stops a burst; squares behind it are not reached', () => {
  // wall along x = 12 from y = 0 to 20
  const blockers = effectBlockers([wall('w', [12, 0], [12, 20])]);
  const a = buildArea('burst', null, 10, 10, { R: 4, blockers });
  assert.ok(a.covered.length > a.cells.length);
  assert.ok(a.cells.every(([c]) => c < 12));
  assert.ok(has(a.cells, 11, 10));
});

test('a burst on a wall line spreads on both sides; a caster against a wall cannot cone through it', () => {
  const blockers = effectBlockers([wall('w', [0, 10], [30, 10])]);
  const b = buildArea('burst', null, 10, 10, { R: 2, blockers });
  assert.equal(b.cells.length, 12);
  const caster = { x: 10, y: 10, size: 1 }; // the wall runs along its north edge
  const c = buildArea('cone', caster, 10.5, 5, { R: 3, blockers });
  assert.equal(c.cells.length, 0);
  const s = buildArea('cone', caster, 10.5, 16, { R: 3, blockers });
  assert.equal(s.cells.length, s.covered.length);
});

test('emanation reaches from any square of the caster; one-way walls block only from their side', () => {
  const blockers = effectBlockers([wall('w', [12, 0], [12, 20])]);
  const e = buildArea('emanation', { x: 10, y: 10, size: 2 }, 0, 0, { R: 1, blockers });
  assert.ok(has(e.cells, 9, 9) && !has(e.cells, 12, 10));
  // dir 1: blocks only from the left of a->b; a->b runs south, so its left is east
  const oneWay = effectBlockers([wall('w', [12, 0], [12, 20], 'solid', { dir: 1 })]);
  assert.ok(clearPath([10.5, 10.5], [13.5, 10.5], oneWay));
  assert.ok(!clearPath([13.5, 10.5], [10.5, 10.5], oneWay));
});

test('reachedCells with no walls keeps every square', () => {
  const a = buildArea('line', { x: 0, y: 0, size: 1 }, 10, 0.5, { R: 6, blockers: [] });
  assert.equal(a.cells.length, a.covered.length);
  assert.deepEqual(reachedCells({ shape: 'burst', origin: [0, 0], cells: [[0, 0]] }, null, []), [[0, 0]]);
});

test('tokensInCells counts any square of a space; cornerDistance measures to the caster', () => {
  const cells = [[5, 5], [6, 5]];
  const hit = tokensInCells(cells, { a: { x: 5, y: 5 }, big: { x: 6, y: 4, size: 2 }, far: { x: 9, y: 9 }, tiny: { x: 6.5, y: 5.5, size: 0.5 } });
  assert.deepEqual(hit.sort(), ['a', 'big', 'tiny']);
  assert.equal(cornerDistance({ x: 10, y: 10, size: 1 }, 11, 11), 0);
  assert.equal(cornerDistance({ x: 10, y: 10, size: 1 }, 14, 11), 3);
});

test('describeArea', () => {
  assert.equal(describeArea({ shape: 'cone', ft: 15, casterName: 'Ezren', dir: 0 }), '15-ft cone from Ezren, facing north');
  assert.equal(describeArea({ shape: 'emanation', ft: 10, casterName: 'Kyra' }), '10-ft emanation around Kyra');
  assert.equal(describeArea({ shape: 'line', ft: 60, casterName: 'Ezren', angle: Math.PI / 2 }), '60-ft line from Ezren, angle 90°');
});

test('area CLI: builds the record the board stores, with who is in the area', async () => {
  const { areaFromOptions } = await import('../tools/area.mjs');
  const { loadMap } = await import('../tools/sight.mjs');
  const fs = await import('node:fs');
  const { map, segs } = loadMap('examples/sample-pack/maps/sample-keep');
  const state = JSON.parse(fs.readFileSync('examples/campaigns/keep-test/maps/sample-keep.json', 'utf8'));
  const sys = PF2E_SYSTEM;
  const CULTIST = 'tok-u1t8r9h7', SKEL1 = 'tok-e6km1o1q', LYRA = 'tok-s85mkapz';   // Varsha Kell (alias Hooded Cultist), Cracked-Skull Skeleton, Lyra
  const b = areaFromOptions({ map, segs, state, sys, shape: 'burst', ft: 15, at: [34, 10], caster: 'Hooded Cultist', id: 'tpl-test0001' });
  assert.equal(b.path, 'templates/tpl-test0001');
  assert.equal(b.record.caster, CULTIST, 'found by the name players see');
  assert.equal(b.record.casterName, 'Hooded Cultist', 'the record players see never names her');
  assert.equal(b.record.map, 'sample-keep');
  assert.ok(b.inArea.some((t) => t.id === SKEL1));
  const e = areaFromOptions({ map, segs, state, sys, shape: 'emanation', ft: 10, caster: 'Lyra' });
  assert.equal(e.inArea[0].id, LYRA, 'an emanation targets its caster');
  const l = areaFromOptions({ map, segs, state, sys, shape: 'line', ft: 60, caster: 'Lyra', angle: 30 });
  assert.match(l.describe, /angle 30°/);
  assert.ok(l.reached < l.covered, 'the keep wall stops the line');
  const open = areaFromOptions({ map, segs, state, sys, shape: 'line', ft: 60, caster: 'Lyra', angle: 30, walls: false });
  assert.equal(open.reached, open.covered);
  const flyer = { ...state, tokens: { ...state.tokens, [SKEL1]: { ...state.tokens[SKEL1], elevation: 40 } } };
  const hi = areaFromOptions({ map, segs, state: flyer, sys, shape: 'burst', ft: 15, at: [34, 10], caster: 'Varsha Kell' });
  assert.ok(hi.outOfReach.some((t) => t.id === SKEL1 && t.elevation === 40), 'a skeleton 40 ft up is over the burst');
  const air = areaFromOptions({ map, segs, state: flyer, sys, shape: 'burst', ft: 15, at: [34, 10], caster: CULTIST, height: 40 });
  assert.ok(air.inArea.some((t) => t.id === SKEL1) && air.record.height === 40, 'an airburst at 40 ft reaches it');
  assert.throws(() => areaFromOptions({ map, segs, state, sys, shape: 'cone', ft: 15 }), /needs --caster/);
  assert.throws(() => areaFromOptions({ map, segs, state, sys, shape: 'cone', ft: 15, caster: 'Pip', dir: 'up' }), /--dir must be/);
  assert.throws(() => areaFromOptions({ map, segs, state, sys, shape: 'emanation', ft: 10, caster: 'Nobody' }), /no token is called "Nobody"/);
});

test('three dimensions: creature height, vertical gap and 3-D distance (10 ft across, 45 ft up = 50 ft)', async () => {
  const { verticalGap, spaceDistance3D, heightSquares } = await import('../engine/measure/measure.js');
  const { creatureDistance3D } = await import('../rulesets/systems.js');
  assert.equal(heightSquares(0.5), 1); assert.equal(heightSquares(2), 2);
  const ground = { x: 0, y: 0, size: 1 }, bird = (e, x = 0) => ({ x, y: 0, size: 1, elevation: e });
  assert.equal(verticalGap(ground, bird(0)), 0);
  assert.equal(verticalGap(ground, bird(5)), 1, 'right on top: adjacent');
  assert.equal(verticalGap(ground, bird(45)), 9);
  assert.equal(verticalGap({ ...ground, size: 2 }, bird(5)), 0, 'a Large creature is 10 ft tall');
  assert.equal(verticalGap(bird(45), ground), 9, 'the same from above');
  // 10 ft across: nearest squares 2 apart
  const far = spaceDistance3D(ground, bird(45, 2));
  assert.deepEqual(far, { cells: 10, across: 2, up: 9 });
  const d = creatureDistance3D(PF2E_SYSTEM, ground, bird(45, 2), spaceDistance3D);
  assert.deepEqual(d, { feet: 50, across: 10, up: 45 });
  assert.equal(creatureDistance3D(PF2E_SYSTEM, ground, bird(0, 3), spaceDistance3D).feet, 15, 'flat as before');
  assert.equal(creatureDistance3D(PF2E_SYSTEM, ground, bird(15, 3), spaceDistance3D).feet, 20, 'Kerra 15 ft up, 15 ft across');
});

test('areas in three dimensions: bursts and cones reach up as far as their size allows, lines are one square tall', async () => {
  const { areaReaches, tokensInArea } = await import('../engine/areas/areas.js');
  const b = buildArea('burst', null, 10, 10, { R: 4 });   // 20-ft burst on the ground
  const at = (x, y, e) => ({ x, y, size: 1, elevation: e });
  const o = { R: 4 };
  assert.ok(areaReaches(b, at(10, 10, 0), o), 'next to the point, on the ground');
  assert.ok(areaReaches(b, at(10, 10, 15), o), '15 ft up next to the point: 3 + 1 = 4 squares');
  assert.equal(areaReaches(b, at(10, 10, 20), o), false, '20 ft up is 5 squares');
  assert.equal(areaReaches(b, at(12, 12, 5), o), false, 'near the edge only the ground is reached');
  assert.ok(areaReaches(b, at(12, 12, 0), o));
  const airburst = { R: 4, height: 30 };
  assert.ok(areaReaches(b, at(10, 10, 30), airburst) && !areaReaches(b, at(10, 10, 0), airburst), 'a burst in the air misses the ground');
  const r = tokensInArea(b, { a: at(10, 10, 0), hawk: at(10, 10, 40), off: at(30, 30, 0) }, o);
  assert.deepEqual(r, { in: ['a'], over: ['hawk'] });
  const caster = { x: 5, y: 5, size: 1, elevation: 0 };
  const line = buildArea('line', caster, 15, 5.5, { R: 6 });
  assert.ok(areaReaches(line, at(8, 5, 0), { R: 6, height: 0 }));
  assert.equal(areaReaches(line, at(8, 5, 5), { R: 6, height: 0 }), false, 'a line along the ground passes under a flyer');
  const em = buildArea('emanation', caster, 0, 0, { R: 2 });
  assert.ok(areaReaches(em, at(6, 5, 5), { R: 2, caster }), 'just above, next to the caster');
  assert.equal(areaReaches(em, at(6, 5, 15), { R: 2, caster }), false);
  assert.ok(areaReaches(em, at(6, 5, 0), { R: 2, caster: { ...caster, elevation: 10 } }), 'a caster 10 ft up still reaches the ground next to it (2 squares)');
});
