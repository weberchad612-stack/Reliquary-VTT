import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SENSE, WALL_TYPES, senseOf, onSnap, sideOf, blocksFrom } from '../engine/walls/presets.js';

const { NONE, LIMITED, NORMAL, PROXIMITY } = SENSE;
const seg = (t, extra = {}) => ({ id: 'x', a: [0, 0], b: [1, 0], t, ...extra });

test('every wall type defines all four senses with valid values', () => {
  for (const [t, v] of Object.entries(WALL_TYPES)) {
    for (const s of ['move', 'sight', 'light', 'sound']) {
      assert.ok(Object.values(SENSE).includes(v[s]), `${t}.${s}`);
    }
    assert.ok([NONE, NORMAL].includes(v.move), `${t}.move must be 0 or 20`);
  }
});

test('type presets match the design table', () => {
  assert.deepEqual(senseOf(seg('solid')), { move: NORMAL, sight: NORMAL, light: NORMAL, sound: NORMAL });
  assert.deepEqual(senseOf(seg('terrain')), { move: NORMAL, sight: LIMITED, light: LIMITED, sound: LIMITED });
  assert.deepEqual(senseOf(seg('grate')), { move: NORMAL, sight: NONE, light: NONE, sound: NONE });
  assert.deepEqual(senseOf(seg('window')), { move: NORMAL, sight: NONE, light: NONE, sound: LIMITED });
  assert.deepEqual(senseOf(seg('slit')), { move: NORMAL, sight: PROXIMITY, light: PROXIMITY, sound: LIMITED });
  assert.deepEqual(senseOf(seg('ethereal')), { move: NONE, sight: NORMAL, light: NORMAL, sound: NONE });
});

test('overrides replace preset values', () => {
  assert.equal(senseOf(seg('solid', { sight: NONE })).sight, NONE);
  assert.equal(senseOf(seg('solid', { sight: NONE })).move, NORMAL);
});

test('doors: closed and locked block, open passes everything', () => {
  const d = seg('door', { door: { id: 'd1' } });
  assert.equal(senseOf(d).sight, NORMAL);
  assert.equal(senseOf(d, { state: 'locked' }).move, NORMAL);
  assert.deepEqual(senseOf(d, { state: 'open' }), { move: NONE, sight: NONE, light: NONE, sound: NONE });
  const startsOpen = seg('door', { door: { id: 'd2', initial: 'open' } });
  assert.equal(senseOf(startsOpen).sight, NONE);
});

test('secret doors act as solid walls until found', () => {
  const s = seg('secret', { door: { id: 's1' }, sight: NONE });
  assert.equal(senseOf(s).sight, NORMAL, 'overrides are ignored while hidden');
  assert.equal(senseOf(s, { state: 'open' }).sight, NORMAL, 'an unfound secret door never opens');
  assert.equal(senseOf(s, { found: true }).sight, NONE, 'found: overrides apply');
  assert.equal(senseOf(s, { found: true, state: 'open' }).move, NONE);
});

test('unknown type throws', () => {
  assert.throws(() => senseOf(seg('brick')), /Unknown wall type/);
});

test('onSnap accepts 1/8 multiples and rejects others', () => {
  for (const v of [0, 0.125, 0.25, 0.375, 3, 10.875]) assert.ok(onSnap(v), String(v));
  for (const v of [0.1, 0.2, 3.3, 10.88]) assert.ok(!onSnap(v), String(v));
});

test('direction: left of an eastward segment is north (y grows downward)', () => {
  const a = [0, 0], b = [1, 0];
  assert.equal(sideOf(a, b, [0.5, -1]), -1);
  assert.equal(sideOf(a, b, [0.5, 1]), 1);
  assert.equal(sideOf(a, b, [2, 0]), 0);
  const left = { a, b, dir: 1 }, right = { a, b, dir: 2 }, both = { a, b };
  assert.ok(blocksFrom(left, [0.5, -1]) && !blocksFrom(left, [0.5, 1]));
  assert.ok(blocksFrom(right, [0.5, 1]) && !blocksFrom(right, [0.5, -1]));
  assert.ok(blocksFrom(both, [0.5, 1]) && blocksFrom(both, [0.5, -1]));
});
