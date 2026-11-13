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
import { LIGHT_PRESETS } from '../rulesets/pf2e/light.js';
import { systemConfig } from '../rulesets/systems.js';
import { checkLibrary } from '../engine/fx/fx.js';
import { nameProblems } from '../board/names.js';
import { prepareActor, BASE_RULE_KEYS } from '../engine/rules/rules.js';
import { parseExpr } from '../engine/rules/expr.js';
import { contentLibrary, contentView } from './library.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = path.join(ROOT, 'schemas');

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, useDefaults: false, allowUnionTypes: true });
const schema = (name) => ajv.compile(JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, name), 'utf8')));
ajv.addSchema(JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, 'terrain.schema.json'), 'utf8')));
ajv.addSchema(JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, 'lighting.schema.json'), 'utf8')));
const V = {
  terrain: ajv.getSchema('https://github.com/weberchad612-stack/Reliquary-VTT/schemas/terrain.schema.json'),
  lighting: ajv.getSchema('https://github.com/weberchad612-stack/Reliquary-VTT/schemas/lighting.schema.json'),
  map: schema('map.schema.json'),
  walls: schema('walls.schema.json'),
  state: schema('map-state.schema.json'),
  pack: schema('pack.schema.json'),
  campaign: schema('campaign.schema.json'),
  actor: schema('actor.schema.json'),
  actorstate: schema('actorstate.schema.json'),
  ledger: schema('ledger.schema.json'),
  loot: schema('loot.schema.json'),
  exploration: schema('exploration.schema.json'),
};
/** A ruleset's own schemas (rulesets/<id>/schemas/<name>.schema.json), compiled once. */
const RULESET_SCHEMAS = new Map();
function rulesetSchema(ruleset, name) {
  const key = `${ruleset}/${name}`;
  if (!RULESET_SCHEMAS.has(key)) {
    const f = path.join(ROOT, 'rulesets', ruleset, 'schemas', `${name}.schema.json`);
    RULESET_SCHEMAS.set(key, fs.existsSync(f) ? ajv.compile(JSON.parse(fs.readFileSync(f, 'utf8'))) : null);
  }
  return RULESET_SCHEMAS.get(key);
}

/** The ruleset's content schema for one kind of document (its own $defs entry), so errors name only what matters. */
function contentSchema(ruleset, kind) {
  const all = rulesetSchema(ruleset, 'content');
  if (!all) return null;
  const sys = systemConfig(ruleset), dirOf = sys && sys.content && sys.content.kindDir;
  const def = !dirOf ? null : dirOf(kind) === 'item' ? 'item' : kind === 'campaign-feature' ? 'campaignFeature' : dirOf(kind) ? kind : null;
  return def ? ajv.getSchema(`${all.schema.$id}#/$defs/${def}`) || all : undefined;
}

// Doorway check: walls running into a door's span pinch it, so an open door cannot be seen or walked through.
// Probe across the door at many points along it; a point is clear when the probe crosses no other wall
// that blocks movement. Probes reach half a cell either side, deeper than any wall face.
// A door segment reaches a little into the walls at both ends, so up to DOORWAY_END_SLACK cells of its
// length may be covered; whatever is left must be clear, and never less than DOORWAY_MIN_CELLS.
export const DOORWAY_END_SLACK = 0.4;
export const DOORWAY_MIN_CELLS = 0.5;
const PROBE = 0.5;                     // cells either side of the door line
const BLOCKING = new Set(['solid', 'window', 'slit', 'grate', 'terrain', 'door', 'secret']);

