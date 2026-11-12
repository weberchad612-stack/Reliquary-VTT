// The game clock, durations and when an effect runs out, for any game system. The clock counts seconds
// (engine/time/calendar.js gives the date); the system says how long a round is. Effects carry a duration
// {value, unit, expiry} and a start {time, turnOf, round}: they run out once their time has passed, or, on the
// last moment, at the start or end of the turn of the creature whose turn it was when they began (turnOf), or at
// the end of the round. This is how Foundry's PF2E system counts too. Docs: docs/design/game-data.md section 8.

import { MINUTE, HOUR, DAY } from './calendar.js';

export const UNITS = Object.freeze(['rounds', 'minutes', 'hours', 'days', 'encounter', 'unlimited']);
export const EXPIRY = Object.freeze(['turn-start', 'turn-end', 'round-end']);
const SINGULAR = { round: 'rounds', minute: 'minutes', min: 'minutes', hour: 'hours', hr: 'hours', day: 'days', week: 'weeks', weeks: 'weeks' };

/** Seconds in one of a unit (a round is the system's round length). Encounter and unlimited have none. */
export function unitSeconds(unit, roundSeconds = 6) {
  return { rounds: roundSeconds, minutes: MINUTE, hours: HOUR, days: DAY, weeks: 7 * DAY }[unit];
}

/** "10 minutes", "1 round", "8 hours", "2 days", "1 week" -> {value, unit}. */
export function parseAmount(text) {
  const m = /^\s*(\d+)\s*([a-z]+)\s*$/i.exec(String(text || ''));
  const unit = m && (SINGULAR[m[2].toLowerCase()] || m[2].toLowerCase());
  if (!m || !['rounds', 'minutes', 'hours', 'days', 'weeks'].includes(unit)) throw new Error(`"${text}" is not an amount of time like "10 minutes", "1 round", "8 hours", "2 days"`);
  return { value: Number(m[1]), unit };
}

/** A duration's length in seconds (Infinity for encounter and unlimited). */
export function durationSeconds(d, roundSeconds = 6) {
  if (!d || d.unit === 'unlimited' || d.unit === 'encounter') return Infinity;
  const per = unitSeconds(d.unit, roundSeconds);
  if (per === undefined) throw new Error(`"${d.unit}" is not a unit of time (${UNITS.join(', ')})`);
  return (d.value ?? 1) * per;
}

/** A duration in words: "1 round, until the end of the turn", "10 minutes", "until the encounter ends". */
export function describeDuration(d) {
  if (!d || d.unit === 'unlimited') return 'unlimited';
  if (d.unit === 'encounter') return 'until the encounter ends';
  const n = d.value ?? 1, u = n === 1 ? d.unit.replace(/s$/, '') : d.unit;
  const when = { 'turn-start': ', until the start of the turn', 'turn-end': ', until the end of the turn', 'round-end': ', until the end of the round' }[d.expiry] || '';
  return `${n} ${u}${when}`;
}

/**
 * Has an effect run out? effect: {duration, start: {time, turnOf}}. ctx: {now, event?: {type: 'turn-start' |
 * 'turn-end' | 'round-end' | 'encounter-end' | 'time', token?}, combatants?: [token ids] (the encounter's; none
 * outside one), roundSeconds}. Out of an encounter, an effect runs out once its time has passed; in one, on its
 * last moment it waits for its turn boundary.
 */
export function effectExpired(effect, ctx) {
  const d = effect.duration;
  if (!d || d.unit === 'unlimited') return false;
  const ev = ctx.event || {};
  if (d.unit === 'encounter') return ev.type === 'encounter-end';
  if (!effect.start || typeof effect.start.time !== 'number') return false;
  const inEncounter = !!(ctx.combatants && ctx.combatants.length);
  let length = durationSeconds(d, ctx.roundSeconds);
  // "until the end of this turn" (0 rounds) outside an encounter: it lasts until the next round's worth of time
  if (!inEncounter && length === 0 && d.unit === 'rounds' && (d.expiry === 'turn-end' || d.expiry === 'round-end')) length = ctx.roundSeconds || 6;
  const remaining = effect.start.time + length - ctx.now;
  if (remaining < 0) return true;
  if (remaining > 0) return false;
  if (!inEncounter || !d.expiry) return true;
  const turnOf = effect.start.turnOf;
  // the creature whose turn it measures from has left the encounter: the end of the round will do
  if (d.expiry !== 'round-end' && (!turnOf || !ctx.combatants.includes(turnOf))) return ev.type === 'round-end' || ev.type === 'turn-end' || ev.type === 'turn-start';
  if (d.expiry === 'turn-start') return ev.type === 'turn-start' && ev.token === turnOf;
  if (d.expiry === 'turn-end') return ev.type === 'turn-end' && ev.token === turnOf;
  return ev.type === 'round-end';
}

/** What an effect has left, in seconds (Infinity when it does not run out by time). */
export function remainingSeconds(effect, now, roundSeconds = 6) {
  const d = effect.duration;
  if (!d || d.unit === 'unlimited' || d.unit === 'encounter' || !effect.start) return Infinity;
  return effect.start.time + durationSeconds(d, roundSeconds) - now;
}
