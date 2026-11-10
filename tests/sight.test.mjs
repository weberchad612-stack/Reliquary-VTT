import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  prepare, visPolygon, canSee, canSeeAny, tokenPoints, polygonArea, pointInPolygon, pointSegDist,
} from '../engine/sight/visibility.js';
import { loadMap } from '../tools/sight.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPTS = { rangeFt: 200, feetPerCell: 5 };

// A 10 x 10 room with nothing in it, plus whatever extra segments a test adds.
const box = [
  { id: 'n', a: [0, 0], b: [10, 0], t: 'solid' },
  { id: 'e', a: [10, 0], b: [10, 10], t: 'solid' },
  { id: 's', a: [10, 10], b: [0, 10], t: 'solid' },
  { id: 'w', a: [0, 10], b: [0, 0], t: 'solid' },
];
const room = (...extra) => [...box, ...extra];
const sees = (segs, from, to, state = {}, opts = OPTS) => canSee(from, to, prepare(segs, state), opts);
// A vertical wall at x = 5 across the whole room.
const wall = (t, extra = {}) => ({ id: 'x', a: [5, 0], b: [5, 10], t, ...extra });
const W = [2, 5], E = [8, 5]; // viewer west of x=5, target east of it

// ---- Section 6 semantics ----

test('open room: everything visible, polygon is the room', () => {
  const p = prepare(box);
  assert.ok(canSee([1, 1], [9, 9], p, OPTS));
  assert.ok(Math.abs(Math.abs(polygonArea(visPolygon([5, 5], p, OPTS))) - 100) < 1e-6);
});

test('normal (solid) wall blocks sight', () => {
  assert.equal(sees(room(wall('solid')), W, E), false);
});

test('none: grate and window let sight through', () => {
  assert.equal(sees(room(wall('grate')), W, E), true);
  assert.equal(sees(room(wall('window')), W, E), true);
});

test('ethereal barrier blocks sight', () => {
  assert.equal(sees(room(wall('ethereal')), W, E), false);
});

test('limited: see past one terrain wall, not two', () => {
  const one = room(wall('terrain'));
  const two = room(wall('terrain'), { id: 'y', a: [7, 0], b: [7, 10], t: 'terrain' });
  assert.equal(sees(one, W, E), true);
  assert.equal(sees(two, W, E), false);
  assert.equal(sees(two, W, [6, 5]), true, 'between the two terrain walls is still visible');
});

test('limited: two pieces of one terrain wall meeting at a point count once', () => {
  const split = room({ id: 't1', a: [5, 0], b: [5, 5], t: 'terrain' }, { id: 't2', a: [5, 5], b: [5, 10], t: 'terrain' });
  assert.equal(sees(split, [2, 5], [8, 5]), true, 'ray through the shared endpoint');
  assert.equal(sees(split, [2, 2], [8, 8]), true);
});

test('limited plus normal stops at the normal wall', () => {
  const segs = room(wall('terrain'), { id: 'y', a: [7, 0], b: [7, 10], t: 'solid' });
  assert.equal(sees(segs, W, [6, 5]), true);
  assert.equal(sees(segs, W, E), false);
});

test('proximity (arrow slit): see through only from close by', () => {
  const slit = room(wall('slit', { prox: { sight: 5 } }));
  assert.equal(sees(slit, [4.5, 5], E), true, '2.5 ft from the slit');
  assert.equal(sees(slit, [4, 5], E), true, 'exactly 5 ft counts as close');
  assert.equal(sees(slit, [2, 5], E), false, '15 ft away');
});

test('reverse proximity: see through only from far away', () => {
  const rp = room(wall('solid', { sight: 40, prox: { sight: 10 } }));
  assert.equal(sees(rp, [1, 5], E), true, '20 ft away');
  assert.equal(sees(rp, [4, 5], E), false, '5 ft away');
});

test('one-way wall: blocks only from the restricted side', () => {
  // a->b runs north to south at x=5; its left (dir 1) is the east side.
  const oneWay = room({ id: 'x', a: [5, 0], b: [5, 10], t: 'solid', dir: 1 });
  assert.equal(sees(oneWay, E, W), false, 'from the east: blocked');
  assert.equal(sees(oneWay, W, E), true, 'from the west: see through');
  const other = room({ id: 'x', a: [5, 0], b: [5, 10], t: 'solid', dir: 2 });
  assert.equal(sees(other, W, E), false);
  assert.equal(sees(other, E, W), true);
});

test('doors: closed and locked block, open passes', () => {
  const door = room({ id: 'x', a: [5, 0], b: [5, 10], t: 'door', door: { id: 'd1' } });
  assert.equal(sees(door, W, E), false);
  assert.equal(sees(door, W, E, { doors: { d1: { state: 'locked' } } }), false);
  assert.equal(sees(door, W, E, { doors: { d1: { state: 'open' } } }), true);
});

