#!/usr/bin/env node
// Command-line access to the fog of war (engine/fog/).
//
// Usage:
//   node tools/fog.mjs <map-dir> --state FILE [--token ID:KIND:X,Y[,SIZE] ...] [--out FILE] [--range FEET]
//
// Tokens come from the state file's `tokens` (each needs kind, x, y and optionally size, hidden, dead)
// plus any given with --token, e.g. --token kerra:pc:2,2 --token ogre:foe:8,7,2 (a --token overrides
// a state token with the same id). Computes what the PCs see now, merges it into the explored area,
// and prints {visible, seen, explored, shown, changed}; `shown` is the outline to paint (straight diagonals). With --out, writes the updated map state there.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare } from '../engine/sight/visibility.js';
import { partyView } from '../engine/fog/view.js';
import { mergeExplored, displayOutlines } from '../engine/fog/explored.js';
import { loadMap } from './sight.mjs';

function main(argv) {
  const args = argv.slice(2);
  const tokArgs = [];
  for (let i = args.indexOf('--token'); i >= 0; i = args.indexOf('--token')) { tokArgs.push(args[i + 1]); args.splice(i, 2); }
  const opt = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  try {
    const stateFile = opt('--state');
    const outFile = opt('--out');
    const rangeFt = Number(opt('--range') ?? 200);
    if (args.length !== 1 || !stateFile) throw new Error('give one map folder and --state');
    const { map, segs } = loadMap(path.resolve(args[0]));
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const tokens = { ...(state.tokens || {}) };
    for (const t of tokArgs) {
      const [id, kind, pos] = String(t).split(':');
      const n = String(pos || '').split(',').map(Number);
      if (!id || !kind || n.length < 2 || n.some((v) => !Number.isFinite(v))) throw new Error(`--token ${t} must be ID:KIND:X,Y[,SIZE]`);
      tokens[id] = { kind, x: n[0], y: n[1], ...(n[2] ? { size: n[2] } : {}) };
    }
    const list = Object.entries(tokens).map(([id, t]) => ({ id, ...t }));
    const prepared = prepare(segs, state, 'sight');
    const view = partyView(list, prepared, { rangeFt, feetPerCell: map.grid.feet_per_cell });
    const { changed, explored } = mergeExplored(state.explored, view.visible, map.grid);
    const round = (p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000];
    if (outFile) {
      const next = { ...state, tokens, explored };
      fs.writeFileSync(outFile, JSON.stringify(next, null, 2) + '\n');
    }
    console.log(JSON.stringify({
      lookers: view.lookers,
      seen: [...view.seen],
      changed,
      explored,
      shown: displayOutlines(explored, map.grid),
      visible: view.visible.map((p) => p.map(round)),
    }));
    return 0;
  } catch (e) {
    console.error(`Error: ${e.message}`);
    console.error('Usage: node tools/fog.mjs <map-dir> --state FILE [--token ID:KIND:X,Y[,SIZE] ...] [--out FILE] [--range FEET]');
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv);
}
