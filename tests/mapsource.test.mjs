// What the page says about a map (tools/mapimport/mapsource.py): the turn from the image's placement, the printed scale.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PY = process.platform === 'win32' ? 'python' : 'python3';
const ready = spawnSync(PY, ['-c', 'import PIL, numpy, cv2, pymupdf'], { encoding: 'utf8' }).status === 0
  && spawnSync('pdfimages', ['-v'], { encoding: 'utf8' }).status === 0;

test('map source: a map placed sideways and printed at 10 ft is found and checked against import.json', { skip: !ready && 'needs Pillow, numpy, OpenCV, PyMuPDF and poppler' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-'));
  const pdf = path.join(dir, 'book.pdf').replace(/\\/g, '/');
  const make = `
import pymupdf
from PIL import Image
Image.new("RGB", (300, 200), (120, 160, 90)).save("${dir.replace(/\\/g, '/')}/m.png")
doc = pymupdf.open()
page = doc.new_page()
page.insert_image(pymupdf.Rect(100, 100, 300, 400), filename="${dir.replace(/\\/g, '/')}/m.png", rotate=90)
page.insert_text((100, 450), "1 SQUARE = 10 FEET")
doc.save("${pdf}")
`;
  assert.equal(spawnSync(PY, ['-c', make], { encoding: 'utf8' }).status, 0);
  const r = spawnSync(PY, ['tools/mapimport/mapsource.py', pdf, '1'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const info = JSON.parse(r.stdout.split('\n')[0]);
  assert.equal(info.printed_feet[0], 10);
  assert.ok([90, 270].includes(info.page_turn), `a quarter turn (${info.page_turn})`);
  const md = path.join(dir, 'maps', 'm');
  fs.mkdirSync(md, { recursive: true });
  const imp = { source: { pdf, page: 1, rotate: info.page_turn }, map: { id: 'm', feet_per_cell: 5 } };
  fs.writeFileSync(path.join(md, 'import.json'), JSON.stringify(imp));
  const c1 = spawnSync(PY, ['tools/mapimport/mapsource.py', '--check', md], { encoding: 'utf8' });
  assert.equal(c1.status, 1);
  assert.match(c1.stdout, /printed at 10 ft a square but feet_per_cell is 5/);
  assert.doesNotMatch(c1.stdout, /turns the map/, 'the turn is set');
  fs.writeFileSync(path.join(md, 'import.json'), JSON.stringify({ ...imp, source: { ...imp.source, rotate: 0 }, print: { feet: 10, why: 'on 5-ft squares' } }));
  const c2 = spawnSync(PY, ['tools/mapimport/mapsource.py', '--check', md], { encoding: 'utf8' });
  assert.match(c2.stdout, /turns the map \d+ degrees but source.rotate is 0/);
  assert.doesNotMatch(c2.stdout, /printed at/, 'the print scale is recorded');
});
