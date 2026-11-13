// Sound for any game: the mixer's channels, where a sound is heard from (distance falloff, stereo pan, walls that
// muffle), shuffle bags, and a music timeline every screen works out the same way from one shared record, so all
// screens play the same piece at the same moment without passing audio around. Pure functions, plus SoundMixer,
// the Web Audio player the board uses (only that class needs a browser). Docs: docs/design/board.md (Sound),
// docs/best-practices/sound.md.

export const CHANNELS = Object.freeze(['music', 'ambience', 'effects', 'interface']);
export const DEFAULT_VOLUMES = Object.freeze({ master: 0.8, music: 0.55, ambience: 0.7, effects: 0.8, interface: 0.5 });
export const CROSSFADE = 4;          // seconds two music pieces overlap
export const MUFFLE = Object.freeze({ gain: 0.35, lowpass: 900 });   // a sound heard through a wall

/** A seeded random source (mulberry32) from a number or a string. */
export function seeded(seed) {
  let h = 2166136261 >>> 0;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A shuffle-bag order of n items: every item once before any repeats, and never the same item twice in a row
 * across bag refills. Deterministic for its seed. Returns the index at position k of the endless sequence.
 */
export function bagIndex(n, seed, k) {
  if (n <= 0) return -1;
  if (n === 1) return 0;
  const bags = Math.floor(k / n);
  let prevLast = -1, order = null;
  for (let b = 0; b <= bags; b++) {
    const rnd = seeded(`${seed}/${b}`), o = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
    if (o[0] === prevLast) [o[0], o[n - 1]] = [o[n - 1], o[0]];
    prevLast = o[n - 1]; order = o;
  }
  return order[k % n];
}

/**
 * Where the music is at a moment: the piece playing and how far into it, from the shared record.
 * @param {Array<{file, secs}>} pieces  the mood's pieces (in manifest order)
 * @param {{since: number, seed}} rec   when this mood's run began (ms) and its bag seed
 * @param {number} now                  ms
 * @returns {{k, index, piece, offset, endsAt}|null}  k: position in the run; offset: seconds into the piece
 */
export function musicAt(pieces, rec, now, crossfade = CROSSFADE) {
  if (!pieces || !pieces.length || !rec || !Number.isFinite(rec.since)) return null;
  let t = Math.max(0, (now - rec.since) / 1000), k = 0;
  for (let guard = 0; guard < 100000; guard++) {
    const index = bagIndex(pieces.length, rec.seed ?? 0, k), piece = pieces[index];
    const step = Math.max(1, (piece.secs || 60) - crossfade);
    if (t < step) return { k, index, piece, offset: t, endsAt: now + (step - t) * 1000 };
    t -= step; k++;
  }
  return null;
}

/**
 * The mood the music follows: the override when one is set, else the game's own state. A system or the board
 * gives the facts; this only picks. Order: silence or a set mood override everything; a running encounter is
 * 'boss' when a boss is in it and 'combat' otherwise; out of combat, the map's theme, else 'explore'.
 * @returns {{mood, why}}
 */
export function chooseMood({ override = null, encounter = false, boss = false, bossOverride = null, theme = null } = {}) {
  if (override && override !== 'auto') return { mood: override, why: 'set by the GM' };
  if (encounter) {
    const isBoss = bossOverride === null || bossOverride === undefined ? boss : !!bossOverride;
    return isBoss ? { mood: 'boss', why: bossOverride ? 'boss music switched on' : 'a powerful foe is in the encounter' } : { mood: 'combat', why: 'an encounter is running' };
  }
  if (theme) return { mood: theme, why: "this map's music" };
  return { mood: 'explore', why: 'exploring' };
}

/**
 * How loud a sound at a point is for a listener, and where it sits left to right.
 * @param {{x, y}} src  cells
 * @param {{x, y}} lis  cells
 * @param {object} o    {radius (cells): 0 gain beyond it; inner (cells): full gain within; curve: 'linear'|'smooth'; panWidth (cells)}
 * @returns {{gain, pan, dist}}
 */
export function falloff(src, lis, { radius = 6, inner = 1, curve = 'smooth', panWidth = null } = {}) {
  const dx = src.x - lis.x, dy = src.y - lis.y, dist = Math.hypot(dx, dy);
  let gain;
  if (dist <= inner) gain = 1;
  else if (dist >= radius) gain = 0;
  else {
    const u = (dist - inner) / Math.max(1e-6, radius - inner);
    gain = curve === 'linear' ? 1 - u : (1 - u) * (1 - u);   // smooth: quadratic, quieter sooner
  }
  const w = panWidth || Math.max(2, radius * 0.6);
  const pan = Math.max(-1, Math.min(1, dx / w)) * 0.8;
  return { gain, pan, dist };
}

/**
 * The loudest way a sound reaches any of several listeners (the party's PCs): each listener's falloff, muffled
 * when a wall that stops sound lies between (blocked(src, lis) -> true), and the best kept.
 * @returns {{gain, pan, muffled, listener}}  listener: the index that heard it best (-1 when nobody did)
 */
export function hearing(src, listeners, opts = {}, blocked = null) {
  let best = { gain: 0, pan: 0, muffled: false, listener: -1 };
  (listeners || []).forEach((lis, i) => {
    const f = falloff(src, lis, opts);
    if (f.gain <= 0) return;
    const m = blocked ? !!blocked(src, lis) : false;
    const g = m ? f.gain * MUFFLE.gain : f.gain;
    if (g > best.gain) best = { gain: g, pan: f.pan, muffled: m, listener: i };
  });
  return best;
}

/** A screen position as a stereo pan (-1 left to 1 right), gentle at the edges. */
export function screenPan(x, width, depth = 0.6) {
  if (!width) return 0;
  return Math.max(-1, Math.min(1, (x / width) * 2 - 1)) * depth;
}

/** Whether an ambient source is active at an hour of the day (when: 'always' | 'day' | 'night'). */
export function activeAt(when, hour) {
  if (!when || when === 'always' || hour === null || hour === undefined) return true;
  const day = hour >= 6 && hour < 19;
  return when === 'day' ? day : !day;
}

/** One file from a list of variants, by a random number 0..1. */
export function pickVariant(list, r = Math.random()) {
  if (!list || !list.length) return null;
  return list[Math.min(list.length - 1, Math.floor(r * list.length))];
}

/**
 * The Web Audio player: a master gain, one gain per channel, a buffer cache, one-shot sounds with gain, pan,
 * an optional low-pass (muffled) and a start delay or offset; looping sounds that can be steered (ambient
 * sources); and music on media elements (streamed, not decoded whole), crossfaded.
 * A browser only starts audio after the first click or key on the page: `unlock()` is called then.
 */
export class SoundMixer {
  constructor({ base = '', volumes = {}, AudioContextClass = null, fetchFn = null } = {}) {
    this.base = base; this.vol = { ...DEFAULT_VOLUMES, ...volumes }; this.muted = false;
    this.Ctx = AudioContextClass || (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
    this.fetch = fetchFn || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    this.ctx = null; this.buffers = new Map(); this.loops = new Map(); this.music = null; this.unlocked = false;
    this.ready = false;
  }
  /** Make the audio graph (the first time) and let it play. Safe to call often. */
  unlock() {
    if (!this.Ctx) return false;
    if (!this.ctx) {
      this.ctx = new this.Ctx();
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.bus = {};
      for (const c of CHANNELS) { const g = this.ctx.createGain(); g.connect(this.master); this.bus[c] = g; }
      this.applyVolumes(); this.ready = true;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.unlocked = true;
    return true;
  }
  get running() { return !!this.ctx && this.ctx.state === 'running'; }
  setVolume(ch, v) { this.vol[ch] = Math.max(0, Math.min(1, Number(v) || 0)); this.applyVolumes(); }
  setMuted(m) { this.muted = !!m; this.applyVolumes(); }
  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.vol.master, t, 0.05);
    for (const c of CHANNELS) this.bus[c].gain.setTargetAtTime(this.vol[c], t, 0.05);
  }
  url(file) { return /^(https?:|data:|blob:|\/)/.test(file) ? file : this.base + file; }
  async buffer(file) {
    if (!this.ctx || !this.fetch) return null;
    if (!this.buffers.has(file)) {
      const p = this.fetch(this.url(file)).then((r) => { if (!r.ok) throw new Error(`${r.status} ${file}`); return r.arrayBuffer(); })
        .then((b) => new Promise((res, rej) => this.ctx.decodeAudioData(b, res, rej)));
      this.buffers.set(file, p);
      p.catch(() => this.buffers.delete(file));
    }
    return this.buffers.get(file);
  }
  /** A node chain: source -> [lowpass] -> gain -> pan -> channel. */
  chain(channel, { gain = 1, pan = 0, lowpass = null } = {}) {
    const g = this.ctx.createGain(); g.gain.value = gain;
    let head = g;
    let lp = null;
    if (lowpass) { lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lowpass; lp.connect(g); head = lp; }
    let p = null;
    if (this.ctx.createStereoPanner) { p = this.ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(this.bus[channel] || this.bus.effects); }
    else g.connect(this.bus[channel] || this.bus.effects);
    return { input: head, gain: g, pan: p, lp };
  }
  /** Play a file once. delay: seconds before it starts; offset: seconds into the file. Resolves to the source. */
  async play(file, { channel = 'effects', gain = 1, pan = 0, lowpass = null, delay = 0, offset = 0 } = {}) {
    if (!this.ctx || !file) return null;
    const buf = await this.buffer(file).catch(() => null);
    if (!buf) return null;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const c = this.chain(channel, { gain, pan, lowpass });
    src.connect(c.input);
    src.start(this.ctx.currentTime + Math.max(0, delay), Math.max(0, Math.min(buf.duration - 0.01, offset)));
    return src;
  }
  /** Start or steer a looping sound by key: gain, pan, muffled; gain 0 fades it out (it keeps running, silent). */
  async loop(key, file, { channel = 'ambience', gain = 1, pan = 0, muffled = false } = {}) {
    if (!this.ctx) return;
    let L = this.loops.get(key);
    if (L && L.file !== file) { this.stopLoop(key); L = null; }
    if (!L) {
      L = { file, pending: true };
      this.loops.set(key, L);
      const buf = await this.buffer(file).catch(() => null);
      if (!buf || this.loops.get(key) !== L) return;
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000;
      const c = this.chain(channel, { gain: 0, pan });
      src.connect(lp); lp.connect(c.input);
      // start each loop at a random point, so two sources of one sound don't play in step
      src.start(this.ctx.currentTime, Math.random() * buf.duration);
      Object.assign(L, { src, lp, c, pending: false });
      this.steer(L, L.want || { gain, pan, muffled }); L.want = null;
      return;
    }
    if (L.pending) { L.want = { gain, pan, muffled }; return; }
    const w = L.want || { gain, pan, muffled }; L.want = null;
    this.steer(L, w);
  }
  steer(L, { gain, pan, muffled }) {
    const t = this.ctx.currentTime;
    L.c.gain.gain.setTargetAtTime(gain, t, 0.4);
    if (L.c.pan) L.c.pan.pan.setTargetAtTime(pan, t, 0.3);
    L.lp.frequency.setTargetAtTime(muffled ? MUFFLE.lowpass : 20000, t, 0.3);
  }
  stopLoop(key) {
    const L = this.loops.get(key);
    if (!L) return;
    this.loops.delete(key);
    if (L.src) { const t = this.ctx.currentTime; L.c.gain.gain.setTargetAtTime(0, t, 0.3); try { L.src.stop(t + 1.5); } catch { /* already stopped */ } }
  }
  loopKeys() { return [...this.loops.keys()]; }
  /**
   * Play a music piece from an offset on a streamed media element, crossfading from what plays now. The same
   * piece at about the same place keeps playing (only a drift of more than 2 seconds is corrected).
   */
  playMusic(file, offset = 0, { fade = CROSSFADE } = {}) {
    if (!this.ctx || typeof Audio === 'undefined') return;
    const cur = this.music;
    if (cur && cur.file === file && Math.abs(cur.el.currentTime - offset) < 2.5) return;
    if (cur && cur.file === file) { try { cur.el.currentTime = offset; } catch { /* not seekable yet */ } return; }
    const el = new Audio(); el.crossOrigin = 'anonymous'; el.preload = 'auto'; el.src = this.url(file);
    const node = this.ctx.createMediaElementSource(el), g = this.ctx.createGain(); g.gain.value = 0;
    node.connect(g); g.connect(this.bus.music);
    const start = () => { try { el.currentTime = offset; } catch { /* seek when it can */ } el.play().catch(() => {}); };
    if (el.readyState >= 1) start(); else el.addEventListener('loadedmetadata', start, { once: true });
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + (cur ? fade : 1.5));
    if (cur) this.fadeOutMusic(cur, fade);
    this.music = { file, el, g };
  }
  fadeOutMusic(m, fade = 2) {
    const t = this.ctx.currentTime;
    m.g.gain.cancelScheduledValues(t); m.g.gain.setValueAtTime(m.g.gain.value, t); m.g.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => { try { m.el.pause(); m.el.src = ''; } catch { /* gone */ } }, fade * 1000 + 200);
  }
  stopMusic(fade = 2) { if (this.music && this.ctx) { this.fadeOutMusic(this.music, fade); this.music = null; } }
  musicFile() { return this.music ? this.music.file : null; }
}
