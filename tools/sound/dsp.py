"""Signal helpers for the board's sound set (tools/sound/): filters, envelopes, noise, synthesis voices, reverb,
mixing and mastering. Everything works on float32 numpy arrays at SR, mono (n,) or stereo (n, 2).
Docs: docs/best-practices/sound.md."""
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000


def secs(n): return int(round(n * SR))


def sos(kind, f, order=2):
    f = np.atleast_1d(f).astype(float)
    f = np.clip(f, 10, SR / 2 * 0.98) / (SR / 2)
    return butter(order, f[0] if len(f) == 1 else f, btype=kind, output='sos')


def lp(x, f, order=2): return sosfilt(sos('low', f, order), x, axis=0)
def hp(x, f, order=2): return sosfilt(sos('high', f, order), x, axis=0)
def bp(x, lo, hi, order=2): return sosfilt(sos('band', [lo, hi], order), x, axis=0)


def sweep_filter(x, f0, f1, q=2.0, steps=48, kind='band'):
    """A filter whose centre moves from f0 to f1 over the sound (piecewise, crossfaded blocks)."""
    n = len(x); out = np.zeros_like(x); block = max(1, n // steps)
    fs = np.geomspace(max(f0, 20), max(f1, 20), steps + 1)
    win = np.hanning(block * 2)
    pos = 0
    for i in range(steps + 1):
        a, b = max(0, pos - block), min(n, pos + block)
        if a >= b: break
        f = fs[min(i, steps)]
        seg = x[a:b]
        if kind == 'band': y = bp(seg, f / (1 + 1 / q), f * (1 + 1 / q))
        elif kind == 'low': y = lp(seg, f)
        else: y = hp(seg, f)
        w = win[block - (pos - a): block + (b - pos)] if len(win) >= block * 2 else np.ones(b - a)
        if x.ndim == 2: w = w[:, None]
        out[a:b] += y * w[: b - a]
        pos += block
    return out


def env_ad(n, a=0.005, d=0.3, curve=4.0):
    """Attack then exponential decay over n samples (a, d in seconds)."""
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-6), np.exp(-(t - a) * curve / max(d, 1e-6)))
    return e.astype(np.float32)


def env_adsr(n, a, d, s, r):
    e = np.full(n, s, dtype=np.float32)
    na, nd, nr = secs(a), secs(d), secs(r)
    na = min(na, n); e[:na] = np.linspace(0, 1, na)
    nd = min(nd, n - na); e[na:na + nd] = np.linspace(1, s, nd)
    nr = min(nr, n); e[n - nr:] *= np.linspace(1, 0, nr)
    return e


def fade(x, fin=0.002, fout=0.01):
    x = x.copy(); n = len(x)
    a, b = min(secs(fin), n), min(secs(fout), n)
    w = np.ones(n, dtype=np.float32)
    if a: w[:a] = np.linspace(0, 1, a)
    if b: w[n - b:] *= np.linspace(1, 0, b)
    return x * (w[:, None] if x.ndim == 2 else w)


def white(n, rng): return rng.standard_normal(n).astype(np.float32)


def pink(n, rng):
    w = np.fft.rfft(rng.standard_normal(n)); f = np.fft.rfftfreq(n, 1 / SR); f[0] = 1
    return (np.fft.irfft(w / np.sqrt(f), n) * 30).astype(np.float32)


def brown(n, rng):
    x = np.cumsum(rng.standard_normal(n)); x -= np.linspace(x[0], x[-1], n)
    return (hp(x, 20) / (np.std(x) + 1e-9) * 0.3).astype(np.float32)


def sine(n, f0, f1=None, phase=0.0):
    f1 = f0 if f1 is None else f1
    f = np.geomspace(max(f0, 1), max(f1, 1), n) if f0 != f1 else np.full(n, f0)
    return np.sin(phase + 2 * np.pi * np.cumsum(f) / SR).astype(np.float32)


