// Importing a whole Foundry PF2E release and tracking it from one import to the next (docs/design/game-data.md
// section 7): stable slugs, links between documents, our corrections (overrides), and a manifest recording every
// document's Foundry id and fingerprints, so each import says what is new, what Foundry changed, what our
// converter changed, what was renamed and what Foundry removed (kept, marked retired).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { KIND_OF, SKIP, CONVERTERS, OPEN_LICENSES, slugify, sourceOf, foundryType } from './convert.mjs';
import { kindDir } from '../../../rulesets/pf2e/content.js';

export const hash = (x) => crypto.createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 16);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const FOUNDRY_ID = /^[A-Za-z0-9]{16}$/;

/** Foundry's JSON files under a folder (recursive; Foundry's own _folders.json and the like skipped). */
export function listJson(dir) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.json') && !e.name.startsWith('_')) out.push(p); } };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

/**
 * A Foundry PF2E checkout (the system's git repository at a release): its version, commit, compendium packs
 * (Foundry's name, our source name = its folder) and the links Foundry redirects.
 */
export function readRelease(root, { version } = {}) {
  const sysFile = ['system.pf2e.json', 'static/system.json', 'system.json'].map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  if (!sysFile) throw new Error(`${root}: no system.pf2e.json (is this a checkout of github.com/foundryvtt/pf2e?)`);
  const sys = readJson(sysFile);
  let commit = null;
  try { commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a git checkout */ }
  // the built system names packs/<folder>; the source repository keeps them under packs/pf2e/<folder>
  const packs = (sys.packs || []).filter((p) => /^packs\/(pf2e\/)?[a-z0-9-]+$/.test(p.path || '')).map((p) => {
    const source = p.path.split('/').pop();
    const dir = [path.join(root, 'packs', 'pf2e', source), path.join(root, p.path)].find((d) => fs.existsSync(d)) || path.join(root, p.path);
    return { name: p.name, source, dir, type: p.type };
  });
  const redirFile = path.join(root, 'build', 'uuid-redirects', 'pf2e.json');
  return { version: version || sys.version, commit, packs, redirects: fs.existsSync(redirFile) ? readJson(redirFile) : {}, traits: readTraits(root) };
}

/**
 * Foundry's trait descriptions (static/lang/en.json: PF2E.TraitDescription<Name>, labelled by PF2E.Trait<Name>):
 * Paizo's rules text for each trait, as documents of type "trait" (source "traits"). Foundry gives them no
 * per-entry licence; its game text is ORC or OGL, so they carry "ORC/OGL".
 */
export function readTraits(root) {
  const f = path.join(root, 'static', 'lang', 'en.json');
  if (!fs.existsSync(f)) return [];
  const pf = (readJson(f) || {}).PF2E || {};
  const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase();
  const out = [];
  for (const [k, text] of Object.entries(pf)) {
    if (!k.startsWith('TraitDescription') || typeof text !== 'string') continue;
    const name = k.slice('TraitDescription'.length), slug = kebab(name);
    const label = typeof pf[`Trait${name}`] === 'string' ? pf[`Trait${name}`] : name.replace(/([a-z])([A-Z])/g, '$1 $2');
    out.push({ file: `static/lang/en.json#${k}`, data: { _id: `trait-${slug}`, name: label, type: 'trait', system: { description: { value: text }, publication: { title: 'Pathfinder rules text (Foundry PF2E trait descriptions)', license: 'ORC/OGL' } } } });
  }
  return out;
}

/** Is a manifest's record for this document, and does it name the same folder? */
const known = (m, src, id) => (m && m.documents ? m.documents[`${src}/${id}`] : undefined);

/**
 * Plan an import: every document read, classified (converted or skipped with why), given a stable slug, and
 * indexed so links between documents resolve. `entries`: [{source, compendium, file, data}].
 */
