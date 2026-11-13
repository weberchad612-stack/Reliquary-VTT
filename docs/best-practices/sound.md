# Sound

The board's sound has two halves. The **sound set** is rendered offline: effects, table cues, ambient loops, music
and stings, made by the generator in `tools/sound/`. The **sound engine** plays them: `engine/sound/sound.js`,
`board/sound.js`, `board/soundui.js` and the sound block in `board/app.js`. Claude's tool is `tools/sound.mjs`.
Built 2026-11-13 (FR-23, FR-27). Design: [docs/design/board.md](../design/board.md) (Sound).

## 1. What plays, and when

| Sound | When | Channel | Heard by |
|---|---|---|---|
| A visual effect's sound | With every visual effect a screen plays (`fx/` records, replays, the GM's preview). It has hit, crit and miss versions, and a miss makes no impact sound. | Effects | Every screen that shows the effect. It is muffled when every listener is behind a wall that stops sound. |
| Table cues | Dice (chat roll, check and damage cards; Dice tab rolls), with a flourish on a natural 20 and a sour note on a natural 1. A PC's turn (chime), a foe's turn (low pulse), a new round (bell), an encounter starting and ending, a PC going down, a foe dying (not when a `creature_down` effect already played), doors opening, closing or locked. | Effects | Each screen. GM-only cards and rolls are heard only in the GM view. A door the party neither sees nor hears stays quiet for players. |
| Music | Always, by mood. | Music | Every screen plays the same piece at the same moment. |
| Ambient sounds | Loops Claude places on a map. Each has a radius, falloff, walls, and day, night or always. | Ambience | Each screen, from its listener. |
| The soundboard | The GM's buttons and Claude's `sound.mjs cue`: stings (victory, defeat, discovery, danger, rested) and some cues. | Music (stings), Effects | Every screen (`sfx/` play records, played once each like visual effects). |

