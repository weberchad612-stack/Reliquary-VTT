// Sound (engine/sound/sound.js, board/sound.js): shuffle bags and the shared music timeline, the mood, how a sound
// is heard (falloff, pan, walls), day and night sources; the files for effects and cues; the music and ambient
// records; the boss check with the PF2E rule (rulesets/pf2e/sound.js); who is listening; the ambient mix; the Sound
// tab's HTML (board/soundui.js); Claude's tool (tools/sound.mjs); the save (board/records.js, schemas); the board
// code free of the system.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { bagIndex, musicAt, chooseMood, falloff, hearing, activeAt, screenPan, pickVariant, seeded, CROSSFADE, MUFFLE, SoundMixer, DEFAULT_VOLUMES } from '../engine/sound/sound.js';
import { effectSound, cueSound, stingSound, moodsIn, musicRecord, encounterFacts, ambientRecord, listeners, ambientMix, diceCue, soundRules, PLAIN_SOUND, CUES, nowPlaying, soundPrefs } from '../board/sound.js';
import { mixerHtml, musicHtml, ambientHtml } from '../board/soundui.js';
import { PF2E_SOUND } from '../rulesets/pf2e/sound.js';
import { PF2E_SYSTEM } from '../rulesets/pf2e/system.js';
import { runSound } from '../tools/sound.mjs';
import { loadGame } from '../tools/actor.mjs';
import { campaignRecords, saveFromRecords } from '../board/records.js';
import { readCampaign, roundTrip, SAVE_COLLECTIONS } from '../tools/campaign.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MAN = {
  fx: { strike_slash: { impact: 0.16, hit: [{ file: 'fx/s-hit-1.mp3' }, { file: 'fx/s-hit-2.mp3' }], crit: [{ file: 'fx/s-crit-1.mp3' }], miss: [{ file: 'fx/s-miss-1.mp3' }] }, heal: { impact: 0, hit: [{ file: 'fx/heal-1.mp3' }] } },
  cues: { cue_dice: { impact: 0, hit: [{ file: 'cue/dice-1.mp3' }] } },
  ambient: { campfire: { file: 'ambient/campfire.mp3', secs: 30, loop: true }, river: { file: 'ambient/river.mp3', secs: 30, loop: true } },
  music: { explore: [{ file: 'music/explore-1.mp3', secs: 100, title: 'A' }, { file: 'music/explore-2.mp3', secs: 80, title: 'B' }], combat: [{ file: 'music/combat-1.mp3', secs: 90 }] },
  stings: { victory: [{ file: 'music/sting-victory-1.mp3' }] },
};

test('shuffle bags: every piece once per bag, never the same twice in a row, the same order for a seed', () => {
  for (const n of [2, 3, 5, 8]) {
    const seq = [...Array(n * 6).keys()].map((k) => bagIndex(n, 'seed-x', k));
    for (let b = 0; b < 6; b++) assert.deepEqual([...seq.slice(b * n, b * n + n)].sort((a, c) => a - c), [...Array(n).keys()], `bag ${b} of ${n}`);
    for (let k = 1; k < seq.length; k++) assert.notEqual(seq[k], seq[k - 1], `no repeat at ${k} (n ${n})`);
    assert.deepEqual(seq, [...Array(n * 6).keys()].map((k) => bagIndex(n, 'seed-x', k)));
  }
  assert.equal(bagIndex(1, 's', 7), 0);
  assert.equal(bagIndex(0, 's', 0), -1);
  assert.notDeepEqual([...Array(8).keys()].map((k) => bagIndex(8, 'a', k)), [...Array(8).keys()].map((k) => bagIndex(8, 'b', k)));
  const r = seeded('x'); assert.ok(r() >= 0 && r() < 1);
});

