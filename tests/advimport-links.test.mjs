// Links between levels from the text (tools/advimport/links.mjs). Invented text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAreas } from '../tools/advimport/areas.mjs';
import { waysBetween } from '../tools/advimport/links.mjs';

const idx = { rooms: {
  X1: { map: 'up', at: [1, 1], rects: [[0, 0, 3, 3]] }, X2: { map: 'up', at: [5, 1], rects: [[4, 0, 3, 3]] },
  Y1: { map: 'down', at: [2, 2], rects: [[0, 0, 4, 4]] }, Y2: { map: 'down', at: [6, 2], rects: [[5, 0, 3, 3]] } } };

test('links: stairs naming an area on another level are paired with it', () => {
  const areas = splitAreas([{ page: 1, text: 'X1. Mossy Hall\nA narrow staircase leads down to area Y2.\nX2. Store\nCrates.\nY1. Cellar\nDamp.\nY2. Landing\nThe stairs climb to X1.\n' }]);
  const w = waysBetween(areas, idx, ['down', 'up']);
  assert.deepEqual(w.map((x) => [x.from, x.to, x.kind, x.sure]), [['X1', 'Y2', 'stairs', 'named']], 'one pair, from either end');
});

test('links: a lift up meets a lift down on the next map; without a direction the guesses are weak', () => {
  const areas = splitAreas([{ page: 1, text: 'Y1. Cellar\nA rickety lift rises up to the floor above.\nY2. Landing\nNothing.\nX1. Mossy Hall\nThe lift comes down here.\nX2. Store\nAn old lift, broken.\n' }]);
  const w = waysBetween(areas, idx, ['down', 'up']);
  assert.deepEqual(w.map((x) => [x.from, x.to, x.sure]), [['Y1', 'X1', 'likely']]);
});
