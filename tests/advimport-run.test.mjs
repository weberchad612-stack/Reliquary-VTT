// The one import command (tools/advimport/run.mjs): which steps are out of date, and the standard pipeline.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stepState, expandSteps, standardPipeline } from '../tools/advimport/run.mjs';

test('import pipeline: a step is out of date when it changed, an output is missing or an input is newer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-'));
  const inp = path.join(dir, 'in.txt'), out = path.join(dir, 'out.txt');
  fs.writeFileSync(inp, 'a');
  const step = { id: 's', run: ['true'], inputs: [inp], outputs: [out], review: false, hash: 'h1' };
  assert.equal(stepState(step, undefined).state, 'new');
  const at = Date.now() + 5000;   // ran after the input was written
  assert.match(stepState(step, { hash: 'h1', at, status: 'ok' }).why, /missing/);
  fs.writeFileSync(out, 'b');
  assert.equal(stepState(step, { hash: 'h1', at, status: 'ok' }).state, 'ok');
  assert.equal(stepState(step, { hash: 'h0', at, status: 'ok' }).why, 'the step changed');
  assert.match(stepState(step, { hash: 'h1', at: at - 60000, status: 'ok' }).why, /in\.txt changed/);
  assert.equal(stepState({ ...step, review: true }, { hash: 'h1', at, status: 'ok' }).state, 'review');
  assert.equal(stepState({ ...step, review: true }, { hash: 'h1', at, status: 'ok', approved: true }).state, 'ok');
  assert.equal(stepState(step, { hash: 'h1', at, status: 'failed', error: 'boom' }).why, 'boom');
});

test('import pipeline: an input the step wrote itself does not make it out of date; a later change does', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-'));
  const inp = path.join(dir, 'walls.json');
  fs.writeFileSync(inp, '{}');
  const t = fs.statSync(inp).mtimeMs;
  const step = { id: 'dcfill', run: ['true'], inputs: [inp], outputs: [], review: false, hash: 'h' };
  const rec = { hash: 'h', at: t - 5000, status: 'ok', seen: { [inp]: t } };
  assert.equal(stepState(step, rec).state, 'ok');
  fs.utimesSync(inp, new Date(), new Date(t + 10000));
  assert.match(stepState(step, rec).why, /walls\.json changed/);
});

test('import pipeline: map steps run once per map that has import settings; vars are filled in', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-'));
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ id: 'demo', maps: ['landing', 'one', 'two'] }));
  for (const m of ['one', 'two']) { fs.mkdirSync(path.join(dir, 'maps', m), { recursive: true }); fs.writeFileSync(path.join(dir, 'maps', m, 'import.json'), '{}'); }
  const p = standardPipeline('demo');
  p.vars.book = 'pdfsource/demo.pdf';
  const steps = expandSteps(dir, p);
  assert.deepEqual(steps.filter((s) => s.base === 'map').map((s) => s.id), ['map:one', 'map:two']);
  const text = steps.find((s) => s.id === 'text');
  assert.match(text.run[0], /pagetext\.mjs pdfsource\/demo\.pdf extracted\/demo\/text/);
  assert.ok(steps.find((s) => s.id === 'campaign').run[0].includes('--update'), 'a campaign is refreshed, never wiped');
  assert.ok(steps.find((s) => s.id === 'landing'), 'the landing page is a step');
});
