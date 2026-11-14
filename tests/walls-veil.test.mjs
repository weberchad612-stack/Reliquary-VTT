// Veils (engine/walls/presets.js): a visible magical barrier, door-like, that blocks movement, sight and light while it
// stands and nothing once the GM dispels it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { senseOf, DOOR_TYPES, VEIL_TYPES, SENSE } from '../engine/walls/presets.js';
import { prepare, canSee } from '../engine/sight/visibility.js';
import { prepareMove, path as findPath } from '../engine/movement/movement.js';

const grid = { cols: 10, rows: 10 };
const room = [
  { id: 'n', t: 'solid', a: [0, 0], b: [10, 0] }, { id: 's', t: 'solid', a: [0, 10], b: [10, 10] },
  { id: 'w', t: 'solid', a: [0, 0], b: [0, 10] }, { id: 'e', t: 'solid', a: [10, 0], b: [10, 10] },
  { id: 'm1', t: 'solid', a: [5, 0], b: [5, 4] }, { id: 'm2', t: 'solid', a: [5, 5], b: [5, 10] },
  { id: 'v1', t: 'veil', a: [5, 4], b: [5, 5], door: { id: 'v01', label: 'Veil' } },
];

test('veil: a door type with no lock, blocking all but sound while it stands', () => {
  assert.ok(DOOR_TYPES.includes('veil') && VEIL_TYPES.includes('veil'));
  const up = senseOf(room[6], { state: 'closed' });
  assert.deepEqual([up.move, up.sight, up.light, up.sound], [SENSE.NORMAL, SENSE.NORMAL, SENSE.NORMAL, SENSE.NONE]);
  const gone = senseOf(room[6], { state: 'open' });
  assert.deepEqual([gone.move, gone.sight, gone.light, gone.sound], [0, 0, 0, 0]);
});

test('veil: standing, it blocks sight and movement; dispelled, both pass', () => {
  const a = [2.5, 4.5], b = [7.5, 4.5];
  const standing = prepare(room, { doors: {} }, 'sight');
  assert.equal(canSee(a, b, standing), false);
  assert.equal(findPath(prepareMove(room, { doors: {} }, grid), { x: 2, y: 4, size: 1 }, 7, 4), null);
  const doors = { v01: { state: 'open' } };
  assert.equal(canSee(a, b, prepare(room, { doors }, 'sight')), true);
  assert.ok(findPath(prepareMove(room, { doors }, grid), { x: 2, y: 4, size: 1 }, 7, 4));
});
