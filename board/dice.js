// Dice statistics: a log of every die rolled at the table, and the numbers worked out from it (as the previous
// board's Dice statistics panel did). One record per roll, dice/<time36>-<n>: who rolled, their side, what kind of
// roll, and every die that landed (both dice of a roll twice and keep one). Kept apart from the chat, so clearing
// the chat never wipes the statistics; part of the save (dice.json). Pure; board/diceui.js draws it. Docs:
// docs/design/board.md (dice statistics), docs/best-practices/board.md (dice statistics).
//
// A record: {at, by ('claude' | 'gm' | 'player'), who (the public name), token?, side ('party' | 'others'),
//            kind (the ruleset's roll kinds: 'initiative', 'attack'...; else 'other'), dice: [{sides, v}], gm?}
// gm: true is a roll players must not know about (a hidden creature's): only the GM view counts it.

export const DICE = 'dice';

let seq = 0;
/** A time-sortable path for a new record: dice/<time36>-<n><random>. */
export function dicePath(now = Date.now(), rnd = Math.random) {
  return `${DICE}/${Math.floor(now).toString(36).padStart(9, '0')}-${(seq++).toString(36)}${rnd().toString(36).slice(2, 6)}`;
}

/** A token's side for the statistics: the party (PCs) or everyone else. */
export const sideOf = (t) => (t && t.kind === 'pc' ? 'party' : 'others');

/** A dice record: checks the dice, drops empty fields. */
export function diceRecord({ who, token = null, side = 'others', kind = 'other', dice, by = 'gm', gm = false, at = null }) {
  const list = (dice || []).map((d) => ({ sides: Number(d.sides), v: Number(d.v) }));
  if (!list.length) throw new Error('a dice record needs at least one die');
  for (const d of list) if (!(d.sides >= 2) || !Number.isInteger(d.v) || d.v < 1 || d.v > d.sides) throw new Error(`a d${d.sides} cannot show ${d.v}`);
  const out = { at: at || new Date().toISOString(), by, who: String(who || 'Someone'), side: side === 'party' ? 'party' : 'others', kind: String(kind || 'other'), dice: list };
  if (token) out.token = token;
  if (gm) out.gm = true;
  return out;
}

/** The dice of a check (rollCheck's result: dice and sides). */
export const checkDice = (r) => (r.dice || []).map((v) => ({ sides: r.sides || 20, v }));
/** The dice of a formula roll (rollFormula's result: rolls [{die: 'd6', results}]). */
export const formulaDice = (r) => (r.rolls || []).flatMap((x) => x.results.map((v) => ({ sides: Number(String(x.die).slice(1)), v })));

/**
 * The records a view counts, filtered: side ('all' | 'party' | 'others'), kind ('all' or a kind), since (an ISO time
 * or null for all time). Players never count the GM's rolls.
 */
export function filterDice(list, { view = 'player', side = 'all', kind = 'all', since = null } = {}) {
  return list.filter((d) => (view === 'gm' || !d.gm) && (side === 'all' || d.side === side) && (kind === 'all' || d.kind === kind) && (!since || d.at >= since));
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/**
 * The statistics of some records: {rolls (records), dice (count), byDie: [{sides, n, avg, fair}], faces(sides) ->
 * [count of 1, 2 ...], extremes(sides) -> {top, one}, byRoller(sides) -> [{who, n, avg, best, worst, top, one}]}.
 */
export function diceStats(list) {
  const by = new Map(), rollers = new Map();
  for (const d of list) for (const x of d.dice) {
    (by.get(x.sides) || by.set(x.sides, []).get(x.sides)).push(x.v);
    const k = `${x.sides}|${d.who}`;
    (rollers.get(k) || rollers.set(k, { who: d.who, sides: x.sides, v: [] }).get(k)).v.push(x.v);
  }
  const byDie = [...by.entries()].sort((a, b) => a[0] - b[0]).map(([sides, v]) => ({ sides, n: v.length, avg: mean(v), fair: (sides + 1) / 2 }));
  return {
    rolls: list.length,
    dice: byDie.reduce((n, d) => n + d.n, 0),
    byDie,
    faces: (sides) => { const c = Array(sides).fill(0); for (const v of by.get(sides) || []) c[v - 1]++; return c; },
    extremes: (sides) => { const v = by.get(sides) || []; return { top: v.filter((x) => x === sides).length, one: v.filter((x) => x === 1).length }; },
    byRoller: (sides) => [...rollers.values()].filter((r) => r.sides === sides)
      .map((r) => ({ who: r.who, n: r.v.length, avg: mean(r.v), best: Math.max(...r.v), worst: Math.min(...r.v), top: r.v.filter((x) => x === sides).length, one: r.v.filter((x) => x === 1).length }))
      .sort((a, b) => b.n - a.n || a.who.localeCompare(b.who)),
  };
}

/** When "this session" starts: the GM's marked start (state/session), else the start of today (local time). */
export function sessionStart(session, now = new Date()) {
  if (session && session.started) return session.started;
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
