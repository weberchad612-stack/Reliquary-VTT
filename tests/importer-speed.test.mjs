// The map importer's step cache and one-room rebuild (tools/mapimport/cache.py, build.py --room). Python with
// numpy and OpenCV; skipped where they are not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const PY = process.platform === 'win32' ? 'python' : 'python3';
const hasCv = spawnSync(PY, ['-c', 'import cv2, numpy, PIL'], { encoding: 'utf8' }).status === 0;

test('map importer: cached steps rerun only when their inputs change; one room rebuilds alone', { skip: !hasCv && 'no Python with OpenCV' }, () => {
  const r = spawnSync(PY, ['tests/py/import_speed.py'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ok/);
});