def fm(n, fc, ratio, index, index_end=None, fc_end=None):
    """Two-operator FM: a bright, glassy or metallic tone; the index can fall over the sound."""
    fc_end = fc if fc_end is None else fc_end
    fcs = np.geomspace(fc, fc_end, n) if fc != fc_end else np.full(n, fc)
    idx = np.linspace(index, index if index_end is None else index_end, n)
    pm = np.cumsum(fcs * ratio) * 2 * np.pi / SR
    pc = np.cumsum(fcs) * 2 * np.pi / SR
    return np.sin(pc + idx * np.sin(pm)).astype(np.float32)


def karplus(n, f, rng, damp=0.996, bright=0.5):
    """A plucked string (Karplus-Strong): bowstrings, twangs, harp-like plinks."""
    p = max(2, int(SR / f)); buf = rng.uniform(-1, 1, p).astype(np.float32)
    buf = lp(buf, 2000 + 8000 * bright).astype(np.float32)
    out = np.zeros(n, dtype=np.float32); i = 0
    for k in range(n):
        out[k] = buf[i]
        j = (i + 1) % p
        buf[i] = damp * 0.5 * (buf[i] + buf[j])
        i = j
    return out


def modal(n, f0, ratios, decays, gains, rng=None):
    """Struck metal or wood: inharmonic partials, each with its own decay (seconds)."""
    t = np.arange(n) / SR; out = np.zeros(n, dtype=np.float32)
    for r, d, g in zip(ratios, decays, gains):
        ph = 0 if rng is None else rng.uniform(0, 2 * np.pi)
        out += (g * np.sin(2 * np.pi * f0 * r * t + ph) * np.exp(-t / d)).astype(np.float32)
    return out


def crackle(n, rng, rate=20.0, bright=(1500, 9000), size=(0.0005, 0.004)):
    """Random pops and crackles (fire, embers, gravel): short filtered bursts at a mean rate per second."""
    out = np.zeros(n, dtype=np.float32)
    k = rng.poisson(rate * n / SR)
    for _ in range(k):
        at = rng.integers(0, n); m = max(8, secs(rng.uniform(*size)))
        b = white(m, rng) * env_ad(m, 0.0002, m / SR * 0.6, 5)
        f = rng.uniform(*bright); b = bp(b, f * 0.6, min(f * 1.6, SR / 2 * 0.95)) * rng.uniform(0.2, 1.0) ** 2
        e = min(n, at + m); out[at:e] += b[: e - at]
    return out


def stereo(x, pan=0.0, width=0.0, rng=None):
    """Mono to stereo at a pan (-1 left ... 1 right), with optional width from a short decorrelating delay."""
    if x.ndim == 2: return x
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    out = np.stack([x * l, x * r], axis=1)
    if width > 0:
        d = secs(0.007 + 0.006 * width)
        y = np.concatenate([np.zeros(d, dtype=np.float32), x[:-d]]) if d < len(x) else x
        out[:, 1] = out[:, 1] * (1 - width * 0.5) + y * r * width * 0.5
        out[:, 0] = out[:, 0] * (1 - width * 0.5) + x * l * width * 0.5
    return out.astype(np.float32)


def pan_stereo(x, pan):
    """Pan a stereo signal (balance law)."""
    l, r = np.cos((pan + 1) * np.pi / 4) * np.sqrt(2), np.sin((pan + 1) * np.pi / 4) * np.sqrt(2)
    return np.stack([x[:, 0] * min(1, l), x[:, 1] * min(1, r)], axis=1).astype(np.float32)


