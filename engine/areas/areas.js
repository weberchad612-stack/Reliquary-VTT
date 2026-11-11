// Area templates: which squares a burst, cone, emanation or line covers, and which of them the area
// reaches past walls (line of effect). Implements docs/design/board.md section 7 (area templates).
// Dependency-free; runs in the browser and in Node. Coordinates are in grid cells, y downward.
//
// Sizes are in cells (feet / feet per square). Distances follow the system's diagonal pattern
// (PF2E [1, 2]: 5-10-5), passed in as `costs`. The shapes are those of the old board, which followed
// the PF2E rules for areas (Player Core, ORC licence, paraphrased):
// - Burst: centred on a grid corner; a square is in if the distance to its far corner is within the radius.
// - Cone: from a point on the caster's edge, spreading in one of 8 directions.
// - Emanation: every square within the distance of the caster's space; the space itself is not listed.
// - Line: squares crossed by a line from the caster's edge at any angle, `width` squares wide.

import { SENSE, senseOf, blocksFrom } from '../walls/presets.js';

const EPS = 1e-9;

/** The 8 cone directions, clockwise from north, as [dx, dy]. */
export const DIRECTIONS = Object.freeze([[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]);
export const DIRECTION_NAMES = Object.freeze(['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']);

/**
 * Distance in cells for a reach of a columns and b rows, which may be half-squares: straight squares
 * count 1, the diagonal squares follow `costs` (only whole diagonals count extra). With [1, 2] this is
 * max + floor(min / 2), the old board's measure.
 */
export function areaDistance(a, b, costs = [1, 2]) {
  const mx = Math.max(Math.abs(a), Math.abs(b)), mn = Math.min(Math.abs(a), Math.abs(b));
  let extra = 0;
  const n = Math.floor(mn + EPS);
  for (let i = 0; i < n; i++) extra += costs[i % costs.length] - 1;
  return mx + extra;
}

/** Burst of radius R cells centred on grid corner (ox, oy). */
export function burstCells(ox, oy, R, costs = [1, 2]) {
  ox = Math.round(ox); oy = Math.round(oy);
  const out = [];
  for (let i = 0; i < R; i++) {
    for (let j = 0; j < R; j++) {
      if (areaDistance(i + 1, j + 1, costs) > R + EPS) continue;
      out.push([ox + i, oy + j], [ox - i - 1, oy + j], [ox + i, oy - j - 1], [ox - i - 1, oy - j - 1]);
    }
  }
  return out;
}

/** Cone of length R cells from point (ox, oy) in direction d (index into DIRECTIONS). */
export function coneCells(ox, oy, d, R, costs = [1, 2]) {
  const f = DIRECTIONS[((d % 8) + 8) % 8], out = [];
  if (f[0] && f[1]) {
    const bx = Math.round(ox), by = Math.round(oy);
    for (let i = 0; i < R; i++) {
      for (let j = 0; j < R; j++) {
        if (areaDistance(i + 1, j + 1, costs) <= R + EPS) out.push([f[0] > 0 ? bx + i : bx - i - 1, f[1] > 0 ? by + j : by - j - 1]);
      }
    }
    return out;
  }
  const vert = f[0] === 0, u0 = vert ? ox : oy, v0 = Math.round(vert ? oy : ox), fw = vert ? f[1] : f[0];
  for (let k = 1; k <= R; k++) {
    const v = fw > 0 ? v0 + k - 1 : v0 - k;
    for (let m = Math.floor(u0) - R - 1; m <= Math.ceil(u0) + R; m++) {
      const a = Math.max(Math.abs(m - u0), Math.abs(m + 1 - u0));
      if (a <= k + EPS && areaDistance(k, a, costs) <= R + EPS) out.push(vert ? [m, v] : [v, m]);
    }
  }
  return out;
}

/** Emanation of R cells around a space {x, y, size}; the space itself is not listed. */
export function emanationCells(space, R, costs = [1, 2]) {
  const s = Math.max(1, Math.ceil(space.size || 1)), x = Math.floor(space.x), y = Math.floor(space.y), out = [];
  for (let c = x - R; c < x + s + R; c++) {
    for (let r = y - R; r < y + s + R; r++) {
      const dx = c < x ? x - c : c >= x + s ? c - (x + s) + 1 : 0;
      const dy = r < y ? y - r : r >= y + s ? r - (y + s) + 1 : 0;
      if (!dx && !dy) continue;
      if (areaDistance(dx, dy, costs) <= R + EPS) out.push([c, r]);
    }
  }
  return out;
}

/** Line of R cells from point (ox, oy) at angle `ang` (radians, 0 = east, clockwise on screen), `width` cells wide. */
export function lineCells(ox, oy, ang, R, width = 1, costs = [1, 2]) {
  const W = Math.max(1, Math.round(width)), ux = Math.cos(ang), uy = Math.sin(ang), px = -uy, py = ux;
  const seen = new Set(), out = [], maxT = R * 1.5 + 3;
  for (let j = 0; j < W; j++) {
    const off = j - (W - 1) / 2, sx = ox + px * off, sy = oy + py * off;
    for (let t = 0.001; t <= maxT; t += 0.02) {
      const c = Math.floor(sx + ux * t), r = Math.floor(sy + uy * t), key = c + ',' + r;
      if (seen.has(key)) continue;
      const A = Math.max(Math.abs(c - ox), Math.abs(c + 1 - ox)), B = Math.max(Math.abs(r - oy), Math.abs(r + 1 - oy));
      if (areaDistance(A, B, costs) <= R + EPS) { seen.add(key); out.push([c, r]); }
    }
  }
  return out;
}

const snapHalf = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v * 2) / 2));

