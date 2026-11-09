#!/usr/bin/env node
// Validate map records, wall segments and map state against the schemas and the rules in docs/design/maps.md.
//
// Usage:
//   node tools/validate.mjs <pack-dir | map-dir> [--save <save-dir>]
//
// A pack dir contains maps/<id>/map.json. A map dir contains map.json directly.
// With --save, every <save-dir>/maps/<id>.json is checked against the matching map.
// Exit code: 0 = no errors (warnings allowed), 1 = errors, 2 = usage problem.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { WALL_TYPES, SENSE, SENSES, DOOR_TYPES, onSnap } from '../engine/walls/presets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = path.join(ROOT, 'schemas');

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, useDefaults: false });
const schema = (name) => ajv.compile(JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, name), 'utf8')));
const V = {
  map: schema('map.schema.json'),
  walls: schema('walls.schema.json'),
  state: schema('map-state.schema.json'),
};

/** Collects findings for one file. */
class Report {
  constructor() { this.items = []; }
  error(file, msg) { this.items.push({ level: 'error', file, msg }); }
  warn(file, msg) { this.items.push({ level: 'warning', file, msg }); }
  get errors() { return this.items.filter((i) => i.level === 'error'); }
  get warnings() { return this.items.filter((i) => i.level === 'warning'); }
}

function readJson(file, report) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    report.error(file, e.code === 'ENOENT' ? 'file not found' : `cannot parse JSON: ${e.message}`);
    return null;
  }
}

function schemaErrors(validate, data, file, report) {
  if (validate(data)) return true;
  for (const e of validate.errors) {
    const where = e.instancePath || '(root)';
    const extra = e.params && e.params.allowedValues ? ` (${e.params.allowedValues.join(', ')})` : '';
    report.error(file, `${where}: ${e.message}${extra}`);
  }
  return false;
}

const inGrid = (p, grid) => p[0] >= 0 && p[1] >= 0 && p[0] <= grid.cols && p[1] <= grid.rows;
const cellInGrid = (c, grid) => c[0] < grid.cols && c[1] < grid.rows;
const fmt = (p) => `(${p[0]}, ${p[1]})`;

/**
 * Validate one map folder.
 * @returns {{map: object|null, doors: Map<string, object>, report: Report}}
 */
export function validateMapDir(dir, { knownMaps = null, report = new Report() } = {}) {
  const mapFile = path.join(dir, 'map.json');
  const map = readJson(mapFile, report);
  const doors = new Map();
  if (!map || !schemaErrors(V.map, map, mapFile, report)) return { map: null, doors, report };

  const { grid } = map;
  if (path.basename(dir) !== map.id) report.warn(mapFile, `map id "${map.id}" does not match its folder name "${path.basename(dir)}"`);
  if (!fs.existsSync(path.join(dir, map.image.file))) report.error(mapFile, `image file "${map.image.file}" not found`);

  const gridW = grid.origin_px[0] + grid.cols * grid.cell_px;
  const gridH = grid.origin_px[1] + grid.rows * grid.cell_px;
  if (gridW > map.image.w + grid.cell_px || gridH > map.image.h + grid.cell_px) {
    report.warn(mapFile, `grid (${grid.cols}x${grid.rows}) extends more than one cell past the image (${map.image.w}x${map.image.h} px)`);
  }

  // Links
  const linkIds = new Set();
  for (const [i, l] of (map.links || []).entries()) {
    const where = `links[${i}] "${l.id}"`;
    if (linkIds.has(l.id)) report.error(mapFile, `${where}: duplicate link id`);
    linkIds.add(l.id);
    l.at.forEach((c) => { if (!cellInGrid(c, grid)) report.error(mapFile, `${where}: cell ${fmt(c)} is outside the grid`); });
    if (l.to_map === map.id) report.warn(mapFile, `${where}: links to its own map`);
    if (knownMaps && !knownMaps.has(l.to_map)) report.error(mapFile, `${where}: target map "${l.to_map}" is not in this pack`);
  }

  // Walls
  const wallFiles = Array.isArray(map.walls) ? map.walls : [map.walls];
  const segIds = new Set();
  const edges = new Map();
  for (const wf of wallFiles) {
    const file = path.join(dir, wf);
    const walls = readJson(file, report);
    if (!walls || !schemaErrors(V.walls, walls, file, report)) continue;
    const size = fs.statSync(file).size;
    if (size > 200 * 1024) report.warn(file, `file is ${(size / 1024).toFixed(0)} KiB; split it to stay under 200 KiB`);

    for (const s of walls.segs) {
      const where = `segment ${s.id}`;
      if (segIds.has(s.id)) report.error(file, `${where}: duplicate segment id`);
      segIds.add(s.id);

      for (const p of [s.a, s.b]) {
        if (!onSnap(p[0]) || !onSnap(p[1])) report.error(file, `${where}: endpoint ${fmt(p)} is not on the 1/8 cell grid`);
        if (!inGrid(p, grid)) report.error(file, `${where}: endpoint ${fmt(p)} is outside the ${grid.cols}x${grid.rows} grid`);
      }
      if (s.a[0] === s.b[0] && s.a[1] === s.b[1]) report.error(file, `${where}: zero length`);

      const key = [fmt(s.a), fmt(s.b)].sort().join('-');
      if (edges.has(key)) report.warn(file, `${where}: same endpoints as segment ${edges.get(key)}`);
      else edges.set(key, s.id);

      // Proximity senses need a distance; distances without a proximity sense are unused.
      const base = WALL_TYPES[s.t];
      for (const sense of SENSES) {
        const val = s[sense] ?? base[sense];
        const prox = val === SENSE.PROXIMITY || val === SENSE.REVERSE_PROXIMITY;
        const dist = s.prox && s.prox[sense];
        if (prox && sense !== 'move' && !dist) report.error(file, `${where}: ${sense} uses proximity but prox.${sense} (feet) is missing`);
        if (!prox && dist) report.warn(file, `${where}: prox.${sense} is set but ${sense} is not a proximity sense`);
        if (sense !== 'move' && s[sense] !== undefined && s[sense] === base[sense]) {
          report.warn(file, `${where}: ${sense} override equals the "${s.t}" default`);
        }
      }

      if (DOOR_TYPES.includes(s.t)) {
        const d = s.door;
        if (doors.has(d.id)) report.error(file, `${where}: door id "${d.id}" is already used by segment ${doors.get(d.id).seg}`);
        doors.set(d.id, { seg: s.id, t: s.t, initial: d.initial || 'closed' });
        if (s.t === 'secret' && d.initial === 'open') report.warn(file, `${where}: a secret door that starts open is not secret`);
        if (s.t === 'secret' && d.dc === undefined && !d.auto_find) report.warn(file, `${where}: secret door has no dc to find it (set auto_find if it needs none)`);
      }
    }
  }
  if (segIds.size === 0) report.warn(mapFile, 'map has no wall segments');
  return { map, doors, report };
}

