#!/usr/bin/env node
// Adventure events from chat (engine/events/events.js; future/adventure-events.md): what is due from the game's
// state, running an event's stages, its decision points and the campaign's flags. Claude runs an event as soon as it
// is due (the user's decision, 2026-11-13) and tells the user afterwards; the GM sees every event in the Events tab.
//
// Usage: node tools/events.mjs <pack-dir> <save-dir> [--records FILE] <command> ...
//   (--records: the board's records: events/, state/flags, state/clock, state/encounter, state/table, tokens/,
//   actors/, actorstate/, board/meta)
//   status [id]                    every event (or one) with its state, stage and what it waits on
//   due                            what is due now and why (run with every move, rest, round and clock change)
//   tick                           do everything due: start events, take branches, move to stages whose condition
//                                  holds; prints each entered stage's actions
//   run <id> [stage]               start an event now (the GM's moment, a manual trigger), at its first stage or one
//   next <id>                      the current stage's actions are done: on to the next stage, or finish
//   go <id> <stage>                move a running event to a stage
//   finish <id>                    end an event (done, or cooling down when it repeats)
//   reset <id>                     back to waiting (the GM's call; its history is kept)
//   decide <id> <point> <choice>   record a decision made at a decision point (also in the ledger)
//   flag <name> [value]            set a flag (true when no value; a number or the word given)
//   unflag <name>                  clear a flag
//   context                        the facts the conditions read (the party's level, map, areas, the time, ...)
// Changing commands print {lines, writes} (db_write each, or apply to the save). Docs:
// docs/best-practices/events.md, docs/gm/running-a-game.md (Events).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGame, creature } from './actor.mjs';
import { readRecords } from './replay.mjs';
import { readClock } from '../engine/time/calendar.js';
import { splitEvents, holds, dueEvents, startEvent, moveTo, nextStage, finishEvent, decide, stageOf, DAY_HOURS, EVENT_STATE_FIELDS } from '../engine/events/events.js';
import { auditPath, auditEntry } from '../board/audit.js';
import { ledgerPath, ledgerEntry } from '../board/ledger.js';

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** A map's keyed rooms: {key: {title, rects: [[x, y, w, h]], outdoor?}} (tools/advimport/roomtable.py). */
function roomsOf(packDir, map) {
  const f = path.join(packDir, 'maps', map, 'rooms.json');
  return fs.existsSync(f) ? (readJson(f).rooms || {}) : {};
}
const mapOf = (packDir, map) => { const f = path.join(packDir, 'maps', map, 'map.json'); return fs.existsSync(f) ? readJson(f) : {}; };
const inRect = (x, y, [rx, ry, w, h]) => x >= rx && x < rx + w && y >= ry && y < ry + h;

/** The party's level: the average of the PCs' levels, rounded (null with none known). */
export function partyLevel(game) {
  const lv = [];
  for (const [id, t] of Object.entries(game.tokens)) {
    if (t.kind !== 'pc' || !game.actors[id]) continue;
    try { const p = creature(game, id).prepared; if (Number.isFinite(p.level)) lv.push(p.level); } catch { /* no numbers */ }
  }
  return lv.length ? Math.round(lv.reduce((a, b) => a + b, 0) / lv.length) : null;
}