/**
 * Aim an area from a caster's space toward a point (gx, gy) in cells, as the mouse does.
 * @param {string} shape  'burst' | 'cone' | 'emanation' | 'line'
 * @param {{x, y, size}} caster  the caster's space (not needed for a burst)
 * @param {number} gx
 * @param {number} gy
 * @param {{R: number, width?: number, costs?: number[]}} o  size in cells, line width in cells, diagonal pattern
 * @returns {{origin: [number, number], dir?: number, angle?: number, cells: Array} | null}  null while the
 *   point is too close to the caster to pick a direction
 */
export function aimArea(shape, caster, gx, gy, { R, width = 1, costs = [1, 2] }) {
  if (shape === 'burst') {
    const ox = Math.round(gx), oy = Math.round(gy);
    return { origin: [ox, oy], cells: burstCells(ox, oy, R, costs) };
  }
  if (!caster) return null;
  const s = Math.max(1, Math.ceil(caster.size || 1)), x = Math.floor(caster.x), y = Math.floor(caster.y);
  if (shape === 'emanation') return { origin: [x + s / 2, y + s / 2], cells: emanationCells({ x, y, size: s }, R, costs) };
  const cx = x + s / 2, cy = y + s / 2, dx = gx - cx, dy = gy - cy;
  if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) return null;
  if (shape === 'cone') {
    const ang = Math.atan2(dx, -dy), d = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8, f = DIRECTIONS[d];
    let ox, oy;
    if (f[0] && f[1]) { ox = f[0] > 0 ? x + s : x; oy = f[1] > 0 ? y + s : y; }
    else if (f[0] === 0) { oy = f[1] > 0 ? y + s : y; ox = snapHalf(gx, x, x + s); }
    else { ox = f[0] > 0 ? x + s : x; oy = snapHalf(gy, y, y + s); }
    return { origin: [ox, oy], dir: d, cells: coneCells(ox, oy, d, R, costs) };
  }
  if (shape === 'line') {
    // the point on the caster's outline toward the mouse, snapped to half squares
    const k = Math.max(Math.abs(dx), Math.abs(dy)) || 1, h = s / 2;
    const ox = snapHalf(cx + dx / k * h, x, x + s), oy = snapHalf(cy + dy / k * h, y, y + s);
    const ex = gx - ox, ey = gy - oy;
    if (Math.abs(ex) < 0.2 && Math.abs(ey) < 0.2) return null;
    const angle = Math.atan2(ey, ex);
    return { origin: [ox, oy], angle, cells: lineCells(ox, oy, angle, R, width, costs) };
  }
  throw new Error(`Unknown area shape "${shape}"`);
}

/**
 * The walls that block line of effect: every segment that blocks movement (closed and locked doors,
 * unfound secret doors and glass windows included), except the wall types the system lists as letting
 * effects through (PF2E: grates and portcullises). Open doors never block.
 * @param {Array} segs  wall segments
 * @param {object} [state]  map state (door states)
 * @param {{passes?: string[]}} [lineOfEffect]  the system's areas.lineOfEffect setting
 */
export function effectBlockers(segs, state = {}, lineOfEffect = {}) {
  const doors = (state && state.doors) || {}, passes = new Set(lineOfEffect.passes || []), out = [];
  for (const s of segs || []) {
    if (passes.has(s.t)) continue;
    const live = s.door ? doors[s.door.id] : undefined;
    if (senseOf(s, live).move === SENSE.NONE) continue;
    out.push({ id: s.id, a: s.a, b: s.b, dir: s.dir || 0 });
  }
  return out;
}

/** True when segment p->q crosses wall a-b anywhere past its start (touching the start does not count). */
function crosses(p, q, a, b) {
  const rx = q[0] - p[0], ry = q[1] - p[1], sx = b[0] - a[0], sy = b[1] - a[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < EPS) return false; // parallel: grazing along a wall does not block
  const qpx = a[0] - p[0], qpy = a[1] - p[1];
  const t = (qpx * sy - qpy * sx) / den, u = (qpx * ry - qpy * rx) / den;
  return t > 1e-6 && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS;
}

/** True when nothing in `blockers` stands between points p and q. */
export function clearPath(p, q, blockers) {
  for (const w of blockers) if (blocksFrom(w, p) && crosses(p, q, w.a, w.b)) return false;
  return true;
}

