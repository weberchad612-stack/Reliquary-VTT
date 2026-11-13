// The sidebar (as Foundry's, v13): a strip of tab icons down the right-hand panel's inner edge and the open tab's
// pane beside it. Clicking the open tab's icon, or the collapse control, collapses the sidebar to its strip (the
// map takes the room); dragging the inner edge resizes it. The width, the open tab and whether it is collapsed
// are remembered per browser. Tabs marked gm show in the GM view only. Docs: docs/design/board.md (the sidebar
// and chat), docs/best-practices/board.md (the sidebar).
//
// Every tab's content sits in a panel (board/panel.js) that pops out as a floating, resizable window (the user's
// standard, 2026-11-12); while it is out, its tab shows a note and a button to bring it back.

const ICONS = {
  chat: '<path d="M4 5h16v10H9l-5 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 9h8M8 12h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  encounter: '<path d="M4 3l9.5 9.5M3 4l9.5 9.5M20 3l-9.5 9.5M21 4l-9.5 9.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6.5 15.5l-3 3M4 17l3 3M17.5 15.5l3 3M20 17l-3 3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  lighting: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.7.5 1 1.2 1 2V16h5v-.1c0-.8.3-1.5 1-2A6 6 0 0 0 12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  dice: '<path d="M12 2.5 20.5 7.5v9L12 21.5 3.5 16.5v-9z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M12 7.5 16.5 15h-9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  audit: '<rect x="5" y="4" width="14" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 4V2.5h6V4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8.5 10h7M8.5 14h7M8.5 18h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  walls: '<path d="M3 5h18v14H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6M9 14.3V19M15 14.3V19" stroke="currentColor" stroke-width="1.6"/>',
  place: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9.5" r="2.5" fill="currentColor"/>',
  collapse: '<path d="M14 6l6 6-6 6M4 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  expand: '<path d="M10 6l-6 6 6 6M20 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
};
import { makePanel } from './panel.js';

const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const load = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null') || {}; } catch { return {}; } };
const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage off: not remembered */ } };
export const SIDEBAR_WIDTH = Object.freeze({ min: 260, max: 720, initial: 340 });

/**
 * root: the sidebar element (holding .sb-strip and .sb-pane[data-pane=<id>] for each tab). tabs: [{id, label,
 * icon?, gm?}] in order. view() -> 'gm' | 'player'. Returns {select(id), current(), showing(id), setBadge(id, n),
 * refresh(), onShow(id, fn), collapsed(), panel(id)}. showing(id) is true while a tab is open in the sidebar or
 * popped out.
 */
