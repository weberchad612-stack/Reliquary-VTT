#!/usr/bin/env node
// Command-line access to the movement engine (engine/movement/movement.js).
//
// Usage:
//   node tools/move.mjs <map-dir> --token X,Y[,SIZE] --to X,Y      [--state FILE] [--diagonal 1,2] [--squeeze SIZE]
//   node tools/move.mjs <map-dir> --token X,Y[,SIZE] --step DX,DY  [--state FILE] [--squeeze SIZE]
//   node tools/move.mjs <map-dir> --token X,Y[,SIZE] --reach FEET  [--state FILE] [--diagonal 1,2] [--squeeze SIZE]
//
// X,Y is the top-left cell of the token's space; SIZE is its side in cells (default 1, Large = 2).
// --to prints the cheapest path and its cost; --step prints whether one step is allowed;
// --reach prints every position reachable within FEET. --diagonal sets successive diagonal costs in
// cells (default 1,2 = PF2E 5-10-5; use 1 for D&D 5e). --squeeze moves with a smaller footprint.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareMove, canStep, fits, path as findPath, reach } from '../engine/movement/movement.js';
import { loadMap } from './sight.mjs';

const nums = (s, name, n) => {
  const v = String(s || '').split(',').map(Number);
  if ((n && !n.includes(v.length)) || v.some((x) => !Number.isFinite(x))) throw new Error(`${name} has the wrong form`);
  return v;
};

function main(argv) {
  const args = argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  try {
    const t = nums(opt('--token'), '--token (X,Y or X,Y,SIZE)', [2, 3]);
    const token = { x: t[0], y: t[1], size: t[2] ?? 1 };
    const to = opt('--to'), step = opt('--step'), reachFt = opt('--reach');
    const stateFile = opt('--state');
    const diag = opt('--diagonal');
    const squeeze = opt('--squeeze');
    if (args.length !== 1 || [to, step, reachFt].filter((v) => v !== undefined).length !== 1) {
      throw new Error('give one map folder and exactly one of --to, --step or --reach');
    }
    const { map, segs } = loadMap(path.resolve(args[0]));
    const state = stateFile ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
    const pm = prepareMove(segs, state, map.grid);
    const opts = { feetPerCell: map.grid.feet_per_cell };
    if (diag) opts.diagonalCosts = nums(diag, '--diagonal');
    if (squeeze) opts.size = Number(squeeze);
    let out;
    if (to !== undefined) {
      const g = nums(to, '--to (X,Y)', [2]);
      out = { token, to: g, fitsAtGoal: fits(pm, g[0], g[1], opts.size ?? token.size), result: findPath(pm, token, g[0], g[1], opts) };
    } else if (step !== undefined) {
      const d = nums(step, '--step (DX,DY)', [2]);
      out = { token, step: d, allowed: canStep(pm, token, d[0], d[1], opts) };
    } else {
      out = { token, reachFt: Number(reachFt), cells: reach(pm, token, Number(reachFt), opts) };
    }
    console.log(JSON.stringify(out));
    return 0;
  } catch (e) {
    console.error(`Error: ${e.message}`);
    console.error('Usage: node tools/move.mjs <map-dir> --token X,Y[,SIZE] (--to X,Y | --step DX,DY | --reach FEET) [--state FILE] [--diagonal 1,2] [--squeeze SIZE]');
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv);
}
