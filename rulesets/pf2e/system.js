// Pathfinder 2E system configuration: the settings the board and tools read for this game system.
// Every system pack has one (rulesets/systems.js lists them); code that measures, counts or labels by the
// rules asks the campaign's system here instead of assuming PF2E. Docs: docs/design/board.md, section 7.
//
// measurement: how squares and distances are counted (Player Core, ORC licence, paraphrased):
// - A square is 5 feet across.
// - Diagonals alternate: the first diagonal square counts 5 feet, the second 10, then 5, 10, ... The count
//   carries on across one move (engine/movement) and restarts for each new measurement.
// - Distance between creatures (range, reach, the board's distance label) is counted from a square of one
//   creature's space to the nearest square of the other's, not centre to centre. Adjacent creatures are
//   5 feet apart; a creature sharing a square with another is 0 feet from it.
// - Height (the user's ruling, 2026-11-11; Player Core does not spell out measuring in three dimensions): the
//   vertical gap counts like a third direction, with the same alternating diagonals, so 10 ft across and 45 ft
//   up is 50 ft. A creature is as tall as it is wide, and distance counts from its nearest part.
//
// areas: the shapes of area effects (Player Core, ORC licence, paraphrased; engine/areas):
// - Burst: spreads from a grid intersection out to the radius in every direction.
// - Cone: spreads from a point on the creature's edge in one direction, as wide at its end as it is long.
// - Emanation: spreads from every side of the creature's space; the creature itself is included only if
//   the effect says so (the board targets it by default, and T removes it).
// - Line: goes in a straight line from the creature's edge, usually 5 feet wide.
// - An area only reaches squares in line of effect from its origin: solid barriers block it, glass
//   windows included; gaps such as a grate or portcullis do not.

// conditions: the effects the board shows as badges on tokens (rulesets/pf2e/conditions.js).

import { PF2E_CONDITIONS } from './conditions.js';
import { PF2E_EFFECTS } from './effects.js';
import { preparePf2e, sizeSquares } from './actor.js';
import { kindDir, CONTENT_KINDS, CONTENT_FOLDERS, featKeys, actorContent } from './content.js';
import { GOLARION_CALENDAR, ROUND_SECONDS } from './calendar.js';
import { PF2E_RULE_KEYS, checkSelectors, adjustDegree } from './rule-keys.js';
import { turnRules } from './turns.js';
import { applyDamage, applyHealing, setTempHp, recoveryCheck, adjustDamage } from './damage.js';
import { PF2E_STAT_BLOCK } from './statblock.js';
import { PF2E_TRAITS } from './traits.js';
import { PF2E_INITIATIVE } from './initiative.js';
import { SELECTORS, CONDITION_RULES, HEALTH_BANDS, healthBand, BONUS_TYPES, SKILLS, SAVES, ATTRIBUTES, RANKS } from './rules.js';

export const PF2E_SYSTEM = Object.freeze({
  id: 'pf2e',
  name: 'Pathfinder 2E',
  // Token Quick-View's layout (rulesets/pf2e/statblock.js) and how traits are written and explained (traits.js)
  statBlock: PF2E_STAT_BLOCK,
  // initiative: the statistics a creature may roll, with initiative's modifiers and notes (rulesets/pf2e/initiative.js)
  initiative: PF2E_INITIATIVE,
  traits: PF2E_TRAITS,
  // the kinds of roll the Dice tab (board/dice.js) sorts dice into, in the order its filter lists them; a roll of
  // another kind is 'other'
  rollKinds: Object.freeze([
    Object.freeze({ id: 'initiative', label: 'Initiative' }),
    Object.freeze({ id: 'attack', label: 'Attack rolls' }),
    Object.freeze({ id: 'save', label: 'Saving throws' }),
    Object.freeze({ id: 'skill', label: 'Skill checks' }),
    Object.freeze({ id: 'perception', label: 'Perception checks' }),
    Object.freeze({ id: 'damage', label: 'Damage' }),
    Object.freeze({ id: 'flat', label: 'Flat checks' }),
    Object.freeze({ id: 'recovery', label: 'Recovery checks' }),
    Object.freeze({ id: 'other', label: 'Other' }),
  ]),
  measurement: Object.freeze({
    unit: 'ft',
    squareFeet: 5,
    diagonalCosts: Object.freeze([1, 2]),    // squares counted for successive diagonals: 5-10-5
    creatureDistance: 'nearest-square',     // between creatures: nearest square to nearest square
    vertical: 'diagonal',                   // height counts like a third direction, with the same 5-10-5 count
    creatureHeight: 'size',                 // a creature is as tall as it is wide (Medium 5 ft, Large 10 ft)
    describe: '5-ft squares, diagonals 5-10-5, measured between nearest squares',
  }),
  areas: Object.freeze({
    shapes: Object.freeze({
      burst: Object.freeze({ label: 'Burst', origin: 'grid-corner' }),
      cone: Object.freeze({ label: 'Cone', origin: 'creature-edge', directions: 8 }),
      emanation: Object.freeze({ label: 'Emanation', origin: 'creature-space', includesCaster: true }),
      line: Object.freeze({ label: 'Line', origin: 'creature-edge', directions: 'any', widthFeet: 5 }),
    }),
    sizes: Object.freeze([5, 10, 15, 20, 30, 60]),  // the quick sizes; any multiple of a square is allowed
    maxFeet: 500,
    lineOfEffect: Object.freeze({
      blocks: 'move',                     // walls that block movement block effects ...
      passes: Object.freeze(['grate']),   // ... except these types, which have gaps effects pass through
    }),
  }),
  conditions: PF2E_CONDITIONS,
  // effects: the visual effects library (rulesets/pf2e/effects.js; primitives in engine/fx).
  effects: PF2E_EFFECTS,
  // time: the calendar, a round's length, initiative ties (foes before PCs), the rules at turn boundaries
  time: Object.freeze({ calendar: GOLARION_CALENDAR, roundSeconds: ROUND_SECONDS, tiebreak: (a, b) => (a.side === 'pc') - (b.side === 'pc'), turnRules }),
  // content: the kinds of game content and the folder each is kept in (rulesets/pf2e/content.js)
  // actorContent(actor): the optional documents a creature's sheet shows (its feats' and features' descriptions),
  // each as candidate keys, the first found being the one; featKeys(f) for one of them
  content: Object.freeze({ kinds: CONTENT_KINDS, folders: CONTENT_FOLDERS, kindDir, featKeys, actorContent }),
  // actors: creatures' game data and rules (rulesets/pf2e/actor.js, damage.js, rules.js; docs/design/game-data.md)
  actors: Object.freeze({
    ruleKeys: PF2E_RULE_KEYS, checkSelectors, adjustDegree, sizeSquares,
    prepare: preparePf2e, applyDamage, applyHealing, setTempHp, recoveryCheck, adjustDamage, healthBand,
    selectors: SELECTORS, conditionRules: CONDITION_RULES, healthBands: HEALTH_BANDS, bonusTypes: BONUS_TYPES,
    skills: SKILLS, saves: SAVES, attributes: ATTRIBUTES, ranks: RANKS, kinds: Object.freeze(['character', 'npc']),
  }),
});
