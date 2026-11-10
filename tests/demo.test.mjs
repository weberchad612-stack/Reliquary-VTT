import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = fs.readFileSync(path.join(ROOT, 'examples', 'demo', 'map-demo.html'), 'utf8');

// The demo is one classic script: a second top-level function with the same name silently replaces
// the first (this once broke the GM vision view when a door helper reused a drawing helper's name).
test('demo: no top-level function or constant is declared twice', () => {
  const names = [...TEMPLATE.matchAll(/^(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual([...new Set(dup)], []);
});

test('demo: every Engine.<name> it uses is exported by the bundled engine', async () => {
  const { bundleEngine } = await import('../tools/bundle.mjs');
  const Engine = new Function(`${bundleEngine()}\nreturn Engine;`)();
  const used = new Set([...TEMPLATE.matchAll(/Engine\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  const missing = [...used].filter((n) => !(n in Engine));
  assert.deepEqual(missing, []);
});

test('bundle: every export of every engine module reaches the bundled Engine', async () => {
  const { bundleEngine, ENTRIES } = await import('../tools/bundle.mjs');
  const Engine = new Function(`${bundleEngine()}\nreturn Engine;`)();
  const missing = [];
  for (const e of ENTRIES) {
    const mod = await import(new URL(`../engine/${e}`, import.meta.url));
    for (const name of Object.keys(mod)) if (!(name in Engine)) missing.push(`${e}: ${name}`);
  }
  assert.deepEqual(missing, []);
});

const BOARD_APP = fs.readFileSync(path.join(ROOT, 'board', 'app.js'), 'utf8');

test('board: no function or constant inside start() is declared twice', () => {
  const names = [...BOARD_APP.matchAll(/^  (?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual([...new Set(dup)], []);
});

test('board: every Engine.<name> it uses is exported, and the board bundles', async () => {
  const { bundleEngine, bundleBoard } = await import('../tools/bundle.mjs');
  const Engine = new Function(`${bundleEngine()}\nreturn Engine;`)();
  const used = new Set([...BOARD_APP.matchAll(/Engine\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  assert.deepEqual([...used].filter((n) => !(n in Engine)), []);
  const Board = new Function(`${bundleEngine()}\n${bundleBoard()}\nreturn Board;`)();
  for (const n of ['boot', 'start', 'MemoryStore', 'platformStore', 'campaignRecords', 'saveFromRecords']) assert.ok(n in Board, n);
});
