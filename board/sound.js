// Sound at the table: which file plays for an effect or a table cue, the shared music record and the mood it
// follows, ambient sources placed on maps, and who is listening. Pure functions shared by the board
// (board/soundui.js and app.js, with the engine's SoundMixer: engine/sound/sound.js) and Claude's tool
// (tools/sound.mjs). Docs: docs/design/board.md (Sound), docs/best-practices/sound.md.
//
// Records:
//   state/music     {mood: 'auto' | a mood | 'silence', since (ms), seed, boss: null | true | false (the GM's or Claude's
//                   boss switch for the running encounter), themes: {map id: mood} (a map's music out of combat),
//                   playing: mood (the mood the run is for), by, at}. Saved with the campaign (campaign.music).
//   ambient/<id>    {map, sound (an ambient loop's name), at: [x, y] cells, radius (ft), inner (ft)?, when ('always' |
//                   'day' | 'night'), volume (0..1)?, label?, off?, gm_only?, by}. Saved with the map's state.
// The sound files and their manifest (sounds/sounds.json) ride along with the board page; the manifest lists
// effects by the visual effect's name, table cues, ambient loops, music by mood and short stings.
//
// The system says what a boss is (system.sound.isBoss); a system without it never switches to boss music by itself.

export const MUSIC_PATH = 'state/music';
export const AMBIENT = 'ambient';
export const MANIFEST = 'sounds/sounds.json';
export const MOODS = Object.freeze(['explore', 'combat', 'boss', 'town', 'tension', 'rest']);
export const MOOD_WORDS = Object.freeze({ auto: 'Automatic', explore: 'Exploring', combat: 'Combat', boss: 'Boss', town: 'Town', tension: 'Tension', rest: 'Rest', silence: 'Silence' });
export const WHEN = Object.freeze(['always', 'day', 'night']);
export const PREF_KEY = 'reliquary.sound';   // per browser: volumes, mute
export const CUES = Object.freeze({
  dice: 'cue_dice', diceCrit: 'cue_dice_crit', diceFumble: 'cue_dice_fumble', turnPc: 'cue_turn_pc', turnFoe: 'cue_turn_foe', round: 'cue_round',
  encounterStart: 'cue_encounter_start', encounterEnd: 'cue_encounter_end', pcDown: 'cue_pc_down', foeDeath: 'cue_foe_death', crit: 'cue_crit',
  doorOpen: 'cue_door_open', doorClose: 'cue_door_close', doorLocked: 'cue_door_locked', coins: 'cue_coins', item: 'cue_item', page: 'cue_page',
  click: 'cue_click', open: 'cue_open', close: 'cue_close', notify: 'cue_notify', levelUp: 'cue_level_up', rest: 'cue_rest', discovery: 'cue_discovery',
});
// cues that are the interface's own (the Interface channel); the rest are the table's (Effects)
export const INTERFACE_CUES = Object.freeze(new Set(['cue_click', 'cue_open', 'cue_close', 'cue_notify', 'cue_page']));

/** The fallback for a system with no sound rules: nothing is a boss by itself. */
export const PLAIN_SOUND = Object.freeze({ isBoss: () => false, levelOf: () => null, bossWhy: () => '' });
export const soundRules = (sys) => (sys && sys.sound) || PLAIN_SOUND;

/** An empty manifest (no sound files): everything stays quiet. */
export const EMPTY_MANIFEST = Object.freeze({ fx: {}, cues: {}, ambient: {}, music: {}, stings: {} });

/**
 * The file for a visual effect's sound: {file, impact} or null. result: 'hit' | 'crit' | 'miss' (an effect with
 * one sound has only 'hit'). name: the effect that played (after the library's fallbacks).
 */
export function effectSound(man, name, result = 'hit', r = Math.random()) {
  const e = man && man.fx && man.fx[name];
  if (!e) return null;
  const list = e[result] || e.hit || Object.values(e).find(Array.isArray);
  if (!list || !list.length) return null;
  const f = list[Math.min(list.length - 1, Math.floor(r * list.length))];
  return { file: f.file, impact: e.impact || 0, secs: f.secs };
}

/** The file for a table cue (CUES), or null. */
export function cueSound(man, cue, r = Math.random()) {
  const e = man && man.cues && man.cues[cue];
  const list = e && (e.hit || Object.values(e).find(Array.isArray));
  if (!list || !list.length) return null;
  return { file: list[Math.min(list.length - 1, Math.floor(r * list.length))].file };
}

