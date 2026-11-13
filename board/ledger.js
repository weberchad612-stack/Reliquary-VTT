// The campaign ledger: the GM's memory of the campaign (the user: "SUPER important"; GM guide rule B5). What the
// chat can't hold: every improvisation by Claude or the user (room details, items, characters, plots, an NPC's
// claim, names), GM secrets (secret rolls and their DCs, what a search would have found, motives, who is alerted),
// rulings, open threads and quests, timed events, and a "story so far" summary per session. The told story is the
// chat's (board/chat.js); the ledger can link to it. GM only: players never see it. One record per entry,
// ledger/<time36>-<n>, part of the save (ledger.json). Pure; board/ledgerui.js draws the Ledger tab and
// tools/ledger.mjs writes and searches it. Docs: docs/best-practices/board.md (the ledger), docs/gm/running-a-game.md.
//
// An entry: {at (real time), by ('claude' | 'gm'), kind, text, title?, subjects?: [names], where?: {map?, area?},
//            game?: {now (clock seconds), label}, source? ('adventure' | 'added'), addedBy? ('claude' | 'user': who
//            invented it, for 'added'), player? and character? (for the user's: which player, from the campaign's
//            players, and which of their PCs, a token id), status? ('open' | 'done' | 'failed'), links?: [record paths], updated?}

export const LEDGER = 'ledger';
export const TEXT_MAX = 4000;

/** The kinds of entry, in the tab's order, with a label and an icon. */
export const KINDS = Object.freeze({
  summary: { label: 'Story so far', icon: '📜', hint: 'what happened this session, at wrap-up' },
  thread: { label: 'Thread', icon: '🧵', hint: 'an open plot thread or loose end', status: true },
  quest: { label: 'Quest', icon: '🗺️', hint: 'a quest or request given to the party', status: true },
  event: { label: 'Timed event', icon: '⏳', hint: 'something due at a set moment, with its trigger', status: true },
  improv: { label: 'Improvised', icon: '✨', hint: 'a detail invented at the table: room, item, NPC, name, claim' },
  fact: { label: 'Fact', icon: '📌', hint: 'something that happened or was learned and must stay consistent' },
  secret: { label: 'GM secret', icon: '🔒', hint: 'a secret roll and its DC, a hidden truth, a motive, who is alerted' },
  ruling: { label: 'Ruling', icon: '⚖️', hint: 'how the rules were applied to a case they don\'t spell out' },
});
export const KIND_IDS = Object.freeze(Object.keys(KINDS));
export const STATUSES = Object.freeze(['open', 'done', 'failed']);
export const SOURCES = Object.freeze(['adventure', 'added']);
export const AUTHORS = Object.freeze(['claude', 'gm']);
/** Who invented an added detail: Claude, or the user (as a player or as the GM). */
export const INVENTORS = Object.freeze(['claude', 'user']);
/** Kinds with a status: open until closed. */
export const hasStatus = (kind) => !!(KINDS[kind] && KINDS[kind].status);

let seq = 0;
/** A time-sortable path for a new entry: ledger/<time36>-<n><random>. */
export function ledgerPath(now = Date.now(), rnd = Math.random) {
  return `${LEDGER}/${Math.floor(now).toString(36).padStart(9, '0')}-${(seq++).toString(36)}${rnd().toString(36).slice(2, 6)}`;
}

const clean = (s) => String(s ?? '').trim();
const list = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(',')).map(clean).filter(Boolean))];

/**
 * An entry record, checked: a known kind and some text; drops empty fields. Threads, quests and timed events start
 * open. An improvisation is 'added' unless said otherwise; an added detail says who invented it (addedBy: by default
 * whoever wrote the entry, the GM view's entries being the user's).
 */
