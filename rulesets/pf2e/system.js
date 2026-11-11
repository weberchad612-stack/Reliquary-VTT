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

export const PF2E_SYSTEM = Object.freeze({
  id: 'pf2e',
  name: 'Pathfinder 2E',
  measurement: Object.freeze({
    unit: 'ft',
    squareFeet: 5,
    diagonalCosts: Object.freeze([1, 2]),    // squares counted for successive diagonals: 5-10-5
    creatureDistance: 'nearest-square',     // between creatures: nearest square to nearest square
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
});
