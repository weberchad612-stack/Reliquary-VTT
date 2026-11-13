// The Party loot tab (board/loot.js): the party's purse, its stash, and each character's coins and load. Everyone
// can move things: take from the stash, put back, hand between characters, choose how an item is carried, split the
// purse evenly and hand coins over. The GM also adds custom items, identifies, appraises and removes them, and adds
// or takes coins. Players see what the party knows (vague names until identified, values when known); the GM sees
// the truth. Library items, buying and selling are Claude's (tools/loot.mjs). Docs: docs/best-practices/board.md
// (Party loot).
//
// o: {store, view() -> 'gm' | 'player', readOnly, pane, sidebar, tab ('loot'), sys (the campaign's system),
// pcs() -> [{id, name}] the party's tokens, content(keys) -> Promise {key: document} (the board's content records),
// log(text) (an audit line), setEncumbered(id, on) (put the system's encumbered condition on a token or take it off),
// gameNow() -> {now, label} | null, map() -> the current map id, trait(slug) -> {label, text} (the system's words for a
// trait and its glossary entry)}. Returns {render(), state()}.

import {
  LOOT, PURSE, lootRules, lootPath, lootItem, lootView, lootDetails, lootGroup, resolveLoot, stashMerge, takeLoot, putBack, giveLoot, setCarry, setInvested,
  coinsOf, coinLabel, coinValue, addCoins, parseCoins, takeCoins, splitCoins, carried, itemWords, partyValue,
} from './loot.js';

