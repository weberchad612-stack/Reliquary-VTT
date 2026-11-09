// How big a token is drawn inside its space. Dependency-free.
//
// A Small creature occupies a full square, the same as a Medium one (PF2E: 5-foot space), so its
// footprint stays 1x1 for sight, movement and sharing. Only its token is drawn smaller: 0.75 of a
// Medium token, centred in the square. The ruleset marks Small creatures with `small: true`.

export const SMALL_SCALE = 0.75;

/** Drawing scale for a token within its space (1 unless it is a Small creature in a 1x1 space). */
export function drawScale(token) {
  return token.small && (token.size ?? 1) === 1 ? SMALL_SCALE : 1;
}

/**
 * The box a token is drawn in, in cells: its space shrunk by drawScale, centred.
 * @param {{x, y, size}} space  from spaceOf() (Tiny tokens already have their laid-out space)
 * @param {object} token
 */
export function drawBox(space, token) {
  const s = space.size * drawScale(token);
  const inset = (space.size - s) / 2;
  return { x: space.x + inset, y: space.y + inset, size: s };
}
