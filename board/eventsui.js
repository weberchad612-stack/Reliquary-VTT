// The Events tab (the GM's only): every adventure event with its state (running, due, waiting, may happen again,
// done), and, opened, its trigger, stages (the current one marked) with their actions, decisions and history
// (board/events.js; docs/best-practices/events.md). Claude runs events (tools/events.mjs); the tab shows them. Never
// drawn, and never watched, in the player view.
//
// o: {store, view() -> 'gm' | 'player', pane, sidebar, tab ('events'), E (the engine: splitEvents, stageOf),
// badge(n)?}. Returns {render(), rows(), listening(), open(id)}.

import { EVENTS, DUE_PATH, splitRecords, eventRows, eventDetailHtml } from './events.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LABEL = { running: 'Running', due: 'Due', waiting: 'Waiting', cooldown: 'May happen again', done: 'Done' };
const ICON = { running: '▶', due: '❗', waiting: '⏳', cooldown: '↻', done: '✓' };

export function mountEvents(o) {
  const pane = o.pane;
  pane.innerHTML = '<div class="ev-head"><label class="ev-showdone"><input type="checkbox" class="ev-alldone"> Show finished</label><span class="ev-count"></span></div>'
    + '<ol class="ev-list"></ol><p class="ev-empty" hidden>No events in this campaign. The adventure importer brings in the book\'s events (adventure.json).</p>';
  const listEl = pane.querySelector('.ev-list'), empty = pane.querySelector('.ev-empty'), count = pane.querySelector('.ev-count'), showDone = pane.querySelector('.ev-alldone');
  let ROWS = [], DUE = {}, opened = new Set(), split = { defs: [], states: {} };
  const gm = () => o.view() === 'gm';

  function render() {
    if (!gm()) { listEl.innerHTML = ''; empty.hidden = true; count.textContent = ''; return; }
    const rows = eventRows(split.defs, split.states, DUE);
    const shown = rows.filter((r) => showDone.checked || r.status !== 'done');
    const active = rows.filter((r) => r.status === 'running' || r.status === 'due').length;
    count.textContent = rows.length ? `${active} active · ${rows.length} in all` : '';
    empty.hidden = rows.length > 0;
    const byId = Object.fromEntries(split.defs.map((d) => [d.id, d]));
    listEl.innerHTML = shown.map((r) => `<li class="ev-row ev-${r.status}" data-id="${esc(r.id)}">`
      + `<button type="button" class="ev-line" aria-expanded="${opened.has(r.id)}"><span class="ev-st" title="${LABEL[r.status]}">${ICON[r.status]}</span>`
      + `<span class="ev-title">${r.kickoff ? '<span class="ev-kick">Kickoff</span> ' : ''}${esc(r.title)}</span><span class="ev-meta">${esc([LABEL[r.status] + (r.stage ? `: ${r.stage}` : ''), r.pages ? `pp ${r.pages}` : null, r.runs > 1 ? `${r.runs}×` : null].filter(Boolean).join(' · '))}</span></button>`
      + (opened.has(r.id) ? eventDetailHtml(byId[r.id], split.states[r.id], r.due) : '') + '</li>').join('');
    if (o.badge) o.badge(active);
  }
  listEl.addEventListener('click', (ev) => {
    const b = ev.target.closest('.ev-line');
    if (!b) return;
    const id = b.closest('.ev-row').dataset.id;
    if (opened.has(id)) opened.delete(id); else opened.add(id);
    render();
  });
  showDone.addEventListener('change', render);

  let offs = null;
  const listen = (on) => {
    if (on && !offs) {
      offs = [
        o.store.watchCollection(EVENTS, (l) => { ROWS = l; split = splitRecords(l, o.E); render(); }),
        o.store.watch(DUE_PATH, (d) => { DUE = d || {}; render(); }),
      ];
    }
    if (!on && offs) { for (const f of offs) if (typeof f === 'function') f(); offs = null; ROWS = []; split = { defs: [], states: {} }; DUE = {}; render(); }
  };
  if (o.sidebar) o.sidebar.onVisible(o.tab || 'events', listen); else listen(true);
  render();
  return { render, rows: () => eventRows(split.defs, split.states, DUE), listening: () => !!offs, open: (id) => { opened.add(id); render(); } };
}
