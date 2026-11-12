// Rolls on the board: the record a roll leaves (rolls/<time36>-<n>, shown as a roll card on every screen and in
// the roll log) and the card's words. Shared by the board and Claude's tools so both write the same thing. Pure.
// Docs: docs/design/board.md (the encounter tracker: the roll card).

let seq = 0;
/** A time-sortable id for a roll record: rolls/<time36>-<n><random>. */
export function rollPath(now = Date.now(), rnd = Math.random) {
  return `rolls/${Math.floor(now).toString(36).padStart(9, '0')}-${(seq++).toString(36)}${rnd().toString(36).slice(2, 6)}`;
}

/** How many roll records the board keeps (the oldest go). */
export const ROLLS_KEPT = 200;

/**
 * A roll's record. o: {by ('claude' | 'gm' | 'player'), token, name (as shown to everyone), kind ('initiative'),
 * stat ({slug, label}), roll ({dice, kept, mode, sides}), mod, total, parts ([{label, type, value}]), notes
 * ([{text, from}]), at}.
 */
export function rollRecord(o) {
  const r = o.roll || {};
  return {
    by: o.by || 'claude', at: o.at || new Date().toISOString(), token: o.token || null, name: o.name || '', kind: o.kind || 'check',
    stat: o.stat || null, dice: r.dice || [], kept: r.kept ?? null, mode: r.mode || 'normal', sides: r.sides || 20,
    mod: o.mod ?? 0, total: o.total ?? null, parts: o.parts || [], notes: o.notes || [],
  };
}

const sgn = (v) => (v < 0 ? `− ${-v}` : `+ ${v}`);
/** The dice in words: "1d20 + 17", "2d20 keep higher + 17". */
export function diceWords(rec) {
  const d = rec.mode === 'normal' || !rec.mode ? `1d${rec.sides || 20}` : `2d${rec.sides || 20} keep ${rec.mode === 'higher' ? 'higher' : 'lower'}`;
  return `${d} ${sgn(rec.mod || 0)}`;
}

/** The modifier chips' words: "Wisdom +2", "Master +14" (a part's label as the rules wrote it). */
export function chipWords(p) {
  const label = String(p.label || '').replace(/^proficiency \((\w+)\)$/, (_, r) => r.charAt(0).toUpperCase() + r.slice(1));
  return `${label} ${p.value < 0 ? `−${-p.value}` : `+${p.value}`}`;
}
