// Pathfinder 2E exploration: the activities a character keeps up while the party travels, what each needs, the
// choices it takes, its pace, what it asks for when combat starts, and the reminders Claude works from. The board's
// Exploration tab (board/explore.js, board/exploreui.js) and tools/exploration.mjs read it through system.exploration;
// the board knows nothing of any one activity, it carries out the requests listed here. A system without exploration
// rules gets a plain fallback (board/explore.js PLAIN_EXPLORATION). Player Core pp. 438-440 and GM Core p. 36 (ORC
// licence), paraphrased; the activities' own words come from our content (actions:action/<slug>).
//
// - Travel speed (Player Core's table, checked against Archives of Nethys 2026-11-13): feet per minute = Speed x 10,
//   miles per hour = Speed / 10, miles per day = 8 hours of that. A group moves at its slowest member's Speed.
//   Difficult terrain halves it, greater difficult terrain cuts it to a third (the GM's call while travelling).
// - Most activities are done at half speed; Hustle doubles it for Constitution modifier x 10 minutes (at least 10),
//   the group's lowest Constitution when Hustling together. Follow the Expert matches the expert's activity.
// - When combat starts: Avoid Notice rolls Stealth for initiative; Scout gives the party +1 circumstance to
//   initiative; Defend has the shield raised before the first turn (Raise a Shield lasts until the start of the
//   creature's next turn: turns.js lowers it).

const RK_SKILLS = Object.freeze(['arcana', 'crafting', 'medicine', 'nature', 'occultism', 'religion', 'society']);
const SKILL_LABELS = Object.freeze({ acrobatics: 'Acrobatics', arcana: 'Arcana', athletics: 'Athletics', crafting: 'Crafting', deception: 'Deception', diplomacy: 'Diplomacy', intimidation: 'Intimidation', medicine: 'Medicine', nature: 'Nature', occultism: 'Occultism', performance: 'Performance', religion: 'Religion', society: 'Society', stealth: 'Stealth', survival: 'Survival', thievery: 'Thievery' });
const RANK_WORDS = ['untrained', 'trained', 'expert', 'master', 'legendary'];

/** A character's proficiency rank in a skill (0 untrained ... 4 legendary), from its build. */
export function skillRank(actor, skill) {
  const p = (actor && actor.proficiencies) || {};
  return Number((p.skills || {})[skill] || 0);
}
/** Follow the Expert's circumstance bonus for the expert's rank: +2 expert, +3 master, +4 legendary. */
export const expertBonus = (rank) => (rank >= 4 ? 4 : rank === 3 ? 3 : rank === 2 ? 2 : 0);
const casts = (actor) => !!(actor && (actor.spellcasting || (actor.proficiencies && actor.proficiencies.spellcasting)));

/**
 * The activities, in the order the picker lists them. Each: {id, name, ref (its rules text in our content), group,
 * icon, pace ('half' | 'double' | 'full' | 'varies'), summary (one line, our words), options ([{key, label, kind:
 * 'pc' | 'skill' | 'text', skills?, placeholder?}]), requires(ctx) -> null | {text, soft} (soft: allowed with a
 * warning), check(ctx) -> warning words or null (about the choices made), combat(ctx) -> requests, reminder(ctx) ->
 * words for Claude or null}. ctx: {self: {id, name, actor, prepared}, party: [the same for each PC], options}.
 */
