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
// Automatic (#18, 2026-11-13): every door is walked through from both sides (with every door open), and every room
// must be reachable from the map's starting area; rooms reached another way (a lift, a veil) are listed in
// checks.unreached: {room: "why"}; a door that cannot be walked through on purpose is in checks.door_walk: {door id: "why"}. Each leak says what the sight went through: an opening that lets sight pass (a
// window, a slit, a grate) or a gap in the walls, with where it leaves the room.

import fs from 'node:fs';
import path from 'node:path';
import { prepare, visPolygon } from '../engine/sight/visibility.js';
import { prepareMove, path as findPath, fits } from '../engine/movement/movement.js';
import { senseOf, SENSE } from '../engine/walls/presets.js';
import { loadMap } from './sight.mjs';

/** What sight went through from `from` to `to`: an opening that lets it pass, or a gap where it leaves the room. */
function leakWhy(from, to, segs, owner, may) {
  const d = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const crossTo = (t, s) => d(from, t, s.a) * d(from, t, s.b) < 0 && d(s.a, s.b, from) * d(s.a, s.b, t) < 0;
  // the leaking points are corners of the visible area, so rays to them graze walls' ends: try a hair either side
  const r0 = Math.hypot(to[0] - from[0], to[1] - from[1]), th = Math.atan2(to[1] - from[1], to[0] - from[0]);
  for (const d of [0, 0.004, -0.004, 0.015, -0.015]) {
    const t = [from[0] + r0 * Math.cos(th + d), from[1] + r0 * Math.sin(th + d)];
    const hit = segs.filter((s) => crossTo(t, s) && senseOf(s, s.door ? { state: 'closed' } : undefined).sight !== SENSE.NORMAL);
    if (hit.length) return hit.map((s) => `through ${s.t} ${s.id}`).join(', ');
  }
  const n = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.1);
  for (let i = 1; i <= n; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / n, y = from[1] + ((to[1] - from[1]) * i) / n;
    if (!may.has(owner.get(`${Math.floor(x)},${Math.floor(y)}`) || 'outside')) return `through a gap in the walls at ${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return 'past the room\'s edge';
}

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
    if (bad.length) {
      const why = [...new Set(bad.slice(0, 80).map((b) => leakWhy(r.at, [b[0], b[1]], segs, owner, may)))].slice(0, 6);
      out.leaks.push({ room: key, points: bad.slice(0, 6), count: bad.length, why }); out.ok = false;
    }
  }
  const doors = {};
  for (const s of segs) if (s.door && !s.door.blocked) doors[s.door.id] = { state: 'open', found: true };
  const pm = prepareMove(segs, { doors }, map.grid);
  // every door, from both sides
  out.doors = [];
  for (const sg of segs) {
    if (!sg.door || sg.door.blocked) continue;
    const mx = (sg.a[0] + sg.b[0]) / 2, my = (sg.a[1] + sg.b[1]) / 2, dx = sg.b[0] - sg.a[0], dy = sg.b[1] - sg.a[1], L = Math.hypot(dx, dy);
    const side = (k) => { for (const d of [0.75, 1.25, 1.75]) { const x = Math.floor(mx - (dy / L) * d * k), y = Math.floor(my + (dx / L) * d * k); if (x >= 0 && y >= 0 && x < map.grid.cols && y < map.grid.rows && fits(pm, x, y, 1)) return [x, y]; } return null; };
    const a = side(1), b = side(-1);
    if (!a || !b) {
      const why = (checks.door_walk || {})[sg.door.id];
      out.doors.push({ door: sg.door.id, ok: !!why, got: 'no floor on one side', why });
      if (!why) out.ok = false;
      continue;
    }
    const res = findPath(pm, { x: a[0], y: a[1], size: 1 }, b[0], b[1]);
    const okDoor = !!res && (res.feet ?? res.cost * 5) <= 30;   // through the door, not the long way round
    const why = (checks.door_walk || {})[sg.door.id];
    out.doors.push({ door: sg.door.id, from: a, to: b, ok: okDoor || !!why, got: res ? `${res.feet ?? res.cost * 5} ft` : 'blocked', why });
    if (!okDoor && !why) out.ok = false;
  }
  // every room from the starting area
  out.unreached = [];
  const start = (map.start || [])[0];
  if (start) {
    for (const [key, r] of Object.entries(rooms)) {
      const res = findPath(pm, { x: start[0], y: start[1], size: 1 }, Math.floor(r.at[0]), Math.floor(r.at[1]));
      if (res) continue;
      const why = (checks.unreached || {})[key];
      out.unreached.push({ room: key, ok: !!why, why: why || null });
      if (!why) out.ok = false;
    }
  }
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
  for (const l of r.leaks) console.log(`  LEAK  ${l.room}: ${l.count} point(s) outside, e.g. ${l.points.map((p) => `${p[0]},${p[1]} (${p[2]})`).join('; ')}\n        ${l.why.join('; ')}`);
  for (const d of r.doors || []) if (!d.ok) console.log(`  FAIL  door ${d.door}: ${d.got}${d.from ? ` (${d.from} -> ${d.to})` : ''}`);
  for (const u of r.unreached || []) console.log(`  ${u.ok ? 'ok   ' : 'FAIL '} ${u.room} cannot be reached from the starting area${u.why ? `: ${u.why}` : ''}`);
  if (r.doors && r.doors.length) console.log(`  ${r.doors.filter((d) => d.ok).length} of ${r.doors.length} doors walked through from both sides`);
  for (const t of r.routes) console.log(`  ${t.ok ? 'ok   ' : 'FAIL '} route ${t.from} -> ${t.to}: ${t.got} (expected ${t.expect})${t.note ? ` ${t.note}` : ''}`);
  return r.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv);
