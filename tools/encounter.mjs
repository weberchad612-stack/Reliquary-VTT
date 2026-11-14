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
//   roll <who> [--roll D] [--stat S] [--mode higher|lower]
//                                      roll initiative: d20 (or D) + Perception (or the skill S, such as stealth),
//                                      with initiative's modifiers and notes; also writes the roll card (a chat message, chat/)
//   defeat <who> [--undo]              mark defeated (its turns are skipped; the token shows dead) or not
//   hide <who> [--undo]                hide the token from players (map, tracker, rolls) or show it again
//   previous                           back one turn (a correction: no turn rules run)
//   next-round                         end this turn and the round; the next round's first turn (the rest skipped)
//   previous-round                     back to the start of the round before (a correction)
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
import { rollCheck, countedParts, notesFor } from '../engine/rules/check.js';
import { rollRecord } from '../board/rolls.js';
import { chatPath } from '../board/chat.js';
import { auditPath, auditEntry } from '../board/audit.js';
import { dicePath, diceRecord, checkDice, sideOf as diceSide } from '../board/dice.js';
import { resolveToken, publicName } from '../board/names.js';
import { loadGame, creature } from './actor.mjs';
import { runTurnRules, randomSource } from './turns.mjs';
import { describeClock } from './clock.mjs';
import { adjustCheck } from '../engine/rules/check.js';
import { exploreRules, initiativeHint, startRequests } from '../board/explore.js';
import { partyOf, choicesOf } from './exploration.mjs';

const sideOf = (t) => (['pc', 'npc', 'foe'].includes(t.kind) ? t.kind : 'foe');

/** The encounter in words: round, order, who is acting. */
export function describeEncounter(game, enc) {
  if (!enc) return ['no encounter'];
  const name = (id) => (game.tokens[id] || {}).name || id;
  const out = [`${enc.ended != null ? 'ended' : enc.round > 0 ? `round ${enc.round}` : 'not begun'}${game.clock ? `; ${describeClock(game.sys.time.calendar, game.clock)}` : ''}`];
  enc.combatants.forEach((c, i) => out.push(`${i === enc.turn ? '▶' : ' '} ${typeof c.initiative === 'number' ? String(c.initiative).padStart(2) : ' ?'}  ${name(c.token)} (${c.side})${c.delayed ? ' delaying' : ''}${c.defeated ? ' defeated' : ''}${c.hidden ? ' hidden' : ''}`));
  return out;
}

