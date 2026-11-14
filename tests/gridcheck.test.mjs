// Grid sanity (tools/mapimport/grid.py weak and half grids; tools/advimport/gridcheck.mjs across a book's maps).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { clusters, checkGroup, packMaps } from '../tools/advimport/gridcheck.mjs';

const PY = process.platform === 'win32' ? 'python' : 'python3';
const ready = spawnSync(PY, ['-c', 'import PIL, numpy, cv2'], { encoding: 'utf8' }).status === 0;

test('grid check: a map at twice the book\'s usual squares is flagged, with the half grid proposed', () => {
  const maps = [
    { id: 'farm', cell: 44.9 }, { id: 'inn', cell: 44.0 }, { id: 'bridge', cell: 44.93 },
    { id: 'ritual', cell: 89.2, half: { cell_px: 44.6, strength: 1.87 } },
    { id: 'teahouse', cell: 62.9 }, { id: 'town', cell: 22.4 }];
  assert.deepEqual(clusters(maps)[0].map((m) => m.id).sort(), ['bridge', 'farm', 'inn']);
  const flags = checkGroup(maps);
  const ritual = flags.find((f) => f.id === 'ritual');
  assert.match(ritual.why, /about 2x the book's usual 44\.6 px.*every other line/);
  assert.deepEqual(ritual.propose, { cell_px: 44.6, strength: 1.87 });
  assert.match(flags.find((f) => f.id === 'town').why, /about 1\/2/);
  assert.ok(!flags.some((f) => f.id === 'teahouse'), 'another print scale (1.4x) is not a grid error');
  assert.deepEqual(checkGroup(maps.map((m) => (m.id === 'ritual' || m.id === 'town' ? { ...m, checked: 'looked at the print' } : m))), []);
  assert.deepEqual(checkGroup([{ id: 'a', cell: 44 }, { id: 'b', cell: 88 }]), [], 'no usual size from one map each');
  assert.match(checkGroup([{ id: 'a', cell: 44, weak: true, strength: 1.7 }])[0].why, /weak grid/);
});

test('grid check: reads a pack\'s maps by source PDF', () => {
  const pack = fs.mkdtempSync(path.join(os.tmpdir(), 'grid-'));
  const put = (id, imp, mj, rep) => {
    fs.mkdirSync(path.join(pack, 'maps', id), { recursive: true });
    fs.writeFileSync(path.join(pack, 'maps', id, 'import.json'), JSON.stringify(imp));
    fs.writeFileSync(path.join(pack, 'maps', id, 'map.json'), JSON.stringify(mj));
    if (rep) fs.writeFileSync(path.join(pack, 'maps', id, 'import-report.json'), JSON.stringify({ grid: rep }));
  };
  put('a', { source: { pdf: 'book.pdf' }, grid: 'auto' }, { grid: { cell_px: 44 } }, { found: 'auto', strength: 2.5 });
  put('b', { source: { pdf: 'book.pdf' }, grid: 'auto', grid_checked: 'by eye' }, { grid: { cell_px: 88 } }, { found: 'auto', strength: 1.7, weak: true });
  put('c', { source: { pdf: 'maps.pdf' } }, { grid: { cell_px: 30 } });
  const by = packMaps(pack);
  assert.deepEqual(Object.keys(by).sort(), ['book.pdf', 'maps.pdf']);
  assert.equal(by['book.pdf'].find((m) => m.id === 'b').checked, 'by eye');
  assert.equal(by['book.pdf'].find((m) => m.id === 'b').weak, true);
});

test('grid finder: a faint grid is found and marked weak; the half grid is scored', { skip: !ready && 'needs Pillow, numpy and OpenCV' }, () => {
  const py = `
import sys
sys.path.insert(0, "tools")
import numpy as np
from PIL import Image, ImageDraw
from mapimport import grid
def make(shade, cell=40, n=20):
    # a textured ground, like a painted map: on a flat ground any line stands out, however faint
    rng = np.random.default_rng(1)
    a = (200 + rng.normal(0, 20, (cell * n, cell * n))).clip(0, 255).astype(np.uint8)
    im = Image.fromarray(np.stack([a] * 3, -1))
    d = ImageDraw.Draw(im)
    for i in range(n + 1):
        d.line([(i * cell, 0), (i * cell, cell * n)], fill=(shade,) * 3)
        d.line([(0, i * cell), (cell * n, i * cell)], fill=(shade,) * 3)
    return im
clear = grid.calibrate(make(100))
print("clear", clear["cell_px"], clear.get("weak", False), "half" in clear)
faint = grid.calibrate(make(170))
print("faint", faint["cell_px"], faint.get("weak", False))
`;
  const r = spawnSync(PY, ['-c', py], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const [clear, faint] = r.stdout.trim().split('\n');
  assert.match(clear, /^clear (39\.9\d*|40(\.\d+)?) False True$/);
  assert.match(faint, /^faint (39\.9\d*|40(\.\d+)?) True$/);
});
