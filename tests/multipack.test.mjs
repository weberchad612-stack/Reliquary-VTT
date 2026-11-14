// Campaigns of several packs (an Adventure Path: one pack per book, one campaign): the loader merges the packs'
// maps, art, effects and content; records keep the list; the validator checks every pack and ids across them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCampaign, loadPacks, mergePacks, campaignPackIds, findPackDir } from '../tools/campaign.mjs';
import { campaignRecords, saveFromRecords } from '../board/records.js';
import { validate } from '../tools/validate.mjs';
import { loadGame } from '../tools/actor.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Two packs (the sample pack as book 1; a second with one map) and a save naming both. */
export function twoPacks() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-'));
  const a = path.join(dir, 'sample-pack'), b = path.join(dir, 'book-two'), save = path.join(dir, 'save');
  fs.cpSync(path.join(ROOT, 'examples/sample-pack'), a, { recursive: true });
  fs.mkdirSync(path.join(b, 'maps'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'examples/sample-pack/maps/sample-crypt'), path.join(b, 'maps', 'b2-crypt'), { recursive: true });
  const mf = path.join(b, 'maps', 'b2-crypt', 'map.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8')); m.id = 'b2-crypt'; m.name = 'Book two crypt'; delete m.links;
  fs.writeFileSync(mf, JSON.stringify(m));
  fs.writeFileSync(path.join(b, 'pack.json'), JSON.stringify({ $schema: '../../schemas/pack.schema.json', v: 1, id: 'book-two', title: 'Book Two', version: '1.0.0', ruleset: 'pf2e', maps: ['b2-crypt'] }));
  fs.cpSync(path.join(ROOT, 'examples/campaigns/keep-test'), save, { recursive: true });
  const cf = path.join(save, 'campaign.json'), c = JSON.parse(fs.readFileSync(cf, 'utf8'));
  delete c.pack; c.packs = [{ id: 'sample-pack', version: '1.0.0' }, { id: 'book-two', version: '1.0.0' }];
  fs.writeFileSync(cf, JSON.stringify(c));
  return { dir, a, b, save };
}

test('multi-pack: packs are found by id and merged', () => {
  const { a, b, save } = twoPacks();
  assert.deepEqual(campaignPackIds({ pack: { id: 'x' } }), ['x']);
  assert.deepEqual(campaignPackIds({ packs: [{ id: 'x' }, { id: 'y' }] }), ['x', 'y']);
  assert.equal(findPackDir('book-two', [a]), b, 'beside a pack given');
  const list = loadPacks(a, save);
  assert.deepEqual(list.map((p) => p.id), ['sample-pack', 'book-two']);
  const m = mergePacks(list);
  assert.deepEqual(m.ids, ['sample-pack', 'book-two']);
  assert.equal(m.maps.at(-1), 'b2-crypt');
  assert.equal(m.mapDirs['b2-crypt'], b);
  assert.deepEqual(m.dirs, [b, a], 'the later book first');
  assert.throws(() => loadPacks(path.join(ROOT, 'examples/sample-pack'), path.join(ROOT, 'saves/none')), /ENOENT|no such/);
  // a pack the campaign does not use
  const other = path.join(path.dirname(a), 'stranger');
  fs.mkdirSync(other); fs.writeFileSync(path.join(other, 'pack.json'), JSON.stringify({ id: 'stranger', maps: [] }));
  assert.throws(() => loadPacks(other, save), /is for packs "sample-pack", "book-two", not "stranger"/);
  // two packs with one map id
  fs.writeFileSync(path.join(b, 'pack.json'), JSON.stringify({ id: 'book-two', ruleset: 'pf2e', maps: ['sample-crypt'] }));
  assert.throws(() => mergePacks(loadPacks(a, save)), /map "sample-crypt" is in two packs/);
});

