#!/usr/bin/env node
// Campaigns on disk <-> the board's database records (docs/design/board.md; record layout in board/records.js).
//
// Usage:
//   node tools/campaign.mjs records <pack-dir> <save-dir> [--out FILE]
//       The campaign as records ({records, images}): what Claude writes into the board's database when
//       loading a campaign. Each map image is listed with its file and fingerprint; its record carries the
//       fingerprint, and the asset id once Claude has uploaded the file ("asset": null until then).
//   node tools/campaign.mjs seed <pack-dir> <save-dir> [--out FILE]
//       The same, with the images inlined (data URLs), for a board running on memory (the demo, tests).
//   node tools/campaign.mjs save <records-file> <save-dir>
//       Write the save (campaign.json, maps/<id>.json) from records read out of the board's database.
//       The previous save is first copied to <save-dir>/backups/<time>/ (the last BACKUPS are kept).
//   node tools/campaign.mjs check <pack-dir> <save-dir>
//       Round trip: save -> records -> save, and report any difference (exit code 1 if there is one).
//
// For loading, saving and switching on the published board (docs/best-practices/board.md):
//   node tools/campaign.mjs ops-load <pack-dir> <save-dir> --assets ASSETS.json [--out FILE]
//       The db_write batches that load the campaign: {batches: [[op...]...], meta: op, upload: [images]}.
//       ASSETS.json is the board's asset list ({assets: [{opaque_id, sha256}]}); a map image whose
//       fingerprint is already uploaded reuses that asset, any other is listed under "upload".
//       Write the batches in order, then `meta` last (the board reloads when board/meta changes).
//   node tools/campaign.mjs ops-clear <LISTING.json> [--out FILE]
//       Delete ops (batches of 50) for every record in a listing {path: version} of the whole database.
//   node tools/campaign.mjs verify <records-file> <pack-dir> <save-dir>
//       Compare a save on disk with records read from the board's database (the save's own records:
//       board/meta, state, mapstate, tokens, explored, templates, notes). Exit code 1 and the differences if any.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { campaignRecords, saveFromRecords } from '../board/records.js';

export const BACKUPS = 5;
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

/** Read a pack and a save from disk into what campaignRecords() takes, plus the map images. */
export function readCampaign(packDir, saveDir) {
  const pack = readJson(path.join(packDir, 'pack.json'));
  const campaign = readJson(path.join(saveDir, 'campaign.json'));
  const images = [];
  const maps = pack.maps.map((id) => {
    const dir = path.join(packDir, 'maps', id);
    const map = readJson(path.join(dir, 'map.json'));
    const wallFiles = !map.walls ? [] : Array.isArray(map.walls) ? map.walls : [map.walls];   // an area map has none
    const segs = wallFiles.flatMap((f) => readJson(path.join(dir, f)).segs);
    const terrain = map.terrain ? readJson(path.join(dir, map.terrain)).areas : [];
    const lighting = map.lighting ? readJson(path.join(dir, map.lighting)) : null;
    const file = path.join(dir, map.image.file);
    const bytes = fs.readFileSync(file);
    const fingerprint = crypto.createHash('sha256').update(bytes).digest('hex');
    images.push({ map: id, file, fingerprint, bytes: bytes.length, type: MIME[path.extname(file).slice(1).toLowerCase()] });
    const { $schema, ...rest } = map;
    return { id, map: rest, segs, terrain, lighting, image: { fingerprint, asset: null } };
  });
  const mapStates = {};
  const statesDir = path.join(saveDir, 'maps');
  if (fs.existsSync(statesDir)) {
    for (const f of fs.readdirSync(statesDir).filter((n) => n.endsWith('.json'))) {
      const { $schema, ...st } = readJson(path.join(statesDir, f));
      mapStates[path.basename(f, '.json')] = st;
    }
  }
  const { $schema, ...camp } = campaign;
  return { campaign: camp, pack, maps, mapStates, images };
}

