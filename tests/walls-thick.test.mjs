// Wall thickness (walls.json `w`; engine/sight/visibility.js), the 1/32 snap, the straight-wall tools
// (tools/mapimport/lines.py: grid lines, proposals, merging, door gaps, squaring, welding), art-style profiles and
// the map check (tools/mapcheck.mjs). Python parts are skipped where Python with OpenCV is not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepare, visPolygon, canSee, wallBox, farFace, pointInPolygon } from '../engine/sight/visibility.js';
import { prepareMove, path as findPath } from '../engine/movement/movement.js';
import { onSnap, FINE_SNAP } from '../engine/walls/presets.js';
import { checkMap } from '../tools/mapcheck.mjs';

const PY = process.platform === 'win32' ? 'python' : 'python3';
const hasCv = spawnSync(PY, ['-c', 'import cv2, numpy'], { encoding: 'utf8' }).status === 0;
const grid = { cols: 10, rows: 10 };

test('thick walls: the box is squared off past the ends; the far face is the one away from the viewer', () => {
  const box = wallBox([2, 5], [8, 5], 0.2);
  const ys = box.flatMap(([a, b]) => [a[1], b[1]]), xs = box.flatMap(([a, b]) => [a[0], b[0]]);
  assert.deepEqual([Math.min(...ys), Math.max(...ys), Math.min(...xs), Math.max(...xs)].map((v) => +v.toFixed(6)), [4.9, 5.1, 1.9, 8.1]);
  const above = farFace([2, 5], [8, 5], 0.2, [5, 2]), below = farFace([2, 5], [8, 5], 0.2, [5, 8]);
  assert.equal(+above[0][1].toFixed(6), 5.1);
  assert.equal(+below[0][1].toFixed(6), 4.9);
});

test('thick walls: solid through, sight sees to the far face, light and movement stop at the faces', () => {
  const segs = [{ id: 'w1', t: 'solid', a: [0, 5], b: [10, 5], w: 0.25 }];
  const sight = prepare(segs, {}, 'sight');
  assert.equal(sight.length, 1, 'one entry for sight, resolved per viewer');
  assert.equal(prepare(segs, {}, 'light').length, 4, 'four faces for light');
  assert.equal(canSee([5, 2], [5, 8], sight, { feetPerCell: 5 }), false, 'nothing through it');
  const poly = visPolygon([5, 2], sight, { grid, feetPerCell: 5 });
  assert.ok(pointInPolygon([5, 5.1], poly), 'the wall itself is seen to its far face (the fog shows the whole drawn wall)');
  assert.ok(!pointInPolygon([5, 5.2], poly), 'but nothing beyond it');
  const pm = prepareMove(segs, {}, grid);
  assert.equal(findPath(pm, { x: 4, y: 2, size: 1 }, 4, 7), null, 'no way through');
});

test('thick walls: two walls meeting at their centre lines leave no gap at the corner, and a door beside a wall end holds', () => {
  // an L: walls meet at (5, 5); a viewer inside the corner cannot see out through it from any angle
  const segs = [{ id: 'h', t: 'solid', a: [1, 5], b: [5, 5], w: 0.2 }, { id: 'v', t: 'solid', a: [5, 1], b: [5, 5], w: 0.2 }];
  const sight = prepare(segs, {}, 'sight');
  for (let a = 0; a < 90; a += 0.5) {
    const r = (a * Math.PI) / 180, to = [4 + Math.cos(r) * 4, 4 + Math.sin(r) * 4];
    if (to[0] > 5.2 && to[1] > 5.2) assert.equal(canSee([4, 4], to, sight), false, `angle ${a}`);
  }
  // a thick wall ending where a closed door begins: a slanting ray past the joint is stopped (the end cap)
  const door = [{ id: 'w', t: 'solid', a: [9.03, 21], b: [9.03, 23], w: 0.17 }, { id: 'd', t: 'door', a: [9.03, 23], b: [9.03, 25], door: { id: 'd1' } }, { id: 'w2', t: 'solid', a: [9.03, 25], b: [9.03, 28], w: 0.17 }];
  const s2 = prepare(door, {}, 'sight');
  for (let y = 22.8; y < 23.3; y += 0.01) assert.equal(canSee([10, 26.5], [7, y], s2), false, `through the joint at ${y.toFixed(2)}`);
});

test('the 1/32 snap: files say their snap; the validator reads it', () => {
  assert.equal(FINE_SNAP, 1 / 32);
  assert.ok(onSnap(2.03125, FINE_SNAP) && !onSnap(2.03125));
  const s = JSON.parse(fs.readFileSync('schemas/walls.schema.json', 'utf8'));
  assert.deepEqual(s.properties.snap.enum, [0.125, 0.03125]);
  assert.ok(s.$defs.seg.properties.w);
});

