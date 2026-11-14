#!/usr/bin/env node
// Book hand-off (docs/best-practices/adventure-importer.md section 14): before a later book of an Adventure Path joins
// its campaign, find what carries over from the earlier books, so nothing is made twice by accident.
//
// Usage: node tools/advimport/handoff.mjs <pack-dir> <save-dir> [--json]
//
// The earlier books are the campaign's other packs (campaign.json packs, found as packs/<id>). Compared with this
// book's adventure.json and adventure-events.json:
//   - named creatures (not a "Bristling wolf" from unique names) with the same name in an earlier book: a returning NPC
//     keeps the earlier book's token, so their history and ledger follow them; or a new token on purpose;
//   - ledger entries with the same or nearly the same title: a thread that continues is the earlier entry, updated in
//     play, not a second one;
//   - subsystems with the same or nearly the same title under another id: the earlier one goes on (its points carry
//     over), and this book's events use the earlier id;
//   - flags and events this book's conditions wait on that no book sets or has: a typo, or a flag never set.
// Each finding is settled in <pack>/handoff.json: {"decisions": [{"key": "<key printed>", "same"|"apart": true,
// "why": "..."}]}. Exits 1 while anything is unsettled. With no earlier book (the first book) there is nothing to do.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
// unique_names' adjectives (tools/advimport/buildlib.py): such a name is one of many, never a returning NPC
const ADJ = new Set(['amber', 'bristling', 'crooked', 'dusky', 'eager', 'fretful', 'gaunt', 'hollow', 'inky', 'jagged', 'knotted', 'lanky', 'mottled', 'nimble', 'oily', 'pallid', 'quiet', 'ragged', 'sallow', 'twitchy', 'umber', 'vexed', 'wiry', 'yellowed', 'ashen', 'brittle', 'cinder', 'drab', 'ebon', 'flinty', 'grizzled', 'hulking', 'ivory', 'jittery', 'keen', 'lurid', 'mangy', 'nervous']);
const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'with', 'in', 'to', 'at', 'for', 'on']);
const words = (s) => new Set(norm(s).split(' ').filter((w) => w && !STOP.has(w)));

/** Word overlap of two titles (0..1). */
export function similar(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

/** A creature name that is one of a crowd (unique_names) rather than someone. */
export const crowd = (name) => ADJ.has(norm(name).split(' ')[0]);

function named(adv) {
  const out = [];
  for (const e of adv.encounters || []) for (const c of e.creatures || []) if (!crowd(c.name)) out.push({ name: c.name, enc: e.id, map: e.map });
  return out;
}

function conditions(node, out = { flags: new Set(), events: new Set() }) {
  if (Array.isArray(node)) { for (const x of node) conditions(x, out); return out; }
  if (!node || typeof node !== 'object') return out;
  if (!node.do && typeof node.flag === 'string') out.flags.add(node.flag);
  if (!node.do && typeof node.event === 'string') out.events.add(node.event);
  for (const v of Object.values(node)) conditions(v, out);
  return out;
}

function setFlags(events) {
  const out = new Set();
  const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') { if (n.do === 'flag' && n.name) out.add(n.name); Object.values(n).forEach(walk); } };
  walk(events);
  return out;
}

/** Findings for a book joining the earlier books: [{key, what, text}]. */
export function compare(book, earlier) {
  const out = [];
  const add = (key, what, text) => { if (!out.some((f) => f.key === key)) out.push({ key, what, text }); };
  const before = earlier.flatMap((b) => named(b.adv).map((c) => ({ ...c, pack: b.id })));
  for (const c of named(book.adv)) {
    const hit = before.find((b) => norm(b.name) === norm(c.name));
    if (hit) add(`creature:${norm(c.name)}`, 'creature', `${c.name} (${c.enc}, ${c.map}) is also in ${hit.pack} (${hit.enc}, ${hit.map}): the same token returning, or a new one?`);
  }
  for (const l of book.adv.ledger || []) {
    for (const b of earlier) for (const m of b.adv.ledger || []) {
      if (norm(l.title) === norm(m.title) || (similar(l.title, m.title) >= 0.75 && l.kind === m.kind)) add(`ledger:${norm(l.title)}`, 'ledger', `ledger "${l.title}" (${l.kind}) and ${b.id}'s "${m.title}" (${m.kind}): the same thread going on, or apart?`);
    }
  }
  for (const s of book.events.subsystems || []) {
    for (const b of earlier) for (const t of b.events.subsystems || []) {
      if (s.id !== t.id && (norm(s.title) === norm(t.title) || similar(s.title, t.title) >= 0.75)) add(`subsystem:${s.id}`, 'subsystem', `subsystem ${s.id} "${s.title}" is like ${b.id}'s ${t.id} "${t.title}": carry on with ${t.id} (its points carry over), or a new one?`);
    }
  }
  const flags = new Set([...earlier.flatMap((b) => [...setFlags(b.events.events || [])]), ...setFlags(book.events.events || [])]);
  const evIds = new Set([...earlier.flatMap((b) => (b.events.events || []).map((e) => e.id)), ...(book.events.events || []).map((e) => e.id)]);
  const want = conditions(book.events.events || []);
  for (const f of want.flags) if (!f.startsWith('ended:') && !flags.has(f)) add(`flag:${f}`, 'flag', `this book waits on flag "${f}", which no book's events set`);
  for (const e of want.events) if (!evIds.has(e)) add(`event:${e}`, 'event', `this book waits on event "${e}", which no book has`);
  return out;
}

function loadBook(dir, id) {
  return { id, adv: readJson(path.join(dir, 'adventure.json'), {}), events: readJson(path.join(dir, 'adventure-events.json'), {}) };
}

function main(argv) {
  const [packDir, saveDir] = argv.filter((a) => !a.startsWith('--'));
  if (!packDir || !saveDir) { console.error('usage: node tools/advimport/handoff.mjs <pack-dir> <save-dir> [--json]'); return 2; }
  const pack = readJson(path.join(packDir, 'pack.json'));
  const camp = readJson(path.join(saveDir, 'campaign.json'), {});
  const ids = (camp.packs || (camp.pack ? [camp.pack] : [])).map((p) => (typeof p === 'string' ? p : p.id)).filter((id) => id && id !== pack.id);
  if (!ids.length) { console.log(`${pack.id}: the campaign's first book; nothing to hand off`); return 0; }
  const earlier = ids.map((id) => loadBook([path.join(path.dirname(path.resolve(packDir)), id), path.join(REPO, 'packs', id)].find((d) => fs.existsSync(path.join(d, 'pack.json'))) || '', id));
  const book = loadBook(packDir, pack.id);
  const decided = new Map((readJson(path.join(packDir, 'handoff.json'), {}).decisions || []).map((d) => [d.key, d]));
  const found = compare(book, earlier);
  if (argv.includes('--json')) { console.log(JSON.stringify(found, null, 1)); return 0; }
  let open = 0;
  for (const f of found) {
    const d = decided.get(f.key);
    if (d) console.log(`settled  ${f.key}: ${d.same ? 'same' : 'apart'} (${d.why || 'no reason given'})`);
    else { open++; console.log(`DECIDE   ${f.key}: ${f.text}`); }
  }
  console.log(`${pack.id} joining after ${ids.join(', ')}: ${found.length} found, ${open} to decide (in ${path.join(packDir, 'handoff.json')})`);
  return open ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
