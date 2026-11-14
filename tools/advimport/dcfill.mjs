#!/usr/bin/env node
// Missing DCs (docs/best-practices/adventure-importer.md, section 11): a check the book gives no DC for takes the
// game system's DC for the party's expected level at that point in the adventure (for PF2E, GM Core's DCs by level).
//
// Usage: node tools/advimport/dcfill.mjs <pack-dir> [--check]
//
// The party's level comes from pack.json `party_level`: {"default": N, "<map id or subsystem id>": N}. A chapter that
// levels the party up partway through uses the lower level for places that can come before or after the level-up.
// What is filled, in the built files (so every source of them is covered: import.json, generated maps, builders):
//   - secret doors with no `dc` (and not `auto_find`) and locked doors with no `dc`  (maps/<id>/walls.json)
//   - terrain areas of a kind that calls for a check, with no `dc`                     (maps/<id>/terrain.json)
//   - a subsystem part's checks with no `dc`                                            (adventure-events.json)
// Each filled DC gets a note saying so (the GM sees it is not the book's), and <pack>/dc-fills.json lists them all.
// --check: write nothing; list what would be filled and exit 1 if anything is.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemReader } from './statmatch.mjs';

export const MARK = 'the book gives none';
const note = (dc, level) => `DC ${dc}: ${MARK}; the level-based DC for party level ${level} (adventure importer rule).`;
const addNote = (old, text) => (old ? `${old} ${text}` : text);
const marked = (n) => typeof n === 'string' && n.includes(MARK);
// the level a DC was filled for, read back from its note
const noteLevel = (n) => { const m = /party level (\d+)/.exec(n || ''); return m ? Number(m[1]) : null; };

/** The party's level for a map or subsystem id. */
export function partyLevel(levels, id) {
  if (!levels || typeof levels !== 'object') return null;
  if (Number.isInteger(levels[id])) return levels[id];
  return Number.isInteger(levels.default) ? levels.default : null;
}

/** Fill one map's walls; returns the fills (and changes `walls` in place). */
export function fillWalls(walls, level, dcFor) {
  const out = [];
  for (const s of walls.segs || []) {
    const d = s.door;
    if (!d) continue;
    const wants = (s.t === 'secret' && !d.auto_find) || d.initial === 'locked';
    if (marked(s.note)) out.push({ where: s.id, what: s.t === 'secret' ? 'find' : 'unlock', dc: d.dc, level: noteLevel(s.note) });
    if (!wants || d.dc !== undefined) continue;
    d.dc = dcFor(level);
    s.note = addNote(s.note, note(d.dc, level));
    out.push({ where: s.id, what: s.t === 'secret' ? 'find' : 'unlock', dc: d.dc, level, now: true });
  }
  return out;
}

/** Fill one map's terrain areas whose kind calls for a check. */
export function fillTerrain(terrain, level, dcFor, kinds) {
  const out = [];
  for (const a of terrain.areas || []) {
    if (!kinds.includes(a.kind)) continue;
    if (marked(a.note)) out.push({ where: a.id, what: a.kind, dc: a.dc, level: noteLevel(a.note) });
    if (a.dc !== undefined) continue;
    a.dc = dcFor(level);
    a.note = addNote(a.note, note(a.dc, level));
    out.push({ where: a.id, what: a.kind, dc: a.dc, level, now: true });
  }
  return out;
}

