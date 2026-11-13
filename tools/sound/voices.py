"""More synthesis voices for the effect recipes (sfx.py): elements, magic, creatures and the table. Each returns a
stereo float32 array; most take rng first. Docs: docs/best-practices/sound.md."""
import numpy as np
from dsp import (SR, secs, lp, hp, bp, sweep_filter, env_ad, env_adsr, fade, white, pink, brown, sine, fm, karplus, modal,
                 crackle, stereo, mix)

FORMANTS = {'a': (750, 1200, 2600), 'o': (450, 800, 2600), 'e': (400, 2200, 2900), 'u': (330, 700, 2400), 'i': (300, 2500, 3200), 'r': (500, 1300, 1700)}


def saw(n, f0, f1=None, detune=0.0, rng=None):
    f1 = f0 if f1 is None else f1
    f = np.geomspace(max(f0, 1), max(f1, 1), n) * (1 + detune)
    ph = np.cumsum(f) / SR
    return (2 * (ph % 1) - 1).astype(np.float32)


def voice(rng, dur, vowel='a', f0=110, f1=None, breath=0.3, vib=5.0, vibd=0.01):
    """A rough vocal tone (shout, growl, wail, whisper): a buzzing source through vowel formants."""
    n = secs(dur); f1 = f0 if f1 is None else f1
    t = np.arange(n) / SR
    f = np.geomspace(f0, f1, n) * (1 + vibd * np.sin(2 * np.pi * vib * t))
    src = (2 * ((np.cumsum(f) / SR) % 1) - 1) * (1 - breath) + white(n, rng) * breath
    fs = FORMANTS[vowel]; out = np.zeros(n, np.float32)
    for k, fc in enumerate(fs): out += bp(src, fc * 0.85, fc * 1.15) * (1.0, 0.6, 0.25)[k]
    return out.astype(np.float32)


def growl(rng, dur=0.8, f0=70, gain=1.0):
    n = secs(dur); x = voice(rng, dur, 'o', f0, f0 * 0.8, breath=0.5, vib=26, vibd=0.08) * env_adsr(n, 0.05, 0.2, 0.7, dur * 0.4)
    return stereo(lp(x, 1800) * gain * 1.5, 0, 0.4)


def shout(rng, dur=0.45, f0=150, vowel='a', gain=1.0):
    n = secs(dur); x = voice(rng, dur, vowel, f0, f0 * 0.85, breath=0.35, vib=7, vibd=0.03) * env_adsr(n, 0.02, 0.08, 0.8, dur * 0.4)
    return stereo(x * gain * 1.4, 0, 0.3)


def wail(rng, dur=1.6, f0=520, gain=1.0):
    n = secs(dur); t = np.arange(n) / SR
    f = f0 * (1 + 0.5 * np.sin(np.pi * t / dur)) * (1 + 0.02 * np.sin(2 * np.pi * 6 * t))
    src = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.3 * white(n, rng)
    x = (bp(src, 600, 1400) + bp(src, 2200, 3200) * 0.4) * env_adsr(n, 0.3, 0.3, 0.8, dur * 0.4)
    return stereo(x.astype(np.float32) * gain * 1.6, 0, 1.0)


def whisper(rng, dur=1.2, gain=1.0):
    n = secs(dur); out = np.zeros(n, np.float32); t = 0.0
    while t < dur - 0.1:
        d = rng.uniform(0.06, 0.18); m = secs(d); v = rng.choice(list(FORMANTS))
        syl = voice(rng, d, v, 1, breath=1.0) * env_adsr(m, 0.01, 0.02, 0.7, d * 0.5) * rng.uniform(0.3, 1.0)
        a = secs(t); out[a:a + m] += syl[: n - a]; t += d + rng.uniform(0.0, 0.08)
    return stereo(hp(out, 800) * gain * 2.0, 0, 1.0)


def babble(rng, dur=1.2, gain=1.0, f0=(120, 260)):
    n = secs(dur); out = np.zeros(n, np.float32); t = 0.0
    while t < dur - 0.05:
        d = rng.uniform(0.05, 0.14); m = secs(d); f = rng.uniform(*f0)
        syl = voice(rng, d, rng.choice(list(FORMANTS)), f, f * rng.uniform(0.7, 1.4), breath=0.2) * env_adsr(m, 0.005, 0.02, 0.8, d * 0.4)
        a = secs(t); out[a:a + m] += syl[: n - a] * rng.uniform(0.4, 1.0); t += d + rng.uniform(0, 0.05)
    return stereo(out * gain, rng.uniform(-0.3, 0.3), 0.6)


def zap(rng, dur=0.5, gain=1.0, base=90):
    """Electric: a buzzing saw with crackling bursts."""
    n = secs(dur); buzz = (saw(n, base, base * 0.9) + saw(n, base * 1.01, base * 0.92)) * 0.3
    cr = crackle(n, rng, 180, (2000, 11000), (0.0003, 0.002)) * 2.5
    x = (hp(buzz, 300) + cr) * env_ad(n, 0.003, dur * 0.6, 3)
    return stereo(x * gain, 0, 0.7)


