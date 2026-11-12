// The encounter tracker's rules on the board: which rows a view sees, what each view may do with a row, and the
// encounter actions as changes to the record (state/encounter) with the events the system's turn rules answer.
// Pure; board/trackerui.js draws it. Docs: docs/design/board.md (the encounter tracker),
// docs/best-practices/board.md (the encounter tracker).
//
// A view: 'gm' or 'player'. A player controls the party's PCs (token kind 'pc'): adds them, rolls for them, ends
// and delays their turns. The GM controls everything.

/** Whether this view may act for a token: the GM for any, a player for a PC. */
export function controls(view, token) {
  return view === 'gm' || !!(token && token.kind === 'pc');
}

/** Whether an encounter is open (there is one and it has not ended). */
export const openEncounter = (enc) => !!(enc && enc.ended == null);   // ended is a time, and 0 is a time
/** Whether it has begun (round 1 or later). */
export const begun = (enc) => openEncounter(enc) && enc.round > 0;

/**
 * The rows this view sees, in order. tokens: {id: token} (this map's); seen(id): whether the party sees it now;
 * name(id): the name this view uses. The GM sees every row (hidden ones marked); players see a creature only when
 * the party sees it (PCs always) and the GM has not hidden it.
 * Each row: {token, name, kind, initiative, stat, roll, acting, delayed, defeated, hidden, mine (this view acts
 * for it), present (its token is on this map)}.
 */
export function trackerRows(enc, tokens, { view, seen = () => true, name = (id) => id } = {}) {
  if (!openEncounter(enc)) return [];
  const out = [];
  enc.combatants.forEach((c, i) => {
    const t = tokens[c.token];
    if (view !== 'gm') {
      if (c.hidden || !t) return;
      if (t.kind !== 'pc' && !seen(c.token)) return;
    }
    out.push({
      token: c.token, name: t ? name(c.token) : '(not on this map)', kind: t ? t.kind : c.side, side: c.side,
      initiative: typeof c.initiative === 'number' ? c.initiative : null, stat: c.stat || null, roll: c.roll || null,
      acting: i === enc.turn, delayed: !!c.delayed, defeated: !!c.defeated || !!(t && t.dead), hidden: !!c.hidden,
      mine: controls(view, t), present: !!t,
    });
  });
  return out;
}

/** Initiative as shown: whole numbers as they are, a placed creature's half step with its decimal ("17.5"). */
export const initiativeText = (n) => (typeof n === 'number' ? String(Math.round(n * 100) / 100) : '');

/**
 * The initiative a creature takes when dropped at `index` in the order (`order`: the rows as shown, top first, the
 * dragged one left out; each {token, initiative}): between its new neighbours, a whole number when one fits, else
 * the midpoint; above the top one, one more; below the bottom one, one less. Neighbours with no initiative are
 * passed over. Returns a number, or null when nobody around it has initiative.
 */
export function dropInitiative(order, index) {
  const above = order.slice(0, index).reverse().find((r) => typeof r.initiative === 'number');
  const below = order.slice(index).find((r) => typeof r.initiative === 'number');
  if (!above && !below) return null;
  if (!above) return Math.floor(below.initiative) + 1;
  if (!below) return Math.ceil(above.initiative) - 1;
  const a = above.initiative, b = below.initiative;
  if (a <= b) return a;   // a tie: it goes with the one above (the tiebreak decides)
  const whole = Math.ceil(b + 0.0001);
  if (whole < a) return Math.floor((a + b) / 2) > b ? Math.floor((a + b) / 2) : whole;
  return (a + b) / 2;
}

/**
 * Whether this view may drag a row: the GM any row with initiative; a player only their PCs' (and only down, which
 * the drop checks). rows: as trackerRows gives them.
 */
export const canDrag = (row, view) => row.initiative !== null && (view === 'gm' || row.mine);

/**
 * Who still needs initiative, for Roll All (everyone) or Roll NPCs (everyone but PCs): token ids.
 */
export function needInitiative(enc, tokens, which = 'all') {
  if (!openEncounter(enc)) return [];
  return enc.combatants.filter((c) => typeof c.initiative !== 'number' && !c.defeated)
    .filter((c) => which === 'all' || ((tokens[c.token] || {}).kind || c.side) !== 'pc').map((c) => c.token);
}

/**
 * Apply an action to the encounter. E: the engine's encounter functions; T: {tiebreak, roundSeconds}; now: the
 * clock's seconds. Returns {encounter, now, events, lines} or throws with a reason a person can read.
 * action: {type, token?, side?, initiative?, extra?, flags?} with type one of add, remove, initiative, clear,
 * set (the GM types a number), move (dragged in the order), flags, begin, next, previous, next-round,
 * previous-round, delay, resume, end.
 */
