// PF2E character builds (rulesets/pf2e/build.js): the choices a player makes, and the character worked out from them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { deriveCharacter, boostSlots, maxSkillRank, foundryResolver, predicateHolds, textGains, classSection, rankFormula, choiceOption } from '../rulesets/pf2e/build.js';
import { weaponRank } from '../rulesets/pf2e/actor.js';
import { report as buildReport } from '../rulesets/pf2e/builder.js';

// the open content by key: "<source>:<folder>/<slug>" -> content/pf2e/<source>/<folder>/<slug>.json
const get = (key) => {
  const m = /^([^:]+):([^/]+)\/(.+)$/.exec(key || '');
  if (!m) return undefined;
  const f = path.join('content/pf2e', m[1], m[2], m[3] + '.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : undefined;
};
const ajv = new Ajv2020({ allErrors: true, strict: false });
const resolve = foundryResolver(JSON.parse(fs.readFileSync('content/pf2e/import-manifest.json', 'utf8')));
const checkActor = ajv.compile(JSON.parse(fs.readFileSync('rulesets/pf2e/schemas/actor.schema.json', 'utf8')));

const FIGHTER = {
  v: 1, level: 1, name: 'Kerra',
  ancestry: 'ancestries:ancestry/human', heritage: 'heritages:heritage/versatile-human',
  background: 'backgrounds:background/guard', class: 'classes:class/fighter', keyAttribute: 'str',
  boosts: { ancestry: ['str', 'con'], background: ['str', 'dex'], free: ['str', 'dex', 'con', 'wis'] },
  skills: { trained: ['acrobatics', 'medicine', 'society'], lore: ['warfare'] },
  // the content's own choices: the fighter's skill, Versatile Human's general feat, Natural Ambition's class feat
  selections: { 'fighter.fighterSkill': 'athletics', 'versatile-human.versatileHeritage': 'feats:feat/toughness', 'natural-ambition.naturalAmbition': 'feats:feat/snagging-strike' },
  levels: { 1: { feats: { ancestry: 'feats:feat/natural-ambition', class: 'feats:feat/reactive-shield' } } },
};

test('build: boost slots read fixed, chosen and free boosts', () => {
  const elf = boostSlots(get('ancestries:ancestry/elf'));
  assert.deepEqual(elf.map((s) => s.fixed), ['dex', 'int', null]);
  assert.equal(elf[2].free, true);
  assert.deepEqual(boostSlots(get('backgrounds:background/guard'))[0].options, ['cha', 'str']);
  assert.deepEqual([1, 6, 7, 14, 15].map(maxSkillRank), [2, 2, 3, 3, 4]);
});

test('build: a 1st-level human fighter, worked out from the choices', () => {
  const { actor, pending, problems, unsupported } = deriveCharacter(FIGHTER, get, { resolve });
  assert.deepEqual(problems, []);
  assert.deepEqual(unsupported, []);
  assert.deepEqual(pending, [], JSON.stringify(pending));
  assert.deepEqual(actor.attributes, { str: 4, dex: 2, con: 2, int: 0, wis: 1, cha: 0 });
  assert.equal(actor.ancestry.hp, 8); assert.equal(actor.class.hp, 10); assert.equal(actor.class.keyAttribute, 'str');
  const P = actor.proficiencies;
  assert.deepEqual([P.perception, P.fortitude, P.reflex, P.will, P.classDC], [2, 2, 2, 1, 1]);
  assert.deepEqual(P.weapons, { simple: 2, martial: 2, advanced: 1, unarmed: 2 });
  assert.deepEqual(P.armor, { unarmored: 1, light: 1, medium: 1, heavy: 1 });
  assert.deepEqual(P.skills, { intimidation: 1, acrobatics: 1, medicine: 1, society: 1, athletics: 1 }, 'athletics from the fighter\'s own choice');
  assert.deepEqual(P.lore, { warfare: 1 });
  assert.deepEqual(actor.feats.map((f) => [f.slug, f.slot]), [['quick-coercion', 'background'], ['natural-ambition', 'ancestry'], ['reactive-shield', 'class'],
    ['toughness', 'granted'], ['shield-block', 'granted'], ['snagging-strike', 'granted']], 'the feats the choices grant, and Shield Block from the class feature');
  assert.equal(actor.feats.find((f) => f.slug === 'toughness').from, 'Versatile Human');
  assert.deepEqual(actor.granted, [{ name: 'Reactive Strike', kind: 'action', ref: 'actions:action/reactive-strike', from: 'Reactive Strike' }]);
  assert.ok(actor.features.includes('reactive-strike') && !actor.features.includes('bravery'), 'level 1 features only');
  assert.ok(checkActor(actor), JSON.stringify(checkActor.errors && checkActor.errors.slice(0, 3)));
});

test('build: what is still to choose, step by step', () => {
  const r = deriveCharacter({ v: 1, level: 1 }, get, { resolve });
  assert.deepEqual(r.pending.map((p) => p.step), ['ancestry', 'background', 'class', 'boosts.free', 'boosts.free', 'boosts.free', 'boosts.free']);
  const half = deriveCharacter({ ...FIGHTER, keyAttribute: undefined, boosts: { ancestry: ['str'], background: [], free: [] }, skills: {}, selections: {}, levels: {} }, get, { resolve });
  const steps = half.pending.map((p) => p.step);
  for (const s of ['boosts.ancestry', 'boosts.background', 'keyAttribute', 'boosts.free', 'skills', 'feat.ancestry', 'feat.class']) assert.ok(steps.includes(s), `${s} is pending: ${steps}`);
  assert.match(half.pending.find((p) => p.step === 'keyAttribute').text, /dex or str/);
  // the content's "pick one" rules are steps too, with what they offer
  const pick = half.pending.find((p) => p.step === 'choice.fighter.fighterSkill');
  assert.equal(pick.text, 'Fighter: choose a skill.');
  assert.deepEqual(pick.choice.options, [{ value: 'acrobatics', label: 'Acrobatics' }, { value: 'athletics', label: 'Athletics' }]);
  const vh = half.pending.find((p) => p.step === 'choice.versatile-human.versatileHeritage');
  assert.deepEqual(vh.choice, { item: 'heritages:heritage/versatile-human', flag: 'versatileHeritage', filter: ['item:level:1', 'item:trait:general'], itemType: 'feat' });
  const bad = deriveCharacter({ ...FIGHTER, selections: { ...FIGHTER.selections, 'fighter.fighterSkill': 'arcana' } }, get, { resolve });
  assert.match(bad.problems.join('\n'), /Fighter: arcana is not one of its choices/);
});

test('build: wrong choices are problems, never silently taken', () => {
  const bad = deriveCharacter({ ...FIGHTER, heritage: 'heritages:heritage/cavern-elf', keyAttribute: 'int',
    boosts: { ancestry: ['str', 'str'], background: ['wis', 'dex'], free: ['str', 'dex', 'con', 'wis'] }, skills: { trained: ['intimidation', 'medicine', 'acrobatics'] } }, get, { resolve });
  const all = bad.problems.join('\n');
  assert.match(all, /Cavern Elf is a heritage of the Elf, not the Human/);
  assert.match(all, /key attribute int is not one of the Fighter's/);
  assert.match(all, /ancestry boosts: str boosted twice/);
  assert.match(all, /background boost 1: wis is not one of cha, str/);
  assert.match(all, /intimidation is trained already/);
  // a versatile heritage suits any ancestry
  assert.ok(!deriveCharacter({ ...FIGHTER, heritage: 'heritages:heritage/naari' }, get).problems.some((p) => /heritage of/.test(p)));
});

test('build: levels bring feats, skill increases and boosts; a boost at +4 is a partial boost', () => {
  const lv5 = { ...FIGHTER, level: 5, selections: { ...FIGHTER.selections, 'fighter-weapon-mastery.fighterWeaponMastery': 'sword' }, levels: {
    ...FIGHTER.levels,
    2: { feats: { class: 'feats:feat/sudden-charge', skill: 'feats:feat/quick-coercion' } },
    3: { feats: { general: 'feats:feat/toughness' }, skillIncrease: 'athletics' },
    4: { feats: { class: 'feats:feat/intimidating-strike', skill: 'feats:feat/quick-coercion' } },
    5: { feats: { ancestry: 'feats:feat/natural-ambition' }, skillIncrease: 'athletics', boosts: ['str', 'dex', 'con', 'wis'] } } };
  const r = deriveCharacter(lv5, get, { resolve });
  assert.deepEqual(r.pending, [], JSON.stringify(r.pending));
  assert.equal(r.actor.attributes.str, 4, 'str was +4: the boost is partial, half way to +5');
  assert.equal(r.actor.attributes.dex, 3);
  assert.match(r.problems.join('\n'), /level 5: athletics cannot go above expert yet/, 'master needs level 7');
  assert.equal(r.actor.proficiencies.skills.athletics, 2);
  // two partial boosts raise it by one (levels 5 and 10)
  const lv10 = deriveCharacter({ ...lv5, level: 10, levels: { ...lv5.levels, 5: { ...lv5.levels[5], skillIncrease: 'medicine' }, 10: { boosts: ['str', 'dex', 'con', 'int'] } } }, get, { resolve });
  assert.equal(lv10.actor.attributes.str, 5);
});

import { prepareActor } from '../engine/rules/rules.js';
import { systemConfig } from '../rulesets/systems.js';

test('build: the derived character runs in the engine as a PC', () => {
  const { actor } = deriveCharacter(FIGHTER, get, { resolve });
  const content = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? get(k) : undefined) });
  const p = prepareActor({ actor, state: {}, effects: [], content, ruleset: systemConfig('pf2e').actors });
  assert.equal(p.hp.max.value, 8 + 10 + 2 + 1, 'ancestry 8 + (class 10 + Con 2) at 1st level + Toughness (Versatile Human\'s feat) 1');
  assert.equal(p.saves.fortitude.value, 4 + 1 + 2, 'expert (+4) + level 1 + Con 2');
  assert.equal(p.perception.value, 4 + 1 + 1, 'expert (+4) + level 1 + Wis 1');
});

