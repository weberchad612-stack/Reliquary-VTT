// Wall types and sense values. See docs/design/maps.md sections 4 to 6.
// Shared by the board, the sight engine and the tools; keep it dependency-free.

/** Sense values, using Foundry's scale. Movement uses only NONE and NORMAL. */
export const SENSE = Object.freeze({
  NONE: 0,
  LIMITED: 10,
  NORMAL: 20,
  PROXIMITY: 30,
  REVERSE_PROXIMITY: 40,
});

export const SENSE_VALUES = Object.freeze(Object.values(SENSE));
export const MOVE_VALUES = Object.freeze([SENSE.NONE, SENSE.NORMAL]);
export const SENSES = Object.freeze(['move', 'sight', 'light', 'sound']);

const { NONE: N0, LIMITED: L, NORMAL: X, PROXIMITY: P } = SENSE;

/**
 * Default sense values per wall type. A segment may override any of them.
 * `door` and `secret` values apply while closed or locked; an open door is NONE for every sense.
 * An unfound `secret` behaves exactly like `solid`.
 */
export const WALL_TYPES = Object.freeze({
  solid:    Object.freeze({ move: X,  sight: X,  light: X,  sound: X, label: 'Wall' }),
  terrain:  Object.freeze({ move: X,  sight: L,  light: L,  sound: L, label: 'Terrain wall (see past one, not two)' }),
  grate:    Object.freeze({ move: X,  sight: N0, light: N0, sound: N0, label: 'Grate or portcullis' }),
  window:   Object.freeze({ move: X,  sight: N0, light: N0, sound: L, label: 'Window' }),
  slit:     Object.freeze({ move: X,  sight: P,  light: P,  sound: L, label: 'Arrow slit (see through only from close by)' }),
  ethereal: Object.freeze({ move: N0, sight: X,  light: X,  sound: N0, label: 'Ethereal barrier' }),
  door:     Object.freeze({ move: X,  sight: X,  light: X,  sound: X, label: 'Door' }),
  secret:   Object.freeze({ move: X,  sight: X,  light: X,  sound: X, label: 'Secret door' }),
});

export const DOOR_TYPES = Object.freeze(['door', 'secret']);
export const DOOR_STATES = Object.freeze(['closed', 'open', 'locked']);

/**
 * Restriction direction: 0 both sides, 1 only from the left of a->b, 2 only from the right.
 * Coordinates have y increasing downward (screen and image convention), so "left" of a->b is
 * the side where cross(b - a, p - a) < 0. Example: a=(0,0), b=(1,0) runs east; its left is north.
 */
export const DIR = Object.freeze({ BOTH: 0, LEFT: 1, RIGHT: 2 });

/** Which side of segment a->b point p is on: -1 left, 1 right, 0 on the line. */
export function sideOf(a, b, p) {
  const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  return c < 0 ? -1 : c > 0 ? 1 : 0;
}

/** True when a segment with direction `dir` restricts a source standing at p. */
export function blocksFrom(seg, p) {
  const dir = seg.dir || DIR.BOTH;
  if (dir === DIR.BOTH) return true;
  const s = sideOf(seg.a, seg.b, p);
  return dir === DIR.LEFT ? s < 0 : s > 0;
}

/** Endpoint precision in cells (1/8 cell, decision 1). */
export const SNAP = 0.125;

/** True when v is a multiple of SNAP (within floating-point noise). */
export function onSnap(v, snap = SNAP) {
  const k = v / snap;
  return Math.abs(k - Math.round(k)) < 1e-9;
}

/**
 * Effective sense values for a segment given its door state.
 * @param {object} seg  wall segment from walls.json
 * @param {{state?: string, found?: boolean}} [door]  live door state from the save
 */
export function senseOf(seg, door) {
  const base = WALL_TYPES[seg.t];
  if (!base) throw new Error(`Unknown wall type "${seg.t}" on segment ${seg.id}`);
  const isDoor = DOOR_TYPES.includes(seg.t);
  const state = (door && door.state) || (seg.door && seg.door.initial) || 'closed';
  const hiddenSecret = seg.t === 'secret' && !(door && door.found);
  if (isDoor && state === 'open' && !hiddenSecret) {
    return { move: SENSE.NONE, sight: SENSE.NONE, light: SENSE.NONE, sound: SENSE.NONE };
  }
  const out = {};
  for (const s of SENSES) {
    // An unfound secret door is indistinguishable from a solid wall: its overrides do not apply yet.
    out[s] = hiddenSecret ? WALL_TYPES.solid[s] : (seg[s] ?? base[s]);
  }
  return out;
}
