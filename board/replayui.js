// The Replay tab and the "Claude is adjudicating" banner (board/replay.js holds the records and the rules). Every screen
// follows the shared step counter: when a step is revealed, each board frames it (camera follows, per viewer), slides
// the moved tokens along their path, rings the actor in its side's colour (the highlight standard) and plays its
// visual effects (written as fx records by the board that revealed it). Anyone may press Next; the board that wins
// the claim writes the step's changes. Docs: docs/best-practices/board.md (replay).
//
// o: {store, view() -> 'gm' | 'player', readOnly, pane, sidebar, tab ('replay'), banner (element over the map),
//     hooks: {name(id), visible(id) (this view may see the token), frame(points), glide(id, from, to, via) -> ms,
//     ring(id, side), playFx(data), toast(text)}}
// Listeners: the replay collection and the adjudicating record, always (every screen plays the steps and shows the
// banner, whichever tab is open): two. mountAdjudicating() is the banner alone (the area page has no Replay tab).

import {
  REPLAY, ADJ_PATH, ADJ_STALE, CLAIM_WAIT, currentReplay, waitingBehind, remaining, claim, claimStood, stepWrites,
  focusOf, adjState, adjLine, quietWords,
} from './replay.js';
import { auditPath, auditEntry } from './audit.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SIDE_WORDS = { pc: 'PC', npc: 'NPC', env: 'Event' };
const NEXT_WORDS = { pc: 'a PC action', npc: 'an NPC action', env: 'an event' };
const PREF = 'reliquary.replay';   // per browser: {cam, pace}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function loadPref() { try { return { cam: true, pace: 3.5, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch { return { cam: true, pace: 3.5 }; } }
function savePref(p) { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* storage may be off */ } }

