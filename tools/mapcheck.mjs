#!/usr/bin/env node
// The map check (docs/best-practices/map-importer.md): sight from every keyed room with every door closed, and
// walking routes with every door open, in one report. Run it after every import change.
//
// Usage:
//   node tools/mapcheck.mjs <map-dir> [--json] [--slack CELLS]
//
// Rooms: the map's rooms.json (tools/advimport/roomtable.py: each key's squares), else the import settings' `rooms`
// points (sight only, against nothing: listed, not checked). For each room, sight is taken from its point (and from
// every one of its squares' centres with --thorough); a point the sight reaches more than --slack cells (default
// 0.35) outside the room's squares is a leak, reported with where it is, unless the room lists it in `sees`
// (import.json checks.sees: {room: [other rooms it may see into: through a window, a breach the art draws]}).
// Routes: import.json checks.routes: [{from: [x, y], to: [x, y], blocked?: true, note?}]; every door is open (secret
// doors found) except those whose `blocked` reason says they cannot open. A route marked blocked must fail; any other
// must succeed. Exit code 1 when anything fails.

import fs from 'node:fs';
import path from 'node:path';
import { prepare, visPolygon } from '../engine/sight/visibility.js';
import { prepareMove, path as findPath } from '../engine/movement/movement.js';
import { loadMap } from './sight.mjs';

export function checkMap(dir, { slack = 0.35, thorough = false } = {}) {
  const { map, segs } = loadMap(dir);
  const read = (f) => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : null);
  const rooms = (read('rooms.json') || {}).rooms || {};
  const imp = read('import.json') || {};
  const checks = imp.checks || {};
  const opts = { feetPerCell: map.grid.feet_per_cell || 5, grid: map.grid };
  const owner = new Map();
  for (const [k, r] of Object.entries(rooms)) for (const [x, y, w, h] of r.rects) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) owner.set(`${x + i},${y + j}`, k);
  const closed = prepare(segs, {}, 'sight');
  const out = { map: map.id, leaks: [], routes: [], ok: true };
  for (const [key, r] of Object.entries(rooms)) {
    const may = new Set([key, ...((checks.sees || {})[key] || [])]);
    const inside = (p) => {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const cx = Math.floor(p[0] + dx * slack), cy = Math.floor(p[1] + dy * slack);
        const o = owner.get(`${cx},${cy}`) || 'outside';   // squares in no room: rock, the map's margin
        if (may.has(o)) return true;
      }
      return false;
    };
    const from = thorough ? r.rects.flatMap(([x, y, w, h]) => Array.from({ length: w * h }, (_, n) => [x + (n % w) + 0.5, y + Math.floor(n / w) + 0.5])) : [r.at];
    const bad = [];
    for (const f of from) for (const p of visPolygon(f, closed, opts)) {
      if (p[0] < 0 || p[1] < 0 || p[0] > map.grid.cols || p[1] > map.grid.rows) continue;   // past the map's edge: nothing there
      if (!inside(p)) bad.push([+p[0].toFixed(2), +p[1].toFixed(2), owner.get(`${Math.floor(p[0])},${Math.floor(p[1])}`) || 'outside']);
    }
    if (bad.length) { out.leaks.push({ room: key, points: bad.slice(0, 6), count: bad.length }); out.ok = false; }
  }
  const doors = {};
  for (const s of segs) if (s.door && !s.door.blocked) doors[s.door.id] = { state: 'open', found: true };
  const pm = prepareMove(segs, { doors }, map.grid);
  for (const r of checks.routes || []) {
    const res = findPath(pm, { x: r.from[0], y: r.from[1], size: 1 }, r.to[0], r.to[1]);
    const okRoute = r.blocked ? !res : !!res;
    out.routes.push({ from: r.from, to: r.to, expect: r.blocked ? 'blocked' : 'open', got: res ? `${res.feet ?? res.cost * 5} ft` : 'blocked', ok: okRoute, note: r.note });
    if (!okRoute) out.ok = false;
  }
  return out;
}

function main(argv) {
  const args = argv.slice(2);
  const json = args.includes('--json'); if (json) args.splice(args.indexOf('--json'), 1);
  const thorough = args.includes('--thorough'); if (thorough) args.splice(args.indexOf('--thorough'), 1);
  const si = args.indexOf('--slack'); const slack = si >= 0 ? Number(args.splice(si, 2)[1]) : 0.35;
  if (args.length !== 1) { console.error('usage: node tools/mapcheck.mjs <map-dir> [--json] [--thorough] [--slack CELLS]'); return 2; }
  const r = checkMap(path.resolve(args[0]), { slack, thorough });
  if (json) { console.log(JSON.stringify(r, null, 1)); return r.ok ? 0 : 1; }
  console.log(`${r.map}: ${r.ok ? 'OK' : 'PROBLEMS'}`);
  for (const l of r.leaks) console.log(`  LEAK  ${l.room}: ${l.count} point(s) outside, e.g. ${l.points.map((p) => `${p[0]},${p[1]} (${p[2]})`).join('; ')}`);
  for (const t of r.routes) console.log(`  ${t.ok ? 'ok   ' : 'FAIL '} route ${t.from} -> ${t.to}: ${t.got} (expected ${t.expect})${t.note ? ` ${t.note}` : ''}`);
  return r.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv);
