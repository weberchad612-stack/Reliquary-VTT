import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armer, ARM_MS } from '../board/ui.js';

const fakeTimers = () => {
  const t = { pending: new Map(), n: 0 };
  t.set = (fn, ms) => { const id = ++t.n; t.pending.set(id, { fn, ms }); return id; };
  t.clear = (id) => t.pending.delete(id);
  t.fire = () => { for (const [id, { fn }] of t.pending) { t.pending.delete(id); fn(); } };
  return t;
};

test('remove buttons: the first press arms, a second removes', () => {
  const timers = fakeTimers(), log = [];
  const a = armer({ onArm: () => log.push('arm'), onDisarm: () => log.push('disarm'), onRemove: () => log.push('remove'), timers });
  assert.equal(a.press(), false);
  assert.ok(a.armed());
  assert.equal([...timers.pending.values()][0].ms, ARM_MS);
  assert.equal(a.press(), true);
  assert.deepEqual(log, ['arm', 'remove']);
  assert.equal(timers.pending.size, 0, 'no stray timer');
});

test('remove buttons: they disarm by themselves after 3 seconds, or when they lose focus', () => {
  const timers = fakeTimers(), log = [];
  const a = armer({ onArm: () => log.push('arm'), onDisarm: () => log.push('disarm'), onRemove: () => log.push('remove'), timers });
  a.press(); timers.fire();
  assert.equal(a.armed(), false);
  a.press(); a.disarm(); a.disarm();
  assert.deepEqual(log, ['arm', 'disarm', 'arm', 'disarm']);
  assert.equal(a.press(), false, 'starts over: arms again');
});
