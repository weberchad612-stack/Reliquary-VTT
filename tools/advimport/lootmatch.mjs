#!/usr/bin/env node
// Item and hazard matching for the adventure importer (#16; docs/best-practices/adventure-importer.md, section 2):
// the loot and hazards in adventure.json against the open content and the book's own words.
//   - every item `ref` and hazard key must exist in the pack's content sources;
//   - a price the book prints after an item's name, "(5 gp)", is compared with the content's;
//   - an item the pack names without a `ref` is matched to a content item of the same name, proposed for Claude
//     to check (a custom item stays custom when nothing matches);
//   - content items named in an area's treasure text but held by no object in that area are listed;
//   - each hazard's printed numbers (Stealth or Notice DC, Disable DCs, AC, HP) are compared with the content's.
//
// Usage: node tools/advimport/lootmatch.mjs <pack-dir> <text-dir> --pages A-B [--skip REGEX] [--json]
// What the book's words mean is the game system's: rulesets/<ruleset>/bookimport.js (priceAfter, priceCp,
// treasureText, hazardNumbers, hazardContent).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemReader } from './statmatch.mjs';
import { splitAreas, packIndex, roomKeys } from './areas.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const norm = (s) => String(s).toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[’']/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** The pack's content documents by key ("item/slug" for the first source holding it, and "source:kind/slug"). */
export function contentIndex(pack) {
  const byKey = new Map(), byName = new Map();
  for (const src of pack.content || []) {
    const [rs, source] = src.includes('/') ? src.split('/') : [pack.ruleset, src];
    const dir = path.join(REPO, 'content', rs, source);
    if (!fs.existsSync(dir)) continue;
    for (const kind of fs.readdirSync(dir)) {
      const kd = path.join(dir, kind);
      if (!fs.statSync(kd).isDirectory()) continue;
      for (const f of fs.readdirSync(kd).filter((x) => x.endsWith('.json'))) {
        const slug = f.slice(0, -5), key = `${kind}/${slug}`;
        const entry = { key, full: `${source}:${key}`, file: path.join(kd, f) };
        if (!byKey.has(key)) byKey.set(key, entry);
        byKey.set(entry.full, entry);
        if (kind === 'item' || kind === 'hazard') {
          const name = norm(readJson(entry.file).name || slug);
          if (!byName.has(name)) byName.set(name, entry);
        }
      }
    }
  }
  return { byKey, byName, doc: (k) => { const e = byKey.get(k); return e ? readJson(e.file) : null; } };
}

