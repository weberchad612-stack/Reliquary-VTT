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

test('target triangles: four, pointing inward, pulsing inward and back', () => {
  const rest = chevrons(0, 0, 50, 0), mid = chevrons(0, 0, 50, 0.5), end = chevrons(0, 0, 50, 1);
  assert.equal(rest.paths.length, 4);
  for (const p of rest.paths) assert.equal(p.length, 3);
  // top-left triangle: its tip points into the square (down and right of its base)
  const [tip, b1, b2] = rest.paths[0];
  const base = [(b1[0] + b2[0]) / 2, (b1[1] + b2[1]) / 2];
  assert.ok(tip[0] > base[0] && tip[1] > base[1]);
  // at rest it sits on the corner (base just outside it); halfway through the pulse it is further in
  assert.ok(base[0] < 0 && base[1] < 0);
  assert.ok(mid.paths[0][0][0] > tip[0] && mid.paths[0][0][1] > tip[1]);
  assert.deepEqual(end.paths, rest.paths, 'and back again');
  // bottom-right points up and left
  const [t4, c1, c2] = rest.paths[3];
  assert.ok(t4[0] < (c1[0] + c2[0]) / 2 && t4[1] < (c1[1] + c2[1]) / 2);
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
