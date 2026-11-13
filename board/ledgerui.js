// The Ledger tab (the GM's only): the campaign ledger, the GM's memory (board/ledger.js). Search, kind filters (Open
// picks every open thread, quest and timed event), the story so far, and the GM's own entries: add, edit, close or
// reopen, remove (two clicks). An entry's subject searches for it; its links show the chat message or replay it came
// from. Never drawn, and never watched, in the player view. Docs: docs/best-practices/board.md (the ledger).
//
// o: {store, view() -> 'gm' | 'player', readOnly, pane, sidebar, tab ('ledger'), gameNow() -> {now, label} | null,
// map() -> the current map id, showLink(path), log(text) (an audit line)}. Returns {render(), entries(), listening(),
// filter(f)}.

import { LEDGER, KINDS, KIND_IDS, ledgerEntry, editEntry, ledgerPath, ledgerRows, storySoFar, hasStatus, entryLine, ledgerHtml } from './ledger.js';

const SHOWN = 300;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The add/edit form's HTML (pure). e: the entry being edited, or null for a new one. */
export function formHtml(e = null) {
  const v = e || {};
  const kinds = KIND_IDS.map((k) => `<option value="${k}"${(v.kind || 'improv') === k ? ' selected' : ''}>${KINDS[k].icon} ${esc(KINDS[k].label)}</option>`).join('');
  const cur = v.source === 'added' ? `added-${v.addedBy || 'user'}` : (v.source || '');
  const src = [['', 'Source: not said'], ['adventure', 'From the adventure'], ['added-user', 'Added by me (the user)'], ['added-claude', 'Added by Claude']]
    .map(([s, l]) => `<option value="${s}"${cur === s ? ' selected' : ''}>${l}</option>`).join('');
  return `<form class="lg-form" data-edit="${esc(e ? e.id : '')}">`
    + `<div class="lg-frow"><select name="kind" aria-label="Kind">${kinds}</select><select name="source" aria-label="Source">${src}</select></div>`
    + `<input name="title" placeholder="Title (optional)" value="${esc(v.title || '')}" maxlength="120">`
    + `<textarea name="text" rows="4" placeholder="What happened, what was invented, the secret, the ruling..." required>${esc(v.text || '')}</textarea>`
    + `<input name="subjects" placeholder="Who and what it is about: Grukk, the lantern lady" value="${esc((v.subjects || []).join(', '))}">`
    + `<input name="area" placeholder="Where (the adventure's area key)" value="${esc((v.where && v.where.area) || '')}">`
    + `<div class="lg-frow"><button type="submit" class="lg-save">${e ? 'Save changes' : 'Add to the ledger'}</button><button type="button" data-act="cancel">Cancel</button></div>`
    + '<p class="lg-err" hidden></p></form>';
}