export function ledgerEntry({ kind, text, title = null, by = 'claude', subjects = [], where = null, game = null, source = null, addedBy = null, player = null, character = null, status = null, links = [], at = null, updated = null }) {
  if (!KINDS[kind]) throw new Error(`kind must be one of ${KIND_IDS.join(', ')}`);
  const t = clean(text);
  if (!t) throw new Error('a ledger entry needs text');
  if (t.length > TEXT_MAX) throw new Error(`a ledger entry is at most ${TEXT_MAX} characters`);
  if (!AUTHORS.includes(by)) throw new Error(`by must be one of ${AUTHORS.join(', ')}`);
  const out = { at: at || new Date().toISOString(), by, kind, text: t };
  if (clean(title)) out.title = clean(title);
  const subj = list(subjects);
  if (subj.length) out.subjects = subj;
  if (where && (clean(where.map) || clean(where.area))) out.where = { ...(clean(where.map) ? { map: clean(where.map) } : {}), ...(clean(where.area) ? { area: clean(where.area) } : {}) };
  if (game && typeof game.now === 'number') out.game = { now: game.now, ...(clean(game.label) ? { label: clean(game.label) } : {}) };
  const src = source || (kind === 'improv' ? 'added' : null);
  if (src) { if (!SOURCES.includes(src)) throw new Error(`source must be one of ${SOURCES.join(', ')}`); out.source = src; }
  if (src === 'added') {
    const inv = addedBy || (by === 'gm' ? 'user' : 'claude');
    if (!INVENTORS.includes(inv)) throw new Error(`addedBy must be one of ${INVENTORS.join(', ')}`);
    out.addedBy = inv;
    if (inv === 'user') { if (clean(player)) out.player = clean(player); if (clean(character)) out.character = clean(character); }
    else if (player || character) throw new Error('player and character are for a detail the user added');
  } else if (addedBy || player || character) throw new Error('addedBy, player and character are for an added detail (source added)');
  if (hasStatus(kind)) {
    const st = status || 'open';
    if (!STATUSES.includes(st)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
    out.status = st;
  } else if (status) throw new Error(`a ${kind} has no status`);
  const ln = list(links);
  if (ln.length) out.links = ln;
  if (updated) out.updated = updated;
  return out;
}

/** An entry changed: the fields given replace the old ones (null removes one); checked again; `updated` set. */
export function editEntry(old, changes, now = new Date().toISOString()) {
  const merged = { ...old };
  for (const [k, v] of Object.entries(changes)) { if (v === null || v === undefined) { if (v === null) delete merged[k]; } else merged[k] = v; }
  if (!hasStatus(merged.kind)) delete merged.status;
  if (merged.source !== 'added') delete merged.addedBy;
  if (merged.addedBy !== 'user') { delete merged.player; delete merged.character; }
  return ledgerEntry({ ...merged, updated: now });
}

const norm = (s) => String(s || '').toLowerCase();
/** Every word of the query appears in the entry's text, title, subjects, place or game time. */
export function matches(e, query, extra = []) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = norm([e.title, e.text, ...(e.subjects || []), e.where && e.where.area, e.where && e.where.map, e.game && e.game.label, KINDS[e.kind] && KINDS[e.kind].label, ...extra].join(' \n '));
  return words.every((w) => hay.includes(w));
}

/**
 * The entries to show, newest first: [{id, ...entry}]. f: {q, kind (an id, or 'open' for every open thread, quest
  * and event), by, subject, area, status, limit, words (e -> extra words to match: the introducer's names)}.
 */
export function ledgerRows(listed, f = {}) {
  const rows = listed.map((e) => ({ id: e.id, ...(e.data || e) })).filter((e) => {
    if (f.kind === 'open') { if (!(hasStatus(e.kind) && e.status === 'open')) return false; } else if (f.kind && e.kind !== f.kind) return false;
    if (f.by && e.by !== f.by) return false;
    if (f.status && e.status !== f.status) return false;
    if (f.subject && !(e.subjects || []).some((s) => norm(s) === norm(f.subject))) return false;
    if (f.area && norm(e.where && e.where.area) !== norm(f.area)) return false;
    return matches(e, f.q, f.words ? f.words(e) : []);
  });
  rows.sort((a, b) => (a.id < b.id ? 1 : -1));
  return f.limit ? rows.slice(0, f.limit) : rows;
}

/**
 * The story so far, for a session's start (and a new conversation): the session summaries oldest first, then every
 * open timed event, quest and thread. {summaries, events, quests, threads}.
 */
export function storySoFar(listed) {
  const rows = ledgerRows(listed);
  const open = (k) => rows.filter((e) => e.kind === k && e.status === 'open').reverse();
  return { summaries: rows.filter((e) => e.kind === 'summary').reverse(), events: open('event'), quests: open('quest'), threads: open('thread') };
}