test('secret door: blocks until found and opened', () => {
  const sd = room({ id: 'x', a: [5, 0], b: [5, 10], t: 'secret', door: { id: 's1' } });
  assert.equal(sees(sd, W, E), false);
  assert.equal(sees(sd, W, E, { doors: { s1: { state: 'open' } } }), false, 'not found yet');
  assert.equal(sees(sd, W, E, { doors: { s1: { found: true } } }), false, 'found but closed');
  assert.equal(sees(sd, W, E, { doors: { s1: { found: true, state: 'open' } } }), true);
});

test('range: targets beyond vision range are not visible', () => {
  const big = [{ id: 'n', a: [0, 0], b: [100, 0], t: 'solid' }];
  const p = prepare(big);
  assert.equal(canSee([1, 1], [41, 1], p, OPTS), true, '200 ft');
  assert.equal(canSee([1, 1], [42, 1], p, OPTS), false, '205 ft');
  const poly = visPolygon([50, 50], p, OPTS);
  assert.ok(poly.every((q) => Math.hypot(q[0] - 50, q[1] - 50) <= 40 + 1e-6), 'polygon clipped to range');
});

test('corners: two walls meeting at a point do not leak sight', () => {
  const corner = room({ id: 'h', a: [2, 5], b: [5, 5], t: 'solid' }, { id: 'v', a: [5, 5], b: [5, 8], t: 'solid' });
  assert.equal(sees(corner, [4, 4], [6, 6]), false, 'ray through the shared corner');
});

test('grazing along a wall is not blocked by it', () => {
  const segs = room({ id: 'h', a: [2, 5], b: [8, 5], t: 'solid' });
  assert.equal(sees(segs, [1, 5], [9, 5]), true);
});

test('polygon points are inside the room and contain the viewer', () => {
  const poly = visPolygon([3, 3], prepare(room(wall('solid'))), OPTS);
  assert.ok(pointInPolygon([4, 8], poly));
  assert.ok(!pointInPolygon([7, 5], poly));
  assert.ok(Math.abs(Math.abs(polygonArea(poly)) - 50) < 1e-6, 'half the room');
});

test('helpers: point-segment distance and token points', () => {
  assert.equal(pointSegDist([0, 5], [5, 0], [5, 10]), 5);
  assert.equal(pointSegDist([5, 12], [5, 0], [5, 10]), 2);
  const pts = tokenPoints(2, 3);
  assert.deepEqual(pts[0], [2.5, 3.5]);
  assert.equal(pts.length, 5);
});

// ---- Golden positions on the sample crypt ----

const crypt = loadMap(path.join(ROOT, 'examples', 'sample-pack', 'maps', 'sample-crypt'));
const saveState = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'sample-save', 'maps', 'sample-crypt.json'), 'utf8'));
const csee = (from, to, state = {}) => canSee(from, to, prepare(crypt.segs, state), OPTS);

test('crypt: hall door blocks when closed, passes when open (save state)', () => {
  assert.equal(csee([5.5, 4.5], [7.5, 4.5]), false);
  assert.equal(csee([5.5, 4.5], [7.5, 4.5], saveState), true);
});

test('crypt: locked vault door blocks; window beside it does not', () => {
  assert.equal(csee([7.5, 4.5], [7.5, 6.5], saveState), false);
  assert.equal(csee([8.5, 4.5], [8.5, 6.5], saveState), true);
});

test('crypt: arrow slit works only up close', () => {
  assert.equal(csee([10.6875, 4.75], [10.6875, 6.5]), true, '1.25 ft from the slit');
  assert.equal(csee([10.6875, 2.5], [10.6875, 6.5]), false, '12.5 ft from the slit');
});

test('crypt: one curtain does not block', () => {
  assert.equal(csee([7.5, 1.5], [10.5, 1.5]), true);
});

test('crypt: illusory wall blocks only from the north', () => {
  assert.equal(csee([9.5, 6.5], [9.5, 8.5]), false);
  assert.equal(csee([9.5, 8.5], [9.5, 6.5]), true);
});

test('crypt: portcullis passes sight, force barrier stops it', () => {
  assert.equal(csee([2.5, 5.5], [2.5, 7.5]), true);
  assert.equal(csee([2.5, 7.5], [4.5, 8.5]), false);
});

test('crypt: secret panel hides the corridor until found and opened', () => {
  assert.equal(csee([5.5, 8.5], [7.5, 8.5], saveState), false, 'found but still closed in the sample save');
  const opened = { doors: { ...saveState.doors, s01: { found: true, state: 'open' } } };
  assert.equal(csee([5.5, 8.5], [7.5, 8.5], opened), true);
});

