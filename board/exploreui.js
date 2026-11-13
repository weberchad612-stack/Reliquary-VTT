// The Exploration tab (board/explore.js): each PC's standing activity while the party travels, with its choices and
// rules text; the party's pace; the GM's travel box (the clock moves on by the time at the party's pace); the GM's
// reminders for entering a new area; and this screen's switch for the activity badges on the tokens. Everyone can
// set activities. The activities are the system's (system.exploration); a system without them gets a note per PC.
// Docs: docs/best-practices/board.md (Exploration).
//
// o: {store, view() -> 'gm' | 'player', readOnly, pane, sidebar, tab ('exploration'), sys, party() -> Promise
// [{id, name, actor, prepared, dead}] (the PCs on this map), choices() -> {id: choice} (the board's explore/ records),
// content(keys) -> Promise {key: document}, trait(slug) -> {label, text}, log(text), advance(seconds, words) (move the
// clock on), badges: {on(), set(v)} (this screen's switch), onBadges() (redraw the map)}. Returns {render(), refresh(),
// highlight(id)}.

import { EXPLORE, exploreRules, exploreChoice, pcExplore, partyPace, availability, reminders, travelTime, durationWords } from './explore.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The activity picker for one PC (pure): optgroups by the system's groups; what it cannot do greyed with why. */
export function pickerHtml(R, id, party, choices, gm) {
  const cur = ((choices || {})[id] || {}).activity || '';
  const av = availability(R, id, party, choices);
  const opt = (x) => {
    const n = x.need, hard = n && !n.soft;
    return `<option value="${esc(x.activity.id)}"${cur === x.activity.id ? ' selected' : ''}${hard && !gm && cur !== x.activity.id ? ' disabled' : ''}>${esc(x.activity.icon || '')} ${esc(x.activity.name)}${n ? ` (${esc(n.text)})` : ''}</option>`;
  };
  const groups = R.groups.length ? R.groups : [['', '']];
  const body = groups.map(([g, label]) => {
    const list = av.filter((x) => (x.activity.group || '') === g);
    return list.length ? (label ? `<optgroup label="${esc(label)}">${list.map(opt).join('')}</optgroup>` : list.map(opt).join('')) : '';
  }).join('');
  return `<select data-f="activity" aria-label="Exploration activity"><option value=""${cur ? '' : ' selected'}>${esc(R.none.icon)} ${esc(R.none.name)}</option>${body}</select>`;
}

