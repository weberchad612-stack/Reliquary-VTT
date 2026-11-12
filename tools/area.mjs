#!/usr/bin/env node
// Command-line access to area templates (engine/areas/areas.js): what a burst, cone, emanation or line
// covers on a map, who is in it, and the template record to put on the board (templates/<id>).
//
// Usage:
//   node tools/area.mjs <map-dir> --shape burst     --ft N --at X,Y                [--caster ID|NAME|X,Y[,SIZE]]
//   node tools/area.mjs <map-dir> --shape cone      --ft N --caster ID|NAME|X,Y[,SIZE]  (--dir NAME | --toward X,Y)
//   node tools/area.mjs <map-dir> --shape line      --ft N --caster ID|NAME|X,Y[,SIZE]  (--angle DEG | --toward X,Y)
//   node tools/area.mjs <map-dir> --shape emanation --ft N --caster ID|NAME|X,Y[,SIZE]
//   Options: [--state FILE] the map's state (saves/<campaign>/maps/<id>.json): door states, tokens (a caster
//            named by id, and who is in the area), templates already placed (for the colour);
//            [--by gm|player] (default gm); [--ruleset ID] (default pf2e); [--no-walls]; [--id ID];
//            [--height FEET] a burst's point above the ground (default 0; cones, lines and emanations start at
//            the caster's elevation)
//
// Burst --at is a grid corner (cells). Cone --dir: north, northeast, ... northwest. Line --angle: degrees,
// 0 east, 90 south (clockwise on screen). --toward aims as the mouse does on the board (a point in cells).
// Prints JSON: {path, record, covered, reached, inArea: [{id, name}], outOfReach: [{id, name, elevation}]}
// (outOfReach: in the area's squares but above or below it). To place it, write `record` to the
// board's store at `path` (db_write), or add it to the map state's templates (record without "map").

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArea, effectBlockers, tokensInArea, DIRECTION_NAMES, describeArea } from '../engine/areas/areas.js';
import { templateRecord, nextColour, TARGETABLE } from '../board/templates.js';
import { makeId } from '../board/ids.js';
import { resolveToken, publicName } from '../board/names.js';
import { loadMap } from './sight.mjs';
import { systemConfig } from '../rulesets/systems.js';

const nums = (s, name, n) => {
  const v = String(s || '').split(',').map(Number);
  if ((n && !n.includes(v.length)) || v.some((x) => !Number.isFinite(x))) throw new Error(`${name} has the wrong form`);
  return v;
};

/**
 * Build a template from options (the CLI's work, without the file reading).
 * @returns {{path, record, covered, reached, inArea}}
 */
