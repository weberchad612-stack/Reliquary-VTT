#!/usr/bin/env node
// Encounters from chat (engine/time/encounter.js), until the board has a tracker: who is in it, initiative,
// round and turn. Moving on a turn runs the ruleset's turn rules (rulesets/pf2e/turns.js): persistent damage
// and its flat check, frightened going down, fast healing and regeneration, recovery checks, effects running
// out; a new round moves the clock on one round (6 seconds in PF2E).
//
// Usage: node tools/encounter.mjs <pack-dir> <save-dir> [--records FILE] [--seed N] <command> ...
//   show
//   start [<who> ...] [--all]          a new encounter with these creatures (--all: every creature with game
//                                       data on the current map, not dead)
//   add <who> [--init N]               join (sides from the token: pc, foe, npc)
//   init <who> <N>                     set an initiative result
//   roll <who> [--roll D] [--stat S]   roll initiative: d20 (or D) + Perception (or the skill S, such as stealth)
//   begin                              round 1, the first turn
//   next                               end this turn, start the next (and a new round after the last)
//   delay                              the acting creature delays (its end-of-turn rules happen now)
//   resume <who>                       a delaying creature acts now
//   remove <who>                       out of the encounter (dead, fled)
//   end                                the encounter is over (effects lasting for it end)
//
// <who> is a token's name, alias or id. Prints JSON {lines, writes}: write each with db_write (state/encounter,
// state/clock, tokens/, actorstate/) and add the lines to the log. Dice for the rules' own rolls are random
// (--seed N repeats them). Docs: docs/best-practices/game-data.md (time and encounters).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../engine/time/encounter.js';
import { rollDie } from '../engine/rules/dice.js';
import { resolveToken, publicName } from '../board/names.js';
import { loadGame, creature } from './actor.mjs';
import { runTurnRules, randomSource } from './turns.mjs';
import { describeClock } from './clock.mjs';

const sideOf = (t) => (['pc', 'npc', 'foe'].includes(t.kind) ? t.kind : 'foe');

/** The encounter in words: round, order, who is acting. */
export function describeEncounter(game, enc) {
  if (!enc) return ['no encounter'];
  const name = (id) => (game.tokens[id] || {}).name || id;
  const out = [`${enc.ended ? 'ended' : enc.round > 0 ? `round ${enc.round}` : 'not begun'}${game.clock ? `; ${describeClock(game.sys.time.calendar, game.clock)}` : ''}`];
  enc.combatants.forEach((c, i) => out.push(`${i === enc.turn ? '▶' : ' '} ${typeof c.initiative === 'number' ? String(c.initiative).padStart(2) : ' ?'}  ${name(c.token)} (${c.side})${c.delayed ? ' delaying' : ''}`));
  return out;
}

