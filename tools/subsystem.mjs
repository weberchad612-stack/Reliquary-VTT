#!/usr/bin/env node
// Subsystems from chat (engine/events/subsystem.js; the system's kinds in rulesets/<system>/subsystems.js): Victory
// Points, Influence, Chase, Infiltration and Research in PF2E. Points come from the rolls (the user's decision,
// 2026-11-13): a check's degree of success adds the subsystem's points; a threshold reached fires what it says (a flag
// events wait on, a DC change, the end). Players see the revealed parts on their card; DCs and thresholds stay the GM's.
//
// Usage: node tools/subsystem.mjs <pack-dir> <save-dir> [--records FILE] <command> ...
//   list                                   every subsystem: kind, status, points
//   show <id> [--player]                   the whole subsystem (the GM's), or what the players see
//   start <id> [--show]                    it begins (and with --show, the players' card appears)
//   check <id> <part> --who PC --skill S --roll N [--n K] [--bonus N]
//                                          a check against the part's check (the K-th, default the first with that
//                                          skill), DC adjusted by thresholds reached; the card, then the points
//   score <id> [part] <degree> [--who PC]  points for a degree already rolled (critical-success, success, failure,
//                                          critical-failure)
//   add <id> <track | part> <n> [--why "words"]   points by hand (a spell that helps, a complication)
//   round <id>                             a new round (an infiltration's Awareness rises)
//   reveal <id> <part | track> [part | check:N | note:N | threshold:ID]
//   players <id> on|off                    show or hide the players' card
//   end <id> success|failure|done
// Changing commands print {lines, writes}. Docs: docs/best-practices/events.md (Subsystems).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGame } from './actor.mjs';
import { readRecords } from './replay.mjs';
import { runCheck } from './check.mjs';
import { score, addPoints, subsystemRound, reveal, playerView, dcShift } from '../engine/events/subsystem.js';
import { auditPath, auditEntry } from '../board/audit.js';
import { gameArgs } from './campaign.mjs';