def ice(rng, dur=0.9, gain=1.0):
    n = secs(dur); out = np.zeros(n, np.float32)
    for _ in range(14):
        at = int(rng.uniform(0, 0.35) * n); m = secs(rng.uniform(0.1, 0.5))
        s = modal(m, rng.uniform(1800, 4500), [1, 2.32, 4.1, 6.7], [0.15, 0.08, 0.05, 0.03], [1, 0.5, 0.3, 0.2], rng) * rng.uniform(0.1, 0.4)
        e = min(n, at + m); out[at:e] += s[: e - at]
    crunch = bp(white(n, rng), 3000, 12000) * env_ad(n, 0.002, 0.15, 5) * 0.5
    return stereo((out + crunch) * gain, 0, 1.0)


def sizzle(rng, dur=0.8, gain=1.0, bubble=True):
    n = secs(dur); x = hp(white(n, rng), 3500) * env_adsr(n, 0.02, 0.1, 0.6, dur * 0.6) * 0.5
    if bubble:
        for _ in range(int(dur * 25)):
            at = rng.integers(0, max(1, n - secs(0.06))); m = secs(0.04)
            x[at:at + m] += sine(m, rng.uniform(500, 1600), rng.uniform(1600, 3000)) * env_ad(m, 0.002, 0.02, 4) * rng.uniform(0.05, 0.25)
    return stereo(x * gain, 0, 0.8)


def gas(rng, dur=1.6, gain=1.0):
    n = secs(dur); x = sweep_filter(pink(n, rng) * env_adsr(n, 0.15, 0.3, 0.7, dur * 0.5), 600, 2400, q=1.2) * 0.9
    bub = np.zeros(n, np.float32)
    for _ in range(int(dur * 18)):
        at = rng.integers(0, max(1, n - secs(0.08))); m = secs(0.07)
        bub[at:at + m] += sine(m, rng.uniform(120, 300), rng.uniform(300, 600)) * env_ad(m, 0.004, 0.04, 4) * rng.uniform(0.1, 0.4)
    return stereo((x + lp(bub, 1200)) * gain, 0, 1.0)


def drone(rng, dur=1.6, f0=55, gain=1.0, dark=True):
    n = secs(dur)
    x = sum(saw(n, f0 * r, f0 * r * (0.97 if dark else 1.0), detune=rng.uniform(-0.004, 0.004)) for r in (1, 1.5, 2.01, 0.5)) * 0.25
    x = lp(x, 500 if dark else 1500) * env_adsr(n, dur * 0.25, 0.2, 0.8, dur * 0.4)
    return stereo(x * gain * 1.4, 0, 0.8)


def reverse_swell(rng, dur=0.9, gain=1.0, lo=200, hi=3000):
    """A sound pulled backwards: rising, then cut (void, darkness, inhale, teleport)."""
    n = secs(dur); x = sweep_filter(pink(n, rng), lo, hi, q=1.0) * np.linspace(0, 1, n) ** 3
    return stereo(x * gain * 1.2, 0, 0.9)


def shimmer(rng, dur=1.2, gain=1.0, base=880, scale=(0, 4, 7, 11, 12, 16, 19), down=False):
    n = secs(dur); out = np.zeros(n, np.float32); steps = list(scale)[::-1] if down else list(scale)
    for i, s in enumerate(steps):
        at = secs(i * dur / (len(steps) + 2)); m = secs(min(1.0, dur))
        f = base * 2 ** (s / 12)
        tone = (fm(m, f, 2.0, 0.6, 0.0) * 0.6 + np.sin(2 * np.pi * f * 2 * np.arange(m) / SR) * 0.15) * env_ad(m, 0.003, 0.5, 4)
        e = min(n, at + m); out[at:e] += tone[: e - at].astype(np.float32) * 0.5
    return stereo(out * gain, 0, 1.0)


def bubble(rng, dur=0.7, gain=1.0, f0=300, f1=900):
    n = secs(dur); x = fm(n, f0, 1.5, 3.0, 0.3, fc_end=f1) * env_adsr(n, dur * 0.4, 0.1, 0.7, dur * 0.4)
    return stereo(x * gain * 0.6, 0, 0.8)


def pulse(rng, dur=0.6, f=440, gain=1.0):
    """A sonar-like ping: a clean tone with a soft echo."""
    n = secs(dur); x = sine(n, f, f * 0.98) * env_ad(n, 0.004, 0.35, 5)
    return stereo(x * gain * 0.6, 0, 0.6)


