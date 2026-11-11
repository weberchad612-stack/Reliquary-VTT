// Area templates on the board: colours, records, where remove buttons go and who an area targets.
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

/** Tokens that can be targeted: not markers, not GM-only notes, not the dead. */
export const TARGETABLE = (t) => !!t && t.kind !== 'marker' && t.kind !== 'gm' && !t.dead;

/**
 * Whom placing an area targets: every targetable token it reaches that the view can see, the caster too when
 * inside. An emanation targets its caster even though its own space is not part of the area (T removes it).
 * @param {object} tokens  {id: token}
 * @param {{inArea: function, visible: function, caster?: string, includesCaster?: boolean}} o
 *   inArea(pool) -> {in: ids, over: ids} (Engine.tokensInArea: heights included); visible(id) -> boolean
 * @returns {{ids: string[], over: string[]}}  over: in the area's squares but above or below its reach
 */
export function areaTargets(tokens, { inArea, visible, caster, includesCaster = false }) {
  const pool = Object.fromEntries(Object.entries(tokens || {}).filter(([id, t]) => TARGETABLE(t) && visible(id)));
  const r = inArea(pool), ids = [...r.in];
  if (includesCaster && caster && pool[caster] && !ids.includes(caster)) ids.unshift(caster);
  return { ids, over: r.over.filter((id) => id !== caster) };
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
export function templateRecord({ shape, ft, area, caster, casterName, by, col, at, map, widthFeet, height = 0 }) {
  const r = { map, shape, ft, by, origin: area.origin.map((v) => Math.round(v * 1000) / 1000), cells: area.cells, col, at };
  if (height) r.height = height;   // feet: a burst's point, or a cone's, line's or emanation's caster elevation
  if (caster) { r.caster = caster; r.casterName = casterName || caster; }
  if (shape === 'cone') r.dir = area.dir;
  if (shape === 'line') { r.angle = Math.round(area.angle * 1e4) / 1e4; if (widthFeet) r.width_ft = widthFeet; }
  return r;
}
