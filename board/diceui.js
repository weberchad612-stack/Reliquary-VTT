// The Dice tab: statistics of every die rolled at the table (board/dice.js), for everyone (players do not count the
// GM's secret rolls). Filters in one row: who (everyone, the PCs, the NPCs: every creature that is not a PC), when (this session, all
// time) and the kind of roll (the ruleset's roll kinds). A table by die with a luck bar against a fair die, the
// chosen die's faces as a histogram with the fair count marked, and a table by roller. The GM starts a new session
// (state/session) and resets the statistics: this session's dice, or all of them (the records are deleted). Docs: docs/best-practices/board.md (dice statistics).
//
// o: {store, view() -> 'gm' | 'player', readOnly, pane, kinds: [{id, label}] (the ruleset's; may be empty), sidebar
// (board/sidebar.js; with it, the tab watches the database only while it is seen: two listeners, none when
// hidden), tab (its id, 'dice')}. Returns {render(), listening()}.
//
// Lesson from the previous board (2026-11-12): its dice panel read 80 roll documents and kept listeners on two of
// them, all the time, on every page. Here the dice are one collection, watched by one listener (plus the session
// start), and only while the Dice tab is open or popped out.

import { DICE, filterDice, diceStats, sessionStart } from './dice.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');
const SIDES = [['all', 'Everyone'], ['party', 'PCs'], ['others', 'NPCs']];
const WHEN = [['session', 'This session'], ['all', 'All time']];

