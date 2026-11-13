"""The board's music: pieces written by rule (themes, chord progressions with voice leading, a form with an arc of
intensity, orchestration per mood) and performed with recorded orchestral samples (samples.py), then mixed with
reverb and mastered to an even loudness. Each piece is deterministic for its seed. Moods: explore, combat, boss
(the moods the board's music follows). Docs: docs/best-practices/sound.md."""
import numpy as np
from dsp import SR, secs, mix, reverb, master, pan_stereo, lp, hp, stereo, env_adsr
from samples import Bank, perc

MINOR = [0, 2, 3, 5, 7, 8, 10]; DORIAN = [0, 2, 3, 5, 7, 9, 10]; HARM = [0, 2, 3, 5, 7, 8, 11]
MAJOR = [0, 2, 4, 5, 7, 9, 11]; MIXO = [0, 2, 4, 5, 7, 9, 10]; LYD = [0, 2, 4, 6, 7, 9, 11]; PHRYG = [0, 1, 3, 5, 7, 8, 10]

from samples import piano_midi, piano_vel, organ_midi
_BANKS = {}
BANKS = {
    'vln': ('Strings/Violin Section/susVib/*.wav', 0.8), 'vla': ('Strings/Viola Section/susvib/*.wav', 0.8),
    'vc': ('Strings/Cello Section/susvib/*.wav', 0.85), 'cb': ('Strings/Solo Contrabass/SusVib/*.wav', 1.0),
    'vln_spic': ('Strings/Violin Section/Spic/*.wav', 0.9), 'vc_spic': ('Strings/Cello Section/spic/*.wav', 1.0),
    'vln_trem': ('Strings/Violin Section/Trem/*.wav', 0.7), 'vla_trem': ('Strings/Viola Section/trem/*.wav', 0.7),
    'vc_trem': ('Strings/Cello Section/trem/*.wav', 0.8),
    'vln_pizz': ('Strings/Violin Section/Pizz/*.wav', 1.0), 'vla_pizz': ('Strings/Viola Section/pizz/*.wav', 1.0),
    'vc_pizz': ('Strings/Cello Section/pizzT/*.wav', 1.1),
    'hn': ('Brass/F Horn/sus/*.wav', 0.9), 'tpt': ('Brass/Trumpet/sus/*.wav', 0.7), 'tbn': ('Brass/Tenor Trombone/sus/*.wav', 0.8),
    'tba': ('Brass/Tuba/sus/*.wav', 0.9), 'fl': ('Woodwinds/Flute/susvib/*.wav', 0.75), 'ob': ('Woodwinds/Oboe/Vib/*.wav', 0.7),
    'cl': ('Woodwinds/Clarinet/susLong/*.wav', 0.75), 'bsn': ('Woodwinds/Bassoon/sus/*.wav', 0.8),
    'hp': ('Strings/Harp/*.wav', 1.1), 'glk': ('Percussion/Glock/*.wav', 0.35), 'tb': ('Percussion/TB_hit_*.wav', 0.5),
    'pno': ('Keys/Upright Piano/Player_*.wav', 0.9, piano_midi, piano_vel),
    'org': ('Keys/Organ/Quiet/NT5_Man3Quiet_*.wav', 0.45, organ_midi, None), 'org_ped': ('Keys/Organ/Quiet/NT5_PedalQuiet_*.wav', 0.6, organ_midi, None),
}
def bank(key):
    if key not in _BANKS:
        spec = BANKS[key]
        _BANKS[key] = Bank(spec[0], spec[1], *(spec[2:] if len(spec) > 2 else ()))
    return _BANKS[key]

PERC = {'timp': 'Percussion/Timpani/Timpani*_Hit_*.wav', 'bd': 'Percussion/BDrumNewhit*.wav', 'sn': 'Percussion/Snare2-HitSN*.wav',
        'anvil': 'Percussion/Anvil_Hit1*.wav', 'log_hi': 'Percussion/LogDrumHi*.wav', 'log_lo': 'Percussion/LogDrumLo*.wav',
        'roll': 'Percussion/Snare2-rollSN*.wav', 'tamb': 'Percussion/Tamb1-Roll*.wav', 'belltree': 'Percussion/BellTree*.wav',
        'sleigh': 'Percussion/Sleighbells*.wav', 'ratchet': 'Percussion/Ratchet1-*.wav', 'brake': 'Percussion/BrakeDrum1*.wav'}

# where each section sits (orchestral seating) and how much hall it gets
SEAT = {'vln': (-0.45, 0.35), 'vla': (0.15, 0.35), 'vc': (0.4, 0.3), 'cb': (0.55, 0.25), 'vln_spic': (-0.4, 0.3), 'vc_spic': (0.4, 0.28),
        'vln_trem': (-0.5, 0.4), 'vla_trem': (0.1, 0.4), 'vc_trem': (0.4, 0.35), 'vln_pizz': (-0.4, 0.3), 'vla_pizz': (0.1, 0.3), 'vc_pizz': (0.4, 0.25),
        'hn': (-0.2, 0.5), 'tpt': (0.1, 0.45), 'tbn': (0.3, 0.45), 'tba': (0.4, 0.4), 'fl': (-0.1, 0.45), 'ob': (0.05, 0.42), 'cl': (-0.15, 0.42),
        'bsn': (0.2, 0.4), 'hp': (-0.6, 0.4), 'glk': (0.2, 0.45), 'tb': (0.3, 0.55), 'pno': (-0.25, 0.3), 'org': (0.0, 0.6), 'org_ped': (0.0, 0.6),
        'timp': (0.0, 0.5), 'bd': (0.05, 0.45), 'sn': (-0.05, 0.35), 'anvil': (0.2, 0.5), 'log_hi': (-0.3, 0.35), 'log_lo': (0.3, 0.35),
        'roll': (-0.05, 0.4), 'tamb': (0.35, 0.35), 'belltree': (0.4, 0.55), 'sleigh': (-0.35, 0.4), 'ratchet': (0.3, 0.4), 'brake': (0.25, 0.4)}
