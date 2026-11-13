// The title line's game-system badge (board/sysbadge.js): drawn from the ruleset's own badge, else its name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { showSystemBadge } from '../board/sysbadge.js';
import { PF2E_SYSTEM } from '../rulesets/pf2e/system.js';

const el = () => ({ hidden: true, textContent: '', title: '', attrs: {}, vars: {}, setAttribute(k, v) { this.attrs[k] = v; }, style: { setProperty(k, v) { el.last = this; this[k] = v; } } });

test('the ruleset\'s badge: its words, title and colours', () => {
  const e = el();
  showSystemBadge(e, PF2E_SYSTEM);
  assert.equal(e.hidden, false);
  assert.equal(e.textContent, 'PF2e');
  assert.match(e.title, /Pathfinder/);
  assert.equal(e.style['--sb-bg'], PF2E_SYSTEM.badge.colour);
});

test('a system without a badge shows its name plainly; none hides it', () => {
  const e = el();
  showSystemBadge(e, { id: 'dnd5e', name: 'D&D 5e' });
  assert.deepEqual([e.hidden, e.textContent, e.style['--sb-bg']], [false, 'D&D 5e', 'transparent']);
  const n = el();
  showSystemBadge(n, null);
  assert.equal(n.hidden, true);
});
