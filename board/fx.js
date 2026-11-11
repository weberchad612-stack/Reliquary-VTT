// Visual effect plays: the records Claude writes from chat (fx/<id>), which plays a board starts, and where each
// play goes. Pure functions; board/app.js draws them with the engine's player (engine/fx/fx.js), tools/fx.mjs
// writes them. Docs: docs/design/board.md section 7 (visual effects), docs/best-practices/board.md.
//
// A play record, fx/<time>-<n>:
//   {map, name, from?, to?, o?, by, ts}
//   from: a token id, or [x, y] (cells; fractions allowed)
//   to:   a token id; a list of token ids; 'targets' (the GM's targets, else the player's, when it plays);
//         [x, y] (cells); or 'template:<id>' (a placed area template: its squares are filled)
//   o:    {result: 'hit'|'crit'|'miss', results: {id: result}, text, texts: {id: text}, n, colour, kind, traits,
//          gm: true (the GM view only), seed}
// Every board plays a record once, when it arrives; a board that opens later does not replay what is already
// there. Records that arrive together (after a reconnect) play only if written within PLAY_WINDOW of the newest:
// clocks differ between machines, so times are compared with each other, not with this screen's clock. Old
// records are removed (stale()).

export const FX_COLLECTION = 'fx';
export const PLAY_WINDOW = 60 * 1000;      // a record older than this when it arrives is not played
export const KEEP = 10 * 60 * 1000;        // records older than this are removed
export const STAGGER = 220;                // ms between the targets of one play
export const RESULTS = ['hit', 'crit', 'miss'];
export const PREF_KEY = 'reliquary.fx';    // per browser: '0' turns effects off

let counter = 0;
/** A record id that sorts by time: <ms>-<n>. */
export function fxId(now = Date.now(), n = counter++) { return `${now}-${String(n % 1000).padStart(3, '0')}`; }

/** The time a record was written: its ts, else its id's time. */
export function recordTime(e) {
  const d = (e && e.data) || {};
  if (Number.isFinite(d.ts)) return d.ts;
  const t = Number(String(e && e.id).split('-')[0]);
  return Number.isFinite(t) ? t : 0;
}

const isCell = (v) => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n));
const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9_.-]+$/.test(v);

/** Check a play and make its record. Throws with a plain message when something is wrong. */
export function fxRecord({ map, name, from, to, o = {}, by = 'claude', now = Date.now() }) {
  if (!map) throw new Error('a play needs its map');
  if (!/^[a-z][a-z0-9_]*$/.test(String(name || ''))) throw new Error(`effect names are lower case with underscores: "${name}"`);
  if (from !== undefined && !isId(from) && !isCell(from)) throw new Error('from is a token id or [x, y] in cells');
  const okTo = (v) => isId(v) || isCell(v);
  if (to !== undefined && !(okTo(to) || (Array.isArray(to) && to.length && to.every(isId)) || /^template:/.test(String(to)))) {
    throw new Error('to is a token id, a list of ids, "targets", [x, y] in cells, or "template:<id>"');
  }
  if (o.result && !RESULTS.includes(o.result)) throw new Error(`result is one of ${RESULTS.join(', ')}`);
  for (const r of Object.values(o.results || {})) if (!RESULTS.includes(r)) throw new Error(`results are ${RESULTS.join(', ')}`);
  if (o.n !== undefined && !(Number.isInteger(o.n) && o.n >= 1 && o.n <= 10)) throw new Error('n is a whole number from 1 to 10');
  if (o.colour && !/^#[0-9a-f]{3,8}$/i.test(o.colour)) throw new Error('colour is a #hex colour');
  const clean = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const rec = { map, name, by, ts: now };
  if (from !== undefined) rec.from = from;
  if (to !== undefined) rec.to = to;
  if (Object.keys(clean).length) rec.o = clean;
  return rec;
}

/**
 * The records a board should play now, oldest first, and remember as played. The first call (seen empty and
 * first = true) only remembers what is there: a board that opens does not replay the past.
 * @param {Array<{id, path, data}>} list  the fx collection
 * @param {Set<string>} seen  ids already played or skipped (updated)
 */
export function newPlays(list, seen, { map, first = false, window = PLAY_WINDOW } = {}) {
  const out = [], newest = Math.max(0, ...list.map(recordTime));
  for (const e of [...list].sort((a, b) => recordTime(a) - recordTime(b) || String(a.id).localeCompare(String(b.id)))) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    if (first) continue;
    if (map && e.data && e.data.map !== map) continue;
    if (newest - recordTime(e) > window) continue;
    out.push(e);
  }
  return out;
}

