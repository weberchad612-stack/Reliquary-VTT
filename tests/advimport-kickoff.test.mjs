// The adventure kickoff (tools/advimport/kickoff.mjs; mandatory, the user 2026-11-13): the book's opening found by the
// system's cues, the pack's kickoff event checked against it, the campaign refused without one, the pipeline warned,
// and adventure-events.json merged into the adventure so a rebuilt adventure.json cannot erase events.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { kickoffCues } from '../rulesets/pf2e/bookimport.js';
import { findOpening, checkKickoff } from '../tools/advimport/kickoff.mjs';
import { readAdventure, buildSave } from '../tools/advimport/campaign.mjs';
import { MANDATORY, standardPipeline } from '../tools/advimport/run.mjs';
import * as BOOK from '../rulesets/pf2e/bookimport.js';

// an invented opening, in the shape books use
const P2 = 'Introduction\nThis book is for the GM.\n';
const P3 = 'Getting Started\nWhen everyone is ready, start by reading the text below to set the scene.\nYou are travellers on the old road when the bridge gives way.\nHave the players place their pawns in area 1.\n';
const P4 = 'X1. THE RIVERBANK\nGo around the table and ask each player what their hero does first, and have them introduce their heroes.\nEXPERIENCE POINTS For starting their journey, give each hero 20 XP.\n';

const KICK = { id: 'kickoff', kickoff: true, title: 'It begins', pages: '3-4', trigger: { map: 'm' }, stages: [
  { id: 'setup', actions: [{ do: 'note', text: 'Characters ready; the PCs start in area 1: place their pawns there.' }] },
  { id: 'scene', actions: [{ do: 'narrate', text: 'The bridge gives way (p 3).' }] },
  { id: 'into-play', actions: [{ do: 'note', text: 'Ask each player what their hero does first; the players introduce their heroes (p 4).' }, { do: 'xp', amount: 20 }] }] };

test('kickoff: the system\'s cues find the book\'s opening', () => {
  const k = (t) => kickoffCues(t).map((c) => c.kind).sort();
  assert.deepEqual(k(P3), ['heading', 'placement', 'read-aloud']);
  assert.deepEqual(k(P4), ['players', 'xp']);
  assert.deepEqual(k('A1. A ROOM\nRats scurry in the corner.'), []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-'));
  [P2, P3, P4, 'nothing here'].forEach((t, i) => fs.writeFileSync(path.join(dir, `p${String(i + 2).padStart(3, '0')}.txt`), t));
  assert.deepEqual(findOpening(dir, { from: 1, to: 6 }, BOOK).map((o) => o.page), [2, 3, 4]);
});

test('kickoff: checked against the opening: missing, doubled, thin, complete', () => {
  const opening = [{ page: 3, cues: kickoffCues(P3) }, { page: 4, cues: kickoffCues(P4) }];
  const adv = (events) => ({ title: 'River Road', start: { map: 'm' }, maps: ['m'], events });
  const none = checkKickoff(adv([]), opening);
  assert.match(none.errors[0], /no kickoff event/);
  assert.equal(none.skeleton.trigger.map, 'm');
  assert.equal(none.skeleton.pages, '3-4');
  assert.match(checkKickoff(adv([KICK, { ...KICK, id: 'k2' }]), opening).errors[0], /2 kickoff events/);
  const thin = checkKickoff(adv([{ id: 'k', kickoff: true, title: 'K', trigger: { map: 'other' }, stages: [{ id: 'a', actions: [{ do: 'note', text: 'x' }] }] }]), opening);
  assert.deepEqual(thin.errors.map((e) => e.split(':')[1].trim().split(' ')[0]).sort(), ['no', 'no']);
  assert.equal(thin.warnings.length, 4, thin.warnings.join('\n'));   // the starting map, folding the players in, placement, XP
  const ok = checkKickoff(adv([KICK]), opening);
  assert.deepEqual([ok.errors, ok.warnings], [[], []]);
});

test('kickoff: mandatory: the campaign is refused without one; the pipeline keeps the step', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-'));
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ id: 'p', ruleset: 'pf2e', maps: ['m'] }));
  fs.writeFileSync(path.join(dir, 'adventure.json'), JSON.stringify({ title: 'T', maps: ['m'], landing: null }));
  assert.ok(buildSave(dir, {}).problems.some((p) => /no kickoff event/.test(p)));
  fs.writeFileSync(path.join(dir, 'adventure-events.json'), JSON.stringify({ events: [KICK] }));
  assert.deepEqual(buildSave(dir, {}).problems, []);
  assert.equal(buildSave(dir, {}).events.kickoff.kickoff, true);
  assert.ok(MANDATORY.includes('kickoff'));
  const steps = standardPipeline('p').steps.map((s) => s.id);
  assert.ok(steps.indexOf('kickoff') < steps.indexOf('campaign'), 'checked before the campaign is built');
  fs.writeFileSync(path.join(dir, 'pipeline.json'), JSON.stringify({ vars: {}, steps: [{ id: 'text', run: 'true' }] }));
  const r = spawnSync(process.execPath, ['tools/advimport/run.mjs', dir, 'status'], { encoding: 'utf8' });
  assert.match(r.stderr, /no "kickoff" step: it is mandatory/);
});

test('kickoff: adventure-events.json is merged into the adventure; an id in both is an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-'));
  fs.writeFileSync(path.join(dir, 'adventure.json'), JSON.stringify({ title: 'T', events: [{ id: 'a' }], subsystems: [{ id: 's' }] }));
  fs.writeFileSync(path.join(dir, 'adventure-events.json'), JSON.stringify({ events: [{ id: 'b' }], subsystems: [{ id: 't' }] }));
  const a = readAdventure(dir);
  assert.deepEqual([a.events.map((e) => e.id), a.subsystems.map((s) => s.id)], [['a', 'b'], ['s', 't']]);
  fs.writeFileSync(path.join(dir, 'adventure-events.json'), JSON.stringify({ events: [{ id: 'a' }] }));
  assert.throws(() => readAdventure(dir), /in both adventure.json and adventure-events.json/);
});
