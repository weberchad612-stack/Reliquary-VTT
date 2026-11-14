// The map check's own checks (#17, #18): doors walked through from both sides, rooms reached from the start, and what
// a leak went through; and room shapes against the book's crops (tools/advimport/cropcheck.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkMap } from '../tools/mapcheck.mjs';
import { footprint, outside } from '../tools/advimport/cropcheck.mjs';

function mapDir({ segs, rooms, checks = {}, start = [[1, 1]] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-'));
  fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify({ id: 'm', name: 'M', image: { file: 'x.webp', w: 600, h: 300 }, grid: { cell_px: 50, origin_px: [0, 0], cols: 12, rows: 6, feet_per_cell: 5 }, walls: 'walls.json', start }));
  fs.writeFileSync(path.join(dir, 'walls.json'), JSON.stringify({ v: 1, unit: 'cell', snap: 0.125, segs }));
  fs.writeFileSync(path.join(dir, 'rooms.json'), JSON.stringify({ v: 1, rooms }));
  fs.writeFileSync(path.join(dir, 'import.json'), JSON.stringify({ checks }));
  return dir;
}
const box = (x0, x1, id) => [
  { id: `${id}n`, t: 'solid', a: [x0, 0], b: [x1, 0] }, { id: `${id}s`, t: 'solid', a: [x0, 6], b: [x1, 6] }];

test('map check: every door from both sides, rooms reached from the start, explained exceptions', () => {
  const segs = [...box(0, 12, 'o'), { id: 'w', t: 'solid', a: [0, 0], b: [0, 6] }, { id: 'e', t: 'solid', a: [12, 0], b: [12, 6] },
    { id: 'm1', t: 'solid', a: [6, 0], b: [6, 2] }, { id: 'm2', t: 'solid', a: [6, 3], b: [6, 6] },
    { id: 'door01', t: 'door', a: [6, 2], b: [6, 3], door: { id: 'd01' } }];
  const rooms = { R1: { at: [2, 3], rects: [[0, 0, 6, 6]] }, R2: { at: [9, 3], rects: [[6, 0, 6, 6]] } };
  let r = checkMap(mapDir({ segs, rooms }));
  assert.equal(r.doors.length, 1);
  assert.ok(r.doors[0].ok && r.unreached.length === 0, JSON.stringify(r));
  // the door shut for good (blocked): R2 is out of reach unless explained
  const shut = segs.map((s) => (s.door ? { ...s, door: { ...s.door, blocked: 'rubble' } } : s));
  r = checkMap(mapDir({ segs: shut, rooms }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.unreached.map((u) => u.room), ['R2']);
  r = checkMap(mapDir({ segs: shut, rooms, checks: { unreached: { R2: 'by the lift' } } }));
  assert.equal(r.unreached[0].ok, true);
});

test('map check: a leak says what the sight went through', () => {
  const segs = [...box(0, 12, 'o'), { id: 'w', t: 'solid', a: [0, 0], b: [0, 6] }, { id: 'e', t: 'solid', a: [12, 0], b: [12, 6] },
    { id: 'm1', t: 'solid', a: [6, 0], b: [6, 2] }, { id: 'win01', t: 'window', a: [6, 2], b: [6, 3] }, { id: 'm2', t: 'solid', a: [6, 4], b: [6, 6] }];
  const rooms = { R1: { at: [2, 2.5], rects: [[0, 0, 6, 6]] }, R2: { at: [9, 2.5], rects: [[6, 0, 6, 6]] } };
  const r = checkMap(mapDir({ segs, rooms }));
  const why = r.leaks.find((l) => l.room === 'R1').why.join(' | ');
  assert.match(why, /through window win01/);
  assert.match(why, /through a gap in the walls at 6\.\d,3\.\d/, 'the gap between y 3 and 4');
});

test('crop check: a crop\'s footprint in squares, and room squares outside it', () => {
  const crop = { transform: [[1, 0, 100], [0, 1, 50]], crop: { px: [200, 100] } };
  const level = { grid: { cell_px: 50, origin_px: [0, 0] } };
  assert.deepEqual(footprint(crop, level), [2, 1, 6, 3]);
  assert.deepEqual(outside([[2, 1, 4, 2]], [2, 1, 6, 3]), []);
  assert.deepEqual(outside([[2, 1, 6, 1]], [2, 1, 6, 3], 1), [[7, 1]], 'one square of slack, then outside');
});

test('map check: a route may walk with every door closed', () => {
  const segs = [...box(0, 12, 'o'), { id: 'w', t: 'solid', a: [0, 0], b: [0, 6] }, { id: 'e', t: 'solid', a: [12, 0], b: [12, 6] },
    { id: 'm1', t: 'solid', a: [6, 0], b: [6, 2] }, { id: 'm2', t: 'solid', a: [6, 3], b: [6, 6] }, { id: 'door01', t: 'door', a: [6, 2], b: [6, 3], door: { id: 'd01' } }];
  const rooms = { R1: { at: [2, 3], rects: [[0, 0, 6, 6]] }, R2: { at: [9, 3], rects: [[6, 0, 6, 6]] } };
  const r = checkMap(mapDir({ segs, rooms, checks: { routes: [{ from: [2, 2], to: [9, 2] }, { from: [2, 2], to: [9, 2], doors: 'closed', blocked: true }] } }));
  assert.deepEqual(r.routes.map((x) => [x.doors, x.ok]), [['open', true], ['closed', true]]);
});