export function mountLedger(o) {
  const pane = o.pane;
  pane.innerHTML = '<div class="lg-head"><input type="search" class="lg-q" placeholder="Search the ledger: names, places, words" aria-label="Search the ledger">'
    + '<div class="lg-kinds" role="group" aria-label="Show"></div>'
    + '<div class="lg-tools"><button type="button" class="lg-add" data-act="add">+ Add entry</button><button type="button" class="lg-storybtn" data-act="story" aria-pressed="false">📜 Story so far</button></div></div>'
    + '<div class="lg-formbox"></div><ol class="lg-list"></ol><div class="lg-foot"></div>';
  const q = pane.querySelector('.lg-q'), kindsEl = pane.querySelector('.lg-kinds'), list = pane.querySelector('.lg-list');
  const formBox = pane.querySelector('.lg-formbox'), foot = pane.querySelector('.lg-foot'), storyBtn = pane.querySelector('.lg-storybtn');
  let LIST = [], F = { q: '', kind: '' }, story = false, armed = null, armTimer = null, editing = null;
  const gm = () => o.view() === 'gm';
  const canWrite = () => gm() && !o.readOnly;

  function drawKinds() {
    const counts = {};
    for (const e of LIST) counts[e.data.kind] = (counts[e.data.kind] || 0) + 1;
    const open = LIST.filter((e) => hasStatus(e.data.kind) && e.data.status === 'open').length;
    const chip = (id, label, n) => `<button type="button" class="lg-kchip${F.kind === id ? ' on' : ''}" data-kind="${id}" aria-pressed="${F.kind === id}">${label}${n !== undefined ? ` <span>${n}</span>` : ''}</button>`;
    kindsEl.innerHTML = chip('', 'All', LIST.length) + chip('open', 'Open', open) + KIND_IDS.filter((k) => counts[k]).map((k) => chip(k, `${KINDS[k].icon} ${KINDS[k].label}`, counts[k])).join('');
  }
  function render() {
    if (!gm()) { list.innerHTML = ''; foot.innerHTML = ''; kindsEl.innerHTML = ''; formBox.innerHTML = ''; return; }   // never drawn for players
    drawKinds();
    storyBtn.setAttribute('aria-pressed', String(story));
    pane.querySelector('.lg-add').hidden = !canWrite();
    const ed = (e) => ledgerHtml(e, { editable: canWrite(), armed });
    if (story) {
      const s = storySoFar(LIST);
      const sec = (title, rows) => `<li class="lg-sec">${esc(title)} <span>${rows.length}</span></li>${rows.map(ed).join('') || '<li class="lg-none">None.</li>'}`;
      list.innerHTML = sec('The story so far', s.summaries) + sec('Timed events due', s.events) + sec('Open quests', s.quests) + sec('Open threads', s.threads);
      foot.innerHTML = '';
      return;
    }
    const rows = ledgerRows(LIST, F);
    list.innerHTML = rows.length ? rows.slice(0, SHOWN).map(ed).join('')
      : `<li class="lg-none">${LIST.length ? 'Nothing matches.' : 'The ledger is empty. Claude writes every improvisation, secret, ruling, thread and quest here as the game goes; add your own with + Add entry.'}</li>`;
    foot.innerHTML = rows.length > SHOWN ? `<span class="lg-more">${rows.length - SHOWN} more: search to narrow it.</span>` : '';
  }
  function openForm(e = null) {
    if (!canWrite()) return;
    editing = e ? e.id : '';
    formBox.innerHTML = formHtml(e);
    formBox.querySelector('textarea').focus();
  }
  const closeForm = () => { editing = null; formBox.innerHTML = ''; };
  const find = (id) => { const e = LIST.find((x) => x.id === id); return e ? { id: e.id, ...e.data } : null; };

  formBox.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target, val = (n) => f.elements[n].value;
    const err = f.querySelector('.lg-err');
    try {
      const sv = val('source');
      const fields = { kind: val('kind'), title: val('title') || null, text: val('text'), subjects: val('subjects'), source: sv ? (sv.startsWith('added') ? 'added' : sv) : null, addedBy: sv.startsWith('added-') ? sv.slice(6) : null };
      const old = editing ? find(editing) : null;
      const where = { ...((old && old.where) || {}), area: val('area') };
      if (!old && o.map) where.map = o.map();
      if (old) {
        const { id, ...prev } = old;
        const data = editEntry(prev, { ...fields, where }, new Date().toISOString());
        o.store.set(`${LEDGER}/${id}`, data).catch(() => {});
        if (o.log) o.log(`ledger entry changed: ${entryLine(data, 80)}`);
      } else {
        const data = ledgerEntry({ ...fields, by: 'gm', where, game: o.gameNow ? o.gameNow() : null });
        o.store.set(ledgerPath(), data).catch(() => {});
        if (o.log) o.log(`ledger entry added: ${entryLine(data, 80)}`);
      }
      closeForm();
    } catch (x) { err.hidden = false; err.textContent = x.message; }
  });
  pane.addEventListener('click', (ev) => {
    const t = ev.target;
    const chip = t.closest('[data-kind]');
    if (chip) { F.kind = chip.dataset.kind; story = false; render(); return; }
    const subj = t.closest('[data-subject]');
    if (subj) { q.value = subj.dataset.subject; F.q = q.value; story = false; render(); return; }
    const link = t.closest('[data-link]');
    if (link) { if (o.showLink) o.showLink(link.dataset.link); return; }
    const act = t.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act, row = act.closest('[data-id]'), id = row ? row.dataset.id : null;
    if (a === 'story') { story = !story; render(); return; }
    if (a === 'add') { openForm(null); return; }
    if (a === 'cancel') { closeForm(); return; }
    if (!canWrite() || !id) return;
    const e = find(id);
    if (!e) return;
    if (a === 'edit') { openForm(e); return; }
    if (a === 'close' || a === 'reopen') {
      const { id: _i, ...prev } = e;
      const data = editEntry(prev, { status: a === 'close' ? 'done' : 'open' }, new Date().toISOString());
      o.store.set(`${LEDGER}/${id}`, data).catch(() => {});
      if (o.log) o.log(`ledger: ${a === 'close' ? 'done' : 'reopened'}: ${entryLine(data, 80)}`);
      return;
    }
    if (a === 'remove') {
      if (armed !== id) { armed = id; clearTimeout(armTimer); armTimer = setTimeout(() => { armed = null; render(); }, 4000); render(); return; }
      armed = null;
      o.store.remove(`${LEDGER}/${id}`).catch(() => {});
      if (o.log) o.log(`ledger entry removed: ${entryLine(e, 80)}`);
    }
  });
  q.addEventListener('input', () => { F.q = q.value; story = false; render(); });

  let off = null;
  const listen = (on) => {
    if (on && !off) off = o.store.watchCollection(LEDGER, (l) => { LIST = l; render(); });
    if (!on && off) { if (typeof off === 'function') off(); off = null; LIST = []; render(); }
  };
  if (o.sidebar) o.sidebar.onVisible(o.tab || 'ledger', listen); else listen(true);
  render();
  return {
    render, entries: () => LIST, listening: () => !!off,
    filter: (f) => { if (f.q !== undefined) { q.value = f.q; F.q = f.q; } if (f.kind !== undefined) F.kind = f.kind; if (f.story !== undefined) story = !!f.story; render(); },
  };
}