LEVEL = {'vln': 0.9, 'vla': 0.8, 'vc': 0.9, 'cb': 0.8, 'vln_spic': 0.6, 'vc_spic': 0.75, 'vln_trem': 0.6, 'vla_trem': 0.6, 'vc_trem': 0.65,
         'vln_pizz': 0.7, 'vla_pizz': 0.7, 'vc_pizz': 0.85, 'hn': 0.85, 'tpt': 0.6, 'tbn': 0.7, 'tba': 0.7, 'fl': 0.8, 'ob': 0.7, 'cl': 0.75,
         'bsn': 0.7, 'hp': 0.7, 'glk': 0.6, 'tb': 0.5, 'pno': 0.7, 'org': 0.6, 'org_ped': 0.7, 'timp': 0.9, 'bd': 0.8, 'sn': 0.45, 'anvil': 0.35,
         'log_hi': 0.6, 'log_lo': 0.7, 'roll': 0.4, 'tamb': 0.3, 'belltree': 0.35, 'sleigh': 0.25, 'ratchet': 0.25, 'brake': 0.3}
SHORT = {'vc_spic', 'vln_spic', 'vln_pizz', 'vla_pizz', 'vc_pizz'}

MINOR_PROGS = [[0, 5, 2, 6], [0, 3, 5, 4], [5, 3, 0, 4], [0, 6, 5, 6], [0, 5, 6, 4], [0, 3, 6, 4]]
MAJOR_PROGS = [[0, 3, 4, 0], [0, 5, 3, 4], [0, 4, 5, 3], [0, 3, 0, 4], [0, 1, 4, 0], [3, 4, 2, 5]]
DARK_PROGS = [[0, 0, 5, 4], [0, 1, 0, 4], [5, 3, 1, 4], [0, 5, 1, 4], [0, 1, 5, 4]]

