#!/usr/bin/env node
// The adventure kickoff (a mandatory import step; docs/best-practices/adventure-importer.md, section 2c): every
// adventure opens with the book's way of starting the story (the scene-setting read-aloud, the backstory, where the
// heroes begin, and how the players are folded in: introductions, the first thing each hero does). The import keeps
// that as one event marked "kickoff", due when the party first arrives on the adventure's starting map (the GM moves
// it off the landing page), so Claude or a human GM narrates it before anything else.
//
// This step finds the opening in the book (the game system's cues: rulesets/<system>/bookimport.js kickoffCues) and
// checks the pack has its kickoff event: exactly one, with narration, page references, a trigger on the starting map,
// and stages covering what the book's opening does. Prints the findings; exits 1 when the kickoff is missing or
// wrong, with a skeleton to fill in from the book.
//
// Usage: node tools/advimport/kickoff.mjs <pack-dir> <text-dir> --pages A-B [--front N] [--json]
//   --pages: the adventure's pages (its opening is looked for from page 1 to a few pages into them; --front N:
//   how many, default 3).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAdventure } from './campaign.mjs';
import { systemReader } from './statmatch.mjs';

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** The book's opening: pages with cues, best first: [{page, cues: [{kind, at}]}]. */
export function findOpening(textDir, { from = 1, to = 6 } = {}, reader) {
  const out = [];
  for (let p = from; p <= to; p++) {
    const f = path.join(textDir, `p${String(p).padStart(3, '0')}.txt`);
    if (!fs.existsSync(f)) continue;
    const cues = reader.kickoffCues(fs.readFileSync(f, 'utf8'));
    if (cues.length) out.push({ page: p, cues });
  }
  return out;
}

/** Check the pack's kickoff against the book's opening: {kickoff, errors: [], warnings: [], skeleton?}. */
export function checkKickoff(adv, opening = []) {
  const errors = [], warnings = [];
  const ks = (adv.events || []).filter((e) => e.kickoff);
  const start = (adv.start && adv.start.map) || (adv.maps || [])[0] || null;
  const pages = opening.map((o) => o.page);
  const skeleton = {
    id: 'kickoff', kickoff: true, title: `${adv.title || 'The adventure'} begins`, kind: 'story', pages: pages.length ? `${Math.min(...pages)}-${Math.max(...pages)}` : '?',
    trigger: { map: start || '<the starting map>' },
    stages: [
      { id: 'setup', title: 'At the table', actions: [{ do: 'note', text: 'What the book asks before play: characters ready, sheets, where the heroes start (p ?).' }] },
      { id: 'scene', title: 'Setting the scene', actions: [{ do: 'narrate', text: 'Paraphrase the opening read-aloud: who the heroes are, how they come here, what happens (p ?).' }] },
      { id: 'into-play', title: 'Into the story', actions: [{ do: 'note', text: 'How the book folds the players in: where to place the PCs, the first thing each hero does, introductions (p ?).' }] },
    ],
  };
  if (!ks.length) errors.push('no kickoff event: add one (adventure-events.json events, "kickoff": true) from the book\'s opening');
  if (ks.length > 1) errors.push(`${ks.length} kickoff events (${ks.map((e) => e.id).join(', ')}): there is one`);
  const k = ks[0];
  if (k) {
    const acts = (k.stages || []).flatMap((s) => s.actions || []);
    if (!acts.some((a) => a.do === 'narrate')) errors.push(`${k.id}: no narration: the opening read-aloud, paraphrased`);
    if (!k.pages) errors.push(`${k.id}: no page references`);
    const mapIn = (c) => !!c && (c.map === start || (Array.isArray(c.map) && c.map.includes(start)) || (c.all || c.any || []).some(mapIn));
    if (start && !mapIn(k.trigger)) warnings.push(`${k.id}: its trigger does not name the starting map "${start}": it should be due when the party first arrives there`);
    // the book's opening, covered: its pages in the kickoff's, and the players folded in when the book does
    const kp = String(k.pages || '').split(/[,\s]+/).flatMap((r) => { const [a, b] = r.split('-').map(Number); return Number.isFinite(a) ? Array.from({ length: (b || a) - a + 1 }, (_, i) => a + i) : []; });
    const key = opening.filter((o) => o.cues.some((c) => c.kind === 'heading' || c.kind === 'read-aloud'));
    if (k.pages && key.length && !key.some((o) => kp.includes(o.page))) warnings.push(`${k.id}: pages ${k.pages} miss the book's opening (cues on p ${key.map((o) => o.page).join(', ')})`);
    if (opening.some((o) => o.cues.some((c) => c.kind === 'players')) && !acts.some((a) => /introduc|each player|each hero|around the table|first thing/i.test(a.text || ''))) warnings.push(`${k.id}: the book folds the players in (introductions, each hero's first action): say how in a stage`);
    if (opening.some((o) => o.cues.some((c) => c.kind === 'placement')) && !acts.some((a) => /place|pawn|start(?:s|ing)? (?:in|at)|token/i.test(a.text || ''))) warnings.push(`${k.id}: the book says where the heroes start: say so in a stage`);
    if (opening.some((o) => o.cues.some((c) => c.kind === 'xp')) && !acts.some((a) => a.do === 'xp')) warnings.push(`${k.id}: the book gives XP for starting: add it`);
  }
  return { kickoff: k || null, start, errors, warnings, ...(k ? {} : { skeleton }) };
}

