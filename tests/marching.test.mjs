// The party's marching order (engine/tokens/marching.js): slots, turning the block, arrival facing, placement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMove, fits, canStep } from '../engine/movement/movement.js';
import { blockersAt } from '../engine/tokens/occupancy.js';
import {
  MARCH_DIRS, marchFacing, marchMembers, marchSlots, marchMove, marchOffset, marchAnchorBehind, marchAnchorAhead,
  marchArrivalFacing, placeFormation, marchCentre,
} from '../engine/tokens/marching.js';

const engine = { fits, canStep, blockersAt };
const GRID = { cell_px: 50, origin_px: [0, 0], cols: 20, rows: 20, feet_per_cell: 5 };
const wall = (id, a, b) => ({ id, a, b, t: 'solid' });

test('marching: the nearest of 8 directions to a heading', () => {
  assert.equal(marchFacing(0, -5), 'n');
  assert.equal(marchFacing(3, 0), 'e');
  assert.equal(marchFacing(4, 4), 'se');
  assert.equal(marchFacing(-2, -2.2), 'nw');
  assert.equal(marchFacing(-10, 1), 'w');
  assert.equal(marchFacing(0, 0), null);
});

test('marching: members are the living PCs and the GM\'s additions; slots kept, the rest filled middle first', () => {
  const tokens = { a: { kind: 'pc', name: 'Pip' }, b: { kind: 'pc', name: 'Kerra' }, c: { kind: 'pc', name: 'Dead', dead: true },
    d: { kind: 'npc', name: 'Hound' }, e: { kind: 'foe', name: 'Rat' } };
  assert.deepEqual(marchMembers(tokens, {}), ['b', 'a']);
  assert.deepEqual(marchMembers(tokens, { extra: ['d', 'gone'] }), ['d', 'b', 'a']);
  const s = marchSlots(['b', 'a', 'd'], { a: [3, 3], b: [3, 3], d: [9, 0] });
  assert.deepEqual(s, { b: [3, 3], a: [1, 0], d: [2, 0] }, 'the first in name order keeps a contested slot; a bad slot is refilled');
  const swapped = marchMove(s, 'a', [3, 3]);
  assert.deepEqual(swapped, { a: [3, 3], b: [1, 0], d: [2, 0] }, 'whoever stood there takes the old slot');
  assert.deepEqual(marchMove(s, 'b', [0, 2]).b, [0, 2]);
});

test('marching: the block turns in 8 directions and every slot keeps a square of its own', () => {
  const all = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) all.push([c, r]);
  for (const d of MARCH_DIRS) {
    const cells = all.map((s) => marchOffset(s, d).join(','));
    assert.equal(new Set(cells).size, 16, `${d}: 16 squares`);
  }
  // facing north the front row is up and the grid's left is the map's west
  assert.deepEqual(marchOffset([0, 0], 'n'), [-1, -1]);
  assert.deepEqual(marchOffset([3, 3], 'n'), [2, 2]);
  // facing east the front row is east and its left end is north
  assert.deepEqual(marchOffset([0, 0], 'e'), [2, -1]);
  // facing south the block is turned round: the front left is south-east
  assert.deepEqual(marchOffset([0, 0], 's'), [2, 2]);
  // a diagonal: the front row runs along a diagonal, each member a diagonal step from the next
  const ne = [0, 1, 2, 3].map((c) => marchOffset([c, 0], 'ne'));
  for (let i = 1; i < 4; i++) assert.deepEqual([ne[i][0] - ne[i - 1][0], ne[i][1] - ne[i - 1][1]], [1, 1]);
});

test('marching: anchors put the back row on the way in, or the front row on the destination', () => {
  const slots = { a: [1, 0], b: [2, 1] };   // rows 0 and 1 used; the formation's own middle, not the grid's
  const c = marchCentre(slots);
  const sq = (anchor, s) => { const o = marchOffset(s, 'n', c); return [anchor[0] + o[0], anchor[1] + o[1]]; };
  assert.deepEqual(sq(marchAnchorBehind([5, 10], 'n', slots), slots.b), [6, 10], 'the back row stands on the way in');
  assert.deepEqual(sq(marchAnchorAhead([5, 2], 'n', slots), slots.a), [5, 2], 'the front row reaches the destination');
});

