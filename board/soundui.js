// The Sound tab (board/sound.js): for everyone, this screen's mixer (master, music, ambience, effects, interface,
// mute) and what is playing and why; for the GM, the music's mood (automatic or set), the boss switch while an
// encounter runs, Next, this map's music out of combat, the soundboard (stings and cues every screen hears) and
// the ambient sounds on this map (mute or remove; Claude places them with tools/sound.mjs).
// Docs: docs/best-practices/board.md (Sound).
//
// o: {view() -> 'gm' | 'player', readOnly, pane, sidebar, tab ('sound'), mixer (engine SoundMixer), prefs
// (soundPrefs), man() -> manifest, status() -> {mood, why, piece, rec, encounter, listener, unlocked, map},
// setMusic(change) (state/music), play(name) (a sound every screen hears: 'sting:<kind>' or a cue),
// ambient() -> [{id, data}] (this map's), setAmbient(id, patch|null) (null removes)}. Returns {render(), refresh()}.

import { MOODS, MOOD_WORDS, CUES, moodsIn, nowPlaying } from './sound.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SLIDERS = [['master', 'Master'], ['music', 'Music'], ['ambience', 'Ambience'], ['effects', 'Effects'], ['interface', 'Interface']];
const BOARD = [['sting:victory', '🏆 Victory'], ['sting:defeat', '💀 Defeat'], ['sting:discovery', '✨ Discovery'], ['sting:danger', '⚠️ Danger'], ['sting:rested', '🌙 Rested'],
  [CUES.encounterStart, '⚔️ To arms'], [CUES.levelUp, '⭐ Level up'], [CUES.doorOpen, '🚪 Door'], [CUES.coins, '🪙 Coins'], [CUES.round, '🔔 Bell']];

/** The mixer rows (pure). */
export function mixerHtml(vol, muted) {
  return `<div class="sd-mix">${SLIDERS.map(([k, l]) => `<label class="sd-row"><span>${l}</span><input type="range" min="0" max="100" step="1" data-vol="${k}" value="${Math.round((vol[k] ?? 0) * 100)}" aria-label="${l} volume"><output>${Math.round((vol[k] ?? 0) * 100)}</output></label>`).join('')}`
    + `<label class="sd-mute"><input type="checkbox" data-f="mute"${muted ? ' checked' : ''}> Mute all sound <span class="lt-dim">(this screen)</span></label></div>`;
}

/** The GM's music controls (pure). */
export function musicHtml(st, man) {
  const rec = st.rec || {}, cur = rec.mood || 'auto', moods = moodsIn(man);
  const none = (m) => MOODS.includes(m) && !moods.includes(m);   // no music for it in the sound set (it stays quiet)
  const btn = (m) => `<button type="button" data-mood="${m}" aria-pressed="${cur === m}"${none(m) ? ' class="sd-nomusic" title="No music for this mood in the sound set"' : ''}>${esc(MOOD_WORDS[m])}</button>`;
  const boss = st.encounter ? `<div class="sd-line"><b>Boss music</b> <span class="lt-controls">${[['auto', 'Automatic'], ['on', 'On'], ['off', 'Off']].map(([k, l]) => `<button type="button" data-boss="${k}" aria-pressed="${(rec.boss === true ? 'on' : rec.boss === false ? 'off' : 'auto') === k}">${l}</button>`).join('')}</span></div>` : '';
  const theme = (rec.themes || {})[st.map] || '';
  return `<div class="sd-line"><b>Mood</b></div><div class="lt-controls sd-moods">${btn('auto')}${MOODS.map(btn).join('')}${btn('silence')}</div>${boss}`
    + `<div class="sd-line"><label>This map out of combat <select data-f="theme" aria-label="This map's music out of combat"><option value=""${theme ? '' : ' selected'}>Exploring (the default)</option>${MOODS.filter((m) => m !== 'combat' && m !== 'boss' && m !== 'explore').map((m) => `<option value="${m}"${theme === m ? ' selected' : ''}>${esc(MOOD_WORDS[m])}</option>`).join('')}</select></label></div>`
    + '<div class="lt-controls"><button type="button" data-a="next" title="Start a different piece now (every screen)">⏭ Next piece</button></div>';
}

/** The ambient list (pure). */
export function ambientHtml(list, gm, write) {
  if (!list.length) return '<p class="lt-none">No ambient sounds on this map. Claude places them (tools/sound.mjs ambient add).</p>';
  return `<ul class="sd-amb">${list.map(({ id, data: d }) => `<li data-id="${esc(id)}"${d.off ? ' class="sd-off"' : ''}><span class="sd-an">${esc(d.label || d.sound.replace(/_/g, ' '))}</span>`
    + `<span class="lt-dim">${esc(d.sound)} · ${d.radius} ft${d.when && d.when !== 'always' ? ` · ${d.when} only` : ''}${d.gm_only ? ' · GM only' : ''}</span>`
    + (gm && write ? `<span class="sd-ab"><button type="button" data-a="amute" title="${d.off ? 'Turn it on' : 'Turn it off'} (every screen)" aria-pressed="${!!d.off}">${d.off ? '🔇' : '🔊'}</button><button type="button" data-a="aremove" title="Remove it">✕</button></span>` : '')
    + '</li>').join('')}</ul>`;
}

