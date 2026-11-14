// The subsystem card (engine/events/subsystem.js; docs/best-practices/events.md, Subsystems): pinned above the chat
// while a subsystem is under way. Players see it once the GM or Claude shows it, and only its revealed parts (the
// user's decision, 2026-11-13): the points and progress, the parts and notes revealed, the skills revealed. The GM
// sees every subsystem under way with its DCs and thresholds, marked GM only, and whether the players see it.
//
// o: {store, view() -> 'gm' | 'player', pane (the chat pane's body), E (the engine: playerView, dcShift)}.
// Returns {render(), cards()}.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const bar = (v, goal) => (goal ? `<span class="ss-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${Math.min(v, goal)}"><span style="width:${Math.max(0, Math.min(100, (v / goal) * 100))}%"></span></span>` : '');

/** The players' card (pure): what playerView gives. */
export function playerCardHtml(v) {
  const tracks = Object.values(v.tracks || {}).map((t) => `<div class="ss-track"><span class="ss-k">${esc(t.label)}</span><b>${t.value}${t.goal ? ` / ${t.goal}` : ''}</b>${bar(t.value, t.goal)}${t.reached.length ? `<span class="ss-reached">${t.reached.map(esc).join(' · ')}</span>` : ''}</div>`).join('');
  const parts = (v.parts || []).map((p) => `<li class="ss-part${p.done ? ' ss-done' : ''}"><b>${esc(p.label)}</b>${p.goal && !p.per ? ` <span class="ss-k">${p.value} / ${p.goal}</span>${bar(p.value, p.goal)}` : ''}${p.per && Object.keys(p.per).length ? ` <span class="ss-k">${Object.entries(p.per).map(([w, n]) => `${esc(w)} ${n}/${p.goal}`).join(', ')}</span>` : ''}${p.done ? ' <span class="ss-k">✓ overcome</span>' : ''}`
    + `${p.text ? `<p>${esc(p.text)}</p>` : ''}${p.checks.length ? `<p class="ss-k">Try: ${p.checks.map((c) => esc(c.skill)).join(', ')}</p>` : ''}${p.notes.map((n) => `<p class="ss-note">${esc(n)}</p>`).join('')}</li>`).join('');
  const round = v.round !== undefined ? `<span class="ss-k">Round ${v.round}${v.limit ? ` of ${v.limit}` : ''}</span>` : '';
  const status = v.status === 'success' ? ' · succeeded' : v.status === 'failure' ? ' · failed' : '';
  return `<section class="ss-card" aria-label="${esc(v.title)}"><div class="ss-head"><b>${esc(v.title)}</b>${round}<span class="ss-k">${esc(status)}</span></div>${tracks}${parts ? `<ul class="ss-parts">${parts}</ul>` : ''}</section>`;
}

/** The GM's card (pure): everything, with DCs (adjusted) and thresholds. */
export function gmCardHtml(id, s, shift = 0) {
  const th = (list) => (list || []).map((t) => `<span class="ss-th${t.reached !== undefined ? ' ss-hit' : ''}" title="${esc(t.text || '')}">${t.reached !== undefined ? '✓' : '○'} ${t.at} ${esc(t.label || t.id)}</span>`).join('');
  const tracks = Object.values(s.tracks || {}).map((t) => `<div class="ss-track"><span class="ss-k">${esc(t.label)}</span><b>${t.value || 0}${t.goal ? ` / ${t.goal}` : ''}</b>${bar(t.value || 0, t.goal)}<span class="ss-ths">${th(t.thresholds)}</span></div>`).join('');
  const parts = (s.parts || []).map((p) => `<li class="ss-part${p.done ? ' ss-done' : ''}${p.revealed ? '' : ' ss-hidden'}"><b>${esc(p.label)}</b>${p.revealed ? '' : ' <span class="ss-k">(hidden)</span>'}`
    + `${p.goal ? ` <span class="ss-k">${p.individual ? Object.entries(p.per || {}).map(([w, n]) => `${esc(w)} ${n}`).join(', ') || '—' : `${p.value || 0}`} / ${p.goal}</span>` : p.value !== undefined ? ` <span class="ss-k">${p.value}</span>` : ''}`
    + `${(p.checks || []).length ? `<p class="ss-k">${p.checks.map((c) => `${esc(c.skill)}${c.dc !== undefined ? ` DC ${c.dc + shift}` : ''}${c.revealed ? '' : '*'}`).join(', ')}</p>` : ''}<span class="ss-ths">${th(p.thresholds)}</span></li>`).join('');
  return `<section class="ss-card ss-gm" aria-label="${esc(s.title)} (GM)"><div class="ss-head"><b>${esc(s.title)}</b><span class="ss-k">${esc(s.kind)} · ${esc(s.status)}${s.rounds ? ` · round ${s.rounds.n || 0}${s.rounds.limit ? `/${s.rounds.limit}` : ''}` : ''}${shift ? ` · DCs +${shift}` : ''} · ${s.shown ? 'players see it' : 'hidden from players'}</span><span class="ss-gmtag">GM</span></div>${tracks}${parts ? `<ul class="ss-parts">${parts}</ul>` : ''}<p class="ss-k">* not revealed to the players. id: ${esc(id)}</p></section>`;
}

export function mountSubsystems(o) {
  const box = document.createElement('div');
  box.className = 'ss-cards';
  o.pane.insertBefore(box, o.pane.firstChild);
  let LIST = [];
  const shown = () => {
    const gm = o.view() === 'gm';
    return LIST.filter((e) => e.data && (gm ? ['active'].includes(e.data.status) || (e.data.shown && e.data.status !== 'waiting' && e.data.status !== 'done') : e.data.shown && e.data.status !== 'waiting' && e.data.status !== 'done'));
  };
  function render() {
    const gm = o.view() === 'gm';
    box.innerHTML = shown().map((e) => (gm ? gmCardHtml(e.id, e.data, o.E.dcShift(e.data)) : playerCardHtml(o.E.playerView(e.data)))).join('');
    box.hidden = !box.innerHTML;
  }
  o.store.watchCollection('subsystems', (l) => { LIST = l; render(); });
  render();
  return { render, cards: () => shown().map((e) => e.id) };
}
