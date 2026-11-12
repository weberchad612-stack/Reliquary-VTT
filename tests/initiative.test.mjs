// Initiative: the roll dialog's rows and changes (engine/rules/check.js), PF2E's initiative statistic with its
// modifiers and notes (rulesets/pf2e/initiative.js), the encounter's defeated, hidden and previous turn
// (engine/time/encounter.js), and Claude's tool writing the same records as the board.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeStatistic } from '../engine/rules/rules.js';
import { checkRows, adjustCheck, rollCheck, countedParts, notesFor } from '../engine/rules/check.js';
import * as E from '../engine/time/encounter.js';
import { PF2E_SYSTEM } from '../rulesets/pf2e/system.js';
import { loadGame, creature } from '../tools/actor.mjs';
import { runEncounter } from '../tools/encounter.mjs';
import { diceWords, chipWords } from '../board/rolls.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const game = () => loadGame(path.join(ROOT, 'examples/sample-pack'), path.join(ROOT, 'examples/campaigns/keep-test'));
const stacks = PF2E_SYSTEM.initiative.stacks;

test('the roll dialog: rows, switching off and on, adding, stacking by type', () => {
  const st = makeStatistic({ slug: 'x', label: 'Stealth', base: 17, parts: [{ label: 'Dexterity', value: 5, type: 'attribute' }, { label: 'proficiency (expert)', value: 12, type: 'proficiency' }],
    modifiers: [{ slug: 'acp', label: 'Armor check penalty', type: 'untyped', value: -1, when: ['armor:flexible'] }, { slug: 'rune', label: 'shadow rune', type: 'item', value: 1 }, { slug: 'ii', label: 'Incredible Initiative', type: 'circumstance', value: 2 }], tags: new Set(), stacks });
  assert.equal(st.value, 20);
  const rows = checkRows(st);
  assert.deepEqual(rows.map((r) => [r.label, r.type, r.value, r.on]), [['Dexterity', 'attribute', 5, true], ['proficiency (expert)', 'proficiency', 12, true], ['Armor check penalty', 'untyped', -1, false], ['shadow rune', 'item', 1, true], ['Incredible Initiative', 'circumstance', 2, true]]);
  assert.equal(rows[2].why, 'does not apply now');
  assert.equal(adjustCheck(st, { on: ['m0'] }, { stacks }).value, 19, 'the penalty switched on');
  assert.equal(adjustCheck(st, { off: ['m2', 'p0'] }, { stacks }).value, 13);
  // a second circumstance bonus: only the bigger counts
  const more = adjustCheck(st, { add: [{ label: 'Aid', type: 'circumstance', value: 1 }] }, { stacks });
  assert.equal(more.value, 20);
  assert.equal(adjustCheck(st, { add: [{ label: 'Inspire', type: 'status', value: 1 }, { label: 'x', type: 'untyped', value: 2 }] }, { stacks }).value, 23);
  assert.deepEqual(countedParts(more).map((p) => p.label), ['Dexterity', 'proficiency (expert)', 'shadow rune', 'Incredible Initiative']);
});

test('rolling: one die, or two keeping the higher or lower; dice given', () => {
  const st = { value: 7 };
  assert.deepEqual(rollCheck(st, { dice: [12] }), { dice: [12], kept: 12, mod: 7, total: 19, mode: 'normal', sides: 20 });
  assert.equal(rollCheck(st, { mode: 'higher', dice: [4, 15] }).total, 22);
  assert.equal(rollCheck(st, { mode: 'lower', dice: [4, 15] }).total, 11);
  const r = rollCheck(st, { rng: () => 0.999 });
  assert.equal(r.kept, 20);
  assert.equal(diceWords({ mode: 'normal', sides: 20, mod: 17 }), '1d20 + 17');
  assert.equal(diceWords({ mode: 'higher', sides: 20, mod: -1 }), '2d20 keep higher − 1');
  assert.equal(chipWords({ label: 'proficiency (master)', value: 14 }), 'Master +14');
});

test('notes on a roll: by selector, holding now, the feat\'s own text', () => {
  const notes = [{ selectors: ['initiative'], text: '{item|system.description.value}', origin: { label: 'Battle Cry', text: 'When you roll initiative, you can yell a battle cry.' } },
    { selectors: ['attack'], text: 'x' }, { selectors: ['initiative'], text: 'only raging', when: ['raging'] }];
  assert.deepEqual(notesFor(notes, ['initiative', 'perception']), [{ text: 'When you roll initiative, you can yell a battle cry.', from: 'Battle Cry' }]);
  assert.equal(notesFor(notes, ['initiative'], ['raging']).length, 2);
});

