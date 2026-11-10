// Daylight indoors: windows and open doors that face open sky let the sky's light into the room behind
// them. Implements docs/design/lighting.md section 10. Dependency-free; runs in the browser and in Node.
//
// Each opening (any wall that light passes freely: a window, a grate, an arrow slit, an open door) with
// sky on one side and roofed space on the other becomes a row of static half-circle lights just inside
// it, one per square of opening, facing into the room. They are ordinary lights to the rest of the
// engine: walls block them, the light cache keeps them, and they count for the rules like any light.
// They change only when a door opens or closes or the sky changes, never when tokens move.

import { senseOf, SENSE } from '../walls/presets.js';
import { areaCells } from '../terrain/terrain.js';

/**
 * How far daylight reaches into a room, in feet. Day: bright for `bright`, then dim for `dim` more.
 * Dusk (a dim sky): dim light only, for `dusk`. Night: none.
 */
export const DAYLIGHT = Object.freeze({ bright: 15, dim: 50, dusk: 15 });

/** How far inside the opening the lights sit, in cells (just clear of the wall line). */
const INSET = 0.02;
/** How far either side of an opening the sky test looks, in cells (the middle of the next square). */
const PROBE = 0.5;

/**
 * Which squares are open to the sky, as the light map works it out: an outdoor map's sky everywhere,
 * then each region in order (a `sky` region opens its squares, any other level roofs them).
 * @returns {(x: number, y: number) => boolean}  takes a point in cells
 */
export function skyTest(grid, { outdoor = false, regions = [] } = {}) {
  const sky = new Uint8Array(grid.cols * grid.rows).fill(outdoor ? 1 : 0);
  for (const r of regions) {
    const v = r.level === 'sky' ? 1 : 0;
    for (const [x, y] of areaCells(r)) if (x >= 0 && y >= 0 && x < grid.cols && y < grid.rows) sky[y * grid.cols + x] = v;
  }
  return (x, y) => {
    const i = Math.floor(x), j = Math.floor(y);
    if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) return !!outdoor;
    return sky[j * grid.cols + i] === 1;
  };
}

/**
 * The daylight coming in through every opening right now.
 * @param {Array} segs  the map's wall segments
 * @param {object} state  {doors} as for prepare()
 * @param {object} o
 * @param {{cols, rows}} o.grid
 * @param {'bright'|'dim'|'dark'} o.sky  the sky light now
 * @param {boolean} [o.outdoor]  an outdoor map (open to the sky away from regions)
 * @param {Array} [o.regions]  the map's lighting regions
 * @param {object} [o.daylight]  radii, default DAYLIGHT
 * @returns {Array<{id, at, bright, dim, walls: true, angle: 180, rotation, opening}>}  lights for LightCache
 *   (ids are stable: `day:<wall id>:<n>`); an opening narrower than a square lets in proportionally less
 */
export function daylightLights(segs, state = {}, o) {
  const sky = o.sky || 'bright';
  if (sky === 'dark') return [];
  const d = o.daylight || DAYLIGHT;
  const radii = sky === 'bright' ? { bright: d.bright, dim: d.dim } : { bright: 0, dim: d.dusk };
  const isSky = skyTest(o.grid, o);
  const doors = (state && state.doors) || {};
  const out = [];
  for (const s of segs) {
    const v = senseOf(s, s.door ? doors[s.door.id] : undefined).light;
    if (v !== SENSE.NONE && v !== SENSE.PROXIMITY) continue;   // walls, closed doors, curtains: no daylight
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const nx = -dy / len, ny = dx / len;                        // one side of the opening
    const mx = (s.a[0] + s.b[0]) / 2, my = (s.a[1] + s.b[1]) / 2;
    const left = isSky(mx + nx * PROBE, my + ny * PROBE), right = isSky(mx - nx * PROBE, my - ny * PROBE);
    if (left === right) continue;                               // sky both sides, or roof both sides
    const ix = left ? -nx : nx, iy = left ? -ny : ny;           // into the room
    const rotation = ((Math.atan2(iy, ix) * 180) / Math.PI + 360) % 360;
    const scale = Math.min(1, len);                             // an arrow slit lets in a thin beam
    const n = Math.max(1, Math.round(len));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      out.push({
        id: `day:${s.id}:${i}`,
        at: [s.a[0] + dx * t + ix * INSET, s.a[1] + dy * t + iy * INSET],
        bright: radii.bright * scale, dim: radii.dim * scale,
        walls: true, angle: 180, rotation, opening: s.id,
      });
    }
  }
  return out;
}
