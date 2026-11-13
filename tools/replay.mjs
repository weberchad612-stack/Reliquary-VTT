#!/usr/bin/env node
// Replays from chat (board/replay.js): Claude resolves a batch of actions in a draft, step by step, and the table
// reveals the steps on the board. While the draft is open the game's records change only in a working copy, which
// the other tools read (--records), so step 5 sees what steps 1 to 4 did; nothing reaches the board until `end`
// writes the replay, and each step's changes reach the game only when someone reveals it.
//
// Usage: node tools/replay.mjs [--draft FILE] <command> ...
//   begin --records FILE [--title T] [--map M] [--resume | --discard]
//                       open a draft on the board's records ({path: data}, as db_list gives them); replays not yet
//                       revealed are applied to the working copy first. Prints the "Claude is adjudicating" record
//                       and an audit line to write. --resume carries on a draft left open; --discard drops it.
//   records             the working copy's file, for the other tools' --records
//   get <path>          one record from the working copy (an effect.mjs input, say)
//   step --side pc|npc|env --text T [--actor ID] [--who NAME] [--gm] [--focus ID,ID|X:Y,...]
//        [--in FILE | --in PATH=FILE ...] [--move ID:X,Y[:VX,VY;VX,VY]] ...
//                       one step: the other tools' outputs (--in; - is stdin; PATH= for an output without a path,
//                       such as effect.mjs's token) and moves (--move token:to[:waypoints]) change the working copy;
//                       chat, dice, audit and fx records become the step's posts, written when it is revealed;
//                       the outputs' rolls in parts (check.mjs, dice.mjs, actor.mjs damage) become the step's
//                       details, in the order given: give the check, then the damage roll, then actor.mjs damage.
//                       Prints the refreshed "adjudicating" record (write it: the banner times out without it).
//   narrate "text"      a paragraph of narration, posted to the chat when the last step is revealed
//   stop "text"         end the batch here, waiting for reactions ("Can anyone react to the ogre's swing?")
//   ping                the refreshed "adjudicating" record (before a long think)
//   show                the draft so far
//   end                 the replay record to write, the "adjudicating" record's delete and an audit line
//   abort               drop the draft: the "adjudicating" record's delete and an audit line
//
// Every command prints JSON {lines, writes}; write the writes with db_write. Docs: docs/best-practices/game-data.md
// (replays), docs/design/game-data.md section 3.4.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPLAY, ADJ_PATH, POSTS, replayId, diffRecord, applyChange, checkReplay } from '../board/replay.js';
import { auditPath, auditEntry } from '../board/audit.js';
import { publicName, resolveToken } from '../board/names.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DRAFT = path.join(ROOT, 'saves', 'replay-draft.json');
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const recordsFile = (draftFile) => draftFile.replace(/\.json$/, '') + '.records.json';

/** The board's records from a file: {path: data}, or a db_list result ([{path|id, data}]). */
export function readRecords(raw) {
  if (Array.isArray(raw)) return Object.fromEntries(raw.map((e) => [e.path || e.id, e.data]));
  if (raw && Array.isArray(raw.documents)) return readRecords(raw.documents);
  return raw || {};
}

/** A tool's output as writes [{op, path, data?}]. `at`: the path for an output that has none (effect.mjs). */
export function writesOf(out, at = null) {
  if (Array.isArray(out)) return out.flatMap((o) => writesOf(o, at));
  if (!out || typeof out !== 'object') throw new Error('a tool output is a JSON object');
  if (Array.isArray(out.writes)) return out.writes.map((w) => ({ op: w.op || 'set', path: w.path, data: w.data }));
  if (out.op && out.path) return [{ op: out.op, path: out.path, data: out.data }];
  if (out.path && out.record) return [{ op: 'set', path: out.path, data: out.record }];
  if (out.token && at) return [...(out.content ? writesOf(out.content) : []), { op: 'set', path: at, data: out.token }];
  if (at) return [{ op: 'set', path: at, data: out.data ?? out }];
  throw new Error('a tool output with no path: give it as --in PATH=FILE');
}

