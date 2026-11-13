// The content library: every game document a pack's campaigns can draw on, read from files only when asked for.
//
// A content key names one document:
//   <kind>/<slug>            the pack's own content/<kind>/<slug>.json first, then each open source the pack lists
//                            (pack.json `content`, in order: content/<ruleset>/<source>/<kind>/<slug>.json)
//   <source>:<kind>/<slug>   one open source by name (content/<ruleset>/<source>/), listed in pack.json or not;
//                            used when two sources have a document of the same name
//
// The board only ever holds the documents its creatures use (docs/design/game-data.md section 7):
// referencedContent() finds them for loading a campaign, the tools add one when they add a creature or an item,
// and tidyOps() removes the ones nothing uses any more when the game is saved.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = /^[a-z0-9][a-z0-9-]*$/;

/** A content key's parts: {source|null, kind, slug}; throws on a malformed key. */
export function parseKey(key) {
  const m = /^(?:([a-z0-9][a-z0-9-]*):)?([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/.exec(String(key || ''));
  if (!m) throw new Error(`"${key}" is not a content key (<kind>/<slug>, or <source>:<kind>/<slug>)`);
  return { source: m[1] || null, kind: m[2], slug: m[3] };
}

/** The folder of an open source: pack.json lists them as '<ruleset>/<source>'. */
export const sourceDir = (entry) => path.join(REPO, 'content', entry);

/**
 * The library for a pack: get(key) -> document or undefined (cached), where(key) -> the file it came from.
 * `extra` ({key: document}) is consulted first (the board's own records, for the tools).
 */
export function contentLibrary(pack, packDir, { extra = null } = {}) {
  const ruleset = pack.ruleset || 'pf2e';
  const listed = (pack.content || []).map((e) => {
    const dir = sourceDir(e);
    if (!fs.existsSync(dir)) throw new Error(`pack.json content: no open content "${e}" (content/${e})`);
    return dir;
  });
  const own = packDir ? path.join(packDir, 'content') : null;
  const cache = new Map();
  const fileFor = (key) => {
    const { source, kind, slug } = parseKey(key);
    const dirs = source ? [path.join(REPO, 'content', ruleset, source)] : [own, ...listed].filter(Boolean);
    for (const d of dirs) { const f = path.join(d, kind, `${slug}.json`); if (fs.existsSync(f)) return f; }
    return null;
  };
  const lib = {
    where: (key) => { try { return fileFor(key); } catch { return null; } },
    get(key) {
      if (extra && extra[key]) return extra[key];
      if (cache.has(key)) return cache.get(key);
      const f = lib.where(key);
      const doc = f ? (({ $schema: _s, ...d }) => d)(JSON.parse(fs.readFileSync(f, 'utf8'))) : undefined;
      cache.set(key, doc);
      return doc;
    },
    has: (key) => lib.get(key) !== undefined,
  };
  return lib;
}

/** The library as a plain-looking object ({key: document}) for code that indexes content directly. */
export function contentView(lib) {
  return new Proxy({}, {
    get: (_, k) => (typeof k === 'string' ? lib.get(k) : undefined),
    has: (_, k) => typeof k === 'string' && lib.has(k),
  });
}

/**
 * The content keys a campaign uses: each creature's base stat block and each item it carries by reference, and
 * each effect on a token that names an effect in the content. `tokens`: {id: token}.
 */
export function referencedKeys(actors, tokens = {}, loot = []) {
  const keys = new Set();
  for (const it of loot || []) if (it && it.ref) keys.add(it.ref);   // the party's stash
  for (const a of Object.values(actors || {})) {
    if (a && a.base) keys.add(a.base);
    for (const it of (a && a.items) || []) if (it && it.ref) keys.add(it.ref);
  }
  for (const t of Object.values(tokens || {})) for (const e of (t && t.effects) || []) if (e && e.ref) keys.add(e.ref);
  return keys;
}

/**
 * The optional documents creatures show (a character's feats' and features' descriptions), as the system says
 * (system.content.actorContent): a list of candidate-key groups, the first key found in each being the one.
 */
export function optionalGroups(actors, system) {
  const f = system && system.content && system.content.actorContent;
  return f ? Object.values(actors || {}).flatMap((a) => f(a)) : [];
}

/**
 * The documents the campaign uses, from the library: {content: {key: document}, missing: [key]}. With the
 * system, also the first document found of each optional group (none found is not an error).
 */
export function referencedContent(lib, actors, tokens = {}, system = null, loot = []) {
  const content = {}, missing = [];
  const get = (k) => { try { return lib.get(k); } catch { return undefined; } };
  for (const k of [...referencedKeys(actors, tokens, loot)].sort()) {
    const doc = get(k);
    if (doc) content[k] = doc; else missing.push(k);
  }
  for (const group of optionalGroups(actors, system)) {
    const k = group.find((x) => content[x] || get(x));
    if (k && !content[k]) content[k] = get(k);
  }
  return { content, missing };
}


/** The key of the trait glossary every campaign carries on the board (one record). */
export const GLOSSARY_KEY = 'glossary/traits';
/**
 * The trait glossary for a ruleset: every trait's name and description from the open content's "traits" source
 * (content/<ruleset>/traits/trait/*.json), as one document {kind: 'glossary', entries: {slug: {name, text}}};
 * null if there is none.
 */
export function traitGlossary(ruleset) {
  const dir = path.join(REPO, 'content', ruleset, 'traits', 'trait');
  if (!fs.existsSync(dir)) return null;
  const entries = {};
  let source = null;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (d.retired) continue;
    entries[d.slug] = { name: d.name, text: d.text };
    if (!source && d.source) source = { title: d.source.title, license: d.source.license };
  }
  // the system's own trait descriptions only: each document says which system it is for and where it is from
  return { kind: 'glossary', slug: 'traits', system: ruleset, source, entries };
}