const ACTIVITIES = Object.freeze([
  {
    id: 'avoid-notice', name: 'Avoid Notice', ref: 'actions:action/avoid-notice', group: 'Core', icon: '👣', pace: 'half',
    summary: 'Stealth while moving at half speed; usually rolls Stealth for initiative.',
    combat: (c) => [{ kind: 'initiative-stat', token: c.self.id, stat: 'stealth', label: 'Avoid Notice' }],
    reminder: (c) => `${c.self.name} is Avoiding Notice: Stealth against foes' Perception DCs as the party moves; Stealth for initiative.`,
  },
  {
    id: 'defend', name: 'Defend', ref: 'actions:action/defend', group: 'Core', icon: '🛡', pace: 'half',
    summary: 'Moves at half speed with a shield raised; it is up before the first turn when combat starts.',
    requires: (c) => (c.self.prepared && c.self.prepared.shield ? null : { text: 'needs a shield in use', soft: false }),
    combat: (c) => [{ kind: 'state', token: c.self.id, patch: { shieldRaised: true }, label: `Defend: ${c.self.name}'s shield is raised until the start of their first turn` }],
  },
  {
    id: 'detect-magic', name: 'Detect Magic', ref: 'actions:action/detect-magic', group: 'Core', icon: '✨', pace: 'half',
    summary: 'Casts detect magic as the party moves at half speed (or slower).',
    requires: (c) => (casts(c.self.actor) ? null : { text: 'needs the detect magic cantrip (no spellcasting on the sheet)', soft: true }),
    reminder: (c) => `${c.self.name} is Detecting Magic: on entering a new area, say whether magic is within 30 feet (presence only, no roll; nothing if none).`,
  },
  {
    id: 'follow-the-expert', name: 'Follow the Expert', ref: 'actions:action/follow-the-expert', group: 'Core', icon: '🧭', pace: 'varies',
    summary: 'Matches an expert ally\'s tactic, adding level to an untrained check and +2/+3/+4 by their rank.',
    options: [{ key: 'expert', label: 'Following', kind: 'pc' }, { key: 'skill', label: 'Skill', kind: 'skill' }],
    requires: (c) => (c.party.some((p) => p.id !== c.self.id && Object.keys(SKILL_LABELS).some((s) => skillRank(p.actor, s) >= 2)) ? null : { text: 'no ally is expert in a skill', soft: false }),
    check: (c) => {
      const o = c.options || {}, ex = c.party.find((p) => p.id === o.expert);
      if (!ex || !o.skill) return 'choose who to follow and the skill';
      const r = skillRank(ex.actor, o.skill);
      return r >= 2 ? null : `${ex.name} is ${RANK_WORDS[r]} in ${SKILL_LABELS[o.skill]}: following needs an expert`;
    },
    detail: (c) => {
      const o = c.options || {}, ex = c.party.find((p) => p.id === o.expert);
      if (!ex || !o.skill) return null;
      const b = expertBonus(skillRank(ex.actor, o.skill));
      return b ? `following ${ex.name} in ${SKILL_LABELS[o.skill]}: +${b} circumstance, and level added if untrained` : null;
    },
    reminder: (c) => { const o = c.options || {}, ex = c.party.find((p) => p.id === o.expert), b = ex && o.skill ? expertBonus(skillRank(ex.actor, o.skill)) : 0; return b ? `${c.self.name} Follows ${ex.name} (${SKILL_LABELS[o.skill]}): +${b} circumstance to that check, level added if untrained.` : null; },
  },
  {
    id: 'hustle', name: 'Hustle', ref: 'actions:action/hustle', group: 'Core', icon: '🏃', pace: 'double',
    summary: 'Double travel speed for Constitution x 10 minutes (at least 10).',
  },
  {
    id: 'investigate', name: 'Investigate', ref: 'actions:action/investigate', group: 'Core', icon: '📜', pace: 'half',
    summary: 'Secret Recall Knowledge checks for clues while moving at half speed.',
    options: [{ key: 'skill', label: 'Recall Knowledge with', kind: 'skill', skills: RK_SKILLS }],
    reminder: (c) => `${c.self.name} is Investigating${c.options && c.options.skill ? ` (${SKILL_LABELS[c.options.skill]})` : ''}: a secret Recall Knowledge check on the clues of each new area.`,
  },
  {
    id: 'repeat-a-spell', name: 'Repeat a Spell', ref: 'actions:action/repeat-a-spell', group: 'Core', icon: '🔁', pace: 'half',
    summary: 'Casts the same spell (2 actions or fewer) again and again at half speed.',
    options: [{ key: 'spell', label: 'Spell', kind: 'text', placeholder: 'shield' }],
    requires: (c) => (casts(c.self.actor) ? null : { text: 'needs a spell to cast (no spellcasting on the sheet)', soft: true }),
    detail: (c) => (c.options && c.options.spell ? `casting ${c.options.spell}` : null),
  },
  {
    id: 'scout', name: 'Scout', ref: 'actions:action/scout', group: 'Core', icon: '🔭', pace: 'half',
    summary: 'Scouts ahead and behind at half speed; the party gets +1 to initiative in the next encounter.',
    combat: () => [{ kind: 'initiative-mod', tokens: 'party', label: 'Scout', type: 'circumstance', value: 1 }],
  },
  {
    id: 'search', name: 'Search', ref: 'actions:action/search', group: 'Core', icon: '🔍', pace: 'half',
    summary: 'Seeks for hidden doors, hazards and things at half speed; the GM rolls a free secret Seek.',
    reminder: (c) => `${c.self.name} is Searching: a free secret Seek on entering a new area and when passing something hidden.`,
  },
  {
    id: 'sustain-an-effect', name: 'Sustain an Effect', ref: 'actions:action/sustain-an-effect', group: 'Core', icon: '⏳', pace: 'half',
    summary: 'Sustains one sustained effect while moving at half speed (usually up to 10 minutes).',
    options: [{ key: 'effect', label: 'Effect', kind: 'text', placeholder: 'light' }],
    detail: (c) => (c.options && c.options.effect ? `sustaining ${c.options.effect}` : null),
  },
  {
    id: 'track', name: 'Track', ref: 'actions:action/track', group: 'Skill', icon: '🐾', pace: 'half',
    summary: 'Follows tracks at half speed (Survival); an hour without checks after a success.',
    requires: (c) => (skillRank(c.self.actor, 'survival') >= 1 ? null : { text: 'needs trained Survival', soft: false }),
    reminder: (c) => `${c.self.name} is Tracking: Survival against the trail's DC, then an hour at half speed without checks.`,
  },
  {
    id: 'cover-tracks', name: 'Cover Tracks', ref: 'actions:action/cover-tracks', group: 'Skill', icon: '🍂', pace: 'half',
    summary: 'Covers the party\'s trail at half speed: trackers face the Survival DC if higher.',
    requires: (c) => (skillRank(c.self.actor, 'survival') >= 1 ? null : { text: 'needs trained Survival', soft: false }),
  },
]);

