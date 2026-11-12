// The system-free rules engine: expressions, predicates, statistics and stacking, rule elements, degrees of success.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExpr, evalExpr, exprRefs } from '../engine/rules/expr.js';
import { testPredicate, makeStatistic, describeStatistic, collectRules, modifiersFor, degreeOf, mergeData, prepareActor } from '../engine/rules/rules.js';

const stacks = (t) => !t || t === 'untyped';

test('expressions: arithmetic, references, functions; never code', () => {
  assert.equal(evalExpr('2 + 3 * 4'), 14);
  assert.equal(evalExpr('(2 + 3) * 4'), 20);
  assert.equal(evalExpr('-@value', { value: 2 }), -2);
  assert.equal(evalExpr('min(-1 * @level, -1) * @value', { level: 3, value: 2 }), -6);
  assert.equal(evalExpr('min(-1 * @level, -1) * @value', { level: 0, value: 2 }), -2, 'drained at level 0 still costs 1 per value');
  assert.equal(evalExpr('max(1, @actor.level) * 2', { actor: { level: 4 } }), 8);
  assert.equal(evalExpr('floor(7 / 2)'), 3);
  assert.equal(evalExpr(5), 5);
  assert.deepEqual(exprRefs('@level + @value * 2').sort(), ['level', 'value']);
  for (const bad of ['2 +', 'alert(1)', 'process.exit()', '@value; 1', '"x"', 'max(1,', '1 2']) assert.throws(() => evalExpr(bad, { value: 1 }), undefined, bad);
  assert.throws(() => evalExpr('@nope', {}), /unknown reference/);
  assert.throws(() => evalExpr('1 / 0'), /division by zero/);
  assert.deepEqual(parseExpr('-@value'), { neg: { ref: 'value' } });
});

test('predicates: all of a list, or, and, not', () => {
  const tags = new Set(['fear', 'mental', 'enemy']);
  assert.equal(testPredicate(undefined, tags), true);
  assert.equal(testPredicate(['fear'], tags), true);
  assert.equal(testPredicate(['fear', 'poison'], tags), false);
  assert.equal(testPredicate([{ or: ['poison', 'mental'] }], tags), true);
  assert.equal(testPredicate([{ not: 'poison' }, { and: ['fear', 'enemy'] }], tags), true);
  assert.equal(testPredicate([{ not: 'fear' }], tags), false);
  assert.throws(() => testPredicate([42], tags), /bad predicate/);
});

test('statistics: typed bonuses and penalties do not stack, untyped do; each choice is explained', () => {
  const st = makeStatistic({
    slug: 'ac', label: 'AC', base: 18, parts: [{ label: 'base', value: 18 }], stacks,
    modifiers: [
      { slug: 'frightened', label: 'Frightened 2', type: 'status', value: -2 },
      { slug: 'clumsy', label: 'Clumsy 1', type: 'status', value: -1 },
      { slug: 'off-guard', label: 'Off-guard', type: 'circumstance', value: -2 },
      { slug: 'cover', label: 'Cover', type: 'circumstance', value: 1 },
      { slug: 'shield', label: 'Shield', type: 'circumstance', value: 2 },
      { slug: 'acp', label: 'Penalty', type: 'untyped', value: -1 },
      { slug: 'acp2', label: 'Other penalty', type: 'untyped', value: -1 },
      { slug: 'heroism', label: 'Only vs fear', type: 'status', value: 1, when: ['fear'] },
    ],
  });
  // 18 - 2 (status: worst) - 2 (circumstance penalty) + 2 (best circumstance bonus) - 1 - 1 (untyped add up) = 14
  assert.equal(st.value, 14);
  const why = Object.fromEntries(st.modifiers.map((m) => [m.slug, m.applied ? 'yes' : m.reason]));
  assert.equal(why.frightened, 'yes');
  assert.match(why.clumsy, /bigger status penalty/);
  assert.match(why.cover, /bigger circumstance bonus/);
  assert.equal(why.shield, 'yes');
  assert.equal(why.heroism, 'does not apply now');
  assert.equal(makeStatistic({ slug: 'ac', label: 'AC', base: 18, stacks, tags: ['fear'], modifiers: [{ slug: 'heroism', type: 'status', value: 1, when: ['fear'] }] }).value, 19);
  assert.match(describeStatistic(st), /^AC 14 = 18 base − 2 Frightened 2 \(status\) − 2 Off-guard \(circumstance\) \+ 2 Shield \(circumstance\) − 1 Penalty − 1 Other penalty$/);
  // the same modifier twice counts once (frightened from two sources)
  const twice = makeStatistic({ slug: 'will', label: 'Will', base: 5, stacks, modifiers: [{ slug: 'x', type: 'untyped', value: -2 }, { slug: 'x', type: 'untyped', value: -3 }] });
  assert.equal(twice.value, 2);
  assert.equal(makeStatistic({ slug: 'speed', label: 'Speed', base: 10, floor: 5, stacks, modifiers: [{ slug: 'enc', type: 'untyped', value: -10 }] }).value, 5, 'a floor');
});