test('marching: forward on arrival is into the map, or as the map says', () => {
  // an entrance on the west edge: its arrival squares are east of it
  assert.equal(marchArrivalFacing({ link: { at: [[0, 9], [0, 10]] }, cells: [[1, 9], [1, 10]] }), 'e');
  // arrival squares on the entrance itself: toward the map's middle
  assert.equal(marchArrivalFacing({ link: { at: [[10, 19]] }, cells: [[10, 19]], grid: GRID }), 'n');
  // a starting area in the north-west corner faces the middle
  assert.equal(marchArrivalFacing({ start: [[1, 1], [2, 1]], grid: GRID }), 'se');
  assert.equal(marchArrivalFacing({ start: [[1, 1]], grid: GRID, facing: 'w' }), 'w', 'the map\'s own facing wins');
});

test('marching: on open ground every member stands in its place in the block', () => {
  const pm = prepareMove([], {}, GRID);
  const members = [{ id: 'k', slot: [1, 0] }, { id: 'p', slot: [2, 0] }, { id: 'j', slot: [1, 1] }, { id: 'c', slot: [2, 2] }];
  const anchor = [10, 10];
  for (const dir of ['n', 'e', 'se', 'w']) {
    const r = placeFormation({ pm, engine, anchor, dir, members, seeds: [anchor] });
    assert.deepEqual(r.unplaced, []);
    const c = marchCentre(members.map((x) => x.slot));
    for (const m of members) {
      const o = marchOffset(m.slot, dir, c), p = r.placed.find((x) => x.id === m.id);
      assert.deepEqual([p.x, p.y], [anchor[0] + o[0], anchor[1] + o[1]], `${dir}: ${m.id} in its place`);
    }
  }
});

test('marching: in a corridor the block squeezes into single file, front first, never through a wall', () => {
  // a corridor one square wide, x = 5, from y = 0 to y = 19, walls on both sides
  const segs = [wall('w', [5, 0], [5, 20]), wall('e', [6, 0], [6, 20])];
  const pm = prepareMove(segs, {}, GRID);
  const members = [{ id: 'front', slot: [1, 0] }, { id: 'right', slot: [2, 0] }, { id: 'back', slot: [1, 1] }];
  const r = placeFormation({ pm, engine, anchor: [5, 10], dir: 'n', members, seeds: [[5, 10]] });
  assert.deepEqual(r.unplaced, []);
  for (const p of r.placed) assert.equal(p.x, 5, `${p.id} stays in the corridor`);
  const y = Object.fromEntries(r.placed.map((p) => [p.id, p.y]));
  assert.ok(y.front <= y.right && y.front < y.back, `the front of the column leads (${JSON.stringify(y)})`);
  assert.equal(new Set(r.placed.map((p) => p.y)).size, 3, 'one square each');
});

