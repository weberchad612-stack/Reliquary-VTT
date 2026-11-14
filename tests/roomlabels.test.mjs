// Rooms from a map's printed labels (tools/advimport/maplabels.py) and open areas (roomtable.py --max-cells).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PY = process.platform === 'win32' ? 'python' : 'python3';
const ready = spawnSync(PY, ['-c', 'import PIL, numpy, cv2'], { encoding: 'utf8' }).status === 0;

test('map labels: a label\'s pixel goes through crop, scale and rotation exactly as the image does', { skip: !ready && 'needs Pillow, numpy and OpenCV' }, () => {
  const py = `
import sys
sys.path.insert(0, "tools")
from PIL import Image
from mapimport import extract
from advimport import maplabels
W, H, P = 60, 40, (13, 7)
bad = []
for src in ({}, {"rotate": 90}, {"rotate": 180}, {"rotate": 270}, {"crop_px": [5, 2, 50, 30], "rotate": 90}, {"crop_px": [5, 2, 50, 30], "scale": 0.5, "rotate": 270}):
    im = Image.new("L", (W, H), 0)
    im.putpixel(P, 255)
    out = extract.crop_scale(im.convert("RGB"), src.get("crop_px"), src.get("scale"), src.get("rotate")).convert("L")
    # where the marked pixel ended up (its brightest point; scaling spreads it)
    px = max(((x, y) for y in range(out.height) for x in range(out.width)), key=lambda p: out.getpixel(p))
    x, y = maplabels.through_source(P[0] + 0.5, P[1] + 0.5, src, (W, H))
    if abs(x - (px[0] + 0.5)) > 1.01 or abs(y - (px[1] + 0.5)) > 1.01:
        bad.append((src, (round(x, 2), round(y, 2)), px))
print("bad", bad)
`;
  const r = spawnSync(PY, ['-c', py], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'bad []');
});

test('room table: a room with no walls round it keeps a box round its label, after the walled rooms', { skip: !ready && 'needs Pillow, numpy and OpenCV' }, () => {
  const pack = fs.mkdtempSync(path.join(os.tmpdir(), 'rooms-'));
  const d = path.join(pack, 'maps', 'town');
  fs.mkdirSync(d, { recursive: true });
  const seg = (id, a, b) => ({ id, a, b, t: 'solid' });
  // a 4 x 4 walled house at 2..6 in a 20 x 20 open town
  const segs = [seg('n', [2, 2], [6, 2]), seg('s', [2, 6], [6, 6]), seg('w', [2, 2], [2, 6]), seg('e', [6, 2], [6, 6])];
  fs.writeFileSync(path.join(d, 'walls.json'), JSON.stringify({ v: 1, unit: 'cell', snap: 0.125, segs }));
  fs.writeFileSync(path.join(d, 'map.json'), JSON.stringify({ walls: 'walls.json', grid: { cell_px: 50, origin_px: [0, 0], cols: 20, rows: 20 } }));
  const spec = path.join(pack, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ town: { H1: { at: [3.5, 3.5], title: 'House' }, Y1: { at: [6.5, 4], title: 'Yard' } } }));
  const r = spawnSync(PY, ['tools/advimport/roomtable.py', pack, spec, '--max-cells', '100'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Y1: open .*4 x 4 box/);
  const rooms = JSON.parse(fs.readFileSync(path.join(d, 'rooms.json'), 'utf8')).rooms;
  const count = (k) => rooms[k].rects.reduce((s, [, , w, h]) => s + w * h, 0);
  assert.equal(count('H1'), 16, 'the house floods to its walls');
  assert.equal(rooms.Y1.open, true);
  assert.equal(count('Y1'), 12, 'the yard\'s box leaves the house\'s squares to the house');
});