test('multi-pack: the campaign loads, its records keep the list, and saving writes it back', () => {
  const { a, save } = twoPacks();
  const c = readCampaign(a, save);
  assert.ok(c.maps.some((m) => m.id === 'b2-crypt') && c.maps.some((m) => m.id === 'sample-keep'));
  assert.ok(c.images.some((i) => i.map === 'b2-crypt'));
  const r = campaignRecords({ ...c, now: 'x' });
  assert.deepEqual(r['board/meta'].packs.map((p) => p.id), ['sample-pack', 'book-two']);
  assert.ok(r['board/meta'].maps.includes('b2-crypt'));
  assert.ok(r['walls/b2-crypt.000'] || Object.keys(r).some((k) => k.startsWith('walls/b2-crypt')));
  const back = saveFromRecords(r, c.campaign).campaign;
  assert.deepEqual(back.packs, [{ id: 'sample-pack', version: '1.0.0' }, { id: 'book-two', version: '1.0.0' }]);
  assert.equal(back.pack, undefined);
  // the tools' game: any of the campaign's packs, or none (found from the save)
  assert.ok(loadGame(a, save).tokens);
  assert.ok(loadGame(null, save).tokens);
  // one pack keeps the one-pack form
  const one = readCampaign(path.join(ROOT, 'examples/sample-pack'), path.join(ROOT, 'examples/campaigns/keep-test'));
  const b1 = saveFromRecords(campaignRecords({ ...one, now: 'x' }), one.campaign).campaign;
  assert.deepEqual(b1.pack, { id: 'sample-pack', version: '1.0.0' });
  assert.equal(b1.packs, undefined);
});

test('multi-pack: the validator checks every pack and ids across them', () => {
  const { a, b, save } = twoPacks();
  const ok = validate(a, { save });
  assert.deepEqual(ok.errors.map((e) => e.msg), []);
  assert.deepEqual(validate(b, { save }).errors.map((e) => e.msg), [], 'from either pack');
  // the same art key in two packs
  fs.mkdirSync(path.join(b, 'art'), { recursive: true });
  const artA = path.join(a, 'art', 'art.json');
  const keyA = fs.existsSync(artA) ? Object.keys(JSON.parse(fs.readFileSync(artA, 'utf8')))[0] : null;
  if (keyA) {
    fs.writeFileSync(path.join(b, 'art', 'art.json'), JSON.stringify({ [keyA]: { token: 'x.png', full: 'y.png' } }));
    assert.ok(validate(a, { save }).errors.some((e) => /also in .*: art keys must be unique/.test(e.msg)));
  }
  // a pack the save names that is not there
  const c = JSON.parse(fs.readFileSync(path.join(save, 'campaign.json'), 'utf8'));
  c.packs.push({ id: 'book-three', version: '1' });
  fs.writeFileSync(path.join(save, 'campaign.json'), JSON.stringify(c));
  assert.ok(validate(a, { save }).errors.some((e) => /packs: pack "book-three" not found/.test(e.msg)));
});

import { buildSave, updateSave } from '../tools/advimport/campaign.mjs';

