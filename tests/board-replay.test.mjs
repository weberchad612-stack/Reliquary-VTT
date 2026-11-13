// Replay (board/replay.js): changes, reveals, claims, the adjudicating banner; the draft tool (tools/replay.mjs); replays in
// the save (board/records.js, tools/campaign.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  diffRecord, applyChange, conflicts, stepWrites, postPath, currentReplay, waitingBehind, remaining, claim, claimStood,
  focusOf, checkReplay, adjState, adjLine, elapsedWords, ADJ_LINES, ADJ_SLOW, ADJ_STALE, quietWords, narrationPosts,
} from '../board/replay.js';
import { runReplay, writesOf, project, parseMove } from '../tools/replay.mjs';
import { saveFromRecords, campaignRecords, KEEP_REPLAYS } from '../board/records.js';
import { tidyOps } from '../tools/campaign.mjs';

test('replay: a change keeps only the fields that changed, and applies over fields it does not touch', () => {
  const c = diffRecord('tokens/a', { x: 1, y: 2, name: 'Ogre', slot: 1 }, { x: 4, y: 2, name: 'Ogre', dead: true });
  assert.deepEqual(c, { path: 'tokens/a', to: { x: 4, dead: true }, from: { x: 1, slot: 1 }, unset: ['slot'], fromUnset: ['dead'] });
  // someone renamed the token meanwhile: the name stays, the replay's fields win
  assert.deepEqual(applyChange({ x: 1, y: 2, name: 'Big Ogre', slot: 1 }, c), { x: 4, y: 2, name: 'Big Ogre', dead: true });
  assert.equal(diffRecord('tokens/a', { x: 1 }, { x: 1 }), null);
  const made = diffRecord('actorstate/k', null, { hp: 3 });
  assert.equal(made.create, true);
  assert.deepEqual(applyChange(null, made), { hp: 3 });
  assert.equal(applyChange({ hp: 3 }, diffRecord('actorstate/k', { hp: 3 }, null)), null);
});

test('replay: conflicts name the fields someone changed since the replay was made', () => {
  const c = diffRecord('tokens/a', { x: 1, y: 2 }, { x: 4, y: 2, dead: true });
  assert.deepEqual(conflicts({ x: 1, y: 2 }, c), []);
  assert.deepEqual(conflicts({ x: 3, y: 2 }, c), ['x']);
  assert.deepEqual(conflicts({ x: 1, y: 2, dead: false }, c), ['dead']);
  assert.equal(conflicts(null, c).length, 1);
  assert.equal(conflicts({ hp: 1 }, diffRecord('actorstate/k', null, { hp: 3 })).length, 1);
});

const REP = {
  title: 'The ogre', by: 'claude', created: '2026-11-12T00:00:00Z', n: 0, revealed: [], narration: ['The club falls.'],
  steps: [
    { side: 'npc', actor: 'ogre', text: 'Clubs Kerra', changes: [diffRecord('actorstate/kerra', { hp: 20 }, { hp: 11 })],
      posts: [{ c: 'chat', data: { by: 'claude', kind: 'event', text: 'Kerra takes 9' } }, { c: 'fx', data: { map: 'm', name: 'club', from: 'ogre', to: 'kerra', by: 'claude', ts: 1 } }],
      moves: [{ token: 'ogre', from: [1, 1], to: [3, 3] }] },
    { side: 'pc', actor: 'kerra', text: 'Kerra falls prone', changes: [diffRecord('tokens/kerra', { x: 5 }, { x: 5, effects: [{ id: 'prone' }] })], posts: [], moves: [] },
  ],
};

