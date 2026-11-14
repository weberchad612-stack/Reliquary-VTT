// Adventure events (engine/events/events.js): conditions, what is due, stages, branches, repeats. Invented events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { holds, dueEvents, startEvent, moveTo, nextStage, finishEvent, decide, checkEvents, stateOf } from '../engine/events/events.js';

const HOUR = 3600;
const ctx = (o = {}) => ({ now: 100 * HOUR, hour: 22, level: 2, party: { map: 'keep', areas: ['K1'], outdoors: true }, flags: {}, carrying: [], events: {}, ended: {}, encounter: {}, ...o });

// shaped like the Abomination Vaults chapter 1 event: night, level 2, outdoors at the keep; a fight; a second fight
// chained to the first's end; a branch if the party is slow; a repeat after a month
const BEAM = {
  id: 'beam', title: 'The beam', trigger: { all: [{ level: { min: 2 } }, { time: 'night' }, { outdoors: true }, { map: ['keep', 'town'] }] },
  stages: [
    { id: 'light', actions: [{ narrate: 'notes/ch1#beam' }], branches: [{ if: { elapsed: { seconds: 2 * HOUR, since: 'event' } }, go: 'barrier' }] },
    { id: 'barrier', actions: [{ narrate: 'guards fence it' }] },
    { id: 'fight', actions: [{ start_encounter: 'graveyard-dead' }] },
    { id: 'arrival', when: { encounter_ended: 'graveyard-dead' }, actions: [{ place: { group: 'arrival', near: 'party' } }] },
  ],
  repeat: { cooldown: 30 * 24 * HOUR },
};

test('events: conditions on level, time, place, flags, items, other events and fights', () => {
  assert.equal(holds(BEAM.trigger, ctx()), true);
  assert.equal(holds(BEAM.trigger, ctx({ hour: 12 })), false, 'daytime');
  assert.equal(holds(BEAM.trigger, ctx({ level: 1 })), false);
  assert.equal(holds(BEAM.trigger, ctx({ party: { map: 'keep', areas: [], outdoors: false } })), false, 'indoors');
  assert.equal(holds({ any: [{ flag: 'star' }, { carrying: 'Silver Key' }] }, ctx({ carrying: ['silver key'] })), true);
  assert.equal(holds({ not: { flag: 'x' } }, ctx()), true);
  assert.equal(holds({ flag: 'mood', is: 'afraid' }, ctx({ flags: { mood: 'afraid' } })), true);
  assert.equal(holds({ event: 'beam' }, ctx({ events: { beam: { status: 'done' } } })), true);
  assert.equal(holds({ area: ['K2', 'K1'] }, ctx()), true);
  assert.equal(holds({ manual: true }, ctx()), false, 'a manual event never starts by itself');
  const enc = { active: true, round: 3, acting: { group: 'boss', name: 'The Boss' }, groups: ['boss', 'adds'], hp: { boss: 0.4 } };
  assert.equal(holds({ round: 3, group: 'adds' }, ctx({ encounter: enc })), true);
  assert.equal(holds({ round: 4 }, ctx({ encounter: enc })), false);
  assert.equal(holds({ turn: 'boss' }, ctx({ encounter: enc })), true);
  assert.equal(holds({ hp_below: 0.5, group: 'boss' }, ctx({ encounter: enc })), true);
  assert.throws(() => holds({ weather: 'rain' }, ctx()), /unknown condition/);
});

