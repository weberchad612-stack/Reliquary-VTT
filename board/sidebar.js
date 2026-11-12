// The sidebar (as Foundry's, v13): a strip of tab icons down the right-hand panel's inner edge and the open tab's
// pane beside it. Clicking the open tab's icon, or the collapse control, collapses the sidebar to its strip (the
// map takes the room); dragging the inner edge resizes it. The width, the open tab and whether it is collapsed
// are remembered per browser. Tabs marked gm show in the GM view only. Docs: docs/design/board.md (the sidebar
// and chat), docs/best-practices/board.md (the sidebar).

const ICONS = {
  chat: '<path d="M4 5h16v10H9l-5 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 9h8M8 12h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  encounter: '<path d="M4 3l9.5 9.5M3 4l9.5 9.5M20 3l-9.5 9.5M21 4l-9.5 9.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6.5 15.5l-3 3M4 17l3 3M17.5 15.5l3 3M20 17l-3 3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  lighting: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.7.5 1 1.2 1 2V16h5v-.1c0-.8.3-1.5 1-2A6 6 0 0 0 12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  changes: '<path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 4v5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  tablelog: '<path d="M8 6h12M8 12h12M8 18h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="4" cy="6" r="1.4" fill="currentColor"/><circle cx="4" cy="12" r="1.4" fill="currentColor"/><circle cx="4" cy="18" r="1.4" fill="currentColor"/>',
  place: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9.5" r="2.5" fill="currentColor"/>',
  collapse: '<path d="M14 6l6 6-6 6M4 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  expand: '<path d="M10 6l-6 6 6 6M20 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const load = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null') || {}; } catch { return {}; } };
const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage off: not remembered */ } };
export const SIDEBAR_WIDTH = Object.freeze({ min: 260, max: 720, initial: 340 });

/**
 * root: the sidebar element (holding .sb-strip and .sb-pane[data-pane=<id>] for each tab). tabs: [{id, label,
 * icon?, gm?}] in order. view() -> 'gm' | 'player'. Returns {select(id), current(), showing(id), setBadge(id, n),
 * refresh(), onShow(id, fn), collapsed()}.
 */
export function mountSidebar({ root, tabs, view = () => 'player', key = 'reliquary.sidebar' }) {
  const pref = { tab: tabs[0] && tabs[0].id, collapsed: false, width: SIDEBAR_WIDTH.initial, ...load(key) };
  const strip = root.querySelector('.sb-strip'), handle = root.querySelector('.sb-resize');
  const shows = new Map(), badges = new Map();
  const allowed = (t) => !t.gm || view() === 'gm';
  strip.innerHTML = tabs.map((t) => `<button type="button" class="sb-tab" role="tab" data-tab="${t.id}" title="${t.label}" aria-label="${t.label}">${svg(t.icon || t.id)}<span class="sb-badge" hidden></span></button>`).join('')
    + '<span class="sb-gap"></span><button type="button" class="sb-tab sb-fold" data-fold="1"></button>';
  const fold = strip.querySelector('[data-fold]');
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
  const api = {
    select: (id) => select(id),
    current: () => pref.tab,
    collapsed: () => !!pref.collapsed,
    showing: (id) => !pref.collapsed && pref.tab === id,
    setBadge(id, n) { badges.set(id, n); paintBadge(id); },
    badge: (id) => badges.get(id) || 0,
    refresh() { apply(); },
    onShow(id, fn) { if (!shows.has(id)) shows.set(id, []); shows.get(id).push(fn); },
  };
  return api;
}
