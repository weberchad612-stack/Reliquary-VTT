// Exploration: what each character keeps doing while the party travels, the party's pace, travel turned into time,
// and what the activities ask for when combat starts (docs/design/board.md, Exploration). Pure functions shared by
// the board (board/exploreui.js, the tracker, the token badges) and Claude's tool (tools/exploration.mjs).
//
// Records: explore/<token id>  {activity (an id from the system's list, or null: just travelling), options ({key:
// value}: who is followed, a skill, a spell), note (the plain fallback's words), at, by}. Saved as exploration.json.
//
// The system's exploration rules (system.exploration) give the activities and their needs, choices, pace, combat
// requests and reminders; this module only carries them out. Combat requests, the contract a system pack follows:
//   {kind: 'initiative-stat', token, stat, label}         roll initiative with this statistic instead
//   {kind: 'initiative-mod', tokens: 'party' | [ids], label, type, value}   a modifier to those PCs' initiative
//   {kind: 'state', token, patch, label}                   merge into the creature's live state (actorstate/<id>)
//   {kind: 'effect', token, effect, label}                 put an effect on the token
// A system without exploration rules gets PLAIN_EXPLORATION: a free note per PC, pace from Speed, no requests.

export const EXPLORE = 'explore';

/** The fallback for a system with no exploration rules: what each PC is doing, in words; no automation. */
export const PLAIN_EXPLORATION = Object.freeze({
  activities: Object.freeze([]),
  groups: Object.freeze([]),
  skills: Object.freeze([]),
  none: Object.freeze({ name: 'Travelling', summary: 'What the character does while travelling, in words.', icon: '🚶' }),
  paceWords: Object.freeze({}),
  plain: true,
  speedOf: (p) => (p && p.speeds && p.speeds.land ? p.speeds.land.value : null),
  speedText: (n) => `Speed ${n}`,
  conOf: () => 0,
  groupPace: (pcs) => {
    const list = (pcs || []).filter((p) => typeof p.speed === 'number');
    if (!list.length) return null;
    const slow = list.reduce((a, b) => (b.speed < a.speed ? b : a));
    return { speed: slow.speed, slowest: slow.name, slowestText: `${slow.name} (${slow.speed})`, factor: 1, effective: slow.speed, perMinute: slow.speed * 10, mph: slow.speed / 10, perDay: slow.speed * 0.8, why: '' };
  },
  paceText: (g) => (g ? `${g.perMinute} per minute` : ''),
  paceHeadline: (g) => `${g.perMinute}/min`,
  travelSpeed: (s) => ({ perMinute: s * 10, mph: s / 10, perDay: s * 0.8 }),
  terrain: Object.freeze([['normal', 'Normal', 1]]),
});

/** The campaign's exploration rules, or the plain ones. */
export const exploreRules = (sys) => (sys && sys.exploration) || PLAIN_EXPLORATION;

