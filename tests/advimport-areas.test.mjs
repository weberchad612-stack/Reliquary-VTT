// The area checklist (tools/advimport/areas.mjs, with rulesets/pf2e/bookimport.js areaFacts): areas split from the
// book's text, what each asks for, and what the pack is missing. All text here is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { splitAreas, packIndex, checkArea } from '../tools/advimport/areas.mjs';
import { areaFacts, parseBlocks } from '../rulesets/pf2e/bookimport.js';
import { spawnSync } from 'node:child_process';

const PAGES = [
  { page: 3, text: 'Adventure overview\nX1. Mossy Gate (page 4)\nX2. Lantern Hall (page 5)\n' },
  { page: 4, text: 'X1. MOSSY GATE\nX1. Mossy Gate\nThe iron door to the north is locked; a hero can open it with a DC 18 Thievery check.\nThe room is dark. Rubble makes the floor difficult terrain.\nTHE MOSSY HALLS 4\n' },
  { page: 5, text: 'X2. Lantern Hall\nBraziers burn here, filling the hall with bright light.\nTreasure\nA small copper ring lies on the altar.\nX2a: A tiny alcove with nothing in it.\n' },
];

test('area checklist: areas start at title-case headings; lists of areas and captions do not start one', () => {
  const a = splitAreas(PAGES, { skip: /^THE MOSSY HALLS/ });
  assert.deepEqual(Object.keys(a), ['X1', 'X2', 'X2a']);
  assert.deepEqual(a.X1.pages, [4]);
  assert.ok(!/Adventure overview/.test(a.X1.text));
  assert.ok(!/MOSSY HALLS/.test(a.X1.text), 'running heads skipped');
});

test('area checklist: the PF2E reader finds checks, doors, light, terrain and treasure', () => {
  const a = splitAreas(PAGES);
  const f = (k) => areaFacts(a[k].text).map((x) => [x.kind, x.kind === 'dc' ? x.dc : x.what || x.level || (x.source ? 'source' : '')].join(':'));
  assert.deepEqual(f('X1').sort(), ['dc:18', 'door:locked', 'light:dark', 'terrain:difficult'].sort());
  assert.deepEqual(f('X2').sort(), ['light:bright', 'light:source', 'treasure:'].sort());
  assert.equal(areaFacts('The scamp has Speed 20 feet, swim 30 feet; AC 16; HP 20.').length, 0, 'stat block lines are not the room');
});

test('area checklist: what the pack lacks is listed, with proposals; explained items are not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'areas-'));
  const put = (f, d) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), typeof d === 'string' ? d : JSON.stringify(d)); };
  put('pack.json', { id: 'demo', ruleset: 'pf2e', maps: ['m'] });
  put('maps/m/map.json', { id: 'm', base_light: 'dark', grid: { feet_per_cell: 5 } });
  put('maps/m/rooms.json', { rooms: { X1: { at: [1, 1], rects: [[0, 0, 4, 4]] }, X2: { at: [6, 1], rects: [[5, 0, 4, 4]] }, X2a: { at: [6, 5], rects: [[5, 4, 1, 1]] } } });
  put('maps/m/walls.json', { segs: [{ id: 'door01', t: 'door', a: [1, 4], b: [2, 4], door: { id: 'd01' } }] });
  put('maps/m/lighting.json', { lights: [{ id: 'braziers', at: [7, 2], bright: 10, dim: 0, room: 'X2' }] });
  put('notes/m.md', '## X1. Mossy Gate\n- door north: locked, DC 18 Thievery\n## X2. Lantern Hall\n- treasure: a copper ring\n');
  put('adventure.json', { encounters: [], objects: [] });
  const { idx } = packIndex(dir);
  const a = splitAreas(PAGES);
  const x1 = checkArea(a.X1, areaFacts(a.X1.text), [], idx);
  assert.deepEqual(x1.missing.map((m) => m.what.split(',')[0]).sort(), ['a locked door', 'difficult terrain in the text'].sort());
  assert.deepEqual(x1.proposals.map((p) => p.section).sort(), ['doors', 'terrain.areas']);
  assert.deepEqual(x1.proposals.find((p) => p.section === 'doors').entry.near, [1.5, 4]);
  const x2 = checkArea(a.X2, areaFacts(a.X2.text), [], idx);
  assert.deepEqual(x2.missing, [], 'bright light from the braziers reaches the room; the treasure is in the notes');
  const ok = checkArea(a.X1, areaFacts(a.X1.text), [], idx, [{ area: 'X1', match: 'difficult terrain', why: 'rubble is drawn only' }, { area: 'X1', match: 'locked door', why: 'checked' }]);
  assert.deepEqual(ok.missing, []);
  assert.ok(ok.done.some((d) => /explained: rubble is drawn only/.test(d)));
  const blocks = parseBlocks('X1. Mossy Gate\nMOSS TROLL\nPerception +5\nAC 14; HP 30\n', 4);
  assert.match(checkArea(a.X1, [], blocks, idx).missing[0].what, /stat block MOSS TROLL/);
});