/** Run one encounter command: {lines, writes}. */
export function runEncounter(game, cmd, args, opts = {}) {
  const T = game.sys.time, tb = T.tiebreak, rng = randomSource(opts.seed);
  let enc = game.encounter && !game.encounter.ended ? game.encounter : null;
  const now0 = game.clock ? game.clock.now : 0;
  const who = (w) => resolveToken(game.tokens, w);
  const name = (id) => game.tokens[id].name || publicName(game.tokens[id]) || id;
  const done = (e, lines, events = [], now = now0) => {
    // each event in turn, so the log reads in order: the end of one turn, the new round, the next turn
    const out = [...lines], changed = new Map();
    for (const ev of events) {
      if (ev.type === 'round-start') out.push(`— round ${ev.round} —`);
      if (ev.type === 'turn-start') out.push(`${name(ev.token)}'s turn`);
      const r = runTurnRules(game, [ev], { now: ev.type === 'turn-end' || ev.type === 'round-end' ? now0 : now, encounter: e, rng });
      out.push(...r.lines);
      for (const w of r.writes) changed.set(w.path, w);
    }
    const writes = [{ op: 'set', path: 'state/encounter', data: e }];
    if (now !== now0) writes.push({ op: 'set', path: 'state/clock', data: { ...(game.clock || {}), now } });
    game.encounter = e;
    if (game.clock) game.clock = { ...game.clock, now };
    return { lines: out, writes: [...writes, ...changed.values()] };
  };
  if (cmd === 'show') return { lines: describeEncounter(game, enc || game.encounter), writes: [] };
  if (cmd === 'start') {
    if (enc && enc.round > 0) throw new Error('an encounter is under way: end it first');
    let ids = args.map(who);
    if (opts.all) {
      const map = game.campaign.current_map;
      ids = [...new Set([...ids, ...Object.keys(game.tokens).filter((id) => game.actors[id] && !game.tokens[id].dead && (!map || game.tokens[id].map === map))])];
    }
    let e = E.newEncounter(now0);
    for (const id of ids) e = E.addCombatant(e, { token: id, side: sideOf(game.tokens[id]) }, tb);
    return done(e, [`encounter: ${ids.length ? ids.map(name).join(', ') : 'nobody yet'}${game.clock ? '' : ' (the clock is not set: rounds will not move it)'}`]);
  }
  if (!enc) throw new Error('no encounter: start one');
  if (cmd === 'add') {
    const id = who(args[0]);
    const e = E.addCombatant(enc, { token: id, side: sideOf(game.tokens[id]), initiative: opts.init !== undefined ? Number(opts.init) : null }, tb);
    return done(e, [`${name(id)} joins the encounter${opts.init !== undefined ? ` (initiative ${opts.init})` : ''}`]);
  }
  if (cmd === 'init') {
    const id = who(args[0]), n = Number(args[1]);
    return done(E.setInitiative(enc, id, n, tb), [`${name(id)}: initiative ${n}`]);
  }
  if (cmd === 'roll') {
    const id = who(args[0]), c = creature(game, id), stat = opts.stat || 'perception';
    const s = stat === 'perception' ? c.prepared.perception : (c.prepared.skills || {})[stat];
    if (!s) throw new Error(`${name(id)} has no ${stat}`);
    const die = opts.roll !== undefined ? Number(opts.roll) : rollDie(20, rng), total = die + s.value;
    return done(E.setInitiative(enc, id, total, tb), [`${name(id)}: initiative ${die} + ${s.value} (${stat}) = ${total}`]);
  }
  if (cmd === 'begin') { const r = E.begin(enc, now0); return done(r.encounter, ['the encounter begins'], r.events, r.now); }
  if (cmd === 'next') { const r = E.next(enc, now0, T.roundSeconds); return done(r.encounter, [], r.events, r.now); }
  if (cmd === 'delay') { const id = E.acting(enc); const r = E.delay(enc, now0, T.roundSeconds); return done(r.encounter, [`${name(id)} delays`], r.events, r.now); }
  if (cmd === 'resume') { const id = who(args[0]); const r = E.resume(enc, id, now0); return done(r.encounter, [`${name(id)} stops delaying`], r.events, r.now); }
  if (cmd === 'remove') { const id = who(args[0]); const r = E.removeCombatant(enc, id, now0, T.roundSeconds); return done(r.encounter, [`${name(id)} leaves the encounter`], r.events, r.now); }
  if (cmd === 'end') { const r = E.end(enc, now0); return done(r.encounter, [`the encounter ends after ${enc.round} round(s)`], r.events, r.now); }
  throw new Error('commands: show, start, add, init, roll, begin, next, delay, resume, remove, end');
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const rec = opt('--records'), seed = opt('--seed'), init = opt('--init'), roll = opt('--roll'), stat = opt('--stat'), all = flag('--all');
    const [pack, save, cmd, ...rest] = args;
    if (!pack || !save || !cmd) throw new Error('give a pack folder, a save folder and a command');
    const game = loadGame(pack, save, rec ? JSON.parse(fs.readFileSync(rec, 'utf8')) : null);
    const out = runEncounter(game, cmd, rest, { seed, init, roll, stat, all });
    console.log(cmd === 'show' ? out.lines.join('\n') : JSON.stringify(out, null, 2));
    return 0;
  } catch (e) {
    console.error(`encounter: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