test('crypt: canSeeAny with token points sees a guard through the window', () => {
  const p = prepare(crypt.segs, saveState);
  assert.equal(canSeeAny(tokenPoints(8, 3), tokenPoints(8, 6), p, OPTS), true);
  assert.equal(canSeeAny(tokenPoints(1, 1), tokenPoints(9, 8), p, OPTS), false);
});

// ---- Token footprints (docs/design/maps.md section 8) ----

import { footprintPoints, viewpoints, tokenSight, tokenCanSee } from '../engine/sight/visibility.js';

test('footprint point counts: 1x1 5, 2x2 8, 3x3 12, 4x4 16, Tiny 5', () => {
  assert.equal(footprintPoints(0, 0, 1).length, 5);
  assert.equal(footprintPoints(0, 0, 2).length, 8);
  assert.equal(footprintPoints(0, 0, 3).length, 12);
  assert.equal(footprintPoints(0, 0, 4).length, 16);
  assert.equal(footprintPoints(0, 0, 0.5).length, 5);
});

test('footprint points stay inside the space', () => {
  for (const size of [0.5, 1, 2, 3, 4]) {
    for (const [px, py] of footprintPoints(3, 4, size)) {
      assert.ok(px > 3 && px < 3 + size && py > 4 && py < 4 + size, `size ${size}: (${px}, ${py})`);
    }
  }
  assert.deepEqual(footprintPoints(2.5, 2.5, 0.5)[0], [2.75, 2.75], 'Tiny token on a half-cell position');
});

test('a large token sees around a corner its centre cannot', () => {
  // Wall along y = 5 from x = 0 to 4; a 2x2 token at (4,3) has its east edge past the wall end.
  const segs = room({ id: 'h', a: [0, 5], b: [4.5, 5], t: 'solid' });
  const p = prepare(segs);
  const target = { x: 1, y: 7, size: 1 };
  assert.equal(tokenCanSee({ x: 3, y: 3, size: 1 }, target, p, OPTS), false, 'Medium token at (3,3) cannot see it');
  assert.equal(tokenCanSee({ x: 3, y: 3, size: 2 }, target, p, OPTS), true, 'Large token whose space reaches x = 5 can');
});

test('a large target is seen when any part of its space is visible', () => {
  const segs = room({ id: 'v', a: [5, 0], b: [5, 7], t: 'solid' });
  const p = prepare(segs);
  const viewer = { x: 1, y: 1, size: 1 };
  assert.equal(tokenCanSee(viewer, { x: 6, y: 2, size: 1 }, p, OPTS), false, 'Medium creature behind the wall');
  assert.equal(tokenCanSee(viewer, { x: 6, y: 6, size: 3 }, p, OPTS), true, 'Huge creature extends below the wall end');
});

test('viewpoints behind a wall the token overlaps are dropped', () => {
  // Wall along x = 5.25; a 2x2 token placed at (4,4) straddles it, centre (5,5) on the west side.
  const segs = room({ id: 'v', a: [5.25, 0], b: [5.25, 10], t: 'solid' });
  const p = prepare(segs);
  const vp = viewpoints(4, 4, 2, p, OPTS);
  assert.equal(vp.length, 4, 'the 4 points west of the wall are kept, the 4 east of it dropped');
  assert.ok(vp.every((q) => q[0] < 5.25));
  assert.equal(tokenCanSee({ x: 4, y: 4, size: 2 }, { x: 8, y: 5, size: 1 }, p, OPTS), false);
});

test('tokenSight returns one polygon per viewpoint', () => {
  const p = prepare(box);
  assert.equal(tokenSight({ x: 4, y: 4, size: 3 }, p, OPTS).length, 12);
  assert.equal(tokenSight({ x: 4, y: 4 }, p, OPTS).length, 5);
});

test('unlimited sight range: rays that hit nothing stop just past the edge of the map', async () => {
  const { visPolygon: vp, pointInPolygon: pip } = await import('../engine/sight/visibility.js');
  const grid = { cols: 100, rows: 20 };
  const walls = [{ id: 'w', a: [10, 0], b: [10, 8], v: 20, dir: 0 }];
  const poly = vp([2, 10], walls, { grid });
  assert.ok(poly.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])), 'no point at infinity');
  assert.ok(pip([99, 10], poly), 'sees to the far end of a 500 ft map');
  assert.ok(!pip([12, 1], poly), 'still not through the wall');
  const limited = vp([2, 10], walls, { grid, rangeFt: 200 });
  assert.ok(!pip([99, 10], limited), 'a range still limits it when given');
});
