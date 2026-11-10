import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animationAt, animationOf, noise, seedOf, MAX_SWING, ANIMATION_TYPES } from '../engine/light/animate.js';

const sample = (a, id, secs = 20, step = 0.05) => {
  const out = [];
  for (let t = 0; t < secs; t += step) out.push(animationAt(a, id, t));
  return out;
};

test('a light with no animation, or an unknown one, stays steady', () => {
  assert.deepEqual(animationAt(null, 'x', 3), { brightness: 1, hue: 0 });
  assert.deepEqual(animationAt({ type: 'none' }, 'x', 3), { brightness: 1, hue: 0 });
  assert.equal(animationOf({ type: 'vortex' }), null);
});

test('settings are filled and kept in range', () => {
  assert.deepEqual(animationOf({ type: 'torch' }), { type: 'torch', speed: 5, intensity: 5, reverse: false });
  assert.deepEqual(animationOf({ type: 'pulse', speed: 40, intensity: 0 }), { type: 'pulse', speed: 10, intensity: 1, reverse: false });
});

test('every brightness animation stays within its swing, and intensity sets the swing', () => {
  for (const type of ['torch', 'flicker', 'pulse', 'ghostly']) {
    for (const intensity of [1, 5, 10]) {
      const b = sample({ type, intensity }, 'lamp-' + type).map((v) => v.brightness);
      const swing = (intensity / 10) * MAX_SWING;
      assert.ok(Math.max(...b) <= 1 + swing + 1e-9 && Math.min(...b) >= 1 - 1.4 * swing - 1e-9, `${type} ${intensity}`);
      assert.ok(Math.max(...b) - Math.min(...b) > swing * 0.5, `${type} ${intensity} actually moves`);
    }
  }
});

test('the same light moves the same way every time; two lights do not move in step', () => {
  const a = sample({ type: 'torch' }, 'torch-1').map((v) => v.brightness);
  assert.deepEqual(a, sample({ type: 'torch' }, 'torch-1').map((v) => v.brightness));
  const b = sample({ type: 'torch' }, 'torch-2').map((v) => v.brightness);
  const same = a.filter((v, i) => Math.abs(v - b[i]) < 1e-3).length;
  assert.ok(same < a.length / 10);
  assert.notEqual(seedOf('torch-1'), seedOf('torch-2'));
});

test('speed makes the motion quicker', () => {
  const moves = (speed) => {
    const b = sample({ type: 'torch', speed }, 'x', 10, 0.02).map((v) => v.brightness);
    let d = 0;
    for (let i = 1; i < b.length; i++) d += Math.abs(b[i] - b[i - 1]);
    return d;
  };
  assert.ok(moves(10) > moves(5) * 1.5 && moves(5) > moves(1) * 1.5);
});

test('pulse breathes once every 4 s at speed 5', () => {
  const b0 = animationAt({ type: 'pulse' }, 'p', 1).brightness, b4 = animationAt({ type: 'pulse' }, 'p', 5).brightness;
  assert.ok(Math.abs(b0 - b4) < 1e-9);
});

test('chroma turns the hue round, the other way when reversed, and leaves brightness alone', () => {
  const f = animationAt({ type: 'chroma' }, 'c', 5), r = animationAt({ type: 'chroma', reverse: true }, 'c', 5);
  assert.equal(f.brightness, 1);
  assert.ok(Math.abs(f.hue - 90) < 1e-6, 'a quarter turn in 5 s at speed 5');
  assert.ok(Math.abs(r.hue - 270) < 1e-6);
});

test('noise is smooth and within -1..1', () => {
  let prev = noise(7, 0);
  for (let x = 0.01; x < 20; x += 0.01) {
    const v = noise(7, x);
    assert.ok(v >= -1 && v <= 1);
    assert.ok(Math.abs(v - prev) < 0.1);
    prev = v;
  }
  assert.ok(Object.keys(ANIMATION_TYPES).includes('ghostly'));
});