/** A choice record. f: {activity, options, note, by}; empty options and notes are dropped. */
export function exploreChoice(f, rules, now = new Date().toISOString()) {
  const act = f.activity || null;
  if (act && !rules.activities.some((a) => a.id === act)) throw new Error(`no exploration activity "${act}"`);
  const out = { activity: act, at: now, by: f.by || 'gm' };
  const opts = Object.fromEntries(Object.entries(f.options || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  if (act && Object.keys(opts).length) out.options = opts;
  if (f.note && String(f.note).trim()) out.note = String(f.note).trim().slice(0, 200);
  return out;
}

/** The activity a choice names, or null. */
export const activityOf = (rules, choice) => (choice && choice.activity ? rules.activities.find((a) => a.id === choice.activity) || null : null);

/**
 * The context the system's functions take: {self: {id, name, actor, prepared}, party: [...], options}. party:
 * [{id, name, actor, prepared}] (the PCs); choices: {id: choice}.
 */
export function ctxFor(id, party, choices) {
  const self = party.find((p) => p.id === id) || { id, name: id };
  return { self, party, options: ((choices || {})[id] || {}).options || {} };
}

/** Each activity for one PC with whether it can be chosen: [{activity, need: null | {text, soft}}]. */
export function availability(rules, id, party, choices) {
  const ctx = ctxFor(id, party, choices);
  return rules.activities.map((a) => ({ activity: a, need: a.requires ? safe(() => a.requires(ctx)) : null }));
}
const safe = (f, dflt = null) => { try { return f(); } catch { return dflt; } };

/**
 * One PC's card, as the tab and the tool show it (pure): {id, name, activity (or null), icon, title, summary, detail
 * (the chosen options in words), warning (an unmet need, or a problem with the choices), pace, speed}.
 */
export function pcExplore(rules, id, party, choices) {
  const ctx = ctxFor(id, party, choices), choice = (choices || {})[id] || null, a = activityOf(rules, choice);
  const self = ctx.self, speed = self.prepared ? rules.speedOf(self.prepared) : null;
  if (!a) return { id, name: self.name, activity: null, icon: rules.none.icon, title: choice && choice.note ? choice.note : rules.none.name, summary: rules.none.summary, detail: null, warning: null, pace: 'full', speed, note: choice ? choice.note || null : null };
  const need = a.requires ? safe(() => a.requires(ctx)) : null;
  const warning = need ? need.text : a.check ? safe(() => a.check(ctx)) : null;
  return { id, name: self.name, activity: a.id, icon: a.icon || '🧭', title: a.name, summary: a.summary || '', detail: a.detail ? safe(() => a.detail(ctx)) : null, warning, pace: a.pace, speed, ref: a.ref || null, note: choice.note || null };
}

/** The party's pace (the system's): party with prepared numbers, choices by id. */
export function partyPace(rules, party, choices) {
  const pcs = party.map((p) => ({ id: p.id, name: p.name, speed: p.prepared ? rules.speedOf(p.prepared) : null, con: rules.conOf(p.prepared, p.actor), activity: ((choices || {})[p.id] || {}).activity || null, options: ((choices || {})[p.id] || {}).options || {} }));
  return rules.groupPace(pcs);
}

/** Every combat request the party's activities make (dead PCs make none). */
export function combatRequests(rules, party, choices) {
  const out = [];
  for (const p of party) {
    if (p.dead) continue;
    const a = activityOf(rules, (choices || {})[p.id]);
    if (!a || !a.combat) continue;
    const ctx = ctxFor(p.id, party, choices);
    if (a.requires && (safe(() => a.requires(ctx)) || {}).soft === false) continue;   // an activity it cannot do asks for nothing
    for (const r of safe(() => a.combat(ctx), []) || []) out.push({ ...r, from: p.id });
  }
  return out;
}

/** What one PC's initiative roll takes from them: {stat (or null), add: [{label, type, value}]}. */
export function initiativeHint(rules, id, party, choices) {
  const reqs = combatRequests(rules, party, choices);
  const stat = (reqs.find((r) => r.kind === 'initiative-stat' && r.token === id) || {}).stat || null;
  const add = [];
  for (const r of reqs) {
    if (r.kind !== 'initiative-mod') continue;
    const to = r.tokens === 'party' ? party.map((p) => p.id) : r.tokens || [];
    if (to.includes(id) && !add.some((x) => x.label === r.label)) add.push({ label: r.label, type: r.type || 'untyped', value: r.value });
  }
  return { stat, add };
}

/** The requests to carry out when the encounter begins, for the PCs in it: state and effect ones. */
export function startRequests(rules, party, choices, inEncounter) {
  const set = new Set(inEncounter || party.map((p) => p.id));
  return combatRequests(rules, party, choices).filter((r) => (r.kind === 'state' || r.kind === 'effect') && set.has(r.token));
}

/** Claude's reminders for a new area (GM view): [{id, text}]. */
export function reminders(rules, party, choices) {
  const out = [];
  for (const p of party) {
    if (p.dead) continue;
    const a = activityOf(rules, (choices || {})[p.id]);
    if (!a || !a.reminder) continue;
    const t = safe(() => a.reminder(ctxFor(p.id, party, choices)));
    if (t) out.push({ id: p.id, text: t });
  }
  return out;
}

/** The token badge for a PC: {icon, text} or null (no record: nothing chosen yet). */
export function badgeFor(rules, name, choice) {
  if (!choice) return null;
  const a = activityOf(rules, choice);
  if (!a) return choice.note ? { icon: rules.none.icon, text: `${name}: ${choice.note}` } : null;
  const pace = rules.paceWords[a.pace] || '';
  return { icon: a.icon || '🧭', text: `${name}: ${a.name}${pace ? ` (${pace})` : ''}${a.summary ? `: ${a.summary}` : ''}` };
}

/**
 * Seconds to travel a distance at the pace, or the time given straight. amount: {value, unit: 'ft' | 'mi' | 'min' |
 * 'hr'}, terrain: the share of the listed distance a minute covers (1, 0.5, 1/3). Returns {seconds, feet (or null)}.
 */
export function travelTime(pace, amount, terrain = 1) {
  const v = Number(amount && amount.value);
  if (!(v > 0)) throw new Error('how far, or how long?');
  const u = amount.unit || 'ft';
  if (u === 'min') return { seconds: Math.round(v * 60), feet: pace ? Math.round(v * pace.perMinute * terrain) : null };
  if (u === 'hr') return { seconds: Math.round(v * 3600), feet: pace ? Math.round(v * 60 * pace.perMinute * terrain) : null };
  if (!pace || !pace.perMinute) throw new Error('the party has no pace (no Speeds)');
  const feet = u === 'mi' ? v * 5280 : v;
  return { seconds: Math.round((feet / (pace.perMinute * terrain)) * 60), feet: Math.round(feet) };
}

/** Seconds in words: "2 hours 30 minutes", "45 minutes", "20 seconds". */
export function durationWords(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  const p = [h ? `${h} hour${h === 1 ? '' : 's'}` : '', m ? `${m} minute${m === 1 ? '' : 's'}` : '', !h && !m ? `${sec} second${sec === 1 ? '' : 's'}` : ''].filter(Boolean);
  return p.join(' ');
}
