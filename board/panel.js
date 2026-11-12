// A sidebar tab's panel: it lives in its tab (docked) or pops out as a floating window, as Foundry's sidebar tabs
// do. Every tab has one (board/sidebar.js makes them). A floating window moves by its title, is resized from its
// corner, collapses to its title, and closes back into its tab; where it was, its size and how it was are
// remembered per browser. Docs: docs/best-practices/board.md (the sidebar).

const load = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null') || {}; } catch { return {}; } };
const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage off: not remembered */ } };
export const PANEL_SIZE = Object.freeze({ minW: 240, minH: 120, w: 340, h: 480 });
let front = 55;   // floating windows: the one last touched comes to the front

/**
 * o: {id, title, key (localStorage), dockInto (the tab's pane), showTab() (open that tab), onDock(docked)
 * (called when it pops out or comes back), offset (where a first pop-out goes, in steps)}. Returns {el, head,
 * body, foot, docked(), open(), popOut(), dockBack(), setNote(text)}.
 */
export function makePanel(o) {
  const pref = { docked: true, x: null, y: null, w: PANEL_SIZE.w, h: PANEL_SIZE.h, collapsed: false, ...load(o.key) };
  const el = document.createElement('section');
  el.id = o.id; el.className = 'bpanel'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', o.title); el.tabIndex = -1;
  el.innerHTML = `<div class="bp-h"><span class="bp-t"></span><span class="bp-n"></span>
    <button type="button" class="bp-b" data-p="dock"></button>
    <button type="button" class="bp-b" data-p="collapse"></button>
    <button type="button" class="bp-b" data-p="close" aria-label="Back into the sidebar" title="Back into the sidebar">✕</button></div>
    <div class="bp-body"></div><div class="bp-foot"></div>`;
  const head = el.querySelector('.bp-h'), body = el.querySelector('.bp-body'), foot = el.querySelector('.bp-foot');
  el.querySelector('.bp-t').textContent = o.title;
  const step = (o.offset || 0) * 28;
  let sizing = false;
  const place = () => {
    el.classList.toggle('docked', pref.docked); el.classList.toggle('floating', !pref.docked); el.classList.toggle('collapsed', !pref.docked && pref.collapsed);
    const dock = el.querySelector('[data-p=dock]'), col = el.querySelector('[data-p=collapse]'), close = el.querySelector('[data-p=close]');
    dock.textContent = pref.docked ? '⇱' : '⇥';
    dock.title = pref.docked ? 'Pop out as a window' : 'Back into the sidebar';
    dock.setAttribute('aria-label', `${dock.title}: ${o.title}`);
    col.hidden = close.hidden = pref.docked;
    col.textContent = pref.collapsed ? '▸' : '▾';
    col.title = pref.collapsed ? 'Expand' : 'Collapse';
    col.setAttribute('aria-label', col.title); col.setAttribute('aria-expanded', String(!pref.collapsed));
    sizing = true;
    if (pref.docked) {
      el.style.left = el.style.top = el.style.width = el.style.height = el.style.zIndex = '';
      if (el.parentNode !== o.dockInto) o.dockInto.prepend(el);
    } else {
      if (el.parentNode !== document.body) { document.body.appendChild(el); el.style.zIndex = String(++front); }
      const w = Math.max(PANEL_SIZE.minW, Math.min(window.innerWidth - 16, pref.w)), h = Math.max(PANEL_SIZE.minH, Math.min(window.innerHeight - 16, pref.h));
      el.style.width = `${w}px`;
      el.style.height = pref.collapsed ? '' : `${h}px`;
      el.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, pref.x ?? 24 + step))}px`;
      el.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, pref.y ?? 140 + step))}px`;
    }
    requestAnimationFrame(() => { sizing = false; });
  };
  const set = (docked) => {
    if (pref.docked === docked) return;
    pref.docked = docked; save(o.key, pref); place();
    if (docked && o.showTab) o.showTab();
    if (o.onDock) o.onDock(docked);
  };
  head.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    e.stopPropagation();
    if (b.dataset.p === 'dock') return set(!pref.docked);
    if (b.dataset.p === 'close') return set(true);
    if (b.dataset.p === 'collapse') { pref.collapsed = !pref.collapsed; save(o.key, pref); place(); }
  });
  // a floating window moves by its title ...
  head.addEventListener('pointerdown', (e) => {
    if (pref.docked || e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const mv = (ev) => { pref.x = Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - dx)); pref.y = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy)); el.style.left = `${pref.x}px`; el.style.top = `${pref.y}px`; };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); save(o.key, pref); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
  // ... and is resized from its corner (CSS resize); its size is remembered
  if (typeof ResizeObserver !== 'undefined') {
    let t = null;
    new ResizeObserver(() => {
      if (pref.docked || pref.collapsed || sizing) return;
      clearTimeout(t);
      t = setTimeout(() => { pref.w = Math.round(el.offsetWidth); pref.h = Math.round(el.offsetHeight); save(o.key, pref); }, 200);
    }).observe(el);
  }
  el.addEventListener('pointerdown', () => { if (!pref.docked) el.style.zIndex = String(++front); }, true);
  for (const ev of ['click', 'dblclick', 'wheel', 'contextmenu', 'keydown']) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev === 'wheel' });
  place();
  return {
    el, head, body, foot,
    docked: () => pref.docked,
    /** Bring it into view: its tab (docked) or itself (floating, expanded). */
    open() { if (pref.docked) { if (o.showTab) o.showTab(); } else if (pref.collapsed) { pref.collapsed = false; save(o.key, pref); place(); } },
    popOut: () => set(false),
    dockBack: () => set(true),
    setNote(text) { el.querySelector('.bp-n').textContent = text || ''; },
  };
}