test('the music timeline: every screen works out the same piece and place from one record; pieces overlap by the crossfade', () => {
  const pieces = MAN.music.explore, rec = { since: 1000, seed: 's' };
  const a = musicAt(pieces, rec, 1000);
  assert.equal(a.k, 0); assert.equal(a.offset, 0);
  const first = pieces[a.index], step = first.secs - CROSSFADE;
  const b = musicAt(pieces, rec, 1000 + (step - 1) * 1000);
  assert.equal(b.k, 0); assert.ok(Math.abs(b.offset - (step - 1)) < 1e-9);
  const c = musicAt(pieces, rec, 1000 + (step + 2) * 1000);
  assert.equal(c.k, 1); assert.ok(Math.abs(c.offset - 2) < 1e-9); assert.notEqual(c.index, a.index);
  assert.equal(musicAt([], rec, 5), null);
  assert.equal(musicAt(pieces, null, 5), null);
  assert.ok(musicAt(pieces, rec, 0).offset === 0, 'a screen whose clock is behind starts at the beginning');
});

test('the mood: an override first, then the encounter (boss by the rule or the switch), then the map\'s theme, else exploring', () => {
  assert.equal(chooseMood({}).mood, 'explore');
  assert.equal(chooseMood({ theme: 'town' }).mood, 'town');
  assert.equal(chooseMood({ encounter: true, theme: 'town' }).mood, 'combat');
  assert.equal(chooseMood({ encounter: true, boss: true }).mood, 'boss');
  assert.equal(chooseMood({ encounter: true, boss: true, bossOverride: false }).mood, 'combat');
  assert.equal(chooseMood({ encounter: true, boss: false, bossOverride: true }).mood, 'boss');
  assert.equal(chooseMood({ override: 'tension', encounter: true }).mood, 'tension');
  assert.equal(chooseMood({ override: 'silence' }).mood, 'silence');
  assert.equal(chooseMood({ override: 'auto', encounter: true }).mood, 'combat');
  assert.match(chooseMood({ encounter: true }).why, /encounter/);
});

test('hearing: falloff with distance, pan by side, walls muffle, the loudest listener wins', () => {
  const f0 = falloff({ x: 0, y: 0 }, { x: 0.5, y: 0 }, { radius: 6, inner: 1 });
  assert.equal(f0.gain, 1);
  const f1 = falloff({ x: 0, y: 0 }, { x: 3, y: 0 }, { radius: 6, inner: 1 });
  assert.ok(f1.gain > 0 && f1.gain < 1); assert.ok(f1.pan < 0, 'a sound to the left pans left');
  assert.equal(falloff({ x: 0, y: 0 }, { x: 7, y: 0 }, { radius: 6 }).gain, 0);
  assert.ok(falloff({ x: 0, y: 0 }, { x: 3, y: 0 }, { radius: 6, curve: 'linear' }).gain > f1.gain);
  const near = { x: 1, y: 0 }, far = { x: 4, y: 0 }, src = { x: 0, y: 0 };
  const h = hearing(src, [far, near], { radius: 6, inner: 0.5 });
  assert.equal(h.listener, 1); assert.equal(h.muffled, false);
  const wall = (s, l) => l === near;   // a wall between the source and the near listener only
  const hw = hearing(src, [far, near], { radius: 6, inner: 0.5 }, wall);
  const plainFar = falloff(src, far, { radius: 6, inner: 0.5 }).gain, mufNear = falloff(src, near, { radius: 6, inner: 0.5 }).gain * MUFFLE.gain;
  assert.equal(hw.listener, plainFar > mufNear ? 0 : 1);
  assert.equal(hearing(src, [near], {}, () => true).muffled, true);
  assert.equal(hearing(src, [], {}).listener, -1);
  assert.equal(screenPan(0, 100), -0.6); assert.equal(screenPan(100, 100), 0.6); assert.equal(screenPan(50, 100), 0);
  assert.ok(activeAt('day', 12) && !activeAt('day', 23) && activeAt('night', 2) && !activeAt('night', 10) && activeAt('always', 3) && activeAt('night', null));
  assert.equal(pickVariant([1, 2, 3], 0.99), 3); assert.equal(pickVariant([], 0.5), null);
});

