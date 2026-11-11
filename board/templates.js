// Area templates on the board: colours, records, remove markers and who an area targets.
// Pure functions; board/app.js draws and wires them. The shapes come from engine/areas (Engine.buildArea).
// Docs: docs/design/board.md section 7 (area templates), docs/best-practices/board.md.

/** One colour per template, in this order (the first free one is used). */
export const TEMPLATE_COLOURS = Object.freeze(['#ff8a1f', '#2f8cff', '#2fc46a', '#e040c8', '#f2d12b', '#1fd1d1', '#9a6bff', '#a6e22e', '#ff7eb6', '#ff4d4d']);

/** '#rrggbb' with alpha a, as rgba(). */
export function hexA(h, a) {
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export const colourOf = (t) => TEMPLATE_COLOURS[((t && t.col) || 0) % TEMPLATE_COLOURS.length];

/** The first palette colour no template on the map uses (wrapping round when all are taken). */
export function nextColour(templates) {
  const list = Object.values(templates || {});
  const used = new Set(list.map((t) => (t.col || 0) % TEMPLATE_COLOURS.length));
  for (let i = 0; i < TEMPLATE_COLOURS.length; i++) if (!used.has(i)) return i;
  return list.length % TEMPLATE_COLOURS.length;
}

/** A new template id: time-ordered, lower case (map-state schema: ^[a-z0-9][a-z0-9-]*$). */
export function templateId(now = Date.now(), rand = Math.random()) {
  return now.toString(36).padStart(9, '0') + '-' + Math.floor(rand * 36 ** 3).toString(36).padStart(3, '0');
}

/** Players remove the templates the player view placed; the GM view removes any. */
export const canRemove = (t, view) => view === 'gm' || t.by === 'player';

/** Where a template's remove marker sits (cells): just past its origin, in the way it points. */
export function markerOf(t) {
  const [ox, oy] = t.origin;
  if (t.shape === 'cone') {
    const d = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]][t.dir || 0], n = Math.hypot(d[0], d[1]);
    return [ox + (d[0] / n) * 0.4, oy + (d[1] / n) * 0.4];
  }
  if (t.shape === 'line') return [ox + Math.cos(t.angle || 0) * 0.4, oy + Math.sin(t.angle || 0) * 0.4];
  if (t.shape === 'emanation') return [ox + 0.5, oy - 0.5];   // the caster's top right corner (Medium)
  return [ox, oy];
}

/** Remove markers for the templates, oldest first, nudged apart where two would sit on each other. */
export function markerPoints(templates) {
  const out = {}, used = [];
  for (const id of Object.keys(templates || {}).sort()) {
    let [x, y] = markerOf(templates[id]);
    for (let i = 0; i < 8 && used.some(([u, v]) => Math.abs(u - x) < 0.55 && Math.abs(v - y) < 0.55); i++) x += 0.55;
    used.push([x, y]);
    out[id] = [x, y];
  }
  return out;
}

/** The template whose marker is under point p (cells), among those `view` may remove; or null. */
export function markerAt(templates, p, view, radius = 0.3) {
  const pts = markerPoints(templates);
  let best = null;
  for (const [id, [x, y]] of Object.entries(pts)) {
    if (!canRemove(templates[id], view)) continue;
    if (Math.hypot(p[0] - x, p[1] - y) <= radius) best = id;
  }
  return best;
}

/** Tokens that can be targeted: not markers, not GM-only notes. */
export const TARGETABLE = (t) => !!t && t.kind !== 'marker' && t.kind !== 'gm';

/**
 * Whom placing an area targets: every targetable token in it that the view can see, the caster too when
 * inside. An emanation targets its caster even though its own space is not part of the area (T removes it).
 * @param {Array} cells
 * @param {object} tokens  {id: token}
 * @param {{inCells: function, visible: function, caster?: string, includesCaster?: boolean}} o
 *   inCells(cells, tokens) -> ids (Engine.tokensInCells); visible(id) -> boolean
 */
export function areaTargets(cells, tokens, { inCells, visible, caster, includesCaster = false }) {
  const pool = Object.fromEntries(Object.entries(tokens || {}).filter(([id, t]) => TARGETABLE(t) && visible(id)));
  const ids = inCells(cells, pool);
  if (includesCaster && caster && pool[caster] && !ids.includes(caster)) ids.unshift(caster);
  return ids;
}

/** A size typed in the picker, as feet: whole squares, at least one, at most `max`. NaN when not a number. */
export function sizeFeet(v, squareFeet = 5, max = 500) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return Math.max(squareFeet, Math.min(max, Math.round(n / squareFeet) * squareFeet));
}

/**
 * The template record (map-state templates.<id> plus the map it is on).
 * @param {{shape, ft, area, caster?, casterName?, by, col, at, map, widthFeet?}} o  area from Engine.buildArea
 */
export function templateRecord({ shape, ft, area, caster, casterName, by, col, at, map, widthFeet }) {
  const r = { map, shape, ft, by, origin: area.origin.map((v) => Math.round(v * 1000) / 1000), cells: area.cells, col, at };
  if (caster) { r.caster = caster; r.casterName = casterName || caster; }
  if (shape === 'cone') r.dir = area.dir;
  if (shape === 'line') { r.angle = Math.round(area.angle * 1e4) / 1e4; if (widthFeet) r.width_ft = widthFeet; }
  return r;
}

/** The menu commands this module answers, by shape. */
export const TEMPLATE_COMMANDS = Object.freeze({ 'tpl-burst': 'burst', 'tpl-cone': 'cone', 'tpl-line': 'line', 'tpl-emanation': 'emanation' });
