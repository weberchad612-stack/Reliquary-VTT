#!/usr/bin/env node
// Exploration from chat (board/explore.js): what each PC keeps doing while the party travels, the party's pace,
// travelling a distance or a time on the clock, Claude's reminders for a new area, and what the activities ask for
// when combat starts (tools/encounter.mjs applies them: Stealth for initiative, the party's initiative bonus, a
// raised shield). The activities and their rules are the system's (system.exploration).
//
// Usage: node tools/exploration.mjs <pack-dir> <save-dir> [--records FILE] <command> ...
//   (--records: the board's records: explore/, tokens/, actors/, actorstate/, content/, state/clock, board/meta)
//   list                                 each PC's activity (with any warning), the party's pace, the reminders
//   activities                           the system's activities: id, pace, what each needs
//   set <PC> <activity id | none> [--expert PC] [--skill S] [--spell S] [--effect E] [--note "words"]
//   pace                                 the party's pace in words
//   travel <amount> <ft|mi|min|hr> [--terrain normal|difficult|greater]
//                                        the party travels: the clock moves on by the time at the party's pace
//   reminders                            what to do on entering a new area (who Searches, Detects Magic, ...)
//   requests                             what the activities ask for when combat starts
//   content                              the activities' rules text records the board lacks (to write once)
// Changing commands print {lines, writes} (db_write each). Docs: docs/best-practices/board.md (Exploration),
// docs/gm/running-a-game.md section 6.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGame, creature } from './actor.mjs';
import { readRecords } from './replay.mjs';
import { runClock } from './clock.mjs';
import { resolveToken } from '../board/names.js';
import { contentPath } from '../board/records.js';
import { auditPath, auditEntry } from '../board/audit.js';
import { EXPLORE, exploreRules, exploreChoice, pcExplore, partyPace, availability, combatRequests, reminders, travelTime, durationWords } from '../board/explore.js';

/** The party as the exploration rules take it: [{id, name, actor, prepared, dead}]. */
export function partyOf(game) {
  return Object.entries(game.tokens).filter(([id, t]) => t.kind === 'pc' && game.actors[id]).map(([id, t]) => {
    let prepared = null;
    try { prepared = creature(game, id).prepared; } catch { /* no numbers */ }
    return { id, name: t.name || id, actor: game.actors[id], prepared, dead: !!t.dead };
  });
}
/** The choices in the records: {token id: choice}. */
export const choicesOf = (records) => Object.fromEntries(Object.entries(records || {}).filter(([p]) => p.startsWith(`${EXPLORE}/`)).map(([p, d]) => [p.slice(EXPLORE.length + 1), d]));

