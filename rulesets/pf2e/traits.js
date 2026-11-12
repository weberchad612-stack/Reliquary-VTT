// Pathfinder 2E traits: how a trait is written, its entry in the trait glossary, and what the board's rules do
// with a Strike's trait. Used by the stat block (rulesets/pf2e/statblock.js); reached by the board through the
// system configuration (system.js, `traits`). Docs: docs/best-practices/board.md (Token Quick-View).

/** A trait as Pathfinder writes it: "reach-10" -> "reach 10 feet", "deadly-d10" -> "deadly d10", "versatile-p" -> "versatile P". */
export function traitLabel(t) {
  const s = String(t);
  let m = /^(reach|thrown|volley|range|range-increment|splash|jousting-reach)-(\d+)$/.exec(s);
  if (m) return `${m[1].replace(/-/g, ' ')} ${m[2]} feet`;
  m = /^(.*)-(d\d+)$/.exec(s);
  if (m) return `${m[1].replace(/-/g, ' ')} ${m[2]}`;
  m = /^versatile-([a-z]+)$/.exec(s);
  if (m) return `versatile ${m[1].toUpperCase()}`;
  return s.replace(/-/g, ' ');
}

/** A trait's entry in the glossary ({slug: {name, text}}): the trait itself, or the trait without its number, die or letter. */
export function traitEntry(t, glossary = {}) {
  const s = String(t);
  return glossary[s] || glossary[s.replace(/-(d\d+|\d+)$/, '')] || glossary[s.replace(/-[a-z]$/, '')] || null;
}

/**
 * What the board's rules do with a Strike's trait (shown under its description), or null when the trait is not a
 * Strike's. strike: {pc: a character's Strike (worked out from its build) or a creature's (printed)}.
 */
export function traitApplied(t, strike) {
  const base = String(t).replace(/-(d\d+|\d+|[a-z])$/, '');
  if (!strike) return null;
  if (base === 'agile') return 'Applied: the multiple attack penalty is −4 and −8.';
  if (!strike.pc) return 'The printed numbers count it; anything else it does is not automated: Claude applies it.';
  if (base === 'finesse') return 'Applied: Dexterity for the attack when it is higher than Strength.';
  if (base === 'thrown') return 'Applied: thrown at its range, with Strength added to damage.';
  if (base === 'propulsive') return 'Applied: half your Strength (if positive) added to damage.';
  if (base === 'unarmed') return 'Applied: your unarmed proficiency.';
  return 'Not automated: Claude applies it.';
}

export const PF2E_TRAITS = Object.freeze({ label: traitLabel, entry: traitEntry, applied: traitApplied });
