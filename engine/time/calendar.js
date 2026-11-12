// Calendars and the game clock's time of day, for any game system: the system gives the calendar (months, week,
// leap days, era), the engine counts. The clock is a number of seconds since the start of year 1 of the
// calendar. Docs: docs/design/game-data.md section 8.

export const SECOND = 1;
export const MINUTE = 60;
export const HOUR = 3600;
export const DAY = 86400;

/**
 * A calendar: {id, era, months: [{name, days}], weekdays: [name], leap: {every, offset?, month, days?},
 * anchor: {year, month, day, weekday}} (a date whose weekday is known; month and weekday counted from 1 and 0).
 * A year is a leap year when (year - offset) is divisible by `every`; the leap day goes at the end of `month`.
 */
export function checkCalendar(cal) {
  if (!cal || !Array.isArray(cal.months) || !cal.months.length) throw new Error('a calendar needs months');
  if (!Array.isArray(cal.weekdays) || !cal.weekdays.length) throw new Error('a calendar needs weekdays');
  return cal;
}

export const isLeap = (cal, year) => !!cal.leap && (year - (cal.leap.offset || 0)) % cal.leap.every === 0;
const monthDays = (cal, year, m) => cal.months[m - 1].days + (isLeap(cal, year) && cal.leap.month === m ? (cal.leap.days || 1) : 0);
export const yearDays = (cal, year) => cal.months.reduce((n, mo) => n + mo.days, 0) + (isLeap(cal, year) ? (cal.leap.days || 1) : 0);

/** Days from the start of year 1 to the start of `year` (years 1 and later). */
function daysBeforeYear(cal, year) {
  const base = cal.months.reduce((n, mo) => n + mo.days, 0);
  let leaps = 0;
  if (cal.leap) { const off = cal.leap.offset || 0, e = cal.leap.every; const upto = (y) => Math.floor((y - off) / e); leaps = (upto(year - 1) - upto(0)) * (cal.leap.days || 1); }
  return (year - 1) * base + leaps;
}

/** The day number (0 = the first day of year 1) of a date {year, month, day}. Throws on a date that does not exist. */
export function dayNumber(cal, { year, month, day }) {
  if (!Number.isInteger(year) || year < 1) throw new Error(`year ${year}: years start at 1`);
  if (!Number.isInteger(month) || month < 1 || month > cal.months.length) throw new Error(`month ${month} is not a month of this calendar`);
  if (!Number.isInteger(day) || day < 1 || day > monthDays(cal, year, month)) throw new Error(`${cal.months[month - 1].name} ${year} has no day ${day}`);
  let n = daysBeforeYear(cal, year);
  for (let m = 1; m < month; m++) n += monthDays(cal, year, m);
  return n + day - 1;
}

/** The date of a day number: {year, month, day, monthName, weekday, weekdayName, leapDay}. */
export function dateOf(cal, dayNo) {
  let year = Math.max(1, Math.floor(dayNo / 365.25) + 1);
  while (year > 1 && daysBeforeYear(cal, year) > dayNo) year--;
  while (daysBeforeYear(cal, year + 1) <= dayNo) year++;
  let rest = dayNo - daysBeforeYear(cal, year), month = 1;
  while (rest >= monthDays(cal, year, month)) { rest -= monthDays(cal, year, month); month++; }
  const day = rest + 1, a = cal.anchor || { year: 1, month: 1, day: 1, weekday: 0 };
  const w = cal.weekdays.length, weekday = (((dayNo - dayNumber(cal, a) + a.weekday) % w) + w) % w;
  return { year, month, day, monthName: cal.months[month - 1].name, weekday, weekdayName: cal.weekdays[weekday], leapDay: day > cal.months[month - 1].days };
}

/** A clock reading (seconds) in words: {date, time: 'hh:mm', text: 'Toilday, 14 Gozran 4725 AR, 10:32'}. */
export function readClock(cal, seconds) {
  const s = Math.floor(seconds), dayNo = Math.floor(s / DAY), into = s - dayNo * DAY;
  const date = dateOf(cal, dayNo), hh = Math.floor(into / HOUR), mm = Math.floor((into % HOUR) / MINUTE), ss = into % MINUTE;
  const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  return { ...date, hour: hh, minute: mm, second: ss, time, dateText: `${date.day} ${date.monthName} ${date.year}${cal.era ? ` ${cal.era}` : ''}`, text: `${date.weekdayName}, ${date.day} ${date.monthName} ${date.year}${cal.era ? ` ${cal.era}` : ''}, ${time}` };
}

/** Seconds of a date and time of day: {year, month, day, hour?, minute?, second?}. */
export function clockAt(cal, d) {
  return dayNumber(cal, d) * DAY + (d.hour || 0) * HOUR + (d.minute || 0) * MINUTE + (d.second || 0);
}

/**
 * A date written the calendar's way, "14 Gozran 4725 AR" or "14 Gozran 4725", optionally with a time "08:30".
 * Month names match without regard to case; the era may be left out.
 */
export function parseDate(cal, text) {
  const m = /^\s*(\d{1,2})\s+([A-Za-z'-]+)\s+(\d{1,6})(?:\s+[A-Za-z]+)?(?:[,\s]+(\d{1,2}):(\d{2}))?\s*$/.exec(String(text || ''));
  if (!m) throw new Error(`"${text}" is not a date like "1 ${cal.months[0].name} ${cal.anchor ? cal.anchor.year : 1}${cal.era ? ` ${cal.era}` : ''}"`);
  const month = cal.months.findIndex((mo) => mo.name.toLowerCase() === m[2].toLowerCase()) + 1;
  if (!month) throw new Error(`"${m[2]}" is not a month (${cal.months.map((mo) => mo.name).join(', ')})`);
  return { year: Number(m[3]), month, day: Number(m[1]), hour: m[4] ? Number(m[4]) : 0, minute: m[5] ? Number(m[5]) : 0 };
}

/** The day of the adventure (Day 1 is the day it started), from the clock and the adventure's start. */
export function adventureDay(start, now) {
  return Math.floor(now / DAY) - Math.floor(start / DAY) + 1;
}