export function areaFromOptions({ map, segs, state = {}, sys, shape, ft, caster, at, dir, toward, angle, by = 'gm', walls = true, id = makeId('template'), height }) {
  if (!sys.areas || !sys.areas.shapes[shape]) throw new Error(`${sys.name} has no "${shape}" area`);
  if (!(ft > 0)) throw new Error('--ft must be a positive number of feet');
  const FPC = map.grid.feet_per_cell || sys.measurement.squareFeet;
  const tokens = state.tokens || {};
  let space = null, casterId, casterName;
  if (caster !== undefined) {
    if (typeof caster === 'string' && /^[\d.]+,[\d.]+(,[\d.]+)?$/.test(caster)) {
      const c = nums(caster, '--caster', [2, 3]);
      space = { x: c[0], y: c[1], size: c[2] ?? 1 };
    } else {
      // a token by id, name or alias (a name two tokens share is refused: give the id)
      let id;
      try { id = resolveToken(tokens, caster); } catch (e) { throw new Error(`--caster: ${e.message} (a token in the state, by id or name, or X,Y[,SIZE])`); }
      const t = tokens[id];
      space = { x: Math.floor(t.x), y: Math.floor(t.y), size: Math.max(1, Math.ceil(t.size || 1)), elevation: t.elevation || 0 };
      casterId = id; casterName = publicName(t) || id;   // the record is seen by players: never an unlearned name
    }
  }
  if (shape !== 'burst' && !space) throw new Error(`a ${shape} needs --caster`);
  let gx, gy;
  const cx = space ? space.x + space.size / 2 : 0, cy = space ? space.y + space.size / 2 : 0;
  if (shape === 'burst') {
    if (!at) throw new Error('a burst needs --at X,Y (a grid corner)');
    [gx, gy] = at;
  } else if (shape === 'cone') {
    if (dir !== undefined) {
      const d = DIRECTION_NAMES.indexOf(dir);
      if (d < 0) throw new Error(`--dir must be one of ${DIRECTION_NAMES.join(', ')}`);
      const a = (d * Math.PI) / 4;
      gx = cx + Math.sin(a) * 5; gy = cy - Math.cos(a) * 5;
    } else if (toward) [gx, gy] = toward;
    else throw new Error('a cone needs --dir or --toward');
  } else if (shape === 'line') {
    if (angle !== undefined) { const a = (angle * Math.PI) / 180; gx = cx + Math.cos(a) * 1e4; gy = cy + Math.sin(a) * 1e4; }   // far off: the angle from the snapped origin is the one asked
    else if (toward) [gx, gy] = toward;
    else throw new Error('a line needs --angle or --toward');
  } else { gx = cx; gy = cy; }
  const widthFeet = sys.areas.shapes.line.widthFeet || FPC;
  const blockers = walls ? effectBlockers(segs, state, sys.areas.lineOfEffect) : [];
  const area = buildArea(shape, space, gx, gy, { R: Math.max(1, Math.round(ft / FPC)), width: widthFeet / FPC, costs: [...sys.measurement.diagonalCosts], blockers });
  if (!area) throw new Error('--toward is too close to the caster to choose a direction');
  const h = shape === 'burst' ? Number(height || 0) : (space && space.elevation) || 0;
  if (!Number.isFinite(h)) throw new Error('--height must be a number of feet');
  const record = templateRecord({
    map: map.id, shape, ft, area, caster: casterId, casterName, by, col: nextColour(state.templates), at: new Date().toISOString(),
    widthFeet: shape === 'line' ? widthFeet : undefined, height: Math.round(h),
  });
  if (!casterId && space && shape !== 'burst') record.casterName = `the creature at ${space.x},${space.y}`;
  const pool = Object.fromEntries(Object.entries(tokens).filter(([, t]) => TARGETABLE(t)));
  const reach = tokensInArea(area, pool, { R: Math.max(1, Math.round(ft / FPC)), height: Math.round(h), caster: space, costs: [...sys.measurement.diagonalCosts], squareFeet: FPC });
  const inArea = reach.in;
  if (sys.areas.shapes[shape].includesCaster && casterId && pool[casterId] && !inArea.includes(casterId)) inArea.unshift(casterId);
  return {
    path: `templates/${id}`,
    describe: describeArea(record, sys.measurement.unit),
    record,
    covered: area.covered.length,
    reached: area.cells.length,
    inArea: inArea.map((t) => ({ id: t, name: tokens[t].name || t, ...(publicName(tokens[t]) !== tokens[t].name ? { shown: publicName(tokens[t]) } : {}) })),
    outOfReach: reach.over.filter((t) => t !== casterId).map((t) => ({ id: t, name: tokens[t].name || t, elevation: tokens[t].elevation || 0 })),
  };
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const shape = opt('--shape'), ft = Number(opt('--ft')), caster = opt('--caster'), at = opt('--at'), dir = opt('--dir');
    const toward = opt('--toward'), angle = opt('--angle'), stateFile = opt('--state'), by = opt('--by') || 'gm', id = opt('--id'), height = opt('--height');
    const sys = systemConfig(opt('--ruleset') || 'pf2e');
    const noWalls = flag('--no-walls');
    if (!sys) throw new Error('unknown --ruleset');
    if (args.length !== 1 || !shape) throw new Error('give one map folder and --shape');
    if (!['gm', 'player'].includes(by)) throw new Error('--by is gm or player');
    const { map, segs } = loadMap(path.resolve(args[0]));
    const state = stateFile ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
    const out = areaFromOptions({
      map, segs, state, sys, shape, ft, caster, by, walls: !noWalls, id: id || undefined, dir, height,
      at: at ? nums(at, '--at (X,Y)', [2]) : undefined,
      toward: toward ? nums(toward, '--toward (X,Y)', [2]) : undefined,
      angle: angle !== undefined ? Number(angle) : undefined,
    });
    console.log(JSON.stringify(out, null, 2));
    return 0;
  } catch (e) {
    console.error(`area: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
