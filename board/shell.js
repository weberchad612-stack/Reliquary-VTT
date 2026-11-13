// The page around the map: what the battle view (app.js) and the area view (area.js) share.
// The top menu, the map menu on the map's name and travel between maps, the GM's preview of another map,
// the new-version banner, and the confirmation dialog. Docs: docs/design/board.md, section 7.

import { MENU, buildMenuBar } from './menu.js';
import { travelMenu, parseTravelId, travelPlan, planArrival } from './travel.js';

export const KEEP_GM = 'reliquary-keep-gm';   // set just before a preview reload, so the GM view survives it

/** Is version a newer than b? Versions are v<yy>.<mm>.<dd>-<hhmm>, so they compare as text. */
export const newerVersion = (a, b) => !!a && !!b && String(a) > String(b);

/** The preview asked for in the page's address: #preview=<map>[:<entrance>] (GM view only). */
export function previewFromHash(hash) {
  const m = /^#?preview=([a-z0-9][a-z0-9-]*)(?::([A-Za-z0-9_-]+))?$/.exec(hash || '');
  return m ? { map: m[1], link: m[2] || null } : null;
}

/**
 * Where this page is: the party's map, or the GM's preview of another (read from the address once, at start).
 * @returns {{keepGM, preview, readOnly, mapId}}
 */
export function pageMap(meta, partyMap) {
  let keepGM = false;
  try { keepGM = sessionStorage.getItem(KEEP_GM) === '1'; sessionStorage.removeItem(KEEP_GM); } catch (e) { /* no session storage */ }
  let preview = keepGM ? previewFromHash(location.hash) : null;
  if (preview && (preview.map === partyMap || !(meta.maps || []).includes(preview.map))) preview = { ...preview, map: partyMap, here: true };
  if (!keepGM && location.hash) history.replaceState(null, '', location.pathname + location.search);
  return { keepGM, preview, readOnly: !!(preview && !preview.here), mapId: preview ? preview.map : partyMap };
}

/** Ask a yes/no question in the page's own dialog (#travel-confirm). Resolves true or false. */
export function confirmBox(text, { title = 'Move the party?', yes = 'Move' } = {}) {
  return new Promise((resolve) => {
    const dlg = document.getElementById('travel-confirm');
    document.getElementById('travel-confirm-title').textContent = title;
    document.getElementById('travel-confirm-text').textContent = text;
    const ok = dlg.querySelector('[data-a=yes]'), no = dlg.querySelector('[data-a=no]');
    ok.textContent = yes;
    dlg.hidden = false;
    const done = (v) => { dlg.hidden = true; document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } };
    document.addEventListener('keydown', onKey, true);
    ok.onclick = () => done(true); no.onclick = () => done(false);
    ok.focus();
  });
}

/**
 * The shell for one page.
 * @param {object} o
 * @param {object} o.store, o.meta, o.build
 * @param {function} o.table      () => the table record as last seen
 * @param {string} o.mapId        the map on screen; o.mapName its name
 * @param {string} o.partyMap     the party's map when the page started
 * @param {boolean} o.readOnly    a GM preview
 * @param {function} o.view       () => 'player' | 'gm'
 * @param {function} o.tokensHere () => {id: token} on the map on screen
 * @param {function} o.toast, o.logChange
 * @param {function} [o.centreOn] (linkId) => void: show an entrance of the map on screen
 * @param {function} [o.fitWhole] () => void: show the whole map on screen
 * @param {function} [o.onCommand] (id, item, state) => true when the page handled a menu item
 */
