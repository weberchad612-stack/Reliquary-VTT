// Light: how bright each point of a map is. Implements docs/design/lighting.md sections 4, 5 and 7.
// Dependency-free; runs in the browser and in Node.
//
// Light levels are numbers, so the brightest source wins with Math.max: DARK 0, DIM 1, BRIGHT 2.
// The engine knows where light falls; what a level means for a creature (concealed, unseen) is the
// ruleset's call (rulesets/<system>/light.js), and so are presets such as a torch's radii.
//
// The light map is a bitmap on the same 1/8-cell grid as the explored area, so the party's view can be
// filtered by light pixel by pixel and traced back into outlines exactly as the fog is.
//
// Beside the three rule levels, the map keeps a brightness for drawing (`glow`, 0-255): 255 in bright
// light, falling in a straight line across a light's dim band to 0 at its outer edge, so dim light fades
// out instead of stopping at a hard edge. Rules never read it.

import { prepare, visPolygon, pointSegDist } from '../sight/visibility.js';
import { ExploredMask, RES } from '../fog/explored.js';
import { areaCells } from '../terrain/terrain.js';

export const DARK = 0;
export const DIM = 1;
export const BRIGHT = 2;
export const LEVEL = Object.freeze({ dark: DARK, dim: DIM, bright: BRIGHT });
export const LEVEL_NAME = Object.freeze(['dark', 'dim', 'bright']);

const CIRCLE_SIDES = 64;

/** Brightness (0-255) of dim light that does not fade: dim regions, a dim sky. */
export const DIM_GLOW = 128;
const LEVEL_GLOW = [0, DIM_GLOW, 255];

/**
 * A light with bright light but no dim radius still gets a thin fringe of dim light, this fraction of
 * its bright radius, so it does not end at a hard edge (a 10 ft bright light fades over its last foot).
 */
export const DIM_FRINGE = 0.1;

/**
 * Region edges fade over about this many feet in the drawing (half each side of the square line), so a
 * glowing patch of fungus does not stop at a hard square edge. Edges along a wall that blocks light stay
 * sharp (the wall is the edge). Drawing only: the rules still change level at the square line.
 */
export const REGION_FADE_FT = 2;

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
  const brightFt = Math.max(0, light.bright || 0);
  let dimFt = Math.max(0, light.dim || 0);
  if (dimFt === 0 && brightFt > 0) dimFt = brightFt * DIM_FRINGE;
  const bright = brightFt / feetPerCell;
  const reach = bright + dimFt / feetPerCell;
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
 * The pixels one light lights, as three parallel arrays (pixel index, level, brightness 0-255), so a
 * cached light can be laid onto a fresh map without recomputing anything.
 */
