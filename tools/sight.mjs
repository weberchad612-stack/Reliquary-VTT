#!/usr/bin/env node
// Command-line access to the sight engine (engine/sight/visibility.js).
//
// Usage:
//   node tools/sight.mjs <map-dir> --from X,Y [--to X,Y] [--state FILE] [--range FEET] [--sense sight|light|sound]
//   node tools/sight.mjs <map-dir> --token X,Y,SIZE [--state FILE] [--range FEET]
//
// Points are in grid cells (fractions allowed: 3.5,4.5 is the centre of cell 3,4).
// Without --to, prints the visibility polygon as JSON. With --to, prints {"visible": true|false}.
// --token takes a token's top-left cell and size in cells (2 = Large) and prints one polygon per viewpoint.
// --state is a map-state file from a save (door states, found secrets). Default range 200 ft.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare, visPolygon, canSee, tokenSight } from '../engine/sight/visibility.js';

/** Load a map folder: map.json plus all wall segments. */
export function loadMap(dir) {
  const map = JSON.parse(fs.readFileSync(path.join(dir, 'map.json'), 'utf8'));
  const files = Array.isArray(map.walls) ? map.walls : [map.walls];
  const segs = files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).segs);
  return { map, segs };
}

function point(s, name) {
  const p = String(s || '').split(',').map(Number);
  if (p.length !== 2 || p.some((n) => !Number.isFinite(n))) throw new Error(`${name} must be X,Y in cells, for example 3.5,4.5`);
  return p;
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (name, dflt) => {
    const i = args.indexOf(name);
    if (i < 0) return dflt;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  try {
    const tokArg = opt('--token');
    const fromArg = opt('--from');
    const toArg = opt('--to');
    const stateFile = opt('--state');
    const rangeFt = Number(opt('--range', '200'));
    const sense = opt('--sense', 'sight');
    if (args.length !== 1) throw new Error('give exactly one map folder');
    const { map, segs } = loadMap(path.resolve(args[0]));
    const state = stateFile ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
    const prepared = prepare(segs, state, sense);
    const opts = { rangeFt, feetPerCell: map.grid.feet_per_cell };
    const round = (p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000];
    if (tokArg) {
      const t = String(tokArg).split(',').map(Number);
      if (t.length !== 3 || t.some((n) => !Number.isFinite(n)) || t[2] <= 0) throw new Error('--token must be X,Y,SIZE, for example 4,3,2');
      const polys = tokenSight({ x: t[0], y: t[1], size: t[2] }, prepared, opts).map((pg) => pg.map(round));
      console.log(JSON.stringify({ token: { x: t[0], y: t[1], size: t[2] }, rangeFt, polygons: polys }));
      return 0;
    }
    const from = point(fromArg, '--from');
    const out = toArg
      ? { from, to: point(toArg, '--to'), visible: canSee(from, point(toArg, '--to'), prepared, opts) }
      : { from, rangeFt, polygon: visPolygon(from, prepared, opts).map(round) };
    console.log(JSON.stringify(out));
    return 0;
  } catch (e) {
    console.error(`Error: ${e.message}`);
    console.error('Usage: node tools/sight.mjs <map-dir> --from X,Y [--to X,Y] [--state FILE] [--range FEET] [--sense sight|light|sound]');
    console.error('       node tools/sight.mjs <map-dir> --token X,Y,SIZE [--state FILE] [--range FEET]');
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv);
}