const wordsOf = (L) => L.words || { bulk: 'weight', encumbered: 'overloaded', invested: 'attuned', coins: '5', value: '25' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The line under an item's name: what kind of thing it is, how it is used, its level (pure). */
export function summaryHtml(d) {
  const parts = [d.kind, d.usage, d.level !== null && d.level !== undefined ? `level ${d.level}` : ''].filter(Boolean);
  return parts.length ? `<div class="lt-sum">${esc(parts.join(' · '))}</div>` : '';
}

const foundWords = (f) => (f ? [f.from ? `on ${f.from}` : '', f.where && f.where.area ? `in ${f.where.area}` : '', f.game && f.game.label ? f.game.label : ''].filter(Boolean).join(', ') : '');

/**
 * An opened item's details (pure). d: lootDetails; ctx: {gm, trait(slug) -> {label, text} (the system's words and the
 * trait glossary)}.
 */
export function detailsHtml(d, v, ctx) {
  const t = ctx.trait || ((x) => ({ label: String(x).replace(/-/g, ' '), text: '' }));
  const out = [];
  if (d.notInUse) out.push(`<div class="lt-off">${esc(d.notInUse)}</div>`);
  if (d.traits.length) out.push(`<div class="lt-traits">${d.traits.map((x) => { const e = t(x); return `<span class="lt-trait"${e.text ? ` title="${esc(e.text)}"` : ''}>${esc(e.label)}</span>`; }).join('')}</div>`);
  if (d.stats.length) out.push(`<dl class="lt-stats">${d.stats.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join('')}</dl>`);
  const gm = [];
  if (ctx.gm && d.identify) gm.push(`Identify: ${esc(d.identify.words)}${d.identify.dc ? ` DC ${d.identify.dc}` : ''}`);
  if (ctx.gm && d.sell) gm.push(`Sells for ${esc(d.sell)}`);
  if (gm.length) out.push(`<div class="lt-gm">${gm.join(' · ')}</div>`);
  if (d.text) out.push(`<p class="lt-desc">${esc(String(d.text).replace(/\n*^-{3,}$\n*/gm, '\n\n').trim())}</p>`);
  else if (v && v.unknown && !ctx.gm) out.push('<p class="lt-desc lt-dim">Not identified: what it does is unknown.</p>');
  const f = foundWords(d.found);
  const meta = [f ? `Found ${f}` : '', d.source ? `Source: ${d.source}` : ''].filter(Boolean);
  if (meta.length) out.push(`<div class="lt-found">${esc(meta.join(' · '))}</div>`);
  return `<div class="lt-details">${out.join('') || '<span class="lt-dim">Nothing more is known.</span>'}</div>`;
}

const openBtn = (name, open, label) => `<button type="button" class="lt-open" data-act="open" aria-expanded="${open}" title="${open ? 'Hide' : 'Show'} the details">${open ? '▾' : '▸'} ${label}</button>`;

/** One stash row's HTML (pure). v: lootView; d: lootDetails; ctx: {gm, write, pcs, armed, L, open, trait}. */
export function stashRowHtml(e, v, ctx, d = null) {
  const badges = [], W = wordsOf(ctx.L || {});
  if (v.unknown) badges.push(`<span class="lt-badge lt-unk" title="${ctx.gm ? `Players see: ${esc(v.real ? v.real.believed : v.name)}` : 'Not identified yet'}">${v.misidentified && ctx.gm ? 'misidentified' : 'unidentified'}</span>`);
  if (ctx.gm && v.appraised) badges.push('<span class="lt-badge">appraised</span>');
  if (v.rarity) badges.push(`<span class="lt-badge lt-${esc(v.rarity)}">${esc(v.rarity)}</span>`);
  if (v.missing) badges.push('<span class="lt-badge lt-unk">content missing</span>');
  const pcOpts = ctx.pcs.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  const take = ctx.write && ctx.pcs.length ? `<span class="lt-take"><select data-f="to" aria-label="Who takes it">${pcOpts}</select>${v.qty > 1 ? `<input type="number" data-f="qty" min="1" max="${v.qty}" value="1" aria-label="How many">` : ''}<button type="button" data-act="take">Take</button></span>` : '';
  const gmCtl = ctx.gm && ctx.write ? `<span class="lt-ctl">${v.unknown ? '<button type="button" data-act="identify" title="Identified: players see what it is">Identify</button>' : v.mysterious ? '<button type="button" data-act="unidentify" title="Back to unidentified">Unidentify</button>' : ''}${v.appraised ? '' : '<button type="button" data-act="appraise" title="Appraised: players see its value">Appraise</button>'}<button type="button" data-act="remove" class="${ctx.armed === e.id ? 'armed' : ''}" title="Take it out of the stash">${ctx.armed === e.id ? 'Remove?' : '✕'}</button></span>` : '';
  const open = !!(ctx.open && ctx.open(`s:${e.id}`));
  return `<li class="lt-row" data-id="${esc(e.id)}" data-key="s:${esc(e.id)}"><div class="lt-top">${openBtn(v.name, open, `<b class="lt-name">${v.qty > 1 ? `${v.qty} × ` : ''}${esc(v.name)}</b>`)}${badges.join('')}<span class="lt-num">${esc(v.valueLabel)}${v.bulkLabel && v.bulkLabel !== '—' ? ` · ${esc(v.bulkLabel)} ${esc(W.bulk)}` : ''}</span></div>`
    + (d ? summaryHtml(d) : '')
    + (ctx.gm && v.real ? `<div class="lt-real">Players see: ${esc(v.real.believed)}</div>` : '')
    + (open && d ? detailsHtml(d, v, ctx) : '')
    + `<div class="lt-acts">${take}${gmCtl}</div></li>`;
}

/** One character's card HTML (pure). c: carried(); ctx: {gm, view, write, pcs, coins, L, content, open, trait}. */
export function pcCardHtml(p, c, ctx) {
  const L = ctx.L, lim = c.limits, W = wordsOf(L);
  const value = c.bulk.tenths / 10;
  let bar = '';
  if (lim) {
    const pct = Math.min(100, (value / lim.max) * 100), mark = (lim.encumbered / lim.max) * 100;
    const cls = c.overMax ? 'lt-over' : c.encumbered ? 'lt-enc' : 'lt-ok';
    bar = `<div class="lt-bulk" title="${esc(W.bulk)} ${esc(L.bulkLabel(value) || '0')}: ${esc(W.encumbered)} over ${lim.encumbered}, most ${lim.max}"><div class="lt-bar ${cls}" style="width:${pct.toFixed(1)}%"></div><div class="lt-mark" style="left:${mark.toFixed(1)}%"></div></div>`
      + `<div class="lt-bulkw">${esc(W.bulk)} ${esc(L.bulkLabel(value) || '0')} / ${lim.encumbered}${c.encumbered ? ` <b class="${c.overMax ? 'lt-bad' : 'lt-warn'}">${c.overMax ? 'too much to carry' : esc(W.encumbered)}</b>` : ''}${c.investedLimit ? ` · ${esc(W.invested)} ${c.invested}/${c.investedLimit}` : ''}</div>`;
  }
  const others = ctx.pcs.filter((x) => x.id !== p.id);
  const carryOpts = (r) => {
    const opts = L.carryOptions(r.doc);
    const cur = r.item.carry || (r.doc.kind === 'armor' ? 'worn' : opts[0] === 'stowed' ? 'held' : opts[0]);
    return L.carry.filter((k) => opts.includes(k.id)).map((k) => `<option value="${k.id}"${cur === k.id ? ' selected' : ''}>${esc(k.label)}</option>`).join('');
  };
  const rows = c.rows.map((r) => {
    const v = r.view, key = `p:${p.id}:${r.i}`, open = !!(ctx.open && ctx.open(key));
    const d = lootDetails(r.item, ctx.content || {}, ctx.view || (ctx.gm ? 'gm' : 'player'), L, { carriedBy: true });
    const ctl = ctx.write ? `<select data-f="carry" aria-label="How it is carried">${carryOpts(r)}</select>`
      + (v.invested && (r.item.carry || 'worn') === 'worn' ? `<label class="lt-inv" title="Works only worn and ${esc(W.invested)}"><input type="checkbox" data-act="invest"${r.item.invested === false ? '' : ' checked'}> ${esc(W.invested)}</label>` : '')
      + `<span class="lt-more"><button type="button" data-act="putback" title="Put it in the party's stash">Stash</button>${others.length ? `<select data-f="giveto" aria-label="Give it to"><option value="">Give to…</option>${others.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select>` : ''}${v.qty > 1 ? `<input type="number" data-f="qty" min="1" max="${v.qty}" value="1" aria-label="How many">` : ''}</span>`
      : `<span class="lt-carry">${esc(r.item.carry || '')}</span>`;
    return `<li class="lt-item${r.item.carry === 'stowed' ? ' lt-stowed' : ''}" data-i="${r.i}" data-key="${esc(key)}"><div class="lt-top">${openBtn(v.name, open, `<span class="lt-name">${v.qty > 1 ? `${v.qty} × ` : ''}${esc(v.name)}</span>`)}${v.unknown && ctx.gm ? '<span class="lt-badge lt-unk">unidentified</span>' : ''}${v.rarity ? `<span class="lt-badge lt-${esc(v.rarity)}">${esc(v.rarity)}</span>` : ''}${d.notInUse ? `<span class="lt-badge lt-offb" title="${esc(d.notInUse)}">not in use</span>` : ''}<span class="lt-num">${esc(v.valueLabel !== '—' ? v.valueLabel : '')}${v.bulkLabel && v.bulkLabel !== '—' ? ` · ${esc(v.bulkLabel)}` : ''}</span></div>`
      + summaryHtml(d) + (open ? detailsHtml(d, v, ctx) : '') + `<div class="lt-acts">${ctl}</div></li>`;
  }).join('');
  const coinCtl = ctx.write ? `<form class="lt-coinform" data-coins="${esc(p.id)}"><input name="amt" placeholder="${esc(W.coins)}" aria-label="Coins"><select name="to" aria-label="Give the coins to"><option value="purse">to the purse</option>${others.map((x) => `<option value="${esc(x.id)}">to ${esc(x.name)}</option>`).join('')}${ctx.gm ? '<option value="+">add (GM)</option><option value="-">take away (GM)</option>' : ''}</select><button type="submit">Give</button></form>` : '';
  return `<section class="lt-pc" data-pc="${esc(p.id)}"><div class="lt-pch"><b>${esc(p.name)}</b><span class="lt-coins">${esc(coinLabel(ctx.coins, L))}</span></div>${bar}`
    + (c.warnings.length ? `<div class="lt-warns">${c.warnings.map((w) => `<span>${esc(w)}</span>`).join('')}</div>` : '')
    + `<ol class="lt-items">${rows || '<li class="lt-none">Carries nothing.</li>'}</ol>${coinCtl}</section>`;
}

/** The stash's filters (pure): kind chips with counts, and unidentified only. groups: {weapon: n, ...}. */
export function filtersHtml(F, counts, unknownCount) {
  const chips = [['', 'All'], ['weapon', 'Weapons'], ['armor', 'Armor'], ['consumable', 'Consumables'], ['treasure', 'Treasure'], ['other', 'Other']];
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return chips.filter(([id]) => !id || counts[id]).map(([id, l]) => `<button type="button" class="lt-chip${F.group === id ? ' on' : ''}" data-group="${id}" aria-pressed="${F.group === id}">${l} <span>${id ? counts[id] : total}</span></button>`).join('')
    + (unknownCount ? `<button type="button" class="lt-chip${F.unknown ? ' on' : ''}" data-unknown="1" aria-pressed="${!!F.unknown}">Unidentified <span>${unknownCount}</span></button>` : '');
}

/**
 * The party's worth at the top of the tab (pure). pv: partyValue as this view knows it; truth: the GM's (all values
 * known), or null.
 */
export function valueHtml(pv, L, truth = null) {
  const lab = (n) => L.priceLabel(n);
  const parts = [`stash ${lab(pv.stash)}`, `carried ${lab(pv.carried)}`];
  return `<div class="lt-value"><div class="lt-pch"><b>Party loot value</b><span class="lt-coins lt-big">${esc(lab(pv.items))}</span></div>`
    + `<div class="lt-vsub">${esc(parts.join(' · '))}${pv.unknown ? ` · <span class="lt-dim">${pv.unknown} not appraised</span>` : ''}</div>`
    + `<div class="lt-vsub">With coins (${esc(lab(pv.coins))}): <b>${esc(lab(pv.total))}</b></div>`
    + (truth && truth.items !== pv.items ? `<div class="lt-vsub lt-gm">GM: true value ${esc(lab(truth.items))} (with coins ${esc(lab(truth.total))})</div>` : '')
    + '</div>';
}

/** The GM's custom item form (pure). */
export function addFormHtml(L = {}) {
  const W = wordsOf(L), choices = L.bulkChoices || [['', 'No weight']];
  return '<form class="lt-add"><input name="name" placeholder="Name: Silver idol of a toad" required maxlength="120">'
    + `<div class="lt-frow"><input name="qty" type="number" min="1" value="1" aria-label="How many" title="How many"><input name="value" placeholder="Value each: ${esc(W.value)}" aria-label="Value each">${choices.length > 1 ? `<select name="bulk" aria-label="${esc(W.bulk)} each">${choices.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>` : ''}</div>`
    + '<textarea name="text" rows="2" placeholder="What it is (the GM sees this; players once it is identified)"></textarea>'
    + '<div class="lt-frow"><label><input type="checkbox" name="unknown"> Needs identifying</label><input name="mystery" placeholder="Players call it: a strange idol"></div>'
    + '<input name="from" placeholder="Found on or in (optional): the bugbear, the chest">'
    + '<div class="lt-frow"><button type="submit" class="lt-save">Add to the stash</button><button type="button" data-act="cancel">Cancel</button></div><p class="lt-err" hidden></p></form>';
}

export function mountLoot(o) {
  const pane = o.pane, L = lootRules(o.sys);
  pane.innerHTML = '<div class="lt-valuebox"></div><div class="lt-purse"><div class="lt-pch"><b>Party purse</b><span class="lt-coins lt-pursecoins"></span></div><div class="lt-pacts"></div></div>'
    + '<div class="lt-sh"><h3>Stash</h3><span class="lt-sub">carried by nobody</span><button type="button" class="lt-addbtn" data-act="add">+ Custom item</button></div>'
    + '<div class="lt-formbox"></div><input type="search" class="lt-q" placeholder="Search the stash" aria-label="Search the stash"><div class="lt-filters" role="group" aria-label="Show"></div><ol class="lt-stash"></ol>'
    + '<div class="lt-sh"><h3>The party</h3></div><div class="lt-pcs"></div><p class="lt-msg" role="status"></p>';
  const $ = (s) => pane.querySelector(s);
  const stashEl = $('.lt-stash'), filtersEl = $('.lt-filters'), valueEl = $('.lt-valuebox'), pcsEl = $('.lt-pcs'), purseEl = $('.lt-pursecoins'), pactsEl = $('.lt-pacts'), formBox = $('.lt-formbox'), q = $('.lt-q'), msg = $('.lt-msg');
  let STASH = [], PURSE_C = {}, ACTORS = {}, STATES = {}, CONTENT = {}, armed = null, armTimer = null, Q = '', F = { group: '', unknown: false };
  const OPEN = new Set();   // the rows opened to show their details (s:<stash id>, p:<pc>:<i>)
  const gm = () => o.view() === 'gm';
  const canWrite = () => !o.readOnly;
  const pcs = () => (o.pcs ? o.pcs() : []);
  const say = (t, bad = false) => { msg.textContent = t; msg.classList.toggle('lt-bad', bad); clearTimeout(say.t); say.t = setTimeout(() => { msg.textContent = ''; }, 4000); };
  const log = (t) => { if (o.log) o.log(`loot: ${t}`); };
  const coinsOfPc = (id) => coinsOf((STATES[id] || {}).coins, L);
  const nameOf = (id) => (pcs().find((p) => p.id === id) || {}).name || id;

  // content: the documents the stash and the party's items use, read once from the board
  async function needContent() {
    const keys = new Set();
    for (const e of STASH) if (e.data.ref) keys.add(e.data.ref);
    for (const a of Object.values(ACTORS)) for (const it of (a && a.items) || []) if (it.ref) keys.add(it.ref);
    const want = [...keys].filter((k) => !(k in CONTENT));
    if (!want.length || !o.content) return;
    const got = await o.content(want).catch(() => ({}));
    for (const k of want) CONTENT[k] = got[k] || null;
  }
  const content = () => Object.fromEntries(Object.entries(CONTENT).filter(([, d]) => d));

  function render() {
    const view = gm() ? 'gm' : 'player', C = content(), write = canWrite();
    purseEl.textContent = coinLabel(PURSE_C, L);
    // what the party's things are worth: values this view knows (appraised, or identified and common); the GM also the truth
    const party = pcs().filter((p) => ACTORS[p.id]).map((p) => ({ actor: ACTORS[p.id], coins: coinsOfPc(p.id) }));
    const known = partyValue(STASH, party, PURSE_C, C, L, 'player');
    valueEl.innerHTML = valueHtml(known, L, gm() ? partyValue(STASH, party, PURSE_C, C, L, 'gm') : null);
    pactsEl.innerHTML = write ? `<button type="button" data-act="split"${coinValue(PURSE_C, L) && pcs().length ? '' : ' disabled'}>Split evenly</button>${gm() ? `<form class="lt-pform"><input name="amt" placeholder="${esc(wordsOf(L).coins)}" aria-label="Coins"><button type="submit" name="op" value="+">Add</button><button type="submit" name="op" value="-">Take</button></form>` : ''}` : '';
    $('.lt-addbtn').hidden = !(gm() && write);
    const ctx = { gm: gm(), view, write, pcs: pcs(), armed, L, content: C, open: (k) => OPEN.has(k), trait: o.trait };
    const all = STASH.map((e) => ({ e, v: lootView(e.data, C, view, L), g: lootGroup(resolveLoot(e.data, C).doc) }));
    const counts = {};
    for (const r of all) counts[r.g] = (counts[r.g] || 0) + 1;
    filtersEl.innerHTML = STASH.length > 1 ? filtersHtml(F, counts, all.filter((r) => r.v.unknown).length) : '';
    const rows = all.filter(({ v, g }) => (!Q || v.name.toLowerCase().includes(Q)) && (!F.group || g === F.group) && (!F.unknown || v.unknown));
    stashEl.innerHTML = rows.length ? rows.map(({ e, v }) => stashRowHtml(e, v, ctx, lootDetails(e.data, C, view, L))).join('') : `<li class="lt-none">${STASH.length ? 'Nothing matches.' : 'The stash is empty. Claude adds what the party finds; take things from here onto a character.'}</li>`;
    pcsEl.innerHTML = pcs().map((p) => {
      const a = ACTORS[p.id];
      if (!a) return `<section class="lt-pc"><div class="lt-pch"><b>${esc(p.name)}</b></div><p class="lt-none">No game data yet.</p></section>`;
      return pcCardHtml(p, carried(a, coinsOfPc(p.id), C, L, view), { ...ctx, coins: coinsOfPc(p.id) });
    }).join('') || '<p class="lt-none">No player characters on the board.</p>';
  }

  // writes
  const setStash = (id, data) => (data ? o.store.set(`${LOOT}/${id}`, data) : o.store.remove(`${LOOT}/${id}`)).catch(() => say('That did not save.', true));
  const addStash = (data) => o.store.set(lootPath(), data).catch(() => say('That did not save.', true));
  const setItems = (id, items) => { ACTORS[id] = { ...ACTORS[id], items }; return o.store.update(`actors/${id}`, { items }).catch(() => say('That did not save.', true)); };
  const setCoins = (id, coins) => { STATES[id] = { ...(STATES[id] || {}), coins }; return o.store.update(`actorstate/${id}`, { coins }).catch(() => say('That did not save.', true)); };
  const setPurse = (coins) => { PURSE_C = coins; return o.store.set(PURSE, coins).catch(() => say('That did not save.', true)); };
  /** After a character's load changes: the encumbered condition on or off, and a word if it is too much. */
  function loadCheck(id) {
    const c = carried(ACTORS[id], coinsOfPc(id), content(), L, 'gm');
    if (!c.limits) return;
    if (o.setEncumbered) o.setEncumbered(id, c.encumbered);
    if (c.overMax) say(`${nameOf(id)} is carrying more than they can (${c.limits.max} ${wordsOf(L).bulk}): move something off them.`, true);
  }
  const guard = (f) => { try { f(); } catch (x) { say(x.message, true); } };
  const qtyIn = (el) => { const i = el && el.querySelector('[data-f="qty"]'); return i ? Number(i.value) || 1 : undefined; };

  pane.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.lt-chip');
    if (chip) { if (chip.dataset.unknown) F.unknown = !F.unknown; else F.group = chip.dataset.group; render(); return; }
    const act = ev.target.closest('[data-act]');
    if (act && act.dataset.act === 'open') {   // anyone, read-only too: open or close a row's details
      const k = act.closest('[data-key]').dataset.key;
      if (OPEN.has(k)) OPEN.delete(k); else OPEN.add(k);
      render(); return;
    }
    if (!act || !canWrite()) return;
    const a = act.dataset.act;
    if (a === 'add') { if (gm()) { formBox.innerHTML = addFormHtml(L); formBox.querySelector('input').focus(); } return; }
    if (a === 'cancel') { formBox.innerHTML = ''; return; }
    if (a === 'split') return guard(() => {
      const ids = pcs().map((p) => p.id);
      const r = splitCoins(PURSE_C, ids.length, L);
      if (!coinValue(r.each, L)) throw new Error('The purse is too small to split.');
      setPurse(r.left);
      for (const id of ids) { setCoins(id, addCoins(coinsOfPc(id), r.each, L)); loadCheck(id); }
      log(`the purse split ${ids.length} ways, ${coinLabel(r.each, L)} each`);
      say(`${coinLabel(r.each, L)} each; ${coinLabel(r.left, L)} stays in the purse.`);
      render();
    });
    const row = act.closest('[data-id]');
    if (row) {
      const e = STASH.find((x) => x.id === row.dataset.id);
      if (!e) return;
      const C = content();
      if (a === 'take') return guard(() => {
        const to = row.querySelector('[data-f="to"]').value;
        const r = takeLoot(e.data, (ACTORS[to] || {}).items || [], qtyIn(row), null, L, C);
        setStash(e.id, r.stash);
        setItems(to, r.items);
        log(`${nameOf(to)} took ${itemWords(r.moved, C)} from the stash`);
        loadCheck(to);
        render();
      });
      if (!gm()) return;
      if (a === 'identify' || a === 'unidentify' || a === 'appraise') {
        const d = { ...e.data };
        if (a === 'appraise') d.appraised = true;
        else if (a === 'identify') { d.identified = true; delete d.misidentified; } else { d.identified = false; delete d.misidentified; }
        setStash(e.id, d);
        log(`${itemWords(d, C)} ${a === 'appraise' ? 'appraised' : a === 'identify' ? 'identified' : 'marked unidentified'}`);
        return;
      }
      if (a === 'remove') {
        if (armed !== e.id) { armed = e.id; clearTimeout(armTimer); armTimer = setTimeout(() => { armed = null; render(); }, 4000); render(); return; }
        armed = null;
        setStash(e.id, null);
        log(`${itemWords(e.data, C)} removed from the stash`);
      }
      return;
    }
    const li = act.closest('[data-i]'), card = act.closest('[data-pc]');
    if (li && card && a === 'putback') return guard(() => {
      const id = card.dataset.pc, C = content();
      const r = putBack(ACTORS[id].items, Number(li.dataset.i), qtyIn(li), L, C);
      setItems(id, r.items);
      const m = stashMerge(STASH, r.stashItem, C, L);   // onto a matching stack in the stash, if there is one
      if (m.id) setStash(m.id, m.data); else addStash(m.data);
      log(`${nameOf(id)} put ${itemWords(r.stashItem, C)} in the stash`);
      loadCheck(id);
      render();
    });
  });
  pane.addEventListener('change', (ev) => {
    const t = ev.target, li = t.closest('[data-i]'), card = t.closest('[data-pc]');
    if (!li || !card || !canWrite()) return;
    const id = card.dataset.pc, i = Number(li.dataset.i), C = content();
    guard(() => {
      if (t.dataset.f === 'carry') {
        setItems(id, setCarry(ACTORS[id].items, i, t.value));
        log(`${nameOf(id)}'s ${itemWords(ACTORS[id].items[i], C)} now ${t.value}`);
      } else if (t.dataset.act === 'invest') {
        setItems(id, setInvested(ACTORS[id].items, i, t.checked));
        log(`${nameOf(id)} ${t.checked ? 'invested' : 'uninvested'} ${itemWords(ACTORS[id].items[i], C)}`);
      } else if (t.dataset.f === 'giveto' && t.value) {
        const to = t.value;
        const r = giveLoot(ACTORS[id].items, i, (ACTORS[to] || {}).items || [], qtyIn(li), L, C);
        setItems(id, r.from); setItems(to, r.to);
        log(`${nameOf(id)} gave ${itemWords(r.moved, C)} to ${nameOf(to)}`);
        loadCheck(to);
      } else return;
      loadCheck(id);
      render();
    });
  });
  pane.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target;
    if (!canWrite()) return;
    if (f.classList.contains('lt-add')) {
      const err = f.querySelector('.lt-err'), val = (n) => f.elements[n].value;
      try {
        const value = val('value').trim() ? coinValue(parseCoins(val('value'), L), L) : undefined;
        const g = o.gameNow ? o.gameNow() : null, where = o.map ? { map: o.map() } : null;
        const found = { ...(val('from').trim() ? { from: val('from').trim() } : {}), ...(where ? { where } : {}), ...(g ? { game: g } : {}) };
        const item = lootItem({ name: val('name'), qty: Number(val('qty')) || 1, value, bulk: f.elements.bulk ? val('bulk') || undefined : undefined, text: val('text') || undefined, identified: f.elements.unknown.checked ? false : undefined, mystery: val('mystery') || undefined, found, by: 'gm' });
        addStash(item);
        log(`${itemWords(item, {})} added to the party's stash`);
        formBox.innerHTML = '';
      } catch (x) { err.hidden = false; err.textContent = x.message; }
      return;
    }
    if (f.classList.contains('lt-pform')) return guard(() => {
      if (!gm()) return;
      const amt = parseCoins(f.elements.amt.value, L), op = ev.submitter ? ev.submitter.value : '+';
      if (op === '+') setPurse(addCoins(PURSE_C, amt, L)); else setPurse(takeCoins(PURSE_C, amt, L).left);
      log(`${coinLabel(amt, L)} ${op === '+' ? 'added to' : 'taken from'} the purse`);
      f.reset(); render();
    });
    if (f.dataset.coins) return guard(() => {
      const id = f.dataset.coins, to = f.elements.to.value, amt = parseCoins(f.elements.amt.value, L);
      if (to === '+' || to === '-') {
        if (!gm()) return;
        setCoins(id, to === '+' ? addCoins(coinsOfPc(id), amt, L) : takeCoins(coinsOfPc(id), amt, L).left);
        log(`${coinLabel(amt, L)} ${to === '+' ? 'given to' : 'taken from'} ${nameOf(id)}`);
      } else {
        const r = takeCoins(coinsOfPc(id), amt, L);
        setCoins(id, r.left);
        if (to === 'purse') setPurse(addCoins(PURSE_C, r.taken, L)); else { setCoins(to, addCoins(coinsOfPc(to), r.taken, L)); loadCheck(to); }
        log(`${nameOf(id)} gave ${coinLabel(r.taken, L)} to ${to === 'purse' ? 'the purse' : nameOf(to)}`);
      }
      loadCheck(id);
      f.reset(); render();
    });
  });
  q.addEventListener('input', () => { Q = q.value.trim().toLowerCase(); render(); });

  // live: the stash, the purse, and each PC's game data and live state, while the tab is showing
  let offs = [];
  const refresh = () => { needContent().then(render); };
  const listen = (on) => {
    for (const f of offs) if (typeof f === 'function') f();
    offs = [];
    if (!on) return;
    offs.push(o.store.watchCollection(LOOT, (l) => { STASH = l.map((x) => ({ id: x.id, data: x.data })).sort((a, b) => (a.id < b.id ? -1 : 1)); refresh(); }));
    offs.push(o.store.watch(PURSE, (d) => { PURSE_C = coinsOf(d, L); render(); }));
    for (const p of pcs()) {
      offs.push(o.store.watch(`actors/${p.id}`, (d) => { ACTORS[p.id] = d; refresh(); }));
      offs.push(o.store.watch(`actorstate/${p.id}`, (d) => { STATES[p.id] = d || {}; render(); }));
    }
  };
  if (o.sidebar) o.sidebar.onVisible(o.tab || 'loot', listen); else listen(true);
  render();
  return { render, listening: () => offs.length > 0, state: () => ({ stash: STASH, purse: PURSE_C, actors: ACTORS, states: STATES, content: CONTENT }) };
}
