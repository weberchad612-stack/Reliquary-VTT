// Chat messages: the records (chat/<time36>-<n>), who may see them, and their HTML. The chat is the players' story:
// Claude's narration first of all, rulings, NPCs speaking, roll cards, and the events at the table they should know
// about (conditions, damage and healing, deaths, rounds); it is part of the save (chat.json). Every other change to
// the game goes to the GM's audit log (board/audit.js), not here. Pure; board/chatui.js draws it, the tools write it. Docs: docs/design/board.md (the sidebar and
// chat), docs/best-practices/board.md (chat).
//
// A message: {at, by ('claude' | 'gm' | 'player'), kind, gm? (the GM's only), map?, ...}
//   roll       a roll card: {token, name, check ('initiative'...), stat {slug, label}, dice, kept, mode, sides, mod,
//              total, parts [{label, type, value}], notes [{text, from}]}
//   narration  read-aloud text from Claude: {text}
//   ruling     a ruling from Claude: {text}
//   npc        an NPC speaking: {token?, speaker (its name), alias? (what players call it until known), text}
//   check      a check card (attack, save, skill, Perception, flat...): {token, name, roll} (roll: board/rolldetail.js's
//              check entry); players see a PC's whole, another creature's as its total and result; the GM all
//   damage     a damage card: {token? (who dealt it), name, rolls: [damage entries], applied? (the applied entry: who
//              took it, resistances and weaknesses, the amount)}; players see a foe's as the amount taken
//   event      retired 2026-11-12 (the user: events go to the GM's audit log only); old ones still show

import { seesWhole, vsWords } from './rolldetail.js';

export const CHAT = 'chat';
export const KINDS = Object.freeze(['roll', 'narration', 'ruling', 'npc', 'check', 'damage']);

let seq = 0;
/** A time-sortable path for a new message: chat/<time36>-<n><random>. */
export function chatPath(now = Date.now(), rnd = Math.random) {
  return `${CHAT}/${Math.floor(now).toString(36).padStart(9, '0')}-${(seq++).toString(36)}${rnd().toString(36).slice(2, 6)}`;
}

/** A message record: checks the kind, drops empty fields. */
export function chatMessage(o) {
  if (!KINDS.includes(o.kind)) throw new Error(`a chat message's kind is one of ${KINDS.join(', ')}`);
  if (['narration', 'ruling', 'npc'].includes(o.kind) && !String(o.text || '').trim()) throw new Error('a message needs text');
  if (o.kind === 'check' && !(o.roll && o.roll.type === 'check')) throw new Error('a check card needs its roll');
  if (o.kind === 'damage' && !((o.rolls || []).length || o.applied)) throw new Error('a damage card needs its rolls or the damage applied');
  const out = { at: o.at || new Date().toISOString(), by: o.by || 'claude', kind: o.kind };
  for (const [k, v] of Object.entries(o)) if (!(k in out) && v !== undefined && v !== null && v !== '' && !(k === 'gm' && !v)) out[k] = v;
  return out;
}

/** Whether a view may see a message: the GM every one, players those not marked the GM's. */
export const chatVisible = (msg, view) => view === 'gm' || !(msg && msg.gm);

/** How long ago, in words: "just now", "45s ago", "36m 39s ago", "2h 5m ago", "3d ago". */
export function timeAgo(at, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - Date.parse(at)) / 1000));
  if (!Number.isFinite(s)) return '';
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sgn = (v) => (v < 0 ? `− ${-v}` : `+ ${v}`);

/** The dice in words: "1d20 + 17", "2d20 keep higher + 17". */
export function diceWords(rec) {
  const d = rec.mode === 'normal' || !rec.mode ? `1d${rec.sides || 20}` : `2d${rec.sides || 20} keep ${rec.mode === 'higher' ? 'higher' : 'lower'}`;
  return `${d} ${sgn(rec.mod || 0)}`;
}

/** A modifier chip's words: "Wisdom +2", "Master +14" (a proficiency part by its rank). */
export function chipWords(p) {
  const label = String(p.label || '').replace(/^proficiency \((\w+)\)$/, (_, r) => r.charAt(0).toUpperCase() + r.slice(1));
  return `${label} ${p.value < 0 ? `−${-p.value}` : `+${p.value}`}`;
}

