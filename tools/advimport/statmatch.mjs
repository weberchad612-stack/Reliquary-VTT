#!/usr/bin/env node
// Stat block matching for the adventure importer: find each creature the adventure prints a stat block for, propose
// the open content's stat block for it, and flag what the book changes (docs/best-practices/adventure-importer.md).
//
// Usage:
//   node tools/advimport/statmatch.mjs <pack-dir> <text-dir> [--pages 4-35] [--skip REGEX] [--json]
//
// <text-dir> holds the book's pages as p001.txt ... (pdftotext). How a stat block is printed and which numbers it has
// belong to the game system: rulesets/<ruleset>/bookimport.js (parseBlocks, compare, NOT_CREATURES), chosen by the
// pack's ruleset. --skip takes a regular expression for the book's running heads and other capitals lines that are not
// creatures. Each block is matched with the candidates in the pack's open sources (pack.json content, in order): exact
// name first, then the name with commas turned round and plurals made singular, then a word match. The report gives,
// per block: the page, the count, the proposed content key, every number that differs, and the system's verdict. The
// tool only proposes: Claude checks each match.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The game system's printed stat block reader. */
export async function systemReader(ruleset) {
  const f = path.join(REPO, 'rulesets', ruleset, 'bookimport.js');
  if (!fs.existsSync(f)) throw new Error(`ruleset "${ruleset}" has no printed stat block reader (rulesets/${ruleset}/bookimport.js)`);
  return import(pathToFileURL(f).href);
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const singular = (w) => (/ies$/.test(w) ? w.replace(/ies$/, 'y') : /ses$/.test(w) ? w.replace(/es$/, '') : /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w);
const norm = (s) => s.toLowerCase().replace(/\(bb\)/, '').replace(/[’']/g, '').replace(/[^a-z ,]/g, ' ').replace(/\s+/g, ' ').trim();

/** Names to try for a printed heading: as printed, comma turned round ("centipedes, giant" -> "giant centipede"), without "weak"/"elite", singular. */
export function nameVariants(head) {
  const n = norm(head);
  const parts = n.split(',').map((x) => x.trim()).filter(Boolean);
  const flips = parts.length > 1 ? [n.replace(/,/g, ''), [...parts.slice(1), parts[0]].join(' '), parts[0]] : [n];
  const out = new Set();
  for (const f of flips) {
    const words = f.split(' ').filter((w) => w && w !== 'weak' && w !== 'elite');
    out.add(words.join(' '));
    out.add([...words.slice(0, -1), singular(words.at(-1))].join(' '));
    out.add(words.map(singular).join(' '));
  }
  return [...out].filter(Boolean);
}

function candidates(repo, ruleset, sources) {
  const list = [];
  for (const src of sources) {
    const [rs, source] = src.includes('/') ? src.split('/') : [ruleset, src];
    const dir = path.join(repo, 'content', rs, source, 'creature');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const d = readJson(path.join(dir, f));
      list.push({ key: `${source}:creature/${path.basename(f, '.json')}`, name: norm(d.name), doc: d });
    }
  }
  return list;
}

export function matchBlocks(blocks, cands, sources, compare) {
  const order = (k) => sources.findIndex((s) => k.startsWith((s.split('/').pop()) + ':'));
  return blocks.map((b) => {
    const names = nameVariants(b.head);
    let hits = cands.filter((c) => names.includes(c.name));
    let how = 'name';
    if (!hits.length) {
      const words = names[0].split(' ');
      hits = cands.filter((c) => words.every((w) => c.name.includes(singular(w))));
      how = 'words';
    }
    hits.sort((x, y) => order(x.key) - order(y.key));
    const best = hits[0];
    const res = best && compare ? compare(b, best.doc) : null;
    return { page: b.page, head: b.head, count: b.count, proposal: best ? best.key : null, how: best ? how : 'none', others: hits.slice(1, 4).map((h) => h.key), ...(res || {}) };
  });
}

async function main(argv) {
  const args = argv.slice(2);
  const json = args.includes('--json'); if (json) args.splice(args.indexOf('--json'), 1);
  const pi = args.indexOf('--pages'); const pages = pi >= 0 ? args.splice(pi, 2)[1] : null;
  const si = args.indexOf('--skip'); const skip = si >= 0 ? new RegExp(args.splice(si, 2)[1]) : null;
  const [packDir, textDir] = args;
  if (!packDir || !textDir) { console.error('usage: node tools/advimport/statmatch.mjs <pack-dir> <text-dir> [--pages A-B] [--skip REGEX] [--json]'); return 2; }
  const pack = readJson(path.join(packDir, 'pack.json'));
  const sys = await systemReader(pack.ruleset);
  const sources = (pack.content || []).filter((s) => !(sys.NOT_CREATURES && sys.NOT_CREATURES.test(s)));
  let files = fs.readdirSync(textDir).filter((f) => /^p\d+\.txt$/.test(f)).sort();
  if (pages) { const [a, b] = pages.split('-').map(Number); files = files.filter((f) => { const n = Number(f.slice(1, 4)); return n >= a && n <= (b || a); }); }
  const blocks = files.flatMap((f) => sys.parseBlocks(fs.readFileSync(path.join(textDir, f), 'utf8'), Number(f.slice(1, 4)), { skip }));
  const report = matchBlocks(blocks, candidates(REPO, pack.ruleset, sources), sources, sys.compare);
  if (json) { console.log(JSON.stringify(report, null, 1)); return 0; }
  for (const r of report) {
    const d = (r.diffs || []).map((x) => `${x.what} ${x.book} (open ${x.open})`).join(', ');
    console.log(`p${r.page}  ${r.head}  ->  ${r.proposal || 'NO MATCH'}${r.how === 'words' ? ' (word match: check)' : ''}  [${r.verdict || '-'}]${d ? '  ' + d : ''}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv).then((c) => { process.exitCode = c; });
