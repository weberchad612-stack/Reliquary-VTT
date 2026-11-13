"""Every visual effect's sound, written as layer specs: a spec lists layers (voices from sfx.py and voices.py, and the
recorded samples) with when each starts, before the impact or after it, and which results it belongs to. The impact
time is the visual effect's own (rulesets/<system>/effects.js 'impact', in ms), so a sound file lines up with its
effect when both start together. Table cues (dice, turns, doors, the interface) are specs too.

A spec: {'pre': [...], 'hit': [...], 'crit': [...], 'miss': [...], 'room': 'room', 'wet': 0.15, 'target': -16}
with each layer (name, at, gain); at is seconds from the start, or 'i+0.02' / 'i-0.1' from the impact. 'pre' plays
for every result, 'hit' for hit and crit, 'crit' on a crit, 'miss' on a miss. Docs: docs/best-practices/sound.md."""
import numpy as np
from dsp import SR, secs, lp, hp, bp, sweep_filter, env_ad, env_adsr, white, pink, brown, sine, fm, karplus, modal, crackle, stereo, mix, fade
import sfx
from sfx import swing, cut, squelch, thud, ring, boom, roar, sparkle, twang, whiz, thunk, harp_arp, pick, finish
from voices import (growl, shout, wail, whisper, babble, zap, ice, sizzle, gas, drone, reverse_swell, shimmer, bubble, pulse,
                    buzz_swarm, creak, rustle, clacks, bell, footsteps, splat, stab, voice, saw)


def S(x, pan=0.0, w=0.4): return stereo(x, pan, w)


def glass(rng, gain=1.0):
    n = secs(0.6); out = np.zeros(n, np.float32)
    for _ in range(10):
        at = int(rng.uniform(0, 0.12) * n); m = secs(rng.uniform(0.15, 0.45))
        s = modal(m, rng.uniform(2500, 6500), [1, 2.4, 3.9], [0.1, 0.06, 0.03], [1, 0.5, 0.3], rng) * rng.uniform(0.15, 0.5)
        e = min(n, at + m); out[at:e] += s[: e - at]
    burst = bp(white(n, rng), 3000, 14000) * env_ad(n, 0.001, 0.05, 6) * 0.8
    return S((out + burst) * gain, 0, 1.0)


def clink(rng, gain=1.0, f=(1200, 2600)):
    m = secs(0.35); x = modal(m, rng.uniform(*f), [1, 2.76, 5.4, 8.9], [0.12, 0.08, 0.04, 0.02], [1, 0.6, 0.35, 0.2], rng)
    return S(x * gain * 0.5, rng.uniform(-0.3, 0.3))


def chains(rng, gain=1.0, count=8, dur=0.45):
    return mix([(clink(rng, rng.uniform(0.3, 0.8)), rng.uniform(0, dur), 1) for _ in range(count)]) * gain


def hiss(rng, dur=0.6, gain=1.0):
    n = secs(dur); return S(hp(white(n, rng), 4000) * env_adsr(n, 0.03, 0.1, 0.7, dur * 0.5) * gain * 0.6, 0, 0.5)


def spit(rng, gain=1.0):
    n = secs(0.18); x = sweep_filter(white(n, rng) * env_ad(n, 0.003, 0.08, 4), 3000, 900, q=2) + lp(brown(n, rng), 600) * env_ad(n, 0.002, 0.04, 5) * 2
    return S(x * gain, 0, 0.3)


def thwip(rng, gain=1.0):
    n = secs(0.25); x = sweep_filter(white(n, rng) * env_ad(n, 0.002, 0.15, 4), 5000, 800, q=5) * 1.5
    return S(x * gain, 0, 0.4)


def stretch(rng, gain=1.0, dur=0.5):
    return creak(rng, dur, 260, 0.6 * gain)


def wobble(rng, dur=0.9, f=420, gain=1.0):
    """Mental: a detuned, warbling chord."""
    n = secs(dur); t = np.arange(n) / SR; out = np.zeros(n, np.float32)
    for r in (1, 1.26, 1.5, 2.02):
        ff = f * r * (1 + 0.04 * np.sin(2 * np.pi * (5 + r) * t))
        out += np.sin(2 * np.pi * np.cumsum(ff) / SR).astype(np.float32) * 0.2
    return S(out * env_adsr(n, 0.05, 0.2, 0.7, dur * 0.5) * gain, 0, 1.0)


def chime(rng, base=1320, n=3, step=0.18, gain=1.0):
    return mix([(bell(rng, base * 2 ** (rng.choice([0, 4, 7, 12]) / 12), 1.4, 0.7), k * step, 1) for k in range(n)]) * gain


def pop(rng, f=900, gain=1.0):
    m = secs(0.12); return S(sine(m, f * 1.6, f * 0.6) * env_ad(m, 0.001, 0.05, 5) * gain * 0.6, rng.uniform(-0.2, 0.2))


def click(rng, gain=1.0, f=2400):
    m = secs(0.04); return S((bp(white(m, rng), f * 0.7, f * 1.4) * env_ad(m, 0.0005, 0.012, 6) + sine(m, f * 0.5) * env_ad(m, 0.0005, 0.008, 6) * 0.3) * gain, 0)


def coins(rng, gain=1.0, count=9):
    return mix([(clink(rng, rng.uniform(0.25, 0.6), (2600, 4800)), k * rng.uniform(0.03, 0.07), 1) for k in range(count)]) * gain


def page(rng, gain=1.0):
    return rustle(rng, 0.35, gain * 0.7, 1500, 8000)


def door(rng, opening=True, gain=1.0):
    parts = [(creak(rng, 0.9, 140 if opening else 170, 0.8), 0 if opening else 0.0, 1)]
    if not opening: parts += [(thunk(rng, 1.0), 0.55, 1), (thud(rng, -6, 0.8, 0.6), 0.55, 1)]
    else: parts += [(click(rng, 0.6, 1800), 0, 1)]
    return mix(parts) * gain


def latch(rng, gain=1.0):
    return mix([(click(rng, 0.8, 1600), 0, 1), (click(rng, 0.6, 2400), 0.07, 1), (thud(rng, 4, 0.4, 0.15), 0.0, 1)]) * gain


