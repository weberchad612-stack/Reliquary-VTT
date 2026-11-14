// Adventure events on the board (engine/events/events.js; docs/best-practices/events.md): the GM-only Events tab's
// rows and words, and the encounter tracker's hook, which marks events tied to a round, a creature's turn or its
// wounds as due (state/eventsdue) the moment they are, for Claude to run. Pure functions; the tab is
// board/eventsui.js. System-free.

export const EVENTS = 'events';
export const DUE_PATH = 'state/eventsdue';
const COMBAT_KEYS = ['round', 'turn', 'hp_below'];

const list = (v) => (Array.isArray(v) ? v : [v]);
const hours = (s) => (s % 86400 === 0 ? `${s / 86400} day${s === 86400 ? '' : 's'}` : s % 3600 === 0 ? `${s / 3600} hour${s === 3600 ? '' : 's'}` : s % 60 === 0 ? `${s / 60} minute${s === 60 ? '' : 's'}` : `${s} s`);

/** A condition in words, for the GM. */
export function conditionWords(c) {
  if (!c) return 'always';
  if (c.all) return c.all.map(conditionWords).join(' and ');
  if (c.any) return `(${c.any.map(conditionWords).join(' or ')})`;
  if (c.not) return `not ${conditionWords(c.not)}`;
  const w = [];
  if ('manual' in c) w.push('the GM\'s moment');
  if (c.level) w.push(c.level.max === undefined ? `party level ${c.level.min}+` : c.level.min === undefined ? `party level up to ${c.level.max}` : `party level ${c.level.min} to ${c.level.max}`);
  if (c.time) w.push(c.time === 'night' ? 'at night' : 'by day');
  if (c.after !== undefined) w.push(`after game time ${c.after}`);
  if (c.elapsed) w.push(`${hours(c.elapsed.seconds)} after the ${c.elapsed.since === 'stage' ? 'stage' : 'event'} began`);
  if (c.map) w.push(`on ${list(c.map).join(' or ')}`);
  if (c.area) w.push(`in ${list(c.area).join(' or ')}`);
  if (c.outdoors !== undefined) w.push(c.outdoors ? 'outdoors' : 'indoors');
  if (c.flag) w.push('is' in c ? `${c.flag} is ${JSON.stringify(c.is)}` : `flag ${c.flag}`);
  if (c.carrying) w.push(`carrying ${c.carrying}`);
  if (c.event) w.push(`event ${c.event} ${c.status || 'done'}`);
  if (c.encounter_ended) w.push(c.encounter_ended === 'any' ? 'a fight ends' : `the fight ${c.encounter_ended} ends`);
  if (c.round !== undefined) w.push(`round ${c.round}${c.group ? ` with ${c.group}` : ''}`);
  if (c.turn) w.push(`${c.turn}'s turn`);
  if (c.hp_below !== undefined) w.push(`${c.group || 'its group'} below ${Math.round(c.hp_below * 100)}% HP`);
  return w.join(', ') || JSON.stringify(c);
}

/** Whether a condition looks at the encounter (a round, a turn, wounds). */
export function combatCondition(c) {
  if (!c || typeof c !== 'object') return false;
  if (c.all || c.any) return list(c.all || c.any).some(combatCondition);
  if (c.not) return combatCondition(c.not);
  return COMBAT_KEYS.some((k) => k in c);
}

/** The definitions and states from the events records [{id, data}]: {defs, states} (engine splitEvents). */
export function splitRecords(rows, E) {
  return E.splitEvents(Object.fromEntries(rows.map((r) => [r.id, r.data])));
}

/**
 * The tracker's hook: of what is due now (engine dueEvents), what hangs on the encounter (an event's trigger, a
 * branch or the next stage's condition naming a round, a turn or wounds) and is not marked yet:
 * [{id, title, kind, to, why}]. `marked`: state/eventsdue.
 */
