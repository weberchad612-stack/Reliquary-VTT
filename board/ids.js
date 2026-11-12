// Ids for game objects: a type prefix and 8 random base-36 characters (tok-k3x9q2m7, note-..., tpl-...).
// One maker for everything Claude or the board creates that other records point at. Streams keep time-sortable
// ids (log/<time36>-..., fx/<time>-<n>), map pieces keep their map's name (walls/<map>.<n>), and maps and packs
// keep their authored ids. Docs: docs/design/board.md section 3 (ids), future/backlog.md FR-10.

export const ID_PREFIX = Object.freeze({ token: 'tok', note: 'note', template: 'tpl' });
export const ID_LENGTH = 8;
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** A pattern matching one kind's ids (or any generated id). */
export function idPattern(kind) {
  const p = kind ? ID_PREFIX[kind] : Object.values(ID_PREFIX).join('|');
  if (!p) throw new Error(`no id prefix for "${kind}"`);
  return new RegExp(`^(${p})-[0-9a-z]{${ID_LENGTH}}$`);
}

/** Random bytes: the platform's crypto where there is one, else Math.random (tests pass their own). */
function randomBytes(n) {
  const c = typeof globalThis !== 'undefined' && globalThis.crypto;
  if (c && c.getRandomValues) return c.getRandomValues(new Uint8Array(n));
  return Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256));
}

/**
 * A new id for a kind of object (token, note, template). `taken`: ids already used (a Set or an object of
 * records), never returned. `bytes`: a source of random bytes (tests).
 */
export function makeId(kind, { taken = null, bytes = randomBytes } = {}) {
  const prefix = ID_PREFIX[kind];
  if (!prefix) throw new Error(`no id prefix for "${kind}"`);
  const has = (id) => !!taken && (taken instanceof Set ? taken.has(id) : Object.prototype.hasOwnProperty.call(taken, id));
  for (let tries = 0; tries < 20; tries++) {
    // 36^8 does not divide 256^n evenly; rejecting bytes of 252 and above keeps every character equally likely
    let s = '';
    while (s.length < ID_LENGTH) for (const b of bytes(ID_LENGTH * 2)) { if (b < 252 && s.length < ID_LENGTH) s += ALPHABET[b % 36]; }
    const id = `${prefix}-${s}`;
    if (!has(id)) return id;
  }
  throw new Error('could not make a new id (the random source repeats)');
}

/** Is this a generated id of that kind (or of any kind)? */
export const isId = (id, kind) => typeof id === 'string' && idPattern(kind).test(id);
