// The board's events (board/events.js, board/eventsui.js): condition words, the tab's rows and detail, and the
// encounter tracker's hook marking combat events due.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine/events/events.js';
import { conditionWords, combatCondition, combatDue, eventRows, eventDetailHtml, splitRecords, actionShort } from '../board/events.js';
import { mountEvents } from '../board/eventsui.js';

const DEFS = [
  { id: 'wake', title: 'The statue wakes', pages: '9', trigger: { all: [{ round: 3, group: 'hall' }] }, stages: [{ id: 'a', actions: [{ do: 'narrate', text: 'Stone cracks.' }] }] },
  { id: 'flee', title: 'The boss flees', trigger: { manual: true }, stages: [{ id: 'fight' }, { id: 'run', when: { hp_below: 0.5, group: 'boss' }, actions: [{ do: 'place', group: 'boss' }] }] },
  { id: 'dusk', title: 'Dusk bell', trigger: { all: [{ time: 'night' }, { level: { min: 2 } }] }, stages: [{ id: 'a' }], repeat: { cooldown: 86400 } },
];
const ctx = (enc) => ({ now: 100, hour: 12, level: 1, party: { map: 'm', areas: [], outdoors: false }, flags: {}, carrying: [], events: {}, ended: {}, encounter: enc });

test('board events: conditions in words, and which look at the encounter', () => {
  assert.equal(conditionWords(DEFS[2].trigger), 'by day and party level 2+'.replace('by day', 'at night'));
  assert.equal(conditionWords({ elapsed: { seconds: 7200 } }), '2 hours after the event began');
  assert.equal(conditionWords({ hp_below: 0.5, group: 'boss' }), 'boss below 50% HP');
  assert.ok(combatCondition(DEFS[0].trigger));
  assert.ok(combatCondition({ any: [{ flag: 'x' }, { not: { turn: 'boss' } }] }));
  assert.ok(!combatCondition(DEFS[2].trigger));
  assert.equal(actionShort({ do: 'encounter', group: 'hall' }), 'Fight: hall');
});

test('board events: the tracker hook marks combat events due once', () => {
  const states = { flee: { status: 'running', stage: 'fight', runs: 1 } };
  const enc = { active: true, round: 3, groups: ['hall', 'boss'], acting: null, hp: { boss: 0.4 } };
  const due = combatDue(DEFS, states, ctx(enc), E);
  assert.deepEqual(due.map((d) => [d.id, d.kind, d.to]).sort(), [['flee', 'stage', 'run'], ['wake', 'start', 'a']]);
  const marked = Object.fromEntries(due.map((d) => [d.id, { key: d.key }]));
  assert.deepEqual(combatDue(DEFS, states, ctx(enc), E, marked), [], 'marked already');
  assert.deepEqual(combatDue(DEFS, states, ctx({ ...enc, round: 2, hp: { boss: 0.9 } }), E), []);
  // a non-combat event that is due (night, level) is Claude's to see, not the tracker's
  assert.deepEqual(combatDue(DEFS, {}, { ...ctx({ active: false }), hour: 23, level: 3 }, E).map((d) => d.id), []);
});

test('board events: rows order running, due, waiting, done; detail shows stages and the current one', () => {
  const states = { flee: { status: 'running', stage: 'run', decisions: { parley: 'no' }, history: [{ at: 1, what: 'started at fight' }] }, dusk: { status: 'done' } };
  const rows = eventRows(DEFS, states, { wake: { why: 'its trigger holds' } });
  assert.deepEqual(rows.map((r) => [r.id, r.status]), [['flee', 'running'], ['wake', 'due'], ['dusk', 'done']]);
  const h = eventDetailHtml(DEFS[1], states.flee);
  assert.match(h, /class="ev-stage ev-cur"><b>▶ run/);
  assert.match(h, /when boss below 50% HP/);
  assert.match(h, /parley: no/);
  assert.match(h, /started at fight/);
  const { defs, states: st } = splitRecords([{ id: 'wake', data: { ...DEFS[0], status: 'running', stage: 'a' } }], E);
  assert.equal(defs[0].id, 'wake'); assert.equal(st.wake.stage, 'a'); assert.equal(defs[0].status, undefined);
});