test('replay: revealing a step writes its changes and posts, the same paths for the same reveal', () => {
  const at = Date.parse('2026-11-12T10:00:00Z');
  const a = stepWrites(REP, 0, { 'actorstate/kerra': { hp: 20, temp: 0 } }, { at, key: 'abc123' });
  assert.deepEqual(a.warnings, []);
  assert.deepEqual(a.ops[0], { op: 'set', path: 'actorstate/kerra', data: { hp: 11, temp: 0 } });
  assert.equal(a.ops[1].path, postPath('chat', at, 'abc123', 0, 0));
  assert.match(a.ops[1].path, /^chat\/[0-9a-z]{9}-r[0-9a-z]+$/);
  assert.equal(a.ops[1].data.at, '2026-11-12T10:00:00.000Z');
  assert.equal(a.ops[2].data.ts, at);
  assert.deepEqual(stepWrites(REP, 0, { 'actorstate/kerra': { hp: 20, temp: 0 } }, { at, key: 'abc123' }).ops, a.ops);
  // the HP changed meanwhile: a warning, and the replay's value is applied
  assert.equal(stepWrites(REP, 0, { 'actorstate/kerra': { hp: 18 } }, { at, key: 'k' }).warnings.length, 1);
  // a record gone since: its change is skipped, not made again from a few fields
  const gone = stepWrites({ ...REP, steps: [{ ...REP.steps[1], changes: [diffRecord('state/encounter', { turn: 0, combatants: [] }, { turn: 1, combatants: [] })] }] }, 0, {}, { at, key: 'k' });
  assert.equal(gone.ops.filter((o) => o.path === 'state/encounter').length, 0);
  assert.match(gone.warnings[0], /gone/);
  // the last step carries the narration
  const last = stepWrites(REP, 1, { 'tokens/kerra': { x: 5 } }, { at, key: 'k' });
  assert.equal(last.ops.at(-1).data.kind, 'narration');
  assert.deepEqual(narrationPosts({ narration: ['  ', 'x'] }).length, 1);
});

test('replay: the oldest unfinished replay shows first; claims; focus; checks', () => {
  const list = [
    { id: '0002', data: { ...REP, n: 0 } }, { id: '0001', data: { ...REP, n: 2 } }, { id: '0003', data: { ...REP, n: 1 } },
  ];
  assert.equal(currentReplay(list).id, '0002');
  assert.equal(waitingBehind(list, currentReplay(list)), 1);
  assert.equal(currentReplay([{ id: '0001', data: { ...REP, n: 2 } }, { id: '0004', data: { ...REP, n: 2 } }]).id, '0004');
  assert.equal(currentReplay([]), null);
  assert.equal(remaining({ ...REP, n: 1 }), 1);
  const c = claim(REP, { at: 0, key: 'me' });
  assert.equal(c.n, 1);
  assert.ok(claimStood({ ...REP, ...c }, 0, 'me'));
  assert.ok(!claimStood({ ...REP, ...c }, 0, 'you'));
  assert.deepEqual(focusOf(REP.steps[0]), ['ogre', [3, 3], 'ogre', 'kerra']);
  assert.deepEqual(checkReplay(REP), []);
  assert.ok(checkReplay({ steps: [{ side: 'x', text: '' }] }).length >= 2);
});

test('replay: the adjudicating banner goes slow, then stale; lines rotate and say nothing of the game', () => {
  assert.equal(adjState(null, 0, 0), 'off');
  assert.equal(adjState({}, 0, 1000), 'busy');
  assert.equal(adjState({}, 0, ADJ_SLOW), 'slow');
  assert.equal(adjState({}, 0, ADJ_STALE), 'stale');
  assert.equal(ADJ_LINES.length, 50);
  assert.equal(new Set(ADJ_LINES).size, 50);
  const rec = { since: '2026-11-12T00:00:00Z' };
  assert.ok(ADJ_LINES.includes(adjLine(rec)));
  assert.equal(adjLine(rec), adjLine({ ...rec, at: 'later' }), 'one line for the whole adjudication');
  assert.notEqual(adjLine(rec), adjLine({ since: '2026-11-12T00:00:01Z' }), 'another adjudication, another line');
  assert.equal(elapsedWords(42000), '0:42');
  assert.equal(elapsedWords(725000), '12:05');
  assert.equal(elapsedWords(3730000), '1:02:10');
  assert.equal(quietWords(4 * 60000), '4 min');
  assert.equal(quietWords(72 * 60000), '1 h 12 min');
  // for any game: no game system's words
  for (const l of ADJ_LINES) assert.doesNotMatch(l, /d20|spell|magic|hit points|initiative|dungeon/i);
});

