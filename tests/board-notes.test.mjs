import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_COLOURS, noteColour, authorName, noteVisible, canEditNote, cleanText, notePoint, noteRecord, noteGist, collapsedStore, NOTE_MAX,
} from '../board/notes.js';
import { noteFromOptions } from '../tools/note.mjs';
import { loadMap } from '../tools/sight.mjs';

test('who sees and who changes a note', () => {
  const mine = { by: 'player' }, gm = { by: 'gm' }, secret = { by: 'gm', gm_only: true }, claude = { by: 'claude' };
  assert.ok(noteVisible(mine, 'player') && noteVisible(gm, 'player') && noteVisible(claude, 'player'));
  assert.equal(noteVisible(secret, 'player'), false);
  assert.ok(noteVisible(secret, 'gm'));
  assert.ok(canEditNote(mine, 'player'));
  assert.equal(canEditNote(gm, 'player'), false);
  assert.equal(canEditNote(claude, 'player'), false);
  assert.ok(canEditNote(claude, 'gm') && canEditNote(mine, 'gm'));
});

test('colours and names by author', () => {
  assert.equal(noteColour({ by: 'player' }), NOTE_COLOURS.player);
  assert.equal(noteColour({ by: 'gm' }), NOTE_COLOURS.gm);
  assert.equal(noteColour({ by: 'claude' }), NOTE_COLOURS.claude);
  assert.equal(authorName({ by: 'player' }, 'player'), 'You');
  assert.equal(authorName({ by: 'player' }, 'gm'), 'Player');
  assert.equal(authorName({ by: 'claude' }, 'player'), 'Claude');
});

test('ids, text, points and records', () => {
  assert.equal(cleanText('  hi \n'), 'hi');
  assert.equal(cleanText('x'.repeat(600)).length, NOTE_MAX);
  assert.deepEqual(notePoint(3.14159, 2.71828), [3.142, 2.718]);
  assert.deepEqual(notePoint(3.9, 2.1, true), [3.5, 2.5]);
  const r = noteRecord({ map: 'm', text: ' a ', at: [1, 2], by: 'gm', gmOnly: true, updated: 't' });
  assert.deepEqual(r, { map: 'm', text: 'a', at: [1, 2], by: 'gm', updated: 't', gm_only: true });
  assert.equal(noteRecord({ map: 'm', text: 'a', at: [1, 2], by: 'player', updated: 't' }).gm_only, undefined);
  assert.equal(noteGist('first line\nsecond'), 'first line');
  assert.equal(noteGist('y'.repeat(60)).length, 40);
});

test('collapsed notes are kept per browser, and survive a missing or refusing storage', () => {
  const mem = new Map(), storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const a = collapsedStore('k', storage);
  assert.equal(a.toggle('n1'), true);
  assert.ok(collapsedStore('k', storage).has('n1'), 'remembered');
  a.prune(['n2']);
  assert.equal(collapsedStore('k', storage).has('n1'), false, 'a deleted note is forgotten');
  const broken = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
  const b = collapsedStore('k', broken);
  assert.equal(b.toggle('x'), true);
  assert.ok(b.has('x'));
  assert.equal(collapsedStore('k', null).has('x'), false);
});

test('note CLI: the record Claude writes, and its checks', () => {
  const { map } = loadMap('examples/sample-pack/maps/sample-keep');
  const o = noteFromOptions({ map, at: [24.5, 40.5], text: 'Barred door', gmOnly: true, id: 'note-test0001' });
  assert.equal(o.path, 'notes/note-test0001');
  assert.match(noteFromOptions({ map, at: [1, 1], text: 'x' }).path, /^notes\/note-[0-9a-z]{8}$/);
  assert.throws(() => noteFromOptions({ map, at: [1, 1], text: 'x', id: 'c1' }), /--id/);
  assert.equal(o.record.by, 'claude');
  assert.equal(o.record.gm_only, true);
  assert.equal(o.record.map, 'sample-keep');
  assert.throws(() => noteFromOptions({ map, at: [99, 1], text: 'x' }), /outside/);
  assert.throws(() => noteFromOptions({ map, at: [1, 1], text: '   ' }), /empty/);
  assert.throws(() => noteFromOptions({ map, at: [1, 1], text: 'x', by: 'bob' }), /--by/);
});