def flame_whoosh(rng, dur=0.6, gain=1.0):
    n = secs(dur); return S(sweep_filter(brown(n, rng) * 3 * env_adsr(n, 0.05, 0.1, 0.8, dur * 0.5), 200, 2600, q=1.0, kind='low') * gain, 0, 0.7)


def fire_crackle(rng, dur=1.5, gain=1.0):
    n = secs(dur); return S(crackle(n, rng, 60, (1500, 8000)) * env_adsr(n, 0.02, 0.2, 0.8, dur * 0.5) * gain * 0.8, 0, 1.0)


def wind(rng, dur=1.0, lo=500, hi=3000, gain=1.0):
    n = secs(dur); x = sweep_filter(pink(n, rng), lo, hi, q=1.5) * env_adsr(n, dur * 0.3, 0.1, 0.8, dur * 0.4)
    return S(x * gain * 1.2, 0, 1.0)


def thunder(rng, gain=1.0):
    return mix([(boom(rng, 1.0, 2.2, 55), 0, 1), (S(crackle(secs(0.4), rng, 400, (1500, 9000), (0.0003, 0.002)) * 1.5, 0, 0.8), 0, 1),
                (S(lp(brown(secs(2.0), rng), 300) * env_ad(secs(2.0), 0.2, 1.2, 2) * 2, 0, 1.0), 0.1, 1)]) * gain


def void_pop(rng, gain=1.0):
    n = secs(0.5); return S(fm(n, 110, 0.5, 6, 0, fc_end=45) * env_ad(n, 0.002, 0.3, 3) * gain * 0.8, 0, 0.6)


def force_pop(rng, gain=1.0):
    n = secs(0.35); return S(fm(n, 220, 1.41, 8, 0.0, fc_end=90) * env_ad(n, 0.001, 0.2, 4) * gain, 0, 0.5)


def charge(rng, dur=0.25, f0=320, f1=1100, gain=1.0):
    n = secs(dur); return S(fm(n, f0, 1.5, 4, 0.5, fc_end=f1) * env_adsr(n, dur * 0.8, 0.0, 1, 0.03) * 0.5 * gain, 0, 0.5)


def beam(rng, dur=0.3, f0=1400, f1=500, gain=1.0):
    n = secs(dur); return S(fm(n, f0, 2.01, 6, 0.3, fc_end=f1) * env_ad(n, 0.002, dur * 0.7, 4) * 0.7 * gain, 0, 0.6)


def ray_hum(rng, dur=0.5, f=600, gain=1.0):
    n = secs(dur); t = np.arange(n) / SR
    x = fm(n, f, 1.002, 2.5, 1.0) * (0.7 + 0.3 * np.sin(2 * np.pi * 30 * t)) * env_adsr(n, 0.02, 0.05, 0.8, 0.1)
    return S(x * gain * 0.5, 0, 0.5)


def sigil(rng, gain=1.0):
    return mix([(drone(rng, 1.4, 73, 0.6, dark=False), 0, 1), (shimmer(rng, 1.2, 0.4, 660, (0, 7, 12, 19, 24)), 0.2, 1)]) * gain


def zs(rng, gain=1.0):
    return mix([(shimmer(rng, 1.4, 0.5, 990, (12, 7, 4, 0), down=False), 0, 1), (wind(rng, 1.2, 300, 900, 0.3), 0, 1)]) * gain