test('files for effects, cues and stings; the moods with music', () => {
  assert.equal(effectSound(MAN, 'strike_slash', 'crit').file, 'fx/s-crit-1.mp3');
  const spr = { fx: { s: { impact: 0.2, hit: [{ file: 'fx/s.mp3', start: 0, secs: 1 }], crit: [{ file: 'fx/s.mp3', start: 1.3, secs: 1.1 }] } }, cues: { cue_x: { hit: [{ file: 'cue/x.mp3', start: 2.5, secs: 0.4 }] } } };
  assert.deepEqual(effectSound(spr, 's', 'crit'), { file: 'fx/s.mp3', impact: 0.2, secs: 1.1, start: 1.3 }, 'a sprite: one file, each sound\'s start and length');
  assert.deepEqual(cueSound(spr, 'cue_x'), { file: 'cue/x.mp3', start: 2.5, secs: 0.4 });
  assert.equal(effectSound(MAN, 'strike_slash', 'hit', 0.99).file, 'fx/s-hit-2.mp3');
  assert.equal(effectSound(MAN, 'strike_slash', 'miss').impact, 0.16);
  assert.equal(effectSound(MAN, 'heal', 'crit').file, 'fx/heal-1.mp3', 'an effect with one sound plays it for every result');
  assert.equal(effectSound(MAN, 'nope'), null);
  assert.equal(effectSound(null, 'heal'), null);
  assert.equal(cueSound(MAN, 'cue_dice').file, 'cue/dice-1.mp3');
  assert.equal(cueSound(MAN, 'cue_nope'), null);
  assert.equal(stingSound(MAN, 'victory').file, 'music/sting-victory-1.mp3');
  assert.deepEqual(moodsIn(MAN), ['explore', 'combat']);
  assert.equal(nowPlaying({}, 'silence'), 'Silence');
  assert.match(nowPlaying({}, 'explore', { title: 'A' }), /A: Exploring/);
});

test('the music record: moods checked, a new mood or Next starts a new run, the boss switch and maps\' themes', () => {
  const r0 = musicRecord(null, { mood: 'town' }, { now: 1000, by: 'gm' });
  assert.equal(r0.mood, 'town'); assert.equal(r0.since, 1000); assert.equal(r0.by, 'gm');
  const r1 = musicRecord(r0, { boss: true }, { now: 2000 });
  assert.equal(r1.boss, true); assert.equal(r1.since, 1000, 'the boss switch alone keeps the run');
  const r2 = musicRecord(r1, { restart: true }, { now: 3000 });
  assert.equal(r2.since, 3000); assert.notEqual(r2.seed, r1.seed);
  const r3 = musicRecord(r2, { theme: { map: 'town-map', mood: 'town' } }, { now: 4000 });
  assert.deepEqual(r3.themes, { 'town-map': 'town' });
  assert.deepEqual(musicRecord(r3, { theme: { map: 'town-map', mood: null } }).themes, {});
  const p1 = musicRecord(r3, { paused: true }, { now: 10000 });
  assert.deepEqual(p1.paused, { at: 10000 }); assert.equal(p1.since, r3.since);
  assert.deepEqual(musicRecord(p1, { paused: true }, { now: 12000 }).paused, { at: 10000 }, 'pausing twice keeps the first time');
  const p2 = musicRecord(p1, { paused: false }, { now: 16000 });
  assert.ok(!p2.paused); assert.equal(p2.since, r3.since + 6000, 'resuming moves the run on by the pause, so the piece carries on');
  const pieces = [{ file: 'a', secs: 100 }, { file: 'b', secs: 100 }];
  assert.deepEqual(musicAt(pieces, p2, 16000).offset, musicAt(pieces, r3, 10000).offset);
  assert.deepEqual(musicRecord(p1, { mood: 'town' }, { now: 20000 }).paused, { at: 20000 }, 'a new mood while paused stays paused');
  assert.match(nowPlaying({ paused: { at: 1 } }, 'explore', { title: 'A' }), /^Paused: A/);
  assert.throws(() => musicRecord(null, { mood: 'disco' }), /mood/);
  assert.throws(() => musicRecord(null, { boss: 'yes' }), /boss/);
  assert.throws(() => musicRecord(null, { theme: { mood: 'town' } }), /map/);
});

