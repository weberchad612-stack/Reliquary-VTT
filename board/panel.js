// A board panel that is either docked (at the top of the side panel, as Foundry's sidebar) or floating (a window
// you drag by its title), collapsible, and closable: the encounter tracker and the roll log. Where it was and how
// it was are remembered per browser. Docs: docs/best-practices/board.md (the encounter tracker).

const load = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null') || {}; } catch { return {}; } };
const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage off: not remembered */ } };

/**
 * o: {id, title, key (localStorage), docked (default), dockInto (the element docked panels go into, first),
 * onClose?}. Returns {el, head, body, foot, isOpen(), open(), close(), toggle(), setTitle(text), setNote(text)}.
 */
export function makePanel(o) {
  const pref = { open: false, docked: o.docked !== false, x: null, y: null, collapsed: false, ...load(o.key) };
  const el = document.createElement('section');
  el.id = o.id; el.className = 'bpanel'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', o.title); el.tabIndex = -1;
  el.innerHTML = `<div class="bp-h"><span class="bp-t"></span><span class="bp-n"></span>
    <button type="button" class="bp-b" data-p="dock"></button>
    <button type="button" class="bp-b" data-p="collapse"></button>
    <button type="button" class="bp-b" data-p="close" aria-label="Close ${o.title}" title="Close">✕</button></div>
    <div class="bp-body"></div><div class="bp-foot"></div>`;
  const head = el.querySelector('.bp-h'), body = el.querySelector('.bp-body'), foot = el.querySelector('.bp-foot');
  el.querySelector('.bp-t').textContent = o.title;
  const place = () => {
    el.classList.toggle('docked', pref.docked); el.classList.toggle('floating', !pref.docked); el.classList.toggle('collapsed', pref.collapsed);
    const dock = el.querySelector('[data-p=dock]'), col = el.querySelector('[data-p=collapse]');
    dock.textContent = pref.docked ? '⇱' : '⇥';
    dock.title = pref.docked ? 'Float as a window' : 'Dock in the side panel';
    dock.setAttribute('aria-label', dock.title);
    col.textContent = pref.collapsed ? '▸' : '▾';
    col.title = pref.collapsed ? 'Expand' : 'Collapse';
    col.setAttribute('aria-label', col.title); col.setAttribute('aria-expanded', String(!pref.collapsed));
    if (pref.docked) {
      el.style.left = el.style.top = '';
      if (el.parentNode !== o.dockInto) o.dockInto.prepend(el);
    } else {
      if (el.parentNode !== document.body) document.body.appendChild(el);
      const w = el.offsetWidth || 320;
      el.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, pref.x ?? window.innerWidth - w - 360))}px`;
      el.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, pref.y ?? 110))}px`;
    }
    el.hidden = !pref.open;
  };
  head.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    e.stopPropagation();
    if (b.dataset.p === 'dock') pref.docked = !pref.docked;
    if (b.dataset.p === 'collapse') pref.collapsed = !pref.collapsed;
    if (b.dataset.p === 'close') { pref.open = false; if (o.onClose) o.onClose(); }
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
  const api = {
    el, head, body, foot,
    isOpen: () => pref.open,
    open() { if (!pref.open) { pref.open = true; save(o.key, pref); place(); } },
    close() { if (pref.open) { pref.open = false; save(o.key, pref); place(); } },
    toggle() { pref.open = !pref.open; save(o.key, pref); place(); },
    setNote(text) { el.querySelector('.bp-n').textContent = text || ''; },
  };
  return api;
}
