#!/usr/bin/env node
// Room shapes against the book's room crops (#17; docs/best-practices/adventure-importer.md, section 2): the room
// table floods each room's squares from a point inside it, bounded by our walls, so a wall the import missed lets
// the room run on into its neighbours. The book prints a crop of the map beside each room (registered by
// roomcrops.py). A room whose squares reach well outside its own crop's footprint is listed: a wall is probably
// missing there (or the room is open on purpose, which import.json's rooms clip or a note explains).
//
// Usage: node tools/advimport/cropcheck.mjs <pack-dir> <roomcrops.json> --levels A=level-a,B=level-b,C=roof [--slack 1]
// Only crops with one caption are used (a crop showing several rooms says nothing about one room's edges).

import fs from 'node:fs';
import path from 'node:path';

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** A crop's footprint in squares of its level map: [x0, y0, x1, y1]. */
export function footprint(crop, level) {
  const [[a, b, tx], [c, d, ty]] = crop.transform, [w, h] = crop.crop.px;
  const g = level.grid;
  const pts = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => [a * x + b * y + tx, c * x + d * y + ty])
    .map(([x, y]) => [(x - g.origin_px[0]) / g.cell_px, (y - g.origin_px[1]) / g.cell_px]);
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}

/** Squares of a room (rects [x, y, w, h]) lying more than `slack` squares outside a footprint. */
export function outside(rects, fp, slack = 1) {
  const out = [];
  for (const [x, y, w, h] of rects) for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) {
    if (i + 1 <= fp[0] - slack || i >= fp[2] + slack || j + 1 <= fp[1] - slack || j >= fp[3] + slack) out.push([i, j]);
  }
  return out;
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const levels = Object.fromEntries((opt('--levels') || '').split(',').filter(Boolean).map((p) => p.split('=')));
  const slack = Number(opt('--slack') || 1);
  const [packDir, cropsFile] = args;
  if (!packDir || !cropsFile || !Object.keys(levels).length) { console.error('usage: node tools/advimport/cropcheck.mjs <pack-dir> <roomcrops.json> --levels A=map-a,B=map-b [--slack 1]'); return 2; }
  const rc = readJson(cropsFile);
  const lv = Object.fromEntries(rc.levels.map((l) => [l.id, l]));
  let n = 0, flagged = 0;
  for (const p of rc.pages) {
    const keys = [...new Set((p.captions || []).map((c) => c[0]))];
    if (keys.length !== 1 || !levels[p.level]) continue;
    const key = keys[0], rf = path.join(packDir, 'maps', levels[p.level], 'rooms.json');
    if (!fs.existsSync(rf)) continue;
    const room = (readJson(rf).rooms || {})[key];
    if (!room) continue;
    n++;
    const fp = footprint(p, lv[p.level]);
    const out = outside(room.rects, fp, slack);
    if (out.length) {
      flagged++;
      console.log(`✗ ${key} (p ${p.page}): ${out.length} square(s) outside the book's crop (crop covers ${fp.map((v) => v.toFixed(1)).join(', ')}), e.g. ${out.slice(0, 4).map((c) => c.join(',')).join(' ')}`);
    }
  }
  console.log(`\n${n} rooms compared with their crops; ${flagged} reach outside (a wall may be missing)`);
  return 0;
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1])).href) process.exitCode = main(process.argv);
