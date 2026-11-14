#!/usr/bin/env node
// Links between levels from the book (#25; docs/best-practices/adventure-importer.md, section 2): stairs, lifts,
// ladders, shafts and trapdoors the text names in each keyed area, paired with the area they lead to on another map,
// against the links the maps already have (map.json links). Missing pairs are proposed in import.json's map.links
// format, both directions, for Claude to check against the maps (where the stairs are drawn) and the text.
//
// Usage: node tools/advimport/links.mjs <pack-dir> <text-dir> --pages A-B [--skip REGEX] [--json] [--all]
//   --all  propose every pair, also those the maps already link (to check the tool)
//
// The other end: an area key on another map named in the same sentence ("stairs down to B1"), else the area on the
// next or previous map in pack.json's order whose text names the same kind of way ("lift"), by "up"/"down" words
// (pack order is taken as going up; the proposal says which it assumed). Squares: each room's `at` point; move them
// onto the drawn stairs or lift before using them.

import fs from 'node:fs';
import path from 'node:path';
import { splitAreas, packIndex } from './areas.mjs';

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const WAYS = /\b(stair(?:s|case|way)?|steps|lift|elevator|ladder|trap ?door|shaft|chute)\b/i;
const kindOf = (s) => { const m = WAYS.exec(s); return m ? m[1].toLowerCase().replace(/^stair.*$/, 'stairs').replace('steps', 'stairs').replace('elevator', 'lift').replace('trap door', 'trapdoor') : null; };

/** Ways between levels named in the areas' text: [{from, to, kind, how}] by area key. */
export function waysBetween(areas, idx, mapOrder) {
  const out = [];
  const mapOf = (k) => (idx.rooms[k] || {}).map;
  const sentences = (t) => t.replace(/\s*\n\s*/g, ' ').split(/(?<=[.!?])\s+/);
  const mentions = {};   // map -> kind -> [area keys whose text names that kind]
  for (const a of Object.values(areas)) {
    const m = mapOf(a.key);
    if (!m) continue;
    for (const s of sentences(a.text)) {
      const kind = kindOf(s);
      if (!kind) continue;
      ((mentions[m] = mentions[m] || {})[kind] = mentions[m][kind] || new Set()).add(a.key);
      for (const ref of s.matchAll(/\b([A-Z]{1,2}\d{1,2}[a-z]?)\b/g)) {
        const t = ref[1], tm = mapOf(t);
        if (tm && tm !== m) out.push({ from: a.key, to: t, kind, sure: 'named', how: `named together: ${s.slice(0, 70)}...`, sentence: s });
      }
      const up = /\b(up|upper|rises|ascend|above|roof)\b/i.test(s), down = /\b(down|lower|descend|below|beneath)\b/i.test(s);
      if (up !== down) (((a.dir = a.dir || {})[kind] = a.dir[kind] || new Set())).add(up ? 'up' : 'down');
    }
  }
  // the same kind of way on the next or previous map: a lift on one level and a lift on the next
  for (const a of Object.values(areas)) {
    const m = mapOf(a.key);
    if (!m || !a.dir) continue;
    for (const [kind, dirs] of Object.entries(a.dir)) for (const dir of dirs) {
      const i = mapOrder.indexOf(m), tm = mapOrder[dir === 'up' ? i + 1 : i - 1];
      const cands = [...((mentions[tm] || {})[kind] || [])];
      // the other end goes the other way: a lift up meets a lift down; areas that say nothing either way come next
      const opposite = cands.filter((t) => areas[t] && areas[t].dir && areas[t].dir[kind] && areas[t].dir[kind].has(dir === 'up' ? 'down' : 'up'));
      const silent = cands.filter((t) => !(areas[t] && areas[t].dir && areas[t].dir[kind]));
      const pick = opposite.length ? opposite : silent.length ? silent : cands;
      const sure = opposite.length ? 'likely' : 'weak';
      for (const t of pick) {
        if (!out.some((w) => (w.from === a.key && w.to === t) || (w.from === t && w.to === a.key))) out.push({ from: a.key, to: t, kind, sure, how: `${sure}: the ${kind} ${dir} from ${a.key}, and ${t} names a ${kind}${opposite.length ? ` going ${dir === 'up' ? 'down' : 'up'}` : ''} (pack order taken as going up)` });
      }
    }
  }
  // one per pair
  const seen = new Set();
  return out.filter((w) => { const k = [w.from, w.to].sort().join('|'); if (seen.has(k)) return false; seen.add(k); return true; });
}