test('the boss check (PF2E): a unique creature or one 2+ levels above the party; characters never; a system without the rule never', () => {
  assert.equal(PF2E_SOUND.isBoss({ level: 5, traits: [] }, 3), true);
  assert.equal(PF2E_SOUND.isBoss({ level: 4, traits: [] }, 3), false);
  assert.equal(PF2E_SOUND.isBoss({ level: 1, traits: ['unique', 'human'] }, 3), true);
  assert.equal(PF2E_SOUND.isBoss({ kind: 'character', level: 9, traits: ['unique'] }, 3), false);
  assert.equal(PF2E_SOUND.isBoss({ level: 9 }, null), false, 'no party level: only unique creatures');
  assert.equal(PF2E_SYSTEM.sound, PF2E_SOUND);
  assert.equal(soundRules({}), PLAIN_SOUND);
  const enc = { round: 1, started: 1, combatants: [{ token: 'k', side: 'pc' }, { token: 'o', side: 'foe' }, { token: 'g', side: 'foe' }] };
  const actors = { k: { kind: 'character', level: 2 }, o: { level: 3, name: 'Ogre' }, g: { level: 5, name: 'Giant' } };
  const tokens = { k: { kind: 'pc', name: 'Kerra' }, o: { kind: 'npc', name: 'Ogre' }, g: { kind: 'npc', name: 'Giant' } };
  const f = encounterFacts(enc, actors, PF2E_SOUND, tokens);
  assert.equal(f.encounter, true); assert.equal(f.boss, true); assert.equal(f.who, 'Giant'); assert.match(f.why, /level 5, the party 2/);
  assert.equal(encounterFacts(enc, actors, PF2E_SOUND, { ...tokens, g: { ...tokens.g, dead: true } }).boss, false, 'a dead boss no longer counts');
  assert.equal(encounterFacts(enc, actors, PLAIN_SOUND, tokens).boss, false);
  assert.equal(encounterFacts({ ...enc, round: 0 }, actors, PF2E_SOUND, tokens).encounter, false, 'an encounter not yet begun is not running');
  assert.equal(encounterFacts(null, {}, PF2E_SOUND).encounter, false);
});

test('ambient records: checked against the sound set; radius, when, volume, inner', () => {
  const d = ambientRecord({ map: 'm', sound: 'campfire', at: [3.333, 4], radius: 25, when: 'night', volume: 0.5, inner: 5, label: 'Fire' }, { man: MAN });
  assert.deepEqual(d, { map: 'm', sound: 'campfire', at: [3.33, 4], radius: 25, when: 'night', by: 'claude', inner: 5, volume: 0.5, label: 'Fire' });
  assert.throws(() => ambientRecord({ map: 'm', sound: 'lava', at: [1, 1] }, { man: MAN }), /no ambient loop "lava"/);
  assert.throws(() => ambientRecord({ map: 'm', sound: 'campfire', at: [1] }), /at is/);
  assert.throws(() => ambientRecord({ map: 'm', sound: 'campfire', at: [1, 1], radius: -3 }), /radius/);
  assert.throws(() => ambientRecord({ map: 'm', sound: 'campfire', at: [1, 1], when: 'noon' }), /when/);
  assert.throws(() => ambientRecord({ map: 'm', sound: 'campfire', at: [1, 1], radius: 10, inner: 20 }), /inner/);
  assert.throws(() => ambientRecord({ sound: 'campfire', at: [1, 1] }), /map/);
});

test('who listens: one selected token (a player only one they can see); else the party for players; the screen for the GM', () => {
  const tokens = { k: { kind: 'pc', name: 'Kerra' }, p: { kind: 'pc', name: 'Pip' }, o: { kind: 'npc', name: 'Ogre' }, d: { kind: 'pc', name: 'Dead', dead: true } };
  const centreOf = (id) => ({ k: { x: 1, y: 1 }, p: { x: 5, y: 5 }, o: { x: 9, y: 9 }, d: { x: 0, y: 0 } }[id]);
  const base = { tokens, centre: { x: 20, y: 20 }, centreOf, seen: (id) => id !== 'o' };
  assert.deepEqual(listeners({ ...base, view: 'player', selected: 'k' }).points, [{ x: 1, y: 1 }]);
  assert.deepEqual(listeners({ ...base, view: 'player', selected: 'o' }).points, [{ x: 1, y: 1 }, { x: 5, y: 5 }], 'an unseen token is not a listener: back to the party');
  assert.deepEqual(listeners({ ...base, view: 'gm', selected: 'o' }).points, [{ x: 9, y: 9 }]);
  const gm = listeners({ ...base, view: 'gm', selected: null });
  assert.deepEqual(gm.points, [{ x: 20, y: 20 }]); assert.equal(gm.walls, false);
  const party = listeners({ ...base, view: 'player', selected: null });
  assert.equal(party.points.length, 2, 'the dead are not listening'); assert.equal(party.walls, true);
});

