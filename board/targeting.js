// Hover, distance and targeting marks on the battle map (docs/design/board.md, section 7): the parts that need no
// page, so they are tested. The board (app.js) draws them.
//
// - Hovering a token that is not selected shows a thin square in its kind's colour: green for PCs and allies,
//   yellow for neutrals, red for foes. A selected token's square is amber.
// - T over a hovered token targets it or un-targets it (a toggle); Shift+T clears every target. Targets show
//   as pulsing chevrons in the four corners of the token's square, in its kind's colour. The player's and
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
 * Chevrons in the four corners of a square (pixels: x, y, side), pointing inward, at pulse phase t (0-1).
 * Each chevron is three points (an L). They breathe: they sit just outside the corners and move in a little
 * and back. Returns [[[x, y], [x, y], [x, y]] x 4] and the opacity for this phase.
 */
export function chevrons(x, y, side, t = 0) {
  const arm = Math.max(5, side * 0.22);
  const out = Math.max(2, side * 0.08) * (1 - Math.sin(t * Math.PI * 2) * 0.5 - 0.5) + 1;   // 1 .. 1 + 8% of the side
  const corners = [[x, y, 1, 1], [x + side, y, -1, 1], [x, y + side, 1, -1], [x + side, y + side, -1, -1]];
  const paths = corners.map(([cx, cy, sx, sy]) => {
    const px = cx - sx * out, py = cy - sy * out;
    return [[px + sx * arm, py], [px, py], [px, py + sy * arm]];
  });
  return { paths, alpha: 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2)) };
}
