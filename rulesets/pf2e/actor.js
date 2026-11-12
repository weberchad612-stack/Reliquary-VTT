// Pathfinder 2E creatures: every statistic computed from a character's build (attributes, proficiency ranks,
// level, items) or a creature's printed stat block, then adjusted by its feats, items, effects and conditions
// through the engine's rules (engine/rules). Nothing computed here is stored. Rules from Player Core (ORC),
// paraphrased. Docs: docs/design/game-data.md.

import { collectRules, makeStatistic, modifiersFor } from '../../engine/rules/rules.js';
import { ATTRIBUTES, ATTRIBUTE_NAMES, SKILLS, SAVES, RANKS, stacks, proficiency, CONDITION_RULES, activeConditions, healthBand } from './rules.js';

const sign = (v) => (v < 0 ? `${v}` : `+${v}`);
const rankName = (r) => RANKS[r] || 'untrained';
const attrSel = (a) => `${a}-based`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
/** A Strike's own selector stem: its slug, or its name in lower case with dashes (jaws: jaws-attack, jaws-damage). */
const slugOf = (w) => w.slug || String(w.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** An item of a character: a reference into the content ({ref: 'item/longsword', ...own}) or written in full. */
function resolveItem(it, content) {
  if (!it.ref) return it;
  const base = content[it.ref];
  if (!base) throw new Error(`no content "${it.ref}"`);
  const { ref: _r, ...own } = it;
  return { ...base, ...own, runes: { ...(base.runes || {}), ...(own.runes || {}) } };
}

/** The rule sources of a creature: its feats, features, items (equipped ones), own rules, effects and conditions. */
function ruleSources(data, effects, items) {
  const out = [];
  for (const f of [...(data.feats || []), ...(data.features || []).filter((x) => typeof x === 'object')]) out.push({ origin: { kind: 'feat', id: f.slug || f.name, label: f.name }, rules: f.rules || [] });
  for (const it of items) if (it.rules && it.equipped !== false) out.push({ origin: { kind: 'item', id: it.slug || it.name, label: it.name }, rules: it.rules });
  if (data.rules) out.push({ origin: { kind: 'creature', id: data.slug || 'own', label: data.name }, rules: data.rules });
  for (const e of effects || []) if (e && !e.id && e.rules) out.push({ origin: { kind: 'effect', id: e.name, label: e.name }, value: e.value, rules: e.rules });
  for (const c of activeConditions(effects)) {
    const def = CONDITION_RULES[c.id];
    if (def && def.rules) out.push({ origin: { kind: 'condition', id: c.id, label: c.value ? `${cap(c.id)} ${c.value}` : cap(c.id) }, value: c.value, rules: def.rules });
  }
  return out;
}

/** Selectors a statistic answers to (its own, its attribute's, broader ones). */
const SEL = {
  ac: ['ac', 'all', 'dex-based'],
  save: (s) => [s, 'saving-throw', attrSel(SAVES[s]), 'all'],
  perception: ['perception', 'wis-based', 'all'],
  skill: (s) => [s, 'skill-check', attrSel(SKILLS[s]), 'all'],
  lore: (l) => [`${l}-lore`, 'lore', 'skill-check', 'int-based', 'all'],
};

/**
 * Prepare a PF2E creature: {kind, name, level, attributes, hp: {max, value, temp}, ac, saves, perception,
 * skills, classDC, spell, strikes, speeds, senses, iwr, conditions, notes, band, dying..., problems}.
 * Statistics come as engine statistics (value plus breakdown). `ctx.content` resolves item references.
 */
export function preparePf2e(data, state = {}, effects = [], ctx = {}) {
  const content = ctx.content || {}, isPc = data.kind === 'character', level = data.level ?? 0;
  const problems = [];
  const items = (data.items || []).map((it) => { try { return resolveItem(it, content); } catch (e) { problems.push(e.message); return null; } }).filter(Boolean);
  const rules = collectRules(ruleSources(data, effects, items), { level });
  for (const u of rules.unknown) problems.push(`${u.origin.label}: unknown rule "${u.rule.key}"`);
  for (const e of rules.errors) problems.push(`${e.origin.label}: ${e.error}`);
  const unsupported = rules.skipped.map((x) => `${x.origin.label}: ${x.rule.foundry.key || 'rule'}`);
  const conds = activeConditions(effects);
  const tags = new Set([...(data.traits || []), ...conds.map((c) => c.id), ...(state.tags || [])]);
  const stat = (o) => makeStatistic({ ...o, modifiers: [...(o.modifiers || []), ...modifiersFor(rules.modifiers, o.selectors)], tags, stacks });
  const attrs = isPc ? { ...Object.fromEntries(ATTRIBUTES.map((a) => [a, 0])), ...(data.attributes || {}) } : { ...Object.fromEntries(ATTRIBUTES.map((a) => [a, 0])), ...((data.stats || {}).attributes || {}) };
  const out = { kind: data.kind, name: data.name, level, traits: data.traits || [], size: data.size || (data.ancestry || {}).size || 'medium', attributes: attrs, problems };

  // ---- armour and shield (characters) ----
  const armor = items.find((i) => i.kind === 'armor' && i.equipped !== false) || null;
  const shield = items.find((i) => i.kind === 'shield' && i.equipped !== false) || null;
  const meetsStr = !armor || !armor.strength || attrs.str >= armor.strength;

  if (isPc) {
    const P = data.proficiencies || {};
    const pr = (rank) => proficiency(rank || 0, level);
    const profPart = (rank, what = 'proficiency') => ({ label: `${what} (${rankName(rank || 0)})`, value: pr(rank) });
    // AC: 10 + Dexterity (capped by armour) + proficiency in the armour's category + the armour's item bonus
    const cat = armor ? armor.category : 'unarmored', dexCap = armor && armor.dexCap !== undefined ? armor.dexCap : Infinity;
    const dex = Math.min(attrs.dex, dexCap), armRank = (P.armor || {})[cat] || 0;
    const acMods = [];
    if (armor) acMods.push({ slug: 'armor', label: armor.name, type: 'item', value: (armor.acBonus || 0) + ((armor.runes || {}).potency || 0) });
    if (shield && state.shieldRaised) acMods.push({ slug: 'shield', label: `${shield.name} raised`, type: 'circumstance', value: shield.acBonus || 0 });
    out.ac = stat({ slug: 'ac', label: 'AC', base: 10 + dex + pr(armRank), parts: [{ label: 'base', value: 10 }, { label: `Dexterity${dex < attrs.dex ? ` (capped at ${dexCap})` : ''}`, value: dex }, profPart(armRank, `${cat} armour`)], modifiers: acMods, selectors: SEL.ac });
    // saves, Perception
    const resilient = armor ? (armor.runes || {}).resilient || 0 : 0;
    out.saves = Object.fromEntries(Object.entries(SAVES).map(([s, a]) => [s, stat({
      slug: s, label: cap(s), base: attrs[a] + pr(P[s]), parts: [{ label: ATTRIBUTE_NAMES[a], value: attrs[a] }, profPart(P[s])],
      modifiers: resilient ? [{ slug: 'resilient', label: 'resilient rune', type: 'item', value: resilient }] : [], selectors: SEL.save(s),
    })]));
    out.perception = stat({ slug: 'perception', label: 'Perception', base: attrs.wis + pr(P.perception), parts: [{ label: 'Wisdom', value: attrs.wis }, profPart(P.perception)], selectors: SEL.perception });
    // skills (armour check penalty to Strength and Dexterity skills when the Strength is not met; flexible
    // armour spares Acrobatics and Athletics; noisy armour always penalises Stealth)
    const traitsOf = (i) => (i && i.traits) || [];
    out.skills = {};
    for (const [s, a] of Object.entries(SKILLS)) {
      const rank = (P.skills || {})[s] || 0, mods = [];
      const acp = armor && armor.checkPenalty && (a === 'str' || a === 'dex')
        && (!meetsStr || (s === 'stealth' && traitsOf(armor).includes('noisy'))) && !(traitsOf(armor).includes('flexible') && (s === 'acrobatics' || s === 'athletics'));
      if (acp) mods.push({ slug: 'armor-check-penalty', label: 'armour check penalty', type: 'untyped', value: armor.checkPenalty });
      out.skills[s] = stat({ slug: s, label: cap(s), base: attrs[a] + pr(rank), parts: [{ label: ATTRIBUTE_NAMES[a], value: attrs[a] }, profPart(rank)], modifiers: mods, selectors: SEL.skill(s) });
    }
    out.lore = Object.fromEntries(Object.entries(P.lore || {}).map(([l, rank]) => [l, stat({ slug: `${l}-lore`, label: `${cap(l)} Lore`, base: attrs.int + pr(rank), parts: [{ label: 'Intelligence', value: attrs.int }, profPart(rank)], selectors: SEL.lore(l) })]));
    // class DC and spellcasting
    const key = (data.class || {}).keyAttribute || 'str';
    out.classDC = stat({ slug: 'class-dc', label: 'Class DC', base: 10 + attrs[key] + pr(P.classDC), parts: [{ label: 'base', value: 10 }, { label: ATTRIBUTE_NAMES[key], value: attrs[key] }, profPart(P.classDC)], selectors: ['class-dc', attrSel(key), 'all'] });
    if (data.spellcasting) {
      const sa = data.spellcasting.attribute, rank = (P.spellcasting || {})[data.spellcasting.tradition] || 0;
      out.spell = {
        tradition: data.spellcasting.tradition,
        attack: stat({ slug: 'spell-attack', label: 'Spell attack', base: attrs[sa] + pr(rank), parts: [{ label: ATTRIBUTE_NAMES[sa], value: attrs[sa] }, profPart(rank)], selectors: ['spell-attack-roll', 'attack-roll', attrSel(sa), 'all'] }),
        dc: stat({ slug: 'spell-dc', label: 'Spell DC', base: 10 + attrs[sa] + pr(rank), parts: [{ label: 'base', value: 10 }, { label: ATTRIBUTE_NAMES[sa], value: attrs[sa] }, profPart(rank)], selectors: ['spell-dc', attrSel(sa), 'all'] }),
      };
    }
    // strikes: every weapon held, and a fist
    const weapons = items.filter((i) => i.kind === 'weapon' && i.equipped !== false);
    const fist = { name: 'Fist', slug: 'fist', kind: 'weapon', category: 'unarmed', damage: { dice: 1, die: 'd4', type: 'bludgeoning' }, traits: ['agile', 'finesse', 'nonlethal', 'unarmed'] };
    const feats = (data.features || []).filter((x) => typeof x === 'string');
    out.strikes = [...weapons, ...(weapons.some((w) => w.category === 'unarmed') ? [] : [fist])].map((w) => characterStrike(w, { attrs, P, level, stat, feats }));
    // speed: the ancestry's, less the armour's penalty (5 feet less when its Strength is met)
    const anc = data.ancestry || {};
    const spMods = [];
    if (armor && armor.speedPenalty) { const pen = meetsStr ? Math.min(0, armor.speedPenalty + 5) : armor.speedPenalty; if (pen) spMods.push({ slug: 'armor-speed', label: `${armor.name} speed penalty`, type: 'untyped', value: pen }); }
    out.speeds = { land: stat({ slug: 'land-speed', label: 'Speed', base: anc.speed || 25, parts: [{ label: `${anc.name || 'ancestry'} speed`, value: anc.speed || 25 }], modifiers: spMods, selectors: ['land-speed', 'all-speeds'], floor: 5 }) };
    for (const s of rules.speeds) out.speeds[s.type] = stat({ slug: `${s.type}-speed`, label: `${cap(s.type)} Speed`, base: s.value, parts: [{ label: s.origin.label, value: s.value }], selectors: [`${s.type}-speed`, 'all-speeds'], floor: 5 });
    // HP: ancestry + (class + Constitution) per level
    const ancHp = anc.hp || 0, clsHp = (data.class || {}).hp || 0;
    out.hp = { max: stat({ slug: 'hp', label: 'Max HP', base: ancHp + (clsHp + attrs.con) * level, parts: [{ label: `${anc.name || 'ancestry'}`, value: ancHp }, { label: `(${(data.class || {}).name || 'class'} ${clsHp} + Constitution ${sign(attrs.con)}) × level ${level}`, value: (clsHp + attrs.con) * level }], selectors: ['hp'], floor: 1 }) };
    out.senses = [...(anc.senses || []).map((s) => (typeof s === 'string' ? { type: s } : s)), ...rules.senses];
    out.iwr = { immunities: rules.immunities, weaknesses: rules.weaknesses, resistances: rules.resistances };
    out.resources = data.resources || {};
    out.shield = shield ? { name: shield.name, acBonus: shield.acBonus, hardness: shield.hardness, maxHp: shield.hp, brokenAt: shield.brokenAt ?? Math.floor((shield.hp || 0) / 2), hp: (state.shield || {}).hp ?? shield.hp, raised: !!state.shieldRaised } : null;
  } else {
    // a creature: its printed statistics, adjusted by its conditions
    const S = data.stats || {};
    const printed = (slug, label, v, selectors) => stat({ slug, label, base: v ?? 0, parts: [{ label: 'stat block', value: v ?? 0 }], selectors });
    out.ac = printed('ac', 'AC', S.ac, SEL.ac);
    out.saves = Object.fromEntries(Object.keys(SAVES).map((s) => [s, printed(s, cap(s), (S.saves || {})[s], SEL.save(s))]));
    out.perception = printed('perception', 'Perception', S.perception, SEL.perception);
    out.skills = {};
    for (const s of Object.keys(SKILLS)) {
      const v = (S.skills || {})[s];
      out.skills[s] = printed(s, cap(s), v === undefined ? attrs[SKILLS[s]] : typeof v === 'object' ? v.value : v, SEL.skill(s));
    }
    out.strikes = (data.items || []).filter((i) => i.kind === 'strike').map((w) => creatureStrike(w, { stat, attrs }));
    out.speeds = {};
    for (const [t, v] of Object.entries(S.speeds || { land: 25 })) out.speeds[t] = stat({ slug: `${t}-speed`, label: t === 'land' ? 'Speed' : `${cap(t)} Speed`, base: v, parts: [{ label: 'stat block', value: v }], selectors: [`${t}-speed`, 'all-speeds'], floor: 5 });
    out.hp = { max: stat({ slug: 'hp', label: 'Max HP', base: S.hp || 1, parts: [{ label: 'stat block', value: S.hp || 1 }], selectors: ['hp'], floor: 1 }) };
    out.senses = [...(S.senses || []), ...rules.senses];
    const iwr = S.iwr || {};
    out.iwr = { immunities: [...(iwr.immunities || []).map((t) => (typeof t === 'string' ? { type: t } : t)), ...rules.immunities], weaknesses: [...(iwr.weaknesses || []), ...rules.weaknesses], resistances: [...(iwr.resistances || []), ...rules.resistances] };
    out.abilities = (data.items || []).filter((i) => i.kind === 'ability');
    out.resources = data.resources || {};
  }
  // live state
  const max = out.hp.max.value;
  out.hp.value = Math.max(0, Math.min(max, state.hp ?? max));
  out.hp.temp = state.temp || 0;
  out.conditions = conds;
  const dying = conds.find((c) => c.id === 'dying'), doomed = conds.find((c) => c.id === 'doomed');
  out.dying = { value: dying ? dying.value : 0, max: 4 - (doomed ? doomed.value : 0) };
  out.wounded = (conds.find((c) => c.id === 'wounded') || {}).value || 0;
  out.notes = rules.notes;
  out.unsupported = unsupported;   // imported rules not run yet: Claude applies them by hand
  out.usesDying = isPc || !!data.usesDying;
  out.band = healthBand(out.hp.value, max, !!state.dead);
  return out;
}

/** A character's Strike with a weapon: attack bonus (with the multiple attack penalty) and damage. */
function characterStrike(w, { attrs, P, level, stat, feats }) {
  const traits = w.traits || [], ranged = !!w.range && !traits.includes('thrown'), thrown = traits.includes('thrown');
  const finesse = traits.includes('finesse');
  const atkAttr = ranged ? 'dex' : finesse && attrs.dex > attrs.str ? 'dex' : 'str';
  const rank = (P.weapons || {})[w.category || 'simple'] || 0;
  const potency = (w.runes || {}).potency || 0, striking = (w.runes || {}).striking || 0;
  const mods = potency ? [{ slug: 'potency', label: 'potency rune', type: 'item', value: potency }] : [];
  const attack = stat({
    slug: `${w.slug || w.name}-attack`, label: `${w.name} attack`, base: attrs[atkAttr] + proficiency(rank, level),
    parts: [{ label: ATTRIBUTE_NAMES[atkAttr], value: attrs[atkAttr] }, { label: `proficiency (${rankName(rank)})`, value: proficiency(rank, level) }],
    modifiers: mods, selectors: ['attack-roll', 'strike-attack-roll', ranged ? 'ranged-attack-roll' : 'melee-attack-roll', attrSel(atkAttr), 'all', `${slugOf(w)}-attack`],
  });
  const agile = traits.includes('agile');
  // damage: dice (one, more with a striking rune), Strength for melee and thrown weapons (half for propulsive), weapon specialization
  const dmgAttr = !ranged || thrown ? attrs.str : traits.includes('propulsive') ? (attrs.str > 0 ? Math.floor(attrs.str / 2) : attrs.str) : 0;
  const spec = feats.includes('weapon-specialization') && rank >= 2 ? [0, 0, 2, 3, 4][rank] * (feats.includes('greater-weapon-specialization') ? 2 : 1) : 0;
  const dmgMods = spec ? [{ slug: 'weapon-specialization', label: 'weapon specialization', type: 'untyped', value: spec }] : [];
  const damage = stat({
    slug: `${w.slug || w.name}-damage`, label: `${w.name} damage`, base: dmgAttr, parts: dmgAttr ? [{ label: 'Strength', value: dmgAttr }] : [],
    modifiers: dmgMods, selectors: ['damage', 'strike-damage', ...(dmgAttr ? ['str-damage'] : []), `${slugOf(w)}-damage`],
  });
  const dice = 1 + striking, d = w.damage || { die: 'd4', type: 'bludgeoning' };
  return { name: w.name, slug: w.slug || w.name, traits, ranged, range: w.range || null, attack, map: agile ? [0, -4, -8] : [0, -5, -10], damage: { dice, die: d.die, type: d.type, bonus: damage, formula: `${dice}${d.die}${damage.value ? sign(damage.value) : ''} ${d.type}` } };
}

/** A creature's Strike as printed: attack bonus, damage formula; conditions adjust the attack (and damage). */
function creatureStrike(w, { stat }) {
  const traits = w.traits || [], ranged = !!w.range;
  const attr = ranged || traits.includes('finesse') ? 'dex' : 'str';
  const attack = stat({ slug: `${w.slug || w.name}-attack`, label: `${w.name} attack`, base: w.attack || 0, parts: [{ label: 'stat block', value: w.attack || 0 }], selectors: ['attack-roll', 'strike-attack-roll', ranged ? 'ranged-attack-roll' : 'melee-attack-roll', attrSel(attr), 'all', `${slugOf(w)}-attack`] });
  const extra = stat({ slug: `${w.slug || w.name}-damage`, label: `${w.name} damage`, base: 0, parts: [], selectors: ['damage', 'strike-damage', ...(attr === 'str' ? ['str-damage'] : []), `${slugOf(w)}-damage`] });
  const agile = traits.includes('agile');
  const formula = (w.damage || []).map((d) => `${d.dice} ${d.type}`).join(' plus ') + (extra.value ? ` ${sign(extra.value)}` : '');
  return { name: w.name, slug: w.slug || w.name, traits, ranged, range: w.range || null, attack, map: agile ? [0, -4, -8] : [0, -5, -10], damage: { parts: w.damage || [], bonus: extra, formula }, effects: w.effects || [] };
}