/** The chosen activity's choices (pure): a PC to follow, a skill, a spell. */
export function optionsHtml(R, a, id, party, options) {
  if (!a || !a.options) return '';
  const o = options || {};
  return `<div class="ex-opts">${a.options.map((f) => {
    if (f.kind === 'pc') return `<label>${esc(f.label)} <select data-o="${esc(f.key)}"><option value="">Who?</option>${party.filter((p) => p.id !== id).map((p) => `<option value="${esc(p.id)}"${o[f.key] === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`;
    if (f.kind === 'skill') {
      const list = R.skills.filter((s) => !f.skills || f.skills.includes(s.id));
      return `<label>${esc(f.label)} <select data-o="${esc(f.key)}"><option value="">Which?</option>${list.map((s) => `<option value="${esc(s.id)}"${o[f.key] === s.id ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>`;
    }
    return `<label>${esc(f.label)} <input data-o="${esc(f.key)}" value="${esc(o[f.key] || '')}" placeholder="${esc(f.placeholder || '')}" maxlength="80"></label>`;
  }).join('')}</div>`;
}

/** One PC's card (pure). card: pcExplore; ctx: {R, party, choices, gm, write, open, doc (the activity's document), trait}. */
export function cardHtml(card, ctx) {
  const R = ctx.R, a = card.activity ? R.activities.find((x) => x.id === card.activity) : null;
  const pace = a ? R.paceWords[a.pace] || '' : '';
  const choice = (ctx.choices || {})[card.id] || {};
  const control = !ctx.write ? `<b>${esc(card.icon)} ${esc(card.title)}</b>`
    : R.plain ? `<input data-f="note" value="${esc(choice.note || '')}" placeholder="What they do while travelling" maxlength="200" aria-label="What ${esc(card.name)} does while travelling">`
      : pickerHtml(R, card.id, ctx.party, ctx.choices, ctx.gm);
  const t = ctx.trait || ((x) => ({ label: x, text: '' }));
  const doc = ctx.doc;
  const rules = ctx.open && doc ? `<div class="ex-rules">${(doc.traits || []).length ? `<div class="lt-traits">${doc.traits.map((x) => { const e = t(x); return `<span class="lt-trait"${e.text ? ` title="${esc(e.text)}"` : ''}>${esc(e.label)}</span>`; }).join('')}</div>` : ''}<p class="lt-desc">${esc(String(doc.text || '').replace(/\n*^-{3,}$\n*/gm, '\n\n').trim())}</p>${doc.source && doc.source.title ? `<div class="lt-found">Source: ${esc(doc.source.title)}</div>` : ''}</div>` : '';
  return `<section class="ex-pc" data-pc="${esc(card.id)}"><div class="lt-pch"><b>${esc(card.name)}</b><span class="lt-coins">${card.speed !== null && card.speed !== undefined ? esc(R.speedText ? R.speedText(card.speed) : String(card.speed)) : ''}</span></div>`
    + `<div class="ex-pick">${control}${pace ? `<span class="ex-pace">${esc(pace)}</span>` : ''}</div>`
    + (ctx.write ? optionsHtml(R, a, card.id, ctx.party, choice.options) : '')
    + (a ? `<div class="ex-sum">${esc(card.summary)}${card.detail ? ` <b>${esc(card.detail)}</b>` : ''}</div>` : '')
    + (card.warning ? `<div class="ex-warn">⚠ ${esc(card.warning)}</div>` : '')
    + (a && a.ref ? `<button type="button" class="lt-open ex-rbtn" data-act="rules" aria-expanded="${!!ctx.open}">${ctx.open ? '▾' : '▸'} Rules text</button>${rules}` : '')
    + '</section>';
}

export function mountExplore(o) {
  const pane = o.pane, R = exploreRules(o.sys);
  pane.innerHTML = '<div class="ex-pacebox"></div><div class="ex-travel"></div><div class="ex-rem"></div>'
    + '<label class="ex-switch"><input type="checkbox" data-f="badges"> Show activity badges on tokens <span class="lt-dim">(this screen)</span></label>'
    + '<div class="lt-sh"><h3>The party</h3><span class="lt-sub">what each does while travelling</span></div><div class="ex-pcs"></div><p class="lt-msg" role="status"></p>';
  const $ = (s) => pane.querySelector(s);
  const paceEl = $('.ex-pacebox'), travelEl = $('.ex-travel'), remEl = $('.ex-rem'), pcsEl = $('.ex-pcs'), msg = $('.lt-msg'), sw = $('[data-f=badges]');
  let PARTY = [], DOCS = {}, OPEN = new Set(), shown = false, pending = null;
  const gm = () => o.view() === 'gm';
  const write = () => !o.readOnly;
  const say = (t, bad = false) => { msg.textContent = t; msg.classList.toggle('lt-bad', bad); clearTimeout(say.t); say.t = setTimeout(() => { msg.textContent = ''; }, 4000); };
  const choices = () => (o.choices ? o.choices() : {});

  function render() {
    if (!shown) return;
    const C = choices();
    const g = partyPace(R, PARTY, C);
    paceEl.innerHTML = `<div class="lt-value"><div class="lt-pch"><b>Party pace</b><span class="lt-coins lt-big">${g ? esc(R.paceHeadline ? R.paceHeadline(g) : String(g.perMinute)) : '—'}</span></div>`
      + (g ? `<div class="lt-vsub">${esc(R.paceText(g))}</div><div class="lt-vsub">Slowest: ${esc(g.slowestText || g.slowest)}${g.why ? `; ${esc(g.why)}` : ''}</div>${g.limit ? `<div class="lt-vsub ex-warn">${esc(g.limit.text)}</div>` : ''}` : '<div class="lt-vsub">No Speeds known yet.</div>')
      + '</div>';
    travelEl.innerHTML = gm() && write() ? `<form class="ex-tform"><b>Travel</b><input name="v" type="number" min="0" step="any" value="${esc(travelEl.dataset.v || '')}" placeholder="600" aria-label="How far or how long"><select name="u" aria-label="Unit">${[['ft', 'feet'], ['mi', 'miles'], ['min', 'minutes'], ['hr', 'hours']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>${(R.terrain || []).length > 1 ? `<select name="t" aria-label="Terrain">${R.terrain.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>` : ''}<button type="submit">Travel</button></form><div class="lt-vsub">GM: the clock moves on by the time at the party's pace.</div>` : '';
    const rem = gm() ? reminders(R, PARTY, C) : [];
    remEl.innerHTML = rem.length ? `<div class="ex-remind"><b>On entering a new area</b><ul>${rem.map((r) => `<li>${esc(r.text)}</li>`).join('')}</ul></div>` : '';
    sw.checked = !o.badges || o.badges.on();
    const ctxBase = { R, party: PARTY, choices: C, gm: gm(), write: write(), trait: o.trait };
    pcsEl.innerHTML = PARTY.length ? PARTY.map((p) => {
      const card = pcExplore(R, p.id, PARTY, C), a = card.activity ? R.activities.find((x) => x.id === card.activity) : null;
      return cardHtml(card, { ...ctxBase, open: OPEN.has(p.id), doc: a && a.ref ? DOCS[a.ref] : null });
    }).join('') : '<p class="lt-none">No player characters with game data on this map.</p>';
  }
  async function refresh() {
    if (!shown) return;
    PARTY = o.party ? await o.party().catch(() => []) : [];
    const refs = R.activities.map((a) => a.ref).filter((k) => k && !(k in DOCS));
    if (refs.length && o.content) { const got = await o.content(refs).catch(() => ({})); for (const k of refs) DOCS[k] = got[k] || null; }
    render();
    if (pending) { const id = pending; pending = null; flash(id); }
  }
  function flash(id) {
    const el = pcsEl.querySelector(`[data-pc="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    el.classList.remove('cm-flash'); void el.offsetWidth; el.classList.add('cm-flash');
  }
  function save(id, f) {
    const C = choices(), prev = C[id] || {};
    try {
      const data = exploreChoice({ activity: 'activity' in f ? f.activity : prev.activity, options: 'options' in f ? f.options : prev.options, note: 'note' in f ? f.note : prev.note, by: gm() ? 'gm' : 'player' }, R);
      o.store.set(`${EXPLORE}/${id}`, data).catch(() => say('That did not save.', true));
      const card = pcExplore(R, id, PARTY, { ...C, [id]: data });
      if (o.log) o.log(`exploration: ${card.name} is ${data.activity ? card.title : data.note || 'just travelling'}${card.detail ? ` (${card.detail})` : ''}`);
    } catch (x) { say(x.message, true); }
  }
  pane.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t === sw) { if (o.badges) o.badges.set(sw.checked); if (o.onBadges) o.onBadges(); return; }
    const card = t.closest('[data-pc]');
    if (!card || !write()) return;
    const id = card.dataset.pc;
    if (t.dataset.f === 'activity') save(id, { activity: t.value || null, options: {} });
    else if (t.dataset.f === 'note') save(id, { note: t.value });
    else if (t.dataset.o) { const prev = (choices()[id] || {}).options || {}; save(id, { options: { ...prev, [t.dataset.o]: t.value } }); }
  });
  pane.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act=rules]');
    if (!b) return;
    const id = b.closest('[data-pc]').dataset.pc;
    if (OPEN.has(id)) OPEN.delete(id); else OPEN.add(id);
    render();
  });
  pane.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target;
    if (!f.classList.contains('ex-tform') || !gm() || !write()) return;
    try {
      const g = partyPace(R, PARTY, choices()), u = f.elements.u.value, v = Number(f.elements.v.value);
      const terr = f.elements.t ? (R.terrain || []).find((x) => x[0] === f.elements.t.value) : null;
      const r = travelTime(g, { value: v, unit: u }, terr ? terr[2] : 1);
      const words = `${v} ${{ ft: 'feet', mi: 'miles', min: 'minutes', hr: 'hours' }[u]}${terr && terr[2] !== 1 ? ` through ${terr[1].toLowerCase()}` : ''}`;
      if (o.advance) o.advance(r.seconds, `the party travels ${words} (${durationWords(r.seconds)})`);
      if (g && g.limit && r.seconds > g.limit.minutes * 60) say(`Longer than the pace can be kept up: ${g.limit.text}.`, true);
      else say(`Travelled ${words}: ${durationWords(r.seconds)}.`);
      travelEl.dataset.v = '';
    } catch (x) { say(x.message, true); }
  });
  if (o.sidebar) o.sidebar.onVisible(o.tab || 'exploration', (on) => { shown = on; if (on) refresh(); });
  else { shown = true; refresh(); }
  return {
    render, refresh,
    /** Show one PC's card (the token badge was clicked). */
    highlight(id) { if (shown && PARTY.length) flash(id); else pending = id; },
  };
}
