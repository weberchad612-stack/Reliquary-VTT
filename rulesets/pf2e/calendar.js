// Golarion's calendar, Absalom Reckoning (AR), as Pathfinder Second Edition gives it: twelve months named for
// deities, a seven-day week, and a leap day at the end of Calistril every four years (4724 AR was one; first
// edition used eight years). Weekdays follow Paizo's convention that AR years run 2,700 ahead of ours with
// matching weekdays, so 1 Abadius 4724 AR was a Moonday. Source: Pathfinder Wiki, "Absalom Reckoning".

export const GOLARION_CALENDAR = Object.freeze({
  id: 'absalom-reckoning',
  label: 'Absalom Reckoning',
  era: 'AR',
  months: Object.freeze([
    { name: 'Abadius', days: 31, common: 'Prima' },
    { name: 'Calistril', days: 28, common: 'Snappe' },
    { name: 'Pharast', days: 31, common: 'Anu' },
    { name: 'Gozran', days: 30, common: 'Rusanne' },
    { name: 'Desnus', days: 31, common: 'Farlong' },
    { name: 'Sarenith', days: 30, common: 'Sola' },
    { name: 'Erastus', days: 31, common: 'Fletch' },
    { name: 'Arodus', days: 31, common: 'Hazen' },
    { name: 'Rova', days: 30, common: 'Nuvar' },
    { name: 'Lamashan', days: 31, common: 'Shaldo' },
    { name: 'Neth', days: 30, common: 'Joya' },
    { name: 'Kuthona', days: 31, common: 'Kai' },
  ]),
  weekdays: Object.freeze(['Moonday', 'Toilday', 'Wealday', 'Oathday', 'Fireday', 'Starday', 'Sunday']),
  leap: Object.freeze({ every: 4, offset: 0, month: 2, days: 1 }),
  anchor: Object.freeze({ year: 4724, month: 1, day: 1, weekday: 0 }),
});

/** A round of encounter time, in seconds. */
export const ROUND_SECONDS = 6;
