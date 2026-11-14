// Subsystems (future/adventure-events.md; docs/best-practices/events.md, Subsystems): points and thresholds that a
// game system's skill challenges are built from (in PF2E: Victory Points, Influence, Chase, Infiltration, Research).
// System-free: the system supplies each kind's words and its default scoring (rulesets/<system>/subsystems.js); this
// module only keeps the numbers. The shape follows the PF2e Subsystems module for Foundry (WBHarry, MIT): tracks with
// thresholds, parts (obstacles, NPCs, libraries) with their checks, and what is revealed to the players.
//
// A subsystem: {title, kind, event?, status: 'active'|'success'|'failure'|'done',
//   tracks: {id: {label, value, min?, max?, goal?, thresholds?: [threshold]}},       // the party's pools (VP, AP)
//   parts: [{id, label, kind?, text?, revealed?, goal?, value?, individual?, per?: {who: n}, done?, thresholds?,
//            checks?: [{skill, dc, revealed?, note?}], notes?: [{text, revealed?}]}],
//   scoring: {criticalSuccess: {target: n}, success, failure, criticalFailure}         // target: 'part' or a track id
//   rounds?: {n, limit?, each?: {target: n}}, log?: [{at, who?, part?, degree?, deltas, why?}]}
// A threshold: {at, id, label, text?, revealed?, reached?, dc?: n (to every check from then), end?: 'success'|'failure',
//   flag?: name (set when reached; events wait on it)}. 'part' is the part's own counter (or the PC's, for an
//   individual part); a part with a goal is done when it reaches it.

export const DEGREES = Object.freeze(['criticalFailure', 'failure', 'success', 'criticalSuccess']);

const clamp = (v, t) => Math.max(t.min ?? -Infinity, Math.min(t.max ?? Infinity, v));
const copy = (x) => JSON.parse(JSON.stringify(x));

/** The degree's name from a number (0 critical failure .. 3 critical success) or a name. */
export function degreeName(d) {
  if (typeof d === 'number') return DEGREES[d] || null;
  const k = String(d).replace(/[-_ ](\w)/g, (_, c) => c.toUpperCase());
  const map = { critSuccess: 'criticalSuccess', critFailure: 'criticalFailure', critical: 'criticalSuccess' };
  return DEGREES.includes(k) ? k : map[k] || null;
}

/** Thresholds a value crossed going from `from` to `to` (upwards, or downwards for a falling count). */
function crossed(list, from, to) {
  return (list || []).filter((th) => th.reached === undefined && ((to >= th.at && from < th.at) || (th.falling && to <= th.at && from > th.at)));
}

/** The DC adjustment the reached thresholds make. */
export function dcShift(sub) {
  let n = 0;
  for (const t of Object.values(sub.tracks || {})) for (const th of t.thresholds || []) if (th.reached !== undefined && th.dc) n += th.dc;
  return n;
}

/**
 * Apply points to a subsystem: deltas {target: n} ('part' for the part's counter). Returns {sub, reached:
 * [{where, threshold}], done: [part ids], lines}. Thresholds reached are stamped with `now`; one with `end` ends the
 * subsystem; a part with a goal reached is done.
 */
export function addPoints(sub0, deltas, { part = null, who = null, now = 0, why = null, degree = null } = {}) {
  const sub = copy(sub0), reached = [], done = [], lines = [];
  const p = part ? (sub.parts || []).find((x) => x.id === part) : null;
  if (part && !p) throw new Error(`no part "${part}"`);
  for (const [target, n] of Object.entries(deltas || {})) {
    if (!n) continue;
    if (target === 'part') {
      if (!p) throw new Error('these points go to a part: name it');
      const from = p.individual && who ? ((p.per || {})[who] || 0) : (p.value || 0);
      const to = Math.max(0, from + n);
      if (p.individual && who) p.per = { ...(p.per || {}), [who]: to }; else p.value = to;
      lines.push(`${p.label}: ${from} → ${to}${p.goal ? ` of ${p.goal}` : ''}${p.individual && who ? ` (${who})` : ''}`);
      for (const th of crossed(p.thresholds, from, to)) { th.reached = now; reached.push({ where: p.id, threshold: th }); }
      if (p.goal && !p.individual && to >= p.goal && !p.done) { p.done = true; done.push(p.id); }
      continue;
    }
    const t = sub.tracks && sub.tracks[target];
    if (!t) throw new Error(`no track "${target}"`);
    const from = t.value || 0, to = clamp(from + n, t);
    t.value = to;
    lines.push(`${t.label}: ${from} → ${to}${t.goal ? ` of ${t.goal}` : ''}`);
    for (const th of crossed(t.thresholds, from, to)) { th.reached = now; reached.push({ where: target, threshold: th }); }
  }
  for (const r of reached) {
    lines.push(`Threshold ${r.threshold.label || r.threshold.id} (${r.threshold.at})${r.threshold.text ? `: ${r.threshold.text}` : ''}`);
    if (r.threshold.end && sub.status === 'active') { sub.status = r.threshold.end; lines.push(`The ${sub.title || 'subsystem'} ends: ${r.threshold.end}`); }
  }
  for (const id of done) lines.push(`${sub.parts.find((x) => x.id === id).label}: overcome`);
  sub.log = [...(sub.log || []), { at: now, ...(who ? { who } : {}), ...(part ? { part } : {}), ...(degree ? { degree } : {}), deltas, ...(why ? { why } : {}) }];
  return { sub, reached, done, lines };
}

