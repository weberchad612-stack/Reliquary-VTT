// Which creatures may share space. Dependency-free.
//
// Table rule (docs/design/maps.md section 9, Sharing space): two creatures may occupy the same
// squares when one footprint is at least `minGap` squares wider than the other (default 2:
// a 1x1 with a 3x3 or 4x4, a 2x2 with a 4x4), and Tiny creatures may share with anyone (up to four
// Tiny per square; see tiny.js). The rule is data, so a table or ruleset can change it. The
// Player Core as written is stricter: a creature may move through the space of one three or more
// sizes larger, but may not end its move there.

/** Default sharing rule. */
export const SHARE_RULE = Object.freeze({ tiny: true, minGap: 2 });

const sizeOf = (t) => t.size ?? 1;

/** Do the spaces of a at (ax, ay) and b overlap (more than touching edges)? */
export function spacesOverlap(ax, ay, as, b) {
  const bs = sizeOf(b);
  return ax < b.x + bs && b.x < ax + as && ay < b.y + bs && b.y < ay + as;
}

/** May creatures a and b occupy the same squares? */
export function mayShare(a, b, rule = SHARE_RULE) {
  const sa = sizeOf(a), sb = sizeOf(b);
  if (rule.tiny && (sa < 1 || sb < 1)) return true;
  return Math.abs(sa - sb) >= rule.minGap - 1e-9;
}

/**
 * Creatures that stop `token` from ending its move with its space at (x, y).
 * @param {object} token  {id, x, y, size}
 * @param {Array} others  every token on the map (the token itself is skipped)
 * @param {object} [opts]
 * @param {object} [opts.rule]  sharing rule (default SHARE_RULE)
 * @param {function} [opts.ignore]  (other) => true for tokens that never block (default: dead or GM markers)
 * @returns {Array} the blocking tokens (empty when the space is free to end in)
 */
export function blockersAt(token, x, y, others, opts = {}) {
  const rule = opts.rule || SHARE_RULE;
  // objects (a chest, a shelf: board/objects.js) never block and are never blocked
  const ignore = opts.ignore || ((o) => o.dead || o.kind === 'marker' || o.kind === 'gm' || o.kind === 'object');
  const size = sizeOf(token);
  if (token.kind === 'object') return [];
  return others.filter((o) => o.id !== token.id && !ignore(o) && spacesOverlap(x, y, size, o) && !mayShare(token, o, rule));
}
