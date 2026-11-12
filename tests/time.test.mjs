// Time: Golarion's calendar, the game clock, durations and when effects run out, the encounter engine, and
// PF2E's turn rules (frightened, persistent damage, fast healing, recovery checks, effects ending with what they
// granted), through the tools Claude uses (clock.mjs, encounter.mjs, effect.mjs) and the save.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dayNumber, dateOf, readClock, clockAt, parseDate, adventureDay, isLeap, DAY } from '../engine/time/calendar.js';
import { parseAmount, durationSeconds, effectExpired, describeDuration } from '../engine/time/clock.js';
import * as E from '../engine/time/encounter.js';
import { rollFormula, seededRandom } from '../engine/rules/dice.js';
import { GOLARION_CALENDAR as G } from '../rulesets/pf2e/calendar.js';
import { PF2E_SYSTEM } from '../rulesets/pf2e/system.js';
import { persistentParts } from '../rulesets/pf2e/turns.js';
import { PF2E_CONDITIONS } from '../rulesets/pf2e/conditions.js';
import { loadGame } from '../tools/actor.mjs';
import { runClock } from '../tools/clock.mjs';
import { runEncounter } from '../tools/encounter.mjs';
import { applyEffect, durationFrom } from '../tools/effect.mjs';
import { campaignRecords, saveFromRecords } from '../board/records.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'examples/sample-pack'), KEEP = path.join(ROOT, 'examples/campaigns/keep-test');
const KERRA = 'tok-cw77vfz9', RAT = 'tok-gqrwstot', VARSHA = 'tok-u1t8r9h7';

test('Golarion calendar: months, weekdays matching ours 2,700 years on, leap days every four years', () => {
  const day = (y, m, d) => dateOf(G, dayNumber(G, { year: y, month: m, day: d }));
  assert.equal(day(4724, 1, 1).weekdayName, 'Moonday');            // 1 January 2024 was a Monday
  assert.equal(day(4724, 2, 29).weekdayName, 'Oathday');           // 29 February 2024, a Thursday
  assert.equal(day(4725, 4, 14).weekdayName, 'Moonday');           // 14 April 2025, a Monday
  assert.deepEqual([isLeap(G, 4724), isLeap(G, 4725), isLeap(G, 4728)], [true, false, true]);
  assert.throws(() => dayNumber(G, { year: 4725, month: 2, day: 29 }), /Calistril 4725 has no day 29/);
  for (let n = dayNumber(G, { year: 4719, month: 12, day: 25 }); n < dayNumber(G, { year: 4731, month: 1, day: 5 }); n++) assert.equal(dayNumber(G, dateOf(G, n)), n);
  const t = clockAt(G, parseDate(G, '14 Gozran 4725 AR, 10:32'));
  assert.equal(readClock(G, t).text, 'Moonday, 14 Gozran 4725 AR, 10:32');
  assert.deepEqual(parseDate(G, '3 neth 4725'), { year: 4725, month: 11, day: 3, hour: 0, minute: 0 });
  assert.throws(() => parseDate(G, '3 Smarch 4725'), /not a month/);
  assert.equal(adventureDay(t, t + 2 * DAY + 3600), 3);
  assert.equal(adventureDay(t, t + 14 * 3600), 2, 'past midnight is the next day');
});

