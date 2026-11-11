import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStore } from '../board/store.js';
import { campaignRecords, saveFromRecords, mapFromRecords, exploredRecords, exploredFromRecords, WALL_CHUNK } from '../board/records.js';
import { buildRecords, readCampaign, writeSave, roundTrip, BACKUPS } from '../tools/campaign.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'examples', 'sample-pack');
const camp = (id) => path.join(ROOT, 'examples', 'campaigns', id);
const tick = () => new Promise((r) => setTimeout(r, 0));

test('store: two-part paths only; copies in and out', async () => {
  const s = new MemoryStore();
  await assert.rejects(() => s.set('a/b/c', {}), /collection\/record/);
  const v = { x: 1 };
  await s.set('tokens/k', v);
  v.x = 2;
  assert.equal((await s.get('tokens/k')).x, 1);
  const got = await s.get('tokens/k'); got.x = 3;
  assert.equal((await s.get('tokens/k')).x, 1);
  await s.update('tokens/k', { y: 2 });
  assert.deepEqual(await s.get('tokens/k'), { x: 1, y: 2 });
  await s.remove('tokens/k');
  assert.equal(await s.get('tokens/k'), null);
});

test('store: watchers hear the current value, then every change; unsubscribing stops them', async () => {
  const s = new MemoryStore({ 'tokens/a': { x: 1 } });
  const doc = [], coll = [];
  const off = s.watch('tokens/a', (d) => doc.push(d && d.x));
  s.watchCollection('tokens', (l) => coll.push(l.map((e) => e.id).join(',')));
  await tick();
  await s.update('tokens/a', { x: 2 });
  await s.set('tokens/b', { x: 5 });
  await tick();
  assert.deepEqual(doc, [1, 2]);   // a record's watcher hears only its own record, not b's
  assert.ok(coll.includes('a,b'));
  off();
  await s.update('tokens/a', { x: 9 });
  await tick();
  assert.equal(doc.at(-1), 2);
  assert.equal(s.listeners(), 1);
});

test('records: a campaign becomes small two-part records and comes back the same', () => {
  for (const id of ['keep-test', 'crypt-test']) assert.deepEqual(roundTrip(PACK, camp(id)), [], id);
  const { records } = buildRecords(PACK, camp('keep-test'), { now: 't' });
  for (const [p, d] of Object.entries(records)) {
    assert.equal(p.split('/').length, 2, p);
    assert.ok(JSON.stringify(d).length < 200 * 1024, `${p} is under the record size limit`);
  }
  assert.equal(records['board/meta'].ruleset, 'pf2e');
  assert.equal(records['state/table'].current_map, 'sample-keep');
  assert.equal(records['tokens/kerra'].map, 'sample-keep');
});

test('records: a map comes back from its records whole, walls in order', () => {
  const c = readCampaign(PACK, camp('keep-test'));
  const records = campaignRecords({ ...c, now: 't' });
  const keep = c.maps.find((m) => m.id === 'sample-keep');
  const back = mapFromRecords(records, 'sample-keep');
  assert.deepEqual(back.segs, keep.segs);
  assert.deepEqual(back.terrain, keep.terrain);
  assert.equal(back.lighting.lights.length, keep.lighting.lights.length);
  assert.equal(back.map.image.fingerprint, keep.image.fingerprint);
  const big = campaignRecords({ ...c, maps: [{ ...keep, segs: Array.from({ length: WALL_CHUNK * 2 + 5 }, (_, i) => ({ id: 'w' + i, a: [0, 0], b: [1, i] })) }], now: 't' });
  assert.equal(Object.keys(big).filter((p) => p.startsWith('walls/')).length, 3);
  assert.equal(mapFromRecords(big, 'sample-keep').segs[WALL_CHUNK + 1].id, 'w' + (WALL_CHUNK + 1));
});

test('records: explored areas are chunked and rebuilt in order', () => {
  const polys = Array.from({ length: 450 }, (_, i) => [[i, 0], [i + 1, 0], [i + 1, 1]]);
  const recs = exploredRecords('m', { v: 3, polys });
  assert.equal(Object.keys(recs).length, 3);
  const back = exploredFromRecords(Object.values(recs).reverse());
  assert.equal(back.polys.length, 450);
  assert.deepEqual(back.polys[300], polys[300]);
});

