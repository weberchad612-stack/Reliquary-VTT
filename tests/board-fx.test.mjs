// Visual effect plays on the board: records, which plays start, where they go, the pack's library, the tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fxRecord, fxId, recordTime, newPlays, stale, playTargets, templateAim, libraries, paletteOf, previewList, prefStore, PLAY_WINDOW, KEEP } from '../board/fx.js';
import { resolveEffect, checkLibrary } from '../engine/fx/fx.js';
import { PF2E_EFFECTS } from '../rulesets/pf2e/effects.js';
import { playFromOptions, parseTo, packEffects } from '../tools/fx.mjs';
import { readCampaign } from '../tools/campaign.mjs';
import { campaignRecords } from '../board/records.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'examples/sample-pack');

test('a play record: checked, and only what was given', () => {
  const r = fxRecord({ map: 'keep', name: 'strike_slash', from: 'kerra', to: 'gob', o: { result: 'crit', text: '-18', colour: undefined }, now: 5 });
  assert.deepEqual(r, { map: 'keep', name: 'strike_slash', by: 'claude', ts: 5, from: 'kerra', to: 'gob', o: { result: 'crit', text: '-18' } });
  assert.deepEqual(fxRecord({ map: 'm', name: 'heal', to: [3.5, 4.5], now: 1 }).to, [3.5, 4.5]);
  assert.deepEqual(fxRecord({ map: 'm', name: 'burst_fire', to: 'template:t-1', now: 1 }).to, 'template:t-1');
  assert.deepEqual(fxRecord({ map: 'm', name: 'force_missiles', to: ['a', 'b'], now: 1 }).to, ['a', 'b']);
  for (const [bad, msg] of [
    [{ name: 'strike_slash' }, /map/], [{ map: 'm', name: 'Fire Ball' }, /lower case/], [{ map: 'm', name: 'x', from: { x: 1 } }, /from/],
    [{ map: 'm', name: 'x', to: 7 }, /to is/], [{ map: 'm', name: 'x', o: { result: 'graze' } }, /result/], [{ map: 'm', name: 'x', o: { n: 0 } }, /n is/],
    [{ map: 'm', name: 'x', o: { colour: 'red' } }, /colour/], [{ map: 'm', name: 'x', o: { results: { a: 'nope' } } }, /results/],
  ]) assert.throws(() => fxRecord(bad), msg);
});

test('record ids sort by time, and a record\'s time is its ts or its id\'s', () => {
  assert.match(fxId(1000, 7), /^1000-007$/);
  assert.equal(recordTime({ id: '1234-001', data: {} }), 1234);
  assert.equal(recordTime({ id: 'x', data: { ts: 99 } }), 99);
});

test('a board plays each new record once, in order; it does not replay what was there when it opened', () => {
  const seen = new Set(), e = (id, ts, map = 'keep') => ({ id, path: 'fx/' + id, data: { map, name: 'heal', ts } });
  assert.deepEqual(newPlays([e('a', 100), e('b', 200)], seen, { map: 'keep', first: true }), []);
  const list = [e('a', 100), e('b', 200), e('d', 400), e('c', 300), e('x', 350, 'crypt')];
  assert.deepEqual(newPlays(list, seen, { map: 'keep' }).map((r) => r.id), ['c', 'd'], 'the new ones, oldest first; other maps skipped');
  assert.deepEqual(newPlays(list, seen, { map: 'keep' }), [], 'played once');
  // a burst after a reconnect: only those written within the window of the newest play
  const late = [e('old', 1000), e('new', 1000 + PLAY_WINDOW + 1)];
  assert.deepEqual(newPlays(late, seen, { map: 'keep' }).map((r) => r.id), ['new']);
  // clocks differ: a board whose clock is far behind or ahead still plays (times are compared with each other)
  assert.deepEqual(newPlays([e('skew', 9e12)], seen, { map: 'keep' }).map((r) => r.id), ['skew']);
  assert.deepEqual(stale([e('s', 0), e('t', KEEP)], KEEP + 1).map((r) => r.id), ['s']);
});

test('where a play goes: tokens, lists, the targets, a point or a template, with per-target results and text', () => {
  const ctx = { tokens: { k: {}, g1: {}, g2: {} }, targets: { gm: [], player: ['g1', 'gone', 'g2'] }, templates: { t1: { shape: 'burst', origin: [3, 3], cells: [[2, 2]] } } };
  assert.deepEqual(playTargets({ to: 'g1', o: { result: 'hit', text: '-5' } }, ctx), [{ id: 'g1', result: 'hit', text: '-5' }]);
  const many = playTargets({ to: 'targets', o: { result: 'hit', results: { g2: 'miss' }, text: '-5', texts: { g2: '' } } }, ctx);
  assert.deepEqual(many, [{ id: 'g1', result: 'hit', text: '-5' }, { id: 'g2', result: 'miss', text: '' }], 'the player\'s targets that are here; per-target results and text');
  assert.deepEqual(playTargets({ to: 'targets' }, { ...ctx, targets: { gm: ['g2'], player: ['g1'] } }).map((t) => t.id), ['g2'], 'the GM\'s targets come first');
  assert.deepEqual(playTargets({ to: ['g2', 'nobody', 'k'] }, ctx).map((t) => t.id), ['g2', 'k']);
  assert.deepEqual(playTargets({ to: [4, 5] }, ctx), [{ cell: [4, 5], result: undefined, text: undefined }]);
  assert.deepEqual(playTargets({ to: 'template:t1' }, ctx).map((t) => t.template), ['t1']);
  assert.deepEqual(playTargets({ to: 'template:gone' }, ctx), []);
  assert.equal(playTargets({}, ctx).length, 1, 'no target: one play at the source');
});

