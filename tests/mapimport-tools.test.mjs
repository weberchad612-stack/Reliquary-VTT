// The map importer's helpers: turning a sideways map upright (source.rotate), measuring walls between their outlines
// (tools/mapimport/wallscan.py) and hand-placed straight walls (lines.add with fixed: true).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const PY = process.platform === 'win32' ? 'python' : 'python3';
const ready = spawnSync(PY, ['-c', 'import PIL, numpy, cv2'], { encoding: 'utf8' }).status === 0;

test('map importer helpers: rotate, wallscan, fixed straight walls', { skip: !ready && 'needs Pillow, numpy and OpenCV' }, () => {
  const r = spawnSync(PY, ['tests/py/mapimport_tools.py'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /ok/);
});

test('wallscan --propose: a room drawn with outlined thick walls gives its four walls, outer edge to outer edge', { skip: !ready && 'needs Pillow, numpy and OpenCV' }, () => {
  const py = `
import sys
sys.path.insert(0, "tools")
import numpy as np
from mapimport import wallscan
c = 40
v = np.full((12 * c, 12 * c), 180.0)
def wall(axis, at, lo, hi, w=0.3):
    # two black outlines with a brown fill between (value 90), the art's way of drawing a thick wall
    a0, a1 = int((at - w / 2) * c), int((at + w / 2) * c)
    l0, l1 = int(lo * c), int(hi * c)
    sl = (slice(a0, a1), slice(l0, l1)) if axis == "h" else (slice(l0, l1), slice(a0, a1))
    v[sl] = 90
    for e in (a0, a1 - 2):
        s2 = (slice(e, e + 2), slice(l0, l1)) if axis == "h" else (slice(l0, l1), slice(e, e + 2))
        v[s2] = 5
wall("h", 2, 2, 10); wall("h", 9, 2, 10); wall("v", 2, 2, 9); wall("v", 10, 2, 9)
v[int(5.5 * c):int(5.5 * c) + 2, int(4 * c):int(4.4 * c)] = 5   # a short dark mark: not a wall
props = wallscan.propose(v, {"cell_px": c, "origin_px": [0, 0]})
for p in sorted(props, key=lambda p: (p["axis"], p["at"])):
    print(p["axis"], p["at"], p["w"])
`;
  const r = spawnSync(PY, ['-c', py], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n').map((l) => l.split(' '));
  assert.deepEqual(lines.map((l) => `${l[0]} ${l[1]}`), ['h 2.0', 'h 9.0', 'v 2.0', 'v 10.0']);
  for (const l of lines) assert.ok(Math.abs(Number(l[2]) - 0.3) <= 0.05, `width ${l[2]}`);
});
