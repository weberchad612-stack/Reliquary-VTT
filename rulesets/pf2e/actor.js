// Pathfinder 2E creatures: every statistic computed from a character's build (attributes, proficiency ranks,
// level, items) or a creature's printed stat block, then adjusted by its feats, items, effects and conditions
// through the engine's rules (engine/rules). Nothing computed here is stored. Rules from Player Core (ORC),
// paraphrased. Docs: docs/design/game-data.md.

import { collectRules, makeStatistic, modifiersFor, testPredicate } from '../../engine/rules/rules.js';
import { ATTRIBUTES, ATTRIBUTE_NAMES, SKILLS, SAVES, RANKS, stacks, proficiency, CONDITION_RULES, activeConditions, healthBand } from './rules.js';
import { PF2E_RULE_HANDLERS } from './rule-keys.js';
import { inUse } from './loot.js';

const SIZE_ORDER = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
/** Squares a creature of a size takes up across (tiny and small share a square). */
export const sizeSquares = (size) => ({ tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 }[size] || 1);

const sign = (v) => (v < 0 ? `${v}` : `+${v}`);
const rankName = (r) => RANKS[r] || 'untrained';
const attrSel = (a) => `${a}-based`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
/** A Strike's own selector stem: its slug, or its name in lower case with dashes (jaws: jaws-attack, jaws-damage). */
const slugOf = (w) => w.slug || String(w.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** An item of a character: a reference into the content ({ref: 'item/longsword', ...own}) or written in full. */
// a stat block's own entries (its strikes, abilities, spells, gear) may name content too; that is a note, not a use
const STAT_BLOCK_ENTRIES = new Set(['strike', 'ability', 'spell', 'spellcasting', 'gear']);
function resolveItem(it, content) {
  if (!it.ref || STAT_BLOCK_ENTRIES.has(it.kind)) return it;
  const base = content[it.ref];
  if (!base) throw new Error(`no content "${it.ref}"`);
  const { ref: _r, ...own } = it;
  return { ...base, ...own, runes: { ...(base.runes || {}), ...(own.runes || {}) } };
}

/**
 * The rule sources of a creature: its feats, features, items (equipped ones), own rules, effects and conditions.
 * Each with its level (@itemLevel in a rule's value). An effect on the token may name an effect document in the
 * content ({name, ref, level}: Spell Effect: Heroism at rank 6): its rules apply at that level.
 */
function ruleSources(data, effects, items, content, problems) {
  const out = [];
  for (const f of [...(data.feats || []), ...(data.features || []).filter((x) => typeof x === 'object')]) out.push({ origin: { kind: 'feat', id: f.slug || f.name, label: f.name, ...(f.text ? { text: f.text } : {}) }, level: f.level, rules: f.rules || [] });
  for (const it of items) if (it.rules && inUse(it)) out.push({ origin: { kind: 'item', id: it.slug || it.name, label: it.name }, level: it.level, rules: it.rules });
  if (data.rules) out.push({ origin: { kind: 'creature', id: data.slug || 'own', label: data.name }, rules: data.rules });
  for (const e of effects || []) {
    if (!e || e.id) continue;
    if (e.ref) {
      const doc = content[e.ref];
      if (!doc) { problems.push(`${e.name || e.ref}: no content "${e.ref}"`); continue; }
      const label = `${e.name || doc.name}${e.level !== undefined ? ` (level ${e.level})` : ''}`;
      out.push({ origin: { kind: 'effect', id: e.ref, label, ...(doc.text ? { text: doc.text } : {}) }, value: e.value, level: e.level ?? doc.level, rules: doc.rules || [] });
    } else if (e.rules) out.push({ origin: { kind: 'effect', id: e.name, label: e.name }, value: e.value, level: e.level, rules: e.rules });
  }
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
  const first = prepareOnce(data, state, effects, ctx, null);
  if (!first.usesHpFacts) return first;
  // a rule depends on how hurt the creature is ("while below half HP"): prepare again knowing its HP
  const max = first.hp.max.value, hp = first.hp.value;
  return prepareOnce(data, state, effects, ctx, { 'hp-remaining': hp, 'hp-percent': max ? Math.floor((hp / max) * 100) : 0 });
}

/** The numbers a rule's condition can compare (testPredicate's facts). */
function factsOf(level, conds, hpFacts) {
  const f = { 'self:level': level, ...(hpFacts || {}) };
  for (const c of conds) f[`self:condition:${c.id}`] = c.value || 1;
  return f;
}

function prepareOnce(data, state, effects, ctx, hpFacts) {
  const content = ctx.content || {}, isPc = data.kind === 'character', level = data.level ?? 0;
  const problems = [];
  const items = (data.items || []).map((it) => { try { return resolveItem(it, content); } catch (e) { problems.push(e.message); return null; } }).filter(Boolean);
  const rules = collectRules(ruleSources(data, effects, items, content, problems), { level }, PF2E_RULE_HANDLERS);
  for (const k of ['options', 'traitChanges', 'sizes', 'damageDice', 'strikeTraits', 'grantedStrikes', 'degree', 'rollTwice', 'mapRules', 'critSpec', 'ephemeral', 'tempHp', 'fastHealing', 'auras', 'lights', 'grantsConditions']) rules[k] = rules[k] || [];
  for (const u of rules.unknown) problems.push(`${u.origin.label}: unknown rule "${u.rule.key}"`);
  for (const e of rules.errors) problems.push(`${e.origin.label}: ${e.error}`);
  const unsupported = rules.skipped.map((x) => `${x.origin.label}: ${x.rule.foundry.key || 'rule'}`);
  const conds = activeConditions(effects);
  // what holds now, in our words and in Foundry's (its rules test "self:condition:frightened", "self:trait:undead")
  const traitList = [...(data.traits || [])];
  const tags = new Set([...traitList, ...conds.map((c) => c.id), ...(state.tags || [])]);
  for (const t of traitList) tags.add(`self:trait:${t}`);
  for (const c of conds) tags.add(`self:condition:${c.id}`);
  for (const e of effects || []) if (e && e.ref) { const slug = e.ref.split('/').pop(); tags.add(`self:effect:${slug}`); tags.add(`self:effect:${slug.replace(/^(spell-|feat-|equipment-|bestiary-|other-|stance-|aura-)?effect-/, '')}`); }
  const facts = factsOf(level, conds, hpFacts);
  const holds = (x) => testPredicate(x.when, tags, facts);
  // roll options: always-on ones hold when their condition does; switches hold when Claude (or the sheet) turns
  // them on (the live state's tags) or by default
  const off = new Set((state.tags || []).filter((t) => t.startsWith('!')).map((t) => t.slice(1)));
  const options = [];
  for (const o of rules.options) {
    if (!holds(o)) continue;
    const on = o.toggleable ? (tags.has(o.option) || (o.default && !off.has(o.option))) : true;
    if (on) tags.add(o.option);
    if (o.toggleable && !options.some((x) => x.option === o.option)) options.push({ option: o.option, label: o.label, on, from: o.origin.label });
  }
  // traits gained and lost
  for (const t of rules.traitChanges.filter(holds)) { for (const a of t.add) if (!traitList.includes(a)) { traitList.push(a); tags.add(a); tags.add(`self:trait:${a}`); } for (const r of t.remove) { const i = traitList.indexOf(r); if (i >= 0) traitList.splice(i, 1); } }
  // resistances, weaknesses, immunities, speeds and senses granted only sometimes ("while raging")
  for (const k of ['resistances', 'weaknesses', 'immunities', 'speeds', 'senses']) rules[k] = rules[k].filter(holds);
  const stat = (o) => makeStatistic({ ...o, modifiers: [...(o.modifiers || []), ...modifiersFor(rules.modifiers, o.selectors)], tags, facts, stacks });
  const attrs = isPc ? { ...Object.fromEntries(ATTRIBUTES.map((a) => [a, 0])), ...(data.attributes || {}) } : { ...Object.fromEntries(ATTRIBUTES.map((a) => [a, 0])), ...((data.stats || {}).attributes || {}) };
  const sized = rules.sizes.filter(holds).map((s) => s.value).filter((s) => SIZE_ORDER.includes(s));
  const out = { kind: data.kind, name: data.name, level, traits: traitList, size: sized.at(-1) || data.size || (data.ancestry || {}).size || 'medium', attributes: attrs, problems, options };

  // ---- armour and shield (characters) ----
  const armor = items.find((i) => i.kind === 'armor' && inUse(i)) || null;
  const shield = items.find((i) => i.kind === 'shield' && inUse(i)) || null;
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
    const weapons = items.filter((i) => i.kind === 'weapon' && inUse(i));
    const fist = { name: 'Fist', slug: 'fist', kind: 'weapon', category: 'unarmed', damage: { dice: 1, die: 'd4', type: 'bludgeoning' }, traits: ['agile', 'finesse', 'nonlethal', 'unarmed'] };
    const feats = (data.features || []).filter((x) => typeof x === 'string');
    // Strikes its features grant (claws, a kineticist's blast) beside its weapons
    const granted = rules.grantedStrikes.filter(holds).map((g) => ({ name: g.name, slug: slugOf(g), category: g.category || 'unarmed', group: g.group, traits: g.traits || [], range: g.range || null, damage: { die: g.die, type: g.type, ...(g.dice > 1 ? { dice: g.dice } : {}) } }));
    out.strikes = [...weapons, ...granted, ...(weapons.some((w) => w.category === 'unarmed') || granted.some((w) => w.category === 'unarmed') ? [] : [fist])].map((w) => characterStrike(w, { attrs, P, level, stat, feats }));
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
    // speeds its rules grant (a climb Speed from an ability), unless the stat block already has a better one
    for (const s of rules.speeds) if (!out.speeds[s.type] || out.speeds[s.type].base < s.value) out.speeds[s.type] = stat({ slug: `${s.type}-speed`, label: `${cap(s.type)} Speed`, base: s.value, parts: [{ label: s.origin.label, value: s.value }], selectors: [`${s.type}-speed`, 'all-speeds'], floor: 5 });
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
  // Strikes: traits added or removed, multiple attack penalty changes, extra damage dice, critical specialization
  for (const s of out.strikes || []) applyStrikeRules(s, rules, tags, facts);
  // what checks and turns need: degree changes, rolling twice, one-roll effects, temporary HP, fast healing,
  // auras, light, conditions its effects put on it
  out.checkRules = { degree: rules.degree.filter(holds), rollTwice: rules.rollTwice.filter(holds), ephemeral: rules.ephemeral.filter(holds) };
  out.tempHpRules = rules.tempHp;
  out.fastHealing = rules.fastHealing;
  out.auras = rules.auras.filter(holds);
  out.light = rules.lights.at(-1) || null;
  out.grantsConditions = rules.grantsConditions;
  out.tags = [...tags];
  out.facts = facts;
  out.rollModifiers = rules.modifiers;   // every modifier the rules made: checks that are not statistics (initiative) pick theirs
  out.unsupported = unsupported;   // imported rules not run yet: Claude applies them by hand
  out.usesDying = isPc || !!data.usesDying;
  out.band = healthBand(out.hp.value, max, !!state.dead);
  // does any condition compare HP? (then preparePf2e prepares again with the HP known)
  if (!hpFacts) out.usesHpFacts = /"hp-(percent|remaining)"/.test(JSON.stringify(rules.modifiers.map((m) => m.when).concat(rulesWhens(data, effects, items, content))));
  return out;
}

/** Every condition (`when`) on the rules a creature has, including ones filtered out above. */
function rulesWhens(data, effects, items, content) {
  return ruleSources(data, effects, items, content, []).flatMap((s) => (s.rules || []).map((r) => r.when).filter(Boolean));
}

/** A Strike's own tags for the rules that pick Strikes ("item:trait:agile", "item:melee"). */
function strikeTags(s, tags) {
  const t = new Set(tags);
  for (const x of s.traits) { t.add(`item:trait:${x}`); t.add(x); }
  t.add(`item:slug:${slugOf(s)}`); t.add(s.ranged ? 'item:ranged' : 'item:melee');
  if (s.category) t.add(`item:category:${s.category}`);
  if (s.group) t.add(`item:group:${s.group}`);
  return t;
}

function applyStrikeRules(s, rules, tags, facts) {
  let t = strikeTags(s, tags);
  for (const r of rules.strikeTraits) {
    if (!testPredicate(r.when, t, facts)) continue;
    for (const x of r.traits) {
      if (r.mode === 'add' && !s.traits.includes(x)) s.traits = [...s.traits, x];
      if (r.mode === 'remove') s.traits = s.traits.filter((y) => y !== x);
    }
    t = strikeTags(s, tags);
  }
  const attackSel = [`${slugOf(s)}-attack`, 'strike-attack-roll', 'attack-roll', 'attack', 'all'];
  const mapRule = rules.mapRules.filter((m) => m.selectors.some((x) => attackSel.includes(x)) && testPredicate(m.when, t, facts)).at(-1);
  const second = mapRule ? mapRule.value : s.traits.includes('agile') ? -4 : -5;
  s.map = [0, second, second * 2];
  const damageSel = [`${slugOf(s)}-damage`, 'strike-damage', 'damage', s.ranged ? 'ranged-strike-damage' : 'melee-strike-damage', 'all'];
  const extra = rules.damageDice.filter((d) => d.selectors.some((x) => damageSel.includes(x)) && d.die && testPredicate(d.when, t, facts));
  if (extra.length) {
    s.damage.extra = extra.map((d) => ({ dice: `${d.dice}${d.die}`, type: d.type || null, category: d.category || null, critical: d.critical, label: d.label }));
    const always = s.damage.extra.filter((d) => !d.critical);
    if (always.length) s.damage.formula += always.map((d) => ` plus ${d.dice}${d.type ? ` ${d.type}` : ''}${d.category ? ` (${d.category})` : ''}`).join('');
    const crit = s.damage.extra.filter((d) => d.critical);
    if (crit.length) s.damage.criticalExtra = crit.map((d) => `${d.dice}${d.type ? ` ${d.type}` : ''}`).join(' plus ');
  }
  if (rules.critSpec.some((c) => testPredicate(c.when, t, facts))) s.critSpec = true;
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
  return { name: w.name, slug: slugOf(w), traits, ranged, range: w.range || null, category: w.category, group: w.group, attack, map: agile ? [0, -4, -8] : [0, -5, -10], damage: { dice: d.dice ? d.dice + striking : dice, die: d.die, type: d.type, bonus: damage, formula: `${d.dice ? d.dice + striking : dice}${d.die}${damage.value ? sign(damage.value) : ''} ${d.type}` } };
}

/** A creature's Strike as printed: attack bonus, damage formula; conditions adjust the attack (and damage). */
function creatureStrike(w, { stat }) {
  const traits = w.traits || [], ranged = !!w.range;
  const attr = ranged || traits.includes('finesse') ? 'dex' : 'str';
  const attack = stat({ slug: `${w.slug || w.name}-attack`, label: `${w.name} attack`, base: w.attack || 0, parts: [{ label: 'stat block', value: w.attack || 0 }], selectors: ['attack-roll', 'strike-attack-roll', ranged ? 'ranged-attack-roll' : 'melee-attack-roll', attrSel(attr), 'all', `${slugOf(w)}-attack`] });
  const extra = stat({ slug: `${w.slug || w.name}-damage`, label: `${w.name} damage`, base: 0, parts: [], selectors: ['damage', 'strike-damage', ...(attr === 'str' ? ['str-damage'] : []), `${slugOf(w)}-damage`] });
  const agile = traits.includes('agile');
  const formula = (w.damage || []).map((d) => `${d.dice} ${d.type}`).join(' plus ') + (extra.value ? ` ${sign(extra.value)}` : '');
  return { name: w.name, slug: slugOf(w), traits, ranged, range: w.range || null, attack, map: agile ? [0, -4, -8] : [0, -5, -10], damage: { parts: w.damage || [], bonus: extra, formula }, effects: w.effects || [] };
}