test('a template\'s effect aims at a burst\'s point, a line\'s far end, a cone\'s middle', () => {
  const cells = [[0, 0], [1, 0], [2, 0], [3, 0]];
  assert.deepEqual(templateAim({ shape: 'burst', origin: [5, 5], cells }).b, [5, 5]);
  assert.deepEqual(templateAim({ shape: 'emanation', origin: [1, 1], cells }).b, [1, 1]);
  assert.deepEqual(templateAim({ shape: 'line', origin: [0, 0.5], cells }).b, [3.5, 0.5]);
  assert.deepEqual(templateAim({ shape: 'cone', origin: [0, 0.5], cells }).b, [2, 0.5]);
  assert.equal(templateAim({ shape: 'cone', origin: [0, 0.5], cells }).cells, cells);
});

test('the pack\'s effects come first and its colours over the ruleset\'s; the preview list groups and searches', () => {
  const pack = packEffects(PACK);
  assert.ok(pack && pack.effects.brazier_flare);
  assert.deepEqual(checkLibrary(pack, PF2E_EFFECTS), []);
  const libs = libraries(pack, PF2E_EFFECTS);
  assert.deepEqual(libs.map((l) => l.via), ['pack', 'ruleset']);
  assert.equal(resolveEffect('buff', libs).via, 'pack', 'the pack restyles buff');
  assert.equal(resolveEffect('heal', libs).via, 'ruleset');
  const pal = paletteOf(libs);
  assert.equal(pal.keep_banner, '#3fa7ff'); assert.equal(pal.fire, PF2E_EFFECTS.palette.fire);
  assert.deepEqual(libraries(null, PF2E_EFFECTS).map((l) => l.via), ['ruleset']);
  const all = previewList(libs);
  assert.ok(all.find((g) => g.group === 'Sample Keep'));
  const buffs = all.flatMap((g) => g.items).filter((i) => i.name === 'buff');
  assert.equal(buffs.length, 1); assert.equal(buffs[0].via, 'pack', 'listed once, as the pack\'s');
  const fire = previewList(libs, 'FIRE').flatMap((g) => g.items).map((i) => i.name);
  assert.ok(fire.includes('burst_fire') && fire.includes('cone_fire') && !fire.includes('heal'));
  assert.deepEqual(previewList(libs, 'zzzz'), []);
});

test('the pack\'s effects travel with the campaign as fxlib/pack', () => {
  const c = readCampaign(PACK, path.join(ROOT, 'examples/campaigns/keep-test'));
  const r = campaignRecords({ ...c, now: 'x' });
  assert.ok(r['fxlib/pack'] && r['fxlib/pack'].effects.brazier_flare);
  assert.deepEqual(Object.keys(r['fxlib/pack']).sort(), ['effects', 'fallbacks', 'palette']);
  assert.equal(campaignRecords({ ...c, effects: null, now: 'x' })['fxlib/pack'], undefined, 'no effects of its own: no record');
});

test('this browser\'s setting: on unless turned off, and safe without storage', () => {
  const mem = new Map(), storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const p = prefStore(storage);
  assert.equal(p.on(), true); p.set(false); assert.equal(p.on(), false); p.set(true); assert.equal(p.on(), true);
  const broken = prefStore({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } });
  assert.equal(broken.on(), true); assert.doesNotThrow(() => broken.set(false));
  assert.equal(prefStore(null).on(), true);
});

test('tools/fx.mjs: targets parsed, plays built, unknown names fall back', () => {
  assert.deepEqual(parseTo('3,4.5'), [3, 4.5]);
  assert.deepEqual(parseTo('a,b'), ['a', 'b']);
  assert.equal(parseTo('targets'), 'targets');
  assert.equal(parseTo('template:t1'), 'template:t1');
  const p = playFromOptions({ name: 'lightning_bolt', map: 'keep', from: 'pip', to: 'template:t2', kind: 'area', traits: ['electricity'], now: 42 });
  assert.equal(p.plays, 'line_lightning'); assert.equal(p.via, 'fallback');
  assert.deepEqual(p.record.o, { kind: 'area', traits: ['electricity'] });
  const g = playFromOptions({ name: 'brazier_flare', map: 'keep', to: [5, 5], gm: true, pack: packEffects(PACK), now: 1 });
  assert.equal(g.via, 'pack'); assert.equal(g.record.o.gm, true);
  assert.throws(() => playFromOptions({ name: 'heal', map: 'k', kind: 'spell' }), /--kind/);
});
