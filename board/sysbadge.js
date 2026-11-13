// The small badge after the campaign's name: which game system the campaign uses. The ruleset defines it
// (rulesets/<system>/system.js `badge`: {text, title, colour, ink}); a system without one shows its name in plain
// small text. The board itself names no system. Docs: docs/best-practices/board.md (the title line).

/** Fill the badge element from a system configuration (or none). */
export function showSystemBadge(el, sys) {
  if (!el) return;
  const b = sys && sys.badge, name = sys && (sys.name || sys.id);
  if (!b && !name) { el.hidden = true; return; }
  el.textContent = b ? b.text : name;
  el.title = (b && b.title) || name || '';
  el.setAttribute('aria-label', `Game system: ${(b && b.title) || name}`);
  el.style.setProperty('--sb-bg', b && b.colour ? b.colour : 'transparent');
  el.style.setProperty('--sb-ink', b && b.ink ? b.ink : 'var(--muted)');
  el.style.setProperty('--sb-line', b && b.colour ? b.colour : 'var(--line)');
  el.hidden = false;
}
