#!/usr/bin/env node
// Import Foundry PF2E data (the Foundry VTT Pathfinder 2E system's compendium JSON) into our content format.
// Every kind of game document is converted: creatures, hazards, vehicles, items, feats and class features,
// actions, effects, conditions, spells, ancestries, heritages, backgrounds, classes, deities and campaign
// features (tools/import/foundry/convert.mjs). Foundry rule elements are translated where our engine supports
// them and kept untouched otherwise (counted in the report). Each document keeps its licence and book.
//
// Usage:
//   node tools/import/foundry-pf2e.mjs --release <foundry-checkout> [--sources a,b] [--version V] [--dry-run]
//       The open content in this repository (content/pf2e/<source>/<folder>/<slug>.json) from a whole Foundry
//       release: a checkout of github.com/foundryvtt/pf2e at the release's commit. Only documents licensed ORC
//       or OGL are written. Compares with content/pf2e/import-manifest.json and reports what is new, changed by
//       Foundry, changed by our converter, renamed and retired; applies our corrections in content/pf2e/overrides/.
//       Writes import-manifest.json, import-report.md and import-report.json. --dry-run: the report only.
//       --sources: only these Foundry packs (folder names); the rest of the manifest is left as it is.
//   node tools/import/foundry-pf2e.mjs <file-or-folder> [...] --out <pack-dir> [--dry-run]
//       A private pack (packs/<id>, git-ignored, or a folder outside the repository), for anything that is not
//       open; writes <pack-dir>/content/<folder>/<slug>.json and import-report.json there.
// Docs: docs/design/game-data.md sections 5 and 7, docs/best-practices/game-data.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONVERTERS } from './foundry/convert.mjs';
import { readRelease, listJson, planImport, runImport, writeImport, readOverrides, linker } from './foundry/track.mjs';

export { cleanText, convertValue, convertRule, convertCreature, convertItem, convertSpell, convertHazard, OPEN_LICENSES, CONVERTERS, KIND_OF } from './foundry/convert.mjs';
export { planImport, runImport, writeImport, applyOverride, readRelease, reportMarkdown, hash } from './foundry/track.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OPEN_DIR = path.join(ROOT, 'content', 'pf2e');

/**
 * Convert a set of Foundry documents on their own (no manifest): {docs: [{key, doc}], report}, keys
 * '<folder>/<slug>'. `open`: only documents licensed ORC or OGL (the rest skipped). Links between the documents
 * given resolve; links to anything else are kept as names.
 */
export function importDocs(list, { open = false } = {}) {
  const entries = list.map(({ file, data }) => ({ source: 'local', compendium: 'local', file, data }));
  const plan = planImport(entries, { open });
  const report = { converted: [], flagged: [], skipped: plan.skipped.map(({ source: _s, ...x }) => x), unsupported: {}, unresolved: {} };
  const ctx = { report, slug: null, ref: null };
  const ref = linker(plan, {}, report.unresolved);
  ctx.ref = (u) => { const k = ref(u); return k ? k.replace(/^local:/, '') : null; };
  const docs = [];
  for (const x of plan.docs) {
    ctx.slug = x.slug;
    const doc = CONVERTERS[x.kind](x.data, ctx);
    docs.push({ key: `${x.dir}/${x.slug}`, doc });
    report.converted.push({ name: x.data.name, as: `${x.dir}/${x.slug}`, license: doc.source.license });
  }
  return { docs, report };
}

/** Files under the paths given (folders read recursively, .json only; Foundry's _folders.json skipped). */
export function readInputs(paths) {
  const out = [];
  for (const p of paths) {
    const files = fs.statSync(p).isDirectory() ? listJson(p) : [p];
    for (const f of files) { try { out.push({ file: f, data: JSON.parse(fs.readFileSync(f, 'utf8')) }); } catch { out.push({ file: f, data: null }); } }
  }
  return out;
}