async function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  const json = flag('--json'), all = flag('--all');
  const pages = opt('--pages'), skipArg = opt('--skip');
  const [packDir, textDir] = args;
  if (!packDir || !textDir) { console.error('usage: node tools/advimport/links.mjs <pack-dir> <text-dir> --pages A-B [--skip REGEX] [--json] [--all]'); return 2; }
  const { pack, idx } = packIndex(packDir);
  let files = fs.readdirSync(textDir).filter((f) => /^p\d+\.txt$/.test(f)).sort();
  if (pages) { const [a, b] = pages.split('-').map(Number); files = files.filter((f) => { const n = Number(f.slice(1, -4)); return n >= a && n <= (b || a); }); }
  const areas = splitAreas(files.map((f) => ({ page: Number(f.slice(1, -4)), text: fs.readFileSync(path.join(textDir, f), 'utf8') })), { skip: skipArg ? new RegExp(skipArg) : null, caps: process.argv.includes('--caps-headings') });
  const order = (pack.maps || []).filter((m) => fs.existsSync(path.join(packDir, 'maps', m, 'rooms.json')));
  const ways = waysBetween(areas, idx, order);
  const links = Object.fromEntries(order.map((m) => [m, readJson(path.join(packDir, 'maps', m, 'map.json')).links || []]));
  const inRoom = (k, sq) => idx.rooms[k].rects.some(([x, y, w, h]) => sq[0] >= x - 1 && sq[0] < x + w + 1 && sq[1] >= y - 1 && sq[1] < y + h + 1);
  const report = [];
  for (const w of ways) {
    const fm = idx.rooms[w.from].map, tm = idx.rooms[w.to].map;
    const have = links[fm].find((l) => l.to_map === tm && (l.at || []).some((sq) => inRoom(w.from, sq)));
    if (have && !all) { report.push({ ...w, linked: have.id }); continue; }
    const at = (k) => [Math.floor(idx.rooms[k].at[0]), Math.floor(idx.rooms[k].at[1])];
    const id = (a, b) => `${w.kind}-${a.toLowerCase()}-${b.toLowerCase()}`;
    report.push({ ...w, linked: have ? have.id : null, propose: [
      { map: fm, link: { id: id(w.from, w.to), label: `${w.kind[0].toUpperCase()}${w.kind.slice(1)} to ${w.to}`, at: [at(w.from)], to_map: tm, to_link: id(w.to, w.from), arrive: [at(w.to)], found: false } },
      { map: tm, link: { id: id(w.to, w.from), label: `${w.kind[0].toUpperCase()}${w.kind.slice(1)} to ${w.from}`, at: [at(w.to)], to_map: fm, to_link: id(w.from, w.to), arrive: [at(w.from)], found: false } },
    ] });
  }
  if (json) { console.log(JSON.stringify(report, null, 1)); return 0; }
  for (const r of report) console.log(`${r.linked && !r.propose ? '✓' : r.linked ? '=' : '✗'} ${r.from} ↔ ${r.to}  ${r.kind}${r.linked ? `  (linked: ${r.linked})` : ''}\n      ${r.how}`);
  const miss = report.filter((r) => !r.linked).length;
  console.log(`\n${report.length} way(s) between levels in the text; ${miss} not linked on the maps${miss ? ' (--json for the proposed links)' : ''}`);
  return 0;
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1])).href) main(process.argv).then((c) => { process.exitCode = c; });