test('the ambient mix: this map\'s sources, on and visible to the view, active at the hour, each heard from the listeners', () => {
  const lis = { points: [{ x: 0, y: 0 }], walls: true };
  const src = (id, d) => ({ id, data: { map: 'm', radius: 30, when: 'always', ...d } });
  const list = [src('a', { sound: 'campfire', at: [1, 0] }), src('b', { sound: 'river', at: [20, 0] }), src('c', { sound: 'campfire', at: [1, 0], when: 'day' }),
    src('d', { sound: 'campfire', at: [1, 0], off: true }), src('e', { sound: 'campfire', at: [1, 0], gm_only: true }), src('f', { sound: 'campfire', at: [1, 0], map: 'other' }),
    src('g', { sound: 'nope', at: [1, 0] }), src('h', { sound: 'campfire', at: [1, 0], volume: 0.5 })];
  const o = { map: 'm', view: 'player', hour: 23, feetPerCell: 5, man: MAN, hear: hearing, blocked: () => false, activeAt };
  const mix = Object.fromEntries(ambientMix(list, lis, o).map((m) => [m.id, m]));
  assert.deepEqual(Object.keys(mix).sort(), ['a', 'b', 'c', 'h']);
  assert.ok(mix.a.gain > 0.9); assert.equal(mix.b.gain, 0, '100 ft away, heard 30 ft'); assert.equal(mix.c.gain, 0, 'a day sound at night');
  assert.ok(Math.abs(mix.h.gain - mix.a.gain * 0.5) < 1e-9);
  const muffled = ambientMix(list.slice(0, 1), lis, { ...o, blocked: () => true })[0];
  assert.equal(muffled.muffled, true); assert.ok(muffled.gain < mix.a.gain);
  const gmMix = ambientMix(list, { points: [{ x: 0, y: 0 }], walls: false }, { ...o, view: 'gm', blocked: () => true });
  assert.ok(gmMix.some((m) => m.id === 'e') && gmMix.every((m) => !m.muffled), 'the GM hears GM-only sources, without walls from the screen centre');
});

test('dice cues: a natural 20, a natural 1, other dice; prefs kept per browser', () => {
  assert.equal(diceCue({ kind: 'check', roll: { kept: 20 } }), CUES.diceCrit);
  assert.equal(diceCue({ kind: 'check', roll: { kept: 1 } }), CUES.diceFumble);
  assert.equal(diceCue({ kind: 'check', roll: { kept: 12 } }), CUES.dice);
  assert.equal(diceCue({ kind: 'roll', sides: 20, kept: 20 }), CUES.diceCrit);
  assert.equal(diceCue({ kind: 'roll', sides: 6, kept: 6 }), CUES.dice);
  assert.equal(diceCue({ kind: 'damage' }), CUES.dice);
  assert.equal(diceCue({ kind: 'narration' }), null);
  const mem = new Map(), storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const p = soundPrefs(storage);
  p.set({ muted: true }); p.set({ volumes: { music: 0.2 } });
  assert.deepEqual(p.get(), { muted: true, volumes: { music: 0.2 } });
});