/** Run one command: {lines, writes, result?}. */
export function runSubsystem(game, cmd, args = [], o = {}) {
  const subs = game.subsystems || {};
  const lines = [], writes = [];
  const now = game.clock ? game.clock.now : 0;
  const get = (id) => { const s = subs[id]; if (!s) throw new Error(`no subsystem "${id}" (list shows them)`); return s; };
  const audit = (text) => writes.push({ op: 'set', path: auditPath(), data: auditEntry({ text, by: 'claude' }) });
  let flags = null;
  const flag = (name, v) => { flags = flags || { ...(game.flags || {}) }; flags[name] = v; };
  const put = (id, s) => { subs[id] = s; game.subsystems = subs; writes.push({ op: 'set', path: `subsystems/${id}`, data: s }); };
  // after points: thresholds reached set their flags (and <id>:<threshold>), an end sets <id>:<status>
  const after = (id, before, r) => {
    for (const x of r.reached) { flag(x.threshold.flag || `${id}:${x.threshold.id}`, now); }
    if (r.sub.status !== before.status && ['success', 'failure'].includes(r.sub.status)) flag(`${id}:${r.sub.status}`, now);
    for (const p of r.done) flag(`${id}:${p}`, now);
    put(id, r.sub);
    lines.push(...r.lines);
    audit(`${r.sub.title}: ${r.lines.join('; ')}`);
    if (r.reached.length || r.done.length || r.sub.status !== before.status) lines.push('Check events: node tools/events.mjs ... due');
  };
  const finish = () => { if (flags) { game.flags = flags; writes.push({ op: 'set', path: 'state/flags', data: flags }); } return { lines, writes }; };
  const pointsLine = (s) => Object.values(s.tracks || {}).map((t) => `${t.label} ${t.value || 0}${t.goal ? `/${t.goal}` : ''}`)
    .concat((s.parts || []).filter((p) => p.goal).map((p) => `${p.label} ${p.individual ? JSON.stringify(p.per || {}) : `${p.value || 0}/${p.goal}`}${p.done ? ' done' : ''}`)).join('; ');

  if (cmd === 'list') {
    if (!Object.keys(subs).length) lines.push('No subsystems in this campaign.');
    for (const [id, s] of Object.entries(subs)) lines.push(`${id}  ${s.kind} ${s.status}${s.shown ? ' (players see it)' : ''}  "${s.title}"  ${pointsLine(s)}`);
    return { lines, writes };
  }
  const [id, ...rest] = args;
  const s0 = get(id);
  if (cmd === 'show') {
    if (o.player) { lines.push(JSON.stringify(playerView(s0), null, 2)); return { lines, writes }; }
    lines.push(`${s0.title} (${s0.kind}, ${s0.status})${s0.rounds ? `, round ${s0.rounds.n || 0}${s0.rounds.limit ? ` of ${s0.rounds.limit}` : ''}` : ''}${dcShift(s0) ? `; DCs +${dcShift(s0)}` : ''}`);
    for (const [tid, t] of Object.entries(s0.tracks || {})) {
      lines.push(`  ${tid}: ${t.label} ${t.value || 0}${t.goal ? ` of ${t.goal}` : ''}`);
      for (const th of t.thresholds || []) lines.push(`    ${th.reached !== undefined ? '✓' : ' '} ${th.at} ${th.label || th.id}${th.text ? `: ${th.text}` : ''}${th.revealed ? ' (revealed)' : ''}`);
    }
    for (const p of s0.parts || []) {
      lines.push(`  ${p.id}: ${p.label}${p.goal ? ` ${p.individual ? JSON.stringify(p.per || {}) : `${p.value || 0}/${p.goal}`}` : p.value !== undefined ? ` ${p.value}` : ''}${p.done ? ' (overcome)' : ''}${p.revealed ? '' : ' (hidden)'}`);
      (p.checks || []).forEach((c, n) => lines.push(`    check ${n}: ${c.skill}${c.dc !== undefined ? ` DC ${c.dc + dcShift(s0)}` : ''}${c.revealed ? ' (revealed)' : ''}${c.note ? ` (${c.note})` : ''}`));
      (p.notes || []).forEach((x, n) => lines.push(`    note ${n}: ${x.text}${x.revealed ? ' (revealed)' : ''}`));
      for (const th of p.thresholds || []) lines.push(`    ${th.reached !== undefined ? '✓' : ' '} ${th.at} ${th.label || th.id}${th.text ? `: ${th.text}` : ''}`);
    }
    return { lines, writes };
  }
  if (cmd === 'start') {
    put(id, { ...s0, status: 'active', ...(o.show ? { shown: true } : {}) });
    audit(`${s0.title} begins`);
    lines.push(`${s0.title} begins${o.show ? '; the players see its card' : ''}.`);
    return finish();
  }
  if (cmd === 'players') {
    put(id, { ...s0, shown: rest[0] !== 'off' });
    lines.push(`${s0.title}: the players' card is ${rest[0] !== 'off' ? 'shown' : 'hidden'}.`);
    return finish();
  }
  if (cmd === 'end') {
    const st = rest[0] || 'done';
    if (!['success', 'failure', 'done'].includes(st)) throw new Error('end <id> success|failure|done');
    put(id, { ...s0, status: st });
    if (st !== 'done') flag(`${id}:${st}`, now);
    audit(`${s0.title} ends: ${st}`);
    lines.push(`${s0.title} ends: ${st}.`);
    return finish();
  }
  if (s0.status !== 'active' && ['check', 'score', 'add', 'round'].includes(cmd)) throw new Error(`${s0.title} is ${s0.status}: start it first`);
  if (cmd === 'check') {
    const [part] = rest;
    const p = (s0.parts || []).find((x) => x.id === part);
    if (!p) throw new Error(`no part "${part}" in ${id}`);
    if (!o.who || !o.skill) throw new Error('check <id> <part> --who PC --skill S --roll N');
    const skill = String(o.skill).toLowerCase();
    const cands = (p.checks || []).filter((c) => String(c.skill).toLowerCase() === skill);
    const c = o.n !== undefined ? (p.checks || [])[o.n] : cands[0];
    if (!c || c.dc === undefined) throw new Error(`${p.label} has no ${o.skill} check with a DC (show ${id} lists them); for another skill give --n, or roll it with check.mjs and use score`);
    const dc = c.dc + dcShift(s0);
    const r = runCheck(game, { who: o.who, stat: skill, dc, roll: o.roll, bonus: o.bonus || 0 });
    writes.push(...(r.writes || []));
    lines.push(...r.lines);
    after(id, s0, score(s0, { part, degree: r.degree, who: o.who, now }));
    return { ...finish(), result: { degree: r.degree, total: r.total, dc } };
  }
  if (cmd === 'score') {
    const [a, b] = rest;
    const part = b === undefined ? null : a, degree = b === undefined ? a : b;
    after(id, s0, score(s0, { part, degree, who: o.who || null, now }));
    return finish();
  }
  if (cmd === 'add') {
    const [target, n] = rest;
    const isPart = (s0.parts || []).some((x) => x.id === target);
    after(id, s0, addPoints(s0, { [isPart ? 'part' : target]: Number(n) }, { part: isPart ? target : null, who: o.who || null, now, why: o.why || 'by hand' }));
    return finish();
  }
  if (cmd === 'round') { after(id, s0, subsystemRound(s0, now)); return finish(); }
  if (cmd === 'reveal') {
    const [what, which] = rest;
    put(id, reveal(s0, what, which || 'part'));
    audit(`${s0.title}: revealed ${what}${which ? ` ${which}` : ''}`);
    lines.push(`Revealed ${what}${which ? ` ${which}` : ''} to the players.`);
    return finish();
  }
  throw new Error('commands: list, show, start, check, score, add, round, reveal, players, end');
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flagOpt = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const rec = opt('--records'), who = opt('--who'), skill = opt('--skill'), roll = opt('--roll'), n = opt('--n'), bonus = opt('--bonus'), why = opt('--why');
    const player = flagOpt('--player'), show = flagOpt('--show');
    const [pack, save, cmd, ...rest] = gameArgs(args);
    if (!save || !cmd) { console.error('usage: node tools/subsystem.mjs <pack-dir> <save-dir> [--records FILE] <command> ... (see the head of this file)'); return 2; }
    const records = rec ? readRecords(JSON.parse(fs.readFileSync(rec, 'utf8'))) : null;
    const game = loadGame(pack, save, records);
    const out = runSubsystem(game, cmd, rest, { who, skill, roll, n: n === undefined ? undefined : Number(n), bonus: bonus === undefined ? 0 : Number(bonus), why, player, show });
    if (['list', 'show'].includes(cmd)) console.log(out.lines.join('\n'));
    else console.log(JSON.stringify(out, null, 2));
    return 0;
  } catch (e) {
    console.error(e.message);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
