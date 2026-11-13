"""The board's ambient loops: places that sound (a campfire, a cave, a river, wind, rain), rendered offline as
seamless loops (the end crossfades into the start) for the board to place on maps with a radius. A recipe takes
(rng, seconds) and returns stereo. Docs: docs/best-practices/sound.md."""
import numpy as np
from dsp import SR, secs, loudness, lp, hp, bp, env_ad, white, pink, brown, sine, crackle, stereo, mix, reverb, master, sweep_filter


def lfo(n, rate, depth, rng, base=1.0):
    t = np.arange(n) / SR; ph = rng.uniform(0, 2 * np.pi)
    slow = np.sin(2 * np.pi * rate * t + ph) + 0.5 * np.sin(2 * np.pi * rate * 2.7 * t + ph * 1.3)
    return (base + depth * slow / 1.5).astype(np.float32)


def loopable(x, xf=2.5):
    """Make a loop seamless: the last xf seconds crossfade (equal power) into the first, then are cut off."""
    k = secs(xf); head, tail = x[:k], x[-k:]
    w = np.sin(np.linspace(0, np.pi / 2, k))[:, None]
    y = x[:-k].copy(); y[:k] = head * w + tail * np.cos(np.linspace(0, np.pi / 2, k))[:, None]
    return y


def level(x, target):
    """Bring a loop to its loudness target; spiky beds (crackles, ticks) are tamed by a fast compressor and a soft
    limiter rather than being left quiet."""
    from dsp import compress, limit
    for _ in range(3):
        g = 10 ** ((target - loudness(x)) / 20)
        if np.max(np.abs(x)) * g <= 0.8: return (x * g).astype(np.float32)
        x = limit(compress(x * g, thresh_db=-14, ratio=6, attack=0.0005, release=0.06), 0.8)
    return (x * min(1.0, 0.8 / (np.max(np.abs(x)) + 1e-9))).astype(np.float32)


def campfire(rng, seconds=30):
    n = secs(seconds + 2.5)
    bed = lp(brown(n, rng), 600) * 1.6 * lfo(n, 0.17, 0.35, rng)   # the low roar of the flames
    hiss = bp(pink(n, rng), 2500, 9000) * 0.12 * lfo(n, 0.4, 0.5, rng)
    crk = crackle(n, rng, 35, (1200, 7000), (0.0006, 0.004)) * 1.6       # small crackles
    pops = crackle(n, rng, 2.5, (400, 2500), (0.004, 0.02)) * 2.2       # wood pops
    left = bed + hiss + crk + pops
    right = np.roll(bed, secs(0.011)) + np.roll(hiss, secs(0.017)) + crackle(n, rng, 35, (1200, 7000), (0.0006, 0.004)) * 1.6 + np.roll(pops, secs(0.006))
    x = np.stack([left, right], 1).astype(np.float32)
    x = reverb(x, 'outdoors', 0.15)[:n]
    return level(loopable(x), -22)


def cave(rng, seconds=30):
    n = secs(seconds + 2.5)
    air = lp(brown(n, rng), 220) * 0.9 * lfo(n, 0.05, 0.4, rng)          # deep room tone
    far = bp(pink(n, rng), 300, 900) * 0.08 * lfo(n, 0.08, 0.6, rng)
    drips = np.zeros(n, np.float32)
    for _ in range(int(seconds * 0.9)):
        at = int(rng.uniform(0, n - secs(0.5))); m = secs(0.18)
        f = rng.uniform(1200, 3200)
        d = sine(m, f * 1.6, f) * env_ad(m, 0.0005, 0.05, 6) * rng.uniform(0.15, 0.6)
        drips[at:at + m] += d
    x = stereo(air + far, 0, 0.8) + np.stack([drips * rng.uniform(0.4, 1), np.roll(drips, secs(0.004)) * rng.uniform(0.4, 1)], 1)
    x = reverb(x.astype(np.float32), 'cave', 0.55)[:n]
    return level(loopable(x), -24)