/** Apply one write to a working copy of records. */
export function applyWrite(records, w) {
  if (!/^[^/]+\/[^/]+$/.test(String(w.path))) throw new Error(`"${w.path}" is not collection/record`);
  if (w.op === 'delete' || w.op === 'remove') { delete records[w.path]; return; }
  if (w.op === 'update' || w.op === 'merge') { records[w.path] = { ...(records[w.path] || {}), ...clone(w.data) }; return; }
  if (w.op === 'set') { records[w.path] = clone(w.data); return; }
  throw new Error(`unknown write op "${w.op}"`);
}

/** The working copy with the replays not yet revealed applied, in order. */
export function project(records) {
  const out = clone(records);
  const pending = Object.entries(records).filter(([p, d]) => p.startsWith(`${REPLAY}/`) && d && Array.isArray(d.steps) && (d.n || 0) < d.steps.length)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [, rep] of pending) for (const s of rep.steps.slice(rep.n || 0)) for (const c of s.changes || []) {
    const next = applyChange(out[c.path] ?? null, c);
    if (next) out[c.path] = next; else delete out[c.path];
  }
  return { records: out, pending: pending.length };
}

const adjWrite = (d, now) => ({ op: 'set', path: ADJ_PATH, data: { by: 'claude', since: d.started, at: new Date(now).toISOString() } });
const audit = (text, now, map) => ({ op: 'set', path: auditPath(now), data: auditEntry({ text, by: 'claude', map: map || null, at: new Date(now).toISOString() }) });

function parseCell(s) { const [x, y] = String(s).split(',').map(Number); if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`"${s}" is not X,Y`); return [x, y]; }
/** --move token:X,Y[:VX,VY;VX,VY] */
export function parseMove(s) {
  const [token, to, via] = String(s).split(':');
  if (!token || !to) throw new Error('--move is TOKEN:X,Y (with :VX,VY;VX,VY for waypoints)');
  return { token, to: parseCell(to), ...(via ? { via: via.split(';').map(parseCell) } : {}) };
}

/** Run one step on the draft: {lines, step}. inputs: [{at?, out}] (tool outputs); moves: [{token, to, via?}]. */
export function runStep(d, { side, text, actor, who, gm, focus, inputs = [], moves = [] }) {
  const recs = d.records, before = {}, posts = [], lines = [], stepMoves = [];
  const touch = (p) => { if (!(p in before)) before[p] = clone(recs[p] ?? null); };
  const tokens = () => Object.fromEntries(Object.entries(recs).filter(([p]) => p.startsWith('tokens/')).map(([p, t]) => [p.slice(7), t]));
  const tokenId = (ref) => resolveToken(tokens(), ref);
  const rolls = [];
  for (const { at, out } of inputs) {
    // the rolls in parts (check.mjs, dice.mjs, actor.mjs damage), for the step's details on the board
    for (const o of [].concat(out)) if (o && typeof o === 'object') { if (o.roll) rolls.push(o.roll); if (Array.isArray(o.rolls)) rolls.push(...o.rolls); }
    for (const w of writesOf(out, at)) {
      const coll = String(w.path).split('/')[0];
      if (POSTS.includes(coll)) { if (w.op === 'set' || !w.op) posts.push({ c: coll, data: clone(w.data) }); continue; }
      touch(w.path); applyWrite(recs, w);
    }
  }
  for (const m of moves) {
    const id = tokenId(m.token), p = `tokens/${id}`, t = recs[p];
    touch(p);
    stepMoves.push({ token: id, from: [t.x, t.y], to: m.to, ...(m.via ? { via: m.via } : {}) });
    recs[p] = { ...t, x: m.to[0], y: m.to[1] };
    delete recs[p].slot;
  }
  const changes = Object.keys(before).map((p) => diffRecord(p, before[p], recs[p] ?? null)).filter(Boolean);
  const actorId = actor ? tokenId(actor) : undefined;
  const shown = who || (actorId ? publicName(recs[`tokens/${actorId}`]) : '') || undefined;
  if (!SIDE_OK.includes(side)) throw new Error('--side is pc, npc or env');
  if (!String(text || '').trim()) throw new Error('a step needs --text');
  const step = { side, text: String(text).trim(), changes, posts, moves: stepMoves };
  if (actorId) step.actor = actorId;
  if (shown) step.who = shown;
  if (rolls.length) step.rolls = rolls;
  if (gm) step.gm = true;
  if (focus && focus.length) step.focus = focus;
  d.steps.push(step);
  lines.push(`step ${d.steps.length}: ${step.who ? step.who + ': ' : ''}${step.text}`);
  lines.push(`  ${changes.length} record(s) changed, ${posts.length} post(s), ${stepMoves.length} move(s)`);
  for (const c of changes) lines.push(`  ${c.path}: ${c.remove ? 'removed' : c.create ? 'created' : Object.keys(c.to).concat((c.unset || []).map((k) => '-' + k)).join(', ')}`);
  return { lines, step };
}
const SIDE_OK = ['pc', 'npc', 'env'];

