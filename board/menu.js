// The board's top menu: a menubar of drop-down menus, each holding commands, toggles and one level of
// sub-menu (docs/design/board.md, section 7). Modelled on the previous board's top bar (Map / Play /
// Records, with Replay and Narration beside them, and the map name as a menu of maps) and on Foundry's
// menus: click to open, hover moves between menus once one is open, one menu open at a time, a menu
// shows as active while one of its toggles is on, and a dot when something inside is waiting.
//
// The menu only reports what was chosen (onSelect(id, item)); what an item does is wired in app.js.
// The definition, the view filter and the keyboard rules are plain functions, so they are tested without
// a page; buildMenuBar() is the only part that touches the DOM.
//
// Keyboard (the WAI-ARIA menubar pattern): Left/Right move along the bar (and between open menus),
// Down/Enter/Space open a menu, Up/Down/Home/End move inside it, Right opens a sub-menu and Left closes
// it, Escape closes one level and returns focus, Tab closes everything.

/**
 * The menu definition. An entry is one of:
 *   {id, label, items: [...]}        a menu (on the bar) or a sub-menu (inside a menu)
 *   {id, label, kind: 'command'}     does something once
 *   {id, label, kind: 'toggle'}      on or off (aria-checked); its menu shows as active while it is on
 *   {id, label, kind: 'radio', checked}  one of a set (the maps); `checked` marks the current one
 *   {id, label, kind: 'button'}      on the bar only: a command or panel opened straight from the bar
 *   {sep: true}                      a separator line
 * Optional on any entry: hint (tooltip), gm: true (GM view only), key (shortcut shown, not bound here),
 * badge: true (can show a count, set with setBadge).
 */
export const MENU = [
  { id: 'menu-map', label: 'Map', items: [
    { id: 'measure', label: 'Measure', kind: 'toggle', hint: 'Measure distance on the grid' },
    { id: 'add-note', label: 'Add note', kind: 'toggle', key: 'N', hint: 'Click the map to drop a note' },
    { id: 'walls', label: 'Show walls', kind: 'toggle', hint: 'Show the walls and doors the engine uses' },
    { id: 'turn-view', label: 'Turn view', kind: 'toggle', hint: 'Show what the creature whose turn it is can see' },
    { sep: true },
    { id: 'reload', label: 'Reload the board', kind: 'command' },
  ] },
  { id: 'menu-play', label: 'Play', items: [
    { id: 'actions', label: 'Actions', kind: 'command', hint: 'The selected creature\'s actions' },
    { id: 'exploration', label: 'Exploration', kind: 'command', hint: 'Exploration activities' },
    { id: 'templates', label: 'Templates', items: [
      { id: 'tpl-burst', label: 'Burst', kind: 'command' },
      { id: 'tpl-cone', label: 'Cone', kind: 'command' },
      { id: 'tpl-line', label: 'Line', kind: 'command' },
      { id: 'tpl-emanation', label: 'Emanation', kind: 'command' },
      { sep: true },
      { id: 'tpl-clear', label: 'Clear templates', kind: 'command' },
    ] },
  ] },
  { id: 'menu-records', label: 'Records', items: [
    { id: 'loot', label: 'Party loot', kind: 'command' },
    { id: 'quests', label: 'Quest log', kind: 'command' },
    { id: 'dice', label: 'Dice', kind: 'command' },
  ] },
  { id: 'replay', label: 'Replay', kind: 'button', badge: true, hint: 'Step through a batch of resolved actions' },
  { id: 'narration', label: 'Narration', kind: 'button', badge: true, hint: 'The story so far' },
];

/**
 * The definition with a Maps menu first: one entry per map of the campaign, the current map checked
 * (the previous board's map-name menu). `maps` is [{id, name}].
 */
export function withMaps(def, maps, current) {
  if (!maps || maps.length < 2) return def;
  const items = maps.map((m) => ({ id: 'map:' + m.id, label: m.name || m.id, kind: 'radio', checked: m.id === current }));
  return [{ id: 'menu-maps', label: 'Maps', items }, ...def];
}

const isMenu = (e) => Array.isArray(e && e.items);
const isItem = (e) => e && !e.sep;

/** The definition as one view sees it: GM-only entries removed for players, empty menus and stray separators dropped. */
export function menuForView(def, view) {
  const walk = (list) => {
    const out = [];
    for (const e of list) {
      if (e.gm && view !== 'gm') continue;
      if (isMenu(e)) {
        const items = walk(e.items);
        if (items.some(isItem)) out.push({ ...e, items });
      } else out.push(e);
    }
    // No separator first, last or twice in a row.
    return out.filter((e, i, a) => !e.sep || (i > 0 && i < a.length - 1 && !a[i - 1].sep));
  };
  return walk(def);
}

