#!/usr/bin/env node
// One command for a whole adventure import (docs/best-practices/adventure-importer.md, section 2): runs the pack's
// steps in order and keeps a status table of what is up to date, out of date, failed or waiting for review.
//
// Usage:
//   node tools/advimport/run.mjs <pack-dir> init           write a pipeline.json with the standard steps to edit
//   node tools/advimport/run.mjs <pack-dir> [status]       the table
//   node tools/advimport/run.mjs <pack-dir> run [ids...]   run what is out of date (or the named steps), in order
//                                                          [--force: run them even when up to date]
//   node tools/advimport/run.mjs <pack-dir> approve <id>   mark a step's output as reviewed by Claude
//   node tools/advimport/run.mjs <pack-dir> mark <ids...>  record steps as done without running them (a pack
//                                                          imported by hand before it had a pipeline)
//
// <pack>/pipeline.json: {vars: {name: value}, steps: [{id, run, inputs?, outputs?, each?, review?, note?}]}.
//   run      a shell command, or a list of them, with {pack} {id} {save} {extracted} {repo}, {map} (with each)
//            and any var substituted.
//   inputs   files and globs (relative to the repository) the step reads; outputs: what it writes.
//   each     "map": once per map folder of the pack that has an import.json ({map} is its id).
//   review   the result needs Claude's look before the import goes on: after a run the step waits for
//            `approve`; later steps still run, and the table says what is waiting.
// A step is out of date when it never ran, its definition changed, an output is missing, or an input is newer than
// its last successful run. A step with no outputs (a check) is out of date the same way. State is kept in
// <pack>/.pipeline-state.json (private, with the pack).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** The standard steps of an adventure import (`init` writes them; each pack edits its own copy). */
export function standardPipeline(packId) {
  return {
    vars: { book: 'pdfsource/<adventure>.pdf', maps_pdf: 'pdfsource/<level maps>.pdf', levels: 'A=<maps.pdf>:1', crop_levels: 'A=<map id>', pages: '4-35', running_heads: '^(<RUNNING HEAD>)' },
    steps: [
      { id: 'text', run: 'node tools/advimport/pagetext.mjs {book} {extracted}/text', inputs: ['{book}'], outputs: ['{extracted}/text/p001.txt'], note: 'every page as text' },
      { id: 'roomcrops', run: 'python3 tools/advimport/roomcrops.py {book} --level {levels} --out {extracted}/roomcrops.json --images {extracted}/markers', inputs: ['{book}', '{maps_pdf}'], outputs: ['{extracted}/roomcrops.json'] },
      { id: 'landing', run: 'python3 tools/advimport/landing.py {pack} --pdf {book} --page 1', inputs: ['{book}'], outputs: ['{pack}/maps/landing/map.json'], review: true, note: 'the cover; ask the user when the book has none' },
      { id: 'map', each: 'map', run: 'python3 tools/mapimport/build.py {pack}/maps/{map}/import.json', inputs: ['{pack}/maps/{map}/import.json', 'tools/mapimport/profiles.json', '{pack}/maps/{map}/rooms.json'], outputs: ['{pack}/maps/{map}/walls.json'], review: true },
      { id: 'mapcheck', each: 'map', run: 'node tools/mapcheck.mjs {pack}/maps/{map}', inputs: ['{pack}/maps/{map}/walls.json', '{pack}/maps/{map}/rooms.json', '{pack}/maps/{map}/import.json'] },
      { id: 'review-sheet', run: 'python3 tools/advimport/reviewsheet.py {pack} --book {book} --crops {extracted}/roomcrops.json --levels {crop_levels}', inputs: ['{pack}/maps/*/walls.json', '{pack}/maps/*/rooms.json', '{extracted}/roomcrops.json'], outputs: ['{pack}/review/*.png'], review: true, note: 'Claude looks at every room beside the book\'s crop' },
      { id: 'cropcheck', run: 'node tools/advimport/cropcheck.mjs {pack} {extracted}/roomcrops.json --levels {crop_levels}', inputs: ['{extracted}/roomcrops.json', '{pack}/maps/*/rooms.json'], note: 'rooms against the book\'s crops' },
      { id: 'adventure', run: 'python3 {pack}/build_adventure.py', inputs: ['{pack}/build_adventure.py'], outputs: ['{pack}/adventure.json'] },
      { id: 'statmatch', run: 'node tools/advimport/statmatch.mjs {pack} {extracted}/text --pages {pages} --skip "{running_heads}"', inputs: ['{extracted}/text/p001.txt', '{pack}/adventure.json'], review: true },
      { id: 'areas', run: 'node tools/advimport/areas.mjs {pack} {extracted}/text --pages {pages} --skip "{running_heads}" --proposals {pack}/area-proposals.json', inputs: ['{extracted}/text/p001.txt', '{pack}/adventure.json', '{pack}/notes/*.md', '{pack}/checklist.json', '{pack}/maps/*/walls.json', '{pack}/maps/*/rooms.json', '{pack}/maps/*/lighting.json', '{pack}/maps/*/terrain.json'], review: true, note: 'every area of the book accounted for' },
      { id: 'loot', run: 'node tools/advimport/lootmatch.mjs {pack} {extracted}/text --pages {pages} --skip "{running_heads}"', inputs: ['{extracted}/text/p001.txt', '{pack}/adventure.json', '{pack}/checklist.json'], review: true, note: 'items and hazards against the content and the book' },
      { id: 'art', run: 'python3 tools/advimport/tokenart.py {pack}/art/art.json', inputs: ['{pack}/art/art.json'], outputs: ['{pack}/art/tokens'] },
      { id: 'campaign', run: 'node tools/advimport/campaign.mjs {pack} {save} --update', inputs: ['{pack}/adventure.json', '{pack}/pack.json', '{pack}/maps/*/walls.json', '{pack}/maps/*/map.json'], outputs: ['{save}/campaign.json'] },
      { id: 'validate', run: 'node tools/validate.mjs {pack} --save {save}', inputs: ['{pack}/maps/*/walls.json', '{save}/campaign.json'] },
      { id: 'review-page', run: 'python3 tools/advimport/review.py {pack} --save {save}', inputs: ['{save}/campaign.json', '{pack}/maps/*/walls.json'], outputs: ['{pack}/review.html'] },
    ],
  };
}