/** All findings: [{area, kind: 'missing'|'price'|'propose'|'unplaced'|'hazard', what, ...}]. */
export function matchLoot(adv, areas, idx, content, sys) {
  const out = [];
  const textOf = (room) => {
    const key = Object.keys(areas).find((k) => roomKeys(k, idx).includes(room) || k === room);
    return key ? areas[key].text : '';
  };
  for (const o of adv.objects || []) {
    const text = textOf(o.room);
    for (const it of o.items || []) {
      if (it.ref) {
        const doc = content.doc(it.ref);
        if (!doc) { out.push({ area: o.room, kind: 'missing', what: `${o.name}: no content item "${it.ref}"` }); continue; }
        const book = sys.priceAfter(text, it.name || doc.name) || sys.priceAfter(text, doc.name.replace(/\s*\(.*\)$/, ''));
        if (book && doc.price && sys.priceCp(book) !== sys.priceCp(doc.price)) {
          out.push({ area: o.room, kind: 'price', what: `${it.name || doc.name}: the book says ${JSON.stringify(book)}, the content ${JSON.stringify(doc.price)}` });
        }
      } else if (it.name && !['artifact', 'book', 'note'].includes(it.kind)) {
        const hit = content.byName.get(norm(it.name));
        if (hit && hit.key.startsWith('item/')) out.push({ area: o.room, kind: 'propose', what: `${o.name}: "${it.name}" could be ${hit.key}`, ref: hit.key });
      }
    }
    if (o.hazard) {
      const doc = content.doc(o.hazard);
      if (!doc) { out.push({ area: o.room, kind: 'missing', what: `${o.name}: no content hazard "${o.hazard}"` }); continue; }
      // the hazard's own block: from its name printed as a heading (capitals) to 30 lines on; no block, no comparison
      const lines = text.split('\n'), head = norm(doc.name);
      const at = lines.findIndex((l) => /^[A-Z][A-Z ,'’-]{3,}$/.test(l.trim()) && norm(l) === head);
      if (at < 0) { out.push({ area: o.room, kind: 'hazard', what: `${o.name}: no "${doc.name}" block found in the area's text to compare (check by eye)` }); continue; }
      const book = sys.hazardNumbers(lines.slice(at, at + 30).join('\n')), open = sys.hazardContent(doc);
      const diffs = [];
      if (book.stealth !== null && open.stealth !== null && book.stealth !== open.stealth) diffs.push(`Stealth/Notice DC ${book.stealth} (content ${open.stealth})`);
      const bd = [...new Set(book.disable)].sort(), od = [...new Set(open.disable)].sort();
      if (bd.length && od.length && JSON.stringify(bd) !== JSON.stringify(od)) diffs.push(`Disable DCs ${bd.join('/')} (content ${od.join('/')})`);
      if (book.ac !== null && open.ac !== null && book.ac !== open.ac) diffs.push(`AC ${book.ac} (content ${open.ac})`);
      if (book.hp !== null && open.hp !== null && book.hp !== open.hp) diffs.push(`HP ${book.hp} (content ${open.hp})`);
      if (diffs.length) out.push({ area: o.room, kind: 'hazard', what: `${o.name} (${o.hazard}): ${diffs.join(', ')}` });
    }
  }
  // content items named in each area's treasure text, held by no object there
  for (const a of Object.values(areas)) {
    const t = norm(sys.treasureText(a.text));
    if (!t) continue;
    const parent = (/^([A-Z]{1,2}\d{1,2})[a-z]$/.exec(a.key) || [])[1];   // B2d: the whole B2 group's objects count
    const rooms = [...roomKeys(a.key, idx), a.key, ...(parent ? [parent, ...roomKeys(parent, idx)] : [])];
    // what the area's objects hold, by their own names and their content items' names (a grade in brackets dropped)
    const held = (adv.objects || []).filter((o) => rooms.includes(o.room)).flatMap((o) => (o.items || []).flatMap((i) => {
      const d = i.ref ? content.doc(i.ref) : null;
      return [norm(i.name || ''), d ? norm(d.name) : ''].filter((x) => x.length > 2);
    }));
    for (const [name, e] of content.byName) {
      if (!e.key.startsWith('item/') || name.length < 5 || !new RegExp(`\\b${name}\\b`).test(t)) continue;
      if (held.some((n) => n === name || n.includes(name) || name.includes(n))) continue;
      const d = content.doc(e.key);
      if ((d.traits || []).includes('rune') || /etched/.test(d.usage || '')) continue;   // a rune's name is an ordinary word
      out.push({ area: a.key, kind: 'unplaced', what: `"${name}" in the treasure text, held by no object in ${a.key}`, ref: e.key });
    }
  }
  return out;
}

async function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const json = args.includes('--json'); if (json) args.splice(args.indexOf('--json'), 1);
  const pages = opt('--pages'), skipArg = opt('--skip');
  const [packDir, textDir] = args;
  if (!packDir || !textDir) { console.error('usage: node tools/advimport/lootmatch.mjs <pack-dir> <text-dir> --pages A-B [--skip REGEX] [--json]'); return 2; }
  const { pack, idx } = packIndex(packDir);
  const sys = await systemReader(pack.ruleset);
  let files = fs.readdirSync(textDir).filter((f) => /^p\d+\.txt$/.test(f)).sort();
  if (pages) { const [a, b] = pages.split('-').map(Number); files = files.filter((f) => { const n = Number(f.slice(1, -4)); return n >= a && n <= (b || a); }); }
  const areas = splitAreas(files.map((f) => ({ page: Number(f.slice(1, -4)), text: fs.readFileSync(path.join(textDir, f), 'utf8') })), { skip: skipArg ? new RegExp(skipArg) : null, caps: process.argv.includes('--caps-headings') });
  const adv = readJson(path.join(packDir, 'adventure.json'));
  const ef = path.join(packDir, 'checklist.json');
  const explained = fs.existsSync(ef) ? readJson(ef).explained || [] : [];
  const found = matchLoot(adv, areas, idx, contentIndex(pack), sys)
    .map((f) => ({ ...f, explained: (explained.find((e) => e.area === f.area && f.what.includes(e.match)) || {}).why }));
  if (json) { console.log(JSON.stringify(found, null, 1)); return 0; }
  for (const f of found) console.log(`${f.explained ? '✓' : '✗'} ${f.area.padEnd(4)} ${f.kind.padEnd(8)} ${f.what}${f.explained ? `  (explained: ${f.explained})` : ''}`);
  const open = found.filter((f) => !f.explained).length;
  const n = (adv.objects || []).reduce((k, o) => k + (o.items || []).length, 0), h = (adv.objects || []).filter((o) => o.hazard).length;
  console.log(`\n${n} items and ${h} hazards checked; ${open} to check${found.length - open ? `, ${found.length - open} explained` : ''}`);
  return 0;
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1])).href) main(process.argv).then((c) => { process.exitCode = c; });