test('map check: leaks against the room table, expected routes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-'));
  const box = (x0, y0, x1, y1, id) => [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]].map(([a, b], i) => ({ id: `${id}${i}`, t: 'solid', a, b }));
  const segs = [...box(0, 0, 4, 4, 'a'), ...box(4, 0, 8, 4, 'b').filter((s) => s.id !== 'b3'), { id: 'd', t: 'door', a: [4, 1], b: [4, 2], door: { id: 'd1' } }];
  // the shared wall x=4 is a's east side; b's west side (b3) is the same line, left out; a gap at 3..4 lets sight through
  segs.splice(segs.findIndex((s) => s.id === 'a1'), 1, { id: 'a1x', t: 'solid', a: [4, 0], b: [4, 1] }, { id: 'a1y', t: 'solid', a: [4, 2], b: [4, 3] });
  fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify({ id: 'm', grid: { cols: 8, rows: 4, feet_per_cell: 5 }, walls: 'walls.json' }));
  fs.writeFileSync(path.join(dir, 'walls.json'), JSON.stringify({ v: 1, unit: 'cell', snap: 0.125, segs }));
  fs.writeFileSync(path.join(dir, 'rooms.json'), JSON.stringify({ v: 1, rooms: { A: { at: [1.5, 1.5], rects: [[0, 0, 4, 4]] }, B: { at: [6.5, 1.5], rects: [[4, 0, 4, 4]] } } }));
  fs.writeFileSync(path.join(dir, 'import.json'), JSON.stringify({ checks: { routes: [{ from: [1, 1], to: [6, 1] }, { from: [1, 3], to: [6, 3], blocked: false }] } }));
  const r = checkMap(dir);
  assert.equal(r.ok, false);
  assert.ok(r.leaks.some((l) => l.room === 'A'), 'A sees into B through the gap');
  assert.ok(r.routes.every((x) => x.ok), 'both routes walk (one through the door, one through the gap)');
  fs.writeFileSync(path.join(dir, 'import.json'), JSON.stringify({ checks: { sees: { A: ['B'], B: ['A'] }, routes: [{ from: [1, 1], to: [6, 1] }] } }));
  assert.equal(checkMap(dir).ok, true, 'a view the room may have is not a leak');
});

test('straight walls: grid lines go, walls stay with their thickness; doors split them; ends weld; slants square up', { skip: !hasCv && 'Python with OpenCV not installed' }, () => {
  const py = `
import sys, json; sys.path.insert(0, 'tools')
import numpy as np
from mapimport import lines as L
cs = 50; g = {"cell_px": cs, "origin_px": [0, 0], "cols": 8, "rows": 8}
m = np.zeros((400, 400), bool)
for k in range(9):                                   # a thin grid
    m[:, k * cs:k * cs + 1] = True; m[k * cs:k * cs + 1, :] = True
m[98:104, 50:350] = True                             # a wall on the grid line y = 2 (6 px thick)
m[200:205, 100:300] = True                           # a wall off the grid, y = 4.05
m[206:208, 100:300] = True                           # ... drawn with two edges (a trim): one wall
m2, n = L.suppress_grid(m, g)
found = L.consolidate(L.find_lines(m2, g))
hs = sorted([round(x["c"], 2), round(x["w"], 2), round(x["lo"], 1), round(x["hi"], 1)] for x in found if x["axis"] == "h")
cut = L.cut_openings([x for x in found if x["axis"] == "h" and abs(x["c"] - 2) < 0.2], [{"a": [3, 2.02], "b": [4, 2.02]}])
segs = L.to_segments(cut) + [{"t": "solid", "a": [7.05, 2.03], "b": [7.06, 5.0]}]
sq = L.square_up(segs[-1:])
w = L.weld(segs, 0.1, 1 / 32)
print(json.dumps({"cleared": n > 0, "hs": hs, "pieces": [[round(c["lo"], 1), round(c["hi"], 1)] for c in cut], "squared": sq, "last": segs[-1], "first": segs[0]}))
`;
  const r = spawnSync(PY, ['-c', py], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.ok(o.cleared);
  assert.equal(o.hs.length, 2, `two walls, no grid lines: ${JSON.stringify(o.hs)}`);
  assert.ok(Math.abs(o.hs[0][0] - 2.02) < 0.04 && o.hs[0][1] > 0.08 && o.hs[0][1] < 0.16, `on-grid wall: ${o.hs[0]}`);
  assert.ok(Math.abs(o.hs[1][0] - 4.08) < 0.05 && o.hs[1][1] > 0.12, `two-edged wall merged: ${o.hs[1]}`);
  assert.deepEqual(o.pieces, [[1, 3], [4, 7]], 'the door splits its wall');
  assert.equal(o.squared, 1);
  assert.equal(o.last.a[0], o.last.b[0], 'squared up');
  assert.ok(o.first.w > 0 && o.first.a.every((v) => Number.isInteger(v * 32)), 'thickness kept; on the 1/32 grid');
});

test('profiles: named settings under the map\'s own', { skip: !hasCv && 'Python with OpenCV not installed' }, () => {
  const r = spawnSync(PY, ['-c', `
import sys, json; sys.path.insert(0, 'tools')
from mapimport.build import with_profile
c = with_profile({"profile": "thin-lines-grey-stone", "mask": {"exclude": [1]}, "snap": 0.125})
print(json.dumps({"snap": c["snap"], "max": c["mask"]["max_value"], "ex": c["mask"]["exclude"], "lines": c["lines"]["auto"]}))
`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()), { snap: 0.125, max: 32, ex: [1], lines: true });
});
