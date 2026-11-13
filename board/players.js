// The campaign's players: who plays which PCs, kept in the table's state (state/table.players, saved in
// campaign.json). The ledger records which player, and which of their characters, introduced an invented detail
// (board/ledger.js); tools/players.mjs edits the list. Pure. Docs: docs/best-practices/board.md (the ledger).
//
// A player: {id (lower-case, digits, dashes), name, pcs?: [token ids], gm? (also uses the GM view)}

/** An id from a name: "Chad W." -> "chad-w". */
export const playerId = (name) => String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** A player record, checked. */
export function playerRecord({ id = null, name, pcs = [], gm = false }) {
  const n = String(name || '').trim();
  if (!n) throw new Error('a player needs a name');
  const pid = id || playerId(n);
  if (!/^[a-z0-9-]+$/.test(pid)) throw new Error(`player id "${pid}": lower-case letters, digits and dashes`);
  const out = { id: pid, name: n };
  const p = [...new Set((pcs || []).filter(Boolean))];
  if (p.length) out.pcs = p;
  if (gm) out.gm = true;
  return out;
}

/** The player with this id or name (case-insensitive), or null. */
export function findPlayer(players, ref) {
  const k = (s) => String(s || '').trim().toLowerCase();
  return (players || []).find((p) => p.id === ref || k(p.name) === k(ref)) || null;
}

/** The player who plays a PC (by token id), or null. */
export const playerOf = (players, token) => (players || []).find((p) => (p.pcs || []).includes(token)) || null;

/**
 * Who introduced a detail, filled in: {player, character}. A character alone names its player; a lone player in
 * the campaign is the player when none is given. Throws on a character the given player doesn't play.
 */
export function introducer(players, { player = null, character = null } = {}) {
  let p = player ? findPlayer(players, player) : null;
  if (player && !p) throw new Error(`no player "${player}" in the campaign (tools/players.mjs add)`);
  const owner = character ? playerOf(players, character) : null;
  if (p && owner && owner.id !== p.id) throw new Error(`${p.name} doesn't play that character (${owner.name} does)`);
  p = p || owner || ((players || []).length === 1 ? players[0] : null);
  return { player: p ? p.id : null, character: character || null };
}
