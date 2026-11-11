// Shared UI pieces for the board, so the same kind of control looks and behaves the same everywhere.
// Docs: docs/design/board.md section 7 (shared controls), docs/best-practices/board.md.

/** How long an armed remove button waits for the second click (ms). */
export const ARM_MS = 3000;

/**
 * The arm-then-confirm logic of a remove button, without the DOM: the first press arms (and disarms by
 * itself after `ms`), a press while armed removes.
 * @param {{onArm: function, onDisarm: function, onRemove: function, ms?: number, timers?: {set, clear}}} o
 * @returns {{press: function, disarm: function, armed: function}}
 */
export function armer({ onArm, onDisarm, onRemove, ms = ARM_MS, timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) } }) {
  let t = null;
  const disarm = () => { if (t === null) return; timers.clear(t); t = null; onDisarm(); };
  return {
    press() {
      if (t === null) { t = timers.set(() => { t = null; onDisarm(); }, ms); onArm(); return false; }
      timers.clear(t); t = null; onRemove(); return true;
    },
    disarm,
    armed: () => t !== null,
  };
}

/**
 * The board's remove button (area templates, map notes, and anything removable later): a 20 px circle in the
 * item's colour with a white border and a white ✕; the first click turns it into "Remove?" for 3 seconds, a
 * second click removes. Styles: `.rm-btn` in board/index.html.
 * @param {{colour: string, what: string, onRemove: function, doc?: Document}} o  what: the item, for the
 *   tooltip and screen readers ("this note", "15-ft cone from Pip")
 */
export function removeButton({ colour, what, onRemove, doc = document }) {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = 'rm-btn';
  b.style.setProperty('--rc', colour);
  const idle = () => { b.textContent = '✕'; b.classList.remove('arm'); b.title = `Remove ${what}`; b.setAttribute('aria-label', `Remove ${what}`); };
  const a = armer({
    onArm: () => { b.textContent = 'Remove?'; b.classList.add('arm'); b.title = 'Click again to remove'; b.setAttribute('aria-label', `Click again to remove ${what}`); },
    onDisarm: idle,
    onRemove,
  });
  idle();
  b.addEventListener('pointerdown', (e) => { if (e.button === 0) e.stopPropagation(); });
  b.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); a.press(); });
  b.addEventListener('blur', () => a.disarm());
  return b;
}