# ---- more places ----
from dsp import fm, karplus, modal, env_adsr, pan_stereo
from voices import babble, whisper, creak, rustle, bell, footsteps, wail, buzz_swarm, voice, clacks, drone


def bed(n, rng, lo, hi, gain, rate=0.07, depth=0.4, kind='pink'):
    src = {'pink': pink, 'brown': brown, 'white': white}[kind](n, rng)
    x = (bp(src, lo, hi) if lo else lp(src, hi)) * gain
    return np.stack([x * lfo(n, rate, depth, rng), np.roll(x, secs(0.013)) * lfo(n, rate, depth, rng)], 1).astype(np.float32)


def scatter(n, rng, count, make, pan=0.8, gain=(0.4, 1.0), edge=0.4):
    """count events (make(rng) -> stereo or mono) at random times and positions."""
    out = np.zeros((n, 2), np.float32)
    for _ in range(int(count)):
        x = make(rng)
        if x.ndim == 1: x = stereo(x, 0, 0)
        x = pan_stereo(x, rng.uniform(-pan, pan)) * rng.uniform(*gain)
        at = int(rng.uniform(secs(edge), max(secs(edge) + 1, n - len(x) - secs(edge))))
        e = min(n, at + len(x)); out[at:e] += x[: e - at]
    return out


def chirp(rng, base=None):
    """A small bird: a few quick FM sweeps."""
    base = base or rng.uniform(2500, 5000); parts = []; t = 0
    for _ in range(rng.integers(2, 6)):
        d = rng.uniform(0.04, 0.12); m = secs(d)
        f1 = base * rng.uniform(0.7, 1.4)
        parts.append((stereo(fm(m, base, 1.0, 0.0, fc_end=f1) * env_ad(m, 0.005, d * 0.6, 3) * 0.4, 0, 0), t, 1)); t += d + rng.uniform(0.02, 0.1)
    return mix(parts)


def warble(rng):
    """A songbird phrase: a trill then a falling call."""
    m = secs(rng.uniform(0.4, 0.9)); t = np.arange(m) / SR; f0 = rng.uniform(2200, 3800)
    f = f0 * (1 + 0.15 * np.sin(2 * np.pi * rng.uniform(18, 30) * t)) * np.linspace(1.1, 0.85, m)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_adsr(m, 0.01, 0.05, 0.7, 0.1) * 0.3
    return stereo(x.astype(np.float32), 0, 0)


def cricket(rng, seconds):
    n = secs(seconds); f = rng.uniform(3800, 5200); t = np.arange(n) / SR
    rate = rng.uniform(14, 22); chirps = (np.sin(2 * np.pi * rate * t) > 0.3).astype(np.float32)
    gate = (np.sin(2 * np.pi * rng.uniform(0.6, 1.2) * t + rng.uniform(0, 6)) > -0.2).astype(np.float32)
    x = np.sin(2 * np.pi * f * t) * lp(chirps * gate, 200) * 0.12
    return x.astype(np.float32)


def frog(rng):
    m = secs(rng.uniform(0.15, 0.35)); f0 = rng.uniform(140, 320)
    t = np.arange(m) / SR; src = np.sign(np.sin(2 * np.pi * f0 * t)) * (0.5 + 0.5 * np.sin(2 * np.pi * rng.uniform(20, 40) * t))
    x = bp(src.astype(np.float32), 300, 1500) * env_adsr(m, 0.01, 0.05, 0.8, 0.05) * 0.5
    return stereo(x, 0, 0)


def owl(rng):
    parts = []
    for k, (d, f) in enumerate([(0.25, 420), (0.5, 400), (0.2, 380), (0.35, 390)][: rng.integers(2, 5)]):
        m = secs(d); x = np.sin(2 * np.pi * f * np.arange(m) / SR) * env_adsr(m, 0.04, 0.05, 0.8, 0.1) * 0.3 + bp(white(m, rng), 300, 600) * 0.03
        parts.append((stereo(x.astype(np.float32), 0, 0), k * 0.45, 1))
    return mix(parts)


