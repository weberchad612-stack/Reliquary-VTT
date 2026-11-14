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
import { checkEvents, EVENT_STATE_FIELDS } from '../../engine/events/events.js';
import { checkSubsystem } from '../../engine/events/subsystem.js';
import { systemConfig } from '../../rulesets/systems.js';

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
        kind: e.friendly ? 'neutral' : 'foe', source: 'adventure',
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
      name: o.name, kind: 'object', source: 'adventure', type: slug(o.kind || 'object'), group: `objects-${slug(o.room || o.map)}`,
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
  const warnings = [];
  if (!adv.landing) warnings.push('no landing page: the campaign starts on a level (make one with tools/advimport/landing.py and name it in adventure.json "landing")');
  else {
    const lf = path.join(packDir, 'maps', adv.landing, 'map.json');
    if (!fs.existsSync(lf) || readJson(lf).kind !== 'landing') problems.push(`landing: "${adv.landing}" is not a landing page in the pack (tools/advimport/landing.py)`);
  }
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
  // the adventure's events (engine/events/events.js): each starts waiting
  const events = {};
  for (const ev of adv.events || []) {
    const { id: eid, ...def } = ev;
    if (ev.where && ev.where.map && !maps[ev.where.map]) problems.push(`event ${eid}: map "${ev.where.map}" is not in the adventure`);
    events[eid] = { ...def, status: 'waiting' };
  }
  for (const e of checkEvents(adv.events || [])) problems.push(`events: ${e}`);
  // subsystems (Victory Points, Influence, Chase, Infiltration, Research): built from the system's kinds
  const subsystems = {};
  const kinds = ((systemConfig(pack.ruleset) || {}).subsystems || {}).kinds || {};
  for (const s of adv.subsystems || []) {
    const { id: sid, kind, title: st, event, pages, note, shown, ...params } = s;
    if (!kinds[kind]) { problems.push(`subsystem ${sid}: the ${pack.ruleset} system has no kind "${kind}"`); continue; }
    const made = JSON.parse(JSON.stringify(kinds[kind].make(params)));
    subsystems[sid] = { title: st || kinds[kind].label, kind, ...(event ? { event } : {}), ...(pages ? { pages } : {}), ...(note ? { note } : {}), ...(shown ? { shown } : {}), status: 'waiting', ...made };
    for (const e of checkSubsystem(subsystems[sid], sid)) problems.push(`subsystem ${e}`);
  }
  return { campaign, maps, actors, ambient, ledger, events, subsystems, problems, warnings };
}

// Token fields the pack owns: refreshed on --update. Everything else on a token (where it stands, hidden, dead,
// effects, its name and alias, whether its name is known, its kind after a ruling) is play's and is kept.
const PACK_TOKEN_FIELDS = ['art', 'note', 'size', 'type', 'group', 'source'];
// Object fields play changes (the party takes things out): kept on --update when the save has them.
const PLAY_OBJECT_FIELDS = ['items', 'coins'];

/**
 * Refresh a campaign from its pack without losing play (docs/best-practices/adventure-importer.md, section 7):
 * the pack's own data (tokens' art and notes, creatures' stat blocks and the book's changes, objects' text, DCs, locks
 * and hazards) comes from the new build; play (where tokens are, hidden, dead, effects, names learned, door states,
 * explored areas, what was taken from objects, PCs and anything added in play, the table, the clock, the ledger's
 * own entries) stays. New creatures, objects, maps and ambient sounds are added. Creatures and objects no longer in
 * the adventure are kept and reported. Door states for doors no longer on a map are dropped and reported.
 * @returns {{campaign, maps: {id: state}, actors: {id: actor}, ledger: Array|null, report: string[], problems, warnings}}
 */