/** A roll card's body: what was rolled, the modifiers, the notes that trigger, the dice and the total. */
export function cardHtml(rec) {
  const what = rec.check === 'initiative' ? `Initiative: ${(rec.stat && rec.stat.label) || 'Perception'}` : ((rec.stat && rec.stat.label) || 'Check');
  const chips = (rec.parts || []).map((p) => `<span class="rc-chip${p.added ? ' added' : ''}" title="${esc(p.type || '')}">${esc(chipWords(p))}</span>`).join('');
  const notes = (rec.notes || []).map((n) => `<p class="rc-note"><b>${esc(n.from)}</b> ${esc(n.text)}</p>`).join('');
  const dice = (rec.dice || []).length > 1 ? ` <span class="rc-dice" title="the dice rolled">(${rec.dice.map((d) => (d === rec.kept ? `<b>${d}</b>` : `<s>${d}</s>`)).join(' ')})</span>` : '';
  return `<div class="rc-what">${esc(what)}${rec.by && rec.by !== 'player' ? ` <span class="rc-by">by ${esc(rec.by === 'gm' ? 'the GM' : rec.by === 'claude' ? 'Claude' : rec.by)}</span>` : ''}</div>
    ${chips ? `<div class="rc-chips">${chips}</div>` : ''}${notes}
    <div class="rc-formula">${esc(diceWords(rec))}${dice}</div>
    <div class="rc-total" aria-label="Total ${rec.total}">${esc(rec.total)}</div>`;
}

/**
 * A check card's body (attack, save, skill...): the whole roll for a view that may see it (the GM; players a PC's),
 * else its total and result. o: {gm, isPc(token)}.
 */
export function checkCardHtml(msg, o = {}) {
  const e = msg.roll || {}, whole = seesWhole(e, o);
  const res = e.result ? `<div class="rc-result rc-${esc(e.degree || '')}">${esc(e.result)}</div>` : '';
  const vs = e.vs ? `<div class="rc-vs">${esc(vsWords(e.vs, o).trim())}</div>` : '';
  if (!whole) return `<div class="rc-what">${esc(e.label || 'Check')}</div><div class="rc-total" aria-label="Total ${e.total}">${esc(e.total)}</div>${vs}${res}`;
  const chips = (e.parts || []).filter((p) => p && p.value).map((p) => `<span class="rc-chip">${esc(chipWords(p))}</span>`).join('');
  const dice = (e.dice || []).length > 1 ? ` <span class="rc-dice" title="the dice rolled">(${e.dice.map((d) => (d === e.kept ? `<b>${d}</b>` : `<s>${d}</s>`)).join(' ')})</span>` : '';
  return `<div class="rc-what">${esc(e.label || 'Check')}</div>${chips ? `<div class="rc-chips">${chips}</div>` : ''}
    <div class="rc-formula">${esc(`1d20 ${sgn(e.mod || 0)}`)} · <span title="the die">${esc(e.kept)}</span>${dice}</div>
    <div class="rc-total" aria-label="Total ${e.total}">${esc(e.total)}</div>${vs}${res}`;
}

/**
 * A damage card's body: the dice (with the doubling on a critical) and the damage taken (resistances and weaknesses)
 * for a view that sees the dealer's rolls whole; else who took how much. o: {gm, isPc(token), names(token)}.
 */
export function damageCardHtml(msg, o = {}) {
  const rolls = msg.rolls || [], a = msg.applied, whole = rolls.length ? seesWhole(rolls[0], o) : !!o.gm;
  const type = [...new Set(rolls.map((r) => r.damageType).filter(Boolean))].join(', ');
  const target = a ? ((a.token && o.names && o.names(a.token)) || a.who || '') : '';
  const amount = a ? a.taken : rolls.reduce((t, r) => t + (r.total || 0), 0);
  const taken = `<div class="rc-total rc-dmg" aria-label="Damage ${amount}">${esc(amount)}${type ? ` <span class="rc-type">${esc(type)}</span>` : ''}</div>${target ? `<div class="rc-vs">to ${esc(target)}</div>` : ''}`;
  if (!whole) return `<div class="rc-what">Damage</div>${taken}`;
  const lines = rolls.map((r) => `<div class="rc-formula">${esc(r.label && r.label !== 'Damage' ? `${r.label}: ` : '')}${esc(r.text || r.total)}${r.crit ? ` · <b>doubled ${esc(r.total)}</b> (critical)` : ''}</div>`).join('');
  const adj = a && (a.adjust || []).length ? `<div class="rc-adj">${a.adjust.map((t) => `<p>${esc(t)}</p>`).join('')}</div>` : '';
  return `<div class="rc-what">Damage</div>${lines}${adj}${taken}`;
}