def crow(rng):
    parts = []
    for k in range(rng.integers(1, 4)):
        d = rng.uniform(0.2, 0.35); parts.append((stereo(voice(rng, d, 'a', 700, 600, breath=0.5, vib=40, vibd=0.05) * env_adsr(secs(d), 0.01, 0.05, 0.8, 0.08) * 0.4, 0, 0), k * 0.4, 1))
    return mix(parts)


def howl(rng):
    return wail(rng, rng.uniform(2.0, 3.2), rng.uniform(380, 520), 0.5)


def drop(rng, f=None):
    f = f or rng.uniform(1200, 3500); m = secs(0.12)
    return stereo(sine(m, f * 1.6, f) * env_ad(m, 0.0005, 0.04, 6) * rng.uniform(0.2, 0.6), 0, 0)


def rain_bed(n, rng, heavy=1.0):
    hiss = bed(n, rng, 1200, 9000, 0.25 * heavy, 0.05, 0.25)
    patter = np.stack([crackle(n, rng, 400 * heavy, (2000, 9000), (0.0002, 0.0012)) for _ in range(2)], 1) * 0.6
    low = bed(n, rng, 0, 400, 0.5 * heavy, 0.03, 0.2, 'brown')
    return hiss + patter + low


def thunder_roll(rng):
    m = secs(rng.uniform(3, 5)); x = lp(brown(m, rng), 260) * env_adsr(m, 0.3, 0.8, 0.5, m / SR * 0.5) * 3
    x += lp(crackle(m, rng, 30, (300, 2000), (0.002, 0.01)), 800) * np.linspace(1, 0, m) * 2
    return stereo(x.astype(np.float32), 0, 1.0)


def wave(rng):
    m = secs(rng.uniform(4, 7)); e = np.sin(np.linspace(0, np.pi, m)) ** 2
    x = sweep_filter(pink(m, rng) * e, 300, 2500, q=0.7) * 1.6 + lp(brown(m, rng), 300) * e * 1.2
    return stereo(x.astype(np.float32), 0, 1.0)


def hammer(rng):
    from samples import perc
    p = perc('Percussion/Anvil_Hit1*.wav'); x = p[int(rng.integers(len(p)))][: secs(1.0)]
    return x * 0.5


def chant(rng, seconds):
    n = secs(seconds); out = np.zeros(n, np.float32); t = 0.0
    root = rng.uniform(95, 115)
    while t < seconds - 3:
        d = rng.uniform(2.5, 4.5); m = secs(d); f = root * 2 ** (rng.choice([0, 0, 3, 5, 7, -2]) / 12)
        x = sum(voice(rng, d, rng.choice(['o', 'u', 'a']), f * k, breath=0.1, vib=4.5, vibd=0.006) * g for k, g in ((1, 1), (1.003, 0.6), (0.998, 0.6)))
        a = secs(t); out[a:a + m] += (x * env_adsr(m, 0.6, 0.3, 0.8, 1.0)).astype(np.float32)[: n - a]; t += d * 0.85
    return out * 0.6


def clock_tick(n, rng, rate=1.0):
    out = np.zeros(n, np.float32); m = secs(0.03)
    for k in range(int(n / SR * rate)):
        a = secs(k / rate); f = 3000 if k % 2 == 0 else 2600
        out[a:a + m] += modal(m, f, [1, 2.3], [0.01, 0.005], [1, 0.4], rng)[: n - a] * 0.25
    return out


def amb(seconds, rng, layers, room=None, wet=0.2, target=-24):
    n = secs(seconds + 2.5); x = np.zeros((n, 2), np.float32)
    for L in layers: x += L(n)
    if room: x = reverb(x, room, wet)[:n]
    return level(loopable(x), target)


def river(rng, s=30):
    return amb(s, rng, [lambda n: bed(n, rng, 300, 3000, 0.5, 0.15, 0.3), lambda n: bed(n, rng, 2000, 8000, 0.15, 0.3, 0.5),
                        lambda n: scatter(n, rng, s * 12, lambda r: drop(r, r.uniform(400, 1400)), 0.9, (0.1, 0.4))], 'outdoors', 0.15, -22)