test('replay tool: a draft changes a working copy step by step, and end writes the replay', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));
  const draftFile = path.join(dir, 'draft.json'), recFile = path.join(dir, 'records.json');
  fs.writeFileSync(recFile, JSON.stringify({ 'tokens/ogre': { name: 'Ogre', x: 1, y: 1, kind: 'foe', map: 'm' }, 'actorstate/kerra': { hp: 20 } }));
  const run = (cmd, args = [], opts = {}) => runReplay(cmd, args, opts, { draftFile, now: Date.parse('2026-11-12T10:00:00Z') });
  const b = run('begin', [], { records: recFile, title: 'Ogre', map: 'm' });
  assert.deepEqual(b.writes.map((w) => w.path.split('/')[0]), ['state', 'audit']);
  assert.throws(() => run('begin', [], { records: recFile }), /a draft is open/);
  const out = path.join(dir, 'o.json');
  fs.writeFileSync(out, JSON.stringify({ lines: [], writes: [{ op: 'update', path: 'actorstate/kerra', data: { hp: 11 } }, { op: 'set', path: 'chat/x', data: { kind: 'event', text: 'ow' } }] }));
  run('step', [], { side: 'npc', actor: 'Ogre', text: 'Clubs Kerra', in: [out], move: ['ogre:3,4'] });
  const working = JSON.parse(fs.readFileSync(path.join(dir, 'draft.records.json'), 'utf8'));
  assert.equal(working['actorstate/kerra'].hp, 11);   // step 2 sees step 1
  assert.deepEqual([working['tokens/ogre'].x, working['tokens/ogre'].y], [3, 4]);
  fs.writeFileSync(out, JSON.stringify({ op: 'update', path: 'actorstate/kerra', data: { hp: 6 } }));
  run('step', [], { side: 'npc', actor: 'ogre', text: 'Again', in: [out] });
  run('narrate', ['Thud.']);
  const e = run('end');
  const rep = e.writes[0].data;
  assert.equal(e.writes[0].path.split('/')[0], 'replay');
  assert.deepEqual(e.writes.slice(1).map((w) => w.op), ['delete', 'set']);
  assert.equal(rep.steps.length, 2);
  assert.equal(rep.steps[0].who, 'Ogre');
  assert.deepEqual(rep.steps[0].changes.find((c) => c.path === 'actorstate/kerra').from, { hp: 20 });
  assert.deepEqual(rep.steps[1].changes[0].from, { hp: 11 });
  assert.deepEqual(rep.steps[0].posts, [{ c: 'chat', data: { kind: 'event', text: 'ow' } }]);
  assert.deepEqual(rep.steps[0].moves, [{ token: 'ogre', from: [1, 1], to: [3, 4] }]);
  assert.equal(fs.existsSync(draftFile), false);
  // a later draft starts from the board plus the replay not yet revealed
  const p = project({ 'actorstate/kerra': { hp: 20 }, 'tokens/ogre': { x: 1, y: 1 }, 'replay/a': rep });
  assert.equal(p.records['actorstate/kerra'].hp, 6);
  assert.equal(p.pending, 1);
  assert.throws(() => run('step', [], { side: 'npc', text: 'x' }), /no draft is open/);
  assert.equal(run('abort').writes[0].op, 'delete');
});