test('PF2E initiative: Perception or a skill, typed parts, initiative modifiers', () => {
  const g = game();
  const kerra = creature(g, 'Kerra').prepared, I = PF2E_SYSTEM.initiative;
  const list = I.statistics(kerra);
  assert.deepEqual(list[0], { slug: 'perception', label: 'Perception' });
  assert.ok(list.some((s) => s.slug === 'stealth'));
  const st = I.statistic(kerra, 'perception');
  assert.equal(st.value, kerra.perception.value);
  assert.deepEqual(st.parts.map((p) => p.type), ['attribute', 'proficiency']);
  assert.equal(I.statistic(kerra, 'nope'), null);
  // an initiative modifier (Incredible Initiative) counts on any statistic
  const withFeat = { ...kerra, rollModifiers: [...kerra.rollModifiers, { slug: 'ii', label: 'Incredible Initiative', type: 'circumstance', value: 2, selectors: ['initiative'] }] };
  assert.equal(I.statistic(withFeat, 'stealth').value, kerra.skills.stealth.value + 2);
  assert.deepEqual(I.noteSelectors('stealth'), ['initiative', 'stealth']);
});

test('encounter: defeated skipped, hidden kept, previous turn, initiative cleared', () => {
  const tb = PF2E_SYSTEM.time.tiebreak;
  let e = E.newEncounter(0);
  for (const [t, i] of [['tok-aaaaaaaa', 20], ['tok-bbbbbbbb', 15], ['tok-cccccccc', 10]]) e = E.addCombatant(e, { token: t, side: 'foe', initiative: i }, tb);
  e = E.setFlags(e, 'tok-bbbbbbbb', { defeated: true, hidden: true });
  assert.deepEqual(e.combatants[1], { token: 'tok-bbbbbbbb', side: 'foe', initiative: 15, defeated: true, hidden: true });
  let r = E.begin(e, 0);
  r = E.next(r.encounter, r.now, 6);
  assert.equal(E.acting(r.encounter), 'tok-cccccccc', 'the defeated one is skipped');
  const back = E.previous(r.encounter, r.now, 6);
  assert.equal(E.acting(back.encounter), 'tok-aaaaaaaa');
  assert.deepEqual(back.events, []);
  r = E.next(r.encounter, r.now, 6);   // round 2
  assert.equal(r.encounter.round, 2);
  const b2 = E.previous(r.encounter, r.now, 6);
  assert.deepEqual([b2.encounter.round, E.acting(b2.encounter), b2.now], [1, 'tok-cccccccc', r.now - 6]);
  assert.equal(E.setFlags(e, 'tok-bbbbbbbb', { defeated: false }).combatants[1].defeated, undefined);
  const set = E.setInitiative(e, 'tok-aaaaaaaa', 18, tb, { stat: 'stealth', roll: { dice: [11] } });
  assert.equal(set.combatants[0].stat, 'stealth');
  assert.equal(E.setInitiative(set, 'tok-aaaaaaaa', null, tb).combatants.find((c) => c.token === 'tok-aaaaaaaa').initiative, undefined);
});

test('Claude\'s tool: roll with a statistic, the roll card record, defeat and hide', () => {
  const g = game();
  runEncounter(g, 'start', ['Kerra', 'Pip'], {});
  const out = runEncounter(g, 'roll', ['Kerra'], { roll: 10, stat: 'stealth', seed: 1 });
  const enc = out.writes.find((w) => w.path === 'state/encounter').data;
  const k = enc.combatants.find((c) => c.stat === 'stealth');
  assert.equal(k.initiative, 10 + creature(g, 'Kerra').prepared.skills.stealth.value);
  assert.deepEqual(k.roll.dice, [10]);
  const card = out.writes.find((w) => w.path.startsWith('rolls/'));
  assert.match(card.path, /^rolls\/[0-9a-z]{9}-/);
  assert.equal(card.data.kind, 'initiative');
  assert.equal(card.data.stat.label, 'Stealth');
  assert.equal(card.data.total, k.initiative);
  assert.ok(card.data.parts.length >= 2);
  const d = runEncounter(g, 'defeat', ['Pip'], {});
  assert.ok(d.writes[0].data.combatants.find((c) => c.defeated));
  assert.match(runEncounter(g, 'show', [], {}).lines.join('\n'), /defeated/);
});