export function planImport(entries, { manifest = null, open = true } = {}) {
  const skipped = [], docs = [];
  for (const e of entries) {
    const d = e.data, type = foundryType(d);
    if (!type) { skipped.push({ source: e.source, file: e.file, why: 'not a Foundry document' }); continue; }
    const kind = KIND_OF[type];
    if (!kind) { skipped.push({ source: e.source, file: e.file, name: d.name, type, why: SKIP[type] || `Foundry type "${type}" is not imported` }); continue; }
    const src = sourceOf(d);
    if (open && (!src || !OPEN_LICENSES.includes(src.license))) { skipped.push({ source: e.source, file: e.file, name: d.name, type, why: `licence "${src ? src.license : 'none recorded'}" is not open (ORC or OGL): it can only go into a private pack` }); continue; }
    if (!d._id && manifest) { skipped.push({ source: e.source, file: e.file, name: d.name, type, why: 'no Foundry id: it cannot be tracked from one import to the next' }); continue; }
    docs.push({ ...e, type, kind, dir: kindDir(kind), id: d._id || `name-${slugify(d.name)}` });
  }
  // slugs: a document keeps the slug the manifest gave it while its name and folder are unchanged; a new name gets
  // the name's slug, or the slug plus the start of its Foundry id when another document in that folder has it
  const taken = new Map();   // `${source}/${dir}/${slug}` -> doc
  const claim = (x, slug) => { taken.set(`${x.source}/${x.dir}/${slug}`, x); x.slug = slug; };
  const keepers = [], fresh = [];
  for (const x of docs) {
    const m = known(manifest, x.source, x.id);
    if (m && m.key === `${x.dir}/${m.key.split('/')[1]}` && m.name === x.data.name && !m.retired) keepers.push([x, m.key.split('/')[1]]);
    else fresh.push(x);
  }
  for (const [x, slug] of keepers) claim(x, slug);
  fresh.sort((a, b) => a.source.localeCompare(b.source) || a.id.localeCompare(b.id));
  for (const x of fresh) {
    let slug = slugify(x.data.name) || x.id.toLowerCase();
    if (taken.has(`${x.source}/${x.dir}/${slug}`)) slug = `${slug}-${x.id.slice(0, 6).toLowerCase()}`;
    let n = 2;
    while (taken.has(`${x.source}/${x.dir}/${slug}`)) slug = `${slugify(x.data.name)}-${x.id.slice(0, 6).toLowerCase()}-${n++}`;
    claim(x, slug);
  }
  // links: Foundry names a document Compendium.pf2e.<pack>.<Item|Actor>.<id or name>
  const byId = new Map(), byName = new Map();
  for (const x of docs) {
    const key = `${x.source}:${x.dir}/${x.slug}`;
    byId.set(`${x.compendium}/${x.id}`, key);
    const nk = `${x.compendium}/${String(x.data.name).toLowerCase()}`;
    if (!byName.has(nk)) byName.set(nk, key);
  }
  return { docs, skipped, byId, byName };
}

/** A link resolver for converting: ctx.ref(uuid) -> '<source>:<folder>/<slug>' or null (counted in `unresolved`). */
export function linker(plan, redirects = {}, unresolved = {}) {
  // `name`: the linked document's name where the link carries it (an embedded copy), tried when the id is unknown
  return (uuid, name) => {
    let u = String(uuid || '');
    for (let i = 0; i < 3 && redirects[u]; i++) u = redirects[u];
    const m = /^Compendium\.pf2e\.([^.]+)\.(?:Item|Actor|JournalEntry|RollTable)\.(.+)$/.exec(u);
    if (!m) { unresolved[u.split('.').slice(0, 3).join('.') || '(none)'] = (unresolved[u.split('.').slice(0, 3).join('.') || '(none)'] || 0) + 1; return null; }
    const [, pack, rest] = m;
    const hit = (FOUNDRY_ID.test(rest) && plan.byId.get(`${pack}/${rest}`)) || plan.byName.get(`${pack}/${rest.toLowerCase()}`) || plan.byId.get(`${pack}/${rest}`)
      || (name ? plan.byName.get(`${pack}/${String(name).toLowerCase()}`) : null);
    if (!hit) unresolved[pack] = (unresolved[pack] || 0) + 1;
    return hit || null;
  };
}