def stream(rng, s=30):
    return amb(s, rng, [lambda n: bed(n, rng, 800, 6000, 0.25, 0.3, 0.5), lambda n: scatter(n, rng, s * 20, lambda r: drop(r, r.uniform(700, 2400)), 0.7, (0.1, 0.4)),
                        lambda n: scatter(n, rng, s * 0.3, chirp, 0.9, (0.05, 0.15))], 'outdoors', 0.15, -24)
def waterfall(rng, s=30):
    return amb(s, rng, [lambda n: bed(n, rng, 0, 1200, 1.0, 0.1, 0.15, 'brown'), lambda n: bed(n, rng, 600, 10000, 0.6, 0.2, 0.2), lambda n: bed(n, rng, 2000, 9000, 0.25, 0.7, 0.3)], 'outdoors', 0.2, -20)
def wind_ambient(rng, s=30):
    return amb(s, rng, [lambda n: np.stack([sweep_filter(pink(n, rng) * lfo(n, 0.08, 0.7, rng), 200, 1200, q=2.5, steps=96)] * 2, 1) * 1.6,
                        lambda n: bed(n, rng, 1500, 5000, 0.1, 0.13, 0.8)], 'outdoors', 0.2, -24)
def howling_wind(rng, s=30):
    return amb(s, rng, [lambda n: np.stack([sweep_filter(pink(n, rng) * lfo(n, 0.12, 0.8, rng), 400, 2200, q=6, steps=128) * 2.5 for _ in range(2)], 1),
                        lambda n: bed(n, rng, 0, 300, 0.6, 0.05, 0.5, 'brown')], 'outdoors', 0.25, -22)
def rain(rng, s=30):
    return amb(s, rng, [lambda n: rain_bed(n, rng, 1.0), lambda n: scatter(n, rng, s * 6, lambda r: drop(r, r.uniform(800, 2000)), 0.9, (0.1, 0.4))], 'outdoors', 0.15, -22)
def rain_light(rng, s=30):
    return amb(s, rng, [lambda n: rain_bed(n, rng, 0.4), lambda n: scatter(n, rng, s * 4, drop, 0.9, (0.1, 0.4))], 'outdoors', 0.15, -25)
def storm(rng, s=40):
    return amb(s, rng, [lambda n: rain_bed(n, rng, 1.6), lambda n: scatter(n, rng, 3, thunder_roll, 0.6, (0.5, 1.0), edge=3.0)], 'outdoors', 0.2, -20)
def forest_day(rng, s=40):
    return amb(s, rng, [lambda n: bed(n, rng, 600, 4000, 0.12, 0.1, 0.8), lambda n: scatter(n, rng, s * 0.8, chirp, 0.9, (0.15, 0.5)),
                        lambda n: scatter(n, rng, s * 0.25, warble, 0.9, (0.15, 0.5)), lambda n: scatter(n, rng, s * 0.15, lambda r: rustle(r, r.uniform(0.6, 1.5), 0.3, 600, 5000), 0.9)], 'outdoors', 0.2, -25)
def forest_night(rng, s=40):
    return amb(s, rng, [lambda n: bed(n, rng, 300, 2000, 0.08, 0.06, 0.6), lambda n: np.stack([cricket(rng, n / SR) + cricket(rng, n / SR), cricket(rng, n / SR) + cricket(rng, n / SR)], 1),
                        lambda n: scatter(n, rng, 2, owl, 0.8, (0.3, 0.6), edge=2.0)], 'outdoors', 0.25, -26)
def wolves(rng, s=40):
    return amb(s, rng, [lambda n: bed(n, rng, 300, 1800, 0.1, 0.08, 0.7), lambda n: scatter(n, rng, 4, howl, 0.9, (0.3, 0.7), edge=2.5)], 'outdoors', 0.35, -25)
