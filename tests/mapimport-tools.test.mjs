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