/** The facts event conditions read (engine/events/events.js holds()). */
export function eventContext(game, packDir) {
  const now = game.clock ? game.clock.now : 0;
  const table = (game.records && game.records['state/table']) || {};
  const map = table.current_map || (game.campaign || {}).current_map || null;
  const cal = game.sys.time && game.sys.time.calendar;
  const hour = cal && game.clock ? readClock(cal, now).hour : 12;
  // where the PCs stand: the keyed rooms their squares are in, and whether that is outdoors
  const rooms = map ? roomsOf(packDir, map) : {};
  const areas = new Set();
  let outdoorRoom = false;
  const pcs = Object.entries(game.tokens).filter(([, t]) => t.kind === 'pc' && t.map === map && !t.dead);
  for (const [, t] of pcs) {
    for (const [k, r] of Object.entries(rooms)) if ((r.rects || []).some((rc) => inRect(t.x, t.y, rc))) { areas.add(k); if (r.outdoor) outdoorRoom = true; }
  }
  const outdoors = !!(map && (mapOf(packDir, map).outdoor || outdoorRoom));
  // what the PCs carry: each item's ref and name
  const carrying = [];
  for (const [id, t] of Object.entries(game.tokens)) {
    if (t.kind !== 'pc' || !game.actors[id]) continue;
    for (const it of game.actors[id].items || []) for (const k of ['ref', 'name']) if (it[k]) carrying.push(String(it[k]), String(it[k]).split('/').pop());
  }
  // fights that ended: the flags ended:<group> (tools/encounter.mjs end)
  const ended = Object.fromEntries(Object.entries(game.flags || {}).filter(([k]) => k.startsWith('ended:')).map(([k, v]) => [k.slice(6), v]));
  // the encounter under way: round, who acts, the groups in it, each group's share of its HP left
  const enc = game.encounter && game.encounter.ended == null && game.encounter.round > 0 ? game.encounter : null;
  let encounter = { active: false };
  if (enc) {
    const groups = new Set(), hp = {}, tot = {};
    for (const c of enc.combatants) {
      const t = game.tokens[c.token] || {};
      if (!t.group) continue;
      groups.add(t.group);
      try {
        const p = creature(game, c.token).prepared;
        const g = (tot[t.group] = tot[t.group] || { v: 0, m: 0 });
        g.v += t.dead || c.defeated ? 0 : Math.max(0, p.hp.value); g.m += p.hp.max.value;
      } catch { /* no numbers */ }
    }
    for (const [g, x] of Object.entries(tot)) if (x.m > 0) hp[g] = x.v / x.m;
    const actingC = enc.turn != null ? enc.combatants[enc.turn] : null;
    const at = actingC ? game.tokens[actingC.token] || {} : null;
    encounter = { active: true, round: enc.round, acting: at ? { group: at.group || null, name: at.name || null } : null, groups: [...groups], hp };
  }
  const { states } = splitEvents(game.events);
  return { now, hour, day: (game.sys.time && game.sys.time.daylight) || DAY_HOURS, level: partyLevel(game), party: { map, areas: [...areas], outdoors }, flags: game.flags || {}, carrying, events: states, ended, encounter };
}

/** An action as a line of Claude's checklist. Flags and ledger entries are written by the tool. */
export function actionLine(a) {
  const t = a.do || '?';
  const words = {
    narrate: () => `Narrate: ${a.text || ''}`,
    card: () => `Post a card${a.title ? ` "${a.title}"` : ''}: ${a.text || ''} (tools/chat.mjs)`,
    fx: () => `Visual effect: ${a.effect || a.text || ''}${a.at ? ` at ${JSON.stringify(a.at)}` : ''} (tools/fx.mjs)`,
    sound: () => `Sound: ${a.sound || a.text || ''} (tools/sound.mjs)`,
    light: () => `Light or sky: ${a.text || JSON.stringify(a)}`,
    place: () => `Place ${a.group || a.creatures || 'creatures'}${a.at ? ` at ${JSON.stringify(a.at)}` : ''}${a.rule ? ` by rule: ${a.rule}` : ''}${a.map ? ` on ${a.map}` : ''} (tools/token.mjs)`,
    reveal: () => `Reveal ${a.what || a.group || ''} (tools/token.mjs show)`,
    encounter: () => `Start the encounter ${a.group || ''}${a.initiative ? `; initiative: ${a.initiative}` : ''} (tools/encounter.mjs start, add, roll, begin)`,
    door: () => `Door ${a.id || ''}${a.map ? ` on ${a.map}` : ''}: ${a.state || 'open'}`,
    map: () => `Battle map: ${a.map ? `go to ${a.map}` : `generate one: ${a.text || ''}`}`,
    xp: () => `Award ${a.amount} XP${a.why ? ` (${a.why})` : ''}`,
    decision: () => `Decide ${a.id}: ${a.question || ''}${a.options ? ` [${a.options.join(' | ')}]` : ''} (then: decide <event> ${a.id} <choice>)`,
    flag: () => `Flag ${a.name} = ${JSON.stringify(a.value ?? true)} (written)`,
    ledger: () => `Ledger ${a.kind || 'fact'}: ${a.title ? `${a.title}: ` : ''}${a.text || ''} (written)`,
    note: () => `Note: ${a.text || ''}`,
  };
  return (words[t] || (() => `${t}: ${a.text || JSON.stringify(a)}`))();
}