def meadow(rng, s=40):
    return amb(s, rng, [lambda n: bed(n, rng, 500, 3000, 0.1, 0.1, 0.8), lambda n: np.stack([cricket(rng, n / SR) * 0.5] * 2, 1),
                        lambda n: scatter(n, rng, s * 0.5, chirp, 0.9, (0.1, 0.3)), lambda n: scatter(n, rng, s * 0.1, lambda r: buzz_swarm(r, 1.2, 0.08), 0.9)], 'outdoors', 0.15, -26)
def swamp(rng, s=40):
    return amb(s, rng, [lambda n: bed(n, rng, 0, 400, 0.3, 0.05, 0.3, 'brown'), lambda n: scatter(n, rng, s * 2.5, frog, 0.9, (0.2, 0.6)),
                        lambda n: scatter(n, rng, s * 1.5, lambda r: stereo(fm(secs(0.1), r.uniform(150, 400), 1.0, 0.0, fc_end=r.uniform(400, 900)) * env_ad(secs(0.1), 0.01, 0.05, 4) * 0.2, 0, 0), 0.8, (0.1, 0.4)),
                        lambda n: np.stack([cricket(rng, n / SR) * 0.6] * 2, 1), lambda n: scatter(n, rng, s * 0.08, lambda r: buzz_swarm(r, 1.5, 0.1), 0.9)], 'outdoors', 0.2, -25)
def sea(rng, s=40):
    return amb(s, rng, [lambda n: scatter(n, rng, s / 3.2, wave, 0.7, (0.6, 1.0), edge=0.2), lambda n: bed(n, rng, 0, 500, 0.35, 0.06, 0.4, 'brown'),
                        lambda n: scatter(n, rng, 3, lambda r: stereo(voice(r, 0.5, 'e', 1400, 1100, breath=0.3) * env_adsr(secs(0.5), 0.02, 0.1, 0.7, 0.2) * 0.15, 0, 0), 0.9, edge=2.0)], 'outdoors', 0.2, -22)
def ship(rng, s=40):
    return amb(s, rng, [lambda n: scatter(n, rng, s / 4, wave, 0.7, (0.4, 0.7)), lambda n: scatter(n, rng, s * 0.4, lambda r: creak(r, r.uniform(0.6, 1.4), r.uniform(90, 200), 0.6), 0.8),
                        lambda n: bed(n, rng, 300, 1500, 0.12, 0.1, 0.8)], 'outdoors', 0.15, -23)
def brazier(rng, s=30):
    n = secs(s + 2.5)
    x = stereo(bp(brown(n, rng), 200, 1200) * 1.2 * lfo(n, 0.3, 0.4, rng), 0, 0.6) + np.stack([crackle(n, rng, 50, (1500, 8000), (0.0005, 0.003)) for _ in range(2)], 1) * 1.6
    return level(loopable(reverb(x.astype(np.float32), 'room', 0.15)[:n]), -24)
def torch(rng, s=20):
    n = secs(s + 2.5)
    x = stereo(bp(pink(n, rng), 300, 2500) * 0.5 * lfo(n, 0.9, 0.6, rng), 0, 0.3) + np.stack([crackle(n, rng, 12, (2000, 8000), (0.0004, 0.002))] * 2, 1)
    return level(loopable(x.astype(np.float32)), -28)
def forge(rng, s=40):
    return amb(s, rng, [lambda n: campfire_bed(n, rng), lambda n: scatter(n, rng, s * 0.5, hammer, 0.4, (0.4, 0.8)),
                        lambda n: scatter(n, rng, s * 0.12, lambda r: stereo(sweep_filter(brown(secs(1.2), r) * env_adsr(secs(1.2), 0.3, 0.2, 0.7, 0.5), 200, 900, q=1, kind='low') * 2, 0, 0.5), 0.3)], 'room', 0.2, -22)
def campfire_bed(n, rng):
    x = lp(brown(n, rng), 600) * 1.6 * lfo(n, 0.17, 0.35, rng) + crackle(n, rng, 35, (1200, 7000), (0.0006, 0.004)) * 1.6
    return stereo(x.astype(np.float32), 0, 0.6)
