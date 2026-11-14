// Token names: what each view shows, the fallback letter, finding a token by name, and the naming checks.
// Docs: docs/best-practices/board.md (names and ids), future/backlog.md FR-10.
//
// - A creature or NPC without a proper name is named by a unique adjective and its type ("Wet-Nosed Rat"),
//   never a number. PCs keep their names. A proper name ("Djarek Evergloam", "Chillwind") is never changed.
// - alias: what players see until the party learns the proper name (known: true). The GM view always shows
//   the name. Anything players can read (the chat, effects, area summaries) uses the public name.
// - short: the token's letter, shown only when it has no image: the first letter of the adjective (of the
//   alias, else the name), unique within its group (the encounter set; no group: a group of one).
// - type: what kind of creature (giant-rat): art and stat blocks are looked up by it.

/** The name players may see. */
export const publicName = (t) => (t && t.alias && !t.known ? t.alias : (t && t.name) || '');
/** The name a view shows: the GM view the real name, players the public one. */
export const nameFor = (t, view) => (view === 'gm' ? (t && t.name) || '' : publicName(t));
/** The token's group (encounter set): its own id when it has none. */
export const groupOf = (t, id) => (t && t.group) || id;

const words = (s) => String(s || '').split(/[\s-]+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
/** The token's letter: its own short, else the first letter of its public name. */
export const letterOf = (t) => (t && t.short) || (words(publicName(t))[0] || '?')[0].toUpperCase();

/**
 * A letter for a name that no token in `used` (a Set of letters) has: the first word's initial, then the other
 * words' initials, then two letters (the first two words' initials, or the first word's first two letters).
 */
export function pickLetter(name, used = new Set()) {
  const w = words(name).map((x) => x.toUpperCase());
  if (!w.length) return '?';
  const tries = [...w.map((x) => x[0]), w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2), ...w.flatMap((x) => [...x.slice(1)].map((c) => w[0][0] + c))];
  for (const c of tries) if (c && !used.has(c)) return c;
  return w[0][0];
}

/** Letters taken in a group, by the other tokens of that group. */
export function lettersInGroup(tokens, group, exceptId) {
  const out = new Set();
  for (const [id, t] of Object.entries(tokens || {})) if (id !== exceptId && groupOf(t, id) === group && !t.img && !t.art) out.add(letterOf(t));
  return out;
}

/**
 * Find a token by id, or by name or alias (letter case and spacing ignored). Throws when nothing matches or a
 * name matches more than one token (give the id then).
 * @returns {string} the token's id
 */
export function resolveToken(tokens, ref) {
  if (ref === undefined || ref === null || ref === '') throw new Error('no token given');
  if (tokens[ref]) return ref;
  const k = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(), want = k(ref);
  const hits = Object.entries(tokens).filter(([, t]) => k(t.name) === want || (t.alias && k(t.alias) === want)).map(([id]) => id);
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error(`no token is called "${ref}"`);
  throw new Error(`"${ref}" matches ${hits.length} tokens (${hits.join(', ')}): give the id`);
}

/**
 * Naming problems on one map (warnings: they never stop anything). Two tokens players would see with the same
 * name; two tokens without an image sharing a letter in one group; a creature named with a number.
 * @param {object} tokens {id: token}
 * @returns {string[]}
 */
export function nameProblems(tokens) {
  const out = [], byName = new Map(), byLetter = new Map();
  for (const [id, t] of Object.entries(tokens || {})) {
    if (t.kind === 'marker' || t.kind === 'gm') continue;
    for (const n of new Set([t.name, t.alias].filter(Boolean))) {
      const key = n.trim().toLowerCase();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(id);
    }
    if (t.kind !== 'pc' && t.kind !== 'object' && /(^|\s)(\d+|#\d+|\(\w+\))$/.test(publicName(t).trim())) out.push(`${id}: "${publicName(t)}" is numbered: name it by an adjective and its type`);
    if (!t.img && !t.art) {
      const key = groupOf(t, id) + '|' + letterOf(t);
      if (!byLetter.has(key)) byLetter.set(key, []);
      byLetter.get(key).push(id);
    }
  }
  for (const [n, ids] of byName) if (ids.length > 1) out.push(`${ids.join(', ')} share the name "${tokens[ids[0]].name.trim().toLowerCase() === n ? tokens[ids[0]].name : tokens[ids[0]].alias}"`);
  for (const [key, ids] of byLetter) if (ids.length > 1) out.push(`${ids.join(', ')} share the letter ${key.split('|')[1]} in group ${key.split('|')[0]}`);
  return out;
}