function crosses(p1, p2, a, b) {
  const d = (ax, ay, bx, by) => ax * by - ay * bx;
  const r = [p2[0] - p1[0], p2[1] - p1[1]], q = [b[0] - a[0], b[1] - a[1]];
  const den = d(r[0], r[1], q[0], q[1]);
  if (Math.abs(den) < 1e-12) return false;
  const w = [a[0] - p1[0], a[1] - p1[1]];
  const t = d(w[0], w[1], q[0], q[1]) / den, u = d(w[0], w[1], r[0], r[1]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Clear width of a door's opening, in cells: the longest stretch along it with no other wall across it. */
export function doorwayClearance(door, segs, samples = 40) {
  const [ax, ay] = door.a, [bx, by] = door.b;
  const length = Math.hypot(bx - ax, by - ay);
  const nx = -(by - ay) / length * PROBE, ny = (bx - ax) / length * PROBE;
  const others = segs.filter((s) => s !== door && s.id !== door.id && BLOCKING.has(s.t));
  let run = 0, best = 0;
  for (let i = 0; i < samples; i++) {
    const f = (i + 0.5) / samples, px = ax + (bx - ax) * f, py = ay + (by - ay) * f;
    const p1 = [px - nx, py - ny], p2 = [px + nx, py + ny];
    run = others.some((s) => crosses(p1, p2, s.a, s.b)) ? 0 : run + 1;
    best = Math.max(best, run);
  }
  return { clear: (best / samples) * length, length };
}

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
    if (e.keyword === 'propertyNames') continue;   // said with the name itself, below
    if (e.propertyName !== undefined || (e.params && e.params.propertyName)) {
      const name = e.propertyName ?? e.params.propertyName;
      const ids = /tokens|notes|templates|hidden_marks/.test(where) ? ' (ids are generated: tools/ids.mjs converts a save)' : '';
      report.error(file, `${where}: "${name}" ${e.message}${ids}`);
      continue;
    }
    const extra = e.params && e.params.allowedValues ? ` (${e.params.allowedValues.join(', ')})` : e.params && e.params.additionalProperty ? `: "${e.params.additionalProperty}"` : '';
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
  if (map.kind === 'area') return validateArea(map, dir, mapFile, knownMaps, report);

  const { grid } = map;
  if (path.basename(dir) !== map.id) report.warn(mapFile, `map id "${map.id}" does not match its folder name "${path.basename(dir)}"`);
  if (!fs.existsSync(path.join(dir, map.image.file))) report.error(mapFile, `image file "${map.image.file}" not found`);

  const gridW = grid.origin_px[0] + grid.cols * grid.cell_px;
  const gridH = grid.origin_px[1] + grid.rows * grid.cell_px;
  if (gridW > map.image.w + grid.cell_px || gridH > map.image.h + grid.cell_px) {
    report.warn(mapFile, `grid (${grid.cols}x${grid.rows}) extends more than one cell past the image (${map.image.w}x${map.image.h} px)`);
  }

  // Starting area: where the party arrives without an entrance
  if (!map.start) report.warn(mapFile, 'no starting area ("start"): the party cannot be moved here from the map menu except through an entrance');
  for (const c of map.start || []) if (!cellInGrid(c, grid)) report.error(mapFile, `start: cell ${fmt(c)} is outside the grid`);

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
  const allSegs = [];
  for (const wf of wallFiles) {
    const file = path.join(dir, wf);
    const walls = readJson(file, report);
    if (!walls || !schemaErrors(V.walls, walls, file, report)) continue;
    const size = fs.statSync(file).size;
    if (size > 200 * 1024) report.warn(file, `file is ${(size / 1024).toFixed(0)} KiB; split it to stay under 200 KiB`);

    for (const s of walls.segs) {
      allSegs.push({ seg: s, file });
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
  // Double doors: each leaf's pair must name the other, and the leaves must meet end to end on one line.
  const byDoor = new Map(allSegs.filter((x) => x.seg.door).map((x) => [x.seg.door.id, x.seg]));
  for (const { seg, file } of allSegs) {
    const pair = seg.door && seg.door.pair;
    if (!pair) continue;
    const where = `segment ${seg.id} (door ${seg.door.id})`;
    const other = byDoor.get(pair);
    if (!other) { report.error(file, `${where}: pair "${pair}" is not a door on this map`); continue; }
    if (other === seg) { report.error(file, `${where}: a door cannot pair with itself`); continue; }
    if (other.door.pair !== seg.door.id) report.error(file, `${where}: door "${pair}" does not name "${seg.door.id}" as its pair`);
    const shared = [seg.a, seg.b].some((p) => [other.a, other.b].some((q) => p[0] === q[0] && p[1] === q[1]));
    // Snapping to the 1/8 grid can bend a diagonal double door a little at its middle; allow 10 degrees.
    const u = [seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]], v = [other.b[0] - other.a[0], other.b[1] - other.a[1]];
    const sin = Math.abs(u[0] * v[1] - u[1] * v[0]) / (Math.hypot(...u) * Math.hypot(...v));
    if (!shared || sin > Math.sin(Math.PI / 18)) report.error(file, `${where}: the leaves of a double door must meet end to end on one line`);
    if (seg.t !== other.t) report.warn(file, `${where}: leaves of one double door have different types (${seg.t}, ${other.t})`);
  }
  for (const { seg, file } of allSegs) {
    if (!DOOR_TYPES.includes(seg.t)) continue;
    const { clear, length } = doorwayClearance(seg, allSegs.map((x) => x.seg));
    if (clear < Math.max(DOORWAY_MIN_CELLS, length - DOORWAY_END_SLACK)) {
      report.warn(file, `segment ${seg.id} (door ${seg.door.id}${seg.door.label ? `, "${seg.door.label}"` : ''}): ` +
        `walls pinch the doorway; only ${(clear * 5).toFixed(1)} ft of its ${(length * 5).toFixed(1)} ft is clear when open`);
    }
  }
  // Terrain
  const terrainIds = new Set(), inactiveTerrain = new Set();
  if (map.terrain) {
    const file = path.join(dir, map.terrain);
    const terrain = fs.existsSync(file) ? readJson(file, report) : (report.error(mapFile, `terrain file "${map.terrain}" not found`), null);
    if (terrain && schemaErrors(V.terrain, terrain, file, report)) {
      for (const a of terrain.areas) {
        const where = `terrain area ${a.id}`;
        if (terrainIds.has(a.id)) report.error(file, `${where}: duplicate area id`);
        terrainIds.add(a.id);
        if (a.active === false) inactiveTerrain.add(a.id);
        checkArea(a, where, grid, file, report);
        if (a.source || a.until) report.warn(file, `${where}: "source" and "until" belong to temporary terrain in a save`);
      }
    }
  }
  // Lighting
  const lightIds = new Set(), regionIds = new Set();
  let hasSky = false;
  if (map.lighting) {
    const file = path.join(dir, map.lighting);
    const lighting = fs.existsSync(file) ? readJson(file, report) : (report.error(mapFile, `lighting file "${map.lighting}" not found`), null);
    if (lighting && schemaErrors(V.lighting, lighting, file, report)) {
      for (const r of lighting.regions || []) {
        const where = `lighting region ${r.id}`;
        if (regionIds.has(r.id)) report.error(file, `${where}: duplicate region id`);
        regionIds.add(r.id);
        if (r.level === 'sky') hasSky = true;
        checkArea(r, where, grid, file, report);
      }
      for (const l of lighting.lights || []) {
        const where = `light ${l.id}`;
        if (lightIds.has(l.id)) report.error(file, `${where}: duplicate light id`);
        lightIds.add(l.id);
        if (!inGrid(l.at, grid)) report.error(file, `${where}: position ${fmt(l.at)} is outside the grid`);
        checkLightShape(l, where, file, report);
        if (l.rotation !== undefined && l.angle === undefined) report.warn(file, `${where}: rotation has no effect without an emission angle`);
      }
    }
  }
  if (map.outdoor && map.base_light) report.warn(mapFile, '"base_light" is ignored on an outdoor map (the sky lights it)');
  return { map, dir, doors, terrainIds, inactiveTerrain, lightIds, regionIds, hasSky, report };
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
  if (mapInfo.area) {
    if (st.map !== map.id) report.error(file, `state is for map "${st.map}" but was checked against "${map.id}"`);
    for (const id of st.places_found || []) {
      const p = map.places.find((x) => x.id === id);
      if (!p) report.error(file, `places_found: no place "${id}" on map "${map.id}"`);
      else if (p.public !== false) report.warn(file, `places_found: "${id}" is public already`);
    }
    for (const k of ['doors', 'locked_known', 'links_found', 'explored', 'terrain', 'terrain_on', 'terrain_off', 'lights', 'regions', 'regions_off', 'hidden_marks', 'templates', 'notes']) {
      if (st[k] !== undefined) report.warn(file, `${k}: an area map has no grid; ignored`);
    }
    return report;
  }
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
  const terrainIds = mapInfo.terrainIds || new Set();
  for (const id of st.terrain_off || []) if (!terrainIds.has(id)) report.error(file, `terrain_off: no terrain area "${id}" on map "${map.id}"`);
  for (const id of st.terrain_on || []) {
    if (!terrainIds.has(id)) report.error(file, `terrain_on: no terrain area "${id}" on map "${map.id}"`);
    else if (!(mapInfo.inactiveTerrain || new Set()).has(id)) report.warn(file, `terrain_on: area "${id}" is already active; terrain_on is for areas that start switched off`);
  }
  const tempIds = new Set();
  for (const a of st.terrain || []) {
    const where = `terrain ${a.id}`;
    if (terrainIds.has(a.id) || tempIds.has(a.id)) report.error(file, `${where}: id already used by another terrain area`);
    tempIds.add(a.id);
    checkArea(a, where, grid, file, report);
    if (!a.source) report.warn(file, `${where}: temporary terrain should say what created it ("source")`);
  }
  for (const id of Object.keys(st.lights || {})) if (!(mapInfo.lightIds || new Set()).has(id)) report.error(file, `lights.${id}: no light "${id}" on map "${map.id}"`);
  for (const id of st.regions_off || []) if (!(mapInfo.regionIds || new Set()).has(id)) report.error(file, `regions_off: no lighting region "${id}" on map "${map.id}"`);
  for (const id of Object.keys(st.regions || {})) if (!(mapInfo.regionIds || new Set()).has(id)) report.error(file, `regions.${id}: no lighting region "${id}" on map "${map.id}"`);
  if (st.sky_light && !map.outdoor && !(mapInfo.hasSky)) report.warn(file, 'sky_light is set but the map is indoor with no sky regions');
  const KINDS = new Set(['pc', 'ally', 'neutral', 'foe', 'marker', 'gm']);
  for (const [id, n] of Object.entries(st.notes || {})) {
    if (n.at && !cellInGrid([Math.floor(n.at[0]), Math.floor(n.at[1])], grid)) report.warn(file, `notes.${id}: point (${n.at[0]}, ${n.at[1]}) is outside the grid`);
    if (typeof n.text === 'string' && !n.text.trim()) report.error(file, `notes.${id}: the text is empty`);
  }
  for (const [id, a] of Object.entries(st.templates || {})) {
    if (a.caster && !(st.tokens || {})[a.caster]) report.warn(file, `templates.${id}: caster "${a.caster}" is not a token on this map`);
    if (a.shape === 'cone' && a.dir === undefined) report.error(file, `templates.${id}: a cone needs dir`);
    if (a.shape === 'line' && a.angle === undefined) report.error(file, `templates.${id}: a line needs angle`);
    const off = (a.cells || []).filter((c) => !cellInGrid(c, grid)).length;
    if (off) report.warn(file, `templates.${id}: ${off} square(s) outside the grid`);
  }
  for (const [id, t] of Object.entries(st.tokens || {})) {
    if (!cellInGrid([t.x, t.y], grid)) report.error(file, `tokens.${id}: cell (${t.x}, ${t.y}) is outside the grid`);
    if (t.kind !== undefined && !KINDS.has(t.kind)) report.warn(file, `tokens.${id}: kind "${t.kind}" is not one of pc, ally, neutral, foe, marker, gm (the board treats it as a foe)`);
    if (t.light) checkLightShape(t.light, `tokens.${id}.light`, file, report);
    const conds = (systemConfig((report.pack && report.pack.ruleset) || 'pf2e') || {}).conditions || {};
    const seenIds = new Set();
    for (const [i, e] of (t.effects || []).entries()) {
      const at = `tokens.${id}.effects[${i}]`;
      if (e.id) {
        const c = conds[e.id];
        if (!c) { report.error(file, `${at}: "${e.id}" is not a condition of this system (a custom effect needs "name")`); continue; }
        if (c.valued && e.value === undefined) report.error(file, `${at}: ${c.label} needs a value`);
        if (!c.valued && e.value !== undefined) report.warn(file, `${at}: ${c.label} takes no value`);
        if (c.max && e.value > c.max) report.error(file, `${at}: ${c.label} goes no higher than ${c.max}`);
        if (e.kind !== undefined) report.warn(file, `${at}: "kind" is only for custom effects`);
        if (seenIds.has(e.id)) report.warn(file, `${at}: ${c.label} is listed twice`);
        seenIds.add(e.id);
      }
    }
    if (t.dead && (t.effects || []).length) report.warn(file, `tokens.${id}: dead, so its effects are not shown`);
    if (t.known !== undefined && !t.alias) report.warn(file, `tokens.${id}: "known" without an alias does nothing (players see the name)`);
  }
  // names and letters: duplicates are warnings only (docs/best-practices/board.md, names and ids)
  for (const w of nameProblems(st.tokens || {})) report.warn(file, `names: ${w}`);
  return report;
}

/** A light needs a known preset or its own radii. Presets are the PF2E ruleset's (the only ruleset so far). */
function checkLightShape(l, where, file, report) {
  if (l.preset && !LIGHT_PRESETS[l.preset]) report.error(file, `${where}: unknown light preset "${l.preset}" (known: ${Object.keys(LIGHT_PRESETS).join(', ')})`);
  if (!l.preset && !l.bright && !l.dim) report.warn(file, `${where}: gives no light (no preset, no radius)`);
}

/** Checks shared by pack and save terrain areas: squares in the grid, no repeats, sensible fields. */
function checkArea(a, where, grid, file, report) {
  const seen = new Set();
  for (const [x, y, w, h] of a.rects || []) {
    if (w < 1 || h < 1) report.error(file, `${where}: rect [${x}, ${y}, ${w}, ${h}] is empty`);
  }
  let outside = 0, repeated = 0;
  const cells = [...(a.cells || [])];
  for (const [x, y, w, h] of a.rects || []) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) cells.push([x + i, y + j]);
  for (const c of cells) {
    const k = c.join(',');
    if (seen.has(k)) repeated++;
    seen.add(k);
    if (!cellInGrid(c, grid)) outside++;
  }
  if (outside) report.error(file, `${where}: ${outside} square(s) outside the ${grid.cols}x${grid.rows} grid`);
  if (repeated) report.warn(file, `${where}: ${repeated} square(s) listed more than once`);
  if ((a.kind === 'climb' || a.kind === 'swim' || a.kind === 'uneven' || a.kind === 'narrow') && a.dc === undefined) {
    report.warn(file, `${where}: ${a.kind} areas usually give the DC of their check`);
  }
  if (a.kind === 'hazardous' && !a.damage) report.warn(file, `${where}: hazardous terrain should say what damage it deals`);
  if (a.damage && a.kind !== 'hazardous') report.warn(file, `${where}: "damage" only applies to hazardous terrain`);
}

/** An area map (a town): its image and places. No grid, walls, terrain or lighting. */
function validateArea(map, dir, mapFile, knownMaps, report) {
  if (path.basename(dir) !== map.id) report.warn(mapFile, `map id "${map.id}" does not match its folder name "${path.basename(dir)}"`);
  if (!fs.existsSync(path.join(dir, map.image.file))) report.error(mapFile, `image file "${map.image.file}" not found`);
  const ids = new Set();
  for (const p of map.places) {
    const where = `place "${p.id}"`;
    if (ids.has(p.id)) report.error(mapFile, `${where}: duplicate place id`);
    ids.add(p.id);
    if (p.at[0] > map.image.w || p.at[1] > map.image.h) report.error(mapFile, `${where}: pin ${fmt(p.at)} is outside the image (${map.image.w}x${map.image.h})`);
  }
  if (!map.places.length) report.warn(mapFile, 'an area map with no places');
  return { map, dir, doors: new Map(), placeIds: ids, area: true, report };
}

/**
 * Entrances between maps come in pairs: a link's to_link names the entrance it arrives at on its target
 * map, and that entrance should lead back. Without a pair the board cannot take the entrance from the
 * map menu or make the way back known (docs/design/board.md, section 7).
 */
function checkLinkPairs(maps, report) {
  for (const [id, info] of maps) {
    const file = path.join(info.dir || '', 'map.json');
    for (const l of info.map.links || []) {
      const where = `links "${l.id}"`;
      const target = maps.get(l.to_map);
      if (!target) continue;   // a missing target map is reported with the map
      if (target.area) { if (l.to_link) report.error(file, `${where}: to_link on a link to an area map (an area map has no entrances)`); continue; }
      if (!l.to_link) { report.warn(file, `${where}: no to_link (the entrance it arrives at on ${l.to_map}); the party cannot take it from the map menu`); continue; }
      const back = (target.map.links || []).find((x) => x.id === l.to_link);
      if (!back) { report.error(file, `${where}: to_link "${l.to_link}" is not an entrance on ${l.to_map}`); continue; }
      if (back.to_map !== id || (back.to_link && back.to_link !== l.id)) report.warn(file, `${where}: its partner "${back.id}" on ${l.to_map} does not lead back here`);
    }
  }
}

/** Validate a pack (or a single map) and optionally a save. */
/** The pack's visual effects (effects.json, or the file pack.effects names): the engine's checks against the ruleset's library. */
export function validateEffects(target, pack, report) {
  const file = path.join(target, pack.effects || 'effects.json');
  if (!fs.existsSync(file)) { if (pack.effects) report.error(path.join(target, 'pack.json'), `effects: no file "${pack.effects}"`); return; }
  const lib = readJson(file, report);
  if (!lib) return;
  if (!lib.effects || typeof lib.effects !== 'object') { report.error(file, 'effects: an object of named effects is missing'); return; }
  const sys = systemConfig(pack.ruleset);
  for (const msg of checkLibrary(lib, (sys && sys.effects) || {})) report.error(file, msg);
}

export function validate(target, { save = null } = {}) {
  const report = new Report();
  const maps = new Map();
  if (fs.existsSync(path.join(target, 'map.json'))) {
    const info = validateMapDir(target, { report });
    if (info.map) maps.set(info.map.id, info);
  } else if (fs.existsSync(path.join(target, 'maps'))) {
    const mapsDir = path.join(target, 'maps');
    const packFile = path.join(target, 'pack.json');
    if (fs.existsSync(packFile)) {
      const pack = readJson(packFile, report);
      if (pack && schemaErrors(V.pack, pack, packFile, report)) {
        report.pack = pack;
        for (const id of pack.maps) if (!fs.existsSync(path.join(mapsDir, id, 'map.json'))) report.error(packFile, `maps: no map folder "${id}"`);
        validateEffects(target, pack, report);
        report.content = validateContent(target, pack, report);
      }
    } else report.warn(target, 'no pack.json: the board cannot load this pack as a campaign');
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
  checkLinkPairs(maps, report);

  if (save) {
    const campFile = path.join(save, 'campaign.json');
    if (fs.existsSync(campFile)) {
      const camp = readJson(campFile, report);
      if (camp && schemaErrors(V.campaign, camp, campFile, report) && report.pack) {
        if (camp.pack.id !== report.pack.id) report.error(campFile, `pack: this save is for pack "${camp.pack.id}", not "${report.pack.id}"`);
        else if (camp.pack.version !== report.pack.version) report.warn(campFile, `pack: saved with version ${camp.pack.version}, the pack is ${report.pack.version}`);
        if (camp.ruleset !== report.pack.ruleset) report.error(campFile, `ruleset: "${camp.ruleset}" does not match the pack's "${report.pack.ruleset}"`);
        if (camp.current_map && !maps.has(camp.current_map)) report.error(campFile, `current_map: no map "${camp.current_map}" in the pack`);
        for (const id of camp.discovered || []) if (!maps.has(id)) report.error(campFile, `discovered: no map "${id}" in the pack`);
      }
    }
    // the campaign ledger (GM only, private like the whole save)
    const ledgerFile = path.join(save, 'ledger.json');
    if (fs.existsSync(ledgerFile)) { const l = readJson(ledgerFile, report); if (l) schemaErrors(V.ledger, l, ledgerFile, report); }
    // the party's stash and purse
    const lootFile = path.join(save, 'loot.json');
    if (fs.existsSync(lootFile)) { const l = readJson(lootFile, report); if (l) schemaErrors(V.loot, l, lootFile, report); }
    // the PCs' exploration activities
    const exploreFile = path.join(save, 'exploration.json');
    if (fs.existsSync(exploreFile)) { const l = readJson(exploreFile, report); if (l) schemaErrors(V.exploration, l, exploreFile, report); }
    const dir = path.join(save, 'maps');
    if (!fs.existsSync(dir)) report.error(save, 'save has no maps/ folder');
    else {
      for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
        const file = path.join(dir, f);
        const id = path.basename(f, '.json');
        validateState(file, maps.get(id), report);
      }
    }
    if (report.pack) validateActors(save, report.pack, report.content || {}, report);
  }
  return report;
}

/** Rule elements: known keys (the engine's and the ruleset's), values that parse, known selectors. */
function checkRules(rules, where, file, sys, report) {
  for (const [i, r] of (rules || []).entries()) {
    const at = `${where}.rules[${i}]`;
    if (r.foundry) { if (report.tally) report.tally.unsupported++; else report.warn(file, `${at}: imported rule "${r.foundry.key || r.key}" is not supported yet (kept as it was)`); continue; }
    if (!BASE_RULE_KEYS.includes(r.key) && !((sys && sys.actors && sys.actors.ruleKeys) || []).includes(r.key)) report.error(file, `${at}: unknown rule key "${r.key}"`);
    for (const k of ['value', 'range']) if (typeof r[k] === 'string') { try { parseExpr(r[k]); } catch (e) { report.error(file, `${at}.${k}: ${e.message}`); } }
    const sel = (sys && sys.actors && sys.actors.selectors) || [];
    for (const s of [].concat(r.selector || [])) {
      if (!sel.length || sel.includes(s) || /-(lore|attack|damage)$/.test(s)) continue;
      if (report.tally) report.tally.selectors[s] = (report.tally.selectors[s] || 0) + 1;
      else report.warn(file, `${at}: selector "${s}" is not one this ruleset knows`);
    }
  }
}

/**
 * A pack's game content: the open sources it lists must exist (validateOpenContent checks them), and its own
 * content/<folder>/<slug>.json is checked here (the ruleset's schema, unique slugs, rule elements). Returns the
 * pack's library (tools/library.mjs) as {key: document}, read from files only when asked for.
 */
export function validateContent(target, pack, report) {
  for (const src of pack.content || []) {
    if (!fs.existsSync(path.join(ROOT, 'content', src))) report.error(path.join(target, 'pack.json'), `content: no open content "${src}" (content/${src})`);
  }
  contentDir(path.join(target, 'content'), pack.ruleset, report, false);
  try { return contentView(contentLibrary({ ...pack, content: (pack.content || []).filter((src) => fs.existsSync(path.join(ROOT, 'content', src))) }, target)); } catch (e) { report.error(path.join(target, 'pack.json'), e.message); return {}; }
}

/**
 * The repository's open content (content/<system>/<source>/<folder>/<slug>.json): the ruleset's schema and an
 * open licence (ORC or OGL) on every document (NOTICE.md). The importer's own files (import-manifest.json,
 * import-report.*) and our corrections (overrides/) are not content.
 */
export function validateOpenContent(dir, ruleset = 'pf2e', report = new Report()) {
  if (!fs.existsSync(dir)) return report;
  const folders = new Set(((systemConfig(ruleset) || {}).content || {}).folders || ['creature', 'item']);
  const subdirs = fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isDirectory());
  // imported rules our engine cannot run yet are counted, not listed one by one (import-report.md lists them)
  report.tally = { unsupported: 0, selectors: {} };
  if (subdirs.some((s) => folders.has(s))) contentDir(dir, ruleset, report, true);
  else for (const s of subdirs) if (s !== 'overrides') contentDir(path.join(dir, s), ruleset, report, true);
  const { unsupported, selectors } = report.tally;
  delete report.tally;
  if (unsupported) report.warn(dir, `${unsupported} imported rule(s) are not supported yet (kept as they were; import-report.md counts them by type)`);
  const sels = Object.entries(selectors).sort((a, b) => b[1] - a[1]);
  if (sels.length) report.warn(dir, `${sels.reduce((n, [, c]) => n + c, 0)} rule(s) use ${sels.length} selector(s) this ruleset does not know yet: ${sels.slice(0, 12).map(([k, c]) => `${k} (${c})`).join(', ')}${sels.length > 12 ? ', ...' : ''}`);
  return report;
}