def tavern(rng, s=40):
    return amb(s, rng, [lambda n: np.stack([babble(rng, n / SR, 0.5, (110, 240))[:, 0] for _ in range(2)], 1)[:n] if False else crowd(n, rng, 6),
                        lambda n: scatter(n, rng, s * 0.6, lambda r: clacks(r, r.integers(1, 3), 0.1, 0.5, (2200, 4000)), 0.9, (0.2, 0.6)),
                        lambda n: scatter(n, rng, s * 0.15, lambda r: footsteps(r, r.integers(3, 6), 0.4, 0.4), 0.8), lambda n: campfire_bed(n, rng) * 0.25], 'room', 0.25, -22)
def crowd(n, rng, voices_n=6, f0=(110, 260)):
    out = np.zeros((n, 2), np.float32)
    for _ in range(voices_n):
        b = babble(rng, n / SR, 1.0, f0); b = b[:n] if len(b) >= n else np.pad(b, ((0, n - len(b)), (0, 0)))
        out += pan_stereo(b, rng.uniform(-0.8, 0.8)) * lfo(n, rng.uniform(0.05, 0.2), 0.8, rng, 0.6)[:, None]
    return lp(out, 3000) * 0.6
def town(rng, s=40):
    return amb(s, rng, [lambda n: crowd(n, rng, 4) * 0.5, lambda n: scatter(n, rng, s * 0.3, lambda r: footsteps(r, r.integers(4, 9), 0.45, 0.5), 0.9),
                        lambda n: scatter(n, rng, s * 0.06, lambda r: creak(r, 2.0, 120, 0.4), 0.9), lambda n: scatter(n, rng, s * 0.4, chirp, 0.9, (0.05, 0.15)),
                        lambda n: scatter(n, rng, 1, lambda r: bell(r, 440, 3.0, 0.3), 0.6, edge=3.0)], 'outdoors', 0.2, -24)
def market(rng, s=40):
    return amb(s, rng, [lambda n: crowd(n, rng, 9, (120, 300)), lambda n: scatter(n, rng, s * 0.3, lambda r: clacks(r, r.integers(4, 9), 0.04, 0.4, (2600, 4800)), 0.9),
                        lambda n: scatter(n, rng, s * 0.3, lambda r: footsteps(r, r.integers(3, 7), 0.4, 0.5), 0.9)], 'outdoors', 0.15, -22)
def dungeon(rng, s=40):
    return amb(s, rng, [lambda n: bed(n, rng, 0, 220, 0.9, 0.05, 0.4, 'brown'), lambda n: scatter(n, rng, s * 0.6, drop, 0.8, (0.15, 0.5)),
                        lambda n: scatter(n, rng, s * 0.06, lambda r: clacks(r, r.integers(3, 7), 0.12, 0.25, (900, 2000)), 0.9, edge=2.0),
                        lambda n: scatter(n, rng, s * 0.05, lambda r: creak(r, 1.5, 90, 0.3), 0.9, edge=2.0)], 'cave', 0.5, -25)
def crypt(rng, s=40):
    return amb(s, rng, [lambda n: bed(n, rng, 0, 180, 0.9, 0.04, 0.4, 'brown'), lambda n: stereo(drone(rng, n / SR + 0.01, 41, 0.15)[:n, 0], 0, 1.0)[:n] if True else 0,
                        lambda n: scatter(n, rng, 3, lambda r: whisper(r, r.uniform(1.0, 2.0), 0.2), 0.9, edge=2.5), lambda n: scatter(n, rng, s * 0.3, drop, 0.8, (0.1, 0.3))], 'cave', 0.55, -26)