def buzz_swarm(rng, dur=1.4, gain=1.0):
    n = secs(dur); t = np.arange(n) / SR; out = np.zeros(n, np.float32)
    for _ in range(18):
        f = rng.uniform(160, 420) * (1 + 0.03 * np.sin(2 * np.pi * rng.uniform(3, 9) * t + rng.uniform(0, 6)))
        out += (2 * ((np.cumsum(f) / SR) % 1) - 1).astype(np.float32) * rng.uniform(0.03, 0.08) * (0.5 + 0.5 * np.sin(2 * np.pi * rng.uniform(0.5, 3) * t + rng.uniform(0, 6)))
    x = bp(out, 200, 3000) * env_adsr(n, 0.2, 0.2, 0.8, dur * 0.4)
    return stereo(x * gain * 1.6, 0, 1.0)


def creak(rng, dur=0.8, f0=180, gain=1.0):
    """Wood or rope creaking under strain: a stick-slip pulse train through a resonance."""
    n = secs(dur); out = np.zeros(n, np.float32); t = 0
    while t < n:
        f = f0 * rng.uniform(0.8, 1.25) * (1 + 0.3 * np.sin(t / n * np.pi)); step = int(SR / f)
        out[t] = rng.uniform(0.5, 1); t += step
    y = bp(out, 400, 2200) * 3 + bp(out, 2500, 4500)
    return stereo(y * env_adsr(n, 0.05, 0.1, 0.8, dur * 0.3) * gain, 0, 0.4)


def rustle(rng, dur=0.6, gain=1.0, lo=800, hi=6000):
    n = secs(dur); x = bp(white(n, rng), lo, hi) * crackle(n, rng, 300, (2000, 6000), (0.001, 0.004)) * 0
    x = bp(white(n, rng), lo, hi) * np.abs(lp(white(n, rng), 30)) * 6
    return stereo(x * env_adsr(n, 0.05, 0.1, 0.8, dur * 0.4) * gain, 0, 0.8)


def clacks(rng, count=7, start_gap=0.09, gain=1.0, f=(1800, 3200)):
    """A run of hard little impacts slowing down (dice on a table, pebbles)."""
    parts, t, g = [], 0.0, start_gap
    for k in range(count):
        m = secs(0.05)
        c = modal(m, rng.uniform(*f), [1, 1.71, 2.9], [0.012, 0.008, 0.005], [1, 0.6, 0.3], rng) * (1 - k / (count + 2))
        parts.append((stereo(c * gain, rng.uniform(-0.3, 0.3)), t, 1)); t += g; g *= rng.uniform(1.05, 1.3)
    return mix(parts)


def bell(rng, f=880, dur=1.6, gain=1.0):
    n = secs(dur); x = modal(n, f, [1, 2.0, 2.76, 5.4, 8.9], [dur * 0.5, dur * 0.4, dur * 0.25, dur * 0.12, dur * 0.06], [1, 0.5, 0.45, 0.2, 0.1], rng)
    return stereo(x * gain * 0.6, 0, 0.6)


def footsteps(rng, count=4, gap=0.13, gain=1.0):
    parts = []
    for k in range(count):
        m = secs(0.09); s = lp(brown(m, rng), 900) * env_ad(m, 0.002, 0.04, 5) * 3 + bp(white(m, rng), 2000, 6000) * env_ad(m, 0.001, 0.02, 6) * 0.3
        parts.append((stereo(s * gain, rng.uniform(-0.2, 0.2)), k * gap * rng.uniform(0.9, 1.1), 1))
    return mix(parts)


def splat(rng, dur=0.35, gain=1.0):
    n = secs(dur); x = sweep_filter(brown(n, rng) * 3 * env_ad(n, 0.002, dur * 0.4, 5), 2000, 300, q=2) + bp(white(n, rng), 1500, 5000) * env_ad(n, 0.001, 0.05, 6) * 0.5
    return stereo(x * gain, 0, 0.5)


def stab(rng, chord=(48, 55, 60, 63), dur=0.5, inst='hn', gain=1.0):
    """A short orchestral hit from the recorded samples (brass, strings)."""
    from samples import Bank
    pats = {'hn': 'Brass/F Horn/sus/*.wav', 'tbn': 'Brass/Tenor Trombone/sus/*.wav', 'vln': 'Strings/Violin Section/susVib/*.wav', 'vc': 'Strings/Cello Section/susvib/*.wav',
            'trem': 'Strings/Violin Section/Trem/*.wav', 'hp': 'Strings/Harp/*.wav', 'glk': 'Percussion/Glock/*.wav', 'tb': 'Percussion/TB_hit_*.wav', 'tpt': 'Brass/Trumpet/sus/*.wav'}
    b = _bank(pats[inst])
    return mix([(b.note(m, dur, 0.8, rng, release=0.4), 0, 0.6) for m in chord]) * gain


_B = {}
def _bank(p):
    from samples import Bank
    if p not in _B: _B[p] = Bank(p, 1.0)
    return _B[p]