// --- overrides ---------------------------------------------------------------------------------------------------

const pathParts = (p) => String(p).split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : x));
/** Apply an override ({set: {path: value}, remove: [path]}) to a document; returns the problems found. */
export function applyOverride(doc, ov) {
  const problems = [];
  const parentOf = (p) => {
    const parts = pathParts(p);
    let o = doc;
    for (const k of parts.slice(0, -1)) { if (o === null || typeof o !== 'object' || !(k in o)) return [null, parts.at(-1)]; o = o[k]; }
    return [o && typeof o === 'object' ? o : null, parts.at(-1)];
  };
  for (const [p, v] of Object.entries(ov.set || {})) {
    const [o, last] = parentOf(p);
    if (!o) { problems.push(`set "${p}": the document has no such place any more`); continue; }
    o[last] = v;
  }
  for (const p of ov.remove || []) {
    const [o, last] = parentOf(p);
    if (!o || !(last in o)) { problems.push(`remove "${p}": the document has no such field any more`); continue; }
    if (Array.isArray(o)) o.splice(last, 1); else delete o[last];
  }
  return problems;
}

/** The overrides kept for open content: {'<source>/<folder>/<slug>': {file, data}}. */
export function readOverrides(dir) {
  const out = {};
  for (const f of listJson(dir)) {
    const rel = path.relative(dir, f).split(path.sep);
    if (rel.length !== 3) continue;
    out[`${rel[0]}/${rel[1]}/${path.basename(rel[2], '.json')}`] = { file: f, data: readJson(f) };
  }
  return out;
}

// --- the import itself -------------------------------------------------------------------------------------------

/**
 * Convert a planned import and compare it with the manifest. Returns {files: [{rel, doc}], retire: [{rel, since,
 * replacedBy}], manifest, report}; nothing is written. `release`: {version, commit}. `sources`: the sources this
 * import covers (documents of other sources in the manifest are left as they are).
 */