**The listener** (the user's rules, 2026-11-13):
- If one token is selected, the screen hears from it. This works in both views. In the player view the token must be one they can see.
- Otherwise the player view hears through the party's living PCs (the loudest way wins).
- Otherwise the GM view hears from the middle of the screen, with no walls.
- Walls whose `sound` sense stops sound (`engine/walls/presets.js`) muffle what is behind them: the gain is multiplied by `MUFFLE.gain` and a low-pass at `MUFFLE.lowpass` is applied.
- Open doors let sound through.

**The mood** (`chooseMood`), in order:
1. A mood the GM or Claude set (or silence) overrides everything.
2. A running encounter plays `boss` when a boss is in it, otherwise `combat`.
   - The boss check is the system's `system.sound.isBoss`. PF2E: a unique creature, or one 2+ levels above the party's average level; dead foes don't count.
   - The GM's or Claude's boss switch (on, off, automatic) overrides the check.
3. Out of combat, the map's theme (town, tension or rest) applies.
4. Otherwise the mood is `explore`.

A system without sound rules never switches to boss music by itself.

**Music in step on every screen.**
- `state/music` holds the run: `since` (when it began) and `seed` (its shuffle bag).
- Every screen works out the same piece and offset from it (`musicAt`). Pieces overlap by `CROSSFADE` seconds, each mood is a shuffle bag (`bagIndex`: every piece once, never the same twice in a row), and a late joiner starts mid-piece.
- A new mood starts a new run. The GM view writes it when it sees the mood change, and Claude's tool writes it with any change.
- Next starts a new run now.
- With no GM screen open, each player screen keeps its own run until a record comes.

## 2. The Sound tab

**For everyone:**
- A note until the first click. Browsers only start audio after a click or key, and the board unlocks on the first one.
- Now playing: the piece's title, the mood and why.
- This screen's mixer: Master, Music, Ambience, Effects and Interface, each channel with its own mute (🔊/🔇: the slider keeps its level for when it comes back), and Mute all. These are kept per browser (`reliquary.sound`: volumes, muted, mutedChannels). Music muted on one screen keeps its place in the shared run, so unmuting rejoins the piece in step.
- The ambient sounds on this map, and who the screen hears from.

**For the GM:**
- Mood buttons: Automatic, the six moods (in italics when the set has no music for one), Silence.
- The boss switch while an encounter runs.
- This map's music out of combat.
- ⏸ Pause music and ▶ Resume music: the music stops on every screen and later carries on in the same piece, at the same place (`paused: {at}`; resuming moves the run's `since` on by the pause). A mood change while paused stays paused.
- ⏭ Next piece.
- The soundboard.
- A mute and a remove per ambient source.
- Changes go to the audit log.

## 3. Claude's tool

```
node tools/sound.mjs <pack> <save> [--records FILE] status
node tools/sound.mjs ... mood <auto|explore|combat|boss|town|tension|rest|silence>
node tools/sound.mjs ... boss <auto|on|off>          # a set piece the rule misses, or a big foe that isn't one
node tools/sound.mjs ... next
node tools/sound.mjs ... pause | resume
node tools/sound.mjs ... theme <map|here> <town|tension|rest|none>
node tools/sound.mjs ... cue <victory|defeat|discovery|danger|rested|dice|door_open|coins|level_up|round|...> [--gm]
node tools/sound.mjs ... sounds [fx|cues|ambient|music|stings]
node tools/sound.mjs ... ambient add <loop> <x> <y> [--radius FT] [--inner FT] [--when always|day|night] [--volume 0..1] [--label "..."] [--map M] [--gm-only]
node tools/sound.mjs ... ambient list | set <id> [...] [--on|--off] | remove <id>
```

- Changing commands print `{lines, writes}`; db_write each.
- Names are checked against the sound set (`--sounds DIR`, default the repository's `sounds/`).
- When preparing an area, Claude places its ambient sounds (GM guide, Preparing an area):
  - fires and braziers on their squares with a 15–25 ft radius;
  - a river or a waterfall along its course (several sources for a long one);
  - the room tone of a crypt or a cave at its middle with a large radius;
  - a tavern's crowd in the taproom.
- Night-only sources (crickets, owls, wolves) use `--when night`. The hour comes from the game clock.

**The ambient loops (38):**
- Fire and light: campfire, brazier, torch, forge.
- Water: river, stream, waterfall, sea, ship, sewer.
- Weather: wind, howling wind, rain, light rain, storm, blizzard, desert.
- Nature: forest by day, forest at night, wolves, meadow, swamp.
- Underground and indoors: cave, dungeon, crypt, mine, lava, temple, ritual, library, arcane hum, room tone.
- People and places: tavern, town, market, graveyard, haunted, battlefield.

**Cues:**
- Dice, dice crit, dice fumble.
- Turns and rounds: PC turn, foe turn, round.
- Encounters: encounter start, encounter end, PC down, foe death, crit.
- Doors: door open, door close, door locked.
- Items: coins, item, page.
- Interface: click, open, close, notify.
- Milestones: level up, rest, discovery.

## 4. The sound set (rendering)

The generator is Python in `tools/sound/`:
- `dsp.py`: filters, noise, FM, Karplus–Strong, modal bells, reverb and mastering.
- `samples.py`: the recorded instruments.
- `music.py`: the composer and its styles.
- `sfx.py`, `voices.py` and `fx.py`: the effect recipes and layer specs.
- `ambient.py`: the loops.
- `render.py`: the command line.

It needs numpy, scipy, soundfile (pip `--break-system-packages`) and ffmpeg. The instruments are the **Versilian
Community Sample Library (VSCO 2 CE, CC0)**, cloned outside the repo (sparse checkout; env `VSCO`, default
`/home/claude/audio/vsco`).

```
node -e "import('./rulesets/pf2e/effects.js').then(m=>console.log(JSON.stringify(Object.fromEntries(Object.entries(m.PF2E_EFFECTS.effects).map(([k,v])=>[k,{impact:v.impact||0,attack:!!v.attack}])))))" > /tmp/effects.json
python3 tools/sound/render.py fx ALL                     # 97 effects + 24 cues, 3 variants (hit/crit/miss for attacks): ~2 min
python3 tools/sound/render.py ambient ALL                # 38 loops of 30-40 s: ~2 min
python3 tools/sound/render.py stings                     # 13 stings
python3 tools/sound/render.py music ALL                  # 49 pieces of ~2 min in 6 moods and 24 styles: ~15 min (background it)
python3 tools/sound/render.py audition                   # a few of each, to listen to first
```

- Output goes to the repository's `sounds/` (`--out DIR` for elsewhere), with `sounds.json` as the manifest the board reads.
- Everything is deterministic per seed.
- File naming:
  - `fx/<effect>.mp3` and `cue/<cue>.mp3`: **sprites**. Each holds all the effect's sounds (hit, crit and miss, 3 variants each) one after another with 0.3 s of silence between, and the manifest gives each sound's `start` and `secs`. An artifact holds at most 512 files, so one file per variant (751 in all) didn't fit. The board plays a sound from its start for its length plus 80 ms, in case the decoder keeps the mp3 encoder's delay, which costs at most about 35 ms on the impact;
  - `ambient/<loop>.mp3`;
  - `music/<mood>-<n>.mp3` and `music/sting-<kind>-<n>.mp3`.
- Bit rates: effects mono 112 kbps, ambient 128, music 160.
- The whole set is about 150 MB in 222 files.
- **The sound set is kept in the repository with Git LFS** (the user, 2026-11-13). `.gitattributes` tracks `sounds/**/*.mp3`, while `sounds.json` stays plain git. The samples are not committed: the generator points at its own copy.
  - **GitHub's free LFS allowance is 10 GiB of storage and 10 GiB of downloads a month** for the account. Every LFS download counts against it, including clones by Claude's sessions.
  - **Claude's clones skip the audio:** clone with `GIT_LFS_SKIP_SMUDGE=1`, then `git lfs pull --include "sounds/fx/strike_slash.mp3"` for only the files a change needs, or `git lfs pull` for the whole set when publishing it.
  - **Re-render only what changed.** Every new version of a file is kept in LFS: one tweaked effect adds about 150 KB, a music piece about 2.3 MB, everything about 150 MB.
  - Before committing, check that `git lfs status` lists the mp3s as LFS objects, not plain git.

**Effects line up with their visuals.**
- An attack's sound lands its impact at the visual effect's own `impact` (ms, from the effects library).
- The file and the effect start together, and the board delays each target by the effect's stagger.
- The hand-made recipes in `sfx.py` are shifted to match. The manifest records `impact`.

**Music styles:** each mood has 3–5 styles, so a shuffle bag changes in sound, not only in notes.

| Mood | Styles |
|---|---|
| explore | wilds, delve (organ), road, mystic (3/4), highland |
| combat | charge, skirmish (3/4), clash, savage (log drums), gallop |
| boss | doom, cathedral (organ and bells), frenzy, colossus |
| town | tavern (waltz), market, hall, square |
| tension | stealth, dread, hunt |
| rest | camp, hearth (waltz), stars |

Titles are generic, never an adventure's names.

**A new visual effect needs a sound.**
1. Add a spec to `fx.py` `SPECS`, built from layers in `L`: each layer has a name, a start (seconds, or `'i+0.02'` from the impact) and a gain, filed under `pre`, `hit`, `crit` or `miss`.
2. Render it with `render.py fx <name>`.
3. Listen to it.
4. Republish the new files (section 5).

`tests/sound.test.mjs` doesn't check the set's coverage. To check it, compare `SPECS` against the effects library (as in section 6).

## 5. Publishing the sound files

- The files are part of the board artifact. They are served next to its page at `sounds/...` and fetched by the board (`MANIFEST = 'sounds/sounds.json'`).
- Publish them with `publish_files` from the repository's `sounds/` (pull them from LFS first), `as: sounds/<path>`, in patch mode, so the page and the other files stay. Watch the limits: 256 files, 20 MiB a file and 64 MiB per call, so the set goes up in about four calls. The board's allowance is 1 GB, and **an artifact holds at most 512 files** (the page included).
- A page republish (the board's `index.html` alone, patch mode) keeps the sound files.
- Re-render, then republish only what changed.
- A board opened from disk (tests, previews) fetches nothing and stays quiet.
- Publish only when the user says "publish" (the standing rule).

## 6. Checks

- `npm test`: `tests/sound.test.mjs` covers the bag, the timeline, the mood, hearing, files, records, the boss rule, listeners, the ambient mix, the tab's HTML, the tool, the save and the system-free code.
- `tools/headless/smoke.mjs --only sound`: the tab (mood, soundboard, ambient mute, the player view without the GM controls).
- `NODE_PATH=$(npm root -g) node tools/headless/soundcheck.mjs` (the repository's `sounds/`, or `--sounds DIR`): the real files over http in headless Chrome, launched with `--autoplay-policy=no-user-gesture-required` plus a click. It checks:
  - the manifest loads;
  - music plays and the record follows;
  - a strike's crit sound plays;
  - a sting plays on the soundboard;
  - an ambient source is heard near and not far;
  - a source behind a wall is muffled;
  - the mood follows an encounter;
  - silence stops the music.
- Coverage: every effect in `rulesets/pf2e/effects.js` has a recipe (`fx.SPECS` plus `sfx.RECIPES`).

## 7. Lessons learned

- **I can't hear the output, so measure it.** For each file check the peak, a rough loudness (`dsp.loudness`), the loop seam (end against start), spectrograms for a recipe's shape, and that nothing clips. Then send short reels to the user to listen to.
- **Spiky sounds come out quiet** (sparks, crackles, clock ticks): a peak-limited gain leaves them far below the target. `sfx.finish` and `ambient.level` apply a fast compressor and a soft limiter instead, so the effects sit within about 6 dB of each other.
- **VSCO names middle C "C3"** (MIDI = 12·(octave+2) + note).
- **The piano's files are numbered** (`MappingChart.txt`: 000 = A0, every other key). The organ's are offset from MIDI: manual n−86, pedal n−28, measured by pitch detection. `samples.py` has `piano_midi` and `organ_midi`.
- **Slice before resampling** when pitch-shifting long sustains (`Bank.note`), or rendering crawls.
- **Loops are made seamless** by crossfading their last 2.5 s into their first (equal power), then cutting the tail. A loop whose length is a whole number of seconds keeps a 1 s clock tick in step.
- **Music is streamed on media elements**, not decoded whole: two minutes of decoded audio is about 46 MB. Ambient loops are decoded buffers, because media elements leave a gap when they loop. Each loop starts at a random point.
- **Don't load a far-away loop:** it starts only once it can be heard.
- **The board adds six watchers** (music, encounter, ambient, sfx, chat, dice): 24 in all against the platform's cap of about 40.
- **An artifact holds at most 512 files.** The first upload of one file per variant hit that cap (2026-11-13), so effects and cues became sprites.
- **A page opened from disk can't fetch** (CORS), and its console errors would fail the smoke checks, so the manifest is fetched only over http(s).
