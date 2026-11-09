// Where Tiny tokens sit inside their square.
// A Tiny token's position is its square: whole-number x, y. Inside the square it is laid out by who
// else is there (docs/design/maps.md section 8, Token footprints):
// - alone: centred;
// - with other Tiny tokens (up to four per square): one quadrant each. A token keeps its quadrant
//   (`slot`) while others come and go, so tokens do not jump around;
// - sharing the square with a bigger creature: a quadrant, so it is not hidden under it.
// Sight, being seen and drawing all use the laid-out space; movement uses the centred space.
// Dependency-free.

/** Footprint of a Tiny token, in cells. */
export const TINY = 0.5;
/** Most Tiny creatures that fit in one square. */
export const MAX_PER_SQUARE = 4;
/** Quadrant offsets inside the square, by slot: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right. */
export const SLOTS = Object.freeze([[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]]);
/** Order in which free quadrants are handed out: diagonal first, so two tokens look balanced. */
const FILL_ORDER = [0, 3, 1, 2];

export const isTiny = (t) => (t.size ?? 1) < 1;

/**
 * Lay out every Tiny token.
 * @param {Array<{id, x, y, size?, slot?}>} tokens  all tokens on the map
 * @returns {{spaces: Map<string, {x, y, size, slot: number|null}>, overfull: Array<string>}}
 *   spaces: the laid-out space of each Tiny token (slot null when centred). Store `slot` back on the
 *   token so its quadrant stays put. overfull: squares ("x,y") holding more than four Tiny tokens.
 */
export function layoutTiny(tokens) {
  const bySquare = new Map();
  for (const t of tokens) {
    if (!isTiny(t)) continue;
    const k = `${Math.floor(t.x)},${Math.floor(t.y)}`;
    if (!bySquare.has(k)) bySquare.set(k, []);
    bySquare.get(k).push(t);
  }
  const bigCovers = (x, y) => tokens.some((t) => !isTiny(t) && x >= t.x && x < t.x + (t.size ?? 1) && y >= t.y && y < t.y + (t.size ?? 1));
  const spaces = new Map();
  const overfull = [];
  for (const [k, list] of bySquare) {
    const [x, y] = k.split(',').map(Number);
    if (list.length > MAX_PER_SQUARE) overfull.push(k);
    if (list.length === 1 && !bigCovers(x, y)) {
      spaces.set(list[0].id, { x: x + TINY / 2, y: y + TINY / 2, size: TINY, slot: null });
      continue;
    }
    // keep each token's quadrant if it has one and nobody earlier claimed it; stable order by id
    const sorted = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const taken = new Set();
    const slotOf = new Map();
    for (const t of sorted) {
      if (Number.isInteger(t.slot) && t.slot >= 0 && t.slot < 4 && !taken.has(t.slot)) { taken.add(t.slot); slotOf.set(t.id, t.slot); }
    }
    for (const t of sorted) {
      if (slotOf.has(t.id)) continue;
      const free = FILL_ORDER.find((s) => !taken.has(s));
      const s = free ?? FILL_ORDER[slotOf.size % 4]; // overfull: stack on a used quadrant
      taken.add(s); slotOf.set(t.id, s);
    }
    for (const t of list) {
      const s = slotOf.get(t.id);
      spaces.set(t.id, { x: x + SLOTS[s][0], y: y + SLOTS[s][1], size: TINY, slot: s });
    }
  }
  return { spaces, overfull };
}

/**
 * The space a token occupies for sight, being seen and drawing.
 * Non-Tiny tokens are returned as they are; Tiny tokens use their laid-out quadrant or the centre.
 */
export function spaceOf(token, layout) {
  if (!isTiny(token)) return { x: token.x, y: token.y, size: token.size ?? 1 };
  const s = layout && layout.spaces.get(token.id);
  return s ? { x: s.x, y: s.y, size: s.size } : { x: Math.floor(token.x) + TINY / 2, y: Math.floor(token.y) + TINY / 2, size: TINY };
}

/** The space a token moves with: Tiny tokens move from the centre of their square, square to square. */
export function moveSpaceOf(token) {
  if (!isTiny(token)) return { x: token.x, y: token.y, size: token.size ?? 1 };
  return { x: Math.floor(token.x) + TINY / 2, y: Math.floor(token.y) + TINY / 2, size: TINY };
}

/** Square for a Tiny token's moved space (inverse of moveSpaceOf). */
export function squareOfMoveSpace(space) {
  return [Math.floor(space.x), Math.floor(space.y)];
}