/** Fill the subsystems' checks. */
export function fillSubsystems(events, levels, dcFor) {
  const out = [];
  for (const sub of events.subsystems || []) {
    for (const part of sub.parts || []) {
      for (const c of part.checks || []) {
        const where = `${sub.id}/${part.id}/${c.skill}`;
        if (marked(c.note)) out.push({ where, what: c.skill, dc: c.dc, level: noteLevel(c.note) });
        if (c.dc !== undefined) continue;
        const level = partyLevel(levels, sub.id);
        if (level === null) { out.push({ where, what: c.skill, missingLevel: true }); continue; }
        c.dc = dcFor(level);
        c.note = addNote(c.note, note(c.dc, level));
        out.push({ where, what: c.skill, dc: c.dc, level, now: true });
      }
    }
  }
  return out;
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
// keep each file's own layout: one line, or one space per level
const writeLike = (f, obj) => fs.writeFileSync(f, fs.readFileSync(f, 'utf8').trimStart().startsWith('{\n') ? JSON.stringify(obj, null, 1) + '\n' : JSON.stringify(obj));

export async function main(argv) {
  const packDir = argv.find((a) => !a.startsWith('--'));
  const check = argv.includes('--check');
  if (!packDir) { console.error('usage: node tools/advimport/dcfill.mjs <pack-dir> [--check]'); return 2; }
  const pack = readJson(path.join(packDir, 'pack.json'));
  const sys = await systemReader(pack.ruleset);
  if (!sys.missingDC) { console.error(`the ${pack.ruleset} ruleset has no missingDC (rulesets/${pack.ruleset}/bookimport.js)`); return 1; }
  const levels = pack.party_level, kinds = sys.CHECK_TERRAIN || [];
  const fills = [], problems = [];
  const mapsDir = path.join(packDir, 'maps');
  for (const id of fs.existsSync(mapsDir) ? fs.readdirSync(mapsDir).sort() : []) {
    const level = partyLevel(levels, id);
    for (const [file, fill] of [['walls.json', (o) => fillWalls(o, level, sys.missingDC)], ['terrain.json', (o) => fillTerrain(o, level, sys.missingDC, kinds)]]) {
      const f = path.join(mapsDir, id, file);
      if (!fs.existsSync(f)) continue;
      const obj = readJson(f);
      const got = level === null ? [] : fill(obj);
      if (level === null) {
        // nothing can be filled without a level: report what needs one
        const need = file === 'walls.json'
          ? (obj.segs || []).filter((s) => s.door && s.door.dc === undefined && ((s.t === 'secret' && !s.door.auto_find) || s.door.initial === 'locked')).map((s) => s.id)
          : (obj.areas || []).filter((a) => kinds.includes(a.kind) && a.dc === undefined).map((a) => a.id);
        for (const w of need) problems.push(`${id}/${file} ${w}: no DC and no party level (pack.json party_level)`);
      }
      for (const x of got) fills.push({ file: `maps/${id}/${file}`, ...x });
      if (!check && got.some((x) => x.now)) writeLike(f, obj);
    }
  }
  const ev = path.join(packDir, 'adventure-events.json');
  if (fs.existsSync(ev)) {
    const obj = readJson(ev);
    const got = fillSubsystems(obj, levels, sys.missingDC);
    for (const x of got) (x.missingLevel ? problems.push(`adventure-events.json ${x.where}: no DC and no party level (pack.json party_level)`) : fills.push({ file: 'adventure-events.json', ...x }));
    if (!check && got.some((x) => x.now)) writeLike(ev, obj);
  }
  for (const x of fills) console.log(`${x.now ? (check ? 'would fill' : 'filled') : 'kept'}  ${x.file} ${x.where}: ${x.what} DC ${x.dc}${x.level !== null ? ` (party level ${x.level})` : ''}`);
  for (const p of problems) console.log(`NEEDS A LEVEL  ${p}`);
  if (!check) {
    const list = fills.map(({ now, ...x }) => x);
    fs.writeFileSync(path.join(packDir, 'dc-fills.json'), JSON.stringify({ rule: 'a check with no DC in the book takes the level-based DC for the party level there', fills: list }, null, 1) + '\n');
  }
  console.log(`${fills.filter((x) => x.now).length} DC(s) filled now, ${fills.filter((x) => !x.now).length} filled before; ${problems.length} need a party level`);
  if (problems.length) return 1;
  return check && fills.some((x) => x.now) ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((c) => process.exit(c));
