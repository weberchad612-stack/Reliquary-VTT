import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leafEnds, leafShapes, pairOf, sideNormal, insidePoly, LEAF_INSET } from '../engine/doors/leaf.js';

const near = (p, q, msg) => assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9, `${msg}: ${p} vs ${q}`);

// A door in a horizontal wall at y = 5, x 2..3.
const door = (extra = {}) => ({ id: 'x', t: 'door', a: [2, 5], b: [3, 5], door: { id: 'd1', ...extra } });

test('left of a->b is north for an eastward line (y down)', () => {
  near(sideNormal([0, 0], [1, 0], 'left'), [0, -1], 'left');
  near(sideNormal([0, 0], [1, 0], 'right'), [0, 1], 'right');
});

test('hinge defaults to a; panel ends are inset from the walls', () => {
  const e = leafEnds(door());
  near(e.hinge, [2 + LEAF_INSET, 5], 'hinge');
  near(e.free, [3 - LEAF_INSET, 5], 'free');
  const f = leafEnds(door({ hinge: 'b' }));
  near(f.hinge, [3 - LEAF_INSET, 5], 'hinge at b');
});

test('an open leaf swings 90 degrees to the swing side', () => {
  const north = leafShapes(door());
  near(north.openFree, [2 + LEAF_INSET, 5 - (1 - 2 * LEAF_INSET)], 'swings north (left)');
  const south = leafShapes(door({ swing: 'right' }));
  assert.ok(south.openFree[1] > 5, 'swings south (right)');
  const hb = leafShapes(door({ hinge: 'b', swing: 'right' }));
  near(hb.openFree, [3 - LEAF_INSET, 5 + (1 - 2 * LEAF_INSET)], 'hinge b, swings south');
});

test('the swing arc turns the short way, from closed to open', () => {
  const s = leafShapes(door());               // free end east of hinge, opens north
  assert.equal(s.arc.from, 0);
  assert.ok(Math.abs(s.arc.to + Math.PI / 2) < 1e-9);
  assert.equal(s.arc.ccw, true);              // canvas: east to north is anticlockwise
  const r = leafShapes(door({ swing: 'right' }));
  assert.equal(r.arc.ccw, false);
});

test('closed panel covers the doorway centre; open panel does not', () => {
  const s = leafShapes(door());
  assert.ok(insidePoly([2.5, 5], s.closed));
  assert.ok(!insidePoly([2.5, 5], s.open));
  assert.ok(insidePoly([2 + LEAF_INSET + 0.05, 4.5], s.open), 'open panel stands against the hinge jamb');
});

test('double door: the two leaves meet in the middle and hinge at the outer ends', () => {
  const segs = [
    { id: 'l', t: 'door', a: [2, 5], b: [3, 5], door: { id: 'd1', pair: 'd2', hinge: 'a' } },
    { id: 'r', t: 'door', a: [3, 5], b: [4, 5], door: { id: 'd2', pair: 'd1', hinge: 'b' } },
  ];
  const [L, R] = segs;
  assert.equal(pairOf(L, segs), R);
  assert.equal(pairOf(R, segs), L);
  const le = leafEnds(L, R), re = leafEnds(R, L);
  near(le.free, [3, 5], 'left leaf reaches the middle');
  near(re.free, [3, 5], 'right leaf reaches the middle');
  near(le.hinge, [2 + LEAF_INSET, 5], 'left hinge at the west jamb');
  near(re.hinge, [4 - LEAF_INSET, 5], 'right hinge at the east jamb');
  assert.equal(pairOf({ door: { id: 'z' } }, segs), null);
});
