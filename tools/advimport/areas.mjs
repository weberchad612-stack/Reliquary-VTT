#!/usr/bin/env node
// The area checklist (#14) and proposals from the text (#15), for the adventure importer
// (docs/best-practices/adventure-importer.md, section 2): every keyed area of the book, what its text asks for
// (each check and DC, creatures with stat blocks, doors that are locked, stuck, barred or secret, light, terrain,
// treasure), and whether the pack accounts for it: the notes, adventure.json, the walls, the room table, lighting
// and terrain. What is missing is listed with its page; for doors, light and terrain the tool also proposes the
// settings to add (in import.json's own formats), for Claude to check against the text before using.
//
// Usage:
//   node tools/advimport/areas.mjs <pack-dir> <text-dir> --pages 4-35 [--skip REGEX] [--json] [--proposals <file>] [--area A4]
//
// --skip: the book's running heads and footers (lines to ignore). <pack>/checklist.json lists what Claude has checked
// and explained: {"explained": [{"area": "A13", "match": "dim light", "why": "the plaques glow only once solved"}]}.
// An area covers its sub-areas (B2: B2a to B2d) and Claude's own room splits (A4-east).
//
// Areas start at a title-case heading line "A4. The South Hallway" (the book's area titles); an all-caps caption
// ("A4. THE SOUTH HALLWAY", a map crop's label) does not start one, since crops sit inside other areas' text; with
// --caps-headings (a book that prints its area headings in capitals and has no room crops) it does.
// Rooms whose key is not a book key (Claude's names for the rooms of a map with no keyed areas, "farmhouse-kitchen")
// are not looked for in the text. What
// counts as a fact is the game system's: rulesets/<ruleset>/bookimport.js `areaFacts` (and `parseBlocks` for stat
// blocks). Nothing from the book is written anywhere but the run's output.

