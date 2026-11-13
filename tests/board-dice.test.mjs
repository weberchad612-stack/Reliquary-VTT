// Dice statistics (board/dice.js): records, filters, the numbers; Claude's dice tool (tools/dice.mjs); the dice the
// turn rules roll; the dice log in the save (board/records.js, tools/campaign.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dicePath, diceRecord, checkDice, formulaDice, filterDice, diceStats, sessionStart, sideOf } from '../board/dice.js';
import { runDice, parseDice } from '../tools/dice.mjs';
import { campaignRecords, saveFromRecords } from '../board/records.js';
import { readCampaign, writeSave, roundTrip } from '../tools/campaign.mjs';
import { loadGame } from '../tools/actor.mjs';
import { rollFormula, seededRandom } from '../engine/rules/dice.js';
import { PF2E_SYSTEM } from '../rulesets/pf2e/system.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('records: paths, checks, the dice of a check and of a formula', () => {
  assert.match(dicePath(1000000), /^dice\/[0-9a-z]{9}-[0-9a-z]+$/);
  assert.throws(() => diceRecord({ who: 'A', dice: [] }), /at least one/);
  assert.throws(() => diceRecord({ who: 'A', dice: [{ sides: 20, v: 21 }] }), /cannot show/);
  const r = diceRecord({ who: 'Kerra', token: 'tok-a', side: 'party', kind: 'attack', dice: [{ sides: 20, v: 14 }], by: 'player', at: 'T' });
  assert.deepEqual(r, { at: 'T', by: 'player', who: 'Kerra', side: 'party', kind: 'attack', dice: [{ sides: 20, v: 14 }], token: 'tok-a' });
  assert.equal(diceRecord({ who: 'Ogre', dice: [{ sides: 6, v: 3 }], gm: true }).gm, true);
  assert.deepEqual(checkDice({ dice: [3, 17], sides: 20 }), [{ sides: 20, v: 3 }, { sides: 20, v: 17 }], 'both dice of a roll twice');
  assert.deepEqual(formulaDice(rollFormula('2d6+1d4+3', seededRandom(1))).map((d) => d.sides), [6, 6, 4]);
  assert.equal(sideOf({ kind: 'pc' }), 'party');
  assert.equal(sideOf({ kind: 'foe' }), 'others');
});

test('filters and numbers: by side, kind, session; players never count the GM\'s rolls', () => {
  const list = [
    diceRecord({ who: 'Kerra', side: 'party', kind: 'attack', dice: [{ sides: 20, v: 20 }], at: '2026-11-12T10:00:00Z' }),
    diceRecord({ who: 'Kerra', side: 'party', kind: 'damage', dice: [{ sides: 6, v: 1 }, { sides: 6, v: 5 }], at: '2026-11-12T10:01:00Z' }),
    diceRecord({ who: 'Pip', side: 'party', kind: 'save', dice: [{ sides: 20, v: 1 }], at: '2026-11-12T11:00:00Z' }),
    diceRecord({ who: 'Ogre', side: 'others', kind: 'attack', dice: [{ sides: 20, v: 9 }], at: '2026-11-12T12:00:00Z', gm: true }),
  ];
  assert.equal(filterDice(list, { view: 'player' }).length, 3, 'the GM\'s roll is hidden from players');
  assert.equal(filterDice(list, { view: 'gm' }).length, 4);
  assert.equal(filterDice(list, { view: 'gm', side: 'others' }).length, 1);
  assert.equal(filterDice(list, { view: 'gm', kind: 'attack' }).length, 2);
  assert.equal(filterDice(list, { view: 'gm', since: '2026-11-12T10:30:00Z' }).length, 2);
  const s = diceStats(filterDice(list, { view: 'gm' }));
  assert.equal(s.rolls, 4);
  assert.equal(s.dice, 5);
  assert.deepEqual(s.byDie.map((d) => [d.sides, d.n, d.avg, d.fair]), [[6, 2, 3, 3.5], [20, 3, 10, 10.5]]);
  const f = s.faces(20);
  assert.equal(f.length, 20);
  assert.deepEqual([f[0], f[8], f[19]], [1, 1, 1]);
  assert.deepEqual(s.extremes(20), { top: 1, one: 1 });
  assert.deepEqual(s.byRoller(20).map((r) => [r.who, r.n, r.best, r.worst, r.top, r.one]), [['Kerra', 1, 20, 20, 1, 0], ['Ogre', 1, 9, 9, 0, 0], ['Pip', 1, 1, 1, 0, 1]]);
  assert.deepEqual(diceStats([]).byDie, []);
});

