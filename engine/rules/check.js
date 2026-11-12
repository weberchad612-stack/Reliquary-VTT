// Checks for any game system: a statistic as rows a roll dialog can switch on and off, the statistic again with
// the reader's changes (rows switched, modifiers added) under the system's stacking, the roll (one die, or two
// keeping the higher or lower), and the notes that trigger on it. Pure; the board's roll dialog and the tools
// share it. The system says which statistics a roll may use and which types exist (its configuration).
// Docs: docs/design/board.md (the encounter tracker: the roll dialog).

import { makeStatistic, testPredicate } from './rules.js';

/**
 * A statistic's rows for a roll dialog: the parts of its base (key p<i>) then its modifiers (key m<i>), each
 * {key, label, type, value, on, why}. A modifier the rules left out starts off with the reason.
 */
export function checkRows(st) {
  const parts = (st.parts || []).map((p, i) => ({ key: `p${i}`, label: p.label, type: p.type || 'base', value: p.value, on: true }));
  const mods = (st.modifiers || []).map((m, i) => ({ key: `m${i}`, label: m.label || m.slug, type: m.type || 'untyped', value: m.value, on: !!m.applied, ...(m.applied ? {} : { why: m.reason }) }));
  return [...parts, ...mods.filter((m) => m.value)];
}

/**
 * The statistic with the reader's changes: off (row keys switched off), on (row keys switched on that the rules
 * had left out) and add ([{label, type, value}]). Stacking is the system's (stacks(type): true when every
 * modifier of that type adds up). Returns a statistic like makeStatistic's.
 */
export function adjustCheck(st, { off = [], on = [], add = [] } = {}, { stacks = () => false } = {}) {
  const offs = new Set(off), ons = new Set(on);
  const parts = (st.parts || []).filter((_, i) => !offs.has(`p${i}`));
  const base = parts.reduce((s, p) => s + (Number(p.value) || 0), 0);
  const keep = [];
  (st.modifiers || []).forEach((m, i) => {
    const k = `m${i}`;
    if (offs.has(k) || !m.value) return;
    // the rules' verdict stands unless the reader switched it on; whether it applies was decided already
    const wanted = ons.has(k) || m.applied || (m.reason && m.reason !== 'does not apply now' && m.reason !== 'zero');
    if (wanted) keep.push({ ...m, when: undefined, applied: undefined, reason: undefined });
  });
  for (const a of add) {
    const value = Number(a.value);
    if (Number.isFinite(value) && value) keep.push({ slug: `added-${keep.length}`, label: a.label || 'Modifier', type: a.type || 'untyped', value, added: true });
  }
  return makeStatistic({ slug: st.slug, label: st.label, base, parts, modifiers: keep, stacks });
}

/** A die from 1 to sides, from rng (a function returning [0, 1)). */
function die(sides, rng) {
  return Math.min(sides, Math.floor(rng() * sides) + 1);
}

/**
 * Roll a check: mode 'normal' (one die), 'higher' or 'lower' (two dice, keep one). `dice` gives the dice instead
 * of rolling (typed in, or tests). Returns {dice, kept, mod, total, mode, sides}.
 */
export function rollCheck(st, { mode = 'normal', rng = Math.random, dice = null, sides = 20 } = {}) {
  const n = mode === 'normal' ? 1 : 2;
  const rolled = dice && dice.length ? dice.slice(0, n).map(Number) : Array.from({ length: n }, () => die(sides, rng));
  while (rolled.length < n) rolled.push(die(sides, rng));
  const kept = mode === 'higher' ? Math.max(...rolled) : mode === 'lower' ? Math.min(...rolled) : rolled[0];
  return { dice: rolled, kept, mod: st.value, total: kept + st.value, mode, sides };
}

/** The modifiers that counted, for a roll's record and its card: [{label, type, value}]. */
export function countedParts(st) {
  return [
    ...(st.parts || []).filter((p) => p.value).map((p) => ({ label: p.label, type: p.type || 'base', value: p.value })),
    ...(st.modifiers || []).filter((m) => m.applied).map((m) => ({ label: m.label || m.slug, type: m.type || 'untyped', value: m.value, ...(m.added ? { added: true } : {}) })),
  ];
}

/** The notes that trigger on a roll: those naming any of the selectors and holding now. [{text, from}] */
export function notesFor(notes, selectors, tags = [], facts = {}) {
  const want = new Set(selectors), t = new Set(tags);
  return (notes || []).filter((n) => (n.selectors || []).some((s) => want.has(s)) && !n.outcome && testPredicate(n.when, t, facts))
    .map((n) => {
      // Foundry's notes often say "the feat's own description": use the source's text when it has one
      const own = /^\{item\|system\.description\.value\}$/.test(String(n.text || '').trim());
      const text = own ? (n.origin && n.origin.text) || `See ${(n.origin && n.origin.label) || 'its description'}.` : n.text;
      return { text, from: (n.origin && n.origin.label) || '' };
    });
}
