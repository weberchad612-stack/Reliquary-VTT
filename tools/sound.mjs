#!/usr/bin/env node
// Sound from chat (board/sound.js): the music's mood (automatic from the game, or set), the boss switch, the next
// piece, a map's music out of combat, cues and stings every screen hears, and the ambient sounds on a map (Claude
// places them when preparing an area: a campfire, a river, wind, a tavern's crowd).
//
// Usage: node tools/sound.mjs <pack-dir> <save-dir> [--records FILE] [--sounds DIR] <command> ...
//   (--records: the board's records: state/music, ambient/, tokens/, actors/, state/encounter, state/table, board/meta;
//    --sounds: the sound files' folder with sounds.json, to check names; default the repository's sounds/)
//   status                               the mood and why, the boss check, this map's ambient sounds
//   mood <auto|explore|combat|boss|town|tension|rest|silence>
//   boss <auto|on|off>                   boss music for the running encounter
//   next                                 a different piece now (every screen)
//   pause | resume                       stop the music on every screen, then carry on where it stopped
//   theme <map|here> <mood|none>         a map's music out of combat (a town, a tavern, a camp)
//   cue <name> [--gm]                    a cue or sting every screen hears: victory, defeat, discovery, danger,
//                                        rested (stings), or a cue: dice, door_open, coins, level_up, round...
//   sounds [fx|cues|ambient|music|stings]   what the sound set has
//   ambient list [map|here]
//   ambient add <loop> <x> <y> [--radius FT] [--inner FT] [--when always|day|night] [--volume 0..1] [--label "words"]
//               [--map M] [--gm-only]
//   ambient set <id> [same options] [--on|--off]
//   ambient remove <id>
// Changing commands print {lines, writes} (db_write each). Docs: docs/best-practices/sound.md, docs/gm/running-a-game.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGame } from './actor.mjs';
import { readRecords } from './replay.mjs';
import { auditPath, auditEntry } from '../board/audit.js';
import { makeId } from '../board/ids.js';
import { fxId } from '../board/fx.js';
import { MUSIC_PATH, AMBIENT, MOODS, MOOD_WORDS, CUES, soundRules, musicRecord, encounterFacts, ambientRecord, moodsIn } from '../board/sound.js';
import { chooseMood } from '../engine/sound/sound.js';

export const DEFAULT_SOUNDS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'sounds');   // kept with Git LFS
const STINGS = ['victory', 'defeat', 'discovery', 'danger', 'rested'];