import { readAdventure } from './campaign.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { systemReader, nameVariants } from './statmatch.mjs';

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const HEADING = /^\s*([A-Z]{1,2}\d{1,2}[a-z]?)[.:]\s+(\S.{0,80})$/;
const PAGE_REF = /\((pages?|pp?\.?)\s*\d/i;   // "A9. Hag Grotto (page 14-15)": a list of areas, not the area

/** The book's text split by area: {key: {key, title, pages: [n], text}}, in the book's order. */
export function splitAreas(pages, { skip = null, caps = false } = {}) {
  const areas = {};
  let cur = null;
  for (const { page, text } of pages) {
    for (const line of text.split('\n')) {
      if (skip && skip.test(line.trim())) continue;
      const m = HEADING.exec(line);
      if (m && PAGE_REF.test(m[2])) { cur = null; continue; }
      if (m && (caps || /[a-z]/.test(m[2])) && !/\s{3,}/.test(m[2])) {
        cur = areas[m[1]] = areas[m[1]] || { key: m[1], title: m[2].trim(), pages: [], text: '' };
      }
      if (!cur) continue;
      if (!cur.pages.includes(page)) cur.pages.push(page);
      cur.text += line + '\n';
    }
  }
  return areas;
}

/** The pack as the checks see it, keyed by area. */
export function packIndex(packDir) {
  const pack = readJson(path.join(packDir, 'pack.json'));
  const adv = fs.existsSync(path.join(packDir, 'adventure.json')) ? readAdventure(packDir) : {};
  const idx = { rooms: {}, notes: {}, encounters: {}, objects: {}, doors: {}, light: {}, lights: {}, terrain: {}, base: {}, mapLights: {}, fpc: {} };
  for (const m of pack.maps || []) {
    const dir = path.join(packDir, 'maps', m);
    const rf = path.join(dir, 'rooms.json');
    if (!fs.existsSync(rf)) continue;
    const map = readJson(path.join(dir, 'map.json'));
    idx.base[m] = map.base_light || 'bright';
    idx.fpc[m] = (map.grid && map.grid.feet_per_cell) || 5;
    const rooms = readJson(rf).rooms || {};
    const segs = fs.existsSync(path.join(dir, 'walls.json')) ? readJson(path.join(dir, 'walls.json')).segs : [];
    const lighting = fs.existsSync(path.join(dir, 'lighting.json')) ? readJson(path.join(dir, 'lighting.json')) : {};
    const terrain = fs.existsSync(path.join(dir, 'terrain.json')) ? readJson(path.join(dir, 'terrain.json')).areas : [];
    idx.mapLights[m] = lighting.lights || [];
    for (const [key, r] of Object.entries(rooms)) {
      idx.rooms[key] = { map: m, ...r };
      const near = (p) => r.rects.some(([x, y, w, h]) => p[0] >= x - 0.5 && p[0] <= x + w + 0.5 && p[1] >= y - 0.5 && p[1] <= y + h + 0.5);
      idx.doors[key] = segs.filter((s) => s.door && near([(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]));
      idx.light[key] = (lighting.regions || []).filter((x) => x.room === key);
      idx.lights[key] = (lighting.lights || []).filter((x) => x.room === key);
      idx.terrain[key] = terrain.filter((x) => x.room === key);
    }
  }
  const notesDir = path.join(packDir, 'notes');
  for (const f of fs.existsSync(notesDir) ? fs.readdirSync(notesDir).filter((x) => x.endsWith('.md')) : []) {
    const parts = fs.readFileSync(path.join(notesDir, f), 'utf8').split(/^(?=#{2,3} )/m);
    for (const p of parts) { const m = /^#{2,3} ([A-Z]{1,2}\d{1,2})\b/.exec(p); if (m) idx.notes[m[1]] = (idx.notes[m[1]] || '') + p; }
    // an area named inside another's heading ("## B6 & B7") counts for both
    for (const p of parts) for (const m of (/^#{2,3} (.*)$/m.exec(p) || ['', ''])[1].matchAll(/\b([A-Z]\d{1,2})\b/g)) idx.notes[m[1]] = idx.notes[m[1]] || p;
  }
  for (const e of adv.encounters || []) (idx.encounters[e.room] = idx.encounters[e.room] || []).push(e);
  for (const o of adv.objects || []) (idx.objects[o.room] = idx.objects[o.room] || []).push(o);
  idx.events = {};
  for (const ev of adv.events || []) for (const a of [].concat((ev.where && ev.where.area) || [], ev.areas || [])) (idx.events[a] = idx.events[a] || []).push(ev);
  return { pack, idx };
}

const e2s = (s) => s.split(',')[0];
const LEVEL = { dark: ['dark', 'darkness'], dim: ['dim'], bright: ['bright'] };

/** The room-table keys an area covers: itself, its sub-areas (B2: B2a to B2d) and Claude's own splits (A4-east). */
export function roomKeys(key, idx) {
  return Object.keys(idx.rooms).filter((r) => r === key || new RegExp(`^${key}([a-z]|-.+)$`).test(r));
}

/** Check one area's facts against the pack: {done: [...], missing: [...], proposals: [...]}. */
export function checkArea(area, facts, blocks, idx, explained = []) {
  const k = area.key, done = [], missing = [], proposals = [];
  const keys = roomKeys(k, idx);
  const cat = (o) => keys.flatMap((x) => o[x] || []);
  const rects = keys.flatMap((x) => idx.rooms[x].rects);
  const room = keys.length ? { ...idx.rooms[keys[0]], rects } : null;
  const parent = (/^([A-Z]{1,2}\d{1,2})[a-z]$/.exec(k) || [])[1];   // B2d: the notes and encounters of B2 cover it
  const family = parent ? roomKeys(parent, idx).concat(parent) : [];
  const notes = idx.notes[k] || keys.map((x) => idx.notes[x] || '').join('\n') || (parent ? idx.notes[parent] || '' : ''), objs = [...(idx.objects[k] || []), ...cat(idx.objects).filter((o) => o.room !== k)];
  const encs = [...new Set([...(idx.encounters[k] || []), ...keys.filter((x) => x !== k).flatMap((x) => idx.encounters[x] || []), ...family.flatMap((x) => idx.encounters[x] || [])])], doors = cat(idx.doors);
  const L = { light: cat(idx.light), lights: cat(idx.lights), terrain: cat(idx.terrain) };
  const where = `p${area.pages.join(',')}`;
  const miss = (what, f, proposal) => {
    const why = explained.find((e) => e.area === k && what.includes(e.match));
    if (why) { done.push(`${e2s(what)} (explained: ${why.why})`); return; }
    missing.push({ area: k, what, where, at: f && f.at });
    if (proposal) proposals.push({ area: k, map: room && room.map, ...proposal });
  };
  if (!room) miss('not in any map\'s room table (rooms.json)');   // explainable: an area on a town or region map
  if (!notes) miss('no section in the notes');
  const json = JSON.stringify({ objs, encs, doors });
  for (const f of facts) {
    if (f.kind === 'dc') {
      const re = new RegExp(`DC ?${f.dc}\\b`);
      if (re.test(notes) || re.test(json) || json.includes(`"dc":${f.dc}`) || json.includes(`"find_dc":${f.dc}`) || json.includes(`"stuck_dc":${f.dc}`)) done.push(`DC ${f.dc}`);
      else miss(`DC ${f.dc}${f.what ? ' ' + f.what : ''} is in neither the notes nor the pack`, f);
    } else if (f.kind === 'door') {
      const has = { locked: (d) => (d.door.initial === 'locked'), stuck: (d) => d.stuck_dc !== undefined || d.door.stuck_dc !== undefined, secret: (d) => d.t === 'secret', blocked: (d) => !!(d.blocked || d.door.blocked) }[f.what];
      if (doors.some(has) || (f.what === 'locked' && /lock/i.test(notes) && !doors.length)) done.push(`${f.what} door`);
      else {
        const d = doors[0];
        const set = { locked: { initial: 'locked' }, stuck: { stuck_dc: 'DC from the text' }, blocked: { blocked: 'what blocks it, from the text' }, secret: null }[f.what];
        miss(`a ${f.what} door, and no door in the room is${f.what === 'secret' ? ' a secret door' : ' set that way'}`, f,
          set && d ? { section: 'doors', entry: { near: [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2], ...set, note: `${k} (${where}): ${f.what} in the text` } }
            : f.what === 'secret' ? { section: 'add', entry: { t: 'secret', a: '[x, y]', b: '[x, y]', door: { id: `s-${k.toLowerCase()}`, label: `Secret door (${k})`, dc: 'DC from the text' }, note: `${k} (${where}): place it from the book's labelled map (an S)` } } : null);
      }
    } else if (f.kind === 'lock') {
      if (objs.some((o) => o.locked) || doors.some((d) => d.door.initial === 'locked') || /lock/i.test(notes)) done.push('lock');
      else miss('something locked, and nothing in the room is', f);
    } else if (f.kind === 'light' && f.level) {
      // regions in the room, and any light whose radius reaches one of its squares (light from next door counts;
      // distance only, walls are not traced: a check for Claude, not the board's lighting)
      const reach = room ? (idx.mapLights[room.map] || []).filter((l) => l.at && rects.some(([x, y, w, h]) => {
        const dx = Math.max(x - l.at[0], 0, l.at[0] - (x + w)), dy = Math.max(y - l.at[1], 0, l.at[1] - (y + h));
        return Math.hypot(dx, dy) * idx.fpc[room.map] <= (l.bright || 0) + (l.dim || 0);
      })) : [];
      const levels = [...L.light.map((r) => r.level), ...reach.map((l) => ((l.bright || 0) > 0 ? 'bright' : 'dim')), ...(reach.some((l) => (l.dim || 0) > 0) ? ['dim'] : [])];
      const base = room ? idx.base[room.map] : null;
      const now = levels.length ? levels : [base];
      if (now.some((l) => LEVEL[f.level].includes(l))) done.push(`${f.level} light`);
      else miss(`${f.level} light in the text; the room is ${now.join('/')}`, f, room ? { section: 'lighting.regions', entry: { id: `${k.toLowerCase()}-${f.level}`, level: f.level === 'dark' ? 'darkness' : f.level, room: k, select: [{ rects: room.rects }], note: `${k} (${where}): ${f.level} in the text` } } : null);
    } else if (f.kind === 'light' && f.source) {
      if (L.lights.length || L.light.length) done.push('light source');
      else miss('a light source in the text, and no light or lit region in the room', f, room ? { section: 'lighting.lights', entry: { id: `${k.toLowerCase()}-light`, at: room.at, preset: 'torch', room: k, note: `${k} (${where}): place it on the source the text names` } } : null);
    } else if (f.kind === 'terrain') {
      const t = L.terrain;
      if (t.length) done.push(`${f.what} terrain`);
      else miss(`${f.what} terrain in the text, and no terrain area in the room`, f, room ? { section: 'terrain.areas', entry: { id: `${f.what}-${k.toLowerCase()}`, kind: f.what === 'swim' ? 'swim' : f.what, room: k, select: [{ rects: room.rects }], note: `${k} (${where}): ${f.what} in the text; narrow it to the squares the text means` } } : null);
    } else if (f.kind === 'event') {
      // an event in the text: one in adventure.json for this area (or its parent), else the notes say why none
      const evs = [...new Set([k, ...keys, ...family].flatMap((x) => (idx.events || {})[x] || []))];
      if (evs.length) done.push(`event (${evs.map((e) => e.id).join(', ')})`);
      else miss(`a ${f.what} event in the text, and no event in adventure.json for the area`, f, { section: 'events', entry: { id: `${k.toLowerCase()}-${f.what}`, title: 'name it', pages: area.pages.join(','), where: { map: room && room.map, area: k }, trigger: { area: k }, stages: [{ id: 'start', actions: [{ do: 'narrate', text: 'paraphrase' }] }], note: `${k} (${where}): ${f.what} in the text: "${(f.at || '').slice(0, 60)}"` } });
    } else if (f.kind === 'nodc') {
      // a check with no DC in the book (the user's rule, adventure-importer.md section 11): the notes give the
      // level-based DC, dcfill.mjs filled it in the pack, or checklist.json says why none is needed (an opposed check)
      if (/book gives none|level-based DC/i.test(notes) || /book gives none/.test(json)) done.push(`${f.what} check (level-based DC)`);
      else miss(`a ${f.what} check with no DC in the text; give it the level-based DC for the party's level (notes) or explain`, f);
    } else if (f.kind === 'treasure') {
      if (objs.some((o) => (o.items && o.items.length) || o.coins) || /treasure|loot/i.test(notes)) done.push('treasure');
      else miss('treasure in the text, and no object holds any', f);
    }
  }
  for (const b of blocks) {
    const names = nameVariants(b.head);
    const hit = encs.some((e) => e.creatures.some((c) => nameVariants(c.name).some((n) => names.includes(n)) || (c.ref && names.some((n) => c.ref.includes(n.replace(/ /g, '-'))))));
    if (hit) done.push(b.name);
    else miss(`stat block ${b.head}, and no creature by that name in ${k}'s encounters`, { at: b.head });
  }
  return { done, missing, proposals };
}

async function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const json = args.includes('--json'); if (json) args.splice(args.indexOf('--json'), 1);
  const pages = opt('--pages'), propFile = opt('--proposals'), only = opt('--area');
  const skipArg = opt('--skip'); const skip = skipArg ? new RegExp(skipArg) : null;
  const caps = args.includes('--caps-headings'); if (caps) args.splice(args.indexOf('--caps-headings'), 1);
  const [packDir, textDir] = args;
  if (!packDir || !textDir) { console.error('usage: node tools/advimport/areas.mjs <pack-dir> <text-dir> --pages A-B [--json] [--proposals <file>] [--area KEY] [--caps-headings]'); return 2; }
  const { pack, idx } = packIndex(packDir);
  const sys = await systemReader(pack.ruleset);
  if (!sys.areaFacts) { console.error(`the ${pack.ruleset} ruleset has no areaFacts (rulesets/${pack.ruleset}/bookimport.js)`); return 1; }
  let files = fs.readdirSync(textDir).filter((f) => /^p\d+\.txt$/.test(f)).sort();
  if (pages) { const [a, b] = pages.split('-').map(Number); files = files.filter((f) => { const n = Number(f.slice(1, -4)); return n >= a && n <= (b || a); }); }
  const areas = splitAreas(files.map((f) => ({ page: Number(f.slice(1, -4)), text: fs.readFileSync(path.join(textDir, f), 'utf8') })), { skip, caps });
  const ef = path.join(packDir, 'checklist.json');
  const explained = fs.existsSync(ef) ? readJson(ef).explained || [] : [];
  const results = [];
  for (const a of Object.values(areas)) {
    if (only && a.key !== only) continue;
    results.push({ key: a.key, title: a.title, pages: a.pages, ...checkArea(a, sys.areaFacts(a.text), sys.parseBlocks(a.text, a.pages[0], { skip }), idx, explained) });
  }
  const covered = new Set(Object.keys(areas).flatMap((k) => roomKeys(k, idx)));
  const bookKey = (k) => /^[A-Z]{1,2}\d{1,2}[a-z]?(-.+)?$/.test(k);
  for (const k of Object.keys(idx.rooms)) if (!covered.has(k) && !only && bookKey(k)) results.push({ key: k, title: idx.rooms[k].title, pages: [], done: [], missing: [{ area: k, what: 'in the room table but no area of that key in the text read', where: '' }], proposals: [] });
  if (propFile) fs.writeFileSync(propFile, JSON.stringify(results.flatMap((r) => r.proposals), null, 1) + '\n');
  if (json) { console.log(JSON.stringify(results, null, 1)); return 0; }
  let nMiss = 0;
  for (const r of results) {
    nMiss += r.missing.length;
    console.log(`${r.missing.length ? '✗' : '✓'} ${r.key.padEnd(4)} ${String(r.title || '').slice(0, 30).padEnd(30)} p${r.pages.join(',').padEnd(8)} ${r.done.length} ok${r.missing.length ? `, ${r.missing.length} to check` : ''}`);
    for (const m of r.missing) console.log(`      - ${m.what}${m.at ? `  [${m.at}]` : ''}`);
  }
  const nProp = results.reduce((n, r) => n + r.proposals.length, 0);
  console.log(`\n${results.length} areas, ${nMiss} item(s) to check${nProp ? `, ${nProp} proposal(s)${propFile ? ' in ' + propFile : ' (--proposals <file>)'}` : ''}`);
  return 0;
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1])).href) main(process.argv).then((c) => { process.exitCode = c; });
