"""The board's sound effects: each visual effect's sound, rendered offline in layers (an attack, a body, a tail) from
synthesis voices (dsp.py) and recorded percussion (samples.py: anvil, brake drum, bass drum, snare, timpani, glock,
harp), with small random variations, a short room and an even loudness. A recipe takes (rng, result) and returns
stereo; result is 'hit', 'crit' or 'miss' (a miss has no impact). Docs: docs/best-practices/sound.md."""
import numpy as np
from scipy.signal import resample_poly
from dsp import (SR, secs, lp, hp, bp, sweep_filter, env_ad, env_adsr, fade, white, pink, brown, sine, fm, karplus, modal,
                 crackle, stereo, mix, reverb, master)
from samples import perc, Bank

_P = {}
def P(key):
    if key not in _P:
        _P[key] = {'anvil': lambda: perc('Percussion/Anvil_Hit1*.wav'), 'brake': lambda: perc('Percussion/BrakeDrum1_Hammer*.wav'),
                   'bd': lambda: perc('Percussion/BDrumNewhit*.wav'), 'sn': lambda: perc('Percussion/Snare2-HitSN*.wav'),
                   'timp': lambda: perc('Percussion/Timpani/Timpani*_Hit_*.wav')}[key]()
    return _P[key]


def pick(rng, key, semis=0.0, length=None):
    pool = P(key); x = pool[int(rng.integers(len(pool)))]
    if semis:
        r = 2 ** (semis / 12); x = resample_poly(x, int(round(1000 / r)), 1000, axis=0).astype(np.float32)
    if length: x = x[: secs(length)]
    return fade(x, 0.0005, min(0.05, len(x) / SR * 0.3))


def mono(x): return x.mean(axis=1) if x.ndim == 2 else x


# ---- voices ----
def swing(rng, dur=0.3, lo=350, hi=2600, gain=1.0):
    n = secs(dur); x = pink(n, rng)
    e = np.sin(np.linspace(0, np.pi, n)) ** 2.2
    y = sweep_filter(x * e, lo, hi, q=1.6) * 1.6
    y += sweep_filter(x * e, hi * 0.6, lo * 1.5, q=3) * 0.5
    pan = np.linspace(-0.4, 0.4, n) * rng.choice([-1, 1])
    return np.stack([y * np.cos((pan + 1) * np.pi / 4), y * np.sin((pan + 1) * np.pi / 4)], 1).astype(np.float32) * gain


def cut(rng, dur=0.05, gain=1.0):
    n = secs(dur); return stereo(bp(white(n, rng), 2500, 11000) * env_ad(n, 0.001, dur * 0.5, 5) * gain, rng.uniform(-0.2, 0.2), 0.4)


def squelch(rng, dur=0.18, gain=1.0):
    n = secs(dur); x = brown(n, rng) * 3
    y = sweep_filter(x * env_ad(n, 0.004, dur * 0.6, 4), 1400, 250, q=2.5)
    return stereo(y * gain, 0, 0.3)


def thud(rng, semis=-4, gain=1.0, length=0.6):
    return pick(rng, 'bd', semis + rng.uniform(-1, 1), length) * gain


def ring(rng, semis=0, gain=1.0, length=1.4, key='anvil'):
    return hp(pick(rng, key, semis + rng.uniform(-1.5, 1.5), length), 500) * gain


def boom(rng, gain=1.0, dur=1.6, f0=75):
    n = secs(dur); sub = sine(n, f0, f0 * 0.42) * env_ad(n, 0.004, dur * 0.5, 3)
    body = lp(brown(n, rng) * env_ad(n, 0.002, dur * 0.35, 4), 500) * 2
    return stereo((sub + body) * gain, 0, 0.6)


def roar(rng, dur=1.4, gain=1.0, bright=1600):
    n = secs(dur); x = brown(n, rng) * 2 + pink(n, rng) * 0.3
    y = sweep_filter(x, 300, bright, q=1.2, kind='low') * env_adsr(n, 0.06, dur * 0.3, 0.6, dur * 0.6)
    return stereo(y * gain, 0, 0.8)


def sparkle(rng, dur=0.9, gain=1.0, base=1800):
    n = secs(dur); out = np.zeros(n, np.float32)
    for k in range(int(dur * 18)):
        at = int(rng.uniform(0, 0.8) * n); m = secs(0.25)
        f = base * 2 ** (rng.integers(0, 12) / 6)
        tone = fm(m, f, 3.01, 1.5, 0.1) * env_ad(m, 0.002, 0.12, 5) * rng.uniform(0.1, 0.4)
        e = min(n, at + m); out[at:e] += tone[: e - at]
    return stereo(out * gain, 0, 1.0)


