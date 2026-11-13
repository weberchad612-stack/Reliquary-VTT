#!/usr/bin/env python3
"""Render the board's sound set: effect sounds, ambient loops and music, as mp3 files with a manifest the board reads
(sounds.json). Needs numpy, scipy, soundfile, ffmpeg, and the VSCO 2 CE samples (samples.py).

  python3 tools/sound/render.py audition [--out DIR]   a few of each, to listen to before rendering everything
  python3 tools/sound/render.py all [--out DIR]        every recipe, variants and the music set
  python3 tools/sound/render.py fx NAME...|ALL | ambient NAME...|ALL | music MOOD|ALL [N [SECONDS]] | stings

Before fx, write the effects' impacts: node -e "import('./rulesets/pf2e/effects.js').then(m=>console.log(JSON.stringify(
Object.fromEntries(Object.entries(m.PF2E_EFFECTS.effects).map(([k,v])=>[k,{impact:v.impact||0,attack:!!v.attack}])))))" > /tmp/effects.json

Files: fx/<effect>-<hit|crit|miss>-<n>.mp3 (attacks) or fx/<effect>-<n>.mp3, cue/<cue>-<n>.mp3, ambient/<name>.mp3,
music/<mood>-<n>.mp3 and music/sting-<kind>-<n>.mp3; sounds.json lists them with
durations. Deterministic: the same seed gives the same file. Docs: docs/best-practices/sound.md."""
import sys, os, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dsp import write, SR, loudness
import sfx, fx, ambient, music
from dsp import secs

VARIANTS = 3
EFFECTS_JSON = os.environ.get('EFFECTS_JSON', '/tmp/effects.json')   # {id: {impact (ms), attack}} from rulesets/<system>/effects.js
HAND_IMPACT = {'strike_slash': 0.17, 'ranged_arrow': 0.34, 'force_bolt': 0.46}   # where sfx.py's hand-made recipes land


def effects():
    try: return json.load(open(EFFECTS_JSON))
    except OSError: return {}


def names():
    return list(sfx.RECIPES) + [k for k in fx.SPECS if k not in sfx.RECIPES]


SPRITE_GAP = 0.3   # seconds of silence after each variant in a sprite


def fx_one(out, name, variants=VARIANTS, man=None, eff=None):
    """One effect or cue as a sprite: every result's variants in one file, one after another with silence between
    (an artifact holds at most 512 files). The manifest gives each variant's start and length in the file."""
    eff = eff if eff is not None else effects()
    imp = (eff.get(name, {}).get('impact') or 0) / 1000
    attack = name in sfx.ATTACKS or name in fx.ATTACK_SPECS
    res = ['hit', 'crit', 'miss'] if attack else ['hit']
    kind = 'cue' if name.startswith('cue_') else 'fx'
    path = f'{kind}/{name}.mp3'
    parts, entry, t = [], {}, 0.0
    gap = np.zeros((secs(SPRITE_GAP), 2), np.float32)
    for r in res:
        files = []
        for v in range(variants):
            rng = np.random.default_rng(sum(map(ord, name)) * 1000 + ['hit', 'crit', 'miss'].index(r) * 10 + v)
            if name in sfx.RECIPES:
                x = sfx.RECIPES[name](rng, r)
                if attack and imp:   # line the hand-made impact up with the visual's
                    d = secs(imp - HAND_IMPACT.get(name, imp))
                    x = np.concatenate([np.zeros((d, 2), np.float32), x]) if d > 0 else x[-d:]
            else:
                x = fx.recipe(name)(rng, r, imp or 0.3)
            if x.ndim == 1: x = np.stack([x, x], 1)
            files.append({'file': path, 'start': round(t, 4), 'secs': round(len(x) / SR, 3)})
            parts += [x.astype(np.float32), gap]; t += (len(x) + len(gap)) / SR
        entry[r] = files
    write(os.path.join(out, path), np.concatenate(parts), kbps=112, mono=True)
    if man is not None:
        rec = {'impact': round(imp, 3) if attack else 0, **entry}
        (man.setdefault('cues', {}) if name.startswith('cue_') else man['fx'])[name] = rec
    return entry


def ambient_one(out, name, seconds=30, man=None):
    x = ambient.RECIPES[name](np.random.default_rng(sum(map(ord, name))), seconds)
    path = f'ambient/{name}.mp3'; write(os.path.join(out, path), x, kbps=128)
    if man is not None: man['ambient'][name] = {'file': path, 'secs': round(len(x) / SR, 2), 'loop': True}