/** One folder of content (<folder>/<slug>.json); `open`: every document must carry an open licence. */
function contentDir(dir, ruleset, report, open) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  const sys = systemConfig(ruleset);
  const dirOf = (sys && sys.content && sys.content.kindDir) || ((k) => (k === 'creature' ? 'creature' : 'item'));
  for (const kind of fs.readdirSync(dir)) {
    const kdir = path.join(dir, kind);
    if (!fs.statSync(kdir).isDirectory()) continue;
    for (const f of fs.readdirSync(kdir).filter((n) => n.endsWith('.json'))) {
      const file = path.join(kdir, f), d = readJson(file, report);
      if (!d) continue;
      const check = contentSchema(ruleset, d.kind);
      if (check === undefined) { report.error(file, `kind "${d.kind}" is not a kind of content (rulesets/${ruleset}/content.js)`); continue; }
      if (check && !schemaErrors(check, d, file, report)) continue;
      if (open && !['ORC', 'OGL', 'ORC/OGL'].includes((d.source || {}).license)) report.error(file, `licence "${(d.source || {}).license}": open content must be ORC or OGL (NOTICE.md)`);
      const key = `${dirOf(d.kind)}/${d.slug}`;
      if (`${kind}/${path.basename(f, '.json')}` !== key) report.error(file, `its kind and slug make "${key}", not the file's place "${kind}/${path.basename(f, '.json')}"`);
      if (out[key]) report.error(file, `"${key}" is defined twice`);
      out[key] = true;
      checkRules(d.rules, d.slug, file, sys, report);
      for (const [i, it] of (d.items || []).entries()) checkRules(it.rules, `items[${i}]`, file, sys, report);
      // numbers no stat block has: most likely a data error at the source, corrected with an override
      for (const [a, v] of Object.entries(((d.stats || {}).attributes) || {})) if (v > 15 || v < -5) report.warn(file, `stats.attributes.${a} is ${v}: no creature has that; check the book and correct it with an override (content/pf2e/overrides/)`);
    }
  }
  return out;
}

