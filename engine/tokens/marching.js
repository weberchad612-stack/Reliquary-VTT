// The party's marching order (docs/design/board.md, "The party's marching order"): a 4 x 4 grid of slots, row 0 the front, that the
// party keeps when it arrives on a map or when Claude moves it, turned to face the way it is heading (8 directions).
//
// A slot is [col, row], col 0..3 left to right, row 0..3 front to back, as the players see the grid (forward up).
// Only the members' positions relative to each other count (marchCentre): where on the grid they stand does not.
// The record (state/marching): {slots: {<token id>: [col, row]}, extra: [<token id>]}: who stands where, and the
// members the GM added besides the living PCs (a companion, an allied NPC travelling with the party).
//
// Turning: a cardinal direction lays the block out square for square. A diagonal one lays its rows along the
// diagonals (each member a diagonal step from its neighbours), so every slot still lands on a square of its own.

export const MARCH_SIZE = 4;
export const MARCH_DIRS = Object.freeze(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
// forward vectors on the map (x right, y down); a diagonal's is a whole diagonal step
const FORWARD = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };
// the order new members fill the grid: the middle two columns first, front to back, then the outer columns
export const MARCH_FILL = Object.freeze([[1, 0], [2, 0], [1, 1], [2, 1], [1, 2], [2, 2], [1, 3], [2, 3], [0, 0], [3, 0], [0, 1], [3, 1], [0, 2], [3, 2], [0, 3], [3, 3]]);

