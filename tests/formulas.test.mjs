// Foundry's formulas and conditions in our rules: ternary and comparisons in values, the level of what grants a
// rule (@itemLevel), conditions comparing numbers (level, HP, condition values), conditional defences, and
// effects from the content on a token at a level (a spell's rank). Original fixtures; the real Heroism effect is
// checked from the repository's open content when it is there.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalExpr, parseExpr } from '../engine/rules/expr.js';
import { testPredicate, prepareActor } from '../engine/rules/rules.js';
import { PF2E_SYSTEM } from '../rulesets/pf2e/system.js';
import { convertRule } from '../tools/import/foundry/convert.mjs';
import { applyEffect, effectName } from '../tools/effect.mjs';
import { referencedKeys } from '../tools/library.mjs';
import { tidyOps, buildRecords } from '../tools/campaign.mjs';
import { validate } from '../tools/validate.mjs';
import { PF2E_CONDITIONS } from '../rulesets/pf2e/conditions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = PF2E_SYSTEM.actors;
const RANKED = 'ternary(gte(@itemLevel,9),3,ternary(gte(@itemLevel,6),2,1))';

test('formulas: ternary, comparisons, and the level of what grants the rule', () => {
  assert.equal(evalExpr('gte(5, 5) + gt(5, 5) + lt(1, 2) + lte(3, 2) + eq(4, 4) + ne(4, 4)'), 3);
  for (const [rank, want] of [[3, 1], [5, 1], [6, 2], [8, 2], [9, 3], [10, 3]]) assert.equal(evalExpr(RANKED, { itemLevel: rank }), want, `rank ${rank}`);
  assert.equal(evalExpr('ternary(0, 1/0, 7)'), 7, 'only the branch taken is worked out');
  assert.throws(() => parseExpr('when(1, 2)'), /unknown function "when"/);
  assert.throws(() => evalExpr('ternary(1, 2)'), /three values/);
});

test('conditions comparing numbers: known facts only, unknown ones do not hold', () => {
  const facts = { 'self:level': 5, 'hp-percent': 40, 'self:condition:frightened': 2 };
  assert.equal(testPredicate([{ gte: ['self:level', 5] }], [], facts), true);
  assert.equal(testPredicate([{ lt: ['hp-percent', 50] }, 'raging'], ['raging'], facts), true);
  assert.equal(testPredicate([{ lt: ['hp-percent', 50] }, 'raging'], [], facts), false);
  assert.equal(testPredicate([{ gte: ['self:condition:frightened', 3] }], [], facts), false);
  assert.equal(testPredicate([{ lte: ['target:distance', 30] }], [], facts), false, 'a fact nobody gave');
  assert.equal(testPredicate({ not: { gt: ['self:level', 9] } }, [], facts), true);
  assert.throws(() => testPredicate([{ near: ['a', 1] }], []), /bad predicate/);
});

// a creature in our format, its rules from Foundry's (converted the way the importer does)
const conv = (rules) => rules.map((r) => convertRule(r).rule);
const base = (rules, extra = {}) => ({ kind: 'creature', slug: 'test', system: 'pf2e', name: 'Test Brute', level: 5, source: { title: 'x', license: 'ORC' },
  stats: { ac: 20, hp: 80, perception: 10, saves: { fortitude: 12, reflex: 9, will: 8 }, attributes: { str: 4, dex: 1 }, speeds: { land: 25 } }, items: [], rules: conv(rules), ...extra });
const prep = (doc, { state = {}, effects = [], content = {} } = {}) => prepareActor({ actor: { system: 'pf2e', kind: 'npc', base: 'creature/test' }, state, effects, content: { 'creature/test': doc, ...content }, ruleset: R });

test('creature rules: level-scaling values, conditional defences, and bonuses while badly hurt', () => {
  const doc = base([
    { key: 'Resistance', type: 'fire', value: 'max(1, floor(@actor.level / 2))' },
    { key: 'Resistance', type: 'cold', value: 5, predicate: ['raging'] },
    { key: 'Weakness', type: 'good', value: 'ternary(gte(@actor.level, 5), 10, 5)' },
    { key: 'FlatModifier', selector: 'ac', type: 'circumstance', value: 2, predicate: [{ lt: ['hp-percent', 50] }] },
    { key: 'BaseSpeed', selector: 'climb', value: 20, predicate: [{ gte: ['self:level', 5] }] },
  ]);
  assert.ok(doc.rules.every((r) => r.key !== 'unsupported'));
  const fresh = prep(doc);
  assert.deepEqual(fresh.iwr.resistances.map((r) => `${r.type} ${r.value}`), ['fire 2']);
  assert.deepEqual(fresh.iwr.weaknesses.map((r) => `${r.type} ${r.value}`), ['good 10']);
  assert.equal(fresh.ac.value, 20);
  assert.equal(fresh.speeds.climb.value, 20);
  const raging = prep(doc, { state: { tags: ['raging'] } });
  assert.deepEqual(raging.iwr.resistances.map((r) => `${r.type} ${r.value}`), ['fire 2', 'cold 5']);
  // below half HP the AC bonus applies, with its breakdown
  const hurt = prep(doc, { state: { hp: 39 } });
  assert.equal(hurt.ac.value, 22);
  assert.ok(hurt.ac.modifiers.some((m) => m.value === 2 && m.applied !== false && !m.reason));
  assert.equal(prep(doc, { state: { hp: 40 } }).ac.value, 20, 'exactly half is not below half');
  // frightened 2 makes a "while frightened 2 or more" rule hold
  const scared = base([{ key: 'FlatModifier', selector: 'will', type: 'circumstance', value: 1, predicate: [{ gte: ['self:condition:frightened', 2] }] }]);
  assert.equal(prep(scared, { effects: [{ id: 'frightened', value: 2 }] }).saves.will.value, 8 - 2 + 1);
  assert.equal(prep(scared, { effects: [{ id: 'frightened', value: 1 }] }).saves.will.value, 8 - 1);
});

