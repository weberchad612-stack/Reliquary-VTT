#!/usr/bin/env node
// Map notes from chat: the record Claude writes to the board (notes/<id>) for a note pinned to a point.
//
// Usage:
//   node tools/note.mjs <map-dir> --at X,Y --text "TEXT" [--gm-only] [--by claude|gm|player] [--id ID]
//
// X,Y is the point in cells (fractions allowed; 3.5,4.5 is the centre of square 3,4). Claude's notes are
// what the party has learned or should remember; GM-only notes never show in the player view. A note the
// player wrote is theirs: change it only when they ask. Prints JSON {path, record}: write `record` to the
// board's store at `path` (db_write; read the record first when it exists), or add it to the map state's
// notes (the record without "map"). Docs: docs/best-practices/board.md (map notes).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { noteRecord, noteId, cleanText, NOTE_MAX } from '../board/notes.js';
import { loadMap } from './sight.mjs';

/** Build a note record from options (the CLI's work, without the file reading). */
export function noteFromOptions({ map, at, text, gmOnly = false, by = 'claude', id = noteId() }) {
  if (!Array.isArray(at) || at.length !== 2 || at.some((v) => !Number.isFinite(v))) throw new Error('--at must be X,Y in cells');
  const g = map.grid;
  if (at[0] < 0 || at[1] < 0 || at[0] > g.cols || at[1] > g.rows) throw new Error(`--at ${at} is outside the ${g.cols} x ${g.rows} grid`);
  const t = cleanText(text);
  if (!t) throw new Error('--text is empty');
  if (String(text).trim().length > NOTE_MAX) throw new Error(`--text is longer than ${NOTE_MAX} characters`);
  if (!['claude', 'gm', 'player'].includes(by)) throw new Error('--by is claude, gm or player');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('--id: lower-case letters, digits and dashes');
  return { path: `notes/${id}`, record: noteRecord({ map: map.id, text: t, at, by, gmOnly }) };
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const at = opt('--at'), text = opt('--text'), by = opt('--by') || 'claude', id = opt('--id');
    const gmOnly = flag('--gm-only');
    if (args.length !== 1 || at === undefined || text === undefined) throw new Error('give one map folder, --at and --text');
    const { map } = loadMap(path.resolve(args[0]));
    console.log(JSON.stringify(noteFromOptions({ map, at: String(at).split(',').map(Number), text, gmOnly, by, id: id || undefined }), null, 2));
    return 0;
  } catch (e) {
    console.error(`note: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