/** A sting (victory, defeat, discovery, danger, rested): a file or null. */
export function stingSound(man, kind, r = Math.random()) {
  const list = man && man.stings && man.stings[kind];
  return list && list.length ? { file: list[Math.min(list.length - 1, Math.floor(r * list.length))].file } : null;
}

/** The moods the manifest has music for, in the board's order. */
export function moodsIn(man) {
  const m = (man && man.music) || {};
  return MOODS.filter((k) => (m[k] || []).length);
}

/** Check a music record change and make the full record. */
export function musicRecord(prev = {}, change = {}, { by = 'claude', now = Date.now(), seed = null } = {}) {
  const fresh = () => seed ?? Math.floor(Math.random() * 1e9);
  const out = { mood: 'auto', since: now, seed: fresh(), boss: null, themes: {}, ...(prev || {}) };
  if (change.mood !== undefined) {
    const m = change.mood;
    if (!(m === 'auto' || m === 'silence' || MOODS.includes(m))) throw new Error(`a mood is auto, silence or one of ${MOODS.join(', ')}`);
    out.mood = m;
  }
  if (change.boss !== undefined) {
    if (!(change.boss === null || typeof change.boss === 'boolean')) throw new Error('boss is on, off or auto');
    out.boss = change.boss;
  }
  if (change.theme !== undefined) {
    const { map, mood } = change.theme;
    if (!map) throw new Error('a theme needs its map');
    if (mood !== null && !MOODS.includes(mood)) throw new Error(`a map's theme is one of ${MOODS.join(', ')} (or none)`);
    out.themes = { ...(out.themes || {}) };
    if (mood === null) delete out.themes[map]; else out.themes[map] = mood;
  }
  if (change.restart || change.mood !== undefined || change.playing !== undefined) { out.since = now; out.seed = fresh(); }
  if (change.playing !== undefined) out.playing = change.playing;
  out.by = by; out.at = new Date(now).toISOString();
  return out;
}

/**
 * The facts the mood is chosen from, for the board's or the tool's chooseMood (engine): whether an encounter runs,
 * whether a boss is in it (the system's isBoss on each living foe that is in the encounter, against the party's
 * level), and the map's theme.
 * @param {object} enc      state/encounter (or null)
 * @param {object} actors   {token id: actor} for the combatants
 * @param {object} rules    soundRules(sys)
 * @param {object} tokens   {id: token} (kind, dead)
 * @returns {{encounter, boss, who}}
 */
export function encounterFacts(enc, actors, rules, tokens = {}) {
  const running = !!(enc && Array.isArray(enc.combatants) && enc.combatants.length && enc.started !== undefined && enc.round > 0);
  if (!running) return { encounter: false, boss: false, who: null };
  const pcs = enc.combatants.filter((c) => c.side === 'pc' || (tokens[c.token] && tokens[c.token].kind === 'pc'));
  const levels = pcs.map((c) => rules.levelOf(actors[c.token])).filter((n) => Number.isFinite(n));
  const partyLevel = levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : null;
  for (const c of enc.combatants) {
    if (c.side === 'pc' || (tokens[c.token] && (tokens[c.token].kind === 'pc' || tokens[c.token].dead)) || c.defeated) continue;
    const a = actors[c.token];
    if (a && rules.isBoss(a, partyLevel)) return { encounter: true, boss: true, who: (tokens[c.token] && tokens[c.token].name) || a.name || c.token, why: rules.bossWhy(a, partyLevel) };
  }
  return { encounter: true, boss: false, who: null };
}

/** Check an ambient source and make its record. */
export function ambientRecord(o, { man = null, by = 'claude' } = {}) {
  if (!o.map) throw new Error('an ambient sound needs its map');
  if (!o.sound || !/^[a-z][a-z0-9_]*$/.test(o.sound)) throw new Error('an ambient sound is named by its loop (lower case, underscores)');
  if (man && man.ambient && !man.ambient[o.sound]) throw new Error(`no ambient loop "${o.sound}" (there are: ${Object.keys(man.ambient).join(', ')})`);
  if (!(Array.isArray(o.at) && o.at.length === 2 && o.at.every(Number.isFinite))) throw new Error('at is [x, y] in cells');
  const radius = Number(o.radius ?? 30);
  if (!(radius > 0 && radius <= 1000)) throw new Error('radius is in feet, more than 0');
  const when = o.when || 'always';
  if (!WHEN.includes(when)) throw new Error(`when is one of ${WHEN.join(', ')}`);
  const rec = { map: o.map, sound: o.sound, at: o.at.map((n) => Math.round(n * 100) / 100), radius, when, by };
  if (o.inner !== undefined) { const v = Number(o.inner); if (!(v >= 0 && v < radius)) throw new Error('inner is in feet, less than the radius'); rec.inner = v; }
  if (o.volume !== undefined) { const v = Number(o.volume); if (!(v >= 0 && v <= 1)) throw new Error('volume is 0 to 1'); rec.volume = v; }
  if (o.label) rec.label = String(o.label).slice(0, 80);
  if (o.off) rec.off = true;
  if (o.gm_only) rec.gm_only = true;
  return rec;
}

