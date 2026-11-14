#!/usr/bin/env node
// Grid sanity across a book (docs/best-practices/map-importer.md, section 4e): the maps of one PDF are usually printed
// at one scale, so a map whose squares come out at 2x or 3x (or 1/2, 1/3) the book's usual size has most likely
// locked onto every other grid line (or found a finer pattern). A grid found faint (weak) is flagged too.
//
// Usage: node tools/advimport/gridcheck.mjs <pack-dir> [--json]
//
// Reads each map's import.json (source.pdf), map.json (grid.cell_px) and import-report.json (grid: found, strength,
// weak, half). The book's usual size is the largest group of maps whose squares agree within 5% (two maps or more).
// A map is not flagged once its import.json says `grid_checked: "<what was checked>"` (looked at by eye, or a map
// printed at another scale on purpose). Exits 1 while anything is flagged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const CLOSE = 0.05, MULTIPLES = [2, 3];

/** Groups of cell sizes within 5% of the group's first: [[{id, cell}...]...], largest first. */
export function clusters(maps) {
  const out = [];
  for (const m of [...maps].sort((a, b) => a.cell - b.cell)) {
    const c = out.find((g) => Math.abs(m.cell / g[0].cell - 1) <= CLOSE);
    if (c) c.push(m); else out.push([m]);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** Flags for the maps of one PDF: [{id, why, propose?}]. */
export function checkGroup(maps) {
  const flags = [];
  const [main] = clusters(maps);
  const ref = main && main.length >= 2 ? main.reduce((s, m) => s + m.cell, 0) / main.length : null;
  for (const m of maps) {
    if (m.checked) continue;
    if (m.weak) flags.push({ id: m.id, why: `weak grid (strength ${m.strength}): check it by eye on the review sheet` });
    if (!ref || main.includes(m)) continue;
    for (const k of MULTIPLES) {
      if (Math.abs(m.cell / (ref * k) - 1) <= CLOSE) {
        flags.push({ id: m.id, why: `squares of ${m.cell} px are about ${k}x the book's usual ${ref.toFixed(1)} px: the grid may have locked onto every ${k === 2 ? 'other' : 'third'} line`,
          propose: m.half && k === 2 ? { cell_px: m.half.cell_px, strength: m.half.strength } : { cell_px: +(m.cell / k).toFixed(3) } });
      } else if (Math.abs((m.cell * k) / ref - 1) <= CLOSE) {
        flags.push({ id: m.id, why: `squares of ${m.cell} px are about 1/${k} of the book's usual ${ref.toFixed(1)} px: the grid may be a finer pattern than the squares`, propose: { cell_px: +(m.cell * k).toFixed(3) } });
      }
    }
  }
  return flags;
}

/** The pack's book maps, by source PDF. */
export function packMaps(packDir) {
  const dir = path.join(packDir, 'maps'), byPdf = {};
  for (const id of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    const imp = readJson(path.join(dir, id, 'import.json')), mj = readJson(path.join(dir, id, 'map.json'));
    if (!imp || !imp.source || !imp.source.pdf || !mj || !mj.grid || !mj.grid.cell_px) continue;
    const rep = (readJson(path.join(dir, id, 'import-report.json')) || {}).grid || {};
    (byPdf[imp.source.pdf] ||= []).push({ id, cell: mj.grid.cell_px, found: rep.found || (imp.grid === 'auto' ? 'auto' : 'given'),
      strength: rep.strength, weak: !!rep.weak, half: rep.half || null, checked: imp.grid_checked || null });
  }
  return byPdf;
}

function main(argv) {
  const packDir = argv.find((a) => !a.startsWith('--'));
  if (!packDir) { console.error('usage: node tools/advimport/gridcheck.mjs <pack-dir> [--json]'); return 2; }
  const byPdf = packMaps(packDir), flags = [];
  for (const [pdf, maps] of Object.entries(byPdf)) {
    const [main] = clusters(maps);
    console.log(`${path.basename(pdf)}: ${maps.length} map(s); usual squares ${main && main.length >= 2 ? (main.reduce((s, m) => s + m.cell, 0) / main.length).toFixed(1) + ' px (' + main.map((m) => m.id).join(', ') + ')' : 'not known (no two maps agree)'}`);
    for (const m of maps) if (m.checked) console.log(`  checked  ${m.id}: ${m.checked}`);
    flags.push(...checkGroup(maps));
  }
  if (argv.includes('--json')) console.log(JSON.stringify(flags, null, 1));
  else for (const f of flags) console.log(`CHECK  ${f.id}: ${f.why}${f.propose ? `; try cell_px ${f.propose.cell_px}` : ''} (then set grid_checked in its import.json)`);
  console.log(`${flags.length} grid(s) to check`);
  return flags.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
