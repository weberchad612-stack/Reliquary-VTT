// Pathfinder 2E character builds (docs/design/game-data.md section 9): a build record holds the player's choices
// (ancestry, heritage, background, class, and each level's boosts, skills and feats, by content key), and
// deriveCharacter works out the character from them in the actor format (rulesets/pf2e/schemas/actor.schema.json),
// with what is still to choose (`pending`) and what is wrong (`problems`). The rules here are Player Core's
// (remaster), in our words.
//
// The build record (actor `build`):
//   {v: 1, level, ancestry, heritage, background, class (content keys), keyAttribute (when the class offers two),
//    boosts: {ancestry: [attr per ancestry boost], background: [attr, attr], free: [4 attrs]},
//    skills: {trained: [skills chosen at 1st level], lore: [lore subjects chosen, "warfare"]},
//    levels: {"<n>": {feats: {ancestry|class|general|skill: key}, boosts: [4 attrs] (5, 10, 15, 20),
//                     skillIncrease: skill or "lore:<subject>", trained: [skills an Intelligence increase adds],
//                     selections: {<flag>: value} (the content's choices: section 9.3)}},
//    deity (a content key), selections: {"<item slug>.<flag>": value} (the answers to the content's "pick one" rules: section 9.6),
//    languages: [the languages chosen at 1st level] (levels[n].languages: those an Intelligence increase adds),
//    approvals: [{what, by, at}] (uncommon and rare options the GM allowed; "language:<slug>" for a language), name, details}

import { LANGUAGES, languageRarity } from './languages.js';
import { prereqFacts, prereqCheck } from './prereqs.js';

export const ATTRIBUTES = Object.freeze(['str', 'dex', 'con', 'int', 'wis', 'cha']);
export const SKILLS = Object.freeze(['acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy', 'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion', 'society', 'stealth', 'survival', 'thievery']);
export const BOOST_LEVELS = Object.freeze([5, 10, 15, 20]);
/** Renamed legacy options a remastered one replaces (by content key): none found yet (section 9.1). */
export const SUPERSEDED = Object.freeze({});

/**
 * The attribute each casting class casts with (Player Core and the books after it; Foundry's class data does not
 * say). "key": the class's key attribute (a psychic's Intelligence or Charisma). The tradition and whether it
 * prepares or keeps a repertoire are read from the class's spellcasting feature (castingOf). Step 4 (section 9.4)
 * adds the rest of each caster's casting.
 */
export const CASTING_ATTRIBUTE = Object.freeze({ animist: 'wis', bard: 'cha', cleric: 'wis', druid: 'wis', magus: 'int', necromancer: 'int', oracle: 'cha', psychic: 'key', sorcerer: 'cha', summoner: 'cha', witch: 'int', wizard: 'int' });

/**
 * A casting class's casting: {tradition, attribute, kind} for actor.spellcasting, with tradition null where it comes
 * from a choice (a sorcerer's bloodline, a witch's patron, a summoner's eidolon), or null for a class that does not
 * cast from its spellcasting feature.
 */
export function castingOf(cls, get, keyAttr) {
  const at = cls && CASTING_ATTRIBUTE[cls.slug];
  if (!at) return null;
  const feat = (cls.features || []).map((f) => f.ref && get(f.ref)).find((d) => d && /spellcasting$/.test(d.slug));
  const t = (feat && feat.text) || '';
  const m = /spells of the (arcane|divine|occult|primal) tradition|cast (arcane|divine|occult|primal) spells/i.exec(t);
  return { tradition: m ? (m[1] || m[2]).toLowerCase() : null, attribute: at === 'key' ? keyAttr : at, kind: /repertoire/i.test(t) ? 'spontaneous' : 'prepared' };
}

const slug = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const loreSlug = (s) => slug(String(s || '').replace(/\blore\b/i, ''));
const isFree = (opts) => ATTRIBUTES.every((a) => opts.includes(a));

/** An ancestry's or background's boost slots: [{options, fixed}] (a single option is fixed; all six is free). */
export function boostSlots(doc) {
  return ((doc && doc.boosts) || []).map((o) => ({ options: o.slice(), fixed: o.length === 1 ? o[0] : null, free: isFree(o) }));
}

/** The highest rank a skill may reach at a level (expert from 1, master from 7, legendary from 15). */
export const maxSkillRank = (level) => (level >= 15 ? 4 : level >= 7 ? 3 : 2);

// ---- the rules a build runs (section 9.6) ----

/** The Foundry rule elements a build runs: the rest are read at the table, or not at all. */
export const BUILD_RULES = Object.freeze(['ChoiceSet', 'RollOption', 'GrantItem', 'ActiveEffectLike', 'MartialProficiency']);

/** Foundry's compendium names for the packs a build uses, and our sources for them. */
export const FOUNDRY_PACKS = Object.freeze({
  actionspf2e: 'actions', ancestries: 'ancestries', ancestryfeatures: 'ancestry-features', backgrounds: 'backgrounds',
  classes: 'classes', classfeatures: 'class-features', 'feats-srd': 'feats', heritages: 'heritages', 'spells-srd': 'spells',
  'equipment-srd': 'equipment', 'feat-effects': 'feat-effects', deities: 'deities', 'familiar-abilities': 'familiar-abilities',
  'spell-effects': 'spell-effects', 'equipment-effects': 'equipment-effects', 'other-effects': 'other-effects',
});

/**
 * A resolver for Foundry's links ("Compendium.pf2e.feats-srd.Item.<id or name>") from the import manifest
 * (content/pf2e/import-manifest.json): (uuid) -> our content key, or null.
 */
export function foundryResolver(manifest) {
  const byId = new Map(), byName = new Map();
  for (const [k, v] of Object.entries((manifest && manifest.documents) || {})) {
    const [source, id] = [k.slice(0, k.indexOf('/')), k.slice(k.indexOf('/') + 1)];
    const key = `${source}:${v.key}`;
    byId.set(`${source}/${id}`, key);
    if (v.name) byName.set(`${source}/${String(v.name).toLowerCase()}`, key);
  }
  return (uuid) => {
    const m = /^Compendium\.pf2e\.([^.]+)\.Item\.(.+)$/.exec(String(uuid || ''));
    if (!m) return null;
    const source = FOUNDRY_PACKS[m[1]] || m[1];
    return byId.get(`${source}/${m[2]}`) || byName.get(`${source}/${m[2].toLowerCase()}`) || null;
  };
}

