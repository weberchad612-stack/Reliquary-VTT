#!/usr/bin/env node
// Build a campaign save from an imported adventure (docs/best-practices/adventure-importer.md).
//
// Usage:
//   node tools/advimport/campaign.mjs <pack-dir> <save-dir> [--id ID] [--title TITLE] [--force]
//
// Reads <pack-dir>/adventure.json:
//   {title, maps: [map ids], start: {map, room}, landing?: map id, encounters: [...], objects: [...]}
//   landing: the landing page (kind "landing", tools/advimport/landing.py): the campaign starts there; the GM moves the party
//   on to `start` from the map menu.
//   encounter: {id, map, room, pages, xp, hidden, friendly?, trigger?, tactics?,
//               creatures: [{name, alias?, ref? (a stat block key), at: [x, y], art?, rules?, stats?, note?, npc?, size?}]}
//   object:    {id, map, room, at, name, kind: container|feature|hazard, hidden?, items?, coins?, hazard?, locked?,
//               find_dc?, text?, note?, art?}
//   ambient:   [{map, sound (a loop in sounds/sounds.json), at, radius (ft), inner?, when?, volume?, label?, gm_only?}]
//   music:     {themes: {map id: mood}}   each map's music out of combat
//   ledger:    [{kind, title?, text, status?, where?, subjects?}]   the GM's memory from the book (source: adventure)
//   map_state: {map id: {regions_off?: [...], ...}}   how a map starts (a light region switched off until play turns it on)
// and writes the save: campaign.json, maps/<map>.json (tokens), actors/<token id>.json. Every creature and object
// becomes a token (hidden where the adventure hides it), named by the board's rules (board/names.js), with its
// stat block reference and the adventure's own differences, its art key and its encounter group. Token ids are
// stable for a given adventure file (derived from the encounter or object id), so rebuilding gives the same ids.
// The save is private (saves/ is git-ignored); refuses to overwrite one without --force.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n'); };

/** A token id (board/ids.js shape) that is the same every time for the same key. */
export function stableId(key) {
  const h = crypto.createHash('sha256').update(key).digest();
  let s = '';
  for (let i = 0; i < 8; i++) s += '0123456789abcdefghijklmnopqrstuvwxyz'[h[i] % 36];
  return `tok-${s}`;
}

