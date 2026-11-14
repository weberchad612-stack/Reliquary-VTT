// Adventure events (future/adventure-events.md; docs/design/game-data.md, Events): what the book says happens when,
// as data. An event has a trigger (conditions on the game: the party's level, the time, where the party is, flags,
// what they carry, fights that ended, the encounter's round, a creature's turn or wounds) and stages, each with
// actions (narration, cards, effects, placing creatures, starting a fight, flags, ledger entries, decisions) and
// what moves it on (a condition, branches, the next stage). The engine only decides what is due and moves an
// event's state along; the actions are carried out by Claude's tools (tools/events.mjs). System-free: a ruleset
// supplies nothing here except, if it likes, the hours of daylight.
//
// Definition (from the pack's adventure.json): {id, title, kind?, pages?, where?: {map, area}, trigger, stages:
//   [{id, title?, when?, actions: [...], branches?: [{if, go}], next?, end?}], repeat?: {cooldown: seconds}, note?}
//   (a stage with `end`, or with branches and no `next`, is the event's last: it finishes after it)
// State (play's, kept in the save): {status: 'waiting'|'running'|'done'|'cooldown', stage?, started?, stage_at?,
//   runs?, last?, history?: [{at, what}], decisions?: {id: choice}}
// Conditions: {all: [...]}, {any: [...]}, {not: c}, {level: {min?, max?}}, {time: 'night'|'day'}, {after: seconds},
//   {elapsed: {seconds, since: 'event'|'stage'}}, {map: id | [ids]}, {area: key | [keys]}, {outdoors: true},
//   {flag: name, is?: value}, {carrying: ref or name}, {event: id, status?: 'done'|...},
//   {encounter_ended: group | 'any'} (since the event, or for a stage since that stage, began),
//   {round: n, group?}, {turn: group | token name}, {hp_below: fraction, group}, {manual: true} (never by itself).
// A subsystem (engine/events/subsystem.js) talks to events through flags: <subsystem>:<threshold>, <subsystem>:<part>
//   (overcome) and <subsystem>:success|failure.

export const DAY_HOURS = Object.freeze({ from: 6, to: 18 });
export const STATUSES = Object.freeze(['waiting', 'running', 'done', 'cooldown']);
/** The fields of an event that are play's (kept when a campaign is refreshed from its pack). */
export const EVENT_STATE_FIELDS = Object.freeze(['status', 'stage', 'started', 'stage_at', 'runs', 'last', 'history', 'decisions']);

/**
 * Split a save's events ({id: definition and state}, events.json or the events/<id> records) into the definitions
 * (with their ids) and the states.
 */
export function splitEvents(saved) {
  const defs = [], states = {};
  for (const [id, e] of Object.entries(saved || {})) {
    const st = {}, def = { id };
    for (const [k, v] of Object.entries(e)) (EVENT_STATE_FIELDS.includes(k) ? st : def)[k] = v;
    defs.push(def); states[id] = st;
  }
  return { defs, states };
}

const list = (v) => (Array.isArray(v) ? v : [v]);

/**
 * Whether condition `c` holds. ctx: {now, hour, day?: {from, to}, level, party: {map, areas: [], outdoors},
 * flags: {name: value}, carrying: [refs and names], events: {id: state}, ended: {group: game seconds},
 * encounter: {active, round, acting: {group, name}, groups: [], hp: {group: fraction}}}. st: the event's state.
 */
export function holds(c, ctx, st = {}) {
  if (!c) return true;
  if (c.all) return c.all.every((x) => holds(x, ctx, st));
  if (c.any) return c.any.some((x) => holds(x, ctx, st));
  if (c.not) return !holds(c.not, ctx, st);
  const ok = [];
  const day = ctx.day || DAY_HOURS;
  if ('manual' in c) ok.push(false);
  if (c.level) ok.push((c.level.min === undefined || ctx.level >= c.level.min) && (c.level.max === undefined || ctx.level <= c.level.max));
  if (c.time) { const isDay = ctx.hour >= day.from && ctx.hour < day.to; ok.push(c.time === 'day' ? isDay : !isDay); }
  if (c.after !== undefined) ok.push(ctx.now >= c.after);
  if (c.elapsed) { const from = c.elapsed.since === 'stage' ? st.stage_at : st.started; ok.push(from !== undefined && ctx.now - from >= c.elapsed.seconds); }
  if (c.map) ok.push(list(c.map).includes((ctx.party || {}).map));
  if (c.area) ok.push(list(c.area).some((a) => ((ctx.party || {}).areas || []).includes(a)));
  if (c.outdoors !== undefined) ok.push(!!(ctx.party || {}).outdoors === !!c.outdoors);
  // a flag is set unless it is missing, null or false (a game time of 0 counts: flags often hold the time they were set)
  if (c.flag) { const v = (ctx.flags || {})[c.flag]; ok.push('is' in c ? v === c.is : v !== undefined && v !== null && v !== false); }
  if (c.carrying) ok.push((ctx.carrying || []).some((x) => String(x).toLowerCase() === String(c.carrying).toLowerCase()));
  if (c.event) { const s = (ctx.events || {})[c.event] || { status: 'waiting' }; ok.push(s.status === (c.status || 'done')); }
  if (c.encounter_ended) {
    const since = st.stage_at ?? st.started ?? -Infinity;
    const ended = ctx.ended || {};
    const times = c.encounter_ended === 'any' ? Object.values(ended) : [ended[c.encounter_ended]];
    ok.push(times.some((t) => t !== undefined && t >= since));
  }
  const enc = ctx.encounter || {};
  if (c.round !== undefined) ok.push(!!enc.active && enc.round >= c.round && (!c.group || (enc.groups || []).includes(c.group)));
  if (c.turn) ok.push(!!enc.active && !!enc.acting && (enc.acting.group === c.turn || enc.acting.name === c.turn));
  if (c.hp_below !== undefined) ok.push(!!enc.active && ((enc.hp || {})[c.group] ?? 1) < c.hp_below);
  if (!ok.length) throw new Error(`unknown condition ${JSON.stringify(c)}`);
  return ok.every(Boolean);
}

