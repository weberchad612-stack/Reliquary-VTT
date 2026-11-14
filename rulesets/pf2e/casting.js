// PF2E spellcasting for the character builder (docs/design/game-data.md 9.9): each casting class's slots by level,
// how it learns spells (a repertoire, a book or familiar, or its whole list), what it chooses at each level, and the
// spells its subclass grants. Foundry's data has the class features' words but not the tables, so the tables are
// here, from Player Core 1 and 2 and the books after them (checked against Archives of Nethys, 2026-11-14).

// how each kind of caster gains slots: [the slots a rank has the level it arrives, the slots it has after]
const PATTERNS = {
  full23: [2, 3],     // wizard, cleric, druid, bard, witch
  full34: [3, 4],     // sorcerer, oracle
  bounded12: [1, 2],  // magus, summoner, psychic, necromancer
};

/**
 * The casting classes. pattern: the slot pattern; cantrips: cantrips per day (or known, for a repertoire);
 * tenth: a 10th-rank slot at 19th level; learns: "repertoire" (chooses what it knows, as many as its slots),
 * "book" (a spellbook, familiar or dirge: book.cantrips and book.first at 1st level, perLevel after),
 * "list" (prepares from its whole tradition: nothing to choose); gifted: repertoire spells per rank its subclass
 * grants within the count (a sorcerer's bloodline); signature: the level signature spells arrive.
 */
export const CASTERS = Object.freeze({
  bard: { pattern: 'full23', cantrips: 5, tenth: true, learns: 'repertoire', signature: 3 },
  oracle: { pattern: 'full34', cantrips: 5, tenth: true, learns: 'repertoire', signature: 3 },
  sorcerer: { pattern: 'full34', cantrips: 5, tenth: true, learns: 'repertoire', gifted: 1, signature: 3 },
  psychic: { pattern: 'bounded12', cantrips: 3, tenth: true, learns: 'repertoire', signature: 3 },
  summoner: { pattern: 'bounded12', cantrips: 5, tenth: false, learns: 'repertoire', signature: 3 },
  wizard: { pattern: 'full23', cantrips: 5, tenth: true, learns: 'book', book: { cantrips: 10, first: 5, perLevel: 2 } },
  witch: { pattern: 'full23', cantrips: 5, tenth: true, learns: 'book', book: { cantrips: 10, first: 5, perLevel: 2 } },
  magus: { pattern: 'bounded12', cantrips: 5, tenth: false, learns: 'book', book: { cantrips: 8, first: 5, perLevel: 2 } },
  necromancer: { pattern: 'bounded12', cantrips: 5, tenth: true, learns: 'book', book: { cantrips: 8, first: 4, perLevel: 2 } },
  cleric: { pattern: 'full23', cantrips: 5, tenth: true, learns: 'list' },
  druid: { pattern: 'full23', cantrips: 5, tenth: true, learns: 'list' },
  animist: { pattern: 'animist', cantrips: 2, tenth: true, learns: 'list' },
});

/** The highest rank a caster of this level casts (half the level, rounded up; 10th from 19th level for some). */
export function maxRank(c, level) {
  if (!c) return 0;
  return Math.min(9, Math.ceil(level / 2)) + (c.tenth && level >= 19 ? 1 : 0);
}

/** Slots by rank at a level: {cantrips, ranks: {1: n, ...}}. The animist's own slots (its apparitions' are apart). */
export function slotsAt(c, level) {
  if (!c) return null;
  const ranks = {};
  const top = Math.min(9, Math.ceil(level / 2));
  for (let r = 1; r <= top; r++) {
    if (c.pattern === 'animist') { ranks[r] = r === top && level % 2 === 1 ? 1 : 2; continue; }
    const [first, after] = PATTERNS[c.pattern];
    ranks[r] = r === top && level === 2 * r - 1 ? first : after;
  }
  if (c.tenth && level >= 19) ranks[10] = 1;
  if (c.pattern === 'animist' && level >= 19) ranks[10] = 0;   // the animist's 10th is an apparition slot
  return { cantrips: c.cantrips, ranks };
}

/**
 * The spells a subclass's text grants, by rank ("Granted Spells - cantrip: Ignition - 1st: Breathe Fire",
 * "Sorcerous Gifts cantrip: Daze; 1st: Phantom Pain"): {0: name, 1: name, ...}. A rank the text leaves to a choice
 * ("see Draconic Exemplars") is left out.
 */
export function grantedSpellNames(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const h = /(?:Granted Spells?|Sorcerous Gifts)\s*-?\s*/.exec(t);
  if (!h) return {};
  let rest = t.slice(h.index + h[0].length);
  const stop = /\s(?:Bloodline Spells|Revelation Spells|Related Domains|Mystery Skill|Blood Magic|Standard Psi|Unique Psi|Psi Cantrips|Patron|Hex Cantrip|Lesson|Spell List|Tradition|Domain Spells|Granted Lore)\b/.exec(rest);
  if (stop) rest = rest.slice(0, stop.index);
  const out = {};
  const parts = rest.split(/(?:^|[;\s]-?\s*)(cantrip|\d+)(?:st|nd|rd|th)?:\s*/).slice(1);
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const name = parts[i + 1].replace(/[;\s-]+$/, '').replace(/\s*\(.*$/, '').trim();
    if (!name || /^see\b/i.test(name)) continue;
    out[parts[i] === 'cantrip' ? 0 : Number(parts[i])] = name;
  }
  return out;
}