test('area checklist: a check the text calls for with no DC asks for the level-based DC', () => {
  const nodc = (t) => areaFacts(t).filter((x) => x.kind === 'nodc').map((x) => x.what);
  assert.deepEqual(nodc('A hero who succeeds at a Thievery check opens the hidden latch.'), ['Thievery']);
  assert.deepEqual(nodc('A hero can attempt an Athletics check to climb the wall. The DC is 20.'), [], 'the DC comes next');
  assert.deepEqual(nodc('A hero can attempt a DC 18 Athletics check to climb.'), []);
  assert.deepEqual(nodc('The ogre attempts a +9 Athletics check to Shove.'), [], 'a creature\'s own modifier');
  assert.deepEqual(nodc('Heroes take a -1 penalty to Stealth checks here.'), [], 'a penalty, not a check');
  const idx = { rooms: { X1: { map: 'm', at: [1, 1], rects: [[0, 0, 4, 4]] } }, notes: { X1: '## X1' }, encounters: {}, objects: {}, doors: {}, light: {}, lights: {}, terrain: {}, mapLights: {}, base: {}, fpc: { m: 5 }, events: {} };
  const area = { key: 'X1', pages: [4], text: 'A hero who succeeds at a Thievery check opens the hidden latch.' };
  assert.match(checkArea(area, areaFacts(area.text), [], idx).missing[0].what, /Thievery check with no DC.*level-based DC/);
  idx.notes.X1 = '## X1\n- the latch: Thievery DC 16 (the book gives none; level-based DC for party level 2)';
  assert.deepEqual(checkArea(area, areaFacts(area.text), [], idx).missing, []);
});

test('area checklist: events in the text, found and checked against adventure.json events', () => {
  const kinds = (t) => areaFacts(t).filter((x) => x.kind === 'event').map((x) => x.what);
  assert.deepEqual(kinds('At night the bell tolls across the yard.'), ['timed']);
  assert.deepEqual(kinds('Two more guards arrive as reinforcements on the third round.'), ['combat']);
  assert.deepEqual(kinds('Once the heroes defeat the ogre, the gate opens.'), ['trigger']);
  assert.deepEqual(kinds('The party earns Victory Points for each success.'), ['challenge']);
  assert.deepEqual(kinds('INFLUENCE 3\nThe mayor listens.'), ['influence']);
  // not events: room entry, read-aloud cues, rules text about rounds and dying
  assert.deepEqual(kinds('When the heroes enter the room, read the following aloud.'), []);
  assert.deepEqual(kinds('When the heroes open the door, read the following aloud.'), []);
  assert.deepEqual(kinds('Each round, every hero and monster gets one turn. When a monster is reduced to 0 Hit Points, it is removed.'), []);
  const idx = { rooms: { X1: { map: 'm', at: [1, 1], rects: [[0, 0, 4, 4]] } }, notes: { X1: '## X1' }, encounters: {}, objects: {}, doors: {}, light: {}, lights: {}, terrain: {}, mapLights: {}, base: {}, fpc: { m: 5 }, events: {} };
  const area = { key: 'X1', pages: [4], text: 'Once the heroes defeat the ogre, the gate opens.' };
  const miss = checkArea(area, areaFacts(area.text), [], idx);
  assert.match(miss.missing[0].what, /a trigger event in the text, and no event/);
  assert.equal(miss.proposals[0].section, 'events');
  assert.deepEqual(miss.proposals[0].entry.where, { map: 'm', area: 'X1' });
  idx.events.X1 = [{ id: 'gate-opens' }];
  const ok = checkArea(area, areaFacts(area.text), [], idx);
  assert.deepEqual(ok.missing, []);
  assert.ok(ok.done.includes('event (gate-opens)'));
});

test('area checklist: a book with capital headings (--caps-headings), its own room names, and explainable room tables', () => {
  const caps = splitAreas([{ page: 7, text: 'Q1. OLD MILL\nThe millstone is cracked.\nQ2. GRAIN LOFT\nA hatch leads up.\n' }], { caps: true });
  assert.deepEqual(Object.keys(caps), ['Q1', 'Q2']);
  assert.deepEqual(Object.keys(splitAreas([{ page: 7, text: 'Q1. OLD MILL\nx\n' }])), [], 'without the option a capital heading is a caption');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'areas-caps-'));
  const put = (f, d) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), typeof d === 'string' ? d : JSON.stringify(d)); };
  put('pack.json', { id: 'demo', ruleset: 'pf2e', maps: ['farm'] });
  put('maps/farm/map.json', { id: 'farm', grid: { feet_per_cell: 5 } });
  put('maps/farm/rooms.json', { rooms: { 'barn-loft': { at: [1, 1], rects: [[0, 0, 2, 2]] } } });
  put('notes/n.md', '### Q1. Old Mill\n- a cracked millstone\n');
  put('adventure.json', { encounters: [], objects: [] });
  const { idx } = packIndex(dir);
  const q1 = checkArea(caps.Q1, [], [], idx);
  assert.deepEqual(q1.missing.map((m) => m.what), ["not in any map's room table (rooms.json)"]);
  assert.deepEqual(checkArea(caps.Q1, [], [], idx, [{ area: 'Q1', match: 'room table', why: 'a pin on the town map' }]).missing, [], 'a room-table item can be explained');
  const out = spawnSync(process.execPath, ['tools/advimport/areas.mjs', dir, writePages(dir), '--caps-headings'], { encoding: 'utf8' });
  assert.ok(!/barn-loft/.test(out.stdout), "Claude's own room names are not looked for in the text");
});

function writePages(dir) {
  const t = path.join(dir, 'text'); fs.mkdirSync(t, { recursive: true });
  fs.writeFileSync(path.join(t, 'p007.txt'), 'Q1. OLD MILL\nThe millstone is cracked.\n');
  return t;
}