// ---- step 2: the content's own rules ----

test('build rules: Foundry links, conditions, roll options and formulas', () => {
  assert.equal(resolve('Compendium.pf2e.feats-srd.Item.Shield Block'), 'feats:feat/shield-block', 'by name');
  assert.equal(resolve('Compendium.pf2e.classfeatures.Item.Nonsense Feature'), null);
  const facts = { level: 5, tags: new Set(['class:fighter', 'feat:power-attack']), rank: (t) => (t === 'skill:athletics:rank' ? 2 : 0) };
  assert.equal(predicateHolds([{ gte: ['self:level', 5] }, 'class:fighter'], facts), true);
  assert.equal(predicateHolds([{ not: 'feat:power-attack' }], facts), false);
  assert.equal(predicateHolds([{ nor: ['class:wizard', 'class:bard'] }], facts), true);
  assert.equal(predicateHolds(['self:effect:rage'], facts), false, 'a state in play never holds while building');
  assert.equal(predicateHolds([{ gte: ['skill:athletics:rank', 2] }], facts), true);
  assert.equal(predicateHolds(['skill:athletics:rank:2'], facts), true);
  assert.equal(predicateHolds(['mystery-term'], { ...facts, knows: () => false }), null, 'the report asks which terms it can know');
  assert.equal(choiceOption({ rollOption: 'kinetic-gate:first-element' }, 'air'), 'kinetic-gate:first-element:air');
  assert.equal(rankFormula('ternary(gte(@actor.level,15),4,ternary(gte(@actor.level,7),3,2))', 9, () => 0), 3);
  assert.equal(rankFormula('max(@actor.system.proficiencies.defenses.light.rank,1)', 1, (p) => (p === 'proficiencies.defenses.light.rank' ? 2 : null)), 2);
  assert.equal(rankFormula('@actor.flags.anything', 1, () => null), null);
});