export function mountDice(o) {
  const pane = o.pane;
  let LIST = [], session = null, side = 'all', when = 'session', kind = 'all', pick = 20, armed = null;
  const gm = () => o.view() === 'gm' && !o.readOnly;
  const kindLabel = (id) => ((o.kinds || []).find((k) => k.id === id) || {}).label || (id.charAt(0).toUpperCase() + id.slice(1));

  function seg(name, opts, cur) {
    return `<div class="dc-seg" role="group" aria-label="${esc(name)}">${opts.map(([v, l]) => `<button type="button" data-${esc(name)}="${esc(v)}" aria-pressed="${v === cur}">${esc(l)}</button>`).join('')}</div>`;
  }
  function render() {
    const all = LIST.map((e) => e.data);
    const since = when === 'session' ? sessionStart(session) : null;
    const base = filterDice(all, { view: o.view(), side, since });
    const kinds = [...new Set([...(o.kinds || []).map((k) => k.id).filter((id) => all.some((d) => d.kind === id)), ...all.map((d) => d.kind)])];
    if (kind !== 'all' && !kinds.includes(kind)) kind = 'all';
    const rows = kind === 'all' ? base : base.filter((d) => d.kind === kind);
    const s = diceStats(rows);
    const filters = `<div class="dc-filters">${seg('side', SIDES, side)}${seg('when', WHEN, when)}
      <label class="dc-kind">Kind <select data-kind>${[['all', 'All rolls'], ...kinds.map((k) => [k, kindLabel(k)])].map(([v, l]) => `<option value="${esc(v)}"${v === kind ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      ${gm() ? '<button type="button" class="dc-new" data-newsession="1" title="This session\'s statistics start from now">New session</button>' : ''}</div>`;
    // the GM's resets: they delete the dice records (this session's, or every one), whatever the filters show
    const nSession = all.filter((d) => d.at >= sessionStart(session)).length;
    const resets = gm() && all.length ? `<div class="dc-reset">
      <button type="button" data-reset="session"${nSession ? '' : ' disabled'}>${armed === 'session' ? `Delete this session's ${nSession} rolls? Click again` : 'Reset this session'}</button>
      <button type="button" data-reset="all">${armed === 'all' ? `Delete all ${all.length} rolls? Click again` : 'Reset all time'}</button></div>` : '';
    const sinceWords = when === 'session' ? ` since ${new Date(since).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : '';
    if (!s.dice) { pane.innerHTML = `${filters}${resets}<p class="dc-empty">No dice rolled${sinceWords || ' yet'}${side !== 'all' || kind !== 'all' ? ' for this filter' : ''}.</p>`; return; }
    if (!s.byDie.some((d) => d.sides === pick)) pick = (s.byDie.find((d) => d.sides === 20) || s.byDie[0]).sides;
    // by die: the luck bar runs from the die's lowest face to its highest; the tick is a fair die's average and the
    // fill reaches from it to this die's average (to the right: rolling high)
    const table = `<table class="dc-table"><caption>By die</caption><thead><tr><th scope="col">Die</th><th scope="col">Dice</th><th scope="col">Avg</th><th scope="col">Fair</th><th scope="col">Luck</th></tr></thead><tbody>${s.byDie.map((d) => {
      const pos = (x) => ((x - 1) / (d.sides - 1)) * 100, a = pos(d.avg), f = pos(d.fair);
      const words = `${d.avg > d.fair ? 'above' : d.avg < d.fair ? 'below' : 'at'} a fair d${d.sides}'s ${f1(d.fair)}`;
      return `<tr class="dc-pick${d.sides === pick ? ' on' : ''}" data-pick="${d.sides}" tabindex="0" title="Show the d${d.sides}'s faces and rollers"><th scope="row">d${d.sides}</th><td>${d.n}</td><td>${f1(d.avg)}</td><td>${f1(d.fair)}</td>
        <td><span class="dc-luck" role="img" aria-label="Average ${f1(d.avg)}, ${words}"><i class="${d.avg >= d.fair ? 'hi' : 'lo'}" style="left:${Math.min(a, f)}%;width:${Math.max(Math.abs(a - f), 1.5)}%"></i><u style="left:${f}%"></u></span></td></tr>`;
    }).join('')}</tbody></table>`;
    // the chosen die's faces: a bar per face, the fair count dashed across
    const faces = s.faces(pick), n = faces.reduce((x, y) => x + y, 0), fairN = n / pick, top = Math.max(...faces, fairN) || 1;
    const ex = s.extremes(pick);
    const hist = `<h3 class="dc-h">d${pick} faces <span>${n} dice · ${pick}s: ${ex.top} · 1s: ${ex.one}</span></h3>
      <div class="dc-hist" role="img" aria-label="How often each face of the d${pick} came up; a fair die would show each about ${f1(fairN)} times">
        <span class="dc-fair" style="bottom:${(fairN / top) * 100}%" title="A fair die: ${f1(fairN)} each"></span>
        ${faces.map((c, i) => `<b style="height:${Math.max((c / top) * 100, c ? 2 : 0)}%" title="${i + 1}: ${c} time${c === 1 ? '' : 's'} (${n ? Math.round((c / n) * 100) : 0}%)"></b>`).join('')}
      </div>
      <div class="dc-axis" aria-hidden="true">${faces.map((_, i) => `<span>${pick <= 20 || (i + 1) % 5 === 0 || i === 0 ? i + 1 : ''}</span>`).join('')}</div>`;
    const who = s.byRoller(pick);
    const rollers = `<table class="dc-table"><caption>d${pick} by roller</caption><thead><tr><th scope="col">Who</th><th scope="col">Dice</th><th scope="col">Avg</th><th scope="col">Best</th><th scope="col">Worst</th><th scope="col" title="How often the highest face came up">${pick}s</th><th scope="col">1s</th></tr></thead><tbody>${who.map((r) => `<tr><th scope="row">${esc(r.who)}</th><td>${r.n}</td><td>${f1(r.avg)}</td><td>${r.best}</td><td>${r.worst}</td><td>${r.top}</td><td>${r.one}</td></tr>`).join('')}</tbody></table>`;
    pane.innerHTML = `${filters}<p class="dc-sum">${s.rolls} roll${s.rolls === 1 ? '' : 's'}, ${s.dice} dice${sinceWords}. The tick on each luck bar is a fair die's average.</p>${table}${hist}${rollers}${resets}`;
  }
  pane.addEventListener('click', (e) => {
    const b = e.target.closest('button, tr[data-pick]');
    if (!b) return;
    if (b.dataset.side) side = b.dataset.side;
    else if (b.dataset.when) when = b.dataset.when;
    else if (b.dataset.pick) pick = Number(b.dataset.pick);
    else if (b.dataset.newsession && gm()) { o.store.set('state/session', { started: new Date().toISOString() }).catch(() => {}); when = 'session'; }
    else if (b.dataset.reset && gm()) {
      const which = b.dataset.reset;
      if (armed !== which) { armed = which; render(); setTimeout(() => { if (armed === which) { armed = null; render(); } }, 4000); return; }
      armed = null;
      const since = sessionStart(session);
      for (const e of LIST) if (which === 'all' || e.data.at >= since) o.store.remove(`${DICE}/${e.id}`).catch(() => {});
    }
    else return;
    render();
  });
  pane.addEventListener('keydown', (e) => { const r = e.target.closest('tr[data-pick]'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick = Number(r.dataset.pick); render(); } });
  pane.addEventListener('change', (e) => { if (e.target.matches('[data-kind]')) { kind = e.target.value; render(); } });
  // the database, watched only while the tab is seen
  let offs = [];
  const listen = (on) => {
    if (on && !offs.length) offs = [o.store.watchCollection(DICE, (l) => { LIST = l; render(); }), o.store.watch('state/session', (s) => { session = s; render(); })];
    if (!on && offs.length) { for (const off of offs) if (typeof off === 'function') off(); offs = []; LIST = []; pane.innerHTML = ''; }
  };
  if (o.sidebar) o.sidebar.onVisible(o.tab || 'dice', listen); else listen(true);
  return { render: () => { if (offs.length) render(); }, listening: () => offs.length > 0 };
}