export function runExploration(game, cmd, args, o = {}) {
  const R = exploreRules(game.sys), records = game.records || {}, party = partyOf(game), choices = choicesOf(records);
  const lines = [], writes = [];
  const audit = (text) => writes.push({ op: 'set', path: auditPath(), data: auditEntry({ text, by: 'claude' }) });
  const paceLine = () => { const g = partyPace(R, party, choices); return g ? `Pace: ${R.paceText(g)} (slowest ${g.slowestText || g.slowest}${g.why ? `; ${g.why}` : ''})${g.limit ? `; ${g.limit.text}` : ''}` : 'Pace: no Speeds known'; };
  if (cmd === 'list') {
    for (const p of party) {
      const c = pcExplore(R, p.id, party, choices);
      lines.push(`${c.name}: ${c.icon} ${c.title}${c.detail ? ` (${c.detail})` : ''}${c.warning ? `  WARNING: ${c.warning}` : ''}${p.dead ? '  (dead)' : ''}`);
    }
    lines.push(paceLine());
    for (const r of reminders(R, party, choices)) lines.push(`Reminder: ${r.text}`);
    return { lines, writes };
  }
  if (cmd === 'activities') {
    for (const a of R.activities) lines.push(`${a.id}  ${a.icon || ''} ${a.name} (${R.paceWords[a.pace] || a.pace})${a.options ? `; options ${a.options.map((x) => `--${x.key}`).join(' ')}` : ''}: ${a.summary || ''}`);
    if (!R.activities.length) lines.push('This game system has no exploration activities: use set <PC> none --note "what they do".');
    return { lines, writes };
  }
  if (cmd === 'set') {
    const [who, act] = args;
    const id = resolveToken(game.tokens, who);
    if (!party.some((p) => p.id === id)) throw new Error(`${game.tokens[id].name} is not a PC with game data`);
    const activity = !act || act === 'none' ? null : act;
    const opts = {};
    if (o.expert) opts.expert = resolveToken(game.tokens, o.expert);
    for (const k of ['skill', 'spell', 'effect']) if (o[k]) opts[k] = o[k];
    if (activity) {
      const av = availability(R, id, party, { ...choices, [id]: { activity, options: opts } }).find((x) => x.activity.id === activity);
      if (!av) throw new Error(`no activity "${activity}" (tools/exploration.mjs activities)`);
      if (av.need && !av.need.soft) lines.push(`WARNING: ${game.tokens[id].name} ${av.need.text}: it asks for nothing when combat starts.`);
      else if (av.need) lines.push(`Note: ${av.need.text}.`);
    }
    const data = exploreChoice({ activity, options: opts, note: o.note, by: 'claude' }, R);
    writes.push({ op: 'set', path: `${EXPLORE}/${id}`, data });
    const next = { ...choices, [id]: data };
    const c = pcExplore(R, id, party, next);
    lines.push(`${c.name}: ${c.title}${c.detail ? ` (${c.detail})` : ''}${c.warning ? ` (${c.warning})` : ''}`);
    const g = partyPace(R, party, next);
    if (g) lines.push(`Pace now: ${R.paceText(g)}`);
    audit(`exploration: ${c.name} is ${activity ? c.title : 'just travelling'}${c.detail ? ` (${c.detail})` : ''}`);
    return { lines, writes };
  }
  if (cmd === 'pace') { lines.push(paceLine()); return { lines, writes }; }
  if (cmd === 'reminders') { const r = reminders(R, party, choices); lines.push(...(r.length ? r.map((x) => x.text) : ['No activity asks for anything on entering an area.'])); return { lines, writes }; }
  if (cmd === 'requests') {
    const r = combatRequests(R, party, choices);
    lines.push(...(r.length ? r.map((x) => `${x.kind}: ${x.label}${x.stat ? ` (${x.stat})` : ''}${x.value ? ` (${x.type} ${x.value > 0 ? '+' : ''}${x.value})` : ''}`) : ['No activity asks for anything when combat starts.']));
    return { lines, writes };
  }
  if (cmd === 'travel') {
    const [value, unit] = args;
    const g = partyPace(R, party, choices);
    const terr = (R.terrain || []).find((t) => t[0] === (o.terrain || 'normal'));
    if (!terr) throw new Error(`terrain ${(R.terrain || []).map((t) => t[0]).join(', ')}`);
    const t = travelTime(g, { value: Number(value), unit: unit || 'ft' }, terr[2]);
    const minutes = Math.max(1, Math.round(t.seconds / 60));
    const out = runClock(game, 'advance', [`${minutes} minutes`]);
    const words = `${unit === 'min' || unit === 'hr' ? `${value} ${unit === 'min' ? 'minutes' : 'hours'}` : `${value} ${unit === 'mi' ? 'miles' : 'feet'}`}${terr[2] !== 1 ? ` through ${terr[1].toLowerCase()}` : ''}`;
    lines.push(`The party travels ${words}${g ? ` at ${R.paceText(g)}` : ''}: ${durationWords(minutes * 60)}${t.feet && (unit === 'min' || unit === 'hr') ? ` (about ${t.feet.toLocaleString('en-US')} ft)` : ''}.`);
    if (g && g.limit && minutes > g.limit.minutes) lines.push(`WARNING: longer than the pace can be kept up: ${g.limit.text}.`);
    lines.push(...out.lines);
    writes.push(...out.writes);
    audit(`exploration: the party travels ${words} (${durationWords(minutes * 60)})`);
    for (const r of reminders(R, party, choices)) lines.push(`Reminder: ${r.text}`);
    return { lines, writes };
  }
  if (cmd === 'content') {
    for (const a of R.activities) {
      if (!a.ref || game.onBoard[a.ref]) continue;
      const d = game.lib.get(a.ref);
      if (d) writes.push({ op: 'set', path: contentPath(a.ref), data: d });
    }
    lines.push(`${writes.length} activity record(s) to write`);
    return { lines, writes };
  }
  throw new Error(`unknown command "${cmd}"`);
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  try {
    const rec = opt('--records');
    const o = {};
    for (const k of ['expert', 'skill', 'spell', 'effect', 'note', 'terrain']) o[k] = opt(`--${k}`);
    const [pack, save, cmd, ...rest] = args;
    if (!pack || !save || !cmd) throw new Error('give a pack folder, a save folder and a command');
    const records = rec ? readRecords(JSON.parse(fs.readFileSync(rec, 'utf8'))) : null;
    const game = loadGame(pack, save, records);
    if (!records) {   // the save's choices
      const f = path.join(save, 'exploration.json');
      if (fs.existsSync(f)) for (const [id, c] of Object.entries(JSON.parse(fs.readFileSync(f, 'utf8')).choices || {})) game.records[`${EXPLORE}/${id}`] = c;
    }
    const out = runExploration(game, cmd, rest, o);
    if (['list', 'activities', 'pace', 'reminders', 'requests'].includes(cmd)) console.log(out.lines.join('\n'));
    else console.log(JSON.stringify(out, null, 2));
    return 0;
  } catch (e) {
    console.error(`exploration: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