async function main(argv) {
  const args = argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const json = args.includes('--json'); if (json) args.splice(args.indexOf('--json'), 1);
  const pagesOpt = opt('--pages'), front = Number(opt('--front') || 3);
  const [packDir, textDir] = args;
  if (!packDir || !textDir) { console.error('usage: node tools/advimport/kickoff.mjs <pack-dir> <text-dir> --pages A-B [--front N] [--json]'); return 2; }
  const pack = readJson(path.join(packDir, 'pack.json'));
  const reader = await systemReader(pack.ruleset).catch(() => null);
  if (!reader || !reader.kickoffCues) { console.error(`the ${pack.ruleset} system has no book reader for openings (rulesets/${pack.ruleset}/bookimport.js kickoffCues)`); return 1; }
  const first = pagesOpt ? Number(String(pagesOpt).split('-')[0]) : 1;
  const opening = findOpening(textDir, { from: 1, to: first + front - 1 }, reader);
  const r = checkKickoff(readAdventure(packDir), opening);
  if (json) { console.log(JSON.stringify({ opening, ...r }, null, 2)); return r.errors.length ? 1 : 0; }
  console.log('The book\'s opening:');
  if (!opening.length) console.log('  no cues found: find it by hand (the background, getting started, the first read-aloud)');
  for (const o of opening) console.log(`  p${o.page}: ${o.cues.map((c) => `${c.kind} ("${c.at.slice(0, 50)}")`).join('; ')}`);
  if (r.kickoff) console.log(`Kickoff: ${r.kickoff.id} "${r.kickoff.title}" (pp ${r.kickoff.pages}), ${r.kickoff.stages.length} stage(s): ${r.kickoff.stages.map((s) => s.id).join(', ')}`);
  for (const e of r.errors) console.log(`ERROR    ${e}`);
  for (const w of r.warnings) console.log(`WARNING  ${w}`);
  if (r.skeleton) console.log(`A skeleton to fill in from the book (adventure-events.json events):\n${JSON.stringify(r.skeleton, null, 1)}`);
  console.log(r.errors.length ? 'FAILED: the kickoff is missing or wrong' : `OK${r.warnings.length ? ` (${r.warnings.length} warning(s) to look at)` : ''}`);
  return r.errors.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv).then((c) => { process.exitCode = c; });