export function lightPatch(shape, grid, res = RES) {
  const out = { idx: [], lvl: [], glow: [] };
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
      if (d2 <= b2) { out.lvl.push(BRIGHT); out.glow.push(255); continue; }
      out.lvl.push(DIM);
      out.glow.push(Math.max(1, Math.round((255 * (shape.reach - Math.sqrt(d2))) / (shape.reach - shape.bright))));
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
 * @param {Array} [o.walls]  prepareLight() output: region edges along these walls are not faded
 * @param {number} [o.fadeFt=REGION_FADE_FT]  width of the faded region edge in the drawing; 0 for none
 * @param {number} [o.feetPerCell=5]
 */
export class LightMap {
  constructor(grid, o = {}, res = RES) {
    this.res = res;
    this.w = Math.ceil(grid.cols * res);
    this.h = Math.ceil(grid.rows * res);
    const sky = LEVEL[o.sky || 'bright'];
    const base = o.base === 'sky' ? sky : LEVEL[o.base || 'bright'];
    this.levels = new Uint8Array(this.w * this.h).fill(base);
    /** Brightness for drawing, 0-255 (see the top of this file). */
    this.glow = new Uint8Array(this.w * this.h).fill(LEVEL_GLOW[base]);
    for (const r of o.regions || []) {
      const v = r.level === 'sky' ? sky : LEVEL[r.level];
      for (const [x, y] of areaCells(r)) {
        for (let j = y * res; j < (y + 1) * res && j < this.h; j++) {
          for (let i = x * res; i < (x + 1) * res && i < this.w; i++) { this.levels[j * this.w + i] = v; this.glow[j * this.w + i] = LEVEL_GLOW[v]; }
        }
      }
    }
    if ((o.regions || []).length) fadeRegionEdges(this, grid, o);
    for (const p of o.patches || []) {
      for (let n = 0; n < p.idx.length; n++) {
        const k = p.idx[n];
        if (p.lvl[n] > this.levels[k]) this.levels[k] = p.lvl[n];
        if (p.glow[n] > this.glow[k]) this.glow[k] = p.glow[n];
      }
    }
  }

  /** Brightness for drawing at a point in cells, 0 (dark) to 1 (bright). */
  glowAt(x, y) {
    const i = Math.floor(x * this.res), j = Math.floor(y * this.res);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return 0;
    return this.glow[j * this.w + i] / 255;
  }

  /** Light level at a point in cells (0 dark, 1 dim, 2 bright). */
  at(x, y) {
    const i = Math.floor(x * this.res), j = Math.floor(y * this.res);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return DARK;
    return this.levels[j * this.w + i];
  }
}

/**
 * Soften region edges in the drawing (see REGION_FADE_FT): along every square edge where the brightness
 * changes and no wall stands, the brighter side dims toward the darker side's level over the fade width,
 * reaching it at the square line. The fade lies wholly on the lit side, so a creature beyond the edge,
 * who cannot see into the dark, still sees the light die away rather than stop.
 */
function fadeRegionEdges(m, grid, o) {
  const fadeFt = o.fadeFt ?? REGION_FADE_FT, fpc = o.feetPerCell || 5, res = m.res, w = m.w, h = m.h;
  if (!(fadeFt > 0)) return;
  const F = (fadeFt / fpc) * res;   // fade width in pixels
  const walls = o.walls || [];
  const onWall = (a, b) => [0.25, 0.5, 0.75].every((t) => {
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return walls.some((s) => pointSegDist(p, s.a, s.b) < 0.15);
  });
  const src = Uint8Array.from(m.glow);
  const cellGlow = (x, y) => src[Math.min(h - 1, y * res + (res >> 1)) * w + Math.min(w - 1, x * res + (res >> 1))];
  // one edge: the bright cell (bx, by) dims toward `low` approaching the edge from (ax, ay) to (ex, ey), in pixels
  const fade = (bx, by, low, ax, ay, ex, ey) => {
    const high = cellGlow(bx, by);
    for (let j = by * res; j < (by + 1) * res && j < h; j++) {
      for (let i = bx * res; i < (bx + 1) * res && i < w; i++) {
        const d = pointSegDist([i + 0.5, j + 0.5], [ax, ay], [ex, ey]);
        if (d >= F) continue;
        const v = Math.round(low + ((high - low) * d) / F);
        if (v < m.glow[j * w + i]) m.glow[j * w + i] = v;
      }
    }
  };
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const g = cellGlow(x, y);
      if (x + 1 < grid.cols) {
        const g2 = cellGlow(x + 1, y);
        if (g2 !== g && !onWall([x + 1, y], [x + 1, y + 1])) {
          const X = (x + 1) * res;
          if (g > g2) fade(x, y, g2, X, y * res, X, (y + 1) * res); else fade(x + 1, y, g, X, y * res, X, (y + 1) * res);
        }
      }
      if (y + 1 < grid.rows) {
        const g2 = cellGlow(x, y + 1);
        if (g2 !== g && !onWall([x, y + 1], [x + 1, y + 1])) {
          const Y = (y + 1) * res;
          if (g > g2) fade(x, y, g2, x * res, Y, (x + 1) * res, Y); else fade(x, y + 1, g, x * res, Y, (x + 1) * res, Y);
        }
      }
    }
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
