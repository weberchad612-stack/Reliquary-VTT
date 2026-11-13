// The area view: a town or region map (kind "area") shown fitted to the window, with its places as pins
// (docs/design/board.md, section 7). No grid, walls, tokens or fog: the party is "in" the area, and where
// it goes inside it is told in chat. Clicking a pin shows the place's card; players can leave a request
// ("The party goes to the Leaning Lantern") for Claude, who reads it when the user next writes.
//
// - Players see public places and those found in play (`places_found` in the map's state); the GM view
//   shows every place, the GM-only ones marked, with GM notes. The map menu is the way to other maps.
// - One request at a time, in `state/request`; a new one replaces it. Claude deletes it once ruled on.
// - Travel, the menus, the preview bar and the version banner are the shell's (board/shell.js).

import { makeShell, confirmBox } from './shell.js';
import { mountClock } from './clockui.js';
import { publicName } from './names.js';
import { mountSidebar } from './sidebar.js';
import { mountChat } from './chatui.js';
import { auditPath, auditEntry } from './audit.js';
import { mountAudit } from './auditui.js';
import { mountDice } from './diceui.js';
import { kindColour } from './targeting.js';

/** The places a view may see, with what the pin and card need. */
export function visiblePlaces(map, view, found = []) {
  return (map.places || [])
    .filter((p) => view === 'gm' || p.public !== false || found.includes(p.id))
    .map((p) => ({ ...p, secret: p.public === false, revealed: p.public === false && found.includes(p.id) }));
}