_IR = {}
def impulse(kind='room', seed=7):
    """A stereo reverb impulse: decaying, darkening noise (room, hall, cave, outdoors)."""
    key = (kind, seed)
    if key in _IR: return _IR[key]
    rng = np.random.default_rng(seed)
    t60, pre, damp = {'room': (0.6, 0.008, 6000), 'hall': (2.4, 0.025, 4500), 'cave': (3.2, 0.04, 2500), 'outdoors': (0.35, 0.003, 9000), 'small': (0.25, 0.004, 8000)}[kind]
    n = secs(t60 * 1.2); t = np.arange(n) / SR
    out = np.zeros((n + secs(pre), 2), dtype=np.float32)
    for c in range(2):
        noise = rng.standard_normal(n)
        e = np.exp(-6.9 * t / t60)
        lo = lp(noise * e, damp); hi = noise * e * np.exp(-t * 3) * 0.3
        out[secs(pre):, c] = (lo + hp(hi, damp)).astype(np.float32)
    out /= np.sqrt(np.sum(out ** 2) / 2) + 1e-9
    _IR[key] = out
    return out


def reverb(x, kind='room', wet=0.25, seed=7):
    ir = impulse(kind, seed); x = stereo(x) if x.ndim == 1 else x
    w = np.stack([fftconvolve(x[:, c], ir[:, c]) for c in range(2)], axis=1)[: len(x) + len(ir)]
    dry = np.concatenate([x, np.zeros((len(w) - len(x), 2), dtype=np.float32)])
    return (dry * (1 - wet * 0.5) + w * wet).astype(np.float32)


def mix(parts, n=None):
    """Sum [(signal, start seconds, gain)] into one stereo buffer."""
    ends = [secs(s) + len(x) for x, s, g in parts]
    n = n or max(ends)
    out = np.zeros((n, 2), dtype=np.float32)
    for x, s, g in parts:
        x = stereo(x) if x.ndim == 1 else x
        a = secs(s); b = min(n, a + len(x))
        if a < n: out[a:b] += x[: b - a] * g
    return out


def compress(x, thresh_db=-18, ratio=3.0, attack=0.005, release=0.12):
    lvl = np.max(np.abs(x), axis=1) if x.ndim == 2 else np.abs(x)
    a, r = np.exp(-1 / (SR * attack)), np.exp(-1 / (SR * release))
    env = np.zeros_like(lvl); e = 0.0
    from scipy.signal import lfilter
    # a cheap envelope follower: fast rise, slow fall
    up = lfilter([1 - a], [1, -a], lvl); down = lfilter([1 - r], [1, -r], lvl)
    env = np.maximum(up, down)
    db = 20 * np.log10(env + 1e-9)
    over = np.maximum(0, db - thresh_db)
    gain = 10 ** (-(over - over / ratio) / 20)
    return (x * (gain[:, None] if x.ndim == 2 else gain)).astype(np.float32)


def limit(x, ceiling=0.89):
    """A soft limiter: tanh above 70% of the ceiling, so peaks never clip."""
    k = ceiling * 0.7
    y = np.where(np.abs(x) < k, x, np.sign(x) * (k + (ceiling - k) * np.tanh((np.abs(x) - k) / (ceiling - k))))
    return y.astype(np.float32)


def loudness(x):
    """A rough short-term loudness in dB (RMS of a K-ish weighted signal), for evening levels out."""
    y = hp(x, 80); y = y + 0.5 * hp(y, 1500)
    return 20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-9)


def master(x, target_db=-18.0, ceiling=0.89, comp=True):
    if comp: x = compress(x, thresh_db=-20, ratio=2.5)
    g = 10 ** ((target_db - loudness(x)) / 20)
    return limit(x * g, ceiling)


def write(path, x, kind='mp3', kbps=128, mono=False):
    """Write a sound file through ffmpeg: mp3 (every browser), at kbps."""
    import subprocess, tempfile, soundfile as sf, os
    x = np.clip(x, -1, 1)
    if mono and x.ndim == 2: x = x.mean(axis=1)
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f: tmp = f.name
    sf.write(tmp, x, SR, subtype='PCM_16')
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-codec:a', 'libmp3lame', '-b:a', f'{kbps}k', path], check=True)
    os.remove(tmp)