test('records: placed templates get a record each and come back into their map state', () => {
  const c = readCampaign(PACK, camp('keep-test'));
  const mapId = Object.keys(c.mapStates)[0];
  const tpl = { shape: 'burst', ft: 10, by: 'gm', origin: [5, 5], cells: [[4, 4], [5, 5]], col: 2, at: 'x' };
  c.mapStates[mapId] = { ...c.mapStates[mapId], templates: { a1: tpl } };
  const recs = campaignRecords({ ...c, now: 'x' });
  assert.deepEqual(recs['templates/a1'], { ...tpl, map: mapId });
  assert.equal(recs[`mapstate/${mapId}`].templates, undefined);
  const back = saveFromRecords(recs, c.campaign);
  assert.deepEqual(back.mapStates[mapId].templates, { a1: tpl });
});

test('records: a save for the wrong pack or ruleset is refused', () => {
  const c = readCampaign(PACK, camp('keep-test'));
  assert.throws(() => campaignRecords({ ...c, campaign: { ...c.campaign, pack: { id: 'other' } } }), /pack "other"/);
  assert.throws(() => campaignRecords({ ...c, campaign: { ...c.campaign, ruleset: 'dnd5e' } }), /ruleset/);
});

test('saving writes campaign.json and map states, keeps a dated backup, and keeps only the last few', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rvtt-save-'));
  fs.cpSync(camp('keep-test'), tmp, { recursive: true });
  const { records } = buildRecords(PACK, tmp, { now: 't' });
  records['tokens/kerra'] = { ...records['tokens/kerra'], x: 30, y: 30 };
  records['mapstate/sample-keep'] = { ...records['mapstate/sample-keep'], doors: { 'door-library': { state: 'open' } } };
  for (let i = 0; i < BACKUPS + 2; i++) writeSave(records, tmp, { now: new Date(Date.UTC(2026, 10, 10, 12, i)) });
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'maps', 'sample-keep.json'), 'utf8'));
  assert.equal(saved.tokens.kerra.x, 30);
  assert.equal(saved.doors['door-library'].state, 'open');
  assert.ok(JSON.parse(fs.readFileSync(path.join(tmp, 'campaign.json'), 'utf8')).saved_at.startsWith('2026-11-10'));
  assert.equal(fs.readdirSync(path.join(tmp, 'backups')).length, BACKUPS);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a save from records holds no store-only fields', () => {
  const { records } = buildRecords(PACK, camp('crypt-test'), { now: 't' });
  const { campaign, mapStates } = saveFromRecords(records);
  assert.equal(campaign.pack.id, 'sample-pack');
  for (const st of Object.values(mapStates)) for (const t of Object.values(st.tokens || {})) assert.equal(t.map, undefined);
});

test('load ops reuse uploaded images by fingerprint, put board/meta last, and stay in batches of 50', async () => {
  const { loadOps, clearOps } = await import('../tools/campaign.mjs');
  const { records: r0, images } = buildRecords(PACK, camp('keep-test'), { now: 't' });
  const keep = images.find((i) => i.map === 'sample-keep');
  const ops = loadOps(PACK, camp('keep-test'), [{ opaque_id: 'A1', sha256: keep.fingerprint }], { now: 't' });
  assert.ok(ops.batches.every((b) => b.length <= 50));
  const all = ops.batches.flat();
  assert.equal(all.find((o) => o.path === 'maps/sample-keep').data.image.asset, 'A1');
  assert.equal(all.some((o) => o.path === 'board/meta'), false);
  assert.equal(ops.meta.path, 'board/meta');
  assert.deepEqual(ops.upload.map((u) => u.map).sort(), ['sample-crypt', 'sample-stairwell', 'sample-village']);
  assert.equal(all.some((o) => o.path.startsWith('walls/sample-village')), false, 'an area map has no wall records');
  assert.equal(all.length, Object.keys(r0).length - 1);
  const del = clearOps(Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`log/${i}`, 1])));
  assert.deepEqual(del.map((b) => b.length), [50, 50, 20]);
  assert.deepEqual(del[0][0], { op: 'delete', path: 'log/0', ifVersion: 1 });
});

test('verify: a save matches the records it was written from, and a moved token is caught', async () => {
  const { verifySave } = await import('../tools/campaign.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rvtt-verify-'));
  fs.cpSync(camp('keep-test'), tmp, { recursive: true });
  const { records } = buildRecords(PACK, tmp, { now: 't' });
  records['tokens/ogre'] = { ...records['tokens/ogre'], x: 23, y: 17 };
  writeSave(records, tmp);
  assert.deepEqual(verifySave(records, PACK, tmp), []);
  records['tokens/ogre'].x = 30;
  assert.ok(verifySave(records, PACK, tmp).some((d) => d.includes('ogre')));
  fs.rmSync(tmp, { recursive: true, force: true });
});