export function runImport(plan, { manifest = null, overrides = {}, redirects = {}, release = {}, sources = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const report = {
    foundry: { version: release.version || null, commit: release.commit || null }, previous: manifest ? manifest.foundry : null,
    counts: { new: 0, changed: 0, ours: 0, renamed: 0, unchanged: 0, retired: 0, skipped: plan.skipped.length },
    bySource: {}, new: [], changed: [], ours: [], renamed: [], retired: [], overrides: [], errors: [],
    skipped: {}, unsupported: {}, unresolved: {}, flagged: [],
  };
  const ctx = { report, ref: null, slug: null };
  ctx.ref = linker(plan, redirects, report.unresolved);
  const docsOut = {}, files = [], usedOverrides = new Set();
  const covered = new Set(sources || plan.docs.map((x) => x.source));
  for (const s of plan.skipped) { const k = s.why.replace(/"[^"]*"/, '…'); report.skipped[k] = (report.skipped[k] || 0) + 1; }
  const tally = (src, what) => { const b = (report.bySource[src] ||= { documents: 0, new: 0, changed: 0, ours: 0, renamed: 0, retired: 0 }); b[what]++; };
  for (const x of plan.docs) {
    ctx.slug = x.slug;
    let doc;
    try { doc = CONVERTERS[x.kind](x.data, ctx); } catch (e) { report.errors.push(`${x.source}/${x.dir}/${x.slug}: conversion failed: ${e.message}`); continue; }
    const key = `${x.dir}/${x.slug}`, okey = `${x.source}/${key}`, original = hash(x.data);
    const ov = overrides[okey];
    if (ov) {
      usedOverrides.add(okey);
      const problems = applyOverride(doc, ov.data);
      for (const p of problems) report.errors.push(`override ${path.basename(path.dirname(path.dirname(ov.file)))}/${key}: ${p}`);
      if (ov.data.foundry && ov.data.foundry !== original) report.overrides.push({ source: x.source, key, name: x.data.name, why: ov.data.why || '', note: 'Foundry changed this document since our correction: check whether they fixed it and the override can go' });
    }
    const converted = hash(doc);
    const m = known(manifest, x.source, x.id);
    let status;
    if (!m || m.retired) status = 'new';
    else if (m.key !== key) status = 'renamed';
    else if (m.original !== original) status = 'changed';
    else if (m.converted !== converted) status = 'ours';
    else status = 'unchanged';
    tally(x.source, 'documents');
    if (status !== 'unchanged') tally(x.source, status);
    report.counts[status]++;
    const entry = { source: x.source, key, name: x.data.name };
    if (status === 'new') report.new.push(entry);
    if (status === 'changed') report.changed.push(entry);
    if (status === 'ours') report.ours.push(entry);
    if (status === 'renamed') report.renamed.push({ ...entry, from: m.key });
    docsOut[`${x.source}/${x.id}`] = { key, name: x.data.name, original, converted };
    files.push({ rel: `${x.source}/${key}.json`, doc, status });
  }
  for (const k of Object.keys(overrides)) if (!usedOverrides.has(k) && covered.has(k.split('/')[0])) report.errors.push(`override ${k}: no document by that name in this import (renamed or removed?)`);
  // what Foundry no longer has: kept, marked retired; a rename points to the new key
  const retire = [];
  const renamedTo = new Map(report.renamed.map((r) => [`${r.source}/${r.from}`, `${r.source}:${r.key}`]));
  for (const [mk, m] of Object.entries((manifest && manifest.documents) || {})) {
    const src = mk.split('/')[0];
    if (docsOut[mk]) continue;
    if (!covered.has(src)) { docsOut[mk] = m; continue; }
    const rec = { ...m, retired: m.retired || release.version || today };
    docsOut[mk] = rec;
    if (!m.retired) {
      tally(src, 'retired'); report.counts.retired++;
      report.retired.push({ source: src, key: m.key, name: m.name });
      retire.push({ rel: `${src}/${m.key}.json`, since: rec.retired });
    }
  }
  for (const r of report.renamed) retire.push({ rel: `${r.source}/${r.from}.json`, since: release.version || today, replacedBy: renamedTo.get(`${r.source}/${r.from}`) });
  const sorted = Object.fromEntries(Object.entries(docsOut).sort(([a], [b]) => a.localeCompare(b)));
  const out = { foundry: { version: release.version || null, commit: release.commit || null, imported: today }, documents: sorted };
  return { files, retire, manifest: out, report };
}

/** Write an import: the documents that changed, retired marks, the manifest and the report (Markdown and JSON). */
export function writeImport(dest, result) {
  let written = 0;
  for (const f of result.files) {
    const file = path.join(dest, f.rel);
    if (f.status === 'unchanged' && fs.existsSync(file)) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(f.doc, null, 2) + '\n');
    written++;
  }
  for (const r of result.retire) {
    const file = path.join(dest, r.rel);
    if (!fs.existsSync(file)) continue;
    const doc = readJson(file);
    doc.retired = { since: r.since, ...(r.replacedBy ? { replacedBy: r.replacedBy } : {}) };
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  }
  fs.writeFileSync(path.join(dest, 'import-manifest.json'), JSON.stringify(result.manifest, null, 1) + '\n');
  const { flagged, ...rest } = result.report;
  fs.writeFileSync(path.join(dest, 'import-report.json'), JSON.stringify(rest, null, 1) + '\n');
  fs.writeFileSync(path.join(dest, 'import-report.md'), reportMarkdown(result.report));
  return written;
}

const LIST_CAP = 400;
/** The import report for people. */
export function reportMarkdown(r) {
  const L = [], c = r.counts;
  L.push('# Foundry PF2E import report', '');
  L.push(`Release **${r.foundry.version || '?'}** (commit \`${(r.foundry.commit || '?').slice(0, 12)}\`)${r.previous ? `, compared with the previous import of ${r.previous.version} (${r.previous.imported})` : ', the first import'}.`, '');
  L.push('Generated by `tools/import/foundry-pf2e.mjs`; the full lists are in `import-report.json`. Docs: `docs/design/game-data.md` section 7.', '');
  L.push('| New | Changed by Foundry | Changed on our side | Renamed | Retired | Unchanged | Skipped |', '|---:|---:|---:|---:|---:|---:|---:|');
  L.push(`| ${c.new} | ${c.changed} | ${c.ours} | ${c.renamed} | ${c.retired} | ${c.unchanged} | ${c.skipped} |`, '');
  if (r.errors.length) { L.push('## Errors', ''); for (const e of r.errors) L.push(`- ${e}`); L.push(''); }
  if (r.overrides.length) { L.push('## Corrections to review', '', 'Foundry changed these documents since we corrected them (content/pf2e/overrides/).', ''); for (const o of r.overrides) L.push(`- ${o.source}: ${o.name} (\`${o.key}\`)${o.why ? `: ${o.why}` : ''}`); L.push(''); }
  L.push('## By source', '', '| Source | Documents | New | Changed | Ours | Renamed | Retired |', '|---|---:|---:|---:|---:|---:|---:|');
  for (const [s, b] of Object.entries(r.bySource).sort()) L.push(`| ${s} | ${b.documents} | ${b.new} | ${b.changed} | ${b.ours} | ${b.renamed} | ${b.retired} |`);
  L.push('');
  const list = (title, items, fmt) => {
    if (!items.length) return;
    L.push(`## ${title} (${items.length})`, '');
    if (items.length > LIST_CAP) { L.push(`Too many to list here: see the source table above and \`import-report.json\`.`, ''); return; }
    let src = null;
    for (const it of [...items].sort((a, b) => a.source.localeCompare(b.source) || a.key.localeCompare(b.key))) { if (it.source !== src) { L.push(`- **${it.source}**`); src = it.source; } L.push(`  - ${fmt(it)}`); }
    L.push('');
  };
  list('Changed by Foundry', r.changed, (x) => `${x.name} (\`${x.key}\`)`);
  list('Renamed', r.renamed, (x) => `${x.name}: \`${x.from}\` → \`${x.key}\` (the old file is kept, retired)`);
  list('Retired: gone from Foundry, kept so saves still load', r.retired, (x) => `${x.name} (\`${x.key}\`)`);
  list('New', r.new, (x) => `${x.name} (\`${x.key}\`)`);
  list('Changed on our side: the converter, a correction, or a document it links to', r.ours, (x) => `${x.name} (\`${x.key}\`)`);
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  if (Object.keys(r.unsupported).length) {
    L.push('## Foundry rules our engine cannot run yet', '', 'Kept in the documents as `unsupported` and shown on sheets; the count is how often each appears.', '', '| Rule | Count |', '|---|---:|');
    for (const [k, n] of top(r.unsupported)) L.push(`| ${k} | ${n} |`);
    L.push('');
  }
  if (Object.keys(r.skipped).length) {
    L.push('## Skipped', '', '| Why | Count |', '|---|---:|');
    for (const [k, n] of top(r.skipped)) L.push(`| ${k} | ${n} |`);
    L.push('');
  }
  if (Object.keys(r.unresolved).length) {
    L.push('## Links that point outside the import', '', 'Kept as names only. By the Foundry compendium they point into:', '', '| Compendium | Count |', '|---|---:|');
    for (const [k, n] of top(r.unresolved)) L.push(`| ${k} | ${n} |`);
    L.push('');
  }
  return L.join('\n');
}
