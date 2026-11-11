// Zoom and pan gestures on the battle map (docs/design/board.md, section 7): the arithmetic, kept apart from
// the page so it can be tested. The board (app.js) applies it.
//
// - The wheel zooms about the pointer: a mouse wheel (one notch about 12%), a trackpad's two-finger scroll
//   (small steps), and a trackpad pinch, which browsers send as a wheel event with Ctrl held (stronger).
// - Two fingers on a touch screen pinch to zoom about their midpoint, and pan as the midpoint moves.
// - Dragging with the right mouse button pans (the hand cursor shows only while it is held). On a touch
//   screen, one finger dragged on empty floor pans.

export const PAN_SLOP = 4;    // pixels a press may move and still count as a click

/** Wheel delta in pixels, whatever unit the browser reports (lines, pages). */
export function wheelPixels(e, pageHeight = 800) {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pageHeight : 1;
  return e.deltaY * unit;
}

/** The zoom factor for one wheel event: > 1 zooms in. Large steps are capped so one event never jumps far. */
export function wheelZoomFactor(e, pageHeight) {
  const px = Math.max(-120, Math.min(120, wheelPixels(e, pageHeight)));
  const k = e.ctrlKey || e.metaKey ? 0.01 : 0.0012;   // a pinch reports small deltas; a wheel notch is about 100 px
  return Math.exp(-px * k);
}

/** One step of a two-finger pinch, from the previous pair of points to the current pair. */
export function pinchStep(prev, now) {
  const dist = (p) => Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
  const mid = (p) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
  const d0 = dist(prev), d1 = dist(now), m0 = mid(prev), m1 = mid(now);
  return { factor: d0 > 0 ? d1 / d0 : 1, mid: m1, dx: m1.x - m0.x, dy: m1.y - m0.y };
}

/** Has a press moved far enough to be a drag rather than a click? */
export function isDrag(x0, y0, x1, y1, slop = PAN_SLOP) {
  return Math.hypot(x1 - x0, y1 - y0) > slop;
}
