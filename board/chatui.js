// The chat on the board: the Chat tab's log of messages (roll cards, Claude's narration, rulings and NPC lines,
// change-log lines), a card popping up beside the sidebar and an unread count on the Chat icon when the tab is not
// showing, and the GM's delete and clear. The messages and their HTML are board/chat.js. Docs:
// docs/best-practices/board.md (chat).
//
// o: {store, view() -> 'gm' | 'player', readOnly, sidebar (board/sidebar.js), pane (the Chat pane), names(token) ->
// the name this view uses for a token on the map or null, colour(kind), kindOf(token) -> kind or null}.
// Returns {latest(token, check) -> message or null, show(message), render(), changes() -> [log rows]}.

import { CHAT, chatVisible, messageHtml, timeAgo } from './chat.js';

const SHOWN = 300;          // messages drawn in the log (the newest)
const POP_MS = 12000;       // how long a popped-up card stays

export function mountChat(o) {
  const pane = o.pane;
  pane.innerHTML = '<ol class="cm-list" aria-live="polite"></ol><div class="cm-foot"></div>';
  const list = pane.querySelector('.cm-list'), foot = pane.querySelector('.cm-foot');
  const pops = document.createElement('div');
  pops.className = 'cm-pops'; pops.setAttribute('aria-live', 'polite');
  document.body.appendChild(pops);
  let LIST = [], first = true, armed = false, unread = 0;
  const seen = new Set();
  const startedAt = Date.now() - 5000;
  const listeners = [];
  const gm = () => o.view() === 'gm' && !o.readOnly;
  const html = (e, extra = {}) => messageHtml(e.data, { view: o.view(), names: o.names, colour: o.colour, kindOf: o.kindOf, canDelete: gm(), id: e.id, ...extra });

  function render() {
    const visible = LIST.filter((e) => chatVisible(e.data, o.view()));
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const shown = visible.slice(-SHOWN);
    list.innerHTML = (visible.length > SHOWN ? `<li class="cm-older">${visible.length - SHOWN} older message(s) are kept in the save.</li>` : '')
      + (shown.length ? shown.map((e) => html(e)).join('') : '<li class="cm-empty">No messages yet. Rolls, Claude\'s narration and the table\'s changes appear here.</li>');
    if (atBottom || first) list.scrollTop = list.scrollHeight;
    foot.innerHTML = gm() && visible.length ? `<button type="button" class="cm-clear" data-clear="1">${armed ? 'Clear every message? Click again' : 'Clear chat'}</button>` : '';
    for (const fn of listeners) fn();
  }
  /** A message popping up beside the sidebar (the Chat tab is not showing). */
  function show(msg, id = '') {
    const card = document.createElement('div');
    card.className = 'cm-popcard';
    card.innerHTML = `<button type="button" class="cm-popx" aria-label="Close" title="Close">✕</button><ol>${messageHtml(msg, { view: o.view(), names: o.names, colour: o.colour, kindOf: o.kindOf, id })}</ol>`;
    let t = setTimeout(() => card.remove(), POP_MS);
    card.addEventListener('mouseenter', () => clearTimeout(t));
    card.addEventListener('mouseleave', () => { t = setTimeout(() => card.remove(), POP_MS / 2); });
    card.querySelector('.cm-popx').addEventListener('click', () => card.remove());
    card.addEventListener('click', (e) => { if (!e.target.closest('.cm-popx')) { o.sidebar.select('chat'); card.remove(); } });
    pops.append(card);
    while (pops.children.length > 4) pops.firstChild.remove();
    placePops();
  }
  function placePops() {
    const side = document.getElementById('sidebar');
    const w = side ? side.getBoundingClientRect().width : 0;
    pops.style.right = `${Math.round(w + 12)}px`;
  }
  window.addEventListener('resize', placePops);

  pane.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del && gm()) { o.store.remove(`${CHAT}/${del.dataset.del}`).catch(() => {}); return; }
    if (e.target.closest('[data-clear]') && gm()) {
      if (!armed) { armed = true; render(); setTimeout(() => { armed = false; render(); }, 4000); return; }
      armed = false;
      for (const m of LIST) o.store.remove(`${CHAT}/${m.id}`).catch(() => {});
    }
  });
  o.sidebar.onShow('chat', () => { unread = 0; o.sidebar.setBadge('chat', 0); pops.replaceChildren(); list.scrollTop = list.scrollHeight; });
  o.store.watchCollection(CHAT, (l) => {
    LIST = [...l].sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const e of LIST) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (first || Date.parse(e.data.at) < startedAt || !chatVisible(e.data, o.view()) || e.data.kind === 'log') continue;
      if (!o.sidebar.showing('chat')) { show(e.data, e.id); unread++; o.sidebar.setBadge('chat', unread); }
    }
    render();
    first = false;
  });
  // "36m 39s ago" moves on
  setInterval(() => { const now = Date.now(); for (const t of list.querySelectorAll('time[datetime]')) t.textContent = timeAgo(t.getAttribute('datetime'), now); }, 15000);
  return {
    render,
    show,
    latest: (token, check) => { for (let i = LIST.length - 1; i >= 0; i--) { const d = LIST[i].data; if (d.kind === 'roll' && d.token === token && (!check || d.check === check)) return d; } return null; },
    messages: () => LIST,
    onChange: (fn) => listeners.push(fn),
  };
}
