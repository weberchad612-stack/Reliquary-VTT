// The board's data store: what the board reads, writes and listens to (docs/design/board.md section 3).
// The board talks only to this interface, so the same board code runs on the published board's database
// (platformStore) or on memory (MemoryStore: tests, the demo page, a board opened from a file).
//
// Paths are two parts, "collection/record" (the platform's database accepts no deeper paths).
//
//   get(path)                   -> data or null
//   list(collection)            -> [{id, path, data}]
//   set(path, data)             -> replaces a record
//   update(path, partial)       -> merges top-level fields into a record (creating it if missing)
//   remove(path)                -> deletes a record
//   watch(path, cb)             -> cb(data or null) now and on every change; returns unsubscribe
//   watchCollection(coll, cb)   -> cb([{id, path, data}]) now and on every change; returns unsubscribe
//   assetUrl(id)                -> a URL for an uploaded file (a map image)
//   kind                        -> 'memory' or 'platform'
//
// All methods return promises, as the platform's do; watch callbacks are called asynchronously.

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const collectionOf = (path) => path.split('/')[0];
const checkPath = (path) => {
  if (typeof path !== 'string' || path.split('/').length !== 2 || path.split('/').some((p) => !p)) {
    throw new Error(`store path must be "collection/record": ${path}`);
  }
};

/** A store in memory, with the same behaviour as the platform's database (copies in, copies out, async). */
export class MemoryStore {
  /**
   * @param {object} [records]  {path: data}
   * @param {object} [assets]   {id: url} (data URLs in tests and the demo)
   * @param {object} [o]
   * @param {number} [o.latency=0]  ms each write takes, one at a time per record, as on the platform: its
   *   change is seen (and reported to watchers) only then. Tests use it to reproduce late echoes.
   */
  constructor(records = {}, assets = {}, { latency = 0 } = {}) {
    this.latency = latency;
    this.queues = new Map();
    this.kind = 'memory';
    this.records = new Map();
    for (const [p, d] of Object.entries(records)) { checkPath(p); this.records.set(p, clone(d)); }
    this.assets = { ...assets };
    this.docSubs = new Map();   // path -> Set(cb)
    this.collSubs = new Map();  // collection -> Set(cb)
    this.writes = 0;
  }

  async get(path) { checkPath(path); return clone(this.records.get(path) ?? null); }

  async list(collection) { return this._list(collection); }

  _list(collection) {
    const out = [];
    for (const [p, d] of this.records) if (collectionOf(p) === collection) out.push({ id: p.split('/')[1], path: p, data: clone(d) });
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Run a write now, or (with latency) after the record's earlier writes, each taking `latency` ms. */
  _write(path, fn) {
    if (!this.latency) { fn(); return Promise.resolve(); }
    const prev = this.queues.get(path) || Promise.resolve();
    const next = prev.then(() => new Promise((r) => setTimeout(r, this.latency))).then(fn);
    this.queues.set(path, next);
    return next;
  }

  async set(path, data) { checkPath(path); const d = clone(data); return this._write(path, () => { this.records.set(path, d); this._changed(path); }); }

  async update(path, partial) {
    checkPath(path);
    const p = clone(partial);
    return this._write(path, () => { this.records.set(path, { ...(this.records.get(path) || {}), ...p }); this._changed(path); });
  }

  async remove(path) { checkPath(path); return this._write(path, () => { if (this.records.delete(path)) this._changed(path); }); }

  watch(path, cb) {
    checkPath(path);
    if (!this.docSubs.has(path)) this.docSubs.set(path, new Set());
    this.docSubs.get(path).add(cb);
    queueMicrotask(() => cb(clone(this.records.get(path) ?? null)));
    return () => this.docSubs.get(path).delete(cb);
  }

  watchCollection(collection, cb) {
    if (!this.collSubs.has(collection)) this.collSubs.set(collection, new Set());
    this.collSubs.get(collection).add(cb);
    queueMicrotask(() => cb(this._list(collection)));
    return () => this.collSubs.get(collection).delete(cb);
  }

  assetUrl(id) { return this.assets[id] || null; }

  /** Every record, for tests and export: {path: data}. */
  dump() { return Object.fromEntries([...this.records].map(([p, d]) => [p, clone(d)])); }

  /** Listeners now open (the platform limits these; the board should keep a handful). */
  listeners() {
    let n = 0;
    // as the platform store counts: one listener per watched record or collection, however many watchers share it
    for (const s of this.docSubs.values()) n += s.size ? 1 : 0;
    for (const s of this.collSubs.values()) n += s.size ? 1 : 0;
    return n;
  }

  _changed(path) {
    this.writes++;
    const data = clone(this.records.get(path) ?? null);
    for (const cb of this.docSubs.get(path) || []) queueMicrotask(() => cb(clone(data)));
    const coll = collectionOf(path);
    for (const cb of this.collSubs.get(coll) || []) queueMicrotask(() => cb(this._list(coll)));
  }
}
