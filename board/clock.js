// The game clock on the board: the date and time in the title line for everyone; in the GM view, the clock
// editor (quick steps, any amount, a date and time, Day 1). Moving the clock on runs out timed effects on every
// token. Pure functions over the engine's time functions (passed in as `T`: Engine.readClock, adventureDay,
// clockAt, parseAmount, unitSeconds, expireEffects), so they can be tested without a page.
// Docs: docs/best-practices/board.md (the clock), docs/design/game-data.md section 8.

/** The editor's quick steps: seconds to add, or a time of day to go on to. */
export const QUICK_STEPS = Object.freeze([
  { id: 'q-1m', label: '+1 minute', add: 60 },
  { id: 'q-10m', label: '+10 minutes', add: 600 },
  { id: 'q-1h', label: '+1 hour', add: 3600 },
  { id: 'q-8h', label: 'Rest 8 hours', add: 8 * 3600 },
  { id: 'q-morning', label: 'Next morning (07:00)', until: 7 * 3600 },
]);

/** A time of day on a 12-hour clock: "8:00 AM", "12:30 PM", "8:00:06 AM" (seconds when there are some). */
export function time12(hour, minute, second = 0) {
  const h = hour % 12 || 12, p = (n) => String(n).padStart(2, '0');
  return `${h}:${p(minute)}${second ? `:${p(second)}` : ''} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** The clock in words for the title line: "Starday, 1 Pharast 4725 AR · 8:00 AM · Day 1" (null if not set). */
export function clockLabel(T, cal, clock) {
  if (!clock || typeof clock.now !== 'number') return null;
  const r = T.readClock(cal, clock.now);
  const time = time12(r.hour, r.minute, r.second);
  return `${r.weekdayName}, ${r.dateText} · ${time}${typeof clock.start === 'number' ? ` · Day ${T.adventureDay(clock.start, clock.now)}` : ''}`;
}

/** The clock after a quick step (by its id). */
export function quickTarget(clock, id) {
  const q = QUICK_STEPS.find((x) => x.id === id);
  if (!q) throw new Error(`no quick step "${id}"`);
  if (q.add) return clock.now + q.add;
  const day = 86400, into = ((clock.now % day) + day) % day;
  return clock.now - into + q.until + (q.until <= into ? day : 0);
}

/** The clock after an amount typed by the GM ("3 hours", "2 days"). */
export function amountTarget(T, clock, text, roundSeconds = 6) {
  const a = T.parseAmount(text);
  return clock.now + a.value * T.unitSeconds(a.unit, roundSeconds);
}

/** Seconds of a date set in the editor: {day, month (1-12), year, time: "HH:MM"}. Throws on a date that does not exist. */
export function setTarget(T, cal, { day, month, year, time }) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '00:00'));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error('the time is HH:MM');
  return T.clockAt(cal, { year: Number(year), month: Number(month), day: Number(day), hour: Number(m[1]), minute: Number(m[2]) });
}

/** The fields of the editor's date for a clock reading: {day, month, year, time}. */
export function setFields(T, cal, clock) {
  const r = T.readClock(cal, clock.now);
  return { day: r.day, month: r.month, year: r.year, time: r.time };
}

/** Is an encounter under way? (Then time moves by rounds, not from the clock editor.) */
export const encounterUnderWay = (enc) => !!(enc && enc.ended == null && enc.round > 0);

/**
 * Timed effects that ran out when the clock moved on to `now`: {changed: {id: effects}, lines: [{id, text:
 * "Kerra: Bless ends"}]}, for the tokens given ({id: token}); `name(id, token)` gives the name to log.
 */
export function expireAll(T, tokens, now, roundSeconds, name = (id, t) => t.name || id) {
  const changed = {}, lines = [];
  for (const [id, t] of Object.entries(tokens || {})) {
    const { kept, gone } = T.expireEffects(t.effects, { now, event: { type: 'time' }, roundSeconds });
    if (!gone.length) continue;
    changed[id] = kept;
    for (const e of gone) lines.push({ id, text: `${name(id, t)}: ${e.name || e.id} ends${e.grants && e.grants.length ? ` (and ${e.grants.join(', ')})` : ''}` });
  }
  return { changed, lines };
}
