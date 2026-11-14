// Sight engine: visibility polygons and line-of-sight tests over vector wall segments.
// Implements docs/design/maps.md section 6. Dependency-free; runs in the browser and in Node.
//
// All coordinates are in grid cells, with y increasing downward. Distances given in feet are
// converted with the map's feet_per_cell.

import { SENSE, senseOf, blocksFrom } from '../walls/presets.js';

const EPS = 1e-9;
/** Angular offset used to look just past segment endpoints (radians). */
const NUDGE = 1e-5;
/** Number of rays used to trace the range circle. */
const ARC_RAYS = 180;

/**
 * Build the list of segments that matter for one sense, applying door states.
 * @param {Array} segs    wall segments from walls.json (all files concatenated)
 * @param {object} [state] map state from the save (uses state.doors)
 * @param {string} [sense='sight']  'sight' | 'light' | 'sound' | 'move'
 * @returns {Array<{id, a, b, v, dir, prox}>} segments whose value for this sense is not NONE
 */
export function prepare(segs, state = {}, sense = 'sight') {
  const doors = (state && state.doors) || {};
  const out = [];
  for (const s of segs) {
    const live = s.door ? doors[s.door.id] : undefined;
    const v = senseOf(s, live)[sense];
    if (v === SENSE.NONE) continue;
    if (isThick(s)) {
      // A thick wall: sight sees it to its far face (worked out per viewer, activeFor); light, sound and
      // movement meet its four faces, so nothing passes through and nothing lights its inside
      if (sense === 'sight') out.push({ id: s.id, a: s.a, b: s.b, v, dir: 0, w: s.w });
      else wallBox(s.a, s.b, s.w).forEach(([a, b], i) => out.push({ id: `${s.id}~${i}`, a, b, v, dir: 0 }));
      continue;
    }
    out.push({ id: s.id, a: s.a, b: s.b, v, dir: s.dir || 0, prox: s.prox && s.prox[sense] });
  }
  return out;
}

/** A wall with a thickness (walls.json `w`): its centre line runs a-b. Doors, one-way and proximity walls stay lines. */
const isThick = (s) => s.w > 0 && !s.door && !s.dir && !s.prox;

/** The unit direction of a-b and its normal (left of a->b, y down). */
function axes(a, b) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  return { u, n: [u[1], -u[0]] };
}

/**
 * The four faces of a thick wall: the centre line a-b widened by w/2 each side and squared off w/2 past each end
 * (so two walls that meet at their centre lines overlap at the corner, leaving no gap).
 */
export function wallBox(a, b, w) {
  const { u, n } = axes(a, b), h = w / 2;
  const p = (base, su, sn) => [base[0] + u[0] * su * h + n[0] * sn * h, base[1] + u[1] * su * h + n[1] * sn * h];
  const c = [p(a, -1, 1), p(b, 1, 1), p(b, 1, -1), p(a, -1, -1)];
  return [[c[0], c[1]], [c[1], c[2]], [c[2], c[3]], [c[3], c[0]]];
}

/** A thick wall as a viewer at `o` meets it for sight: its far face (squared off past both ends). */
export function farFace(a, b, w, o) {
  const { u, n } = axes(a, b), h = w / 2;
  const side = (o[0] - a[0]) * n[0] + (o[1] - a[1]) * n[1] >= 0 ? -1 : 1;   // the face away from the viewer
  const off = [n[0] * side * h, n[1] * side * h];
  return [[a[0] - u[0] * h + off[0], a[1] - u[1] * h + off[1]], [b[0] + u[0] * h + off[0], b[1] + u[1] * h + off[1]]];
}

/** Distance from point p to segment a-b. */
export function pointSegDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * The effective blocking behaviour of a prepared segment for a source at p:
 * 'none', 'limited' or 'normal'.
 */
function effective(seg, p, feetPerCell) {
  if (!blocksFrom(seg, p)) return 'none';
  switch (seg.v) {
    case SENSE.LIMITED: return 'limited';
    case SENSE.NORMAL: return 'normal';
    case SENSE.PROXIMITY: {
      const near = pointSegDist(p, seg.a, seg.b) * feetPerCell <= (seg.prox || 0) + EPS;
      return near ? 'none' : 'normal';
    }
    case SENSE.REVERSE_PROXIMITY: {
      const far = pointSegDist(p, seg.a, seg.b) * feetPerCell > (seg.prox || 0) + EPS;
      return far ? 'none' : 'normal';
    }
    default: return 'none';
  }
}