/** Travel at a Speed (feet per round): {perMinute (feet), mph, perDay (miles in 8 hours)}. */
export function travelSpeed(speed) {
  const s = Math.max(0, speed || 0);
  return { perMinute: s * 10, mph: s / 10, perDay: (s / 10) * 8 };
}

/**
 * The group's pace. pcs: [{id, name, speed (feet), con (modifier), activity (id or null), options}]. Returns
 * {speed (the slowest), slowest, slowestText, factor (0.5, 1 or 2), effective, perMinute, mph, perDay, why, limit ({minutes,
 * text}: how long the party can keep the pace up, when Hustling)}.
 */
export function groupPace(pcs) {
  const list = (pcs || []).filter((p) => typeof p.speed === 'number');
  if (!list.length) return null;
  const slow = list.reduce((a, b) => (b.speed < a.speed ? b : a));
  const act = (p) => ACTIVITIES.find((a) => a.id === p.activity) || null;
  const paceOf = (p, seen = new Set()) => {
    const a = act(p);
    if (!a) return 'full';
    if (a.pace !== 'varies') return a.pace;
    const ex = list.find((q) => q.id === (p.options || {}).expert);
    if (!ex || seen.has(ex.id)) return 'full';
    seen.add(p.id);
    return paceOf(ex, seen);
  };
  const paces = list.map((p) => ({ p, pace: paceOf(p) }));
  const halves = paces.filter((x) => x.pace === 'half'), hustlers = paces.filter((x) => x.pace === 'double');
  let factor = 1, why = 'nobody is doing a half-speed activity';
  if (halves.length) { factor = 0.5; why = `${halves.map((x) => x.p.name).join(', ')} ${halves.length === 1 ? 'is' : 'are'} on a half-speed activity`; }
  else if (hustlers.length && hustlers.length === list.length) { factor = 2; why = 'everyone is Hustling'; }
  else if (hustlers.length) why = `${hustlers.map((x) => x.p.name).join(', ')} ${hustlers.length === 1 ? 'is' : 'are'} Hustling, but the group only Hustles together`;
  const effective = slow.speed * factor, t = travelSpeed(effective);
  const out = { speed: slow.speed, slowest: slow.name, slowestText: `${slow.name} (Speed ${slow.speed} ft)`, factor, effective, ...t, why };
  if (factor === 2) {
    const minutes = Math.max(10, Math.min(...list.map((p) => (p.con || 0) * 10)));
    out.limit = { minutes, text: `Hustle lasts ${minutes} minutes (the lowest Constitution)` };
  }
  return out;
}

/** The pace in words: "half speed: 125 ft per minute, 1¼ mph, 10 miles a day". */
export function paceWords(g) {
  if (!g) return '';
  const frac = (n) => { const w = Math.floor(n), r = n - w; const f = r === 0.25 ? '¼' : r === 0.5 ? '½' : r === 0.75 ? '¾' : r ? `.${String(Math.round(r * 100)).padStart(2, '0')}` : ''; return `${w || (f ? '' : '0')}${f}`; };
  const speedName = g.factor === 0.5 ? 'half speed' : g.factor === 2 ? 'double speed (Hustle)' : 'full speed';
  return `${speedName}: ${g.perMinute} ft per minute, ${frac(g.mph)} mph, ${frac(g.perDay)} miles a day`;
}

export const PF2E_EXPLORATION = Object.freeze({
  activities: ACTIVITIES,
  groups: Object.freeze([['Core', 'Exploration activities'], ['Skill', 'Skill activities']]),
  skills: Object.freeze(Object.entries(SKILL_LABELS).map(([id, label]) => Object.freeze({ id, label }))),
  none: Object.freeze({ name: 'Travelling', summary: 'No special activity: full travel speed.', icon: '🚶' }),
  paceWords: Object.freeze({ half: 'half speed', double: 'double speed', full: 'full speed', varies: 'matches the expert' }),
  // the creature's Speed for travel, from its prepared numbers (armor and conditions included)
  speedOf: (p) => (p && p.speeds && p.speeds.land ? p.speeds.land.value : null),
  speedText: (n) => `Speed ${n} ft`,
  conOf: (p, actor) => ((p && p.attributes) || (actor && actor.attributes) || {}).con || 0,
  groupPace, paceText: paceWords, travelSpeed,
  paceHeadline: (g) => `${g.perMinute} ft/min`,
  // terrain choices for the travel helper: how much of the listed distance a minute covers
  terrain: Object.freeze([['normal', 'Clear terrain', 1], ['difficult', 'Difficult terrain (half)', 0.5], ['greater', 'Greater difficult terrain (a third)', 1 / 3]]),
});
