// Explored areas: merging what the party sees into what it has seen before.
// Implements docs/design/maps.md sections 7 and 8. Dependency-free; runs in the browser and in Node.
//
// The explored area is stored as outlines (rings of points in cells, on the 1/8 cell grid).
// Merging works on a bitmap with 8 x 8 pixels per cell: rasterize the stored outlines, add the new
// visibility polygons, then trace the result back into outlines. Tracing is exact (pixel edges);
// the outlines are then simplified only when the simplified version rasterizes to the identical
// bitmap, so repeated merges can never grow or shrink the explored area by themselves.

import { simplify as dropCollinear } from '../sight/visibility.js';

export const RES = 8; // pixels per cell = 1/8 cell precision (design decision 1)

/** A bitmap of explored 1/8-cell pixels for one map. */
export class ExploredMask {
  /** @param {{cols: number, rows: number}} grid */
  constructor(grid, res = RES) {
    this.res = res;
    this.w = Math.ceil(grid.cols * res);
    this.h = Math.ceil(grid.rows * res);
    this.bits = new Uint8Array(this.w * this.h);
  }

  /** Build a mask from stored outlines ({polys}) as found in a save. */
  static fromExplored(explored, grid, res = RES) {
    const m = new ExploredMask(grid, res);
    if (explored && explored.polys && explored.polys.length) fillEvenOdd(m, explored.polys);
    return m;
  }

  /** Is the point (in cells) explored? */
  at(x, y) {
    const i = Math.floor(x * this.res), j = Math.floor(y * this.res);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return false;
    return this.bits[j * this.w + i] === 1;
  }

  /** Number of explored pixels. */
  count() {
    let n = 0;
    for (const b of this.bits) n += b;
    return n;
  }

  /**
   * Add visibility polygons (each filled on its own, then OR-ed in).
   * @returns {boolean} true when the explored area grew
   */
  add(polys) {
    let changed = false;
    for (const p of polys) {
      if (p && p.length >= 3) changed = fillEvenOdd(this, [p]) || changed;
    }
    return changed;
  }

  /** Outlines of the explored area, in cells, on the 1/8 grid. */
  toPolys() {
    const exact = trace(this);
    for (const tol of [0.45, 0.25]) {
      const simple = exact.map((r) => simplifyRing(r, tol / this.res)).filter((r) => r.length >= 3);
      if (sameRaster(this, simple)) return simple;
    }
    return exact;
  }
}

/**
 * Fill rings into the mask with the even-odd rule, sampling each pixel at its centre.
 * @returns {boolean} whether any pixel changed from 0 to 1
 */
function fillEvenOdd(m, rings) {
  const { w, h, res, bits } = m;
  let minY = Infinity, maxY = -Infinity;
  for (const r of rings) for (const p of r) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  const j0 = Math.max(0, Math.floor(minY * res)), j1 = Math.min(h - 1, Math.ceil(maxY * res));
  let changed = false;
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const y = (j + 0.5) / res;
    xs.length = 0;
    for (const r of rings) {
      for (let k = 0, l = r.length - 1; k < r.length; l = k++) {
        const [xk, yk] = r[k], [xl, yl] = r[l];
        if ((yk > y) !== (yl > y)) xs.push(xk + ((y - yk) * (xl - xk)) / (yl - yk));
      }
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const i0 = Math.max(0, Math.ceil(xs[q] * res - 0.5));
      const i1 = Math.min(w - 1, Math.ceil(xs[q + 1] * res - 0.5) - 1);
      for (let i = i0; i <= i1; i++) {
        const k = j * w + i;
        if (!bits[k]) { bits[k] = 1; changed = true; }
      }
    }
  }
  return changed;
}

/** Does filling `rings` (even-odd) reproduce exactly the bits of `m`? */
function sameRaster(m, rings) {
  const t = new ExploredMask({ cols: m.w / m.res, rows: m.h / m.res }, m.res);
  fillEvenOdd(t, rings);
  const a = m.bits, b = t.bits;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Directions in screen order: 0 east, 1 south, 2 west, 3 north.
const STEP = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/**
 * Trace pixel-edge outlines with the explored side always on the right (screen coordinates).
 * Where two regions touch only at a corner, the right-hand turn is taken so they stay separate.
 * @returns {Array<Array<[number, number]>>} rings in cells
 */
function trace(m) {
  const { w, h, res, bits } = m;
  const on = (i, j) => i >= 0 && j >= 0 && i < w && j < h && bits[j * w + i] === 1;
  const W1 = w + 1;
  const out = new Map(); // vertex key -> outgoing edges [{dir, used}]
  const add = (x, y, dir) => {
    const k = y * W1 + x;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push({ x, y, dir, used: false });
  };
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!bits[j * w + i]) continue;
      if (!on(i, j - 1)) add(i, j, 0);         // top edge, heading east
      if (!on(i + 1, j)) add(i + 1, j, 1);     // right edge, heading south
      if (!on(i, j + 1)) add(i + 1, j + 1, 2); // bottom edge, heading west
      if (!on(i - 1, j)) add(i, j + 1, 3);     // left edge, heading north
    }
  }
  const rings = [];
  for (const edges of out.values()) {
    for (const start of edges) {
      if (start.used) continue;
      const pts = [];
      let e = start;
      let prevDir = -1;
      while (e && !e.used) {
        e.used = true;
        if (e.dir !== prevDir) pts.push([e.x / res, e.y / res]);
        prevDir = e.dir;
        const nx = e.x + STEP[e.dir][0], ny = e.y + STEP[e.dir][1];
        const cand = (out.get(ny * W1 + nx) || []).filter((c) => !c.used);
        if (!cand.length) break;
        const pref = [(e.dir + 1) % 4, e.dir, (e.dir + 3) % 4];
        e = pref.map((d) => cand.find((c) => c.dir === d)).find(Boolean) || cand[0];
      }
      // the first point may be collinear with the last segment when the ring started mid-run
      const ring = dropCollinear(pts, 1e-9);
      if (ring.length >= 3) rings.push(ring);
    }
  }
  return rings;
}

/** Perpendicular distance from p to the line through a and b. */
function lineDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  if (!L) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / L;
}

/** Douglas-Peucker on an open polyline; keeps original vertices only (so points stay on the 1/8 grid). */
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  let best = -1, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = lineDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > best) { best = d; idx = i; }
  }
  if (best <= tol) return [pts[0], pts[pts.length - 1]];
  const left = dp(pts.slice(0, idx + 1), tol), right = dp(pts.slice(idx), tol);
  return left.slice(0, -1).concat(right);
}

/** Simplify a closed ring: split at the vertex farthest from the first one and run DP on both halves. */
function simplifyRing(ring, tol) {
  if (ring.length < 5) return ring;
  let far = 0, fd = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const a = dp(ring.slice(0, far + 1), tol);
  const b = dp(ring.slice(far).concat([ring[0]]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

/**
 * Merge visibility polygons into a stored explored area.
 * @param {{v: number, polys: Array}|undefined} explored  from the save
 * @param {Array} visible  visibility polygons (e.g. every viewpoint polygon of every PC)
 * @param {{cols: number, rows: number}} grid
 * @returns {{changed: boolean, explored: {v: number, polys: Array}}}
 */
export function mergeExplored(explored, visible, grid) {
  const base = explored || { v: 0, polys: [] };
  const m = ExploredMask.fromExplored(base, grid);
  if (!m.add(visible)) return { changed: false, explored: base };
  return { changed: true, explored: { v: (base.v || 0) + 1, polys: m.toPolys() } };
}
