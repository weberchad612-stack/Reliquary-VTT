// Hover, distance and targeting (board/targeting.js) and the system configuration (rulesets/).
import test from 'node:test';
import assert from 'node:assert/strict';
import { kindColour, KIND_COLOURS, toggleTarget, markSquare, chevrons } from '../board/targeting.js';
import { systemConfig, creatureDistance, SYSTEMS } from '../rulesets/systems.js';
import { spaceDistance } from '../engine/measure/measure.js';
import { DIAGONAL_COSTS, FEET_PER_CELL } from '../rulesets/pf2e/terrain.js';

test('kind colours: PCs and allies green, neutrals yellow, foes and unknown kinds red', () => {
  assert.equal(kindColour('pc'), kindColour('ally'));
  assert.notEqual(kindColour('neutral'), kindColour('pc'));
  assert.equal(kindColour('foe'), KIND_COLOURS.foe);
  assert.equal(kindColour('something-old'), KIND_COLOURS.foe);
});

test('T toggles a target; the order is the order targets were added', () => {
  let t = toggleTarget([], 'ogre');
  t = toggleTarget(t, 'rat1');
  assert.deepEqual(t, ['ogre', 'rat1']);
  assert.deepEqual(toggleTarget(t, 'ogre'), ['rat1']);
});

test('mark squares: whole space; a lone Tiny creature its square; a sharing one its quarter', () => {
  assert.deepEqual(markSquare({ x: 3, y: 4, size: 2 }, false, false), { x: 3, y: 4, size: 2 });
  assert.deepEqual(markSquare({ x: 3.25, y: 4.25, size: 0.5 }, true, false), { x: 3, y: 4, size: 1 });
  assert.deepEqual(markSquare({ x: 3.5, y: 4, size: 0.5 }, true, true), { x: 3.5, y: 4, size: 0.5 });
});

test('chevrons: four, pointing inward from the corners, breathing with the phase', () => {
  const a = chevrons(0, 0, 50, 0), b = chevrons(0, 0, 50, 0.25);
  assert.equal(a.paths.length, 4);
  const [tl] = a.paths;   // top-left: the corner point is up-left of the square, the arms point right and down
  assert.ok(tl[1][0] <= 0 && tl[1][1] <= 0);
  assert.ok(tl[0][0] > tl[1][0] && tl[2][1] > tl[1][1]);
  assert.notDeepEqual(a.paths, b.paths, 'they move with the pulse');
  assert.ok(a.alpha > 0 && a.alpha <= 1);
});

test('PF2E system configuration: 5-ft squares, 5-10-5 diagonals, nearest-square creature distance', () => {
  const pf2e = systemConfig('pf2e');
  assert.equal(pf2e.measurement.squareFeet, 5);
  assert.deepEqual([...pf2e.measurement.diagonalCosts], [1, 2]);
  assert.equal(systemConfig('nope'), null);
  assert.deepEqual(Object.keys(SYSTEMS), ['pf2e']);
  // terrain rules read the same configuration (one source)
  assert.equal(DIAGONAL_COSTS, pf2e.measurement.diagonalCosts);
  assert.equal(FEET_PER_CELL, 5);
  // adjacent: 5 ft; three diagonals: 5 + 10 + 5 = 20 ft; a Large creature measured from its nearest square
  assert.equal(creatureDistance(pf2e, { x: 0, y: 0, size: 1 }, { x: 1, y: 0, size: 1 }, spaceDistance), 5);
  assert.equal(creatureDistance(pf2e, { x: 0, y: 0, size: 1 }, { x: 3, y: 3, size: 1 }, spaceDistance), 20);
  assert.equal(creatureDistance(pf2e, { x: 0, y: 0, size: 1 }, { x: 2, y: 0, size: 2 }, spaceDistance), 10);
  // a made-up system with 1-1-1 diagonals and 1.5 m squares measures by its own rule
  const metric = { measurement: { squareFeet: 1.5, diagonalCosts: [1], unit: 'm' } };
  assert.equal(creatureDistance(metric, { x: 0, y: 0, size: 1 }, { x: 3, y: 3, size: 1 }, spaceDistance), 4.5);
});