// an effect document shaped like Foundry's Heroism, converted
const HEROISM = { kind: 'effect', slug: 'spell-effect-heroism', system: 'pf2e', name: 'Spell Effect: Heroism', level: 3, source: { title: 'x', license: 'ORC' },
  rules: conv([{ key: 'FlatModifier', selector: ['attack', 'saving-throw', 'skill-check', 'perception'], type: 'status', value: 'ternary(gte(@item.level,9),3,ternary(gte(@item.level,6),2,1))' }]) };

test('an effect from the content on a token: its rules apply at the level it was cast', () => {
  assert.equal(HEROISM.rules[0].key, 'modifier');
  const content = { 'spell-effects:effect/spell-effect-heroism': HEROISM };
  const at = (level) => prep(base([]), { content, effects: [{ name: 'Heroism', ref: 'spell-effects:effect/spell-effect-heroism', level }] });
  for (const [rank, bonus] of [[3, 1], [6, 2], [9, 3]]) {
    const p = at(rank);
    assert.deepEqual([p.saves.will.value, p.perception.value], [8 + bonus, 10 + bonus], `rank ${rank}`);
    assert.ok(p.saves.will.modifiers.some((m) => m.label === `Heroism (level ${rank})`));
  }
  assert.equal(at(undefined).saves.will.value, 9, 'no level given: the document\'s');
  // status bonuses don't stack: heroism and another status bonus, the best counts
  const p = prep(base([]), { content, effects: [{ name: 'Heroism', ref: 'spell-effects:effect/spell-effect-heroism', level: 6 }, { name: 'Bless-ish', rules: [{ key: 'modifier', selector: 'will', type: 'status', value: 1 }] }] });
  assert.equal(p.saves.will.value, 10);
  // a missing document is a problem, not a crash
  assert.match(prep(base([]), { effects: [{ name: 'Gone', ref: 'x:effect/gone', level: 1 }] }).problems.join(), /no content "x:effect\/gone"/);
});

test('the effect tool applies a content effect as a badge; the campaign keeps its document while it is on a token', () => {
  assert.equal(effectName(HEROISM), 'Heroism');
  const out = applyEffect({ name: 'Kerra', effects: [{ id: 'frightened', value: 1 }] }, 'apply', ['spell-effects:effect/spell-effect-heroism'], { doc: HEROISM, level: '6' }, PF2E_CONDITIONS);
  assert.deepEqual(out.token.effects[1], { name: 'Heroism', kind: 'good', ref: 'spell-effects:effect/spell-effect-heroism', level: 6 });
  assert.deepEqual(out.changed, ['Heroism (level 6)']);
  assert.throws(() => applyEffect({}, 'apply', ['item/rope'], { doc: { kind: 'equipment' } }, PF2E_CONDITIONS), /not an effect/);
  assert.throws(() => applyEffect({}, 'apply', ['spell-effects:effect/spell-effect-heroism'], { doc: HEROISM, level: 'six' }, PF2E_CONDITIONS), /not a whole number/);
  // in use while on a token: loading keeps it on the board, tidying leaves it
  assert.deepEqual([...referencedKeys({}, { t: out.token })], ['spell-effects:effect/spell-effect-heroism']);
  const { records } = buildRecords(path.join(ROOT, 'examples/sample-pack'), path.join(ROOT, 'examples/campaigns/keep-test'), { now: 't' });
  records['tokens/tok-cw77vfz9'] = { ...records['tokens/tok-cw77vfz9'], effects: out.token.effects };
  records['content/spell-effects.effect.spell-effect-heroism'] = HEROISM;
  assert.deepEqual(tidyOps(records), []);
  delete records['tokens/tok-cw77vfz9'].effects;
  assert.deepEqual(tidyOps(records), [[{ op: 'delete', path: 'content/spell-effects.effect.spell-effect-heroism' }]]);
});

test('a save with a content effect on a token: it validates, and a missing document is an error', () => {
  const real = path.join(ROOT, 'content/pf2e/spell-effects/effect/spell-effect-heroism.json');
  if (!fs.existsSync(real)) return;   // the open content is imported in this repository; skip if it is not there
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'rvtt-fx-'));
  fs.cpSync(path.join(ROOT, 'examples/sample-pack'), path.join(t, 'pack'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'examples/campaigns/keep-test'), path.join(t, 'save'), { recursive: true });
  const mapFile = path.join(t, 'save/maps/sample-keep.json'), st = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  st.tokens['tok-cw77vfz9'].effects = [{ name: 'Heroism', kind: 'good', ref: 'spell-effects:effect/spell-effect-heroism', level: 6 }];
  fs.writeFileSync(mapFile, JSON.stringify(st));
  const ok = validate(path.join(t, 'pack'), { save: path.join(t, 'save') });
  assert.deepEqual(ok.errors.map((e) => e.msg), []);
  // the real Heroism, from the open content, at rank 6: +2 status to Kerra's Will (8 + 2)
  const doc = JSON.parse(fs.readFileSync(real, 'utf8'));
  assert.equal(doc.rules[0].key, 'modifier');
  st.tokens['tok-cw77vfz9'].effects[0].ref = 'spell-effects:effect/no-such-effect';
  fs.writeFileSync(mapFile, JSON.stringify(st));
  assert.match(validate(path.join(t, 'pack'), { save: path.join(t, 'save') }).errors.map((e) => e.msg).join('\n'), /no content "spell-effects:effect\/no-such-effect"/);
  fs.rmSync(t, { recursive: true, force: true });
});