const SIZES = { tiny: 0.5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The stat block document for a key (source:kind/slug), from content/<ruleset>/<source>/. */
function statBlock(repo, ruleset, key) {
  const m = /^(?:([a-z0-9-]+):)?([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(key || '');
  if (!m || !m[1]) return null;
  const f = path.join(repo, 'content', ruleset, m[1], m[2], `${m[3]}.json`);
  return fs.existsSync(f) ? readJson(f) : null;
}

export function buildSave(packDir, { id, title, repo = process.cwd() } = {}) {
  const pack = readJson(path.join(packDir, 'pack.json'));
  const adv = readJson(path.join(packDir, 'adventure.json'));
  const maps = Object.fromEntries([...new Set([...(adv.landing ? [adv.landing] : []), ...(adv.maps || pack.maps)])].map((m) => [m, {}]));
  const actors = {};
  const problems = [];
  const letters = {};
  const letterFor = (group, name) => {
    const used = (letters[group] = letters[group] || new Set());
    for (const ch of String(name).toUpperCase().replace(/[^A-Z]/g, '')) if (!used.has(ch)) { used.add(ch); return ch; }
    return String(name)[0].toUpperCase();
  };
  for (const e of adv.encounters || []) {
    if (!maps[e.map]) { problems.push(`${e.id}: map "${e.map}" is not in the adventure`); continue; }
    e.creatures.forEach((c, n) => {
      const tid = stableId(`${pack.id}:${e.id}:${n}`);
      const doc = c.ref ? statBlock(repo, pack.ruleset, c.ref) : null;
      if (c.ref && !doc) problems.push(`${e.id}: no stat block "${c.ref}"`);
      const size = SIZES[c.size || (doc && doc.size) || 'medium'] ?? 1;
      const tok = {
        name: c.name, ...(c.alias ? { alias: c.alias, known: false } : {}),
        kind: e.friendly ? 'neutral' : 'foe',
        type: slug(doc ? doc.name.replace(/\s*\(BB\)$/i, '') : c.name),
        group: e.id, short: letterFor(e.id, c.alias || c.name),
        ...(c.art ? { art: c.art } : {}),
        x: Math.floor(c.at[0]), y: Math.floor(c.at[1]),
        ...(size !== 1 ? { size } : {}),
        ...((c.size || (doc && doc.size)) === 'small' ? { small: true } : {}),
        ...(e.hidden ? { hidden: true } : {}),
      };
      if (doc && doc.stats && doc.stats.speeds) tok.speed = doc.stats.speeds.land || doc.stats.speeds.fly || 25;
      if (doc && (doc.stats.senses || []).some((s) => s.type === 'darkvision')) tok.senses = ['darkvision'];
      maps[e.map][tid] = tok;
      const note = [c.note, c.stats_note, `${e.room} (pp ${e.pages})`].filter(Boolean).join('. ');
      // a creature with no stat block (a merchant who never fights) is a token with a note, without game data
      if (!c.ref) tok.note = note;
      else actors[tid] = { system: pack.ruleset, kind: 'npc', base: c.ref, ...(c.stats ? { stats: c.stats } : {}), ...(c.rules ? { rules: c.rules } : {}), note };
    });
  }
  for (const o of adv.objects || []) {
    if (!maps[o.map]) { problems.push(`${o.id}: map "${o.map}" is not in the adventure`); continue; }
    const tid = stableId(`${pack.id}:object:${o.id}`);
    maps[o.map][tid] = {
      name: o.name, kind: 'object', type: slug(o.kind || 'object'), group: `objects-${slug(o.room || o.map)}`,
      short: letterFor(`objects-${slug(o.room || o.map)}`, o.name), ...(o.art ? { art: o.art } : {}),
      x: Math.floor(o.at[0]), y: Math.floor(o.at[1]), ...(o.hidden ? { hidden: true } : {}),
    };
    const items = (o.items || []).map(({ text_note: tn, ...it }) => (tn ? { ...it, text: tn } : it));
    actors[tid] = {
      system: pack.ruleset, kind: 'object', name: o.name,
      ...(o.text ? { text: o.text } : {}), ...(o.note ? { note: o.note } : {}),
      ...(items.length ? { items } : {}), ...(o.coins ? { coins: o.coins } : {}),
      ...(o.hazard ? { hazard: o.hazard } : {}), ...(o.locked ? { locked: o.locked } : {}),
      ...(o.find_dc ? { find_dc: o.find_dc } : {}), ...(o.room ? { room: o.room } : {}),
    };
  }
  const ambient = {};
  (adv.ambient || []).forEach((a, n) => {
    if (!maps[a.map]) { problems.push(`ambient ${n}: map "${a.map}" is not in the adventure`); return; }
    const { map, ...rest } = a;
    (ambient[map] = ambient[map] || {})[stableId(`${pack.id}:ambient:${n}`).replace('tok-', 'amb-')] = { ...rest, by: 'claude' };
  });
  const start = adv.start || { map: Object.keys(maps)[0] };
  const campaign = {
    $schema: '../../schemas/campaign.schema.json', v: 1,
    id: id || pack.id, title: title || adv.title || pack.title,
    pack: { id: pack.id, version: pack.version || '0' }, ruleset: pack.ruleset,
    current_map: adv.landing || start.map, discovered: [start.map],
    ...(adv.music && adv.music.themes ? { music: { mood: 'auto', themes: adv.music.themes } } : {}),
  };
  const t0 = Date.now();
  const ledger = (adv.ledger || []).map((e, n) => ({ id: `${t0.toString(36).padStart(9, '0')}-${n.toString(36)}`, at: new Date(t0).toISOString(), by: 'claude', source: 'adventure', ...e }));
  return { campaign, maps, actors, ambient, ledger, problems };
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const force = args.includes('--force'); if (force) args.splice(args.indexOf('--force'), 1);
  const id = opt('--id'), title = opt('--title');
  const [packDir, saveDir] = args;
  if (!packDir || !saveDir) { console.error('usage: node tools/advimport/campaign.mjs <pack-dir> <save-dir> [--id ID] [--title TITLE] [--force]'); return 2; }
  if (fs.existsSync(path.join(saveDir, 'campaign.json')) && !force) { console.error(`${saveDir} already holds a campaign (use --force to rebuild it)`); return 1; }
  const { campaign, maps, actors, ambient, ledger, problems } = buildSave(packDir, { id, title });
  for (const p of problems) console.error('PROBLEM', p);
  if (problems.length) return 1;
  if (force) for (const d of ['maps', 'actors']) fs.rmSync(path.join(saveDir, d), { recursive: true, force: true });
  write(path.join(saveDir, 'campaign.json'), campaign);
  for (const [m, tokens] of Object.entries(maps)) write(path.join(saveDir, 'maps', `${m}.json`), { $schema: '../../../schemas/map-state.schema.json', map: m, tokens, ...(ambient[m] ? { ambient: ambient[m] } : {}), ...(((readJson(path.join(packDir, 'adventure.json')).map_state) || {})[m] || {}) });
  if (ledger.length) write(path.join(saveDir, 'ledger.json'), { $schema: '../../schemas/ledger.schema.json', entries: ledger });
  for (const [tid, a] of Object.entries(actors)) write(path.join(saveDir, 'actors', `${tid}.json`), a);
  const n = Object.values(maps).reduce((k, t) => k + Object.keys(t).length, 0);
  console.log(`${saveDir}: ${n} tokens on ${Object.keys(maps).length} maps, ${Object.keys(actors).length} actors`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv);
