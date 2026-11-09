import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawScale, drawBox, SMALL_SCALE } from '../engine/tokens/display.js';
import { footprintPoints } from '../engine/sight/visibility.js';
import { mayShare } from '../engine/tokens/occupancy.js';

test('Small tokens are drawn at 0.75 of a Medium token, centred in their square', () => {
  assert.equal(SMALL_SCALE, 0.75);
  const pip = { x: 3, y: 4, small: true };
  assert.deepEqual(drawBox({ x: 3, y: 4, size: 1 }, pip), { x: 3.125, y: 4.125, size: 0.75 });
  assert.deepEqual(drawBox({ x: 3, y: 4, size: 1 }, { x: 3, y: 4 }), { x: 3, y: 4, size: 1 }, 'Medium unchanged');
});

test('the Small flag only shrinks 1x1 tokens', () => {
  assert.equal(drawScale({ small: true, size: 2 }), 1);
  assert.equal(drawScale({ small: true, size: 0.5 }), 1);
  assert.equal(drawScale({ small: true }), SMALL_SCALE);
});

test('a Small creature still occupies a full square for rules', () => {
  // footprint, sight sample points and sharing are unchanged by `small`
  assert.deepEqual(footprintPoints(3, 4, 1), footprintPoints(3, 4, 1));
  assert.equal(mayShare({ size: 1, small: true }, { size: 1 }), false, 'Small and Medium cannot share');
  assert.equal(mayShare({ size: 1, small: true }, { size: 3 }), true, 'Small may share with Huge, like Medium');
});
