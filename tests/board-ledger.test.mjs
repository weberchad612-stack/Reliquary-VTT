// The campaign ledger (board/ledger.js): entries, edits, search, the story so far, HTML; Claude's tool
// (tools/ledger.mjs); the ledger in the save (board/records.js, tools/campaign.mjs, schemas/ledger.schema.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { KINDS, KIND_IDS, ledgerEntry, editEntry, ledgerPath, ledgerRows, storySoFar, subjectsIndex, matches, entryLine, ledgerHtml, hasStatus } from '../board/ledger.js';
import { formHtml } from '../board/ledgerui.js';
import { runLedger, gameNow, ledgerList } from '../tools/ledger.mjs';
import { campaignRecords, saveFromRecords } from '../board/records.js';
import { readCampaign, writeSave, roundTrip, SAVE_COLLECTIONS } from '../tools/campaign.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('entries: a known kind and text; status for threads, quests and timed events; improvisations are added', () => {
  assert.throws(() => ledgerEntry({ kind: 'gossip', text: 'x' }), /kind/);
  assert.throws(() => ledgerEntry({ kind: 'fact', text: '  ' }), /text/);
  assert.throws(() => ledgerEntry({ kind: 'fact', text: 'x', by: 'player' }), /by/, 'players never write the ledger');
  assert.throws(() => ledgerEntry({ kind: 'fact', text: 'x', status: 'open' }), /no status/);
  assert.deepEqual(ledgerEntry({ kind: 'thread', text: 'Boot prints', at: 'T' }), { at: 'T', by: 'claude', kind: 'thread', text: 'Boot prints', status: 'open' });
  const e = ledgerEntry({ kind: 'improv', text: 'Grukk calls them shiny-eyes', subjects: 'Grukk, lantern lady, Grukk', where: { map: 'm', area: '' }, game: { now: 5, label: 'Day 1' }, links: ['chat/a'], by: 'gm', at: 'T' });
  assert.deepEqual(e, { at: 'T', by: 'gm', kind: 'improv', text: 'Grukk calls them shiny-eyes', subjects: ['Grukk', 'lantern lady'], where: { map: 'm' }, game: { now: 5, label: 'Day 1' }, source: 'added', addedBy: 'user', links: ['chat/a'] });
  assert.equal(ledgerEntry({ kind: 'fact', text: 'x', source: 'adventure' }).source, 'adventure');
  // who invented an added detail: the writer by default (the GM view's entries are the user's), or said outright
  assert.equal(ledgerEntry({ kind: 'improv', text: 'x' }).addedBy, 'claude');
  assert.equal(ledgerEntry({ kind: 'quest', text: 'The king\'s orders', source: 'added', addedBy: 'user' }).addedBy, 'user', 'a player\'s improvisation, logged by Claude');
  assert.throws(() => ledgerEntry({ kind: 'fact', text: 'x', source: 'adventure', addedBy: 'user' }), /addedBy/);
  assert.throws(() => ledgerEntry({ kind: 'improv', text: 'x', addedBy: 'gm' }), /addedBy/);
  assert.equal(editEntry(ledgerEntry({ kind: 'improv', text: 'x' }), { source: 'adventure' }, 'T').addedBy, undefined);
  assert.deepEqual(KIND_IDS.filter(hasStatus), ['thread', 'quest', 'event']);
  assert.match(ledgerPath(1000000), /^ledger\/[0-9a-z]{9}-[0-9a-z]+$/);
});

test('edits: fields replace, null removes, status kept only where it belongs, `updated` set', () => {
  const old = ledgerEntry({ kind: 'thread', text: 'a', title: 'T', at: 'A' });
  const done = editEntry(old, { status: 'done' }, 'B');
  assert.deepEqual([done.status, done.updated, done.at], ['done', 'B', 'A']);
  const noTitle = editEntry(old, { title: null, text: 'b' }, 'C');
  assert.equal(noTitle.title, undefined);
  assert.equal(noTitle.text, 'b');
  assert.equal(editEntry(old, { kind: 'fact' }, 'D').status, undefined, 'a fact has no status');
});