/**
 * Who is listening, in cells: a single selected token the view may hear from (both views; in the player view only
 * a token they can see); otherwise the player view hears through the party's PCs on the map, and the GM view
 * from the middle of the screen (no walls).
 * @param {object} o  {view, tokens: {id: token}, selected: id|null, centre: {x, y}, seen: (id) => bool, centreOf: (id) => {x, y}}
 * @returns {{points: [{x, y}], walls: bool, why}}
 */
export function listeners({ view, tokens, selected, centre, seen = () => true, centreOf }) {
  const t = selected && tokens[selected];
  if (t && (view === 'gm' || seen(selected))) return { points: [centreOf(selected)], walls: true, why: `${t.name || 'the selected token'}` };
  if (view !== 'gm') {
    const pcs = Object.keys(tokens).filter((id) => tokens[id].kind === 'pc' && !tokens[id].dead);
    if (pcs.length) return { points: pcs.map(centreOf), walls: true, why: 'the party' };
  }
  return { points: centre ? [centre] : [], walls: false, why: 'the middle of the screen' };
}

/**
 * The ambient mix: for each source on this map, the loop to play and how it is heard.
 * @param {Array<{id, data}>} sources  ambient records
 * @param {object} lis      listeners(...)
 * @param {object} o        {map, view, hour, feetPerCell, man, hear: engine hearing(src, points, opts, blocked), blocked}
 * @returns {Array<{id, file, gain, pan, muffled}>}  only sources with a loop file
 */
export function ambientMix(sources, lis, { map, view, hour = null, feetPerCell = 5, man, hear, blocked, activeAt }) {
  const out = [];
  for (const e of sources || []) {
    const d = e.data || e;
    if (d.map !== map || d.off || (d.gm_only && view !== 'gm')) continue;
    const loop = man && man.ambient && man.ambient[d.sound];
    if (!loop) continue;
    const on = activeAt ? activeAt(d.when, hour) : true;
    const src = { x: d.at[0], y: d.at[1] };
    const h = on ? hear(src, lis.points, { radius: d.radius / feetPerCell, inner: (d.inner ?? Math.min(d.radius * 0.25, 10)) / feetPerCell }, lis.walls ? blocked : null) : { gain: 0, pan: 0, muffled: false };
    out.push({ id: e.id, file: loop.file, gain: h.gain * (d.volume ?? 1), pan: h.pan, muffled: !!h.muffled });
  }
  return out;
}

/** Volumes and mute kept per browser. */
export function soundPrefs(storage) {
  const get = () => { try { return JSON.parse(storage.getItem(PREF_KEY) || '{}') || {}; } catch { return {}; } };
  return {
    get,
    set(patch) { const v = { ...get(), ...patch }; try { storage.setItem(PREF_KEY, JSON.stringify(v)); } catch { /* private mode */ } return v; },
  };
}

/** A chat roll or check card's die as a cue: a natural 20, a natural 1, or plain dice. */
export function diceCue(msg) {
  if (!msg) return null;
  if (msg.kind === 'check') {
    const k = msg.roll && msg.roll.kept;
    return k === 20 ? CUES.diceCrit : k === 1 ? CUES.diceFumble : CUES.dice;
  }
  if (msg.kind === 'roll') return msg.sides === 20 && msg.kept === 20 ? CUES.diceCrit : msg.sides === 20 && msg.kept === 1 ? CUES.diceFumble : CUES.dice;
  if (msg.kind === 'damage') return CUES.dice;
  return null;
}

/** The music line for the Sound tab: what plays and why. */
export function nowPlaying(rec, mood, piece) {
  if (mood === 'silence') return 'Silence';
  if (!piece) return `${MOOD_WORDS[mood] || mood}: no music for this mood`;
  return `${piece.title || piece.file}: ${MOOD_WORDS[mood] || mood}`;
}