/** Run one command: {lines, writes}. */
export function runEvents(game, packDir, cmd, args = []) {
  const { defs, states } = splitEvents(game.events);
  const byId = Object.fromEntries(defs.map((d) => [d.id, d]));
  const lines = [], writes = [];
  const ctx = eventContext(game, packDir);
  const now = ctx.now;
  let flags = { ...(game.flags || {}) }, flagsChanged = false;
  const audit = (text) => writes.push({ op: 'set', path: auditPath(), data: auditEntry({ text, by: 'claude', map: ctx.party.map }) });
  const get = (id) => { const d = byId[id]; if (!d) throw new Error(`no event "${id}" (status lists them)`); return d; };
  const save = (id, st) => {
    const { id: _i, ...def } = byId[id];
    states[id] = st;
    game.events = { ...game.events, [id]: { ...def, ...Object.fromEntries(EVENT_STATE_FIELDS.filter((k) => st[k] !== undefined).map((k) => [k, st[k]])) } };
    writes.push({ op: 'set', path: `events/${id}`, data: game.events[id] });
  };
  // a stage's actions: flags and ledger entries written, the rest listed for Claude
  const enter = (ev, stageId) => {
    const s = stageOf(ev, stageId);
    if (!s) return;
    lines.push(`  ${ev.id} / ${s.id}${s.title ? ` (${s.title})` : ''}${s.note ? `: ${s.note}` : ''}`);
    for (const a of s.actions || []) {
      lines.push(`    - ${actionLine(a)}`);
      if (a.do === 'flag') { flags[a.name] = a.value ?? true; flagsChanged = true; }
      if (a.do === 'ledger') writes.push({ op: 'set', path: ledgerPath(), data: ledgerEntry({ kind: a.kind || 'fact', title: a.title || ev.title, text: a.text || '', status: a.status || null, by: 'claude', source: 'adventure' }) });
    }
    const nx = nextStage(ev, { stage: s.id });
    const branch = (s.branches || []).map((b) => b.go);
    lines.push(`    then: ${branch.length ? `a branch (${branch.join(', ')}) when its condition holds; ` : ''}${nx ? (stageOf(ev, nx).when ? `${nx} when its condition holds` : `next ${ev.id} when these are done (to ${nx})`) : `finish ${ev.id} when these are done`}`);
  };
  const ended = () => { if (flagsChanged) { game.flags = flags; writes.push({ op: 'set', path: 'state/flags', data: flags }); } return { lines, writes }; };
  const statusLine = (d) => {
    const st = states[d.id] || { status: 'waiting' };
    const s = st.stage ? stageOf(d, st.stage) : null;
    const next = s ? nextStage(d, st) : null;
    const waits = st.status === 'running' ? (s && (s.branches || []).length ? `branches ${s.branches.map((b) => b.go).join(', ')}; ` : '') + (next ? `${next}${stageOf(d, next).when ? ' when its condition holds' : ' when Claude moves it on'}` : 'finish') : st.status === 'waiting' ? (holds(d.trigger, ctx, st) ? 'DUE' : 'its trigger') : st.status === 'cooldown' ? `may happen again${d.repeat && d.repeat.cooldown ? ` after ${Math.round(d.repeat.cooldown / 86400)} day(s)` : ''}` : '';
    return `${d.id}  ${st.status}${st.stage ? ` at ${st.stage}` : ''}${st.runs ? `, ran ${st.runs}x` : ''}  "${d.title}"${d.pages ? ` (pp ${d.pages})` : ''}${waits ? `  -> ${waits}` : ''}`;
  };
  if (cmd === 'status') {
    const list = args[0] ? [get(args[0])] : defs;
    if (!list.length) lines.push('No events in this campaign.');
    for (const d of list) {
      lines.push(statusLine(d));
      if (args[0]) {
        for (const s of d.stages) lines.push(`  ${s.id === states[d.id].stage ? '>' : ' '} ${s.id}${s.title ? ` (${s.title})` : ''}: ${(s.actions || []).length} action(s)`);
        for (const h of states[d.id].history || []) lines.push(`  ${h.at}: ${h.what}`);
        for (const [k, v] of Object.entries(states[d.id].decisions || {})) lines.push(`  decided ${k}: ${v}`);
      }
    }
    return { lines, writes };
  }
  if (cmd === 'context') { lines.push(JSON.stringify(ctx, null, 2)); return { lines, writes }; }
  if (cmd === 'due') {
    const due = dueEvents(defs, states, ctx);
    if (!due.length) lines.push('Nothing due.');
    for (const d of due) lines.push(`${d.id}: ${d.kind === 'start' ? 'starts' : d.kind === 'branch' ? `branches to ${d.to}` : `moves to ${d.to}`} (${d.why}) "${d.title}"`);
    if (due.length) lines.push('Run them: tick');
    return { lines, writes };
  }
  if (cmd === 'tick') {
    // repeat: a stage entered may make another due (a flag it sets); at most a few passes
    for (let pass = 0; pass < 5; pass++) {
      const due = dueEvents(defs, states, { ...ctx, flags, events: states });
      if (!due.length) break;
      for (const d of due) {
        const ev = byId[d.id];
        const st = d.kind === 'start' ? startEvent(ev, states[d.id] || {}, now) : moveTo(ev, states[d.id], d.to, now);
        save(d.id, st);
        audit(`Event ${ev.title}: ${d.kind === 'start' ? 'began' : `to ${d.to}`} (${d.why})`);
        lines.push(`${d.kind === 'start' ? 'Started' : 'Moved'} ${ev.id}${d.kind === 'start' ? '' : ` to ${d.to}`}:`);
        enter(ev, st.stage);
      }
    }
    if (!lines.length) lines.push('Nothing due.');
    return ended();
  }
  const [id, a1, a2] = args;
  if (cmd === 'run') {
    const ev = get(id), st0 = states[id] || {};
    if (st0.status === 'running') throw new Error(`${id} is running (at ${st0.stage}): use go or next`);
    const st = startEvent(ev, st0, now, a1 || null);
    if (a1 && !stageOf(ev, a1)) throw new Error(`event ${id} has no stage "${a1}"`);
    save(id, st);
    audit(`Event ${ev.title}: began${a1 ? ` at ${a1}` : ''}`);
    lines.push(`Started ${id}:`);
    enter(ev, st.stage);
    return ended();
  }
  if (cmd === 'next' || cmd === 'go') {
    const ev = get(id), st0 = states[id] || {};
    if (st0.status !== 'running') throw new Error(`${id} is not running (${st0.status || 'waiting'})`);
    const to = cmd === 'go' ? a1 : nextStage(ev, st0);
    if (cmd === 'go' && !to) throw new Error('go <id> <stage>');
    if (!to) {
      save(id, finishEvent(ev, st0, now));
      audit(`Event ${ev.title}: finished`);
      lines.push(`Finished ${id}${ev.repeat ? ' (it may happen again)' : ''}.`);
      return ended();
    }
    const st = moveTo(ev, st0, to, now);
    save(id, st);
    audit(`Event ${ev.title}: to ${to}`);
    lines.push(`Moved ${id} to ${to}:`);
    enter(ev, to);
    return ended();
  }
  if (cmd === 'finish') {
    const ev = get(id);
    save(id, finishEvent(ev, states[id] || {}, now));
    audit(`Event ${ev.title}: finished`);
    lines.push(`Finished ${id}${ev.repeat ? ' (it may happen again)' : ''}.`);
    return ended();
  }
  if (cmd === 'reset') {
    const ev = get(id), st0 = states[id] || {};
    const { stage: _s, stage_at: _a, started: _b, ...rest } = st0;
    save(id, { ...rest, status: 'waiting', history: [...(st0.history || []), { at: now, what: 'reset to waiting' }] });
    audit(`Event ${ev.title}: reset to waiting`);
    lines.push(`${id} is waiting again.`);
    return ended();
  }
  if (cmd === 'decide') {
    const ev = get(id);
    if (!a1 || a2 === undefined) throw new Error('decide <id> <point> <choice>');
    const choice = args.slice(2).join(' ');
    save(id, decide(states[id] || {}, a1, choice, now));
    writes.push({ op: 'set', path: ledgerPath(), data: ledgerEntry({ kind: 'fact', title: `${ev.title}: ${a1}`, text: `Claude decided: ${choice}`, by: 'claude' }) });
    audit(`Event ${ev.title}: decided ${a1}: ${choice}`);
    lines.push(`Recorded ${id} ${a1}: ${choice} (and in the ledger).`);
    return ended();
  }
  if (cmd === 'flag' || cmd === 'unflag') {
    if (!id) throw new Error(`${cmd} <name>${cmd === 'flag' ? ' [value]' : ''}`);
    if (cmd === 'flag') flags[id] = a1 === undefined ? true : Number.isFinite(Number(a1)) ? Number(a1) : a1 === 'false' ? false : a1;
    else delete flags[id];
    flagsChanged = true;
    audit(cmd === 'flag' ? `Flag ${id} = ${JSON.stringify(flags[id])}` : `Flag ${id} cleared`);
    lines.push(cmd === 'flag' ? `${id} = ${JSON.stringify(flags[id])}` : `${id} cleared`);
    const due = dueEvents(defs, states, { ...ctx, flags });
    if (due.length) lines.push(`Now due: ${due.map((d) => d.id).join(', ')} (tick)`);
    return ended();
  }
  throw new Error('commands: status, due, tick, run, next, go, finish, reset, decide, flag, unflag, context');
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  try {
    const rec = opt('--records');
    const [pack, save, cmd, ...rest] = args;
    if (!pack || !save || !cmd) { console.error('usage: node tools/events.mjs <pack-dir> <save-dir> [--records FILE] <command> ... (see the head of this file)'); return 2; }
    const records = rec ? readRecords(JSON.parse(fs.readFileSync(rec, 'utf8'))) : null;
    const game = loadGame(pack, save, records);
    const out = runEvents(game, pack, cmd, rest);
    if (['status', 'due', 'context'].includes(cmd)) console.log(out.lines.join('\n'));
    else console.log(JSON.stringify(out, null, 2));
    return 0;
  } catch (e) {
    console.error(e.message);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