test('replay tool: tool outputs of every shape become writes', () => {
  assert.deepEqual(writesOf({ op: 'set', path: 'chat/a', data: { t: 1 } }), [{ op: 'set', path: 'chat/a', data: { t: 1 } }]);
  assert.deepEqual(writesOf({ path: 'fx/1', record: { n: 1 } }), [{ op: 'set', path: 'fx/1', data: { n: 1 } }]);
  assert.equal(writesOf({ token: { x: 1 }, changed: true }, 'tokens/t')[0].path, 'tokens/t');
  assert.throws(() => writesOf({ token: { x: 1 } }), /PATH=FILE/);
  assert.deepEqual(parseMove('ogre:3,4:1,2;2,3'), { token: 'ogre', to: [3, 4], via: [[1, 2], [2, 3]] });
});

test('replay: the save keeps every unfinished replay and the last few finished; tidy deletes the rest', () => {
  const meta = { campaign: { id: 'c', title: 'C' }, pack: { id: 'p', version: '1' }, ruleset: 'pf2e', maps: [] };
  const records = { 'board/meta': meta };
  for (let i = 0; i < KEEP_REPLAYS + 3; i++) records[`replay/00000000${i}-a`] = { ...REP, n: 2 };
  records['replay/000000000-b'] = { ...REP, n: 1 };   // the oldest, not finished
  const s = saveFromRecords(records);
  assert.equal(s.replays.length, KEEP_REPLAYS + 1);
  assert.ok(s.replays.some((x) => x.id === '000000000-b'));
  const back = campaignRecords({ campaign: s.campaign, pack: { id: 'p', version: '1' }, maps: [], replays: s.replays });
  assert.equal(Object.keys(back).filter((p) => p.startsWith('replay/')).length, KEEP_REPLAYS + 1);
  const del = tidyOps(records).flat().map((o) => o.path).filter((p) => p.startsWith('replay/'));
  assert.equal(del.length, 3);
});

// ---------- roll details (board/rolldetail.js; the user's decisions, 2026-11-12) ----------
import { rollLines } from '../board/rolldetail.js';
import { runCheck } from '../tools/check.mjs';
import { runDice } from '../tools/dice.mjs';
import { loadGame } from '../tools/actor.mjs';

const KERRA_HITS = [
  { type: 'check', token: 'kerra', who: 'Kerra', label: 'Longsword Strike (attack 2)', dice: [12], kept: 12, mod: 8, parts: [{ label: 'Strength', value: 4 }, { label: 'multiple attack', value: -5 }, { label: 'backswing', value: 1 }], total: 20, vs: { label: 'AC', value: 17, token: 'ogre' }, result: 'success' },
  { type: 'damage', token: 'kerra', who: 'Kerra', label: 'Damage', text: '1d8+4 = (8)+4 = 12', crit: true, total: 24, damageType: 'slashing' },
  { type: 'applied', token: 'ogre', who: 'Ogre', amount: 24, adjust: ['24 slashing: resistance 5 → 19'], taken: 19 },
];
const OGRE_HITS = [
  { type: 'check', token: 'ogre', who: 'Ogre', label: 'Greatclub Strike', dice: [12], kept: 12, mod: 12, parts: [{ label: 'stat block', value: 12 }], total: 24, vs: { label: 'AC', value: 20, token: 'kerra' }, result: 'success' },
  { type: 'damage', token: 'ogre', who: 'Ogre', label: 'Damage', text: '1d10+7 = (4)+7 = 11', total: 11, damageType: 'bludgeoning' },
  { type: 'applied', token: 'kerra', who: 'Kerra', amount: 11, adjust: [], taken: 11 },
];
const isPc = (id) => id === 'kerra';

test('roll details: a PC\'s rolls are whole for everyone, the foe\'s AC hidden from players', () => {
  const p = rollLines(KERRA_HITS, { gm: false, isPc }).map((l) => l.text);
  assert.deepEqual(p, [
    'Longsword Strike (attack 2) +8 (+4 Strength, −5 multiple attack, +1 backswing) · d20 12 = 20 vs AC ? · success',
    'Damage 1d8+4 = (8)+4 = 12 · doubled: 24 (critical) slashing',
    '24 slashing: resistance 5 → 19',
  ]);
  assert.match(rollLines(KERRA_HITS, { gm: true, isPc })[0].text, /vs AC 17/);
});