/** A pin's box in percent of the image: [left, top, width, height] (round, or a wide pill 5.5:1). */
export function pinBox(p, image) {
  const w = p.size || image.w * 0.045;
  const h = p.shape === 'wide' ? w / 5.5 : w;
  return [((p.at[0] - w / 2) / image.w) * 100, ((p.at[1] - h / 2) / image.h) * 100, (w / image.w) * 100, (h / image.h) * 100];
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Run the board on an area map.
 * @param {object} store
 * @param {object} c  {meta, table, page: {keepGM, readOnly, mapId}, partyMap, map, mapState, build}
 */
export async function startArea(store, c) {
  const { meta: META, page: PAGE, partyMap: PARTY_MAP, map, build } = c;
  let TABLE = c.table;
  let found = (c.mapState && c.mapState.places_found) || [];
  let request = await store.get('state/request');
  let view = 'player', selected = null, clockUi = null, chatUi = null, auditUi = null, diceUi = null;
  const tokensHere = {};
  for (const e of await store.list('tokens')) if (e.data.map === map.id) { const { map: _m, ...t } = e.data; tokensHere[e.id] = t; }

  // ---- the page: hide the battle map's own controls and cards ----
  for (const id of ['map', 'anim', 'hud']) { const n = document.getElementById(id); if (n) n.hidden = true; }
  for (const sel of ['.zoom', '#sky-wrap', '#b-lighting', '#b-colour', '#b-anim', '#b-walls', '#b-enc']) { const n = document.querySelector(sel); if (n) n.hidden = true; }
  const stage = document.getElementById('stage');
  stage.classList.add('area-stage');
  const box = document.createElement('div');
  box.className = 'area-map';
  box.innerHTML = `<img alt="${esc(map.name)}" draggable="false">`;
  stage.prepend(box);
  const img = box.querySelector('img');
  img.src = map.image.asset ? store.assetUrl(map.image.asset) : (map.image.data || '');
  const card = document.createElement('section');
  card.className = 'card place-card';
  card.id = 'place-card';
  document.getElementById('pane-place').prepend(card);
  // the sidebar (board/sidebar.js): the place, the chat, the dice statistics and the GM's audit log
  const sidebar = mountSidebar({ root: document.getElementById('sidebar'), view: () => view, key: 'reliquary.sidebar.area', tabs: [{ id: 'place', label: 'Place' }, { id: 'chat', label: 'Chat' }, { id: 'dice', label: 'Dice statistics' }, { id: 'audit', label: 'Audit log (GM)', gm: true }] });

  const toastEl = document.getElementById('toast');
  let toastT = null;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }
  const by = () => (view === 'gm' ? 'gm' : 'player');
  /** A line in the GM's audit log (board/audit.js). */
  function logChange(what) {
    if (PAGE.readOnly) return;
    store.set(auditPath(), auditEntry({ text: what, by: by(), map: map.id })).catch(() => {});
  }

  // ---- fit the picture to the window ----
  function fit() {
    const pad = 32;
    const s = Math.min((stage.clientWidth - pad) / map.image.w, (stage.clientHeight - pad) / map.image.h);
    const k = Math.max(0.2, Number.isFinite(s) && s > 0 ? s : 1);
    box.style.width = Math.round(map.image.w * k) + 'px';
    box.style.height = Math.round(map.image.h * k) + 'px';
  }
  addEventListener('resize', fit);

  // ---- pins and the card ----
  const places = () => visiblePlaces(map, view, found);
  function drawPins() {
    box.querySelectorAll('.pin').forEach((n) => n.remove());
    for (const p of places()) {
      const [l, t, w, h] = pinBox(p, map.image);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pin' + (p.shape === 'wide' ? ' wide' : '') + (p.secret && !p.revealed ? ' secret' : '') + (request && request.place === p.id ? ' pending' : '');
      b.style.cssText = `left:${l}%;top:${t}%;width:${w}%;height:${h}%`;
      b.setAttribute('aria-pressed', String(selected === p.id));
      const label = (p.number ? p.number + '. ' : '') + p.name;
      b.setAttribute('aria-label', label);
      b.title = label + (p.secret && !p.revealed ? ' (GM only)' : '');
      b.onclick = (e) => { e.stopPropagation(); select(p.id); };
      box.appendChild(b);
    }
  }
  function select(id) { selected = id; drawPins(); drawCard(); }
  box.addEventListener('click', () => select(null));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && selected && !document.querySelector('.menu-pop:not([hidden])')) select(null); });

  function drawCard() {
    const p = places().find((x) => x.id === selected);
    const waiting = request && request.status !== 'done' ? request : null;
    if (!p) {
      const n = places().length;
      card.innerHTML = `<h2>${esc(map.name)}</h2><p class="muted">${n ? `Click a place on the map to see what is there${PAGE.readOnly || view === 'gm' ? '' : ', and tell Claude where the party goes'}.` : 'No places are known here yet.'}</p>`
        + (waiting ? `<p class="req">Waiting for Claude: ${esc(waiting.what)}</p>` : '');
      return;
    }
    const tags = [];
    if (p.secret) tags.push(p.revealed ? '<span class="chip ok">found in play</span>' : '<span class="chip warn">GM only</span>');
    let html = `<p class="ptype">${esc(p.type || '')}</p><h2>${p.number ? esc(p.number) + '. ' : ''}${esc(p.name)}</h2>`
      + (p.address ? `<p class="addr">${esc(p.address)}</p>` : '')
      + (p.note ? `<p>${esc(p.note)}</p>` : '')
      + (tags.length ? `<div class="chips">${tags.join('')}</div>` : '');
    if (view === 'gm') {
      if (p.gm_note) html += `<p class="gmnote">${esc(p.gm_note)}</p>`;
      if (waiting) html += `<p class="req">Request: ${esc(waiting.what)} <button data-a="clear">Clear</button></p>`;
    } else if (!PAGE.readOnly) {
      if (waiting && waiting.place === p.id) html += `<p class="req">Requested. Waiting for Claude. <button data-a="withdraw">Withdraw</button></p>`;
      else html += `<button data-a="go" aria-pressed="true">The party goes here</button>` + (waiting ? `<p class="muted">This replaces the waiting request (${esc(waiting.what)}).</p>` : '');
    }
    card.innerHTML = html;
    const on = (a, fn) => { const b = card.querySelector(`[data-a=${a}]`); if (b) b.onclick = fn; };
    on('go', () => requestPlace(p));
    on('withdraw', () => clearRequest('withdrew the request'));
    on('clear', () => clearRequest('cleared the request'));
  }

  async function requestPlace(p) {
    const what = `The party goes to ${p.name}`;
    if (request && request.status !== 'done' && request.place !== p.id && !(await confirmBox(`Replace the waiting request (${request.what}) with "${what}"?`, { title: 'Replace the request?', yes: 'Replace' }))) return;
    request = { by: 'player', at: new Date().toISOString(), map: map.id, place: p.id, what, status: 'pending' };
    try {
      await store.set('state/request', request);
      logChange(`request: ${what}`, true);
      toast('Request left for Claude. Tell Claude in chat when you are ready.');
    } catch (e) { toast(`Could not leave the request (${e.message || e}).`); }
    drawPins(); drawCard();
  }
  async function clearRequest(how) {
    const what = request && request.what;
    request = null;
    try { await store.remove('state/request'); logChange(`${how}: ${what}`, true); } catch (e) { toast(`Could not clear the request (${e.message || e}).`); }
    drawPins(); drawCard();
  }

  // ---- the views ----
  const shell = makeShell({
    store, meta: META, build, table: () => TABLE, mapId: map.id, mapName: map.name, partyMap: PARTY_MAP, readOnly: PAGE.readOnly,
    view: () => view, tokensHere: () => tokensHere, toast, logChange, fitWhole: fit,
  });
  function setView(v) {
    view = v;
    document.getElementById('v-player').setAttribute('aria-pressed', String(v === 'player'));
    document.getElementById('v-gm').setAttribute('aria-pressed', String(v === 'gm'));
    sidebar.refresh();
    if (auditUi) auditUi.render();
    if (diceUi) diceUi.render();
    if (chatUi) chatUi.render();
    if (selected && !places().find((p) => p.id === selected)) selected = null;
    shell.setView(v);
    if (clockUi) clockUi.render();
    drawPins(); drawCard();
    if (PAGE.readOnly && v !== 'gm') shell.leavePreview();
  }
  document.getElementById('v-player').onclick = () => setView('player');
  document.getElementById('v-gm').onclick = () => {
    if (view === 'gm') return;
    const dlg = document.getElementById('gm-confirm');
    dlg.hidden = false;
    dlg.querySelector('[data-a=yes]').focus();
    dlg.querySelector('[data-a=yes]').onclick = () => { dlg.hidden = true; setView('gm'); };
    dlg.querySelector('[data-a=no]').onclick = () => { dlg.hidden = true; };
  };

  // ---- keeping in step with the store ----
  function reloadBoard(why) { toast(why + ' Reloading the board...'); setTimeout(() => location.reload(), 900); }
  function startSync() {
    store.watch('board/meta', (m) => {
      if (!m) return reloadBoard('The campaign was unloaded.');
      if (m.campaign.id !== META.campaign.id || m.loaded_at !== META.loaded_at) reloadBoard(`${m.campaign.title} is now on the table.`);
    });
    store.watch('state/table', (t) => {
      if (!t) return;
      TABLE = t;
      shell.travelChanged();
      if (PAGE.readOnly) return shell.previewBar();
      if (t.current_map && t.current_map !== map.id) reloadBoard('The table moved to another map.');
    });
    store.watch('mapstate/' + map.id, (d) => {
      const next = (d && d.places_found) || [];
      if (JSON.stringify(next) === JSON.stringify(found)) return;
      found = next; drawPins(); drawCard();
    });
    store.watch('state/request', (r) => { if (JSON.stringify(r || null) === JSON.stringify(request || null)) return; request = r; drawPins(); drawCard(); });
    store.watchCollection('tokens', (list) => {
      for (const k of Object.keys(tokensHere)) delete tokensHere[k];
      for (const e of list) if (e.data.map === map.id) { const { map: _m, ...t } = e.data; tokensHere[e.id] = t; }
    });
    chatUi = mountChat({ store, view: () => view, readOnly: PAGE.readOnly, sidebar, pane: sidebar.panel('chat').body,
      names: (id) => (tokensHere[id] ? (view === 'gm' ? tokensHere[id].name : publicName(tokensHere[id])) : null), colour: kindColour, kindOf: (id) => (tokensHere[id] ? tokensHere[id].kind : null) });
    auditUi = mountAudit({ store, view: () => view, readOnly: PAGE.readOnly, pane: sidebar.panel('audit').body });
    diceUi = mountDice({ store, view: () => view, readOnly: PAGE.readOnly, pane: sidebar.panel('dice').body, kinds: (Engine.systemConfig(META.ruleset) || {}).rollKinds || [] });
  }

  // ---- start ----
  window.reliquary = {
    store, meta: META, map: map.id, area: true,
    view: (v) => setView(v), select: (id) => select(id), places: () => places().map((p) => p.id),
    menu: () => shell.menu(), mapMenu: () => shell.mapMenu(), preview: () => (PAGE.readOnly ? map.id : null),
  };
  document.title = META.campaign.title + ' · Reliquary Virtual Tabletop';
  document.getElementById('campaign-title').textContent = META.campaign.title;
  document.getElementById('subtitle').textContent = `${META.pack.title} · area map`;
  shell.startMenu();
  const SYS = Engine.systemConfig(META.ruleset) || {};
  clockUi = await mountClock({
    store, T: { readClock: Engine.readClock, adventureDay: Engine.adventureDay, clockAt: Engine.clockAt, parseAmount: Engine.parseAmount, unitSeconds: Engine.unitSeconds, expireEffects: Engine.expireEffects }, cal: (SYS.time || {}).calendar, roundSeconds: (SYS.time || {}).roundSeconds || 6,
    getView: () => view, readOnly: PAGE.readOnly, toast, logChange, names: (id, t) => publicName(t) || t.name || id, applyLocal: () => [],
  });
  await shell.startMapMenu();
  if (PAGE.keepGM) setView('gm'); else { drawPins(); drawCard(); }
  fit();
  img.addEventListener('load', fit);
  shell.previewBar();
  startSync();
  shell.watchBuild();
}