export function combatDue(defs, states, ctx, E, marked = {}) {
  const byId = Object.fromEntries(defs.map((d) => [d.id, d]));
  return E.dueEvents(defs, states, ctx).filter((d) => {
    const ev = byId[d.id], st = states[d.id] || {};
    const key = `${d.id}:${d.kind}:${d.to || ''}:${st.runs || 0}`;
    if (marked[d.id] && marked[d.id].key === key) return false;
    if (d.kind === 'start') return combatCondition(ev.trigger);
    const cur = E.stageOf(ev, st.stage) || {};
    if (d.kind === 'branch') return (cur.branches || []).some((b) => b.go === d.to && combatCondition(b.if));
    return combatCondition((E.stageOf(ev, d.to) || {}).when);
  }).map((d) => ({ ...d, key: `${d.id}:${d.kind}:${d.to || ''}:${(states[d.id] || {}).runs || 0}` }));
}

/** The tab's rows: [{id, title, status, stage, pages, kind, due, line}], running first, then due, waiting, done. */
export function eventRows(defs, states, due = {}) {
  const order = { running: 0, due: 1, waiting: 2, cooldown: 3, done: 4 };
  return defs.map((d) => {
    const st = states[d.id] || {};
    const status = due[d.id] && st.status !== 'done' ? (st.status === 'running' ? 'running' : 'due') : (st.status || 'waiting');
    return { id: d.id, title: d.title || d.id, status, stage: st.stage || null, pages: d.pages || null, kind: d.kind || null, due: due[d.id] || null, runs: st.runs || 0, kickoff: !!d.kickoff };
  // the kickoff first until it has run (it is the first thing at the table), then by state
  }).sort((a, b) => ((b.kickoff && b.status !== 'done') - (a.kickoff && a.status !== 'done')) || (order[a.status] - order[b.status]) || a.title.localeCompare(b.title));
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ACTION_WORDS = { narrate: 'Narrate', card: 'Card', fx: 'Effect', sound: 'Sound', light: 'Light', place: 'Place', reveal: 'Reveal', encounter: 'Fight', door: 'Door', map: 'Map', xp: 'XP', decision: 'Decision', flag: 'Flag', ledger: 'Ledger', note: 'Note', subsystem: 'Subsystem' };

/** One action as a short line. */
export function actionShort(a) {
  const what = a.text || a.question || a.group || a.name || a.id || a.what || a.amount || '';
  return `${ACTION_WORDS[a.do] || a.do}${what !== '' ? `: ${what}` : ''}`;
}

/** An event's detail (the open row): trigger, stages with the current one marked, decisions, history. */
export function eventDetailHtml(def, st = {}, due = null) {
  const stages = (def.stages || []).map((s) => {
    const cur = s.id === st.stage;
    const acts = (s.actions || []).map((a) => `<li>${esc(actionShort(a))}</li>`).join('');
    const when = s.when ? `<span class="ev-when">when ${esc(conditionWords(s.when))}</span>` : '';
    const br = (s.branches || []).map((b) => `<span class="ev-when">→ ${esc(b.go)} if ${esc(conditionWords(b.if))}</span>`).join('');
    return `<li class="ev-stage${cur ? ' ev-cur' : ''}"><b>${cur ? '▶ ' : ''}${esc(s.title || s.id)}</b>${when}${br}${acts ? `<ul>${acts}</ul>` : ''}</li>`;
  }).join('');
  const decisions = Object.entries(st.decisions || {}).map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`).join('');
  const hist = (st.history || []).slice(-8).map((h) => `<li>${esc(h.what)}</li>`).join('');
  return `<div class="ev-detail">`
    + (def.kickoff ? '<p class="ev-note">The adventure\'s kickoff: narrate it when the party first arrives, before anything else.</p>' : '')
    + `<p class="ev-trig"><b>Starts:</b> ${esc(conditionWords(def.trigger))}${def.repeat ? ` · may happen again${def.repeat.cooldown ? ` after ${esc(hours(def.repeat.cooldown))}` : ''}` : ''}</p>`
    + (due ? `<p class="ev-due">Due: ${esc(due.why)}${due.to ? ` (to ${esc(due.to)})` : ''}. Claude runs it.</p>` : '')
    + (def.note ? `<p class="ev-note">${esc(def.note)}</p>` : '')
    + `<ol class="ev-stages">${stages}</ol>`
    + (decisions ? `<p><b>Decided</b></p><ul class="ev-dec">${decisions}</ul>` : '')
    + (hist ? `<p><b>History</b></p><ul class="ev-hist">${hist}</ul>` : '')
    + '</div>';
}