test('rule elements: modifiers with values and selectors, IWR, speeds, senses, notes; unknown keys and errors reported', () => {
  const out = collectRules([
    { origin: { kind: 'condition', id: 'clumsy', label: 'Clumsy 2' }, value: 2, rules: [{ key: 'modifier', selector: 'dex-based', type: 'status', value: '-@value' }] },
    { origin: { kind: 'feat', id: 'toughness', label: 'Toughness' }, rules: [{ key: 'modifier', selector: 'hp', value: '@level' }, { key: 'note', selector: 'will', text: 'x' }] },
    { origin: { kind: 'item', id: 'ring', label: 'Ring' }, rules: [{ key: 'resistance', type: 'fire', value: 5 }, { key: 'weakness', type: 'cold', value: '@level' }, { key: 'immunity', type: 'poison' }, { key: 'speed', type: 'fly', value: 20 }, { key: 'sense', type: 'darkvision' }] },
    { origin: { kind: 'feat', id: 'odd', label: 'Odd' }, rules: [{ key: 'GrantItem', uuid: 'x' }, { key: 'modifier', selector: 'ac', value: '@missing' }] },
  ], { level: 3 });
  assert.equal(out.modifiers.length, 2);
  assert.deepEqual(out.modifiers.map((m) => m.value), [-2, 3]);
  assert.deepEqual(modifiersFor(out.modifiers, ['reflex', 'dex-based']).map((m) => m.slug), ['clumsy']);
  assert.deepEqual(out.resistances[0], { type: 'fire', value: 5, except: undefined, when: undefined, origin: { kind: 'item', id: 'ring', label: 'Ring' } });
  assert.equal(out.weaknesses[0].value, 3);
  assert.equal(out.immunities[0].type, 'poison');
  assert.equal(out.speeds[0].value, 20);
  assert.equal(out.senses[0].type, 'darkvision');
  assert.equal(out.notes[0].selectors[0], 'will');
  assert.equal(out.unknown[0].rule.key, 'GrantItem', 'unsupported rules are reported, never silently dropped');
  assert.match(out.errors[0].error, /unknown reference @missing/);
  const extra = collectRules([{ origin: { id: 'x', label: 'X' }, rules: [{ key: 'custom', v: 1 }] }], {}, { custom: (r, ctx, o) => o.notes.push({ text: `custom ${r.v}` }) });
  assert.equal(extra.notes[0].text, 'custom 1', 'a ruleset can add its own keys');
});

test('degrees of success: margins of 10 and the natural 20 and 1', () => {
  assert.equal(degreeOf(25, 15, 12), 'critical-success');
  assert.equal(degreeOf(15, 15, 10), 'success');
  assert.equal(degreeOf(14, 15, 10), 'failure');
  assert.equal(degreeOf(5, 15, 3), 'critical-failure');
  assert.equal(degreeOf(14, 15, 20), 'success', 'a natural 20 improves a failure');
  assert.equal(degreeOf(25, 15, 1), 'success', 'a natural 1 worsens a critical success');
  assert.equal(degreeOf(6, 15, 1), 'critical-failure');
  assert.equal(degreeOf(30, 15, 20), 'critical-success', 'never above critical success');
  assert.equal(degreeOf(14, 15, 20, { naturalShift: false }), 'failure', 'a ruleset may turn the natural shift off');
});

test('a creature over its base: own values win, objects merge, null removes', () => {
  const base = { name: 'Rat', stats: { ac: 14, hp: 7, speeds: { land: 25, climb: 10 } }, traits: ['animal'] };
  const m = mergeData(base, { name: 'Big Rat', stats: { hp: 12, speeds: { climb: null } }, traits: ['animal', 'elite'] });
  assert.deepEqual(m, { name: 'Big Rat', stats: { ac: 14, hp: 12, speeds: { land: 25 } }, traits: ['animal', 'elite'] });
  assert.equal(base.stats.hp, 7, 'the base is not changed');
  const seen = [];
  prepareActor({ actor: { base: 'creature/rat', name: 'Wet-Nosed Rat' }, content: { 'creature/rat': base }, ruleset: { prepare: (d) => seen.push(d) } });
  assert.equal(seen[0].name, 'Wet-Nosed Rat'); assert.equal(seen[0].stats.ac, 14); assert.equal(seen[0].base, undefined);
  assert.throws(() => prepareActor({ actor: { base: 'creature/none' }, content: {}, ruleset: { prepare() {} } }), /no content "creature\/none"/);
  assert.throws(() => prepareActor({ actor: {}, ruleset: {} }), /cannot prepare/);
});