/**
 * Keep the squares the area reaches: a square is in when the line from the area's origin to its centre
 * crosses no blocker. Where the line starts:
 * - burst: the grid corner, nudged a hair toward the square (a burst on a wall's corner spreads both ways);
 * - cone and line: the origin on the caster's edge, nudged a hair into the caster's space, so a caster
 *   against a wall cannot aim through it;
 * - emanation: the centre of any square of the caster's space.
 * @param {{shape, origin, cells}} area  from aimArea
 * @param {{x, y, size}} [caster]
 * @param {Array} blockers  from effectBlockers
 */
export function reachedCells(area, caster, blockers) {
  if (!blockers || !blockers.length) return area.cells.slice();
  const [ox, oy] = area.origin;
  // only walls near the area matter
  let x0 = ox, y0 = oy, x1 = ox, y1 = oy;
  for (const [c, r] of area.cells) { x0 = Math.min(x0, c); y0 = Math.min(y0, r); x1 = Math.max(x1, c + 1); y1 = Math.max(y1, r + 1); }
  const near = blockers.filter((w) => Math.max(w.a[0], w.b[0]) >= x0 - 1 && Math.min(w.a[0], w.b[0]) <= x1 + 1
    && Math.max(w.a[1], w.b[1]) >= y0 - 1 && Math.min(w.a[1], w.b[1]) <= y1 + 1);
  if (!near.length) return area.cells.slice();
  const s = caster ? Math.max(1, Math.ceil(caster.size || 1)) : 1;
  const sources = [];
  if (area.shape === 'emanation' && caster) {
    for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) sources.push([Math.floor(caster.x) + i + 0.5, Math.floor(caster.y) + j + 0.5]);
  } else if (area.shape !== 'burst' && caster) {
    const cx = Math.floor(caster.x) + s / 2, cy = Math.floor(caster.y) + s / 2, d = Math.hypot(cx - ox, cy - oy) || 1;
    sources.push([ox + (cx - ox) / d * 0.01, oy + (cy - oy) / d * 0.01]);
  }
  return area.cells.filter(([c, r]) => {
    const q = [c + 0.5, r + 0.5];
    if (!sources.length) {
      const p = [ox + Math.sign(q[0] - ox) * 0.01, oy + Math.sign(q[1] - oy) * 0.01];
      return clearPath(p, q, near);
    }
    return sources.some((p) => clearPath(p, q, near));
  });
}

/**
 * Build a whole area: aim it, then keep the squares it reaches.
 * @returns {{shape, origin, dir?, angle?, cells, covered}} | null  covered: squares before walls
 */
export function buildArea(shape, caster, gx, gy, { R, width = 1, costs = [1, 2], blockers = [] }) {
  const a = aimArea(shape, caster, gx, gy, { R, width, costs });
  if (!a) return null;
  const area = { shape, ...a };
  area.covered = a.cells;
  area.cells = reachedCells(area, caster, blockers);
  return area;
}

/**
 * Tokens whose space touches any of the cells. `tokens` is {id: {x, y, size}}; Tiny tokens (size < 1)
 * count by the square they stand in.
 */
export function tokensInCells(cells, tokens) {
  const set = new Set(cells.map(([c, r]) => c + ',' + r)), out = [];
  for (const [id, t] of Object.entries(tokens || {})) {
    if (!t) continue;
    const s = Math.max(1, Math.ceil(t.size || 1)), x = Math.floor(t.x), y = Math.floor(t.y);
    let hit = false;
    for (let i = 0; i < s && !hit; i++) for (let j = 0; j < s && !hit; j++) if (set.has((x + i) + ',' + (y + j))) hit = true;
    if (hit) out.push(id);
  }
  return out;
}

/** Feet from a caster's space to a burst's grid corner, counted the system's way. */
export function cornerDistance(caster, ox, oy, costs = [1, 2]) {
  const s = Math.max(1, Math.ceil(caster.size || 1)), x = Math.floor(caster.x), y = Math.floor(caster.y);
  const gx = Math.max(0, x - ox, ox - (x + s)), gy = Math.max(0, y - oy, oy - (y + s));
  return areaDistance(gx, gy, costs);
}

/** A short description, e.g. "15-ft cone from Ezren, facing north". */
export function describeArea(t, unit = 'ft') {
  const n = `${t.ft}-${unit} ${t.shape}` + (t.shape === 'line' && t.width_ft > 5 ? ` (${t.width_ft} ${unit} wide)` : '');
  const who = t.casterName || t.caster || '?';
  if (t.shape === 'cone') return `${n} from ${who}, facing ${DIRECTION_NAMES[t.dir || 0]}`;
  if (t.shape === 'burst') return `${n} at a point` + (t.casterName ? ` (from ${t.casterName})` : '');
  if (t.shape === 'emanation') return `${n} around ${who}`;
  return `${n} from ${who}, angle ${Math.round((((t.angle || 0) * 180) / Math.PI + 360) % 360)}°`;
}