def sewer(rng, s=40):
    return amb(s, rng, [lambda n: bed(n, rng, 400, 2500, 0.2, 0.2, 0.5), lambda n: scatter(n, rng, s * 2, drop, 0.8, (0.1, 0.5)),
                        lambda n: scatter(n, rng, s * 0.15, lambda r: stereo(fm(secs(0.08), r.uniform(3500, 5000), 1.0, 0.0, fc_end=r.uniform(4500, 6000)) * env_ad(secs(0.08), 0.005, 0.04, 4) * 0.15, 0, 0), 0.9),
                        lambda n: bed(n, rng, 0, 200, 0.5, 0.05, 0.3, 'brown')], 'cave', 0.4, -24)
def mine(rng, s=40):
    return amb(s, rng, [lambda n: bed(n, rng, 0, 250, 0.8, 0.05, 0.4, 'brown'), lambda n: scatter(n, rng, s * 0.25, lambda r: hammer(r)[: secs(0.4)] * 0.3, 0.9),
                        lambda n: scatter(n, rng, s * 0.05, lambda r: clacks(r, 10, 0.05, 0.3, (300, 1200)), 0.9, edge=2.0), lambda n: scatter(n, rng, s * 0.4, drop, 0.8, (0.1, 0.3))], 'cave', 0.5, -24)
def lava(rng, s=40):
    return amb(s, rng, [lambda n: bed(n, rng, 0, 160, 1.2, 0.04, 0.5, 'brown'),
                        lambda n: scatter(n, rng, s * 3, lambda r: stereo(fm(secs(0.15), r.uniform(60, 160), 1.0, 0.0, fc_end=r.uniform(150, 300)) * env_ad(secs(0.15), 0.01, 0.08, 4) * 0.5, 0, 0), 0.8),
                        lambda n: np.stack([crackle(n, rng, 15, (800, 4000), (0.002, 0.01))] * 2, 1) * 0.6, lambda n: bed(n, rng, 3000, 9000, 0.05, 0.2, 0.8)], 'cave', 0.3, -22)
def arcane(rng, s=30):
    n0 = secs(s + 2.5); t = np.arange(n0) / SR
    def hum(n):
        x = sum(np.sin(2 * np.pi * f * t[:n] * (1 + 0.002 * np.sin(2 * np.pi * 0.2 * t[:n]))) * g for f, g in ((110, 0.4), (165, 0.25), (220.6, 0.2), (440.3, 0.06)))
        return stereo(x.astype(np.float32) * lfo(n, 0.12, 0.3, rng), 0, 0.7)
    return amb(s, rng, [hum, lambda n: scatter(n, rng, s * 0.4, lambda r: stereo(fm(secs(0.6), r.uniform(1500, 3500), 3.01, 1.5, 0.1) * env_ad(secs(0.6), 0.01, 0.4, 4) * 0.12, 0, 0), 0.9)], 'hall', 0.4, -26)
def temple(rng, s=40):
    return amb(s, rng, [lambda n: bed(n, rng, 0, 300, 0.4, 0.04, 0.3, 'brown'), lambda n: stereo(chant(rng, n / SR), 0, 0.8)[:n],
                        lambda n: scatter(n, rng, 1, lambda r: bell(r, 330, 4.0, 0.4), 0.3, edge=4.0)], 'hall', 0.45, -25)
def ritual(rng, s=40):
    return amb(s, rng, [lambda n: stereo(chant(rng, n / SR), -0.3, 0.6)[:n] + stereo(chant(rng, n / SR), 0.3, 0.6)[:n], lambda n: stereo(drone(rng, n / SR + 0.01, 41, 0.3)[:n, 0], 0, 1.0),
                        lambda n: campfire_bed(n, rng) * 0.3], 'cave', 0.4, -24)
def library(rng, s=40):
    return amb(s, rng, [lambda n: bed(n, rng, 0, 400, 0.15, 0.04, 0.3, 'brown'), lambda n: stereo(clock_tick(n, rng, 1.0), 0.5, 0),
                        lambda n: scatter(n, rng, s * 0.08, lambda r: rustle(r, 0.35, 0.4, 1500, 8000), 0.8, edge=1.0), lambda n: scatter(n, rng, s * 0.03, lambda r: creak(r, 0.6, 200, 0.2), 0.9, edge=2.0)], 'room', 0.3, -28)
