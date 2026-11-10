import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareMove, canStep, fits, path as findPath, reach, strideReach, crossesInterior } from '../engine/movement/movement.js';
import { loadMap } from '../tools/sight.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRID = { cols: 10, rows: 10 };
const box = [
  { id: 'n', a: [0, 0], b: [10, 0], t: 'solid' },
  { id: 'e', a: [10, 0], b: [10, 10], t: 'solid' },
  { id: 's', a: [10, 10], b: [0, 10], t: 'solid' },
  { id: 'w', a: [0, 10], b: [0, 0], t: 'solid' },
];
const pm = (extra = [], state = {}) => prepareMove([...box, ...extra], state, GRID);
// A vertical wall of type t on the line x = 5, full height.
const wall = (t, extra = {}) => ({ id: 'x', a: [5, 0], b: [5, 10], t, ...extra });
const tok = (x, y, size = 1) => ({ x, y, size });

test('geometry: segment through a rectangle interior, not along its edge', () => {
  assert.ok(crossesInterior([5, 0], [5, 10], [4, 4, 6, 6]));
  assert.ok(!crossesInterior([5, 0], [5, 10], [5, 4, 6, 6]), 'on the edge');
  assert.ok(!crossesInterior([0, 0], [3, 3], [4, 4, 6, 6]), 'outside');
  assert.ok(crossesInterior([4.5, 4.5], [4.6, 4.6], [4, 4, 6, 6]), 'fully inside');
});

test('open room: every step allowed, edges of the grid are not', () => {
  const m = pm();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    assert.ok(canStep(m, tok(4, 4), dx, dy), `${dx},${dy}`);
  }
  assert.ok(!canStep(m, tok(0, 0), -1, 0), 'off the grid');
  assert.ok(!canStep(m, tok(4, 4), 2, 0), 'not a single step');
  assert.ok(!canStep(m, tok(4, 4), 0, 0));
});

test('wall types: what blocks movement', () => {
  const blocked = (t, extra) => !canStep(pm([wall(t, extra)]), tok(4, 4), 1, 0);
  assert.ok(blocked('solid'));
  assert.ok(blocked('terrain'), 'terrain walls block walking');
  assert.ok(blocked('grate'), 'portcullis');
  assert.ok(blocked('window'));
  assert.ok(blocked('slit', { prox: { sight: 5 } }));
  assert.ok(!blocked('ethereal'), 'ethereal barriers can be walked through');
});

test('doors: closed, locked and unfound secret doors block; open doors do not', () => {
  const door = { id: 'x', a: [5, 0], b: [5, 10], t: 'door', door: { id: 'd1' } };
  assert.ok(!canStep(pm([door]), tok(4, 4), 1, 0));
  assert.ok(!canStep(pm([door], { doors: { d1: { state: 'locked' } } }), tok(4, 4), 1, 0));
  assert.ok(canStep(pm([door], { doors: { d1: { state: 'open' } } }), tok(4, 4), 1, 0));
  const secret = { id: 'x', a: [5, 0], b: [5, 10], t: 'secret', door: { id: 's1' } };
  assert.ok(!canStep(pm([secret], { doors: { s1: { state: 'open' } } }), tok(4, 4), 1, 0), 'not found');
  assert.ok(!canStep(pm([secret], { doors: { s1: { found: true } } }), tok(4, 4), 1, 0), 'found, closed');
  assert.ok(canStep(pm([secret], { doors: { s1: { found: true, state: 'open' } } }), tok(4, 4), 1, 0));
});

test('one-way walls block movement only from the restricted side', () => {
  // a->b runs north to south at x = 5; dir 1 restricts the left, which is the east side.
  const m = pm([{ id: 'x', a: [5, 0], b: [5, 10], t: 'solid', dir: 1 }]);
  assert.ok(!canStep(m, tok(5, 4), -1, 0), 'east to west: blocked');
  assert.ok(canStep(m, tok(4, 4), 1, 0), 'west to east: allowed');
});

test('no corner cutting: a diagonal step cannot pass a wall corner', () => {
  // Wall ends exactly at the corner point (5, 5).
  const m = pm([{ id: 'h', a: [2, 5], b: [5, 5], t: 'solid' }]);
  assert.ok(!canStep(m, tok(4, 4), 1, 1), 'past the wall end');
  assert.ok(!canStep(m, tok(4, 5), 1, -1));
  assert.ok(canStep(m, tok(5, 4), 1, 1), 'clear of it');
});