/** A subclass's tradition from its text ("Tradition occult", "Spell List primal"), or null. */
export function subclassTradition(text) {
  const m = /\b(?:Tradition|Spell List)\s+(arcane|divine|occult|primal)\b/i.exec(String(text || ''));
  return m ? m[1].toLowerCase() : null;
}

/**
 * What a caster must choose by this level: [{step, count, rank?, text}] against what the build has
 * (build.spells: {cantrips: [keys], repertoire: {rank: [keys]}, book: [keys], signature: {rank: key}}).
 * granted: the spells its subclass gives ({rank: key}); getRank(key) the rank of a spell (0 for a cantrip).
 */
export function spellSteps(c, level, spells = {}, granted = {}, getRank = () => 1) {
  if (!c || c.learns === 'list') return [];
  const out = [];
  const have = (list) => (list || []).length;
  const giftCantrip = granted[0] ? 1 : 0;
  if (c.learns === 'repertoire') {
    const sl = slotsAt(c, level);
    const wantC = c.cantrips - (c.gifted ? giftCantrip : 0);
    if (have(spells.cantrips) < wantC) out.push({ step: 'spells.cantrips', count: wantC - have(spells.cantrips), text: `Choose ${wantC - have(spells.cantrips)} cantrip${wantC - have(spells.cantrips) > 1 ? 's' : ''} for the repertoire.` });
    for (const [r, n] of Object.entries(sl.ranks)) {
      if (Number(r) === 10) continue;   // a 10th-rank slot comes with spells its feature names
      const want = n - (c.gifted && granted[r] ? c.gifted : 0);
      const got = have((spells.repertoire || {})[r]);
      if (got < want) out.push({ step: `spells.rank${r}`, rank: Number(r), count: want - got, text: `Choose ${want - got} ${ordinal(r)}-rank spell${want - got > 1 ? 's' : ''} for the repertoire.` });
    }
    if (c.signature && level >= c.signature) {
      for (const r of Object.keys(sl.ranks).map(Number).filter((r) => r < 10)) {
        if (!(spells.signature || {})[r]) out.push({ step: `spells.signature${r}`, rank: r, count: 1, text: `Choose a signature spell of ${ordinal(r)} rank (one of the repertoire's).` });
      }
    }
  } else if (c.learns === 'book') {
    const book = spells.book || [];
    const cantrips = book.filter((k) => getRank(k) === 0).length;
    const ranked = book.filter((k) => getRank(k) > 0).length;
    if (cantrips < c.book.cantrips) out.push({ step: 'spells.bookCantrips', count: c.book.cantrips - cantrips, text: `Choose ${c.book.cantrips - cantrips} cantrip${c.book.cantrips - cantrips > 1 ? 's' : ''} for the book.` });
    const firsts = book.filter((k) => getRank(k) === 1).length;
    if (firsts < c.book.first) out.push({ step: 'spells.book1', rank: 1, count: c.book.first - firsts, text: `Choose ${c.book.first - firsts} 1st-rank spell${c.book.first - firsts > 1 ? 's' : ''} for the book.` });
    const total = c.book.first + c.book.perLevel * (level - 1);
    if (ranked < total && firsts >= c.book.first) out.push({ step: 'spells.book', count: total - ranked, text: `Add ${total - ranked} spell${total - ranked > 1 ? 's' : ''} of any rank up to ${ordinal(maxRank(c, level) > 9 ? 9 : maxRank(c, level))} to the book (${c.book.perLevel} a level).` });
  }
  return out;
}

const ordinal = (r) => { r = Number(r); return `${r}${r === 1 ? 'st' : r === 2 ? 'nd' : r === 3 ? 'rd' : 'th'}`; };

/**
 * The spells a feature's text says the character learns ("You learn the Counter Performance composition spell and
 * the Courageous Anthem composition cantrip", "Revelation Spells - initial: Incendiary Aura", "Order Spell Heal
 * Animal", "Muse Spell Sure Strike", "your familiar learns Sure Strike"): [{name, how}] with how "learn" (a focus spell
 * or cantrip, or a spell it knows), "repertoire" (added to the repertoire) or "book" (added to the book or familiar).
 */
export function learnedSpellNames(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const out = [];
  const add = (name, how) => { name = name.trim(); if (name && !out.some((x) => x.name === name)) out.push({ name, how }); };
  for (const m of t.matchAll(/\b(?:[Yy]ou learn|[Yy]ou gain|and) the ([A-Z][A-Za-z'’ -]+?) (?:composition |devotion |hex |order |revelation |focus |warden |qi |bloodline |domain )?(spell|cantrip)\b/g)) add(m[1], 'learn');
  for (const m of t.matchAll(/\byour familiar learns ([A-Z][A-Za-z'’ -]+?)(?=[.,;]|\s+and\b)/g)) add(m[1], 'book');
  for (const m of t.matchAll(/\binitial:\s*([A-Z][A-Za-z'’ -]+?)(?=\s*(?:-\s*advanced|;|\s-\s|$))/g)) add(m[1], 'learn');
  for (const m of t.matchAll(/\bOrder Spell\s+([A-Z][A-Za-z'’ -]+?)(?=\s+Anathema\b)/g)) add(m[1], 'learn');
  for (const m of t.matchAll(/\bMuse Spell\s+([A-Z][A-Za-z'’ -]+?)(?=\s+[A-Z][a-z]+ [A-Z]|\s*$)/g)) add(m[1], 'repertoire');
  return out;
}
