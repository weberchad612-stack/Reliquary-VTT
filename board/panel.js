// A board panel that lives in a sidebar tab (docked) or pops out as a floating window you drag by its title, as
// Foundry's sidebar tabs do: the encounter tracker. Floating, it collapses to its title and closes back into its
// tab. How it was is remembered per browser. Docs: docs/best-practices/board.md (the sidebar).

const load = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null') || {}; } catch { return {}; } };
const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage off: not remembered */ } };

/**
 * o: {id, title, key (localStorage), dockInto (the tab's pane), showTab() (open that tab)}. Returns {el, head, body,
 * foot, isOpen(), open(), docked(), setNote(text)}.
 */
export function makePanel(o) {
  const pref = { docked: true, x: null, y: null, collapsed: false, ...load(o.key) };
  const el = document.createElement('section');
  el.id = o.id; el.className = 'bpanel'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', o.title); el.tabIndex = -1;
  el.innerHTML = `<div class="bp-h"><span class="bp-t"></span><span class="bp-n"></span>
    <button type="button" class="bp-b" data-p="dock"></button>
    <button type="button" class="bp-b" data-p="collapse"></button>
    <button type="button" class="bp-b" data-p="close" aria-label="Back into the sidebar" title="Back into the sidebar">✕</button></div>
    <div class="bp-body"></div><div class="bp-foot"></div>`;
  const head = el.querySelector('.bp-h'), body = el.querySelector('.bp-body'), foot = el.querySelector('.bp-foot');
  el.querySelector('.bp-t').textContent = o.title;
  const place = () => {
    el.classList.toggle('docked', pref.docked); el.classList.toggle('floating', !pref.docked); el.classList.toggle('collapsed', !pref.docked && pref.collapsed);
    const dock = el.querySelector('[data-p=dock]'), col = el.querySelector('[data-p=collapse]'), close = el.querySelector('[data-p=close]');
    dock.textContent = pref.docked ? '⇱' : '⇥';
    dock.title = pref.docked ? 'Pop out as a window' : 'Back into the sidebar';
    dock.setAttribute('aria-label', dock.title);
    col.hidden = close.hidden = pref.docked;
    col.textContent = pref.collapsed ? '▸' : '▾';
    col.title = pref.collapsed ? 'Expand' : 'Collapse';
    col.setAttribute('aria-label', col.title); col.setAttribute('aria-expanded', String(!pref.collapsed));
    if (pref.docked) {
      el.style.left = el.style.top = '';
      if (el.parentNode !== o.dockInto) o.dockInto.prepend(el);
    } else {
      if (el.parentNode !== document.body) document.body.appendChild(el);
      el.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, pref.x ?? 24))}px`;
      el.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, pref.y ?? 140))}px`;
    }
  };
  head.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    e.stopPropagation();
    if (b.dataset.p === 'dock' || b.dataset.p === 'close') { pref.docked = !pref.docked || b.dataset.p === 'close'; if (pref.docked && o.showTab) o.showTab(); }
    if (b.dataset.p === 'collapse') pref.collapsed = !pref.collapsed;
    save(o.key, pref); place();
  });
  // a floating panel moves by its title
  head.addEventListener('pointerdown', (e) => {
    if (pref.docked || e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const mv = (ev) => { pref.x = Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - dx)); pref.y = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy)); el.style.left = `${pref.x}px`; el.style.top = `${pref.y}px`; };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); save(o.key, pref); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
  for (const ev of ['click', 'dblclick', 'wheel', 'contextmenu', 'keydown']) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev === 'wheel' });
  place();
  return {
    el, head, body, foot,
    docked: () => pref.docked,
    /** Bring it into view: its tab (docked) or itself (floating, expanded). */
    open() { if (pref.docked) { if (o.showTab) o.showTab(); } else if (pref.collapsed) { pref.collapsed = false; save(o.key, pref); place(); } },
    setNote(text) { el.querySelector('.bp-n').textContent = text || ''; },
  };
}
