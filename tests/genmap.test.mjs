// The battle map generator (tools/genmap/genmap.py): from a spec, original art and map data that agree, valid in a
// pack, the same every time for the same spec.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const PY = process.platform === 'win32' ? 'python' : 'python3';
const hasPil = spawnSync(PY, ['-c', 'import PIL'], { encoding: 'utf8' }).status === 0;

const SPEC = {
  id: 'yard', name: 'A yard', cols: 16, rows: 12, ground: 'dirt', start: [1, 9, 2, 2],
  features: [
    { type: 'path', points: [[0, 10], [8, 6], [8, 3]], width: 2 },
    { type: 'building', id: 'shed', rect: [5, 0, 6, 3], doors: [{ side: 's', at: 2, label: 'Shed door', initial: 'locked' }], windows: [{ side: 'e', at: 1 }] },
    { type: 'low-wall', from: [2, 5], to: [14, 5], gaps: [[7, 9]] },
    { type: 'graves', area: [2, 6, 12, 5], count: 10 },
    { type: 'rock', rects: [[13, 8, 2, 2]] },
    { type: 'water', rects: [[0, 0, 3, 2]], deep: true },
    { type: 'rubble', rects: [[11, 6, 2, 1]] },
    { type: 'hazard', rects: [[4, 9, 1, 1]], label: 'Embers', damage: '1d4 fire on entering' },
    { type: 'trees', at: [[14, 2]] },
    { type: 'fire', at: [4.5, 9.5], label: 'Campfire' },
  ],
};

test('genmap: a spec becomes a valid battle map whose data matches it', { skip: !hasPil && 'needs Pillow' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genmap-'));
  const pack = path.join(dir, 'pack');
  fs.cpSync('examples/sample-pack', pack, { recursive: true });
  fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(SPEC));
  const out = path.join(pack, 'maps', 'yard');
  const r = spawnSync(PY, ['tools/genmap/genmap.py', path.join(dir, 'spec.json'), out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const read = (f) => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'));
  const map = read('map.json'), walls = read('walls.json'), terrain = read('terrain.json'), lighting = read('lighting.json');
  assert.equal(map.kind, 'battle');
  assert.equal(map.outdoor, true);
  assert.deepEqual(map.grid, { cell_px: 70, origin_px: [0, 0], cols: 16, rows: 12, feet_per_cell: 5 });
  assert.deepEqual(map.start, [[1, 9], [2, 9], [1, 10], [2, 10]]);
  const door = walls.segs.find((s) => s.t === 'door');
  assert.deepEqual([door.a, door.b, door.door.initial], [[7, 3], [8, 3], 'locked']);
  assert.ok(walls.segs.some((s) => s.t === 'window' && s.a[0] === 11));
  assert.equal(walls.segs.filter((s) => s.t === 'solid').length, 4 /* shed sides around its openings */ + 2 + 4 /* rock */);
  const kinds = terrain.areas.map((a) => `${a.kind}:${a.cause}`).sort();
  assert.deepEqual(kinds, ['difficult:low-wall', 'difficult:rubble', 'difficult:trees', 'hazardous:hazard', 'swim:water'].sort());
  assert.equal(terrain.areas.find((a) => a.kind === 'hazardous').damage, '1d4 fire on entering', 'a hazard keeps the damage the spec gives');
  assert.deepEqual(terrain.areas.find((a) => a.cause === 'low-wall').rects, [[2, 4, 5, 2], [9, 4, 5, 2]], 'the gap is left open');
  assert.equal(lighting.lights[0].label, 'Campfire');
  assert.deepEqual(read('genmap.json'), SPEC, 'the spec kept beside the map');
  const pj = JSON.parse(fs.readFileSync(path.join(pack, 'pack.json'), 'utf8'));
  pj.maps.push('yard'); fs.writeFileSync(path.join(pack, 'pack.json'), JSON.stringify(pj));
  const v = spawnSync(process.execPath, ['tools/validate.mjs', pack], { encoding: 'utf8' });
  assert.match(v.stdout + v.stderr, /OK: 0 errors/);
  // the same spec, the same picture
  const h = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
  const first = h(path.join(out, 'yard.webp'));
  spawnSync(PY, ['tools/genmap/genmap.py', path.join(dir, 'spec.json'), out], { encoding: 'utf8' });
  assert.equal(h(path.join(out, 'yard.webp')), first);
});
