import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformStore } from '../board/platform.js';

/** A stand-in for the platform's db: frozen snapshots, async calls, a flaky first call, write overlap check. */
function fakeDb({ flaky = 0 } = {}) {
  const docs = new Map(), subs = new Set();
  let inFlight = new Map(), overlaps = 0, failures = flaky;
  const snap = (path) => Object.freeze({ id: path.split('/').pop(), exists: docs.has(path), data: () => (docs.has(path) ? Object.freeze(structuredClone(docs.get(path))) : undefined) });
  const notify = () => { for (const s of subs) s(); };
  const write = async (path, fn) => {
    if (failures > 0) { failures--; const e = new Error('try again'); e.code = 'unavailable'; throw e; }
    if (inFlight.get(path)) overlaps++;
    inFlight.set(path, true);
    await new Promise((r) => setTimeout(r, 2));
    fn(); inFlight.set(path, false); notify();
  };
  const db = {
    doc: (path) => ({
      get: async () => snap(path),
      set: (d) => write(path, () => docs.set(path, structuredClone(d))),
      delete: () => write(path, () => docs.delete(path)),
      onSnapshot: (next) => { const f = () => next(snap(path)); subs.add(f); setTimeout(f, 0); return () => subs.delete(f); },
    }),
    collection: (c) => ({
      get: async () => ({ docs: [...docs.keys()].filter((p) => p.startsWith(c + '/')).sort().map(snap) }),
      onSnapshot: (next) => { const f = () => next({ docs: [...docs.keys()].filter((p) => p.startsWith(c + '/')).sort().map(snap) }); subs.add(f); setTimeout(f, 0); return () => subs.delete(f); },
    }),
  };
  return { db, docs, overlaps: () => overlaps };
}

test('platform store: none without the platform', async () => {
  assert.equal(await platformStore(), null);
});

test('platform store: writes to one record never overlap, a transient failure is retried, values are copies', async () => {
  const f = fakeDb({ flaky: 1 });
  globalThis.claude = { use: async (n) => (n === 'db' ? f.db : null) };
  try {
    const s = await platformStore();
    assert.equal(s.kind, 'platform');
    await Promise.all([1, 2, 3, 4, 5].map((x) => s.set('tokens/k', { x })));
    assert.equal(f.overlaps(), 0);
    assert.deepEqual(await s.get('tokens/k'), { x: 5 }, 'last write wins, in order');
    const got = await s.get('tokens/k'); got.x = 99;   // not frozen: a copy
    assert.equal((await s.get('tokens/k')).x, 5);
    await s.update('tokens/k', { y: 1 });
    await s.update('tokens/new', { y: 2 });
    assert.deepEqual(await s.get('tokens/k'), { x: 5, y: 1 });
    assert.deepEqual(await s.get('tokens/new'), { y: 2 }, 'update creates a missing record');
    const seen = [];
    const off = s.watchCollection('tokens', (l) => seen.push(l.map((e) => e.id).join(',')));
    await new Promise((r) => setTimeout(r, 5));
    await s.remove('tokens/new');
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(seen.at(-1), 'k');
    assert.equal(s.listeners(), 1); off(); assert.equal(s.listeners(), 0);
    assert.equal(s.assetUrl('abc'), '/_blob/abc');
  } finally { delete globalThis.claude; }
});