export function readManifest(dir = DEFAULT_SOUNDS) {
  const f = path.join(dir, 'sounds.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

/** The ambient sources in the records: [{id, data}]. */
export const ambientOf = (records) => Object.entries(records || {}).filter(([p]) => p.startsWith(`${AMBIENT}/`)).map(([p, d]) => ({ id: p.slice(AMBIENT.length + 1), data: d }));

export function runSound(game, cmd, args, o = {}) {
  const records = game.records || {}, man = o.man || null, lines = [], writes = [];
  const R = soundRules(game.sys), rec = records[MUSIC_PATH] || null;
  const here = (records['state/table'] || {}).current_map || null;
  const mapOf = (m) => (!m || m === 'here' ? here : m);
  const audit = (text) => writes.push({ op: 'set', path: auditPath(), data: auditEntry({ text, by: 'claude' }) });
  const facts = () => encounterFacts(game.encounter, game.actors, R, game.tokens);
  const moodNow = (r = rec) => { const f = facts(); return { ...chooseMood({ override: r && r.mood, encounter: f.encounter, boss: f.boss, bossOverride: r ? r.boss ?? null : null, theme: ((r && r.themes) || {})[here] || null }), facts: f }; };
  const setMusic = (change, text) => {
    const next = musicRecord(rec, change, { by: 'claude' });
    next.playing = moodNow(next).mood;
    writes.push({ op: 'set', path: MUSIC_PATH, data: next });
    audit(text); lines.push(`${text}. Now: ${MOOD_WORDS[next.playing] || next.playing} (${moodNow(next).why}).`);
  };
  if (cmd === 'status') {
    const m = moodNow();
    lines.push(`Music: ${rec && rec.paused ? 'PAUSED, ' : ''}${MOOD_WORDS[m.mood] || m.mood} (${m.why})${rec && rec.mood && rec.mood !== 'auto' ? `; set to ${rec.mood}` : '; automatic'}${rec && rec.boss !== null && rec.boss !== undefined ? `; boss switch ${rec.boss ? 'on' : 'off'}` : ''}`);
    if (m.facts.encounter) lines.push(m.facts.boss ? `Boss check: yes, ${m.facts.why || m.facts.who}` : 'Boss check: no foe counts as a boss (the GM or Claude can switch boss music on)');
    const themes = (rec && rec.themes) || {};
    if (Object.keys(themes).length) lines.push(`Map music: ${Object.entries(themes).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const amb = ambientOf(records).filter((e) => e.data.map === here);
    lines.push(amb.length ? `Ambient sounds on ${here}: ${amb.map((e) => `${e.id} ${e.data.sound} at ${e.data.at.join(',')} ${e.data.radius} ft${e.data.off ? ' (off)' : ''}`).join('; ')}` : `No ambient sounds on ${here}.`);
    if (man) lines.push(`Sound set: ${Object.keys(man.fx || {}).length} effects, ${Object.keys(man.cues || {}).length} cues, ${Object.keys(man.ambient || {}).length} ambient loops, music for ${moodsIn(man).join(', ')}`);
    return { lines, writes };
  }
  if (cmd === 'mood') {
    const m = args[0];
    if (!m) throw new Error(`give a mood: auto, silence or ${MOODS.join(', ')}`);
    setMusic({ mood: m }, m === 'auto' ? 'Music follows the game again' : `Music set to ${MOOD_WORDS[m] || m}`);
    return { lines, writes };
  }
  if (cmd === 'boss') {
    const v = args[0];
    if (!['auto', 'on', 'off'].includes(v)) throw new Error('boss is auto, on or off');
    setMusic({ boss: v === 'auto' ? null : v === 'on' }, `Boss music ${v === 'auto' ? 'automatic' : v}`);
    return { lines, writes };
  }
  if (cmd === 'next') { setMusic({ restart: true }, 'Music: next piece'); return { lines, writes }; }
  if (cmd === 'pause' || cmd === 'resume') { setMusic({ paused: cmd === 'pause' }, cmd === 'pause' ? 'Music paused' : 'Music resumed'); return { lines, writes }; }
  if (cmd === 'theme') {
    const map = mapOf(args[0]), mood = args[1];
    if (!map || !mood) throw new Error('give a map (or here) and a mood (or none)');
    setMusic({ theme: { map, mood: mood === 'none' ? null : mood } }, mood === 'none' ? `${map} plays the exploring music` : `${map} plays ${MOOD_WORDS[mood] || mood} music out of combat`);
    return { lines, writes };
  }
  if (cmd === 'cue') {
    const n = args[0];
    if (!n) throw new Error('give a cue or a sting');
    const name = STINGS.includes(n) ? `sting:${n}` : n.startsWith('cue_') ? n : `cue_${n}`;
    if (man && !name.startsWith('sting:') && !(man.cues || {})[name]) throw new Error(`no cue "${n}" (cues: ${Object.keys(man.cues || {}).map((k) => k.slice(4)).join(', ')}; stings: ${STINGS.join(', ')})`);
    if (!name.startsWith('sting:') && !Object.values(CUES).includes(name) && !man) throw new Error(`no cue "${n}"`);
    writes.push({ op: 'set', path: `sfx/${fxId()}`, data: { map: here, name, by: 'claude', ts: Date.now(), ...(o.gm ? { gm: true } : {}) } });
    lines.push(`Played ${name.replace('sting:', 'the ').replace('cue_', '')}${name.startsWith('sting:') ? ' sting' : ''} on every screen${o.gm ? ' (GM only)' : ''}.`);
    return { lines, writes };
  }
  if (cmd === 'sounds') {
    if (!man) throw new Error('no sound set found (give --sounds DIR)');
    const what = args[0];
    const show = (k, f) => { if (!what || what === k) lines.push(`${k}: ${f()}`); };
    show('fx', () => Object.keys(man.fx || {}).join(', '));
    show('cues', () => Object.keys(man.cues || {}).map((c) => c.slice(4)).join(', '));
    show('ambient', () => Object.keys(man.ambient || {}).join(', '));
    show('music', () => Object.entries(man.music || {}).map(([k, v]) => `${k} ${v.length}`).join(', '));
    show('stings', () => Object.entries(man.stings || {}).map(([k, v]) => `${k} ${v.length}`).join(', '));
    return { lines, writes };
  }
  if (cmd === 'ambient') {
    const sub = args[0];
    if (sub === 'list') {
      const map = mapOf(args[1]);
      const amb = ambientOf(records).filter((e) => e.data.map === map);
      for (const e of amb) lines.push(`${e.id}  ${e.data.label || e.data.sound} (${e.data.sound}) at ${e.data.at.join(', ')}, ${e.data.radius} ft${e.data.inner ? `, full within ${e.data.inner} ft` : ''}${e.data.when !== 'always' ? `, ${e.data.when} only` : ''}${e.data.volume !== undefined ? `, volume ${e.data.volume}` : ''}${e.data.off ? ' (off)' : ''}${e.data.gm_only ? ' (GM only)' : ''}`);
      if (!amb.length) lines.push(`No ambient sounds on ${map}.`);
      return { lines, writes };
    }
    if (sub === 'add') {
      const [, loop, x, y] = args;
      const map = mapOf(o.map);
      if (!map) throw new Error('no current map: give --map');
      const d = ambientRecord({ map, sound: loop, at: [Number(x), Number(y)], radius: o.radius ?? 30, inner: o.inner, when: o.when, volume: o.volume, label: o.label, gm_only: o.gmOnly }, { man });
      const id = makeId('ambient', { taken: new Set(ambientOf(records).map((e) => e.id)) });
      writes.push({ op: 'set', path: `${AMBIENT}/${id}`, data: d });
      lines.push(`Ambient sound ${id}: ${d.label || d.sound} at ${d.at.join(', ')} on ${map}, heard ${d.radius} ft${d.when !== 'always' ? ` (${d.when} only)` : ''}.`);
      return { lines, writes };
    }
    if (sub === 'set' || sub === 'remove') {
      const id = args[1], cur = records[`${AMBIENT}/${id}`];
      if (!cur) throw new Error(`no ambient sound "${id}"`);
      if (sub === 'remove') { writes.push({ op: 'delete', path: `${AMBIENT}/${id}` }); lines.push(`Removed ambient sound ${id} (${cur.sound}).`); return { lines, writes }; }
      const d = ambientRecord({ ...cur, ...(o.radius !== undefined ? { radius: o.radius } : {}), ...(o.inner !== undefined ? { inner: o.inner } : {}), ...(o.when ? { when: o.when } : {}), ...(o.volume !== undefined ? { volume: o.volume } : {}), ...(o.label ? { label: o.label } : {}), off: o.off === undefined ? cur.off : o.off, gm_only: o.gmOnly ?? cur.gm_only }, { man, by: cur.by || 'claude' });
      writes.push({ op: 'set', path: `${AMBIENT}/${id}`, data: d });
      lines.push(`Ambient sound ${id}: ${d.sound}, ${d.radius} ft${d.off ? ', off' : ''}.`);
      return { lines, writes };
    }
    throw new Error('ambient list | add | set | remove');
  }
  throw new Error(`unknown command "${cmd}"`);
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const rec = opt('--records'), sounds = opt('--sounds') || DEFAULT_SOUNDS;
    const o = { radius: opt('--radius'), inner: opt('--inner'), when: opt('--when'), volume: opt('--volume'), label: opt('--label'), map: opt('--map') };
    for (const k of ['radius', 'inner', 'volume']) if (o[k] !== undefined) o[k] = Number(o[k]);
    o.gmOnly = flag('--gm-only') || undefined; o.gm = flag('--gm');
    if (flag('--off')) o.off = true; if (flag('--on')) o.off = undefined;
    const [pack, save, cmd, ...rest] = args;
    if (!pack || !save || !cmd) throw new Error('give a pack folder, a save folder and a command');
    const records = rec ? readRecords(JSON.parse(fs.readFileSync(rec, 'utf8'))) : null;
    const game = loadGame(pack, save, records);
    if (!records) {   // the save's music and the maps' ambient sounds
      const camp = JSON.parse(fs.readFileSync(path.join(save, 'campaign.json'), 'utf8'));
      if (camp.music) game.records[MUSIC_PATH] = camp.music;
      game.records['state/table'] = { current_map: camp.current_map };
    }
    const out = runSound(game, cmd, rest, { ...o, man: readManifest(sounds) });
    if (['status', 'sounds'].includes(cmd) || (cmd === 'ambient' && rest[0] === 'list')) console.log(out.lines.join('\n'));
    else console.log(JSON.stringify(out, null, 2));
    return 0;
  } catch (e) {
    console.error(`sound: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