const stepHash = (s) => crypto.createHash('sha1').update(JSON.stringify(s)).digest('hex').slice(0, 12);

function subst(text, vars) {
  return String(text).replace(/\{([a-z_]+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}

/** Files matching a glob relative to the repository (* and ** only), or the path itself. */
function expand(pattern) {
  if (!/[*?]/.test(pattern)) return [pattern];
  try { return fs.globSync(pattern, { cwd: REPO }); } catch { return []; }
}
const mtime = (rel) => { try { return fs.statSync(path.resolve(REPO, rel)).mtimeMs; } catch { return null; } };

/** The pack's steps with each "each: map" step expanded once per map folder that has an import.json. */
export function expandSteps(packDir, pipeline) {
  const rel = path.relative(REPO, path.resolve(packDir)) || '.';
  const pack = readJson(path.join(packDir, 'pack.json'));
  const vars = { repo: REPO, pack: rel, id: pack.id, save: `saves/${pack.id}`, extracted: `extracted/${pack.id}`, ...(pipeline.vars || {}) };
  const out = [];
  for (const s of pipeline.steps) {
    if (s.each === 'map') {
      const maps = (pack.maps || []).filter((m) => fs.existsSync(path.join(packDir, 'maps', m, 'import.json')));
      for (const m of maps) out.push(resolve(s, { ...vars, map: m }, `${s.id}:${m}`));
    } else out.push(resolve(s, vars, s.id));
  }
  return out;
}
function resolve(s, vars, id) {
  const runs = (Array.isArray(s.run) ? s.run : [s.run]).map((r) => subst(r, vars));
  const files = (l) => (l || []).map((p) => subst(p, vars));
  return { id, base: s.id, run: runs, inputs: files(s.inputs), outputs: files(s.outputs), review: !!s.review, note: s.note || '', hash: stepHash({ ...s, run: runs }) };
}

/** Where a step stands: {state: 'ok'|'review'|'stale'|'failed'|'new', why}. */
export function stepState(step, rec) {
  if (!rec) return { state: 'new', why: 'never run' };
  if (rec.hash !== step.hash) return { state: 'stale', why: 'the step changed' };
  if (rec.status === 'failed') return { state: 'failed', why: rec.error || 'failed' };
  for (const o of step.outputs) if (!expand(o).some((f) => mtime(f) !== null)) return { state: 'stale', why: `${o} is missing` };
  for (const i of step.inputs) {
    for (const f of expand(i)) {
      const t = mtime(f);
      if (t !== null && t > rec.at + 1) return { state: 'stale', why: `${f} changed` };
    }
  }
  if (step.review && !rec.approved) return { state: 'review', why: 'waiting for review' };
  return { state: 'ok', why: '' };
}

function loadState(packDir) { const f = path.join(packDir, '.pipeline-state.json'); return fs.existsSync(f) ? readJson(f) : {}; }
function saveState(packDir, st) { fs.writeFileSync(path.join(packDir, '.pipeline-state.json'), JSON.stringify(st, null, 1) + '\n'); }

function table(steps, st) {
  const rows = steps.map((s) => { const r = stepState(s, st[s.id]); return [s.id, r.state, st[s.id] ? new Date(st[s.id].at).toISOString().slice(0, 16).replace('T', ' ') : '-', r.why || s.note]; });
  const w = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i].length), ['step', 'state', 'last run'][i].length));
  const line = (r) => r.map((c, i) => (i < 3 ? c.padEnd(w[i]) : c)).join('  ');
  return [line(['step', 'state', 'last run', 'why']), ...rows.map(line)].join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  const force = args.includes('--force'); if (force) args.splice(args.indexOf('--force'), 1);
  const [packDir, cmd = 'status', ...ids] = args;
  if (!packDir) { console.error('usage: node tools/advimport/run.mjs <pack-dir> [init|status|run [ids...] [--force]|approve <id>]'); return 2; }
  const pf = path.join(packDir, 'pipeline.json');
  if (cmd === 'init') {
    if (fs.existsSync(pf)) { console.error(`${pf} exists`); return 1; }
    fs.writeFileSync(pf, JSON.stringify(standardPipeline(readJson(path.join(packDir, 'pack.json')).id), null, 1) + '\n');
    console.log(`wrote ${pf}: fill in its vars and remove the steps this adventure does not need`);
    return 0;
  }
  if (!fs.existsSync(pf)) { console.error(`no ${pf} (node tools/advimport/run.mjs ${packDir} init)`); return 1; }
  const steps = expandSteps(packDir, readJson(pf));
  const st = loadState(packDir);
  if (cmd === 'status') { console.log(table(steps, st)); return 0; }
  if (cmd === 'approve') {
    const hit = steps.filter((s) => ids.includes(s.id) || ids.includes(s.base));
    if (!hit.length) { console.error(`no step ${ids.join(' ')}`); return 1; }
    for (const s of hit) if (st[s.id]) st[s.id].approved = true;
    saveState(packDir, st);
    console.log(table(steps, st));
    return 0;
  }
  if (cmd === 'mark') {
    const hit = steps.filter((s) => ids.includes(s.id) || ids.includes(s.base));
    for (const s of hit) st[s.id] = { hash: s.hash, at: Date.now(), status: 'ok', approved: true, marked: true };
    saveState(packDir, st);
    console.log(table(steps, st));
    return 0;
  }
  if (cmd !== 'run') { console.error(`unknown command ${cmd}`); return 2; }
  const chosen = ids.length ? steps.filter((s) => ids.includes(s.id) || ids.includes(s.base)) : steps;
  let failed = false;
  for (const s of chosen) {
    const before = stepState(s, st[s.id]);
    if (!force && !ids.length && (before.state === 'ok' || before.state === 'review')) continue;
    console.log(`\n== ${s.id}: ${before.why || 'run'}`);
    const at = Date.now();
    let error = null;
    for (const c of s.run) {
      const r = spawnSync(c, { cwd: REPO, shell: true, encoding: 'utf8', maxBuffer: 64 << 20 });
      const outText = ((r.stdout || '') + (r.stderr || '')).trim();
      if (outText) console.log(outText.split('\n').slice(-12).join('\n'));
      if (r.status !== 0) { error = (outText.split('\n').filter(Boolean).pop() || `exit ${r.status}`).slice(0, 160); break; }
    }
    st[s.id] = { hash: s.hash, at, status: error ? 'failed' : 'ok', ...(error ? { error } : {}), approved: false };
    saveState(packDir, st);
    if (error) { failed = true; console.log(`!! ${s.id} failed: ${error}`); break; }
  }
  console.log('\n' + table(steps, st));
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1])).href) process.exitCode = main(process.argv);
