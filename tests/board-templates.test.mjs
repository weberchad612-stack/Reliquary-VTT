import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATE_COLOURS, nextColour, canRemove, markerOf, markerPoints, areaTargets, sizeFeet, templateRecord, hexA,
} from '../board/templates.js';

test('colours: the first free palette colour, wrapping when all are used', () => {
  assert.equal(nextColour({}), 0);
  assert.equal(nextColour({ a: { col: 0 }, b: { col: 2 } }), 1);
  const full = Object.fromEntries(TEMPLATE_COLOURS.map((_, i) => ['t' + i, { col: i }]));
  assert.equal(nextColour(full), 0);
  assert.equal(hexA('#ff8a1f', 0.5), 'rgba(255, 138, 31, 0.5)');
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
});

test('areaTargets: visible, targetable tokens the area reaches; an emanation adds its caster; the rest over or under', () => {
  const tokens = { me: { x: 5, y: 5 }, foe: { x: 6, y: 5, kind: 'foe' }, mark: { x: 6, y: 6, kind: 'marker' }, unseen: { x: 4, y: 4, kind: 'foe' }, bird: { x: 6, y: 6, kind: 'foe' } };
  const visible = (id) => id !== 'unseen';
  const inArea = (pool) => ({ in: Object.keys(pool).filter((id) => id === 'foe'), over: Object.keys(pool).filter((id) => id === 'bird') });
  assert.deepEqual(areaTargets(tokens, { inArea, visible }), { ids: ['foe'], over: ['bird'] });
  assert.deepEqual(areaTargets(tokens, { inArea, visible, caster: 'me', includesCaster: true }).ids, ['me', 'foe']);
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
  assert.equal(line.height, undefined, 'on the ground: no height');
  assert.equal(templateRecord({ map: 'm', shape: 'burst', ft: 20, area: { origin: [1, 2], cells: [] }, by: 'gm', col: 0, at: 't', height: 30 }).height, 30);
  assert.equal(line.angle, 0.1235); assert.equal(line.width_ft, 5); assert.equal(line.caster, undefined);
});