const L = (id, d) => ({ id, data: ledgerEntry({ at: id, ...d }) });
const LIST = [
  L('000000001-a', { kind: 'summary', title: 'Session 1', text: 'The party beat the ogre.' }),
  L('000000002-b', { kind: 'thread', title: 'Boot prints', text: 'Prints lead to the west postern.', subjects: ['postern'], where: { area: 'south grounds' } }),
  L('000000003-c', { kind: 'improv', text: 'Grukk calls the servants shiny-eyes.', subjects: ['Grukk', 'lantern lady'] }),
  L('000000004-d', { kind: 'quest', text: 'Find the lantern lady.', subjects: ['lantern lady'], status: 'done' }),
  L('000000005-e', { kind: 'secret', text: 'Varsha Kell is the lantern lady.', subjects: ['Varsha Kell', 'lantern lady'], by: 'gm' }),
  L('000000006-f', { kind: 'event', text: 'At dusk the lantern lights in the north wing.', game: { now: 9, label: 'Day 1, 6:00 PM' } }),
];

test('search: every word, across text, title, subjects, place and game time; filters; newest first', () => {
  assert.deepEqual(ledgerRows(LIST).map((e) => e.id), ['000000006-f', '000000005-e', '000000004-d', '000000003-c', '000000002-b', '000000001-a']);
  assert.deepEqual(ledgerRows(LIST, { q: 'lantern LADY' }).map((e) => e.id), ['000000005-e', '000000004-d', '000000003-c']);
  assert.deepEqual(ledgerRows(LIST, { q: 'south postern' }).map((e) => e.id), ['000000002-b'], 'the place counts');
  assert.deepEqual(ledgerRows(LIST, { q: 'dusk 6:00' }).map((e) => e.id), ['000000006-f'], 'the game time counts');
  assert.deepEqual(ledgerRows(LIST, { kind: 'open' }).map((e) => e.id), ['000000006-f', '000000002-b'], 'open: threads, quests and events not closed');
  assert.deepEqual(ledgerRows(LIST, { subject: 'grukk' }).map((e) => e.id), ['000000003-c']);
  assert.deepEqual(ledgerRows(LIST, { by: 'gm' }).map((e) => e.id), ['000000005-e']);
  assert.deepEqual(ledgerRows(LIST, { area: 'South Grounds' }).map((e) => e.id), ['000000002-b']);
  assert.equal(ledgerRows(LIST, { limit: 2 }).length, 2);
  assert.ok(matches({ kind: 'ruling', text: 'cover' }, 'ruling cover'), 'the kind\'s label counts');
});

test('the story so far: summaries oldest first, then open timed events, quests and threads', () => {
  const s = storySoFar(LIST);
  assert.deepEqual(s.summaries.map((e) => e.id), ['000000001-a']);
  assert.deepEqual(s.events.map((e) => e.id), ['000000006-f']);
  assert.deepEqual(s.quests, [], 'the done quest is not open');
  assert.deepEqual(s.threads.map((e) => e.id), ['000000002-b']);
  assert.deepEqual(subjectsIndex(LIST)[0], { name: 'lantern lady', n: 3 });
});

