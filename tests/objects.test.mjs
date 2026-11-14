// Object tokens (board/objects.js) and token art: what each view sees inside, Take to the stash with where it was
// found, the engine never blocking on objects, token art loaded with a campaign (tools/campaign.mjs readArt, board
// records), the adventure importer's campaign builder (tools/advimport/campaign.mjs) and the validator's checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isOpen, objectView, takeFromObject, takeAllFromObject, foundAt } from '../board/objects.js';
import { blockersAt } from '../engine/tokens/occupancy.js';
import { readArt } from '../tools/campaign.mjs';
import { campaignRecords } from '../board/records.js';
import { stableId, buildSave, updateSave } from '../tools/advimport/campaign.mjs';
import { nameProblems } from '../board/names.js';

const chest = {
  system: 'pf2e', kind: 'object', name: 'Oak chest', text: 'Iron-bound.', note: 'DC 15 to find the false bottom',
  items: [{ ref: 'item/dagger', runes: { potency: 1 }, name: '+1 dagger' }, { name: 'Silver ring', price: { gp: 5 } }],
  coins: { gp: 3, sp: 2 }, find_dc: 15, room: 'A4',
};

test('objects: players see inside only once it is open; the GM always does', () => {
  assert.equal(isOpen(chest, {}), false);
  assert.equal(isOpen(chest, { open: true }), true);
  assert.equal(isOpen({ name: 'Shelf', items: [] }, {}), true, 'nothing in the way: open');
  const p = objectView(chest, {}, 'player');
  assert.deepEqual([p.items.length, p.coins, p.note, p.find_dc], [0, null, '', null]);
  const g = objectView(chest, {}, 'gm');
  assert.equal(g.items.length, 2);
  assert.deepEqual(g.coins, { gp: 3, sp: 2 });
  assert.match(g.note, /false bottom/);
  assert.equal(objectView(chest, { open: true }, 'player').items.length, 2);
  assert.equal(objectView({ ...chest, locked: 'Thievery DC 20' }, {}, 'player').locked, 'Thievery DC 20');
});

test('objects: Take moves one item to the stash with where it was found; Take everything empties it', () => {
  const found = foundAt(chest, { name: 'Chest' }, 'level-a', { now: 100 });
  assert.deepEqual(found, { from: 'Oak chest', where: { map: 'level-a', area: 'A4' }, game: { now: 100 } });
  const r = takeFromObject(chest, 0, found, '2026-11-13T00:00:00Z', 'player');
  assert.equal(r.actor.items.length, 1);
  assert.deepEqual([r.stashItem.ref, r.stashItem.name, r.stashItem.runes, r.stashItem.found.from, r.stashItem.added.by], ['item/dagger', '+1 dagger', { potency: 1 }, 'Oak chest', 'player']);
  assert.throws(() => takeFromObject(chest, 9, found));
  const all = takeAllFromObject(chest, found, '2026-11-13T00:00:00Z');
  assert.deepEqual([all.actor.items.length, all.stashItems.length, all.coins, 'coins' in all.actor], [0, 2, { gp: 3, sp: 2 }, false]);
});

test('objects: never block movement and are never blocked', () => {
  const box = { id: 'o', kind: 'object', x: 2, y: 2 }, ogre = { id: 'g', kind: 'foe', x: 2, y: 2 };
  assert.deepEqual(blockersAt({ id: 'p', kind: 'pc' }, 2, 2, [box]), []);
  assert.deepEqual(blockersAt(box, 2, 2, [ogre]), []);
  assert.equal(blockersAt({ id: 'p', kind: 'pc' }, 2, 2, [ogre]).length, 1);
  assert.deepEqual(nameProblems({ 'tok-aaaaaaaa': { name: 'Shadow wall (north)', kind: 'object', x: 0, y: 0 } }), []);
});

test('token art: the save\'s tokens name art the campaign uploads with it; art records reach the board', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-'));
  fs.mkdirSync(path.join(dir, 'art'));
  for (const f of ['rat.webp', 'rat-token.webp']) fs.writeFileSync(path.join(dir, 'art', f), f);
  fs.writeFileSync(path.join(dir, 'art', 'art.json'), JSON.stringify({ rat: { full: 'rat.webp', token: 'rat-token.webp', w: 10, h: 20 }, bat: { full: 'x', token: 'y' } }));
  const images = [];
  const art = readArt(dir, { a: { art: 'rat' }, b: { art: 'rat' }, c: {} }, images);
  assert.deepEqual(Object.keys(art), ['rat'], 'only the art tokens use');
  assert.equal(images.length, 2);
  assert.deepEqual([art.rat.full.w, art.rat.full.h, art.rat.token.asset], [10, 20, null]);
  assert.throws(() => readArt(dir, { a: { art: 'wolf' } }, []), /not in art\/art.json/);
  const r = campaignRecords({ campaign: { id: 'x' }, pack: { id: 'p', ruleset: 'pf2e' }, maps: [], art });
  assert.ok(r['art/rat'] && r['art/rat'].token.fingerprint);
});

