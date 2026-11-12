// Pathfinder 2E rules as data, for the engine's rules machinery (engine/rules): how bonuses stack, the
// selectors statistics answer to, what each condition does to the numbers, the skills, proficiency and the
// health bands players see for foes. Rules from Player Core (ORC licence), paraphrased; condition rules match
// the published rule data of the Foundry PF2E system (OGL/ORC), in our own rule-element form.
// Docs: docs/design/game-data.md.

export const ATTRIBUTES = Object.freeze(['str', 'dex', 'con', 'int', 'wis', 'cha']);
export const ATTRIBUTE_NAMES = Object.freeze({ str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' });

/** Bonus types: circumstance, item and status don't stack with themselves (best bonus, worst penalty); untyped all add. */
export const BONUS_TYPES = Object.freeze(['circumstance', 'item', 'status', 'untyped']);
export const stacks = (type) => !type || type === 'untyped';

/** Proficiency ranks and the bonus each gives at a level (untrained 0, otherwise 2 per rank plus level). */
export const RANKS = Object.freeze(['untrained', 'trained', 'expert', 'master', 'legendary']);
export function proficiency(rank, level) { return rank > 0 ? 2 * rank + level : 0; }

/** The skills and the attribute each uses. */
export const SKILLS = Object.freeze({
  acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int', deception: 'cha', diplomacy: 'cha', intimidation: 'cha', medicine: 'wis',
  nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis', society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
});
export const SAVES = Object.freeze({ fortitude: 'con', reflex: 'dex', will: 'wis' });

/**
 * The selectors a rule element can name, and what they cover. A statistic answers to its own name and the
 * broader ones: Reflex answers to 'reflex', 'saving-throw', 'dex-based' and 'all'.
 */
export const SELECTORS = Object.freeze([
  'all', 'ac', 'saving-throw', 'fortitude', 'reflex', 'will', 'perception', 'skill-check', ...Object.keys(SKILLS), 'lore',
  'str-based', 'dex-based', 'con-based', 'int-based', 'wis-based', 'cha-based', 'attack-roll', 'strike-attack-roll',
  'melee-attack-roll', 'ranged-attack-roll', 'spell-attack-roll', 'damage', 'strike-damage', 'str-damage', 'class-dc', 'spell-dc',
  'hp', 'all-speeds', 'land-speed', 'climb-speed', 'swim-speed', 'fly-speed', 'burrow-speed', 'initiative',
]);

/**
 * What each condition does to the numbers (our rule elements) and the conditions it brings with it
 * (grants: off-guard from prone; clumsy 1 from encumbered). Conditions with no entry change no number
 * (their effects are for Claude and the board to apply: concealed, slowed, fleeing...).
 */
export const CONDITION_RULES = Object.freeze({
  blinded: { rules: [{ key: 'modifier', selector: 'perception', type: 'status', value: -4 }, { key: 'immunity', type: 'visual' }] },
  clumsy: { rules: [{ key: 'modifier', selector: 'dex-based', type: 'status', value: '-@value' }] },
  confused: { grants: [{ id: 'off-guard' }] },
  deafened: { rules: [{ key: 'modifier', selector: ['perception', 'skill-check'], type: 'status', value: -2, when: [{ or: ['auditory', 'initiative'] }] }, { key: 'immunity', type: 'auditory' }] },
  drained: { rules: [{ key: 'modifier', selector: 'con-based', type: 'status', value: '-@value' }, { key: 'modifier', selector: 'hp', type: 'status', value: 'min(-1 * @level, -1) * @value' }] },
  dying: { grants: [{ id: 'unconscious' }] },
  encumbered: { rules: [{ key: 'modifier', selector: 'all-speeds', type: 'untyped', value: -10 }], grants: [{ id: 'clumsy', value: 1 }] },
  enfeebled: { rules: [{ key: 'modifier', selector: ['str-based', 'str-damage'], type: 'status', value: '-@value' }] },
  fascinated: { rules: [{ key: 'modifier', selector: ['perception', 'skill-check'], type: 'status', value: -2 }] },
  fatigued: { rules: [{ key: 'modifier', selector: ['ac', 'saving-throw'], type: 'status', value: -1 }] },
  frightened: { rules: [{ key: 'modifier', selector: 'all', type: 'status', value: '-@value' }] },
  grabbed: { grants: [{ id: 'off-guard' }, { id: 'immobilized' }] },
  'off-guard': { rules: [{ key: 'modifier', selector: 'ac', type: 'circumstance', value: -2 }] },
  paralyzed: { grants: [{ id: 'off-guard' }] },
  prone: { rules: [{ key: 'modifier', selector: 'attack-roll', type: 'circumstance', value: -2 }], grants: [{ id: 'off-guard' }] },
  restrained: { grants: [{ id: 'off-guard' }, { id: 'immobilized' }] },
  sickened: { rules: [{ key: 'modifier', selector: 'all', type: 'status', value: '-@value' }] },
  stupefied: { rules: [{ key: 'modifier', selector: ['int-based', 'wis-based', 'cha-based'], type: 'status', value: '-@value' }] },
  unconscious: { rules: [{ key: 'modifier', selector: ['ac', 'perception', 'reflex'], type: 'status', value: -4 }], grants: [{ id: 'blinded' }, { id: 'off-guard' }, { id: 'prone' }] },
});

/**
 * The conditions in force, with those granted by others and the highest value of each: [{id, value, from}].
 * `effects` are a token's effects ({id, value} for conditions; custom ones, with a name, are skipped).
 */
export function activeConditions(effects) {
  const out = new Map();
  const add = (id, value, from) => {
    const prev = out.get(id);
    if (prev && (prev.value || 0) >= (value || 0)) return;
    out.set(id, { id, value: value || 0, from });
    for (const g of (CONDITION_RULES[id] || {}).grants || []) add(g.id, g.value, from || id);
  };
  for (const e of effects || []) if (e && e.id) add(e.id, e.value, null);
  return [...out.values()];
}

/**
 * Health bands players see for a foe (the user's choice: in the ruleset's own words), from its share of HP.
 * Each band: the lowest share of maximum HP it covers.
 */
export const HEALTH_BANDS = Object.freeze([
  { min: 1, label: 'Unharmed' },
  { min: 0.75, label: 'Scratched' },
  { min: 0.5, label: 'Wounded' },
  { min: 0.25, label: 'Badly wounded' },
  { min: Number.MIN_VALUE, label: 'Near death' },
  { min: 0, label: 'Down' },
]);
export function healthBand(hp, max, dead = false) {
  if (dead) return 'Dead';
  if (!max || max <= 0) return HEALTH_BANDS[0].label;
  const share = Math.max(0, hp) / max;
  return (HEALTH_BANDS.find((b) => share >= b.min) || HEALTH_BANDS[HEALTH_BANDS.length - 1]).label;
}

/** Damage types grouped as the rules group them (a resistance to physical covers all three). */
export const DAMAGE_GROUPS = Object.freeze({
  physical: ['bludgeoning', 'piercing', 'slashing'],
  energy: ['acid', 'cold', 'electricity', 'fire', 'sonic', 'force', 'vitality', 'void'],
});