test('this session: the GM\'s marked start, else the start of today', () => {
  assert.equal(sessionStart({ started: '2026-11-12T18:00:00Z' }), '2026-11-12T18:00:00Z');
  const t = new Date(sessionStart(null, new Date(2026, 10, 12, 15, 30)));
  assert.deepEqual([t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), t.getMinutes()], [2026, 10, 12, 0, 0]);
});

test('the ruleset names its roll kinds', () => {
  const ids = PF2E_SYSTEM.rollKinds.map((k) => k.id);
  for (const id of ['initiative', 'attack', 'save', 'skill', 'damage', 'other']) assert.ok(ids.includes(id), id);
});

test('Claude\'s dice tool: roll a formula, log given dice, find the roller', () => {
  assert.deepEqual(parseDice(['d20=14', '2d6=3,5']), [{ sides: 20, v: 14 }, { sides: 6, v: 3 }, { sides: 6, v: 5 }]);
  assert.throws(() => parseDice(['2d6=3']), /2 dice but 1/);
  assert.throws(() => runDice('roll', ['1d6'], {}), /--who/);
  const g = loadGame(path.join(ROOT, 'examples/sample-pack'), path.join(ROOT, 'examples/campaigns/keep-test'));
  const r = runDice('roll', ['2d6+3'], { who: 'Kerra', kind: 'damage', seed: 4 }, g);
  const d = r.writes[0].data;
  assert.match(r.writes[0].path, /^dice\//);
  assert.deepEqual([d.who, d.side, d.kind, d.dice.length, d.by], ['Kerra', 'party', 'damage', 2, 'claude']);
  assert.equal(r.total, d.dice[0].v + d.dice[1].v + 3);
  const l = runDice('log', ['d20=7'], { who: 'Ogre', kind: 'attack', side: 'others', gm: true });
  assert.deepEqual([l.writes[0].data.who, l.writes[0].data.side, l.writes[0].data.gm, l.writes[0].data.dice], ['Ogre', 'others', true, [{ sides: 20, v: 7 }]]);
});

test('the turn rules report the dice they roll', () => {
  const T = PF2E_SYSTEM.time;
  const g = loadGame(path.join(ROOT, 'examples/sample-pack'), path.join(ROOT, 'examples/campaigns/keep-test'));
  const id = Object.keys(g.tokens).find((k) => g.actors[k]);
  const tokens = { ...g.tokens, [id]: { ...g.tokens[id], effects: [{ id: 'persistent', detail: '1d6 fire' }] } };
  const r = T.turnRules({ events: [{ type: 'turn-end', token: id }], now: 0, encounter: null, tokens, states: {}, roundSeconds: 6, rng: seededRandom(3), prepare: () => null });
  assert.deepEqual(r.dice.map((d) => d.kind), ['flat'], 'no game data: the damage is applied by hand, the flat check is rolled');
  assert.equal(r.dice[0].dice[0].sides, 20);
});

test('the dice log is part of the save: records and back, dice.json; the session start too', () => {
  const pack = path.join(ROOT, 'examples/sample-pack'), keep = path.join(ROOT, 'examples/campaigns/keep-test');
  const c = readCampaign(pack, keep);
  const dice = [{ id: '00000001a-0aaaa', ...diceRecord({ who: 'Kerra', side: 'party', kind: 'attack', dice: [{ sides: 20, v: 11 }], at: 'A' }) }];
  const campaign = { ...c.campaign, session: { started: '2026-11-12T18:00:00Z' } };
  const records = campaignRecords({ ...c, campaign, dice, now: 'x' });
  assert.equal(records['dice/00000001a-0aaaa'].who, 'Kerra');
  assert.deepEqual(records['state/session'], { started: '2026-11-12T18:00:00Z' });
  const back = saveFromRecords(records);
  assert.deepEqual(back.dice, dice);
  assert.deepEqual(back.campaign.session, { started: '2026-11-12T18:00:00Z' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dice-'));
  fs.cpSync(keep, dir, { recursive: true });
  writeSave(records, dir);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'dice.json'), 'utf8')).rolls, dice);
  assert.deepEqual(readCampaign(pack, dir).dice, dice);
  assert.deepEqual(roundTrip(pack, dir), []);
  fs.rmSync(dir, { recursive: true });
});
