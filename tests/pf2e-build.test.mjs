// PF2E character builds (rulesets/pf2e/build.js): the choices a player makes, and the character worked out from them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { deriveCharacter, boostSlots, maxSkillRank } from '../rulesets/pf2e/build.js';

// the open content by key: "<source>:<folder>/<slug>" -> content/pf2e/<source>/<folder>/<slug>.json
const get = (key) => {
  const m = /^([^:]+):([^/]+)\/(.+)$/.exec(key || '');
  if (!m) return undefined;
  const f = path.join('content/pf2e', m[1], m[2], m[3] + '.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : undefined;
};
const ajv = new Ajv2020({ allErrors: true, strict: false });
const checkActor = ajv.compile(JSON.parse(fs.readFileSync('rulesets/pf2e/schemas/actor.schema.json', 'utf8')));

const FIGHTER = {
  v: 1, level: 1, name: 'Kerra',
  ancestry: 'ancestries:ancestry/human', heritage: 'heritages:heritage/versatile-human',
  background: 'backgrounds:background/guard', class: 'classes:class/fighter', keyAttribute: 'str',
  boosts: { ancestry: ['str', 'con'], background: ['str', 'dex'], free: ['str', 'dex', 'con', 'wis'] },
  skills: { trained: ['athletics', 'acrobatics', 'medicine'], lore: ['warfare'] },
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
  const { actor, pending, problems } = deriveCharacter(FIGHTER, get);
  assert.deepEqual(problems, []);
  assert.deepEqual(pending, [], JSON.stringify(pending));
  assert.deepEqual(actor.attributes, { str: 4, dex: 2, con: 2, int: 0, wis: 1, cha: 0 });
  assert.equal(actor.ancestry.hp, 8); assert.equal(actor.class.hp, 10); assert.equal(actor.class.keyAttribute, 'str');
  const P = actor.proficiencies;
  assert.deepEqual([P.perception, P.fortitude, P.reflex, P.will, P.classDC], [2, 2, 2, 1, 1]);
  assert.deepEqual(P.weapons, { simple: 2, martial: 2, advanced: 1, unarmed: 2 });
  assert.deepEqual(P.armor, { unarmored: 1, light: 1, medium: 1, heavy: 1 });
  assert.deepEqual(P.skills, { intimidation: 1, athletics: 1, acrobatics: 1, medicine: 1 });
  assert.deepEqual(P.lore, { warfare: 1 });
  assert.deepEqual(actor.feats.map((f) => [f.slug, f.slot]), [['quick-coercion', 'background'], ['natural-ambition', 'ancestry'], ['reactive-shield', 'class']]);
  assert.ok(actor.features.includes('reactive-strike') && !actor.features.includes('bravery'), 'level 1 features only');
  assert.ok(checkActor(actor), JSON.stringify(checkActor.errors && checkActor.errors.slice(0, 3)));
});

test('build: what is still to choose, step by step', () => {
  const r = deriveCharacter({ v: 1, level: 1 }, get);
  assert.deepEqual(r.pending.map((p) => p.step), ['ancestry', 'background', 'class', 'boosts.free', 'boosts.free', 'boosts.free', 'boosts.free']);
  const half = deriveCharacter({ ...FIGHTER, keyAttribute: undefined, boosts: { ancestry: ['str'], background: [], free: [] }, skills: {}, levels: {} }, get);
  const steps = half.pending.map((p) => p.step);
  for (const s of ['boosts.ancestry', 'boosts.background', 'keyAttribute', 'boosts.free', 'skills', 'feat.ancestry', 'feat.class']) assert.ok(steps.includes(s), `${s} is pending: ${steps}`);
  assert.match(half.pending.find((p) => p.step === 'keyAttribute').text, /dex or str/);
});

test('build: wrong choices are problems, never silently taken', () => {
  const bad = deriveCharacter({ ...FIGHTER, heritage: 'heritages:heritage/cavern-elf', keyAttribute: 'int',
    boosts: { ancestry: ['str', 'str'], background: ['wis', 'dex'], free: ['str', 'dex', 'con', 'wis'] }, skills: { trained: ['intimidation', 'athletics', 'acrobatics'] } }, get);
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
  const lv5 = { ...FIGHTER, level: 5, levels: {
    ...FIGHTER.levels,
    2: { feats: { class: 'feats:feat/sudden-charge', skill: 'feats:feat/quick-coercion' } },
    3: { feats: { general: 'feats:feat/toughness' }, skillIncrease: 'athletics' },
    4: { feats: { class: 'feats:feat/power-attack', skill: 'feats:feat/quick-coercion' } },
    5: { feats: { ancestry: 'feats:feat/natural-ambition' }, skillIncrease: 'athletics', boosts: ['str', 'dex', 'con', 'wis'] } } };
  const r = deriveCharacter(lv5, get);
  assert.deepEqual(r.pending, [], JSON.stringify(r.pending));
  assert.equal(r.actor.attributes.str, 4, 'str was +4: the boost is partial, half way to +5');
  assert.equal(r.actor.attributes.dex, 3);
  assert.match(r.problems.join('\n'), /level 5: athletics cannot go above expert yet/, 'master needs level 7');
  assert.equal(r.actor.proficiencies.skills.athletics, 2);
  // two partial boosts raise it by one (levels 5 and 10)
  const lv10 = deriveCharacter({ ...lv5, level: 10, levels: { ...lv5.levels, 5: { ...lv5.levels[5], skillIncrease: 'medicine' }, 10: { boosts: ['str', 'dex', 'con', 'int'] } } }, get);
  assert.equal(lv10.actor.attributes.str, 5);
});

import { prepareActor } from '../engine/rules/rules.js';
import { systemConfig } from '../rulesets/systems.js';

test('build: the derived character runs in the engine as a PC', () => {
  const { actor } = deriveCharacter(FIGHTER, get);
  const content = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? get(k) : undefined) });
  const p = prepareActor({ actor, state: {}, effects: [], content, ruleset: systemConfig('pf2e').actors });
  assert.equal(p.hp.max.value, 8 + 10 + 2, 'ancestry 8 + (class 10 + Con 2) at 1st level');
  assert.equal(p.saves.fortitude.value, 4 + 1 + 2, 'expert (+4) + level 1 + Con 2');
  assert.equal(p.perception.value, 4 + 1 + 1, 'expert (+4) + level 1 + Wis 1');
});
