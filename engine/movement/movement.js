// Movement: can a token take a step, does it fit, and how does it get somewhere.
// Implements docs/design/maps.md section 9. Dependency-free; runs in the browser and in Node.
//
// Tokens are {x, y, size}: the top-left cell of their space and its side in cells (Large = 2).
// The engine knows nothing about a game system. Rules such as diagonal cost, difficult terrain,
// squeezing and moving through other creatures come in as options from the ruleset.

import { prepare } from '../sight/visibility.js';
import { blocksFrom } from '../walls/presets.js';

const E = 1e-6;

/**
 * Default movement clearance, in cells. Walls may poke this far into a square without blocking it:
 * hand-drawn maps rarely line doorways up with the grid (a 1.5-cell door centred on a grid line
 * leaves a quarter-cell jamb in each square). 0.3 cells is 1.5 ft on a 5-ft grid; a 2x2 creature
 * still cannot use a 5-ft door and diagonals still cannot cut wall corners.
 */
export const CLEARANCE = 0.3;

/**
 * Prepare a map's walls for movement queries.
 * @param {Array} segs  wall segments (all wall files concatenated)
 * @param {object} state  map state from the save (door states, found secrets)
 * @param {{cols: number, rows: number}} grid
 */
export function prepareMove(segs, state, grid) {
  const list = prepare(segs, state, 'move');
  const index = new Map();
  for (const s of list) {
    const x0 = Math.floor(Math.min(s.a[0], s.b[0])) - 1, x1 = Math.floor(Math.max(s.a[0], s.b[0]));
    const y0 = Math.floor(Math.min(s.a[1], s.b[1])) - 1, y1 = Math.floor(Math.max(s.a[1], s.b[1]));
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = x + ',' + y;
        if (!index.has(k)) index.set(k, []);
        index.get(k).push(s);
      }
    }
  }
  return { list, index, cols: grid.cols, rows: grid.rows };
}

/** Segments whose bounding box is near rectangle r = [x0, y0, x1, y1]. */
function near(pm, r) {
  const out = new Set();
  for (let x = Math.floor(r[0]); x <= Math.floor(r[2]); x++) {
    for (let y = Math.floor(r[1]); y <= Math.floor(r[3]); y++) {
      const b = pm.index.get(x + ',' + y);
      if (b) for (const s of b) out.add(s);
    }
  }
  return out;
}

/** True when segment a-b passes through the open interior of rectangle r (Liang-Barsky clipping). */
export function crossesInterior(a, b, r) {
  const x0 = r[0] + E, y0 = r[1] + E, x1 = r[2] - E, y1 = r[3] - E;
  if (x0 >= x1 || y0 >= y1) return false;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - x0, x1 - a[0], a[1] - y0, y1 - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return t1 - t0 > E;
}

const rect = (x, y, s) => [x, y, x + s, y + s];
const shrink = (r, c) => [r[0] + c, r[1] + c, r[2] - c, r[3] - c];
const inBounds = (pm, x, y, s) => x >= -E && y >= -E && x + s <= pm.cols + E && y + s <= pm.rows + E;

/**
 * Does a token of `size` fit with its space starting at (x, y): inside the grid and no wall through it?
 * @param {number} [clearance=CLEARANCE]  walls may poke this far (cells) into the space
 */
export function fits(pm, x, y, size = 1, clearance = CLEARANCE) {
  if (!inBounds(pm, x, y, size)) return false;
  const r = shrink(rect(x, y, size), Math.min(clearance, size * 0.4));
  for (const s of near(pm, r)) if (crossesInterior(s.a, s.b, r)) return false;
  return true;
}

/**
 * Can a token take one step of (dx, dy), each -1, 0 or 1?
 * - The space at the destination must fit (no wall through it).
 * - The area swept by the step must not cross a wall. For a diagonal step that is the whole box
 *   around the start and end spaces, so diagonals never cut past a wall corner.
 * - One-way walls only block when the token's centre starts on their restricted side.
 * - A token already overlapping a wall (squeezing) may step away from it, but not deeper into it.
 * @param {object} [opts]
 * @param {number} [opts.size]  footprint to test with instead of token.size (the ruleset passes a
 *                              smaller size when it allows squeezing)
 * @param {number} [opts.clearance=CLEARANCE]  walls may poke this far (cells) into a square
 */