/** Records old enough to remove. */
export function stale(list, now = Date.now(), keep = KEEP) { return list.filter((e) => now - recordTime(e) > keep); }

/**
 * Who a play goes to: [{id?, cell?, template?, result, text}], one per target in order.
 * @param {object} rec  the play record
 * @param {object} ctx  {tokens: {id: token}, targets: {gm: ids, player: ids}, templates: {id: template}}
 */
export function playTargets(rec, ctx) {
  const o = rec.o || {}, tokens = ctx.tokens || {};
  const one = (t) => ({ ...t, result: (t.id && o.results && o.results[t.id]) || o.result, text: (t.id && o.texts && o.texts[t.id] !== undefined) ? o.texts[t.id] : o.text });
  const to = rec.to;
  if (to === undefined) return [one({})];
  if (to === 'targets') {
    const t = ctx.targets || {}, ids = ((t.gm && t.gm.length) ? t.gm : (t.player || [])).filter((id) => tokens[id]);
    return ids.map((id) => one({ id }));
  }
  if (typeof to === 'string' && to.startsWith('template:')) {
    const id = to.slice(9), tp = (ctx.templates || {})[id];
    return tp ? [one({ template: id })] : [];
  }
  if (isCell(to)) return [one({ cell: to })];
  const ids = Array.isArray(to) ? to : [to];
  return ids.filter((id) => tokens[id]).map((id) => one({ id }));
}

/**
 * Where an area template's effect aims (cells): a burst or an emanation at its origin, a line at its far end,
 * a cone at the middle of its squares. And its squares, for the fill.
 */
export function templateAim(t) {
  const cells = t.cells || [], centre = (c) => [c[0] + 0.5, c[1] + 0.5];
  if (!cells.length) return { b: t.origin, cells };
  if (t.shape === 'burst' || t.shape === 'emanation') return { b: t.origin, cells };
  if (t.shape === 'line') {
    let far = cells[0], d = -1;
    for (const c of cells) { const k = Math.hypot(c[0] + 0.5 - t.origin[0], c[1] + 0.5 - t.origin[1]); if (k > d) { d = k; far = c; } }
    return { b: centre(far), cells };
  }
  const sx = cells.reduce((s, c) => s + c[0] + 0.5, 0) / cells.length, sy = cells.reduce((s, c) => s + c[1] + 0.5, 0) / cells.length;
  return { b: [sx, sy], cells };
}

/** The libraries for a lookup, most specific first: the pack's (record fxlib/pack), then the ruleset's. */
export function libraries(pack, ruleset) {
  return [pack && pack.effects ? { via: 'pack', ...pack } : null, ruleset ? { via: 'ruleset', ...ruleset } : null].filter(Boolean);
}

/** The palette a play uses: the ruleset's, with the pack's over it. */
export function paletteOf(libs) { return Object.assign({}, ...[...libs].reverse().map((l) => l.palette || {})); }

/** Effects for the GM's preview list: [{group, items: [{name, label, via}]}], filtered by a search. */
export function previewList(libs, query = '') {
  const q = query.trim().toLowerCase(), seen = new Set(), groups = new Map();
  for (const lib of libs) {
    for (const [name, e] of Object.entries(lib.effects || {})) {
      if (seen.has(name)) continue;
      seen.add(name);
      if (q && !(name.includes(q) || String(e.label || '').toLowerCase().includes(q) || String(e.group || '').toLowerCase().includes(q))) continue;
      const g = e.group || 'Other';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push({ name, label: e.label || name, via: lib.via, attack: !!e.attack, area: e.kind === 'area' });
    }
  }
  return [...groups].map(([group, items]) => ({ group, items }));
}

/** This browser's setting: effects on unless turned off. Storage may be missing (private windows). */
export function prefStore(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  return {
    on() { try { return !storage || storage.getItem(PREF_KEY) !== '0'; } catch (e) { return true; } },
    set(v) { try { if (storage) storage.setItem(PREF_KEY, v ? '1' : '0'); } catch (e) { /* kept for this page only */ } },
  };
}
