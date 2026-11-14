// Book hand-off (tools/advimport/handoff.mjs): what a later book of an Adventure Path shares with the earlier ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compare, similar, crowd } from '../tools/advimport/handoff.mjs';

const book1 = {
  id: 'ap-1',
  adv: { encounters: [{ id: 'b1', map: 'ap1-town', creatures: [{ name: 'Mayor Hollis' }, { name: 'Amber wolf' }] }],
    ledger: [{ kind: 'thread', title: 'Reputation with the Guild' }, { kind: 'quest', title: 'Find the lost bell' }] },
  events: { events: [{ id: 'k', kickoff: true, stages: [{ id: 's', actions: [{ do: 'flag', name: 'bell-found' }] }] }],
    subsystems: [{ id: 'reputation', title: 'Guild Reputation' }] },
};

test('hand-off: returning names, continuing threads and subsystems, unknown flags', () => {
  const book2 = {
    id: 'ap-2',
    adv: { encounters: [{ id: 'c1', map: 'ap2-hall', creatures: [{ name: 'Mayor Hollis' }, { name: 'Amber wolf' }, { name: 'Captain Rue' }] }],
      ledger: [{ kind: 'thread', title: 'The Guild reputation' }, { kind: 'quest', title: 'Storm the keep' }] },
    events: { events: [{ id: 'e1', trigger: { flag: 'bell-found' }, stages: [{ id: 's', when: { flag: 'keep-open' }, actions: [] }] }, { id: 'e2', trigger: { event: 'gone' }, stages: [{ id: 's' }] }],
      subsystems: [{ id: 'reputation-2', title: 'Guild Reputation' }] },
  };
  const keys = compare(book2, [book1]).map((f) => f.key);
  assert.deepEqual(keys.sort(), ['creature:mayor hollis', 'event:gone', 'flag:keep-open', 'ledger:the guild reputation', 'subsystem:reputation-2']);
  assert.ok(crowd('Amber wolf') && !crowd('Mayor Hollis'));
  assert.ok(similar('Reputation with the Guild', 'The Guild reputation') >= 0.75);
  assert.ok(similar('Find the lost bell', 'Storm the keep') < 0.75);
});

test('hand-off: the command reads the campaign\'s earlier books and settles decisions from handoff.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-'));
  const put = (b) => {
    const d = path.join(root, 'packs', b.id);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'pack.json'), JSON.stringify({ id: b.id }));
    fs.writeFileSync(path.join(d, 'adventure.json'), JSON.stringify(b.adv));
    fs.writeFileSync(path.join(d, 'adventure-events.json'), JSON.stringify(b.events));
    return d;
  };
  put(book1);
  const d2 = put({ id: 'ap-2', adv: { encounters: [{ id: 'c1', map: 'm', creatures: [{ name: 'Mayor Hollis' }] }] }, events: { events: [], subsystems: [] } });
  const save = path.join(root, 'saves', 'ap');
  fs.mkdirSync(save, { recursive: true });
  fs.writeFileSync(path.join(save, 'campaign.json'), JSON.stringify({ packs: [{ id: 'ap-1' }, { id: 'ap-2' }] }));
  const run = () => spawnSync(process.execPath, ['tools/advimport/handoff.mjs', d2, save], { encoding: 'utf8' });
  const r1 = run();
  assert.equal(r1.status, 1);
  assert.match(r1.stdout, /DECIDE {3}creature:mayor hollis: Mayor Hollis \(c1, m\) is also in ap-1/);
  fs.writeFileSync(path.join(d2, 'handoff.json'), JSON.stringify({ decisions: [{ key: 'creature:mayor hollis', same: true, why: 'she returns: keep the book 1 token' }] }));
  const r2 = run();
  assert.equal(r2.status, 0, r2.stdout);
  assert.match(r2.stdout, /settled {2}creature:mayor hollis: same/);
  fs.writeFileSync(path.join(save, 'campaign.json'), JSON.stringify({ pack: { id: 'ap-1' } }));
  assert.match(spawnSync(process.execPath, ['tools/advimport/handoff.mjs', path.join(root, 'packs', 'ap-1'), save], { encoding: 'utf8' }).stdout, /first book/);
});

test('hand-off: a later book\'s events may use an earlier book\'s subsystems and encounters', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-')).replace(/\\/g, '/');
  for (const [id, adv, ev] of [['ap-1', { encounters: [{ id: 'b1' }] }, { subsystems: [{ id: 'reputation' }] }], ['ap-2', { encounters: [{ id: 'c1' }] }, null]]) {
    fs.mkdirSync(path.join(root, id), { recursive: true });
    fs.writeFileSync(path.join(root, id, 'adventure.json'), JSON.stringify(adv));
    if (ev) fs.writeFileSync(path.join(root, id, 'adventure-events.json'), JSON.stringify(ev));
  }
  const py = `import sys
sys.path.insert(0, "tools/advimport")
from buildlib import *
ev = [{"id": "k", "kickoff": True, "stages": [{"id": "s", "actions": [show_subsystem("reputation"), reveal("b1")]}]}]
print(check_events("${root}/ap-2", ev, []))
print(check_events("${root}/ap-2", ev, [], earlier=["ap-1"]))`;
  const r = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', py], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const [alone, joined] = r.stdout.trim().split('\n');
  assert.match(alone, /subsystem reputation does not exist/);
  assert.equal(joined, '[]');
});
