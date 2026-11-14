#!/usr/bin/env node
// The game clock and calendar from chat (engine/time/calendar.js, the ruleset's calendar: Golarion's Absalom
// Reckoning for PF2E). The clock counts seconds; Day 1 is the day the adventure started. Advancing it runs out
// effects whose time has passed (the ruleset's turn rules), outside encounters (rounds pass in tools/encounter.mjs).
//
// Usage:
//   node tools/clock.mjs <pack-dir> <save-dir> [--records FILE] show
//   node tools/clock.mjs <pack-dir> <save-dir> [--records FILE] set "14 Gozran 4725 AR, 08:00" [--start]
//   node tools/clock.mjs <pack-dir> <save-dir> [--records FILE] start            (today is Day 1)
//   node tools/clock.mjs <pack-dir> <save-dir> [--records FILE] advance "10 minutes" | "8 hours" | "2 days"
//   node tools/clock.mjs <pack-dir> <save-dir> [--records FILE] until 07:00      (the next time it is 07:00)
//
// Prints JSON {lines, writes} (state/clock, and tokens/ for effects that ran out): write each with db_write.
// Docs: docs/best-practices/game-data.md (time and encounters).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readClock, clockAt, parseDate, adventureDay, DAY, HOUR, MINUTE } from '../engine/time/calendar.js';
import { parseAmount, unitSeconds } from '../engine/time/clock.js';
import { loadGame } from './actor.mjs';
import { runTurnRules, randomSource } from './turns.mjs';
import { gameArgs } from './campaign.mjs';

/** The clock in words: "Moonday, 14 Gozran 4725 AR, 10:32 (Day 3)". */
export function describeClock(cal, clock) {
  if (!clock) return 'the clock is not set (clock.mjs set "<date>")';
  const r = readClock(cal, clock.now);
  return `${r.text}${r.second ? `:${String(r.second).padStart(2, '0')}` : ''}${clock.start !== undefined ? ` (Day ${adventureDay(clock.start, clock.now)})` : ''}`;
}

/** Run one clock command: {lines, writes}. */
export function runClock(game, cmd, args, opts = {}) {
  const T = game.sys.time;
  if (!T || !T.calendar) throw new Error('this ruleset has no calendar');
  const cal = T.calendar, clock = game.clock ? { ...game.clock } : null;
  const write = (c) => ({ op: 'set', path: 'state/clock', data: c });
  if (cmd === 'show') return { lines: [describeClock(cal, clock), ...(game.encounter && game.encounter.ended == null && game.encounter.round > 0 ? [`encounter: round ${game.encounter.round}`] : [])], writes: [] };
  if (cmd === 'set') {
    const now = clockAt(cal, parseDate(cal, args[0]));
    const c = { now, ...(clock && clock.start !== undefined && !opts.start ? { start: clock.start } : { start: now }) };
    return { lines: [`the clock is set to ${describeClock(cal, c)}`], writes: [write(c)] };
  }
  if (!clock) throw new Error('the clock is not set: clock.mjs set "<date>" first');
  if (cmd === 'start') {
    const c = { ...clock, start: clock.now };
    return { lines: [`Day 1 is today: ${describeClock(cal, c)}`], writes: [write(c)] };
  }
  let to;
  if (cmd === 'advance') {
    const a = parseAmount(args[0]);
    to = clock.now + a.value * unitSeconds(a.unit, T.roundSeconds);
  } else if (cmd === 'until') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(args[0] || '');
    if (!m) throw new Error('until HH:MM');
    const target = Number(m[1]) * HOUR + Number(m[2]) * MINUTE, into = clock.now % DAY;
    to = clock.now - into + target + (target <= into ? DAY : 0);
  } else throw new Error('commands: show, set, start, advance, until');
  if (game.encounter && game.encounter.ended == null && game.encounter.round > 0) throw new Error('an encounter is under way: rounds pass with encounter.mjs next (end it first)');
  const c = { ...clock, now: to };
  const r = runTurnRules(game, [{ type: 'time', from: clock.now, to }], { now: to, encounter: null, rng: randomSource(opts.seed) });
  return { lines: [`${describeClock(cal, clock)} → ${describeClock(cal, c)}`, ...r.lines], writes: [write(c), ...r.writes] };
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const rec = opt('--records'), seed = opt('--seed'), start = flag('--start');
    const [pack, save, cmd, ...rest] = gameArgs(args);
    if (!save || !cmd) throw new Error('give a save folder (or a pack folder and a save folder) and a command (show, set, start, advance, until)');
    const game = loadGame(pack, save, rec ? JSON.parse(fs.readFileSync(rec, 'utf8')) : null);
    const out = runClock(game, cmd, rest, { seed, start });
    console.log(cmd === 'show' ? out.lines.join('\n') : JSON.stringify(out, null, 2));
    return 0;
  } catch (e) {
    console.error(`clock: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