/** The direction (one of MARCH_DIRS) nearest a heading dx, dy on the map; null for no heading. */
export function marchFacing(dx, dy) {
  if (!dx && !dy) return null;
  const a = Math.atan2(dx, -dy);   // 0 = north (up), clockwise
  return MARCH_DIRS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

/** The party's members: living PCs and the GM's additions that exist, in name order. tokens: {id: token}. */
export function marchMembers(tokens, marching = {}) {
  const extra = new Set(marching.extra || []);
  return Object.entries(tokens || {})
    .filter(([id, t]) => t && !t.dead && (t.kind === 'pc' || extra.has(id)))
    .sort(([a, ta], [b, tb]) => String(ta.name || a).localeCompare(String(tb.name || b)))
    .map(([id]) => id);
}

const valid = (s) => Array.isArray(s) && s.length === 2 && s.every((v) => Number.isInteger(v) && v >= 0 && v < MARCH_SIZE);

/** Every member's slot: the saved one where it is valid and free, the rest in MARCH_FILL order. {id: [col, row]} */
export function marchSlots(ids, slots = {}) {
  const out = {}, taken = new Set();
  for (const id of ids) {
    const s = slots[id];
    if (valid(s) && !taken.has(s.join(','))) { out[id] = [s[0], s[1]]; taken.add(s.join(',')); }
  }
  for (const id of ids) {
    if (out[id]) continue;
    const free = MARCH_FILL.find((c) => !taken.has(c.join(',')));
    if (!free) break;   // more than 16 members: the rest have no slot
    out[id] = [free[0], free[1]];
    taken.add(free.join(','));
  }
  return out;
}

/** Moving a member to a slot: whoever stands there swaps into the member's old slot. Returns new slots. */
export function marchMove(slots, id, slot) {
  const out = { ...slots };
  const from = out[id];
  const other = Object.keys(out).find((k) => k !== id && out[k][0] === slot[0] && out[k][1] === slot[1]);
  out[id] = [slot[0], slot[1]];
  if (other) { if (from) out[other] = from; else delete out[other]; }
  return out;
}

/**
 * The middle of the occupied squares (the user, 2026-11-14): only the members' positions relative to each other count,
 * not where on the 4 x 4 grid they were drawn. A column drawn on the right-hand edge plays the same as one in the middle.
 * slots: {id: [col, row]} (or a list of slots).
 */
export function marchCentre(slots) {
  const list = Array.isArray(slots) ? slots : Object.values(slots || {});
  if (!list.length) return [1.5, 1.5];
  const cs = list.map((s) => s[0]), rs = list.map((s) => s[1]);
  return [(Math.min(...cs) + Math.max(...cs)) / 2, (Math.min(...rs) + Math.max(...rs)) / 2];
}

/** A slot's square offset from the block's anchor, for a direction; centre: the occupied squares' middle. */
export function marchOffset([col, row], dir, centre = [1.5, 1.5]) {
  const [fx, fy] = FORWARD[dir] || FORWARD.n;
  const rx = -fy, ry = fx;   // right of forward (clockwise a quarter turn, y down)
  const a = col - centre[0], b = row - centre[1];   // right of the middle; behind the middle
  const x = a * rx - b * fx, y = a * ry - b * fy;
  return [Math.floor(x + 0.5 + 1e-9), Math.floor(y + 0.5 + 1e-9)];
}

/** The rearmost and frontmost rows anyone stands in. */
function rows(slots) {
  const r = Object.values(slots).map((s) => s[1]);
  return r.length ? [Math.max(...r), Math.min(...r)] : [MARCH_SIZE - 1, 0];
}

/**
 * The block's anchor square for an arrival: the rearmost occupied row's middle on the arrival point, the block ahead
 * of it. at: the arrival point (a square); dir: the facing.
 */
export function marchAnchorBehind(at, dir, slots) {
  const c = marchCentre(slots), [back] = rows(slots);
  const o = marchOffset([c[0], back], dir, c);
  return [at[0] - o[0], at[1] - o[1]];
}

/** The block's anchor square for a move: the frontmost occupied row's middle on the destination. */
export function marchAnchorAhead(at, dir, slots) {
  const c = marchCentre(slots), [, front] = rows(slots);
  const o = marchOffset([c[0], front], dir, c);
  return [at[0] - o[0], at[1] - o[1]];
}

/** The way into a map from an entrance: from the entrance's own squares to its arrival squares, else toward the map's middle. */
export function marchArrivalFacing({ link = null, cells = [], grid = null, start = null, facing = null }) {
  if (facing && MARCH_DIRS.includes(facing)) return facing;
  const mid = (cs) => cs.reduce((s, c) => [s[0] + c[0] / cs.length, s[1] + c[1] / cs.length], [0, 0]);
  if (link && link.at && link.at.length && cells.length) {
    const a = mid(link.at), b = mid(cells);
    const f = marchFacing(b[0] - a[0], b[1] - a[1]);
    if (f) return f;
  }
  const from = cells.length ? mid(cells) : start && start.length ? mid(start) : null;
  if (from && grid && grid.cols && grid.rows) {
    const f = marchFacing((grid.cols - 1) / 2 - from[0], (grid.rows - 1) / 2 - from[1]);
    if (f) return f;
  }
  return 'n';
}

/**
 * Squares for the party in formation, each as near its place in the block as the map allows. Where the block does
 * not fit (a narrow passage, a doorway, a corner), the party walks in column instead: in marching order (front row
 * first, left to right), each member takes the next free square along the way from the lead square, so the front
 * stays in front and the passage's width decides how many walk abreast.
 * @param {object} o
 * @param {object} o.pm          the map prepared for movement (prepareMove)
 * @param {object} o.engine      {fits, canStep, blockersAt}
 * @param {Array} o.anchor       the block's anchor square [x, y]
 * @param {string} o.dir         the facing (MARCH_DIRS)
 * @param {Array} o.members      [{id, size?, slot: [col, row]}]
 * @param {Array} o.seeds        squares the party comes from (the arrival squares, the destination): only squares
 *                               that can be walked to from them are used, so nobody lands behind a wall
 * @param {Array} [o.origin]     squares the party comes from, when it is not the seeds (a move: where the party
 *                               stands now): in column, "behind" is toward them
 * @param {Array} [o.occupants]  tokens already there (they block as usual)
 * @param {Function} [o.spill] (x, y) -> may a member stand here when it is not its own place: the party never
 *                               spills into ground it has not explored (the user, 2026-11-14), so the board passes
 *                               "explored"; the seeds (the way in, the destination) are always allowed
 * @param {number} [o.slack=1]   how far (squares) a member may land from its place before the party goes in column
 * @param {number} [o.limit=2000] squares searched at most
 * @returns {{placed: Array<{id, x, y}>, unplaced: Array<string>, column: boolean}}
 */
export function placeFormation({ pm, engine, anchor, dir, members, seeds, origin = null, occupants = [], spill = null, slack = 1, limit = 2000 }) {
  const { fits, canStep, blockersAt } = engine;
  const key = (x, y) => x + ',' + y;
  const order = members.slice().sort((p, q) => p.slot[1] - q.slot[1] || p.slot[0] - q.slot[0]);
  const centre = marchCentre(members.map((m) => m.slot));   // relative positions only
  const target = (m) => { const [ox, oy] = marchOffset(m.slot, dir, centre); return [anchor[0] + ox, anchor[1] + oy]; };
  // squares that can be walked to, breadth-first from `from`, in order, with each one's walking distance
  const walk = (from) => {
    const out = [], dist = new Map(), queue = [];
    for (const [x, y] of from) {
      if (dist.has(key(x, y)) || !fits(pm, x, y, 1)) continue;
      dist.set(key(x, y), 0); out.push([x, y]); queue.push([x, y]);
    }
    for (let i = 0; i < queue.length && out.length < limit; i++) {
      const [x, y] = queue[i], d = dist.get(key(x, y));
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (dist.has(key(nx, ny)) || !canStep(pm, { x, y, size: 1 }, dx, dy)) continue;
        dist.set(key(nx, ny), d + 1); out.push([nx, ny]); queue.push([nx, ny]);
      }
    }
    out.dist = dist;
    return out;
  };
  const seedSet = new Set(seeds.map((c) => key(c[0], c[1])));
  const mayUse = (x, y) => !spill || seedSet.has(key(x, y)) || spill(x, y);
  const free = (m, x, y, here) => fits(pm, x, y, m.size || 1) && !blockersAt({ ...m, size: m.size || 1 }, x, y, here).length;

  // 1. the block: each member on the reachable square nearest its place
  const reach = walk(seeds);
  const block = { placed: [], unplaced: [], worst: 0 };
  const here = occupants.slice();
  for (const m of order) {
    const [tx, ty] = target(m);
    let best = null, bestD = Infinity;
    for (const [x, y] of reach) {
      const d = (x - tx) ** 2 + (y - ty) ** 2;
      if (d >= bestD || (d > 0 && !mayUse(x, y)) || !free(m, x, y, here)) continue;
      best = [x, y]; bestD = d;
      if (d === 0) break;
    }
    if (!best) { block.unplaced.push(m.id); continue; }
    block.placed.push({ id: m.id, x: best[0], y: best[1] });
    block.worst = Math.max(block.worst, Math.sqrt(bestD));
    here.push({ ...m, size: m.size || 1, x: best[0], y: best[1] });
  }
  if (block.worst <= slack + 1e-9 || !order.length) return { placed: block.placed, unplaced: block.unplaced, column: false };

  // 2. the column. "Behind" is toward where the party comes from (origin, else the seeds): the lead stands as near
  // its place as it can with room behind it for everyone, and the others follow in marching order, each on the free
  // square nearest the lead that is no further in than the lead
  const back = origin && origin.length ? walk(origin) : reach;
  const inReach = new Set(reach.map((c) => key(c[0], c[1])));
  const behind = (c) => back.dist.get(key(c[0], c[1]));
  const cands = reach.filter((c) => behind(c) !== undefined).sort((p, q) => behind(p) - behind(q));
  const need = cands.length ? behind(cands[Math.min(order.length, cands.length) - 1]) : 0;
  const lead = target(order[0]);
  const [fx, fy] = FORWARD[dir] || FORWARD.n;
  let start = null, sd = Infinity;
  for (const c of cands) {
    if (behind(c) < need || (!mayUse(c[0], c[1]) && !(c[0] === lead[0] && c[1] === lead[1]))) continue;
    // nearest the lead's place; a tie goes to the square further forward (the column leads the way it faces)
    const d = (c[0] - lead[0]) ** 2 + (c[1] - lead[1]) ** 2 - 1e-3 * ((c[0] - lead[0]) * fx + (c[1] - lead[1]) * fy);
    if (d < sd) { start = c; sd = d; }
  }
  const fromLead = start ? walk([start]).filter((c) => inReach.has(key(c[0], c[1]))) : [];
  const usable = fromLead.filter((c) => mayUse(c[0], c[1]) || (start && c[0] === start[0] && c[1] === start[1]));
  const line = [...usable.filter((c) => behind(c) !== undefined && behind(c) <= behind(start)), ...usable.filter((c) => !(behind(c) <= behind(start)))];
  const placed = [], unplaced = [], taken = occupants.slice();
  for (const m of order) {
    const spot = line.find(([x, y]) => free(m, x, y, taken));
    if (!spot) { unplaced.push(m.id); continue; }
    placed.push({ id: m.id, x: spot[0], y: spot[1] });
    taken.push({ ...m, size: m.size || 1, x: spot[0], y: spot[1] });
  }
  // the column is a fallback: when it fits fewer than the block did, the block stands
  if (unplaced.length > block.unplaced.length) return { placed: block.placed, unplaced: block.unplaced, column: false };
  return { placed, unplaced, column: true };
}
