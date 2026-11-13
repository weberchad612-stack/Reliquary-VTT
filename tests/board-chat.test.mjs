// Chat (board/chat.js): messages, who sees them, their HTML, table events; the GM's audit log (board/audit.js);
// Claude's tool (tools/chat.mjs); the chat and the audit log in the save (board/records.js, tools/campaign.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatMessage, chatPath, chatVisible, timeAgo, messageHtml, speakerOf } from '../board/chat.js';
import { auditPath, auditEntry, auditRows, auditHtml } from '../board/audit.js';
import { chatPost } from '../tools/chat.mjs';
import { campaignRecords, saveFromRecords } from '../board/records.js';
import { readCampaign, writeSave, roundTrip } from '../tools/campaign.mjs';
import { loadGame } from '../tools/actor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('messages: kinds, paths, who sees them', () => {
  assert.match(chatPath(1000000), /^chat\/[0-9a-z]{9}-[0-9a-z]+$/);
  assert.ok(chatPath(1) < chatPath(2), 'time-sortable');
  assert.throws(() => chatMessage({ kind: 'shout', text: 'x' }), /kind/);
  assert.throws(() => chatMessage({ kind: 'narration', text: ' ' }), /text/);
  const n = chatMessage({ kind: 'narration', text: 'The door creaks.', at: 'T' });
  assert.deepEqual(n, { at: 'T', by: 'claude', kind: 'narration', text: 'The door creaks.' });
  const secret = chatMessage({ kind: 'ruling', text: 'Varsha is frightened 1', gm: true }), open = chatMessage({ kind: 'ruling', text: 'Kerra is prone' });
  assert.equal(chatVisible(secret, 'player'), false);
  assert.equal(chatVisible(secret, 'gm'), true);
  assert.equal(chatVisible(open, 'player'), true);
  assert.equal(open.gm, undefined);
});

test('time ago, as Foundry writes it', () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  assert.equal(timeAgo('2026-11-12T12:00:00Z', now), 'just now');
  assert.equal(timeAgo('2026-11-12T11:59:15Z', now), '45s ago');
  assert.equal(timeAgo('2026-11-12T11:23:21Z', now), '36m 39s ago');
  assert.equal(timeAgo('2026-11-12T09:55:00Z', now), '2h 5m ago');
  assert.equal(timeAgo('2026-11-09T12:00:00Z', now), '3d ago');
});

test('message HTML: speakers by view, read-aloud, rulings, NPCs by alias, GM delete', () => {
  const npc = chatMessage({ kind: 'npc', speaker: 'Varsha Kell', alias: 'Hooded Cultist', text: 'You should not be here.' });
  assert.equal(speakerOf(npc, 'player'), 'Hooded Cultist');
  assert.equal(speakerOf(npc, 'gm'), 'Varsha Kell');
  assert.match(strip(messageHtml(npc, { view: 'player' })), /Hooded Cultist .* “You should not be here\.”/);
  assert.match(messageHtml(chatMessage({ kind: 'narration', text: 'Rain falls.' })), /<blockquote class="cm-read">Rain falls\.<\/blockquote>/);
  assert.match(strip(messageHtml(chatMessage({ kind: 'ruling', text: 'Cover applies.' }))), /Claude \(GM\) .* Ruling Cover applies\./);
  assert.doesNotMatch(messageHtml(npc, { view: 'player' }), /data-del/);
  assert.match(messageHtml(npc, { view: 'gm', canDelete: true, id: 'x1' }), /data-del="x1"/);
  // a roll's speaker: the name this view uses for its token, else the recorded name
  const roll = chatMessage({ kind: 'roll', token: 'tok-a', name: 'Hooded Cultist', check: 'initiative', total: 14, mod: 4, dice: [10], kept: 10 });
  assert.equal(speakerOf(roll, 'gm', (id) => (id === 'tok-a' ? 'Varsha Kell' : null)), 'Varsha Kell');
  assert.match(strip(messageHtml(roll, {})), /Hooded Cultist .* Initiative: Perception .* 1d20 \+ 4 14/);
  // an old event message (retired 2026-11-12) still shows; new ones cannot be made
  assert.match(messageHtml({ at: 'T', by: 'gm', kind: 'event', text: 'Varsha is dead', gm: true }, { view: 'gm' }), /class="cm cm-event gm"/);
  assert.throws(() => chatMessage({ kind: 'event', text: 'Round 1' }), /kind/, 'events go to the audit log');
  assert.throws(() => chatMessage({ kind: 'log', text: 'moved' }), /kind/, 'the change-log kind is retired');
});

test('the audit log: entries, newest first, warnings marked', () => {
  assert.match(auditPath(1000000), /^audit\/[0-9a-z]{9}-[0-9a-z]+$/);
  assert.throws(() => auditEntry({ text: ' ' }), /text/);
  assert.deepEqual(auditEntry({ text: 'Kerra moved to 3,4', by: 'player', map: 'm', at: 'T' }), { at: 'T', by: 'player', text: 'Kerra moved to 3,4', map: 'm' });
  assert.equal(auditEntry({ text: 'x', level: 'loud' }).level, undefined);
  const list = [{ id: '000000001-a', data: auditEntry({ text: 'one', at: '1' }) }, { id: '000000002-b', data: auditEntry({ text: 'two', at: '2', level: 'warn' }) }];
  assert.deepEqual(auditRows(list).map((e) => e.text), ['two', 'one']);
  assert.match(auditHtml(auditRows(list)[0]), /au-row au-warn/);
  assert.match(auditHtml({ by: 'claude', text: '<b>', at: '2026-11-12T12:00:00Z' }), /&lt;b&gt;/);
});