/** An event's state, filled in. */
export const stateOf = (states, id) => ({ status: 'waiting', ...((states || {})[id] || {}) });

/** A stage of an event by id (or its first). */
export function stageOf(ev, id) {
  return (ev.stages || []).find((s) => s.id === id) || null;
}

/**
 * What is due now: [{id, title, kind: 'start' | 'stage' | 'branch', to?, why}]. A waiting event starts when its
 * trigger holds (a manual one never does); a cooling one waits out its cooldown first. A running event moves on to
 * a branch whose condition holds, else to its next stage once that stage's `when` holds (a next stage with no `when`
 * is not due by itself: Claude moves it on when the current stage's actions are done).
 */
export function dueEvents(defs, states, ctx) {
  const out = [];
  for (const ev of defs) {
    const st = stateOf(states, ev.id);
    if (st.status === 'done') continue;
    if (st.status === 'waiting' || st.status === 'cooldown') {
      if (st.status === 'cooldown' && !(ev.repeat && ctx.now - (st.last ?? -Infinity) >= (ev.repeat.cooldown || 0))) continue;
      if (holds(ev.trigger, ctx, st)) out.push({ id: ev.id, title: ev.title, kind: 'start', to: (ev.stages || [])[0] && ev.stages[0].id, why: 'its trigger holds' });
      continue;
    }
    const cur = stageOf(ev, st.stage);
    if (!cur) continue;
    const br = (cur.branches || []).find((b) => holds(b.if, ctx, st));
    if (br) { out.push({ id: ev.id, title: ev.title, kind: 'branch', to: br.go, why: `a branch of ${cur.id} holds` }); continue; }
    const nid = nextStage(ev, st);
    const next = nid ? stageOf(ev, nid) : null;
    if (next && next.when && holds(next.when, ctx, st)) out.push({ id: ev.id, title: ev.title, kind: 'stage', to: next.id, why: `${next.id}'s condition holds` });
  }
  return out;
}

const note = (st, at, what) => ({ ...st, history: [...(st.history || []), { at, what }] });

/** Start an event at its first stage (or `stage`). */
export function startEvent(ev, st, now, stage = null) {
  const first = stage || ((ev.stages || [])[0] || {}).id || null;
  return note({ ...st, status: 'running', stage: first, started: now, stage_at: now, runs: (st.runs || 0) + 1 }, now, `started${first ? ` at ${first}` : ''}`);
}

/** Move a running event to another stage. */
export function moveTo(ev, st, to, now) {
  if (!stageOf(ev, to)) throw new Error(`event ${ev.id} has no stage "${to}"`);
  return note({ ...st, stage: to, stage_at: now }, now, `to ${to}`);
}

/**
 * The stage that follows the current one, or null when the event finishes after it: its `next`; none for a stage
 * marked `end` or one whose only ways on are branches; else the stage written after it.
 */
export function nextStage(ev, st) {
  const cur = stageOf(ev, st.stage);
  if (!cur) return null;
  if (cur.next) return cur.next;
  if (cur.end || (cur.branches || []).length) return null;
  const i = (ev.stages || []).indexOf(cur);
  return (ev.stages[i + 1] || {}).id || null;
}

/** End an event: done, or cooling down when it repeats. */
export function finishEvent(ev, st, now) {
  const { stage: _s, stage_at: _a, ...rest } = st;
  return note({ ...rest, status: ev.repeat ? 'cooldown' : 'done', last: now }, now, ev.repeat ? 'finished (may happen again)' : 'finished');
}

/** Record a decision made at a decision point. */
export function decide(st, id, choice, now) {
  return note({ ...st, decisions: { ...(st.decisions || {}), [id]: choice } }, now, `decided ${id}: ${choice}`);
}

/** Problems with a set of definitions: [message]. */
export function checkEvents(defs) {
  const out = [], ids = new Set();
  const probe = { now: 0, hour: 12, level: 1, party: { map: null, areas: [], outdoors: false }, flags: {}, carrying: [], events: {}, ended: {}, encounter: {} };
  const tryCond = (c, where) => { try { holds(c, probe, {}); } catch (e) { out.push(`${where}: ${e.message}`); } };
  for (const ev of defs) {
    if (!ev.id) { out.push('an event without an id'); continue; }
    if (ids.has(ev.id)) out.push(`${ev.id}: duplicate id`);
    ids.add(ev.id);
    if (!ev.stages || !ev.stages.length) out.push(`${ev.id}: no stages`);
    tryCond(ev.trigger, `${ev.id} trigger`);
    const sids = new Set((ev.stages || []).map((s) => s.id));
    for (const s of ev.stages || []) {
      if (s.when) tryCond(s.when, `${ev.id}/${s.id} when`);
      for (const b of s.branches || []) { tryCond(b.if, `${ev.id}/${s.id} branch`); if (!sids.has(b.go)) out.push(`${ev.id}/${s.id}: branch to unknown stage "${b.go}"`); }
      if (s.next && !sids.has(s.next)) out.push(`${ev.id}/${s.id}: next is unknown stage "${s.next}"`);
    }
  }
  return out;
}