test('adventure importer: stable token ids, creatures and objects from adventure.json', () => {
  assert.equal(stableId('a:b:0'), stableId('a:b:0'));
  assert.match(stableId('x'), /^tok-[0-9a-z]{8}$/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-'));
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ id: 'p', ruleset: 'pf2e', maps: ['m'] }));
  fs.writeFileSync(path.join(dir, 'adventure-events.json'), JSON.stringify({ events: [{ id: 'kickoff', kickoff: true, title: 'It begins', pages: '1', trigger: { map: 'm' }, stages: [{ id: 'scene', actions: [{ do: 'narrate', text: 'The scene.' }] }] }] }));
  fs.writeFileSync(path.join(dir, 'adventure.json'), JSON.stringify({
    title: 'T', maps: ['m'], start: { map: 'm' },
    encounters: [{ id: 'e1', map: 'm', room: 'R1', pages: '1', hidden: true, creatures: [
      { name: 'Grey Rat', ref: 'pathfinder-monster-core:creature/giant-rat', at: [3.5, 4.2], art: 'rat' },
      { name: 'Mossy Pedlar', at: [1, 1], npc: true, note: 'merchant' }] },
    { id: 'e2', map: 'm', room: 'R2', pages: '2', friendly: true, creatures: [{ name: 'Ghost', ref: 'pathfinder-monster-core:creature/giant-rat', at: [0, 0] }] }],
    objects: [{ id: 'o1', map: 'm', room: 'R1', at: [2, 2], name: 'Chest', kind: 'container', items: [{ ref: 'item/dagger' }], find_dc: 12 }],
  }));
  const { campaign, maps, actors, problems } = buildSave(dir, { repo: path.resolve('.') });
  assert.deepEqual(problems, []);
  const toks = Object.values(maps.m);
  const rat = toks.find((t) => t.name === 'Grey Rat');
  assert.deepEqual([rat.x, rat.y, rat.hidden, rat.kind, rat.art, rat.group], [3, 4, true, 'foe', 'rat', 'e1']);
  assert.equal(toks.find((t) => t.name === 'Ghost').kind, 'neutral');
  assert.equal(toks.find((t) => t.name === 'Mossy Pedlar').note.startsWith('merchant'), true);
  const chestId = Object.keys(maps.m).find((k) => maps.m[k].name === 'Chest');
  assert.deepEqual([maps.m[chestId].kind, actors[chestId].kind, actors[chestId].find_dc, actors[chestId].room], ['object', 'object', 12, 'R1']);
  assert.equal(Object.values(actors).filter((a) => a.kind === 'npc').length, 2, 'the pedlar has no stat block, so no game data');
  assert.equal(campaign.current_map, 'm');
  assert.match(buildSave(dir, { repo: path.resolve('.') }).warnings.join(), /no landing page/);
  // with a landing page named, the campaign starts there and the page gets its map state
  const adv = JSON.parse(fs.readFileSync(path.join(dir, 'adventure.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'adventure.json'), JSON.stringify({ ...adv, landing: 'cover' }));
  assert.match(buildSave(dir, { repo: path.resolve('.') }).problems.join(), /not a landing page/);
  fs.mkdirSync(path.join(dir, 'maps', 'cover'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'maps', 'cover', 'map.json'), JSON.stringify({ id: 'cover', name: 'Cover', kind: 'landing', image: { file: 'cover.webp', w: 10, h: 10 } }));
  const withCover = buildSave(dir, { repo: path.resolve('.') });
  assert.deepEqual([withCover.problems, withCover.warnings, withCover.campaign.current_map, withCover.campaign.discovered], [[], [], 'cover', ['m']]);
  assert.deepEqual(withCover.maps.cover, {});
});

test('schemas and the board know object tokens and art', () => {
  const s = JSON.parse(fs.readFileSync('schemas/map-state.schema.json', 'utf8'));
  const t = s.properties.tokens.additionalProperties.properties;
  assert.ok(t.art && t.kind.enum.includes('object'));
  const app = fs.readFileSync('board/app.js', 'utf8');
  assert.match(app, /paintDisc/);
  assert.match(app, /objectRender/);
  assert.doesNotMatch(fs.readFileSync('board/objects.js', 'utf8'), /pf2e|Pathfinder/i, 'objects are system-free');
});

test('adventure importer: --update refreshes the pack\'s data and keeps play', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'advup-'));
  const save = path.join(dir, 'save');
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ id: 'p', ruleset: 'pf2e', maps: ['m'] }));
  fs.writeFileSync(path.join(dir, 'adventure-events.json'), JSON.stringify({ events: [{ id: 'kickoff', kickoff: true, title: 'It begins', pages: '1', trigger: { map: 'm' }, stages: [{ id: 'scene', actions: [{ do: 'narrate', text: 'The scene.' }] }] }] }));
  fs.mkdirSync(path.join(dir, 'maps', 'm'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'maps', 'm', 'walls.json'), JSON.stringify({ v: 1, segs: [{ id: 'door01', t: 'door', a: [0, 0], b: [1, 0], door: { id: 'd01' } }] }));
  const adv = (note, extra = []) => ({ title: 'T', maps: ['m'], start: { map: 'm' }, ledger: [{ kind: 'thread', text: 'A thread' }],
    encounters: [{ id: 'e1', map: 'm', room: 'R1', pages: '1', creatures: [{ name: 'Grey Rat', ref: 'pathfinder-monster-core:creature/giant-rat', at: [3, 4], note }, ...extra] }],
    objects: [{ id: 'o1', map: 'm', room: 'R1', at: [2, 2], name: 'Chest', kind: 'container', items: [{ ref: 'item/dagger' }, { name: 'Rope' }], find_dc: 12 }] });
  fs.writeFileSync(path.join(dir, 'adventure.json'), JSON.stringify(adv('old note')));
  const first = buildSave(dir, { repo: path.resolve('.') });
  // write the save as the tool does, then play: the rat moves and dies, a PC joins, a door opens, the rope is taken
  const w = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d)); };
  w(path.join(save, 'campaign.json'), { ...first.campaign, current_map: 'm', clock: { now: 99 } });
  const rat = Object.keys(first.maps.m).find((k) => first.maps.m[k].name === 'Grey Rat');
  const chest = Object.keys(first.maps.m).find((k) => first.maps.m[k].name === 'Chest');
  const tokens = { ...first.maps.m, [rat]: { ...first.maps.m[rat], x: 7, y: 7, dead: true }, 'tok-pc000001': { name: 'Kerra', kind: 'pc', x: 1, y: 1 } };
  w(path.join(save, 'maps', 'm.json'), { map: 'm', tokens, doors: { d01: { state: 'open' }, gone: { state: 'open' } } });
  for (const [id, a] of Object.entries(first.actors)) w(path.join(save, 'actors', `${id}.json`), id === chest ? { ...a, items: [a.items[0]] } : a);
  w(path.join(save, 'ledger.json'), { entries: [...first.ledger, { id: 'x', kind: 'ruling', text: 'Mine', by: 'gm' }] });
  // the pack changes: a new note, a new creature
  fs.writeFileSync(path.join(dir, 'adventure.json'), JSON.stringify(adv('new note', [{ name: 'Second Rat', ref: 'pathfinder-monster-core:creature/giant-rat', at: [5, 5] }])));
  const u = updateSave(dir, save, { repo: path.resolve('.') });
  assert.deepEqual(u.problems, []);
  const t = u.maps.m.tokens;
  assert.deepEqual([t[rat].x, t[rat].y, t[rat].dead, t[rat].source, String(u.actors[rat].note).startsWith('new note')], [7, 7, true, 'adventure', true], 'play kept, the note refreshed');
  assert.ok(t['tok-pc000001'], 'the PC stays');
  assert.ok(Object.values(t).some((x) => x.name === 'Second Rat'), 'the new creature arrives');
  assert.deepEqual(u.maps.m.doors, { d01: { state: 'open' } }, 'a door no longer on the map loses its state');
  assert.deepEqual(u.actors[chest].items.map((i) => i.ref || i.name), ['item/dagger'], 'taken loot stays taken');
  assert.equal(u.campaign.clock.now, 99);
  assert.equal(u.ledger, null, 'no new adventure entries: the ledger is left alone');
  assert.ok(u.report.some((r) => /Second Rat/.test(r)));
});