/** A check's result: the subsystem's scoring for the degree (or the part's own), applied. */
export function score(sub, { part = null, degree, who = null, now = 0 }) {
  const d = degreeName(degree);
  if (!d) throw new Error(`unknown degree "${degree}"`);
  const p = part ? (sub.parts || []).find((x) => x.id === part) : null;
  if (p && p.done) throw new Error(`${p.label} is already overcome`);
  const table = (p && p.scoring) || sub.scoring || {};
  return addPoints(sub, table[d] || {}, { part, who, now, degree: d });
}

/** A new round: the round count, and the points each round brings (an infiltration's Awareness). */
export function subsystemRound(sub0, now = 0) {
  const sub = copy(sub0);
  sub.rounds = { ...(sub.rounds || {}), n: ((sub.rounds || {}).n || 0) + 1 };
  const r = sub.rounds.each ? addPoints(sub, sub.rounds.each, { now, why: `round ${sub.rounds.n}` }) : { sub, reached: [], done: [], lines: [] };
  r.lines.unshift(`Round ${sub.rounds.n}${sub.rounds.limit ? ` of ${sub.rounds.limit}` : ''}`);
  if (sub.rounds.limit && sub.rounds.n >= sub.rounds.limit && r.sub.status === 'active') r.lines.push('The last round');
  r.sub.rounds = sub.rounds;
  return r;
}

/** Reveal a part, one of its checks or notes, or a threshold: what: 'part' | 'check:<n>' | 'note:<n>' | 'threshold:<id>'. */
export function reveal(sub0, partOrTrack, what = 'part') {
  const sub = copy(sub0);
  const p = (sub.parts || []).find((x) => x.id === partOrTrack);
  const t = (sub.tracks || {})[partOrTrack];
  if (!p && !t) throw new Error(`no part or track "${partOrTrack}"`);
  const [k, n] = String(what).split(':');
  if (k === 'part') { if (!p) throw new Error(`${partOrTrack} is a track`); p.revealed = true; }
  else if (k === 'check' || k === 'note') { const l = (p || {})[`${k}s`] || []; const x = l[Number(n)]; if (!x) throw new Error(`no ${k} ${n}`); x.revealed = true; }
  else if (k === 'threshold') { const th = ((p || t).thresholds || []).find((x) => x.id === n); if (!th) throw new Error(`no threshold "${n}"`); th.revealed = true; }
  else throw new Error(`reveal what? part, check:<n>, note:<n>, threshold:<id>`);
  return sub;
}

/**
 * What the players see (the user's decision, 2026-11-13: "revealed parts"): the points and progress, the parts and
 * notes revealed, checks' skills once revealed; DCs, thresholds and hidden parts stay the GM's.
 */
export function playerView(sub) {
  return {
    title: sub.title, kind: sub.kind, status: sub.status,
    tracks: Object.fromEntries(Object.entries(sub.tracks || {}).filter(([, t]) => !t.hidden).map(([id, t]) => [id, { label: t.label, value: t.value || 0, ...(t.goal ? { goal: t.goal } : {}),
      reached: (t.thresholds || []).filter((th) => th.revealed && th.reached !== undefined).map((th) => th.label) }])),
    parts: (sub.parts || []).filter((p) => p.revealed).map((p) => ({ id: p.id, label: p.label, ...(p.text ? { text: p.text } : {}), ...(p.goal ? { goal: p.goal, value: p.value || 0 } : {}), ...(p.individual ? { per: p.per || {} } : {}), done: !!p.done,
      checks: (p.checks || []).filter((c) => c.revealed).map((c) => ({ skill: c.skill })), notes: (p.notes || []).filter((x) => x.revealed).map((x) => x.text) })),
    ...(sub.rounds ? { round: sub.rounds.n || 0, ...(sub.rounds.limit ? { limit: sub.rounds.limit } : {}) } : {}),
  };
}

/** Problems with a subsystem: [message]. */
export function checkSubsystem(sub, id = sub.title) {
  const out = [];
  if (!sub.scoring || !DEGREES.some((d) => sub.scoring[d])) out.push(`${id}: no scoring`);
  for (const d of DEGREES) for (const t of Object.keys((sub.scoring || {})[d] || {})) if (t !== 'part' && !(sub.tracks || {})[t]) out.push(`${id}: scoring names unknown track "${t}"`);
  const ids = new Set();
  for (const p of sub.parts || []) { if (ids.has(p.id)) out.push(`${id}: duplicate part "${p.id}"`); ids.add(p.id); }
  for (const t of Object.keys((sub.rounds || {}).each || {})) if (!(sub.tracks || {})[t]) out.push(`${id}: rounds add to unknown track "${t}"`);
  return out;
}