test('events: due, run through stages and branches, finish, repeat after the cooldown', () => {
  let st = stateOf({}, 'beam');
  assert.deepEqual(dueEvents([BEAM], {}, ctx({ hour: 12 })), []);
  const due = dueEvents([BEAM], {}, ctx());
  assert.deepEqual(due.map((d) => [d.id, d.kind, d.to]), [['beam', 'start', 'light']]);
  const t0 = 100 * HOUR;
  st = startEvent(BEAM, st, t0);
  assert.equal(st.status, 'running');
  // slow party: the branch fires after two hours
  assert.deepEqual(dueEvents([BEAM], { beam: st }, ctx({ now: t0 + HOUR })), []);
  assert.deepEqual(dueEvents([BEAM], { beam: st }, ctx({ now: t0 + 2 * HOUR })).map((d) => [d.kind, d.to]), [['branch', 'barrier']]);
  st = moveTo(BEAM, st, 'fight', t0 + HOUR);
  // the chained fight: due only once the first fight has ended after this stage began
  assert.deepEqual(dueEvents([BEAM], { beam: st }, ctx({ now: t0 + HOUR, ended: { 'graveyard-dead': t0 - 10 } })), []);
  assert.deepEqual(dueEvents([BEAM], { beam: st }, ctx({ now: t0 + HOUR + 60, ended: { 'graveyard-dead': t0 + HOUR + 50 } })).map((d) => [d.kind, d.to]), [['stage', 'arrival']]);
  st = moveTo(BEAM, st, 'arrival', t0 + HOUR + 60);
  assert.equal(nextStage(BEAM, st), null);
  st = decide(st, 'guards', 'helped', t0 + HOUR + 70);
  st = finishEvent(BEAM, st, t0 + 2 * HOUR);
  assert.equal(st.status, 'cooldown');
  assert.equal(st.decisions.guards, 'helped');
  assert.deepEqual(dueEvents([BEAM], { beam: st }, ctx({ now: t0 + 10 * 24 * HOUR })), [], 'cooling down');
  assert.equal(dueEvents([BEAM], { beam: st }, ctx({ now: t0 + 40 * 24 * HOUR })).length, 1, 'may happen again');
  assert.ok(st.history.length >= 5);
});

test('events: definitions are checked', () => {
  assert.deepEqual(checkEvents([BEAM]), []);
  const bad = checkEvents([{ id: 'x', trigger: { weather: 1 }, stages: [{ id: 'a', branches: [{ if: { flag: 'f' }, go: 'zz' }], next: 'yy' }] }, { id: 'x', stages: [] }]);
  assert.ok(bad.some((m) => /unknown condition/.test(m)));
  assert.ok(bad.some((m) => /branch to unknown stage "zz"/.test(m)));
  assert.ok(bad.some((m) => /next is unknown stage "yy"/.test(m)));
  assert.ok(bad.some((m) => /duplicate id/.test(m)) && bad.some((m) => /no stages/.test(m)));
});

// ---- the save: events.json <-> records, the adventure importer ----
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { splitEvents } from '../engine/events/events.js';
import { campaignRecords, saveFromRecords } from '../board/records.js';
import { buildSave, updateSave } from '../tools/advimport/campaign.mjs';

test('events: a save splits into definitions and states', () => {
  const { defs, states } = splitEvents({ beam: { title: 'B', trigger: { manual: true }, stages: [{ id: 'a' }], status: 'running', stage: 'a', runs: 1 } });
  assert.deepEqual(defs, [{ id: 'beam', title: 'B', trigger: { manual: true }, stages: [{ id: 'a' }] }]);
  assert.deepEqual(states, { beam: { status: 'running', stage: 'a', runs: 1 } });
});

test('events: records round trip (events/<id> and state/flags)', () => {
  const campaign = { v: 1, id: 'c', title: 'C', pack: { id: 'p', version: '1' }, ruleset: 'pf2e', current_map: 'm' };
  const events = { events: { beam: { title: 'B', trigger: { manual: true }, stages: [{ id: 'a' }], status: 'waiting' } }, flags: { 'ended:g1': 30 } };
  const r = campaignRecords({ campaign, pack: { id: 'p', ruleset: 'pf2e' }, maps: [], events, now: 'x' });
  assert.equal(r['events/beam'].title, 'B');
  assert.deepEqual(r['state/flags'], { 'ended:g1': 30 });
  assert.deepEqual(saveFromRecords(r, campaign).events, events);
  assert.equal(saveFromRecords(campaignRecords({ campaign, pack: { id: 'p', ruleset: 'pf2e' }, maps: [], now: 'x' }), campaign).events, null);
});