export function mountSidebar({ root, tabs, view = () => 'player', key = 'reliquary.sidebar' }) {
  const pref = { tab: tabs[0] && tabs[0].id, collapsed: false, width: SIDEBAR_WIDTH.initial, ...load(key) };
  const strip = root.querySelector('.sb-strip'), handle = root.querySelector('.sb-resize');
  const shows = new Map(), badges = new Map();
  const allowed = (t) => !t.gm || view() === 'gm';
  strip.innerHTML = tabs.map((t) => `<button type="button" class="sb-tab" role="tab" data-tab="${t.id}" title="${t.label}" aria-label="${t.label}">${svg(t.icon || t.id)}<span class="sb-badge" hidden></span></button>`).join('')
    + '<span class="sb-gap"></span><button type="button" class="sb-tab sb-fold" data-fold="1"></button>';
  const fold = strip.querySelector('[data-fold]');
  // each tab's content goes into its panel, which can pop out
  const panels = new Map();
  tabs.forEach((t, i) => {
    const pane = root.querySelector(`.sb-pane[data-pane="${t.id}"]`);
    if (!pane) return;
    const kids = [...pane.childNodes];
    const p = makePanel({ id: `panel-${t.id}`, title: t.label, key: `${key}.${t.id}`, dockInto: pane, offset: i, showTab: () => select(t.id), onDock: () => { apply(); if (api.showing(t.id)) for (const fn of shows.get(t.id) || []) fn(); } });
    for (const k of kids) p.body.appendChild(k);
    const note = document.createElement('div');
    note.className = 'sb-popped';
    note.innerHTML = `<p>${t.label} is popped out as a window.</p><button type="button">Bring it back</button>`;
    note.querySelector('button').addEventListener('click', () => p.dockBack());
    pane.appendChild(note);
    panels.set(t.id, { panel: p, note });
  });
  const resized = () => window.dispatchEvent(new Event('resize'));
  function apply() {
    if (!tabs.some((t) => t.id === pref.tab && allowed(t))) pref.tab = (tabs.find(allowed) || {}).id;
    root.classList.toggle('collapsed', !!pref.collapsed);
    root.style.setProperty('--sbw', `${Math.max(SIDEBAR_WIDTH.min, Math.min(SIDEBAR_WIDTH.max, pref.width))}px`);
    for (const t of tabs) {
      const b = strip.querySelector(`[data-tab="${t.id}"]`), pane = root.querySelector(`.sb-pane[data-pane="${t.id}"]`);
      const on = t.id === pref.tab;
      b.hidden = !allowed(t);
      b.classList.toggle('on', on && !pref.collapsed);
      b.setAttribute('aria-selected', String(on));
      if (pane) pane.hidden = !on || pref.collapsed;
      const P = panels.get(t.id);
      if (P) { P.note.hidden = P.panel.docked(); P.panel.el.hidden = !allowed(t); }
    }
    fold.innerHTML = svg(pref.collapsed ? 'expand' : 'collapse');
    fold.title = pref.collapsed ? 'Expand the sidebar' : 'Collapse the sidebar';
    fold.setAttribute('aria-label', fold.title); fold.setAttribute('aria-expanded', String(!pref.collapsed));
  }
  function select(id, { toggle = false } = {}) {
    const was = { tab: pref.tab, collapsed: pref.collapsed };
    if (toggle && id === pref.tab && !pref.collapsed) pref.collapsed = true;   // Foundry: the open tab's icon collapses
    else { pref.tab = id; pref.collapsed = false; }
    save(key, pref); apply();
    if (was.collapsed !== pref.collapsed) resized();
    if (api.showing(pref.tab)) { badges.set(pref.tab, 0); paintBadge(pref.tab); for (const fn of shows.get(pref.tab) || []) fn(); }
  }
  function paintBadge(id) {
    const b = strip.querySelector(`[data-tab="${id}"] .sb-badge`), n = badges.get(id) || 0;
    if (!b) return;
    b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n);
  }
  strip.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.fold) { pref.collapsed = !pref.collapsed; save(key, pref); apply(); resized(); if (!pref.collapsed) select(pref.tab); return; }
    select(b.dataset.tab, { toggle: true });
  });
  strip.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const list = [...strip.querySelectorAll('button:not([hidden])')], i = list.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus();
  });
  // the inner edge resizes it
  if (handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || pref.collapsed) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      root.classList.add('resizing');
      const mv = (ev) => { pref.width = Math.round(window.innerWidth - ev.clientX); apply(); };
      const up = () => { handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); root.classList.remove('resizing'); save(key, pref); resized(); };
      handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up);
    });
    handle.addEventListener('dblclick', () => { pref.width = SIDEBAR_WIDTH.initial; save(key, pref); apply(); resized(); });
  }
  apply();
  resized();   // a sidebar restored collapsed or at another width changes the map's room after the page fitted it
  const api = {
    select: (id) => select(id),
    current: () => pref.tab,
    collapsed: () => !!pref.collapsed,
    showing: (id) => (!pref.collapsed && pref.tab === id) || !!(panels.get(id) && !panels.get(id).panel.docked()),
    panel: (id) => (panels.get(id) || {}).panel || null,
    setBadge(id, n) { badges.set(id, n); paintBadge(id); },
    badge: (id) => badges.get(id) || 0,
    refresh() { apply(); },
    onShow(id, fn) { if (!shows.has(id)) shows.set(id, []); shows.get(id).push(fn); },
  };
  return api;
}