def twang(rng, gain=1.0):
    n = secs(0.35); s = karplus(n, rng.uniform(85, 105), rng, damp=0.975, bright=0.35) * env_ad(n, 0.001, 0.12, 4) * 0.5
    thr = lp(white(secs(0.08), rng), 1200) * env_ad(secs(0.08), 0.001, 0.04, 5) * 0.4
    s[: len(thr)] += thr
    return stereo(s * gain, -0.2, 0.3)


def whiz(rng, dur=0.35, f0=4200, f1=1500, gain=1.0):
    n = secs(dur); x = white(n, rng) * np.sin(np.linspace(0, np.pi, n)) ** 3
    y = sweep_filter(x, f0, f1, q=6)
    return stereo(y * gain * 1.5, 0, 0.5)


def thunk(rng, gain=1.0):
    wood = modal(secs(0.25), rng.uniform(180, 240), [1, 2.76, 5.4], [0.05, 0.03, 0.015], [1, 0.5, 0.25], rng)
    return mix([(stereo(wood * 0.8), 0, 1), (thud(rng, 3, 0.6, 0.25), 0, 1)]) * gain


def harp_arp(rng, notes, step=0.07, gain=1.0):
    hb = Bank('Strings/Harp/*.wav', 1.0)
    return mix([(hb.note(m, 1.5, 0.6, rng, release=1.2), i * step, 0.8 - i * 0.05) for i, m in enumerate(notes)]) * gain


def finish(x, room='room', wet=0.18, target=-16.0):
    x = reverb(x, room, wet)
    lvl = np.max(np.abs(x), axis=1); keep = np.where(lvl > lvl.max() * 0.002)[0]
    x = x[: (keep[-1] + secs(0.05)) if len(keep) else len(x)]
    # even loudness without squashing: the loudness target, but never past a clean peak
    # spiky sounds (sparks, crackles) are tamed by a fast compressor and a soft limiter, at most a few dB, so they are
    # not left far quieter than the rest
    from dsp import loudness, compress, limit
    for _ in range(2):
        g = 10 ** ((target - loudness(x)) / 20)
        if np.max(np.abs(x)) * g <= 0.85: break
        x = limit(compress(x * min(g, 0.85 / (np.max(np.abs(x)) + 1e-9) * 2.5), thresh_db=-14, ratio=4, attack=0.0005, release=0.08), 0.89)
    g = min(0.89 / (np.max(np.abs(x)) + 1e-9), 10 ** ((target - loudness(x)) / 20))
    return fade((x * g).astype(np.float32), 0.0, 0.08)


# ---- recipes (effect name -> (rng, result) -> stereo) ----
def strike_slash(rng, r):
    parts = [(swing(rng, 0.28, 400, 3000), 0, 0.9)]
    if r != 'miss':
        hit = 0.17
        parts += [(cut(rng, 0.05, 0.9), hit, 1), (squelch(rng, 0.16, 0.9), hit + 0.01, 1), (thud(rng, -2, 0.7, 0.4), hit, 1)]
        if r == 'crit':
            parts += [(ring(rng, -3, 0.35), hit, 1), (boom(rng, 0.55, 1.0, 70), hit, 1), (squelch(rng, 0.25, 0.8), hit + 0.08, 1), (cut(rng, 0.07, 0.7), hit + 0.02, 1)]
    else:
        parts += [(swing(rng, 0.22, 1200, 500, 0.35), 0.2, 1)]
    return finish(mix(parts), 'room', 0.2 if r == 'crit' else 0.14, -15 if r == 'crit' else -16.5)


def ranged_arrow(rng, r):
    parts = [(twang(rng, 0.8), 0, 1), (whiz(rng, 0.3, 4500, 1800, 0.7), 0.05, 1)]
    if r == 'miss': parts += [(stereo(crackle(secs(0.3), rng, 25, (2500, 7000), (0.001, 0.004)) * 0.6, 0.3), 0.36, 1), (whiz(rng, 0.25, 2500, 900, 0.35), 0.3, 1)]
    else:
        parts += [(thunk(rng, 0.9), 0.34, 1), (squelch(rng, 0.12, 0.6), 0.345, 1)]
        if r == 'crit': parts += [(thud(rng, -5, 0.8, 0.5), 0.34, 1), (squelch(rng, 0.22, 0.7), 0.38, 1)]
    return finish(mix(parts), 'room', 0.15, -16.5)