export function applyAction(enc, action, { E, T, now = 0, view = 'gm', tokens = {}, name = (id) => id }) {
  const t = action.token ? tokens[action.token] : null;
  const mayAct = (id) => controls(view, tokens[id]);
  const gmOnly = () => { if (view !== 'gm') throw new Error('only the GM can do that'); };
  const done = (e, lines = [], events = [], at = now) => ({ encounter: e, now: at, events, lines });
  const live = openEncounter(enc) ? enc : null;
  switch (action.type) {
    case 'add': {
      if (!mayAct(action.token)) throw new Error('players can only add their own characters');
      const base = live || E.newEncounter(now);
      const side = action.side || (['pc', 'npc', 'foe'].includes((t || {}).kind) ? t.kind : 'foe');
      return done(E.addCombatant(base, { token: action.token, side }, T.tiebreak), [`${name(action.token)} enters the encounter`]);
    }
    case 'remove': {
      if (!live) throw new Error('there is no encounter');
      if (!mayAct(action.token)) throw new Error('players can only remove their own characters');
      const r = E.removeCombatant(live, action.token, now, T.roundSeconds);
      const e = r.encounter.combatants.length ? r.encounter : { ...r.encounter, ended: now };
      return done(e, [`${name(action.token)} leaves the encounter`], r.events, r.now);
    }
    case 'move': {
      // dragged in the order: a player only their own PC, and only down (later in the round)
      if (!live) throw new Error('there is no encounter');
      if (!mayAct(action.token)) throw new Error('players can only move their own characters');
      const c = live.combatants.find((x) => x.token === action.token);
      if (!c) throw new Error('that creature is not in the encounter');
      if (view !== 'gm' && !(typeof c.initiative === 'number' && action.initiative < c.initiative)) throw new Error('players can only move their characters down the order');
      return done(E.setInitiative(live, action.token, action.initiative, T.tiebreak, setByHand(c)), [`${name(action.token)} moves to initiative ${initiativeText(action.initiative)}`]);
    }
    case 'set': {
      gmOnly();
      if (!live) throw new Error('there is no encounter');
      const c = live.combatants.find((x) => x.token === action.token);
      if (!c) throw new Error('that creature is not in the encounter');
      return done(E.setInitiative(live, action.token, action.initiative, T.tiebreak, setByHand(c)), [`${name(action.token)}: initiative set to ${initiativeText(action.initiative)}`]);
    }
    case 'initiative': {
      if (!live) throw new Error('there is no encounter');
      if (!mayAct(action.token)) throw new Error('players can only roll for their own characters');
      return done(E.setInitiative(live, action.token, action.initiative, T.tiebreak, action.extra || {}), []);
    }
    case 'clear': {
      if (!live) throw new Error('there is no encounter');
      if (!mayAct(action.token)) throw new Error('players can only clear their own characters');
      return done(E.setInitiative(live, action.token, null, T.tiebreak), [`${name(action.token)}'s initiative cleared`]);
    }
    case 'flags': {
      gmOnly();
      if (!live) throw new Error('there is no encounter');
      const f = action.flags || {};
      const words = [];
      if ('defeated' in f) words.push(f.defeated ? 'defeated' : 'no longer defeated');
      if ('hidden' in f) words.push(f.hidden ? 'hidden from players' : 'shown to players');
      return done(E.setFlags(live, action.token, f), [`${name(action.token)}: ${words.join(', ')}`]);
    }
    case 'begin': gmOnly(); { const r = E.begin(live || enc, now); return done(r.encounter, ['the encounter begins'], r.events, r.now); }
    case 'next': {
      if (!begun(live)) throw new Error('the encounter has not begun');
      const acting = E.acting(live);
      if (view !== 'gm' && !(acting && mayAct(acting))) throw new Error('players can only end their own turn');
      const r = E.next(live, now, T.roundSeconds);
      return done(r.encounter, [], r.events, r.now);
    }
    case 'previous': gmOnly(); { const r = E.previous(live, now, T.roundSeconds); return done(r.encounter, [], r.events, r.now); }
    case 'next-round': gmOnly(); { if (!begun(live)) throw new Error('the encounter has not begun'); const r = E.nextRound(live, now, T.roundSeconds); return done(r.encounter, [], r.events, r.now); }
    case 'previous-round': gmOnly(); { if (!begun(live)) throw new Error('the encounter has not begun'); const r = E.previousRound(live, now, T.roundSeconds); return done(r.encounter, [`back to the start of round ${r.encounter.round}`], r.events, r.now); }
    case 'delay': {
      if (!begun(live)) throw new Error('the encounter has not begun');
      const acting = E.acting(live);
      if (!acting) throw new Error('nobody is acting');
      if (view !== 'gm' && !mayAct(acting)) throw new Error('players can only delay their own turn');
      const r = E.delay(live, now, T.roundSeconds);
      return done(r.encounter, [`${name(acting)} delays`], r.events, r.now);
    }
    case 'resume': {
      if (!begun(live)) throw new Error('the encounter has not begun');
      if (!mayAct(action.token)) throw new Error('players can only bring back their own characters');
      const r = E.resume(live, action.token, now);
      return done(r.encounter, [`${name(action.token)} stops delaying`], r.events, r.now);
    }
    case 'end': gmOnly(); { if (!live) throw new Error('there is no encounter'); const r = E.end(live, now); return done(r.encounter, [`the encounter ends after ${live.round} round(s)`], r.events, r.now); }
    default: throw new Error(`no encounter action "${action.type}"`);
  }
}

/** A creature's roll, kept when its initiative is set or moved by hand (and marked so). */
const setByHand = (c) => ({ ...(c.stat ? { stat: c.stat } : {}), roll: { ...(c.roll || {}), set: true } });

/** The event lines a turn change shows (the round, whose turn it is), in order. */
export function eventLines(events, name = (id) => id) {
  const out = [];
  for (const ev of events) {
    if (ev.type === 'round-start') out.push(`round ${ev.round}`);
    if (ev.type === 'turn-start') out.push(`${name(ev.token)}'s turn`);
  }
  return out;
}

/** Dead tokens in the encounter not yet marked defeated: the GM view marks them (tokens: {id: token}). */
export function newlyDefeated(enc, tokens) {
  if (!openEncounter(enc)) return [];
  return enc.combatants.filter((c) => !c.defeated && tokens[c.token] && tokens[c.token].dead).map((c) => c.token);
}
