#!/usr/bin/env node
// The party's marching order from chat (engine/tokens/marching.js; the board's Marching order tab: board/marchui.js).
// Claude moves the party with it when narration moves the group: the block faces the way the party heads, the front
// row reaches the destination, in column where the block does not fit, and nobody is ever placed on ground the party
// has not explored except their own place in the block and the destination itself (the user, 2026-11-14).
//
// Usage: node tools/marching.mjs [<pack-dir>] <save-dir> [--records FILE] <command>
//   show                                   the grid, front row first
//   set "Kerra=1,0" "Pip=2,1" ...         put members on the grid (column 0-3 left to right, row 0-3 front to back);
//                                          whoever stood there takes the member's old square
//   add <name|id> / remove <name|id>       someone besides the PCs travels with the party (a companion, an ally)
//   move --to X,Y [--facing auto|n|ne|e|se|s|sw|w|nw] [--map ID]
//                                          the party (its members on the party's map, or --map) moves: the front row
//                                          to X,Y, facing the way from where the party stands to X,Y (auto) or as given
//
// --records: the board's records (tokens/, state/marching, state/table, mapstate/<map>, explored/<map>.*), over the
// save's. Prints JSON {lines, writes}: write each with db_write (state/marching set; tokens/<id> update {x, y}).
// move writes nothing when anyone does not fit: its lines say who, for Claude to decide (never onto unexplored ground).
// Docs: docs/best-practices/board.md (Marching order), docs/gm/running-a-game.md (marching order).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameArgs, readCampaign } from './campaign.mjs';
import { readRecords } from './replay.mjs';
import { prepareMove, fits, canStep } from '../engine/movement/movement.js';
import { blockersAt } from '../engine/tokens/occupancy.js';
import { squareExplored } from '../engine/fog/explored.js';
import { exploredFromRecords } from '../board/records.js';
import { MARCH_DIRS, marchFacing, marchMembers, marchSlots, marchMove, marchAnchorAhead, placeFormation } from '../engine/tokens/marching.js';

const ROWS = ['front', 'second', 'third', 'rear'];
const engine = { fits, canStep, blockersAt };

/** The game as this tool needs it: tokens (with their maps), the marching record, the party's map, maps, states. */
export function loadMarching(packDir, saveDir, records = null) {
  const c = readCampaign(packDir, saveDir);
  const tokens = {};
  for (const [map, st] of Object.entries(c.mapStates)) for (const [id, t] of Object.entries(st.tokens || {})) tokens[id] = { ...t, map };
  const r = records || {};
  for (const [p, d] of Object.entries(r)) if (p.startsWith('tokens/')) tokens[p.slice(7)] = d;
  const marching = r['state/marching'] || c.campaign.marching || { slots: {}, extra: [] };
  const partyMap = (r['state/table'] || {}).current_map || c.campaign.current_map;
  return { c, tokens, marching, partyMap, records: r };
}

/** A member by name or id. */
function find(tokens, who) {
  const w = String(who || '').toLowerCase();
  const hit = Object.entries(tokens).find(([id, t]) => id.toLowerCase() === w) || Object.entries(tokens).find(([, t]) => String(t.name || '').toLowerCase() === w)
    || Object.entries(tokens).filter(([, t]) => String(t.name || '').toLowerCase().startsWith(w));
  if (Array.isArray(hit) && hit.length && Array.isArray(hit[0])) { if (hit.length > 1) throw new Error(`"${who}" could be ${hit.map(([, t]) => t.name).join(', ')}`); return hit[0]; }
  if (!hit || !hit.length) throw new Error(`no token "${who}"`);
  return hit;
}

/** The grid as lines. */
export function gridLines(tokens, marching) {
  const ids = marchMembers(tokens, marching), slots = marchSlots(ids, marching.slots || {});
  const at = {};
  for (const id of ids) at[slots[id].join(',')] = tokens[id].name || id;
  const lines = ['Marching order (forward is up):'];
  for (let r = 0; r < 4; r++) lines.push(`  ${ROWS[r].padEnd(6)} ${[0, 1, 2, 3].map((c) => (at[`${c},${r}`] || '.').slice(0, 12).padEnd(12)).join(' ')}`);
  const extra = (marching.extra || []).filter((id) => tokens[id]).map((id) => tokens[id].name || id);
  if (extra.length) lines.push(`  travelling with the party: ${extra.join(', ')}`);
  return lines;
}

