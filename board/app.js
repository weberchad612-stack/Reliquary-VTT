// The board: the live table page (docs/design/board.md). It runs the map engine on the campaign held in a
// store (board/store.js): on the published board, its database; in the demo and tests, memory. It reads
// the campaign when it starts, writes what the player (or the GM view) changes, and redraws when Claude
// changes something. Grown out of the engine demo page; the drawing and input code is the demo's.
//
// Keeping the table in step with the store (the end of start()):
// - persist(): after every redraw, the records the board's state implies (tokens, the map's state, the
//   table's settings) are compared with the last known store values; only changed records are written,
//   each with a change-log entry saying who changed what.
// - the watchers: a change arriving from the store (Claude moving a foe, opening a door) is compared the
//   same way, applied to the board's state and redrawn. Our own writes come back unchanged and are ignored.
// - the explored area is written a moment after it grows, in chunks.
// - a different campaign or map in the store reloads the page.

import { MemoryStore } from './store.js';
import { platformStore } from './platform.js';
import { mapFromRecords, exploredFromRecords, exploredRecords } from './records.js';
import { makeShell, pageMap } from './shell.js';
import { startArea } from './area.js';
import { wheelZoomFactor, pinchStep, isDrag } from './gestures.js';
import { kindColour, SELECTED_COLOUR, toggleTarget, markSquare, chevrons } from './targeting.js';

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Drop empty objects and arrays (and undefined), so equal states compare equal however they were built. */
export function prune(v) {
  if (Array.isArray(v)) return v.map(prune);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      const p = prune(x);
      if (p === undefined) continue;
      if (p && typeof p === 'object' && !Array.isArray(p) && !Object.keys(p).length) continue;
      if (Array.isArray(p) && !p.length) continue;
      out[k] = p;
    }
    return out;
  }
  return v;
}

/** JSON with object keys sorted, for comparing records. */
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

/**
 * Start the page: on memory with a seed campaign ({records, assets}), otherwise on the board's database.
 * @param {object|null} seed
 */
export async function boot(seed, build = null) {
  showBuild(build);
  if (seed) return start(new MemoryStore(seed.records, seed.assets || {}, { latency: seed.latency || 0 }), { build });
  const store = await platformStore();
  if (!store) return showMessage('This board has no database to read from. Open it as a published board, or build it with a seed campaign.');
  return start(store, { build });
}

/** The version badge beside the title: the build's date and time; its tooltip says which commit. */
export function showBuild(build) {
  const b = document.getElementById('bver');
  if (!b || !build) return;
  b.textContent = build.version;
  const when = build.built_at ? new Date(build.built_at).toLocaleString() : '';
  b.title = `Board version ${build.version}, built ${when} from ${build.commit ? 'commit ' + build.commit : 'no commit'}${build.dirty ? ' + uncommitted changes' : ''}.`;
  b.hidden = false;
}


/** Show a message in place of the map. */
export function showMessage(text) {
  const stage = document.getElementById('stage');
  const p = document.createElement('p');
  p.className = 'board-message';
  p.textContent = text;
  stage.replaceChildren(p);
  document.getElementById('campaign-title').textContent = 'Reliquary Virtual Tabletop';
}

/**
 * Run the board on a store holding a campaign.
 * @param {object} store  see board/store.js
 */