/**
 * Who a message is from, as this view says it: a roll's or an NPC's creature (the players' name for it: its alias
 * until it is known), or Claude. names(token) -> the name this view uses for a token on the map, or null.
 */
export function speakerOf(msg, view, names = () => null) {
  if (msg.kind === 'roll' || msg.kind === 'check' || msg.kind === 'damage') return (msg.token && names(msg.token)) || msg.name || 'Someone';
  if (msg.kind === 'npc') return (msg.token && names(msg.token)) || (view === 'gm' || !msg.alias ? msg.speaker : msg.alias) || 'Someone';
  if (msg.kind === 'narration' || msg.kind === 'ruling') return 'Claude (GM)';
  return '';
}

/**
 * One message's HTML for the chat log (pure). o: {view, now, names(token), colour(kind), kindOf(token), canDelete,
 * id}.
 */
export function messageHtml(msg, o = {}) {
  const view = o.view || 'player', now = o.now ?? Date.now();
  const gmTag = msg.gm ? '<span class="cm-gm" title="Only the GM sees this">GM</span>' : '';
  const del = o.canDelete ? `<button type="button" class="cm-del" data-del="${esc(o.id)}" title="Delete this message" aria-label="Delete this message">${TRASH}</button>` : '';
  const when = `<time datetime="${esc(msg.at)}" title="${esc(new Date(msg.at).toLocaleString())}">${esc(timeAgo(msg.at, now))}</time>`;
  if (msg.kind === 'event') return `<li class="cm cm-event${msg.gm ? ' gm' : ''}" data-id="${esc(o.id)}">${gmTag}<span class="cm-eventtext">${esc(msg.text)}</span>${when}${del}</li>`;
  const who = speakerOf(msg, view, o.names || (() => null));
  const kind = msg.token && o.kindOf ? o.kindOf(msg.token) : msg.kind === 'npc' ? 'npc' : null;
  const disc = ['roll', 'npc', 'check', 'damage'].includes(msg.kind)
    ? `<span class="cm-pic" style="--c:${o.colour ? o.colour(kind || 'foe') : '#888'}" aria-hidden="true">${esc(String(who).charAt(0).toUpperCase())}</span>`
    : '<span class="cm-pic cm-claude" aria-hidden="true">✦</span>';
  const head = `<div class="cm-h">${disc}<span class="cm-who">${esc(who)}</span>${gmTag}${when}${del}</div>`;
  let body = '';
  if (msg.kind === 'roll') body = cardHtml(msg);
  const see = { gm: view === 'gm', isPc: (id) => !!id && !!o.kindOf && o.kindOf(id) === 'pc', names: o.names };
  if (msg.kind === 'check') body = checkCardHtml(msg, see);
  if (msg.kind === 'damage') body = damageCardHtml(msg, see);
  if (msg.kind === 'narration') body = `<blockquote class="cm-read">${esc(msg.text).replace(/\n+/g, '<br>')}</blockquote>`;
  if (msg.kind === 'ruling') body = `<div class="cm-ruling"><b>Ruling</b> ${esc(msg.text).replace(/\n+/g, '<br>')}</div>`;
  if (msg.kind === 'npc') body = `<p class="cm-say">“${esc(msg.text).replace(/\n+/g, '<br>')}”</p>`;
  return `<li class="cm cm-${msg.kind}${msg.gm ? ' gm' : ''}" data-id="${esc(o.id)}">${head}${body}</li>`;
}

const TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