/** Every subject named in the ledger, most used first: [{name, n}]. */
export function subjectsIndex(listed) {
  const n = new Map();
  for (const e of ledgerRows(listed)) for (const s of e.subjects || []) { const k = s.trim(); n.set(k, (n.get(k) || 0) + 1); }
  return [...n].map(([name, c]) => ({ name, n: c })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WHO = { claude: 'Claude', gm: 'GM' };

/** Who invented an added detail, in words: "you", "Claude", "Chad (as Kerra)". who: {player(id) -> name, character(id) -> name}. */
export function addedByWords(e, who = {}) {
  if (e.addedBy !== 'user') return 'Claude';
  const p = e.player ? ((who.player && who.player(e.player)) || e.player) : (who.you || 'the user');
  const c = e.character ? ((who.character && who.character(e.character)) || e.character) : null;
  return c ? `${p} (as ${c})` : p;
}

/** An entry in words, one line (for the tool and the audit log): "🧵 Thread (open): The boot prints — ...". */
export function entryLine(e, max = 160, who = {}) {
  const k = KINDS[e.kind] || { label: e.kind, icon: '' };
  const head = `${k.icon} ${k.label}${e.status ? ` (${e.status})` : ''}${e.source ? ` [${e.source === 'added' ? `added by ${addedByWords(e, who)}` : e.source}]` : ''}`;
  const body = `${e.title ? `${e.title}: ` : ''}${e.text}`.replace(/\s+/g, ' ');
  return `${head}: ${body.length > max ? `${body.slice(0, max - 1)}…` : body}`;
}

/**
 * One entry's HTML (pure): kind, title, text, subjects, where and when, source and author, status; with `editable`
 * its edit, close/reopen and remove controls; links as buttons (data-link).
 */
export function ledgerHtml(e, { editable = false, armed = null, who = {} } = {}) {
  const k = KINDS[e.kind] || { label: e.kind, icon: '•' };
  const meta = [
    e.where && (e.where.area || e.where.map) ? `<span class="lg-where">${esc([e.where.area, e.where.map].filter(Boolean).join(' · '))}</span>` : '',
    e.game && e.game.label ? `<span class="lg-when">${esc(e.game.label)}</span>` : '',
    e.source ? `<span class="lg-src lg-${esc(e.source)}${e.addedBy ? ` lg-by-${esc(e.addedBy)}` : ''}" title="${e.source === 'added' ? 'Invented at the table' : 'From the adventure'}">${e.source === 'added' ? `✨ added by ${esc(addedByWords(e, { you: 'you', ...who }))}` : 'adventure'}</span>` : '',
    `<span class="lg-by lg-${esc(e.by)}">${esc(WHO[e.by] || e.by)}</span>`,
  ].filter(Boolean).join(' ');
  const subj = (e.subjects || []).map((s) => `<button type="button" class="lg-subj" data-subject="${esc(s)}">${esc(s)}</button>`).join('');
  const links = (e.links || []).map((l) => `<button type="button" class="lg-link" data-link="${esc(l)}" title="Show it">${esc(l.split('/')[0] === 'chat' ? 'in the chat' : l.split('/')[0] === 'replay' ? 'in the replay' : l)}</button>`).join('');
  const status = e.status ? `<span class="lg-status lg-${esc(e.status)}">${esc(e.status)}</span>` : '';
  const ctl = editable ? `<span class="lg-ctl">${e.status ? `<button type="button" data-act="${e.status === 'open' ? 'close' : 'reopen'}" title="${e.status === 'open' ? 'Mark done' : 'Reopen'}">${e.status === 'open' ? '✓' : '↺'}</button>` : ''}<button type="button" data-act="edit" title="Edit">✎</button><button type="button" data-act="remove" class="${armed === e.id ? 'armed' : ''}" title="${armed === e.id ? 'Click again to remove' : 'Remove'}">${armed === e.id ? 'Remove?' : '✕'}</button></span>` : '';
  return `<li class="lg-row lg-k-${esc(e.kind)}${e.status && e.status !== 'open' ? ' lg-closed' : ''}" data-id="${esc(e.id)}">`
    + `<div class="lg-top"><span class="lg-kind" title="${esc(k.hint || '')}">${k.icon} ${esc(k.label)}</span>${status}${ctl}</div>`
    + `${e.title ? `<b class="lg-title">${esc(e.title)}</b>` : ''}<p class="lg-text">${esc(e.text)}</p>`
    + `${subj || links ? `<div class="lg-tags">${subj}${links}</div>` : ''}<div class="lg-meta">${meta}</div></li>`;
}