test('events: the importer writes them waiting and --update keeps play', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
  const pack = path.join(dir, 'pack'), save = path.join(dir, 'save');
  fs.mkdirSync(pack, { recursive: true });
  fs.writeFileSync(path.join(pack, 'pack.json'), JSON.stringify({ id: 'p', title: 'P', ruleset: 'pf2e', maps: ['m'] }));
  const ev = (title) => ({ id: 'beam', title, trigger: { all: [{ time: 'night' }, { level: { min: 2 } }] }, stages: [{ id: 'a' }, { id: 'b', when: { encounter_ended: 'g1' } }] });
  fs.writeFileSync(path.join(pack, 'adventure.json'), JSON.stringify({ title: 'P', maps: ['m'], landing: null, events: [ev('Old')] }));
  const b = buildSave(pack, {});
  assert.deepEqual(b.problems, []);
  assert.equal(b.events.beam.status, 'waiting');
  assert.equal(b.events.beam.id, undefined);
  fs.mkdirSync(save, { recursive: true });
  fs.writeFileSync(path.join(save, 'campaign.json'), JSON.stringify(b.campaign));
  fs.writeFileSync(path.join(save, 'events.json'), JSON.stringify({ events: { beam: { ...b.events.beam, status: 'running', stage: 'b', started: 5, runs: 1 }, gone: { title: 'G', trigger: { manual: true }, stages: [{ id: 'x' }], status: 'done' } }, flags: { seen: true } }));
  fs.writeFileSync(path.join(pack, 'adventure.json'), JSON.stringify({ title: 'P', maps: ['m'], events: [ev('New')] }));
  const u = updateSave(pack, save, {});
  assert.equal(u.events.events.beam.title, 'New');
  assert.equal(u.events.events.beam.status, 'running');
  assert.equal(u.events.events.beam.stage, 'b');
  assert.equal(u.events.events.gone.status, 'done');
  assert.deepEqual(u.events.flags, { seen: true });
  assert.ok(u.report.some((x) => /gone is no longer/.test(x)));
  fs.writeFileSync(path.join(pack, 'adventure.json'), JSON.stringify({ title: 'P', maps: ['m'], events: [{ id: 'bad', trigger: { nonsense: 1 }, stages: [{ id: 'a', next: 'zz' }] }] }));
  assert.ok(buildSave(pack, {}).problems.some((x) => /unknown condition/.test(x)) && buildSave(pack, {}).problems.some((x) => /zz/.test(x)));
});

test('events: a flag set at time 0 counts; branch endings finish the event', () => {
  assert.equal(holds({ flag: 'x' }, { flags: { x: 0 } }), true);
  assert.equal(holds({ flag: 'x' }, { flags: { x: false } }), false);
  assert.equal(holds({ flag: 'x' }, { flags: {} }), false);
  const ev = { id: 'e', stages: [{ id: 'a', branches: [{ if: { flag: 'ok' }, go: 'win' }, { if: { flag: 'bad' }, go: 'lose' }] }, { id: 'win', end: true }, { id: 'lose', end: true }, { id: 'x' }, { id: 'y', next: 'x' }] };
  assert.equal(nextStage(ev, { stage: 'a' }), null, 'branches only: no falling through to win');
  assert.equal(nextStage(ev, { stage: 'win' }), null, 'end: not on to lose');
  assert.equal(nextStage(ev, { stage: 'lose' }), null);
  assert.equal(nextStage(ev, { stage: 'x' }), 'y', 'a plain stage goes on to the one written after it');
  assert.equal(nextStage(ev, { stage: 'y' }), 'x');
});
