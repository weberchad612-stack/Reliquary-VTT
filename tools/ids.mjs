#!/usr/bin/env node
// Convert a save's ids to generated ids (board/ids.js: tok-, note-, tpl- and 8 base-36 characters), with every
// reference to them: token ids (one id per creature across all of the save's maps), hidden markers, template
// casters, note and template ids. Names are not touched: a proper name is never changed; naming creatures by
// adjective is Claude's job (docs/best-practices/board.md, names and ids).
//
// Usage:
//   node tools/ids.mjs convert <save-dir> [--ids MAPPING.json] [--dry-run]
//   node tools/ids.mjs records <records.json> [--ids MAPPING.json]
//
// convert rewrites <save-dir>/maps/*.json in place (a copy of each is kept in <save-dir>/backups/ids-<time>/) and
// prints the mapping {old id: new id}. --ids gives ids to use (old -> new) and the rest are generated; ids that
// are already generated are kept. records does the same for the board's records ({path: data}, as db_list gives
// them) and prints {mapping, ops}: the db_write operations (new records set, old ones deleted, targets and
// templates rewritten). Docs: docs/best-practices/board.md (names and ids).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeId, isId } from '../board/ids.js';

/** Give every token, note and template a generated id; returns the mapping {token: {}, note: {}, template: {}}. */
export function planIds(states, given = {}) {
  const map = { token: {}, note: {}, template: {} }, taken = new Set(Object.values(given));
  const assign = (kind, old) => {
    if (isId(old, kind)) return old;
    if (map[kind][old]) return map[kind][old];
    const id = given[old] && isId(given[old], kind) ? given[old] : makeId(kind, { taken });
    taken.add(id); map[kind][old] = id;
    return id;
  };
  for (const st of states) {
    for (const id of Object.keys(st.tokens || {})) assign('token', id);
    for (const id of Object.keys(st.notes || {})) assign('note', id);
    for (const id of Object.keys(st.templates || {})) assign('template', id);
  }
  return map;
}

const rekey = (obj, m) => (obj ? Object.fromEntries(Object.entries(obj).map(([k, v]) => [m[k] || k, v])) : obj);

/** One map state with its ids replaced. */
export function convertState(st, map) {
  const out = { ...st };
  if (st.tokens) out.tokens = rekey(st.tokens, map.token);
  if (st.hidden_marks) out.hidden_marks = rekey(st.hidden_marks, map.token);
  if (st.notes) out.notes = rekey(st.notes, map.note);
  if (st.templates) {
    out.templates = Object.fromEntries(Object.entries(st.templates).map(([k, t]) => [map.template[k] || k, t.caster && map.token[t.caster] ? { ...t, caster: map.token[t.caster] } : t]));
  }
  return out;
}

/** The board's records converted: {mapping, ops} (db_write ops: set the new, delete the old, rewrite references). */
export function convertRecords(records, given = {}) {
  const states = [{ tokens: {}, notes: {}, templates: {} }];
  for (const [p] of Object.entries(records)) {
    const [c, id] = p.split('/');
    if (c === 'tokens') states[0].tokens[id] = 1;
    if (c === 'notes') states[0].notes[id] = 1;
    if (c === 'templates') states[0].templates[id] = 1;
  }
  const map = planIds(states, given), ops = [];
  const moved = { tokens: map.token, notes: map.note, templates: map.template };
  for (const [p, d] of Object.entries(records)) {
    const [c, id] = p.split('/');
    if (moved[c] && moved[c][id] && moved[c][id] !== id) {
      let data = d;
      if (c === 'templates' && d.caster && map.token[d.caster]) data = { ...d, caster: map.token[d.caster] };
      ops.push({ op: 'set', path: `${c}/${moved[c][id]}`, data }, { op: 'delete', path: p });
    } else if (c === 'templates' && d.caster && map.token[d.caster] && map.token[d.caster] !== d.caster) {
      ops.push({ op: 'update', path: p, data: { caster: map.token[d.caster] } });
    } else if (c === 'targets' && Array.isArray(d.ids) && d.ids.some((x) => map.token[x])) {
      ops.push({ op: 'update', path: p, data: { ids: d.ids.map((x) => map.token[x] || x) } });
    } else if (c === 'mapstate' && d.hidden_marks && Object.keys(d.hidden_marks).some((x) => map.token[x])) {
      ops.push({ op: 'update', path: p, data: { hidden_marks: rekey(d.hidden_marks, map.token) } });
    }
  }
  return { mapping: map, ops };
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const idsFile = opt('--ids'), dry = flag('--dry-run'), given = idsFile ? JSON.parse(fs.readFileSync(idsFile, 'utf8')) : {};
    const [cmd, target] = args;
    if (cmd === 'convert' && target) {
      const dir = path.join(target, 'maps'), files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      const states = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      const map = planIds(states, given);
      if (!dry) {
        const bak = path.join(target, 'backups', `ids-${new Date().toISOString().replace(/[:.]/g, '-')}`);
        fs.mkdirSync(bak, { recursive: true });
        files.forEach((f, i) => {
          fs.copyFileSync(path.join(dir, f), path.join(bak, f));
          fs.writeFileSync(path.join(dir, f), JSON.stringify(convertState(states[i], map), null, 2) + '\n');
        });
      }
      console.log(JSON.stringify(map, null, 2));
      return 0;
    }
    if (cmd === 'records' && target) {
      console.log(JSON.stringify(convertRecords(JSON.parse(fs.readFileSync(target, 'utf8')), given), null, 2));
      return 0;
    }
    throw new Error('commands: convert <save-dir>, records <records.json>');
  } catch (e) {
    console.error(`ids: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