# Styles: each mood has several, so a shuffle bag of one mood still varies in sound and not only in notes.
# pad: [(inst, voice 0-3, octave shift, base velocity)]; layers: rhythmic parts written per bar (LAYERS below).
STYLES = {
    'explore': {
        'wilds': dict(bpm=(66, 72, 76), tonic=50, scales=(DORIAN, MINOR), meter=4, bpc=2, progs=MINOR_PROGS, lead=('fl', 'ob'), counter='vln',
                      pad=[('vc', 0, 0, .35), ('vla', 1, 0, .3), ('vln', 2, 12, .25), ('vln', 3, 12, .2)], bass='cb', layers=['arp_harp', 'glint'], swell='hn'),
        'delve': dict(bpm=(56, 60, 64), tonic=48, scales=(MINOR, PHRYG), meter=4, bpc=2, progs=DARK_PROGS, lead=('vc', 'cl', 'bsn'), counter='hn', lead_lo=48, lead_hi=70,
                      pad=[('org', 0, 0, .3), ('org', 1, 0, .25), ('org', 2, 0, .25)], bass='org_ped', layers=['pulse_pizz_low', 'drip'], swell='vla_trem'),
        'road': dict(bpm=(92, 98, 104), tonic=50, scales=(MIXO, DORIAN), meter=4, bpc=1, progs=MAJOR_PROGS, lead=('cl', 'hn', 'ob'), counter='fl',
                     pad=[('vla', 1, 0, .3), ('vln', 2, 12, .25)], bass='vc_pizz', layers=['walk_pizz', 'tamb_light', 'arp_harp'], swell='hn'),
        'mystic': dict(bpm=(60, 66), tonic=52, scales=(LYD, DORIAN), meter=3, bpc=2, progs=MAJOR_PROGS, lead=('fl', 'vln'), counter='cl',
                       pad=[('vla_trem', 1, 0, .25), ('vln', 2, 12, .2), ('vln', 3, 12, .18)], bass='cb', layers=['arp_glk', 'arp_harp', 'belltree'], swell='hn'),
        'highland': dict(bpm=(80, 84, 88), tonic=50, scales=(DORIAN, MIXO), meter=3, bpc=1, progs=MINOR_PROGS, lead=('ob', 'fl', 'vln'), counter='hn',
                         pad=[('vc', 0, 0, .35), ('vla', 1, 0, .3), ('vln', 2, 12, .25)], bass='cb', layers=['drone_fifth', 'arp_harp'], swell='hn'),
    },
    'combat': {
        'charge': dict(bpm=(128, 136, 144), tonic=52, scales=(MINOR, HARM), meter=4, bpc=1, progs=MINOR_PROGS, lead=('hn',), counter='tbn', lead_lo=55, lead_hi=76,
                       pad=[('vln_trem', 2, 12, .35), ('vla', 1, 0, .35)], bass='cb', layers=['ost_spic', 'drums_combat'], swell='tbn'),
        'skirmish': dict(bpm=(150, 160, 168), tonic=50, scales=(DORIAN, MINOR), meter=3, bpc=1, progs=MINOR_PROGS, lead=('tpt', 'hn'), counter='vln', lead_lo=60, lead_hi=79,
                         pad=[('vla_trem', 1, 0, .3), ('vln_trem', 2, 12, .3)], bass='cb', layers=['ost_spic3', 'drums_tribal'], swell='tbn'),
        'clash': dict(bpm=(140, 146, 152), tonic=53, scales=(HARM, MINOR), meter=4, bpc=1, progs=MINOR_PROGS, lead=('vln',), counter='hn', lead_lo=67, lead_hi=88,
                      pad=[('vla', 1, 0, .35), ('vc', 0, 0, .35)], bass='cb', layers=['stabs', 'ost_spic', 'drums_combat'], swell='tbn'),
        'savage': dict(bpm=(120, 126, 132), tonic=48, scales=(PHRYG, MINOR), meter=4, bpc=2, progs=DARK_PROGS, lead=('hn', 'tbn'), counter='vc', lead_lo=48, lead_hi=70,
                       pad=[('vc_trem', 0, 0, .4), ('vla_trem', 1, 0, .35)], bass='cb', layers=['drums_tribal', 'ost_brass_low'], swell='tba'),
        'gallop': dict(bpm=(132, 138), tonic=55, scales=(MINOR, DORIAN), meter=4, bpc=1, progs=MINOR_PROGS, lead=('tpt', 'vln'), counter='hn', lead_lo=62, lead_hi=84,
                       pad=[('vln_trem', 2, 12, .3), ('vla', 1, 0, .3)], bass='cb', layers=['gallop', 'drums_combat'], swell='tbn'),
    },
    'boss': {
        'doom': dict(bpm=(84, 90, 96), tonic=48, scales=(HARM,), meter=4, bpc=2, progs=DARK_PROGS, lead=('hn',), counter='tbn', lead_lo=55, lead_hi=76,
                     pad=[('vln_trem', 3, 12, .35), ('vla', 1, 0, .4)], bass='cb', bass2='tba', layers=['ost_brass_low', 'drums_boss'], swell='tbn'),
        'cathedral': dict(bpm=(72, 76, 80), tonic=47, scales=(HARM, PHRYG), meter=4, bpc=2, progs=DARK_PROGS, lead=('tpt', 'hn'), counter='vc', lead_lo=58, lead_hi=79,
                          pad=[('org', 0, 0, .45), ('org', 1, 0, .4), ('org', 2, 0, .4), ('org', 3, 12, .35)], bass='org_ped', bass2='tba', layers=['tolling', 'drums_boss', 'ost_brass_low'], swell='vln_trem'),
        'frenzy': dict(bpm=(150, 158, 164), tonic=50, scales=(HARM, PHRYG), meter=4, bpc=1, progs=DARK_PROGS, lead=('tpt', 'hn'), counter='vln', lead_lo=60, lead_hi=82,
                       pad=[('vln_trem', 2, 12, .4), ('vla_trem', 1, 0, .4), ('vc_trem', 0, 0, .4)], bass='cb', bass2='tba', layers=['ost_spic', 'drums_combat', 'anvil'], swell='tbn'),
        'colossus': dict(bpm=(66, 70), tonic=45, scales=(MINOR, HARM), meter=4, bpc=2, progs=DARK_PROGS, lead=('hn', 'tbn'), counter='vc', lead_lo=50, lead_hi=72,
                         pad=[('vc_trem', 0, 0, .45), ('vla_trem', 1, 0, .4), ('vln_trem', 2, 12, .35)], bass='cb', bass2='tba', layers=['drums_tribal', 'ost_brass_low', 'tolling'], swell='tbn'),
    },
    'town': {
        'tavern': dict(bpm=(108, 116, 120), tonic=55, scales=(MAJOR, MIXO), meter=3, bpc=1, progs=MAJOR_PROGS, lead=('cl', 'ob', 'fl', 'vln'), counter='bsn',
                       pad=[], bass='vc_pizz', layers=['oompah', 'tamb_light'], swell=None),
        'market': dict(bpm=(100, 106, 112), tonic=53, scales=(MAJOR, MIXO, DORIAN), meter=4, bpc=1, progs=MAJOR_PROGS, lead=('fl', 'ob', 'cl'), counter='vla',
                       pad=[('vla', 1, 0, .25)], bass='vc_pizz', layers=['walk_pizz', 'arp_pno', 'tamb_light'], swell=None),
        'hall': dict(bpm=(80, 84, 88), tonic=51, scales=(MAJOR,), meter=4, bpc=2, progs=MAJOR_PROGS, lead=('hn', 'tpt', 'vln'), counter='vc',
                     pad=[('vc', 0, 0, .35), ('vla', 1, 0, .3), ('vln', 2, 12, .28), ('vln', 3, 12, .22)], bass='cb', layers=['arp_harp'], swell='hn'),
        'square': dict(bpm=(92, 96), tonic=57, scales=(MIXO, MAJOR), meter=4, bpc=1, progs=MAJOR_PROGS, lead=('vln', 'fl'), counter='cl',
                       pad=[], bass='vc_pizz', layers=['strum_pno', 'walk_pizz', 'sleigh_light'], swell=None),
    },
    'tension': {
        'stealth': dict(bpm=(84, 88, 92), tonic=50, scales=(MINOR, PHRYG), meter=4, bpc=2, progs=DARK_PROGS, lead=('cl', 'bsn'), counter='vla', lead_lo=50, lead_hi=72, sparse=True,
                        pad=[('vln_trem', 3, 12, .15)], bass='vc_pizz', layers=['pulse_pizz_low', 'log_tick'], swell='vla_trem'),
        'dread': dict(bpm=(58, 62), tonic=46, scales=(PHRYG, HARM), meter=4, bpc=4, progs=DARK_PROGS, lead=('bsn', 'vc'), counter='cl', lead_lo=43, lead_hi=65, sparse=True,
                      pad=[('vc_trem', 0, 0, .25), ('org', 1, 0, .2)], bass='org_ped', layers=['heartbeat', 'scrape'], swell='vln_trem'),
        'hunt': dict(bpm=(100, 104), tonic=52, scales=(MINOR, HARM), meter=4, bpc=2, progs=MINOR_PROGS, lead=('hn', 'cl'), counter='vc', lead_lo=52, lead_hi=72, sparse=True,
                     pad=[('vla_trem', 1, 0, .22), ('vln_trem', 2, 12, .18)], bass='cb', layers=['ost_pizz', 'log_tick'], swell='hn'),
    },
    'rest': {
        'camp': dict(bpm=(60, 64, 68), tonic=53, scales=(MAJOR, LYD), meter=4, bpc=2, progs=MAJOR_PROGS, lead=('fl', 'ob'), counter='vc',
                     pad=[('vla', 1, 0, .22), ('vln', 2, 12, .18)], bass='vc', layers=['arp_pno', 'arp_harp_slow'], swell=None),
        'hearth': dict(bpm=(72, 76), tonic=51, scales=(MAJOR, DORIAN), meter=3, bpc=1, progs=MAJOR_PROGS, lead=('pno', 'vc', 'cl'), counter='vla',
                       pad=[('vla', 1, 0, .2), ('vln', 2, 12, .16)], bass='vc_pizz', layers=['waltz_pno'], swell=None),
        'stars': dict(bpm=(54, 58), tonic=55, scales=(LYD, MAJOR), meter=4, bpc=2, progs=MAJOR_PROGS, lead=('fl', 'vln'), counter='hn',
                      pad=[('vln', 2, 12, .16), ('vln', 3, 12, .14), ('vla', 1, 0, .18)], bass='cb', layers=['arp_glk', 'arp_harp_slow'], swell=None),
    },
}
MOODS = list(STYLES)


