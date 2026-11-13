#!/usr/bin/env node
// The "Claude is thinking" banner on its own (board/replay.js, state/adjudicating), for any adjudication that is not
// a replay: an exploration check, a social scene, a rest, a big change to the map. Raise it before the first change,
// keep it up with ping during long work, and take it down when done. A replay begun while it is up (tools/replay.mjs
// begin) carries on with it, and the replay's end takes it down.
//
// Usage: node tools/think.mjs [--draft FILE] start [--what "text for the GM's audit log"]
//        node tools/think.mjs [--draft FILE] ping
//        node tools/think.mjs [--draft FILE] stop
// Prints JSON {lines, writes}: write the writes with db_write. The banner says nothing of what is being worked out;
// --what goes to the GM's audit log only. Docs: docs/best-practices/game-data.md section 2c.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADJ_PATH } from '../board/replay.js';
import { auditPath, auditEntry } from '../board/audit.js';
import { DEFAULT_DRAFT, thinkFile, readThink, clearThink } from './replay.mjs';

/** Run a command: {lines, writes}. */
export function runThink(cmd, opts = {}, { draftFile = DEFAULT_DRAFT, now = Date.now() } = {}) {
  const at = new Date(now).toISOString();
  const banner = (since) => ({ op: 'set', path: ADJ_PATH, data: { by: 'claude', since, at } });
  const audit = (text) => ({ op: 'set', path: auditPath(now), data: auditEntry({ text, by: 'claude', at }) });
  if (cmd === 'start') {
    const t = readThink(draftFile);
    if (t) return { lines: [`the banner is already up (since ${t.since}): refreshed`], writes: [banner(t.since)] };
    fs.mkdirSync(path.dirname(thinkFile(draftFile)), { recursive: true });
    fs.writeFileSync(thinkFile(draftFile), JSON.stringify({ since: at, what: opts.what || null }));
    return { lines: ['the banner is up'], writes: [banner(at), audit(`Claude began thinking${opts.what ? `: ${opts.what}` : ''}`)] };
  }
  if (cmd === 'ping') {
    const t = readThink(draftFile);
    if (!t) throw new Error('the banner is not up: think.mjs start (a replay draft refreshes it with replay.mjs ping)');
    return { lines: ['refreshed'], writes: [banner(t.since)] };
  }
  if (cmd === 'stop') {
    const t = readThink(draftFile);
    clearThink(draftFile);
    return { lines: [t ? 'the banner is down' : 'the banner was not up (its record is deleted anyway)'], writes: [{ op: 'delete', path: ADJ_PATH }, audit(`Claude finished thinking${t && t.what ? `: ${t.what}` : ''}`)] };
  }
  throw new Error('commands: start, ping, stop');
}

function main(argv) {
  const args = argv.slice(2), opts = {};
  for (let i = 0; i < args.length; i++) if (args[i].startsWith('--')) { opts[args[i].slice(2)] = args[i + 1]; args.splice(i, 2); i--; }
  try {
    console.log(JSON.stringify(runThink(args[0], opts, { draftFile: opts.draft ? path.resolve(opts.draft) : DEFAULT_DRAFT }), null, 2));
    return 0;
  } catch (e) {
    console.error(`think: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