export function mountReplay(o) {
  const pane = o.pane, h = o.hooks;
  const pref = loadPref();
  let LIST = [], cur = null, shownN = null, busy = false, auto = null, played = new Set();
  const gm = () => o.view() === 'gm';
  const canAct = () => !o.readOnly;
  const key = () => Math.random().toString(36).slice(2, 10);

  // ---------- the tab ----------
  // a step for the GM's eyes only (a hidden creature's) is not shown to players at all, nor counted
  const shows = (s) => gm() || !s.gm;
  function stepHtml(s, i, rep, last) {
    const side = s.side, who = s.who || (s.actor ? h.name(s.actor) : ''), text = s.text;
    return `<li class="rp-step ${side}${last ? ' last' : ''}${s.gm && gm() ? ' gm-only' : ''}" data-step="${i}" tabindex="0" title="Play this step again">
      <div class="rp-head"><span class="rp-chip ${side}">${SIDE_WORDS[side]}</span><span class="rp-who">${esc(who)}</span><span class="rp-no">#${(cur ? cur.data.steps.slice(0, i + 1).filter(shows).length : i + 1)}</span></div>
      <div class="rp-text">${esc(text)}</div></li>`;
  }
  function render() {
    const rep = cur && cur.data;
    if (!rep) { pane.innerHTML = '<p class="rp-empty">Nothing to replay. When Claude resolves several actions at once, they wait here so the table can watch them one step at a time.</p>'; badge(); return; }
    const n = rep.n || 0, left = rep.steps.length - n, behind = waitingBehind(LIST, cur);
    const L = rep.steps.filter(shows).length, seenN = rep.steps.slice(0, n).filter(shows).length, seenLeft = L - seenN;
    const status = n === 0 ? `${L} step${L === 1 ? '' : 's'} resolved. Press Next to reveal them one at a time.`
      : seenLeft ? `Step ${seenN} of ${L} · ${seenLeft} left` : left ? `All ${L} step${L === 1 ? '' : 's'} revealed; the GM's steps go on.` : `All ${L} step${L === 1 ? '' : 's'} revealed.`;
    const ctl = canAct() ? `<div class="rp-ctl">
        <button type="button" class="rp-go" data-rp="next"${left && !busy ? '' : ' disabled'}>${n === 0 ? '▶ Start' : 'Next ▶'}</button>
        <button type="button" data-rp="auto"${left ? '' : ' disabled'} aria-pressed="${!!auto}">${auto ? '⏸ Pause' : '⏯ Auto'}</button>
        <button type="button" data-rp="all"${left && !busy ? '' : ' disabled'} title="Reveal every remaining step now, without effects">⏭ Show all</button></div>` : '';
    const opts = `<div class="rp-opts"><label><input type="checkbox" data-rp="cam"${pref.cam ? ' checked' : ''}> Camera follows</label>
      ${canAct() ? `<label>Auto pace <input type="range" data-rp="pace" min="1" max="8" step="0.5" value="${pref.pace}"> <span class="rp-pace">${pref.pace} s</span></label>` : ''}</div>`;
    const lastShown = rep.steps.slice(0, n).map((s, i) => (shows(s) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    const done = rep.steps.slice(0, n).map((s, i) => (shows(s) ? stepHtml(s, i, rep, i === lastShown) : '')).join('');
    let after = '';
    if (left) {
      const nx = rep.steps.slice(n).find(shows);
      after = gm()
        ? rep.steps.slice(n).map((s, j) => `<li class="rp-step pending ${s.side}"><div class="rp-head"><span class="rp-chip ${s.side}">${SIDE_WORDS[s.side]}</span><span class="rp-who">${esc(s.who || '')}</span><span class="rp-no">#${n + j + 1}</span></div><div class="rp-text">${esc(s.text)}</div></li>`).join('')
        : nx ? `<li class="rp-step pending ${nx.side}"><div class="rp-text">Next: ${NEXT_WORDS[nx.side]}…</div></li>` : '';
    } else if (rep.stop) after = `<li class="rp-stop"><b>Waiting for reactions.</b> ${esc(rep.stop)}</li>`;
    else after = `<li class="rp-end">The end of this replay${(rep.narration || []).length ? ': the story goes on in the chat' : ''}.</li>`;
    pane.innerHTML = `<div class="rp-top"><div class="rp-title">${esc(rep.title || 'Resolved actions')}</div><p class="rp-status">${esc(status)}${behind ? ` <span class="rp-behind">${behind} more replay${behind === 1 ? '' : 's'} waiting after this one</span>` : ''}</p>${ctl}${opts}</div><ol class="rp-list">${done}${after}</ol>`;
    const last = pane.querySelector('.rp-step.last'); if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest' });
    badge();
  }
  function badge() {
    if (!o.sidebar) return;
    const left = remaining(cur && cur.data);
    if (o.sidebar.showing(o.tab || 'replay')) o.sidebar.setBadge(o.tab || 'replay', 0);
    else o.sidebar.setBadge(o.tab || 'replay', left);
  }
  pane.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rp]');
    if (b && b.dataset.rp === 'next') { stopAuto(); next(); return; }
    if (b && b.dataset.rp === 'auto') { if (auto) stopAuto(); else startAuto(); return; }
    if (b && b.dataset.rp === 'all') { stopAuto(); showAll(); return; }
    const st = e.target.closest('.rp-step[data-step]');
    if (st) again(Number(st.dataset.step));
  });
  pane.addEventListener('keydown', (e) => { const st = e.target.closest('.rp-step[data-step]'); if (st && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); again(Number(st.dataset.step)); } });
  pane.addEventListener('change', (e) => { const b = e.target.closest('[data-rp]'); if (b && b.dataset.rp === 'cam') { pref.cam = b.checked; savePref(pref); } });
  pane.addEventListener('input', (e) => {
    const b = e.target.closest('[data-rp="pace"]'); if (!b) return;
    pref.pace = Number(b.value) || 3.5; savePref(pref);
    const s = pane.querySelector('.rp-pace'); if (s) s.textContent = `${pref.pace} s`;
  });

  // ---------- revealing (this screen pressed Next) ----------
  async function next({ quiet = false } = {}) {
    if (busy || !cur || !canAct()) return false;
    busy = true; render();
    try {
      const path = `${REPLAY}/${cur.id}`;
      const rep = await o.store.get(path);
      if (!rep || remaining(rep) === 0) return false;
      const k = rep.n || 0, at = Date.now(), my = key();
      const c = claim(rep, { at, key: my });
      if (quiet) c.revealed[k].quiet = true;
      await o.store.update(path, c);
      await wait(CLAIM_WAIT);
      const back = await o.store.get(path);
      if (!claimStood(back, k, my)) return true;   // another screen revealed it at the same moment: its writes come
      const now = {};
      for (const ch of rep.steps[k].changes || []) now[ch.path] = await o.store.get(ch.path).catch(() => null);
      const { ops, warnings } = stepWrites(rep, k, now, { at, key: my });
      const fxLater = [];
      for (const op of ops) {
        if (op.path.startsWith('fx/')) { if (!quiet) fxLater.push(op); continue; }
        if (op.op === 'remove') await o.store.remove(op.path); else await o.store.set(op.path, op.data);
      }
      for (const w of warnings) await o.store.set(auditPath(), auditEntry({ text: `Replay "${rep.title}", step ${k + 1}: ${w}`, by: gm() ? 'gm' : 'player', level: 'warn' }));
      // the effects after the camera and the slides, as each screen plays them (play() below)
      if (fxLater.length) setTimeout(() => { for (const op of fxLater) o.store.set(op.path, { ...op.data, ts: Date.now() }).catch(() => {}); }, settleMs(rep.steps[k]));
      return true;
    } catch (e) {
      h.toast(`Could not reveal the step (${e.message || e}).`);
      return false;
    } finally { busy = false; render(); }
  }
  async function showAll() { while (cur && remaining(cur.data) > 0) { const ok = await next({ quiet: true }); if (!ok) break; await wait(50); } }
  function startAuto() {
    auto = true; render();
    const tick = async () => {
      if (!auto) return;
      if (!cur || remaining(cur.data) === 0) { stopAuto(); return; }
      await next();
      if (auto) auto = setTimeout(tick, pref.pace * 1000);
    };
    tick();
  }
  function stopAuto() { if (auto && auto !== true) clearTimeout(auto); auto = null; render(); }

  // ---------- playing (every screen, as the counter moves) ----------
  const settleMs = (s) => 300 + 450 + ((s.moves || []).length ? 900 : 0);
  async function play(rep, k, { local = false } = {}) {
    const s = rep.steps[k];
    if (!s || (s.gm && !gm())) return;
    const pts = focusOf(s).filter((p) => Array.isArray(p) || h.visible(p));
    if (pref.cam && pts.length && h.frame(pts)) await wait(450);
    let longest = 0;
    for (const m of s.moves || []) if (h.visible(m.token)) longest = Math.max(longest, h.glide(m.token, m.from, m.to, m.via) || 0);
    if (s.actor && h.visible(s.actor)) h.ring(s.actor, s.side);
    if (local) {
      await wait(longest);
      (s.posts || []).filter((p) => p.c === 'fx').forEach((p, i) => setTimeout(() => h.playFx({ ...p.data, ts: Date.now() }), i * 220));
    }
  }
  function again(k) { const rep = cur && cur.data; if (rep && k < (rep.n || 0)) play(rep, k, { local: true }); }

  function onList(list) {
    LIST = list;
    const was = cur && cur.id, prevN = shownN;
    cur = currentReplay(list);
    const rep = cur && cur.data, n = rep ? rep.n || 0 : 0;
    if (!cur) { shownN = null; render(); return; }
    if (cur.id !== was) {
      shownN = n;   // a replay this screen opens on: nothing to play; a new one: show the tab
      if (n === 0 && o.sidebar && !o.readOnly) o.sidebar.select(o.tab || 'replay');
    } else if (prevN !== null && n > prevN) {
      // steps revealed since: play each (after the claim has had time to stand and the changes to land)
      const from = prevN; shownN = n;
      (async () => {
        await wait(CLAIM_WAIT + 300);
        for (let k = from; k < n; k++) {
          const tag = `${cur.id}:${k}`;
          if (played.has(tag)) continue;
          played.add(tag);
          if (rep.revealed && rep.revealed[k] && rep.revealed[k].quiet) continue;
          await play(rep, k);
          if (k < n - 1) await wait(400);
        }
      })();
    } else shownN = n;
    render();
  }
  let first = true;
  o.store.watchCollection(REPLAY, (l) => { if (first) { first = false; cur = currentReplay(l); shownN = cur ? cur.data.n || 0 : null; LIST = l; render(); return; } onList(l); });

  const adjUi = o.banner ? mountAdjudicating({ store: o.store, view: o.view, readOnly: o.readOnly, el: o.banner }) : null;

  return {
    render, refresh: () => { render(); if (adjUi) adjUi.paint(); },
    current: () => (cur ? { id: cur.id, n: cur.data.n || 0, steps: cur.data.steps.length } : null),
    next, showAll, banner: () => (adjUi ? adjUi.text() : null),
  };
}