def burst_fire(rng, r):
    big = 1.25 if r == 'crit' else 1.0
    n = secs(0.5); whoomp = stereo(sweep_filter(brown(n, rng) * 3 * env_ad(n, 0.03, 0.3, 3), 150, 2200, q=1.0, kind='low'), 0, 0.7)
    parts = [(whoomp, 0, 0.9 * big), (pick(rng, 'timp', -6, 2.0), 0.05, 0.7 * big), (boom(rng, 0.8 * big, 1.8, 70), 0.04, 1),
             (roar(rng, 1.6 * big, 0.8, 1800), 0.06, 1), (stereo(crackle(secs(2.0), rng, 60, (1500, 8000)) * 0.8, 0, 1), 0.2, 1)]
    return finish(mix(parts), 'hall', 0.22, -14.5 if r == 'crit' else -15.5)


def force_bolt(rng, r):
    n = secs(0.25); charge = stereo(fm(n, 320, 1.5, 4, 0.5, fc_end=1100) * env_adsr(n, 0.2, 0.0, 1, 0.03) * 0.5, 0, 0.5)
    n2 = secs(0.3); zap = stereo(fm(n2, 1400, 2.01, 6, 0.3, fc_end=500) * env_ad(n2, 0.002, 0.2, 4) * 0.7, 0, 0.6)
    parts = [(charge, 0, 1), (zap, 0.22, 1), (whiz(rng, 0.25, 6000, 2500, 0.4), 0.24, 1)]
    if r != 'miss':
        n3 = secs(0.35); pop = stereo(fm(n3, 220, 1.41, 8, 0.0, fc_end=90) * env_ad(n3, 0.001, 0.2, 4), 0, 0.5)
        parts += [(pop, 0.46, 0.9), (sparkle(rng, 0.7, 0.6, 2200), 0.47, 1), (thud(rng, 0, 0.4, 0.3), 0.46, 1)]
        if r == 'crit': parts += [(boom(rng, 0.5, 1.0, 90), 0.46, 1), (sparkle(rng, 1.0, 0.5, 3200), 0.5, 1)]
    return finish(mix(parts), 'room', 0.25, -16)


def shield_block(rng, r):
    parts = [(pick(rng, 'brake', rng.uniform(-2, 1), 0.9), 0, 0.9), (ring(rng, -6, 0.4, 1.0), 0, 1), (thud(rng, -1, 0.6, 0.35), 0, 1), (swing(rng, 0.18, 600, 1800, 0.4), -0.0, 1)]
    return finish(mix(parts), 'room', 0.15, -16)


def burst_vitality(rng, r):
    root = 64 + int(rng.integers(-2, 3)); notes = [root, root + 4, root + 7, root + 12, root + 16, root + 19]
    vb = Bank('Strings/Violin Section/susVib/*.wav', 0.6)
    pad = mix([(vb.note(root + 12, 1.6, 0.25, rng, release=0.8), 0, 1), (vb.note(root + 19, 1.6, 0.2, rng, release=0.8), 0, 1)])
    n = pad.shape[0]; pad = pad * np.linspace(0, 1, n)[:, None] ** 0.7
    parts = [(harp_arp(rng, notes, 0.065, 0.9), 0, 1), (pad, 0.05, 0.6), (sparkle(rng, 1.2, 0.45, 2000), 0.15, 1)]
    return finish(mix(parts), 'hall', 0.3, -17)


def creature_down(rng, r):
    n = secs(0.4); cloth = stereo(bp(white(n, rng), 300, 2500) * env_ad(n, 0.02, 0.2, 3) * 0.5, 0, 0.5)
    parts = [(cloth, 0, 1), (thud(rng, -6, 1.0, 0.8), 0.18, 1), (thud(rng, -3, 0.5, 0.5), 0.32, 1),
             (stereo(crackle(secs(0.5), rng, 30, (800, 5000), (0.001, 0.006)) * 0.5, 0, 0.6), 0.2, 1), (ring(rng, 8, 0.12, 0.5, 'brake'), 0.34, 1)]
    return finish(mix(parts), 'room', 0.15, -16)


RECIPES = {'strike_slash': strike_slash, 'ranged_arrow': ranged_arrow, 'burst_fire': burst_fire, 'force_bolt': force_bolt,
           'shield_block': shield_block, 'burst_vitality': burst_vitality, 'creature_down': creature_down}
ATTACKS = {'strike_slash', 'ranged_arrow', 'force_bolt'}
