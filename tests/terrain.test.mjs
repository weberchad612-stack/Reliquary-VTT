import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainMap, areaCells, cellsToRects, terrainEnterCost, routeTerrain } from '../engine/terrain/terrain.js';
import { prepareMove, path, reach, routeCost } from '../engine/movement/movement.js';
import { gridDistance, rulerLength, spaceDistance } from '../engine/measure/measure.js';
import { terrainRules, cost, canStepInto } from '../rulesets/pf2e/terrain.js';

const GRID = { cols: 20, rows: 20 };
const open = prepareMove([], {}, GRID);
const sorted = (cells) => cells.map((c) => c.join(',')).sort();

// ---- areas and the index ----

test('area squares come from cells and rects together, without repeats', () => {
  assert.deepEqual(sorted(areaCells({ cells: [[0, 0], [1, 0]], rects: [[1, 0, 2, 2]] })), sorted([[0, 0], [1, 0], [2, 0], [1, 1], [2, 1]]));
});

test('cellsToRects covers exactly the same squares', () => {
  const cells = [[2, 2], [3, 2], [4, 2], [2, 3], [3, 3], [4, 3], [7, 3], [3, 4]];
  const rects = cellsToRects(cells);
  assert.deepEqual(sorted(areaCells({ rects })), sorted(cells));
  assert.ok(rects.length <= 3, `expected the 2x3 block as one rect: ${JSON.stringify(rects)}`);
});

test('the save can switch pack areas off and add temporary ones', () => {
  const pack = [{ id: 'rubble', kind: 'difficult', cells: [[5, 5]] }, { id: 'mud', kind: 'greater_difficult', cells: [[6, 5]] }];
  const t = new TerrainMap(pack, { terrain_off: ['rubble'], terrain: [{ id: 'mist', kind: 'difficult', magical: true, cells: [[7, 5]] }] });
  assert.deepEqual(t.at(5, 5), []);
  assert.equal(t.at(6, 5)[0].id, 'mud');
  assert.equal(t.at(7, 5)[0].id, 'mist');
});

test('a step enters only the new squares of the space', () => {
  const t = new TerrainMap([{ id: 'r', kind: 'difficult', cells: [[3, 3]] }]);
  assert.equal(t.entered(2, 3, 3, 3, 1).length, 1, 'Medium steps into it');
  assert.equal(t.entered(2, 2, 3, 2, 2).length, 0, 'Large: (3,3) was already in its space');
  assert.equal(t.entered(1, 2, 2, 2, 2).length, 1, 'Large: (3,3) is a new square');
});

// ---- PF2E costs ----

const D = { id: 'd', kind: 'difficult', cause: 'rubble' }, G = { id: 'g', kind: 'greater_difficult', cause: 'mud' };

test('difficult +1, greater +2, and they do not stack', () => {
  assert.equal(cost([D]).extra, 1);
  assert.equal(cost([G]).extra, 2);
  assert.equal(cost([D, G]).extra, 2);
  assert.equal(cost([D, { ...D, id: 'd2' }]).extra, 1);
});

test('ignoring difficult terrain: difficult is free, greater counts as difficult', () => {
  assert.equal(cost([D], { ignoreDifficult: true }).extra, 0);
  assert.equal(cost([G], { ignoreDifficult: true }).extra, 1);
  assert.equal(cost([D], { ignoreDifficult: { causes: ['rubble'] } }).extra, 0, 'skitters over rubble');
  assert.equal(cost([G], { ignoreDifficult: { causes: ['rubble'] } }).extra, 2, 'but not mud');
  assert.equal(cost([{ ...D, magical: true }], { ignoreDifficult: { natural: true } }).extra, 1, 'natural only');
});

test('flying passes over ordinary ground terrain but not magical areas', () => {
  assert.equal(cost([G], { flying: true }).extra, 0);
  assert.equal(cost([{ ...D, magical: true }], { flying: true }).extra, 1);
});

test('climb and swim need their action unless the creature has the speed', () => {
  const pit = { id: 'p', kind: 'climb', dc: 12, label: 'A sinkhole' };
  const r = cost([pit]);
  assert.equal(r.blocked, true);
  assert.deepEqual(r.notes, ['Climb DC 12 (A sinkhole)']);
  assert.equal(cost([pit], { speeds: { land: 25, climb: 20 } }).blocked, false);
  assert.equal(cost([{ id: 'w', kind: 'swim' }], { speeds: { swim: 20 } }).blocked, false);
});

test('uneven ground and hazards add notes, not cost', () => {
  const r = cost([{ id: 'u', kind: 'uneven', dc: 11 }, { id: 'h', kind: 'hazardous', damage: '1d6 fire' }]);
  assert.equal(r.extra, 0);
  assert.deepEqual(r.notes, ['Balance (Acrobatics) DC 11', 'Hazardous: 1d6 fire']);
});

test('no Step into difficult terrain', () => {
  assert.equal(canStepInto([D]), false);
  assert.equal(canStepInto([{ id: 'u', kind: 'uneven' }]), true);
  assert.equal(canStepInto([D], { ignoreDifficult: true }), true);
});

// ---- movement through terrain ----

const strip = new TerrainMap([{ id: 'r', kind: 'difficult', rects: [[5, 0, 1, 20]] }]);   // a column of rubble at x = 5
const med = { x: 2, y: 5, size: 1 };
const withTerrain = (terrain, mover = {}) => ({ enterCost: terrainEnterCost(terrain, terrainRules, mover) });