def graveyard(rng, s=40):
    return amb(s, rng, [lambda n: np.stack([sweep_filter(pink(n, rng) * lfo(n, 0.07, 0.7, rng), 200, 1000, q=2.5, steps=96)] * 2, 1) * 1.2,
                        lambda n: scatter(n, rng, 3, crow, 0.9, (0.3, 0.6), edge=2.0), lambda n: scatter(n, rng, 1, lambda r: bell(r, 220, 4.0, 0.25), 0.5, edge=4.0)], 'outdoors', 0.3, -25)
def blizzard(rng, s=40):
    return amb(s, rng, [lambda n: np.stack([sweep_filter(pink(n, rng) * lfo(n, 0.15, 0.6, rng), 600, 4000, q=3, steps=128) * 2 for _ in range(2)], 1),
                        lambda n: bed(n, rng, 2500, 10000, 0.25, 0.3, 0.5), lambda n: bed(n, rng, 0, 300, 0.5, 0.06, 0.5, 'brown')], 'outdoors', 0.2, -21)
def desert(rng, s=40):
    return amb(s, rng, [lambda n: np.stack([sweep_filter(pink(n, rng) * lfo(n, 0.05, 0.6, rng), 300, 1500, q=2, steps=96)] * 2, 1),
                        lambda n: bed(n, rng, 3000, 10000, 0.06, 0.1, 0.8)], 'outdoors', 0.15, -26)
def haunted(rng, s=40):
    return amb(s, rng, [lambda n: bed(n, rng, 0, 200, 0.6, 0.04, 0.5, 'brown'), lambda n: scatter(n, rng, 2, lambda r: wail(r, r.uniform(2, 3), r.uniform(300, 500), 0.3), 0.9, edge=3.0),
                        lambda n: scatter(n, rng, 3, lambda r: whisper(r, r.uniform(1, 2), 0.2), 0.9, edge=2.0), lambda n: scatter(n, rng, 2, lambda r: creak(r, 1.2, 110, 0.3), 0.9, edge=2.0)], 'hall', 0.45, -26)
def battlefield(rng, s=40):
    return amb(s, rng, [lambda n: np.stack([sweep_filter(pink(n, rng) * lfo(n, 0.06, 0.6, rng), 200, 900, q=2, steps=96)] * 2, 1), lambda n: scatter(n, rng, 4, crow, 0.9, (0.2, 0.5), edge=2.0),
                        lambda n: campfire_bed(n, rng) * 0.2, lambda n: scatter(n, rng, s * 0.1, lambda r: clacks(r, 2, 0.2, 0.2, (1500, 3000)), 0.9)], 'outdoors', 0.3, -25)
def room_tone(rng, s=30):
    return amb(s, rng, [lambda n: bed(n, rng, 0, 300, 0.4, 0.05, 0.3, 'brown'), lambda n: bed(n, rng, 300, 1200, 0.03, 0.05, 0.5)], 'room', 0.2, -32)


RECIPES = {'campfire': campfire, 'cave': cave, 'river': river, 'stream': stream, 'waterfall': waterfall, 'wind': wind_ambient, 'howling_wind': howling_wind,
           'rain': rain, 'rain_light': rain_light, 'storm': storm, 'forest_day': forest_day, 'forest_night': forest_night, 'wolves': wolves, 'meadow': meadow,
           'swamp': swamp, 'sea': sea, 'ship': ship, 'brazier': brazier, 'torch': torch, 'forge': forge, 'tavern': tavern, 'town': town, 'market': market,
           'dungeon': dungeon, 'crypt': crypt, 'sewer': sewer, 'mine': mine, 'lava': lava, 'arcane': arcane, 'temple': temple, 'ritual': ritual,
           'library': library, 'graveyard': graveyard, 'blizzard': blizzard, 'desert': desert, 'haunted': haunted, 'battlefield': battlefield, 'room_tone': room_tone}