test('multi-pack: --update adds a book to a campaign, judging each book\'s own', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpi-'));
  const mk = (id, maps, extra = {}) => {
    const d = path.join(dir, id);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'pack.json'), JSON.stringify({ id, title: id, version: '1.0.0', ruleset: 'pf2e', maps }));
    fs.writeFileSync(path.join(d, 'adventure.json'), JSON.stringify({ title: id, maps, start: { map: maps[0] }, landing: null,
      objects: [{ id: `${id}-chest`, map: maps[0], room: 'R1', at: [1, 1], name: `${id} chest`, kind: 'container' }], music: { themes: { [maps[0]]: 'explore' } }, ...extra }));
    fs.writeFileSync(path.join(d, 'adventure-events.json'), JSON.stringify({ events: [{ id: `${id}-kickoff`, kickoff: true, title: `${id} begins`, pages: '1', trigger: { map: maps[0] }, stages: [{ id: 's', actions: [{ do: 'narrate', text: 'x' }] }] }] }));
    return d;
  };
  const one = mk('book-one', ['b1-town']), two = mk('book-two', ['b2-fort']);
  const save = path.join(dir, 'save');
  const b = buildSave(one, { id: 'saga', title: 'The Saga' });
  assert.deepEqual(b.problems, []);
  fs.mkdirSync(path.join(save, 'maps'), { recursive: true });
  fs.writeFileSync(path.join(save, 'campaign.json'), JSON.stringify(b.campaign));
  for (const [m, tokens] of Object.entries(b.maps)) fs.writeFileSync(path.join(save, 'maps', `${m}.json`), JSON.stringify({ map: m, tokens }));
  fs.writeFileSync(path.join(save, 'events.json'), JSON.stringify({ events: b.events }));
  assert.equal(Object.values(b.maps['b1-town'])[0].pack, 'book-one', 'tokens know their book');
  assert.equal(b.events['book-one-kickoff'].pack, 'book-one');
  // book two joins
  const u = updateSave(two, save, {});
  assert.deepEqual(u.problems, []);
  assert.deepEqual(u.campaign.packs.map((p) => p.id), ['book-one', 'book-two']);
  assert.equal(u.campaign.pack, undefined);
  assert.equal(u.campaign.id, 'saga');
  assert.equal(u.campaign.current_map, 'b1-town', 'play stays where it is');
  assert.ok(u.report.some((r) => /pack book-two: added to the campaign \(book 2\)/.test(r)));
  assert.ok(u.report.some((r) => /to start this book: --update --start/.test(r)));
  assert.ok(!u.report.some((r) => /no longer in the adventure/.test(r)), 'book one\'s things are not book two\'s to lose');
  assert.ok(u.maps['b2-fort'] && u.maps['b1-town']);
  assert.ok(u.events.events['book-one-kickoff'] && u.events.events['book-two-kickoff'].pack === 'book-two');
  assert.deepEqual(u.campaign.music.themes, { 'b1-town': 'explore', 'b2-fort': 'explore' });
  // --start: the party goes to book two's start
  const s = updateSave(two, save, { start: true });
  assert.equal(s.campaign.current_map, 'b2-fort');
  assert.ok(s.campaign.discovered.includes('b1-town') && s.campaign.discovered.includes('b2-fort'));
  // written, then book one refreshed: book two stays, book one's own still judged
  fs.writeFileSync(path.join(save, 'campaign.json'), JSON.stringify(u.campaign));
  for (const [m, st] of Object.entries(u.maps)) fs.writeFileSync(path.join(save, 'maps', `${m}.json`), JSON.stringify(st));
  fs.writeFileSync(path.join(save, 'events.json'), JSON.stringify(u.events));
  fs.writeFileSync(path.join(one, 'adventure.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(one, 'adventure.json'), 'utf8')), objects: [] }));
  const r = updateSave(one, save, {});
  assert.deepEqual(r.campaign.packs.map((p) => p.id), ['book-one', 'book-two']);
  assert.deepEqual(r.report.filter((x) => /no longer/.test(x)), ['b1-town: book-one chest is no longer in the adventure (kept)']);
  // a third book reusing a map id is refused
  const three = mk('book-three', ['b1-town']);
  assert.match(updateSave(three, save, {}).problems[0], /map id b1-town also in pack book-one/);
  // an event id another book has
  const four = mk('book-four', ['b4-x']);
  fs.writeFileSync(path.join(four, 'adventure-events.json'), JSON.stringify({ events: [{ id: 'book-one-kickoff', kickoff: true, title: 'x', pages: '1', trigger: { map: 'b4-x' }, stages: [{ id: 's', actions: [{ do: 'narrate', text: 'x' }] }] }] }));
  assert.match(updateSave(four, save, {}).problems[0], /event "book-one-kickoff" is also pack book-one's/);
});

import { spawnSync } from 'node:child_process';
import { gameArgs } from '../tools/campaign.mjs';

test('multi-pack: the tools take the save folder alone', () => {
  const { a, save } = twoPacks();
  assert.deepEqual(gameArgs([save, 'show']), [null, save, 'show']);
  assert.deepEqual(gameArgs([a, save, 'show']), [a, save, 'show']);
  const run = (...args) => spawnSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT });
  const one = run('tools/actor.mjs', save, 'list');
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /Kerra/);
  assert.equal(run('tools/campaign.mjs', 'check', save).stdout.trim(), 'round trip OK');
  assert.equal(run('tools/encounter.mjs', a, save, 'show').status, 0, 'the two-folder form still works');
});
