// tools/mapimport/strip_numbers.py on the Sample Village (original art, numbers printed in discs).
// Skipped where Python with OpenCV is not installed (the importer's requirements).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PY = process.platform === 'win32' ? 'python' : 'python3';
const hasCv = spawnSync(PY, ['-c', 'import cv2, numpy'], { encoding: 'utf8' }).status === 0;

test('strip numbers: finds every printed marker, leaves the original alone, writes a check sheet', { skip: !hasCv && 'Python with OpenCV not installed' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strip-'));
  fs.cpSync('examples/sample-pack/maps/sample-village', path.join(dir, 'v'), { recursive: true });
  const img = path.join(dir, 'v', 'sample-village.webp');
  const before = fs.readFileSync(img);
  const r = spawnSync(PY, ['tools/mapimport/strip_numbers.py', path.join(dir, 'v')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(Object.keys(out.stripped).sort(), ['1', '2', '3', '4', '5'], 'only places with a printed number');
  assert.deepEqual(out.not_found, []);
  for (const k of ['out', 'mask', 'sheet']) assert.ok(fs.existsSync(out[k]), k);
  assert.ok(fs.readFileSync(img).equals(before), 'the original image is unchanged');
  // --only picks places by number; a place with nothing printed near it is reported, with exit code 1
  const one = spawnSync(PY, ['tools/mapimport/strip_numbers.py', path.join(dir, 'v'), '--only', '3,cellar'], { encoding: 'utf8' });
  assert.equal(one.status, 1);
  const o = JSON.parse(one.stdout.trim().split('\n').pop());
  assert.deepEqual(Object.keys(o.stripped), ['3']);
  assert.deepEqual(o.not_found, ['cellar']);
});
