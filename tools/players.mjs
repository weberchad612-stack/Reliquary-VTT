#!/usr/bin/env node
// The campaign's players (board/players.js): who plays which PCs, in the table's state (state/table.players, saved
// in campaign.json). The ledger records which player, and which character, introduced an invented detail.
//
// Usage (--records FILE: the board's records, with state/table and tokens/):
//   node tools/players.mjs list --records FILE
//   node tools/players.mjs add "Chad" [--pcs "Kerra, Lyra, Pip"] [--gm] --records FILE
//   node tools/players.mjs set "Chad" [--name N] [--pcs "Kerra, Lyra"] [--gm|--no-gm] --records FILE
//   node tools/players.mjs remove "Chad" --records FILE
// PCs are tokens' names, aliases or ids. Writes print {lines, writes} (a merge of state/table: write it with its
// version). Docs: docs/best-practices/board.md (the ledger).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playerRecord, findPlayer } from '../board/players.js';
import { resolveToken } from '../board/names.js';
import { readRecords } from './replay.mjs';

/** Run one command: {lines, writes}. */
export function runPlayers(cmd, args, opts = {}, records = {}) {
  const players = [...((records['state/table'] || {}).players || [])];
  const tokens = Object.fromEntries(Object.entries(records).filter(([p]) => p.startsWith('tokens/')).map(([p, t]) => [p.slice(7), t]));
  const pcs = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean).map((r) => resolveToken(tokens, r));
  const name = (id) => (tokens[id] || {}).name || id;
  const line = (p) => `${p.name} (${p.id})${p.gm ? ', GM view' : ''}: ${(p.pcs || []).map(name).join(', ') || 'no PCs'}`;
  const write = (list) => ({ lines: list.map(line), writes: [{ op: 'merge', path: 'state/table', data: { players: list } }] });
  if (cmd === 'list') return { lines: players.length ? players.map(line) : ['no players yet (players.mjs add "<name>" --pcs "...")'], writes: [] };
  if (cmd === 'add') {
    const p = playerRecord({ name: args.join(' '), pcs: pcs(opts.pcs), gm: !!opts.gm });
    if (findPlayer(players, p.id) || findPlayer(players, p.name)) throw new Error(`"${p.name}" is already a player (use set)`);
    const taken = players.find((o) => (o.pcs || []).some((t) => (p.pcs || []).includes(t)));
    if (taken) throw new Error(`${taken.name} already plays one of those PCs`);
    return write([...players, p]);
  }
  const old = findPlayer(players, args.join(' '));
  if (!old) throw new Error(`no player "${args.join(' ')}"`);
  if (cmd === 'remove') return write(players.filter((p) => p.id !== old.id));
  if (cmd === 'set') {
    const p = playerRecord({ id: old.id, name: opts.name || old.name, pcs: opts.pcs !== undefined ? pcs(opts.pcs) : old.pcs, gm: opts.gm ? true : opts.noGm ? false : !!old.gm });
    return write(players.map((o) => (o.id === old.id ? p : o)));
  }
  throw new Error('commands: list, add, set, remove');
}

async function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const rec = opt('--records');
    const o = { pcs: opt('--pcs'), name: opt('--name'), gm: flag('--gm'), noGm: flag('--no-gm') };
    if (!rec) throw new Error('needs --records FILE (the board\'s state/table and tokens/)');
    const [cmd, ...rest] = args;
    const out = runPlayers(cmd, rest, o, readRecords(JSON.parse(fs.readFileSync(rec, 'utf8'))));
    console.log(out.writes.length ? JSON.stringify(out, null, 2) : out.lines.join('\n'));
    return 0;
  } catch (e) {
    console.error(`players: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv).then((c) => process.exit(c));
