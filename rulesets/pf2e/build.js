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
//    approvals: [{what, by, at}] (uncommon and rare options the GM allowed), name, details}

export const ATTRIBUTES = Object.freeze(['str', 'dex', 'con', 'int', 'wis', 'cha']);
export const SKILLS = Object.freeze(['acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy', 'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion', 'society', 'stealth', 'survival', 'thievery']);
export const BOOST_LEVELS = Object.freeze([5, 10, 15, 20]);
/** Renamed legacy options a remastered one replaces (by content key): none found yet (section 9.1). */
export const SUPERSEDED = Object.freeze({});

const slug = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const loreSlug = (s) => slug(String(s || '').replace(/\blore\b/i, ''));
const isFree = (opts) => ATTRIBUTES.every((a) => opts.includes(a));

/** An ancestry's or background's boost slots: [{options, fixed}] (a single option is fixed; all six is free). */
export function boostSlots(doc) {
  return ((doc && doc.boosts) || []).map((o) => ({ options: o.slice(), fixed: o.length === 1 ? o[0] : null, free: isFree(o) }));
}

/** The highest rank a skill may reach at a level (expert from 1, master from 7, legendary from 15). */
export const maxSkillRank = (level) => (level >= 15 ? 4 : level >= 7 ? 3 : 2);

/**
 * The character a build makes. get(key) -> content document (or undefined).
 * @returns {{actor: object, pending: Array<{level, step, text}>, problems: string[]}}
 */
export function deriveCharacter(build, get) {
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
    if (!key) need(1, 'keyAttribute', `Choose the ${cls.name.toLowerCase()}'s key attribute (${ka.join(' or ')}).`);
    else if (!ka.includes(key)) problems.push(`key attribute ${key} is not one of the ${cls.name}'s (${ka.join(', ')})`);
    else raise(key, 1);
  }
  for (const a of boostSet('free', Array.from({ length: 4 }, () => ({ options: [...ATTRIBUTES], free: true })), (b.boosts || {}).free, 1)) raise(a, 1);
  const levels = b.levels || {};
  const intAt1 = mods.int;
  for (const lv of BOOST_LEVELS.filter((x) => x <= L)) {
    const picks = boostSet(`level ${lv}`, Array.from({ length: 4 }, () => ({ options: [...ATTRIBUTES], free: true })), (levels[lv] || {}).boosts, lv);
    for (const a of picks) raise(a, lv);
  }

  // ---- proficiencies ----
  const P = { perception: 0, fortitude: 0, reflex: 0, will: 0, classDC: 0, armor: {}, weapons: {}, skills: {}, lore: {} };
  if (cls) {
    P.perception = cls.perception || 0;
    for (const s of ['fortitude', 'reflex', 'will']) P[s] = (cls.saves || {})[s] || 0;
    P.classDC = 1;
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
  // skill increases, and the skills an Intelligence increase adds
  for (const lv of ((cls && cls.skillIncreaseLevels) || []).filter((x) => x <= L)) {
    const s = (levels[lv] || {}).skillIncrease;
    if (!s) { need(lv, 'skillIncrease', `Choose a skill to increase at level ${lv}.`); continue; }
    const [bag, name] = s.startsWith('lore:') ? [P.lore, loreSlug(s.slice(5))] : [P.skills, s];
    const now = bag[name] || 0;
    if (now + 1 > maxSkillRank(lv)) problems.push(`level ${lv}: ${s} cannot go above ${['untrained', 'trained', 'expert', 'master', 'legendary'][maxSkillRank(lv)]} yet`);
    else bag[name] = now + 1;
  }
  for (const [lv, d] of Object.entries(levels)) for (const s of (d && d.trained) || []) P.skills[s] = Math.max(P.skills[s] || 0, 1);

  // ---- features and feats ----
  const features = cls ? (cls.features || []).filter((f) => f.level <= L).map((f) => (f.ref ? f.ref.split('/').pop() : slug(f.name))) : [];
  const feats = [];
  const featOf = (k, level, slot) => {
    const d = get(k);
    if (!d) { problems.push(`${slot} feat ${k} is not in the content`); return; }
    if (d.level && d.level > level) problems.push(`${d.name} is a level ${d.level} feat, taken at level ${level}`);
    feats.push({ name: d.name, slug: d.slug, ref: k, level, slot, ...(d.rules && d.rules.length ? { rules: d.rules } : {}) });
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

  const actor = {
    system: 'pf2e', kind: 'character', name: b.name || 'New character', level: L,
    ancestry: anc ? { name: anc.name, hp: anc.hp || 0, size: anc.size || 'medium', speed: anc.speed || 25, traits: [...(anc.traits || [])], senses: anc.vision && anc.vision !== 'normal' ? [anc.vision] : [] }
      : { name: '?', hp: 0, speed: 25 },
    ...(her ? { heritage: her.name } : {}),
    ...(bg ? { background: bg.name } : {}),
    class: cls ? { name: cls.name, hp: cls.hp || 0, keyAttribute: key || (cls.keyAttribute || [])[0] || 'str' } : { name: '?', hp: 0, keyAttribute: 'str' },
    attributes: mods,
    proficiencies: P,
    features,
    feats,
    traits: anc ? [...(anc.traits || [])] : [],
    build: b,
  };
  return { actor, pending, problems };
}