test('build rules: proficiency gains read from class feature text', () => {
  assert.deepEqual(textGains("You're trained in light and medium armor, and you have expert proficiency in Fortitude saves. At 13th level, if you gain the Divine Defense class feature, you also gain expert proficiency in light and medium armor.").gains,
    [{ bag: 'armor', key: 'light', rank: 1 }, { bag: 'armor', key: 'medium', rank: 1 }, { bag: null, key: 'fortitude', rank: 2 }]);
  assert.deepEqual(textGains('If you have qi spells, your proficiency rank for spell attacks and spell DCs increases to expert.').gains, [], 'a gain that holds only if something is so');
  assert.deepEqual(textGains("Their proficiency rank for unarmed attacks increases to expert.").gains, [], "an eidolon's rank is not the character's");
  assert.deepEqual(textGains('Your proficiency rank for the chosen saving throw increases to master.').unread, ['the chosen saving throw']);
  assert.deepEqual(textGains('Second Doctrine (3rd): You are trained in martial weapons.').gains, [], 'a summary of later features');
  const shared = 'Champion, Magus Your proficiency ranks for simple weapons and martial weapons increase to expert.\n\nDruid, Kineticist Your proficiency rank for simple weapons increases to expert.';
  assert.equal(classSection(shared, 'Druid'), 'Your proficiency rank for simple weapons increases to expert.');
  assert.equal(classSection('Your rank goes up.', 'Druid'), 'Your rank goes up.');
});

