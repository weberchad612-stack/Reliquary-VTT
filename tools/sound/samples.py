"""The recorded instruments the music and some effects use: the Versilian Community Sample Library (VSCO 2
Community Edition, CC0, github.com/sgossner/VSCO-2-CE), cloned outside the repository (VSCO env var, default
/home/claude/audio/vsco). A bank maps notes to samples; a note is played from the nearest sample, pitch-shifted by
resampling, at a velocity layer. Docs: docs/best-practices/sound.md."""
import os, re, glob, functools
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from dsp import SR, env_adsr, secs

ROOT = os.environ.get('VSCO', '/home/claude/audio/vsco')
NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def midi_of(name):
    m = re.search(r'(?<![A-Za-z])([A-G])(#|b)?(-?\d)(?!\d)', name)
    if not m: return None
    n = NOTE[m.group(1)] + (1 if m.group(2) == '#' else -1 if m.group(2) == 'b' else 0)
    return 12 * (int(m.group(3)) + 2) + n   # VSCO names middle C 'C3' (MIDI 60)


def vel_of(name):
    m = re.search(r'_v(\d)', name)
    return int(m.group(1)) if m else 1


@functools.lru_cache(maxsize=None)
def load(path):
    x, sr = sf.read(path, dtype='float32', always_2d=True)
    if x.shape[1] == 1: x = np.repeat(x, 2, axis=1)
    if sr != SR: x = resample_poly(x, SR, sr, axis=0).astype(np.float32)
    # trim the leading silence so notes start on time
    lvl = np.max(np.abs(x), axis=1); peak = lvl.max() + 1e-9
    start = int(np.argmax(lvl > peak * 0.02)); start = max(0, start - secs(0.003))
    return x[start:]


class Bank:
    """One instrument articulation: {midi: {vel: [paths]}}."""
    def __init__(self, pattern, gain=1.0, mapper=None, veler=None):
        self.map = {}
        for p in sorted(glob.glob(os.path.join(ROOT, pattern))):
            b = os.path.basename(p)
            m = (mapper or midi_of)(b)
            if m is None: continue
            self.map.setdefault(m, {}).setdefault((veler or vel_of)(b), []).append(p)
        if not self.map: raise FileNotFoundError(f'no samples for {pattern} under {ROOT}')
        self.notes = sorted(self.map); self.gain = gain
        self.vels = sorted({v for d in self.map.values() for v in d})

    def note(self, midi, dur, vel=0.7, rng=None, release=0.35, attack=0.0):
        """A note of dur seconds at vel (0..1): stereo float32 including its release tail."""
        base = min(self.notes, key=lambda k: abs(k - midi))
        layers = self.map[base]; vs = sorted(layers)
        v = vs[min(len(vs) - 1, int(vel * len(vs)))]
        paths = layers[v]; p = paths[(rng.integers(len(paths)) if rng is not None else 0)]
        x = load(p); ratio = 2 ** ((midi - base) / 12)
        x = x[: int((dur + release) * SR * ratio) + 256]   # only what the note needs, before resampling
        if abs(ratio - 1) > 1e-4:
            up, down = int(round(1000 / ratio)), 1000
            x = resample_poly(x, up, down, axis=0).astype(np.float32)
        n = min(len(x), secs(dur + release))
        y = x[:n] * env_adsr(n, attack or 0.004, 0.0, 1.0, min(release, n / SR * 0.9))[:, None]
        # quieter layers are recorded quieter: scale gently by the requested velocity within a layer
        return (y * self.gain * (0.55 + 0.45 * vel)).astype(np.float32)


def piano_midi(name):
    """The upright piano's files are numbered 000..044, every other key from A0 (its MappingChart.txt)."""
    m = re.search(r'_(\d{3})\.wav$', name)
    return None if not m else min(108, 21 + 2 * int(m.group(1)))


def piano_vel(name):
    m = re.search(r'dyn(\d)', name)
    return int(m.group(1)) if m else 1


def organ_midi(name):
    """The organ's files carry a number offset from MIDI (measured: manual n-86, pedal n-28)."""
    m = re.search(r'(Man3|Pedal)Quiet_(\d{3})', name)
    if not m: return None
    return int(m.group(2)) - (86 if m.group(1) == 'Man3' else 28)


def perc(pattern):
    """All samples matching a pattern (round robins and velocities), for effects."""
    return [load(p) for p in sorted(glob.glob(os.path.join(ROOT, pattern)))]
