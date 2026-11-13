// The Audit tab (the GM's only): the audit log's newest entries, live, with the GM's clear. The records and their
// HTML are board/audit.js. Docs: docs/best-practices/board.md (chat and audit log).
//
// o: {store, view() -> 'gm' | 'player', readOnly, pane (the Audit pane), sidebar, tab ('audit')}. With the sidebar,
// the audit log is watched only while its tab is seen, which is never in the player view. Returns {render(),
// entries(), listening()}.

import { AUDIT, auditRows, auditHtml } from './audit.js';

const SHOWN = 200;

export function mountAudit(o) {
  const pane = o.pane;
  pane.innerHTML = '<div class="au-head"><span class="au-note">The GM\'s only: every change to the game, newest first</span></div><ol class="au-list"></ol><div class="au-foot"></div>';
  const list = pane.querySelector('.au-list'), foot = pane.querySelector('.au-foot');
  let LIST = [], armed = false;
  const gm = () => o.view() === 'gm' && !o.readOnly;
  function render() {
    if (o.view() !== 'gm') { list.innerHTML = ''; foot.innerHTML = ''; return; }   // never drawn for players
    const rows = auditRows(LIST, SHOWN);
    list.innerHTML = rows.length ? rows.map(auditHtml).join('') : '<li class="au-empty">No changes yet.</li>';
    foot.innerHTML = gm() && LIST.length
      ? `${LIST.length > SHOWN ? `<span class="au-more">${LIST.length - SHOWN} older entries are kept in the save.</span>` : ''}<button type="button" class="cm-clear" data-clear="1">${armed ? 'Clear the audit log? Click again' : 'Clear audit log'}</button>`
      : '';
  }
  pane.addEventListener('click', (e) => {
    if (!e.target.closest('[data-clear]') || !gm()) return;
    if (!armed) { armed = true; render(); setTimeout(() => { armed = false; render(); }, 4000); return; }
    armed = false;
    for (const m of LIST) o.store.remove(`${AUDIT}/${m.id}`).catch(() => {});
  });
  let off = null;
  const listen = (on) => {
    if (on && !off) off = o.store.watchCollection(AUDIT, (l) => { LIST = l; render(); });
    if (!on && off) { if (typeof off === 'function') off(); off = null; LIST = []; render(); }
  };
  if (o.sidebar) o.sidebar.onVisible(o.tab || 'audit', listen); else listen(true);
  return { render, entries: () => LIST, listening: () => !!off };
}