/** The campaign as records, with its images listed (or inlined as data URLs with `inline`). */
export function buildRecords(packDir, saveDir, { inline = false, now } = {}) {
  const c = readCampaign(packDir, saveDir);
  if (inline) for (const m of c.maps) m.image.asset = 'fp-' + m.image.fingerprint.slice(0, 16);
  const records = campaignRecords({ ...c, now });
  const out = { records, images: c.images.map(({ map, file, fingerprint, bytes, type }) => ({ map, file: path.relative(process.cwd(), file), fingerprint, bytes, type })) };
  if (inline) {
    out.assets = {};
    for (const img of c.images) out.assets['fp-' + img.fingerprint.slice(0, 16)] = `data:${img.type};base64,${fs.readFileSync(img.file).toString('base64')}`;
  }
  return out;
}

/** Write a save from records, keeping a dated copy of the previous one. Returns the files written. */
export function writeSave(records, saveDir, { now = new Date() } = {}) {
  const campFile = path.join(saveDir, 'campaign.json');
  const base = fs.existsSync(campFile) ? readJson(campFile) : {};
  if (fs.existsSync(campFile)) backup(saveDir, now);
  const { campaign, mapStates } = saveFromRecords(records, base);
  campaign.saved_at = now.toISOString();
  const written = [];
  const write = (f, obj) => {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(obj, null, 2) + '\n');
    written.push(f);
  };
  write(campFile, { $schema: base.$schema || '../../../schemas/campaign.schema.json', v: 1, ...campaign });
  for (const [id, st] of Object.entries(mapStates)) {
    const f = path.join(saveDir, 'maps', id + '.json');
    const prev = fs.existsSync(f) ? readJson(f) : {};
    write(f, { $schema: prev.$schema || '../../../../schemas/map-state.schema.json', ...st });
  }
  return written;
}

function backup(saveDir, now) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const dest = path.join(saveDir, 'backups', stamp);
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(saveDir, 'campaign.json'), path.join(dest, 'campaign.json'));
  if (fs.existsSync(path.join(saveDir, 'maps'))) fs.cpSync(path.join(saveDir, 'maps'), path.join(dest, 'maps'), { recursive: true });
  const all = fs.readdirSync(path.join(saveDir, 'backups')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - BACKUPS))) fs.rmSync(path.join(saveDir, 'backups', old), { recursive: true, force: true });
}

/** Differences between two JSON values, as "path: a != b" lines (order of object keys ignored). */
export function diff(a, b, at = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => diff(a[k], b[k], at ? `${at}.${k}` : k));
  }
  return [`${at || '(root)'}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`];
}

/** Save -> records -> save; the differences (none means a clean round trip). */
export function roundTrip(packDir, saveDir) {
  const c = readCampaign(packDir, saveDir);
  const back = saveFromRecords(campaignRecords({ ...c, now: 'x' }), c.campaign);
  const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === '$schema' ? undefined : v)));
  const out = diff(strip(c.campaign), strip(back.campaign));
  for (const id of new Set([...Object.keys(c.mapStates), ...Object.keys(back.mapStates)])) {
    out.push(...diff({ map: id, ...strip(c.mapStates[id] || {}) }, strip(back.mapStates[id] || {}), `maps/${id}`));
  }
  return out;
}

export const SAVE_COLLECTIONS = ['board', 'state', 'mapstate', 'tokens', 'explored', 'templates', 'notes'];
const BATCH = 50;
const batches = (ops) => { const out = []; for (let i = 0; i < ops.length; i += BATCH) out.push(ops.slice(i, i + BATCH)); return out; };