test('roll details: a foe\'s rolls are results only for players (a PC\'s AC shown), whole for the GM', () => {
  assert.deepEqual(rollLines(OGRE_HITS, { gm: false, isPc }).map((l) => l.text), ['Greatclub Strike: 24 vs AC 20 · success', 'Damage: 11 bludgeoning']);
  const gm = rollLines(OGRE_HITS, { gm: true, isPc }).map((l) => l.text);
  assert.equal(gm[0], 'Greatclub Strike +12 (+12 stat block) · d20 12 = 24 vs AC 20 · success');
  assert.equal(gm[1], 'Damage 1d10+7 = (4)+7 = 11 bludgeoning');
  // rolling twice: both dice, the one kept
  assert.match(rollLines([{ ...OGRE_HITS[0], token: 'kerra', dice: [3, 15], kept: 15 }], { isPc })[0].text, /d20 3 and 15, kept 15/);
  assert.deepEqual(rollLines(null), []);
});

test('roll details: the tools give the rolls in parts (check.mjs, dice.mjs)', () => {
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const game = loadGame(path.join(ROOT, 'examples/sample-pack'), path.join(ROOT, 'examples/campaigns/keep-test'));
  const r = runCheck(game, { who: 'Kerra', strike: 'Longsword', attack: 2, against: 'Scar-Browed Ogre', roll: '12', bonus: 1, bonusLabel: 'backswing' });
  assert.equal(r.roll.type, 'check');
  assert.equal(r.roll.total, r.total);
  assert.equal(r.roll.mod, r.roll.parts.reduce((t, x) => t + x.value, 0), 'the parts add up');
  assert.ok(r.roll.parts.some((x) => x.label === 'backswing' && x.value === 1));
  assert.ok(r.roll.parts.some((x) => x.label === 'multiple attack' && x.value === -5));
  assert.equal(r.roll.vs.label, 'AC');
  const d = runDice('roll', ['1d8+4'], { who: 'Kerra', kind: 'damage', crit: true, type: 'slashing', seed: 3 });
  assert.equal(d.roll.total, d.roll.rolled * 2);
  assert.equal(d.total, d.roll.total);
  assert.equal(d.roll.damageType, 'slashing');
});

test('think.mjs: the banner on its own, carried on by a replay begun while it is up', async () => {
  const { runThink } = await import('../tools/think.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'think-'));
  const draftFile = path.join(dir, 'draft.json'), recFile = path.join(dir, 'records.json');
  fs.writeFileSync(recFile, '{}');
  const t0 = Date.parse('2026-11-12T10:00:00Z');
  const s = runThink('start', { what: 'searching' }, { draftFile, now: t0 });
  assert.equal(s.writes[0].data.since, '2026-11-12T10:00:00.000Z');
  assert.equal(runThink('ping', {}, { draftFile, now: t0 + 5000 }).writes[0].data.since, '2026-11-12T10:00:00.000Z');
  const b = runReplay('begin', [], { records: recFile, title: 'Searching', kind: 'exploration' }, { draftFile, now: t0 + 9000 });
  assert.equal(b.writes[0].data.since, '2026-11-12T10:00:00.000Z', 'the same adjudication goes on');
  assert.throws(() => runThink('ping', {}, { draftFile }), /not up/);
  assert.throws(() => runReplay('begin', [], { records: recFile, kind: 'dance' }, { draftFile: path.join(dir, 'other.json') }), /kind is one of/);
  fs.writeFileSync(path.join(dir, 'o.json'), JSON.stringify({ op: 'set', path: 'chat/x', data: { kind: 'event', text: 'found it' } }));
  runReplay('step', [], { side: 'pc', text: 'Lyra searches', in: [path.join(dir, 'o.json')] }, { draftFile });
  assert.equal(runReplay('end', [], {}, { draftFile }).writes[0].data.kind, 'exploration');
  assert.equal(runThink('stop', {}, { draftFile }).writes[0].op, 'delete');
});