export function mountSound(o) {
  const pane = o.pane;
  pane.innerHTML = '<div class="sd-unlock" hidden>🔈 Sound starts after your first click on the board (the browser asks for one).</div>'
    + '<div class="lt-value sd-now"></div><div class="sd-mixbox"></div><div class="sd-gm"></div>'
    + '<div class="lt-sh"><h3>Ambient sounds here</h3><span class="lt-sub sd-hear"></span></div><div class="sd-ambbox"></div><p class="lt-msg" role="status"></p>';
  const $ = (s) => pane.querySelector(s);
  const nowEl = $('.sd-now'), mixEl = $('.sd-mixbox'), gmEl = $('.sd-gm'), ambEl = $('.sd-ambbox'), hearEl = $('.sd-hear'), unlockEl = $('.sd-unlock'), msg = $('.lt-msg');
  let shown = false;
  const gm = () => o.view() === 'gm';
  const write = () => !o.readOnly;
  const say = (t) => { msg.textContent = t; clearTimeout(say.t); say.t = setTimeout(() => { msg.textContent = ''; }, 3500); };

  function renderNow() {
    const st = o.status();
    unlockEl.hidden = !!st.unlocked;
    nowEl.innerHTML = `<div class="lt-pch"><b>Now playing</b><span class="lt-coins">${esc(MOOD_WORDS[st.mood] || st.mood || '')}</span></div>`
      + `<div class="lt-vsub">${esc(nowPlaying(st.rec, st.mood, st.piece))}</div><div class="lt-vsub">Why: ${esc(st.why || '')}</div>`;
    hearEl.textContent = st.listener ? `heard from ${st.listener}` : '';
  }
  function render() {
    if (!shown) return;
    const v = o.prefs.get();
    renderNow();
    mixEl.innerHTML = mixerHtml({ ...o.mixer.vol, ...(v.volumes || {}) }, !!v.muted);
    const st = o.status(), man = o.man();
    gmEl.innerHTML = gm() && write() ? `<div class="lt-sh"><h3>Music</h3><span class="lt-sub">every screen plays the same piece</span></div>${musicHtml(st, man)}`
      + `<div class="lt-sh"><h3>Soundboard</h3><span class="lt-sub">every screen hears it</span></div><div class="lt-controls sd-board">${BOARD.map(([k, l]) => `<button type="button" data-play="${esc(k)}">${l}</button>`).join('')}</div>` : '';
    ambEl.innerHTML = ambientHtml(o.ambient(), gm(), write());
  }
  pane.addEventListener('input', (ev) => {
    const r = ev.target.closest('[data-vol]');
    if (!r) return;
    const k = r.dataset.vol, val = Number(r.value) / 100;
    o.mixer.setVolume(k, val);
    const v = o.prefs.get(); o.prefs.set({ volumes: { ...(v.volumes || {}), [k]: val } });
    r.nextElementSibling.textContent = r.value;
  });
  pane.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.f === 'mute') { o.mixer.setMuted(t.checked); o.prefs.set({ muted: t.checked }); say(t.checked ? 'Sound muted on this screen.' : 'Sound on.'); }
    if (t.dataset.f === 'theme') { o.setMusic({ theme: { map: o.status().map, mood: t.value || null } }); say(t.value ? `This map plays ${MOOD_WORDS[t.value]} music out of combat.` : 'This map plays the exploring music.'); }
  });
  pane.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    o.mixer.unlock();
    if (b.dataset.mood) { o.setMusic({ mood: b.dataset.mood }); say(b.dataset.mood === 'auto' ? 'The music follows the game again.' : `Music: ${MOOD_WORDS[b.dataset.mood]}.`); }
    else if (b.dataset.boss) { o.setMusic({ boss: b.dataset.boss === 'auto' ? null : b.dataset.boss === 'on' }); say(`Boss music: ${b.dataset.boss === 'auto' ? 'automatic' : b.dataset.boss}.`); }
    else if (b.dataset.a === 'next') { o.setMusic({ restart: true }); say('Next piece.'); }
    else if (b.dataset.play) o.play(b.dataset.play);
    else if (b.dataset.a === 'amute' || b.dataset.a === 'aremove') {
      const id = b.closest('[data-id]').dataset.id, cur = o.ambient().find((e) => e.id === id);
      if (!cur) return;
      if (b.dataset.a === 'amute') o.setAmbient(id, { ...cur.data, off: !cur.data.off || undefined });
      else o.setAmbient(id, null);
    }
    setTimeout(render, 50);
  });
  if (o.sidebar) o.sidebar.onVisible(o.tab, (v) => { shown = v; if (v) render(); });
  return { render, refresh: () => { if (shown) render(); }, now: () => { if (shown) renderNow(); } };
}
