// The audit log: every change to the game's state, in words, for the GM only (moves, doors, lights, templates, notes,
// terrain, the clock, the encounter, conditions, and the board's warnings such as "moved beyond its Speed"). One
// stream of records, audit/<time36>-<n>, part of the save (audit.json). The chat (board/chat.js) is the players':
// Claude's narration, rolls and the events they should know about. Pure; board/auditui.js draws it. Docs:
// docs/design/board.md (the chat and the audit log), docs/best-practices/board.md (chat and audit log).
//
// An entry: {at, by ('claude' | 'gm' | 'player'), text, map?, level? ('warn' | 'ok')}

export const AUDIT = 'audit';
export const LEVELS = Object.freeze(['warn', 'ok']);

let seq = 0;
/** A time-sortable path for a new entry: audit/<time36>-<n><random>. */
export function auditPath(now = Date.now(), rnd = Math.random) {
  return `${AUDIT}/${Math.floor(now).toString(36).padStart(9, '0')}-${(seq++).toString(36)}${rnd().toString(36).slice(2, 6)}`;
}

/** An entry record: needs text; drops empty fields. */
export function auditEntry({ text, by = 'gm', map = null, level = null, at = null }) {
  const t = String(text || '').trim();
  if (!t) throw new Error('an audit entry needs text');
  const out = { at: at || new Date().toISOString(), by, text: t };
  if (map) out.map = map;
  if (level && LEVELS.includes(level)) out.level = level;
  return out;
}

/** The rows to show (newest first), at most `limit`: [{id, ...entry}]. */
export function auditRows(list, limit = 200) {
  return [...list].sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, limit).map((e) => ({ id: e.id, ...e.data }));
}

/** A record list ({id, data}) as the save keeps it: [{id, ...entry}], oldest first. */
export function auditForSave(list) {
  return [...list].sort((a, b) => (a.id < b.id ? -1 : 1)).map((e) => ({ id: e.id, ...e.data }));
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WHO = { claude: 'Claude', gm: 'GM', player: 'Player' };

/** One row's HTML (pure): the time, who, the text; a warning in amber. */
export function auditHtml(e) {
  const t = e.at ? new Date(e.at) : null;
  const time = t && !Number.isNaN(+t) ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  return `<li class="au-row${e.level ? ' au-' + esc(e.level) : ''}"><time datetime="${esc(e.at)}" title="${esc(t ? t.toLocaleString() : '')}">${esc(time)}</time> <b class="au-who au-${esc(e.by)}">${esc(WHO[e.by] || e.by)}</b> <span class="au-text">${esc(e.text)}</span></li>`;
}