/**
 * Distance along the ray (origin o, unit direction d) to segment a-b, or -1 when it misses.
 * Endpoints count as hits.
 */
function rayHit(o, d, a, b) {
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const den = d[0] * ey - d[1] * ex;
  if (Math.abs(den) < EPS) return -1; // parallel or collinear: a ray grazing along a wall is not blocked by it
  const ax = a[0] - o[0], ay = a[1] - o[1];
  const t = (ax * ey - ay * ex) / den;      // distance along the ray
  const u = (ax * d[1] - ay * d[0]) / den;  // position along the segment, 0..1
  if (t < EPS || u < -EPS || u > 1 + EPS) return -1;
  return t;
}

/**
 * How far a ray travels before it is stopped, applying the sense rules:
 * normal stops it; limited lets the first one through and stops at the second.
 * Limited segments hit at the same point (two pieces of one terrain wall meeting there) count once.
 */
function castRay(o, d, active, maxDist) {
  const hits = [];
  for (const s of active) {
    const t = rayHit(o, d, s.a, s.b);
    if (t >= 0 && t <= maxDist + EPS) hits.push([t, s.kind]);
  }
  hits.sort((x, y) => x[0] - y[0]);
  let limitedAt = -Infinity;
  for (const [t, kind] of hits) {
    if (kind === 'normal') return t;
    if (limitedAt === -Infinity) { limitedAt = t; continue; }
    if (t - limitedAt > 1e-7) return t; // a second, distinct limited wall
  }
  return maxDist;
}

/** A distance from `origin` that reaches past every corner of the map (or of the walls, without a grid). */
function beyondMap(origin, prepared, grid) {
  let x0 = 0, y0 = 0, x1 = grid ? grid.cols : 0, y1 = grid ? grid.rows : 0;
  if (!grid) for (const s of prepared) for (const p of [s.a, s.b]) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  let far = 0;
  for (const [cx, cy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) far = Math.max(far, Math.hypot(cx - origin[0], cy - origin[1]));
  return far + 1;
}

/** Segments that restrict a source at `origin`, tagged with how they behave. */
function activeFor(prepared, origin, feetPerCell) {
  const out = [];
  for (const s of prepared) {
    const kind = effective(s, origin, feetPerCell);
    if (kind === 'none') continue;
    if (s.w) {
      // its far face and both end caps: the caps stop a slanting ray slipping past the wall's end beside a door
      const box = wallBox(s.a, s.b, s.w), [fa, fb] = farFace(s.a, s.b, s.w, origin);
      out.push({ a: fa, b: fb, kind }, { a: box[1][0], b: box[1][1], kind }, { a: box[3][0], b: box[3][1], kind });
    }
    else out.push({ a: s.a, b: s.b, kind });
  }
  return out;
}

/**
 * Visibility polygon from a point.
 * @param {[number, number]} origin  viewer position in cells
 * @param {Array} prepared  output of prepare()
 * @param {object} opts
 * @param {number} [opts.rangeFt=Infinity]  vision range in feet. Unlimited (PF2E vision has no range:
 *   walls and darkness limit it): rays that hit nothing stop beyond the edge of the map.
 * @param {number} [opts.feetPerCell=5]
 * @param {{cols, rows}} [opts.grid]  the map's size, for unlimited range (default: the walls' extent)
 * @returns {Array<[number, number]>} polygon vertices in angular order (counter-clockwise on screen)
 */
export function visPolygon(origin, prepared, { rangeFt = Infinity, feetPerCell = 5, grid } = {}) {
  let range = rangeFt / feetPerCell;
  if (!Number.isFinite(range)) range = beyondMap(origin, prepared, grid);
  const active = activeFor(prepared, origin, feetPerCell);

  const angles = [];
  for (let i = 0; i < ARC_RAYS; i++) angles.push((i / ARC_RAYS) * 2 * Math.PI);
  for (const s of active) {
    for (const p of [s.a, s.b]) {
      const dx = p[0] - origin[0], dy = p[1] - origin[1];
      if (Math.hypot(dx, dy) > range + EPS) continue;
      const ang = Math.atan2(dy, dx);
      angles.push(ang - NUDGE, ang, ang + NUDGE);
    }
  }
  const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const sorted = [...new Set(angles.map((a) => norm(a)))].sort((x, y) => x - y);

  const poly = [];
  for (const ang of sorted) {
    const d = [Math.cos(ang), Math.sin(ang)];
    const t = castRay(origin, d, active, range);
    poly.push([origin[0] + d[0] * t, origin[1] + d[1] * t]);
  }
  return simplify(poly);
}

/** Drop repeated points and points that lie on a straight line between their neighbours. */
export function simplify(poly, tol = 1e-7) {
  let pts = poly.filter((p, i) => {
    const q = poly[(i + poly.length - 1) % poly.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > tol;
  });
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    const keep = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const span = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      if (Math.abs(cross) / span < tol) changed = true;
      else keep.push(b);
    }
    pts = keep;
  }
  return pts;
}