# ---- the layer library: name -> rng -> stereo ----
L = {
    'swing': lambda r: swing(r, 0.28, 400, 3000), 'swing_fast': lambda r: swing(r, 0.2, 600, 3600, 0.9), 'swing_heavy': lambda r: swing(r, 0.45, 220, 1500, 1.1),
    'swing_long': lambda r: swing(r, 0.5, 300, 2600), 'swing_double': lambda r: mix([(swing(r, 0.2, 600, 3400), 0, 1), (swing(r, 0.2, 700, 3800), 0.16, 1)]),
    'whiff': lambda r: swing(r, 0.22, 1200, 500, 0.35), 'thrust': lambda r: swing(r, 0.18, 1500, 4500, 0.7),
    'cut': lambda r: cut(r, 0.05, 0.9), 'cut_big': lambda r: cut(r, 0.08, 1.0), 'squelch': lambda r: squelch(r, 0.16, 0.9), 'squelch_big': lambda r: squelch(r, 0.28, 1.0),
    'stab_flesh': lambda r: mix([(cut(r, 0.03, 0.6), 0, 1), (squelch(r, 0.12, 0.8), 0.005, 1)]),
    'thud': lambda r: thud(r, -2, 0.7, 0.4), 'thud_big': lambda r: thud(r, -7, 1.0, 0.8), 'thud_small': lambda r: thud(r, 3, 0.5, 0.25),
    'crunch': lambda r: mix([(S(crackle(secs(0.25), r, 300, (1200, 7000), (0.0005, 0.003)) * 1.6), 0, 1), (thud(r, -3, 0.6, 0.3), 0, 1)]),
    'bone_crack': lambda r: mix([(S(crackle(secs(0.12), r, 500, (2000, 9000), (0.0003, 0.0015)) * 1.8), 0, 1), (thunk(r, 0.5), 0, 1)]),
    'ring': lambda r: ring(r, -3, 0.35), 'clang': lambda r: pick(r, 'brake', r.uniform(-2, 1), 0.9) * 0.9, 'anvil': lambda r: ring(r, 0, 0.5, 1.4),
    'thunk': lambda r: thunk(r, 0.9), 'twang': lambda r: twang(r, 0.8),
    'xbow': lambda r: mix([(S(karplus(secs(0.2), r.uniform(150, 180), r, damp=0.96, bright=0.6) * env_ad(secs(0.2), 0.001, 0.06, 5) * 0.6), 0, 1), (click(r, 0.9, 1400), 0, 1), (click(r, 0.6, 900), 0.03, 1)]),
    'whiz': lambda r: whiz(r, 0.3, 4500, 1800, 0.7), 'whiz_long': lambda r: whiz(r, 0.5, 3500, 1200, 0.6), 'whiz_short': lambda r: whiz(r, 0.18, 5500, 2500, 0.6),
    'whoosh_low': lambda r: swing(r, 0.55, 140, 900, 1.0), 'whoosh_spin': lambda r: mix([(swing(r, 0.15, 300, 1200, 0.6), k * 0.12, 1) for k in range(4)]),
    'skitter': lambda r: clacks(r, 6, 0.06, 0.6, (1200, 2600)), 'rubble': lambda r: clacks(r, 12, 0.03, 0.7, (300, 1400)),
    'glass': lambda r: glass(r, 0.9), 'splat': lambda r: splat(r, 0.35, 0.9), 'sizzle': lambda r: sizzle(r, 0.8, 0.7), 'sizzle_long': lambda r: sizzle(r, 1.4, 0.7),
    'spit': lambda r: spit(r, 0.9), 'thwip': lambda r: thwip(r, 0.9), 'stretch': lambda r: stretch(r, 0.8),
    'boom': lambda r: boom(r, 0.8, 1.6, 70), 'boom_big': lambda r: boom(r, 1.0, 2.2, 55), 'boom_small': lambda r: boom(r, 0.5, 0.8, 95),
    'flame': lambda r: flame_whoosh(r, 0.6, 0.9), 'flame_long': lambda r: flame_whoosh(r, 1.2, 0.9), 'roar_fire': lambda r: roar(r, 1.4, 0.8, 1800),
    'crackle': lambda r: fire_crackle(r, 1.5, 0.8), 'timp_low': lambda r: pick(r, 'timp', -6, 2.0) * 0.7,
    'ice': lambda r: ice(r, 0.9, 0.9), 'frost_wind': lambda r: wind(r, 0.9, 1500, 6000, 0.6), 'frost_wind_long': lambda r: wind(r, 1.4, 1200, 6000, 0.7),
    'zap': lambda r: zap(r, 0.4, 0.9), 'zap_long': lambda r: zap(r, 0.8, 1.0, 70), 'thunder': lambda r: thunder(r, 0.9),
    'charge': lambda r: charge(r), 'charge_long': lambda r: charge(r, 0.6, 200, 1200), 'beam': lambda r: beam(r), 'force_pop': lambda r: force_pop(r, 0.9),
    'sparkle': lambda r: sparkle(r, 0.7, 0.6, 2200), 'sparkle_big': lambda r: sparkle(r, 1.2, 0.6, 2600), 'sparkle_low': lambda r: sparkle(r, 0.9, 0.5, 1200),
    'ray_hum': lambda r: ray_hum(r), 'ray_cold': lambda r: ray_hum(r, 0.55, 1200, 0.8), 'ray_void': lambda r: ray_hum(r, 0.5, 140, 1.2),
    'void_pop': lambda r: void_pop(r), 'drone_dark': lambda r: drone(r, 1.4, 49, 0.8), 'drone_long': lambda r: drone(r, 2.2, 44, 0.8),
    'inhale': lambda r: reverse_swell(r, 0.8, 0.8), 'inhale_long': lambda r: reverse_swell(r, 1.4, 0.8, 120, 1600),
    'wobble': lambda r: wobble(r, 0.9, 420, 0.8), 'wobble_long': lambda r: wobble(r, 1.6, 300, 0.8),
    'wail': lambda r: wail(r, 1.6, 0.8), 'wail_long': lambda r: wail(r, 2.6, 0.9, 480), 'whisper': lambda r: whisper(r, 1.2, 0.9), 'whisper_long': lambda r: whisper(r, 2.4, 0.9),
    'babble': lambda r: babble(r, 2.4, 0.8), 'shout': lambda r: shout(r, 0.5, 150, 'a', 0.9), 'war_cry': lambda r: mix([(shout(r, 0.8, 140, 'a', 0.8), 0, 1), (shout(r, 0.7, 175, 'o', 0.6), 0.05, 1)]),
    'grunt': lambda r: shout(r, 0.2, 120, 'u', 0.7),
    'growl': lambda r: growl(r, 0.8, 70, 0.9), 'roar_beast': lambda r: growl(r, 1.4, 55, 1.1), 'snarl': lambda r: growl(r, 0.4, 90, 0.8), 'hiss': lambda r: hiss(r, 0.6, 0.9),
    'chains': lambda r: chains(r, 0.9), 'chains_short': lambda r: chains(r, 0.7, 4, 0.2), 'clink': lambda r: clink(r, 0.7),
    'swarm': lambda r: buzz_swarm(r, 1.4, 0.9), 'rustle': lambda r: rustle(r, 0.6, 0.9), 'rustle_long': lambda r: rustle(r, 1.4, 0.9, 400, 4000), 'creak': lambda r: creak(r, 0.8),
    'gas': lambda r: gas(r, 1.6, 0.9), 'bubble': lambda r: bubble(r, 0.7, 0.8), 'bubble_down': lambda r: bubble(r, 0.8, 0.8, 900, 250),
    'harp_up': lambda r: harp_arp(r, [64, 68, 71, 76, 80, 83], 0.065, 0.8), 'harp_down': lambda r: harp_arp(r, [83, 79, 76, 71, 67, 64], 0.06, 0.7),
    'harp_dark': lambda r: harp_arp(r, [62, 65, 68, 71, 74], 0.08, 0.7),
    'shimmer': lambda r: shimmer(r, 1.2, 0.8, 880), 'shimmer_down': lambda r: shimmer(r, 1.2, 0.7, 880, down=True), 'shimmer_low': lambda r: shimmer(r, 1.0, 0.6, 440, (0, 7, 12)),
    'holy': lambda r: mix([(stab(r, (64, 68, 71, 76), 1.4, 'vln', 0.8), 0, 1), (shimmer(r, 1.2, 0.5, 1320, (0, 4, 7, 12)), 0.1, 1)]),
    'unholy': lambda r: mix([(stab(r, (50, 51, 57), 1.2, 'vc', 0.8), 0, 1), (drone(r, 1.2, 46, 0.5), 0, 1)]),
    'bell': lambda r: bell(r, 1320, 1.6, 0.8), 'chime': lambda r: chime(r, 1320, 3, 0.18, 0.8), 'alarm': lambda r: chime(r, 1760, 6, 0.4, 0.8),
    'tolling': lambda r: stab(r, (60,), 2.5, 'tb', 0.9), 'glk': lambda r: stab(r, (84, 91), 1.0, 'glk', 0.7),
    'brass': lambda r: stab(r, (55, 62, 67, 71), 0.5, 'hn', 0.8), 'fanfare': lambda r: mix([(stab(r, (67,), 0.15, 'tpt', 0.8), 0, 1), (stab(r, (67,), 0.15, 'tpt', 0.8), 0.15, 1), (stab(r, (72, 76, 79), 0.8, 'tpt', 0.9), 0.3, 1)]),
    'brass_dark': lambda r: stab(r, (43, 44, 50), 0.8, 'tbn', 0.9), 'trem': lambda r: stab(r, (74, 75, 81), 1.2, 'trem', 0.6),
    'pulse': lambda r: pulse(r, 0.6, 660, 0.8), 'pulse_low': lambda r: pulse(r, 0.8, 330, 0.8), 'pop': lambda r: pop(r, 900, 0.8),
    'sigil': lambda r: sigil(r, 0.8), 'zs': lambda r: zs(r, 0.8), 'wind': lambda r: wind(r, 1.0, 400, 2500, 0.7),
    'footsteps': lambda r: footsteps(r, 4, 0.11, 0.8), 'footsteps_run': lambda r: footsteps(r, 5, 0.075, 0.9), 'cloth': lambda r: S(bp(white(secs(0.4), r), 300, 2500) * env_ad(secs(0.4), 0.02, 0.2, 3) * 0.5, 0, 0.5),
    'click': lambda r: click(r, 0.8), 'click_soft': lambda r: click(r, 0.5, 1600), 'coins': lambda r: coins(r, 0.8), 'page': lambda r: page(r, 0.8),
    'door_open': lambda r: door(r, True, 0.9), 'door_close': lambda r: door(r, False, 0.9), 'latch': lambda r: latch(r, 0.8),
    'dice': lambda r: clacks(r, 7, 0.08, 0.8, (1800, 3400)), 'dice_shake': lambda r: mix([(clacks(r, 3, 0.03, 0.5, (2000, 3500)), k * 0.09, 1) for k in range(3)]),
    'body_fall': lambda r: mix([(thud(r, -6, 1.0, 0.8), 0, 1), (thud(r, -3, 0.5, 0.5), 0.14, 1), (S(crackle(secs(0.5), r, 30, (800, 5000), (0.001, 0.006)) * 0.5, 0, 0.6), 0.02, 1)]),
    'metal_drop': lambda r: ring(r, 8, 0.15, 0.5, 'brake'),
}


