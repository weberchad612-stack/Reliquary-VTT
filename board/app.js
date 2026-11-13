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
import { mapFromRecords, exploredFromRecords, exploredRecords, contentPath } from './records.js';
import { quickViewAccess, quickViewTitle, quickViewBody, quickViewKeys } from './quickview.js';
import { makeShell, pageMap } from './shell.js';
import { startArea } from './area.js';
import { wheelZoomFactor, pinchStep, isDrag } from './gestures.js';
import { kindColour, SELECTED_COLOUR, toggleTarget, markSquare, chevrons } from './targeting.js';
import { NOTE_MAX, NOTE_COMMAND, authorName, noteColour, noteVisible, canEditNote, cleanText, notePoint, noteRecord, noteGist, collapsedStore } from './notes.js';
import { removeButton } from './ui.js';
import { mountClock } from './clockui.js';
import { mountTracker } from './trackerui.js';
import { mountChat } from './chatui.js';
import { mountSidebar } from './sidebar.js';
import { makeFloating, bringToFront } from './panel.js';
import { chatPath, logMessage, changeLog } from './chat.js';
import { badgesFor, badgeSlot, tokenState, cannotSee, stepCondition, describeEffects, KIND_COLOURS } from './effects.js';
import { makeId } from './ids.js';
import { publicName, nameFor, letterOf } from './names.js';
import { fxRecord, fxId, FX_COLLECTION, STAGGER, newPlays, stale, playTargets, templateAim, libraries, paletteOf, previewList, prefStore } from './fx.js';
import { TEMPLATE_COLOURS, hexA, colourOf, nextColour, canRemove, markerPoints, areaTargets, sizeFeet, templateRecord } from './templates.js';

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
  const MAPNOTES = {};       // map notes on this map: {id: note} (records notes/<id>)
  for (const e of await store.list('notes')) if (e.data.map === MAP_ID) { const { map: _m, ...n } = e.data; MAPNOTES[e.id] = n; }
  const TEMPLATES = {};   // area templates on this map: {id: template} (records templates/<id>)
  for (const e of await store.list('templates')) if (e.data.map === MAP_ID) { const { map: _m, ...t } = e.data; TEMPLATES[e.id] = t; }
  // visual effects: the pack's own effects (record fxlib/pack, from its effects.json), over the ruleset's
  const FX_LIBS = libraries(await store.get('fxlib/pack').catch(() => null), SYS.effects);
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
  // Names (board/names.js): the screen shows this view's name (the GM view the real one, players the alias of a
  // creature whose name they have not learned); anything players can read later (the change log, a template's
  // caster) uses the public name, whichever view wrote it.
  const nm = (t) => nameFor(t, S.view);
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pubName = (t) => publicName(t);
  const theName = (t) => nm(t);   // no article: "the Varsha Kell" would be wrong, and adjective names read well bare
  let shellReady = false;
  let clockUi = null;   // the clock in the title line (mounted near the end of start())
  let trackerUi = null, chatUi = null, sidebar = null;   // the encounter tracker, the chat and the sidebar (mounted after the clock)
  let actingId = null, trkHover = null;   // the acting creature, and the tracker row under the mouse (drawn on the overlay)
  let notesReady = false;   // the notes layer is wired near the end of start()   // the shell (menus) is made near the end of start()
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
    const list = [...new Set(ids)].filter((id) => S.tokens[id] && (S.view === 'gm' || !S.tokens[id].hidden));   // players never hold a hidden token
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
  const CONDS = SYS.conditions || {};   // the system's conditions: effect badges, and who cannot see (board/effects.js)
  // Who looks for the party: living PCs who can see (not dead, blinded, unconscious, dying or petrified)
  const opts = { rangeFt: RANGE, feetPerCell: FPC, grid: G, canLook: (t) => t.kind === 'pc' && !t.hidden && !cannotSee(t, CONDS) };
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
    const o = { ...(LIT ? litOpts() : opts), canLook: (t) => t.id === fid && !cannotSee(t, CONDS), alwaysShown: MARKERS_ONLY };
    const v = Engine.partyView(tokenList(), sightSegs, o);
    const visible = LIT ? v.perceived.displayPolys() : v.visible;
    const out = {
      focus: fid, visible, explored: [], mono: LIT ? v.mono.displayPolys() : [], perceived: LIT ? v.perceived : null, monoMask: LIT ? v.mono : null,
      // a token the GM hid is never seen in the player view, through any creature's eyes
      seen: new Set([...v.seen, fid].filter((id) => S.view === 'gm' || !(S.tokens[id] && S.tokens[id].hidden))), concealedFrom: v.concealedFrom || {},
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
    // tokens the GM hid are never the party's to see (the player view skips them; the GM view draws them faint)
    for (const [id, t] of Object.entries(S.tokens)) if (t.hidden) view.seen.delete(id);
    // a token hidden while a player holds it is let go
    if (S.view !== 'gm' && ((selected && S.tokens[selected] && S.tokens[selected].hidden) || [...multi].some((id) => S.tokens[id] && S.tokens[id].hidden))) setSelection([...(selected ? [selected] : []), ...multi]);
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
      if (!was && now) log(`${pubName(t)} comes into view.`, 'foe');
      if (was && !now && reason !== 'reset') log(`${pubName(t)} is out of sight.`);
    }
    lastSeen = new Set(view.seen);
    if (trackerUi) trackerUi.tokensChanged();   // rows follow who is seen, conditions and deaths
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
    for (const c of [tgtCanvas, fxCanvas]) {
      c.style.width = canvas.style.width; c.style.height = canvas.style.height;
      c.width = canvas.width; c.height = canvas.height;
      c.style.left = canvas.offsetLeft + 'px'; c.style.top = canvas.offsetTop + 'px';
    }
    draw();
    if (notesReady) renderNotes();   // pins and bubbles follow the zoom
  }
  const P = (c) => c * CS; // cells -> pixels from the grid origin (draw() translates by OX, OY)



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

    // movement range of the selected token: one, two and three Strides (a player's PC, or any token for the GM),
    // only while an encounter is under way (begun and not ended): outside combat the bands are clutter
    if (encounterOn && selected && canDrag(selected)) drawMoveBands(F);

    if (S.walls || full) drawWalls(full && !S.walls);
    drawDoors(gm, full);
    if (LIT && gm) { drawRegionOutlines(); drawLightSources(); }   // the GM's marks: players see only the light
    if (drag && drag.route !== undefined) drawRoute();
    drawTemplates();       // area templates: under the tokens, above the fog (they are shared on the board)
    if (hudFor) renderHud();   // follows the token; rebuilt only when its effects or targets changed
    drawTokens(F, full);   // the hover square, distance line and target marks are on the overlay (drawOverlay)
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
  const fxCanvas = document.getElementById('fxc');     // visual effects, drawn every frame while one plays
  const fxg = fxCanvas.getContext('2d');
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
  let encounterOn = false;   // an encounter has begun and not ended (the tracker says): the Stride bands show
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
    // the waypoints (Space): a dot on each
    ctx.setLineDash([]); ctx.fillStyle = '#e3a443'; ctx.strokeStyle = 'rgba(6, 10, 7, .8)'; ctx.lineWidth = 2;
    for (const [x, y] of drag.waypoints || []) { ctx.beginPath(); ctx.arc(P(x + size / 2), P(y + size / 2), Math.max(5, P(0.16)), 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    // each finished leg's distance, stamped beside the waypoint that ends it
    const legs = drag.route && drag.route.legs, perCell = drag.route && drag.route.cost ? drag.route.feet / drag.route.cost : FPC;
    if (legs) {
      ctx.font = '600 12px IBM Plex Sans, sans-serif'; ctx.textBaseline = 'middle';
      legs.slice(0, -1).forEach((leg, i) => {
        const [x, y] = drag.waypoints[i], text = `${Math.round(leg.cost * perCell)} ${SYS.measurement.unit}`;
        const w = ctx.measureText(text).width + 10, bx = P(x + size / 2) + Math.max(8, P(0.22)), by = P(y + size / 2) - 9;
        ctx.fillStyle = 'rgba(20, 22, 26, .88)'; ctx.fillRect(bx, by, w, 18);
        ctx.fillStyle = '#e3a443'; ctx.fillText(text, bx + 5, by + 9);
      });
      ctx.textBaseline = 'alphabetic';
    }
    const shared = Engine.isTiny(t) ? [] : Engine.blockersAt({ id: selected, ...t }, g[0], g[1], raw());
    const tn = routeNotes(selected, drag.route);
    const label = shared.length ? `occupied by ${theName(shared[0])}`
      : drag.route ? `${drag.route.feet} ft${tn.extraFt ? ` (${tn.extraFt} ft terrain)` : ''}${tn.notes.length ? ' · ' + tn.notes.join(' · ') : ''}`
      : 'no route';
    const wp = (drag.waypoints || []).length;
    const lastLeg = legs && legs.length > 1 ? ` · this leg ${Math.round(legs.at(-1).cost * perCell)} ${SYS.measurement.unit}` : '';
    const hint = drag.waypoints ? (wp ? `${lastLeg} · ${wp} waypoint${wp > 1 ? 's' : ''} (Backspace removes)` : ' · Space: waypoint') : '';
    ctx.font = '600 13px IBM Plex Sans, sans-serif';
    // above the goal square; above the height label ("+50 ft", drawn over the token's top) when it has one
    const tw = ctx.measureText(label + hint).width + 12, lx = P(g[0]) + 4, ly = P(g[1]) - 22 - (t.elevation && !t.dead ? 20 : 0);
    const good = !shared.length && drag.route && drag.route.feet <= t.speed;
    ctx.fillStyle = good ? '#1f2a22' : '#2b2418';
    ctx.fillRect(lx, ly, tw, 20);
    ctx.fillStyle = good ? '#5fbf83' : '#e3a443';
    ctx.fillText(label, lx + 6, ly + 15);
    if (hint) { ctx.fillStyle = '#b9b2a4'; ctx.fillText(hint, lx + 6 + ctx.measureText(label).width, ly + 15); }
    ctx.restore();
  }

  // ---- hover, distance and targets ----
  /**
   * The token's square at space t with Tiny layout L, or null when it shows none: the selection square (amber),
   * and with `hover` also the hover square (its kind's colour) for the hovered token.
   */
  function boxFor(id, t, L, hover = false) {
    const picked = id === selected || multi.has(id);
    if (!picked && !(hover && id === hoverId && !drag)) return null;
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
    // in three dimensions: elevation (feet) and the creature's height by its size (rulesets/<id>/system.js)
    const withH = (id) => ({ ...mspace(id), elevation: S.tokens[id].elevation || 0 });
    const d = Engine.creatureDistance3D(SYS, withH(selected), withH(hoverId), Engine.spaceDistance3D);
    const higher = (S.tokens[hoverId].elevation || 0) > (S.tokens[selected].elevation || 0);
    return { ids: [selected, hoverId], a: [a.x + a.size / 2, a.y + a.size / 2], b: [b.x + b.size / 2, b.y + b.size / 2], top: b.y, feet: d.feet, across: d.across, up: d.up, higher, unit: SYS.measurement.unit };
  }
  /** Token disc in pixels (grid space), as drawTokens draws it: [cx, cy, r]. */
  function discOf(id) {
    const t0 = S.tokens[id], sp = space(id), size = sp.size;
    return [P(sp.x + size / 2), P(sp.y + size / 2), (P(size) / 2 - (size < 1 ? 2 : 5)) * Engine.drawScale(t0)];
  }
  /** The line between the two tokens, drawn on the overlay and then cut away where the tokens are, so it
   *  shows under them (the tokens are on the map below). */
  function drawDistanceLine(ctx, d) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(10, 12, 16, .75)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(P(d.a[0]), P(d.a[1])); ctx.lineTo(P(d.b[0]), P(d.b[1])); ctx.stroke();
    ctx.strokeStyle = '#f4ecd6'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(P(d.a[0]), P(d.a[1])); ctx.lineTo(P(d.b[0]), P(d.b[1])); ctx.stroke();
    ctx.globalCompositeOperation = 'destination-out';
    for (const id of d.ids) { const [cx, cy, r] = discOf(id); ctx.beginPath(); ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  /** The hovered token's name, centred under its square; a Tiny creature sharing a square: under the whole square. */
  function drawNameLabel(ctx, id) {
    const t0 = S.tokens[id], sp = space(id), tiny = Engine.isTiny(t0);
    const sq = tiny ? { x: Math.floor(sp.x), y: Math.floor(sp.y), size: 1 } : sp;
    const name = nm(t0) || id;
    ctx.save();
    ctx.font = '600 12px IBM Plex Sans, sans-serif';
    const w = ctx.measureText(name).width + 12, cx = P(sq.x + sq.size / 2), y = P(sq.y + sq.size) + 4;
    ctx.fillStyle = 'rgba(20, 22, 27, .92)'; ctx.strokeStyle = kindColour(t0.kind); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(cx - w / 2, y, w, 18, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f4ecd6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, cx, y + 9.5);
    ctx.restore();
  }
  /** The distance above the hovered token; when the two are at different heights, a second line breaks it
   *  down ("15 ft across · 15 ft up"). */
  function drawDistanceLabel(ctx, d) {
    const label = `${d.feet} ${d.unit}`, sub = d.up ? `${d.across} ${d.unit} across · ${d.up} ${d.unit} ${d.higher ? 'up' : 'down'}` : '';
    ctx.save();
    ctx.font = '600 13px IBM Plex Sans, sans-serif';
    const w1 = ctx.measureText(label).width;
    ctx.font = '500 11px IBM Plex Sans, sans-serif';
    const w2 = sub ? ctx.measureText(sub).width : 0;
    const raise = S.tokens[d.ids[1]] && S.tokens[d.ids[1]].elevation ? 18 : 0;   // above the elevation label
    const h = sub ? 34 : 20, w = Math.max(w1, w2) + 12, x = P(d.b[0]) - w / 2, y = P(d.top) - 6 - h - raise;
    ctx.fillStyle = 'rgba(20, 22, 27, .92)'; ctx.strokeStyle = '#f4ecd6'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f4ecd6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 13px IBM Plex Sans, sans-serif'; ctx.fillText(label, P(d.b[0]), y + 10.5);
    if (sub) { ctx.font = '500 11px IBM Plex Sans, sans-serif'; ctx.fillStyle = '#c9c2b2'; ctx.fillText(sub, P(d.b[0]), y + 25); }
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
    badgeHits = [];
    const badgeQueue = [];   // drawn on the overlay (drawTargets), above the hover and selection squares
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
      if (full && t0.hidden) ctx.globalAlpha = 0.35;   // hidden by the GM: transparent in the GM view
      const look = tokenState(t0, S.view, CONDS);   // dead: faded and grey; down (unconscious, dying): greyed
      if (look === 'dead') { ctx.globalAlpha *= 0.55; ctx.filter = 'grayscale(0.6)'; }
      else if (look === 'down') ctx.filter = 'grayscale(0.75) brightness(0.8)';
      ctx.fillStyle = t.kind === 'pc' ? '#5b93ff' : '#e5615a';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#0d0f12';
      if (full && !seen) ctx.setLineDash([4, 3]);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#fff'; ctx.font = `600 ${Math.max(10, r * 0.95)}px IBM Plex Sans, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(letterOf(t), cx, cy + 1);
      ctx.restore();
      if (look === 'dead') drawDeadCross(cx, cy, r);
      // A thin square on the grid squares the token occupies (a Tiny creature alone: its square; sharing a
      // square with others: its own quarter): amber when selected, its kind's colour when hovered.
      const box = boxFor(id, t, L);
      if (box) strokeBox(ctx, box);
      // concealed by light from the creature whose eyes the board shows (or from some PC): worked out, not stored
      if (seen && !t0.dead && concealedNow(F, id) && !hasStoredConcealed(t0)) badgeQueue.push((c) => drawConcealBadge(c, F, id, P(t.x), P(t.y), P(size)));
      badgeQueue.push((c) => drawBadges(c, id, t0, P(t.x), P(t.y), P(size)));
      if (t0.elevation && !t0.dead) badgeQueue.push((c) => drawElevation(c, t0.elevation, cx, P(t.y)));
    }
    badgeDraws = badgeQueue;
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
  // ---- effect badges (board/effects.js; the conditions come from the system configuration) ----
  let badgeHits = [];      // [{x, y, w, h, text}] in map pixels (grid origin), from the last drawTokens
  let badgeDraws = [];     // the badges to draw, from the last drawTokens: (ctx) => void, run on the overlay
  let hoverBadge = null;   // the badge under the pointer: {x, y, w, h, text}
  const BADGE_MIN_PX = 10;   // a badge is never smaller than this on screen
  /** Badges as Foundry lays them out: inside the token's space from its top-left corner, in columns of five,
   *  then the next column to the right; each a fifth of the token's side (at least BADGE_MIN_PX on screen).
   *  Square, the icon or letter, the number in a corner, the border by kind (good, bad, neutral). */
  function drawBadges(ctx, id, t0, left, top, spacePx) {
    const list = badgesFor(t0, S.view, CONDS);
    if (!list.length) return;
    const b = Math.max(BADGE_MIN_PX / scale, spacePx / 5), inset = b * 0.08;
    list.forEach((bd, i) => {
      const { col, row } = badgeSlot(i);
      const x = left + inset + col * b, y = top + inset + row * b, s = b - inset;
      ctx.save();
      ctx.fillStyle = '#1a2438'; ctx.strokeStyle = KIND_COLOURS[bd.kind]; ctx.lineWidth = Math.max(1 / scale, s * 0.08);
      ctx.beginPath(); ctx.roundRect(x, y, s, s, s * 0.18); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (bd.icon) { ctx.font = `${s * 0.66}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`; ctx.fillText(bd.icon, x + s / 2, y + s / 2 + s * 0.04); }
      else { ctx.fillStyle = '#fff'; ctx.font = `700 ${s * 0.62}px IBM Plex Sans, sans-serif`; ctx.fillText(bd.letter, x + s / 2, y + s / 2 + s * 0.03); }
      if (bd.value != null) {   // the number, in the bottom-right corner
        const v = String(bd.value), w = Math.max(s * 0.5, s * 0.32 * v.length);
        ctx.fillStyle = bd.kind === 'good' ? '#1f6f47' : bd.kind === 'bad' ? '#a82424' : '#7a5c12';
        ctx.fillRect(x + s - w * 0.75, y + s - s * 0.42, w, s * 0.52);
        ctx.fillStyle = '#fff'; ctx.font = `700 ${s * 0.46}px IBM Plex Sans, sans-serif`;
        ctx.fillText(v, x + s - w * 0.75 + w / 2, y + s - s * 0.15);
      }
      if (bd.gm) { ctx.setLineDash([2 / scale, 2 / scale]); ctx.strokeStyle = '#b48cff'; ctx.lineWidth = 1 / scale; ctx.strokeRect(x - 1.5 / scale, y - 1.5 / scale, s + 3 / scale, s + 3 / scale); }
      ctx.restore();
      badgeHits.push({ x, y, w: s, h: s, text: bd.text });
    });
  }
  /** "+15 ft" above the token, as Foundry shows elevation (on the overlay, with the badges). */
  function drawElevation(c, v, cx, top) {
    const text = `${elevText(v)} ${SYS.measurement.unit}`;
    c.save();
    c.font = '700 13px IBM Plex Sans, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.lineJoin = 'round'; c.lineWidth = 3.5; c.strokeStyle = 'rgba(10, 12, 16, .9)'; c.strokeText(text, cx, top - 3);
    c.fillStyle = '#ffffff'; c.fillText(text, cx, top - 3);
    c.restore();
  }
  function drawDeadCross(cx, cy, r) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(3, r * 0.34); ctx.lineCap = 'round';
    const k = r * 0.62;
    const cross = () => { ctx.beginPath(); ctx.moveTo(cx - k, cy - k); ctx.lineTo(cx + k, cy + k); ctx.moveTo(cx + k, cy - k); ctx.lineTo(cx - k, cy + k); ctx.stroke(); };
    cross(); ctx.strokeStyle = '#e02020'; ctx.lineWidth = Math.max(2, r * 0.2); cross();
    ctx.restore();
  }
  const badgeAt = (p) => { const x = P(p[0]), y = P(p[1]); for (let i = badgeHits.length - 1; i >= 0; i--) { const h = badgeHits[i]; if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h; } return null; };
  /** The hovered badge's text, under it, on the overlay. */
  function drawBadgeTip(c) {
    if (!hoverBadge) return;
    const pad = 6 / scale, lh = 15 / scale, maxW = 280 / scale;
    c.save(); c.font = `500 ${12 / scale}px IBM Plex Sans, sans-serif`;
    const words = hoverBadge.text.split(' '), lines = [];
    let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (c.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    const w = Math.max(...lines.map((l) => c.measureText(l).width)) + pad * 2, h = lines.length * lh + pad * 2;
    let x = hoverBadge.x + hoverBadge.w / 2 - w / 2;
    const y = hoverBadge.y - h - 4 / scale;
    x = Math.max(-OX, x);
    c.fillStyle = 'rgba(13, 15, 18, .94)'; c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 1 / scale;
    c.beginPath(); c.roundRect(x, y, w, h, 5 / scale); c.fill(); c.stroke();
    c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'top';
    lines.forEach((l, i) => c.fillText(l, x + pad, y + pad + i * lh));
    c.restore();
  }
  /** Concealed from the creature whose eyes the board shows, or (the party's view) from any PC who sees it. */
  function concealedNow(F, id) {
    const from = F.concealedFrom[id];
    if (!from) return false;
    return F.focus ? from.includes(F.focus) : true;
  }
  /** The concealed condition set on the creature (a spell, fog) shows as an ordinary badge for everyone. */
  const hasStoredConcealed = (t) => (t.effects || []).some((e) => e.id === 'concealed' && (S.view === 'gm' || !e.gm_only));
  /**
   * Concealment by light, as a badge in the token's bottom-right corner: the same square as the effect badges,
   * holding the half-shaded disc. It follows the board's eyes: with a creature selected, concealed from that
   * creature; otherwise concealed from at least one PC who sees it. The hover names who and why.
   */
  function drawConcealBadge(ctx, F, id, left, top, spacePx) {
    const b = Math.max(BADGE_MIN_PX / scale, spacePx / 5), inset = b * 0.08, sz = b - inset;
    const x = left + spacePx - inset - sz, y = top + spacePx - inset - sz;
    ctx.save();
    ctx.fillStyle = '#1a2438'; ctx.strokeStyle = KIND_COLOURS.good; ctx.lineWidth = Math.max(1 / scale, sz * 0.08);
    ctx.beginPath(); ctx.roundRect(x, y, sz, sz, sz * 0.18); ctx.fill(); ctx.stroke();
    const cx = x + sz / 2, cy = y + sz / 2, r = sz * 0.3;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#ebe6dc'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fillStyle = '#4b5263'; ctx.fill();
    ctx.restore();
    const from = (F.concealedFrom[id] || []).filter((pid) => S.tokens[pid]).map((pid) => nm(S.tokens[pid]));
    const who = F.focus ? nm(S.tokens[F.focus]) : from.join(', ');
    const others = F.focus ? '' : ' Any other PC who sees it sees it clearly.';
    badgeHits.push({ x, y, w: sz, h: sz, text: `Concealed from ${who}: in dim light. Targeting it takes a DC 5 flat check.${others} (Worked out from light and senses; changes as they move.)` });
  }

  const namesOf = (ids) => ids.map((i) => nm(S.tokens[i])).join(' and ');

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
    parts.push(focusId() ? `view <b>${esc(nm(S.tokens[focusId()]))} only</b>` : `lookers <b>${view.lookers.length}</b>`);
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
      <div class="sel-name">${esc(nm(t))}</div>${S.view === 'gm' && t.alias ? `<div class="sel-alias">Players see: <b>${esc(t.known ? t.name : t.alias)}</b>${t.known ? ' (name learned)' : ' (name not learned yet)'}</div>` : ''}
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
      <div style="color:var(--muted);font-size:13px">Square ${t.x},${t.y}${t.note ? ' · ' + t.note : ''}. ${focusId() ? `The board shows only what ${esc(nm(t))} perceives now. ` : ''}${canDrag(selected) ? 'Dashed green: where one, two and three Strides reach (light, medium, dark green).' : ''}</div>`;
    const cr = el.querySelector('.lrow[data-kind=carried]');
    if (cr) {
      const set = (k, v) => { t.light = { ...t.light, [k]: v }; };
      cr.querySelector('[data-f=on]').onchange = (e) => { set('on', e.target.checked); log(`${pubName(t)} ${e.target.checked ? 'lights' : 'puts out'} the light.`, 'ok'); panel(); recompute(); };
      cr.querySelector('[data-f=colour]').onchange = (e) => { set('colour', e.target.value); log(`GM: ${pubName(t)}'s light colour ${e.target.value}.`, 'ok'); panel(); relight(); };
      cr.querySelector('[data-f=nocolour]').onclick = () => { set('colour', 'none'); log(`GM: ${pubName(t)}'s light uncoloured.`, 'ok'); panel(); relight(); };
      cr.querySelector('[data-f=intensity]').oninput = (e) => { cr.querySelector('.pct').textContent = e.target.value + '%'; };
      cr.querySelector('[data-f=intensity]').onchange = (e) => { set('intensity', Number(e.target.value)); log(`GM: ${pubName(t)}'s light intensity ${e.target.value}%.`, 'ok'); panel(); relight(); };
      wireAnimRow(el.querySelector('[data-anim-for="carried"]'), () => Engine.lightSpec(t.light).animation, (a) => set('animation', a), `${pubName(t)}'s light`);
    }
    const bl = document.getElementById('b-light');
    if (bl) bl.onclick = () => {
      const on = t.light.on === false;
      t.light = { ...t.light, on };
      log(`${pubName(t)} ${on ? 'lights' : 'puts out'} the ${((Engine.LIGHT_PRESETS[t.light.preset] || {}).label || 'light').toLowerCase()}.`, 'ok');
      panel(); recompute();
    };
    const bm = document.getElementById('b-mark');
    if (bm) bm.onclick = () => {
      if (S.hiddenMarks[selected]) { delete S.hiddenMarks[selected]; log(`GM: hidden marker for ${pubName(t)} cleared.`, 'ok'); }
      else { S.hiddenMarks[selected] = [t.x, t.y]; log(`GM: the party knows something is at ${t.x},${t.y} (${pubName(t)}, hidden).`, 'ok'); }
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
    pan = { x: ev.clientX, y: ev.clientY, left: stageEl.scrollLeft, top: stageEl.scrollTop, moved: false, deselect, button: ev.button, p: cellAt(ev) };
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
    if (aim && ev.button === 2) { ev.preventDefault(); endAim('Cancelled.'); return; }   // aiming: the right button cancels
    if (ev.button === 2) { ev.preventDefault(); startPan(ev, false, true); return; }   // right button: pan, hand cursor
    if (ev.button !== 0) return;
    const p = cellAt(ev);
    if (hudFor) closeHud();
    if (noting) { setNoting(false); openNoteEditor({ at: notePoint(p[0], p[1]) }); return; }   // Add note: the editor opens here
    if (aim) { aimMove(p); placeTemplate(); return; }
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
      canvas.style.cursor = 'grabbing';
      return;
    }
    setSelection([id]); panel();
    if (canDrag(id)) {
      drag = { id, start: [S.tokens[id].x, S.tokens[id].y], goal: [S.tokens[id].x, S.tokens[id].y], waypoints: [], moved: false };
      canvas.setPointerCapture(ev.pointerId);
      canvas.style.cursor = 'grabbing';
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
      canvas.style.cursor = 'grabbing';
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
    lastPoint = p;
    if (noting) { canvas.style.cursor = 'crosshair'; return; }
    if (aim) { aimMove(p); return; }
    const hb = drag ? null : badgeAt(p);
    if (hb !== hoverBadge) { hoverBadge = hb; targetsChanged(); }
    const over = drag ? {} : clickTarget(p);
    const h = !drag && over.token && (fullGM() || shown().seen.has(over.token)) ? over.token : null;
    if (h !== hoverId) { hoverId = h; targetsChanged(); }   // the overlay only: a full map redraw costs ~50 ms
    // doors and every token: the pointing hand; a token being dragged: the closed hand
    canvas.style.cursor = drag ? 'grabbing' : over.door || over.token ? 'pointer' : 'default';
    if (drag) {
      const g = goalFor(drag.id, p);
      if (g[0] !== drag.goal[0] || g[1] !== drag.goal[1]) {
        drag.goal = g; drag.moved = true;
        drag.route = dragRoute(drag);
      }
      draw();
    } else hud();
  });
  /** The dragged token's route: the cheapest path to the goal, or through the waypoints set with Space, each leg
   *  the cheapest path from the point before (the diagonal count carrying on, as in one move). */
  function dragRoute(d) {
    const ms = mspace(d.id), off = Engine.isTiny(S.tokens[d.id]) ? 0.25 : 0;
    if (!d.waypoints.length) return Engine.path(moveWalls, ms, d.goal[0] + off, d.goal[1] + off, moveOpts(d.id));
    return Engine.pathVia(moveWalls, ms, [...d.waypoints, d.goal].map(([x, y]) => [x + off, y + off]), moveOpts(d.id));
  }
  // Space while dragging one token drops a waypoint where it is now; Backspace takes the last one back (as the
  // old board's ruler). This screen's only: nothing is shared until the token is dropped.
  window.addEventListener('keydown', (e) => {
    if (!drag || drag.group || !drag.waypoints) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (e.repeat || !drag.moved) return;
      const last = drag.waypoints.at(-1) || drag.start;
      if (last[0] === drag.goal[0] && last[1] === drag.goal[1]) return;
      drag.waypoints.push([...drag.goal]);
      drag.route = dragRoute(drag); draw();
    } else if (e.key === 'Backspace' && drag.waypoints.length) {
      e.preventDefault();
      drag.waypoints.pop();
      drag.route = dragRoute(drag); draw();
    }
  });
  window.addEventListener('keyup', (e) => { if (drag && drag.waypoints && (e.key === ' ' || e.code === 'Space')) e.preventDefault(); });   // a focused button would click on Space's release
  function pointerEnd(ev, cancelled) {
    touches.delete(ev.pointerId);
    if (pinch) { if (touches.size < 2) pinch = null; return; }
    if (box) { endBox(cancelled); return; }
    if (drag) canvas.style.cursor = 'pointer';   // released over the token
    if (drag && drag.group) {
      const d = drag; drag = null;
      if (!cancelled && d.moved && (d.dx || d.dy)) moveGroup([...d.group.keys()], d.dx, d.dy);
      else draw();
      return;
    }
    if (pan) {
      const { moved, deselect, button, p } = pan;
      pan = null; canvas.style.cursor = 'default';
      if (!moved && button === 2 && !cancelled && ev.target === canvas) { const id = clickTarget(p).token; if (id && canHud(id)) openHud(id); else closeHud(); return; }   // right-click: the token HUD
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
  canvas.addEventListener('pointerleave', () => { hoverCell = null; lastPoint = null; if (hoverBadge) { hoverBadge = null; targetsChanged(); } if (hoverId) { hoverId = null; targetsChanged(); } hud(); });

  // ---- targeting (T): this view's own list; the GM view also shows the player's ----
  const myTargets = () => TARGETS[S.view === 'gm' ? 'gm' : 'player'];
  function setMyTargets(ids, what) {
    const who = S.view === 'gm' ? 'gm' : 'player';
    TARGETS[who] = ids;
    sending('targets/' + who, store.set('targets/' + who, { ids })).catch((e) => toast(`Could not save the targets (${e.message || e}).`));
    if (what) toast(what);
    targetsChanged();
  }
  // T held while drawing a selection box makes it a targeting box (on release). A held key repeats: only the
  // first press acts, so holding T over a token does not flip its target on and off.
  let tHeld = false;
  const isT = (e) => e.key === 't' || e.key === 'T';
  window.addEventListener('keydown', (e) => {
    if (!isT(e)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || (e.target.closest && e.target.closest('input, textarea, select, [role^=menu]'))) return;
    if (READONLY) return;
    e.preventDefault();
    if (e.repeat) return;
    tHeld = true; boxStyle();
    if (box) return;   // drawing a box: T makes it a targeting box, it does not toggle the hovered token
    if (e.shiftKey) { if (myTargets().length) setMyTargets([], 'Targets cleared.'); return; }
    if (!hoverId) return;
    if (S.tokens[hoverId] && S.tokens[hoverId].dead && !myTargets().includes(hoverId)) { toast(`${nm(S.tokens[hoverId])} is dead: it can't be targeted.`); return; }
    setMyTargets(toggleTarget(myTargets(), hoverId));
  });
  window.addEventListener('keyup', (e) => { if (isT(e)) { tHeld = false; boxStyle(); } });
  // Escape while aiming cancels the template only (caught first, so it does not also clear the selection)
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && aim) { e.preventDefault(); e.stopPropagation(); endAim('Cancelled.'); } }, true);
  window.addEventListener('blur', () => { tHeld = false; boxStyle(); });
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
  /**
   * The overlay above the map (#tgt): the distance line (cut away under the two tokens), the target
   * triangles, the hover square and the distance label. It is cheap to redraw, so hovering never redraws the
   * map; it animates (every frame) only while a target is shown.
   */
  function drawTargets(now) {
    tgtRaf = null;
    const dpr = window.devicePixelRatio || 1;
    tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.clearRect(0, 0, tgtCanvas.width, tgtCanvas.height);
    const marks = targetMarks();
    const F = shown(), dist = distanceTo(F, fullGM());
    const hoverBox = hoverId && S.tokens[hoverId] && !drag ? boxFor(hoverId, space(hoverId), layout, true) : null;
    const hoverName = hoverId && S.tokens[hoverId] && !drag;
    const F0 = F, isShown = (id) => !!S.tokens[id] && (fullGM() || F0.seen.has(id) || S.tokens[id].kind === 'pc');
    const acting = actingId && isShown(actingId) ? actingId : null, trk = trkHover && isShown(trkHover) ? trkHover : null;
    if (!marks.length && !dist && !hoverBox && !hoverName && !(aim && aim.cur) && !hoverBadge && !badgeDraws.length && !acting && !trk) return;
    tctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0); tctx.translate(OX, OY);
    drawAimOverlay(tctx);
    if (dist) drawDistanceLine(tctx, dist);
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
    if (hoverBox) strokeBox(tctx, hoverBox);
    // the encounter: the acting creature's ring, and the row hovered in the tracker
    if (acting) {
      const sp = space(acting), r = P(sp.size) / 2;
      tctx.save(); tctx.strokeStyle = '#ffd166'; tctx.lineWidth = 3; tctx.setLineDash([7, 4]);
      tctx.beginPath(); tctx.arc(P(sp.x) + r, P(sp.y) + r, r + 3, 0, Math.PI * 2); tctx.stroke(); tctx.restore();
    }
    if (trk) { const sp = space(trk); strokeBox(tctx, { m: markSquare(sp, Engine.isTiny(S.tokens[trk]), false), colour: '#ffd166' }); }
    for (const f of badgeDraws) f(tctx);   // effect and concealment badges: above every square, under the labels
    if (hoverId && S.tokens[hoverId] && !drag) drawNameLabel(tctx, hoverId);
    if (dist) drawDistanceLabel(tctx, dist);
    drawBadgeTip(tctx);
    if (marks.length && !REDUCED) tgtRaf = requestAnimationFrame(drawTargets);
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
  /** The box looks different while T is held: it will target, not select. */
  function boxStyle() { boxEl.classList.toggle('targeting', tHeld); }
  function moveBox(ev) {
    if (!box.moved && !isDrag(box.x, box.y, ev.clientX, ev.clientY)) return;
    box.moved = true; box.cx = ev.clientX; box.cy = ev.clientY; box.p1 = cellAt(ev);
    const sr = stageEl.getBoundingClientRect();
    const l = Math.min(box.x, ev.clientX), t = Math.min(box.y, ev.clientY);
    boxEl.style.left = l - sr.left + stageEl.scrollLeft + 'px'; boxEl.style.top = t - sr.top + stageEl.scrollTop + 'px';
    boxEl.style.width = Math.abs(ev.clientX - box.x) + 'px'; boxEl.style.height = Math.abs(ev.clientY - box.y) + 'px';
    boxEl.hidden = false;
  }
  /**
   * Tokens a box picks: centre inside it. Selecting: players pick their PCs only, the GM every token.
   * Targeting: any token this view can see.
   */
  function tokensInBox(p0, p1, forTargets = false) {
    const [x0, x1] = [Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0])], [y0, y1] = [Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1])];
    const F = forTargets ? shown() : null, full = fullGM();
    return Object.keys(S.tokens).filter((id) => {
      if (forTargets ? !(full || F.seen.has(id)) || S.tokens[id].dead : S.view !== 'gm' && (S.tokens[id].kind !== 'pc' || S.tokens[id].hidden)) return false;
      const sp = space(id), cx = sp.x + sp.size / 2, cy = sp.y + sp.size / 2;
      return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
    });
  }
  function endBox(cancelled) {
    const b = box; box = null; boxEl.hidden = true;
    if (cancelled) return;
    if (b.moved && tHeld) {
      // a targeting box: add what it covers to this view's targets; the selection stays as it was
      const ids = tokensInBox(b.p0, b.p1, true), own = myTargets();
      const add = ids.filter((id) => !own.includes(id));
      if (add.length) setMyTargets([...own, ...add], `${add.length} target${add.length > 1 ? 's' : ''} added.`);
      return;
    }
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
      moved.push(pubName(t));
    }
    if (moved.length) log(`${moved.join(', ')} moved together.`);
    panel(); recompute();
  }

  // ---- area templates (the token HUD's Area template): a shape, a size, aim, place; placing replaces your targets ----
  const AREAS = SYS.areas || null;
  let aim = null;          // {shape, ft, caster, R, width, blockers, cur}: a template being aimed (from the token HUD)
  const lastFt = {};       // the size last used for each shape
  let lastBurstHeight = 0; // the height last given for a burst's point (feet)
  const casterSpace = (id) => { const t = S.tokens[id], s = Math.max(1, Math.ceil(t.size || 1)); return { x: Math.floor(t.x), y: Math.floor(t.y), size: s }; };
  // who an area can target: the GM view, every creature; the player view, those the party sees (not only the caster)
  const canSeeId = (id) => S.view === 'gm' || (partyShown && partyShown.seen.has(id));
  const tplBlockers = () => Engine.effectBlockers(segs, state(), AREAS.lineOfEffect);
  const aimBar = document.getElementById('aimbar');
  function aimMessage(text, who = '') {
    aimBar.hidden = !text;
    document.getElementById('aim-text').textContent = text || '';
    document.getElementById('aim-who').textContent = who;
  }
  document.getElementById('aim-cancel').onclick = () => endAim('Cancelled.');
  const label = (shape) => (AREAS.shapes[shape] && AREAS.shapes[shape].label) || shape;
  function startAim(shape, ft, caster, burstHeight = 0) {
    if (READONLY) return toast('This is a preview: templates are placed on the party\'s map.');
    if (!S.tokens[caster]) return toast('That creature is not on this map.');
    endAim(); if (noting) setNoting(false);
    lastFt[shape] = ft;
    const width = (AREAS.shapes.line.widthFeet || FPC) / FPC;
    // the area's height: a burst's point (chosen in the flyout, the ground by default); the rest start at the caster's elevation
    const height = shape === 'burst' ? burstHeight : (S.tokens[caster].elevation || 0);
    aim = { shape, ft, caster, R: Math.max(1, Math.round(ft / FPC)), width, height, blockers: tplBlockers(), cur: null };
    if (shape === 'emanation') { aim.cur = aimAt([0, 0]); return placeTemplate(); }
    canvas.style.cursor = 'crosshair';
    aimMessage(`Aim the ${ft}-${SYS.measurement.unit} ${shape} from ${nm(S.tokens[caster])}: click to place. Esc or right-click cancels.`);
    canvas.focus();
  }
  function endAim(msg) {
    if (!aim) return;
    aim = null; aimMessage(''); canvas.style.cursor = 'default';
    if (msg) toast(msg);
    targetsChanged();
  }
  const aimAt = (p) => Engine.buildArea(aim.shape, casterSpace(aim.caster), p[0], p[1], { R: aim.R, width: aim.width, costs: SYS.measurement.diagonalCosts, blockers: aim.blockers });
  /** Who the area reaches, heights included ({ids, over}: over are in its squares but above or below it). */
  function whoIn(area, caster, shape, R, height) {
    const cs = { ...casterSpace(caster), elevation: S.tokens[caster] ? S.tokens[caster].elevation || 0 : 0 };
    const opts = { R, height, caster: cs, costs: SYS.measurement.diagonalCosts, squareFeet: FPC };
    const inArea = (pool) => (SYS.measurement.vertical ? Engine.tokensInArea({ ...area, shape }, pool, opts) : { in: Engine.tokensInCells(area.cells, pool), over: [] });
    return areaTargets(S.tokens, { inArea, visible: canSeeId, caster, includesCaster: !!(AREAS.shapes[shape] && AREAS.shapes[shape].includesCaster) });
  }
  const overText = (ids) => ids.map((id) => { const e = S.tokens[id].elevation || 0; return `${nm(S.tokens[id])} (${e ? `${Math.abs(e)} ${SYS.measurement.unit} ${e > 0 ? 'up' : 'down'}` : 'on the ground'})`; }).join(', ');
  function aimMove(p) {
    const c = aimAt(p);
    if (!c) return;
    aim.cur = c;
    const unit = SYS.measurement.unit, name = nm(S.tokens[aim.caster]);
    let text = `${aim.ft}-${unit} ${aim.shape} from ${name}`;
    if (aim.shape === 'cone') text += `, facing ${Engine.DIRECTION_NAMES[c.dir]}`;
    if (aim.shape === 'line') text += `, angle ${Math.round(((c.angle * 180) / Math.PI + 360) % 360)}°`;
    if (aim.shape === 'burst') text = `${aim.ft}-${unit} burst, ${Engine.cornerDistance(casterSpace(aim.caster), c.origin[0], c.origin[1], SYS.measurement.diagonalCosts) * FPC} ${unit} from ${name}`;
    if (aim.height && aim.shape === 'burst') text += `, ${aim.height} ${unit} up`;
    const w = whoIn(c, aim.caster, aim.shape, aim.R, aim.height), who = w.ids.map((id) => nm(S.tokens[id]));
    aimMessage(text + '. Click to place, Esc cancels.', (who.length ? `In the area: ${who.join(', ')}.` : 'Nobody in the area.') + (w.over.length ? ` Out of reach: ${overText(w.over)}.` : ''));
    targetsChanged();
  }
  /** Place the aimed template: shared on the board, saved with the campaign; your targets become who is in it. */
  function placeTemplate() {
    if (!aim || !aim.cur) return;
    const { shape, ft, caster, cur, R, height } = aim;
    endAim();
    const id = makeId('template', { taken: TEMPLATES }), by = S.view === 'gm' ? 'gm' : 'player';
    const rec = templateRecord({ map: MAP_ID, shape, ft, area: cur, caster, casterName: pubName(S.tokens[caster]), by, col: nextColour(TEMPLATES), at: new Date().toISOString(), widthFeet: shape === 'line' ? AREAS.shapes.line.widthFeet : undefined, height });
    const { map: _m, ...t } = rec;
    TEMPLATES[id] = t;
    sending('templates/' + id, store.set('templates/' + id, rec)).catch((e) => { delete TEMPLATES[id]; draw(); toast(`Could not save the template (${e.message || e}).`); });
    const { ids, over } = whoIn({ ...t, cells: t.cells }, caster, shape, R, height);
    const what = Engine.describeArea(t, SYS.measurement.unit);
    logChange(`placed a ${what}`, true);
    setMyTargets(ids, `${what[0].toUpperCase() + what.slice(1)}: ${ids.length ? `targeting ${ids.map((i) => nm(S.tokens[i])).join(', ')}` : 'nobody in the area'}.${over.length ? ` Out of reach: ${overText(over)}.` : ''}`);
    draw();
  }
  function removeTemplate(id) {
    const t = TEMPLATES[id];
    if (!t) return;
    delete TEMPLATES[id];
    sending('templates/' + id, store.remove('templates/' + id)).catch((e) => { TEMPLATES[id] = t; draw(); toast(`Could not remove the template (${e.message || e}).`); });
    logChange(`removed a ${Engine.describeArea(t, SYS.measurement.unit)}`, true); toast('Template removed.');
    draw();
  }
  function onCommand(id, item, state) {
    if (id === 'fx-on') { setFxOn(state); return true; }
    if (id === 'fx-preview') { openFxPanel(); return true; }
    if (id === NOTE_COMMAND) { if (READONLY) { toast('This is a preview: notes are added on the party\'s map.'); setNoting(false); } else setNoting(state); return true; }
    return false;
  }
  /** Placed templates, on the map under the tokens: filled squares with an outline. Their remove buttons are
   *  page buttons in a layer over the map (renderTplButtons), above the target triangles. */
  function drawTemplates() {
    for (const id of Object.keys(TEMPLATES).sort()) cellsPath(ctx, TEMPLATES[id].cells, colourOf(TEMPLATES[id]), false);
    renderTplButtons();
  }
  /** One shared remove button (board/ui.js) per template this view may remove, at its marker point. Rebuilt
   *  only when the templates, the view or the scale change, so an armed button survives other redraws. */
  const tplLayer = document.getElementById('tplx');
  let tplKey = '';
  function renderTplButtons() {
    tplLayer.style.left = canvas.offsetLeft + 'px'; tplLayer.style.top = canvas.offsetTop + 'px';
    tplLayer.style.width = canvas.style.width; tplLayer.style.height = canvas.style.height;
    const pts = markerPoints(TEMPLATES);
    const ids = Object.keys(pts).filter((id) => !READONLY && canRemove(TEMPLATES[id], S.view));
    const key = canon({ ids, pts: ids.map((id) => pts[id]), cols: ids.map((id) => TEMPLATES[id].col), view: S.view, scale });
    if (key === tplKey) return;
    tplKey = key;
    tplLayer.replaceChildren();
    for (const id of ids) {
      const t = TEMPLATES[id], [x, y] = pts[id];
      const b = removeButton({ colour: colourOf(t), what: `the ${Engine.describeArea(t, SYS.measurement.unit)}`, onRemove: () => removeTemplate(id) });
      b.style.left = (OX + x * CS) * scale + 'px'; b.style.top = (OY + y * CS) * scale + 'px';
      tplLayer.appendChild(b);
    }
  }
  tplLayer.addEventListener('contextmenu', (e) => e.preventDefault());
  tplLayer.addEventListener('pointerdown', (e) => { if (e.button === 2) { e.preventDefault(); startPan(e, false, true); } });
  function cellsPath(c, cells, col, preview) {
    c.save();
    c.fillStyle = hexA(col, preview ? 0.22 : 0.3);
    c.strokeStyle = hexA(col, 0.95); c.lineWidth = preview ? 1.5 : 1.25;
    if (preview) c.setLineDash([6, 4]);
    for (const [x, y] of cells) { c.fillRect(P(x), P(y), CS, CS); c.strokeRect(P(x) + 0.5, P(y) + 0.5, CS - 1, CS - 1); }
    c.restore();
  }
  /** On the overlay: the aimed template (dashed), under the target triangles. */
  function drawAimOverlay(c) {
    if (aim && aim.cur) {
      const col = TEMPLATE_COLOURS[nextColour(TEMPLATES)];
      cellsPath(c, aim.cur.cells, col, true);
      const [ox, oy] = aim.cur.origin;
      c.save(); c.beginPath(); c.arc(P(ox), P(oy), 5, 0, Math.PI * 2); c.fillStyle = col; c.fill(); c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke(); c.restore();
    }
  }

  // ---- map notes (Map > Add note, or N under the mouse): pins and bubbles in a page layer over the map ----
  const notesEl = document.getElementById('notes');
  const NOTES_SHUT = collapsedStore(`reliquary-notes-shut:${META.campaign.id}:${MAP_ID}`);
  let noting = false;      // Add note is on: the next click on the map opens the editor there
  let lastPoint = null;    // the pointer's point on the map, for N
  let noteEditor = null;   // {box, id}: the editor that is open
  const noteBy = () => (S.view === 'gm' ? 'gm' : 'player');
  function setNoting(on) {
    noting = !!on && !READONLY;
    if (noting) endAim();
    const m = shellReady && shell.menu();
    if (m) m.setToggle(NOTE_COMMAND, noting);
    canvas.style.cursor = noting ? 'crosshair' : 'default';
    if (noting) toast('Click the map to drop a note. Esc cancels.');
  }
  /** Map point (cells) -> pixels inside the notes layer. */
  const notePx = ([x, y]) => [(OX + x * CS) * scale, (OY + y * CS) * scale];
  function placeNotesLayer() {
    notesEl.style.left = canvas.offsetLeft + 'px'; notesEl.style.top = canvas.offsetTop + 'px';
    notesEl.style.width = canvas.style.width; notesEl.style.height = canvas.style.height;
  }
  /** Draw every note this view may see: a pin, and unless collapsed here, a bubble with the text. */
  function renderNotes() {
    placeNotesLayer();
    const keepEditor = noteEditor && noteEditor.box;
    notesEl.replaceChildren();
    NOTES_SHUT.prune(Object.keys(MAPNOTES));
    for (const id of Object.keys(MAPNOTES).sort()) {
      const n = MAPNOTES[id];
      if (!noteVisible(n, S.view)) continue;
      const [px, py] = notePx(n.at), mine = canEditNote(n, S.view) && !READONLY, shut = NOTES_SHUT.has(id);
      const who = authorName(n, S.view);
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'pin' + (shut ? ' shut' : '') + (n.gm_only ? ' gm-only' : '') + (mine ? ' mine' : '');
      pin.style.setProperty('--nc', noteColour(n));
      pin.style.left = px + 'px'; pin.style.top = py + 'px';
      pin.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="nfill" d="M4 3h16v12l-6 6H4z" fill="currentColor" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/><path d="M14 21v-6h6" fill="#fff" fill-opacity=".55" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/><path d="M7.5 8h9M7.5 11.5h9" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>';
      pin.setAttribute('aria-expanded', String(!shut));
      pin.setAttribute('aria-label', `${shut ? 'Show' : 'Hide'} note by ${who}: ${n.text}`);
      pin.title = (shut ? 'Show note' : 'Hide note') + (mine ? ' · drag to move (Shift: centre of a square)' : '');
      wirePin(pin, id, mine);
      notesEl.appendChild(pin);
      if (shut) continue;
      const b = document.createElement('div');
      b.className = 'note' + (mine ? ' mine' : '') + (n.gm_only ? ' gm-only' : '');
      b.style.setProperty('--nc', noteColour(n));
      b.style.left = px + 'px'; b.style.top = py + 'px';
      const text = document.createElement('span');
      text.textContent = n.text;
      b.appendChild(text);
      const tag = document.createElement('small');
      tag.className = 'nby';
      tag.textContent = who + (n.gm_only ? ' · GM only' : '');
      b.appendChild(tag);
      if (mine) {
        b.title = 'Click to edit this note';
        b.addEventListener('click', (e) => { e.stopPropagation(); openNoteEditor({ id, at: n.at, text: n.text, gmOnly: !!n.gm_only }); });
        b.appendChild(removeButton({ colour: noteColour(n), what: 'this note', onRemove: () => deleteNote(id) }));
      }
      notesEl.appendChild(b);
    }
    if (keepEditor) notesEl.appendChild(keepEditor);
  }
  /** A pin: click hides or shows its bubble (this browser only); the author drags it to move the note. */
  function wirePin(pin, id, mine) {
    let press = null;
    pin.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      press = { x: e.clientX, y: e.clientY, moved: false };
      if (mine) pin.setPointerCapture(e.pointerId);
    });
    pin.addEventListener('pointermove', (e) => {
      if (!press || !mine) return;
      if (!press.moved && !isDrag(press.x, press.y, e.clientX, e.clientY)) return;
      press.moved = true;
      const p = cellAt(e), at = notePoint(p[0], p[1], e.shiftKey), [px, py] = notePx(at);
      pin.style.left = px + 'px'; pin.style.top = py + 'px';
      pin.classList.add('dragging');
    });
    pin.addEventListener('pointerup', (e) => {
      if (!press) return;
      const { moved } = press;
      press = null;
      if (moved) { const p = cellAt(e); moveNote(id, notePoint(p[0], p[1], e.shiftKey)); return; }
      NOTES_SHUT.toggle(id); renderNotes();
    });
    pin.addEventListener('pointercancel', () => { press = null; renderNotes(); });
    pin.addEventListener('click', (e) => e.stopPropagation());
  }
  /** The note editor: Enter saves, Shift+Enter a new line, Esc cancels; empty text removes the note. */
  function openNoteEditor(o) {
    if (READONLY) return;
    closeNoteEditor();
    const box = document.createElement('div');
    box.className = 'nedit';
    box.style.setProperty('--nc', o.id ? noteColour(MAPNOTES[o.id]) : noteColour({ by: noteBy() }));
    const [px, py] = notePx(o.at);
    box.style.left = px + 'px'; box.style.top = py + 'px';
    const ta = document.createElement('textarea');
    ta.value = o.text || ''; ta.maxLength = NOTE_MAX; ta.setAttribute('aria-label', 'Map note text');
    box.appendChild(ta);
    let gmBox = null;
    if (S.view === 'gm') {
      const lab = document.createElement('label');
      lab.className = 'ngm';
      gmBox = document.createElement('input');
      gmBox.type = 'checkbox'; gmBox.checked = o.id ? !!o.gmOnly : true;
      lab.append(gmBox, ' GM only (players never see it)');
      box.appendChild(lab);
    }
    const hint = document.createElement('small');
    hint.textContent = 'Enter saves · Shift+Enter new line · Esc cancels' + (o.id ? ' · empty text removes the note' : '');
    box.appendChild(hint);
    for (const ev of ['pointerdown', 'click', 'dblclick', 'wheel']) box.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      closeNoteEditor();
      if (save) saveNote(o, ta.value, gmBox ? gmBox.checked : (o.id ? !!o.gmOnly : false));
    };
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    if (gmBox) gmBox.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') finish(false); if (e.key === 'Enter') finish(true); });
    // clicking away saves (as before); moving focus inside the editor does not
    box.addEventListener('focusout', (e) => { if (!box.contains(e.relatedTarget)) setTimeout(() => { if (noteEditor && noteEditor.box === box) finish(true); }, 120); });
    noteEditor = { box, id: o.id || null };
    notesEl.appendChild(box);
    setTimeout(() => { ta.focus(); ta.select(); }, 0);
  }
  function closeNoteEditor() { if (noteEditor) { noteEditor.box.remove(); noteEditor = null; } }
  function writeNote(id, rec, what) {
    const { map: _m, ...n } = rec, before = MAPNOTES[id];
    MAPNOTES[id] = n;
    sending('notes/' + id, store.set('notes/' + id, rec)).catch((e) => {
      if (before) MAPNOTES[id] = before; else delete MAPNOTES[id];
      renderNotes(); toast(`Could not save the note (${e.message || e}).`);
    });
    if (what) logChange(what, !n.gm_only);
    renderNotes();
  }
  function saveNote(o, raw, gmOnly) {
    const text = cleanText(raw);
    if (!o.id) {
      if (!text) return;
      const id = makeId('note', { taken: MAPNOTES });
      writeNote(id, noteRecord({ map: MAP_ID, text, at: o.at, by: noteBy(), gmOnly }), `added a note${gmOnly ? ' (GM only)' : ''}: "${noteGist(text)}"`);
      return;
    }
    const n = MAPNOTES[o.id];
    if (!n) return;
    if (!text) { deleteNote(o.id); return; }
    if (text === n.text && !!gmOnly === !!n.gm_only) return;
    writeNote(o.id, noteRecord({ map: MAP_ID, text, at: n.at, by: n.by, gmOnly }), `edited a note: "${noteGist(text)}"`);
  }
  function moveNote(id, at) {
    const n = MAPNOTES[id];
    if (!n || (at[0] === n.at[0] && at[1] === n.at[1])) return renderNotes();
    writeNote(id, noteRecord({ map: MAP_ID, text: n.text, at, by: n.by, gmOnly: !!n.gm_only }), `moved a note: "${noteGist(n.text)}"`);
  }
  function deleteNote(id) {
    const n = MAPNOTES[id];
    if (!n) return;
    delete MAPNOTES[id];
    sending('notes/' + id, store.remove('notes/' + id)).catch((e) => { MAPNOTES[id] = n; renderNotes(); toast(`Could not delete the note (${e.message || e}).`); });
    logChange(`removed a note: "${noteGist(n.text)}"`, !n.gm_only);
    toast('Note removed.');
    renderNotes();
  }
  // the right button pans from a note too; no browser menu over notes
  notesEl.addEventListener('contextmenu', (e) => e.preventDefault());
  notesEl.addEventListener('pointerdown', (e) => { if (e.button === 2 && !e.target.closest('.nedit')) { e.preventDefault(); startPan(e, false, true); } });
  // N: a note under the mouse (or Add note, if the mouse is not on the map); Escape: Add note off
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && noting) { e.preventDefault(); e.stopPropagation(); setNoting(false); return; }
    if (e.key !== 'n' && e.key !== 'N') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || READONLY) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [role^=menu]')) return;
    e.preventDefault();
    if (lastPoint) { setNoting(false); openNoteEditor({ at: notePoint(lastPoint[0], lastPoint[1]) }); }
    else setNoting(true);
  }, true);

  // ---- Token Quick-View (board/quickview.js): double-click a token, or select it and press Enter, for its stat
  // block in a floating window, live. GM view: any creature in full; player view: its PCs in full, other creatures
  // it can see as a public card. Read-only. ----
  const qvWins = new Map();   // token id -> {el, offs: [unwatch]}
  const qvContentCache = new Map();
  let qvT = null;
  // keys: a key, or a list of candidate keys (the first the board holds is the one)
  async function qvContent(keys) {
    const out = {};
    for (const entry of keys) {
      for (const k of Array.isArray(entry) ? entry : [entry]) {
        if (!qvContentCache.has(k)) qvContentCache.set(k, await store.get(contentPath(k)).catch(() => null));
        if (qvContentCache.get(k)) { out[k] = qvContentCache.get(k); break; }
      }
    }
    return out;
  }
  const qvSeen = (id) => S.view === 'gm' || (S.tokens[id] && S.tokens[id].kind === 'pc') || shown().seen.has(id);
  function qvClose(id) {
    const w = qvWins.get(id);
    if (!w) return;
    for (const off of w.offs) try { off(); } catch { /* already gone */ }
    w.el.remove();
    qvWins.delete(id);
  }
  function openQuickView(id) {
    const t = S.tokens[id];
    if (!t || !quickViewAccess(t, S.view, qvSeen(id))) return;
    const old = qvWins.get(id);
    if (old) { bringToFront(old.el); old.el.focus(); return; }
    const el = document.createElement('div');
    el.className = 'qvwin'; el.tabIndex = -1;
    el.setAttribute('role', 'dialog');
    el.innerHTML = '<div class="qv-h"><span class="qv-t"></span><span class="qv-k"></span><button type="button" class="qv-x qv-c" data-w="collapse"></button><button type="button" class="qv-x" data-w="close" aria-label="Close Token Quick-View" title="Close (Esc)">✕</button></div><div class="qv-b">Loading…</div>';
    el.querySelector('[data-w=close]').addEventListener('click', () => qvClose(id));
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); qvClose(id); } });
    for (const ev of ['click', 'dblclick', 'wheel', 'contextmenu']) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev === 'wheel' });
    document.body.appendChild(el);
    // the pop-out windows' frame (board/panel.js): moved, resized, collapsed, in front; each token's window remembers
    // its place and size (per browser); a first one opens near the right, the next ones stepped
    const n = qvWins.size % 6;
    makeFloating(el, el.querySelector('.qv-h'), { key: `reliquary.qv.${id}`, defaults: { x: Math.max(8, window.innerWidth - 470 - 28 * n), y: 110 + 28 * n, w: 440 } });
    const w = { el, offs: [] };
    qvWins.set(id, w);
    // live: the creature's game data and live state from the database; its token from the page (qvRefresh)
    w.offs.push(store.watch(`actors/${id}`, () => qvRender(id)), store.watch(`actorstate/${id}`, () => qvRender(id)));
    qvRender(id).then(() => el.focus());
  }
  let qvGlossary = null;   // the campaign's system's trait glossary, read once
  async function qvRender(id) {
    // the glossary built into the board for the campaign's system (GLOSSARIES, by ruleset id), else the campaign's
    // record when it is for the same system; another system's descriptions are never shown
    if (!qvGlossary) {
      const built = typeof GLOSSARIES !== 'undefined' && GLOSSARIES ? GLOSSARIES[META.ruleset] : null;
      const rec = built ? null : await store.get('content/glossary.traits').catch(() => null);
      qvGlossary = (built && built.entries) || (rec && rec.system === META.ruleset && rec.entries) || {};
    }
    const w = qvWins.get(id), t = S.tokens[id];
    if (!w) return;
    const access = t && quickViewAccess(t, S.view, qvSeen(id));
    if (!access) return qvClose(id);
    const actor = await store.get(`actors/${id}`).catch(() => null);
    const state = (await store.get(`actorstate/${id}`).catch(() => null)) || {};
    const content = await qvContent(quickViewKeys(actor, t, SYS));
    let prepared = null;
    const base = actor && actor.base ? content[actor.base] || null : null;
    if (actor && SYS.actors) {
      try { prepared = Engine.prepareActor({ actor, state, effects: t.effects || [], content, ruleset: SYS.actors }); if (!prepared.name) prepared.name = t.name; } catch (e) { prepared = null; console.warn('Quick-View', e); }
    }
    if (!qvWins.has(id)) return;
    const o = { token: t, actor: actor || {}, state, prepared, base, view: S.view, access, conditions: CONDS, describe: Engine.describeStatistic, publicName, system: SYS, glossary: qvGlossary, content };
    const title = quickViewTitle(o);
    w.el.setAttribute('aria-label', `Token Quick-View: ${title.name}`);
    w.el.querySelector('.qv-t').textContent = title.name;
    w.el.querySelector('.qv-k').textContent = [title.kind, title.also].filter(Boolean).join(' · ');
    w.el.querySelector('.qv-b').innerHTML = quickViewBody(o);
  }
  /** Tokens changed (effects, death, the view): redraw the open Quick-Views a moment later. */
  function qvRefresh() { if (qvWins.size && !qvT) qvT = setTimeout(() => { qvT = null; for (const id of [...qvWins.keys()]) qvRender(id); }, 50); }
  canvas.addEventListener('dblclick', (ev) => {
    const target = clickTarget(cellAt(ev));
    if (target.token) { ev.preventDefault(); openQuickView(target.token); }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !selected || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select, button, [role^=menu], .qvwin, .nedit')) return;
    e.preventDefault();
    openQuickView(selected);
  });

  // ---- the token HUD (right-click a token): Target and Assign status effects, as Foundry's Token HUD ----
  const hudEl = document.getElementById('tokhud');
  const hudLeftEl = document.getElementById('tokhud-left');   // the column on the token's left: elevation, Enter Combat, Hide
  let hudElevEdit = false;   // the elevation box is open for typing
  let hudFor = null;        // the token the HUD is open on
  let hudPanel = null;      // the flyout that is open: 'effects' (status palette) or 'template' (area templates)
  let hudShape = null;      // the template shape picked in the flyout, waiting for its size
  let hudKey = '';
  /** Both views open the HUD on any token they can see (to target it); the status effects button is the GM
   *  view's on every token and the player view's on its own PCs only. */
  const canHud = (id) => !READONLY && !!S.tokens[id] && (fullGM() || shown().seen.has(id) || (S.view === 'player' && S.tokens[id].kind === 'pc'));
  const canEditEffects = (id) => S.view === 'gm' || (S.tokens[id] && S.tokens[id].kind === 'pc');
  const HUD_ICONS = {
    effects: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6" r="2.6" fill="currentColor"/><path d="M8.5 21v-6.5L7 10.5Q7 9 9 9h6q2 0 2 1.5l-1.5 4V21z" fill="currentColor"/><path d="M12 1.5v1.6M4.5 4.5l1.2 1.1M19.5 4.5l-1.2 1.1M2 11h1.7M20.3 11H22M3.5 17.5l1.4-.8M20.5 17.5l-1.4-.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    template: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21 L12 4 L21 21 Z" fill="currentColor" fill-opacity=".35" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="4" r="1.8" fill="currentColor"/></svg>',
    target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>',
    eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M4 4l16 16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    combat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3l9.5 9.5M3 4l9.5 9.5M20 3l-9.5 9.5M21 4l-9.5 9.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6.5 15.5l-3 3M4 17l3 3M17.5 15.5l3 3M20 17l-3 3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  };
  function openHud(id) {
    endAim(); if (noting) setNoting(false);
    hudFor = id; hudPanel = null; hudShape = null; hudKey = ''; hudElevEdit = false;
    renderHud();
  }
  function closeHud() {
    if (!hudFor) return;
    hudFor = null; hudPanel = null; hudShape = null; hudKey = ''; hudElevEdit = false;
    hudEl.replaceChildren(); hudEl.hidden = true;
    hudLeftEl.replaceChildren(); hudLeftEl.hidden = true;
  }
  /** The HUD beside the token's space; rebuilt only when what it shows changes (so hovering a tile keeps its tip). */
  function renderHud() {
    if (!hudFor || !S.tokens[hudFor] || !canHud(hudFor)) return closeHud();
    const t = S.tokens[hudFor];
    const key = canon({ id: hudFor, p: hudPanel, sh: hudShape, e: t.effects || [], d: !!t.dead, hid: !!t.hidden, el: t.elevation || 0, ee: hudElevEdit, tg: myTargets().includes(hudFor), v: S.view, c: !!(trackerUi && trackerUi.inEncounter(hudFor)) });
    if (key !== hudKey) {
      hudKey = key;
      hudEl.replaceChildren();
      const col = document.createElement('div');
      col.className = 'hud-col';
      const left = [];   // buttons for the column on the token's left, under the height
      const btn = (kind, label, on, act, side) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'hud-btn' + (on ? ' on' : ''); b.innerHTML = HUD_ICONS[kind];
        b.title = label; b.setAttribute('aria-label', label); b.setAttribute('aria-pressed', String(!!on));
        b.addEventListener('click', (e) => { e.stopPropagation(); act(); });
        if (side === 'left') left.push(b); else col.appendChild(b);
        return b;
      };
      btn('target', myTargets().includes(hudFor) ? 'Untarget' : 'Target', myTargets().includes(hudFor), () => {
        if (t.dead && !myTargets().includes(hudFor)) return toast(`${nm(t)} is dead: it can't be targeted.`);
        setMyTargets(toggleTarget(myTargets(), hudFor)); renderHud();
      });
      // Enter Combat (the encounter tracker): the GM for any token (with the others selected), a player for a PC
      if (trackerUi && (S.view === 'gm' || t.kind === 'pc')) {
        const inEnc = trackerUi.inEncounter(hudFor);
        btn('combat', inEnc ? 'Leave combat' : 'Enter Combat', inEnc, () => {
          if (inEnc) return trackerUi.leave(hudFor);
          const group = S.view === 'gm' && (multi.has(hudFor) || selected === hudFor) ? [...new Set([hudFor, ...multi])].filter((id) => S.tokens[id]) : [hudFor];
          trackerUi.enter(group).then(() => renderHud());
        }, 'left');
      }
      // Hide / Show (the GM's only), under Enter Combat: a hidden token is never the players'; the GM sees it transparent
      if (S.view === 'gm') btn(t.hidden ? 'eyeOff' : 'eye', t.hidden ? 'Show to players' : 'Hide from players', !!t.hidden, () => setHidden(hudFor, !t.hidden), 'left');
      const panelBtn = (kind, label, panel) => btn(kind, label, hudPanel === panel, () => { hudPanel = hudPanel === panel ? null : panel; hudShape = null; renderHud(); });
      if (canEditEffects(hudFor)) panelBtn('effects', 'Assign status effects', 'effects');
      if (canEditEffects(hudFor) && AREAS) panelBtn('template', 'Area template', 'template');
      hudEl.appendChild(col);
      if (hudPanel === 'effects' && canEditEffects(hudFor)) hudEl.appendChild(statusPalette(hudFor));
      if (hudPanel === 'template' && canEditEffects(hudFor) && AREAS) hudEl.appendChild(templatePanel(hudFor));
      hudLeftEl.replaceChildren();
      const leftCol = elevationControl(hudFor, canEditEffects(hudFor));   // read-only where this view may not change it
      for (const b of left) leftCol.appendChild(b);   // then Enter Combat and Hide, as Foundry's left column
      hudLeftEl.appendChild(leftCol);
    }
    hudEl.hidden = false;
    hudLeftEl.hidden = !hudLeftEl.childElementCount;
    placeHud();
  }
  /** Elevation, in the column on the token's left (as Foundry's): the height in feet, shown above the token as
   *  "+15 ft". Click it to type a number (negative is below the ground); Enter saves, Escape cancels. */
  const elevText = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
  function elevationControl(id, editable = true) {
    const t = S.tokens[id], v = t.elevation || 0, unit = SYS.measurement.unit, box = document.createElement('div');
    box.className = 'hud-col';
    if (!editable) {   // players see a foe's or NPC's height, but do not change it
      const b = document.createElement('div');
      b.className = 'hud-btn hud-elev readonly' + (v ? ' on' : '');
      b.textContent = String(v === 0 ? 0 : elevText(v));
      b.title = `Elevation: ${v ? elevText(v) + ' ' + unit : 'on the ground'}`;
      b.setAttribute('role', 'status'); b.setAttribute('aria-label', `Elevation ${v} ${unit}`);
      box.appendChild(b);
      return box;
    }
    if (!hudElevEdit) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'hud-btn hud-elev' + (v ? ' on' : '');
      b.textContent = String(v === 0 ? 0 : elevText(v));
      b.title = `Elevation: ${v ? elevText(v) + ' ' + unit : 'on the ground'} (click to change)`;
      b.setAttribute('aria-label', `Elevation ${v} ${unit}; click to change`);
      b.addEventListener('click', (e) => { e.stopPropagation(); hudElevEdit = true; renderHud(); });
      box.appendChild(b);
      return box;
    }
    const form = document.createElement('form');
    form.className = 'hud-elev-form'; form.noValidate = true;
    const input = document.createElement('input');
    input.type = 'number'; input.step = '1'; input.value = String(v); input.setAttribute('aria-label', `Elevation in ${unit}`);
    const lab = document.createElement('small'); lab.textContent = `Elevation (${unit})`;
    form.append(input, lab);
    form.addEventListener('submit', (e) => {
      e.preventDefault(); e.stopPropagation();
      const n = Math.round(Number(input.value));
      if (input.value.trim() === '' || !Number.isFinite(n)) { toast(`Give the elevation as a number of ${unit} (negative for below).`); input.focus(); return; }
      hudElevEdit = false;
      setElevation(id, n);
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();   // typing never reaches the board's keys (T, N, arrows)
      if (e.key === 'Escape') { e.preventDefault(); hudElevEdit = false; renderHud(); }
    });
    box.appendChild(form);
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return box;
  }
  function setElevation(id, n) {
    const t = { ...S.tokens[id] };
    if (n) t.elevation = n; else delete t.elevation;
    S.tokens[id] = t;
    renderHud(); draw();   // persist() writes the token and logs the change
  }
  const SHAPE_ICONS = {
    burst: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".3" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/></svg>',
    cone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 L20 3 L20 21 Z" fill="currentColor" fill-opacity=".3" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    line: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="9.5" width="20" height="5" rx="1" fill="currentColor" fill-opacity=".3" stroke="currentColor" stroke-width="1.6"/></svg>',
    emanation: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor" fill-opacity=".25" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2"/><rect x="8.5" y="8.5" width="7" height="7" rx="1" fill="currentColor"/></svg>',
  };
  /** The area template flyout: the system's shapes; then that shape's quick sizes and a custom size. The token
   *  is the caster. Picking a size starts aiming (an emanation is placed at once). */
  function templatePanel(id) {
    const pan = document.createElement('div'), unit = SYS.measurement.unit, sq = SYS.measurement.squareFeet;
    pan.className = 'hud-tpl'; pan.setAttribute('role', 'group'); pan.setAttribute('aria-label', `Area template from ${nm(S.tokens[id])}`);
    const row = document.createElement('div'); row.className = 'hud-shapes';
    for (const shape of Object.keys(AREAS.shapes)) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'hud-shape' + (hudShape === shape ? ' on' : '');
      b.innerHTML = (SHAPE_ICONS[shape] || '') + `<span>${label(shape)}</span>`;
      b.setAttribute('aria-pressed', String(hudShape === shape));
      b.title = { burst: 'Burst: from a grid corner you choose', cone: 'Cone: from this creature, 8 directions', line: 'Line: from this creature, any angle', emanation: 'Emanation: all round this creature, placed at once' }[shape] || label(shape);
      b.addEventListener('click', (e) => { e.stopPropagation(); hudShape = hudShape === shape ? null : shape; renderHud(); });
      row.appendChild(b);
    }
    pan.appendChild(row);
    if (hudShape) {
      let burstHeight = lastBurstHeight;
      const go = (ft) => { const shape = hudShape, caster = id; lastBurstHeight = burstHeight; closeHud(); startAim(shape, ft, caster, shape === 'burst' ? burstHeight : 0); };
      const sizes = document.createElement('div'); sizes.className = 'hud-sizes';
      for (const ft of AREAS.sizes) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'hud-size' + (lastFt[hudShape] === ft ? ' last' : ''); b.textContent = `${ft} ${unit}`;
        b.addEventListener('click', (e) => { e.stopPropagation(); go(ft); });
        sizes.appendChild(b);
      }
      const custom = document.createElement('form'); custom.className = 'hud-custom';
      custom.noValidate = true;   // 12 is fine: sizeFeet rounds it to whole squares (the browser's step check would block it)
      const input = document.createElement('input');
      input.type = 'number'; input.min = sq; input.step = sq; input.max = AREAS.maxFeet || 500; input.placeholder = 'Custom';
      input.setAttribute('aria-label', `Custom size in ${unit}`);
      const ok = document.createElement('button'); ok.type = 'submit'; ok.textContent = 'Aim';
      custom.append(input, ok);
      custom.addEventListener('submit', (e) => {
        e.preventDefault(); e.stopPropagation();
        const ft = sizeFeet(input.value, sq, AREAS.maxFeet || 500);
        if (!Number.isFinite(ft)) { toast(`Give the size in ${unit}.`); input.focus(); return; }
        go(ft);
      });
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') closeHud(); });
      sizes.appendChild(custom);
      if (hudShape === 'burst') {   // a burst's point can be in the air: its height above the ground
        const hl = document.createElement('label'); hl.className = 'hud-height';
        const hi = document.createElement('input');
        hi.type = 'number'; hi.step = '5'; hi.value = String(burstHeight); hi.setAttribute('aria-label', `Burst height in ${unit}`);
        hi.addEventListener('input', () => { const n = Math.round(Number(hi.value)); burstHeight = Number.isFinite(n) ? n : 0; });
        hi.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') closeHud(); });
        hl.append('At height ', hi, ` ${unit}`);
        sizes.appendChild(hl);
      }
      pan.appendChild(sizes);
    }
    return pan;
  }
  /** Every condition of the system and Dead: lit with an orange frame when on, dimmed when off; the number on
   *  valued ones. Click toggles or raises, right-click lowers or removes (board/effects.js stepCondition). */
  function statusPalette(id) {
    const t = S.tokens[id], pal = document.createElement('div');
    pal.className = 'hud-palette'; pal.setAttribute('role', 'group'); pal.setAttribute('aria-label', `Status effects for ${nm(t)}`);
    const mine = (t.effects || []).filter((e) => S.view === 'gm' || !e.gm_only);
    const tile = (icon, label, rule, on, value, kind, act) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'hud-tile' + (on ? ' on' : '') + ' ' + kind;
      b.textContent = icon;
      b.title = `${label}${value != null ? ' ' + value : ''}: ${rule}${on ? '' : ''}`;
      b.setAttribute('aria-label', `${label}${value != null ? ' ' + value : ''}${on ? ' (on)' : ''}`);
      b.setAttribute('aria-pressed', String(!!on));
      if (value != null) { const n = document.createElement('span'); n.className = 'hud-n'; n.textContent = value; b.appendChild(n); }
      b.addEventListener('click', (e) => { e.stopPropagation(); act(1); });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); act(-1); });
      pal.appendChild(b);
    };
    const ids = Object.keys(CONDS).sort((a, b) => CONDS[a].label.localeCompare(CONDS[b].label));
    for (const cid of ids) {
      const c = CONDS[cid], cur = mine.find((e) => e.id === cid);
      tile(c.icon, c.label, c.rule + (c.valued ? ' (Click raises, right-click lowers.)' : ''), !!cur, cur && c.valued ? cur.value : null, c.kind, (dir) => setEffects(id, stepCondition(t.effects, cid, dir, CONDS)));
    }
    tile('✖', 'Dead', 'Faded with a red cross; no longer blocks movement, sees or can be targeted. Click to switch.', !!t.dead, null, 'dead', (dir) => setDead(id, dir > 0 ? !t.dead : false));
    return pal;
  }
  function setEffects(id, effects) {
    const t = { ...S.tokens[id] };
    if (effects.length) t.effects = effects; else delete t.effects;
    S.tokens[id] = t;
    renderHud(); recompute();   // who can see may change (blinded, unconscious); persist() writes it and logs the change
    qvRefresh();
  }
  /** The GM hides a token from the players or shows it again (the token HUD, the tracker's eye). */
  function setHidden(id, hidden) {
    if (S.view !== 'gm' || !S.tokens[id]) return;
    const t = { ...S.tokens[id] };
    if (hidden) t.hidden = true; else delete t.hidden;
    S.tokens[id] = t;
    renderHud(); recompute(); draw();
    qvRefresh();
    schedulePersist();
  }
  function setDead(id, dead) {
    const t = { ...S.tokens[id] };
    if (dead) { t.dead = true; if (myTargets().includes(id)) setMyTargets(myTargets().filter((x) => x !== id)); } else delete t.dead;
    S.tokens[id] = t;
    renderHud(); recompute();
    qvRefresh();
  }
  /** The HUD floats over the page (fixed), to the right of the token's space, or to its left when there is no
   *  room; kept inside the window. It follows the token, the zoom and scrolling. */
  const HUD_SQUARE_PX = 48, HUD_SCALE = [0.7, 1.5];
  function placeHud() {
    if (!hudFor || !S.tokens[hudFor] || hudEl.hidden) return;
    const sp = space(hudFor), r = canvas.getBoundingClientRect(), gap = 8;
    const x0 = r.left + (OX + sp.x * CS) * scale, x1 = r.left + (OX + (sp.x + sp.size) * CS) * scale, y0 = r.top + (OY + sp.y * CS) * scale;
    // Scale with the zoom, as Foundry's Token HUD does: normal size when a square is HUD_SQUARE_PX on screen,
    // within HUD_SCALE. A CSS transform: no re-layout, so it keeps up with the wheel.
    const k = Math.max(HUD_SCALE[0], Math.min(HUD_SCALE[1], (CS * scale) / HUD_SQUARE_PX));
    hudEl.style.transform = `scale(${k})`;
    const w = hudEl.offsetWidth * k, h = hudEl.offsetHeight * k;
    let left = x1 + gap;
    if (left + w > window.innerWidth - gap) left = Math.max(gap, x0 - gap - w);
    const top = Math.max(gap, Math.min(window.innerHeight - h - gap, y0));
    hudEl.style.left = left + 'px'; hudEl.style.top = top + 'px';
    hudEl.classList.toggle('flip', left < x0);
    if (!hudLeftEl.hidden) {   // elevation: on the token's left, its right edge a gap from the token
      hudLeftEl.style.transform = `scale(${k})`;
      const lw = hudLeftEl.offsetWidth * k;
      hudLeftEl.style.left = Math.max(gap, x0 - gap - lw) + 'px';
      hudLeftEl.style.top = Math.max(gap, Math.min(window.innerHeight - hudLeftEl.offsetHeight * k - gap, y0)) + 'px';
    }
  }
  document.getElementById('stage').addEventListener('scroll', () => { if (hudFor) placeHud(); }, { passive: true });
  window.addEventListener('resize', () => { if (hudFor) placeHud(); });
  for (const el of [hudEl, hudLeftEl]) {
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !hudFor) return;
    e.preventDefault(); e.stopPropagation();
    if (hudElevEdit) { hudElevEdit = false; renderHud(); } else closeHud();   // Escape while typing the elevation cancels only that
  }, true);

  function moveToken(id, goal, route) {
    const t = S.tokens[id], tiny = Engine.isTiny(t), size = t.size || 1, off = tiny ? 0.25 : 0;
    const fits = Engine.fits(moveWalls, goal[0] + off, goal[1] + off, size);
    const tinyHere = tiny ? Object.entries(S.tokens).filter(([o, u]) => o !== id && Engine.isTiny(u) && u.x === goal[0] && u.y === goal[1]).length : 0;
    const blocking = tiny ? [] : Engine.blockersAt({ id, ...t }, goal[0], goal[1], raw());
    if (blocking.length) { const who = blocking.map(theName).join(' and '); toast(`${nm(t)} cannot share a square with ${who}.`); log(`${pubName(t)} placed on ${blocking.map((b) => pubName(b)).join(' and ')} (GM call).`, 'warn'); }
    if (tiny && tinyHere >= Engine.MAX_PER_SQUARE) { toast(`Only ${Engine.MAX_PER_SQUARE} Tiny creatures fit in one square.`); log(`${pubName(t)} squeezed into a full square (GM call).`, 'warn'); }
    // The board warns but never prevents: the GM decides.
    if (!fits) { toast(`${nm(t)} does not fit there.`); log(`${pubName(t)} placed where it does not fit (GM call).`, 'warn'); }
    else if (!route) { toast(`No route for ${nm(t)}: walls are in the way.`); log(`${pubName(t)} moved with no legal route (GM call).`, 'warn'); }
    else if (route.feet > t.speed) { toast(`${route.feet} ft is more than ${nm(t)}'s ${t.speed} ft Speed.`); log(`${pubName(t)} moved ${route.feet} ft, beyond its Speed.`, 'warn'); }
    else {
      const tn = routeNotes(id, route);
      log(`${pubName(t)} moved ${route.feet} ft to ${goal[0]},${goal[1]}${tn.extraFt ? `, ${tn.extraFt} ft of it for difficult terrain` : ''}.`);
      for (const n of tn.notes) log(`${pubName(t)}: ${n}.`, 'warn');
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
      toast(`${nm(t)} cannot step that way.`); return;
    }
    const entered = terrain.entered(t.x, t.y, t.x + k[0], t.y + k[1], mspace(selected).size);
    const stepOk = Engine.canStepInto(entered, moverOf(selected));
    t.x += k[0]; t.y += k[1]; delete t.slot;
    if (stepOk) log(`${pubName(t)} steps to ${t.x},${t.y}.`);
    else log(`${pubName(t)} moves to ${t.x},${t.y}: difficult terrain, so this is a Stride, not a Step.`, 'warn');
    panel(); recompute();
  });

  function setView(v) {
    if (v !== S.view) { endAim(); closeNoteEditor(); setNoting(false); closeHud(); fxPanel.hidden = true; fxPlayer.clear(); }
    S.view = v;
    if (v === 'player' && S.walls) setWalls(false);   // the walls are the GM's (the Walls tab)
    document.getElementById('v-player').setAttribute('aria-pressed', String(v === 'player'));
    document.getElementById('v-gm').setAttribute('aria-pressed', String(v === 'gm'));
    if (v === 'player' && selected && !view.seen.has(selected)) selected = null;
    if (v === 'player' && multi.size) setSelection([...multi].filter((id) => S.tokens[id] && S.tokens[id].kind === 'pc'));
  if (sidebar) sidebar.refresh();
  changeLogCard();
    document.getElementById('b-colour').hidden = !(HAS_LIGHTING && v === 'gm');
    document.getElementById('b-anim').hidden = !(HAS_LIGHTING && v === 'gm');
    panel(); lightingCard(); draw();
    if (notesReady) renderNotes();
    if (shellReady) shell.setView(v);
    if (trackerUi) trackerUi.render();
    if (chatUi) chatUi.render();
    if (clockUi) clockUi.render();
    qvRefresh();
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
  const wallsBtn = document.getElementById('b-walls');
  function setWalls(on) { S.walls = on; wallsBtn.setAttribute('aria-pressed', String(on)); wallsBtn.textContent = on ? 'Hide walls' : 'Show walls'; draw(); }
  wallsBtn.onclick = () => setWalls(!S.walls);
  document.getElementById('lt-none').hidden = HAS_LIGHTING;
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
    // Place the token HUD again now, in the same frame: fit() placed it before the scroll was corrected, and
    // the scroll event comes a frame later, so it would show a frame or two out of place (a bounce).
    if (hudFor) placeHud();
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
    if (q.dx || q.dy) { stageEl.scrollLeft -= q.dx; stageEl.scrollTop -= q.dy; if (hudFor) placeHud(); }
  }
  const onWheel = (e) => {
    e.preventDefault();
    queueView(wheelZoomFactor(e, stageEl.clientHeight), e.clientX, e.clientY);
  };
  stageEl.addEventListener('wheel', onWheel, { passive: false });
  hudEl.addEventListener('wheel', onWheel, { passive: false });   // the token HUD floats outside the stage: zoom over it too
  hudLeftEl.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoom * 1.25); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(zoom / 1.25); }
    else if (e.key === '0') { e.preventDefault(); zoom = 1; fit(); }
  });
  window.addEventListener('resize', fit);
  // the map area can change size without the window doing so (the sidebar restored collapsed or at another width,
  // resized, a tab's content): refit then too, so the overlays (hover squares, rings, labels, effects, notes) stay
  // on the map, which is centred in the area
  if (typeof ResizeObserver !== 'undefined') {
    let fitRaf = null, lastW = 0, lastH = 0;
    new ResizeObserver(() => {
      const st = document.getElementById('stage');
      if (st.clientWidth === lastW && st.clientHeight === lastH) return;
      lastW = st.clientWidth; lastH = st.clientHeight;
      if (!fitRaf) fitRaf = requestAnimationFrame(() => { fitRaf = null; fit(); });
    }).observe(document.getElementById('stage'));
  }
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
      const [coll, rid] = p.split('/');
      const pub = coll === 'tokens' ? !!(S.tokens[rid] && (S.tokens[rid].kind === 'pc' || (view && view.seen && view.seen.has(rid)))) : undefined;
      for (const what of describe(p, before, v)) logChange(what, pub);
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
      const name = pubName(after) || id, out = [];
      if (before.x !== after.x || before.y !== after.y) out.push(`${name} moved to ${after.x},${after.y}`);
      const lb = before.light || {}, la = after.light || {};
      if ((lb.on !== false) !== (la.on !== false) && after.light) out.push(`${name} ${la.on === false ? 'put out' : 'lit'} the light`);
      for (const k of ['colour', 'intensity', 'animation']) if (canon(lb[k]) !== canon(la[k])) out.push(`${name}'s light ${k}: ${typeof la[k] === 'object' ? canon(la[k]) : la[k]}`);
      out.push(...describeEffects(name, before, after, CONDS));
      if (!!before.hidden !== !!after.hidden) out.push(after.hidden ? `${name} hidden from players` : `${name} shown to players`);
      if ((before.elevation || 0) !== (after.elevation || 0)) out.push(after.elevation ? `${name} elevation ${elevText(after.elevation)} ${SYS.measurement.unit}` : `${name} back to the ground (elevation 0)`);
      for (const k of changedKeys(before, after).filter((k) => !['x', 'y', 'light', 'slot', 'effects', 'dead', 'elevation', 'hidden'].includes(k))) out.push(`${name}: ${k} changed`);
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
  /**
   * A change-log line, into the chat (board/chat.js): the GM sees every line; players see it when `pub` (about a PC
   * or a creature the party sees, the clock, rounds and turns); by default a player's own changes are public.
   */
  function logChange(what, pub) {
    if (READONLY) return;
    store.set(chatPath(), logMessage({ text: what, by: by(), map: MAP_ID, public: pub ?? by() === 'player' })).catch(() => {});
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
  function remoteChanged() { if (!remoteT) remoteT = setTimeout(() => { remoteT = null; panel(); lightingCard(); recompute(); qvRefresh(); }, 0); }
  /** Has the store's value at p changed from what the board knows? If so, remember it and say yes. */
  function fresh(p, data) {
    const v = prune(data || {}), c = canon(v);
    if (known.get(p) === c) return false;
    known.set(p, c); knownData.set(p, v);
    return true;
  }
  function reloadBoard(why) { toast(why + ' Reloading the board...'); setTimeout(() => location.reload(), 900); }

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
    const onTemplates = (list) => {
      let changed = false;
      const here = new Set();
      for (const e of list) {
        if (e.data.map !== MAP_ID) continue;
        here.add(e.id);
        if (busy(e.path)) continue;
        const { map: _m, ...t } = e.data;
        if (canon(t) !== canon(TEMPLATES[e.id])) { TEMPLATES[e.id] = t; changed = true; }
      }
      for (const id of Object.keys(TEMPLATES)) if (!here.has(id) && !busy('templates/' + id)) { delete TEMPLATES[id]; changed = true; }
      if (changed) draw();
    };
    store.watchCollection('templates', onTemplates);
    const onNotes = (list) => {
      let changed = false;
      const here = new Set();
      for (const e of list) {
        if (e.data.map !== MAP_ID) continue;
        here.add(e.id);
        if (busy(e.path)) continue;
        const { map: _m, ...n } = e.data;
        if (canon(n) !== canon(MAPNOTES[e.id])) { MAPNOTES[e.id] = n; changed = true; }
      }
      for (const id of Object.keys(MAPNOTES)) if (!here.has(id) && !busy('notes/' + id)) { delete MAPNOTES[id]; changed = true; }
      // someone else changed or removed the note being edited: the editor stays; saving writes over it
      if (changed) renderNotes();
    };
    store.watchCollection('notes', onNotes);
    store.watchCollection(FX_COLLECTION, onFx);
    resync.notes = () => store.list('notes').then(onNotes).catch(() => {});
    resync.templates = () => store.list('templates').then(onTemplates).catch(() => {});
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

  }

  // ---------- visual effects (engine/fx, board/fx.js; docs/design/board.md section 7) ----------
  // Claude plays an effect by writing a record fx/<id> (tools/fx.mjs); every board plays it once as it arrives,
  // on its own canvas over the map. Effects show only what this view can see: a play is drawn when the view sees
  // either end, and a GM-only play (o.gm) only in the GM view.
  const fxPlayer = new Engine.FxPlayer(), fxPref = prefStore(), FX_PALETTE = paletteOf(FX_LIBS);
  let fxOn = fxPref.on(), fxRaf = null, fxN = 0;
  const fxSeen = new Set(), fxRemoving = new Set();
  /** Pixels (from the grid origin) of a cell point. */
  const cellPx = (c) => ({ x: P(c[0]), y: P(c[1]) });
  /** One end of a play: a token's centre (lifted toward its elevation label when it is up in the air) or a point. */
  function fxEnd(ref, F, full, lifted = true) {
    if (ref === undefined || ref === null) return null;
    if (Array.isArray(ref)) return { pt: cellPx(ref), seen: full || F.at(ref[0], ref[1]) };
    const t = S.tokens[ref];
    if (!t) return null;
    const sp = space(ref), lift = lifted && (t.elevation || 0) > 0 ? sp.size * 0.4 : 0;
    return { pt: { x: P(sp.x + sp.size / 2), y: P(sp.y + sp.size / 2 - lift) }, seen: full || (t.kind === 'pc' && !t.hidden) || F.seen.has(ref) };
  }
  /** The board's map under a token, drawn again offset: the shake on a hit. */
  function fxSnapshot(g, x, y, r, dx, dy) {
    const k = scale * (window.devicePixelRatio || 1), sx = (OX + x - r) * k, sy = (OY + y - r) * k, sw = 2 * r * k;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    g.beginPath(); g.arc((OX + x + dx) * k, (OY + y + dy) * k, r * k, 0, Math.PI * 2); g.clip();
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.shadowBlur = 0;
    g.drawImage(canvas, Math.max(0, sx), Math.max(0, sy), sw, sw, Math.max(0, sx) + dx * k, Math.max(0, sy) + dy * k, sw, sw);
    g.restore();
  }
  /**
   * Play an effect record ({name, from?, to?, o?}) on this screen. Returns how many targets it played at.
   * `local`: the GM's preview (plays even with effects turned off, nothing written).
   */
  function playFx(rec, { local = false } = {}) {
    if ((!fxOn && !local) || !rec || !rec.name) return 0;
    const o = rec.o || {};
    if (o.gm && S.view !== 'gm') return 0;
    const found = Engine.resolveEffect(rec.name, FX_LIBS, { kind: o.kind, traits: o.traits });
    const F = shown(), full = S.view === 'gm';
    const from = fxEnd(rec.from, F, full), now = performance.now();
    const env = { cs: CS, rng: Engine.makeRng(1), reduced: REDUCED, snapshot: fxSnapshot };
    let k = 0;
    for (const t of playTargets(rec, { tokens: S.tokens, targets: TARGETS, templates: TEMPLATES })) {
      let b = null, cells;
      if (t.id || t.cell) b = fxEnd(t.id || t.cell, F, full, rec.name !== 'ping');   // a ping marks the token itself, not its height
      else if (t.template) {
        const aim = templateAim(TEMPLATES[t.template]);
        cells = aim.cells.map(cellPx);
        b = { pt: cellPx(aim.b), seen: full || aim.cells.some((c) => F.at(c[0] + 0.5, c[1] + 0.5)) };
      }
      const a = from || b, z = b || from;
      if (!a || !(a.seen || z.seen)) continue;
      const jobs = Engine.planEffect(found.effect, {
        a: a.pt, b: z.pt, cells, cs: CS, palette: FX_PALETTE, reduced: REDUCED,
        o: { ...o, result: t.result, text: t.text }, rng: Engine.makeRng(`${rec.id || 'local' + fxN++}/${k}`),
      });
      fxPlayer.add(jobs, now + k * STAGGER, env);
      k++;
    }
    if (k && !fxRaf) fxRaf = requestAnimationFrame(fxFrame);
    return k;
  }
  function fxFrame() {
    fxRaf = null;
    const dpr = window.devicePixelRatio || 1;
    fxg.setTransform(1, 0, 0, 1, 0, 0); fxg.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    fxg.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0); fxg.translate(OX, OY);
    const live = fxPlayer.draw(fxg, performance.now());
    if (fxPlayer.lastError) { console.warn('Visual effect:', fxPlayer.lastError); fxPlayer.lastError = null; }
    if (live) fxRaf = requestAnimationFrame(fxFrame);
  }
  function setFxOn(on) {
    fxOn = !!on; fxPref.set(fxOn);
    const m = shellReady && shell.menu();
    if (m) m.setToggle('fx-on', fxOn);
    if (!fxOn) { fxPlayer.clear(); fxFrame(); }
    toast(fxOn ? 'Visual effects on (this screen).' : 'Visual effects off (this screen).');
  }
  /** New play records: play each once; remove old ones. */
  function onFx(list) {
    const first = !fxSeen.size && !onFx.ran;
    onFx.ran = true;
    for (const e of newPlays(list, fxSeen, { map: PARTY_MAP, first })) if (!READONLY) playFx({ id: e.id, ...e.data });
    if (READONLY) return;
    for (const e of stale(list)) if (!fxRemoving.has(e.path)) { fxRemoving.add(e.path); store.remove(e.path).catch(() => {}); }
  }
  // the GM's preview: every effect by group, played from the selected token to the targets (or the hovered token)
  const fxPanel = document.getElementById('fxpanel'), fxList = document.getElementById('fx-list'), fxSearch = document.getElementById('fx-search');
  let fxLastHover = null;
  function renderFxList() {
    const groups = previewList(FX_LIBS, fxSearch.value);
    fxList.textContent = '';
    for (const g of groups) {
      const h = document.createElement('h3'); h.textContent = g.group; fxList.appendChild(h);
      for (const it of g.items) {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.dataset.fx = it.name; btn.title = it.name;
        btn.innerHTML = `<span></span>${it.via === 'pack' ? '<span class="tag">pack</span>' : ''}<span class="nm"></span>`;
        btn.children[0].textContent = it.label; btn.querySelector('.nm').textContent = it.name;
        fxList.appendChild(btn);
      }
    }
    if (!groups.length) fxList.innerHTML = '<p class="fxhint">No effect matches.</p>';
  }
  function previewFx(name) {
    const src = selectedIds()[0], mine = myTargets().filter((id) => S.tokens[id] && id !== src);
    const to = mine.length ? mine : fxLastHover && S.tokens[fxLastHover] && fxLastHover !== src ? [fxLastHover] : null;
    const res = (document.querySelector('input[name=fx-res]:checked') || {}).value || 'hit';
    const text = document.getElementById('fx-text').value.trim(), n = Number(document.getElementById('fx-n').value) || 3;
    const e = Engine.resolveEffect(name, FX_LIBS).effect;
    // an area effect plays over the newest template on the map when there is one
    const tpl = e.kind === 'area' ? Object.keys(TEMPLATES).sort((x, y) => (TEMPLATES[y].at || '').localeCompare(TEMPLATES[x].at || ''))[0] : null;
    const rec = { name, from: src || undefined, to: tpl ? 'template:' + tpl : to || (src ? undefined : null), o: { result: res, text: text || undefined, n } };
    if (!src && !to && !tpl) { toast('Select a token to play from, and target or hover one to play at.'); return; }
    if (!playFx(rec, { local: true })) toast('Nothing to play at here.');
  }
  function openFxPanel() {
    if (S.view !== 'gm') return;
    fxPanel.hidden = false; renderFxList(); fxSearch.focus();
  }
  fxSearch.addEventListener('input', renderFxList);
  fxList.addEventListener('click', (ev) => { const b = ev.target.closest('button[data-fx]'); if (b) previewFx(b.dataset.fx); });
  document.getElementById('fx-close').addEventListener('click', () => { fxPanel.hidden = true; });
  fxPanel.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); fxPanel.hidden = true; } });
  canvas.addEventListener('pointermove', () => { if (hoverId) fxLastHover = hoverId; });

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
    const rows = changeLog(chatUi ? chatUi.messages() : [], S.view).map((d) => {
      const t = d.at ? new Date(d.at) : null;
      const time = t ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      return `<li${d.gm ? ' class="gmline"' : ''}><span class="when">${time}</span> <b class="who who-${d.by}">${WHO[d.by] || d.by}</b> ${String(d.text || '').replace(/</g, '&lt;')}</li>`;
    });
    el.innerHTML = `<h2>Change log</h2><ol class="changes">${rows.join('') || '<li class="muted">No changes yet.</li>'}</ol>`;
  }

  // ---------- the page around the map (board/shell.js): menus, travel, preview, version ----------
  const shell = makeShell({
    store, meta: META, build, table: () => TABLE, mapId: MAP_ID, mapName: map.name, partyMap: PARTY_MAP, readOnly: READONLY,
    view: () => S.view, tokensHere: () => S.tokens, toast, logChange, onCommand, centreOn: centreOnLink, fitWhole: () => { zoom = 1; fit(); },
  });
  shellReady = true;
  const travelChanged = () => shell.travelChanged();
  /** Scroll the map so a token is in the middle of the view (the tracker's ping). */
  function centreOnToken(id) {
    const sp = space(id), stage = document.getElementById('stage');
    if (!sp || !stage) return;
    const sr = stage.getBoundingClientRect(), r = canvas.getBoundingClientRect();
    stage.scrollLeft += r.left - sr.left + (OX + (sp.x + sp.size / 2) * CS) * scale - stage.clientWidth / 2;
    stage.scrollTop += r.top - sr.top + (OY + (sp.y + sp.size / 2) * CS) * scale - stage.clientHeight / 2;
  }
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
    fx: { play: (rec) => playFx(rec, { local: true }), busy: () => fxPlayer.busy, jobs: () => fxPlayer.jobs.map((j) => ({ p: j.p, t0: j.t0, ms: j.ms })), on: () => fxOn, libs: () => FX_LIBS.map((l) => l.via) },
    templates: () => clone(TEMPLATES),
    notes: () => clone(MAPNOTES),
    badges: () => clone(badgeHits),
    hud: () => hudFor,
    noting: () => noting,
    aim: () => (aim ? { shape: aim.shape, ft: aim.ft, caster: aim.caster, cells: aim.cur ? aim.cur.cells.length : 0 } : null),
    command: (id) => onCommand(id),
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
  document.getElementById('sky').value = S.sky;
  syncColourButton(); syncAnimButton();
  if (NOTES.intro) log(NOTES.intro);
  recompute('reset');
  panel();
  lightingCard();
  fit();
  shell.startMenu();
  shell.menu().setToggle('fx-on', fxOn);
  notesReady = true; renderNotes();
  // the game clock in the title line; the GM view edits it (board/clockui.js)
  clockUi = await mountClock({
    store, T: { readClock: Engine.readClock, adventureDay: Engine.adventureDay, clockAt: Engine.clockAt, parseAmount: Engine.parseAmount, unitSeconds: Engine.unitSeconds, expireEffects: Engine.expireEffects }, cal: (SYS.time || {}).calendar, roundSeconds: (SYS.time || {}).roundSeconds || 6,
    getView: () => S.view, readOnly: READONLY, toast, logChange,
    names: (id, t) => publicName(S.tokens[id] || t) || (S.tokens[id] || t).name || id,
    // tokens on this map change through the page's own state (persist() writes and logs them)
    applyLocal: (changed) => { const here = Object.keys(changed).filter((id) => S.tokens[id]); for (const id of here) setEffects(id, changed[id]); return here; },
  });
  // the sidebar (board/sidebar.js): chat, the encounter tracker, the GM's lighting, the change log, the table log
  sidebar = mountSidebar({ root: document.getElementById('sidebar'), view: () => S.view, tabs: [
    { id: 'chat', label: 'Chat' }, { id: 'encounter', label: 'Encounter' }, { id: 'lighting', label: 'Lighting (GM)', gm: true },
    { id: 'walls', label: 'Walls (GM)', gm: true },
    { id: 'changes', label: 'Change log' }, { id: 'tablelog', label: 'Table log' }] });
  chatUi = mountChat({ store, view: () => S.view, readOnly: READONLY, sidebar, pane: sidebar.panel('chat').body,
    names: (id) => (S.tokens[id] ? nm(S.tokens[id]) : null), colour: kindColour, kindOf: (id) => (S.tokens[id] ? S.tokens[id].kind : null) });
  chatUi.onChange(() => changeLogCard());
  trackerUi = await mountTracker({
    store, Engine, SYS, readOnly: READONLY, view: () => S.view, tokens: () => S.tokens,
    seen: (id) => S.view === 'gm' || shown().seen.has(id) || (S.tokens[id] && S.tokens[id].kind === 'pc'),
    partySees: (id) => !!(view && view.seen && view.seen.has(id)),
    name: (id) => (S.tokens[id] ? nm(S.tokens[id]) : id), publicName: (id) => (S.tokens[id] ? pubName(S.tokens[id]) || S.tokens[id].name : id) || id,
    colour: kindColour, toast, logChange,
    loadCreature: async (id) => {
      const actor = await store.get(`actors/${id}`).catch(() => null);
      if (!actor) return null;
      const state = (await store.get(`actorstate/${id}`).catch(() => null)) || {};
      return { actor, state, content: await qvContent(quickViewKeys(actor, S.tokens[id], SYS)) };
    },
    applyTokens: (changed) => {
      const here = Object.keys(changed).filter((id) => S.tokens[id]);
      for (const id of here) { setEffects(id, changed[id].effects); if (changed[id].dead && !S.tokens[id].dead) setDead(id, true); }
      if (here.length) schedulePersist();
      return here;
    },
    // the tracker's target button: target this token alone, or add it to the targets (Shift)
    target: (id, add) => { const t = S.tokens[id]; if (!t) return; if (t.dead) return toast(`${nm(t)} is dead: it can't be targeted.`); const now = myTargets(); setMyTargets(add ? (now.includes(id) ? now : [...now, id]) : [id]); },
    ping: (id) => {
      if (!S.tokens[id]) return;
      centreOnToken(id);
      const rec = fxRecord({ map: MAP_ID, name: 'ping', to: id, by: by() });
      if (READONLY) return playFx(rec, { local: true });
      store.set(`${FX_COLLECTION}/${fxId()}`, rec).catch(() => playFx(rec, { local: true }));
    },
    hover: (id) => { if (trkHover !== id) { trkHover = id; targetsChanged(); } },
    onActing: (id) => { actingId = id; targetsChanged(); },
    onEncounter: (on) => { encounterOn = on; bandCache = null; draw(); },
    setHidden: (id, hidden) => setHidden(id, hidden),
    // the tracker's Defeated marks the token dead on the map (faded, red cross) and back; its hit points are not touched
    setDead: (id, dead) => { const t = S.tokens[id]; if (t && !!t.dead !== !!dead) setDead(id, dead); },
    reveal: (id) => { const t = S.tokens[id]; if (!t || !t.alias) return; S.tokens[id] = { ...t, known: true }; schedulePersist(); draw(); toast(`The party now knows ${t.name}.`); },
    conditionWords: (t) => [...(t.dead ? ['Dead'] : []), ...(t.effects || []).filter((e) => e && (S.view === 'gm' || !e.gm_only)).map((e) => (e.id ? ((CONDS[e.id] || {}).label || e.id) : e.name) + (e.value ? ` ${e.value}` : ''))],
    rolls: chatUi, panel: sidebar.panel('encounter'), openButton: document.getElementById('b-enc'),
  });
  await shell.startMapMenu();
  if (keepGM) setView('gm');
  if (PREVIEW && PREVIEW.link) centreOnLink(PREVIEW.link);
  shell.previewBar();
  startSync();
  shell.watchBuild();
}