test('HTML: escaped; kind, status, subjects and links; controls only when editable; two-click remove', () => {
  const e = { id: 'x', ...ledgerEntry({ kind: 'thread', text: '<b>x</b>', subjects: ['Grukk'], links: ['chat/abc', 'replay/r1'], at: 'T' }) };
  const h = ledgerHtml(e);
  assert.match(h, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(h, /data-subject="Grukk"/);
  assert.match(h, /data-link="chat\/abc"[^>]*>in the chat/);
  assert.match(h, /data-link="replay\/r1"[^>]*>in the replay/);
  assert.match(h, /lg-status lg-open/);
  assert.doesNotMatch(h, /data-act/);
  const ed = ledgerHtml(e, { editable: true });
  assert.match(ed, /data-act="close"/);
  assert.match(ed, /data-act="edit"/);
  assert.match(ledgerHtml(e, { editable: true, armed: 'x' }), /Remove\?/);
  assert.match(ledgerHtml({ ...e, status: 'done' }, { editable: true }), /data-act="reopen"/);
  assert.match(ledgerHtml({ ...e, source: 'added', addedBy: 'user' }), /✨ added by you/);
  assert.match(ledgerHtml({ ...e, source: 'added', addedBy: 'claude' }), /✨ added by Claude/);
  assert.match(formHtml({ id: 'k', ...ledgerEntry({ kind: 'quest', text: 'x', source: 'added', addedBy: 'user' }) }), /<option value="added-user" selected>/);
  assert.match(entryLine(LIST[1].data), /^🧵 Thread \(open\): Boot prints: Prints lead/);
  assert.match(formHtml(), /Add to the ledger/);
  const f = formHtml({ id: 'q1', ...LIST[2].data });
  assert.match(f, /data-edit="q1"/);
  assert.match(f, /value="Grukk, lantern lady"/);
  assert.match(f, /<option value="improv" selected/);
  assert.equal(Object.keys(KINDS).length, 8);
});

const RECORDS = { 'board/meta': { ruleset: 'pf2e' }, 'state/clock': { now: 149136906012, start: 149136904200 }, 'chat/0000000aa-1': { kind: 'npc', speaker: 'Scar-Browed Ogre', text: 'Lantern lady give Grukk sheep.' } };
for (const e of LIST) RECORDS[`ledger/${e.id}`] = e.data;

test('the tool: add carries the game time; summary; edit, close and reopen; remove', () => {
  const g = gameNow(RECORDS);
  assert.equal(g.now, 149136906012);
  assert.match(g.label, /4726 AR · 2:20:12 PM · Day 1$/);
  const a = runLedger('add', ['improv', 'The', 'innkeeper', 'is', 'Brennan'], { subjects: 'Brennan', area: 'A1', now: '2026-11-13T00:00:00.000Z' }, RECORDS);
  assert.equal(a.writes.length, 1);
  assert.match(a.writes[0].path, /^ledger\//);
  assert.deepEqual([a.writes[0].data.text, a.writes[0].data.source, a.writes[0].data.where.area, a.writes[0].data.game.now], ['The innkeeper is Brennan', 'added', 'A1', 149136906012]);
  assert.equal(runLedger('add', ['fact', 'x'], { game: 'Day 2, 9:00 AM' }, RECORDS).writes[0].data.game.label, 'Day 2, 9:00 AM');
  assert.equal(runLedger('summary', ['We', 'met', 'Grukk.'], { title: 'Session 2' }, RECORDS).writes[0].data.kind, 'summary');
  const user = runLedger('add', ['quest', 'The', 'king\'s', 'orders'], { addedBy: 'user' }, RECORDS).writes[0].data;
  assert.deepEqual([user.source, user.addedBy], ['added', 'user'], '--added-by user implies an added detail');
  const flagged = runLedger('edit', ['000000004-d'], { addedBy: 'user' }, RECORDS).writes[0].data;
  assert.deepEqual([flagged.source, flagged.addedBy], ['added', 'user'], 'an entry flagged afterwards as the user\'s invention');
  assert.throws(() => runLedger('add', ['gossip', 'x'], {}, RECORDS), /kind/);
  const c = runLedger('close', ['000000002-b'], { now: 'N' }, RECORDS);
  assert.deepEqual([c.writes[0].path, c.writes[0].data.status, c.writes[0].data.updated], ['ledger/000000002-b', 'done', 'N']);
  assert.equal(runLedger('close', ['ledger/000000002-b'], { failed: true }, RECORDS).writes[0].data.status, 'failed');
  assert.equal(runLedger('reopen', ['000000004-d'], {}, RECORDS).writes[0].data.status, 'open');
  assert.throws(() => runLedger('close', ['000000003-c'], {}, RECORDS), /no status/);
  assert.throws(() => runLedger('close', ['nope'], {}, RECORDS), /no ledger entry/);
  const ed = runLedger('edit', ['000000003-c'], { text: 'Grukk calls them glow-eyes', link: ['chat/0000000aa-1'] }, RECORDS);
  assert.deepEqual([ed.writes[0].data.text, ed.writes[0].data.links, ed.writes[0].data.subjects], ['Grukk calls them glow-eyes', ['chat/0000000aa-1'], ['Grukk', 'lantern lady']]);
  assert.throws(() => runLedger('edit', ['000000003-c'], {}, RECORDS), /edit what/);
  assert.deepEqual(runLedger('remove', ['000000003-c'], {}, RECORDS).writes, [{ op: 'delete', path: 'ledger/000000003-c' }]);
});

test('the tool: find (with the chat), story and subjects', () => {
  const f = runLedger('find', ['grukk'], {}, RECORDS).lines;
  assert.equal(f.length, 1);
  assert.match(f[0], /^000000003-c .*Improvised \[added by Claude\]: Grukk calls/);
  const fc = runLedger('find', ['lantern', 'lady'], { chat: true, kind: 'secret' }, RECORDS).lines;
  assert.match(fc[0], /^000000005-e/);
  assert.ok(fc.some((l) => /^chat\/0000000aa-1 +npc Scar-Browed Ogre: Lantern lady give Grukk sheep/.test(l)), 'the chat is searched too');
  assert.match(runLedger('find', ['zzz'], {}, RECORDS).lines[0], /nothing in the ledger for "zzz"/);
  const s = runLedger('story', [], {}, RECORDS).lines.join('\n');
  assert.match(s, /## The story so far \(1\)\n- 000000001-a Session 1: The party beat the ogre\./);
  assert.match(s, /## Timed events due \(1\)\n- 000000006-f \[Day 1, 6:00 PM\]/);
  assert.match(s, /## Open quests \(0\)\n- none/);
  assert.match(runLedger('subjects', [], {}, RECORDS).lines[0], /^lantern lady \(3\)$/);
  assert.equal(ledgerList(RECORDS).length, 6);
  assert.throws(() => runLedger('dance', [], {}, RECORDS), /commands/);
});

test('the ledger is part of the save: records and back, ledger.json, the schema, the save collections', () => {
  const pack = path.join(ROOT, 'examples/sample-pack'), keep = path.join(ROOT, 'examples/campaigns/keep-test');
  const c = readCampaign(pack, keep);
  const ledger = LIST.map((e) => ({ id: e.id, ...e.data }));
  const records = campaignRecords({ ...c, ledger, now: 'x' });
  assert.equal(records['ledger/000000002-b'].title, 'Boot prints');
  assert.deepEqual(saveFromRecords(records).ledger, ledger);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  fs.cpSync(keep, dir, { recursive: true });
  writeSave(records, dir);
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8'));
  assert.deepEqual(file.entries, ledger);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const check = ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/ledger.schema.json'), 'utf8')));
  assert.ok(check(file), JSON.stringify(check.errors));
  assert.deepEqual(readCampaign(pack, dir).ledger, ledger);
  assert.deepEqual(roundTrip(pack, dir), []);
  // an empty ledger leaves no file
  writeSave(campaignRecords({ ...c, now: 'x' }), dir);
  assert.ok(!fs.existsSync(path.join(dir, 'ledger.json')));
  fs.rmSync(dir, { recursive: true });
  assert.ok(SAVE_COLLECTIONS.includes('ledger'), 'saving the game reads the ledger collection');
});