def at(t, imp):
    if isinstance(t, str): return max(0.0, imp + float(t[1:]))
    return t


def build(spec, rng, r, imp):
    parts = []
    for key in ('pre', 'hit', 'crit', 'miss'):
        if key == 'hit' and r == 'miss': continue
        if key == 'crit' and r != 'crit': continue
        if key == 'miss' and r != 'miss': continue
        for name, t, g in spec.get(key, []):
            parts.append((L[name](rng), at(t, imp), g * (1.15 if (key == 'hit' and r == 'crit') else 1.0)))
    x = mix(parts)
    tgt = spec.get('target', -16) + (1.0 if r == 'crit' else 0)
    return finish(x, spec.get('room', 'room'), spec.get('wet', 0.15) * (1.3 if r == 'crit' else 1), tgt)


I = 'i+0'   # at the impact
SPECS = {
    # ---- weapon strikes ----
    'strike_pierce': {'pre': [('thrust', 'i-0.12', 1)], 'hit': [('stab_flesh', I, 1), ('thud_small', I, 0.8)], 'crit': [('squelch_big', 'i+0.04', 0.9), ('ring', I, 0.5)], 'miss': [('whiff', 'i+0.02', 1)]},
    'strike_bludgeon': {'pre': [('swing_heavy', 'i-0.25', 0.9)], 'hit': [('thud_big', I, 1), ('crunch', I, 0.7)], 'crit': [('bone_crack', 'i+0.01', 1), ('boom_small', I, 0.8)], 'miss': [('whiff', 'i+0.05', 1), ('thud_small', 'i+0.15', 0.3)]},
    'strike_flourish': {'pre': [('swing_double', 'i-0.32', 1)], 'hit': [('cut', I, 1), ('squelch', 'i+0.01', 0.8), ('cut', 'i+0.12', 0.8)], 'crit': [('ring', I, 0.5), ('sparkle', I, 0.6)], 'miss': [('whiff', 'i+0.05', 1)]},
    'strike_sweep': {'pre': [('swing_long', 'i-0.32', 1)], 'hit': [('cut_big', I, 1), ('squelch', I, 0.9), ('thud', I, 0.7)], 'crit': [('squelch_big', 'i+0.06', 1), ('boom_small', I, 0.6)], 'miss': [('whiff', 'i+0.04', 1)]},
    'strike_chop': {'pre': [('swing_heavy', 'i-0.28', 1)], 'hit': [('thunk', I, 0.8), ('squelch', I, 0.9), ('thud', I, 0.8)], 'crit': [('bone_crack', I, 1), ('squelch_big', 'i+0.05', 0.9)], 'miss': [('whiff', 'i+0.03', 1), ('thunk', 'i+0.18', 0.4)]},
    'strike_thrust': {'pre': [('thrust', 'i-0.15', 1), ('swing_fast', 'i-0.2', 0.5)], 'hit': [('stab_flesh', I, 1), ('thud', I, 0.7)], 'crit': [('squelch_big', 'i+0.03', 1), ('ring', I, 0.4)], 'miss': [('whiff', 'i+0.02', 1)]},
    # ---- ranged ----
    'ranged_bolt': {'pre': [('xbow', 0, 1), ('whiz_short', 0.03, 0.8)], 'hit': [('thunk', I, 1), ('stab_flesh', I, 0.7)], 'crit': [('thud_big', I, 0.8), ('squelch_big', 'i+0.03', 0.8)], 'miss': [('skitter', 'i+0.04', 0.8)]},
    'ranged_javelin': {'pre': [('grunt', 0, 0.6), ('whoosh_low', 0.02, 0.7), ('whiz_long', 0.1, 0.5)], 'hit': [('stab_flesh', I, 1), ('thud', I, 0.9)], 'crit': [('thud_big', I, 0.8), ('squelch_big', 'i+0.03', 0.9)], 'miss': [('thunk', 'i+0.05', 0.6), ('skitter', 'i+0.1', 0.5)]},
    'ranged_dart': {'pre': [('swing_fast', 0, 0.6), ('whiz_short', 0.08, 0.7)], 'hit': [('stab_flesh', I, 0.9)], 'crit': [('squelch', 'i+0.02', 0.9), ('ring', I, 0.3)], 'miss': [('clink', 'i+0.04', 0.8), ('skitter', 'i+0.08', 0.4)]},
    'ranged_sling': {'pre': [('whoosh_spin', 0, 0.6), ('whiz_short', 'i-0.15', 0.6)], 'hit': [('thud', I, 1), ('crunch', I, 0.5)], 'crit': [('bone_crack', I, 1)], 'miss': [('skitter', 'i+0.04', 0.9)]},
    'ranged_rock': {'pre': [('rubble', 0, 0.4), ('whoosh_low', 'i-0.4', 0.8)], 'hit': [('thud_big', I, 1), ('rubble', I, 0.7)], 'crit': [('bone_crack', I, 0.8), ('boom_small', I, 0.7)], 'miss': [('rubble', 'i+0.05', 0.9)]},
    'ranged_boulder': {'pre': [('grunt', 0, 0.7), ('whoosh_low', 0.1, 1)], 'hit': [('boom', I, 1), ('rubble', I, 1), ('thud_big', I, 1)], 'crit': [('bone_crack', I, 1), ('boom_big', I, 0.8)], 'miss': [('boom_small', 'i+0.05', 0.9), ('rubble', 'i+0.06', 1)], 'room': 'hall', 'wet': 0.18},
    'ranged_flask': {'pre': [('swing_fast', 0, 0.5), ('whiz_long', 0.08, 0.4)], 'hit': [('glass', I, 1), ('sizzle', 'i+0.03', 0.9), ('splat', I, 0.6)], 'crit': [('flame', 'i+0.02', 0.8), ('sizzle_long', 'i+0.05', 0.8)], 'miss': [('glass', 'i+0.05', 0.9), ('sizzle', 'i+0.08', 0.6)]},
    'ranged_spit': {'pre': [('spit', 0, 1), ('whiz_short', 0.04, 0.4)], 'hit': [('splat', I, 1), ('sizzle', 'i+0.03', 0.8)], 'crit': [('sizzle_long', 'i+0.03', 1), ('hiss', I, 0.6)], 'miss': [('splat', 'i+0.08', 0.5)]},
    'ranged_web': {'pre': [('thwip', 0, 1), ('whiz', 0.05, 0.4)], 'hit': [('splat', I, 0.7), ('stretch', 'i+0.03', 1)], 'crit': [('stretch', 'i+0.25', 0.8)], 'miss': [('thwip', 'i+0.05', 0.4)]},
    # ---- spell projectiles ----
    'force_missiles': {'pre': [('charge', 0, 1), ('beam', 0.2, 0.7), ('beam', 0.3, 0.6), ('beam', 0.4, 0.6)], 'hit': [('force_pop', I, 0.9), ('force_pop', 'i+0.1', 0.8), ('force_pop', 'i+0.2', 0.8), ('sparkle', I, 0.6)], 'crit': [('boom_small', I, 0.6)], 'miss': [('sparkle_low', 'i+0.05', 0.6)]},
    'ray_fire': {'pre': [('flame', 0, 0.9), ('whiz', 0.1, 0.4)], 'hit': [('boom_small', I, 0.9), ('crackle', I, 0.8), ('sizzle', I, 0.5)], 'crit': [('roar_fire', I, 0.9)], 'miss': [('crackle', 'i+0.05', 0.4)]},
    'ray_cold': {'pre': [('ray_cold', 0, 1), ('frost_wind', 0.05, 0.6)], 'hit': [('ice', I, 1), ('thud_small', I, 0.6)], 'crit': [('glass', I, 0.8), ('frost_wind_long', I, 0.7)], 'miss': [('ice', 'i+0.05', 0.4)]},
    'ray_void': {'pre': [('ray_void', 0, 1), ('inhale', 0, 0.4)], 'hit': [('void_pop', I, 1), ('drone_dark', I, 0.5)], 'crit': [('unholy', I, 0.8)], 'miss': [('void_pop', 'i+0.05', 0.4)]},
    'ray_mental': {'pre': [('wobble', 0, 0.8)], 'hit': [('pop', I, 0.8), ('sparkle', I, 0.7), ('wobble', I, 0.6)], 'crit': [('glk', I, 0.7)], 'miss': [('shimmer_down', 'i+0.05', 0.4)], 'room': 'hall'},
    'arc_lightning': {'pre': [('charge', 0, 0.6)], 'hit': [('zap', I, 1), ('thunder', 'i+0.03', 0.7)], 'crit': [('zap_long', I, 1)], 'miss': [('zap', 'i+0.04', 0.5)]},
    'gadget_zap': {'pre': [('click', 0, 0.8), ('charge', 0, 0.4)], 'hit': [('zap', I, 0.9), ('pop', I, 0.5)], 'crit': [('zap_long', I, 0.8)], 'miss': [('zap', 'i+0.03', 0.35)]},
    'acid_splash': {'pre': [('bubble', 0, 0.7), ('whiz', 0.06, 0.4)], 'hit': [('splat', I, 1), ('sizzle', 'i+0.03', 1)], 'crit': [('sizzle_long', 'i+0.03', 1)], 'miss': [('splat', 'i+0.06', 0.5), ('sizzle', 'i+0.1', 0.5)]},
    'tendrils': {'pre': [('drone_dark', 0, 0.8), ('rustle_long', 0.1, 0.5), ('whisper', 0.1, 0.4)], 'hit': [('squelch', I, 0.8), ('void_pop', I, 0.8)], 'crit': [('squelch_big', 'i+0.1', 0.8)], 'miss': [('inhale', 'i-0.3', 0.5)]},
    'shadow_grasp': {'pre': [('inhale', 0, 0.6), ('whisper', 0, 0.4)], 'hit': [('void_pop', I, 1), ('stretch', I, 0.4)], 'crit': [('unholy', I, 0.7)], 'miss': [('whiff', I, 0.5)]},
    'drain_life': {'pre': [('drone_dark', 0, 0.6)], 'hit': [('void_pop', I, 0.9), ('inhale_long', 'i+0.1', 0.9)], 'crit': [('wail', 'i+0.2', 0.5)], 'miss': [('inhale', 'i+0.05', 0.5)]},
    # ---- areas (no hit or miss: one sound) ----
    'burst_cold': {'pre': [('frost_wind_long', 0, 0.9), ('ice', 0.15, 1), ('ice', 0.35, 0.8), ('boom_small', 0.12, 0.6)], 'room': 'hall', 'wet': 0.22},
    'burst_poison': {'pre': [('gas', 0, 1), ('hiss', 0.1, 0.6), ('bubble', 0.3, 0.5)], 'room': 'hall', 'wet': 0.2},
    'burst_void': {'pre': [('inhale_long', 0, 0.9), ('void_pop', 0.9, 1), ('drone_long', 0.4, 0.7), ('whisper', 0.3, 0.4)], 'room': 'hall', 'wet': 0.25},
    'burst_death': {'pre': [('squelch_big', 0, 1), ('splat', 0.05, 0.9), ('gas', 0.1, 0.6), ('void_pop', 0, 0.6)]},
    'burst_sleep': {'pre': [('zs', 0, 1), ('harp_down', 0.1, 0.5)], 'room': 'hall', 'wet': 0.3, 'target': -18},
    'burst_spirit': {'pre': [('holy', 0, 0.7), ('wail', 0.1, 0.4), ('boom_small', 0.05, 0.6), ('sparkle_big', 0.1, 0.6)], 'room': 'hall', 'wet': 0.3},
    'burst_force': {'pre': [('charge', 0, 0.6), ('force_pop', 0.22, 1), ('boom', 0.22, 0.9), ('sparkle', 0.3, 0.5)], 'room': 'hall', 'wet': 0.2},
    'cone_fire': {'pre': [('flame_long', 0, 1), ('roar_fire', 0.1, 1), ('crackle', 0.3, 0.8)], 'room': 'hall', 'wet': 0.18},
    'cone_cold': {'pre': [('frost_wind_long', 0, 1), ('ice', 0.25, 1), ('ice', 0.5, 0.7)], 'room': 'hall', 'wet': 0.2},
    'cone_swarm': {'pre': [('swarm', 0, 1), ('rustle', 0.1, 0.4)]},
    'line_lightning': {'pre': [('charge', 0, 0.5), ('zap_long', 0.15, 1), ('thunder', 0.18, 1)], 'room': 'hall', 'wet': 0.22},
    'emanation_detect': {'pre': [('pulse', 0, 0.9), ('pulse', 0.5, 0.6), ('pulse', 1.0, 0.4), ('shimmer_low', 0.1, 0.4)], 'room': 'hall', 'wet': 0.3, 'target': -18},
    'emanation_bless': {'pre': [('holy', 0, 1), ('bell', 0.2, 0.5)], 'room': 'hall', 'wet': 0.3, 'target': -17},
    'emanation_anthem': {'pre': [('fanfare', 0, 0.9), ('harp_up', 0.2, 0.5)], 'room': 'hall', 'wet': 0.25, 'target': -16.5},
    'emanation_fear': {'pre': [('roar_beast', 0, 1), ('brass_dark', 0.05, 0.6), ('trem', 0.1, 0.5)], 'room': 'hall', 'wet': 0.2},
    'area_thorns': {'pre': [('rustle_long', 0, 1), ('creak', 0.2, 0.7), ('crunch', 0.5, 0.4)]},
    'area_darkness': {'pre': [('inhale_long', 0, 0.8), ('drone_long', 0.2, 0.8), ('whisper', 0.6, 0.3)], 'room': 'hall', 'wet': 0.3, 'target': -18},
    # ---- healing and buffs ----
    'heal': {'pre': [('harp_up', 0, 0.9), ('sparkle', 0.2, 0.5)], 'room': 'hall', 'wet': 0.3, 'target': -17},
    'heal_song': {'pre': [('shimmer', 0, 0.7), ('holy', 0.1, 0.7), ('harp_up', 0.3, 0.6)], 'room': 'hall', 'wet': 0.3, 'target': -17},
    'heal_medicine': {'pre': [('cloth', 0, 0.8), ('rustle', 0.1, 0.5), ('clink', 0.4, 0.5), ('sparkle_low', 0.6, 0.4)], 'target': -18},
    'buff': {'pre': [('shimmer', 0, 0.8), ('sparkle', 0.1, 0.5)], 'room': 'hall', 'wet': 0.25, 'target': -17.5},
    'rage': {'pre': [('war_cry', 0, 1), ('drone_dark', 0, 0.4), ('thud_big', 0.05, 0.6)]},
    'shield_bubble': {'pre': [('charge', 0, 0.5), ('pulse', 0.15, 0.8), ('shimmer_low', 0.15, 0.5)], 'target': -17},
    'armor_shimmer': {'pre': [('shimmer_low', 0, 0.7), ('clink', 0.1, 0.4), ('creak', 0.1, 0.3)], 'target': -17.5},
    'sanctuary': {'pre': [('holy', 0, 0.8), ('bell', 0.05, 0.4)], 'room': 'hall', 'wet': 0.3, 'target': -17.5},
    'guidance': {'pre': [('sparkle', 0, 0.8), ('shimmer', 0.1, 0.4)], 'target': -18},
    'speed_lines': {'pre': [('whoosh_spin', 0, 0.6), ('shimmer', 0, 0.4)], 'target': -17},
    'invisibility': {'pre': [('shimmer_down', 0, 0.7), ('inhale', 0.2, 0.5)], 'room': 'hall', 'wet': 0.3, 'target': -17.5},
    'mirror_image': {'pre': [('shimmer', 0, 0.6), ('shimmer', 0.6, 0.5), ('shimmer', 1.2, 0.4)], 'room': 'hall', 'wet': 0.3, 'target': -18},
    'panache': {'pre': [('swing_double', 0, 0.6), ('fanfare', 0.1, 0.7), ('sparkle', 0.2, 0.5)], 'target': -16.5},
    # ---- conditions and social ----
    'condition_pulse': {'pre': [('pulse_low', 0, 0.7), ('shimmer_low', 0.05, 0.3)], 'target': -19},
    'demoralize': {'pre': [('shout', 0, 0.9), ('snarl', 0.05, 0.4)], 'hit': [('brass_dark', I, 0.6), ('trem', I, 0.5)], 'miss': [('pop', I, 0.3)]},
    'charm': {'pre': [('harp_up', 0, 0.6), ('wobble', 0.1, 0.4), ('sparkle', 0.2, 0.5)], 'room': 'hall', 'wet': 0.3, 'target': -17.5},
    'command': {'pre': [('wobble', 0, 0.6), ('whisper', 0, 0.5), ('pulse_low', 0.25, 0.6)], 'target': -17.5},
    'curse': {'pre': [('unholy', 0, 0.9), ('whisper', 0.1, 0.5), ('void_pop', 0.3, 0.6)], 'room': 'hall', 'wet': 0.25},
    'dirty_trick': {'pre': [('swing_fast', 0, 0.6), ('rubble', 0.15, 0.4), ('grunt', 0.3, 0.4)]},
    'escape': {'pre': [('stretch', 0, 0.8), ('grunt', 0.2, 0.6)], 'hit': [('pop', I, 0.6), ('whoosh_low', I, 0.5)], 'miss': [('creak', I, 0.6)]},
    'blinding_flash': {'pre': [('boom_small', 0, 0.5), ('shimmer', 0, 0.7), ('sparkle_big', 0, 0.6)], 'target': -16.5},
    'faerie_fire': {'pre': [('shimmer', 0, 0.6), ('sparkle_low', 0.1, 0.5)], 'room': 'hall', 'wet': 0.3, 'target': -18},
    'alarm': {'pre': [('alarm', 0, 1)], 'room': 'hall', 'wet': 0.25, 'target': -17},
    'prestidigitation': {'pre': [('pop', 0, 0.6), ('sparkle', 0.05, 0.6)], 'target': -19},
    'summon': {'pre': [('sigil', 0, 1), ('boom_small', 1.0, 0.5)], 'room': 'hall', 'wet': 0.3},
    'gibbering': {'pre': [('babble', 0, 1), ('wobble_long', 0.2, 0.4)], 'room': 'hall', 'wet': 0.2},
    # ---- creature attacks ----
    'claw_rake': {'pre': [('snarl', 0, 0.6), ('swing_fast', 'i-0.18', 0.8)], 'hit': [('cut', I, 1), ('cut', 'i+0.15', 0.9), ('cut', 'i+0.3', 0.8), ('squelch', 'i+0.05', 0.8)], 'crit': [('squelch_big', 'i+0.3', 0.9)], 'miss': [('whiff', I, 0.8), ('whiff', 'i+0.2', 0.6)]},
    'bite': {'pre': [('snarl', 'i-0.25', 0.8)], 'hit': [('bone_crack', I, 0.8), ('squelch', I, 1)], 'crit': [('squelch_big', 'i+0.05', 1), ('growl', 'i+0.05', 0.6)], 'miss': [('click', I, 0.8), ('snarl', 'i+0.05', 0.4)]},
    'bite_venom': {'pre': [('hiss', 'i-0.3', 0.7)], 'hit': [('squelch', I, 1), ('sizzle', 'i+0.1', 0.6)], 'crit': [('bubble_down', 'i+0.15', 0.6)], 'miss': [('click', I, 0.8), ('hiss', 'i+0.05', 0.4)]},
    'tentacle_lash': {'pre': [('swing_long', 'i-0.32', 0.9), ('squelch', 0, 0.4)], 'hit': [('splat', I, 0.9), ('thud', I, 1)], 'crit': [('thud_big', I, 0.8), ('squelch_big', I, 0.8)], 'miss': [('splat', 'i+0.08', 0.4)]},
    'fist_slam': {'pre': [('swing_heavy', 'i-0.3', 1)], 'hit': [('thud_big', I, 1), ('crunch', I, 0.8), ('boom_small', I, 0.6)], 'crit': [('boom', I, 0.8), ('rubble', 'i+0.05', 0.7)], 'miss': [('thud_big', 'i+0.05', 0.6), ('rubble', 'i+0.06', 0.5)]},
    'grab_engulf': {'pre': [('swing', 'i-0.2', 0.6)], 'hit': [('squelch_big', I, 0.9), ('stretch', 'i+0.1', 0.8)], 'crit': [('bone_crack', 'i+0.3', 0.7)], 'miss': [('whiff', I, 0.7)]},
    'poison_sting': {'pre': [('swing_fast', 'i-0.15', 0.8), ('hiss', 'i-0.2', 0.3)], 'hit': [('stab_flesh', I, 1), ('bubble_down', 'i+0.1', 0.5)], 'crit': [('sizzle', 'i+0.1', 0.6)], 'miss': [('thunk', 'i+0.04', 0.5)]},
    'ghost_touch': {'pre': [('wail', 0, 0.4), ('frost_wind', 0, 0.5)], 'hit': [('ice', I, 0.6), ('void_pop', I, 0.6)], 'crit': [('wail', I, 0.5)], 'miss': [('whisper', I, 0.3)], 'room': 'hall', 'wet': 0.25},
    'paralyze_touch': {'pre': [('snarl', 0, 0.5), ('swing_fast', 'i-0.15', 0.7)], 'hit': [('cut', I, 0.9), ('squelch', I, 0.6), ('trem', 'i+0.05', 0.4)], 'crit': [('ice', 'i+0.05', 0.5)], 'miss': [('whiff', I, 0.8)]},
    'mental_blast': {'pre': [('wobble', 0, 0.7)], 'hit': [('boom_small', I, 0.6), ('wobble_long', I, 0.5), ('glk', I, 0.4)], 'crit': [('trem', I, 0.6)], 'miss': [('shimmer_down', I, 0.4)]},
    'possession': {'pre': [('whisper', 0, 0.6), ('wail', 0.1, 0.4)], 'hit': [('inhale', 'i-0.4', 0.6), ('void_pop', I, 0.7), ('wobble', I, 0.5)], 'crit': [('whisper_long', I, 0.5)], 'miss': [('wail', I, 0.3)], 'room': 'hall', 'wet': 0.25},
    'pounce': {'pre': [('growl', 0, 0.7), ('whoosh_low', 'i-0.25', 0.8)], 'hit': [('thud_big', I, 1), ('cut', I, 0.8), ('body_fall', 'i+0.05', 0.6)], 'crit': [('squelch_big', I, 0.9)], 'miss': [('footsteps_run', 'i-0.05', 0.6), ('thud', 'i+0.08', 0.4)]},
    'chain_lash': {'pre': [('chains_short', 0, 0.8), ('swing_long', 'i-0.32', 0.8)], 'hit': [('chains', I, 0.9), ('thud', I, 1)], 'crit': [('clang', I, 0.6), ('thud_big', I, 0.8)], 'miss': [('chains', 'i+0.05', 0.6)]},
    'hellfire': {'pre': [('drone_dark', 0, 0.5)], 'hit': [('flame_long', 'i-0.1', 1), ('roar_fire', I, 1), ('boom', I, 0.7)], 'crit': [('unholy', I, 0.6)], 'miss': [('flame', I, 0.6)], 'room': 'hall', 'wet': 0.2},
    'tendril_lance': {'pre': [('swing_fast', 'i-0.15', 0.6), ('squelch', 0, 0.3)], 'hit': [('stab_flesh', I, 1), ('squelch_big', 'i+0.05', 0.8)], 'crit': [('bone_crack', I, 0.6)], 'miss': [('thunk', 'i+0.04', 0.5)]},
    'hand_grasp': {'pre': [('rustle', 0, 0.6), ('rubble', 0.1, 0.4), ('whisper', 0, 0.3)], 'hit': [('squelch', I, 0.8), ('stretch', I, 0.5)], 'crit': [('bone_crack', 'i+0.1', 0.6)], 'miss': [('rubble', I, 0.4)]},
    'wisp_shock': {'pre': [('shimmer', 0, 0.4), ('whiz_short', 'i-0.2', 0.4)], 'hit': [('zap', I, 0.9)], 'crit': [('zap_long', I, 0.8)], 'miss': [('pop', I, 0.4)]},
    'ghost_wail': {'pre': [('wail_long', 0, 1), ('frost_wind_long', 0.2, 0.4), ('trem', 0.3, 0.4)], 'room': 'hall', 'wet': 0.3},
    # ---- movement ----
    'dash': {'pre': [('footsteps_run', 0, 0.8), ('whoosh_low', 0.05, 0.7)], 'target': -17},
    'tumble': {'pre': [('cloth', 0, 0.8), ('whoosh_spin', 0.1, 0.6), ('footsteps', 0.7, 0.6)], 'target': -17.5},
    'teleport_blink': {'pre': [('inhale', 0, 0.6), ('pop', 0.3, 0.8), ('sparkle', 0.3, 0.5)], 'target': -17},
    # ---- table cues (not visual effects) ----
    'cue_dice': {'pre': [('dice_shake', 0, 0.7), ('dice', 0.3, 1)], 'target': -19, 'wet': 0.08},
    'cue_dice_crit': {'pre': [('dice', 0, 1), ('fanfare', 0.5, 0.7), ('sparkle', 0.6, 0.5)], 'target': -17},
    'cue_dice_fumble': {'pre': [('dice', 0, 1), ('brass_dark', 0.55, 0.5), ('bubble_down', 0.6, 0.4)], 'target': -18},
    'cue_turn_pc': {'pre': [('chime', 0, 0.8)], 'target': -20, 'room': 'hall', 'wet': 0.2},
    'cue_turn_foe': {'pre': [('pulse_low', 0, 0.7), ('drone_dark', 0, 0.3)], 'target': -21},
    'cue_round': {'pre': [('tolling', 0, 0.8)], 'target': -21, 'room': 'hall', 'wet': 0.2},
    'cue_encounter_start': {'pre': [('brass_dark', 0, 0.9), ('timp_low', 0, 1), ('trem', 0.1, 0.5)], 'target': -16, 'room': 'hall', 'wet': 0.2},
    'cue_encounter_end': {'pre': [('harp_down', 0, 0.6), ('shimmer_low', 0.2, 0.4)], 'target': -19, 'room': 'hall', 'wet': 0.25},
    'cue_pc_down': {'pre': [('body_fall', 0, 1), ('brass_dark', 0.2, 0.6), ('tolling', 0.3, 0.6)], 'target': -16, 'room': 'hall', 'wet': 0.2},
    'cue_foe_death': {'pre': [('body_fall', 0, 1), ('metal_drop', 0.18, 0.6)], 'target': -17},
    'cue_crit': {'pre': [('brass', 0, 0.7), ('boom_small', 0, 0.5)], 'target': -17},
    'cue_door_open': {'pre': [('door_open', 0, 1)], 'target': -18},
    'cue_door_close': {'pre': [('door_close', 0, 1)], 'target': -18},
    'cue_door_locked': {'pre': [('latch', 0, 1), ('latch', 0.18, 0.7)], 'target': -19},
    'cue_coins': {'pre': [('coins', 0, 1)], 'target': -19},
    'cue_item': {'pre': [('cloth', 0, 0.6), ('clink', 0.08, 0.5)], 'target': -20},
    'cue_page': {'pre': [('page', 0, 1)], 'target': -21},
    'cue_click': {'pre': [('click_soft', 0, 1)], 'target': -24, 'wet': 0.02},
    'cue_open': {'pre': [('pop', 0, 0.6), ('click_soft', 0, 0.5)], 'target': -23, 'wet': 0.03},
    'cue_close': {'pre': [('click_soft', 0, 0.6)], 'target': -24, 'wet': 0.02},
    'cue_notify': {'pre': [('bell', 0, 0.7)], 'target': -21, 'wet': 0.15},
    'cue_level_up': {'pre': [('fanfare', 0, 1), ('harp_up', 0.3, 0.7), ('sparkle_big', 0.4, 0.6)], 'target': -16, 'room': 'hall', 'wet': 0.25},
    'cue_rest': {'pre': [('harp_up', 0, 0.6), ('wind', 0, 0.3)], 'target': -19, 'room': 'hall', 'wet': 0.3},
    'cue_discovery': {'pre': [('harp_up', 0, 0.7), ('glk', 0.3, 0.6)], 'target': -18, 'room': 'hall', 'wet': 0.3},
}
ATTACK_SPECS = {k for k, v in SPECS.items() if 'hit' in v or 'miss' in v}


def recipe(name):
    spec = SPECS[name]
    return lambda rng, r, imp=0.3: build(spec, rng, r, imp)
