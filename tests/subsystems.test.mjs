// Subsystems: the engine (engine/events/subsystem.js), PF2E's kinds (rulesets/pf2e/subsystems.js) and the tool
// (tools/subsystem.mjs): points from degrees, thresholds, rounds, reveals, the players' view.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { score, addPoints, subsystemRound, reveal, playerView, dcShift, degreeName, checkSubsystem } from '../engine/events/subsystem.js';
import { PF2E_SUBSYSTEMS } from '../rulesets/pf2e/subsystems.js';
import { loadGame } from '../tools/actor.mjs';
import { runSubsystem } from '../tools/subsystem.mjs';

const K = PF2E_SUBSYSTEMS.kinds;
const sub = (kind, o) => ({ title: kind, kind, status: 'active', ...JSON.parse(JSON.stringify(K[kind].make(o))) });

test('subsystems: degrees by any name', () => {
  assert.equal(degreeName('critical-success'), 'criticalSuccess');
  assert.equal(degreeName('criticalFailure'), 'criticalFailure');
  assert.equal(degreeName(1), 'failure');
  assert.equal(degreeName('nonsense'), null);
});

test('subsystems: Victory Points: the default scale and thresholds, a falling structure', () => {
  let s = sub('victory', { goal: 6, thresholds: [{ at: 3, id: 'half', label: 'Halfway' }, { at: 6, id: 'won', label: 'Won', end: 'success' }] });
  let r = score(s, { degree: 'critical-success' });
  assert.equal(r.sub.tracks.vp.value, 2);
  r = score(r.sub, { degree: 'success' });
  assert.equal(r.reached[0].threshold.id, 'half');
  r = score(r.sub, { degree: 'critical-failure' });
  assert.equal(r.sub.tracks.vp.value, 2);
  assert.equal(score(r.sub, { degree: 'failure' }).sub.tracks.vp.value, 2);
  r = addPoints(r.sub, { vp: 4 });
  assert.equal(r.sub.status, 'success');
  assert.equal(r.reached.length, 1, 'halfway is reached once only');
  s = sub('victory', { start: 3, diminishing: true });
  assert.equal(score(s, { degree: 'critical-failure' }).sub.tracks.vp.value, 1);
  assert.equal(score(s, { degree: 'success' }).sub.tracks.vp.value, 3);
});

test('subsystems: Infiltration: IP to the obstacle, Awareness on failures and each round, DCs and the end', () => {
  let s = sub('infiltration', { obstacles: [{ id: 'gate', label: 'Gate', goal: 2, checks: [{ skill: 'stealth', dc: 15 }] }, { id: 'floor', label: 'Squeaky floor', goal: 1, individual: true }] });
  assert.deepEqual(checkSubsystem(s), []);
  let r = score(s, { part: 'gate', degree: 'success' });
  assert.equal(r.sub.parts[0].value, 1);
  r = score(r.sub, { part: 'gate', degree: 'critical-success' });
  assert.deepEqual(r.done, ['gate']);
  assert.throws(() => score(r.sub, { part: 'gate', degree: 'success' }), /already overcome/);
  r = score(r.sub, { part: 'floor', degree: 'success', who: 'Kerra' });
  assert.deepEqual(r.sub.parts[1].per, { Kerra: 1 });
  r = score(r.sub, { part: 'floor', degree: 'critical-failure', who: 'Pip' });
  assert.equal(r.sub.tracks.awareness.value, 2);
  r = addPoints(r.sub, { awareness: 2 });
  r = subsystemRound(r.sub);
  assert.equal(r.sub.tracks.awareness.value, 5);
  assert.equal(r.reached[0].threshold.id, 'suspicious');
  assert.equal(dcShift(r.sub), 1);
  r = addPoints(r.sub, { awareness: 10 });
  assert.equal(dcShift(r.sub), 2, '15 AP: +2 in all');
  r = addPoints(r.sub, { awareness: 5 });
  assert.equal(r.sub.status, 'failure');
});

