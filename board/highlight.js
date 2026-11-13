// The board's "this one is over there" highlight (the user's standard, 2026-11-12): hovering or focusing an entry in
// a sidebar list (a note in the Notes tab, a row in the encounter tracker; later loot, quests, roll cards) points out
// its thing on the map with a ring in the thing's own colour, glowing and pulsing slowly. On this screen only, only
// while the entry is hovered or focused; a steady ring when the system asks for reduced motion. Not for states that
// stay on (the selection square, target triangles, the acting creature's ring) and not the ping (everyone's screen).
//
// Two forms with one look: pointOutRing() draws it on a canvas (tokens, on the overlay); the CSS class `pointout`
// (board/index.html, with --hl for the colour) does it for page elements (note pins). Docs:
// docs/best-practices/board.md (the highlight standard).

export const POINT_OUT = Object.freeze({ period: 1800, grow: 0.3, gap: 0.35, width: 3, glow: 14 });

/** How far through its pulse the ring is: 0 (smallest) .. 1 (largest) and back; 0 with reduced motion. */
export function pointOutPhase(now, reduced = false) {
  if (reduced) return 0;
  const t = ((now || 0) % POINT_OUT.period) / POINT_OUT.period;
  return 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
}

/**
 * Draw the ring around a disc at (cx, cy) of radius r (canvas units) in `colour`. unit: canvas units per screen
 * pixel at this zoom, so the line and glow keep their size on screen.
 */
export function pointOutRing(ctx, { cx, cy, r, colour, now, reduced = false, unit = 1 }) {
  const k = 1 + POINT_OUT.grow * pointOutPhase(now, reduced);
  const rr = (r + r * POINT_OUT.gap) * k;
  ctx.save();
  ctx.shadowColor = colour; ctx.shadowBlur = POINT_OUT.glow;   // shadows are in screen pixels already
  ctx.lineWidth = POINT_OUT.width * unit + 2 * unit; ctx.strokeStyle = 'rgba(10, 12, 16, .6)';
  ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = POINT_OUT.width * unit; ctx.strokeStyle = colour;
  ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  return rr;
}
