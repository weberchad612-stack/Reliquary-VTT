// The encounter tracker on the board (as Foundry's combat tracker): the panel (docked or floating), its rows,
// the roll dialog, and the actions, each written to state/encounter; turn changes run the system's turn rules and
// move the clock, as Claude's tools/encounter.mjs does. The rules of who sees and does what are board/tracker.js.
// Docs: docs/design/board.md (the encounter tracker), docs/best-practices/board.md (the encounter tracker).
//
// o: {store, Engine, SYS, readOnly, view() -> 'gm' | 'player', tokens() -> {id: token} (this map's),
//   seen(id), name(id) (this view's name), publicName(id) (the name players use), colour(kind), toast(msg),
//   logChange(what) (the GM's audit log), postEvent(text, pub, token) (an event in the players' chat), loadCreature(id) -> {actor, state, content} | null, applyTokens({id: {effects, dead}}) -> ids
//   handled on this page, target(id, add) (target this token alone, or add it with Shift), ping(id), hover(id | null), onActing(id | null), onEncounter(underWay) (an encounter began or ended),
//   reveal(id), setHidden(id, hidden) (the GM hides a token from the players), setDead(id, dead) (the token's dead look on the map), conditionWords(token) -> [words this view may see], rolls (the chat: {show, latest}), panel (the
//   Encounter tab's panel, board/panel.js), openButton}

import { trackerRows, applyAction, needInitiative, initiativeText, begun, openEncounter, newlyDefeated, eventLines, dropInitiative, canDrag } from './tracker.js';
import { rollRecord } from './rolls.js';
import { chatPath } from './chat.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sgn = (v) => (v < 0 ? `−${-v}` : `+${v}`);
const ICON = {
  hide: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
  hidden: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 4l16 16" stroke="currentColor" stroke-width="2.2"/></svg>',
  reveal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16 16l2 2 4-5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  defeated: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C7 2 4 5.5 4 10c0 2.6 1.2 4.3 3 5.4V19h10v-3.6c1.8-1.1 3-2.8 3-5.4 0-4.5-3-8-8-8z" fill="currentColor"/><circle cx="9" cy="10.5" r="1.9" fill="var(--panel)"/><circle cx="15" cy="10.5" r="1.9" fill="var(--panel)"/><path d="M9 19v3M12 19v3M15 19v3" stroke="currentColor" stroke-width="1.6"/></svg>',
  target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2"/></svg>',
  ping: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.4 4.4a10.8 10.8 0 0 0 0 15.2M19.6 4.4a10.8 10.8 0 0 1 0 15.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  die: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.8 21.3 7.2v9.6L12 22.2 2.7 16.8V7.2z" fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 6.5 17.2 15H6.8z M12 1.8V6.5M2.7 7.2 6.8 15M21.3 7.2 17.2 15M6.8 15 2.7 16.8M17.2 15l4.1 1.8M6.8 15 12 22.2 17.2 15" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><text x="12" y="13.6" text-anchor="middle" font-size="5.2" font-weight="700" fill="currentColor" font-family="sans-serif">20</text></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H5M11 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  prevRound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M19 5 8.5 12 19 19z" fill="currentColor"/></svg>',
  nextRound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M5 5l10.5 7L5 19z" fill="currentColor"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>',
};

