// Reading a feat's prerequisites (PF2E). Foundry keeps them as the book's words ("trained in Intimidation",
// "Shield Block", "Strength +2", "Druid Dedication or Wizard Dedication"); this reads the forms the books use and
// says met, not met, or "the GM checks" for the rest (docs/design/game-data.md 9.7).

import { SKILLS } from './build.js';

const RANK = { untrained: 0, trained: 1, expert: 2, master: 3, legendary: 4 };
const ATTR = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };
const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/**
 * What a character offers a prerequisite: from the actor deriveCharacter makes.
 * @returns {{names: Set<string>, P: object, attributes: object, traits: Set<string>, languages: Set<string>, deity: boolean, casts: boolean}}
 */
export function prereqFacts(actor, build = {}) {
  const names = new Set();
  for (const f of [...(actor.feats || []), ...(actor.features || [])]) {
    if (typeof f === 'string') { names.add(norm(f.replace(/-/g, ' '))); continue; }
    if (f.name) names.add(norm(f.name));
    if (f.slug) names.add(norm(f.slug.replace(/-/g, ' ')));
  }
  for (const x of [actor.heritage, actor.background, actor.ancestry && actor.ancestry.name, actor.class && actor.class.name]) if (x) names.add(norm(x));
  const P = actor.proficiencies || {};
  return {
    names, P, attributes: actor.attributes || {},
    traits: new Set((actor.traits || []).map(norm)),
    languages: new Set((actor.languages || []).map(norm)),
    senses: new Set(((actor.ancestry || {}).senses || []).map((x) => norm(x).replace(/[-\s]/g, ''))),
    deity: !!build.deity,
    casts: Object.values(P.spellcasting || {}).some((r) => r > 0),
    heritage: norm(actor.heritage), ancestry: norm(actor.ancestry && actor.ancestry.name), className: norm(actor.class && actor.class.name),
  };
}

/** One prerequisite against the facts: true (met), false (not met) or null (the GM checks it). */
export function prereqMet(text, f) {
  const t = norm(text).replace(/\.$/, '');
  if (!t) return true;
  if (f.names.has(t)) return true;
  let m;
  // "trained in Intimidation", "expert in Warfare Lore", "master in Perception", "trained in martial weapons"
  if ((m = /^(trained|expert|master|legendary) in (?:the )?(.+)$/.exec(t))) {
    const want = RANK[m[1]], what = m[2];
    const one = (w) => {
      w = w.trim();
      if (SKILLS.includes(w)) return ((f.P.skills || {})[w] || 0) >= want;
      const lore = /^(.+) lore$/.exec(w);
      if (lore) return ((f.P.lore || {})[lore[1].replace(/\s+/g, '-')] || 0) >= want;
      if (w === 'perception') return (f.P.perception || 0) >= want;
      const save = /^(fortitude|reflex|will)(?: saves?)?$/.exec(w);
      if (save) return (f.P[save[1]] || 0) >= want;
      const wpn = /^(simple|martial|advanced) weapons$|^(unarmed) attacks$/.exec(w);
      if (wpn) return ((f.P.weapons || {})[wpn[1] || wpn[2]] || 0) >= want;
      const arm = /^(light|medium|heavy) armor$|^(unarmored) defense$/.exec(w);
      if (arm) return ((f.P.armor || {})[arm[1] || arm[2]] || 0) >= want;
      if (/^a skill$|^at least one skill$/.test(w)) return Object.values(f.P.skills || {}).some((r) => r >= want);
      return null;
    };
    // "trained in Arcana or Religion", "trained in Arcana, Nature, Occultism, or Religion", "trained in Stealth and
    // Survival" (but not "... depending on your chosen tradition")
    if (/depending|chosen/.test(what)) return null;
    if (/ and /.test(what) && !/ or /.test(what)) return all(what.split(/,? and |, /).map(one));
    return any(what.split(/,? or |, /).map(one));
  }
  // "Strength +2", "Intelligence or Wisdom +2"
  if ((m = /^((?:strength|dexterity|constitution|intelligence|wisdom|charisma)(?: or (?:strength|dexterity|constitution|intelligence|wisdom|charisma))*) \+?(\d+)$/.exec(t))) {
    return m[1].split(' or ').some((a) => (f.attributes[ATTR[a]] || 0) >= Number(m[2]));
  }
  if (/^(low-light vision|darkvision|greater darkvision)$/.test(t)) {
    const has = (x) => f.senses.has(x.replace(/[-\s]/g, ''));
    return has(t) || (t === 'low-light vision' && has('darkvision')) || (t === 'darkvision' && has('greater darkvision'));
  }
  // a subclass by its kind: "enigma muse", "flames mystery", "warpriest doctrine" (the feature is named for the option)
  if ((m = /^(?:the )?(.+?) (muse|mystery|bloodline|doctrine|instinct|order|patron|research field|hybrid study|cause|innovation|racket|methodology|style|implement|conflux|eidolon)$/.exec(t))) {
    const base = m[1];
    if (f.names.has(base) || f.names.has(`${base} ${m[2]}`) || f.names.has(`${m[2]}: ${base}`)) return true;
    return f.knownNames && (f.knownNames.has(base) || f.knownNames.has(`${m[2]}: ${base}`)) ? false : null;
  }
  if ((m = /^(.+) heritage$/.exec(t))) return any(m[1].split(/,? or |, /).map((h) => f.heritage === norm(h) || f.heritage === `${norm(h)} heritage`));
  if ((m = /^(.+) trait$/.exec(t)) && !/,| or /.test(m[1])) return f.traits.has(m[1]);
  if ((m = /^you speak (.+)$/.exec(t))) return f.languages.has(m[1]);
  if (/^(you )?(follow|worship) a deity$|^you have a deity$/.test(t)) return f.deity;
  if (/^(you have a )?spellcasting class feature$|^(the )?ability to cast spells$/.test(t)) return f.casts || null;
  // "Druid Dedication or Wizard Dedication", "Guiding Shot or Set-Up Strike", "Bomber's field discovery, A, or B"
  if (/ or /.test(t)) {
    const parts = t.split(/,? or |, /).map((p) => p.trim()).filter(Boolean);
    const known = parts.map((p) => (f.names.has(p) ? true : prereqMet(p, { ...f, strictNames: true })));
    return any(known);
  }
  // a single name: a feat or feature we know of but the character does not have
  if (f.strictNames || f.knownNames?.has(t)) return f.names.has(t) ? true : (f.knownNames?.has(t) ? false : null);
  return null;
}
const all = (vals) => (vals.some((v) => v === false) ? false : vals.every((v) => v === true) ? true : null);
const any = (vals) => (vals.some((v) => v === true) ? true : vals.every((v) => v === false) ? false : null);

/** All a feat's prerequisites: {met: true|false|null, unmet: [text], unread: [text]}. */
export function prereqCheck(doc, facts) {
  const unmet = [], unread = [];
  for (const p of (doc && doc.prerequisites) || []) {
    const v = prereqMet(p, facts);
    if (v === false) unmet.push(p); else if (v === null) unread.push(p);
  }
  return { met: unmet.length ? false : unread.length ? null : true, unmet, unread };
}