test('crossing a band of difficult terrain costs 5 ft more', () => {
  const r = path(open, med, 8, 5, withTerrain(strip));
  assert.equal(r.feet, 35);              // 6 squares + 1 difficult
  assert.equal(path(open, med, 8, 5).feet, 30);
});

test('a diagonal into difficult terrain: 5-10-5 underneath, +5 on top', () => {
  const t = new TerrainMap([{ id: 'r', kind: 'difficult', rects: [[0, 0, 20, 20]] }]);
  const r = routeCost(open, { x: 0, y: 0 }, [[0, 0], [1, 1], [2, 2], [3, 3]], withTerrain(t));
  assert.deepEqual(r.steps.map((s) => s.feet), [10, 15, 10]);
});

test('the route goes round greater difficult terrain when that is cheaper', () => {
  const t = new TerrainMap([{ id: 'm', kind: 'greater_difficult', cells: [[5, 5]] }]);   // one square of mud
  const r = path(open, med, 8, 5, withTerrain(t));
  assert.ok(!r.path.some(([x, y]) => x === 5 && y === 5), 'avoids the mud');
  assert.equal(r.feet, 35);                // through it would be 30 + 10
});

test('reach shrinks in difficult terrain', () => {
  const all = new TerrainMap([{ id: 'r', kind: 'difficult', rects: [[0, 0, 20, 20]] }]);
  const cells = reach(open, { x: 10, y: 10 }, 25, withTerrain(all));
  const far = Math.max(...cells.map((c) => Math.abs(c.x - 10)));
  assert.equal(far, 2);                   // 10 ft per square: two squares, not five
});

test('deep water is routed round; a swimmer goes straight across', () => {
  const water = new TerrainMap([{ id: 'w', kind: 'swim', rects: [[5, 0, 1, 19]] }]);   // gap at y = 19
  const walker = path(open, med, 8, 5, withTerrain(water));
  assert.ok(walker.path.some(([, y]) => y === 19), 'walks round through the gap');
  const swimmer = path(open, med, 8, 5, withTerrain(water, { speeds: { land: 25, swim: 25 } }));
  assert.equal(swimmer.feet, 30);
  const notes = routeTerrain(water, terrainRules, {}, [[4, 5], [5, 5], [6, 5]]);
  assert.equal(notes[0].blocked, true);
  assert.deepEqual(notes[0].notes, ['Swim']);
});

test('routeCost flags steps that are not legal moves, without refusing them', () => {
  const r = routeCost(open, { x: 0, y: 0 }, [[0, 0], [2, 0]]);
  assert.equal(r.legal, false);
  assert.equal(r.steps[0].legal, false);
});

// ---- measurement ----

test('grid distance: 5-10-5 diagonals', () => {
  assert.equal(gridDistance(3, 0), 3);
  assert.equal(gridDistance(1, 1), 1);
  assert.equal(gridDistance(2, 2), 3);
  assert.equal(gridDistance(3, 3), 4);
  assert.equal(gridDistance(4, 1), 4);
  assert.equal(gridDistance(2, 2, [1]), 2, 'one-cost diagonals');
});

test('a ruler through waypoints carries the diagonal pattern on', () => {
  const r = rulerLength([[0, 0], [1, 1], [2, 2]]);
  assert.deepEqual(r.legs, [1, 2]);
  assert.equal(r.cells, gridDistance(2, 2));
});

test('distance between spaces counts to the nearest square', () => {
  assert.equal(spaceDistance({ x: 0, y: 0 }, { x: 1, y: 0 }), 1, 'adjacent: 5 ft');
  assert.equal(spaceDistance({ x: 0, y: 0 }, { x: 1, y: 1 }), 1, 'diagonally adjacent: 5 ft');
  assert.equal(spaceDistance({ x: 0, y: 0 }, { x: 2, y: 2 }), 3, 'two diagonals: 15 ft');
  assert.equal(spaceDistance({ x: 0, y: 0, size: 2 }, { x: 3, y: 0 }), 2, 'Large to Medium: one square between');
  assert.equal(spaceDistance({ x: 0, y: 0, size: 3 }, { x: 1, y: 1 }), 0, 'sharing a space');
});

test('an area that starts switched off applies only once the save switches it on', () => {
  const pack = [{ id: 'pier', kind: 'greater_difficult', active: false, cells: [[4, 4]] }];
  assert.deepEqual(new TerrainMap(pack, {}).at(4, 4), []);
  assert.equal(new TerrainMap(pack, { terrain_on: ['pier'] }).at(4, 4)[0].id, 'pier');
  assert.deepEqual(new TerrainMap(pack, { terrain_on: ['pier'], terrain_off: ['pier'] }).at(4, 4), [], 'off wins');
});

test('routeCost keeps a finite total when a step cannot be walked', () => {
  const t = new TerrainMap([{ id: 'deep', kind: 'swim', cells: [[3, 0]] }]);
  const enterCost = terrainEnterCost(t, terrainRules, {});
  const r = routeCost(open, { x: 1, y: 0, size: 1 }, [[1, 0], [2, 0], [3, 0], [4, 0]], { enterCost });
  assert.equal(r.legal, false);
  assert.equal(r.feet, 15);
  assert.equal(r.steps[1].legal, false);
});
