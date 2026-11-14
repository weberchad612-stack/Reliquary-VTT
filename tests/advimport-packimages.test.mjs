// Art sources kept small (tools/advimport/packimages.py): PNG to lossless WebP, the same pixels, art.json repointed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PY = process.platform === 'win32' ? 'python' : 'python3';
const ready = spawnSync(PY, ['-c', 'import PIL'], { encoding: 'utf8' }).status === 0;

test('packimages: PNG sources become lossless WebP with the same pixels, and art.json follows', { skip: !ready && 'needs Pillow' }, () => {
  const pack = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-'));
  fs.mkdirSync(path.join(pack, 'art', 'book'), { recursive: true });
  const make = `from PIL import Image
im = Image.new("RGBA", (40, 30))
im.putdata([((x * 7) % 256, (y * 11) % 256, (x * y) % 256, 255 if x % 3 else 128) for y in range(30) for x in range(40)])
im.save("${path.join(pack, 'art', 'book', 'p5-x9.png').replace(/\\/g, '/')}")`;
  assert.equal(spawnSync(PY, ['-c', make]).status, 0);
  fs.writeFileSync(path.join(pack, 'art', 'art.json'), JSON.stringify({ wolf: { src: 'book/p5-x9.png', crop: 'face' } }));
  fs.writeFileSync(path.join(pack, 'pipeline.json'), JSON.stringify({ steps: [{ id: 'art', inputs: ['{pack}/art/book/*.png'] }] }));
  assert.equal(spawnSync(PY, ['tools/advimport/packimages.py', pack, '--check']).status, 1, 'something to convert');
  const r = spawnSync(PY, ['tools/advimport/packimages.py', pack], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(pack, 'art', 'book', 'p5-x9.png')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(pack, 'art', 'art.json'), 'utf8')).wolf.src, 'book/p5-x9.webp');
  assert.match(fs.readFileSync(path.join(pack, 'pipeline.json'), 'utf8'), /art\/book\/\*"/);
  const same = `from PIL import Image
a = Image.open("${path.join(pack, 'art', 'book', 'p5-x9.webp').replace(/\\/g, '/')}").convert("RGBA")
print(a.getpixel((4, 2)), a.getpixel((3, 5)))`;
  assert.equal(spawnSync(PY, ['-c', same], { encoding: 'utf8' }).stdout.trim(), '(28, 22, 8, 255) (21, 55, 15, 128)');
  assert.equal(spawnSync(PY, ['tools/advimport/packimages.py', pack, '--check']).status, 0, 'nothing left');
});