/** Every entry by id (menus, sub-menus and items), to find what was chosen. Throws on a repeated id. */
export function menuIndex(def) {
  const out = new Map();
  const walk = (list, parent) => {
    for (const e of list) {
      if (e.sep) continue;
      if (out.has(e.id)) throw new Error(`menu: id "${e.id}" is used twice`);
      out.set(e.id, { entry: e, parent });
      if (isMenu(e)) walk(e.items, e.id);
    }
  };
  walk(def, null);
  return out;
}

/** Ids of the menus (and sub-menus) that hold a toggle which is on: those show as active. */
export function activeMenus(def, on) {
  const out = new Set();
  const walk = (list) => {
    let any = false;
    for (const e of list) {
      if (isMenu(e)) { if (walk(e.items)) { out.add(e.id); any = true; } }
      else if (e.kind === 'toggle' && on.has(e.id)) any = true;
    }
    return any;
  };
  walk(def);
  return out;
}

/**
 * Where focus goes for a key inside a list of `count` items (separators already skipped): the new index,
 * or null when the key does not move within the list. Wraps at both ends.
 */
export function moveIndex(key, index, count) {
  if (!count) return null;
  if (key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowUp') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/**
 * Build the menubar into `root` (an empty <nav>). Options:
 *   view       'player' or 'gm' (GM-only entries hidden for players; change with setView)
 *   onSelect   (id, item, state) => void, called for every command, toggle and bar button chosen;
 *              state is the toggle's new value (true/false) or undefined
 *   def        the definition (default MENU)
 * Returns {setView, setToggle, setBadge, setPending, close, isOpen, destroy}.
 */
export function buildMenuBar(root, { view = 'player', onSelect = () => {}, def = MENU } = {}) {
  const doc = root.ownerDocument;
  const on = new Set();          // toggles that are on
  const badges = new Map();      // id -> count
  const pending = new Set();     // menu ids showing a waiting dot
  let current = [];              // the definition for the view
  let openMenu = null;           // the open top-level menu's bar button
  let openSub = null;            // the open sub-menu's item
  let listeners = [];
  menuIndex(def);                // repeated ids fail loudly at start-up

  const el = (tag, props = {}, kids = []) => {
    const n = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids) n.appendChild(c);
    return n;
  };
  /** A pop-up's own items, in order (a sub-menu's item sits inside its wrapper; separators are skipped). */
  const items = (pop) => [...pop.children]
    .map((c) => (c.classList.contains('mi-sub') ? c.firstElementChild : c))
    .filter((c) => c.matches('[role^=menuitem]'));
  const barButtons = () => [...root.querySelectorAll(':scope > .mb-item > [role=menuitem]')];
  const popupOf = (btn) => btn && doc.getElementById(btn.getAttribute('aria-controls'));

  function renderItem(e) {
    if (e.sep) return el('div', { class: 'mi-sep', role: 'separator' });
    const label = el('span', { class: 'mi-label', text: e.label });
    const kids = [el('span', { class: 'mi-check', 'aria-hidden': 'true' }), label];
    if (e.key) kids.push(el('kbd', { class: 'mi-key', text: e.key }));
    if (isMenu(e)) {
      kids.push(el('span', { class: 'mi-arrow', 'aria-hidden': 'true', text: '›' }));
      const wrap = el('div', { class: 'mi-sub' });
      const btn = el('button', { type: 'button', class: 'mi', role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'menu-pop-' + e.id, 'data-id': e.id, title: e.hint, tabindex: '-1' }, kids);
      const pop = el('div', { class: 'menu-pop sub', role: 'menu', id: 'menu-pop-' + e.id, 'aria-label': e.label, hidden: true }, e.items.map(renderItem));
      wrap.append(btn, pop);
      return wrap;
    }
    const role = e.kind === 'toggle' ? 'menuitemcheckbox' : e.kind === 'radio' ? 'menuitemradio' : 'menuitem';
    const checked = e.kind === 'toggle' ? String(on.has(e.id)) : e.kind === 'radio' ? String(!!e.checked) : null;
    return el('button', { type: 'button', class: 'mi', role, 'aria-checked': checked, 'data-id': e.id, title: e.hint, tabindex: '-1' }, kids);
  }

  function render() {
    root.textContent = '';
    root.setAttribute('role', 'menubar');
    current = menuForView(def, view);
    current.forEach((e, i) => {
      const li = el('div', { class: 'mb-item' });
      const kids = [el('span', { class: 'mb-label', text: e.label })];
      if (e.badge) kids.push(el('span', { class: 'mb-badge', 'data-badge': e.id, hidden: true }));
      if (isMenu(e)) {
        kids.push(el('span', { class: 'mb-caret', 'aria-hidden': 'true', text: '▾' }));
        const btn = el('button', { type: 'button', class: 'mb-btn', role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'menu-pop-' + e.id, 'data-id': e.id, tabindex: i ? '-1' : '0', title: e.hint }, kids);
        const pop = el('div', { class: 'menu-pop', role: 'menu', id: 'menu-pop-' + e.id, 'aria-label': e.label, hidden: true }, e.items.map(renderItem));
        li.append(btn, pop);
      } else {
        li.append(el('button', { type: 'button', class: 'mb-btn', role: 'menuitem', 'data-id': e.id, tabindex: i ? '-1' : '0', title: e.hint }, kids));
      }
      root.appendChild(li);
    });
    refresh();
  }

  /** Active menus, checked toggles, badges and waiting dots, from the current state. */
  function refresh() {
    const act = activeMenus(current, on);
    root.querySelectorAll('[data-id]').forEach((n) => {
      const id = n.dataset.id;
      if (n.getAttribute('aria-haspopup')) n.classList.toggle('active', act.has(id));
      if (n.getAttribute('role') === 'menuitemcheckbox') n.setAttribute('aria-checked', String(on.has(id)));
      n.classList.toggle('pending', pending.has(id));
    });
    root.querySelectorAll('[data-badge]').forEach((b) => {
      const n = badges.get(b.dataset.badge) || 0;
      b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n);
    });
  }

  function closeSub() {
    if (!openSub) return;
    openSub.setAttribute('aria-expanded', 'false');
    popupOf(openSub).hidden = true;
    openSub = null;
  }
  function close(focusBar = false) {
    closeSub();
    if (!openMenu) return;
    const btn = openMenu;
    btn.setAttribute('aria-expanded', 'false');
    popupOf(btn).hidden = true;
    openMenu = null;
    if (focusBar) btn.focus();
  }
  function open(btn, focus = 'first') {
    if (openMenu === btn) return;
    close();
    openMenu = btn;
    btn.setAttribute('aria-expanded', 'true');
    const pop = popupOf(btn);
    pop.hidden = false;
    keepOnScreen(pop);
    if (focus) focusIn(pop, focus);
  }
  function openSubmenu(item, focus = 'first') {
    if (openSub === item) { if (focus) focusIn(popupOf(item), focus); return; }
    closeSub();
    openSub = item;
    item.setAttribute('aria-expanded', 'true');
    const pop = popupOf(item);
    pop.hidden = false;
    keepOnScreen(pop, true);
    if (focus) focusIn(pop, focus);
  }
  function focusIn(pop, which) {
    const list = items(pop);
    if (!list.length) return;
    (which === 'last' ? list[list.length - 1] : list[0]).focus();
  }
  /** Flip a pop-up that would leave the window: a menu to the left edge, a sub-menu to the other side. */
  function keepOnScreen(pop, sub = false) {
    pop.classList.remove('flip');
    const win = doc.defaultView;
    const r = pop.getBoundingClientRect();
    if (r.right > win.innerWidth - 4) pop.classList.add('flip');
    if (sub && pop.classList.contains('flip') && pop.getBoundingClientRect().left < 4) pop.classList.remove('flip');
  }
  function setBarFocus(btn) {
    barButtons().forEach((b) => b.setAttribute('tabindex', b === btn ? '0' : '-1'));
    btn.focus();
  }

  function choose(item) {
    const id = item.dataset.id;
    const entry = menuIndex(def).get(id)?.entry;
    if (!entry) return;
    let state;
    if (entry.kind === 'toggle') { state = !on.has(id); if (state) on.add(id); else on.delete(id); refresh(); }
    close(true);
    onSelect(id, entry, state);
  }

  // ---- pointer ----
  const onClick = (ev) => {
    const btn = ev.target.closest('[role^=menuitem]');
    if (!btn || !root.contains(btn)) return;
    ev.stopPropagation();
    if (btn.classList.contains('mb-btn')) {
      if (btn.getAttribute('aria-haspopup')) {
        if (openMenu === btn) close(); else open(btn, ev.detail === 0 ? 'first' : null);
      } else { close(); onSelect(btn.dataset.id, menuIndex(def).get(btn.dataset.id).entry, undefined); }
      return;
    }
    if (btn.getAttribute('aria-haspopup')) { openSubmenu(btn, ev.detail === 0 ? 'first' : null); return; }
    choose(btn);
  };
  const onOver = (ev) => {
    const btn = ev.target.closest('[role^=menuitem]');
    if (!btn || !root.contains(btn)) return;
    // Once a menu is open, pointing at another menu on the bar opens that one (as in a desktop menubar).
    if (btn.classList.contains('mb-btn')) { if (openMenu && openMenu !== btn) { if (btn.getAttribute('aria-haspopup')) open(btn, null); else close(); } return; }
    // Inside a menu: pointing at a sub-menu's item opens it; pointing at a sibling item closes it.
    const pop = btn.closest('.menu-pop');
    if (btn.getAttribute('aria-haspopup')) openSubmenu(btn, null);
    else if (openSub && !popupOf(openSub).contains(btn) && pop && !pop.classList.contains('sub')) closeSub();
  };
  const onDocDown = (ev) => { if (openMenu && !root.contains(ev.target)) close(); };
  const onDocKey = (ev) => { if (ev.key === 'Escape' && openMenu && !root.contains(doc.activeElement)) close(); };

  // ---- keyboard ----
  const onKey = (ev) => {
    const t = ev.target.closest('[role^=menuitem]');
    if (!t) return;
    const bar = barButtons();
    const onBar = t.classList.contains('mb-btn');
    const stepBar = (dir) => {
      const from = onBar ? t : openMenu || bar[0];
      const next = bar[(bar.indexOf(from) + dir + bar.length) % bar.length];
      const wasOpen = !!openMenu;
      close();
      setBarFocus(next);
      if (wasOpen && next.getAttribute('aria-haspopup')) open(next, 'first');
    };
    let done = true;
    if (onBar) {
      if (ev.key === 'ArrowRight') stepBar(1);
      else if (ev.key === 'ArrowLeft') stepBar(-1);
      else if (ev.key === 'Home') { close(); setBarFocus(bar[0]); }
      else if (ev.key === 'End') { close(); setBarFocus(bar[bar.length - 1]); }
      else if (t.getAttribute('aria-haspopup') && ['ArrowDown', 'Enter', ' '].includes(ev.key)) open(t, 'first');
      else if (t.getAttribute('aria-haspopup') && ev.key === 'ArrowUp') open(t, 'last');
      else if (ev.key === 'Escape') close(true);
      else done = false;
    } else {
      const pop = t.closest('.menu-pop');
      const list = items(pop);
      const i = moveIndex(ev.key, list.indexOf(t), list.length);
      if (i !== null) list[i].focus();
      else if (ev.key === 'ArrowRight' && t.getAttribute('aria-haspopup')) openSubmenu(t, 'first');
      else if (ev.key === 'ArrowLeft' && pop.classList.contains('sub')) { const owner = openSub; closeSub(); owner.focus(); }
      else if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') stepBar(ev.key === 'ArrowRight' ? 1 : -1);
      else if (ev.key === 'Enter' || ev.key === ' ') { if (t.getAttribute('aria-haspopup')) openSubmenu(t, 'first'); else choose(t); }
      else if (ev.key === 'Escape') { if (pop.classList.contains('sub')) { const owner = openSub; closeSub(); owner.focus(); } else close(true); }
      else if (ev.key === 'Tab') { close(); done = false; }
      else done = false;
    }
    if (done) { ev.preventDefault(); ev.stopPropagation(); }
  };

  const listen = (target, type, fn, opt) => { target.addEventListener(type, fn, opt); listeners.push([target, type, fn, opt]); };
  listen(root, 'click', onClick);
  listen(root, 'pointerover', onOver);
  listen(root, 'keydown', onKey);
  listen(doc, 'pointerdown', onDocDown, true);
  listen(doc, 'keydown', onDocKey);
  render();

  return {
    /** Show the menu for the player or GM view (GM-only entries come and go; open menus close). */
    setView(v) { if (v === view) return; close(); view = v; render(); },
    /** Set a toggle's state without calling onSelect (when the board changes it some other way). */
    setToggle(id, value) { if (value) on.add(id); else on.delete(id); refresh(); },
    /** A count on a bar button with badge: true (0 hides it). */
    setBadge(id, n) { badges.set(id, n | 0); refresh(); },
    /** A waiting dot on a menu (something inside wants attention). */
    setPending(id, value) { if (value) pending.add(id); else pending.delete(id); refresh(); },
    close: () => close(),
    isOpen: () => !!openMenu,
    destroy() { close(); listeners.forEach(([t, ty, fn, o]) => t.removeEventListener(ty, fn, o)); listeners = []; root.textContent = ''; },
  };
}