/** Validate one map-state file against its map. */
export function validateState(file, mapInfo, report = new Report()) {
  const st = readJson(file, report);
  if (!st || !schemaErrors(V.state, st, file, report)) return report;
  if (!mapInfo || !mapInfo.map) {
    report.error(file, `map "${st.map}" is not in the pack or did not validate`);
    return report;
  }
  const { map, doors } = mapInfo;
  const grid = map.grid;
  if (st.map !== map.id) report.error(file, `state is for map "${st.map}" but was checked against "${map.id}"`);

  for (const [id, d] of Object.entries(st.doors || {})) {
    const def = doors.get(id);
    if (!def) { report.error(file, `doors.${id}: no such door on map "${map.id}"`); continue; }
    if (d.found !== undefined && def.t !== 'secret') report.warn(file, `doors.${id}: "found" only applies to secret doors`);
    if (def.t === 'secret' && d.state === 'open' && !d.found) report.error(file, `doors.${id}: a secret door cannot be open before it is found`);
    if (d.state && d.state === def.initial && d.found === undefined) report.warn(file, `doors.${id}: state equals the initial state; the entry can be removed`);
  }
  for (const id of st.locked_known || []) {
    const def = doors.get(id);
    if (!def) report.error(file, `locked_known: no such door "${id}"`);
  }
  const linkIds = new Set((map.links || []).map((l) => l.id));
  for (const id of st.links_found || []) if (!linkIds.has(id)) report.error(file, `links_found: no such link "${id}"`);

  for (const [i, ring] of (st.explored ? st.explored.polys : []).entries()) {
    for (const p of ring) {
      if (!onSnap(p[0]) || !onSnap(p[1])) { report.error(file, `explored.polys[${i}]: point ${fmt(p)} is not on the 1/8 cell grid`); break; }
      if (!inGrid(p, grid)) { report.error(file, `explored.polys[${i}]: point ${fmt(p)} is outside the grid`); break; }
    }
  }
  for (const [id, t] of Object.entries(st.tokens || {})) {
    if (!cellInGrid([t.x, t.y], grid)) report.error(file, `tokens.${id}: cell (${t.x}, ${t.y}) is outside the grid`);
  }
  return report;
}

/** Validate a pack (or a single map) and optionally a save. */
export function validate(target, { save = null } = {}) {
  const report = new Report();
  const maps = new Map();
  if (fs.existsSync(path.join(target, 'map.json'))) {
    const info = validateMapDir(target, { report });
    if (info.map) maps.set(info.map.id, info);
  } else if (fs.existsSync(path.join(target, 'maps'))) {
    const mapsDir = path.join(target, 'maps');
    const dirs = fs.readdirSync(mapsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    if (!dirs.length) report.warn(mapsDir, 'no maps found');
    const known = new Set(dirs);
    for (const d of dirs) {
      const info = validateMapDir(path.join(mapsDir, d), { knownMaps: known, report });
      if (info.map) {
        if (maps.has(info.map.id)) report.error(path.join(mapsDir, d), `map id "${info.map.id}" is used twice`);
        maps.set(info.map.id, info);
      }
    }
  } else {
    report.error(target, 'not a pack (no maps/ folder) or a map folder (no map.json)');
  }

  if (save) {
    const dir = path.join(save, 'maps');
    if (!fs.existsSync(dir)) report.error(save, 'save has no maps/ folder');
    else {
      for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
        const file = path.join(dir, f);
        const id = path.basename(f, '.json');
        validateState(file, maps.get(id), report);
      }
    }
  }
  return report;
}

function main(argv) {
  const args = argv.slice(2);
  const si = args.indexOf('--save');
  let save = null;
  if (si >= 0) { save = args[si + 1]; args.splice(si, 2); }
  if (args.length !== 1 || (si >= 0 && !save)) {
    console.error('Usage: node tools/validate.mjs <pack-dir | map-dir> [--save <save-dir>]');
    return 2;
  }
  const report = validate(path.resolve(args[0]), { save: save && path.resolve(save) });
  for (const i of report.items) console.log(`${i.level.toUpperCase()}  ${path.relative(process.cwd(), i.file) || i.file}: ${i.msg}`);
  const e = report.errors.length, w = report.warnings.length;
  console.log(e ? `FAILED: ${e} error(s), ${w} warning(s)` : `OK: 0 errors, ${w} warning(s)`);
  return e ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv);
}
