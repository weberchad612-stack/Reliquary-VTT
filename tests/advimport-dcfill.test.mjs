// Missing DCs (tools/advimport/dcfill.mjs): a check the book gives no DC for takes the level-based DC for the party's level.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { partyLevel, fillWalls, fillTerrain, fillSubsystems } from '../tools/advimport/dcfill.mjs';
import { missingDC, CHECK_TERRAIN } from '../rulesets/pf2e/bookimport.js';

test('dcfill: the PF2E DC for a missing DC is the DC by level', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 10].map(missingDC), [14, 15, 16, 18, 19, 27]);
});

test('dcfill: the party level of a map or subsystem, else the default', () => {
  const lv = { default: 1, cave: 3 };
  assert.equal(partyLevel(lv, 'cave'), 3);
  assert.equal(partyLevel(lv, 'yard'), 1);
  assert.equal(partyLevel({}, 'yard'), null);
  assert.equal(partyLevel(undefined, 'yard'), null);
});

test('dcfill: fills secret and locked doors and check terrain with no DC, and leaves the book\'s DCs and obvious doors alone', () => {
  const walls = { segs: [
    { id: 's1', t: 'secret', door: { id: 'a' } },
    { id: 's2', t: 'secret', door: { id: 'b', dc: 22 } },
    { id: 's3', t: 'secret', door: { id: 'c', auto_find: true } },
    { id: 'd1', t: 'door', door: { id: 'd', initial: 'locked' } },
    { id: 'd2', t: 'door', door: { id: 'e', initial: 'closed' } }] };
  const got = fillWalls(walls, 2, missingDC);
  assert.deepEqual(got.map((x) => [x.where, x.dc]), [['s1', 16], ['d1', 16]]);
  assert.equal(walls.segs[1].door.dc, 22);
  assert.equal(walls.segs[2].door.dc, undefined, 'a door found as soon as seen needs no DC');
  assert.equal(walls.segs[4].door.dc, undefined, 'a door that is only closed needs none');
  assert.match(walls.segs[0].note, /book gives none.*party level 2/);
  // run again: nothing new, the earlier fills are reported as kept
  const again = fillWalls(walls, 2, missingDC);
  assert.ok(again.every((x) => !x.now) && again.length === 2);

  const terrain = { areas: [{ id: 'c', kind: 'climb' }, { id: 'w', kind: 'swim', dc: 12 }, { id: 'r', kind: 'difficult' }] };
  assert.deepEqual(fillTerrain(terrain, 3, missingDC, CHECK_TERRAIN).map((x) => [x.where, x.dc]), [['c', 18]]);
  assert.equal(terrain.areas[1].dc, 12);
  assert.equal(terrain.areas[2].dc, undefined);
});

test('dcfill: subsystem checks take the subsystem\'s level; with no level they are reported, not guessed', () => {
  const ev = { subsystems: [{ id: 'farm', parts: [{ id: 'task', checks: [{ skill: 'nature' }, { skill: 'crafting', dc: 15 }] }] },
    { id: 'other', parts: [{ id: 'task', checks: [{ skill: 'society' }] }] }] };
  const got = fillSubsystems(ev, { farm: 4 }, missingDC);
  assert.equal(ev.subsystems[0].parts[0].checks[0].dc, 19);
  assert.equal(ev.subsystems[0].parts[0].checks[1].dc, 15);
  assert.ok(got.some((x) => x.missingLevel && x.where === 'other/task/society'));
  assert.equal(ev.subsystems[1].parts[0].checks[0].dc, undefined);
});

test('dcfill: the command fills a pack, lists it in dc-fills.json, and --check reports without writing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcfill-'));
  fs.mkdirSync(path.join(dir, 'maps', 'yard'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ id: 'p', ruleset: 'pf2e', party_level: { default: 1 } }));
  fs.writeFileSync(path.join(dir, 'maps', 'yard', 'terrain.json'), JSON.stringify({ v: 1, areas: [{ id: 'wall', kind: 'climb' }] }));
  const run = (...a) => spawnSync(process.execPath, ['tools/advimport/dcfill.mjs', dir, ...a], { encoding: 'utf8' });
  const c = run('--check');
  assert.equal(c.status, 1);
  assert.match(c.stdout, /would fill/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'maps', 'yard', 'terrain.json'), 'utf8')).areas[0].dc, undefined);
  assert.equal(run().status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'maps', 'yard', 'terrain.json'), 'utf8')).areas[0].dc, 15);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'dc-fills.json'), 'utf8')).fills[0].dc, 15);
  assert.equal(run('--check').status, 0, 'nothing left to fill');
});
