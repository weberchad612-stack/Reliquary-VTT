// tools/events.mjs: the context from the game, due events, running stages, decisions, flags; the encounter's end
// setting ended:<group> flags.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGame } from '../tools/actor.mjs';
import { runEvents, eventContext, partyLevel } from '../tools/events.mjs';
import { runEncounter } from '../tools/encounter.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'examples/sample-pack'), SAVE = path.join(ROOT, 'examples/campaigns/keep-test');

// a pack folder with only what the context reads: the keep's rooms (Lyra stands at 2,18) and whether it is outdoors
function roomsPack(outdoor = false) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'evt-'));
  fs.mkdirSync(path.join(d, 'maps/sample-keep'), { recursive: true });
  fs.writeFileSync(path.join(d, 'maps/sample-keep/rooms.json'), JSON.stringify({ v: 1, rooms: { W1: { title: 'West yard', rects: [[0, 15, 5, 6]] }, S1: { title: 'Path', rects: [[20, 44, 6, 4]], outdoor: true } } }));
  fs.writeFileSync(path.join(d, 'maps/sample-keep/map.json'), JSON.stringify({ id: 'sample-keep', outdoor }));
  return d;
}

// an invented event in the shape the books use (future/adventure-events.md)
const EVENT = {
  title: 'The bell at dusk', pages: '1',
  trigger: { all: [{ level: { min: 1 } }, { area: 'S1' }, { flag: 'bell' }] },
  stages: [
    { id: 'toll', actions: [{ do: 'narrate', text: 'A bell tolls.' }, { do: 'flag', name: 'tolled' }, { do: 'decision', id: 'ally', question: 'Does the guard help?', options: ['yes', 'no'] }] },
    { id: 'fight', when: { flag: 'tolled' }, actions: [{ do: 'encounter', group: 'tower' }, { do: 'ledger', kind: 'quest', title: 'Silence the bell', text: 'The party was asked to silence it.', status: 'open' }] },
    { id: 'after', when: { encounter_ended: 'tower' }, actions: [{ do: 'xp', amount: 30 }] },
  ],
  repeat: { cooldown: 86400 },
  status: 'waiting',
};

const game = () => { const g = loadGame(PACK, SAVE); g.events = { bell: structuredClone(EVENT) }; g.flags = {}; return g; };

test('events tool: the context reads the party from the board', () => {
  const g = game(), p = roomsPack();
  const ctx = eventContext(g, p);
  assert.equal(ctx.party.map, 'sample-keep');
  assert.deepEqual(ctx.party.areas.sort(), ['S1', 'W1']);
  assert.equal(ctx.party.outdoors, true);          // Kerra is on the outdoor path
  assert.equal(ctx.level, partyLevel(g));
  assert.ok(Number.isFinite(ctx.level));
  assert.equal(ctx.encounter.active, false);
  assert.equal(eventContext(g, roomsPack(true)).party.outdoors, true);
});

test('events tool: due, tick through the stages, decide, the fight ending, finish and cooldown', () => {
  const g = game(), p = roomsPack();
  assert.match(runEvents(g, p, 'due').lines.join('\n'), /Nothing due/);
  const f = runEvents(g, p, 'flag', ['bell']);
  assert.deepEqual(g.flags, { bell: true });
  assert.ok(f.writes.some((w) => w.path === 'state/flags'));
  assert.match(f.lines.join('\n'), /Now due: bell/);
  // tick: starts, the stage's flag makes the fight stage due, so it moves on in the same tick
  const t = runEvents(g, p, 'tick');
  const text = t.lines.join('\n');
  assert.match(text, /Started bell/);
  assert.match(text, /Narrate: A bell tolls/);
  assert.match(text, /Decide ally/);
  assert.match(text, /Moved bell to fight/);
  assert.match(text, /Start the encounter tower/);
  assert.equal(g.events.bell.status, 'running');
  assert.equal(g.events.bell.stage, 'fight');
  assert.equal(g.flags.tolled, true);
  assert.ok(t.writes.some((w) => w.path.startsWith('ledger/') && w.data.kind === 'quest' && w.data.source === 'adventure'));
  assert.ok(t.writes.some((w) => w.path === 'events/bell' && w.data.title === 'The bell at dusk'));
  const d = runEvents(g, p, 'decide', ['bell', 'ally', 'no,', 'he', 'flees']);
  assert.equal(g.events.bell.decisions.ally, 'no, he flees');
  assert.ok(d.writes.some((w) => w.path.startsWith('ledger/') && /he flees/.test(w.data.text)));
  // the fight: the encounter tool's end sets ended:tower, which the last stage waits on
  let e = runEncounter(g, 'start', []);
  e = runEncounter(g, 'add', ['Sleepy-Eyed Guard']); runEncounter(g, 'add', ['Kerra']);
  runEncounter(g, 'init', ['Sleepy-Eyed Guard', '20']); runEncounter(g, 'init', ['Kerra', '10']);
  runEncounter(g, 'begin', []);
  assert.equal(eventContext(g, p).encounter.active, true);
  assert.deepEqual(eventContext(g, p).encounter.groups, ['tower']);
  assert.equal(eventContext(g, p).encounter.acting.group, 'tower');
  e = runEncounter(g, 'end', []);
  assert.ok(e.writes.some((w) => w.path === 'state/flags' && w.data['ended:tower'] !== undefined));
  assert.match(runEvents(g, p, 'due').lines.join('\n'), /bell: moves to after/);
  assert.match(runEvents(g, p, 'tick').lines.join('\n'), /Award 30 XP/);
  const n = runEvents(g, p, 'next', ['bell']);
  assert.match(n.lines.join('\n'), /may happen again/);
  assert.equal(g.events.bell.status, 'cooldown');
  assert.match(runEvents(g, p, 'status').lines.join('\n'), /bell {2}cooldown, ran 1x/);
  assert.match(runEvents(g, p, 'status', ['bell']).lines.join('\n'), /decided ally: no, he flees/);
  // cooling: not due again before its day is out
  assert.match(runEvents(g, p, 'due').lines.join('\n'), /Nothing due/);
});

test('events tool: run by hand, go, reset, errors', () => {
  const g = game(), p = roomsPack();
  assert.match(runEvents(g, p, 'run', ['bell', 'fight']).lines.join('\n'), /Started bell[\s\S]*fight/);
  assert.throws(() => runEvents(g, p, 'run', ['bell']), /is running/);
  runEvents(g, p, 'go', ['bell', 'after']);
  assert.equal(g.events.bell.stage, 'after');
  assert.throws(() => runEvents(g, p, 'go', ['bell', 'nowhere']), /no stage/);
  runEvents(g, p, 'reset', ['bell']);
  assert.equal(g.events.bell.status, 'waiting');
  assert.equal(g.events.bell.stage, undefined);
  assert.throws(() => runEvents(g, p, 'run', ['nope']), /no event/);
  runEvents(g, p, 'flag', ['count', '3']); runEvents(g, p, 'unflag', ['bell']);
  assert.deepEqual(g.flags, { count: 3 });
});