/**
 * Line of sight between two points.
 * @returns {boolean} true when `to` is visible from `from` within range
 */
export function canSee(from, to, prepared, { rangeFt = Infinity, feetPerCell = 5 } = {}) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const dist = Math.hypot(dx, dy);
  if (dist * feetPerCell > rangeFt + EPS) return false;
  if (dist < EPS) return true;
  const d = [dx / dist, dy / dist];
  const active = activeFor(prepared, from, feetPerCell);
  return castRay(from, d, active, dist) >= dist - 1e-7;
}

/**
 * Sample points for a token whose space starts at (x, y) and is `size` cells on a side.
 * size <= 1 (Tiny, Small, Medium): the centre plus four points near the corners (5 points).
 * size >= 2 (Large and up): four points near the corners plus the centre of every cell along
 * the edge of the space (2x2: 8, 3x3: 12, 4x4: 16). See docs/design/maps.md section 8.
 */
export function footprintPoints(x, y, size = 1, inset = 0.15) {
  const k = Math.min(inset, size * 0.3);
  const corners = [[x + k, y + k], [x + size - k, y + k], [x + k, y + size - k], [x + size - k, y + size - k]];
  if (size <= 1) return [[x + size / 2, y + size / 2], ...corners];
  const n = Math.round(size);
  const edge = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === 0 || j === 0 || i === n - 1 || j === n - 1) edge.push([x + i + 0.5, y + j + 0.5]);
    }
  }
  return [...corners, ...edge];
}

/** Alias kept for callers that think in "token points". */
export const tokenPoints = footprintPoints;

/**
 * The points a token actually looks from: its footprint points, minus any that the token's own
 * centre cannot see (so a large token against or squeezing past a wall never sees through it).
 */
export function viewpoints(x, y, size, prepared, { feetPerCell = 5 } = {}) {
  const c = [x + size / 2, y + size / 2];
  return footprintPoints(x, y, size).filter((p) => canSee(c, p, prepared, { rangeFt: Infinity, feetPerCell }));
}

/**
 * Everything a token can see: one visibility polygon per viewpoint (their union is the visible area).
 * Used for PC fog, for the GM vision view when a token is clicked, and for Claude's sight queries.
 */
export function tokenSight(token, prepared, opts) {
  const size = token.size || 1;
  return viewpoints(token.x, token.y, size, prepared, opts).map((p) => visPolygon(p, prepared, opts));
}

/**
 * Can `viewer` see `target` right now? Both are {x, y, size}. True when any of the viewer's
 * viewpoints has line of sight to any of the target's footprint points.
 */
export function tokenCanSee(viewer, target, prepared, opts) {
  const vp = viewpoints(viewer.x, viewer.y, viewer.size || 1, prepared, opts);
  return canSeeAny(vp, footprintPoints(target.x, target.y, target.size || 1), prepared, opts);
}

/**
 * True when any viewer point can see any target point.
 * Used for "can a PC see this token right now".
 */
export function canSeeAny(viewerPts, targetPts, prepared, opts) {
  for (const v of viewerPts) for (const t of targetPts) if (canSee(v, t, prepared, opts)) return true;
  return false;
}

/** Signed area of a polygon (positive when counter-clockwise on screen, i.e. clockwise in math axes). */
export function polygonArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** Point-in-polygon test (even-odd rule). */
export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