/**
 * A save's creatures (actors/<id>.json) and their live state (actorstate/<id>.json): the schemas, a stat block or
 * items that exist in the pack's content, a token for each, and the ruleset preparing each one without problems.
 */
export function validateActors(save, pack, content, report) {
  const sys = systemConfig(pack.ruleset), check = rulesetSchema(pack.ruleset, 'actor');
  const tokens = new Set(), tokenEffects = {};
  const mdir = path.join(save, 'maps');
  if (fs.existsSync(mdir)) for (const f of fs.readdirSync(mdir).filter((n) => n.endsWith('.json'))) { try { const st = JSON.parse(fs.readFileSync(path.join(mdir, f), 'utf8')); for (const [id, t] of Object.entries(st.tokens || {})) { tokens.add(id); tokenEffects[id] = t.effects || []; } } catch { /* reported by validateState */ } }
  const adir = path.join(save, 'actors'), sdir = path.join(save, 'actorstate');
  const ids = fs.existsSync(adir) ? fs.readdirSync(adir).filter((n) => n.endsWith('.json')).map((n) => path.basename(n, '.json')) : [];
  for (const id of ids) {
    const file = path.join(adir, id + '.json'), a = readJson(file, report);
    if (!a || !schemaErrors(V.actor, a, file, report)) continue;
    if (!/^tok-[0-9a-z]{8}$/.test(id)) report.error(file, `"${id}" is not a token id: an actor has its token's id`);
    else if (!tokens.has(id)) report.warn(file, `no token "${id}" on any map of this save`);
    if (a.system !== pack.ruleset) { report.error(file, `system "${a.system}" is not the campaign's ruleset "${pack.ruleset}"`); continue; }
    if (check && !schemaErrors(check, a, file, report)) continue;
    const look = (k) => { try { return content[k]; } catch (e) { report.error(file, e.message); return undefined; } };
    if (a.base && !look(a.base)) { report.error(file, `base: no "${a.base}" in the pack's content or the open sources pack.json lists`); continue; }
    const before = report.errors.length;
    for (const [i, it] of (a.items || []).entries()) if (it.ref && !look(it.ref)) report.error(file, `items[${i}]: no "${it.ref}" in the pack's content or the open sources pack.json lists`);
    for (const k of [a.base, ...(a.items || []).map((it) => it.ref)].filter(Boolean)) { const d = look(k); if (d && d.retired) report.warn(file, `"${k}" is retired in Foundry since ${d.retired.since}${d.retired.replacedBy ? `: use "${d.retired.replacedBy}"` : ''}`); }
    checkRules(a.rules, id, file, sys, report);
    for (const [i, f] of (a.feats || []).entries()) checkRules(f.rules, `feats[${i}]`, file, sys, report);
    let st = {};
    const sfile = path.join(sdir, id + '.json');
    if (fs.existsSync(sfile)) { st = readJson(sfile, report) || {}; schemaErrors(V.actorstate, st, sfile, report); }
    if (!sys || !sys.actors || report.errors.length > before) continue;   // the rules would only repeat these
    try {
      const p = prepareActor({ actor: a, state: st, effects: tokenEffects[id] || [], content, ruleset: sys.actors });
      for (const msg of p.problems) report.error(file, msg);
      if (st.hp !== undefined && st.hp > p.hp.max.value) report.warn(sfile, `hp ${st.hp} is above the maximum ${p.hp.max.value}`);
    } catch (e) { report.error(file, `cannot be prepared: ${e.message}`); }
  }
  if (fs.existsSync(sdir)) for (const n of fs.readdirSync(sdir).filter((x) => x.endsWith('.json'))) if (!ids.includes(path.basename(n, '.json'))) report.error(path.join(sdir, n), 'live state for a creature with no actor');
  // the encounter: every combatant a token of this save
  const campFile = path.join(save, 'campaign.json');
  if (fs.existsSync(campFile)) {
    try {
      const enc = JSON.parse(fs.readFileSync(campFile, 'utf8')).encounter;
      for (const c of (enc && enc.combatants) || []) if (!tokens.has(c.token)) report.error(campFile, `encounter: no token "${c.token}" on any map of this save`);
      if (enc && enc.turn !== null && enc.turn !== undefined && !(enc.combatants || [])[enc.turn]) report.error(campFile, `encounter: turn ${enc.turn} is not a combatant`);
    } catch { /* reported with campaign.json */ }
  }
}

function main(argv) {
  const args = argv.slice(2);
  const ci = args.indexOf('--content');
  if (ci >= 0) {   // the repository's open content: node tools/validate.mjs --content content/pf2e
    const report = validateOpenContent(path.resolve(args[ci + 1] || 'content/pf2e'));
    for (const i of report.items) console.log(`${i.level.toUpperCase()}  ${path.relative(process.cwd(), i.file) || i.file}: ${i.msg}`);
    console.log(report.errors.length ? `FAILED: ${report.errors.length} error(s), ${report.warnings.length} warning(s)` : `OK: 0 errors, ${report.warnings.length} warning(s)`);
    return report.errors.length ? 1 : 0;
  }
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
