// Encounters, for any game system: who is in it, initiative order, round and turn, and the events a turn change
// makes (turn-end, round-end, turn-start, encounter-end) for the system's rules to answer. Pure functions over
// an encounter record: {round, turn, combatants: [{token, initiative, side, delayed?, defeated?, hidden?, stat?,
// roll?}], started, ended?}. Defeated creatures stay listed and their turns are skipped; hidden ones are hidden
// from players only (the board's business).
// `turn` is the index of the creature acting (null before the first turn). The clock moves on one round's
// length at each new round. Docs: docs/design/game-data.md section 8.

/** A new encounter, not started: add combatants, give them initiative, then begin. */
export function newEncounter(now) {
  return { round: 0, turn: null, combatants: [], started: now };
}

/**
 * The order of play: highest initiative first; ties broken by the system's tiebreak (a, b -> negative when a
 * goes first), then by who was added first. Combatants with no initiative yet go last.
 */
export function sortCombatants(list, tiebreak = () => 0) {
  return list.map((c, i) => [c, i]).sort(([a, ai], [b, bi]) => {
    const an = typeof a.initiative === 'number', bn = typeof b.initiative === 'number';
    if (an !== bn) return an ? -1 : 1;
    if (an && a.initiative !== b.initiative) return b.initiative - a.initiative;
    return tiebreak(a, b) || ai - bi;
  }).map(([c]) => c);
}

const current = (enc) => (enc.turn === null || enc.turn === undefined ? null : enc.combatants[enc.turn] || null);
/** The creature whose turn it is, or null. */
export const acting = (enc) => (current(enc) || {}).token || null;

/** Re-sort, keeping the creature whose turn it is acting. */
function resort(enc, tiebreak) {
  const now = acting(enc);
  const combatants = sortCombatants(enc.combatants, tiebreak);
  return { ...enc, combatants, turn: now ? combatants.findIndex((c) => c.token === now) : enc.turn };
}

/** Add a creature (token id) with its side ('pc', 'foe', 'npc') and initiative if known. */
export function addCombatant(enc, { token, side = 'foe', initiative = null }, tiebreak) {
  if (enc.combatants.some((c) => c.token === token)) throw new Error(`${token} is already in the encounter`);
  return resort({ ...enc, combatants: [...enc.combatants, { token, side, ...(initiative === null ? {} : { initiative }) }] }, tiebreak);
}

/**
 * Set a creature's initiative; `extra` keeps how it was rolled ({stat, roll}). initiative null clears it (to roll
 * again).
 */
export function setInitiative(enc, token, initiative, tiebreak, extra = {}) {
  if (!enc.combatants.some((c) => c.token === token)) throw new Error(`${token} is not in the encounter`);
  if (initiative !== null && (typeof initiative !== 'number' || !Number.isFinite(initiative))) throw new Error('initiative is a number');
  return resort({ ...enc, combatants: enc.combatants.map((c) => {
    if (c.token !== token) return c;
    if (initiative === null) { const { initiative: _i, roll: _r, stat: _s, ...rest } = c; return rest; }
    const { roll: _r, stat: _s, ...rest } = c;
    return { ...rest, initiative, ...extra };
  }) }, tiebreak);
}

/** Mark flags on a combatant: {defeated, hidden} (true sets, false clears). */
export function setFlags(enc, token, flags) {
  if (!enc.combatants.some((c) => c.token === token)) throw new Error(`${token} is not in the encounter`);
  return { ...enc, combatants: enc.combatants.map((c) => {
    if (c.token !== token) return c;
    const out = { ...c };
    for (const k of ['defeated', 'hidden']) if (k in flags) { if (flags[k]) out[k] = true; else delete out[k]; }
    return out;
  }) };
}

/** Whether a combatant's turn is skipped: delaying or defeated. */
const skipped = (c) => !!(c && (c.delayed || c.defeated));

/** Take a creature out (dead, fled). If it was acting, the next creature's turn begins: events as next(). */
export function removeCombatant(enc, token, now, roundSeconds) {
  const i = enc.combatants.findIndex((c) => c.token === token);
  if (i < 0) throw new Error(`${token} is not in the encounter`);
  const wasActing = enc.turn === i;
  const combatants = enc.combatants.filter((c) => c.token !== token);
  let turn = enc.turn;
  if (turn !== null && i < turn) turn--;
  const out = { ...enc, combatants, turn: combatants.length ? turn : null };
  if (!wasActing || !combatants.length) return { encounter: out, now, events: [] };
  // the removed creature's turn ends without its turn-end rules; the creature now at its place acts
  if (out.turn >= combatants.length) return advance({ ...out, turn: combatants.length - 1 }, now, roundSeconds, { skipEnd: true });
  return { encounter: out, now, events: [{ type: 'turn-start', token: combatants[out.turn].token, round: out.round }] };
}