test('build rules: a level 11 fighter, its weapon group mastery and its ranks', () => {
  const b = { ...FIGHTER, level: 11, selections: { ...FIGHTER.selections, 'fighter-weapon-mastery.fighterWeaponMastery': 'sword' } };
  const { actor, unsupported } = deriveCharacter(b, get, { resolve });
  assert.deepEqual(unsupported, []);
  const P = actor.proficiencies;
  assert.deepEqual([P.perception, P.fortitude, P.reflex, P.will, P.classDC], [3, 3, 2, 2, 2], 'Battlefield Surveyor, Battle Hardened, Bravery, Fighter Expertise');
  assert.deepEqual(P.armor, { unarmored: 2, light: 2, medium: 2, heavy: 2 }, 'Armor Expertise');
  assert.deepEqual(P.definitions['weapon-mastery-simple-martial'].when[0], 'item:group:sword');
  assert.equal(weaponRank(get('equipment:item/longsword'), P), 3, 'master with swords');
  assert.equal(weaponRank(get('equipment:item/battle-axe'), P), 2, 'expert with other martial weapons');
  assert.ok(checkActor(actor), JSON.stringify(checkActor.errors && checkActor.errors.slice(0, 3)));
});

test('build rules: a cleric doctrine sets the flags its later features grant from', () => {
  const b = { v: 1, level: 7, ancestry: 'ancestries:ancestry/dwarf', heritage: 'heritages:heritage/rock-dwarf', background: 'backgrounds:background/acolyte', class: 'classes:class/cleric',
    selections: { 'doctrine.doctrine': 'class-features:feat/warpriest' } };
  const { actor, unsupported } = deriveCharacter(b, get, { resolve });
  assert.deepEqual(unsupported, []);
  for (const f of ['warpriest', 'first-doctrine-warpriest', 'second-doctrine-warpriest', 'third-doctrine-warpriest']) assert.ok(actor.features.includes(f), f);
  assert.ok(!actor.features.includes('fourth-doctrine-warpriest'), 'the fourth doctrine comes at 11th level');
  const P = actor.proficiencies;
  assert.equal(P.fortitude, 2, 'First Doctrine: expert Fortitude');
  assert.deepEqual(P.armor, { unarmored: 1, light: 1, medium: 1 });
  assert.equal(P.weapons.martial, 2, 'Second Doctrine trained, Third Doctrine expert');
  assert.deepEqual(P.spellcasting, { cleric: 1 });
  assert.ok(actor.feats.some((f) => f.slug === 'shield-block' && f.slot === 'granted'));
});

test('build rules: every class works out at 20th level without a rank it was never trained in', () => {
  for (const f of fs.readdirSync('content/pf2e/classes/class')) {
    const { actor } = deriveCharacter({ v: 1, level: 20, class: `classes:class/${f.slice(0, -5)}` }, get, { resolve });
    const P = actor.proficiencies;
    for (const k of ['perception', 'fortitude', 'reflex', 'will']) assert.ok(P[k] >= 1 && P[k] <= 4, `${f} ${k}`);
    assert.ok(P.armor.unarmored >= 2, `${f}: unarmored defense rises by 20th level`);
    if (f === 'wizard.json') assert.equal(P.weapons.martial, undefined, 'a wizard never gains martial weapons');
  }
});

test('build rules: the report of what the builder cannot run', () => {
  const r = buildReport();
  assert.ok(r.totals.rules < 120, `${r.totals.rules} rules left`);
  for (const c of ['fighter', 'wizard', 'cleric', 'rogue', 'bard', 'sorcerer', 'witch', 'monk', 'barbarian']) assert.deepEqual(r.classes[c], [], c);
});
