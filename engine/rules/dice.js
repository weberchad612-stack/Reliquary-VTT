// Dice for the rules' own rolls (persistent damage, flat checks, recovery checks at turn boundaries): a formula
// "2d6+3", "1d4 + 1d6", "5" rolled with a random source. A seeded source makes rolls repeatable for tests and
// replays. Until the dice service exists (docs/design/game-data.md), the tools roll with these. Never runs code.

/** A repeatable random source in [0, 1) from a whole-number seed (mulberry32). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Roll one die of `sides` faces. */
export function rollDie(sides, rng = Math.random) { return 1 + Math.floor(rng() * sides); }

/** Roll a formula: {total, rolls: [{die, results}], text: "2d6+3 = (4+2)+3 = 9"}. Throws on anything else. */
export function rollFormula(formula, rng = Math.random) {
  const src = String(formula).replace(/\s+/g, '');
  if (!/^[+-]?(\d+d\d+|\d+)([+-](\d+d\d+|\d+))*$/i.test(src)) throw new Error(`"${formula}" is not a dice formula like 2d6+3`);
  let total = 0;
  const rolls = [], shown = [];
  for (const m of src.matchAll(/([+-]?)(\d+d\d+|\d+)/gi)) {
    const neg = m[1] === '-', term = m[2].toLowerCase();
    if (term.includes('d')) {
      const [n, s] = term.split('d').map(Number);
      if (n > 100 || s < 1) throw new Error(`"${term}": too many dice or no sides`);
      const results = Array.from({ length: n }, () => rollDie(s, rng));
      const sum = results.reduce((a, b) => a + b, 0);
      total += neg ? -sum : sum;
      rolls.push({ die: `d${s}`, results });
      shown.push(`${neg ? '-' : shown.length ? '+' : ''}(${results.join('+')})`);
    } else {
      const n = Number(term);
      total += neg ? -n : n;
      shown.push(`${neg ? '-' : shown.length ? '+' : ''}${n}`);
    }
  }
  return { total, rolls, text: `${formula} = ${shown.join('')} = ${total}` };
}