/** Start the first round: every creature needs an initiative. Events: round-start, the first turn-start. */
export function begin(enc, now) {
  if (!enc.combatants.length) throw new Error('nobody is in the encounter');
  const missing = enc.combatants.filter((c) => typeof c.initiative !== 'number' && !c.defeated).map((c) => c.token);
  if (missing.length) throw new Error(`no initiative yet for ${missing.join(', ')}`);
  if (enc.round > 0) throw new Error('the encounter has already begun');
  const first = enc.combatants.findIndex((c) => !skipped(c));
  if (first < 0) throw new Error('everyone is delaying or defeated');
  const out = { ...enc, round: 1, turn: first, started: now };
  return { encounter: out, now, events: [{ type: 'round-start', round: 1 }, { type: 'turn-start', token: out.combatants[first].token, round: 1 }] };
}

function advance(enc, now, roundSeconds, { skipEnd = false } = {}) {
  const events = [];
  const cur = current(enc);
  if (cur && !skipEnd) events.push({ type: 'turn-end', token: cur.token, round: enc.round });
  let turn = enc.turn, round = enc.round, t = now;
  for (let step = 0; step <= enc.combatants.length; step++) {
    turn++;
    if (turn >= enc.combatants.length) {
      events.push({ type: 'round-end', round });
      round++; turn = 0; t += roundSeconds;
      events.push({ type: 'round-start', round });
    }
    if (!skipped(enc.combatants[turn])) break;
  }
  const out = { ...enc, round, turn };
  if (skipped(enc.combatants[turn])) return { encounter: { ...out, turn: null }, now: t, events };   // everyone is delaying or defeated
  events.push({ type: 'turn-start', token: out.combatants[turn].token, round });
  return { encounter: out, now: t, events };
}

/** End the current turn and start the next one: {encounter, now, events}. */
export function next(enc, now, roundSeconds = 6) {
  if (!(enc.round > 0)) throw new Error('the encounter has not begun');
  if (enc.ended != null) throw new Error('the encounter is over');
  return advance(enc, now, roundSeconds);
}

/**
 * Back one turn (a correction): the previous creature not delaying or defeated acts again. No turn rules run
 * (what happened stays done); going back past the start of a round takes the clock back one round.
 * Returns {encounter, now, events: []}.
 */
export function previous(enc, now, roundSeconds = 6) {
  if (!(enc.round > 0)) throw new Error('the encounter has not begun');
  let turn = enc.turn === null ? enc.combatants.length : enc.turn, round = enc.round, t = now;
  for (let step = 0; step <= enc.combatants.length; step++) {
    turn--;
    if (turn < 0) {
      if (round <= 1) return { encounter: enc, now, events: [] };   // the first turn: nothing before it
      round--; turn = enc.combatants.length - 1; t -= roundSeconds;
    }
    if (!skipped(enc.combatants[turn])) return { encounter: { ...enc, round, turn }, now: t, events: [] };
  }
  return { encounter: enc, now, events: [] };
}

/**
 * The acting creature delays: its turn ends (its turn-end rules happen now, as the rules say) and it leaves the
 * order until it comes back with resume().
 */
export function delay(enc, now, roundSeconds = 6) {
  const cur = current(enc);
  if (!cur) throw new Error('nobody is acting');
  const marked = { ...enc, combatants: enc.combatants.map((c) => (c === cur ? { ...c, delayed: true } : c)) };
  const r = advance(marked, now, roundSeconds);
  r.events[0] = { ...r.events[0], delayed: true };
  return r;
}

/**
 * A delaying creature comes back: it acts now, before whoever was about to act; its initiative becomes just
 * above theirs. Events: the interrupted creature's turn does not end (it had not started acting: its
 * turn-start is undone by the system if needed); the returning creature's turn starts.
 */
export function resume(enc, token, now) {
  const c = enc.combatants.find((x) => x.token === token);
  if (!c || !c.delayed) throw new Error(`${token} is not delaying`);
  const next = current(enc) || enc.combatants.find((x) => !x.delayed);
  const initiative = next ? (next.initiative ?? 0) + 0.5 : c.initiative;
  const others = enc.combatants.filter((x) => x.token !== token);
  const at = next ? others.indexOf(next) : others.length;
  const combatants = [...others.slice(0, at), { ...c, delayed: undefined, initiative }, ...others.slice(at)].map((x) => (x.delayed === undefined ? (({ delayed: _d, ...y }) => y)(x) : x));
  const turn = combatants.findIndex((x) => x.token === token);
  return { encounter: { ...enc, combatants, turn }, now, events: [{ type: 'turn-start', token, round: enc.round, resumed: true }] };
}

/** End the encounter: {encounter (ended), now, events: [turn-end of whoever was acting, encounter-end]}. */
export function end(enc, now) {
  const cur = current(enc), events = [];
  if (cur) events.push({ type: 'turn-end', token: cur.token, round: enc.round });
  events.push({ type: 'encounter-end', round: enc.round });
  return { encounter: { ...enc, turn: null, ended: now }, now, events };
}
