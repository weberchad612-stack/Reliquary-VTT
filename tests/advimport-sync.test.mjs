// Syncing a private pack to the user's PC (tools/advimport/sync.mjs): only what changed, never over the user's edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { plan, APPLY } from '../tools/advimport/sync.mjs';

test('sync: sends changed files with what was last sent, and lists files that are gone', () => {
  const p = plan(['a', 'b', 'c'], { a: '1', b: '2', c: '3' }, { a: '1', b: '0', d: '4' });
  assert.deepEqual(p.send, [{ file: 'b', md5: '2', prev: '0' }, { file: 'c', md5: '3', prev: null }]);
  assert.deepEqual(p.gone, ['d']);
  assert.equal(plan(['a'], { a: '1' }, { a: '1' }, true).send.length, 1, '--all sends everything');
});

test('sync: apply.sh writes unchanged files, keeps the user\'s edits, backs up first-time overwrites', { skip: spawnSync('python3', ['-V']).status !== 0 && 'no python3' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'));
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'src-'));
  const put = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
  const md5 = (t) => require_md5(t);
  put(root, 'p/same.json', 'old'); put(root, 'p/edited.json', 'user edit'); put(root, 'p/first.json', 'pc only'); put(root, 'p/gone.json', 'x');
  for (const [f, t] of [['p/same.json', 'new'], ['p/edited.json', 'new'], ['p/first.json', 'new'], ['p/added.json', 'new']]) put(src, f, t);
  const tgz = path.join(os.tmpdir(), 'x.tgz');
  spawnSync('tar', ['czf', tgz, '-C', src, 'p']);
  const here = path.join(root, '_sync', 'S1');
  fs.mkdirSync(here, { recursive: true });
  fs.copyFileSync(tgz, path.join(here, 'sync.tgz.part00'));
  fs.writeFileSync(path.join(here, 'manifest.json'), JSON.stringify({ pack: 'p', stamp: 'S1', md5: md5(fs.readFileSync(tgz)), gone: ['p/gone.json'], send: [
    { file: 'p/same.json', md5: md5('new'), prev: md5('old') },
    { file: 'p/edited.json', md5: md5('new'), prev: md5('old') },
    { file: 'p/first.json', md5: md5('new'), prev: null },
    { file: 'p/added.json', md5: md5('new'), prev: null }] }));
  fs.writeFileSync(path.join(here, 'apply.sh'), APPLY);
  const r = spawnSync('bash', [path.join(here, 'apply.sh'), root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  assert.equal(read('p/same.json'), 'new');
  assert.equal(read('p/edited.json'), 'user edit', 'changed on the PC since the last sync: kept');
  assert.equal(read('p/first.json'), 'new');
  assert.equal(read('_to_delete/S1/replaced/p/first.json'), 'pc only', 'the PC copy is kept before a first overwrite');
  assert.equal(read('p/added.json'), 'new');
  assert.ok(!fs.existsSync(path.join(root, 'p/gone.json')) && fs.existsSync(path.join(root, '_to_delete/S1/p/gone.json')));
  assert.match(r.stdout, /KEPT p\/edited\.json/);
  assert.equal(read('_to_delete/sync-S1/incoming/p/edited.json'), 'new', 'the new copy waits beside it');
});

import crypto from 'node:crypto';
function require_md5(t) { return crypto.createHash('md5').update(t).digest('hex'); }

test('sync: files left out (caches, working candidates) are never treated as gone', () => {
  const p = plan(['p/a'], { 'p/a': '1' }, { 'p/a': '1', 'p/art/candidates/x.png': '9', 'p/maps/m/.cache/detect.pkl': '8' });
  assert.deepEqual(p.gone, []);
});