test('large tokens must fit: a 2x2 cannot pass a 5-ft gap, a 1x1 can', () => {
  // Wall at x = 5 with a one-cell gap from y = 4 to y = 5.
  const gap = [{ id: 'a', a: [5, 0], b: [5, 4], t: 'solid' }, { id: 'b', a: [5, 5], b: [5, 10], t: 'solid' }];
  const m = pm(gap);
  assert.ok(findPath(m, tok(2, 4), 7, 4), 'Medium finds the gap');
  assert.equal(findPath(m, tok(2, 4, 2), 7, 4), null, 'Large does not fit');
  assert.ok(findPath(m, tok(2, 4, 2), 7, 4, { size: 1 }), 'Large squeezing (ruleset passes a smaller footprint)');
});

test('fits: inside the grid and no wall through the space', () => {
  const m = pm([{ id: 'v', a: [5, 0], b: [5, 3], t: 'solid' }]);
  assert.ok(fits(m, 4, 4, 2));
  assert.ok(!fits(m, 4, 1, 2), 'wall through the middle of a 2x2');
  assert.ok(!fits(m, 9, 9, 2), 'off the grid');
  assert.ok(fits(m, 4.5, 4.5, 0.5), 'Tiny on a half cell');
});

test('a token already overlapping a wall can step away from it but not deeper', () => {
  const m = pm([{ id: 'v', a: [5, 0], b: [5, 10], t: 'solid' }]);
  const stuck = tok(4, 4, 2); // straddles x = 5
  assert.ok(canStep(m, stuck, -1, 0), 'away');
  assert.ok(!canStep(m, tok(3, 4, 2), 1, 0), 'into the wall');
});

test('PF2E diagonals: 5-10-5', () => {
  const m = pm();
  const r = findPath(m, tok(1, 1), 4, 4);
  assert.equal(r.feet, 20, 'three diagonals = 5 + 10 + 5');
  assert.equal(r.path.length, 4);
  assert.equal(findPath(m, tok(1, 1), 3, 3).feet, 15, 'two diagonals = 5 + 10');
  assert.equal(findPath(m, tok(1, 1), 5, 3).feet, 25, 'two diagonals and two straight = 5 + 10 + 5 + 5');
});

test('D&D 5e diagonals: every diagonal costs 5 ft', () => {
  assert.equal(findPath(pm(), tok(1, 1), 4, 4, { diagonalCosts: [1] }).feet, 15);
});

test('difficult terrain and occupied squares come from the ruleset', () => {
  const m = pm();
  const difficult = (x) => (x === 3 ? 1 : 0); // column 3 costs an extra 5 ft per square entered
  assert.equal(findPath(m, tok(1, 5), 5, 5).feet, 20);
  assert.equal(findPath(m, tok(1, 5), 5, 5, { enterCost: difficult }).feet, 25);
  const ogre = (x, y) => !(x === 3 && y >= 0 && y <= 9); // a line of creatures blocking column 3
  assert.equal(findPath(m, tok(1, 5), 5, 5, { passable: ogre }), null);
});

test('reach lists every position within the movement allowance', () => {
  const m = pm();
  const cells = reach(m, tok(4, 4), 10);
  const at = (x, y) => cells.find((c) => c.x === x && c.y === y);
  assert.equal(at(4, 4).feet, 0);
  assert.equal(at(6, 4).feet, 10);
  assert.equal(at(5, 5).feet, 5);
  assert.equal(at(6, 6), undefined, 'two diagonals = 5 + 10 = 15 ft, beyond 10 ft');
  assert.equal(at(7, 4), undefined);
  assert.equal(cells.length, 21, '5x5 square minus the 4 far corners');
});

// ---- Golden positions on the sample crypt ----

const crypt = loadMap(path.join(ROOT, 'examples', 'sample-pack', 'maps', 'sample-crypt'));
const saveState = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'sample-save', 'maps', 'sample-crypt.json'), 'utf8'));
const cm = (state = saveState) => prepareMove(crypt.segs, state, crypt.map.grid);

test('crypt: through the open hall door into the north-east room', () => {
  const r = findPath(cm(), tok(4, 3), 8, 1);
  assert.ok(r);
  assert.equal(r.feet, 30);
  assert.ok(r.path.some(([x, y]) => x === 6 && y === 4), 'passes through the door cell');
  assert.equal(findPath(cm({}), tok(4, 3), 8, 1), null, 'door closed: no route');
});