/** Run one command: {lines, writes}. */
export function runMarching(g, cmd, args, opts = {}) {
  const { tokens } = g;
  let marching = { slots: { ...(g.marching.slots || {}) }, extra: [...(g.marching.extra || [])] };
  const write = () => ({ op: 'set', path: 'state/marching', data: marching });
  if (cmd === 'show') return { lines: gridLines(tokens, marching), writes: [] };
  if (cmd === 'set') {
    if (!args.length) throw new Error('give "Name=col,row" for each member to place');
    const ids = marchMembers(tokens, marching);
    let slots = marchSlots(ids, marching.slots);
    for (const a of args) {
      const m = /^(.+)=(\d),(\d)$/.exec(a);
      if (!m) throw new Error(`"${a}": Name=col,row (0-3 each)`);
      const [id] = find(tokens, m[1]);
      if (!ids.includes(id)) throw new Error(`${tokens[id].name || id} is not in the party (add them first)`);
      const c = +m[2], r = +m[3];
      if (c > 3 || r > 3) throw new Error(`"${a}": columns and rows go 0 to 3`);
      slots = marchMove(slots, id, [c, r]);
    }
    marching = { ...marching, slots };
    return { lines: gridLines(tokens, marching), writes: [write()] };
  }
  if (cmd === 'add' || cmd === 'remove') {
    const [id, t] = find(tokens, args.join(' '));
    if (t.kind === 'pc') throw new Error(`${t.name || id} is a PC: PCs are always in the marching order`);
    if (cmd === 'add') { if (!marching.extra.includes(id)) marching.extra.push(id); }
    else { marching.extra = marching.extra.filter((x) => x !== id); delete marching.slots[id]; }
    marching.slots = marchSlots(marchMembers(tokens, marching), marching.slots);
    return { lines: gridLines(tokens, marching), writes: [write()] };
  }
  if (cmd === 'move') {
    const to = String(opts.to || '').split(',').map(Number);
    if (to.length !== 2 || !to.every(Number.isInteger)) throw new Error('--to X,Y: the square the front of the party reaches');
    const mapId = opts.map || g.partyMap;
    const m = g.c.maps.find((x) => x.id === mapId);
    if (!m || !m.map.grid) throw new Error(`map ${mapId} has no squares`);
    const here = Object.fromEntries(Object.entries(tokens).filter(([, t]) => t.map === mapId));
    const ids = marchMembers(here, marching);
    if (!ids.length) throw new Error(`no one in the party is on ${mapId}`);
    const slots = marchSlots(ids, marching.slots);
    // the way the party heads: from where it stands now to the destination, unless given
    const centre = ids.reduce((s, id) => [s[0] + here[id].x / ids.length, s[1] + here[id].y / ids.length], [0, 0]);
    const dir = opts.facing && opts.facing !== 'auto' ? opts.facing : marchFacing(to[0] - centre[0], to[1] - centre[1]) || 'n';
    if (!MARCH_DIRS.includes(dir)) throw new Error(`--facing is auto or one of ${MARCH_DIRS.join(', ')}`);
    // the map as the party finds it: its walls, the doors as they stand, the ground it has explored
    const st = g.records[`mapstate/${mapId}`] || g.c.mapStates[mapId] || {};
    const pm = prepareMove(m.segs, st, m.map.grid);
    const chunks = Object.entries(g.records).filter(([p, d]) => p.startsWith('explored/') && d && d.map === mapId).map(([, d]) => d);
    const explored = chunks.length ? exploredFromRecords(chunks) : (g.c.mapStates[mapId] || {}).explored;
    const occupants = Object.entries(here).filter(([id]) => !ids.includes(id)).map(([id, t]) => ({ ...t, id }));
    const members = ids.map((id) => ({ ...here[id], id, slot: slots[id] }));
    const r = placeFormation({ pm, engine, anchor: marchAnchorAhead(to, dir, slots), dir, members, seeds: [to],
      origin: ids.map((id) => [here[id].x, here[id].y]), occupants, spill: squareExplored(explored) });
    const name = (id) => here[id].name || id;
    const lines = [`The party heads ${dir.toUpperCase()} to ${to.join(',')} on ${mapId}${r.column ? ', in column (the block does not fit here)' : ', in formation'}:`];
    for (const p of r.placed) lines.push(`  ${name(p.id)}: ${here[p.id].x},${here[p.id].y} -> ${p.x},${p.y}`);
    if (r.unplaced.length) {
      lines.push(`NOT MOVED: no room for ${r.unplaced.map(name).join(', ')} on squares the party has explored. Nothing was written: choose another square, move them by hand, or leave them where they are.`);
      return { lines, writes: [], unplaced: r.unplaced };
    }
    return { lines, writes: r.placed.map((p) => ({ op: 'update', path: `tokens/${p.id}`, data: { x: p.x, y: p.y } })), dir, column: r.column };
  }
  throw new Error(`unknown command "${cmd}" (show, set, add, remove, move)`);
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  try {
    const rec = opt('--records'), to = opt('--to'), facing = opt('--facing'), map = opt('--map');
    const [pack, save, cmd, ...rest] = gameArgs(args);
    if (!save || !cmd) throw new Error('give a save folder (or a pack folder and a save folder) and a command');
    const records = rec ? readRecords(JSON.parse(fs.readFileSync(rec, 'utf8'))) : null;
    const out = runMarching(loadMarching(pack, save, records), cmd, rest, { to, facing, map });
    console.log(cmd === 'show' ? out.lines.join('\n') : JSON.stringify(out, null, 2));
    return out.unplaced ? 1 : 0;
  } catch (e) {
    console.error(`marching: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