/**
 * The "Claude is adjudicating" banner over the map (state/adjudicating; board/replay.js): on every screen, the tactical
 * board and the area page alike. One listener. o: {store, view() -> 'gm' | 'player', readOnly, el}.
 */
export function mountAdjudicating(o) {
  const ban = o.el;
  let adj = null, seen = 0, tick = null, adjFirst = true;
  function paintBanner() {
    if (!ban) return;
    const now = Date.now(), st = adjState(adj, seen, now);
    if (st === 'stale' && adj && o.view() === 'gm' && !o.readOnly) {
      const was = adj; adj = null;
      o.store.remove(ADJ_PATH).then(() => o.store.set(auditPath(), auditEntry({ text: `The "Claude is adjudicating" banner timed out: nothing from Claude for ${quietWords(ADJ_STALE)} (begun ${was.since || '?'})`, by: 'gm', level: 'warn' }))).catch(() => {});
    }
    if (st === 'off' || st === 'stale') { ban.hidden = true; if (tick) { clearInterval(tick); tick = null; } return; }
    const line = st === 'slow' ? `Still working on it… <span class="adj-time">${esc(quietWords(now - Date.parse(adj.since || '') || 0))}</span>` : esc(adjLine(adj, now));
    ban.hidden = false;
    ban.classList.toggle('slow', st === 'slow');
    ban.innerHTML = `<span class="adj-mark" aria-hidden="true">⚖</span><span class="adj-line" role="status">${line}</span>${o.view() === 'gm' && !o.readOnly ? '<button type="button" class="adj-clear" title="Take the banner down (the GM\'s only)">Clear</button>' : ''}`;
    if (!tick) tick = setInterval(paintBanner, 1000);
  }
  if (ban) ban.addEventListener('click', (e) => {
    if (!e.target.closest('.adj-clear') || o.view() !== 'gm') return;
    adj = null; paintBanner();
    o.store.remove(ADJ_PATH).then(() => o.store.set(auditPath(), auditEntry({ text: 'The GM took down the "Claude is adjudicating" banner', by: 'gm' }))).catch(() => {});
  });
  o.store.watch(ADJ_PATH, (d) => {
    const now = Date.now();
    // first sight: as old as the record says (capped at now: clocks differ); every change after: now
    seen = adjFirst && d ? Math.min(now, Date.parse(d.at || '') || now) : now;
    adjFirst = false; adj = d; paintBanner();
  });

  return { paint: paintBanner, text: () => (ban && !ban.hidden ? ban.textContent : null) };
}