test('Claude\'s tool: events are audit lines, and audit lines', () => {
  const e = chatPost('event', ['Kerra', 'takes', '7', 'damage'], {});
  assert.match(e.path, /^audit\//, 'events go to the GM\'s audit log (the user, 2026-11-12)');
  assert.equal(e.data.text, 'Kerra takes 7 damage');
  const a = chatPost('audit', ['HP', '31', '->', '24'], { warn: true, map: 'm' });
  assert.match(a.path, /^audit\//);
  assert.deepEqual([a.data.by, a.data.text, a.data.level, a.data.map], ['claude', 'HP 31 -> 24', 'warn', 'm']);
});

test('Claude\'s tool: narration, rulings, an NPC by its token (alias until known)', () => {
  const n = chatPost('narration', ['The', 'torch', 'gutters.'], {});
  assert.match(n.path, /^chat\//);
  assert.deepEqual([n.data.kind, n.data.by, n.data.text], ['narration', 'claude', 'The torch gutters.']);
  assert.equal(chatPost('ruling', ['No.'], { gm: true }).data.gm, true);
  const g = loadGame(path.join(ROOT, 'examples/sample-pack'), path.join(ROOT, 'examples/campaigns/keep-test'));
  const v = chatPost('npc', ['Varsha Kell', 'Leave', 'now.'], {}, g).data;
  assert.deepEqual([v.speaker, v.alias, v.text, v.token], ['Varsha Kell', 'Hooded Cultist', 'Leave now.', 'tok-u1t8r9h7']);
  assert.equal(chatPost('npc', ['Hello'], { as: 'Innkeeper' }).data.speaker, 'Innkeeper');
});

test('the chat and the audit log are part of the save: records and back, chat.json and audit.json', () => {
  const pack = path.join(ROOT, 'examples/sample-pack'), keep = path.join(ROOT, 'examples/campaigns/keep-test');
  const c = readCampaign(pack, keep);
  const chat = [{ id: '00000001a-0aaaa', ...chatMessage({ kind: 'narration', text: 'Hello', at: 'A' }) }, { id: '00000003c-0cccc', ...chatMessage({ kind: 'ruling', text: 'Round 1', at: 'C' }) }];
  const audit = [{ id: '00000002b-0bbbb', ...auditEntry({ text: 'Kerra moved to 3,4', by: 'player', at: 'B' }) }];
  const records = campaignRecords({ ...c, chat, audit, now: 'x' });
  assert.equal(records['chat/00000001a-0aaaa'].text, 'Hello');
  assert.equal(records['audit/00000002b-0bbbb'].text, 'Kerra moved to 3,4');
  assert.deepEqual(saveFromRecords(records).chat, chat);
  assert.deepEqual(saveFromRecords(records).audit, audit);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-'));
  fs.cpSync(keep, dir, { recursive: true });
  writeSave(records, dir);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'chat.json'), 'utf8')).messages, chat);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'audit.json'), 'utf8')).entries, audit);
  assert.deepEqual(readCampaign(pack, dir).chat, chat);
  assert.deepEqual(readCampaign(pack, dir).audit, audit);
  assert.deepEqual(roundTrip(pack, dir), []);
  fs.rmSync(dir, { recursive: true });
});

test('an older save\'s change-log lines (chat kind log) move to the audit log', () => {
  const pack = path.join(ROOT, 'examples/sample-pack'), keep = path.join(ROOT, 'examples/campaigns/keep-test');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-'));
  fs.cpSync(keep, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'chat.json'), JSON.stringify({ messages: [
    { id: '00000001a-0aaaa', at: 'A', by: 'claude', kind: 'narration', text: 'Hello' },
    { id: '00000002b-0bbbb', at: 'B', by: 'player', kind: 'log', text: 'Kerra moved to 3,4', map: 'sample-keep' },
  ] }));
  const c = readCampaign(pack, dir);
  assert.deepEqual(c.chat.map((m) => m.kind), ['narration']);
  assert.deepEqual(c.audit, [{ id: '00000002b-0bbbb', at: 'B', by: 'player', text: 'Kerra moved to 3,4', map: 'sample-keep' }]);
  // and records still holding them (a board loaded before the change) save them as audit entries
  const s = saveFromRecords({ ...campaignRecords({ ...c, now: 'x' }), 'chat/00000004d-0dddd': { at: 'D', by: 'gm', kind: 'log', text: 'door opened', gm: true } });
  assert.ok(s.audit.some((e) => e.id === '00000004d-0dddd' && e.text === 'door opened' && e.gm === undefined));
  assert.ok(!s.chat.some((m) => m.kind === 'log'));
  fs.rmSync(dir, { recursive: true });
});
