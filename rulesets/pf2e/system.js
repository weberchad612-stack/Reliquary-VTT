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
});