class Score:
    def __init__(self, bpm, rng):
        self.bpm, self.rng, self.ev = bpm, rng, []
        self.beat = 60 / bpm
    def add(self, inst, t_beats, midi, dur_beats, vel):
        self.ev.append((inst, t_beats * self.beat, int(midi), dur_beats * self.beat, float(np.clip(vel, 0.05, 1.0))))


def chord(tonic, scale, deg, n=4):
    """Chord tones (MIDI, around tonic) of a scale degree: triad plus the seventh when n>3."""
    out = []
    for k in range(n):
        i = deg + 2 * k
        out.append(tonic + scale[i % 7] + 12 * (i // 7))
    return out


def voice(prev, tones, lo, hi):
    """Voice-lead: for each voice, the chord tone (any octave in range) nearest the previous note."""
    pcs = sorted({t % 12 for t in tones}); out = []
    for p in prev:
        cands = [o * 12 + pc for pc in pcs for o in range(lo // 12, hi // 12 + 1) if lo <= o * 12 + pc <= hi]
        best = min(cands, key=lambda c: (abs(c - p), c in out))
        out.append(best)
    return out


def motif(rng, scale, tonic, bars=2, busy=0.5, lo=60, hi=84, meter=4):
    """A short theme: rhythm from a pool, pitches walking the scale with leaps on strong beats; [(beat, midi, dur)]."""
    pools4 = [[1, 0.5, 0.5, 2], [1.5, 0.5, 1, 1], [0.5, 0.5, 1, 2], [2, 1, 1], [1, 1, 0.5, 0.5, 1], [0.75, 0.25, 1, 2], [3, 1]]
    pools3 = [[1, 1, 1], [2, 1], [1.5, 0.5, 1], [0.5, 0.5, 1, 1], [1, 0.5, 0.5, 1], [3]]
    pools = pools3 if meter == 3 else pools4
    L = bars * meter
    out, t, deg = [], 0.0, rng.choice([0, 2, 4])
    while t < L - 0.01:
        pat = pools[rng.integers(len(pools))] if rng.random() < busy else ([meter] if meter == 3 else [2, 2])
        for d in pat:
            if t >= L - 0.01: break
            step = rng.choice([-2, -1, -1, 1, 1, 2, 3, -3, 4]) if t % meter == 0 else rng.choice([-1, 1, 1, -1, 2])
            deg = int(np.clip(deg + step, -2, 9))
            m = tonic + scale[deg % 7] + 12 * (deg // 7)
            while m < lo: m += 12
            while m > hi: m -= 12
            out.append((t, m, min(d, L - t)))
            t += d
    if out: b, m, d = out[-1]; out[-1] = (b, m, max(d, 1.0))
    return out


def bass_note(inst, pc):
    lo = {'cb': 30, 'vc_pizz': 36, 'vc': 36, 'org_ped': 31, 'tba': 29}.get(inst, 33)
    m = lo + ((pc - lo) % 12)
    return m


# ---- rhythmic layers: fn(S, ctx) writes one bar ----
def _arp(S, c, inst, step=0.5, vel=0.35, up=12, low=55):
    t0, M, tones, I = c['t0'], c['meter'], c['tones'], c['I']
    pat = [tones[0], tones[1], tones[2], tones[1] + 12, tones[2] + 12, tones[1] + 12, tones[2], tones[1]]
    n = int(M / step)
    for k in range(n):
        mm = pat[k % len(pat)] + up
        while mm < low: mm += 12
        S.add(inst, t0 + k * step, mm, step * 3, (vel + 0.35 * I) * (1 if k % 2 == 0 else 0.7))

def L_arp_harp(S, c):
    if c['I'] > 0.3: _arp(S, c, 'hp')
def L_arp_harp_slow(S, c): _arp(S, c, 'hp', step=1.0, vel=0.3)
def L_arp_glk(S, c):
    if c['bar'] % 2 == 0: _arp(S, c, 'glk', step=1.0, vel=0.25, up=24, low=72)
def L_arp_pno(S, c): _arp(S, c, 'pno', step=0.5 if c['I'] > 0.5 else 1.0, vel=0.25, up=12, low=55)
def L_glint(S, c):
    if c['bar'] % 8 == 7 and c['I'] > 0.5: S.add('glk', c['t0'] + c['meter'] - 1, c['tones'][2] + 24, 2, 0.4)
def L_belltree(S, c):
    if c['bar'] % 8 == 0 and c['bar'] > 0: S.add('belltree', c['t0'], 0, 2, 0.5)
def L_drip(S, c):
    r = S.rng
    if r.random() < 0.5: S.add('hp', c['t0'] + r.integers(0, c['meter'] * 2) / 2, c['tones'][r.integers(3)] + 24, 2, 0.25)
def L_walk_pizz(S, c):
    t0, M, tones = c['t0'], c['meter'], c['tones']; b = bass_note('vc_pizz', tones[0] % 12)
    steps = [0, 7, 12, 7] if S.rng.random() < 0.5 else [0, 4 if (tones[1] - tones[0]) % 12 == 4 else 3, 7, 10]
    for k in range(M): S.add('vc_pizz', t0 + k, b + steps[k % 4], 0.8, 0.55 + 0.3 * c['I'])
def L_pulse_pizz_low(S, c):
    t0, M = c['t0'], c['meter']; b = bass_note('vc_pizz', c['tones'][0] % 12)
    for k in range(M):
        if k % 2 == 0 or c['I'] > 0.6: S.add('vc_pizz', t0 + k, b, 0.8, 0.4 + 0.3 * c['I'])
def L_ost_pizz(S, c):
    t0, M = c['t0'], c['meter']; b = bass_note('vc_pizz', c['tones'][0] % 12)
    for k, o in enumerate([0, 12, 7, 12, 3, 12, 7, 12][: M * 2]): S.add('vc_pizz' if k % 2 == 0 else 'vla_pizz', t0 + k * 0.5, b + o, 0.4, 0.4 + 0.3 * c['I'])
def L_oompah(S, c):
    t0, M, tones = c['t0'], c['meter'], c['tones']; b = bass_note('vc_pizz', tones[0] % 12)
    S.add('vc_pizz', t0, b if c['bar'] % 2 == 0 else b + 7, 0.8, 0.65)
    for k in range(1, M):
        for m in tones[:3]:
            mm = m + 12
            while mm < 60: mm += 12
            S.add('vln_pizz', t0 + k, mm, 0.5, 0.4 + 0.2 * c['I'])
    if c['I'] > 0.45:
        for k in range(1, M): S.add('pno', t0 + k, tones[1] + 12, 0.5, 0.3)
def L_waltz_pno(S, c):
    t0, tones = c['t0'], c['tones']; b = bass_note('vc', tones[0] % 12) - 12
    S.add('pno', t0, max(33, b), 2.5, 0.45)
    for k in (1, 2):
        for m in tones[1:3]: S.add('pno', t0 + k, m + 12, 0.9, 0.28)
def L_strum_pno(S, c):
    t0, M, tones = c['t0'], c['meter'], c['tones']
    for k in range(M):
        for j, m in enumerate(tones[:3]): S.add('pno', t0 + k + j * 0.02 + (0.5 if k % 2 else 0), m + 12, 0.4, 0.3 + 0.2 * c['I'])
def L_tamb_light(S, c):
    if c['I'] > 0.45 and c['bar'] % 2 == 1: S.add('tamb', c['t0'] + c['meter'] - 1, 0, 1, 0.4)
def L_sleigh_light(S, c):
    if c['I'] > 0.5: [S.add('sleigh', c['t0'] + k, 0, 1, 0.3) for k in range(1, c['meter'], 2)]
def L_drone_fifth(S, c):
    if c['bar'] % 4 == 0:
        r = c['tonic'] % 12; S.add('vc', c['t0'], 36 + r, c['meter'] * 4, 0.35); S.add('vla', c['t0'], 43 + r, c['meter'] * 4, 0.28)
def L_ost_spic(S, c):
    t0, M, I = c['t0'], c['meter'], c['I']; root = c['tones'][0] % 12
    ost = [0, 0, 7, 0, 12, 0, 7, 10] if c['bar'] % 8 < 6 else [0, 12, 0, 7, 0, 12, 3, 7]
    base = 36 + root
    for k, o in enumerate(ost[: M * 2]):
        acc = 1.0 if k in (0, 3, 6) else 0.7
        S.add('vc_spic', t0 + k * 0.5, base + o, 0.45, (0.55 + 0.35 * I) * acc)
        if I > 0.5: S.add('vln_spic', t0 + k * 0.5, base + 24 + o, 0.45, (0.4 + 0.4 * I) * acc)
def L_ost_spic3(S, c):
    t0, I = c['t0'], c['I']; root = c['tones'][0] % 12; base = 36 + root
    for k, o in enumerate([0, 7, 12, 0, 7, 10]):   # in 3: eighths, accent the beats
        acc = 1.0 if k % 2 == 0 else 0.65
        S.add('vc_spic', t0 + k * 0.5, base + o, 0.45, (0.55 + 0.35 * I) * acc)
        if I > 0.5: S.add('vln_spic', t0 + k * 0.5, base + 24 + o, 0.45, (0.4 + 0.4 * I) * acc)
def L_gallop(S, c):
    t0, M, I = c['t0'], c['meter'], c['I']; base = 36 + c['tones'][0] % 12
    for k in range(M):
        for d, a in ((0, 1.0), (0.5, 0.6), (0.75, 0.7)):
            S.add('vc_spic', t0 + k + d, base, 0.25, (0.55 + 0.35 * I) * a)
            if I > 0.55: S.add('vln_spic', t0 + k + d, base + 19, 0.25, (0.35 + 0.4 * I) * a)
def L_stabs(S, c):
    if c['I'] > 0.5:
        for b in (1.5, 3):
            for m in c['tones'][:3]: S.add('hn', c['t0'] + b, m, 0.5, 0.55 + 0.35 * c['I'])
def L_ost_brass_low(S, c):
    t0, M, I = c['t0'], c['meter'], c['I']; root = c['tones'][0] % 12
    for k in range(M):
        o = [0, 0, 1, 0][k % 4] if c['deg'] == 0 else 0
        S.add('tbn', t0 + k, 40 + (root + o) % 12, 0.8, (0.5 + 0.4 * I) * (1.0 if k == 0 else 0.72))
def L_drums_combat(S, c):
    t0, M, I = c['t0'], c['meter'], c['I']; root = c['tones'][0] % 12
    S.add('timp', t0, root, 1, 0.6 + 0.4 * I); S.add('timp', t0 + 2, root, 1, 0.5 + 0.3 * I)
    if I > 0.55: S.add('bd', t0, 0, 1, 0.5 + 0.4 * I); S.add('sn', t0 + 1, 0, 1, 0.35 + 0.4 * I); S.add('sn', t0 + 3, 0, 1, 0.4 + 0.4 * I)
    if c['bar'] % 4 == 3: [S.add('sn', t0 + 3 + q * 0.25, 0, 0.25, 0.35 + 0.15 * q) for q in range(4)]
def L_drums_tribal(S, c):
    t0, M, I = c['t0'], c['meter'], c['I']; r = S.rng
    pat = [(0, 'log_lo', 1), (0.5, 'log_hi', .6), (1.5, 'log_lo', .8), (2, 'log_hi', .7), (2.5, 'log_hi', .5), (3, 'log_lo', .9), (3.5, 'log_hi', .6)]
    for b, inst, a in pat:
        if b < M and (a > 0.65 or I > 0.4): S.add(inst, t0 + b, 0, 0.5, (0.45 + 0.45 * I) * a)
    S.add('bd', t0, 0, 1, 0.5 + 0.4 * I)
    if I > 0.6: S.add('timp', t0 + M - 1, c['tones'][0] % 12, 1, 0.6 + 0.3 * I)
def L_drums_boss(S, c):
    t0, M, I = c['t0'], c['meter'], c['I']; root = c['tones'][0] % 12
    S.add('timp', t0, root, 1, 0.75 + 0.25 * I); S.add('bd', t0, 0, 1, 0.6 + 0.4 * I)
    if I > 0.6: S.add('timp', t0 + 3.5, root, 0.5, 0.6)
    if c['bar'] % 8 == 7 and I > 0.5: S.add('roll', t0, 0, 4, 0.5)
def L_anvil(S, c):
    if c['bar'] % 4 == 3 and c['I'] > 0.6: S.add('anvil', c['t0'] + 3, 0, 1, 0.5)
def L_tolling(S, c):
    if c['bar'] % 4 == 0: S.add('tb', c['t0'], c['tonic'] % 12 + 60, 4, 0.5 + 0.3 * c['I'])
def L_log_tick(S, c):
    r = S.rng
    for k in range(c['meter'] * 2):
        if r.random() < 0.25 + 0.3 * c['I']: S.add('log_hi', c['t0'] + k * 0.5, 0, 0.5, 0.25 + 0.2 * c['I'])
def L_heartbeat(S, c):
    S.add('timp', c['t0'], c['tones'][0] % 12, 1, 0.35 + 0.2 * c['I']); S.add('timp', c['t0'] + 0.6, c['tones'][0] % 12, 1, 0.25 + 0.15 * c['I'])
def L_scrape(S, c):
    if c['bar'] % 4 == 2 and S.rng.random() < 0.6: S.add('ratchet' if S.rng.random() < 0.5 else 'brake', c['t0'] + 2, 0, 1, 0.3)

LAYERS = {k[2:]: v for k, v in globals().items() if k.startswith('L_')}


def compose(mood, seed, seconds=120, style=None):
    rng = np.random.default_rng(seed)
    styles = STYLES[mood]
    name = style or list(styles)[seed % len(styles)]
    st = styles[name]
    bpm = int(rng.choice(st['bpm'])); tonic = st['tonic'] + int(rng.integers(-2, 3))
    scale = st['scales'][rng.integers(len(st['scales']))]; M = st['meter']; bpc = st['bpc']
    S = Score(bpm, rng)
    bars = int(seconds / (M * 60 / bpm)); bars -= bars % 8
    prog = st['progs'][rng.integers(len(st['progs']))]
    lead = st['lead'][rng.integers(len(st['lead']))]
    lo, hi = st.get('lead_lo', 62), st.get('lead_hi', 86)
    busy = {'combat': 0.75, 'boss': 0.5, 'town': 0.7, 'tension': 0.3, 'rest': 0.35}.get(mood, 0.45)
    theme = motif(rng, scale, tonic + 12, busy=busy, lo=lo, hi=hi, meter=M)
    answer = motif(rng, scale, tonic + 12, busy=busy * 0.8, lo=lo, hi=hi, meter=M)
    pad = [tonic - 12 + 7, tonic, tonic + 3, tonic + 7]
    arc = np.interp(np.arange(bars), [0, 4, bars * 0.35, bars * 0.55, bars * 0.8, bars - 4, bars], [0.25, 0.4, 0.55, 0.7, 1.0, 0.6, 0.2])
    if mood in ('rest', 'tension'): arc = 0.3 + 0.5 * (arc - 0.2) / 0.8
    for bar in range(bars):
        I = arc[bar]; t0 = bar * M
        deg = prog[(bar // bpc) % len(prog)]
        tones = chord(tonic, scale, deg, 4)
        ctx = dict(t0=t0, meter=M, tones=tones, I=I, bar=bar, deg=deg, tonic=tonic)
        if bar % bpc == 0:
            pad = voice(pad, tones, 43, 79); dur = M * bpc
            for inst, vi, sh, v in st['pad']:
                if inst.endswith('trem') and I < 0.4 and mood in ('combat', 'boss'): continue
                S.add(inst, t0, pad[vi] + sh, dur, v + 0.3 * I)
            b = st['bass']
            if b in ('cb', 'org_ped', 'vc'): S.add(b, t0, bass_note(b, tones[0] % 12), dur, 0.4 + 0.3 * I)
            if st.get('bass2'): S.add(st['bass2'], t0, bass_note(st['bass2'], tones[0] % 12), dur, 0.5 + 0.4 * I)
            if st.get('swell') and I > 0.62: S.add(st['swell'], t0, pad[1], dur * (0.5 if mood in ('combat', 'boss') else 1), 0.3 + 0.4 * I)
        for L in st['layers']: LAYERS[L](S, ctx)
        sec = bar / bars
        phrase = theme if (sec < 0.35 or 0.55 <= sec < 0.95) else answer
        gap = 4 if st.get('sparse') else 2
        if 4 <= bar < bars - 4 and (bar % gap == 0):
            for b, m, d in phrase:
                S.add(lead, t0 + b, m, d, 0.45 + 0.45 * I)
                if I > 0.8 and st.get('counter'): S.add(st['counter'], t0 + b, m - 12, d, 0.3 + 0.35 * I)
        elif 4 <= bar < bars - 4 and st.get('counter') and 0.35 <= sec < 0.55 and bar % gap == 1:
            for b, m, d in answer: S.add(st['counter'], t0 + b, m - 12 if m > 66 else m, d, 0.35 + 0.3 * I)
    t0 = bars * M; fin = voice(pad, chord(tonic, scale, 0, 3), 43, 79)
    pads = st['pad'] or [('vla', 1, 0, .3), ('vln', 2, 12, .25)]
    for inst, vi, sh, v in pads: S.add(inst, t0, fin[vi] + sh, 6, v + 0.15)
    S.add(st['bass'] if st['bass'] != 'vc_pizz' else 'vc', t0, bass_note(st['bass'], tonic % 12), 6, 0.5)
    if mood in ('explore', 'rest', 'town'): S.add('hp', t0, tonic + 24, 3, 0.4)
    elif mood in ('combat', 'boss'): S.add('timp', t0, tonic, 1, 0.8); S.add('hn', t0, fin[1], 5, 0.6); S.add('tbn', t0, fin[0], 5, 0.55)
    return S, {'bpm': bpm, 'tonic': int(tonic), 'bars': bars, 'style': name, 'meter': M, 'lead': lead}


def sting(kind, seed):
    """Short cues (4 to 12 seconds): victory, defeat, discovery, danger, rest_done."""
    rng = np.random.default_rng(seed); tonic = 55 + int(rng.integers(-3, 3))
    S = Score(int(rng.choice([88, 96, 104])), rng)
    if kind == 'victory':
        sc = MAJOR; fan = [(0, 0), (0.5, 0), (0.75, 0), (1, 4), (2, 7), (3, 12)] if rng.random() < 0.5 else [(0, 7), (0.5, 7), (1, 9), (1.5, 11), (2, 12)]
        for b, o in fan: S.add('tpt', b, tonic + 12 + o, 0.9 if b < 2 else 3, 0.8); S.add('hn', b, tonic + o, 0.9 if b < 2 else 3, 0.7)
        for m in chord(tonic, sc, 0, 3): S.add('vln', 2, m + 12, 4, 0.6); S.add('vla', 2, m, 4, 0.5)
        S.add('cb', 2, bass_note('cb', tonic % 12), 4, 0.6); S.add('roll', 0, 0, 2, 0.6); S.add('timp', 2, tonic, 1, 0.9); S.add('belltree', 2, 0, 2, 0.4)
    elif kind == 'defeat':
        sc = HARM; line = [7, 5, 3, 2, 0] if rng.random() < 0.5 else [8, 7, 5, 3, 2]
        for k, o in enumerate(line): S.add('vln', k * 1.5, tonic + 12 + sc[(o if o < 7 else 0)] if False else tonic + 12 + o, 1.6, 0.5)
        for m in chord(tonic - 12, MINOR, 0, 3): S.add('vc', 0, m, 8, 0.4)
        S.add('cb', 0, bass_note('cb', tonic % 12), 8, 0.45); S.add('tb', 6, tonic % 12 + 60, 4, 0.4); S.add('hn', 4.5, tonic + 3, 3.5, 0.4)
    elif kind == 'discovery':
        for k, m in enumerate([0, 4, 7, 11, 12, 16, 19, 23]): S.add('hp', k * 0.15, tonic + m, 2, 0.5)
        for m in chord(tonic, LYD, 0, 4): S.add('vln', 1, m + 12, 4, 0.4); S.add('vla_trem', 1, m, 4, 0.3)
        S.add('glk', 1.2, tonic + 31, 3, 0.5); S.add('belltree', 0.8, 0, 2, 0.4)
    elif kind == 'danger':
        for m in (tonic - 12, tonic - 11, tonic - 6): S.add('tbn', 0, m, 1.5, 0.85); S.add('hn', 0, m + 12, 1.5, 0.8)
        S.add('timp', 0, tonic, 1, 1.0); S.add('bd', 0, 0, 1, 0.9); S.add('vln_trem', 0, tonic + 25, 4, 0.6); S.add('vc_trem', 0, tonic - 12, 4, 0.6)
        S.add('anvil', 2, 0, 1, 0.4)
    elif kind == 'rested':
        for k, m in enumerate(chord(tonic, MAJOR, 0, 4) + [tonic + 12]): S.add('pno', k * 0.4, m + 12, 3, 0.4)
        for m in chord(tonic, MAJOR, 0, 3): S.add('vla', 0.8, m, 4, 0.25)
        S.add('fl', 1.6, tonic + 19, 2.5, 0.45)
    return S


def render(S, mood, seed, target=-17.0):
    from scipy.signal import resample_poly
    rng = np.random.default_rng(seed + 1)
    pools = {}
    groups = {}
    for inst, t, m, d, v in S.ev:
        if inst in PERC:
            pool = pools.setdefault(inst, perc(PERC[inst]))
            x = pool[int(rng.integers(len(pool)))] if pool else np.zeros((10, 2), np.float32)
            if inst == 'timp':   # tune the drum toward the chord root (within a few semitones)
                shift = ((m % 12) - 7 + 6) % 12 - 6; r = 2 ** (shift / 12)
                x = resample_poly(x, int(round(1000 / r)), 1000, axis=0).astype(np.float32)
            if inst in ('roll', 'tamb', 'ratchet'): x = x[: secs(d * 1.0 + 0.4)] * env_adsr(min(len(x), secs(d + 0.4)), 0.01, 0, 1, 0.3)[:, None]
            x = x * (v ** 1.5)
        else:
            x = bank(inst).note(m, d, v, rng, release=0.15 if inst in SHORT else (1.2 if inst in ('pno', 'hp', 'glk', 'tb') else 0.5))
        t = max(0.0, t + rng.normal(0, 0.006))
        groups.setdefault(inst, []).append((x, t, 1.0))
    n = max(secs(t) + len(x) for parts in groups.values() for x, t, g in parts) + secs(3)
    bus = np.zeros((n, 2), np.float32); send = np.zeros((n, 2), np.float32)
    for inst, parts in groups.items():
        stem = mix(parts, n)
        pan, wet = SEAT.get(inst, (0, 0.3))
        stem = pan_stereo(stem, pan) * LEVEL.get(inst, 0.7)
        bus += stem; send += stem * wet
    wetbus = reverb(send, 'hall', wet=1.0)[:n]
    out = bus + wetbus * 0.55
    out = hp(out, 30)
    return master(out, target_db=target)