/** Is a folder a place imported content may go: outside this repository, or under its git-ignored packs/? */
export function privateTarget(dir) {
  const abs = path.resolve(dir), rel = path.relative(ROOT, abs);
  const inside = !rel.startsWith('..') && !path.isAbsolute(rel);   // '' is the repository's own root
  return !inside || rel.split(path.sep)[0] === 'packs';
}

/** Import a whole release into `dest` (content/pf2e). Returns the result of runImport, written unless dryRun. */
export function importRelease(root, { dest = OPEN_DIR, sources = null, version, dryRun = false, today } = {}) {
  const rel = readRelease(root, { version });
  const packs = rel.packs.filter((p) => !sources || sources.includes(p.source));
  if (sources) for (const s of sources) if (s !== 'traits' && !packs.some((p) => p.source === s)) throw new Error(`--sources: no Foundry pack "${s}" in this release`);
  const entries = [];
  for (const p of packs) for (const f of listJson(p.dir)) {
    let data = null;
    try { data = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* reported as not a document */ }
    entries.push({ source: p.source, compendium: p.name, file: path.relative(root, f), data });
  }
  // the trait descriptions from Foundry's language file: one more source, "traits"
  if (!sources || sources.includes('traits')) for (const t of rel.traits || []) entries.push({ source: 'traits', compendium: 'traits', ...t });
  const mf = path.join(dest, 'import-manifest.json');
  const manifest = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : null;
  const plan = planImport(entries, { manifest, open: true });
  const covered = [...packs.map((p) => p.source), ...((!sources || sources.includes('traits')) && (rel.traits || []).length ? ['traits'] : [])];
  const result = runImport(plan, { manifest, overrides: readOverrides(path.join(dest, 'overrides')), redirects: rel.redirects, release: rel, sources: covered, today });
  if (!dryRun) { fs.mkdirSync(dest, { recursive: true }); result.written = writeImport(dest, result); }
  return result;
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const release = opt('--release'), out = opt('--out'), srcs = opt('--sources'), version = opt('--version'), dry = flag('--dry-run');
    if (opt('--public') !== undefined) throw new Error('--public is replaced by --release <foundry-checkout> [--sources <pack>]: open content is imported from a whole release, tracked by the manifest');
    if (release) {
      const r = importRelease(release, { sources: srcs ? srcs.split(',').map((s) => s.trim()).filter(Boolean) : null, version, dryRun: dry });
      const c = r.report.counts;
      console.log(`Foundry PF2E ${r.report.foundry.version}: ${c.new} new, ${c.changed} changed by Foundry, ${c.ours} changed on our side, ${c.renamed} renamed, ${c.retired} retired, ${c.unchanged} unchanged, ${c.skipped} skipped${dry ? ' (dry run: nothing written)' : `; ${r.written} file(s) written to ${path.relative(process.cwd(), OPEN_DIR) || OPEN_DIR}`}`);
      for (const e of r.report.errors.slice(0, 30)) console.log(`  ERROR ${e}`);
      for (const o of r.report.overrides) console.log(`  review override ${o.source}/${o.key}: ${o.note}`);
      return r.report.errors.length ? 1 : 0;
    }
    if (!out || !args.length) throw new Error('give --release <foundry-checkout> (open content), or files or folders and --out <pack-dir> (a private pack)');
    if (!privateTarget(out)) throw new Error(`"${out}" is inside the repository: open content comes in with --release, anything else into a private pack (packs/<id>) or a folder outside the repository`);
    const dest = path.join(out, 'content');
    const { docs, report } = importDocs(readInputs(args), { open: false });
    if (!dry) {
      for (const { key, doc } of docs) {
        const f = path.join(dest, `${key}.json`);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, JSON.stringify(doc, null, 2) + '\n');
      }
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, 'import-report.json'), JSON.stringify(report, null, 2) + '\n');
    }
    console.log(`${report.converted.length} converted, ${report.flagged.length} flagged, ${report.skipped.length} skipped${dry ? ' (dry run: nothing written)' : ` into ${dest}`}`);
    for (const s of report.skipped.slice(0, 10)) console.log(`  skipped ${s.name || s.file}: ${s.why}`);
    return 0;
  } catch (e) {
    console.error(`import: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
