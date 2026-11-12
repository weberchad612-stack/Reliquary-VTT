// The encounter tracker's rules on the board (board/tracker.js): rows by view, who may do what, the actions as
// changes to the encounter, and roll cards (board/rollsui.js cardHtml).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine/time/encounter.js';
import { PF2E_SYSTEM } from '../rulesets/pf2e/system.js';
import { controls, trackerRows, applyAction, needInitiative, initiativeText, eventLines, newlyDefeated } from '../board/tracker.js';
import { cardHtml } from '../board/chat.js';

const T = { tiebreak: PF2E_SYSTEM.time.tiebreak, roundSeconds: 6 };
const tokens = {
  'tok-pc000001': { name: 'Kerra', kind: 'pc' },
  'tok-foe00001': { name: 'Varsha Kell', alias: 'Hooded Cultist', kind: 'foe' },
  'tok-foe00002': { name: 'Rat', kind: 'foe' },
};
const act = (enc, a, view = 'gm', now = 0) => applyAction(enc, a, { E, T, now, view, tokens, name: (id) => tokens[id].name });

test('who controls what: the GM everything, a player the PCs', () => {
  assert.equal(controls('gm', tokens['tok-foe00001']), true);
  assert.equal(controls('player', tokens['tok-pc000001']), true);
  assert.equal(controls('player', tokens['tok-foe00001']), false);
});

test('building an encounter: players add their PCs only; the first one in makes it', () => {
  assert.throws(() => act(null, { type: 'add', token: 'tok-foe00001' }, 'player'), /own characters/);
  let r = act(null, { type: 'add', token: 'tok-pc000001' }, 'player');
  assert.deepEqual(r.encounter.combatants, [{ token: 'tok-pc000001', side: 'pc' }]);
  r = act(r.encounter, { type: 'add', token: 'tok-foe00001' });
  r = act(r.encounter, { type: 'add', token: 'tok-foe00002' });
  assert.deepEqual(needInitiative(r.encounter, tokens, 'npc'), ['tok-foe00001', 'tok-foe00002']);
  assert.deepEqual(needInitiative(r.encounter, tokens, 'all').length, 3);
  assert.throws(() => act(r.encounter, { type: 'initiative', token: 'tok-foe00001', initiative: 9 }, 'player'), /own/);
  for (const [id, n] of [['tok-pc000001', 15], ['tok-foe00001', 15], ['tok-foe00002', 4]]) r = act(r.encounter, { type: 'initiative', token: id, initiative: n, extra: { stat: 'perception' } });
  // a tie: the foe goes first (PF2E)
  assert.deepEqual(r.encounter.combatants.map((c) => c.token), ['tok-foe00001', 'tok-pc000001', 'tok-foe00002']);
  assert.throws(() => act(r.encounter, { type: 'begin' }, 'player'), /only the GM/);
  r = act(r.encounter, { type: 'begin' });
  assert.deepEqual(eventLines(r.events, (id) => tokens[id].name), ['round 1', "Varsha Kell's turn"]);
  assert.throws(() => act(r.encounter, { type: 'next' }, 'player'), /own turn/);
  r = act(r.encounter, { type: 'next' });
  // now Kerra acts: her player may end her turn
  const p = act(r.encounter, { type: 'next' }, 'player');
  assert.equal(E.acting(p.encounter), 'tok-foe00002');
  assert.throws(() => act(r.encounter, { type: 'flags', token: 'tok-foe00002', flags: { hidden: true } }, 'player'), /only the GM/);
});

test('rows by view: hidden and unseen foes are the GM\'s; defeated and dead struck', () => {
  let e = E.newEncounter(0);
  for (const [t, i] of [['tok-pc000001', 10], ['tok-foe00001', 12], ['tok-foe00002', 8]]) e = E.addCombatant(e, { token: t, side: tokens[t].kind, initiative: i }, T.tiebreak);
  e = E.setFlags(e, 'tok-foe00001', { hidden: true });
  const gm = trackerRows(e, tokens, { view: 'gm' });
  assert.equal(gm.length, 3);
  assert.equal(gm.find((r) => r.token === 'tok-foe00001').hidden, true);
  const pl = trackerRows(e, tokens, { view: 'player', seen: (id) => id !== 'tok-foe00002' });
  assert.deepEqual(pl.map((r) => r.token), ['tok-pc000001'], 'hidden by the GM, and the rat out of sight');
  assert.equal(pl[0].mine, true);
  const dead = { ...tokens, 'tok-foe00002': { ...tokens['tok-foe00002'], dead: true } };
  assert.equal(trackerRows(e, dead, { view: 'gm' }).find((r) => r.token === 'tok-foe00002').defeated, true);
  assert.deepEqual(newlyDefeated(e, dead), ['tok-foe00002']);
  assert.equal(initiativeText(26.5), '26');
  assert.deepEqual(trackerRows(null, tokens, { view: 'gm' }), []);
});

test('removing the last creature ends the encounter; delay and resume by the owner', () => {
  let r = act(null, { type: 'add', token: 'tok-pc000001' });
  r = act(r.encounter, { type: 'remove', token: 'tok-pc000001' });
  assert.notEqual(r.encounter.ended, undefined);
  let e = E.newEncounter(0);
  for (const [t, i] of [['tok-pc000001', 20], ['tok-foe00002', 4]]) e = E.addCombatant(e, { token: t, side: tokens[t].kind, initiative: i }, T.tiebreak);
  r = act(e, { type: 'begin' });
  r = act(r.encounter, { type: 'delay' }, 'player');
  assert.equal(r.encounter.combatants.find((c) => c.token === 'tok-pc000001').delayed, true);
  r = act(r.encounter, { type: 'resume', token: 'tok-pc000001' }, 'player');
  assert.equal(E.acting(r.encounter), 'tok-pc000001');
});

test('a roll card: who, the statistic, chips, notes, the dice and the total', () => {
  const html = cardHtml({ name: 'Vincent', check: 'initiative', stat: { label: 'Perception' }, by: 'player', mode: 'normal', sides: 20, mod: 17, total: 32, dice: [15], kept: 15,
    parts: [{ label: 'Wisdom', value: 2 }, { label: 'proficiency (master)', value: 14 }, { label: 'Trap Finder', value: 1 }], notes: [{ from: 'Battle Cry', text: 'When you roll initiative, you can yell.' }] });
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /Initiative: Perception Wisdom \+2 Master \+14 Trap Finder \+1 Battle Cry When you roll initiative, you can yell\. 1d20 \+ 17 32/);
  assert.match(cardHtml({ name: 'x', check: 'initiative', mode: 'higher', dice: [4, 15], kept: 15, mod: 1, total: 16, by: 'gm' }), /<s>4<\/s> <b>15<\/b>/);
});

test('a roll for a creature the players do not see is the GM\'s', async () => {
  const { rollRecord } = await import('../board/rolls.js');
  const { chatVisible, messageHtml } = await import('../board/chat.js');
  const secret = rollRecord({ name: 'Hooded Cultist', check: 'initiative', total: 12, gm: true });
  assert.equal(secret.kind, 'roll');
  assert.equal(chatVisible(secret, 'player'), false);
  assert.equal(chatVisible(secret, 'gm'), true);
  assert.equal(chatVisible(rollRecord({ name: 'Kerra', total: 9 }), 'player'), true);
  assert.match(messageHtml(secret, { view: 'gm' }), /class="cm-gm"/);
});
