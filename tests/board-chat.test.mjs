// Chat (board/chat.js): messages, who sees them, their HTML, the change log; Claude's tool (tools/chat.mjs); the
// chat in the save (board/records.js, tools/campaign.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatMessage, chatPath, chatVisible, logMessage, timeAgo, messageHtml, speakerOf, changeLog } from '../board/chat.js';
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
  const secret = logMessage({ text: 'Varsha moved', by: 'gm' }), open = logMessage({ text: 'Kerra moved', by: 'player', public: true });
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
  assert.match(messageHtml(logMessage({ text: 'door opened' }), { view: 'gm' }), /class="cm cm-log gm"/);
});

test('the change log: log lines this view may see, newest first', () => {
  const list = [
    { id: 'a', data: logMessage({ text: 'one', public: true, at: '1' }) },
    { id: 'b', data: chatMessage({ kind: 'narration', text: 'x' }) },
    { id: 'c', data: logMessage({ text: 'secret', at: '3' }) },
  ];
  assert.deepEqual(changeLog(list, 'player').map((d) => d.text), ['one']);
  assert.deepEqual(changeLog(list, 'gm').map((d) => d.text), ['secret', 'one']);
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

test('the chat is part of the save: records and back, chat.json written and read', () => {
  const pack = path.join(ROOT, 'examples/sample-pack'), keep = path.join(ROOT, 'examples/campaigns/keep-test');
  const c = readCampaign(pack, keep);
  const chat = [{ id: '00000001a-0aaaa', ...chatMessage({ kind: 'narration', text: 'Hello', at: 'A' }) }, { id: '00000002b-0bbbb', ...logMessage({ text: 'moved', at: 'B' }) }];
  const records = campaignRecords({ ...c, chat, now: 'x' });
  assert.equal(records['chat/00000001a-0aaaa'].text, 'Hello');
  assert.deepEqual(saveFromRecords(records).chat, chat);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-'));
  fs.cpSync(keep, dir, { recursive: true });
  writeSave(records, dir);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'chat.json'), 'utf8')).messages, chat);
  assert.deepEqual(readCampaign(pack, dir).chat, chat);
  assert.deepEqual(roundTrip(pack, dir), []);
  fs.rmSync(dir, { recursive: true });
});