test('durations: amounts of time, and when an effect runs out in and out of encounters', () => {
  assert.deepEqual(parseAmount('10 minutes'), { value: 10, unit: 'minutes' });
  assert.deepEqual(parseAmount('1 round'), { value: 1, unit: 'rounds' });
  assert.throws(() => parseAmount('soon'), /not an amount/);
  assert.equal(durationSeconds({ value: 10, unit: 'minutes' }), 600);
  assert.equal(describeDuration({ value: 1, unit: 'rounds', expiry: 'turn-end' }), '1 round, until the end of the turn');
  // "until the end of your next turn": cast on Kerra's turn at T; it runs out at the end of her turn a round later
  const fx = { duration: { value: 1, unit: 'rounds', expiry: 'turn-end' }, start: { time: 600, turnOf: 'k' } };
  const ctx = (now, event) => ({ now, event, combatants: ['k', 'r'], roundSeconds: 6 });
  assert.equal(effectExpired(fx, ctx(600, { type: 'turn-end', token: 'k' })), false, 'not at the end of this turn');
  assert.equal(effectExpired(fx, ctx(606, { type: 'turn-start', token: 'k' })), false);
  assert.equal(effectExpired(fx, ctx(606, { type: 'turn-end', token: 'r' })), false, 'someone else\'s turn');
  assert.equal(effectExpired(fx, ctx(606, { type: 'turn-end', token: 'k' })), true);
  assert.equal(effectExpired(fx, ctx(612, { type: 'turn-start', token: 'r' })), true, 'past its time');
  // out of an encounter: once the time has passed
  const minute = { duration: { value: 1, unit: 'minutes' }, start: { time: 0 } };
  assert.equal(effectExpired(minute, { now: 59, event: { type: 'time' } }), false);
  assert.equal(effectExpired(minute, { now: 60, event: { type: 'time' } }), true);
  assert.equal(effectExpired({ duration: { unit: 'encounter' }, start: { time: 0 } }, { now: 9999, event: { type: 'time' } }), false);
  assert.equal(effectExpired({ duration: { unit: 'encounter' }, start: { time: 0 } }, { now: 6, event: { type: 'encounter-end' } }), true);
  assert.equal(effectExpired({ duration: { unit: 'unlimited' } }, { now: 1e9, event: { type: 'time' } }), false);
});

test('the encounter engine: order with ties (foes first), turns, rounds moving the clock, delay and resume', () => {
  const tb = PF2E_SYSTEM.time.tiebreak;
  let e = E.newEncounter(0);
  for (const [token, side, initiative] of [['pc1', 'pc', 15], ['foe1', 'foe', 15], ['pc2', 'pc', 20], ['foe2', 'foe', 3]]) e = E.addCombatant(e, { token, side, initiative }, tb);
  assert.deepEqual(e.combatants.map((c) => c.token), ['pc2', 'foe1', 'pc1', 'foe2'], 'a tie: the foe goes first');
  assert.throws(() => E.next(e, 0), /not begun/);
  let r = E.begin(e, 100);
  assert.deepEqual(r.events.map((x) => x.type), ['round-start', 'turn-start']);
  let now = 100;
  const types = [];
  for (let i = 0; i < 4; i++) { r = E.next(r.encounter, now, 6); now = r.now; types.push(r.events.map((x) => `${x.type}${x.token ? ':' + x.token : ''}`).join(' ')); }
  assert.deepEqual(types.at(-1), 'turn-end:foe2 round-end round-start turn-start:pc2');
  assert.equal(now, 106, 'a new round: 6 seconds on');
  r = E.delay(r.encounter, now, 6);
  assert.equal(r.events[0].delayed, true);
  assert.equal(E.acting(r.encounter), 'foe1');
  r = E.resume(r.encounter, 'pc2', now);
  assert.equal(E.acting(r.encounter), 'pc2');
  assert.ok(r.encounter.combatants.findIndex((c) => c.token === 'pc2') < r.encounter.combatants.findIndex((c) => c.token === 'foe1'));
  r = E.removeCombatant(r.encounter, 'pc2', now, 6);
  assert.equal(E.acting(r.encounter), 'foe1', 'the next creature acts');
  r = E.end(r.encounter, now);
  assert.deepEqual(r.events.map((x) => x.type), ['turn-end', 'encounter-end']);
  assert.throws(() => E.next(r.encounter, now), /over/);
});

test('dice for the rules\' own rolls: formulas, and seeded rolls that repeat', () => {
  const a = rollFormula('2d6+3', seededRandom(7)), b = rollFormula('2d6+3', seededRandom(7));
  assert.deepEqual(a, b);
  assert.ok(a.total >= 5 && a.total <= 15);
  assert.equal(rollFormula('4').total, 4);
  assert.throws(() => rollFormula('2d6; alert(1)'), /not a dice formula/);
  assert.deepEqual(persistentParts({ detail: '1d6 fire, 2 bleed' }), [{ formula: '1d6', type: 'fire' }, { formula: '2', type: 'bleed' }]);
});

/** The keep test with the clock set, a few badges, and an encounter of Kerra, the rat and Varsha Kell. */
function setup() {
  const g = loadGame(PACK, KEEP);
  g.clock = runClock(g, 'set', ['1 Pharast 4725 AR, 08:00'], {}).writes[0].data;
  runEncounter(g, 'start', ['Kerra', 'Wet-Nosed Rat', 'Varsha Kell'], {});
  for (const [w, n] of [['Kerra', 22], ['Varsha Kell', 17], ['Wet-Nosed Rat', 14]]) runEncounter(g, 'init', [w, n], {});
  return g;
}