export function updateSave(packDir, saveDir, opts = {}) {
  const fresh = buildSave(packDir, opts);
  const report = [];
  if (fresh.problems.length) return { ...fresh, report };
  const old = readJson(path.join(saveDir, 'campaign.json'));
  const campaign = { ...old, title: old.title || fresh.campaign.title, pack: fresh.campaign.pack };
  if (fresh.campaign.music && !old.music) campaign.music = fresh.campaign.music;
  const adv = readJson(path.join(packDir, 'adventure.json'));
  // every token in the save, wherever play has moved it
  const states = {};
  const mapsDir = path.join(saveDir, 'maps');
  for (const f of fs.existsSync(mapsDir) ? fs.readdirSync(mapsDir).filter((x) => x.endsWith('.json')) : []) states[f.slice(0, -5)] = readJson(path.join(mapsDir, f));
  const where = {};
  for (const [m, st] of Object.entries(states)) for (const tid of Object.keys(st.tokens || {})) where[tid] = m;
  const packIds = new Set();
  for (const [m, tokens] of Object.entries(fresh.maps)) {
    if (!states[m]) {
      states[m] = { $schema: '../../../schemas/map-state.schema.json', map: m, tokens: {}, ...((adv.map_state || {})[m] || {}) };
      report.push(`map ${m}: new`);
    }
    for (const [tid, t] of Object.entries(tokens)) {
      packIds.add(tid);
      const at = where[tid];
      if (!at) { states[m].tokens[tid] = t; report.push(`${m}: new token ${t.name}`); continue; }
      const cur = states[at].tokens[tid];
      for (const k of PACK_TOKEN_FIELDS) { if (t[k] !== undefined) cur[k] = t[k]; else delete cur[k]; }
    }
    const amb = fresh.ambient[m] || {};
    const have = states[m].ambient || {};
    const add = Object.keys(amb).filter((k) => !have[k]);
    if (add.length) { states[m].ambient = { ...have, ...Object.fromEntries(add.map((k) => [k, amb[k]])) }; report.push(`${m}: ${add.length} new ambient sound(s)`); }
  }
  // tokens that came from an earlier build of the adventure but are no longer in it (an id made by stableId for this
  // pack): kept, since play may refer to them
  for (const [tid, m] of Object.entries(where)) {
    const t = states[m].tokens[tid];
    if (!packIds.has(tid) && t.source === 'adventure') report.push(`${m}: ${t.name} is no longer in the adventure (kept)`);
  }
  // door states for doors the walls no longer have
  for (const [m, st] of Object.entries(states)) {
    const wf = path.join(packDir, 'maps', m, 'walls.json');
    if (!st.doors || !fs.existsSync(wf)) continue;
    const ids = new Set(readJson(wf).segs.filter((x) => x.door).map((x) => x.door.id));
    for (const d of Object.keys(st.doors)) if (!ids.has(d)) { delete st.doors[d]; report.push(`${m}: door ${d} is no longer on the map (its state dropped)`); }
    if (st.locked_known) st.locked_known = st.locked_known.filter((d) => ids.has(d));
  }
  // game data: the pack's fields win; what play changed on an object stays
  const actors = {};
  for (const [tid, a] of Object.entries(fresh.actors)) {
    const f = path.join(saveDir, 'actors', `${tid}.json`);
    const was = fs.existsSync(f) ? readJson(f) : null;
    const next = { ...(was || {}), ...a };
    if (was && a.kind === 'object') for (const k of PLAY_OBJECT_FIELDS) { if (was[k] !== undefined) next[k] = was[k]; else if (k in was === false && a[k] === undefined) delete next[k]; }
    actors[tid] = next;
  }
  // the ledger: the adventure's entries that are not there yet
  let ledger = null;
  const lf = path.join(saveDir, 'ledger.json');
  const have = fs.existsSync(lf) ? readJson(lf) : { $schema: '../../schemas/ledger.schema.json', entries: [] };
  const sig = (e) => JSON.stringify([e.kind, e.title || '', e.text]);
  const known = new Set(have.entries.map(sig));
  const add = fresh.ledger.filter((e) => !known.has(sig(e)));
  if (add.length) { ledger = { ...have, entries: [...have.entries, ...add] }; report.push(`ledger: ${add.length} new adventure entr${add.length === 1 ? 'y' : 'ies'}`); }
  // events: the pack's definitions are refreshed, their state in play is kept; the flags stay
  let events = null;
  const ef = path.join(saveDir, 'events.json');
  const hadEvents = fs.existsSync(ef) ? readJson(ef) : null;
  if (Object.keys(fresh.events).length || Object.keys(fresh.subsystems).length || hadEvents) {
    const was = (hadEvents && hadEvents.events) || {};
    const next = {};
    for (const [eid, def] of Object.entries(fresh.events)) {
      const keep = Object.fromEntries(EVENT_STATE_FIELDS.filter((k) => was[eid] && was[eid][k] !== undefined).map((k) => [k, was[eid][k]]));
      next[eid] = { ...def, ...keep };
      if (!was[eid]) report.push(`event ${eid}: new`);
    }
    for (const [eid, e] of Object.entries(was)) if (!next[eid]) { next[eid] = e; report.push(`event ${eid} is no longer in the adventure (kept)`); }
    // subsystems: one already in play is kept as it is (its points, reveals and log are play's); new ones are added
    const hadSubs = (hadEvents && hadEvents.subsystems) || {};
    const subs = { ...hadSubs };
    for (const [sid, s] of Object.entries(fresh.subsystems)) if (!hadSubs[sid]) { subs[sid] = s; report.push(`subsystem ${sid}: new`); }
    events = { $schema: '../../schemas/events.schema.json', events: next, ...(hadEvents && hadEvents.flags ? { flags: hadEvents.flags } : {}), ...(Object.keys(subs).length ? { subsystems: subs } : {}) };
  }
  return { campaign, maps: states, actors, ledger, events, report, problems: [], warnings: fresh.warnings };
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const force = args.includes('--force'); if (force) args.splice(args.indexOf('--force'), 1);
  const update = args.includes('--update'); if (update) args.splice(args.indexOf('--update'), 1);
  const id = opt('--id'), title = opt('--title');
  const [packDir, saveDir] = args;
  if (!packDir || !saveDir) { console.error('usage: node tools/advimport/campaign.mjs <pack-dir> <save-dir> [--id ID] [--title TITLE] [--update | --force]'); return 2; }
  const exists = fs.existsSync(path.join(saveDir, 'campaign.json'));
  if (exists && update) {
    const u = updateSave(packDir, saveDir, { id, title });
    for (const w of u.warnings) console.error('WARNING', w);
    for (const p of u.problems) console.error('PROBLEM', p);
    if (u.problems.length) return 1;
    write(path.join(saveDir, 'campaign.json'), u.campaign);
    for (const [m, st] of Object.entries(u.maps)) write(path.join(saveDir, 'maps', `${m}.json`), st);
    for (const [tid, a] of Object.entries(u.actors)) write(path.join(saveDir, 'actors', `${tid}.json`), a);
    if (u.ledger) write(path.join(saveDir, 'ledger.json'), u.ledger);
    if (u.events) write(path.join(saveDir, 'events.json'), u.events);
    for (const r of u.report) console.log(' ', r);
    console.log(`${saveDir}: updated from the pack, play kept (${u.report.length} change${u.report.length === 1 ? '' : 's'} besides refreshed art, notes and stat blocks)`);
    return 0;
  }
  if (exists && !force) { console.error(`${saveDir} already holds a campaign (use --update to refresh it from the pack and keep play, or --force to start over)`); return 1; }
  const { campaign, maps, actors, ambient, ledger, events, subsystems, problems, warnings } = buildSave(packDir, { id, title });
  for (const w of warnings) console.error('WARNING', w);
  for (const p of problems) console.error('PROBLEM', p);
  if (problems.length) return 1;
  if (force) for (const d of ['maps', 'actors']) fs.rmSync(path.join(saveDir, d), { recursive: true, force: true });
  write(path.join(saveDir, 'campaign.json'), campaign);
  for (const [m, tokens] of Object.entries(maps)) write(path.join(saveDir, 'maps', `${m}.json`), { $schema: '../../../schemas/map-state.schema.json', map: m, tokens, ...(ambient[m] ? { ambient: ambient[m] } : {}), ...(((readJson(path.join(packDir, 'adventure.json')).map_state) || {})[m] || {}) });
  if (ledger.length) write(path.join(saveDir, 'ledger.json'), { $schema: '../../schemas/ledger.schema.json', entries: ledger });
  for (const [tid, a] of Object.entries(actors)) write(path.join(saveDir, 'actors', `${tid}.json`), a);
  if (Object.keys(events).length || Object.keys(subsystems).length) write(path.join(saveDir, 'events.json'), { $schema: '../../schemas/events.schema.json', events, ...(Object.keys(subsystems).length ? { subsystems } : {}) });
  else if (force) fs.rmSync(path.join(saveDir, 'events.json'), { force: true });
  const n = Object.values(maps).reduce((k, t) => k + Object.keys(t).length, 0);
  console.log(`${saveDir}: ${n} tokens on ${Object.keys(maps).length} maps, ${Object.keys(actors).length} actors`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv);
