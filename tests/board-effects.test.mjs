import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeOf, badgesFor, badgeSlot, tokenState, cannotSee, visibleEffects, withEffect, withoutEffect, stepCondition, describeEffects } from '../board/effects.js';
import { applyEffect } from '../tools/effect.mjs';
import { PF2E_SYSTEM } from '../rulesets/pf2e/system.js';
import { PF2E_CONDITIONS } from '../rulesets/pf2e/conditions.js';

const C = PF2E_SYSTEM.conditions;

test('the PF2E conditions: all of Player Core, each with its own icon, a kind and a rules line', () => {
  const ids = Object.keys(PF2E_CONDITIONS);
  for (const id of ['blinded', 'clumsy', 'concealed', 'confused', 'controlled', 'dazzled', 'deafened', 'doomed', 'drained', 'dying',
    'encumbered', 'enfeebled', 'fascinated', 'fatigued', 'fleeing', 'frightened', 'grabbed', 'hidden', 'immobilized', 'invisible',
    'off-guard', 'paralyzed', 'persistent', 'petrified', 'prone', 'quickened', 'restrained', 'sickened', 'slowed', 'stunned',
    'stupefied', 'unconscious', 'undetected', 'unnoticed', 'wounded']) assert.ok(ids.includes(id), id);
  const icons = ids.map((id) => PF2E_CONDITIONS[id].icon);
  assert.equal(new Set(icons).size, icons.length, 'every icon is unique');
  for (const [id, c] of Object.entries(PF2E_CONDITIONS)) {
    assert.ok(['good', 'bad', 'neutral'].includes(c.kind), id);
    assert.ok(c.rule && c.rule.length < 220, id);
    assert.match(id, /^[a-z][a-z-]*$/);
  }
  assert.equal(C, PF2E_CONDITIONS, 'part of the system configuration');
});

test('badges: conditions show their icon, number and rules line; custom effects their first letter', () => {
  const f = badgeOf({ id: 'frightened', value: 2, source: 'Demoralize by Kerra' }, C);
  assert.equal(f.icon, '😨'); assert.equal(f.value, 2); assert.equal(f.kind, 'bad');
  assert.match(f.text, /^Frightened 2: Status penalty/); assert.match(f.text, /From Demoralize by Kerra\./);
  const p = badgeOf({ id: 'persistent', detail: '2d6 fire' }, C);
  assert.equal(p.label, 'Persistent damage (2d6 fire)');
  const b = badgeOf({ name: 'bless', kind: 'good', until: 'end of the encounter' }, C);
  assert.equal(b.icon, null); assert.equal(b.letter, 'B'); assert.equal(b.kind, 'good');
  assert.match(b.text, /Until end of the encounter\./);
  assert.equal(badgeOf({ name: '???' }, C).letter, '•');
});

test('badges: all of them, the token-state ones first, in columns of five; GM-only ones in the GM view only', () => {
  const t = { effects: [{ id: 'prone' }, { id: 'off-guard' }, { id: 'sickened', value: 1 }, { id: 'clumsy', value: 1 }, { id: 'dying', value: 1 }, { name: 'Curse', gm_only: true }] };
  const p = badgesFor(t, 'player', C);
  assert.equal(p.length, 5);
  assert.equal(p[0].key, 'dying');
  assert.equal(badgesFor(t, 'gm', C).length, 6);
  assert.deepEqual(badgeSlot(0), { col: 0, row: 0 });
  assert.deepEqual(badgeSlot(4), { col: 0, row: 4 });
  assert.deepEqual(badgeSlot(5), { col: 1, row: 0 });
  assert.equal(visibleEffects({ dead: true, effects: t.effects }, 'gm').length, 0, 'none on the dead');
});

test('the status palette: click toggles or raises, right-click lowers or removes', () => {
  let e = stepCondition([], 'prone', 1, C);
  assert.deepEqual(e, [{ id: 'prone' }]);
  assert.deepEqual(stepCondition(e, 'prone', 1, C), [], 'a second click on a plain condition removes it');
  assert.deepEqual(stepCondition(e, 'prone', -1, C), []);
  e = stepCondition([], 'frightened', 1, C);
  e = stepCondition(e, 'frightened', 1, C);
  assert.deepEqual(e, [{ id: 'frightened', value: 2 }]);
  assert.deepEqual(stepCondition(e, 'frightened', -1, C), [{ id: 'frightened', value: 1 }]);
  assert.deepEqual(stepCondition([{ id: 'frightened', value: 1, source: 'x' }], 'frightened', -1, C), []);
  assert.deepEqual(stepCondition([{ id: 'frightened', value: 1, source: 'x' }], 'frightened', 1, C), [{ id: 'frightened', value: 2, source: 'x' }], 'keeps the source');
  assert.deepEqual(stepCondition([{ id: 'dying', value: 4 }], 'dying', 1, C), [{ id: 'dying', value: 4 }], 'capped at its max');
  assert.deepEqual(stepCondition([], 'frightened', -1, C), []);
  assert.throws(() => stepCondition([], 'nope', 1, C), /not a condition/);
});