test('the Sound tab\'s HTML: the mixer, the GM\'s moods and boss switch, the ambient list', () => {
  const mx = mixerHtml({ master: 0.8, music: 0.5, ambience: 0.7, effects: 0.8, interface: 0.5 }, true);
  assert.match(mx, /data-vol="music" value="50"/); assert.match(mx, /data-f="mute" checked/);
  assert.equal((mx.match(/data-cmute=/g) || []).length, 4, 'a mute per channel (not the master: that is Mute all)');
  const mx2 = mixerHtml({ music: 0.5 }, false, ['music']);
  assert.match(mx2, /data-cmute="music" aria-pressed="true"/); assert.match(mx2, /sd-row sd-off/); assert.match(mx2, /data-cmute="effects" aria-pressed="false"/);
  const m = musicHtml({ rec: { mood: 'town', boss: true, themes: { m1: 'town' } }, encounter: true, map: 'm1' }, { ...MAN, music: { ...MAN.music, town: [{ file: 't', secs: 9 }] } });
  assert.match(m, /data-mood="town" aria-pressed="true"/); assert.match(m, /data-boss="on" aria-pressed="true"/); assert.match(m, /<option value="town" selected>/);
  assert.ok(!/data-boss/.test(musicHtml({ rec: {}, encounter: false, map: 'm1' }, MAN)), 'the boss switch only while an encounter runs');
  assert.match(musicHtml({ rec: {}, map: 'm1' }, MAN), /data-a="pause"/); assert.match(musicHtml({ rec: { paused: { at: 1 } }, map: 'm1' }, MAN), /data-a="resume"/);
  const a = ambientHtml([{ id: 'amb-1', data: { sound: 'campfire', radius: 20, when: 'night', off: true } }], true, true);
  assert.match(a, /sd-off/); assert.match(a, /night only/); assert.match(a, /data-a="aremove"/);
  assert.ok(!/data-a=/.test(ambientHtml([{ id: 'amb-1', data: { sound: 'campfire', radius: 20 } }], false, true)), 'players only see the list');
  assert.match(ambientHtml([], true, true), /No ambient sounds/);
});

