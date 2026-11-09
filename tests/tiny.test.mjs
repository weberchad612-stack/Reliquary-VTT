import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTiny, spaceOf, moveSpaceOf, SLOTS } from '../engine/tokens/tiny.js';
import { prepareMove, path } from '../engine/movement/movement.js';
import { prepare, tokenCanSee } from '../engine/sight/visibility.js';

const rat = (id, x, y, extra = {}) => ({ id, x, y, size: 0.5, ...extra });
const at = (layout, id) => layout.spaces.get(id);

test('a Tiny token alone in its square is centred', () => {
  const L = layoutTiny([rat('r1', 4, 5)]);
  assert.deepEqual(at(L, 'r1'), { x: 4.25, y: 5.25, size: 0.5, slot: null });
});

test('two Tiny tokens in one square take diagonal quadrants', () => {
  const L = layoutTiny([rat('a', 4, 5), rat('b', 4, 5)]);
  assert.deepEqual([at(L, 'a').x, at(L, 'a').y], [4, 5], 'top-left');
  assert.deepEqual([at(L, 'b').x, at(L, 'b').y], [4.5, 5.5], 'bottom-right');
});

test('four Tiny tokens fill the square; each gets its own quadrant', () => {
  const L = layoutTiny(['a', 'b', 'c', 'd'].map((id) => rat(id, 2, 2)));
  const slots = ['a', 'b', 'c', 'd'].map((id) => at(L, id).slot).sort();
  assert.deepEqual(slots, [0, 1, 2, 3]);
  assert.equal(L.overfull.length, 0);
});

test('a fifth Tiny token in one square is reported as overfull', () => {
  const L = layoutTiny(['a', 'b', 'c', 'd', 'e'].map((id) => rat(id, 2, 2)));
  assert.deepEqual(L.overfull, ['2,2']);
});

test('tokens keep their quadrant when others arrive or leave', () => {
  const L1 = layoutTiny([rat('a', 3, 3), rat('b', 3, 3)]);
  const keep = (id) => ({ slot: at(L1, id).slot });
  // c arrives: a and b stay where they were
  const L2 = layoutTiny([rat('a', 3, 3, keep('a')), rat('b', 3, 3, keep('b')), rat('c', 3, 3)]);
  assert.equal(at(L2, 'a').slot, at(L1, 'a').slot);
  assert.equal(at(L2, 'b').slot, at(L1, 'b').slot);
  assert.ok(![at(L1, 'a').slot, at(L1, 'b').slot].includes(at(L2, 'c').slot));
  // a leaves: b keeps its quadrant while c is still there
  const L3 = layoutTiny([rat('b', 3, 3, keep('b')), rat('c', 3, 3, { slot: at(L2, 'c').slot })]);
  assert.equal(at(L3, 'b').slot, at(L1, 'b').slot);
  // only one left: back to the centre
  const L4 = layoutTiny([rat('b', 3, 3, keep('b'))]);
  assert.equal(at(L4, 'b').slot, null);
});

test('a lone Tiny token stays centred inside a Large, Huge or Gargantuan creature', () => {
  for (const size of [2, 3, 4]) {
    const big = { id: 'big', x: 2, y: 2, size };
    const L = layoutTiny([big, rat('r', 3, 3)]);
    assert.equal(at(L, 'r').slot, null, `size ${size}`);
  }
});

test('a Tiny token sharing a square with a Small or Medium creature takes a quadrant', () => {
  const L = layoutTiny([{ id: 'kerra', x: 3, y: 3 }, rat('r', 3, 3)]);
  assert.notEqual(at(L, 'r').slot, null);
  const small = layoutTiny([{ id: 'pip', x: 3, y: 3, small: true }, rat('r', 3, 3)]);
  assert.notEqual(at(small, 'r').slot, null);
  const next = layoutTiny([{ id: 'kerra', x: 4, y: 3 }, rat('r', 3, 3)]);
  assert.equal(at(next, 'r').slot, null, 'Medium in the next square: centred');
});

test('several Tiny tokens inside a big creature still take quadrants', () => {
  const L = layoutTiny([{ id: 'giant', x: 2, y: 2, size: 3 }, rat('a', 3, 3), rat('b', 3, 3)]);
  assert.notEqual(at(L, 'a').slot, null);
  assert.notEqual(at(L, 'b').slot, null);
});

test('Tiny tokens in different squares do not affect each other', () => {
  const L = layoutTiny([rat('a', 1, 1), rat('b', 2, 1)]);
  assert.equal(at(L, 'a').slot, null);
  assert.equal(at(L, 'b').slot, null);
});

test('spaceOf and moveSpaceOf', () => {
  const L = layoutTiny([rat('a', 4, 4), rat('b', 4, 4)]);
  assert.deepEqual(spaceOf(rat('b', 4, 4), L), { x: 4.5, y: 4.5, size: 0.5 });
  assert.deepEqual(moveSpaceOf(rat('b', 4, 4)), { x: 4.25, y: 4.25, size: 0.5 }, 'movement always from the centre');
  assert.deepEqual(spaceOf({ id: 'k', x: 1, y: 1 }, L), { x: 1, y: 1, size: 1 });
  assert.equal(SLOTS.length, 4);
});

test('a centred Tiny token moves square to square and is seen from its laid-out space', () => {
  const walls = [{ id: 'v', a: [3, 0], b: [3, 5], t: 'solid' }];
  const pm = prepareMove(walls, {}, { cols: 10, rows: 10 });
  const r = path(pm, moveSpaceOf(rat('r', 1, 1)), 4.25, 6.25);
  assert.ok(r, 'goes around the wall');
  assert.deepEqual(r.path[r.path.length - 1], [4.25, 6.25]);
  // Seen: a viewer east of the wall sees the rat once it is past the wall's end
  const p = prepare(walls);
  const L = layoutTiny([rat('r', 2, 6)]);
  assert.ok(tokenCanSee({ x: 5, y: 2 }, spaceOf(rat('r', 2, 6), L), p, { rangeFt: 200, feetPerCell: 5 }));
});