export function canStep(pm, token, dx, dy, opts = {}) {
  if ((dx === 0 && dy === 0) || Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
  const size = opts.size ?? token.size ?? 1;
  const x = token.x, y = token.y, nx = x + dx, ny = y + dy;
  if (!inBounds(pm, nx, ny, size)) return false;
  const c = Math.min(opts.clearance ?? CLEARANCE, size * 0.4);
  const r0 = shrink(rect(x, y, size), c), r1 = shrink(rect(nx, ny, size), c);
  const u = [Math.min(r0[0], r1[0]), Math.min(r0[1], r1[1]), Math.max(r0[2], r1[2]), Math.max(r0[3], r1[3])];
  const centre = [x + size / 2, y + size / 2];
  for (const s of near(pm, u)) {
    if (!blocksFrom(s, centre)) continue;
    if (crossesInterior(s.a, s.b, r1)) return false;
    if (crossesInterior(s.a, s.b, u) && !crossesInterior(s.a, s.b, r0)) return false;
  }
  return true;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Minimal binary heap keyed on cost. */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) {
    const a = this.a; a.push(n);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].cost <= a[i].cost) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].cost < a[m].cost) m = l;
        if (r < a.length && a[r].cost < a[m].cost) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

/**
 * Shortest-cost search from a token's position. Shared by path() and reach().
 * Options (all from the ruleset):
 * - diagonalCosts: costs in cells for successive diagonal steps, repeating. PF2E 5-10-5 is [1, 2]
 *   (the default); D&D 5e's default is [1].
 * - enterCost(x, y, size): extra cost in cells for entering the space at (x, y) (difficult terrain).
 * - passable(x, y, size): false when the space cannot be moved through (occupied by a creature
 *   the mover cannot pass).
 * - size: footprint to move with (squeezing).
 * - maxCost: stop searching beyond this cost in cells.
 */
function search(pm, token, opts, goal) {
  const size = opts.size ?? token.size ?? 1;
  const diag = opts.diagonalCosts || [1, 2];
  const enterCost = opts.enterCost || (() => 0);
  const passable = opts.passable || (() => true);
  const maxCost = opts.maxCost ?? Infinity;
  const best = new Map();
  const prev = new Map();
  const startKey = `${token.x},${token.y},0`;
  best.set(startKey, 0);
  const heap = new Heap();
  heap.push({ x: token.x, y: token.y, p: 0, cost: 0, key: startKey });
  while (heap.size) {
    const n = heap.pop();
    if (n.cost > best.get(n.key)) continue;
    if (goal && n.x === goal[0] && n.y === goal[1]) return { end: n, best, prev };
    for (const [dx, dy] of DIRS) {
      const isDiag = dx !== 0 && dy !== 0;
      const nx = n.x + dx, ny = n.y + dy;
      if (!passable(nx, ny, size)) continue;
      if (!canStep(pm, { x: n.x, y: n.y, size }, dx, dy, { clearance: opts.clearance })) continue;
      const step = (isDiag ? diag[n.p % diag.length] : 1) + enterCost(nx, ny, size);
      const cost = n.cost + step;
      if (cost > maxCost + E) continue;
      const p = isDiag ? (n.p + 1) % diag.length : n.p;
      const key = `${nx},${ny},${p}`;
      if (cost < (best.get(key) ?? Infinity)) {
        best.set(key, cost);
        prev.set(key, n.key);
        heap.push({ x: nx, y: ny, p, cost, key });
      }
    }
  }
  return { end: null, best, prev };
}

/**
 * Cheapest path for a token to move its space to (gx, gy).
 * @returns {{path: Array<[number, number]>, cost: number, feet: number} | null}
 *   `path` lists the top-left cell of each position, start included; null when unreachable.
 */
export function path(pm, token, gx, gy, opts = {}) {
  const feetPerCell = opts.feetPerCell ?? 5;
  if (token.x === gx && token.y === gy) return { path: [[gx, gy]], cost: 0, feet: 0 };
  const { end, prev } = search(pm, token, opts, [gx, gy]);
  if (!end) return null;
  const cells = [];
  for (let k = end.key; k; k = prev.get(k)) {
    const [x, y] = k.split(',').map(Number);
    cells.push([x, y]);
  }
  cells.reverse();
  return { path: cells, cost: end.cost, feet: end.cost * feetPerCell };
}

/**
 * Every position a token can reach within `maxFeet`, with the cheapest cost to get there.
 * @returns {Array<{x: number, y: number, feet: number}>}
 */
export function reach(pm, token, maxFeet, opts = {}) {
  const feetPerCell = opts.feetPerCell ?? 5;
  const { best } = search(pm, token, { ...opts, maxCost: maxFeet / feetPerCell });
  const cheapest = new Map();
  for (const [key, cost] of best) {
    const [x, y] = key.split(',').map(Number);
    const k = x + ',' + y;
    if (cost < (cheapest.get(k) ?? Infinity)) cheapest.set(k, cost);
  }
  return [...cheapest].map(([k, cost]) => {
    const [x, y] = k.split(',').map(Number);
    return { x, y, feet: cost * feetPerCell };
  });
}