test('Claude\'s tool: status, mood, boss, next, theme, cue, ambient add/set/remove', () => {
  const pack = path.join(ROOT, 'examples/sample-pack'), save = path.join(ROOT, 'examples/campaigns/keep-test');
  const game = loadGame(pack, save, null);
  game.records['state/table'] = { current_map: 'sample-keep' };
  const st = runSound(game, 'status', [], { man: MAN });
  assert.match(st.lines[0], /Music: Exploring/); assert.match(st.lines.join('\n'), /No ambient sounds on sample-keep/);
  const m = runSound(game, 'mood', ['tension'], { man: MAN });
  assert.equal(m.writes[0].path, 'state/music'); assert.equal(m.writes[0].data.mood, 'tension'); assert.equal(m.writes[0].data.playing, 'tension');
  assert.ok(m.writes.some((w) => w.path.startsWith('audit/')));
  game.records['state/music'] = m.writes[0].data;
  assert.equal(runSound(game, 'mood', ['auto'], { man: MAN }).writes[0].data.playing, 'explore');
  assert.equal(runSound(game, 'boss', ['on'], { man: MAN }).writes[0].data.boss, true);
  assert.throws(() => runSound(game, 'boss', ['maybe'], {}), /auto, on or off/);
  assert.notEqual(runSound(game, 'next', [], { man: MAN }).writes[0].data.seed, game.records['state/music'].seed);
  const pz = runSound(game, 'pause', [], { man: MAN }).writes[0].data;
  assert.ok(pz.paused); game.records['state/music'] = pz;
  assert.match(runSound(game, 'status', [], { man: MAN }).lines[0], /PAUSED/);
  assert.ok(!runSound(game, 'resume', [], { man: MAN }).writes[0].data.paused);
  assert.deepEqual(runSound(game, 'theme', ['here', 'town'], { man: MAN }).writes[0].data.themes, { 'sample-keep': 'town' });
  const cue = runSound(game, 'cue', ['victory'], { man: MAN });
  assert.match(cue.writes[0].path, /^sfx\//); assert.equal(cue.writes[0].data.name, 'sting:victory');
  assert.equal(runSound(game, 'cue', ['dice'], { man: MAN }).writes[0].data.name, 'cue_dice');
  assert.throws(() => runSound(game, 'cue', ['kazoo'], { man: MAN }), /no cue/);
  const add = runSound(game, 'ambient', ['add', 'campfire', '10', '12'], { man: MAN, radius: 20, when: 'night', label: 'Guards' });
  const w = add.writes[0];
  assert.match(w.path, /^ambient\/amb-[0-9a-z]{8}$/); assert.deepEqual(w.data.at, [10, 12]); assert.equal(w.data.map, 'sample-keep');
  assert.throws(() => runSound(game, 'ambient', ['add', 'kazoo', '1', '1'], { man: MAN }), /no ambient loop/);
  game.records[w.path] = w.data;
  const id = w.path.split('/')[1];
  assert.match(runSound(game, 'ambient', ['list'], { man: MAN }).lines[0], new RegExp(`${id}  Guards \\(campfire\\) at 10, 12, 20 ft, night only`));
  assert.equal(runSound(game, 'ambient', ['set', id], { man: MAN, off: true }).writes[0].data.off, true);
  assert.equal(runSound(game, 'ambient', ['remove', id], {}).writes[0].op, 'delete');
  assert.throws(() => runSound(game, 'ambient', ['remove', 'amb-nope'], {}), /no ambient sound/);
});

test('the save: ambient sources with the map\'s state, the music with the campaign; the schemas; round trip', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-'));
  const pack = path.join(ROOT, 'examples/sample-pack');
  fs.cpSync(path.join(ROOT, 'examples/campaigns/keep-test'), tmp, { recursive: true });
  const campFile = path.join(tmp, 'campaign.json'), camp = JSON.parse(fs.readFileSync(campFile, 'utf8'));
  const music = { mood: 'auto', since: 5, seed: 7, boss: null, themes: { 'sample-keep': 'town' }, playing: 'town', by: 'claude', at: 'T' };
  fs.writeFileSync(campFile, JSON.stringify({ ...camp, music }, null, 2));
  const msFile = path.join(tmp, 'maps', fs.readdirSync(path.join(tmp, 'maps'))[0]);
  const ms = JSON.parse(fs.readFileSync(msFile, 'utf8'));
  const amb = { 'amb-abcdefgh': { sound: 'campfire', at: [10, 12], radius: 20, when: 'night', by: 'claude' } };
  fs.writeFileSync(msFile, JSON.stringify({ ...ms, ambient: amb }, null, 2));
  const c = readCampaign(pack, tmp);
  const r = campaignRecords({ ...c, now: 'T' });
  assert.equal(r['ambient/amb-abcdefgh'].map, ms.map);
  assert.deepEqual(r['state/music'], music);
  const back = saveFromRecords(r);
  assert.deepEqual(back.campaign.music, music);
  assert.deepEqual(back.mapStates[ms.map].ambient, amb);
  assert.ok(!('ambient' in r[`mapstate/${ms.map}`]));
  assert.deepEqual(roundTrip(pack, tmp), []);
  assert.ok(SAVE_COLLECTIONS.includes('ambient'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const sch = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', f), 'utf8'));
  const ambS = sch('map-state.schema.json').properties.ambient, musS = sch('campaign.schema.json').properties.music;
  assert.ok(ajv.validate(ambS, amb), JSON.stringify(ajv.errors));
  assert.ok(!ajv.validate(ambS, { 'amb-abcdefgh': { sound: 'campfire', at: [1, 1], radius: 0, by: 'claude' } }));
  assert.ok(ajv.validate(musS, music), JSON.stringify(ajv.errors));
  assert.ok(!ajv.validate(musS, { mood: 'disco' }));
});

test('the mixer mutes one channel and keeps its volume for when it comes back', () => {
  const gains = {};
  const param = (k) => ({ setTargetAtTime: (v) => { gains[k] = v; } });
  class Ctx { constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; this.n = 0; } createGain() { const k = this.n++; return { gain: param(k), connect() {}, k }; } }
  const m = new SoundMixer({ AudioContextClass: Ctx, volumes: { music: 0.4 } });
  m.unlock();
  const k = (ch) => m.bus[ch].k;
  assert.equal(gains[k('music')], 0.4);
  m.setChannelMuted('music', true);
  assert.equal(gains[k('music')], 0); assert.equal(m.channelMuted('music'), true); assert.equal(gains[k('effects')], DEFAULT_VOLUMES.effects);
  m.setVolume('music', 0.7); assert.equal(gains[k('music')], 0, 'a muted channel stays silent when its slider moves');
  m.setChannelMuted('music', false); assert.equal(gains[k('music')], 0.7);
  m.setChannelMuted('nonsense', true); assert.equal(m.off.size, 0);
});

test('the board\'s sound code is free of any one game system', () => {
  for (const f of ['board/sound.js', 'board/soundui.js', 'engine/sound/sound.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/pf2e|pathfinder|golarion/i.test(src), `${f} names a system`);
    assert.ok(!/\bunique\b/.test(src), `${f} knows a system's trait`);
  }
});
