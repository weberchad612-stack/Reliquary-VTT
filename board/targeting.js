// Hover, distance and targeting marks on the battle map (docs/design/board.md, section 7): the parts that need no
// page, so they are tested. The board (app.js) draws them.
//
// - Hovering a token that is not selected shows a thin square in its kind's colour: green for PCs and allies,
//   yellow for neutrals, red for foes. A selected token's square is amber.
// - T over a hovered token targets it or un-targets it (a toggle); Shift+T clears every target. Targets show
//   as filled triangles in the four corners of the token's square, pointing and pulsing inward, in its kind's colour. The player's and
//   the GM view's targets are kept apart (targets/player, targets/gm); the GM view shows both.

/** Token kinds and their colours. Any other kind (an older save) is treated as a foe. */
export const KIND_COLOURS = Object.freeze({ pc: '#5fbf83', ally: '#5fbf83', neutral: '#e8d25a', foe: '#e5615a' });
export const SELECTED_COLOUR = '#e3a443';
export const kindColour = (kind) => KIND_COLOURS[kind] || KIND_COLOURS.foe;

/** Toggle one id in a target list; a new list, in the order targets were added. */
export function toggleTarget(ids, id) {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/**
 * The square a token's marks sit on, in cells: its whole space; a Tiny creature alone, its square; a Tiny
 * creature sharing a square, its quarter. `space` is its laid-out space {x, y, size}; `shared` is whether
 * the Tiny layout gave it a quadrant.
 */
export function markSquare(space, tiny, shared) {
  if (!tiny) return { x: space.x, y: space.y, size: space.size };
  if (shared) return { x: space.x, y: space.y, size: 0.5 };
  return { x: Math.floor(space.x), y: Math.floor(space.y), size: 1 };
}

/**
 * Target markers in the four corners of a square (pixels: x, y, side), at pulse phase t (0-1): filled
 * triangles pointing inward, toward the middle of the square. They pulse inward: at rest each sits on its
 * corner, and once a cycle it slides in toward the token by about 7% of the side and back. They are drawn
 * under the token's square (hover or selection), which is drawn again on top of them.
 * Returns {paths: [[[x, y] x 3] x 4] (closed triangles), alpha}.
 */
export function chevrons(x, y, side, t = 0) {
  const len = Math.max(4, side * 0.12);                      // tip to base
  const half = len * 0.7;                                    // half the base
  const push = Math.max(1.5, side * 0.07) * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));   // 0 at rest, in and back
  const corners = [[x, y, 1, 1], [x + side, y, -1, 1], [x, y + side, 1, -1], [x + side, y + side, -1, -1]];
  const k = Math.SQRT1_2;
  const paths = corners.map(([cx, cy, sx, sy]) => {
    const dx = sx * k, dy = sy * k;                          // inward, along the diagonal
    const bx = cx - dx * len * 0.35 + dx * push, by = cy - dy * len * 0.35 + dy * push;   // base centre, just outside
    return [[bx + dx * len, by + dy * len], [bx - dy * half, by + dx * half], [bx + dy * half, by - dx * half]];
  });
  return { paths, alpha: 0.75 + 0.25 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2)) };
}