test('subsystems: Influence per NPC, Research, Chase; the players see revealed parts only', () => {
  let s = sub('influence', { rounds: 4, npcs: [{ id: 'mayor', label: 'The mayor', thresholds: [{ at: 2, id: 'listens', label: 'Listens' }], checks: [{ skill: 'diplomacy', dc: 18 }], notes: [{ text: 'Weakness: flattery' }] }] });
  let r = score(s, { part: 'mayor', degree: 'critical-success' });
  assert.equal(r.reached[0].threshold.id, 'listens');
  assert.equal(subsystemRound(r.sub).sub.rounds.n, 1);
  let v = playerView(r.sub);
  assert.deepEqual(v.parts, []);
  let x = reveal(reveal(r.sub, 'mayor'), 'mayor', 'note:0');
  v = playerView(x);
  assert.equal(v.parts[0].label, 'The mayor');
  assert.deepEqual(v.parts[0].notes, ['Weakness: flattery']);
  assert.deepEqual(v.parts[0].checks, []);
  x = reveal(x, 'mayor', 'check:0');
  assert.deepEqual(playerView(x).parts[0].checks, [{ skill: 'diplomacy' }], 'the skill, never its DC');
  assert.ok(!JSON.stringify(playerView(x)).includes('18'));
  s = sub('research', { goal: 10, thresholds: [{ at: 4, id: 'first', label: 'First clue' }] });
  assert.equal(score(s, { degree: 'critical-failure' }).sub.tracks.rp.value, 0, 'never below 0');
  s = sub('chase', { obstacles: [{ id: 'cart', label: 'Fruit cart', goal: 3 }], opponent: { label: 'The thief', goal: 6, each: 1 } });
  r = subsystemRound(score(s, { part: 'cart', degree: 'success' }).sub);
  assert.equal(r.sub.tracks.opponent.value, 1);
  assert.equal(r.sub.parts[0].value, 1);
});

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
test('subsystem tool: a check scores from its degree; thresholds set flags; the card hides DCs', () => {
  const g = loadGame(path.join(ROOT, 'examples/sample-pack'), path.join(ROOT, 'examples/campaigns/keep-test'));
  g.flags = {};
  g.subsystems = { sneak: { title: 'Into the keep', ...sub('infiltration', { obstacles: [{ id: 'gate', label: 'Gate', goal: 2, checks: [{ skill: 'stealth', dc: 10 }] }] }), status: 'waiting' } };
  assert.throws(() => runSubsystem(g, 'check', ['sneak', 'gate'], { who: 'Kerra', skill: 'stealth', roll: 15 }), /start it first/);
  runSubsystem(g, 'start', ['sneak'], { show: true });
  assert.equal(g.subsystems.sneak.shown, true);
  const c = runSubsystem(g, 'check', ['sneak', 'gate'], { who: 'Kerra', skill: 'stealth', roll: 19 });
  assert.equal(c.result.dc, 10);
  assert.ok(c.writes.some((w) => w.path.startsWith('chat/')), 'the check card');
  assert.ok(c.writes.some((w) => w.path === 'subsystems/sneak'));
  assert.ok(g.subsystems.sneak.parts[0].value >= 1);
  runSubsystem(g, 'add', ['sneak', 'awareness', '5']);
  assert.equal(g.flags['sneak:suspicious'], 0);
  const c2 = runSubsystem(g, 'check', ['sneak', 'gate'], { who: 'Kerra', skill: 'stealth', roll: 2 });
  assert.equal(c2.result.dc, 11, 'Suspicions raised: DC +1');
  assert.match(runSubsystem(g, 'list').lines[0], /sneak {2}infiltration active \(players see it\)/);
  assert.match(runSubsystem(g, 'show', ['sneak']).lines.join('\n'), /✓ 5 Suspicions raised/);
  const pv = JSON.parse(runSubsystem(g, 'show', ['sneak'], { player: true }).lines[0]);
  assert.equal(pv.tracks.awareness.value >= 5, true);
  assert.deepEqual(pv.parts, []);
  runSubsystem(g, 'end', ['sneak', 'success']);
  assert.equal(g.flags['sneak:success'], 0);
});

import fs from 'node:fs';
import os from 'node:os';
import { buildSave, updateSave } from '../tools/advimport/campaign.mjs';
import { campaignRecords, saveFromRecords } from '../board/records.js';

test('subsystems: the importer builds them from the system\'s kinds and --update keeps play', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-'));
  const pack = path.join(dir, 'pack'), save = path.join(dir, 'save');
  fs.mkdirSync(pack, { recursive: true }); fs.mkdirSync(save, { recursive: true });
  fs.writeFileSync(path.join(pack, 'pack.json'), JSON.stringify({ id: 'p', title: 'P', ruleset: 'pf2e', maps: ['m'] }));
  const adv = (subs) => fs.writeFileSync(path.join(pack, 'adventure.json'), JSON.stringify({ title: 'P', maps: ['m'], subsystems: subs }));
  adv([{ id: 'lift', kind: 'victory', title: 'Fix the lift', goal: 4, pages: '7', thresholds: [{ at: 4, id: 'fixed', label: 'Fixed', end: 'success' }] }]);
  const b = buildSave(pack, {});
  assert.deepEqual(b.problems, []);
  assert.equal(b.subsystems.lift.status, 'waiting');
  assert.equal(b.subsystems.lift.tracks.vp.goal, 4);
  assert.deepEqual(b.subsystems.lift.scoring.criticalSuccess, { vp: 2 });
  fs.writeFileSync(path.join(save, 'campaign.json'), JSON.stringify(b.campaign));
  fs.writeFileSync(path.join(save, 'events.json'), JSON.stringify({ events: {}, subsystems: { lift: { ...b.subsystems.lift, status: 'active', tracks: { vp: { ...b.subsystems.lift.tracks.vp, value: 3 } } } } }));
  adv([{ id: 'lift', kind: 'victory', title: 'Fix the lift', goal: 4 }, { id: 'talk', kind: 'influence', npcs: [{ id: 'npc', label: 'Someone' }] }]);
  const u = updateSave(pack, save, {});
  assert.equal(u.events.subsystems.lift.tracks.vp.value, 3, 'play kept');
  assert.equal(u.events.subsystems.talk.kind, 'influence');
  assert.ok(u.report.includes('subsystem talk: new'));
  adv([{ id: 'odd', kind: 'dance-off' }]);
  assert.match(buildSave(pack, {}).problems[0], /no kind "dance-off"/);
  // records round trip
  const campaign = { v: 1, id: 'c', pack: { id: 'p' }, ruleset: 'pf2e', current_map: 'm' };
  const r = campaignRecords({ campaign, pack: { id: 'p', ruleset: 'pf2e' }, maps: [], events: { events: {}, subsystems: { lift: b.subsystems.lift } }, now: 'x' });
  assert.ok(r['subsystems/lift']);
  assert.deepEqual(saveFromRecords(r, campaign).events.subsystems.lift, b.subsystems.lift);
});
