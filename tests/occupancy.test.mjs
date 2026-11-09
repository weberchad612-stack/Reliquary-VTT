import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayShare, blockersAt, spacesOverlap, SHARE_RULE } from '../engine/tokens/occupancy.js';

const c = (id, x, y, size = 1, extra = {}) => ({ id, x, y, size, ...extra });

test('sharing table: who may share space with whom', () => {
  const share = (a, b) => mayShare({ size: a }, { size: b });
  // 1x1
  assert.equal(share(1, 1), false);
  assert.equal(share(1, 2), false);
  assert.equal(share(1, 3), true, '1x1 with 3x3');
  assert.equal(share(1, 4), true, '1x1 with 4x4');
  // 2x2
  assert.equal(share(2, 2), false);
  assert.equal(share(2, 3), false);
  assert.equal(share(2, 4), true, '2x2 with 4x4');
  // 3x3 and 4x4
  assert.equal(share(3, 4), false);
  assert.equal(share(4, 4), false);
  // order does not matter
  assert.equal(share(4, 1), true);
  assert.equal(share(3, 2), false);
  // Tiny shares with anyone
  for (const s of [0.5, 1, 2, 3, 4]) assert.equal(share(0.5, s), true, `Tiny with ${s}`);
});

test('the rule is data: a stricter table can require a bigger gap', () => {
  const strict = { tiny: true, minGap: 3 };
  assert.equal(mayShare({ size: 1 }, { size: 3 }, strict), false);
  assert.equal(mayShare({ size: 1 }, { size: 4 }, strict), true);
  assert.equal(mayShare({ size: 2 }, { size: 4 }, strict), false);
  assert.equal(SHARE_RULE.minGap, 2);
});

test('overlap ignores creatures that only touch at an edge', () => {
  const giant = c('g', 4, 4, 3);
  assert.ok(spacesOverlap(5, 5, 1, giant));
  assert.ok(!spacesOverlap(7, 5, 1, giant), 'east of the giant, touching its edge');
  assert.ok(spacesOverlap(3, 3, 2, giant), 'a 2x2 overlapping one corner square');
});

test('blockersAt: a Medium may end inside a Huge creature but not on a Large one', () => {
  const tokens = [c('kerra', 1, 1), c('giant', 4, 4, 3), c('ogre', 8, 1, 2)];
  const kerra = tokens[0];
  assert.deepEqual(blockersAt(kerra, 5, 5, tokens), [], 'inside the giant');
  assert.deepEqual(blockersAt(kerra, 8, 2, tokens).map((t) => t.id), ['ogre']);
  assert.deepEqual(blockersAt(kerra, 2, 2, tokens), [], 'empty square');
});

test('blockersAt: a 2x2 may overlap a 4x4 but not a 3x3', () => {
  const tokens = [c('ogre', 0, 0, 2), c('dragon', 4, 4, 4), c('giant', 0, 5, 3)];
  const ogre = tokens[0];
  assert.deepEqual(blockersAt(ogre, 5, 5, tokens), []);
  assert.deepEqual(blockersAt(ogre, 1, 6, tokens).map((t) => t.id), ['giant']);
});

test('blockersAt: two Medium creatures never share; the dead and markers never block', () => {
  const tokens = [c('kerra', 1, 1), c('pip', 2, 2), c('corpse', 3, 3, 1, { dead: true }), c('ping', 4, 4, 1, { kind: 'marker' })];
  assert.deepEqual(blockersAt(tokens[0], 2, 2, tokens).map((t) => t.id), ['pip']);
  assert.deepEqual(blockersAt(tokens[0], 3, 3, tokens), []);
  assert.deepEqual(blockersAt(tokens[0], 4, 4, tokens), []);
  assert.deepEqual(blockersAt(tokens[0], 1, 1, tokens), [], 'its own square');
});

test('blockersAt: Tiny creatures never block and are never blocked', () => {
  const tokens = [c('kerra', 1, 1), c('rat', 2, 2, 0.5)];
  assert.deepEqual(blockersAt(tokens[0], 2, 2, tokens), []);
  assert.deepEqual(blockersAt(tokens[1], 1, 1, tokens), []);
});