test('marching: a bending passage takes the party in column, in marching order, never through a wall', () => {
  // a passage one square wide: east along y = 10 from x = 2 to x = 8, then north along x = 8 up to y = 4
  const cells = [];
  for (let x = 2; x <= 8; x++) cells.push([x, 10]);
  for (let y = 4; y < 10; y++) cells.push([8, y]);
  const open = new Set(cells.map((c) => c.join(',')));
  const segs = [];
  for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) {
    if (!open.has(`${x},${y}`)) continue;
    if (!open.has(`${x},${y - 1}`)) segs.push(wall(`n${x}.${y}`, [x, y], [x + 1, y]));
    if (!open.has(`${x},${y + 1}`)) segs.push(wall(`s${x}.${y}`, [x, y + 1], [x + 1, y + 1]));
    if (!open.has(`${x - 1},${y}`)) segs.push(wall(`w${x}.${y}`, [x, y], [x, y + 1]));
    if (!open.has(`${x + 1},${y}`)) segs.push(wall(`e${x}.${y}`, [x + 1, y], [x + 1, y + 1]));
  }
  const pm = prepareMove(segs, {}, GRID);
  // a 2 x 2 block arriving from the passage's west end, heading east
  const members = [{ id: 'lead', slot: [1, 0] }, { id: 'second', slot: [2, 0] }, { id: 'third', slot: [1, 1] }, { id: 'last', slot: [2, 1] }];
  const dir = 'e';
  const anchor = marchAnchorBehind([2, 10], dir, Object.fromEntries(members.map((m) => [m.id, m.slot])));
  const r = placeFormation({ pm, engine, anchor, dir, members, seeds: [[2, 10]] });
  assert.equal(r.column, true, 'the block does not fit: in column');
  assert.deepEqual(r.unplaced, []);
  for (const p of r.placed) assert.ok(open.has(`${p.x},${p.y}`), `${p.id} at ${p.x},${p.y} is in the passage`);
  // along the passage, the lead is furthest in and the order holds
  const along = (p) => cells.findIndex((c) => c[0] === p.x && c[1] === p.y);
  const at = Object.fromEntries(r.placed.map((p) => [p.id, along(p)]));
  assert.ok(at.lead > at.second && at.second > at.third && at.third > at.last, `in order: ${JSON.stringify(at)}`);
});

test('marching: moving up a corridor, the front reaches the destination and the rest trail back the way they came', () => {
  const segs = [wall('w', [5, 0], [5, 20]), wall('e', [6, 0], [6, 20])];
  const pm = prepareMove(segs, {}, GRID);
  const members = [{ id: 'lead', slot: [1, 0] }, { id: 'second', slot: [2, 0] }, { id: 'last', slot: [1, 1] }];
  const slots = Object.fromEntries(members.map((m) => [m.id, m.slot]));
  const dest = [5, 4], dir = 'n';
  const r = placeFormation({ pm, engine, anchor: marchAnchorAhead(dest, dir, slots), dir, members, seeds: [dest], origin: [[5, 15], [5, 16]] });
  assert.equal(r.column, true);
  const y = Object.fromEntries(r.placed.map((p) => [p.id, p.y]));
  assert.deepEqual(y, { lead: 4, second: 5, last: 6 }, 'the lead on the destination, the others behind it, toward where they came from');
});

test('marching: nobody spills into unexplored ground; with no explored room left, members are reported', () => {
  const segs = [wall('w', [5, 0], [5, 20]), wall('e', [6, 0], [6, 20])];
  const pm = prepareMove(segs, {}, GRID);
  const members = [{ id: 'lead', slot: [1, 0] }, { id: 'second', slot: [2, 0] }, { id: 'last', slot: [1, 1] }];
  const slots = Object.fromEntries(members.map((m) => [m.id, m.slot]));
  const dest = [5, 4], dir = 'n';
  const anchor = marchAnchorAhead(dest, dir, slots);
  // explored: the corridor from y = 5 down: room behind the lead
  const behind = placeFormation({ pm, engine, anchor, dir, members, seeds: [dest], origin: [[5, 15]], spill: (x, y) => y >= 5 });
  assert.deepEqual(behind.unplaced, []);
  for (const p of behind.placed) assert.ok(p.y >= 4, `${p.id} on explored ground or the destination`);
  // explored: nothing but the destination itself
  const none = placeFormation({ pm, engine, anchor, dir, members, seeds: [dest], origin: [[5, 15]], spill: () => false });
  assert.equal(none.placed.length + none.unplaced.length, 3);
  for (const p of none.placed) {
    const o = marchOffset(members.find((m) => m.id === p.id).slot, dir, marchCentre(members.map((m) => m.slot)));
    const own = p.x === anchor[0] + o[0] && p.y === anchor[1] + o[1];
    assert.ok(own || (p.x === 5 && p.y === 4), `${p.id} only on its own place or the destination`);
  }
  assert.ok(none.unplaced.length >= 1, 'whoever has neither is reported, not placed on unexplored squares');
});