/** The replay record for a finished draft. */
export function replayRecord(d, now = Date.now()) {
  const rep = { title: d.title || 'Resolved actions', by: 'claude', created: new Date(now).toISOString(), steps: d.steps, narration: d.narration || [], n: 0, revealed: [] };
  if (d.map) rep.map = d.map;
  if (d.stop) rep.stop = d.stop;
  const problems = checkReplay(rep);
  if (problems.length) throw new Error(problems.join('; '));
  return rep;
}

function readJson(file) {
  const s = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
  try { return JSON.parse(s); } catch { return s.trim().split(/\n(?=[[{])/).map((x) => JSON.parse(x)); }   // several JSON documents one after another
}
const loadDraft = (f) => { if (!fs.existsSync(f)) throw new Error('no draft is open: run begin first'); return JSON.parse(fs.readFileSync(f, 'utf8')); };
function saveDraft(f, d) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(d));
  fs.writeFileSync(recordsFile(f), JSON.stringify(d.records));
}
function dropDraft(f) { for (const x of [f, recordsFile(f)]) if (fs.existsSync(x)) fs.rmSync(x); }

/** Run a command: {lines, writes}. */
export function runReplay(cmd, args, opts, { draftFile = DEFAULT_DRAFT, now = Date.now() } = {}) {
  const lines = [], writes = [];
  if (cmd === 'begin') {
    if (fs.existsSync(draftFile) && !opts.resume && !opts.discard) {
      const old = JSON.parse(fs.readFileSync(draftFile, 'utf8'));
      throw new Error(`a draft is open ("${old.title}", ${old.steps.length} step(s), begun ${old.started}): begin --resume to carry on, or --discard to drop it`);
    }
    if (opts.resume) {
      const d = loadDraft(draftFile);
      lines.push(`resumed "${d.title}" at step ${d.steps.length + 1}`, `working copy: ${recordsFile(draftFile)}`);
      return { lines, writes: [adjWrite(d, now)] };
    }
    if (!opts.records) throw new Error('begin needs --records FILE (the board\'s records, as db_list gives them)');
    const { records, pending } = project(readRecords(JSON.parse(fs.readFileSync(opts.records, 'utf8'))));
    const d = { id: replayId(now), title: opts.title || 'Resolved actions', map: opts.map || null, started: new Date(now).toISOString(), records, steps: [], narration: [], stop: null };
    saveDraft(draftFile, d);
    lines.push(`draft "${d.title}" open${pending ? `; ${pending} replay(s) not yet revealed applied to the working copy` : ''}`, `working copy: ${recordsFile(draftFile)} (give it to the other tools as --records)`);
    writes.push(adjWrite(d, now), audit(`Claude began resolving: ${d.title}`, now, d.map));
    return { lines, writes };
  }
  if (cmd === 'abort') {
    const d = fs.existsSync(draftFile) ? JSON.parse(fs.readFileSync(draftFile, 'utf8')) : null;
    dropDraft(draftFile);
    lines.push(d ? `dropped "${d.title}" (${d.steps.length} step(s))` : 'no draft was open');
    writes.push({ op: 'delete', path: ADJ_PATH }, audit(d ? `Claude stopped resolving: ${d.title} (nothing applied)` : 'Claude cleared the adjudicating banner', now, d && d.map));
    return { lines, writes };
  }
  const d = loadDraft(draftFile);
  if (cmd === 'records') return { lines: [recordsFile(draftFile)], writes: [] };
  if (cmd === 'get') {
    const r = d.records[args[0]];
    if (r === undefined) throw new Error(`no record ${args[0]} in the working copy`);
    return { path: args[0], data: r };
  }
  if (cmd === 'ping') return { lines: ['refreshed'], writes: [adjWrite(d, now)] };
  if (cmd === 'show') {
    lines.push(`"${d.title}" begun ${d.started}: ${d.steps.length} step(s)`);
    d.steps.forEach((s, i) => lines.push(`  ${i + 1}. [${s.side}] ${s.who ? s.who + ': ' : ''}${s.text}${s.gm ? ' (GM only)' : ''}`));
    if (d.narration.length) lines.push(`narration: ${d.narration.length} paragraph(s)`);
    if (d.stop) lines.push(`stops for reactions: ${d.stop}`);
    return { lines, writes: [] };
  }
  if (cmd === 'narrate' || cmd === 'stop') {
    const text = args.join(' ').trim();
    if (!text) throw new Error(`${cmd} needs text`);
    if (cmd === 'narrate') d.narration.push(text); else d.stop = text;
    saveDraft(draftFile, d);
    return { lines: [cmd === 'narrate' ? `narration ${d.narration.length} added` : `stops for reactions: ${text}`], writes: [adjWrite(d, now)] };
  }
  if (cmd === 'step') {
    const inputs = (opts.in || []).map((x) => { const m = /^([^=\/]+\/[^=]+)=(.+)$/.exec(x); return m ? { at: m[1], out: readJson(m[2]) } : { out: readJson(x) }; });
    const r = runStep(d, { side: opts.side, text: opts.text, actor: opts.actor, who: opts.who, gm: opts.gm, focus: opts.focus, inputs, moves: (opts.move || []).map(parseMove) });
    saveDraft(draftFile, d);
    return { lines: r.lines, writes: [adjWrite(d, now)] };
  }
  if (cmd === 'end') {
    const rep = replayRecord(d, now);
    writes.push({ op: 'set', path: `${REPLAY}/${d.id}`, data: rep }, { op: 'delete', path: ADJ_PATH }, audit(`Claude finished resolving: ${rep.title} (${rep.steps.length} step(s), waiting to be revealed)`, now, d.map));
    dropDraft(draftFile);
    lines.push(`replay ${REPLAY}/${d.id}: ${rep.steps.length} step(s)${rep.narration.length ? `, ${rep.narration.length} paragraph(s) of narration` : ''}${rep.stop ? '; stops for reactions' : ''}`);
    return { lines, writes };
  }
  throw new Error(`unknown command "${cmd}"`);
}

export function parseArgs(argv) {
  const opts = { in: [], move: [] }, args = [];
  let cmd = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in' || a === '--move') opts[a.slice(2)].push(argv[++i]);
    else if (a === '--gm' || a === '--resume' || a === '--discard') opts[a.slice(2)] = true;
    else if (a === '--focus') opts.focus = argv[++i].split(',').map((x) => (/^-?[\d.]+:-?[\d.]+$/.test(x) ? x.split(':').map(Number) : x));
    else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i];
    else if (!cmd) cmd = a;
    else args.push(a);
  }
  return { cmd, args, opts };
}

function main(argv) {
  try {
    const { cmd, args, opts } = parseArgs(argv.slice(2));
    if (!cmd) { console.error('usage: node tools/replay.mjs [--draft FILE] begin|records|get|step|narrate|stop|ping|show|end|abort ...'); return 2; }
    const out = runReplay(cmd, args, opts, { draftFile: opts.draft ? path.resolve(opts.draft) : DEFAULT_DRAFT });
    console.log(cmd === 'records' ? out.lines[0] : JSON.stringify(out, null, 2));
    return 0;
  } catch (e) {
    console.error(`replay: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
