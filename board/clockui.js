// The clock in the title line (everyone) and its editor (the GM view): shared by the battle map page
// (board/app.js) and the area map page (board/area.js). Reads and watches state/clock and state/encounter;
// the GM's changes write state/clock, log the change, and run out timed effects on every token (those on this
// page through `applyLocal`, so the page's own state stays the truth; the rest straight to the database).
// Docs: docs/best-practices/board.md (the clock).

import { QUICK_STEPS, clockLabel, quickTarget, amountTarget, setTarget, setFields, encounterUnderWay, expireAll } from './clock.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * o: {store, T (the engine's time functions), cal (the ruleset's calendar), roundSeconds, getView() -> 'gm' |
 * 'player', readOnly (a preview: nothing is written), toast(msg), logChange(what) (the GM's audit log), names(id, token) -> name,
 * applyLocal(changed: {id: effects}) -> the ids it handled (tokens on this page)}.
 * Returns {render(), clock()}.
 */
export async function mountClock(o) {
  const el = document.getElementById('clock'), dlg = document.getElementById('clock-panel');
  if (!el || !dlg || !o.cal) return { render() {}, clock: () => null, advance() {} };
  let CLOCK = await o.store.get('state/clock').catch(() => null), ENC = await o.store.get('state/encounter').catch(() => null);
  const gm = () => o.getView() === 'gm' && !o.readOnly;

  function render() {
    const label = clockLabel(o.T, o.cal, CLOCK);
    el.hidden = !label && !gm();
    el.textContent = label || 'Set the date and time';
    el.classList.toggle('unset', !label);
    el.disabled = !gm();
    el.title = gm() ? 'GM: change the date and time' : (label ? `${o.cal.label || 'Calendar'}${encounterUnderWay(ENC) ? `; round ${ENC.round}` : ''}` : '');
    if (!dlg.hidden && !gm()) dlg.hidden = true;
  }

  // the editor
  function open() {
    if (!gm()) return;
    const f = CLOCK ? setFields(o.T, o.cal, CLOCK) : { day: 1, month: 1, year: (o.cal.anchor || {}).year || 1, time: '08:00' };
    const busy = encounterUnderWay(ENC);
    dlg.innerHTML = `<div class="box">
      <h2 id="clock-title">${CLOCK ? 'The clock' : 'Set the date and time'}</h2>
      ${CLOCK ? `<p class="now">${esc(clockLabel(o.T, o.cal, CLOCK))}</p>` : ''}
      ${busy ? `<p class="muted">An encounter is under way (round ${ENC.round}): time moves by rounds. End the encounter to move the clock on.</p>` : ''}
      ${CLOCK ? `<div class="quick" role="group" aria-label="Move the clock on">${QUICK_STEPS.map((q) => `<button type="button" data-q="${q.id}" ${busy ? 'disabled' : ''}>${esc(q.label)}</button>`).join('')}</div>
      <form class="amount"><label>Move on by <input name="amount" placeholder="3 hours, 2 days" autocomplete="off" ${busy ? 'disabled' : ''}></label><button ${busy ? 'disabled' : ''}>Move on</button></form>` : ''}
      <form class="set"><fieldset><legend>Set the date</legend>
        <input name="day" type="number" min="1" max="31" value="${f.day}" aria-label="Day" required>
        <select name="month" aria-label="Month">${o.cal.months.map((m, i) => `<option value="${i + 1}" ${i + 1 === f.month ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
        <input name="year" type="number" min="1" value="${f.year}" aria-label="Year" required> ${esc(o.cal.era || '')}
        <input name="time" type="time" value="${f.time}" aria-label="Time" required>
        <button ${busy ? 'disabled' : ''}>Set</button></fieldset></form>
      <div class="row">${CLOCK ? '<button type="button" data-a="day1" title="Make today Day 1 of the adventure">Make today Day 1</button>' : ''}<button type="button" data-a="close" aria-pressed="true">Close</button></div>
    </div>`;
    dlg.hidden = false;
    (dlg.querySelector('[data-q]') || dlg.querySelector('input')).focus();
  }
  const close = () => { dlg.hidden = true; el.focus(); };

  async function write(next, what, runOut = true) {
    if (!gm()) return;
    try {
      const before = CLOCK;
      await o.store.set('state/clock', next);
      CLOCK = next;
      o.logChange(what(before, next), true);   // the time is everyone's
      render();
      if (runOut && before && next.now > before.now) await expire(next.now);
      if (!dlg.hidden) open();
    } catch (e) { o.toast(`Could not change the clock (${e.message || e}).`); }
  }
  /** Timed effects that ran out: on this page through applyLocal, elsewhere straight to the database. */
  async function expire(now) {
    const list = await o.store.list('tokens');
    const tokens = Object.fromEntries(list.map((e) => [e.id, e.data]));
    const r = expireAll(o.T, tokens, now, o.roundSeconds, o.names);
    if (!r.lines.length) return;
    const handled = new Set(o.applyLocal(r.changed) || []);
    for (const [id, effects] of Object.entries(r.changed)) {
      if (handled.has(id)) continue;
      const data = { ...tokens[id] };
      if (effects.length) data.effects = effects; else delete data.effects;
      await o.store.set(`tokens/${id}`, data).catch((e) => o.toast(`Could not update a token (${e.message || e}).`));
    }
    // the page logs its own tokens' changes as it writes them; these are the others
    // (effects running out: the GM's audit log)
    for (const line of r.lines) if (!handled.has(line.id)) o.logChange(line.text);
  }
  const moved = (b, n) => `the clock moves on: ${clockLabel(o.T, o.cal, b)} → ${clockLabel(o.T, o.cal, n)}`;

  el.addEventListener('click', open);
  dlg.addEventListener('click', (ev) => {
    const q = ev.target.closest('[data-q]'), a = ev.target.closest('[data-a]');
    if (ev.target === dlg || (a && a.dataset.a === 'close')) return close();
    if (q && CLOCK) return write({ ...CLOCK, now: quickTarget(CLOCK, q.dataset.q) }, moved);
    if (a && a.dataset.a === 'day1' && CLOCK) return write({ ...CLOCK, start: CLOCK.now }, (b, n) => `today is Day 1: ${clockLabel(o.T, o.cal, n)}`);
  });
  dlg.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const form = ev.target, fd = new FormData(form);
    try {
      if (form.classList.contains('amount')) {
        if (!CLOCK) return;
        return write({ ...CLOCK, now: amountTarget(o.T, CLOCK, fd.get('amount'), o.roundSeconds) }, moved);
      }
      const now = setTarget(o.T, o.cal, { day: fd.get('day'), month: fd.get('month'), year: fd.get('year'), time: fd.get('time') });
      const next = CLOCK ? { ...CLOCK, now } : { now, start: now };
      // setting the date does not run effects out: it may go back, or jump for a new chapter
      return write(next, (b, n) => (b ? `the clock is set: ${clockLabel(o.T, o.cal, b)} → ${clockLabel(o.T, o.cal, n)}` : `the clock is set: ${clockLabel(o.T, o.cal, n)}`), false);
    } catch (e) { o.toast(e.message); }
  });
  dlg.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } });

  o.store.watch('state/clock', (c) => { CLOCK = c; render(); if (!dlg.hidden && !document.activeElement.closest('form')) open(); });
  o.store.watch('state/encounter', (e) => { ENC = e; render(); });
  render();
  return {
    render, clock: () => CLOCK,
    /** Move the clock on (the GM's travel box): running effects out as the clock's own changes do. */
    advance(seconds, words) {
      if (!CLOCK) { o.toast('Set the date and time first (the clock in the title line).'); return; }
      return write({ ...CLOCK, now: CLOCK.now + Math.round(seconds) }, (b, n) => `${words}: ${clockLabel(o.T, o.cal, b)} → ${clockLabel(o.T, o.cal, n)}`);
    },
  };
}
