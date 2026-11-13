// Map notes on the board: who may see and change a note, colours, records, and which bubbles this
// browser has collapsed. Pure functions apart from the collapsed set (localStorage, guarded); board/app.js
// draws the pins and bubbles and wires them. Docs: docs/design/board.md section 7 (map notes).

export const NOTE_MAX = 500;

/** Colours by author: the player view orange, the GM view purple, Claude the board's accent (amber). */
export const NOTE_COLOURS = Object.freeze({ player: '#ff9f43', gm: '#b48cff', claude: '#e3a443' });
export const noteColour = (n) => NOTE_COLOURS[n && n.by] || NOTE_COLOURS.claude;

/** Who wrote a note, in words: the player's own notes read "You" in the player view, "Player" in the GM view. */
export const authorName = (n, view) => ({ player: view === 'gm' ? 'Player' : 'You', gm: 'GM', claude: 'Claude' })[n && n.by] || (n && n.by) || '?';

/** GM-only notes show only in the GM view; every other note shows everywhere, fog or not. */
export const noteVisible = (n, view) => !!n && (view === 'gm' || !n.gm_only);

/** The player view edits, moves and deletes the notes it wrote; the GM view any note, Claude's included. */
export const canEditNote = (n, view) => !!n && (view === 'gm' || n.by === 'player');


/** Text as stored: trimmed, at most NOTE_MAX characters. Empty means "no note". */
export const cleanText = (t) => String(t || '').trim().slice(0, NOTE_MAX);

/** A point in cells, rounded to 1/1000 of a square; with snap, the centre of its square. */
export function notePoint(x, y, snap = false) {
  if (snap) return [Math.floor(x) + 0.5, Math.floor(y) + 0.5];
  return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
}

/** The note record (map-state notes.<id> plus the map it is on). */
export function noteRecord({ map, text, at, by, gmOnly = false, updated = new Date().toISOString() }) {
  const r = { map, text: cleanText(text), at, by, updated };
  if (gmOnly) r.gm_only = true;
  return r;
}

/** A short form of a note for the audit log: its first line, at most 40 characters. */
export function noteGist(text) {
  const first = String(text || '').split('\n')[0].trim();
  return first.length > 40 ? first.slice(0, 39) + '…' : first;
}

/**
 * The notes this browser has collapsed, kept per campaign and map in localStorage. Storage may be missing
 * or refuse (a preview, private mode): then the set lives only as long as the page.
 */
export function collapsedStore(key, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  let set = new Set();
  try { const v = storage && JSON.parse(storage.getItem(key) || '[]'); if (Array.isArray(v)) set = new Set(v); } catch { /* keep empty */ }
  const save = () => { try { if (storage) storage.setItem(key, JSON.stringify([...set])); } catch { /* page only */ } };
  return {
    has: (id) => set.has(id),
    toggle(id) { if (set.has(id)) set.delete(id); else set.add(id); save(); return set.has(id); },
    /** Forget notes that no longer exist. */
    prune(ids) { const keep = new Set(ids); const n = set.size; set = new Set([...set].filter((i) => keep.has(i))); if (set.size !== n) save(); },
  };
}

