// Light: how bright each point of a map is. Implements docs/design/lighting.md sections 4, 5 and 7.
// Dependency-free; runs in the browser and in Node.
//
// Light levels are numbers, so the brightest source wins with Math.max: DARK 0, DIM 1, BRIGHT 2.
// The engine knows where light falls; what a level means for a creature (concealed, unseen) is the
// ruleset's call (rulesets/<system>/light.js), and so are presets such as a torch's radii.
//
// The light map is a bitmap on the same 1/8-cell grid as the explored area, so the party's view can be
// filtered by light pixel by pixel and traced back into outlines exactly as the fog is.

import { prepare, visPolygon } from '../sight/visibility.js';
import { ExploredMask, RES } from '../fog/explored.js';
import { areaCells } from '../terrain/terrain.js';

export const DARK = 0;
export const DIM = 1;
export const BRIGHT = 2;
export const LEVEL = Object.freeze({ dark: DARK, dim: DIM, bright: BRIGHT });
export const LEVEL_NAME = Object.freeze(['dark', 'dim', 'bright']);

const CIRCLE_SIDES = 64;

/** Light segments for a map: the walls with door states applied, using each wall's `light` value. */
export function prepareLight(segs, state = {}) {
  return prepare(segs, state, 'light');
}

/**
 * Where one light source reaches.
 * @param {object} light  {at: [x, y] in cells, bright: feet, dim: feet beyond bright, walls?: boolean (default true),
 *   angle?: degrees (a cone; static lights only), rotation?: degrees (cone direction, 0 = east, clockwise with y down)}
 * @param {Array} preparedLight  prepareLight() output
 * @returns {{at, bright: number, reach: number, poly: Array|null, cone: {dir: number, half: number}|null}}
 *   bright and reach in cells; poly is the area the light can reach through walls (null when walls do not constrain it)
 */
export function lightShape(light, preparedLight, { feetPerCell = 5 } = {}) {
  const bright = Math.max(0, light.bright || 0) / feetPerCell;
  const reach = bright + Math.max(0, light.dim || 0) / feetPerCell;
  const at = light.at;
  let poly;
  if (light.walls === false) {
    poly = [];
    for (let i = 0; i < CIRCLE_SIDES; i++) {
      const a = (i / CIRCLE_SIDES) * 2 * Math.PI;
      poly.push([at[0] + Math.cos(a) * reach, at[1] + Math.sin(a) * reach]);
    }
  } else {
    poly = reach > 0 ? visPolygon(at, preparedLight, { rangeFt: reach * feetPerCell, feetPerCell }) : null;
  }
  const cone = light.angle && light.angle < 360
    ? { dir: ((light.rotation || 0) * Math.PI) / 180, half: (light.angle * Math.PI) / 360 }
    : null;
  return { at, bright, reach, poly, cone };
}

/**
 * The pixels one light lights, as two parallel arrays (pixel index, level), so a cached light can be laid
 * onto a fresh map without recomputing anything.
 */
export function lightPatch(shape, grid, res = RES) {
  const out = { idx: [], lvl: [] };
  if (!shape.poly || shape.reach <= 0) return out;
  const m = new ExploredMask(grid, res);
  m.add([shape.poly]);
  const [ax, ay] = shape.at, r2 = shape.reach * shape.reach, b2 = shape.bright * shape.bright;
  const i0 = Math.max(0, Math.floor((ax - shape.reach) * res)), i1 = Math.min(m.w - 1, Math.ceil((ax + shape.reach) * res));
  const j0 = Math.max(0, Math.floor((ay - shape.reach) * res)), j1 = Math.min(m.h - 1, Math.ceil((ay + shape.reach) * res));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * m.w + i;
      if (!m.bits[k]) continue;
      const dx = (i + 0.5) / res - ax, dy = (j + 0.5) / res - ay, d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      if (shape.cone && d2 > 1e-9) {
        let da = Math.atan2(dy, dx) - shape.cone.dir;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) > shape.cone.half) continue;
      }
      out.idx.push(k);
      out.lvl.push(d2 <= b2 ? BRIGHT : DIM);
    }
  }
  return out;
}

/**
 * How bright every point of a map is right now.
 * @param {{cols, rows}} grid
 * @param {object} o
 * @param {'bright'|'dim'|'dark'} [o.base='bright']  the map's own level away from regions and lights
 *   (indoor maps usually 'dark'); outdoor maps pass the sky level here
 * @param {'bright'|'dim'|'dark'} [o.sky='bright']  the sky light: used by `sky` regions (and by outdoor maps' base)
 * @param {Array} [o.regions]  lighting regions: {id, level: 'sky'|'bright'|'dim'|'dark', cells?, rects?}
 * @param {Array} [o.patches]  lightPatch() results for every light that is on
 */
export class LightMap {
  constructor(grid, o = {}, res = RES) {
    this.res = res;
    this.w = Math.ceil(grid.cols * res);
    this.h = Math.ceil(grid.rows * res);
    const sky = LEVEL[o.sky || 'bright'];
    const base = o.base === 'sky' ? sky : LEVEL[o.base || 'bright'];
    this.levels = new Uint8Array(this.w * this.h).fill(base);
    for (const r of o.regions || []) {
      const v = r.level === 'sky' ? sky : LEVEL[r.level];
      for (const [x, y] of areaCells(r)) {
        for (let j = y * res; j < (y + 1) * res && j < this.h; j++) {
          for (let i = x * res; i < (x + 1) * res && i < this.w; i++) this.levels[j * this.w + i] = v;
        }
      }
    }
    for (const p of o.patches || []) {
      for (let n = 0; n < p.idx.length; n++) if (p.lvl[n] > this.levels[p.idx[n]]) this.levels[p.idx[n]] = p.lvl[n];
    }
  }

  /** Light level at a point in cells (0 dark, 1 dim, 2 bright). */
  at(x, y) {
    const i = Math.floor(x * this.res), j = Math.floor(y * this.res);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return DARK;
    return this.levels[j * this.w + i];
  }
}

/**
 * Keeps light patches between updates. A light is recomputed only when its position, shape or the
 * door states change (static lights: almost never; a carried torch: when its carrier moves).
 */
export class LightCache {
  constructor(grid, { feetPerCell = 5, res = RES } = {}) {
    this.grid = grid; this.feetPerCell = feetPerCell; this.res = res;
    this.patches = new Map();
    this.computed = 0;
  }

  /**
   * Patches for the given lights (each {id, at, bright, dim, walls?, angle?, rotation?}).
   * `doorsKey` is any string that changes when door states change.
   */
  patchesFor(lights, segs, state, doorsKey) {
    let prepared = null;
    const out = [], live = new Set();
    for (const l of lights) {
      const key = [l.id, l.at[0], l.at[1], l.bright, l.dim, l.walls !== false, l.angle || 0, l.rotation || 0, l.walls === false ? '' : doorsKey].join('|');
      live.add(l.id);
      const hit = this.patches.get(l.id);
      if (hit && hit.key === key) { out.push(hit.patch); continue; }
      if (!prepared) prepared = prepareLight(segs, state);
      const patch = lightPatch(lightShape(l, prepared, { feetPerCell: this.feetPerCell }), this.grid, this.res);
      this.patches.set(l.id, { key, patch });
      this.computed++;
      out.push(patch);
    }
    for (const id of [...this.patches.keys()]) if (!live.has(id)) this.patches.delete(id);
    return out;
  }
}