/** Run one encounter command: {lines, writes}. */
export function runEncounter(game, cmd, args, opts = {}) {
  const T = game.sys.time, tb = T.tiebreak, rng = randomSource(opts.seed);
  let enc = game.encounter && game.encounter.ended == null ? game.encounter : null;
  const now0 = game.clock ? game.clock.now : 0;
  const who = (w) => resolveToken(game.tokens, w);
  const name = (id) => game.tokens[id].name || publicName(game.tokens[id]) || id;
  const done = (e, lines, events = [], now = now0) => {
    // each event in turn, so the log reads in order: the end of one turn, the new round, the next turn; every line
    // goes to the GM's audit log, as the board does (the players' chat has no events since 2026-11-12)
    const out = [...lines], changed = new Map();
    for (const ev of events) {
      if (ev.type === 'round-start') out.push(`— round ${ev.round} —`);
      if (ev.type === 'turn-start') out.push(`${name(ev.token)}'s turn`);
      const r = runTurnRules(game, [ev], { now: ev.type === 'turn-end' || ev.type === 'round-end' ? now0 : now, encounter: e, rng });
      out.push(...r.lines);
      for (const w of r.writes) changed.set(w.path, w);
    }
    const writes = [{ op: 'set', path: 'state/encounter', data: e }];
    for (const text of out) writes.push({ op: 'set', path: auditPath(), data: auditEntry({ text: text.replace(/^— (.*) —$/, '$1'), by: 'claude', map: (game.campaign || {}).current_map || null }) });
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
    const id = who(args[0]), c = creature(game, id), I = game.sys.initiative;
    if (!I) throw new Error('this game system has no initiative rules');
    // the PC's exploration activity: Avoid Notice rolls Stealth, Scout gives the party a bonus (board/explore.js)
    const hint = game.tokens[id].kind === 'pc' ? initiativeHint(exploreRules(game.sys), id, partyOf(game), choicesOf(game.records)) : { stat: null, add: [] };
    const slug = opts.stat || (hint.stat && I.statistic(c.prepared, hint.stat) ? hint.stat : 'perception');
    const st0 = I.statistic(c.prepared, slug);
    const st = st0 && hint.add.length ? adjustCheck(st0, { add: hint.add }, { stacks: I.stacks }) : st0;
    if (!st) throw new Error(`${name(id)} has no ${slug}`);
    const r = rollCheck(st, { mode: opts.mode || 'normal', rng, dice: opts.roll !== undefined ? [Number(opts.roll)] : null, sides: I.die });
    const label = (I.statistics(c.prepared).find((x) => x.slug === slug) || {}).label || slug;
    const parts = countedParts(st), notes = notesFor(c.prepared.notes, I.noteSelectors(slug), c.prepared.tags, c.prepared.facts);
    const roll = { dice: r.dice, kept: r.kept, mode: r.mode, sides: r.sides, mod: r.mod, parts };
    const out = done(E.setInitiative(enc, id, r.total, tb, { stat: slug, roll }), [`${name(id)}: initiative ${r.dice.join('/')} ${r.mod < 0 ? '−' : '+'} ${Math.abs(r.mod)} (${label}${hint.add.length ? `; ${hint.add.map((a) => `${a.label} ${a.value > 0 ? '+' : ''}${a.value}`).join(', ')}` : ''}) = ${r.total}`, ...notes.map((n) => `  ${n.from}: ${n.text}`)]);
    const gm = !!(enc.combatants.find((x) => x.token === id) || {}).hidden || !!game.tokens[id].hidden;
    out.writes.push({ op: 'set', path: chatPath(), data: rollRecord({ by: 'claude', token: id, name: publicName(game.tokens[id]) || name(id), check: 'initiative', stat: { slug, label }, roll: r, mod: r.mod, total: r.total, parts, notes, gm }) });
    // the dice, for the Dice tab's statistics (board/dice.js)
    out.writes.push({ op: 'set', path: dicePath(), data: diceRecord({ who: publicName(game.tokens[id]) || name(id), token: id, side: diceSide(game.tokens[id]), kind: 'initiative', dice: checkDice(r), by: 'claude', gm }) });
    return out;
  }
  if (cmd === 'defeat') {
    // as the board's tracker: the token shows dead on the map (faded, red cross) and back; hit points are not touched
    const id = who(args[0]), out = done(E.setFlags(enc, id, { defeated: !opts.undo }), [`${name(id)}: ${opts.undo ? 'no longer ' : ''}defeated`]);
    if (game.tokens[id]) {
      out.writes.push({ op: 'update', path: `tokens/${id}`, data: { dead: opts.undo ? { __delete__: true } : true } });
      if (opts.undo) delete game.tokens[id].dead; else game.tokens[id].dead = true;
    }
    return out;
  }
  if (cmd === 'hide') {
    // the token itself is hidden (as the board's token menu and the tracker's eye do): players never see it
    const id = who(args[0]), out = done(E.setFlags(enc, id, { hidden: false }), [`${name(id)}: ${opts.undo ? 'shown to' : 'hidden from'} players`]);
    out.writes.push({ op: 'update', path: `tokens/${id}`, data: { hidden: opts.undo ? { __delete__: true } : true } });
    if (opts.undo) delete game.tokens[id].hidden; else game.tokens[id].hidden = true;
    return out;
  }
  if (cmd === 'next-round') { const r = E.nextRound(enc, now0, T.roundSeconds); return done(r.encounter, [], r.events, r.now); }
  if (cmd === 'previous-round') { const r = E.previousRound(enc, now0, T.roundSeconds); return done(r.encounter, [`back to the start of round ${r.encounter.round}`], [], r.now); }
  if (cmd === 'previous') { const r = E.previous(enc, now0, T.roundSeconds); return done(r.encounter, [E.acting(r.encounter) ? `back to ${name(E.acting(r.encounter))}'s turn` : 'already at the first turn'], [], r.now); }
  if (cmd === 'begin') {
    // the exploration activities that act before the first turn (Defend's raised shield): into the live state first,
    // so the first turn's rules see them (a raised shield lowers at its owner's turn start)
    const reqs = startRequests(exploreRules(game.sys), partyOf(game), choicesOf(game.records), enc.combatants.map((c) => c.token));
    const pre = [];
    for (const q of reqs) {
      if (q.kind === 'state') { game.states[q.token] = { ...(game.states[q.token] || {}), ...q.patch }; pre.push({ op: 'update', path: `actorstate/${q.token}`, data: q.patch }); }
      if (q.kind === 'effect') { const t = game.tokens[q.token]; game.tokens[q.token] = { ...t, effects: [...(t.effects || []), q.effect] }; pre.push({ op: 'update', path: `tokens/${q.token}`, data: { effects: game.tokens[q.token].effects } }); }
    }
    const r = E.begin(enc, now0);
    const out = done(r.encounter, ['The encounter begins', ...reqs.map((q) => q.label)], r.events, r.now);
    const later = new Set(out.writes.map((w) => w.path));
    out.writes.splice(1, 0, ...pre.filter((w) => !later.has(w.path)));   // the turn rules' own write of the same record wins
    return out;
  }
  if (cmd === 'next') { const r = E.next(enc, now0, T.roundSeconds); return done(r.encounter, [], r.events, r.now); }
  if (cmd === 'delay') { const id = E.acting(enc); const r = E.delay(enc, now0, T.roundSeconds); return done(r.encounter, [`${name(id)} delays`], r.events, r.now); }
  if (cmd === 'resume') { const id = who(args[0]); const r = E.resume(enc, id, now0); return done(r.encounter, [`${name(id)} stops delaying`], r.events, r.now); }
  if (cmd === 'remove') { const id = who(args[0]); const r = E.removeCombatant(enc, id, now0, T.roundSeconds); return done(r.encounter, [`${name(id)} leaves the encounter`], r.events, r.now); }
  if (cmd === 'end') {
    const r = E.end(enc, now0);
    const out = done(r.encounter, [`The encounter ends after ${enc.round} round(s)`], r.events, r.now);
    // the fight's groups have ended: events waiting on them read these flags (tools/events.mjs; engine/events)
    const groups = [...new Set(enc.combatants.map((c) => (game.tokens[c.token] || {}).group).filter(Boolean))];
    if (groups.length) {
      const flags = { ...(game.flags || {}) };
      for (const g of groups) flags[`ended:${g}`] = r.now;
      game.flags = flags;
      out.writes.push({ op: 'set', path: 'state/flags', data: flags });
      out.lines.push('Check events: node tools/events.mjs ... due (a fight ended)');
    }
    return out;
  }
  throw new Error('commands: show, start, add, init, roll, defeat, hide, begin, next, previous, next-round, previous-round, delay, resume, remove, end');
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const rec = opt('--records'), seed = opt('--seed'), init = opt('--init'), roll = opt('--roll'), stat = opt('--stat'), mode = opt('--mode'), all = flag('--all'), undo = flag('--undo');
    const [pack, save, cmd, ...rest] = args;
    if (!pack || !save || !cmd) throw new Error('give a pack folder, a save folder and a command');
    const game = loadGame(pack, save, rec ? JSON.parse(fs.readFileSync(rec, 'utf8')) : null);
    const out = runEncounter(game, cmd, rest, { seed, init, roll, stat, mode, all, undo });
    console.log(cmd === 'show' ? out.lines.join('\n') : JSON.stringify(out, null, 2));
    return 0;
  } catch (e) {
    console.error(`encounter: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
