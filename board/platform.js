// The store on the published board's database (the platform's `db` capability; interface in board/store.js).
//
// What the platform asks of a page, and how this adapter keeps to it:
// - one write at a time per record: writes to the same path are queued, each waiting for the last;
// - `update` exists only for records that exist: this adapter reads, merges the top-level fields, and
//   sets, which also creates a missing record (the memory store does the same);
// - a transient `unavailable` is retried once after a short random delay; other errors reach the caller;
// - snapshots are frozen: every value handed to the board is a copy;
// - map images are uploaded files, served at /_blob/<id>.


const clone = (v) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The board's database as a store, or null when this view has none (not published, not signed in). */
export async function platformStore() {
  if (typeof claude === 'undefined' || !claude || typeof claude.use !== 'function') return null;
  const db = await claude.use('db');
  if (!db) return null;
  return new PlatformStore(db);
}

class PlatformStore {
  constructor(db) {
    this.kind = 'platform';
    this.db = db;
    this.queues = new Map();
    this.shared = new Map();   // 'doc:<path>' or 'coll:<name>' -> one platform listener and its watchers
  }

  /** Run fn after every earlier write to the same path (one write at a time per record). */
  _queue(path, fn) {
    const prev = this.queues.get(path) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => retry(fn));
    this.queues.set(path, next);
    next.finally(() => { if (this.queues.get(path) === next) this.queues.delete(path); }).catch(() => {});
    return next;
  }

  async get(path) {
    const snap = await retry(() => this.db.doc(path).get());
    return snap.exists ? clone(snap.data()) : null;
  }

  async list(collection) {
    const snap = await retry(() => this.db.collection(collection).get());
    return snap.docs.map((d) => ({ id: d.id, path: `${collection}/${d.id}`, data: clone(d.data()) }));
  }

  set(path, data) { return this._queue(path, () => this.db.doc(path).set(clone(data))); }

  update(path, partial) {
    return this._queue(path, async () => {
      const snap = await this.db.doc(path).get();
      await this.db.doc(path).set({ ...(snap.exists ? clone(snap.data()) : {}), ...clone(partial) });
    });
  }

  remove(path) { return this._queue(path, () => this.db.doc(path).delete()); }

  // One snapshot listener per record or collection, however many parts of the board watch it: the platform caps a
  // page's listeners (about 40), and the encounter, flags and events are each watched from several places. A late
  // watcher gets the last value at once; the listener closes when its last watcher goes.
  _shared(key, open, cb, onError) {
    let sh = this.shared.get(key);
    if (!sh) {
      sh = { cbs: new Set(), has: false, last: null, off: null };
      this.shared.set(key, sh);
      sh.off = open((v) => { sh.has = true; sh.last = v; for (const w of [...sh.cbs]) w.cb(clone(v)); },
        (e) => { for (const w of [...sh.cbs]) report(w.onError, key.replace(/^(doc|coll):/, ''), e); });
    }
    const w = { cb, onError };
    sh.cbs.add(w);
    if (sh.has) queueMicrotask(() => { if (sh.cbs.has(w)) cb(clone(sh.last)); });
    return () => {
      if (!sh.cbs.delete(w) || sh.cbs.size) return;
      this.shared.delete(key);
      sh.off();
    };
  }

  watch(path, cb, onError) {
    return this._shared(`doc:${path}`, (next, err) => this.db.doc(path).onSnapshot((snap) => next(snap.exists ? snap.data() : null), err), cb, onError);
  }

  watchCollection(collection, cb, onError) {
    return this._shared(`coll:${collection}`, (next, err) => this.db.collection(collection).onSnapshot(
      (snap) => next(snap.docs.map((d) => ({ id: d.id, path: `${collection}/${d.id}`, data: d.data() }))), err), cb, onError);
  }

  assetUrl(id) { return id ? '/_blob/' + id : null; }

  /** The platform listeners this page holds (one per watched record or collection). */
  listeners() { return this.shared.size; }
}

async function retry(fn) {
  try {
    return await fn();
  } catch (e) {
    if (!e || e.code !== 'unavailable') throw e;
    await wait(300 + Math.random() * 700);
    return fn();
  }
}

function report(onError, where, e) {
  const msg = `The board lost its connection to ${where} (${(e && e.code) || 'error'}). Reload the page to reconnect.`;
  if (onError) onError(e, msg);
  else console.warn(msg, e);
}

