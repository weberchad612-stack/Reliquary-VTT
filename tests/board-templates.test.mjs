import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATE_COLOURS, nextColour, templateId, canRemove, markerOf, markerPoints, markerAt, areaTargets, sizeFeet, templateRecord, hexA,
} from '../board/templates.js';
import { tokensInCells } from '../engine/areas/areas.js';

test('colours: the first free palette colour, wrapping when all are used', () => {
  assert.equal(nextColour({}), 0);
  assert.equal(nextColour({ a: { col: 0 }, b: { col: 2 } }), 1);
  const full = Object.fromEntries(TEMPLATE_COLOURS.map((_, i) => ['t' + i, { col: i }]));
  assert.equal(nextColour(full), 0);
  assert.equal(hexA('#ff8a1f', 0.5), 'rgba(255, 138, 31, 0.5)');
});

test('ids are lower case and time-ordered', () => {
  const a = templateId(1000, 0.5), b = templateId(2000, 0.1);
  assert.match(a, /^[a-z0-9][a-z0-9-]*$/);
  assert.ok(a < b);
});

test('who may remove: players their own, the GM any', () => {
  assert.equal(canRemove({ by: 'player' }, 'player'), true);
  assert.equal(canRemove({ by: 'gm' }, 'player'), false);
  assert.equal(canRemove({ by: 'player' }, 'gm'), true);
});

test('remove markers sit past the origin and are nudged apart', () => {
  assert.deepEqual(markerOf({ shape: 'burst', origin: [3, 4] }), [3, 4]);
  const c = markerOf({ shape: 'cone', origin: [3, 4], dir: 4 });
  assert.ok(Math.abs(c[0] - 3) < 1e-9 && Math.abs(c[1] - 4.4) < 1e-9);
  const pts = markerPoints({ a: { shape: 'burst', origin: [3, 4] }, b: { shape: 'burst', origin: [3, 4] } });
  assert.notDeepEqual(pts.a, pts.b);
  const T = { a: { shape: 'burst', origin: [3, 4], by: 'gm' } };
  assert.equal(markerAt(T, [3.1, 4], 'gm'), 'a');
  assert.equal(markerAt(T, [3.1, 4], 'player'), null);
  assert.equal(markerAt(T, [4, 4], 'gm'), null);
});

test('areaTargets: visible, targetable tokens in the area; an emanation adds its caster', () => {
  const tokens = { me: { x: 5, y: 5 }, foe: { x: 6, y: 5, kind: 'foe' }, mark: { x: 6, y: 6, kind: 'marker' }, unseen: { x: 4, y: 4, kind: 'foe' } };
  const cells = [[6, 5], [6, 6], [4, 4]];
  const visible = (id) => id !== 'unseen';
  assert.deepEqual(areaTargets(cells, tokens, { inCells: tokensInCells, visible }), ['foe']);
  assert.deepEqual(areaTargets(cells, tokens, { inCells: tokensInCells, visible, caster: 'me', includesCaster: true }), ['me', 'foe']);
});

test('sizes: whole squares, at least one, capped', () => {
  assert.equal(sizeFeet('17'), 15);
  assert.equal(sizeFeet('1'), 5);
  assert.equal(sizeFeet('9000'), 500);
  assert.ok(Number.isNaN(sizeFeet('abc')));
  assert.ok(Number.isNaN(sizeFeet('-5')));
});

test('templateRecord keeps what each shape needs', () => {
  const cone = templateRecord({ map: 'm', shape: 'cone', ft: 15, area: { origin: [1, 2], dir: 3, cells: [[1, 2]] }, caster: 'a', casterName: 'A', by: 'gm', col: 1, at: 't' });
  assert.equal(cone.dir, 3); assert.equal(cone.casterName, 'A');
  const line = templateRecord({ map: 'm', shape: 'line', ft: 30, area: { origin: [1, 2], angle: 0.123456789, cells: [] }, by: 'player', col: 0, at: 't', widthFeet: 5 });
  assert.equal(line.angle, 0.1235); assert.equal(line.width_ft, 5); assert.equal(line.caster, undefined);
});