export async function mountTracker(o) {
  const { store, Engine, SYS } = o;
  const I = SYS.initiative || null;
  const Tm = SYS.time || {};
  const TT = { tiebreak: Tm.tiebreak || (() => 0), roundSeconds: Tm.roundSeconds || 6 };
  const panel = o.panel;   // the Encounter tab's panel (board/sidebar.js): in its tab or popped out
  panel.el.classList.add('tracker');
  let ENC = await store.get('state/encounter').catch(() => null);
  let lastKey = '', busy = false, menuFor = null, typing = null, lastActing = null, editing = null, dragging = null, lastRows = [];
  const gm = () => o.view() === 'gm' && !o.readOnly;
  const hover = (id) => o.hover(id);

  // ---- writing: one action at a time, on the record as it is now ----
  async function commit(action, extra = []) {
    if (o.readOnly) return false;
    if (busy) { o.toast('One moment: the last change is still being saved.'); return false; }
    busy = true;
    try {
      const enc0 = await store.get('state/encounter').catch(() => null);
      const clock = await store.get('state/clock').catch(() => null);
      const now0 = clock ? clock.now : 0;
      const r = applyAction(enc0, action, { E: Engine, T: TT, now: now0, view: o.view(), tokens: o.tokens(), name: o.publicName });
      // each line is public unless it is about a creature the players do not see (hidden, or out of sight)
      const secret = (id) => { const c = r.encounter.combatants.find((x) => x.token === id), t = o.tokens()[id]; return !!(c && c.hidden) || !!(t && t.kind !== 'pc' && !o.partySees(id)); };
      // every line goes to the GM's audit log; the ones players should know about (the encounter beginning or ending,
      // a new round, what the turn rules did: damage, conditions, recovery) also go to the chat as events
      const startStop = action.type === 'begin' || action.type === 'end';
      const lines = r.lines.map((text) => ({ text, pub: !(action.token && secret(action.token)), event: startStop })), turnWords = eventLines(r.events.filter((ev) => !ev.token || !secret(ev.token)), o.publicName);
      const tokChanged = {}, stateChanged = {};
      if (r.events.length && Tm.turnRules) {
        const all = Object.fromEntries((await store.list('tokens')).map((e) => [e.id, e.data]));
        const ids = r.encounter.combatants.map((c) => c.token), cre = {}, states = {};
        for (const id of ids) { const c = await o.loadCreature(id).catch(() => null); if (c && c.actor) { cre[id] = c; states[id] = c.state || {}; } }
        const prepare = (id, token, state) => { const c = cre[id]; if (!c) return null; try { return Engine.prepareActor({ actor: c.actor, state: state || {}, effects: (token && token.effects) || [], content: c.content, ruleset: SYS.actors }); } catch { return null; } };
        const names = Object.fromEntries(Object.keys(all).map((id) => [id, o.publicName(id)]));
        for (const ev of r.events) {
          const pub = !ev.token || !secret(ev.token);
          if (ev.type === 'round-start') lines.push({ text: `Round ${ev.round}`, pub: true, event: true });
          if (ev.type === 'turn-start') lines.push({ text: `${o.publicName(ev.token)}'s turn`, pub });
          const res = Tm.turnRules({ events: [ev], now: ev.type === 'turn-end' || ev.type === 'round-end' ? now0 : r.now, encounter: r.encounter, tokens: all, states, names, roundSeconds: TT.roundSeconds, rng: Math.random, prepare });
          lines.push(...res.lines.map((text) => ({ text, pub, event: true })));
          for (const [id, t] of Object.entries(res.tokens || {})) { all[id] = { ...all[id], ...t }; tokChanged[id] = { effects: t.effects || [], dead: !!t.dead }; }
          for (const [id, s] of Object.entries(res.states || {})) { states[id] = s; stateChanged[id] = s; }
        }
      }
      await store.set('state/encounter', r.encounter);
      ENC = r.encounter;
      if (clock && r.now !== now0) await store.set('state/clock', { ...clock, now: r.now });
      const handled = new Set(o.applyTokens(tokChanged) || []);
      for (const [id, ch] of Object.entries(tokChanged)) {
        if (handled.has(id)) continue;
        const cur = await store.get(`tokens/${id}`).catch(() => null);
        if (!cur) continue;
        const data = { ...cur };
        if (ch.effects.length) data.effects = ch.effects; else delete data.effects;
        if (ch.dead) data.dead = true;
        await store.set(`tokens/${id}`, data);
      }
      for (const [id, s] of Object.entries(stateChanged)) {
        const data = Object.fromEntries(Object.entries(s).filter(([k, v]) => v !== undefined && v !== null && !(k === 'temp' && v === 0)));
        await store.set(`actorstate/${id}`, data);
      }
      for (const w of extra) await store.set(w.path, w.data);
      for (const l of lines) { o.logChange(l.text); if (l.event && o.postEvent) o.postEvent(l.text, l.pub, null); }
      if (turnWords.length) o.toast(turnWords.join(' · '));
      render();
      return true;
    } catch (e) {
      o.toast(e.message || String(e));
      return false;
    } finally { busy = false; }
  }

  // ---- rolling ----
  async function prepared(id) {
    const c = await o.loadCreature(id).catch(() => null);
    if (!c || !c.actor || !SYS.actors) return null;
    const t = o.tokens()[id] || {};
    try { return Engine.prepareActor({ actor: c.actor, state: c.state || {}, effects: t.effects || [], content: c.content, ruleset: SYS.actors }); } catch { return null; }
  }
  /** A roll's action and its card record. */
  function rollWrites(id, p, slug, st, mode, dice = null) {
    const r = Engine.rollCheck(st, { mode, sides: I.die || 20, dice });
    const label = (I.statistics(p).find((x) => x.slug === slug) || {}).label || slug;
    const parts = Engine.countedParts(st), notes = Engine.notesFor(p.notes, I.noteSelectors(slug), p.tags, p.facts);
    const roll = { dice: r.dice, kept: r.kept, mode: r.mode, sides: r.sides, mod: r.mod, parts };
    // a creature the players do not see (hidden in the tracker, or out of the party's sight): its roll is the GM's
    const c = openEncounter(ENC) ? ENC.combatants.find((x) => x.token === id) : null, t = o.tokens()[id];
    const secret = !!(c && c.hidden) || !!(t && t.kind !== 'pc' && !o.partySees(id));
    const rec = rollRecord({ by: o.view() === 'gm' ? 'gm' : 'player', token: id, name: o.publicName(id), check: 'initiative', stat: { slug, label }, roll: r, mod: r.mod, total: r.total, parts, notes, gm: secret });
    return { action: { type: 'initiative', token: id, initiative: r.total, extra: { stat: slug, roll } }, write: { path: chatPath(), data: rec } };
  }
  /** Roll All / Roll NPCs: Perception, no dialog, for everyone who still needs it. */
  async function rollMany(which) {
    if (!I) return o.toast('This game system has no initiative rules.');
    const ids = needInitiative(ENC, o.tokens(), which);
    if (!ids.length) return o.toast(which === 'all' ? 'Everyone has initiative.' : 'Every NPC has initiative.');
    let none = 0;
    for (const id of ids) {
      const p = await prepared(id);
      const st = p && I.statistic(p, 'perception');
      if (!st) { none++; continue; }
      const w = rollWrites(id, p, 'perception', st, 'normal');
      if (!(await commit(w.action, [w.write]))) return;
    }
    if (none) o.toast(`${none} creature(s) have no game data: type their initiative in (the row's ⋮ menu).`);
  }

  // the roll dialog (Foundry's): the statistic, every modifier with a switch, your own modifiers, rolling twice
  let dlg = null;
  function closeDialog() { if (dlg) { dlg.el.remove(); dlg = null; } }
  async function openDialog(id) {
    closeDialog();
    if (!I) return o.toast('This game system has no initiative rules: type the result in.');
    const p = await prepared(id);
    if (!p) return o.toast(`${o.name(id)} has no game data: type the result in (the row's ⋮ menu).`);
    const el = document.createElement('div');
    el.className = 'rolldlg'; el.setAttribute('role', 'dialog'); el.tabIndex = -1;
    dlg = { el, id, p, slug: 'perception', flip: new Set(), add: [], mode: 'normal' };
    const pr = panel.el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - 380, pr.left - 372))}px`;
    el.style.top = `${Math.max(8, Math.min(window.innerHeight - 420, pr.top + 40))}px`;
    document.body.appendChild(el);
    for (const ev of ['click', 'dblclick', 'wheel', 'contextmenu']) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev === 'wheel' });
    el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') closeDialog(); });
    el.addEventListener('click', onDialogClick);
    el.addEventListener('change', onDialogChange);
    el.addEventListener('submit', (e) => { e.preventDefault(); addModifier(); });
    renderDialog();
    el.focus();
  }
  const dialogStat = () => {
    const st0 = I.statistic(dlg.p, dlg.slug), rows = Engine.checkRows(st0);
    const off = rows.filter((r) => r.on && dlg.flip.has(r.key)).map((r) => r.key), on = rows.filter((r) => !r.on && dlg.flip.has(r.key)).map((r) => r.key);
    return { st0, rows, st: Engine.adjustCheck(st0, { off, on, add: dlg.add }, { stacks: I.stacks }) };
  };
  function renderDialog() {
    const { rows, st } = dialogStat();
    const types = I.addTypes || ['untyped'];
    const statOpts = I.statistics(dlg.p).map((s) => `<option value="${esc(s.slug)}"${s.slug === dlg.slug ? ' selected' : ''}>${esc(s.label)}</option>`).join('');
    const applied = new Set(st.modifiers.filter((m) => m.applied).map((m) => m.label));
    const row = (r) => {
      const on = r.on !== dlg.flip.has(r.key);
      return `<tr class="${on ? '' : 'off'}"><td>${esc(r.label)}${r.why && !on ? `<small>${esc(r.why)}</small>` : ''}</td><td><span class="rd-type">${esc(r.type)}</span></td><td class="rd-v">${sgn(r.value)}</td>
        <td><button type="button" role="switch" aria-checked="${on}" class="rd-sw" data-k="${r.key}" aria-label="${esc(r.label)} ${on ? 'on' : 'off'}">${on ? 'ON' : 'OFF'}</button></td></tr>`;
    };
    const added = dlg.add.map((a, i) => `<tr class="${applied.has(a.label) ? '' : 'off'}"><td>${esc(a.label)}${applied.has(a.label) ? '' : '<small>a bigger bonus of this type applies</small>'}</td><td><span class="rd-type">${esc(a.type)}</span></td><td class="rd-v">${sgn(a.value)}</td>
      <td><button type="button" class="rd-rm" data-rm="${i}" aria-label="Remove ${esc(a.label)}">✕</button></td></tr>`).join('');
    dlg.el.innerHTML = `<div class="rd-h"><span>Initiative: ${esc(o.name(dlg.id))}</span><button type="button" class="rd-x" data-a="close" aria-label="Close">✕</button></div>
      <label class="rd-stat">Roll with <select data-f="stat">${statOpts}</select></label>
      <table class="rd-t"><thead><tr><th>Modifier</th><th>Type</th><th></th><th></th></tr></thead><tbody>${rows.map(row).join('')}${added}</tbody></table>
      <form class="rd-add"><input name="label" placeholder="Modifier" aria-label="Modifier name"><input name="value" type="number" step="1" value="1" aria-label="Value" required>
        <select name="type" aria-label="Type">${types.map((t) => `<option${t === 'circumstance' ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select><button>+ Add</button></form>
      <fieldset class="rd-mode"><legend class="sr">Dice</legend>${[['higher', 'Keep higher'], ['normal', 'Normal'], ['lower', 'Keep lower']].map(([v, l]) => `<label><input type="radio" name="mode" value="${v}"${dlg.mode === v ? ' checked' : ''}> ${l}</label>`).join('')}</fieldset>
      <button type="button" class="rd-roll" data-a="roll">Roll (${sgn(st.value)})</button>`;
  }
  function addModifier() {
    const f = dlg.el.querySelector('.rd-add'), fd = new FormData(f);
    const value = Math.round(Number(fd.get('value')));
    if (!Number.isFinite(value) || !value) return o.toast('Give the modifier a number other than 0.');
    dlg.add.push({ label: String(fd.get('label') || '').trim() || `${fd.get('type')} ${sgn(value)}`, type: String(fd.get('type')), value });
    renderDialog();
  }
  function onDialogClick(e) {
    const b = e.target.closest('button');
    if (!b || !dlg) return;
    if (b.dataset.a === 'close') return closeDialog();
    if (b.dataset.k) { if (dlg.flip.has(b.dataset.k)) dlg.flip.delete(b.dataset.k); else dlg.flip.add(b.dataset.k); return renderDialog(); }
    if (b.dataset.rm !== undefined) { dlg.add.splice(Number(b.dataset.rm), 1); return renderDialog(); }
    if (b.dataset.a === 'roll') {
      const { st } = dialogStat(), d = dlg;
      const w = rollWrites(d.id, d.p, d.slug, st, d.mode);
      closeDialog();
      commit(w.action, [w.write]);
    }
  }
  function onDialogChange(e) {
    if (!dlg) return;
    if (e.target.dataset.f === 'stat') { dlg.slug = e.target.value; dlg.flip.clear(); renderDialog(); }
    if (e.target.name === 'mode') { dlg.mode = e.target.value; }
  }

  // ---- drawing ----
  function render() {
    const view = o.view(), tokens = o.tokens();
    const live = openEncounter(ENC), started = begun(ENC);
    const rows = trackerRows(ENC, tokens, { view, seen: o.seen, name: o.name });
    lastRows = rows;
    const acting = rows.find((r) => r.acting);
    const actingId = acting ? acting.token : null;
    if (actingId !== lastActing) { lastActing = actingId; o.onActing(actingId); }
    const status = !live ? 'No encounter' : started ? `Round ${ENC.round}` : 'Not started';
    panel.setNote(status);
    if (o.openButton) {
      o.openButton.textContent = live ? (started ? `⚔ Round ${ENC.round}` : '⚔ Encounter') : '⚔';
      o.openButton.classList.toggle('on', live);
      o.openButton.title = live ? `The encounter (${status.toLowerCase()})` : 'The encounter tracker';
    }
    const B = panel.body;
    if (!live) {
      lastKey = '';
      B.innerHTML = `<p class="muted trk-empty">No encounter. ${view === 'gm' ? 'Right-click a token and choose <b>Enter Combat</b> (several selected tokens enter together).' : 'Right-click your character and choose <b>Enter Combat</b>.'}</p>`;
      panel.foot.innerHTML = '';
      return;
    }
    const key = JSON.stringify([rows, view, gm(), started, ENC.round, rows.map((r) => [(o.tokens()[r.token] || {}).known, o.conditionWords(o.tokens()[r.token] || {})])]);
    if ((key === lastKey && !menuFor) || editing || dragging) return;   // never redraw under a hand that is typing or dragging
    lastKey = key;
    const tools = gm() ? `<div class="trk-tools"><button type="button" data-a="roll-all">Roll All</button><button type="button" data-a="roll-npc">Roll NPCs</button></div>` : '';
    B.innerHTML = tools + `<ol class="trk-list">${rows.map(rowHtml).join('')}</ol>`;
    let foot = '';
    if (!started) foot = gm() ? '<button type="button" class="trk-go" data-a="begin">⚔ Begin Encounter</button>' : '<p class="muted">Waiting for the GM to begin.</p>';
    // the GM's controls, as Foundry's: previous round, previous turn, End Encounter, next turn, next round
    else if (gm()) foot = `<div class="trk-nav">
      <button type="button" class="trk-ic" data-a="previous-round" title="Previous round: back to the start of the round before (a correction: nothing is undone)" aria-label="Previous round">${ICON.prevRound}</button>
      <button type="button" class="trk-ic" data-a="previous" title="Previous turn (a correction: nothing is undone)" aria-label="Previous turn">${ICON.prev}</button>
      <button type="button" class="trk-end" data-a="end">✕ End Encounter</button>
      <button type="button" class="trk-ic" data-a="next" title="Next turn" aria-label="Next turn">${ICON.next}</button>
      <button type="button" class="trk-ic" data-a="next-round" title="Next round: the rest of this round's turns are skipped" aria-label="Next round">${ICON.nextRound}</button></div>`;
    else if (acting && acting.mine) foot = '<div class="trk-turns"><button type="button" data-a="delay">Delay</button><button type="button" class="trk-go" data-a="next">End turn ▶</button></div>';
    panel.foot.innerHTML = foot;
    if (menuFor) openMenu(menuFor, true);
  }
  function rowHtml(r) {
    const t = o.tokens()[r.token] || {};
    const isGm = gm();
    const pic = `<span class="trk-pic" style="--c:${o.colour(r.kind)}" aria-hidden="true">${esc((t.short || r.name || '?').charAt(0).toUpperCase())}</span>`;
    const ib = (a, icon, label, on = false) => `<button type="button" class="trk-ib${on ? ' on' : ''}" data-a="${a}" data-id="${r.token}" title="${esc(label)}" aria-label="${esc(label)}" aria-pressed="${on}">${ICON[icon]}</button>`;
    const icons = [];
    if (isGm) {
      icons.push(ib('hide', r.hidden ? 'hidden' : 'hide', r.hidden ? 'Hidden from players: show' : 'Hide from players', r.hidden));
      if (t.alias && !t.known) icons.push(ib('reveal', 'reveal', `Reveal the name (players see "${t.alias}")`));
      icons.push(ib('defeated', 'defeated', r.defeated ? 'Defeated: not defeated' : 'Mark defeated', r.defeated));
    }
    if (r.present) icons.push(ib('target', 'target', 'Target (Shift-click: add to your targets)'), ib('ping', 'ping', 'Ping on the map'));
    if (r.mine && !o.readOnly) icons.push(ib('menu', 'menu', 'More'));
    const conds = r.present ? o.conditionWords(t) : [];
    let init;
    if (r.initiative !== null) {
      const rolled = r.roll && r.roll.parts ? `${(r.roll.dice || []).join('/')} ${sgn(r.roll.mod || 0)}: ${r.roll.parts.map((p) => `${p.label} ${sgn(p.value)}`).join(', ')}` : '';
      const tip = [r.roll && r.roll.set ? 'set by hand' : '', r.roll && r.roll.typed ? 'typed in' : '', rolled ? `rolled ${rolled}` : ''].filter(Boolean).join('; ') || 'initiative';
      init = isGm
        ? `<button type="button" class="trk-n" data-a="set-init" data-id="${r.token}" title="${esc(tip)} (click to change it)">${initiativeText(r.initiative)}</button>`
        : `<button type="button" class="trk-n" data-a="card" data-id="${r.token}" title="${esc(tip)} (click for the roll card)">${initiativeText(r.initiative)}</button>`;
    } else if (r.mine && !o.readOnly) init = `<button type="button" class="trk-die" data-a="roll" data-id="${r.token}" title="Roll initiative" aria-label="Roll initiative for ${esc(r.name)}">${ICON.die}</button>`;
    else init = '<span class="trk-q" title="No initiative yet">—</span>';
    const extra = r.delayed ? `<div class="trk-delay">Delaying${r.mine && begun(ENC) ? ' <button type="button" data-a="resume" data-id="' + r.token + '">Act now</button>' : ''}</div>` : '';
    const drag = !o.readOnly && canDrag(r, o.view() === 'gm' ? 'gm' : 'player') ? ' draggable="true"' : '';
    return `<li${drag} class="trk-row${drag ? ' can-drag' : ''}${r.acting ? ' acting' : ''}${r.defeated ? ' defeated' : ''}${r.hidden ? ' hidden' : ''}${r.delayed ? ' delayed' : ''}" data-id="${r.token}"${r.acting ? ' aria-current="true"' : ''}>
      ${pic}<div class="trk-main"><div class="trk-name">${r.acting ? '<span class="trk-arrow" aria-label="acting">▶</span> ' : ''}${esc(r.name)}</div>
      <div class="trk-icons">${icons.join('')}</div>${conds.length ? `<div class="trk-conds">${conds.map((w) => `<span>${esc(w)}</span>`).join('')}</div>` : ''}${extra}</div>
      <div class="trk-init">${init}</div></li>`;
  }

  // the row's ⋮ menu: roll with the dialog, type a result, clear, remove
  function openMenu(id, keep = false) {
    const old = panel.el.querySelector('.trk-menu');
    if (old) old.remove();
    if (!keep && menuFor === id && !typing) { menuFor = null; return; }
    menuFor = id;
    const li = panel.el.querySelector(`.trk-row[data-id="${id}"]`);
    if (!li) { menuFor = null; return; }
    const m = document.createElement('div');
    m.className = 'trk-menu'; m.setAttribute('role', 'menu');
    if (typing === id) {
      m.innerHTML = `<form class="trk-type"><label>Initiative total <input type="number" step="1" required aria-label="Initiative total"></label><button>Set</button><button type="button" data-m="cancel">Cancel</button></form>`;
    } else {
      const has = ENC && ENC.combatants.some((c) => c.token === id && typeof c.initiative === 'number');
      const actingNow = begun(ENC) && Engine.acting(ENC) === id;
      m.innerHTML = [actingNow ? ['delay', 'Delay (act later this round)'] : null, has && gm() ? ['card', 'Show the roll card'] : null, ['roll', has ? 'Roll again…' : 'Roll initiative…'], ['type', 'Type a result…'], has ? ['clear', 'Clear initiative'] : null, ['remove', 'Remove from the encounter']].filter(Boolean)
        .map(([a, l]) => `<button type="button" role="menuitem" data-m="${a}">${l}</button>`).join('');
    }
    li.appendChild(m);
    const f = m.querySelector('input, button'); if (f) f.focus();
  }
  function closeMenu() { menuFor = null; typing = null; const old = panel.el.querySelector('.trk-menu'); if (old) old.remove(); }

  panel.el.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!e.target.classList.contains('trk-type') || !menuFor) return;
    const n = Math.round(Number(e.target.querySelector('input').value)), id = menuFor;
    if (!Number.isFinite(n)) return;
    closeMenu();
    commit({ type: 'initiative', token: id, initiative: n, extra: { roll: { typed: true } } }, []).then((ok) => { if (ok) o.logChange(`${o.publicName(id)}: initiative ${n} (typed in)`); });
  });
  panel.el.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]');
    if (m && menuFor) {
      const id = menuFor, a = m.dataset.m;
      if (a === 'type') { typing = id; return openMenu(id, true); }
      closeMenu();
      if (a === 'roll') return openDialog(id);
      if (a === 'clear') return commit({ type: 'clear', token: id });
      if (a === 'remove') return commit({ type: 'remove', token: id });
      if (a === 'delay') return commit({ type: 'delay' });
      if (a === 'card') { const rec = o.rolls.latest(id, 'initiative'); return rec ? o.rolls.show(rec) : o.toast('No roll card for this initiative (it was typed in).'); }
      return;
    }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const id = b.dataset.id, a = b.dataset.a;
    if (a !== 'menu') closeMenu();
    if (a === 'menu') return openMenu(id);
    if (a === 'roll') return openDialog(id);
    if (a === 'set-init') return editInitiative(id, b);
    if (a === 'card') { const rec = o.rolls.latest(id, 'initiative'); return rec && (o.view() === 'gm' || !rec.gm) ? o.rolls.show(rec) : o.toast('No roll card for this initiative (it was typed in, or rolled before roll cards).'); }
    if (a === 'hide') {
      // the token's own hidden flag (the token menu's Hide / Show); a row whose token is on another map keeps its own
      const t = o.tokens()[id], c = ENC.combatants.find((x) => x.token === id) || {};
      if (t) { if (c.hidden) commit({ type: 'flags', token: id, flags: { hidden: false } }); o.setHidden(id, !(t.hidden || c.hidden)); lastKey = ''; return render(); }
      return commit({ type: 'flags', token: id, flags: { hidden: !c.hidden } });
    }
    if (a === 'defeated') {
      // defeated shows the token dead on the map (and back again); hit points are not touched
      const on = !(ENC.combatants.find((c) => c.token === id) || {}).defeated;
      return commit({ type: 'flags', token: id, flags: { defeated: on } }).then((ok) => { if (ok && o.tokens()[id]) o.setDead(id, on); });
    }
    if (a === 'reveal') { o.reveal(id); lastKey = ''; return render(); }
    if (a === 'target') return o.target(id, e.shiftKey);
    if (a === 'ping') return o.ping(id);
    if (a === 'resume') return commit({ type: 'resume', token: id });
    if (a === 'roll-all') return rollMany('all');
    if (a === 'roll-npc') return rollMany('npc');
    if (['begin', 'next', 'previous', 'next-round', 'previous-round', 'delay'].includes(a)) return commit({ type: a });
    if (a === 'end') return commit({ type: 'end' });
  });
  panel.el.addEventListener('mouseover', (e) => { const li = e.target.closest('.trk-row'); hover(li ? li.dataset.id : null); });
  panel.el.addEventListener('mouseleave', () => hover(null));
  panel.el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuFor) { closeMenu(); } });
  if (o.openButton) o.openButton.addEventListener('click', () => panel.open());

  // the GM changes a number in place: Enter sets it (the order re-sorts), Escape or leaving cancels
  function editInitiative(id, btn) {
    if (!gm()) return;
    const c = ENC.combatants.find((x) => x.token === id);
    if (!c) return;
    editing = id;
    const input = document.createElement('input');
    input.type = 'number'; input.step = 'any'; input.className = 'trk-edit'; input.value = String(c.initiative);
    input.setAttribute('aria-label', `Initiative for ${o.name(id)}`);
    btn.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true; editing = null; lastKey = '';
      const n = Number(input.value);
      if (save && input.value.trim() !== '' && Number.isFinite(n) && n !== c.initiative) commit({ type: 'set', token: id, initiative: n });
      else render();
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    input.addEventListener('blur', () => finish(true));
  }

  // dragging a row in the order: the GM any row, a player their PCs and only down; the new initiative comes from
  // the new neighbours (dropInitiative)
  const listEl = () => panel.el.querySelector('.trk-list');
  function dropIndex(y) {
    const items = [...listEl().querySelectorAll('.trk-row')].filter((li) => li.dataset.id !== dragging);
    let i = 0;
    for (const li of items) { const r = li.getBoundingClientRect(); if (y > r.top + r.height / 2) i++; }
    return i;
  }
  function markDrop(i) {
    const items = [...listEl().querySelectorAll('.trk-row')].filter((li) => li.dataset.id !== dragging);
    items.forEach((li, k) => { li.classList.toggle('drop-before', k === i); li.classList.toggle('drop-after', i === items.length && k === items.length - 1); });
  }
  panel.el.addEventListener('dragstart', (e) => {
    const li = e.target.closest && e.target.closest('.trk-row[draggable="true"]');
    if (!li) return;
    dragging = li.dataset.id;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragging);
  });
  panel.el.addEventListener('dragover', (e) => {
    if (!dragging || !listEl()) return;
    e.preventDefault();
    markDrop(dropIndex(e.clientY));
  });
  panel.el.addEventListener('drop', (e) => {
    if (!dragging) return;
    e.preventDefault();
    const id = dragging, order = lastRows.filter((r) => r.token !== id), n = dropInitiative(order, dropIndex(e.clientY));
    const was = (lastRows.find((r) => r.token === id) || {}).initiative;
    dragging = null; lastKey = '';
    if (n === null || n === was) return render();
    if (!gm() && !(n < was)) { o.toast('Players can only move their characters down the order.'); return render(); }
    commit({ type: 'move', token: id, initiative: n });
  });
  panel.el.addEventListener('dragend', () => { if (dragging) { dragging = null; lastKey = ''; render(); } });

  // the GM view marks dead creatures defeated (their turns are then skipped), once each
  const marking = new Set();
  async function markDefeated() {
    if (!gm() || busy) return;
    for (const id of newlyDefeated(ENC, o.tokens())) {
      if (marking.has(id)) continue;
      marking.add(id);
      await commit({ type: 'flags', token: id, flags: { defeated: true } });
      marking.delete(id);
    }
  }
  // the board shows the Stride bands only while an encounter is under way (begun, not ended)
  let wasOn = null;
  const tellBoard = () => { const on = begun(ENC); if (on !== wasOn) { wasOn = on; if (o.onEncounter) o.onEncounter(on); } };
  store.watch('state/encounter', (e) => { ENC = e; render(); markDefeated(); tellBoard(); });
  render(); tellBoard();
  return {
    render: () => { lastKey = ''; render(); },
    encounter: () => ENC,
    inEncounter: (id) => openEncounter(ENC) && ENC.combatants.some((c) => c.token === id),
    /** Enter Combat from the token HUD: one token or several. */
    async enter(ids) {
      for (const id of ids) {
        if (openEncounter(ENC) && ENC.combatants.some((c) => c.token === id)) continue;
        if (!(await commit({ type: 'add', token: id }))) return;
      }
      panel.open();
    },
    leave: (id) => commit({ type: 'remove', token: id }),
    tokensChanged() { render(); markDefeated(); },
  };
}
