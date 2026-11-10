// Terrain: areas of squares that change how creatures move (difficult terrain, water, slopes...).
// Implements docs/design/maps.md section 9a. Dependency-free; runs in the browser and in Node.
//
// The engine only knows where each area is and which squares a move enters. What an area costs, who
// ignores it and which checks it calls for come from the ruleset (rulesets/<system>/terrain.js), so the
// same data serves any game system.
//
// An area: {id, kind, cause?, magical?, dc?, label?, note?, cells?: [[x, y]...], rects?: [[x, y, w, h]...]}
// Pack areas come from the map's terrain.json; the save adds temporary areas (state.terrain), switches
// pack areas off (state.terrain_off, a list of area ids), for example once rubble is cleared, and switches
// on areas that start inactive (active: false; state.terrain_on), for example once a bridge collapses.

/** Every square [x, y] of an area (cells and rects together, without repeats). */
export function areaCells(area) {
  const out = [], seen = new Set();
  const add = (x, y) => { const k = x + ',' + y; if (!seen.has(k)) { seen.add(k); out.push([x, y]); } };
  for (const [x, y] of area.cells || []) add(x, y);
  for (const [x, y, w, h] of area.rects || []) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) add(x + i, y + j);
  return out;
}

/**
 * Squares to rectangles: merge runs along each row, then stack equal runs on consecutive rows.
 * Used to store areas compactly. Returns [[x, y, w, h]...].
 */
export function cellsToRects(cells) {
  const rows = new Map();
  for (const [x, y] of cells) { if (!rows.has(y)) rows.set(y, new Set()); rows.get(y).add(x); }
  const runs = [];
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const xs = [...rows.get(y)].sort((a, b) => a - b);
    for (let i = 0; i < xs.length;) {
      let j = i; while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
      runs.push([xs[i], y, xs[j] - xs[i] + 1]); i = j + 1;
    }
  }
  const open = new Map(), rects = [];   // key "x,w" -> rect still growing downward
  for (const [x, y, w] of runs) {
    const k = x + ',' + w, r = open.get(k);
    if (r && r[1] + r[3] === y) r[3]++;
    else { const n = [x, y, w, 1]; rects.push(n); open.set(k, n); }
  }
  return rects;
}

/**
 * Index of the terrain on one map: which areas cover each square.
 * @param {Array} areas  pack areas (terrain.json `areas`)
 * @param {object} [state]  map state from the save: {terrain?: Array, terrain_off?: Array<string>}
 */
export class TerrainMap {
  constructor(areas = [], state = {}) {
    const off = new Set(state.terrain_off || []), on = new Set(state.terrain_on || []);
    const applies = (a) => !off.has(a.id) && (a.active !== false || on.has(a.id));
    this.areas = [...areas.filter(applies), ...(state.terrain || [])];
    this.byCell = new Map();
    for (const a of this.areas) {
      for (const [x, y] of areaCells(a)) {
        const k = x + ',' + y;
        if (!this.byCell.has(k)) this.byCell.set(k, []);
        this.byCell.get(k).push(a);
      }
    }
  }

  /** Areas covering square (x, y). */
  at(x, y) { return this.byCell.get(x + ',' + y) || []; }

  /** Areas covering any square of a space (top-left x, y; side `size` in cells). */
  inSpace(x, y, size = 1) {
    const s = Math.max(1, Math.ceil(size)), out = new Set();
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) for (const a of this.at(Math.floor(x) + i, Math.floor(y) + j)) out.add(a);
    return [...out];
  }

  /**
   * Areas a move enters: those covering squares of the new space that were not part of the old space.
   * A creature already standing in difficult terrain pays again for each new square it enters; a Large
   * creature pays once per step even if several new squares are difficult (the worst one counts).
   */
  entered(fromX, fromY, toX, toY, size = 1) {
    const s = Math.max(1, Math.ceil(size)), out = new Set();
    const inOld = (cx, cy) => fromX != null && cx >= fromX && cx < fromX + s && cy >= fromY && cy < fromY + s;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const cx = toX + i, cy = toY + j;
      if (inOld(cx, cy)) continue;
      for (const a of this.at(cx, cy)) out.add(a);
    }
    return [...out];
  }
}

/**
 * The movement engine's enterCost option for one mover, from a ruleset.
 * @param {TerrainMap} terrain
 * @param {{cost: function}} rules  ruleset terrain rules: cost(areas, mover) -> {extra, blocked}
 * @param {object} mover  the moving creature as the ruleset describes it (speeds, what it ignores)
 * @returns {function(x, y, size, fromX, fromY): number}  extra cost in cells (Infinity: cannot Stride there)
 */
export function terrainEnterCost(terrain, rules, mover) {
  return (x, y, size, fromX, fromY) => {
    const areas = terrain.entered(fromX, fromY, x, y, size);
    if (!areas.length) return 0;
    const r = rules.cost(areas, mover);
    return r.blocked ? Infinity : r.extra;
  };
}

/**
 * What a route crosses, step by step: the areas each step enters and the ruleset's notes on them
 * (checks to make, damage, a move that needs another action than Stride). For warnings on the board
 * and for Claude's narration. `path` is the list of top-left cells from movement.path().
 */
export function routeTerrain(terrain, rules, mover, path, size = 1) {
  const steps = [];
  for (let i = 1; i < path.length; i++) {
    const [fx, fy] = path[i - 1], [x, y] = path[i];
    const areas = terrain.entered(fx, fy, x, y, size);
    if (!areas.length) continue;
    const r = rules.cost(areas, mover);
    steps.push({ step: i, cell: [x, y], areas: areas.map((a) => a.id), extra: r.extra, blocked: !!r.blocked, notes: r.notes || [] });
  }
  return steps;
}
