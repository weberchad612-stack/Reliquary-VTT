#!/usr/bin/env node
// The campaign ledger from chat (board/ledger.js): the GM's memory of the campaign (GM guide rule B5). Claude writes
// every improvisation (his or the user's), GM secret, ruling, thread, quest and timed event the same turn, and a
// "story so far" summary at every session's wrap-up; reads it before answering anything about the past. GM only.
//
// Usage (--records FILE: the board's records, {path: data} or a db_list result; the ledger collection, and the
// state/clock and board/meta records for the game time; --chat also searches chat/ records in the same file):
//   node tools/ledger.mjs add <kind> "text" [--title T] [--subjects "Grukk, lantern lady"] [--area B12] [--map M]
//        [--source adventure|added] [--added-by user|claude] [--by gm] [--link chat/<id>]... [--game "Day 3, 2:20 PM"]
//        [--player NAME] [--character PC] [--records FILE]
//        (--added-by user: the user invented it, at the table or through a character; implies --source added.
//         --character names the PC who brought it into the story, and implies --added-by user; --player is a name from
//         the campaign's players (tools/players.mjs), found from the character, or the only player, when not given)
//   node tools/ledger.mjs summary "what happened this session" [--title "Session 4"] [--records FILE]
//   node tools/ledger.mjs edit <id> [--text T] [--title T] [--subjects S] [--area A] [--source S] [--added-by W] [--link L]
//        --records FILE
//   node tools/ledger.mjs close <id> [--failed] --records FILE      (a thread, quest or timed event is over)
//   node tools/ledger.mjs reopen <id> --records FILE
//   node tools/ledger.mjs remove <id>
//   node tools/ledger.mjs find ["words"] [--kind <kind>|open] [--subject S] [--area A] [--by gm] [--chat]
//        [--limit N] --records FILE
//   node tools/ledger.mjs story --records FILE                     (the session-start read)
//   node tools/ledger.mjs subjects --records FILE                  (every name in the ledger, most used first)
// Kinds: summary, thread, quest, event (timed event), improv, fact, secret, ruling. <id> is the part after ledger/.
// add, summary, edit, close, reopen and remove print {lines, writes}: write each with db_write (an edit needs the
// record's version). find, story and subjects print what they found. Docs: docs/best-practices/board.md (the
// ledger), docs/gm/running-a-game.md (rule B5).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER, KINDS, KIND_IDS, ledgerEntry, editEntry, ledgerPath, ledgerRows, storySoFar, subjectsIndex, entryLine, matches } from '../board/ledger.js';
import { clockLabel } from '../board/clock.js';
import { readClock, adventureDay } from '../engine/time/calendar.js';
import { systemConfig } from '../rulesets/systems.js';
import { readRecords } from './replay.mjs';
import { introducer, findPlayer } from '../board/players.js';
import { resolveToken } from '../board/names.js';

/** The ledger's entries in a set of records: [{id, data}]. */
export const ledgerList = (records) => Object.entries(records).filter(([p]) => p.startsWith(`${LEDGER}/`)).map(([p, data]) => ({ id: p.slice(LEDGER.length + 1), data }));

/** The game time now, from the records' clock and the campaign's ruleset: {now, label}, or null. */
export function gameNow(records) {
  const clock = records['state/clock'], meta = records['board/meta'];
  if (!clock || typeof clock.now !== 'number') return null;
  let label = null;
  try {
    const sys = systemConfig(meta && meta.ruleset);
    const cal = sys && sys.time && sys.time.calendar;
    if (cal) label = clockLabel({ readClock, adventureDay }, cal, clock);
  } catch { /* no calendar: the clock alone */ }
  return { now: clock.now, ...(label ? { label } : {}) };
}

const entryOf = (records, id) => {
  const p = `${LEDGER}/${String(id).replace(/^ledger\//, '')}`;
  if (!records[p]) throw new Error(`no ledger entry "${id}" in the records`);
  return { path: p, data: records[p] };
};

/** Names for the tool's lines: players and tokens by id. */
const whoWords = (records) => {
  const players = (records['state/table'] || {}).players || [];
  return { player: (id) => (findPlayer(players, id) || {}).name, character: (id) => (records[`tokens/${id}`] || {}).name };
};

/** Who invented it, from --added-by, --player and --character: {addedBy, player, character} (all null if not said). */
export function whoOf(records, opts) {
  if (!opts.addedBy && !opts.player && !opts.character) return { addedBy: null, player: null, character: null };
  if (opts.addedBy && opts.addedBy !== 'user') {
    if (opts.player || opts.character) throw new Error('--player and --character are for a detail the user added');
    return { addedBy: opts.addedBy, player: null, character: null };
  }
  const tokens = Object.fromEntries(Object.entries(records).filter(([p]) => p.startsWith('tokens/')).map(([p, t]) => [p.slice(7), t]));
  let character = null;
  if (opts.character) {
    if (!Object.keys(tokens).length) throw new Error('--character needs the board\'s tokens/ records in --records');
    character = resolveToken(tokens, opts.character);
  }
  const players = (records['state/table'] || {}).players || [];
  return { addedBy: 'user', ...introducer(players, { player: opts.player || null, character }) };
}