test('crypt: portcullis, window and locked vault door block; the secret panel needs opening', () => {
  assert.equal(findPath(cm(), tok(1, 1), 1, 8), null, 'portcullis blocks the cell');
  assert.equal(findPath(cm(), tok(8, 3), 8, 7), null, 'window and locked vault door');
  assert.equal(findPath(cm(), tok(9, 9), 1, 8), null, 'secret panel found but still closed');
  const opened = { ...saveState, doors: { ...saveState.doors, s01: { found: true, state: 'open' } } };
  const r = findPath(cm(opened), tok(9, 9), 1, 8);
  assert.ok(r, 'through the opened secret panel and the force barrier');
  assert.ok(r.path.some(([x, y]) => x === 6 && y === 8) && r.path.some(([x, y]) => x === 5 && y === 8), 'via the panel');
  assert.ok(r.path.some(([x]) => x === 3) && r.path.some(([x]) => x === 4), 'across the ethereal barrier at x = 3.5');
});

test('crypt: a Large creature cannot use the 5-ft hall door', () => {
  assert.equal(findPath(cm(), tok(3, 2, 2), 8, 3), null);
  assert.ok(findPath(cm(), tok(3, 2, 1), 8, 3));
});

test('crypt: the illusory wall can be crossed northward only', () => {
  // Illusory wall on y = 8 between x = 8 and 11, blocking only from the north.
  assert.equal(canStep(cm(), tok(9, 7), 0, 1), false, 'from the north: blocked');
  assert.equal(canStep(cm(), tok(9, 7), 0, -1), true, 'already north, moving away');
  assert.equal(canStep(cm(), tok(9, 8), 0, -1), true, 'from the south: allowed');
});

test('clearance: a doorway centred on a grid line still lets a Medium creature through', () => {
  // A wall along y = 5 with a 1.5-cell doorway from x = 4.25 to 5.75 (centred on the grid line x = 5):
  // each jamb pokes a quarter cell into the squares beside the gap.
  const m = pm([{ id: 'l', a: [0, 5], b: [4.25, 5], t: 'solid' }, { id: 'r', a: [5.75, 5], b: [10, 5], t: 'solid' }]);
  assert.ok(findPath(m, tok(4, 2), 4, 7), 'with the default clearance');
  assert.equal(findPath(m, tok(4, 2), 4, 7, { clearance: 0 }), null, 'with no clearance the jambs block every column');
  assert.ok(findPath(m, tok(3, 2, 2), 4, 7), 'a 2x2 creature needs 1.4 cells of clear width, and this door is 1.5');
});

test('Stride bands: each Stride is its own move: feet left over are lost, the diagonal count carries on', () => {
  const grid = { cols: 40, rows: 40 };
  const pm = prepareMove([], {}, grid);
  const t = { x: 5, y: 5, size: 1 };
  const bands = strideReach(pm, t, 25, 3);
  const has = (band, x, y) => band.some((c) => c.x === x && c.y === y);
  const key = (c) => c.x + ',' + c.y;
  assert.equal(bands.length, 3);
  assert.ok(has(bands[0], 10, 5) && !has(bands[0], 11, 5), 'one Stride: 25 ft straight');
  assert.ok(has(bands[1], 15, 5) && has(bands[2], 20, 5), 'two and three Strides: 50 and 75 ft straight');
  assert.ok(has(bands[0], 8, 8) && !has(bands[0], 9, 9), 'one Stride: three diagonals (5 + 10 + 5)');
  assert.ok(bands[0].every((c) => has(bands[1], c.x, c.y)) && bands[1].every((c) => has(bands[2], c.x, c.y)), 'bands nest');
  assert.ok(has(bands[0], 5, 5), 'staying put is in every band');
  // never more than one long move of the same total (the diagonal count carries over) ...
  for (const [k, ft] of [[1, 50], [2, 75]]) {
    const all = new Set(reach(pm, t, ft).map(key));
    assert.ok(bands[k].every((c) => all.has(key(c))), `${k + 1} Strides stay within ${ft} ft`);
  }
  // ... and sometimes less: feet left at the end of a Stride are lost
  const r50 = reach(pm, t, 50);
  assert.ok(r50.some((c) => !has(bands[1], c.x, c.y)), 'some square 50 ft away needs a third Stride');
});

test('Stride bands: a wall is walked round, not through', () => {
  const grid = { cols: 30, rows: 30 };
  const pm = prepareMove([{ id: 'w', t: 'solid', a: [7, 0], b: [7, 12] }], {}, grid);
  const bands = strideReach(pm, { x: 5, y: 5, size: 1 }, 25, 3);
  const has = (band, x, y) => band.some((c) => c.x === x && c.y === y);
  assert.ok(!bands[0].some((c) => c.x >= 7), 'one Stride cannot get past the wall');
  assert.ok(has(bands[1], 8, 11) && !has(bands[1], 8, 5), 'two Strides reach round the end of the wall, not back up behind it');
  assert.ok(has(bands[2], 7, 5), 'three Strides reach the square just behind the wall');
});