test('board events: the tab draws for the GM only, and opens an event', () => {
  // a tiny DOM: enough of an element for the tab
  const el = () => {
    const kids = {};
    const node = { innerHTML: '', hidden: false, textContent: '', checked: false, dataset: {}, listeners: {},
      querySelector: (s) => (kids[s] = kids[s] || el()), addEventListener: (t, f) => { node.listeners[t] = f; } };
    return node;
  };
  const pane = el();
  let watchers = {}, badge = null;
  const store = { watchCollection: (c, cb) => { watchers[c] = cb; return () => {}; }, watch: (p, cb) => { watchers[p] = cb; return () => {}; } };
  let view = 'gm';
  const ui = mountEvents({ store, view: () => view, pane, E, badge: (n) => { badge = n; } });
  watchers.events([{ id: 'wake', data: { ...DEFS[0], status: 'waiting' } }, { id: 'flee', data: { ...DEFS[1], status: 'running', stage: 'fight' } }]);
  watchers['state/eventsdue']({ wake: { why: 'round 3' } });
  const list = pane.querySelector('.ev-list');
  assert.match(list.innerHTML, /The boss flees[\s\S]*The statue wakes/);
  assert.equal(badge, 2);
  ui.open('wake');
  assert.match(list.innerHTML, /Due: round 3/);
  view = 'player'; ui.render();
  assert.equal(list.innerHTML, '');
});

import * as SS from '../engine/events/subsystem.js';
import { playerCardHtml, gmCardHtml } from '../board/subsystemui.js';
import { PF2E_SUBSYSTEMS } from '../rulesets/pf2e/subsystems.js';

test('board subsystem card: players see revealed parts and no DCs; the GM sees all', () => {
  let s = { title: 'Into the keep', kind: 'infiltration', status: 'active', shown: true, ...JSON.parse(JSON.stringify(PF2E_SUBSYSTEMS.kinds.infiltration.make({ obstacles: [{ id: 'gate', label: 'Gate', goal: 2, checks: [{ skill: 'stealth', dc: 17 }] }, { id: 'vault', label: 'Secret vault', goal: 3 }] }))) };
  s = SS.reveal(SS.reveal(s, 'gate'), 'gate', 'check:0');
  s = SS.addPoints(s, { awareness: 5 }).sub;
  const p = playerCardHtml(SS.playerView(s));
  assert.match(p, /Into the keep/);
  assert.match(p, /Awareness Points<\/span><b>5/);
  assert.match(p, /Gate/);
  assert.match(p, /Try: stealth/);
  assert.ok(!/Secret vault/.test(p), 'a hidden part');
  assert.ok(!/17|18|DC/.test(p), 'no DCs');
  assert.ok(!/Suspicions/.test(p), 'thresholds stay the GM\'s until revealed');
  const g = gmCardHtml('sneak', s, SS.dcShift(s));
  assert.match(g, /stealth DC 18/);
  assert.match(g, /✓ 5 Suspicions raised/);
  assert.match(g, /Secret vault<\/b> <span class="ss-k">\(hidden\)/);
  assert.match(g, /players see it/);
});

test('board events: the kickoff comes first until it has run', () => {
  const defs = [{ id: 'a', title: 'Alpha', trigger: {}, stages: [{ id: 's' }] }, { id: 'k', title: 'Zed begins', kickoff: true, trigger: {}, stages: [{ id: 's' }] }];
  assert.deepEqual(eventRows(defs, { a: { status: 'running' } }).map((r) => r.id), ['k', 'a']);
  assert.deepEqual(eventRows(defs, { a: { status: 'running' }, k: { status: 'done' } }).map((r) => r.id), ['a', 'k']);
  assert.match(eventDetailHtml(defs[1], {}), /kickoff: narrate it when the party first arrives/);
});
