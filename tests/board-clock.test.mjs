// The clock on the board (board/clock.js): the title line's words, the GM editor's steps, amounts and dates, and
// timed effects running out when the clock moves on. The page itself is checked headless (docs/best-practices/board.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readClock, adventureDay, clockAt } from '../engine/time/calendar.js';
import { parseAmount, unitSeconds, expireEffects } from '../engine/time/clock.js';
import { GOLARION_CALENDAR as G } from '../rulesets/pf2e/calendar.js';
import { QUICK_STEPS, time12, clockLabel, quickTarget, amountTarget, setTarget, setFields, encounterUnderWay, expireAll } from '../board/clock.js';

const T = { readClock, adventureDay, clockAt, parseAmount, unitSeconds, expireEffects };
const at = (d) => clockAt(G, d);
const C = { now: at({ year: 4725, month: 3, day: 1, hour: 8 }), start: at({ year: 4725, month: 3, day: 1, hour: 8 }) };

test('the title line: weekday, date, time and the day of the adventure; nothing when the clock is not set', () => {
  assert.equal(clockLabel(T, G, C), 'Starday, 1 Pharast 4725 AR · 8:00 AM · Day 1');
  assert.equal(clockLabel(T, G, { now: C.now + 6 }), 'Starday, 1 Pharast 4725 AR · 8:00:06 AM', 'seconds show during rounds; no Day without a start');
  assert.equal(clockLabel(T, G, { ...C, now: C.now + 2 * 86400 + 5 * 3600 }), 'Moonday, 3 Pharast 4725 AR · 1:00 PM · Day 3');
  assert.deepEqual([time12(0, 0), time12(12, 0), time12(23, 59), time12(11, 5, 7)], ['12:00 AM', '12:00 PM', '11:59 PM', '11:05:07 AM']);
  assert.equal(clockLabel(T, G, null), null);
});

test('the editor: quick steps, any amount, a date and time, and the fields it starts from', () => {
  assert.deepEqual(QUICK_STEPS.map((q) => q.id), ['q-1m', 'q-10m', 'q-1h', 'q-8h', 'q-morning']);
  assert.equal(quickTarget(C, 'q-10m') - C.now, 600);
  assert.equal(quickTarget(C, 'q-8h') - C.now, 8 * 3600);
  assert.equal(readClock(G, quickTarget(C, 'q-morning')).text, 'Sunday, 2 Pharast 4725 AR, 07:00', 'after 07:00: the next day');
  assert.equal(readClock(G, quickTarget({ now: C.now - 3 * 3600 }, 'q-morning')).text, 'Starday, 1 Pharast 4725 AR, 07:00', 'before 07:00: the same day');
  assert.equal(amountTarget(T, C, '3 hours') - C.now, 3 * 3600);
  assert.throws(() => amountTarget(T, C, 'a while'), /not an amount/);
  assert.equal(readClock(G, setTarget(T, G, { day: 14, month: 4, year: 4725, time: '10:32' })).text, 'Moonday, 14 Gozran 4725 AR, 10:32');
  assert.throws(() => setTarget(T, G, { day: 31, month: 2, year: 4725, time: '10:00' }), /Calistril 4725 has no day 31/);
  assert.throws(() => setTarget(T, G, { day: 1, month: 2, year: 4725, time: '25:00' }), /HH:MM/);
  assert.deepEqual(setFields(T, G, C), { day: 1, month: 3, year: 4725, time: '08:00' });
  assert.equal(encounterUnderWay({ round: 2, combatants: [] }), true);
  assert.equal(encounterUnderWay({ round: 2, combatants: [], ended: 5 }), false);
  assert.equal(encounterUnderWay(null), false);
});

test('moving the clock on runs out timed effects, with the conditions they granted', () => {
  const tokens = {
    a: { name: 'Kerra', effects: [{ name: 'Bless', duration: { value: 1, unit: 'minutes' }, start: { time: C.now } }, { id: 'frightened', value: 1 }] },
    b: { name: 'Rat', effects: [{ id: 'off-guard' }, { name: 'Feinted', duration: { value: 1, unit: 'hours' }, start: { time: C.now }, grants: ['off-guard'] }] },
    c: { name: 'Lyra' },
  };
  const ten = expireAll(T, tokens, C.now + 600, 6);
  assert.deepEqual(ten.changed, { a: [{ id: 'frightened', value: 1 }] });
  assert.deepEqual(ten.lines, [{ id: 'a', text: 'Kerra: Bless ends' }]);
  const hours = expireAll(T, tokens, C.now + 2 * 3600, 6);
  assert.deepEqual(hours.changed.b, []);
  assert.deepEqual(hours.lines.map((l) => l.text), ['Kerra: Bless ends', 'Rat: Feinted ends (and off-guard)']);
});