export function makeShell(o) {
  const { store, meta } = o;
  let menu = null, mapMenu = null;
  let MAPS = [];            // [{id, name, kind, grid, links}] in the campaign's order
  let LINKS_FOUND = {};     // map id -> entrances found in play
  let travelKey = '';

  /** The top menu: the page answers the items it has built (o.onCommand returns true); the rest say they are not built yet. */
  function startMenu() {
    const bar = document.getElementById('menubar');
    bar.hidden = !MENU.length;   // nothing on the top menu: no bar
    menu = buildMenuBar(bar, {
      view: o.view(),
      def: MENU,
      onSelect: (id, item, state) => {
        if (o.onCommand && o.onCommand(id, item, state)) return;
        const what = item.kind === 'toggle' ? `${item.label} ${state ? 'on' : 'off'}` : item.label;
        o.toast(`${what}: not built yet.`);
      },
    });
  }

  const travelDef = () => travelMenu({ maps: MAPS, view: o.view(), current: o.table().current_map || o.partyMap, shown: o.mapId, discovered: o.table().discovered || [], linksFound: LINKS_FOUND });
  function travelChanged() {
    if (!mapMenu) return;
    const d = travelDef(), k = JSON.stringify(d);
    if (k === travelKey) return;
    travelKey = k;
    mapMenu.setDef(d);
  }
  async function startMapMenu() {
    try {
      const order = meta.maps || [];
      MAPS = (await store.list('maps')).map((r) => ({ id: r.data.id || r.id, name: r.data.name, kind: r.data.kind || 'battle', grid: r.data.grid, start: r.data.start || null, links: r.data.links || [] }))
        .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      for (const e of await store.list('mapstate')) LINKS_FOUND[e.data.map || e.id] = e.data.links_found || [];
    } catch (e) { MAPS = [{ id: o.mapId, name: o.mapName, links: [] }]; }
    const nav = document.getElementById('mapmenu');
    nav.hidden = false;
    mapMenu = buildMenuBar(nav, { view: o.view(), def: travelDef(), onSelect: (id) => chooseTravel(id) });
    travelKey = JSON.stringify(travelDef());
    store.watchCollection('mapstate', (list) => {
      const next = {};
      for (const e of list) next[e.data.map || e.id] = e.data.links_found || [];
      if (JSON.stringify(next) !== JSON.stringify(LINKS_FOUND)) { LINKS_FOUND = next; travelChanged(); }
    });
  }

  function chooseTravel(id) {
    const t = parseTravelId(id);
    if (!t) return;
    if (t.kind === 'view') return previewMap(t.map, t.link);
    if (t.kind === 'go') return moveParty(t.map, t.link);
  }

  /** GM: show another map (centred on an entrance) on this screen only. */
  function previewMap(mapId, linkId) {
    if (o.view() !== 'gm') return;
    if (mapId === o.mapId) { if (linkId && o.centreOn) o.centreOn(linkId); else if (o.fitWhole) o.fitWhole(); return; }
    try { sessionStorage.setItem(KEEP_GM, '1'); } catch (e) { /* the preview will open in the player view */ }
    location.hash = 'preview=' + mapId + (linkId ? ':' + linkId : '');
    location.reload();
  }
  function leavePreview() {
    try { if (o.view() === 'gm') sessionStorage.setItem(KEEP_GM, '1'); } catch (e) { /* back in the player view */ }
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
  }
  function previewBar() {
    const bar = document.getElementById('preview-bar');
    if (!o.readOnly) { bar.hidden = true; return; }
    const party = o.table().current_map || o.partyMap;
    const nm = (id) => ((MAPS.find((m) => m.id === id) || {}).name) || id;
    document.getElementById('preview-text').textContent = `Previewing ${o.mapName || o.mapId} on this screen only (the party is on ${nm(party)}). Nothing you change here is saved.`;
    bar.hidden = false;
    document.getElementById('preview-back').onclick = leavePreview;
  }

  /** Player: move the PCs on this map to an entrance or an area map (after a confirmation); the table follows. */
  async function moveParty(toMap, linkId) {
    if (o.view() !== 'player' || o.readOnly) return;
    const plan = travelPlan({ maps: MAPS, from: o.mapId, toMap, linkId, tokens: o.tokensHere() });
    if (!plan) return o.toast('That way does not lead anywhere yet.');
    if (!plan.travellers.length) return o.toast('No PCs are on this map.');
    const dest = plan.target.map, entrance = plan.target.link;
    const who = plan.travellers.map((t) => t.name || t.id).join(', ');
    const where = entrance ? `the ${entrance.label} in ${dest.name || dest.id}` : plan.target.start ? `the starting area of ${dest.name || dest.id}` : (dest.name || dest.id);
    const text = plan.via ? `Take the ${plan.via.label} to ${dest.name || dest.id}? ${who} will go.` : `Move the party to ${where}? ${who} will go.`;
    if (!(await confirmBox(text))) return;
    try {
      let placed = plan.travellers.map((t) => ({ id: t.id }));
      if (dest.kind !== 'area') {
        // The target map as the engine sees it: its walls and its doors as they stand.
        const segs = (await store.list('walls')).filter((e) => e.data.map === dest.id).flatMap((e) => e.data.segs || []);
        const dstate = (await store.get('mapstate/' + dest.id)) || {};
        const pm = Engine.prepareMove(segs, dstate, dest.grid);
        const occupants = (await store.list('tokens')).filter((e) => e.data.map === dest.id).map((e) => ({ ...e.data, id: e.id }));
        const r = planArrival({ pm, cells: plan.cells, travellers: plan.travellers, occupants, engine: Engine });
        if (r.unplaced.length) return o.toast(`There is no room at ${where} for ${r.unplaced.join(', ')}. Ask Claude.`);
        placed = r.placed;
      }
      // An area map has no squares: the PCs go with the party and keep their last square.
      for (const p of placed) await store.update('tokens/' + p.id, p.x === undefined ? { map: dest.id } : { map: dest.id, x: p.x, y: p.y });
      for (const [mid, ids] of Object.entries(plan.found)) {
        const st = (await store.get('mapstate/' + mid)) || { map: mid };
        const have = st.links_found || [];
        const inPack = ((MAPS.find((m) => m.id === mid) || {}).links || []);
        const add = ids.filter((x) => !have.includes(x) && !inPack.find((l) => l.id === x && l.found));
        if (add.length) await store.set('mapstate/' + mid, { ...st, map: mid, links_found: [...have, ...add] });
      }
      o.logChange(`party moved to ${where}`, true);
      await store.update('state/table', { current_map: dest.id });   // every board reloads on this
    } catch (e) { o.toast(`Could not move the party (${e.message || e}).`); }
  }

  /** A newer board published while this page is open: offer a reload. */
  function watchBuild() {
    if (!o.build) return;
    let dismissed = null;
    const box = document.getElementById('newver');
    store.watch('app/build', (b) => {
      if (!b || !newerVersion(b.version, o.build.version) || b.version === dismissed) return;
      box.hidden = false;
      document.getElementById('newver-reload').onclick = () => location.reload();
      document.getElementById('newver-x').onclick = () => { dismissed = b.version; box.hidden = true; };
    });
  }

  return {
    startMenu, startMapMenu, travelChanged, previewBar, leavePreview, watchBuild, moveParty,
    /** The view changed: both menus show what that view may see. */
    setView(v) { if (menu) menu.setView(v); if (mapMenu) { mapMenu.setView(v); travelKey = ''; travelChanged(); } },
    maps: () => MAPS,
    menu: () => menu,
    mapMenu: () => mapMenu,
  };
}
