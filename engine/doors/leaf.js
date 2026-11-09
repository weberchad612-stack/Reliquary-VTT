// Door leaves: where a door panel sits when closed and where it swings to when open.
//
// Every door segment is one leaf. A double door is two leaves whose `door.pair` names each other;
// each leaf has its own state, icon and click target. A leaf turns on its hinge end (`door.hinge`,
// "a" or "b", default "a") and opens toward one side of the line a->b (`door.swing`, "left" or
// "right", default "left"; with y pointing down, the same convention as the `dir` field).
//
// Pure geometry in cell coordinates; drawing is up to the page.

/** How far a leaf's outer ends are pulled back from the segment ends, in cells. Door segments
 *  reach a little into the walls; the panel should stop at the jamb. */
export const LEAF_INSET = 0.1;
/** Panel thickness in cells. */
export const LEAF_THICKNESS = 0.16;

const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
const mul = (p, k) => [p[0] * k, p[1] * k];
const len = (p) => Math.hypot(p[0], p[1]);
const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;

/** The other leaf of a double door, or null. `segs` are all wall segments of the map. */
export function pairOf(seg, segs) {
  const id = seg.door && seg.door.pair;
  if (!id) return null;
  return segs.find((s) => s !== seg && s.door && s.door.id === id) || null;
}

/** Unit normal pointing to the given side of a->b (y down: "left" is the side a left-hand turn faces). */
export function sideNormal(a, b, side = 'left') {
  const d = sub(b, a), L = len(d);
  // y down: walking a->b, the left side is (dy, -dx)
  const n = [d[1] / L, -d[0] / L];
  return side === 'right' ? mul(n, -1) : n;
}

/**
 * Hinge and free end of a leaf's panel, inset from ends that meet a wall.
 * The end shared with a paired leaf is not inset, so the two panels meet in the middle.
 */
export function leafEnds(seg, partner = null) {
  const hingeAtB = seg.door && seg.door.hinge === 'b';
  let h = hingeAtB ? seg.b : seg.a, f = hingeAtB ? seg.a : seg.b;
  const d = sub(f, h), L = len(d), u = mul(d, 1 / L);
  const shared = (p) => partner && (same(p, partner.a) || same(p, partner.b));
  const inset = Math.min(LEAF_INSET, L / 4);
  if (!shared(h)) h = add(h, mul(u, inset));
  if (!shared(f)) f = sub(f, mul(u, inset));
  return { hinge: h, free: f, length: len(sub(f, h)) };
}

/** Rectangle around the line p->q, `t` thick, offset `off` along normal n (0 = centred). */
function panel(p, q, n, t, off = 0) {
  const o1 = mul(n, off + t / 2), o2 = mul(n, off - t / 2);
  return [add(p, o1), add(q, o1), add(q, o2), add(p, o2)];
}

/**
 * Shapes for drawing a leaf.
 * @returns {{hinge, free, closed: number[][], open: number[][], openFree: number[],
 *            arc: {c, r, from, to, ccw}, normal: number[], centre: number[]}}
 *   closed: panel polygon lying in the doorway; open: panel swung 90 degrees on its hinge to the swing side;
 *   arc: the free end's path from closed to open (angles in radians, canvas convention, y down);
 *   centre: middle of the closed panel (for badges and clicks).
 */
export function leafShapes(seg, { partner = null, thickness = LEAF_THICKNESS } = {}) {
  const { hinge, free, length } = leafEnds(seg, partner);
  const n = sideNormal(seg.a, seg.b, seg.door && seg.door.swing);
  const openFree = add(hinge, mul(n, length));
  const along = sub(free, hinge);
  const from = Math.atan2(along[1], along[0]), to = Math.atan2(n[1], n[0]);
  // Shortest turn from the closed direction to the open one (always 90 degrees).
  let delta = to - from;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  // The open panel lies against the hinge-side jamb, on the swing side of the wall line.
  const u = mul(along, 1 / len(along));
  return {
    hinge, free, openFree, normal: n,
    closed: panel(hinge, free, n, thickness),
    open: panel(hinge, openFree, mul(u, 1), thickness, thickness / 2),
    arc: { c: hinge, r: length, from, to, ccw: delta < 0 },
    centre: mul(add(hinge, free), 0.5),
  };
}

/** True when point p lies inside polygon poly. */
export function insidePoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
