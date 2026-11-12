// Roll cards and the roll log on the board: every roll record (rolls/<id>, board/rolls.js) pops up as a card on
// every screen when it arrives (public rolls; private and blind ones are FR-10), and goes into the roll log
// (a panel, docked or floating). The GM view removes the oldest beyond ROLLS_KEPT. Docs:
// docs/best-practices/board.md (the encounter tracker: roll cards and the log).

import { makePanel } from './panel.js';
import { diceWords, chipWords, rollVisible, ROLLS_KEPT } from './rolls.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CARD_MS = 15000;

/** A roll card's HTML (pure): who, what, the modifiers, the notes that trigger, the dice and the total. */
export function cardHtml(rec, { title = true } = {}) {
  const what = rec.kind === 'initiative' ? `Initiative: ${(rec.stat && rec.stat.label) || 'Perception'}` : ((rec.stat && rec.stat.label) || 'Check');
  const chips = (rec.parts || []).map((p) => `<span class="rc-chip${p.added ? ' added' : ''}" title="${esc(p.type || '')}">${esc(chipWords(p))}</span>`).join('');
  const notes = (rec.notes || []).map((n) => `<p class="rc-note"><b>${esc(n.from)}</b> ${esc(n.text)}</p>`).join('');
  const dice = (rec.dice || []).length > 1 ? ` <span class="rc-dice" title="the dice rolled">(${rec.dice.map((d) => (d === rec.kept ? `<b>${d}</b>` : `<s>${d}</s>`)).join(' ')})</span>` : '';
  return `${title ? `<div class="rc-who">${esc(rec.name || 'Someone')}</div>` : ''}
    <div class="rc-what">${rec.gm ? '<span class="rc-gm" title="Only the GM sees this roll">GM</span> ' : ''}${esc(what)}${rec.by && rec.by !== 'player' ? ` <span class="rc-by">by ${esc(rec.by === 'gm' ? 'the GM' : rec.by === 'claude' ? 'Claude' : rec.by)}</span>` : ''}</div>
    ${chips ? `<div class="rc-chips">${chips}</div>` : ''}${notes}
    <div class="rc-formula">${esc(diceWords(rec))}${dice}</div>
    <div class="rc-total" aria-label="Total ${rec.total}">${esc(rec.total)}</div>`;
}

/**
 * o: {store, view() -> 'gm' | 'player', readOnly, openButton (the title line's button)}. Returns {show(rec),
 * latest(token, kind) -> record or null}.
 */
export function mountRolls(o) {
  const log = makePanel({ id: 'rolllog', title: 'Rolls', key: 'reliquary.rolllog', docked: true, dockInto: document.querySelector('main aside') });
  log.body.classList.add('rl-list');
  const stack = document.createElement('div');
  stack.className = 'rc-stack'; stack.setAttribute('aria-live', 'polite');
  document.body.appendChild(stack);
  let LIST = [];
  const seen = new Set();
  const startedAt = Date.now() - 5000;
  let first = true;

  function show(rec) {
    const card = document.createElement('div');
    card.className = 'rcard'; card.setAttribute('role', 'status');
    card.innerHTML = `<button type="button" class="rc-x" aria-label="Close the roll card" title="Close">✕</button>${cardHtml(rec)}`;
    let t = setTimeout(() => card.remove(), CARD_MS);
    card.addEventListener('mouseenter', () => clearTimeout(t));
    card.addEventListener('mouseleave', () => { t = setTimeout(() => card.remove(), CARD_MS / 2); });
    card.querySelector('.rc-x').addEventListener('click', () => card.remove());
    stack.prepend(card);
    while (stack.children.length > 4) stack.lastChild.remove();
  }
  function renderLog() {
    const list = LIST.filter((e) => rollVisible(e.data, o.view()));
    log.setNote(list.length ? String(list.length) : '');
    log.body.innerHTML = list.length ? [...list].reverse().slice(0, 60).map((e) => `<div class="rl-item">${cardHtml(e.data)}<time>${esc(new Date(e.data.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</time></div>`).join('') : '<p class="muted">No rolls yet.</p>';
  }
  o.store.watchCollection('rolls', (list) => {
    LIST = [...list].sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const e of LIST) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (!first && Date.parse(e.data.at) >= startedAt && rollVisible(e.data, o.view())) show(e.data);
    }
    first = false;
    renderLog();
    // the GM view keeps the log short
    if (o.view() === 'gm' && !o.readOnly && LIST.length > ROLLS_KEPT) for (const e of LIST.slice(0, LIST.length - ROLLS_KEPT)) o.store.remove(`rolls/${e.id}`).catch(() => {});
  });
  if (o.openButton) o.openButton.addEventListener('click', () => log.toggle());
  return {
    show,
    render: renderLog,
    latest: (token, kind) => { for (let i = LIST.length - 1; i >= 0; i--) if (LIST[i].data.token === token && (!kind || LIST[i].data.kind === kind)) return LIST[i].data; return null; },
  };
}