test('marching: squares taken by others are avoided; with no room the member is reported', () => {
  const pm = prepareMove([], {}, { ...GRID, cols: 2, rows: 1 });
  const occupants = [{ id: 'rat', x: 0, y: 0, size: 1 }];
  const r = placeFormation({ pm, engine, anchor: [0, 0], dir: 'n', members: [{ id: 'a', slot: [1, 0] }, { id: 'b', slot: [2, 0] }], seeds: [[0, 0], [1, 0]], occupants });
  assert.equal(r.placed.length, 1);
  assert.deepEqual(r.placed[0], { id: 'a', x: 1, y: 0 });
  assert.deepEqual(r.unplaced, ['b']);
});

import { formationArrival, partyOf } from '../board/travel.js';
import * as M from '../engine/tokens/marching.js';

test('marching: arriving through an entrance, the party faces into the map in its order; extras travel along', () => {
  const pm = prepareMove([], {}, GRID);
  const eng = { ...engine, ...M };
  const tokens = { k: { name: 'Kerra', kind: 'pc' }, p: { name: 'Pip', kind: 'pc' }, h: { name: 'Hound', kind: 'npc' }, r: { name: 'Rat', kind: 'foe' } };
  const marching = { slots: { k: [1, 0], p: [1, 1], h: [2, 1] }, extra: ['h'] };
  const travellers = partyOf(tokens, marching);
  assert.deepEqual(travellers.map((t) => t.id), ['h', 'k', 'p'], 'the PCs and the GM\'s addition, not the rat');
  // an entrance on the west edge at x 0, arrival squares at x 1
  const link = { at: [[0, 9], [0, 10]] }, cells = [[1, 9], [1, 10]];
  const r = formationArrival({ pm, cells, travellers, engine: eng, marching, link, map: { grid: GRID } });
  assert.equal(r.dir, 'e');
  const at = Object.fromEntries(r.placed.map((p) => [p.id, [p.x, p.y]]));
  assert.ok(at.k[0] > at.p[0], `Kerra (front) is further in than Pip (behind): ${JSON.stringify(at)}`);
  assert.equal(at.p[1], at.k[1], 'Pip right behind her');
  assert.ok(at.h[1] > at.p[1], 'the hound on the right, facing east: south of Pip');
  // nothing explored: only own places and the arrival squares
  const none = formationArrival({ pm, cells, travellers, engine: eng, marching, link, map: { grid: GRID }, spill: () => false });
  assert.deepEqual(none.unplaced, [], 'on open ground everyone has their own place');
});

test('marching: only relative positions count: a column on the right edge plays the same as one in the middle', () => {
  const pm = prepareMove([], {}, GRID);
  const place = (col) => {
    const members = [{ id: 'a', slot: [col, 0] }, { id: 'b', slot: [col, 1] }, { id: 'c', slot: [col, 2] }];
    const slots = Object.fromEntries(members.map((m) => [m.id, m.slot]));
    const r = placeFormation({ pm, engine, anchor: marchAnchorAhead([10, 5], 'n', slots), dir: 'n', members, seeds: [[10, 5]] });
    return Object.fromEntries(r.placed.map((p) => [p.id, [p.x, p.y]]));
  };
  const right = place(3), middle = place(1), left = place(0);
  assert.deepEqual(right, { a: [10, 5], b: [10, 6], c: [10, 7] }, 'the column walks straight in on the destination');
  assert.deepEqual(middle, right);
  assert.deepEqual(left, right);
  // and a block drawn in the rear rows still leads with its front row onto the destination
  const rear = [{ id: 'x', slot: [1, 2] }, { id: 'y', slot: [2, 3] }];
  const rs = Object.fromEntries(rear.map((m) => [m.id, m.slot]));
  const r = placeFormation({ pm, engine, anchor: marchAnchorAhead([10, 5], 'e', rs), dir: 'e', members: rear, seeds: [[10, 5]] });
  assert.ok(r.placed.some((p) => p.x === 10 && p.y === 5 || (p.id === 'x' && p.x === 10)), JSON.stringify(r.placed));
});