test('audit and chat lines for effects', () => {
  assert.deepEqual(describeEffects('Lyra', {}, { effects: [{ id: 'frightened', value: 2 }] }, C), ['Lyra frightened 2']);
  assert.deepEqual(describeEffects('Lyra', { effects: [{ id: 'frightened', value: 2 }] }, { effects: [{ id: 'frightened', value: 1 }] }, C), ['Lyra frightened 1 (was 2)']);
  assert.deepEqual(describeEffects('Lyra', { effects: [{ id: 'prone' }] }, {}, C), ['Lyra no longer prone']);
  assert.deepEqual(describeEffects('Ogre', {}, { dead: true }, C), ['Ogre is dead']);
  assert.deepEqual(describeEffects('Ogre', {}, { effects: [{ name: 'Curse', gm_only: true }] }, C), ['Ogre Curse (GM only)']);
});

test('token states: dead, down (unconscious or dying), and who cannot see', () => {
  assert.equal(tokenState({ dead: true }, 'player', C), 'dead');
  assert.equal(tokenState({ effects: [{ id: 'unconscious' }] }, 'player', C), 'down');
  assert.equal(tokenState({ effects: [{ id: 'dying', value: 1 }] }, 'player', C), 'down');
  assert.equal(tokenState({ effects: [{ id: 'dying', value: 1, gm_only: true }] }, 'player', C), null);
  assert.equal(tokenState({ effects: [{ id: 'prone' }] }, 'player', C), null);
  assert.ok(cannotSee({ dead: true }, C));
  for (const id of ['blinded', 'unconscious', 'petrified']) assert.ok(cannotSee({ effects: [{ id }] }, C), id);
  assert.ok(cannotSee({ effects: [{ id: 'dying', value: 1 }] }, C));
  assert.equal(cannotSee({ effects: [{ id: 'dazzled' }] }, C), false);
});

test('editing effects: replace by id, check values, remove', () => {
  let e = withEffect([], { id: 'frightened', value: 2 }, C);
  e = withEffect(e, { id: 'frightened', value: 1 }, C);
  assert.deepEqual(e, [{ id: 'frightened', value: 1 }]);
  assert.throws(() => withEffect([], { id: 'frightened' }, C), /needs a value/);
  assert.throws(() => withEffect([], { id: 'prone', value: 2 }, C), /takes no value/);
  assert.throws(() => withEffect([], { id: 'dying', value: 5 }, C), /no higher than 4/);
  assert.throws(() => withEffect([], { id: 'cursed' }, C), /not a condition/);
  e = withEffect(e, { name: 'Bless', kind: 'good', gm_only: false }, C);
  assert.deepEqual(e[1], { name: 'Bless', kind: 'good' });
  assert.deepEqual(withoutEffect(e, 'Bless'), [{ id: 'frightened', value: 1 }]);
});

test('effect CLI: add, custom, remove, clear, dead and alive on a token record', () => {
  const tok = { name: 'Lyra', x: 3, y: 4, kind: 'pc' };
  let r = applyEffect(tok, 'add', ['frightened', '2'], { source: 'Demoralize' }, C);
  assert.deepEqual(r.token.effects, [{ id: 'frightened', value: 2, source: 'Demoralize' }]);
  assert.deepEqual(r.changed, ['Frightened 2']);
  r = applyEffect(r.token, 'custom', ['Bless'], { kind: 'good', gmOnly: true }, C);
  assert.deepEqual(r.token.effects[1], { name: 'Bless', kind: 'good', gm_only: true });
  r = applyEffect(r.token, 'remove', ['frightened'], {}, C);
  assert.equal(r.token.effects.length, 1);
  r = applyEffect(r.token, 'clear', [], {}, C);
  assert.equal(r.token.effects, undefined);
  r = applyEffect(r.token, 'dead', [], {}, C);
  assert.equal(r.token.dead, true);
  r = applyEffect(r.token, 'alive', [], {}, C);
  assert.equal(r.token.dead, undefined);
  r = applyEffect(r.token, 'elevation', ['15'], {}, C);
  assert.equal(r.token.elevation, 15); assert.deepEqual(r.changed, ['elevation +15 ft']);
  r = applyEffect(r.token, 'elevation', ['-10'], {}, C);
  assert.equal(r.token.elevation, -10);
  r = applyEffect(r.token, 'elevation', ['0'], {}, C);
  assert.equal(r.token.elevation, undefined);
  assert.throws(() => applyEffect(tok, 'elevation', ['high'], {}, C), /whole number/);
  assert.throws(() => applyEffect(tok, 'remove', ['prone'], {}, C), /no effect/);
  assert.throws(() => applyEffect(tok, 'custom', ['prone'], {}, C), /is a condition/);
  assert.equal(tok.effects, undefined, 'the input is not changed');
});