test('turn rules: frightened goes down, persistent damage and its flat check, recovery checks, effects ending with what they granted', () => {
  const g = setup();
  g.tokens[RAT].effects = [{ id: 'frightened', value: 2 }, { id: 'persistent', detail: '1d4 fire' }];
  g.states[RAT] = { hp: 6 };
  const t0 = g.clock.now;
  // Kerra is under an effect that made her off-guard, until the end of her next turn
  g.tokens[KERRA].effects = [{ id: 'off-guard', source: 'Feint' }, { name: 'Feinted', kind: 'bad', duration: { value: 1, unit: 'rounds', expiry: 'turn-end' }, start: { time: t0, turnOf: KERRA }, grants: ['off-guard'] }];
  runEncounter(g, 'begin', [], { seed: 1 });
  runEncounter(g, 'next', [], { seed: 1 });                 // Kerra -> Varsha
  assert.ok(g.tokens[KERRA].effects.some((e) => e.name === 'Feinted'), 'not at the end of this turn');
  runEncounter(g, 'next', [], { seed: 1 });                 // Varsha -> rat
  const out = runEncounter(g, 'next', [], { seed: 3 });     // rat's turn ends: persistent damage, flat check, frightened
  const text = out.lines.join('\n');
  assert.match(text, /Wet-Nosed Rat: persistent damage 1d4 = \(\d\) = \d fire/);
  assert.match(text, /flat check to end 1d4 fire persistent damage: \d+ against DC 15/);
  assert.match(text, /Wet-Nosed Rat: frightened goes down to 1/);
  assert.match(text, /— round 2 —\nKerra's turn/);
  assert.equal(g.tokens[RAT].effects.find((e) => e.id === 'frightened').value, 1);
  assert.ok(out.writes.some((w) => w.path === `actorstate/${RAT}`) && out.writes.some((w) => w.path === 'state/clock' && w.data.now === t0 + 6));
  const end = runEncounter(g, 'next', [], { seed: 1 });      // Kerra's turn ends: Feinted runs out, and the off-guard it granted
  assert.match(end.lines.join('\n'), /Kerra: Feinted ends \(and off-guard\)/);
  assert.deepEqual(g.tokens[KERRA].effects, []);
  // frightened held by a ruling does not go down
  g.tokens[RAT].effects = [{ id: 'frightened', value: 2, noDecrease: true }];
  runEncounter(g, 'next', [], {});
  runEncounter(g, 'next', [], {});
  assert.equal(g.tokens[RAT].effects[0].value, 2);
});

test('turn rules: a dying creature rolls its recovery check at the start of its turn; fast healing', () => {
  const g = setup();
  g.tokens[KERRA].effects = [{ id: 'dying', value: 1 }, { id: 'unconscious' }];
  g.states[KERRA] = { hp: 0 };
  const r = runEncounter(g, 'begin', [], { seed: 5 });
  assert.match(r.lines.join('\n'), /Kerra: recovery check \d+: /);
  // a creature with fast healing heals at the start of its turn
  const g2 = setup();
  g2.actors[VARSHA] = { ...g2.actors[VARSHA], rules: [{ key: 'fast-healing', value: 2 }] };
  g2.states[VARSHA] = { hp: 5 };
  runEncounter(g2, 'begin', [], {});
  const fh = runEncounter(g2, 'next', [], {});
  assert.match(fh.lines.join('\n'), /Varsha Kell: fast healing 2; .*5 → 7/);
});

test('the clock: set, Day 1, advancing runs out effects, and not while an encounter is under way', () => {
  const g = loadGame(PACK, KEEP);
  assert.throws(() => runClock(g, 'advance', ['1 hour'], {}), /not set/);
  g.clock = runClock(g, 'set', ['1 Pharast 4725 AR, 08:00'], {}).writes[0].data;
  assert.equal(runClock(g, 'show', [], {}).lines[0], 'Starday, 1 Pharast 4725 AR, 08:00 (Day 1)');
  g.tokens[KERRA].effects = [{ name: 'Bless', kind: 'good', duration: { value: 1, unit: 'minutes' }, start: { time: g.clock.now } }, { name: 'Ward', kind: 'good', duration: { value: 1, unit: 'hours' }, start: { time: g.clock.now } }];
  const r = runClock(g, 'advance', ['10 minutes'], {});
  assert.match(r.lines[0], /08:00 \(Day 1\) → Starday, 1 Pharast 4725 AR, 08:10 \(Day 1\)/);
  assert.match(r.lines.join('\n'), /Kerra: Bless ends/);
  assert.deepEqual(r.writes.find((w) => w.path === `tokens/${KERRA}`).data.effects.map((e) => e.name), ['Ward']);
  g.clock = r.writes[0].data;
  const night = runClock(g, 'until', ['07:00'], {});
  assert.match(night.lines[0], /→ Sunday, 2 Pharast 4725 AR, 07:00 \(Day 2\)/);
  runEncounter(g, 'start', ['Kerra'], {});
  runEncounter(g, 'init', ['Kerra', 10], {});
  runEncounter(g, 'begin', [], {});
  assert.throws(() => runClock(g, 'advance', ['1 minute'], {}), /encounter is under way/);
});

test('effects get durations and a start: from the document, the options, the clock and whose turn it is', () => {
  assert.deepEqual(durationFrom({ duration: '1 round', expiry: 'turn-end' }), { value: 1, unit: 'rounds', expiry: 'turn-end' });
  assert.deepEqual(durationFrom({}, { value: 10, unit: 'minutes', expiry: 'turn-start' }), { value: 10, unit: 'minutes', expiry: 'turn-start' });
  assert.equal(durationFrom({}, { unit: 'unlimited' }), undefined);
  assert.throws(() => durationFrom({ duration: '1 round', expiry: 'later' }), /--expiry/);
  const doc = { kind: 'effect', name: 'Effect: Shaken', duration: { value: 1, unit: 'rounds', expiry: 'turn-end' }, rules: [{ key: 'grant-condition', condition: 'frightened', value: 1 }] };
  const out = applyEffect({ name: 'Rat' }, 'apply', ['x:effect/shaken'], { doc, start: { time: 50, turnOf: KERRA } }, PF2E_CONDITIONS);
  assert.deepEqual(out.token.effects, [{ id: 'frightened', value: 1, source: 'Shaken' }, { name: 'Shaken', kind: 'good', ref: 'x:effect/shaken', duration: { value: 1, unit: 'rounds', expiry: 'turn-end' }, start: { time: 50, turnOf: KERRA }, grants: ['frightened'] }]);
  assert.deepEqual(applyEffect(out.token, 'remove', ['Shaken'], {}, PF2E_CONDITIONS).token.effects, undefined, 'its condition goes with it');
});

test('the save keeps the clock and the encounter; the validator checks the encounter\'s creatures', async () => {
  const g = setup();
  const records = { 'board/meta': { campaign: { id: 'c', title: 'C' }, pack: { id: 'sample-pack', version: '1' }, ruleset: 'pf2e', maps: [] }, 'state/table': {}, 'state/clock': g.clock, 'state/encounter': g.encounter };
  const { campaign } = saveFromRecords(records);
  assert.deepEqual([campaign.clock, campaign.encounter], [g.clock, g.encounter]);
  const back = campaignRecords({ campaign: { id: 'c', ...campaign }, pack: { id: 'sample-pack', ruleset: 'pf2e' }, maps: [] });
  assert.deepEqual([back['state/clock'], back['state/encounter']], [g.clock, g.encounter]);
  const fs = await import('node:fs'), os = await import('node:os');
  const { validate } = await import('../tools/validate.mjs');
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'rvtt-time-'));
  fs.cpSync(PACK, path.join(t, 'pack'), { recursive: true }); fs.cpSync(KEEP, path.join(t, 'save'), { recursive: true });
  const cf = path.join(t, 'save/campaign.json'), camp = JSON.parse(fs.readFileSync(cf, 'utf8'));
  fs.writeFileSync(cf, JSON.stringify({ ...camp, clock: g.clock, encounter: g.encounter }));
  assert.deepEqual(validate(path.join(t, 'pack'), { save: path.join(t, 'save') }).errors.map((e) => e.msg), []);
  fs.writeFileSync(cf, JSON.stringify({ ...camp, clock: g.clock, encounter: { ...g.encounter, combatants: [...g.encounter.combatants, { token: 'tok-zzzzzzzz', side: 'foe' }] } }));
  assert.match(validate(path.join(t, 'pack'), { save: path.join(t, 'save') }).errors.map((e) => e.msg).join('\n'), /no token "tok-zzzzzzzz"/);
  fs.rmSync(t, { recursive: true, force: true });
});