// proficiency gains written in a class feature's text ("your proficiency rank for Fortitude saves increases to
// master"): Foundry's data leaves most of them out, and the text says them in a fixed form
const RANKS = { trained: 1, expert: 2, master: 3, legendary: 4 };
const GAIN = [
  [/\byour (?:and your [a-z'’]+ )?proficiency ranks? (?:for|in|with) ([^.]*?) (?:increases?|increase) to (expert|master|legendary)/gi, 1, 2],
  [/\byour proficiency ranks? increases? to (expert|master|legendary) (?:for|with|in) ([^.]*)/gi, 2, 1],
  // "you're trained in light and medium armor", "you become trained in martial weapons"
  [/\byou(?:'re| are| become)? trained (?:in|with) ([^.;]*)/gi, 1, null],
  // "you have expert proficiency in Fortitude saves", "you gain expert proficiency with martial weapons"
  [/\byou (?:have|gain) (expert|master|legendary) proficiency (?:in|with) ([^.;]*)/gi, 2, 1],
];
// a feature whose text sums up features that come at later levels ("Second Doctrine (3rd): ...") is read from
// those features, not from the summary
const SUMMARY = /\(\d+(?:st|nd|rd|th)\):/;

/** What a phrase names: [{bag, key}] in the proficiencies, or null when it cannot be told from the words. */
export function profTargets(phrase) {
  const p = String(phrase || '').toLowerCase();
  if (/chosen|that group|choice|listed|\bor\b|\beach\b|^it$|^your (weapon|armor)|associated|matching|related|instead|rather/.test(p)) return null;
  const out = [];
  if (/spell attack|spell dc/.test(p)) out.push({ bag: 'spellcasting', key: 'class' });
  if (/class dc|ranger dc/.test(p)) out.push({ bag: null, key: 'classDC' });
  if (/perception/.test(p)) out.push({ bag: null, key: 'perception' });
  for (const s of ['fortitude', 'reflex', 'will']) if (new RegExp(`\\b${s}\\b`).test(p)) out.push({ bag: null, key: s });
  if (/favored weapon/.test(p)) out.push({ bag: 'weapons', key: 'deitys-favored-weapon' });
  if (/firearms/.test(p)) out.push({ bag: 'weapons', key: 'firearms-crossbows' });
  else if (/advanced weapons/.test(p)) out.push({ bag: 'weapons', key: 'advanced' });
  if (/simple/.test(p)) out.push({ bag: 'weapons', key: 'simple' });
  if (/martial/.test(p)) out.push({ bag: 'weapons', key: 'martial' });
  if (/unarmed attacks/.test(p)) out.push({ bag: 'weapons', key: 'unarmed' });
  if (/alchemical bombs/.test(p)) out.push({ bag: 'weapons', key: 'alchemical-bombs' });
  if (/unarmored/.test(p)) out.push({ bag: 'armor', key: 'unarmored' });
  if (/\blight\b/.test(p)) out.push({ bag: 'armor', key: 'light' });
  if (/\bmedium\b/.test(p)) out.push({ bag: 'armor', key: 'medium' });
  if (/\bheavy\b/.test(p)) out.push({ bag: 'armor', key: 'heavy' });
  for (const k of SKILLS) if (new RegExp(`\\b${k}\\b`).test(p)) out.push({ bag: 'skills', key: k });
  const lore = /([a-z]+) lore/.exec(p);
  if (lore) out.push({ bag: 'lore', key: lore[1] });
  return out.length ? out : null;
}

/**
 * A feature several classes share (Weapon Expertise) words its text once for each, in paragraphs headed by the
 * classes' names ("Druid, Kineticist You've improved ..."): the paragraphs for this class, or the whole text when it
 * has no such headings.
 */
export function classSection(text, className) {
  const paras = String(text || '').split(/\n\s*\n(?:---\s*\n)?/).map((p) => p.replace(/^---\s*/, '').trim()).filter(Boolean);
  const head = (p) => { const m = /^([A-Z][a-z]+(?:, [A-Z][a-z]+)*) (?=[A-Z])/.exec(p); return m ? m[1].split(', ') : null; };
  if (paras.filter(head).length < 2 || !className) return String(text || '');
  return paras.filter((p) => (head(p) || []).includes(className)).map((p) => p.replace(/^[A-Z][a-z]+(?:, [A-Z][a-z]+)* /, '')).join('\n\n');
}

/** The proficiency gains a feature's text states: {gains: [{bag, key, rank}], unread: [phrase]}. */
export function textGains(text) {
  const gains = [], unread = [];
  const t = String(text || '');
  if (SUMMARY.test(t)) return { gains, unread };
  for (const [re, pi, ri] of GAIN) {
    for (const m of t.matchAll(re)) {
      // the clause up to a condition ("At 13th level, if ...") belongs to a later level: not read here
      if (/\bat \d+(?:st|nd|rd|th) level\b[^.]*$/i.test(t.slice(Math.max(0, m.index - 60), m.index))) continue;
      // nor one that holds only if something is so ("If you have qi spells, your proficiency ..."): the rules or
      // the step that gives that thing read it
      if (/\bif\b[^.]*$/i.test(t.slice(Math.max(0, m.index - 80), m.index))) continue;
      const phrase = m[pi].replace(/\s+(?:and|but|as long as|if|when|while)\s+(?:you|your)\b.*$/i, '').replace(/,?\s+and gain\b.*$/i, '');
      const rank = ri ? m[ri] : 'trained';
      const targets = profTargets(phrase);
      // "the listed skills", "the skill associated with your patron": the subclass's own rules give those
      if (/listed|associated|matching|related|granted by/i.test(phrase)) continue;
      if (!targets) { unread.push(phrase.trim()); continue; }
      for (const x of targets) gains.push({ ...x, rank: RANKS[rank.toLowerCase()] });
    }
  }
  return { gains, unread };
}

// the rules a feat or feature keeps on the character: those the engine runs in play. The building rules have run
// already, and the rest stay in the content (docs/design/game-data.md 9.6)
const playRules = (d) => { const r = ((d && d.rules) || []).filter((x) => x.key !== 'unsupported'); return r.length ? { rules: r } : {}; };

// terms a predicate tests that are states in play (an effect, a condition, a battle form, a target): while
// building none of them holds
const IN_PLAY = /^(self:(effect|condition|action|stance)|battle-form|target:|origin:|item:|rage$|stance:)/;

/**
 * Does a Foundry predicate hold for the build? facts: {level, tags: Set of the character's roll options,
 * knows?(term)}. Returns true, false, or null (a term the builder cannot know: only when facts.knows is given,
 * as the report does; the build itself reads an unknown term as absent).
 */
export function predicateHolds(pred, facts) {
  if (pred === undefined || pred === null) return true;
  const one = (t) => {
    if (typeof t === 'string') {
      if (IN_PLAY.test(t)) return false;
      const rk = /^((?:skill|defense|attack|save):[a-z-]+:rank):(\d)$/.exec(t);
      if (rk) return facts.rank ? facts.rank(rk[1]) === Number(rk[2]) : facts.knows ? true : null;
      if (facts.knows && !facts.knows(t)) return null;
      return facts.tags.has(t);
    }
    if (t && typeof t === 'object') {
      if (t.not !== undefined) { const v = one(t.not); return v === null ? null : !v; }
      if (Array.isArray(t.or)) { const v = t.or.map(one); return v.some((x) => x === true) ? true : v.some((x) => x === null) ? null : false; }
      if (Array.isArray(t.nor)) { const v = t.nor.map(one); return v.some((x) => x === true) ? false : v.some((x) => x === null) ? null : true; }
      if (Array.isArray(t.nand)) { const v = t.nand.map(one); return v.some((x) => x === false) ? true : v.some((x) => x === null) ? null : false; }
      if (Array.isArray(t.and)) { const v = t.and.map(one); return v.some((x) => x === false) ? false : v.some((x) => x === null) ? null : true; }
      for (const op of ['gte', 'gt', 'lte', 'lt', 'eq']) {
        const rk = Array.isArray(t[op]) && typeof t[op][0] === 'string' && /^(skill|defense|attack|save):[a-z-]+:rank$/.test(t[op][0]);
        if (Array.isArray(t[op]) && (t[op][0] === 'self:level' || rk) && typeof t[op][1] === 'number') {
          if (rk && !facts.rank) return facts.knows ? true : null;
          const a = rk ? facts.rank(t[op][0]) : facts.level, n = t[op][1];
          return { gte: a >= n, gt: a > n, lte: a <= n, lt: a < n, eq: a === n }[op];
        }
      }
    }
    return null;
  };
  const list = Array.isArray(pred) ? pred : [pred];
  const v = list.map(one);
  return v.some((x) => x === false) ? false : v.some((x) => x === null) ? null : true;
}

/** The roll option a choice gives ("kinetic-gate:first-element:air"), or null when it gives none. */
export function choiceOption(fr, value) {
  if (!fr || !fr.rollOption || value === undefined || value === null) return null;
  const v = String(value).includes('/') ? String(value).split('/').pop() : String(value);
  return `${fr.rollOption}:${v.toLowerCase()}`;
}

/** Foundry's words are keys into its language file ("PF2E.Skill.Acrobatics"): the last part, spaced ("Acrobatics"). */
export function foundryLabel(k) {
  const t = String(k == null ? '' : k);
  if (!/^PF2E\./.test(t)) return t;
  const last = t.split('.').pop().replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2');
  return last.charAt(0) + last.slice(1).toLowerCase();
}

/** What a choice asks, from Foundry's prompt key: "choose a skill", "make a choice (general training)". */
function choicePrompt(p) {
  const parts = String(p || '').split('.');
  if (!/^PF2E\./.test(String(p || ''))) return p ? String(p) : 'make a choice';
  if (parts[parts.length - 1] === 'Prompt') return parts.length > 3 ? `make a choice (${foundryLabel(parts.slice(0, -1).join('.')).toLowerCase()})` : 'make a choice';
  const w = foundryLabel(p).toLowerCase().replace(/\bone\b/, '1');
  return `choose ${/^[aeiou]/.test(w) ? 'an' : 'a'} ${w}`;
}

/**
 * Fill a rule's references: {item|flags.system.rulesSelections.<flag>} with this item's choice and
 * {actor|flags.<path>} with a flag another item set (the cleric's doctrine sets the doctrines its later features
 * grant). undefined: a reference not filled yet (a choice to make, a flag still to come); null: a reference the
 * builder does not read.
 */
function fill(v, flags, actorFlags = {}) {
  if (typeof v !== 'string') return v;
  let missing = false;
  const out = v.replace(/\{item\|flags\.system\.rulesSelections\.([A-Za-z0-9_]+)\}/gi, (_, f) => { if (flags[f] === undefined) { missing = true; return ''; } return String(flags[f]); })
    .replace(/\{actor\|flags\.([A-Za-z0-9_.]+)\}/g, (_, p) => { const x = dig(actorFlags, p); if (x === undefined) { missing = true; return ''; } return String(x); });
  if (missing) return undefined;
  return /\{[^}]*\|/.test(out) ? null : out;
}
const dig = (o, p) => p.split('.').reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o);
function setPath(o, p, v, mode) {
  const ks = p.split('.'), last = ks.pop();
  let t = o;
  for (const k of ks) t = t[k] && typeof t[k] === 'object' ? t[k] : (t[k] = {});
  t[last] = mode === 'override' && v && typeof v === 'object' && !Array.isArray(v) ? { ...(t[last] || {}), ...v } : v;
}

/**
 * Work out a rank Foundry writes as a formula: numbers, @actor.level, @actor.system.<...>.rank (read through
 * rankAt), ternary, max, min, gte, gt, lte, lt, eq. null when it holds anything else.
 */
export function rankFormula(src, level, rankAt) {
  const toks = String(src).match(/@[A-Za-z0-9_.{}|-]+|\d+|[A-Za-z]+|[(),]/g) || [];
  let i = 0;
  const expr = () => {
    const t = toks[i++];
    if (t === undefined) throw new Error('end');
    if (/^\d+$/.test(t)) return Number(t);
    if (t === '@actor.level') return level;
    if (t.startsWith('@actor.system.')) { const v = rankAt(t.slice(14)); if (v === null) throw new Error(t); return v; }
    const fns = { ternary: (c, a, b) => (c ? a : b), max: Math.max, min: Math.min, gte: (a, b) => a >= b, gt: (a, b) => a > b, lte: (a, b) => a <= b, lt: (a, b) => a < b, eq: (a, b) => a === b };
    if (!fns[t] || toks[i++] !== '(') throw new Error(t);
    const args = [expr()];
    while (toks[i] === ',') { i++; args.push(expr()); }
    if (toks[i++] !== ')') throw new Error(')');
    return fns[t](...args);
  };
  try { const v = expr(); return i === toks.length && typeof v === 'number' ? v : null; } catch { return null; }
}

/**
 * The character a build makes. get(key) -> content document (or undefined).
 * opts.resolve(uuid) -> content key: Foundry's links in the content's rules (foundryResolver). opts.knownNames: the
 * names of every feat and class feature (lower case), so a prerequisite naming one the character lacks is unmet
 * (knownFeatNames in rulesets/pf2e/builder.js); without it such a prerequisite is left to the GM.
 * checks: prerequisites the builder cannot read, for the GM.
 * @returns {{actor: object, pending: Array<{level, step, text}>, problems: string[], unsupported: Array<{from, rule, why}>, checks: Array<{feat, level, prerequisite}>}}
 */
export function deriveCharacter(build, get, opts = {}) {
  const b = build || {}, L = Math.max(1, Math.min(20, b.level || 1));
  const pending = [], problems = [];
  const need = (level, step, text) => pending.push({ level, step, text });
  const doc = (key, kind) => {
    if (!key) return null;
    const d = get(key);
    if (!d) { problems.push(`${kind} ${key} is not in the content`); return null; }
    if (d.kind !== kind) problems.push(`${key} is a ${d.kind}, not a ${kind}`);
    return d;
  };
  const anc = doc(b.ancestry, 'ancestry'), her = doc(b.heritage, 'heritage'), bg = doc(b.background, 'background'), cls = doc(b.class, 'class');
  if (!anc) need(1, 'ancestry', 'Choose an ancestry.');
  if (anc && !her) need(1, 'heritage', `Choose a heritage for the ${anc.name.toLowerCase()}.`);
  // a versatile heritage (Changeling, Nephilim) belongs to no ancestry and suits any
  if (her && anc && her.ancestry && her.ancestry.ref && her.ancestry.ref !== b.ancestry) problems.push(`${her.name} is a heritage of the ${her.ancestry.name}, not the ${anc.name}`);
  if (!bg) need(1, 'background', 'Choose a background.');
  if (!cls) need(1, 'class', 'Choose a class.');

  // ---- attributes ----
  const mods = Object.fromEntries(ATTRIBUTES.map((a) => [a, 0]));
  const partial = Object.fromEntries(ATTRIBUTES.map((a) => [a, false]));
  const boostSet = (label, slots, chosen, level) => {
    const picks = [];
    slots.forEach((s, i) => {
      const v = s.fixed || (chosen || [])[i];
      if (!v) { need(level, `boosts.${label}`, `Choose the ${label} boost${slots.length > 1 ? ` ${i + 1}` : ''} (${s.free ? 'any attribute' : s.options.join(' or ')}).`); return; }
      if (!s.options.includes(v)) { problems.push(`${label} boost ${i + 1}: ${v} is not one of ${s.options.join(', ')}`); return; }
      picks.push(v);
    });
    const twice = picks.filter((v, i) => picks.indexOf(v) !== i);
    if (twice.length) problems.push(`${label} boosts: ${twice[0]} boosted twice (each boost from one source goes to a different attribute)`);
    return [...new Set(picks)];
  };
  const raise = (a, level) => {
    // from 2nd level on, a boost to +4 or more is a partial boost: two of them raise it by one
    if (level > 1 && mods[a] >= 4) { if (partial[a]) { mods[a] += 1; partial[a] = false; } else partial[a] = true; } else mods[a] += 1;
  };
  if (anc) {
    for (const a of boostSet('ancestry', boostSlots(anc), (b.boosts || {}).ancestry, 1)) raise(a, 1);
    for (const f of (anc.flaws || []).filter((o) => o.length === 1)) mods[f[0]] -= 1;
  }
  if (bg) for (const a of boostSet('background', boostSlots(bg), (b.boosts || {}).background, 1)) raise(a, 1);
  let key = null;
  if (cls) {
    const ka = cls.keyAttribute || [];
    key = ka.length === 1 ? ka[0] : b.keyAttribute;
    // a class whose key attribute its subclass decides (a psychic's subconscious mind) lists none
    if (!key) need(1, 'keyAttribute', ka.length ? `Choose the ${cls.name.toLowerCase()}'s key attribute (${ka.join(' or ')}).` : `Choose the ${cls.name.toLowerCase()}'s key attribute (its subclass says which).`);
    else if (!ATTRIBUTES.includes(key) || (ka.length && !ka.includes(key))) problems.push(`key attribute ${key} is not one of the ${cls.name}'s (${ka.join(', ')})`);
    else raise(key, 1);
  }
  for (const a of boostSet('free', Array.from({ length: 4 }, () => ({ options: [...ATTRIBUTES], free: true })), (b.boosts || {}).free, 1)) raise(a, 1);
  const levels = b.levels || {};
  const intAt1 = mods.int;
  // an Intelligence modifier that goes up after 1st level brings a trained skill and a language at that level
  const intGains = {};
  for (const lv of BOOST_LEVELS.filter((x) => x <= L)) {
    const before = mods.int;
    const picks = boostSet(`level ${lv}`, Array.from({ length: 4 }, () => ({ options: [...ATTRIBUTES], free: true })), (levels[lv] || {}).boosts, lv);
    for (const a of picks) raise(a, lv);
    if (mods.int > before) intGains[lv] = mods.int - before;
  }

  // the class's casting; its proficiency is kept by tradition, as the engine reads it (by the class's name until the
  // tradition is known)
  const casting = cls ? castingOf(cls, get, key) : null;
  const spellKey = () => (casting && casting.tradition) || (cls && cls.slug) || 'class';

  // ---- proficiencies ----
  const P = { perception: 0, fortitude: 0, reflex: 0, will: 0, classDC: 0, armor: {}, weapons: {}, skills: {}, lore: {}, spellcasting: {} };
  if (cls) {
    P.perception = cls.perception || 0;
    for (const s of ['fortitude', 'reflex', 'will']) P[s] = (cls.saves || {})[s] || 0;
    P.classDC = 1;
    if (cls.spellcasting) P.spellcasting[spellKey()] = cls.spellcasting;
    for (const [k, v] of Object.entries(cls.defenses || {})) if (v) P.armor[k] = v;
    for (const [k, v] of Object.entries(cls.attacks || {})) {
      if (k === 'other') { if (v && v.name && v.rank) P.weapons[slug(v.name)] = v.rank; continue; }
      if (v) P.weapons[k] = v;
    }
  }
  // trained skills: the class's and the background's; where two give the same skill, the player picks another
  const fixed = [...((cls && cls.skills && cls.skills.trained) || []), ...((bg && bg.skills) || [])];
  const doubled = fixed.filter((s, i) => fixed.indexOf(s) !== i).length;
  for (const s of fixed) P.skills[s] = 1;
  const chosen = ((b.skills || {}).trained || []);
  const want = cls ? ((cls.skills || {}).additional || 0) + Math.max(0, intAt1) + doubled : 0;
  // (the Intelligence modifier counts as it stands at 1st level; a later increase adds a skill at that level)
  for (const s of chosen) {
    if (!SKILLS.includes(s)) { problems.push(`trained skill ${s}: not a skill (lore subjects go in skills.lore)`); continue; }
    if (P.skills[s]) problems.push(`${s} is trained already (choose another skill)`);
    P.skills[s] = 1;
  }
  if (cls && chosen.length < want) need(1, 'skills', `Choose ${want - chosen.length} more trained skill${want - chosen.length > 1 ? 's' : ''} (${want} in all: the class's ${(cls.skills || {}).additional || 0}, Intelligence ${intAt1}${doubled ? `, ${doubled} for a skill trained twice` : ''}).`);
  if (chosen.length > want && cls) problems.push(`${chosen.length} trained skills chosen, ${want} allowed`);
  for (const l of [...((bg && bg.lore) || []), ...((b.skills || {}).lore || [])]) P.lore[loreSlug(l)] = 1;
  // ---- features and feats ----
  const features = cls ? (cls.features || []).filter((f) => f.level <= L).map((f) => (f.ref ? f.ref.split('/').pop() : slug(f.name))) : [];
  // the ancestry's own features (a dwarf's Clan Dagger, an elf's or a gnome's low-light vision)
  for (const f of (anc && anc.features) || []) if ((f.level || 0) <= L) features.push(f.ref ? f.ref.split('/').pop() : slug(f.name));
  const feats = [];
  const featOf = (k, level, slot) => {
    const d = get(k);
    if (!d) { problems.push(`${slot} feat ${k} is not in the content`); return; }
    if (d.level && d.level > level) problems.push(`${d.name} is a level ${d.level} feat, taken at level ${level}`);
    feats.push({ name: d.name, slug: d.slug, ref: k, level, slot, ...playRules(d) });
  };
  for (const f of (bg && bg.feats) || []) if ((f.level || 1) <= L && f.ref) featOf(f.ref, f.level || 1, 'background');
  if (cls) {
    for (const [kind, lvls] of Object.entries(cls.featLevels || {})) {
      for (const lv of lvls.filter((x) => x <= L)) {
        const k = ((levels[lv] || {}).feats || {})[kind];
        if (!k) need(lv, `feat.${kind}`, `Choose a${kind === 'ancestry' ? 'n' : ''} ${kind} feat (level ${lv} or lower).`);
        else featOf(k, lv, kind);
      }
    }
  }

  // ---- the content's own rules: "pick one", "you gain this", proficiency upgrades (section 9.6) ----
  const sel = b.selections || {}, unsupported = [], granted = [], actorFlags = {}, waiting = [], formulas = [], langGranted = [];
  let langExtra = 0;
  const resolve = opts.resolve || (() => null);
  const camel = (x) => String(x).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
  const tags = new Set();
  for (const [kind, d] of [['class', cls], ['ancestry', anc], ['heritage', her], ['background', bg]]) if (d && d.slug) tags.add(`${kind}:${d.slug}`);
  for (const f of feats) tags.add(`feat:${f.slug}`);
  for (const s of features) { tags.add(`feat:${s}`); tags.add(`feature:${s}`); }   // Foundry gives class features both
  for (const t of (anc && anc.traits) || []) tags.add(`self:trait:${t}`);
  if (b.deity) tags.add('deity');
  if (her && her.slug) tags.add(`self:heritage:${her.slug}`);
  const choicesOf = (d) => ((d && d.rules) || []).map((r) => (r.key === 'unsupported' ? r.foundry : null)).filter((fr) => fr && fr.key === 'ChoiceSet');
  const facts = { level: L, tags };
  const up = (bag, k, rank, mode) => {
    const box = bag ? P[bag] : P;
    const now = box[k] || 0;
    box[k] = Math.max(0, Math.min(4, mode === 'override' ? rank : mode === 'add' ? now + rank : Math.max(now, rank)));
  };
  // a rule's proficiency path: [bag, key] in P, or null
  const pathOf = (p) => {
    let m;
    if ((m = /^system\.skills\.([a-z-]+)\.rank$/.exec(p))) return SKILLS.includes(m[1]) ? ['skills', m[1]] : /-lore$/.test(m[1]) ? ['lore', m[1].replace(/-lore$/, '')] : null;
    if ((m = /^system\.proficiencies\.attacks\.([a-z-]+)\.rank$/.exec(p))) return ['weapons', m[1]];
    if ((m = /^system\.proficiencies\.defenses\.([a-z-]+)\.rank$/.exec(p))) return ['armor', m[1]];
    if ((m = /^system\.saves\.(fortitude|reflex|will)\.rank$/.exec(p))) return [null, m[1]];
    if (/^system\.(attributes\.)?perception\.rank$/.test(p)) return [null, 'perception'];
    if (/^system\.proficiencies\.classDCs\.[a-z-]+\.rank$/.test(p)) return [null, 'classDC'];
    if (/^system\.proficiencies\.spellcasting\.rank$/.test(p)) return ['spellcasting', spellKey()];
    return null;
  };
  const rankAt = (p) => { const t = pathOf(`system.${p}`); return t ? ((t[0] ? P[t[0]] : P)[t[1]] || 0) : null; };
  facts.rank = (term) => {
    const [kind, k] = term.split(':');
    const bag = { skill: P.skills, defense: P.armor, attack: P.weapons }[kind];
    return bag ? (bag[k] || 0) : kind === 'save' ? (P[k] || 0) : 0;
  };
  const seen = new Set(), featureDocs = new Map();
  const queue = [];
  const add = (d, key, level, from, granter) => {
    if (!d || seen.has(key || d.slug)) return;
    seen.add(key || d.slug);
    if (/feature$/.test(from)) featureDocs.set(d.slug, { name: d.name, slug: d.slug, ...(key ? { ref: key } : {}), level, ...playRules(d) });
    queue.push({ d, key, level, from, granter, flags: {} });
    // the roll options of the choices made on it count from the start, as Foundry's do
    for (const fr of choicesOf(d)) { const o = choiceOption(fr, sel[`${d.slug}.${fr.flag || camel(d.slug)}`]); if (o) tags.add(o); }
  };
  add(cls, b.class, 1, 'class'); add(anc, b.ancestry, 1, 'ancestry'); add(her, b.heritage, 1, 'heritage'); add(bg, b.background, 1, 'background');
  for (const f of (cls && cls.features) || []) if (f.level <= L && f.ref) add(get(f.ref), f.ref, f.level, 'class feature');
  for (const f of (anc && anc.features) || []) if ((f.level || 0) <= L && f.ref) add(get(f.ref), f.ref, Math.max(1, f.level || 0), 'ancestry feature');
  for (const f of feats) add(get(f.ref), f.ref, f.level, `${f.slot} feat`);

  // one rule: true when done (or set aside), 'wait' when it needs a flag another item has not set yet
  const run = (it, fr) => {
    const { d, key, level, flags } = it;
    const where = `${d.name} (${it.from})`;
    const skip = (why) => { unsupported.push({ from: where, rule: fr.key, why }); return true; };
    tags.delete('parent:granter');
    for (const t of [...tags].filter((x) => x.startsWith('parent:granter:'))) tags.delete(t);
    if (it.granter) { tags.add(`parent:granter:slug:${it.granter}`); tags.add('parent:granter'); }
    const fillDeep = (x) => (typeof x === 'string' ? (fill(x, flags, actorFlags) ?? '') : Array.isArray(x) ? x.map(fillDeep) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, fillDeep(v)])) : x);
    const holds = predicateHolds(fr.predicate === undefined ? undefined : fillDeep(fr.predicate), facts);
    if (holds === false) return true;
    if (fr.key === 'ChoiceSet') {
      const flag = fr.flag || camel(d.slug);
      const id = `${d.slug}.${flag}`;
      const c = fr.choices;
      const spec = Array.isArray(c) ? { options: c.map((o) => (o && typeof o === 'object' ? { value: o.value, label: foundryLabel(o.label) } : { value: o, label: String(o) })) }
        : c && typeof c === 'object' && c.ownedItems ? { owned: { types: c.types || [], ...(c.predicate ? { predicate: c.predicate } : {}) } }
        : c && typeof c === 'object' && c.filter ? { filter: c.filter, ...(c.itemType ? { itemType: c.itemType } : {}) }
        : typeof c === 'string' ? { config: c } : c && c.config ? { config: c.config } : null;
      if (!spec) return skip('a choice of a kind the builder does not read');
      if (sel[id] === undefined) {
        need(level, `choice.${id}`, `${d.name}: ${spec.owned ? 'choose one of the character\'s own items (once the gear is bought)' : choicePrompt(fr.prompt)}.`);
        pending[pending.length - 1].choice = { item: key || d.slug, flag, ...spec };
        return true;
      }
      if (spec.options) {
        const ok = spec.options.some((o) => o.value === sel[id] || (typeof o.value === 'string' && /^Compendium\./.test(o.value) && resolve(o.value) === sel[id]));
        if (!ok) problems.push(`${d.name}: ${sel[id]} is not one of its choices`);
      }
      flags[flag] = sel[id];
      const o = choiceOption(fr, sel[id]);
      if (o) tags.add(o);
      return true;
    }
    if (fr.key === 'GrantItem') {
      const uuid = fill(fr.uuid, flags, actorFlags);
      if (uuid === undefined) return /\{actor\|/.test(fr.uuid) ? 'wait' : true;   // a choice still to make: its own step says so
      if (uuid === null) return skip(`it grants ${fr.uuid}, which the builder cannot work out`);
      const gk = /^Compendium\./.test(uuid) ? resolve(uuid) : uuid;
      const g = gk ? get(gk) : null;
      if (!g) return skip(`it grants ${uuid}, which is not in the open content`);
      if (seen.has(gk)) return true;
      if (g.kind === 'feat') {
        if (g.category === 'classfeature') { features.push(g.slug); tags.add(`feature:${g.slug}`); }
        else feats.push({ name: g.name, slug: g.slug, ref: gk, level, slot: 'granted', from: d.name, ...playRules(g) });
        tags.add(`feat:${g.slug}`);
      } else granted.push({ name: g.name, kind: g.kind, ref: gk, from: d.name });
      add(g, gk, level, g.category === 'classfeature' ? 'class feature' : 'granted', d.slug);
      return true;
    }
    if (fr.key === 'RollOption') {
      // a standing roll option (Clan Dagger's chosen weapon); one the player toggles in play is not the build's
      if (fr.toggleable) return true;
      const o = fill(fr.option, flags, actorFlags);
      if (o === undefined) return true;
      if (o) tags.add(String(o).toLowerCase());
      return true;
    }
    if (fr.key === 'MartialProficiency') {
      // a proficiency for weapons matching a definition (Fighter Weapon Mastery's chosen group); sameAs: its rank
      // goes with another's (Monastic Weaponry: as unarmed attacks, up to master)
      const fillAll = (x) => (typeof x === 'string' ? fill(x, flags, actorFlags) : Array.isArray(x) ? x.map(fillAll) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, fillAll(v)])) : x);
      const def = fillAll(fr.definition);
      const text = JSON.stringify(def, (k, v) => (v === undefined ? '__undefined__' : v));
      if (text.includes('__undefined__')) return true;   // the choice is still to make
      if (text.includes('null')) return skip('a weapon proficiency the builder cannot work out');
      const slugOf = fr.slug || `${d.slug}-${Object.keys(P.definitions || {}).length + 1}`;
      P.definitions = P.definitions || {};
      P.definitions[slugOf] = { when: Array.isArray(def) ? def : [def], ...(fr.sameAs ? { sameAs: fr.sameAs } : {}), ...(RANKS[fr.maxRank] ? { max: RANKS[fr.maxRank] } : {}) };
      if (typeof fr.value === 'number') up('weapons', slugOf, fr.value, 'upgrade');
      else if (fr.value !== undefined && fr.value !== null) formulas.push({ where, fr, target: ['weapons', slugOf] });
      return true;
    }
    // ActiveEffectLike
    const path = fill(fr.path, flags, actorFlags);
    if (path === undefined) return /\{actor\|/.test(fr.path) ? 'wait' : true;
    if (path === null) return skip(`a change to ${fr.path}, which the builder cannot work out`);
    if (/^flags\./.test(path)) { setPath(actorFlags, path.slice(6), fr.value, fr.mode); return true; }
    if (path === 'system.build.languages.granted') { const v = fr.value && typeof fr.value === 'object' ? fr.value.slug : fr.value; if (v) langGranted.push(String(v)); return true; }
    if (path === 'system.build.languages.max') {
      if (typeof fr.value === 'number') langExtra += fr.value;
      else formulas.push({ where, fr, target: ['languages', 'max'] });
      return true;
    }
    const target = pathOf(path);
    if (!target) return true;   // not a proficiency: a play-time effect, read by the rules at the table
    if (!['upgrade', 'override', 'add'].includes(fr.mode)) return skip(`a ${fr.mode} of ${path}`);
    const raw = typeof fr.value === 'string' ? fill(fr.value, flags, actorFlags) : fr.value;
    if (raw === undefined) return true;   // a rank set by a choice still to make
    const v = typeof raw === 'number' ? raw : /^\d+$/.test(String(raw)) ? Number(raw) : undefined;
    if (v === undefined) { formulas.push({ where, fr: { ...fr, value: String(raw).replace(/@item\.flags\.system\.rulesSelections\.([A-Za-z0-9_]+)/g, (m, k) => (typeof flags[k] === 'number' || /^\d+$/.test(String(flags[k])) ? String(flags[k]) : m)) }, target }); return true; }   // worked out once the rest is in
    up(target[0], target[1], v, fr.mode);
    return true;
  };
  for (;;) {
    while (queue.length) {
      const it = queue.shift();
      if (it.from === 'class feature') {
        // the proficiency gains a class feature states in its text and Foundry leaves out
        // (a feature shared by classes, Weapon Expertise, is read in this class's paragraphs only)
        const { gains, unread } = textGains(classSection(it.d.text, cls && cls.name));
        for (const g of gains) {
          const k = g.bag === 'spellcasting' ? spellKey() : g.key;
          // a rank raised above trained raises what the character has: a wizard's Weapon Expertise does not make
          // it an expert with martial weapons it was never trained in
          if (g.rank > 1 && g.bag && !((P[g.bag] || {})[k] > 0)) continue;
          up(g.bag, k, g.rank, 'upgrade');
        }
        const covered = (it.d.rules || []).some((r) => r.foundry && (r.foundry.key === 'MartialProficiency' || /\.rank$/.test(r.foundry.path || '')));
        if (!covered) for (const u of unread) unsupported.push({ from: `${it.d.name} (class feature)`, rule: 'text', why: `a proficiency gain for "${u}": the player says what it applies to` });
      }
      for (const r of it.d.rules || []) {
        const fr = r.key === 'unsupported' ? r.foundry : null;
        if (!fr || !BUILD_RULES.includes(fr.key)) continue;
        if (run(it, fr) === 'wait') waiting.push({ it, fr });
      }
    }
    // rules waiting on a flag: run those whose flag has come; stop when none moves
    const before = waiting.length;
    for (const w of waiting.splice(0)) if (run(w.it, w.fr) === 'wait') waiting.push(w);
    if (!queue.length && waiting.length === before) break;
  }
  for (const w of waiting) unsupported.push({ from: `${w.it.d.name} (${w.it.from})`, rule: w.fr.key, why: `it waits on ${w.fr.uuid || w.fr.path}, which nothing set` });
  // ranks written as formulas ("the same as your unarmed attacks"), in order, after everything else
  for (const { where, fr, target } of formulas) {
    const v = rankFormula(fr.value, L, rankAt);
    if (v === null) unsupported.push({ from: where, rule: fr.key, why: `a rank the builder cannot work out: ${JSON.stringify(fr.value)}` });
    else if (target[0] === 'languages') langExtra += v;
    else up(target[0], target[1], v, fr.mode);
  }
  // skill increases (after the rules: a skill the class's own choice trains is increased from trained), and the
  // skills an Intelligence increase adds
  for (const lv of ((cls && cls.skillIncreaseLevels) || []).filter((x) => x <= L)) {
    const s = (levels[lv] || {}).skillIncrease;
    if (!s) { need(lv, 'skillIncrease', `Choose a skill to increase at level ${lv}.`); continue; }
    const [bag, name] = s.startsWith('lore:') ? [P.lore, loreSlug(s.slice(5))] : [P.skills, s];
    const now = bag[name] || 0;
    if (now + 1 > maxSkillRank(lv)) problems.push(`level ${lv}: ${s} cannot go above ${['untrained', 'trained', 'expert', 'master', 'legendary'][maxSkillRank(lv)]} yet`);
    else bag[name] = now + 1;
  }
  for (const [lv, d] of Object.entries(levels)) {
    const got = ((d && d.trained) || []);
    if (got.length > (intGains[lv] || 0)) problems.push(`level ${lv}: ${got.length} skill${got.length > 1 ? 's' : ''} trained for an Intelligence increase, ${intGains[lv] || 0} allowed`);
    for (const sk of got) {
      if (!SKILLS.includes(sk)) problems.push(`level ${lv}: ${sk} is not a skill`);
      else if (P.skills[sk]) problems.push(`level ${lv}: ${sk} is trained already (choose another skill)`);
      else P.skills[sk] = 1;
    }
  }
  for (const [lv, n] of Object.entries(intGains)) {
    const left = n - (((levels[lv] || {}).trained) || []).length;
    if (left > 0) need(Number(lv), 'trained', `Intelligence went up: choose ${left} more skill${left > 1 ? 's' : ''} to become trained in.`);
  }

  // ---- languages: the ancestry's, those rules grant, and the player's picks (section 9.7) ----
  const langs = [...new Set(['common', ...((anc && anc.languages) || []), ...langGranted])];
  const offered = new Set([...LANGUAGES.common, ...(((anc && anc.additionalLanguages) || {}).choices || [])]);
  const approved = new Set((b.approvals || []).map((x) => x.what));
  const pickLang = (lv, list, allowed) => {
    for (const l of list || []) {
      const r = languageRarity(l);
      if (!r) { problems.push(`level ${lv}: ${l} is not a language`); continue; }
      if (langs.includes(l)) { problems.push(`${l} is known already (choose another language)`); continue; }
      if (r === 'secret') { problems.push(`${l} is a secret language: no character learns it by choosing`); continue; }
      if (!offered.has(l) && !approved.has(`language:${l}`)) problems.push(`${l} is ${r === 'rare' ? 'a rare' : 'an uncommon'} language: it needs the GM's leave (approvals "language:${l}")`);
      langs.push(l);
    }
    const n = (list || []).length;
    if (n > allowed) problems.push(`level ${lv}: ${n} languages chosen, ${allowed} allowed`);
    if (n < allowed) need(lv, 'languages', `Choose ${allowed - n} more language${allowed - n > 1 ? 's' : ''} (common ones freely, or the ${anc ? anc.name.toLowerCase() + '\'s' : 'ancestry\'s'} list; others with the GM's leave).`);
  };
  if (anc) pickLang(1, b.languages, (((anc.additionalLanguages || {}).count) || 0) + Math.max(0, intAt1) + langExtra);
  for (const [lv, n] of Object.entries(intGains)) pickLang(Number(lv), (levels[lv] || {}).languages, n);

  for (const k of Object.keys(P.spellcasting)) if (!P.spellcasting[k]) delete P.spellcasting[k];
  if (!Object.keys(P.spellcasting).length) delete P.spellcasting;

  const actor = {
    system: 'pf2e', kind: 'character', name: b.name || 'New character', level: L,
    ancestry: anc ? { name: anc.name, hp: anc.hp || 0, size: anc.size || 'medium', speed: anc.speed || 25, traits: [...(anc.traits || [])], senses: anc.vision && anc.vision !== 'normal' ? [anc.vision] : [] }
      : { name: '?', hp: 0, speed: 25 },
    ...(her ? { heritage: her.name } : {}),
    ...(bg ? { background: bg.name } : {}),
    class: cls ? { name: cls.name, hp: cls.hp || 0, keyAttribute: key || (cls.keyAttribute || [])[0] || 'str' } : { name: '?', hp: 0, keyAttribute: 'str' },
    attributes: mods,
    proficiencies: P,
    // each feature with its rules, so the engine runs them (Juggernaut's better saves); the name alone where the
    // content has no document for it
    features: features.map((sl) => featureDocs.get(sl) || sl),
    feats,
    traits: anc ? [...(anc.traits || [])] : [],
    languages: langs,
    ...(casting && casting.tradition ? { spellcasting: casting } : {}),
    ...(granted.length ? { granted } : {}),
    build: b,
  };
  // ---- prerequisites of the feats the player chose (section 9.7), against the character as built: exact for the
  // feats of its newest level, which is when a choice is made ----
  const checks = [];
  const pf = { ...prereqFacts(actor, b), knownNames: opts.knownNames };
  for (const f of feats.filter((x) => !['granted', 'background'].includes(x.slot))) {
    const r = prereqCheck(get(f.ref), { ...pf, names: new Set([...pf.names].filter((n) => n !== f.name.toLowerCase())) });
    for (const p of r.unmet) problems.push(`${f.name} (level ${f.level} ${f.slot} feat): prerequisite not met: ${p}`);
    for (const p of r.unread) checks.push({ feat: f.name, level: f.level, prerequisite: p });
  }
  return { actor, pending, problems, unsupported, checks };
}