export async function start(store, { build = null } = {}) {
  const slow = setTimeout(() => showMessage('The board is waiting for its database... If this does not clear, check your connection and reload.'), 10000);
  let META;
  try { META = await store.get('board/meta'); } catch (e) { clearTimeout(slow); return showMessage(`The board cannot read its database (${(e && e.code) || e}).`); }
  clearTimeout(slow);
  if (!META) {
    // an empty board waits for a campaign: when Claude loads one (board/meta is written last), start on it
    showMessage('No campaign is loaded on this board yet. Ask Claude to load one; it will appear here by itself.');
    const off = store.watch('board/meta', (m) => { if (m) { off(); location.reload(); } });
    return;
  }
  // The campaign's game system: measurement and other rules settings (rulesets/<id>/system.js)
  const SYS = Engine.systemConfig(META.ruleset);
  if (!SYS) return showMessage(`This campaign uses the "${META.ruleset}" rules, which this board does not have yet.`);
  let TABLE = (await store.get('state/table')) || {};
  const NOTES = TABLE.notes || {};
  const PARTY_MAP = TABLE.current_map || (META.maps || [])[0];
  // The GM's preview of another map: this screen only; nothing is written while it is shown.
  const PAGE = pageMap(META, PARTY_MAP);
  const keepGM = PAGE.keepGM, PREVIEW = PAGE.preview, READONLY = PAGE.readOnly, MAP_ID = PAGE.mapId;
  const recs = {};
  for (const p of [`maps/${MAP_ID}`, `terrain/${MAP_ID}`, `lighting/${MAP_ID}`]) { const d = await store.get(p); if (d) recs[p] = d; }
  for (const e of await store.list('walls')) if (e.data.map === MAP_ID) recs[e.path] = e.data;
  const MAPDATA = mapFromRecords(recs, MAP_ID);
  if (!MAPDATA) return showMessage(`The map "${MAP_ID}" is not on this board.`);
  if (MAPDATA.map.kind === 'area') {
    // A town or region: a picture with places, not a battle map (board/area.js).
    return startArea(store, { meta: META, table: TABLE, page: PAGE, partyMap: PARTY_MAP, map: MAPDATA.map, mapState: (await store.get(`mapstate/${MAP_ID}`)) || {}, build });
  }
  const DATA = { ...MAPDATA, image: MAPDATA.map.image && MAPDATA.map.image.asset ? store.assetUrl(MAPDATA.map.image.asset) : null };
  const MS = (await store.get(`mapstate/${MAP_ID}`)) || {};
  const TOKENS0 = {};
  for (const e of await store.list('tokens')) if (e.data.map === MAP_ID) { const { map: _m, ...t } = e.data; TOKENS0[e.id] = t; }
  const ex = (await store.list('explored')).filter((e) => e.data.map === MAP_ID).map((e) => e.data);
  const EXPLORED0 = ex.length ? exploredFromRecords(ex) : null;

  const { map, segs } = DATA;
  // Feet per square: the map's own scale if it gives one, else the system's square (PF2E: 5 ft)
  const G = map.grid, CS = G.cell_px, FPC = G.feet_per_cell || SYS.measurement.squareFeet;
  const OX = G.origin_px[0], OY = G.origin_px[1];
  const W = map.image.w, H = map.image.h;
  const RANGE = Infinity;   // PF2E vision has no range: walls and darkness limit sight
  const PCS = () => new Set(Object.entries(TOKENS0).filter(([, t]) => t.kind === 'pc').map(([id]) => id));

  // The table's state on this map, as loaded; kept in step with the store by persist() and the watchers.
  const START = () => ({
    view: 'player',
    walls: false,
    doors: clone(MS.doors || {}),
    locked_known: clone(MS.locked_known || []),
    terrain: clone(MS.terrain || []),            // temporary terrain from play (a spell's entangling plants)
    terrain_on: clone(MS.terrain_on || []),      // pack areas that start switched off and now apply (a bridge has collapsed)
    terrain_off: clone(MS.terrain_off || []),    // pack areas that no longer apply
    links_found: clone(MS.links_found || []),
    lights: clone(MS.lights || {}),              // static lights changed in play: {id: {on?, colour?, intensity?, animation?}}
    regions: clone(MS.regions || {}),            // lighting regions changed in play: {id: {colour?, intensity?}}
    regions_off: clone(MS.regions_off || []),    // lighting regions that no longer apply
    light_colour: { on: true, strength: 25, ...(TABLE.light_colour || {}) },   // the table-wide coloured-light switch and strongest tint (%)
    light_animation: { on: true, ...(TABLE.light_animation || {}) },           // the table-wide switch for animated lights
    sky: TABLE.sky_light || 'bright',            // sky light for outdoor maps and sky regions
    hiddenMarks: clone(MS.hidden_marks || {}),   // GM-placed "hidden" markers: foe id -> square where the party thinks it is
    tokens: clone(TOKENS0),
  });
  let S = START();
  let shellReady = false;   // the shell (menus) is made near the end of start()
  let mask = EXPLORED0 ? Engine.ExploredMask.fromExplored(EXPLORED0, G) : new Engine.ExploredMask(G);
  let selected = null, drag = null, hoverCell = null, lastSeen = PCS();
  // Several tokens selected (a box, or Ctrl+click): this screen only. While it holds two or more, `selected`
  // is null, so the map shows the party's view with no movement outlines (as with nothing selected).
  let multi = new Set();
  // Hover and targets (board/targeting.js). Targets are shared through the store: targets/player and
  // targets/gm, each {ids}; this view edits its own list, and the GM view also shows the player's.
  let hoverId = null;
  const TARGETS = { player: [], gm: [] };
  const selectedIds = () => (multi.size ? [...multi] : selected ? [selected] : []);
  /** Set the selection from a list of ids: one becomes the single selection, two or more a multi-selection. */
  function setSelection(ids) {
    const list = [...new Set(ids)].filter((id) => S.tokens[id]);
    multi = new Set(list.length > 1 ? list : []);
    selected = list.length === 1 ? list[0] : null;
  }
  let gen = 0;   // bumped by every recompute(): cached drawings and the focus view key on it

  const img = new Image();
  img.src = DATA.image || '';
  const canvas = document.getElementById('map');
  const ctx = canvas.getContext('2d');
  const fog = document.createElement('canvas'); fog.width = W; fog.height = H;
  const fctx = fog.getContext('2d');
  let scale = 1;

  // ---------- engine glue ----------
  const state = () => ({ doors: S.doors });
  let layout = { spaces: new Map(), overfull: [] };
  const raw = () => Object.entries(S.tokens).map(([id, t]) => ({ id, ...t }));
  /** Lay out Tiny tokens and keep each one's quadrant on the token, so it stays put. */
  function relayout() {
    layout = Engine.layoutTiny(raw());
    for (const [id, sp] of layout.spaces) {
      if (sp.slot === null) delete S.tokens[id].slot; else S.tokens[id].slot = sp.slot;
    }
  }
  const space = (id) => Engine.spaceOf({ id, ...S.tokens[id] }, layout);       // sight, being seen, drawing
  const mspace = (id) => Engine.moveSpaceOf({ id, ...S.tokens[id] });           // movement
  const tokenList = () => raw().map((t) => ({ ...t, ...space(t.id) }));
  const opts = { rangeFt: RANGE, feetPerCell: FPC, grid: G };
  let view = null, sightSegs = null, moveWalls = null, terrain = null;
  const PACK_TERRAIN = DATA.terrain || [];
  // ---------- light ----------
  const LIGHTING = DATA.lighting || { regions: [], lights: [] };
  const HAS_LIGHTING = !!(DATA.lighting || map.base_light || map.outdoor);   // maps without lighting data stay fully lit
  let LIT = HAS_LIGHTING;   // the Lighting button switches the whole light system off (everything bright) and on
  const HAS_SKY = !!map.outdoor || (LIGHTING.regions || []).some((r) => r.level === 'sky');
  const lightCache = new Engine.LightCache(G, { feetPerCell: FPC });
  let lightMap = null;
  const staticOn = (l) => (S.lights[l.id] && S.lights[l.id].on !== undefined ? S.lights[l.id].on : l.on !== false);
  /** A static light as it is now: the pack's, with any colour and intensity changed in play. */
  const staticSpec = (l) => Engine.lightSpec({ ...l, ...pick(S.lights[l.id], ['colour', 'intensity', 'animation']) });
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
  /** The map's lighting regions as they are now: switched-off ones dropped, colour and intensity changes applied. */
  const regionsNow = () => (LIGHTING.regions || []).filter((r) => !S.regions_off.includes(r.id)).map((r) => ({ ...r, ...pick(S.regions[r.id], ['colour', 'intensity']) }));
  /** Every light that is on now: the map's static lights and the lights tokens carry (always circles). */
  function lightsNow() {
    const out = [];
    for (const l of LIGHTING.lights || []) {
      if (!staticOn(l)) continue;
      out.push({ id: l.id, at: l.at, walls: l.walls, angle: l.angle, rotation: l.rotation, ...staticSpec(l) });
    }
    for (const [id, t] of Object.entries(S.tokens)) {
      if (!t.light || t.light.on === false) continue;
      const sp = mspace(id), c = Engine.isTiny(t) ? 0.25 : sp.size / 2;
      out.push({ id: 'tok:' + id, at: [sp.x + c, sp.y + c], ...Engine.lightSpec(t.light) });
    }
    return out;
  }
  let lightGen = 0;   // bumped when the light map is rebuilt (colour and intensity changes rebuild only it)
  function buildLightMap() {
    lightMap = new Engine.LightMap(G, {
      base: map.outdoor ? 'sky' : (map.base_light || 'dark'), sky: S.sky, regions: regionsNow(),
      walls: Engine.prepareLight(segs, state()), feetPerCell: FPC,   // region edges fade, except along walls
      patches: lightCache.patchesFor([...lightsNow(), ...daylightNow()], segs, state(), JSON.stringify(S.doors)),
    });
    lightGen++;
  }
  /** A change that only alters how light looks (colour, intensity): rebuild the light map and redraw. */
  function relight() { if (LIT) buildLightMap(); draw(); }
  /** Daylight coming in through windows, grates and open doors that face open sky (none at night). */
  const daylightNow = () => (HAS_SKY ? Engine.daylightLights(segs, state(), { grid: G, sky: S.sky, outdoor: !!map.outdoor, regions: LIGHTING.regions || [] }) : []);
  const litOpts = () => ({ ...opts, grid: G, light: lightMap, rules: Engine.lightRules });

  // ---------- what the board shows ----------
  // Nothing selected: the party's view, with everything it has explored. A creature selected (the GM: any;
  // a player: a PC): only what that creature perceives now, nothing remembered (docs/design/lighting.md
  // section 11). Deselect to see the explored map again.
  let partyShown = null, focusCache = null;
  const MARKERS_ONLY = new Set(['marker']);
  /** The creature whose eyes the board shows, or null for the party. */
  function focusId() {
    if (!selected || !S.tokens[selected]) return null;
    return S.view === 'gm' || S.tokens[selected].kind === 'pc' ? selected : null;
  }
  const inPolys = (polys) => (x, y) => polys.some((poly) => Engine.pointInPolygon([x, y], poly));
  /** The view being drawn: {focus, visible, explored, mono, perceived, monoMask, seen, concealedFrom, at(x, y)}. */
  function shown() {
    const fid = focusId();
    if (!fid) return partyShown;
    const key = fid + '|' + gen;
    if (focusCache && focusCache.key === key) return focusCache.v;
    const o = { ...(LIT ? litOpts() : opts), canLook: (t) => t.id === fid, alwaysShown: MARKERS_ONLY };
    const v = Engine.partyView(tokenList(), sightSegs, o);
    const visible = LIT ? v.perceived.displayPolys() : v.visible;
    const out = {
      focus: fid, visible, explored: [], mono: LIT ? v.mono.displayPolys() : [], perceived: LIT ? v.perceived : null, monoMask: LIT ? v.mono : null,
      seen: new Set([...v.seen, fid]), concealedFrom: v.concealedFrom || {},
      at: LIT ? (x, y) => !!v.perceived.at(x, y) : inPolys(v.visible),
    };
    focusCache = { key, v: out };
    return out;
  }
  /** The GM's whole-map view (GM view with nothing selected): everything drawn, the party's view shaded. */
  const fullGM = () => S.view === 'gm' && !focusId();
  /** How each kind of terrain is named and marked (the table's red chevrons for difficult terrain). */
  const TERRAIN_LOOK = {
    difficult: { name: 'difficult terrain', colour: '#c62a1c', mark: 'chevron' },
    greater_difficult: { name: 'greater difficult terrain', colour: '#c62a1c', mark: 'chevron2' },
    swim: { name: 'Swim', colour: '#3f8fd8', mark: 'waves' },
    climb: { name: 'Climb', colour: '#e3862f', mark: 'arrow' },
    uneven: { name: 'uneven ground (Balance)', colour: '#e3b330', mark: 'zigzag' },
    narrow: { name: 'narrow surface (Balance)', colour: '#e3b330', mark: 'zigzag' },
    hazardous: { name: 'hazardous terrain', colour: '#d0379a', mark: 'bang' },
  };
  /** The creature as the ruleset sees it when it moves: speeds, flying, what terrain it ignores. */
  const moverOf = (id) => { const t = S.tokens[id]; return { speeds: t.speeds, flying: t.flying, ignoreDifficult: t.ignoreDifficult }; };
  /** Movement options for one creature: the ruleset's diagonals and its terrain costs. */
  const moveOpts = (id) => ({ ...opts, diagonalCosts: SYS.measurement.diagonalCosts, enterCost: Engine.terrainEnterCost(terrain, Engine.terrainRules, moverOf(id)) });
  /** Terrain a route crosses: extra feet and the checks to call for. */
  function routeNotes(id, route) {
    if (!route) return { extraFt: 0, notes: [] };
    const steps = Engine.routeTerrain(terrain, Engine.terrainRules, moverOf(id), route.path, mspace(id).size);
    const notes = [...new Set(steps.flatMap((s) => s.notes))];
    return { extraFt: steps.reduce((n, s) => n + (Number.isFinite(s.extra) ? s.extra : 0), 0) * FPC, notes };
  }

  function recompute(reason) {
    relayout();
    terrain = new Engine.TerrainMap(PACK_TERRAIN, { terrain: S.terrain, terrain_on: S.terrain_on, terrain_off: S.terrain_off });
    sightSegs = Engine.prepare(segs, state(), 'sight');
    moveWalls = Engine.prepareMove(segs, state(), G);
    if (LIT) {
      buildLightMap();
      view = Engine.partyView(tokenList(), sightSegs, litOpts());
      if (mask.addMask(view.perceived)) exploredChanged();
    } else {
      view = Engine.partyView(tokenList(), sightSegs, opts);
      if (mask.add(view.visible)) exploredChanged();
    }
    gen++;
    for (const id of Object.keys(S.hiddenMarks)) if (view.seen.has(id)) delete S.hiddenMarks[id];   // seen again: the marker goes
    const explored = mask.toPolys();     // stored in the save: pixel-exact
    partyShown = {
      focus: null, explored: mask.displayPolys(),   // painted: diagonals as straight lines
      visible: LIT ? view.perceived.displayPolys() : view.visible, mono: LIT ? view.mono.displayPolys() : [],
      perceived: LIT ? view.perceived : null, monoMask: LIT ? view.mono : null,
      seen: view.seen, concealedFrom: view.concealedFrom || {},
      at: LIT ? (x, y) => !!view.perceived.at(x, y) : inPolys(view.visible),
    };
    // announce foes that come into or leave view
    for (const t of tokenList()) {
      if (t.kind === 'pc') continue;
      const was = lastSeen.has(t.id), now = view.seen.has(t.id);
      if (!was && now) log(`${t.name} comes into view.`, 'foe');
      if (was && !now && reason !== 'reset') log(`${t.name} is out of sight.`);
    }
    lastSeen = new Set(view.seen);
    S.explored = explored;
    draw();
  }

  // ---------- doors ----------
  const doorSegs = segs.filter((s) => s.door);
  function doorInfo(s) {
    const live = S.doors[s.door.id] || {};
    const st = live.state || s.door.initial || 'closed';
    const found = s.t !== 'secret' || !!live.found;
    return { st, found, knownLocked: S.locked_known.includes(s.door.id) };
  }
  const mid = (s) => [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
  /** Players see a found door once either side of it is explored; a creature's own view, while it sees one side now. */
  function doorVisibleToPlayers(s) {
    const info = doorInfo(s);
    if (!info.found) return false;
    const [mx, my] = mid(s);
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], L = Math.hypot(dx, dy);
    const nx = -dy / L * 0.35, ny = dx / L * 0.35;
    const F = shown(), at = F.focus ? F.at : (x, y) => mask.at(x, y);
    return !!(at(mx + nx, my + ny) || at(mx - nx, my - ny));
  }
  const leafOf = (s) => Engine.leafShapes(s, { partner: Engine.pairOf(s, segs) });
  /** Click a door leaf. With `both`, a double door's two leaves change together (Shift+click). */
  function clickDoor(s, both = false) {
    const partner = Engine.pairOf(s, segs);
    const leaves = both && partner ? [s, partner] : [s];
    if (S.view === 'gm') {
      const info = doorInfo(s);
      if (s.t === 'secret' && !info.found) {
        for (const l of leaves) S.doors[l.door.id] = { ...(S.doors[l.door.id] || {}), found: true };
        log(`GM: ${s.door.label} marked found. Players now see a closed door.`, 'ok'); return recompute();
      }
      const next = { closed: 'open', open: 'locked', locked: 'closed' }[info.st];
      for (const l of leaves) S.doors[l.door.id] = { ...(S.doors[l.door.id] || {}), state: next };
      log(`GM: ${leaves.map((l) => l.door.label).join(' and ')} ${leaves.length > 1 ? 'are' : 'is'} now ${next}.`, 'ok');
      return recompute();
    }
    const want = doorInfo(s).st === 'open' ? 'closed' : 'open';
    const changed = [];
    for (const l of leaves) {
      const info = doorInfo(l), id = l.door.id;
      if (want === 'open' && info.st === 'locked') {
        if (!info.knownLocked) S.locked_known.push(id);
        toast(`${l.door.label}: locked. It will not open.`);
        log(`${l.door.label} is locked.`, 'warn');
        continue;
      }
      if (info.st === want) continue;
      S.doors[id] = { ...(S.doors[id] || {}), state: want };
      changed.push(l.door.label);
    }
    if (!changed.length) return draw();
    log(`${changed.join(' and ')} ${want === 'open' ? 'opened' : 'closed'}.`, 'ok');
    recompute();
  }

  // ---------- drawing ----------
  const WALL_COLOURS = { solid: '#d9d2c3', terrain: '#e8913a', grate: '#9aa3ad', window: '#46c6e0', slit: '#d055c8', ethereal: '#9a7cf0', door: '#e5615a', secret: '#e3b330' };
  const LEGEND = [['solid', 'Wall'], ['door', 'Door'], ['secret', 'Secret door (GM only until found)'], ['grate', 'Portcullis: see through, cannot pass'], ['window', 'Window: see through, cannot pass'], ['slit', 'Arrow slit: see through only up close'], ['ethereal', 'Force barrier: pass through, cannot see'], ['terrain', 'Curtain: see past one, not two']];
  const TERRAIN_ICON = {
    chevron: 'M3 12 L9 6 L15 12', chevron2: 'M3 9 L9 3 L15 9 M3 15 L9 9 L15 15', waves: 'M2 7 Q5 4 9 7 T16 7 M2 12 Q5 9 9 12 T16 12',
    arrow: 'M9 16 V3 M5 7 L9 3 L13 7', zigzag: 'M2 11 L5.5 6 L9 11 L12.5 6 L16 11', bang: 'M9 3 V11 M9 15 V15.5',
  };
  const terrainKinds = [...new Set(PACK_TERRAIN.map((a) => a.kind))];
  document.getElementById('legend').innerHTML = LEGEND.map(([t, l]) => `<span class="sw" style="background:${WALL_COLOURS[t]}"></span><span>${l}</span>`).join('')
    + terrainKinds.map((k) => `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="${TERRAIN_ICON[TERRAIN_LOOK[k].mark]}" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="${TERRAIN_ICON[TERRAIN_LOOK[k].mark]}" fill="none" stroke="${TERRAIN_LOOK[k].colour}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${TERRAIN_LOOK[k].name[0].toUpperCase() + TERRAIN_LOOK[k].name.slice(1)}</span>`).join('');

  function fit() {
    const stage = document.getElementById('stage');
    const hudH = document.getElementById('hud').offsetHeight || 20;
    const availW = Math.max(260, stage.clientWidth - 32);
    const availH = Math.max(220, stage.clientHeight - 32 - 10 - hudH);
    baseScale = Math.min(1.6, availW / W, window.innerWidth > 860 ? availH / H : Infinity);
    scale = baseScale * zoom;
    document.getElementById('z-lab').textContent = Math.round(zoom * 100) + '%';
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = W * scale + 'px'; canvas.style.height = H * scale + 'px';
    canvas.width = Math.round(W * scale * dpr); canvas.height = Math.round(H * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    animCanvas.style.width = canvas.style.width; animCanvas.style.height = canvas.style.height;
    animCanvas.width = canvas.width; animCanvas.height = canvas.height;
    animCanvas.style.left = canvas.offsetLeft + 'px'; animCanvas.style.top = canvas.offsetTop + 'px';
    for (const c of [tgtCanvas]) {
      c.style.width = canvas.style.width; c.style.height = canvas.style.height;
      c.width = canvas.width; c.height = canvas.height;
      c.style.left = canvas.offsetLeft + 'px'; c.style.top = canvas.offsetTop + 'px';
    }
    draw();
  }
  const P = (c) => c * CS; // cells -> pixels from the grid origin (draw() translates by OX, OY)

  function polyPath(c, poly) {
    c.moveTo(P(poly[0][0]), P(poly[0][1]));
    for (let i = 1; i < poly.length; i++) c.lineTo(P(poly[i][0]), P(poly[i][1]));
    c.closePath();
  }

  function draw() {
    if (!view) return;
    const gm = S.view === 'gm';
    ctx.clearRect(0, 0, W, H);
    if (img.complete) ctx.drawImage(img, 0, 0, W, H);

    const F = shown(), full = fullGM();

    // light: greyscale where only darkvision sees, darker as light fades (GM: the light everywhere)
    if (LIT) drawLight(F, full);

    // terrain marks, under the fog: hidden where unexplored, dimmed where only remembered
    ctx.save(); ctx.translate(OX, OY); drawTerrain(full); ctx.restore();

    // fog of war, painted by the engine: a selected creature's view is drawn as a player sees it
    Engine.paintFog(fctx, { grid: G, explored: F.explored, visible: F.visible, mode: full ? 'gm' : 'player', width: W, height: H });
    ctx.drawImage(fog, 0, 0);
    ctx.save();
    ctx.translate(OX, OY); // everything below is drawn in grid space
    // parts of the image that are not this map (insets): always covered
    ctx.fillStyle = '#14110e';
    for (const h of map.hidden_areas || []) {
      const [x0, y0, x1, y1] = h.cells;
      ctx.fillRect(P(x0), P(y0), P(x1 - x0), P(y1 - y0) + CS);
    }

    // movement range of the selected token: one, two and three Strides (a player's PC, or any token for the GM)
    if (selected && canDrag(selected)) drawMoveBands(F);

    if (S.walls || full) drawWalls(full && !S.walls);
    drawDoors(gm, full);
    if (LIT && gm) { drawRegionOutlines(); drawLightSources(); }   // the GM's marks: players see only the light
    if (drag && drag.route !== undefined) drawRoute();
    const dist = distanceTo(F, full);
    if (dist) drawDistanceLine(dist);   // under the tokens
    drawTokens(F, full);
    if (dist) drawDistanceLabel(dist);
    ctx.restore();
    refreshAnimation(F, full);
    targetsChanged();
    hud();
    schedulePersist();
  }

  function drawWalls(faint) {
    ctx.save(); ctx.lineCap = 'round';
    for (const s of segs) {
      if (!faint && S.view === 'player' && s.t === 'secret' && !doorInfo(s).found) continue;
      ctx.globalAlpha = faint ? 0.45 : 0.95;
      ctx.strokeStyle = WALL_COLOURS[s.t]; ctx.lineWidth = s.door ? 6 : 4;
      ctx.setLineDash(s.t === 'grate' || s.t === 'window' ? [6, 5] : []);
      ctx.beginPath(); ctx.moveTo(P(s.a[0]), P(s.a[1])); ctx.lineTo(P(s.b[0]), P(s.b[1])); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- light drawing ----------
  // Shade over the map by brightness: none in bright light, deepening as light fades, deepest in darkness.
  // gm: the GM's whole-map view; player: what the party (or a selected creature) perceives now.
  const LIGHT_LOOK = { shade: '11, 13, 26', gm: 0.6, player: 0.7, curve: 1.5, on: '#f0b44a', off: '#8a8f99' };
  const shadeTable = (max) => Array.from({ length: 256 }, (_, g) => Math.round(255 * max * Math.pow(1 - g / 255, LIGHT_LOOK.curve)));
  const SHADE_GM = shadeTable(LIGHT_LOOK.gm), SHADE_PLAYER = shadeTable(LIGHT_LOOK.player);
  let lightCanvas = null, lightCanvasFor = null;
  function ringsPath(rings) {
    ctx.beginPath();
    for (const r of rings) { if (r.length < 3) continue; ctx.moveTo(P(r[0][0]), P(r[0][1])); for (let i = 1; i < r.length; i++) ctx.lineTo(P(r[i][0]), P(r[i][1])); ctx.closePath(); }
  }
  function drawLight(F, full) {
    ctx.save(); ctx.translate(OX, OY);
    const key = (full ? 'gm|' : 'view|' + (F.focus || '') + '|') + gen + '|' + lightGen;
    if (colourOn()) drawTint(F, full, key);
    if (lightCanvasFor !== key) {
      lightCanvas = lightCanvas || document.createElement('canvas');
      lightCanvas.width = lightMap.w; lightCanvas.height = lightMap.h;
      const lc = lightCanvas.getContext('2d'), im = lc.createImageData(lightMap.w, lightMap.h);
      const [r, g, b] = LIGHT_LOOK.shade.split(',').map(Number), glow = lightMap.glow;
      const per = F.perceived && F.perceived.bits, mono = F.monoMask && F.monoMask.bits;
      for (let k = 0; k < glow.length; k++) {
        im.data[k * 4] = r; im.data[k * 4 + 1] = g; im.data[k * 4 + 2] = b;
        // what is not perceived counts as dark here so the blur does not lighten the edge of the view
        // (the drawing is clipped to the view); darkvision alone sees without shade, in greyscale
        im.data[k * 4 + 3] = full ? SHADE_GM[glow[k]] : !per[k] ? SHADE_PLAYER[0] : mono[k] ? 0 : SHADE_PLAYER[glow[k]];
      }
      lc.putImageData(im, 0, 0); lightCanvasFor = key;
    }
    if (!full) {
      // visible now: greyscale where only darkvision sees (PF2E darkvision is black and white)
      ringsPath(F.visible); ctx.clip('nonzero');
      if (F.mono.length && img.complete) {
        ctx.save(); ringsPath(F.mono); ctx.clip('nonzero');
        ctx.filter = 'grayscale(1) brightness(.85)'; ctx.drawImage(img, -OX, -OY, W, H); ctx.filter = 'none'; ctx.restore();
      }
    }
    ctx.imageSmoothingEnabled = true;
    if ('filter' in ctx) ctx.filter = `blur(${Math.max(2, P(0.1))}px)`;   // hide the 1/8-square steps
    ctx.drawImage(lightCanvas, 0, 0, P(G.cols), P(G.rows));
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.restore();
  }
  /** Lighting regions, GM view only, always: a faint dashed outline (gold for a fixed level, blue for sky). */
  const REGION_LOOK = { fixed: '#e9cf86', sky: '#8fcaf2', alpha: 0.7, dash: [0.22, 0.16] };
  let regionRuns = null;
  function drawRegionOutlines() {
    regionRuns = regionRuns || (LIGHTING.regions || []).map((r) => ({
      sky: r.level === 'sky', runs: edgeRuns(squareEdges(new Set(Engine.areaCells(r).map(([x, y]) => x + ',' + y)))),
    }));
    ctx.save(); ctx.globalAlpha = REGION_LOOK.alpha; ctx.setLineDash(REGION_LOOK.dash.map(P));
    for (const { sky, runs } of regionRuns) {
      ctx.beginPath();
      for (const [x0, y0, x1, y1] of runs) { ctx.moveTo(P(x0), P(y0)); ctx.lineTo(P(x1), P(y1)); }
      ctx.lineWidth = Math.max(3, P(0.1)); ctx.strokeStyle = 'rgba(10, 10, 14, .75)'; ctx.stroke();
      ctx.lineWidth = Math.max(1.4, P(0.045)); ctx.strokeStyle = sky ? REGION_LOOK.sky : REGION_LOOK.fixed; ctx.stroke();
    }
    ctx.restore();
  }
  /** Lighting regions on a square (GM readout). */
  const regionsAt = (x, y) => (LIGHTING.regions || []).filter((r) => Engine.areaCells(r).some(([cx, cy]) => cx === x && cy === y));

  // ---------- coloured light ----------
  // A subtle tint, under the light shade: each pixel takes the mixed colour of the coloured light there,
  // stronger where the light is brighter (by the square root, so a dim glow still shows its colour) and where
  // more of the light there is coloured, at most the table's strength.
  // Darkvision-only areas stay black and white; players see colour only where they perceive.
  const colourOn = () => LIT && S.light_colour.on && S.light_colour.strength > 0 && !!lightMap && !!lightMap.colour;
  let tintCanvas = null, tintFor = null;
  function drawTint(F, full, key) {
    const tkey = key + '|' + S.light_colour.strength;
    if (tintFor !== tkey) {
      tintCanvas = tintCanvas || document.createElement('canvas');
      tintCanvas.width = lightMap.w; tintCanvas.height = lightMap.h;
      const tc = tintCanvas.getContext('2d'), im = tc.createImageData(lightMap.w, lightMap.h);
      const { rgb, share } = lightMap.colour, glow = lightMap.glow, max = S.light_colour.strength / 100;
      const per = F.perceived && F.perceived.bits, mono = F.monoMask && F.monoMask.bits;
      for (let k = 0; k < glow.length; k++) {
        if (!share[k] || (!full && (!per[k] || mono[k]))) continue;
        im.data[k * 4] = rgb[k * 3]; im.data[k * 4 + 1] = rgb[k * 3 + 1]; im.data[k * 4 + 2] = rgb[k * 3 + 2];
        im.data[k * 4 + 3] = Math.round(255 * max * (share[k] / 255) * Math.sqrt(glow[k] / 255));   // a faint glow still shows its colour
      }
      tc.putImageData(im, 0, 0); tintFor = tkey;
    }
    ctx.save();
    if (!full) { ringsPath(F.visible); ctx.clip('nonzero'); }
    ctx.imageSmoothingEnabled = true;
    if ('filter' in ctx) ctx.filter = `blur(${Math.max(2, P(0.1))}px)`;
    ctx.drawImage(tintCanvas, 0, 0, P(G.cols), P(G.rows));
    ctx.restore();
  }

  // ---------- light animation (torch, flicker, pulse, ghostly, chroma) ----------
  // Drawn on a layer of its own over the map, about 30 times a second, from pictures of each animated light's
  // glow made once (again only when the light moves or changes). The board itself is never redrawn for
  // animation. Drawing only: the rules never change. Clipped to what the view perceives, so an animated light
  // never shows players an unseen room.
  const tgtCanvas = document.getElementById('tgt');   // targets' pulsing chevrons, drawn every frame while any show
  const tctx = tgtCanvas.getContext('2d');
  const animCanvas = document.getElementById('anim');
  const actx = animCanvas.getContext('2d');
  const ANIM_LOOK = { darken: 1.6, brighten: 0.9, light: '#fff1d6', fps: 30 };
  const animOn = () => LIT && S.light_animation.on;
  let animList = [], animClip = null, animFull = true, animRAF = null, animLast = 0;
  const animSprites = new Map();   // light id -> {key, x, y, w, h, dark, bright, colour}
  const animStats = { frames: 0, ms: 0, since: 0, fps: 0, avg: 0 };
  const animStatText = () => (animOn() && animList.length ? `animation <b>${animList.length}</b> lights · <b>${animStats.avg.toFixed(1)}</b> ms/frame · <b>${animStats.fps}</b> fps` : animOn() ? 'animation <b>idle</b>' : 'animation <b>off</b>');
  /**
   * A light's glow as small pictures (dark, bright, colour), made once per light shape, colour, intensity and
   * kind of animation. Flames (torch, flicker) move mostly at the edge: the bright core wavers a little, the
   * dim fringe more, as a real flame's reach comes and goes. Pulse, ghostly and chroma move evenly.
   */
  const FLAME = { core: 0.25, edge: 1 };
  function flameWeight(g) {   // g: brightness 0-1 at this point of the light
    const toEdge = FLAME.core + (FLAME.edge - FLAME.core) * (1 - g);
    return toEdge * Math.min(1, g * 5);   // fading out right at the outer edge, so nothing pops beyond the light
  }
  function animSprite(l, patch, flame) {
    const key = [l.colour || '', l.intensity ?? 100, flame ? 'flame' : 'even'].join('|');
    const hit = animSprites.get(l.id);
    if (hit && hit.patch === patch && hit.key === key) return hit;
    const W = lightMap.w;
    let i0 = Infinity, j0 = Infinity, i1 = -1, j1 = -1;
    for (const k of patch.idx) { const i = k % W, j = (k - i) / W; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
    if (i1 < 0) return null;
    const w = i1 - i0 + 1, h = j1 - j0 + 1, f = (l.intensity ?? 100) / 100;
    const rgb = Engine.parseColour(l.colour) || [255, 80, 80];
    const make = (r, g, b) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const cx = c.getContext('2d'), im = cx.createImageData(w, h);
      for (let n = 0; n < patch.idx.length; n++) {
        const k = patch.idx[n], i = (k % W) - i0, j = Math.floor(k / W) - j0, q = (j * w + i) * 4;
        const gl = patch.glow[n] / 255;
        im.data[q] = r; im.data[q + 1] = g; im.data[q + 2] = b; im.data[q + 3] = Math.round(255 * f * (flame ? flameWeight(gl) : gl));
      }
      cx.putImageData(im, 0, 0);
      return c;
    };
    const shade = LIGHT_LOOK.shade.split(',').map(Number), lt = Engine.parseColour(ANIM_LOOK.light);
    const sp = { key, patch, x: i0 / lightMap.res, y: j0 / lightMap.res, w: w / lightMap.res, h: h / lightMap.res,
      dark: make(...shade), bright: make(...lt), colour: make(...rgb) };
    animSprites.set(l.id, sp);
    return sp;
  }
  /** Which lights animate now, and where the view lets them show. Called after every board redraw. */
  function refreshAnimation(F, full) {
    animList = [];
    if (animOn()) {
      for (const l of lightsNow()) {
        const anim = Engine.animationOf(l.animation);
        const hit = anim && lightCache.patches.get(l.id);
        if (!hit) continue;
        const sp = animSprite(l, hit.patch, anim.type === 'torch' || anim.type === 'flicker');
        if (sp) animList.push({ id: l.id, anim, sp });
      }
    }
    animFull = full;
    animClip = null;
    if (!full && !F.visible.length) animList = [];   // the view sees nothing: nothing may animate (not everything)
    if (!full && F.visible.length) {
      animClip = new Path2D();
      for (const r of F.visible) { if (r.length < 3) continue; animClip.moveTo(P(r[0][0]), P(r[0][1])); for (let i = 1; i < r.length; i++) animClip.lineTo(P(r[i][0]), P(r[i][1])); animClip.closePath(); }
    }
    if (!animList.length) { clearAnim(); return; }
    if (!animRAF) animRAF = requestAnimationFrame(animFrame);
  }
  function clearAnim() {
    actx.setTransform(1, 0, 0, 1, 0, 0); actx.clearRect(0, 0, animCanvas.width, animCanvas.height);
  }
  function animFrame(now) {
    animRAF = null;
    if (!animOn() || !animList.length) { clearAnim(); return; }
    if (now - animLast >= 1000 / ANIM_LOOK.fps - 2) {
      animLast = now;
      const t0 = performance.now();
      drawAnim(now / 1000);
      animStats.ms += performance.now() - t0; animStats.frames++;
      if (now - animStats.since >= 1000) {
        animStats.fps = Math.round((animStats.frames * 1000) / (now - animStats.since || 1));
        animStats.avg = animStats.frames ? animStats.ms / animStats.frames : 0;
        animStats.frames = 0; animStats.ms = 0; animStats.since = now;
        const el = document.getElementById('animstat'); if (el) el.innerHTML = animStatText();
      }
    }
    animRAF = requestAnimationFrame(animFrame);
  }
  function drawAnim(t) {
    const dpr = window.devicePixelRatio || 1;
    clearAnim();
    actx.save();   // the view clip must not pile up from frame to frame (it did: the animation slowed, then stopped)
    actx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    actx.translate(OX, OY);
    if (animClip) actx.clip(animClip, 'nonzero');
    actx.imageSmoothingEnabled = true;
    const colour = S.light_colour.on, strength = S.light_colour.strength / 100;
    for (const { id, anim, sp } of animList) {
      const { brightness, hue } = Engine.animationAt(anim, id, t);
      const d = brightness - 1, x = P(sp.x), y = P(sp.y), w = P(sp.w), h = P(sp.h);
      if (d < 0) { actx.globalAlpha = Math.min(1, -d * ANIM_LOOK.darken); actx.drawImage(sp.dark, x, y, w, h); }
      else if (d > 0) { actx.globalAlpha = Math.min(1, d * ANIM_LOOK.brighten); actx.drawImage(sp.bright, x, y, w, h); }
      if (anim.type === 'chroma' && colour) {
        actx.globalAlpha = Math.min(1, strength * 1.6 * (anim.intensity / 10));
        actx.filter = `hue-rotate(${hue}deg)`; actx.drawImage(sp.colour, x, y, w, h); actx.filter = 'none';
      }
    }
    actx.restore();
  }
  function syncAnimButton() {
    const b = document.getElementById('b-anim');
    b.setAttribute('aria-pressed', String(S.light_animation.on));
    b.textContent = S.light_animation.on ? 'Animation on' : 'Animation off';
  }
  document.getElementById('b-anim').onclick = () => {
    S.light_animation = { ...S.light_animation, on: !S.light_animation.on };
    syncAnimButton();
    log(`GM: light animation ${S.light_animation.on ? 'on' : 'off'} for the whole table.`, 'ok');
    draw();
  };
  /** Animation controls under a lamp's or a carried light's row: type, speed, intensity, reverse. */
  function animRow(anim) {
    const a = { ...Engine.ANIMATION_DEFAULTS, ...(anim || {}) };
    return `<div class="arow">
      <select data-a="type" aria-label="Animation">${Object.keys(Engine.ANIMATION_TYPES).map((k) => `<option value="${k}" ${k === a.type ? 'selected' : ''} title="${Engine.ANIMATION_TYPES[k]}">${k === 'none' ? 'steady' : k}</option>`).join('')}</select>
      <label title="Speed 1-10">speed <input type="range" min="1" max="10" step="1" data-a="speed" value="${a.speed}"></label>
      <label title="Animation intensity 1-10">strength <input type="range" min="1" max="10" step="1" data-a="intensity" value="${a.intensity}"></label>
      <label title="Reverse direction"><input type="checkbox" data-a="reverse" ${a.reverse ? 'checked' : ''}> rev</label>
    </div>`;
  }
  /** Wire an animation row: `get` returns the current settings, `set(next)` stores them. */
  function wireAnimRow(row, get, set, name) {
    if (!row) return;
    for (const el of row.querySelectorAll('[data-a]')) {
      el.onchange = () => {
        const f = el.dataset.a, v = f === 'type' ? el.value : f === 'reverse' ? el.checked : Number(el.value);
        set({ ...Engine.ANIMATION_DEFAULTS, ...(get() || {}), [f]: v });
        log(`GM: ${name} animation ${f} ${v}.`, 'ok');
        draw();
      };
    }
  }

  // ---------- the GM's lighting card: coloured light, lamps and regions ----------
  const pct = (v) => Math.round(v === undefined ? 100 : v);
  const colourValue = (c) => (Engine.parseColour(c) ? c : '#ffffff');
  function lightRow(kind, id, name, on, colour, intensity) {
    return `<div class="lrow${on ? '' : ' off'}" data-kind="${kind}" data-id="${id}">
      <label class="nm" title="${name}"><input type="checkbox" data-f="on" ${on ? 'checked' : ''}> ${name}</label>
      <span title="${Engine.parseColour(colour) ? 'Colour ' + colour : 'Uncoloured'}"><input type="color" data-f="colour" value="${colourValue(colour)}" aria-label="${name}: colour"><button data-f="nocolour" title="Make it uncoloured" ${Engine.parseColour(colour) ? '' : 'disabled'}>×</button></span>
      <input type="range" min="0" max="100" step="5" data-f="intensity" value="${pct(intensity)}" aria-label="${name}: intensity">
      <span class="pct">${pct(intensity)}%</span>
    </div>`;
  }
  function lightingCard() {
    const el = document.getElementById('lightcard');
    el.hidden = !(S.view === 'gm' && LIT && ((LIGHTING.lights || []).length || (LIGHTING.regions || []).length));
    if (el.hidden) return;
    const lamps = (LIGHTING.lights || []).map((l) => { const sp = staticSpec(l); return lightRow('lamp', l.id, l.label ? `${l.label}${l.room ? ' · ' + l.room : ''}` : l.id, staticOn(l), sp.colour, sp.intensity) + `<div data-anim-for="${l.id}">${animRow(sp.animation)}</div>`; });
    const regs = (LIGHTING.regions || []).map((r) => { const now = { ...r, ...pick(S.regions[r.id], ['colour', 'intensity']) }; return lightRow('region', r.id, `${r.label || r.id} (${r.level})`, !S.regions_off.includes(r.id), now.colour, now.intensity); });
    el.innerHTML = `<h2>Lighting (GM)</h2>
      <div class="lrow"><span class="nm">Colour strength</span><span></span><input type="range" min="0" max="60" step="5" id="colour-strength" value="${S.light_colour.strength}" aria-label="Strongest colour tint"><span class="pct">${S.light_colour.strength}%</span></div>
      ${lamps.length ? `<div class="lsub">Lamps</div>${lamps.join('')}` : ''}
      ${regs.length ? `<div class="lsub">Regions</div>${regs.join('')}` : ''}`;
    el.querySelector('#colour-strength').onchange = (e) => {
      S.light_colour = { ...S.light_colour, strength: Number(e.target.value) };
      log(`GM: colour strength ${S.light_colour.strength}%.`, 'ok'); lightingCard(); draw();
    };
    for (const row of el.querySelectorAll('.lrow[data-id]')) {
      const { kind, id } = row.dataset, store = kind === 'lamp' ? S.lights : S.regions;
      const name = row.querySelector('.nm').textContent.trim();
      const set = (k, v) => { store[id] = { ...(store[id] || {}), [k]: v }; };
      row.querySelector('[data-f=on]').onchange = (e) => {
        if (kind === 'lamp') set('on', e.target.checked);
        else S.regions_off = e.target.checked ? S.regions_off.filter((x) => x !== id) : [...S.regions_off, id];
        log(`GM: ${name} ${e.target.checked ? 'on' : 'off'}.`, 'ok'); lightingCard(); recompute();
      };
      row.querySelector('[data-f=colour]').onchange = (e) => { set('colour', e.target.value); log(`GM: ${name} colour ${e.target.value}.`, 'ok'); lightingCard(); relight(); };
      row.querySelector('[data-f=nocolour]').onclick = () => { set('colour', 'none'); log(`GM: ${name} uncoloured.`, 'ok'); lightingCard(); relight(); };
      row.querySelector('[data-f=intensity]').oninput = (e) => { row.querySelector('.pct').textContent = e.target.value + '%'; };
      row.querySelector('[data-f=intensity]').onchange = (e) => { set('intensity', Number(e.target.value)); log(`GM: ${name} intensity ${e.target.value}%.`, 'ok'); lightingCard(); relight(); };
      if (kind === 'lamp') {
        const l = LIGHTING.lights.find((x) => x.id === id);
        wireAnimRow(el.querySelector(`[data-anim-for="${id}"]`), () => staticSpec(l).animation, (a) => set('animation', a), name);
      }
    }
  }

  /** Static lights: a small lamp mark (lit or cold), GM view only, always (also through a creature's eyes),
   *  so the GM can click one to light it or put it out. Players never see the marks, only the light. */
  function drawLightSources() {
    for (const l of LIGHTING.lights || []) {
      const on = staticOn(l);
      const x = P(l.at[0]), y = P(l.at[1]), r = Math.max(5, P(0.17));
      ctx.save();
      if (on) { const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.6); g.addColorStop(0, 'rgba(255, 200, 90, .55)'); g.addColorStop(1, 'rgba(255, 200, 90, 0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, Math.PI * 2); ctx.fill(); }
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      const lc = on && S.light_colour.on ? staticSpec(l).colour : null;
      ctx.fillStyle = on ? (Engine.parseColour(lc) ? lc : LIGHT_LOOK.on) : '#17191d'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = on ? '#3a2408' : LIGHT_LOOK.off; ctx.stroke();
      if (l.angle) {   // a cone: a tick showing where it points
        const a = ((l.rotation || 0) * Math.PI) / 180;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.lineTo(x + Math.cos(a) * r * 2.2, y + Math.sin(a) * r * 2.2);
        ctx.strokeStyle = on ? LIGHT_LOOK.on : LIGHT_LOOK.off; ctx.lineWidth = 2.5; ctx.stroke();
      }
      ctx.restore();
    }
  }
  /** GM view: the static light under p, if any. */
  function lightAt(p) {
    return (LIGHTING.lights || []).find((l) => Math.hypot(p[0] - l.at[0], p[1] - l.at[1]) < 0.3) || null;
  }

  // ---------- terrain ----------
  // One mark per square, drawn on the map under the fog (so unexplored terrain stays hidden and remembered
  // terrain is dimmed), plus a thin outline round each area. Red up-chevrons for difficult terrain, as at
  // the table; two for greater difficult terrain.
  function terrainMark(kind, x, y, alpha) {
    const look = TERRAIN_LOOK[kind], cx = P(x + 0.5), cy = P(y + 0.5), u = P(0.16);
    ctx.save(); ctx.globalAlpha = alpha; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    if (look.mark === 'chevron' || look.mark === 'chevron2') {
      const rows = look.mark === 'chevron' ? [0.6] : [0.1, 1.1];
      for (const dy of rows) { ctx.moveTo(cx - u * 1.3, cy + u * dy); ctx.lineTo(cx, cy - u * 1.1 + u * dy); ctx.lineTo(cx + u * 1.3, cy + u * dy); }
    } else if (look.mark === 'waves') {
      for (const dy of [-0.5, 0.6]) { ctx.moveTo(cx - u * 1.4, cy + u * dy); ctx.quadraticCurveTo(cx - u * 0.7, cy + u * (dy - 0.7), cx, cy + u * dy); ctx.quadraticCurveTo(cx + u * 0.7, cy + u * (dy + 0.7), cx + u * 1.4, cy + u * dy); }
    } else if (look.mark === 'arrow') {
      ctx.moveTo(cx, cy + u * 1.4); ctx.lineTo(cx, cy - u * 1.2); ctx.moveTo(cx - u, cy - u * 0.2); ctx.lineTo(cx, cy - u * 1.2); ctx.lineTo(cx + u, cy - u * 0.2);
    } else if (look.mark === 'zigzag') {
      ctx.moveTo(cx - u * 1.4, cy + u * 0.4); ctx.lineTo(cx - u * 0.7, cy - u * 0.5); ctx.lineTo(cx, cy + u * 0.4); ctx.lineTo(cx + u * 0.7, cy - u * 0.5); ctx.lineTo(cx + u * 1.4, cy + u * 0.4);
    } else {
      ctx.moveTo(cx, cy - u * 1.3); ctx.lineTo(cx, cy + u * 0.3); ctx.moveTo(cx, cy + u * 1.05); ctx.lineTo(cx, cy + u * 1.1);
    }
    ctx.lineWidth = Math.max(3, P(0.12)); ctx.strokeStyle = 'rgba(255, 255, 255, .9)'; ctx.stroke();   // white edge, as on the old board
    ctx.lineWidth = Math.max(1.6, P(0.06)); ctx.strokeStyle = look.colour; ctx.stroke();
    ctx.restore();
  }
  /** Thin outline along the edges of an area's squares that border squares outside it. */
  function terrainOutline(cells, colour, dashed) {
    const inside = new Set(cells.map(([x, y]) => x + ',' + y));
    ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = 1.2; ctx.globalAlpha = dashed ? 0.9 : 0.55;
    if (dashed) ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (const [x, y] of cells) {
      if (!inside.has(x + ',' + (y - 1))) { ctx.moveTo(P(x), P(y)); ctx.lineTo(P(x + 1), P(y)); }
      if (!inside.has(x + ',' + (y + 1))) { ctx.moveTo(P(x), P(y + 1)); ctx.lineTo(P(x + 1), P(y + 1)); }
      if (!inside.has((x - 1) + ',' + y)) { ctx.moveTo(P(x), P(y)); ctx.lineTo(P(x), P(y + 1)); }
      if (!inside.has((x + 1) + ',' + y)) { ctx.moveTo(P(x + 1), P(y)); ctx.lineTo(P(x + 1), P(y + 1)); }
    }
    ctx.stroke(); ctx.restore();
  }
  function drawTerrain(full) {
    for (const a of terrain.areas) {
      const cells = Engine.areaCells(a);
      terrainOutline(cells, TERRAIN_LOOK[a.kind].colour, false);
      for (const [x, y] of cells) terrainMark(a.kind, x, y, a.kind === 'swim' ? 0.55 : 0.95);
    }
    if (!full) return;
    // GM only: areas that start switched off (a bridge that will collapse); click one to switch it on
    for (const a of PACK_TERRAIN) if (a.active === false && !S.terrain_on.includes(a.id)) terrainOutline(Engine.areaCells(a), TERRAIN_LOOK[a.kind].colour, true);
  }
  /** GM view: the pack area that starts switched off under p, if any. */
  function inactiveAreaAt(p) {
    const x = Math.floor(p[0]), y = Math.floor(p[1]);
    return PACK_TERRAIN.find((a) => a.active === false && Engine.areaCells(a).some(([cx, cy]) => cx === x && cy === y)) || null;
  }

  // Door leaves are drawn as panels: in the doorway when closed, swung on the hinge when open.
  const DOOR_LOOK = {
    wood: '#8a5a2e', woodEdge: '#c48b52', stone: '#7b776f', stoneEdge: '#b3ada2', ink: '#140d07',
    open: 'rgba(235, 230, 220, .55)', lock: '#e3a443', secret: '#e3b330',
  };
  function leafPath(poly) {
    ctx.beginPath(); ctx.moveTo(P(poly[0][0]), P(poly[0][1]));
    for (let i = 1; i < poly.length; i++) ctx.lineTo(P(poly[i][0]), P(poly[i][1]));
    ctx.closePath();
  }
  function drawPanel(poly, stone) {
    leafPath(poly);
    ctx.fillStyle = stone ? DOOR_LOOK.stone : DOOR_LOOK.wood; ctx.fill();
    ctx.lineWidth = 1.6; ctx.strokeStyle = DOOR_LOOK.ink; ctx.stroke();
    // a lighter grain line down the middle of the panel
    const m1 = [(poly[0][0] + poly[3][0]) / 2, (poly[0][1] + poly[3][1]) / 2], m2 = [(poly[1][0] + poly[2][0]) / 2, (poly[1][1] + poly[2][1]) / 2];
    ctx.beginPath(); ctx.moveTo(P(m1[0]), P(m1[1])); ctx.lineTo(P(m2[0]), P(m2[1]));
    ctx.lineWidth = 0.8; ctx.strokeStyle = stone ? DOOR_LOOK.stoneEdge : DOOR_LOOK.woodEdge; ctx.stroke();
  }
  function drawPadlock(c, col) {
    const x = P(c[0]), y = P(c[1]), k = Math.max(0.55, P(0.32) / 10);
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
    ctx.fillStyle = '#17191d'; ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -2, 4.2, Math.PI, 0); ctx.stroke();               // shackle
    ctx.beginPath(); ctx.rect(-6, -2, 12, 9); ctx.fill(); ctx.stroke();             // body
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 2.5, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawDoors(gm, full) {
    ctx.save(); ctx.lineJoin = 'round';
    for (const s of doorSegs) {
      const info = doorInfo(s);
      if (!full && !doorVisibleToPlayers(s)) continue;
      const L = leafOf(s), stone = s.t === 'secret';
      if (!info.found) {                         // GM only: an unfound secret door, outlined
        leafPath(L.closed); ctx.setLineDash([4, 3]); ctx.lineWidth = 1.6; ctx.strokeStyle = DOOR_LOOK.secret; ctx.stroke(); ctx.setLineDash([]);
        continue;
      }
      if (info.st === 'open') {
        // the empty doorway, the swing path, then the leaf standing open
        ctx.beginPath(); ctx.moveTo(P(L.hinge[0]), P(L.hinge[1])); ctx.lineTo(P(L.free[0]), P(L.free[1]));
        ctx.lineWidth = 1; ctx.strokeStyle = DOOR_LOOK.open; ctx.setLineDash([2, 3]); ctx.stroke();
        ctx.beginPath(); ctx.arc(P(L.arc.c[0]), P(L.arc.c[1]), P(L.arc.r), L.arc.from, L.arc.to, L.arc.ccw); ctx.stroke();
        ctx.setLineDash([]);
        drawPanel(L.open, stone);
      } else {
        drawPanel(L.closed, stone);
        if (info.st === 'locked' && (gm || info.knownLocked)) drawPadlock(L.centre, DOOR_LOOK.lock);
      }
      // hinge pin
      ctx.beginPath(); ctx.arc(P(L.hinge[0]), P(L.hinge[1]), Math.max(1.2, P(0.05)), 0, Math.PI * 2);
      ctx.fillStyle = DOOR_LOOK.ink; ctx.fill();
    }
    ctx.restore();
  }

  // ---------- movement range ----------
  // Dashed outlines round where one, two and three Strides reach this turn (exact: feet left over from one
  // Stride are lost, the diagonal count carries on), drawn only over squares the view can see so the
  // outline never gives away walls in the fog. No fill: a fill reads as light.
  const BAND_LOOK = [   // dash and gap in cells, so the pattern keeps its look at any zoom
    { colour: '#c6f5ae', dash: [0.5, 0.25] },    // one Stride: light green, long dashes
    { colour: '#5bd06a', dash: [0.3, 0.2] },     // two: medium green, medium dashes
    { colour: '#2f9a48', dash: [0.13, 0.13] },   // three: dark green, short dashes
  ];
  const BAND_ALPHA = 0.5;   // see-through, so the map under the outlines stays readable
  let bandCache = null;
  function moveBands(id) {
    const key = id + '|' + gen;
    if (bandCache && bandCache.key === key) return bandCache.bands;
    const bands = Engine.strideReach(moveWalls, mspace(id), S.tokens[id].speed, BAND_LOOK.length, moveOpts(id));
    bandCache = { key, bands };
    return bands;
  }
  /** Edges round a set of squares ("x,y" keys), one per square side: "h:x,y" runs (x,y)-(x+1,y), "v:x,y" (x,y)-(x,y+1). */
  function squareEdges(set) {
    const out = new Set();
    for (const k of set) {
      const [x, y] = k.split(',').map(Number);
      if (!set.has(x + ',' + (y - 1))) out.add(`h:${x},${y}`);
      if (!set.has(x + ',' + (y + 1))) out.add(`h:${x},${y + 1}`);
      if (!set.has((x - 1) + ',' + y)) out.add(`v:${x},${y}`);
      if (!set.has((x + 1) + ',' + y)) out.add(`v:${x + 1},${y}`);
    }
    return out;
  }
  /** Unit edges joined into straight runs: [[x0, y0, x1, y1], ...] in cells (so dashes run on unbroken). */
  function edgeRuns(edges) {
    const lines = new Map();
    for (const e of edges) {
      const [x, y] = e.slice(2).split(',').map(Number), horiz = e[0] === 'h';
      const line = (horiz ? 'h' : 'v') + (horiz ? y : x);
      if (!lines.has(line)) lines.set(line, []);
      lines.get(line).push(horiz ? x : y);
    }
    const runs = [];
    for (const [line, starts] of lines) {
      const horiz = line[0] === 'h', c = Number(line.slice(1));
      starts.sort((a, b) => a - b);
      let a = starts[0], b = a + 1;
      for (let i = 1; i <= starts.length; i++) {
        if (i < starts.length && starts[i] === b) { b++; continue; }
        runs.push(horiz ? [a, c, b, c] : [c, a, c, b]);
        if (i < starts.length) { a = starts[i]; b = a + 1; }
      }
    }
    return runs;
  }
  function drawMoveBands(F) {
    const bands = moveBands(selected), sq = Math.max(1, mspace(selected).size);
    const seen = (x, y) => (F.focus ? F.at(x + 0.5, y + 0.5) : mask.at(x + 0.5, y + 0.5));
    // each band's edges, nearest band first; where bands share an edge (a dead-end corridor, along a wall)
    // only the nearest band's line is drawn
    const taken = new Set(), lines = [];
    for (let k = 0; k < bands.length; k++) {
      const set = new Set();
      for (const c of bands[k]) {
        const x0 = Math.floor(c.x), y0 = Math.floor(c.y);
        for (let j = 0; j < sq; j++) for (let i = 0; i < sq; i++) if (seen(x0 + i, y0 + j)) set.add((x0 + i) + ',' + (y0 + j));
      }
      const own = [...squareEdges(set)].filter((e) => !taken.has(e));
      own.forEach((e) => taken.add(e));
      lines.push(edgeRuns(own));
    }
    ctx.save(); ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    ctx.globalAlpha = BAND_ALPHA;
    for (let k = lines.length - 1; k >= 0; k--) {
      const look = BAND_LOOK[k];
      ctx.beginPath();
      for (const [x0, y0, x1, y1] of lines[k]) { ctx.moveTo(P(x0), P(y0)); ctx.lineTo(P(x1), P(y1)); }
      ctx.setLineDash(look.dash.map(P));
      ctx.lineWidth = Math.max(4, P(0.17)); ctx.strokeStyle = 'rgba(6, 10, 7, .8)'; ctx.stroke();   // dark edge: readable on pale floors and grass
      ctx.lineWidth = Math.max(2, P(0.085)); ctx.strokeStyle = look.colour; ctx.stroke();
    }
    ctx.restore();
  }

  function drawRoute() {
    const t = S.tokens[selected], ms = mspace(selected), size = ms.size, sq = Math.max(1, size);
    const g = drag.goal;
    ctx.save();
    ctx.strokeStyle = 'rgba(227, 164, 67, .9)'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    ctx.strokeRect(P(g[0]) + 2, P(g[1]) + 2, P(sq) - 4, P(sq) - 4);
    if (drag.route) {
      ctx.setLineDash([]); ctx.lineWidth = 4; ctx.strokeStyle = '#e3a443';
      ctx.beginPath();
      drag.route.path.forEach(([x, y], i) => { const px = P(x + size / 2), py = P(y + size / 2); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.stroke();
    }
    const shared = Engine.isTiny(t) ? [] : Engine.blockersAt({ id: selected, ...t }, g[0], g[1], raw());
    const tn = routeNotes(selected, drag.route);
    const label = shared.length ? `occupied by ${theName(shared[0])}`
      : drag.route ? `${drag.route.feet} ft${tn.extraFt ? ` (${tn.extraFt} ft terrain)` : ''}${tn.notes.length ? ' · ' + tn.notes.join(' · ') : ''}`
      : 'no route';
    ctx.font = '600 13px IBM Plex Sans, sans-serif';
    const tw = ctx.measureText(label).width + 12, lx = P(g[0]) + 4, ly = P(g[1]) - 22;
    const good = !shared.length && drag.route && drag.route.feet <= t.speed;
    ctx.fillStyle = good ? '#1f2a22' : '#2b2418';
    ctx.fillRect(lx, ly, tw, 20);
    ctx.fillStyle = good ? '#5fbf83' : '#e3a443';
    ctx.fillText(label, lx + 6, ly + 15);
    ctx.restore();
  }

  // ---- hover, distance and targets ----
  /** The token's square (hover or selection) at space t with Tiny layout L, or null when it shows none. */
  function boxFor(id, t, L) {
    const picked = id === selected || multi.has(id);
    if (!picked && !(id === hoverId && !drag)) return null;
    const t0 = S.tokens[id], q = Engine.isTiny(t0) && L.spaces.get(id);
    return { m: markSquare(t, Engine.isTiny(t0), !!q && q.slot !== null), colour: picked ? SELECTED_COLOUR : kindColour(t0.kind) };
  }
  function strokeBox(c, box) {
    c.save();
    c.lineWidth = 2; c.strokeStyle = box.colour;
    c.strokeRect(P(box.m.x) + 1, P(box.m.y) + 1, P(box.m.size) - 2, P(box.m.size) - 2);
    c.restore();
  }
  const visibleToken = (F, full, id) => !!S.tokens[id] && (full || F.seen.has(id));
  /** With one token selected and another hovered (both visible): the line between them and the distance. */
  function distanceTo(F, full) {
    if (!selected || !hoverId || hoverId === selected || drag || multi.size) return null;
    if (!visibleToken(F, full, selected) || !visibleToken(F, full, hoverId)) return null;
    const a = space(selected), b = space(hoverId);
    const feet = Engine.creatureDistance(SYS, mspace(selected), mspace(hoverId), Engine.spaceDistance);
    return { a: [a.x + a.size / 2, a.y + a.size / 2], b: [b.x + b.size / 2, b.y + b.size / 2], top: b.y, feet, unit: SYS.measurement.unit };
  }
  function drawDistanceLine(d) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(10, 12, 16, .75)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(P(d.a[0]), P(d.a[1])); ctx.lineTo(P(d.b[0]), P(d.b[1])); ctx.stroke();
    ctx.strokeStyle = '#f4ecd6'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(P(d.a[0]), P(d.a[1])); ctx.lineTo(P(d.b[0]), P(d.b[1])); ctx.stroke();
    ctx.restore();
  }
  function drawDistanceLabel(d) {
    const label = `${d.feet} ${d.unit}`;
    ctx.save();
    ctx.font = '600 13px IBM Plex Sans, sans-serif';
    const w = ctx.measureText(label).width + 12, x = P(d.b[0]) - w / 2, y = P(d.top) - 26;
    ctx.fillStyle = 'rgba(20, 22, 27, .92)'; ctx.strokeStyle = '#f4ecd6'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, 20, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f4ecd6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, P(d.b[0]), y + 10.5);
    ctx.restore();
  }

  /**
   * The tokens as a drag would leave them, for drawing during the drag: the dragged tokens at their new
   * squares with their quadrants given up (as moveGroup and moveToken do), so Tiny creatures show where they
   * will really sit. Null while nothing has moved to another square: tokens are drawn where they are.
   */
  function dragPreview() {
    if (!drag) return null;
    if (drag.group) {
      if (!drag.dx && !drag.dy) return null;
      const list = raw().map((t) => (drag.group.has(t.id) ? { ...t, x: t.x + drag.dx, y: t.y + drag.dy, slot: undefined } : t));
      return { list, layout: Engine.layoutTiny(list) };
    }
    const t0 = S.tokens[drag.id];
    if (!t0 || (drag.goal[0] === t0.x && drag.goal[1] === t0.y)) return null;
    const list = raw().map((t) => (t.id === drag.id ? { ...t, x: drag.goal[0], y: drag.goal[1], slot: undefined } : t));
    return { list, layout: Engine.layoutTiny(list) };
  }
  function drawTokens(F, full) {
    // biggest first, so a creature sharing a bigger one's space is drawn on top of it
    const order = Object.entries(S.tokens).sort((a, b) => (b[1].size || 1) - (a[1].size || 1));
    // During a group drag, Tiny creatures are laid out where the move will put them: those moving take free
    // quadrants where they land, and those left behind keep theirs (or are centred if now alone).
    const preview = dragPreview();
    const L = preview ? preview.layout : layout;
    for (const [id, t0] of order) {
      const seen = F.seen.has(id);
      if (!full && !seen) continue;
      const sp = preview ? Engine.spaceOf(preview.list.find((t) => t.id === id), L) : space(id);
      const t = { ...t0, ...sp };
      // Medium tokens leave a 5 px margin in their square; Small ones are 3/4 of that token; Tiny a 2 px margin
      const size = t.size, medium = P(size) / 2 - (size < 1 ? 2 : 5), r = medium * Engine.drawScale(t0);
      const cx = P(t.x + size / 2), cy = P(t.y + size / 2);
      ctx.save();
      if (preview && drag && (drag.id === id || (drag.group && drag.group.has(id)))) ctx.globalAlpha = 0.75;   // faded only once it moves
      if (full && !seen) ctx.globalAlpha = 0.6;
      ctx.fillStyle = t.kind === 'pc' ? '#5b93ff' : '#e5615a';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#0d0f12';
      if (full && !seen) ctx.setLineDash([4, 3]);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#fff'; ctx.font = `600 ${Math.max(10, r * 0.95)}px IBM Plex Sans, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t.short, cx, cy + 1);
      ctx.restore();
      // A thin square on the grid squares the token occupies (a Tiny creature alone: its square; sharing a
      // square with others: its own quarter): amber when selected, its kind's colour when hovered.
      const box = boxFor(id, t, L);
      if (box) strokeBox(ctx, box);
      if (seen && concealedNow(F, id)) drawConcealed(cx + r * 0.72, cy - r * 0.72, Math.max(6, r * 0.34));
    }
    // "hidden" markers the GM placed: where the party thinks an unseen creature is (not shown through a foe's eyes)
    if (F.focus && S.tokens[F.focus].kind !== 'pc') return;
    for (const [id, sq] of Object.entries(S.hiddenMarks)) {
      const x = P(sq[0] + 0.5), y = P(sq[1] + 0.5), r = P(0.36);
      ctx.save(); ctx.setLineDash([5, 4]); ctx.lineWidth = 2.5; ctx.strokeStyle = '#e3a443'; ctx.fillStyle = 'rgba(23, 25, 29, .55)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#e3a443'; ctx.font = `700 ${Math.max(11, r)}px IBM Plex Sans, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', x, y + 1); ctx.restore();
    }
  }
  /** Concealed from the creature whose eyes the board shows, or (the party's view) from any PC who sees it. */
  function concealedNow(F, id) {
    const from = F.concealedFrom[id];
    if (!from) return false;
    return F.focus ? from.includes(F.focus) : true;
  }
  function drawConcealed(x, y, r) {   // a half-shaded disc: concealed (DC 5 flat check to target)
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#ebe6dc'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fillStyle = '#20232a'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.strokeStyle = '#0d0f12'; ctx.stroke();
    ctx.restore();
  }
  const namesOf = (ids) => ids.map((i) => S.tokens[i].name).join(' and ');

  function hud() {
    const parts = [];
    if (hoverCell) {
      const [x, y] = hoverCell, c = [x + 0.5, y + 0.5];
      const F = shown();
      const fs = F.at(c[0], c[1]) ? 'visible' : !F.focus && mask.at(c[0], c[1]) ? 'explored' : 'hidden';
      parts.push(`square <b>${x},${y}</b>`, `fog <b>${fs}</b>`);
      if (LIT && (S.view === 'gm' || fs !== 'hidden')) parts.push(`light <b>${Engine.LEVEL_NAME[lightMap.at(c[0], c[1])]}</b> · glow <b>${Math.round(lightMap.glowAt(c[0], c[1]) * 100)}%</b>`);
      if (LIT && S.view === 'gm') {
        const rs = regionsAt(x, y);
        if (rs.length) parts.push(`region <b>${rs.map((r) => `${r.label || r.note || r.id} (${r.level})`).join('; ')}</b>`);
      }
      if (S.view === 'gm' || fs !== 'hidden') {
        const here = terrain.at(x, y).map((a) => `${a.label || a.cause || 'terrain'}: ${TERRAIN_LOOK[a.kind].name}${a.dc ? ' DC ' + a.dc : ''}`);
        if (here.length) parts.push(`terrain <b>${here.join('; ')}</b>`);
      }
    }
    const bytes = JSON.stringify({ v: 1, polys: S.explored }).length;
    parts.push(`explored <b>${S.explored.length}</b> rings · <b>${(bytes / 1024).toFixed(1)}</b> KiB`);
    parts.push(focusId() ? `view <b>${S.tokens[focusId()].name} only</b>` : `lookers <b>${view.lookers.length}</b>`);
    parts.push(`<span id="animstat">${animStatText()}</span>`);
    document.getElementById('hud').innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
  }

  function panel() {
    const el = document.getElementById('sel');
    if (!selected) {
      el.innerHTML = `<h2>Selection</h2><div style="color:var(--muted);font-size:14px">${S.view === 'gm' ? 'Click any token to see the board through its eyes: only what it perceives now. Click empty floor or press Escape for the whole map. Click a door to cycle closed, open, locked; Shift+click a double door for both leaves.' : 'Click a PC to see only what they perceive now and how far they can move; click empty floor or press Escape to see everything the party has explored. Click a door to open or close it; Shift+click a double door to work both leaves.'}</div>`;
      return;
    }
    const t = S.tokens[selected], size = t.size || 1;
    const seen = view.seen.has(selected);
    el.innerHTML = `<h2>Selection</h2>
      <div class="sel-name">${t.name}</div>
      <div class="chips">
        <span class="chip ${t.kind}">${t.kind === 'pc' ? 'PC' : 'Foe'}</span>
        <span class="chip">${t.small && size === 1 ? 'Small' : size === 4 ? 'Gargantuan 4×4' : size === 3 ? 'Huge 3×3' : size === 2 ? 'Large 2×2' : size < 1 ? (t.slot === undefined ? 'Tiny, centred' : 'Tiny, quadrant ' + (t.slot + 1)) : 'Medium'}</span>
        <span class="chip">Speed ${t.speed} ft</span>
        ${t.kind === 'pc' ? '' : `<span class="chip ${seen ? 'ok' : 'warn'}">${seen ? 'Seen by the party' : 'Hidden from players'}</span>`}
        ${(t.senses || []).map((x) => `<span class="chip">${typeof x === 'string' ? x : x.type}</span>`).join('')}
        ${seen && view.concealedFrom && view.concealedFrom[selected] ? `<span class="chip warn">Concealed from ${namesOf(view.concealedFrom[selected])}</span>` : ''}
      </div>
      <div class="sel-actions">
        ${t.light ? `<button id="b-light">${t.light.on === false ? 'Light' : 'Put out'} the ${(Engine.LIGHT_PRESETS[t.light.preset] || {}).label || 'light'}</button>` : ''}
      </div>
      ${t.light && S.view === 'gm' && LIT ? lightRow('carried', selected, 'Carried light', t.light.on !== false, Engine.lightSpec(t.light).colour, Engine.lightSpec(t.light).intensity) + `<div data-anim-for="carried">${animRow(Engine.lightSpec(t.light).animation)}</div>` : ''}
      <div class="sel-actions">
        ${S.view === 'gm' && t.kind !== 'pc' && !seen ? `<button id="b-mark">${S.hiddenMarks[selected] ? 'Clear the hidden marker' : 'Mark hidden for players'}</button>` : ''}
      </div>
      <div style="color:var(--muted);font-size:13px">Square ${t.x},${t.y}${t.note ? ' · ' + t.note : ''}. ${focusId() ? `The board shows only what ${t.name} perceives now. ` : ''}${canDrag(selected) ? 'Dashed green: where one, two and three Strides reach (light, medium, dark green).' : ''}</div>`;
    const cr = el.querySelector('.lrow[data-kind=carried]');
    if (cr) {
      const set = (k, v) => { t.light = { ...t.light, [k]: v }; };
      cr.querySelector('[data-f=on]').onchange = (e) => { set('on', e.target.checked); log(`${t.name} ${e.target.checked ? 'lights' : 'puts out'} the light.`, 'ok'); panel(); recompute(); };
      cr.querySelector('[data-f=colour]').onchange = (e) => { set('colour', e.target.value); log(`GM: ${t.name}'s light colour ${e.target.value}.`, 'ok'); panel(); relight(); };
      cr.querySelector('[data-f=nocolour]').onclick = () => { set('colour', 'none'); log(`GM: ${t.name}'s light uncoloured.`, 'ok'); panel(); relight(); };
      cr.querySelector('[data-f=intensity]').oninput = (e) => { cr.querySelector('.pct').textContent = e.target.value + '%'; };
      cr.querySelector('[data-f=intensity]').onchange = (e) => { set('intensity', Number(e.target.value)); log(`GM: ${t.name}'s light intensity ${e.target.value}%.`, 'ok'); panel(); relight(); };
      wireAnimRow(el.querySelector('[data-anim-for="carried"]'), () => Engine.lightSpec(t.light).animation, (a) => set('animation', a), `${t.name}'s light`);
    }
    const bl = document.getElementById('b-light');
    if (bl) bl.onclick = () => {
      const on = t.light.on === false;
      t.light = { ...t.light, on };
      log(`${t.name} ${on ? 'lights' : 'puts out'} the ${((Engine.LIGHT_PRESETS[t.light.preset] || {}).label || 'light').toLowerCase()}.`, 'ok');
      panel(); recompute();
    };
    const bm = document.getElementById('b-mark');
    if (bm) bm.onclick = () => {
      if (S.hiddenMarks[selected]) { delete S.hiddenMarks[selected]; log(`GM: hidden marker for ${t.name} cleared.`, 'ok'); }
      else { S.hiddenMarks[selected] = [t.x, t.y]; log(`GM: the party knows something is at ${t.x},${t.y} (${t.name}, hidden).`, 'ok'); }
      panel(); draw();
    };
  }

  // ---------- interaction ----------
  function cellAt(ev) {
    const r = canvas.getBoundingClientRect();
    return [((ev.clientX - r.left) / scale - OX) / CS, ((ev.clientY - r.top) / scale - OY) / CS];
  }
  function tokenAt(p) {
    const gm = S.view === 'gm';
    let best = null;
    const order = Object.keys(S.tokens).sort((a, b) => (S.tokens[b].size || 1) - (S.tokens[a].size || 1));
    for (const id of order) {
      if (!gm && !shown().seen.has(id)) continue;
      const t = space(id), s = t.size;
      if (p[0] >= t.x && p[0] < t.x + s && p[1] >= t.y && p[1] < t.y + s) best = id; // last drawn wins (smallest on top)
    }
    return best;
  }
  /** The token whose drawn disc is under p (smallest on top), or null. A token on its disc takes the
   *  click before a door: a token standing in a doorway must still be draggable. The rest of the door,
   *  outside the disc, stays clickable. */
  function tokenDiscAt(p) {
    const gm = S.view === 'gm';
    let best = null;
    const order = Object.keys(S.tokens).sort((a, b) => (S.tokens[b].size || 1) - (S.tokens[a].size || 1));
    for (const id of order) {
      if (!gm && !shown().seen.has(id)) continue;
      const t = space(id), s = t.size;
      const r = (s / 2 - (s < 1 ? 2 : 5) / CS) * Engine.drawScale(S.tokens[id]);   // as drawTokens draws it
      if (Math.hypot(p[0] - (t.x + s / 2), p[1] - (t.y + s / 2)) <= r) best = id;
    }
    return best;
  }
  /** What a click at p acts on: a token's disc first, then a door, then the rest of a token's square. */
  function clickTarget(p) {
    const disc = tokenDiscAt(p);
    if (disc) return { token: disc };
    const door = doorAt(p);
    if (door) return { door };
    const id = tokenAt(p);
    return id ? { token: id } : {};
  }
  const distToSeg = (p, a, b) => Engine.pointSegDist(p, a, b);
  /** The door leaf under p: near the closed leaf, or near the open leaf where it now stands. */
  function doorAt(p) {
    let best = null, bd = 0.3;
    for (const s of doorSegs) {
      if (!fullGM() && !doorVisibleToPlayers(s)) continue;
      const L = leafOf(s);
      let d = distToSeg(p, L.hinge, L.free);
      if (doorInfo(s).st === 'open') d = Math.min(d, distToSeg(p, L.hinge, L.openFree));
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  /** "the Ogre" for creatures, plain "Kerra" for player characters. */
  const theName = (t) => (t.kind === 'pc' ? t.name : `the ${t.name}`);
  const canDrag = (id) => S.view === 'gm' || S.tokens[id].kind === 'pc';

  function goalFor(id, p) {
    const t = S.tokens[id], size = t.size || 1;
    if (Engine.isTiny(t)) return [Math.max(0, Math.min(G.cols - 1, Math.floor(p[0]))), Math.max(0, Math.min(G.rows - 1, Math.floor(p[1])))];
    let gx = Math.round(p[0] - size / 2), gy = Math.round(p[1] - size / 2);
    gx = Math.max(0, Math.min(G.cols - size, gx)); gy = Math.max(0, Math.min(G.rows - size, gy));
    return [gx, gy];
  }

  // ---- zoom and pan (board/gestures.js): wheel and pinch zoom; the right button pans (the hand shows only then);
  // on a touch screen, one finger on empty floor or two fingers together pan ----
  const touches = new Map();   // pointerId -> {x, y}: the pointers down on the map
  let pan = null;              // {x, y, left, top, moved, deselect}: a pan in progress
  let pinch = null;            // the two pointers of a pinch, as last seen
  const stageEl = document.getElementById('stage');
  function startPan(ev, deselect, hand = false) {
    pan = { x: ev.clientX, y: ev.clientY, left: stageEl.scrollLeft, top: stageEl.scrollTop, moved: false, deselect };
    canvas.setPointerCapture(ev.pointerId);
    if (hand) canvas.style.cursor = 'grabbing';
  }
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());   // the right button pans

  canvas.addEventListener('pointerdown', (ev) => {
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (touches.size === 2) {
      // a second finger: a pinch. A token being dragged goes back where it was.
      if (drag) { drag = null; draw(); }
      pan = null;
      pinch = [...touches.values()].map((t) => ({ ...t }));
      return;
    }
    if (touches.size > 2) return;
    if (ev.button === 2) { ev.preventDefault(); startPan(ev, false, true); return; }   // right button: pan, hand cursor
    if (ev.button !== 0) return;
    const p = cellAt(ev);
    const lamp = S.view === 'gm' && LIT ? lightAt(p) : null;
    if (lamp && !tokenDiscAt(p)) {
      const on = !staticOn(lamp);
      S.lights[lamp.id] = { ...(S.lights[lamp.id] || {}), on };
      log(`GM: ${lamp.label || lamp.id} ${on ? 'lit' : 'put out'}.`, 'ok');
      lightingCard();
      return recompute();
    }
    const target = clickTarget(p);
    const id0 = target.token || null;
    // Ctrl+click: add a token to the selection or take it away (players: their PCs only)
    if ((ev.ctrlKey || ev.metaKey) && id0) {
      if (!canDrag(id0)) return;
      const cur = selectedIds();
      setSelection(cur.includes(id0) ? cur.filter((x) => x !== id0) : [...cur, id0]);
      panel(); draw(); return;
    }
    if (target.door) { clickDoor(target.door, ev.shiftKey); return; }
    const id = id0;
    const area = !id && S.view === 'gm' ? inactiveAreaAt(p) : null;
    if (area) {
      const on = S.terrain_on.includes(area.id);
      S.terrain_on = on ? S.terrain_on.filter((x) => x !== area.id) : [...S.terrain_on, area.id];
      log(`GM: ${area.label || area.id} ${on ? 'switched off' : 'now applies'} (${TERRAIN_LOOK[area.kind].name}).`, 'ok');
      return recompute();
    }
    // Empty floor: a left drag draws a selection box; a click clears the selection (on release).
    // On a touch screen a one-finger drag there pans instead (no right button).
    if (!id && ev.pointerType === 'touch') { startPan(ev, true); return; }
    if (!id) { startBox(ev, p); return; }
    // A token in a multi-selection: the whole group moves with it (no route, no warnings)
    if (multi.has(id)) {
      drag = { id, group: new Map([...multi].map((x) => [x, [S.tokens[x].x, S.tokens[x].y]])), start: [S.tokens[id].x, S.tokens[id].y], goal: [S.tokens[id].x, S.tokens[id].y], dx: 0, dy: 0, moved: false };
      canvas.setPointerCapture(ev.pointerId);
      return;
    }
    setSelection([id]); panel();
    if (canDrag(id)) {
      drag = { id, goal: [S.tokens[id].x, S.tokens[id].y], moved: false };
      canvas.setPointerCapture(ev.pointerId);
    }
    draw();
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (touches.has(ev.pointerId)) touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch && touches.size >= 2) {
      const now = [...touches.values()].slice(0, 2);
      const st = pinchStep(pinch, now);
      pinch = now.map((t) => ({ ...t }));
      queueView(st.factor, st.mid.x, st.mid.y, st.dx, st.dy);
      return;
    }
    if (box) { moveBox(ev); return; }
    if (drag && drag.group) {
      const g = goalFor(drag.id, cellAt(ev));
      const dx = g[0] - drag.start[0], dy = g[1] - drag.start[1];
      if (dx !== drag.dx || dy !== drag.dy) { drag.dx = dx; drag.dy = dy; drag.goal = g; drag.moved = true; draw(); }
      return;
    }
    if (pan) {
      if (!pan.moved && isDrag(pan.x, pan.y, ev.clientX, ev.clientY)) pan.moved = true;
      if (pan.moved) { stageEl.scrollLeft = pan.left - (ev.clientX - pan.x); stageEl.scrollTop = pan.top - (ev.clientY - pan.y); }
      return;
    }
    const p = cellAt(ev);
    hoverCell = [Math.floor(p[0]), Math.floor(p[1])];
    const over = drag ? {} : clickTarget(p);
    const h = !drag && over.token && (fullGM() || shown().seen.has(over.token)) ? over.token : null;
    if (h !== hoverId) { hoverId = h; draw(); }
    canvas.style.cursor = over.door ? 'pointer' : over.token ? (canDrag(over.token) ? 'grab' : 'pointer') : 'default';
    if (drag) {
      const g = goalFor(drag.id, p);
      if (g[0] !== drag.goal[0] || g[1] !== drag.goal[1]) {
        drag.goal = g; drag.moved = true;
        const ms = mspace(drag.id), off = Engine.isTiny(S.tokens[drag.id]) ? 0.25 : 0;
        drag.route = Engine.path(moveWalls, ms, g[0] + off, g[1] + off, moveOpts(drag.id));
      }
      draw();
    } else hud();
  });
  function pointerEnd(ev, cancelled) {
    touches.delete(ev.pointerId);
    if (pinch) { if (touches.size < 2) pinch = null; return; }
    if (box) { endBox(cancelled); return; }
    if (drag && drag.group) {
      const d = drag; drag = null;
      if (!cancelled && d.moved && (d.dx || d.dy)) moveGroup([...d.group.keys()], d.dx, d.dy);
      else draw();
      return;
    }
    if (pan) {
      const { moved, deselect } = pan;
      pan = null; canvas.style.cursor = 'default';
      if (!moved && deselect && !cancelled) { selected = null; panel(); draw(); }
      return;
    }
    if (!drag) return;
    const { id, goal, route, moved } = drag;
    drag = null;
    if (!cancelled && moved && (goal[0] !== S.tokens[id].x || goal[1] !== S.tokens[id].y)) moveToken(id, goal, route);
    else draw();
  }
  canvas.addEventListener('pointerup', (ev) => pointerEnd(ev, false));
  canvas.addEventListener('pointercancel', (ev) => pointerEnd(ev, true));
  canvas.addEventListener('pointerleave', () => { hoverCell = null; if (hoverId) { hoverId = null; draw(); } else hud(); });

  // ---- targeting (T): this view's own list; the GM view also shows the player's ----
  const myTargets = () => TARGETS[S.view === 'gm' ? 'gm' : 'player'];
  function setMyTargets(ids, what) {
    const who = S.view === 'gm' ? 'gm' : 'player';
    TARGETS[who] = ids;
    sending('targets/' + who, store.set('targets/' + who, { ids })).catch((e) => toast(`Could not save the targets (${e.message || e}).`));
    if (what) toast(what);
    targetsChanged();
  }
  window.addEventListener('keydown', (e) => {
    if (e.key !== 't' && e.key !== 'T') return;
    if (e.ctrlKey || e.metaKey || e.altKey || (e.target.closest && e.target.closest('input, textarea, select, [role^=menu]'))) return;
    if (READONLY) return;
    e.preventDefault();
    if (e.shiftKey) { if (myTargets().length) setMyTargets([], 'Targets cleared.'); return; }
    if (!hoverId) return;
    setMyTargets(toggleTarget(myTargets(), hoverId));
  });
  /** What to mark: [{id, own}] for tokens on this map that this view may see. */
  function targetMarks() {
    const F = shown(), full = fullGM(), out = [];
    const add = (ids, own) => { for (const id of ids) if (S.tokens[id] && (full || F.seen.has(id)) && !out.some((m) => m.id === id && m.own)) out.push({ id, own }); };
    add(myTargets(), true);
    if (S.view === 'gm') add(TARGETS.player, false);
    return out;
  }
  let tgtRaf = null;
  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function targetsChanged() { if (!tgtRaf) tgtRaf = requestAnimationFrame(drawTargets); }
  /** The target triangles: the view's own filled, the player's (in the GM view) as outlines; they pulse inward. */
  function drawTargets(now) {
    tgtRaf = null;
    const dpr = window.devicePixelRatio || 1;
    tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.clearRect(0, 0, tgtCanvas.width, tgtCanvas.height);
    const marks = targetMarks();
    if (!marks.length) return;
    tctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0); tctx.translate(OX, OY);
    const phase = REDUCED ? 0.25 : ((now || 0) % 1400) / 1400;
    for (const { id, own } of marks) {
      const t = S.tokens[id], sp = space(id), q = Engine.isTiny(t) && layout.spaces.get(id);
      const m = markSquare(sp, Engine.isTiny(t), !!q && q.slot !== null);
      const { paths, alpha } = chevrons(P(m.x), P(m.y), P(m.size), phase);
      tctx.save();
      tctx.globalAlpha = own ? alpha : 0.85;
      tctx.lineCap = 'round'; tctx.lineJoin = 'round';
      // this view's own targets: filled triangles; the player's, in the GM view: outlines only
      for (const pts of paths) {
        tctx.beginPath(); tctx.moveTo(...pts[0]); tctx.lineTo(...pts[1]); tctx.lineTo(...pts[2]); tctx.closePath();
        tctx.strokeStyle = 'rgba(10, 12, 16, .85)'; tctx.lineWidth = own ? 2 : 3.5; tctx.stroke();
        if (own) { tctx.fillStyle = kindColour(t.kind); tctx.fill(); }
        else { tctx.strokeStyle = kindColour(t.kind); tctx.lineWidth = 1.5; tctx.stroke(); }
      }
      tctx.restore();
      // the token's square stays on top of its triangles
      const box = !drag && boxFor(id, sp, layout);
      if (box) strokeBox(tctx, box);
    }
    if (!REDUCED) tgtRaf = requestAnimationFrame(drawTargets);
  }

  // ---- the selection box and group moves ----
  let box = null;   // {x, y, p0, moved}: a selection box being drawn from a press on empty floor
  const boxEl = document.createElement('div');
  boxEl.className = 'selbox'; boxEl.hidden = true;
  stageEl.appendChild(boxEl);
  function startBox(ev, p) {
    box = { x: ev.clientX, y: ev.clientY, p0: p, moved: false };
    canvas.setPointerCapture(ev.pointerId);
  }
  function moveBox(ev) {
    if (!box.moved && !isDrag(box.x, box.y, ev.clientX, ev.clientY)) return;
    box.moved = true; box.cx = ev.clientX; box.cy = ev.clientY; box.p1 = cellAt(ev);
    const sr = stageEl.getBoundingClientRect();
    const l = Math.min(box.x, ev.clientX), t = Math.min(box.y, ev.clientY);
    boxEl.style.left = l - sr.left + stageEl.scrollLeft + 'px'; boxEl.style.top = t - sr.top + stageEl.scrollTop + 'px';
    boxEl.style.width = Math.abs(ev.clientX - box.x) + 'px'; boxEl.style.height = Math.abs(ev.clientY - box.y) + 'px';
    boxEl.hidden = false;
  }
  /** Tokens a box picks: centre inside it. Players pick their PCs only; the GM picks every token. */
  function tokensInBox(p0, p1) {
    const [x0, x1] = [Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0])], [y0, y1] = [Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1])];
    return Object.keys(S.tokens).filter((id) => {
      if (S.view !== 'gm' && S.tokens[id].kind !== 'pc') return false;
      const sp = space(id), cx = sp.x + sp.size / 2, cy = sp.y + sp.size / 2;
      return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
    });
  }
  function endBox(cancelled) {
    const b = box; box = null; boxEl.hidden = true;
    if (cancelled) return;
    setSelection(b.moved ? tokensInBox(b.p0, b.p1) : []);   // a click without a box clears the selection
    panel(); draw();
  }
  /** Move several tokens by (dx, dy) together, keeping their spacing. No route and no warnings (the user's choice). */
  function moveGroup(ids, dx, dy) {
    ids = ids.filter((id) => S.tokens[id]);
    // The whole group stops at the map's edge together, so it keeps its shape.
    for (const id of ids) {
      const t = S.tokens[id], size = Engine.isTiny(t) ? 1 : (t.size || 1);
      dx = Math.max(-t.x, Math.min(G.cols - size - t.x, dx));
      dy = Math.max(-t.y, Math.min(G.rows - size - t.y, dy));
    }
    if (!dx && !dy) return;
    const moved = [];
    for (const id of ids) {
      const t = S.tokens[id];
      t.x += dx; t.y += dy;
      delete t.slot;
      moved.push(t.name);
    }
    if (moved.length) log(`${moved.join(', ')} moved together.`);
    panel(); recompute();
  }

  function moveToken(id, goal, route) {
    const t = S.tokens[id], tiny = Engine.isTiny(t), size = t.size || 1, off = tiny ? 0.25 : 0;
    const fits = Engine.fits(moveWalls, goal[0] + off, goal[1] + off, size);
    const tinyHere = tiny ? Object.entries(S.tokens).filter(([o, u]) => o !== id && Engine.isTiny(u) && u.x === goal[0] && u.y === goal[1]).length : 0;
    const blocking = tiny ? [] : Engine.blockersAt({ id, ...t }, goal[0], goal[1], raw());
    if (blocking.length) { const who = blocking.map(theName).join(' and '); toast(`${t.name} cannot share a square with ${who}.`); log(`${t.name} placed on ${who} (GM call).`, 'warn'); }
    if (tiny && tinyHere >= Engine.MAX_PER_SQUARE) { toast(`Only ${Engine.MAX_PER_SQUARE} Tiny creatures fit in one square.`); log(`${t.name} squeezed into a full square (GM call).`, 'warn'); }
    // The board warns but never prevents: the GM decides.
    if (!fits) { toast(`${t.name} does not fit there.`); log(`${t.name} placed where it does not fit (GM call).`, 'warn'); }
    else if (!route) { toast(`No route for ${t.name}: walls are in the way.`); log(`${t.name} moved with no legal route (GM call).`, 'warn'); }
    else if (route.feet > t.speed) { toast(`${route.feet} ft is more than ${t.name}'s ${t.speed} ft Speed.`); log(`${t.name} moved ${route.feet} ft, beyond its Speed.`, 'warn'); }
    else {
      const tn = routeNotes(id, route);
      log(`${t.name} moved ${route.feet} ft to ${goal[0]},${goal[1]}${tn.extraFt ? `, ${tn.extraFt} ft of it for difficult terrain` : ''}.`);
      for (const n of tn.notes) log(`${t.name}: ${n}.`, 'warn');
    }
    t.x = goal[0]; t.y = goal[1];
    delete t.slot; // a token arriving in a square takes the next free quadrant
    panel(); recompute();
  }

  canvas.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { setSelection([]); panel(); draw(); return; }
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (k && multi.size) { ev.preventDefault(); moveGroup([...multi], k[0], k[1]); return; }
    if (!k || !selected || !canDrag(selected)) return;
    ev.preventDefault();
    const t = S.tokens[selected];
    if (!Engine.canStep(moveWalls, mspace(selected), k[0], k[1])) {
      toast(`${t.name} cannot step that way.`); return;
    }
    const entered = terrain.entered(t.x, t.y, t.x + k[0], t.y + k[1], mspace(selected).size);
    const stepOk = Engine.canStepInto(entered, moverOf(selected));
    t.x += k[0]; t.y += k[1]; delete t.slot;
    if (stepOk) log(`${t.name} steps to ${t.x},${t.y}.`);
    else log(`${t.name} moves to ${t.x},${t.y}: difficult terrain, so this is a Stride, not a Step.`, 'warn');
    panel(); recompute();
  });

  function setView(v) {
    S.view = v;
    document.getElementById('v-player').setAttribute('aria-pressed', String(v === 'player'));
    document.getElementById('v-gm').setAttribute('aria-pressed', String(v === 'gm'));
    if (v === 'player' && selected && !view.seen.has(selected)) selected = null;
    if (v === 'player' && multi.size) setSelection([...multi].filter((id) => S.tokens[id] && S.tokens[id].kind === 'pc'));
  document.getElementById('changelog').hidden = v !== 'gm';
  if (v === 'gm') changeLogCard();
    document.getElementById('b-colour').hidden = !(HAS_LIGHTING && v === 'gm');
    document.getElementById('b-anim').hidden = !(HAS_LIGHTING && v === 'gm');
    panel(); lightingCard(); draw();
    if (shellReady) shell.setView(v);
    if (READONLY && v !== 'gm') shell.leavePreview();
  }
  document.getElementById('v-player').onclick = () => setView('player');
  document.getElementById('v-gm').onclick = () => { if (S.view !== 'gm') confirmGM(); };
  function syncColourButton() {
    const b = document.getElementById('b-colour');
    b.setAttribute('aria-pressed', String(S.light_colour.on));
    b.textContent = S.light_colour.on ? 'Colour on' : 'Colour off';
  }
  document.getElementById('b-colour').onclick = () => {
    S.light_colour = { ...S.light_colour, on: !S.light_colour.on };
    syncColourButton();
    log(`GM: coloured light ${S.light_colour.on ? 'on' : 'off'} for the whole table.`, 'ok');
    draw();
  };
  document.getElementById('b-walls').onclick = (e) => { S.walls = !S.walls; e.currentTarget.setAttribute('aria-pressed', String(S.walls)); draw(); };
  if (HAS_LIGHTING) {
    const bl = document.getElementById('b-lighting');
    bl.hidden = false;
    bl.onclick = () => {
      LIT = !LIT;
      bl.setAttribute('aria-pressed', String(LIT));
      bl.textContent = LIT ? 'Lighting on' : 'Lighting off';
      document.getElementById('sky-wrap').hidden = !(LIT && HAS_SKY);
      log(LIT ? 'Lighting on: light, darkness and senses apply.' : 'Lighting off: everything counts as bright (sight is walls only).', 'ok');
      panel(); lightingCard(); recompute();
    };
  }
  if (HAS_SKY) {
    document.getElementById('sky-wrap').hidden = false;
    document.getElementById('sky').onchange = (e) => { S.sky = e.target.value; log(`GM: the sky is now ${S.sky} (${{ bright: 'day', dim: 'dusk', dark: 'night' }[S.sky]}).`, 'ok'); recompute(); };
  }

  let toastT = 0;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2400);
  }
  function log(msg, cls = '') {
    const li = document.createElement('li'); li.textContent = msg; if (cls) li.className = cls;
    const ol = document.getElementById('log'); ol.prepend(li);
    while (ol.children.length > 30) ol.lastChild.remove();
  }

  // ---------- zoom ----------
  let zoom = 1, baseScale = 1;
  const ZMIN = 0.5, ZMAX = 6;
  /** Zoom to z, keeping the map point under (cx, cy) on screen (default: the middle of the view). */
  function setZoom(z, cx, cy) {
    const stage = document.getElementById('stage');
    const sr = stage.getBoundingClientRect();
    if (cx === undefined) { cx = sr.left + sr.width / 2; cy = sr.top + sr.height / 2; }
    const r = canvas.getBoundingClientRect();
    const ix = (cx - r.left) / scale, iy = (cy - r.top) / scale;   // image pixels under the pointer
    zoom = Math.max(ZMIN, Math.min(ZMAX, z));
    fit();
    const r2 = canvas.getBoundingClientRect();
    stage.scrollLeft += r2.left + ix * scale - cx;
    stage.scrollTop += r2.top + iy * scale - cy;
  }
  document.getElementById('z-in').onclick = () => setZoom(zoom * 1.25);
  document.getElementById('z-out').onclick = () => setZoom(zoom / 1.25);
  document.getElementById('z-fit').onclick = () => { zoom = 1; fit(); };
  // The wheel zooms about the pointer (mouse wheel, trackpad scroll, and trackpad pinch: Ctrl+wheel).
  // Changes are gathered and applied once per frame, so a fast wheel or pinch redraws at most once a frame.
  let viewQ = null;
  function queueView(factor, cx, cy, dx = 0, dy = 0) {
    if (!viewQ) { viewQ = { factor: 1, cx, cy, dx: 0, dy: 0 }; requestAnimationFrame(applyView); }
    viewQ.factor *= factor; viewQ.cx = cx; viewQ.cy = cy; viewQ.dx += dx; viewQ.dy += dy;
  }
  function applyView() {
    const q = viewQ; viewQ = null;
    if (Math.abs(q.factor - 1) > 1e-4) setZoom(zoom * q.factor, q.cx, q.cy);
    if (q.dx || q.dy) { stageEl.scrollLeft -= q.dx; stageEl.scrollTop -= q.dy; }
  }
  stageEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    queueView(wheelZoomFactor(e, stageEl.clientHeight), e.clientX, e.clientY);
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoom * 1.25); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(zoom / 1.25); }
    else if (e.key === '0') { e.preventDefault(); zoom = 1; fit(); }
  });
  window.addEventListener('resize', fit);
  img.onload = () => draw();

  // ---------- keeping the table in step with the store ----------
  const by = () => (S.view === 'gm' ? 'gm' : 'player');
  const known = new Map();       // path -> canonical JSON of the store's value, as last seen or written
  const knownData = new Map();   // path -> that value
  let mapStateBase = clone(MS);  // fields of the map's state the board does not hold, kept as they are
  const TOKEN_LOCAL = new Set(['slot']);   // kept on tokens; everything else on a token record is the store's

  function recordsFromState() {
    const out = {};
    for (const [id, t] of Object.entries(S.tokens)) out['tokens/' + id] = { ...t, map: MAP_ID };
    out['mapstate/' + MAP_ID] = {
      ...mapStateBase, map: MAP_ID, doors: S.doors, locked_known: S.locked_known, terrain: S.terrain, terrain_on: S.terrain_on,
      terrain_off: S.terrain_off, links_found: S.links_found, lights: S.lights, regions: S.regions, regions_off: S.regions_off,
      hidden_marks: S.hiddenMarks,
    };
    out['state/table'] = tableRecord(TABLE, S.sky, S.light_colour, S.light_animation);
    return out;
  }
  /** The table record as the board holds it: the store's, with the board's defaults filled in. */
  function tableRecord(t, sky = t.sky_light, colour = t.light_colour, anim = t.light_animation) {
    return { ...t, current_map: MAP_ID, sky_light: sky || 'bright', light_colour: { on: true, strength: 25, ...(colour || {}) }, light_animation: { on: true, ...(anim || {}) } };
  }
  for (const [p, d] of Object.entries(recordsFromState())) { const v = prune(d); known.set(p, canon(v)); knownData.set(p, v); }

  // Our own writes come back from the store, one at a time per record and late (the platform writes a
  // record's changes in order). A late echo of an older write must not count as someone else's change, or it
  // would put a token back where it was a moment ago (and a key pressed then would move it from there).
  // While a record has writes of ours in progress, whatever the store reports for it is out of date: an echo of
  // an earlier write of ours, or (through a collection watch, which re-sends every record whenever any one
  // changes) its value from before our writes landed. Applying either would put a token back where it was a
  // moment ago, and a key pressed then would move it on from there. So a busy record's reports are ignored,
  // and when its last write settles it is read once more, in case someone else changed it meanwhile.
  const inflight = new Map();   // path -> writes of ours not yet settled
  const resync = {};            // collection -> (path) => re-read and apply; set by startSync()
  const busy = (p) => inflight.has(p);
  function sending(p, promise) {
    inflight.set(p, (inflight.get(p) || 0) + 1);
    const done = () => {
      const n = inflight.get(p) - 1;
      if (n > 0) { inflight.set(p, n); return; }
      inflight.delete(p);
      const r = resync[p.split('/')[0]];
      if (r) r(p);
    };
    promise.then(done, done);
    return promise;
  }
  let persistT = null;
  function schedulePersist() { if (!persistT) persistT = setTimeout(persist, 0); }
  /** Write every record the board's state changed, each with a change-log entry. */
  function persist() {
    persistT = null;
    if (READONLY) return;   // a preview writes nothing
    for (const [p, data] of Object.entries(recordsFromState())) {
      const v = prune(data), c = canon(v);
      if (known.get(p) === c) continue;
      const before = knownData.get(p);
      known.set(p, c); knownData.set(p, v);
      sending(p, store.set(p, v)).catch((e) => toast(`Could not save a change (${e.message || e}).`));
      for (const what of describe(p, before, v)) logChange(what);
    }
  }

  const doorLabel = (id) => { const s = doorSegs.find((d) => d.door.id === id); return (s && s.door.label) || id; };
  const lampLabel = (id) => { const l = (LIGHTING.lights || []).find((x) => x.id === id); return (l && l.label) || id; };
  const regionLabel = (id) => { const r = (LIGHTING.regions || []).find((x) => x.id === id); return (r && r.label) || id; };
  const changedKeys = (a = {}, b = {}) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => canon(a[k]) !== canon(b[k]));
  /** What changed in a record, in words, for the change log. */
  function describe(p, before = {}, after = {}) {
    const [coll, id] = p.split('/');
    if (coll === 'tokens') {
      const name = after.name || id, out = [];
      if (before.x !== after.x || before.y !== after.y) out.push(`${name} moved to ${after.x},${after.y}`);
      const lb = before.light || {}, la = after.light || {};
      if ((lb.on !== false) !== (la.on !== false) && after.light) out.push(`${name} ${la.on === false ? 'put out' : 'lit'} the light`);
      for (const k of ['colour', 'intensity', 'animation']) if (canon(lb[k]) !== canon(la[k])) out.push(`${name}'s light ${k}: ${typeof la[k] === 'object' ? canon(la[k]) : la[k]}`);
      for (const k of changedKeys(before, after).filter((k) => !['x', 'y', 'light', 'slot'].includes(k))) out.push(`${name}: ${k} changed`);
      return out;
    }
    if (coll === 'mapstate') {
      const out = [];
      for (const d of changedKeys(before.doors, after.doors)) {
        const a = (after.doors || {})[d] || {}, b = (before.doors || {})[d] || {};
        if (a.found && !b.found) out.push(`${doorLabel(d)} found`);
        if (a.state !== b.state) out.push(`${doorLabel(d)} ${a.state || 'back to its first state'}`);
      }
      for (const l of changedKeys(before.lights, after.lights)) {
        const a = (after.lights || {})[l] || {}, b = (before.lights || {})[l] || {};
        if (a.on !== b.on && a.on !== undefined) out.push(`${lampLabel(l)} ${a.on ? 'lit' : 'put out'}`);
        for (const k of ['colour', 'intensity', 'animation']) if (canon(a[k]) !== canon(b[k])) out.push(`${lampLabel(l)} ${k}: ${typeof a[k] === 'object' ? canon(a[k]) : a[k]}`);
      }
      for (const r of changedKeys(before.regions, after.regions)) out.push(`${regionLabel(r)} changed: ${canon((after.regions || {})[r] || {})}`);
      const setDiff = (k, on, off) => {
        const a = new Set(after[k] || []), b = new Set(before[k] || []);
        for (const x of a) if (!b.has(x)) out.push(on(x));
        for (const x of b) if (!a.has(x)) out.push(off(x));
      };
      setDiff('regions_off', (x) => `${regionLabel(x)} switched off`, (x) => `${regionLabel(x)} switched on`);
      setDiff('terrain_on', (x) => `terrain ${x} now applies`, (x) => `terrain ${x} switched off`);
      setDiff('locked_known', (x) => `the party knows ${doorLabel(x)} is locked`, (x) => `${doorLabel(x)} no longer known locked`);
      for (const m of changedKeys(before.hidden_marks, after.hidden_marks)) out.push((after.hidden_marks || {})[m] ? `hidden marker for ${m} at ${after.hidden_marks[m].join(',')}` : `hidden marker for ${m} cleared`);
      if (!out.length) out.push('map state changed');
      return out;
    }
    if (coll === 'state') {
      const out = [];
      if (before.sky_light !== after.sky_light) out.push(`sky ${after.sky_light}`);
      const cb = before.light_colour || {}, ca = after.light_colour || {};
      if (cb.on !== ca.on) out.push(`coloured light ${ca.on === false ? 'off' : 'on'}`);
      if (cb.strength !== ca.strength) out.push(`colour strength ${ca.strength}%`);
      if (canon(before.light_animation) !== canon(after.light_animation)) out.push(`light animation ${(after.light_animation || {}).on === false ? 'off' : 'on'}`);
      return out;
    }
    return [`${p} changed`];
  }
  let logN = 0;
  function logChange(what) {
    const id = Date.now().toString(36).padStart(9, '0') + '-' + (logN++).toString(36) + Math.random().toString(36).slice(2, 6);
    store.set('log/' + id, { by: by(), at: new Date().toISOString(), map: MAP_ID, what }).catch(() => {});
  }

  // the explored area: written a moment after it grows
  let exploredT = null, exploredPaths = new Set(ex.length ? (await store.list('explored')).filter((e) => e.data.map === MAP_ID).map((e) => e.path) : []);
  let exploredV = EXPLORED0 ? EXPLORED0.v || 1 : 0, exploredCanon = EXPLORED0 ? canon(EXPLORED0.polys) : canon([]);
  function exploredChanged() { clearTimeout(exploredT); exploredT = setTimeout(saveExplored, 1500); }
  function saveExplored() {
    if (READONLY) return;
    const polys = mask.toPolys();
    exploredV++; exploredCanon = canon(polys);
    const recs = exploredRecords(MAP_ID, { v: exploredV, polys });
    for (const [p, d] of Object.entries(recs)) store.set(p, d).catch(() => {});
    for (const p of exploredPaths) if (!recs[p]) store.remove(p).catch(() => {});
    exploredPaths = new Set(Object.keys(recs));
  }

  let remoteT = null;
  function remoteChanged() { if (!remoteT) remoteT = setTimeout(() => { remoteT = null; panel(); lightingCard(); recompute(); }, 0); }
  /** Has the store's value at p changed from what the board knows? If so, remember it and say yes. */
  function fresh(p, data) {
    const v = prune(data || {}), c = canon(v);
    if (known.get(p) === c) return false;
    known.set(p, c); knownData.set(p, v);
    return true;
  }
  function reloadBoard(why) { toast(why + ' Reloading the board...'); setTimeout(() => location.reload(), 900); }

  let CHANGES = [];
  const LOG_KEEP = 300;
  function startSync() {
    store.watch('board/meta', (m) => {
      if (!m) return reloadBoard('The campaign was unloaded.');
      if (m.campaign.id !== META.campaign.id || m.loaded_at !== META.loaded_at) reloadBoard(`${m.campaign.title} is now on the table.`);
    });
    const onTable = (t) => {
      if (!t) return;
      TABLE = t;
      travelChanged();
      if (READONLY) { travelChanged(); return shell.previewBar(); }
      if (t.current_map && t.current_map !== MAP_ID) return reloadBoard('The table moved to another map.');
      if (busy('state/table') || !fresh('state/table', tableRecord(t))) return;
      S.sky = t.sky_light || 'bright';
      S.light_colour = { on: true, strength: 25, ...(t.light_colour || {}) };
      S.light_animation = { on: true, ...(t.light_animation || {}) };
      document.getElementById('sky').value = S.sky;
      syncColourButton(); syncAnimButton();
      remoteChanged();
    };
    store.watch('state/table', onTable);
    const onMapState = (d) => {
      if (!d || busy('mapstate/' + MAP_ID) || !fresh('mapstate/' + MAP_ID, d)) return;
      mapStateBase = clone(d);
      S.doors = d.doors || {}; S.locked_known = d.locked_known || []; S.terrain = d.terrain || [];
      S.terrain_on = d.terrain_on || []; S.terrain_off = d.terrain_off || []; S.links_found = d.links_found || [];
      S.lights = d.lights || {}; S.regions = d.regions || {}; S.regions_off = d.regions_off || [];
      S.hiddenMarks = d.hidden_marks || {};
      remoteChanged();
    };
    store.watch('mapstate/' + MAP_ID, onMapState);
    const onTokens = (list) => {
      let changed = false;
      const here = new Set();
      for (const e of list) {
        if (e.data.map !== MAP_ID) continue;
        here.add(e.id);
        if (drag && (drag.id === e.id || (drag.group && drag.group.has(e.id)))) continue;   // being moved here: our move wins
        if (busy(e.path) || !fresh(e.path, e.data)) continue;
        const { map: _m, ...t } = e.data;
        for (const k of TOKEN_LOCAL) if (S.tokens[e.id] && S.tokens[e.id][k] !== undefined && t[k] === undefined) t[k] = S.tokens[e.id][k];
        S.tokens[e.id] = t;
        changed = true;
      }
      for (const id of Object.keys(S.tokens)) {
        if (here.has(id)) continue;
        delete S.tokens[id]; known.delete('tokens/' + id); knownData.delete('tokens/' + id);
        if (selected === id) selected = null;
        if (multi.has(id)) setSelection([...multi].filter((x) => x !== id));
        changed = true;
      }
      if (changed) remoteChanged();
    };
    store.watchCollection('tokens', onTokens);
    store.watchCollection('targets', (list) => {
      let changed = false;
      for (const who of ['player', 'gm']) {
        if (busy('targets/' + who)) continue;
        const e = list.find((x) => x.id === who), ids = (e && e.data.ids) || [];
        if (JSON.stringify(ids) !== JSON.stringify(TARGETS[who])) { TARGETS[who] = ids; changed = true; }
      }
      if (changed) targetsChanged();
    });
    resync.state = (p) => { if (p === 'state/table') store.get(p).then(onTable).catch(() => {}); };
    resync.mapstate = (p) => { if (p === 'mapstate/' + MAP_ID) store.get(p).then(onMapState).catch(() => {}); };
    resync.tokens = () => store.list('tokens').then(onTokens).catch(() => {});
    resync.targets = (p) => store.get(p).then((d) => { const who = p.split('/')[1]; const ids = (d && d.ids) || []; if (JSON.stringify(ids) !== JSON.stringify(TARGETS[who])) { TARGETS[who] = ids; targetsChanged(); } }).catch(() => {});
    store.watchCollection('explored', (list) => {
      const mine = list.filter((e) => e.data.map === MAP_ID);
      const polys = exploredFromRecords(mine.map((e) => e.data)).polys;
      if (canon(polys) === exploredCanon) return;
      exploredCanon = canon(polys); exploredPaths = new Set(mine.map((e) => e.path));
      mask = Engine.ExploredMask.fromExplored({ v: 1, polys }, G);   // Claude reset or edited the fog
      remoteChanged();
    });
    store.watchCollection('log', (list) => {
      CHANGES = list;
      if (S.view === 'gm') changeLogCard();
      // the log is a growing stream: keep the newest LOG_KEEP entries (the platform caps records per board)
      if (list.length > LOG_KEEP + 50) for (const e of list.slice(0, list.length - LOG_KEEP)) store.remove(e.path).catch(() => {});
    });
  }

  // ---------- the GM switch and the change log ----------
  function confirmGM() {
    const dlg = document.getElementById('gm-confirm');
    dlg.hidden = false;
    dlg.querySelector('[data-a=yes]').focus();
    dlg.querySelector('[data-a=yes]').onclick = () => { dlg.hidden = true; setView('gm'); log('GM view: unseen foes, secret doors and other spoilers are shown.', 'warn'); };
    dlg.querySelector('[data-a=no]').onclick = () => { dlg.hidden = true; };
  }
  const WHO = { claude: 'Claude', gm: 'GM view', player: 'Player' };
  function changeLogCard() {
    const el = document.getElementById('changelog');
    const rows = CHANGES.slice(-60).reverse().map((e) => {
      const d = e.data, t = d.at ? new Date(d.at) : null;
      const time = t ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      return `<li><span class="when">${time}</span> <b class="who who-${d.by}">${WHO[d.by] || d.by}</b> ${String(d.what || '').replace(/</g, '&lt;')}</li>`;
    });
    el.innerHTML = `<h2>Change log</h2><ol class="changes">${rows.join('') || '<li class="muted">No changes yet.</li>'}</ol>`;
  }

  // ---------- the page around the map (board/shell.js): menus, travel, preview, version ----------
  const shell = makeShell({
    store, meta: META, build, table: () => TABLE, mapId: MAP_ID, mapName: map.name, partyMap: PARTY_MAP, readOnly: READONLY,
    view: () => S.view, tokensHere: () => S.tokens, toast, logChange, centreOn: centreOnLink, fitWhole: () => { zoom = 1; fit(); },
  });
  shellReady = true;
  const travelChanged = () => shell.travelChanged();
  function centreOnLink(linkId) {
    const l = linkId === '_start' ? (map.start ? { label: 'Starting area', at: map.start } : null) : (map.links || []).find((x) => x.id === linkId);
    if (!l) return;
    const [x, y] = l.at[0];
    zoom = Math.max(zoom, 1.5); fit();
    const stage = document.getElementById('stage');
    const sr = stage.getBoundingClientRect(), r = canvas.getBoundingClientRect();
    stage.scrollLeft += r.left - sr.left + (OX + (x + 0.5) * CS) * scale - stage.clientWidth / 2;
    stage.scrollTop += r.top - sr.top + (OY + (y + 0.5) * CS) * scale - stage.clientHeight / 2;
    toast(l.label);
  }

  // ---------- a handle for tests and debugging (read-mostly; the board never depends on it) ----------
  window.reliquary = {
    store, meta: META, map: MAP_ID,
    state: () => clone(S),
    known: (p) => clone(knownData.get(p)),
    exploredPolys: () => mask.toPolys(),
    select: (id) => { setSelection(id ? [id] : []); panel(); draw(); },
    selection: () => selectedIds(),
    targets: () => clone(TARGETS),
    hover: () => hoverId,
    view: (v) => setView(v),
    menu: () => shell.menu(),
    mapMenu: () => shell.mapMenu(),
    preview: () => (READONLY ? MAP_ID : null),
    sky: (v) => { S.sky = v; document.getElementById('sky').value = v; recompute(); },
    cellPoint: (x, y) => { const r = canvas.getBoundingClientRect(); return [r.left + (OX + x * CS) * scale, r.top + (OY + y * CS) * scale]; },
  };

  // ---------- start ----------
  document.title = META.campaign.title + ' · Reliquary Virtual Tabletop';
  document.getElementById('campaign-title').textContent = META.campaign.title;
  document.getElementById('subtitle').textContent = NOTES.subtitle || `${META.pack.title} · ${map.name || map.id}`;
  document.getElementById('try').innerHTML = (NOTES.tips || []).map((t) => `<li>${t}</li>`).join('');
  document.getElementById('try').closest('section').hidden = !(NOTES.tips || []).length;
  document.getElementById('sky').value = S.sky;
  syncColourButton(); syncAnimButton();
  if (NOTES.intro) log(NOTES.intro);
  recompute('reset');
  panel();
  lightingCard();
  fit();
  shell.startMenu();
  await shell.startMapMenu();
  if (keepGM) setView('gm');
  if (PREVIEW && PREVIEW.link) centreOnLink(PREVIEW.link);
  shell.previewBar();
  startSync();
  shell.watchBuild();
}