/** db_write batches loading a campaign; images matched to uploaded assets by SHA-256. */
export function loadOps(packDir, saveDir, assets = [], { now } = {}) {
  const bySha = new Map(assets.map((a) => [a.sha256, a.opaque_id]));
  const { records, images } = buildRecords(packDir, saveDir, { now });
  const upload = [];
  for (const [p, d] of Object.entries(records)) {
    if (!p.startsWith('maps/')) continue;
    const id = bySha.get(d.image.fingerprint);
    if (id) d.image.asset = id;
    else upload.push(images.find((i) => i.fingerprint === d.image.fingerprint));
  }
  const ops = Object.entries(records).filter(([p]) => p !== 'board/meta').map(([path, data]) => ({ op: 'set', path, data }));
  return { batches: batches(ops), meta: { op: 'set', path: 'board/meta', data: records['board/meta'] }, upload };
}

/** Delete ops for a whole-database listing {path: version}. */
export function clearOps(listing) {
  return batches(Object.entries(listing).map(([path, ifVersion]) => ({ op: 'delete', path, ifVersion })));
}

/** Differences between a save on disk and the save's records read from the board (empty: they match). */
export function verifySave(records, packDir, saveDir) {
  const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === '$schema' || k === 'saved_at' ? undefined : v)));
  const fromDb = saveFromRecords(records);
  const disk = readCampaign(packDir, saveDir);
  const out = diff(strip({ v: 1, ...fromDb.campaign }), strip({ v: 1, ...disk.campaign }), 'campaign');
  const ids = new Set([...Object.keys(fromDb.mapStates), ...Object.keys(disk.mapStates)]);
  for (const id of ids) out.push(...diff(strip(fromDb.mapStates[id] || {}), strip({ map: id, ...(disk.mapStates[id] || {}) }), `maps/${id}`));
  return out;
}

function main(argv) {
  const args = argv.slice(2);
  const oi = args.indexOf('--out');
  let out = null;
  if (oi >= 0) { out = args[oi + 1]; args.splice(oi, 2); }
  const ai = args.indexOf('--assets');
  let assetsFile = null;
  if (ai >= 0) { assetsFile = args[ai + 1]; args.splice(ai, 2); }
  const [cmd, a, b, c] = args;
  const emit = (obj) => {
    const text = JSON.stringify(obj);
    if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, text); console.log(`wrote ${out} (${(text.length / 1024).toFixed(0)} KiB)`); } else console.log(text);
  };
  if ((cmd === 'records' || cmd === 'seed') && a && b) { emit(buildRecords(a, b, { inline: cmd === 'seed' })); return 0; }
  if (cmd === 'save' && a && b) {
    const data = readJson(a);
    const files = writeSave(data.records || data, b);
    console.log(`wrote ${files.length} file(s) to ${b}`);
    return 0;
  }
  if (cmd === 'ops-load' && a && b) {
    const assets = assetsFile ? (readJson(assetsFile).assets || readJson(assetsFile)) : [];
    emit(loadOps(a, b, assets));
    return 0;
  }
  if (cmd === 'ops-clear' && a) { emit({ batches: clearOps(readJson(a)) }); return 0; }
  if (cmd === 'verify' && a && b && c) {
    const data = readJson(a);
    const d = verifySave(data.records || data, b, c);
    if (d.length) { console.log(d.join('\n')); return 1; }
    console.log('save matches the board');
    return 0;
  }
  if (cmd === 'check' && a && b) {
    const d = roundTrip(a, b);
    if (d.length) { console.log(d.join('\n')); return 1; }
    console.log('round trip OK');
    return 0;
  }
  console.error('Usage: node tools/campaign.mjs records|seed <pack-dir> <save-dir> [--out FILE]\n       node tools/campaign.mjs save <records-file> <save-dir>\n       node tools/campaign.mjs check <pack-dir> <save-dir>' +
    '\n       node tools/campaign.mjs ops-load <pack-dir> <save-dir> --assets ASSETS.json [--out FILE]' +
    '\n       node tools/campaign.mjs ops-clear <listing.json> [--out FILE]' +
    '\n       node tools/campaign.mjs verify <records-file> <pack-dir> <save-dir>');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv);
}
