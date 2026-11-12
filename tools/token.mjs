#!/usr/bin/env node
// Tokens from chat: add a creature (a generated id, its letter picked unique in its group), reveal a named NPC's
// proper name to the players, look a token up by name, and check a map's names.
//
// Usage:
//   node tools/token.mjs add --state FILE --name "Wet-Nosed Rat" --type rat --at X,Y [--group cellar-rats]
//        [--alias "Hooded Cultist"] [--kind foe|npc|pc] [--size S] [--speed FEET] [--elevation FEET] [--short L]
//   node tools/token.mjs reveal --state FILE <name|alias|id>
//   node tools/token.mjs find --state FILE <name|alias|id>
//   node tools/token.mjs check --state FILE
//
// --state is the map's state (saves/<campaign>/maps/<id>.json) or a JSON object of tokens. add and reveal print
// {path, record}: write `record` to the board's store at `path` (db_write; reveal: read the token first), and the
// same token (without "map") into the save's tokens. Names: a creature without a proper name is a unique
// adjective and its type ("Wet-Nosed Rat"), never a number; PCs keep their names; a proper name is written as
// it is and never changed, with --alias for what players see until they learn it (reveal sets known: true).
// Duplicate names and letters are warnings, never errors. Docs: docs/best-practices/board.md (names and ids).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeId } from '../board/ids.js';
import { resolveToken, pickLetter, lettersInGroup, nameProblems, publicName, groupOf } from '../board/names.js';

const KINDS = ['foe', 'npc', 'pc'];

/** A new token: {id, path, record, warnings}. `tokens`: the map's tokens; `map`: the map id. */
export function addToken({ tokens = {}, map, name, type, at, group, alias, kind = 'foe', size, speed, elevation, short }) {
  name = String(name || '').trim();
  if (!name) throw new Error('--name is needed (an adjective and the type, a PC\'s name, or the NPC\'s proper name)');
  if (!map) throw new Error('the map id is missing (the state has no "map"; give --map)');
  if (!KINDS.includes(kind)) throw new Error(`--kind is one of ${KINDS.join(', ')}`);
  if (type !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(type)) throw new Error('--type: lower case, digits and dashes (giant-rat)');
  if (group !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(group)) throw new Error('--group: lower case, digits and dashes (b14-morlocks)');
  if (kind !== 'pc' && !type) throw new Error('--type is needed for a creature (art and stat blocks are looked up by it)');
  if (!Array.isArray(at) || at.length !== 2 || !at.every(Number.isInteger) || at.some((v) => v < 0)) throw new Error('--at X,Y: a square');
  const id = makeId('token', { taken: tokens });
  const t = { name };
  if (alias) { t.alias = String(alias).trim(); t.known = false; }
  if (type) t.type = type;
  if (group) t.group = group;
  Object.assign(t, { kind, x: at[0], y: at[1] });
  if (size !== undefined) t.size = Number(size);
  if (speed !== undefined) t.speed = Number(speed);
  if (elevation) t.elevation = Number(elevation);
  t.short = short || pickLetter(publicName(t), lettersInGroup(tokens, groupOf(t, id), id));
  const warnings = nameProblems({ ...tokens, [id]: t }).filter((w) => w.includes(id));
  return { id, path: `tokens/${id}`, record: { ...t, map }, warnings };
}

/** The players learn a named NPC's proper name: the token with known: true. */
export function revealToken(tokens, ref) {
  const id = resolveToken(tokens, ref), t = tokens[id];
  if (!t.alias) throw new Error(`${t.name} has no alias: players already see the name`);
  return { id, path: `tokens/${id}`, record: { ...t, known: true } };
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  try {
    const cmd = args.shift(), sf = opt('--state');
    if (!sf) throw new Error('--state FILE is needed (the map\'s state)');
    const st = JSON.parse(fs.readFileSync(sf, 'utf8')), tokens = st.tokens || st, mapId = opt('--map') || st.map;
    if (cmd === 'add') {
      const at = (opt('--at') || '').split(',').map(Number);
      const out = addToken({
        tokens, map: mapId, name: opt('--name'), type: opt('--type'), at, group: opt('--group'), alias: opt('--alias'), kind: opt('--kind') || 'foe',
        size: opt('--size'), speed: opt('--speed'), elevation: opt('--elevation'), short: opt('--short'),
      });
      for (const w of out.warnings) console.error(`token: warning: ${w}`);
      console.log(JSON.stringify({ path: out.path, record: out.record }, null, 2));
      return 0;
    }
    if (cmd === 'reveal' || cmd === 'find') {
      if (args.length !== 1) throw new Error('give one token (name, alias or id)');
      if (cmd === 'reveal') { const r = revealToken(tokens, args[0]); console.log(JSON.stringify({ path: r.path, record: { ...r.record, map: mapId } }, null, 2)); return 0; }
      const id = resolveToken(tokens, args[0]), t = tokens[id];
      console.log(JSON.stringify({ id, name: t.name, shown: publicName(t), group: t.group, short: t.short }, null, 2));
      return 0;
    }
    if (cmd === 'check') {
      const p = nameProblems(tokens);
      for (const w of p) console.log(`  ${w}`);
      console.log(p.length ? `${p.length} warning(s)` : 'OK: names and letters are unique');
      return 0;
    }
    throw new Error('commands: add, reveal, find, check');
  } catch (e) {
    console.error(`token: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