# Titles for the board's now-playing line: evocative and generic, never an adventure's names.
TITLES = {
    'explore': ['Dust and Candlelight', 'Pale Light on Old Stone', 'The Long Stair Down', 'Forgotten Gardens', 'Whispers in the Stacks', 'Where the Lamplight Fades',
                'Echoes Below', 'Over the Next Ridge', 'Moss on the Milestones', 'A Map Half Burned', 'The Quiet Road', 'Starlit Ferns'],
    'combat': ['Iron Vow', 'Ashes of the Vanguard', 'Blades in the Dark', 'Lanterns Against the Void', 'March of the Fallen Crown', 'Thunder Under the Hill',
               'Crimson Descent', 'Oath of the Last Torch', 'Steel Rain', 'Hold the Line', 'The Breaking Shield', 'Hooves on the Bridge'],
    'boss': ['The Abomination Wakes', 'Throne of Hollow Bone', 'Requiem for the Living', 'Cathedral of Ruin', 'Lord of the Black Vault', 'The Last Bell', 'Titan in the Deep', 'Crown of Cinders'],
    'town': ['The Crooked Tankard', 'Market Morning', 'Banners in the Square', 'A Toast to the Road', 'Cobbles and Coin', 'The Guildhall Steps', 'Lanterns at Dusk', 'Fiddler at the Well'],
    'tension': ['Something Follows', 'Hold Your Breath', 'The Watcher in the Rafters', 'Footprints in the Ash', 'Too Quiet', 'The Hunt Begins', 'Behind the Door'],
    'rest': ['Embers and Old Songs', 'Under a Thousand Stars', 'Bedroll and Birdsong', 'The Kettle Sings', 'Night Watch', 'Warm Hearth, Long Road'],
}
MUSIC = {'explore': (100, 10), 'combat': (200, 10), 'boss': (300, 8), 'town': (400, 8), 'tension': (500, 7), 'rest': (600, 6)}
TARGET = {'explore': -18.0, 'combat': -16.5, 'boss': -16.0, 'town': -17.5, 'tension': -19.5, 'rest': -19.5}
STINGS = {'victory': 3, 'defeat': 2, 'discovery': 3, 'danger': 3, 'rested': 2}


def music_one(out, mood, n, seconds=120, man=None):
    seed = MUSIC[mood][0] + n
    S, info = music.compose(mood, seed, seconds); x = music.render(S, mood, seed, TARGET[mood])
    path = f'music/{mood}-{n}.mp3'; write(os.path.join(out, path), x, kbps=160)
    if man is not None:
        lst = [e for e in man['music'].setdefault(mood, []) if e['file'] != path]
        lst.append({'file': path, 'title': TITLES[mood][(n - 1) % len(TITLES[mood])], 'secs': round(len(x) / SR, 2), **{k: (int(v) if isinstance(v, (np.integer,)) else v) for k, v in info.items()}})
        man['music'][mood] = sorted(lst, key=lambda e: int(e['file'].rsplit('-', 1)[1].split('.')[0]))


def sting_one(out, kind, n, man=None):
    seed = 900 + n * 7 + sum(map(ord, kind))
    S = music.sting(kind, seed); x = music.render(S, 'sting', seed, -16.5)
    path = f'music/sting-{kind}-{n}.mp3'; write(os.path.join(out, path), x, kbps=160)
    if man is not None: man.setdefault('stings', {}).setdefault(kind, []).append({'file': path, 'secs': round(len(x) / SR, 2)})


def main(argv):
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'sounds')   # the repository's sounds/ (Git LFS)
    if '--out' in argv: i = argv.index('--out'); out = argv[i + 1]; del argv[i:i + 2]
    cmd = argv[1] if len(argv) > 1 else 'audition'
    manf = os.path.join(out, 'sounds.json')
    man = json.load(open(manf)) if os.path.exists(manf) else {'fx': {}, 'ambient': {}, 'music': {}}
    if cmd == 'audition':
        for name in ['strike_slash', 'ranged_arrow', 'burst_fire', 'force_bolt', 'shield_block', 'burst_vitality', 'creature_down']: fx_one(out, name, 1, man)
        for name in ['campfire', 'cave']: ambient_one(out, name, 30, man)
        man['music'] = {}
        for mood, secs_ in (('explore', 90), ('combat', 75), ('boss', 75)): music_one(out, mood, 1, secs_, man)
    elif cmd == 'fx': [fx_one(out, n, VARIANTS, man) for n in (names() if argv[2:] == ['ALL'] else argv[2:])]
    elif cmd == 'stings':
        man['stings'] = {}
        for k, c in STINGS.items():
            for i in range(1, c + 1): sting_one(out, k, i, man)
    elif cmd == 'ambient': [ambient_one(out, n, 30, man) for n in (list(ambient.RECIPES) if argv[2:] == ['ALL'] else argv[2:])]
    elif cmd == 'music':
        moods = list(MUSIC) if argv[2] == 'ALL' else [argv[2]]
        for mood in moods:
            for i in ([int(argv[3])] if len(argv) > 3 else range(1, MUSIC[mood][1] + 1)):
                music_one(out, mood, i, float(argv[4]) if len(argv) > 4 else 120, man)
                os.makedirs(out, exist_ok=True); json.dump(man, open(manf, 'w'), indent=1)   # progress survives a stop
    elif cmd == 'all':
        for n in names(): fx_one(out, n, VARIANTS, man)
        for n in ambient.RECIPES: ambient_one(out, n, 30, man)
        man['music'] = {}; man['stings'] = {}
        for mood, (base, k) in MUSIC.items():
            for i in range(1, k + 1): music_one(out, mood, i, 120, man)
        for k, c in STINGS.items():
            for i in range(1, c + 1): sting_one(out, k, i, man)
    else: print(__doc__); return 2
    os.makedirs(out, exist_ok=True); json.dump(man, open(manf, 'w'), indent=1)
    print(f'wrote {manf}')
    return 0


if __name__ == '__main__': sys.exit(main(sys.argv))