/** Run one command: {lines, writes} (writes for add, summary, edit, close, reopen, remove). */
export function runLedger(cmd, args, opts = {}, records = {}) {
  const now = opts.now || new Date().toISOString();
  const game = opts.game ? { now: (gameNow(records) || { now: 0 }).now, label: opts.game } : gameNow(records);
  const who = whoOf(records, opts);
  const fields = () => ({ title: opts.title, subjects: opts.subjects, where: { map: opts.map, area: opts.area }, source: who.addedBy && !opts.source ? 'added' : opts.source, addedBy: who.addedBy, player: who.player, character: who.character, links: opts.link || [] });
  if (cmd === 'add' || cmd === 'summary') {
    const kind = cmd === 'summary' ? 'summary' : args[0];
    const text = (cmd === 'summary' ? args : args.slice(1)).join(' ');
    const data = ledgerEntry({ kind, text, by: opts.by || 'claude', game, at: now, ...fields() });
    const p = ledgerPath(Date.parse(now) || Date.now());
    return { lines: [`${p}: ${entryLine(data, 160, whoWords(records))}`], writes: [{ op: 'set', path: p, data }] };
  }
  if (cmd === 'edit' || cmd === 'close' || cmd === 'reopen') {
    const e = entryOf(records, args[0]);
    let changes;
    if (cmd === 'edit') {
      changes = {};
      for (const k of ['text', 'title', 'subjects', 'source']) if (opts[k] !== undefined) changes[k] = opts[k];
      if (who.addedBy) { changes.addedBy = who.addedBy; changes.player = who.player; changes.character = who.character; if (!opts.source) changes.source = 'added'; }
      if (opts.area !== undefined || opts.map !== undefined) changes.where = { ...(e.data.where || {}), ...(opts.area !== undefined ? { area: opts.area } : {}), ...(opts.map !== undefined ? { map: opts.map } : {}) };
      if (opts.link && opts.link.length) changes.links = [...(e.data.links || []), ...opts.link];
      if (!Object.keys(changes).length) throw new Error('edit what? --text, --title, --subjects, --area, --map, --source, --added-by, --player, --character or --link');
    } else {
      if (!e.data.status) throw new Error(`a ${e.data.kind} has no status: only threads, quests and timed events close`);
      changes = { status: cmd === 'reopen' ? 'open' : opts.failed ? 'failed' : 'done' };
    }
    const data = editEntry(e.data, changes, now);
    return { lines: [`${e.path}: ${entryLine(data, 160, whoWords(records))}`], writes: [{ op: 'set', path: e.path, data }] };
  }
  if (cmd === 'remove') {
    const p = `${LEDGER}/${String(args[0] || '').replace(/^ledger\//, '')}`;
    if (!args[0]) throw new Error('remove <id>');
    return { lines: [`removed ${p}`], writes: [{ op: 'delete', path: p }] };
  }
  const listed = ledgerList(records);
  if (cmd === 'find') {
    const q = args.join(' ');
    const W = whoWords(records);
    const rows = ledgerRows(listed, { q, kind: opts.kind, subject: opts.subject, area: opts.area, by: opts.by, limit: opts.limit, words: (e) => [e.player && W.player(e.player), e.character && W.character(e.character)].filter(Boolean) });
    const lines = rows.map((e) => `${e.id}  ${e.game && e.game.label ? `[${e.game.label}] ` : ''}${e.where && e.where.area ? `{${e.where.area}} ` : ''}${entryLine(e, 400, W)}${e.subjects ? `  (${e.subjects.join(', ')})` : ''}`);
    if (!rows.length) lines.push(`nothing in the ledger${q ? ` for "${q}"` : ''}`);
    if (opts.chat) {
      const chat = Object.entries(records).filter(([p, m]) => p.startsWith('chat/') && m && m.text && matches({ text: m.text, title: m.speaker }, q))
        .sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, opts.limit || 20);
      lines.push(`--- the chat: ${chat.length} message(s)`);
      for (const [p, m] of chat) lines.push(`${p}  ${m.kind}${m.speaker ? ` ${m.speaker}` : ''}: ${m.text.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
    return { lines, writes: [] };
  }
  if (cmd === 'story') {
    const s = storySoFar(listed);
    const sec = (title, rows) => [`## ${title} (${rows.length})`, ...(rows.length ? rows.map((e) => `- ${e.id}${e.game && e.game.label ? ` [${e.game.label}]` : ''} ${e.title ? `${e.title}: ` : ''}${e.text.replace(/\s+/g, ' ')}`) : ['- none'])];
    return { lines: [...sec('The story so far', s.summaries), ...sec('Timed events due', s.events), ...sec('Open quests', s.quests), ...sec('Open threads', s.threads)], writes: [] };
  }
  if (cmd === 'subjects') return { lines: subjectsIndex(listed).map((s) => `${s.name} (${s.n})`), writes: [] };
  throw new Error(`commands: add, summary, edit, close, reopen, remove, find, story, subjects (kinds: ${KIND_IDS.join(', ')})`);
}

async function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const opts = (k) => { const out = []; let v; while ((v = opt(k)) !== undefined) out.push(v); return out; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const rec = opt('--records');
    const o = {
      title: opt('--title'), subjects: opt('--subjects'), area: opt('--area'), map: opt('--map'), source: opt('--source'), addedBy: opt('--added-by'), player: opt('--player'), character: opt('--character'),
      by: opt('--by'), game: opt('--game'), text: opt('--text'), kind: opt('--kind'), subject: opt('--subject'),
      limit: Number(opt('--limit')) || undefined, link: opts('--link'), failed: flag('--failed'), chat: flag('--chat'),
    };
    const [cmd, ...rest] = args;
    const records = rec ? readRecords(JSON.parse(fs.readFileSync(rec, 'utf8'))) : {};
    if (['edit', 'close', 'reopen', 'find', 'story', 'subjects'].includes(cmd) && !rec) throw new Error(`${cmd} needs --records FILE (the board's ledger records)`);
    const out = runLedger(cmd, rest, o, records);
    if (out.writes.length) console.log(JSON.stringify(out, null, 2));
    else console.log(out.lines.join('\n'));
    return 0;
  } catch (e) {
    console.error(`ledger: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv).then((c) => process.exit(c));

export { KINDS };
