# Where things stand

A one-page map of what is built, for a new conversation getting its bearings. Each line points at the guide that
says how to use or change it. Keep this page short and current: when a feature lands, changes or moves, update its
line here in the same commit. Last brought up to date: 2026-11-14 (hand-placed walls and sideways maps in the map importer; two-column books in the adventure importer; missing DCs from the party's level; the party's marching order).

## The pieces

| Area | What exists | Read |
|---|---|---|
| Engine (`engine/`) | Walls (thick walls, 1/32 snap), doors and veils, sight and fog, light (daylight, colour, intensity, animation), movement (paths, Stride ranges, waypoints), terrain, measurement and height, areas, tokens (Tiny layout, occupancy), visual effects, sound (mixer, listeners, music timeline), the rules machinery, adventure events (triggers, stages, branches, repeats) and subsystems (points, thresholds, revealed parts), dice, time (calendar, clock, durations, encounters). System-free. | [engine/README.md](../engine/README.md), the best-practices guides |
| Pathfinder 2e (`rulesets/pf2e/`) | Measurement, areas, conditions, terrain, light and senses, creatures' statistics, damage and healing, rule keys, turn rules (they report their dice), Golarion's calendar, Quick-View's stat block, traits, initiative, roll kinds, the title line's badge, loot (coins, Bulk, identifying, selling), exploration (activities, pace, combat-start requests), sound (what is a boss), subsystems (Victory Points, Influence, Chase, Infiltration, Research). | [game-data.md](best-practices/game-data.md) |
| Open content (`content/pf2e/`) | All of Foundry PF2E's open data (ORC and OGL), imported by `tools/import/foundry-pf2e.mjs`. | [content/pf2e/README.md](../content/pf2e/README.md) |
| Character builder (`rulesets/pf2e/build.js`, `tools/builder.mjs`) | Being built (2026-11-14; Claude and the player build a character together, step by step). Step 1: the build record and the character worked out from it (attributes, skills, proficiencies, feats, features). Step 2: the content's own rules run (choices, grants, proficiency upgrades, weapon group proficiencies, gains read from feature text); `builder.mjs report` lists what still cannot run (22 of 29 classes: nothing). Then ancestry features, languages, feat prerequisites, and every class checked through the engine. Step 3: the step-by-step tool (`tools/builder.mjs`: drafts in the campaign save, options with rarity, books, prerequisites and dedications, the deity, preview, finish). Step 4: casters (slots by the books' tables, repertoires, books and familiars, the tradition from the subclass, granted and focus spells, spell choices with their checks). Step 5: starting gear (15 gp at 1st level, GM Core's wealth table above) and finishing: into the party, in another PC's place, or the bullpen, with the player's picture as token art. Next: a level-1 character with the user for each kind of class, then levelling. | [design](design/game-data.md) section 9 |
| Map importer (`tools/mapimport/`) | Book maps to packs: grid, walls, doors, terrain, lighting, with every decision in `import.json`. Art-style profiles, straight thick walls on measured lines, room interiors erased, squaring and welding on the 1/32 snap, a step cache (a rebuild in seconds), one-room rebuilds and wall suggestions; hand-placed walls measured outline to outline (`wallscan.py`, for art whose shadow is as dark as its walls), maps printed sideways turned upright, 10-ft prints on 5-ft squares; `tools/mapcheck.mjs` checks sight per room, every door both ways, every room reached, and walking routes. Packs stay private. | [map-importer.md](best-practices/map-importer.md) |
| Adventure importer (`tools/advimport/`) | A whole adventure to a pack and a campaign: paraphrased notes, maps (with the map importer), start squares from the book's pawn markers, token art and portraits from the book, the cast with stat blocks, object tokens with their treasure. First import: the Beginner Box adventure (2026-11-13); second: the first book of an Adventure Path (2026-11-14), the first pack of a multi-book campaign, with town and region maps from a clean image and the text layer's labels, and books in two columns with capital area headings. Every adventure gets a landing page (its cover). One command runs an import (`run.mjs`, a pipeline per pack). The checks: an area checklist against the book, loot and hazards, links between levels, rooms against the book's crops, and a review sheet per map. A campaign can span several packs (an Adventure Path: one pack per book, each added with `--update`). A campaign updates from its pack without losing play, and the pack syncs to the PC without overwriting the user's edits. The checklist finds the book's events and checks each is written into the adventure (events and subsystems), and every adventure has its kickoff: the book's way of starting the story, as an event (mandatory). A check the book gives no DC for takes the level-based DC for the party's expected level there (`dcfill.mjs`). Room tables from the book's crops; stat blocks matched with the open content and the book's changes listed (`statmatch.mjs`). | [adventure-importer.md](best-practices/adventure-importer.md) |
| Claude's tools (`tools/`) | Campaign load, save and switch; tokens, templates, notes, effects, visual effects; creatures, checks, dice; the clock and encounters; chat messages, check and damage cards, audit lines; replays (`replay.mjs`: resolve a batch in a draft, narration steps) and the thinking banner (`think.mjs`); the campaign ledger (`ledger.mjs`) and the campaign's players (`players.mjs`); party loot (`loot.mjs`: find, add, identify, appraise, move, buy, sell, coins); exploration (`exploration.mjs`: activities, pace, travel, reminders); adventure events (`events.mjs`: due, tick, decisions, flags) and subsystems (`subsystem.mjs`: points from the rolls); battle maps for fights the book gives none (`genmap/`); sound (`sound.mjs`: mood, boss, cues, ambient sounds; the sound set's generator `tools/sound/`). | [tools/README.md](../tools/README.md) |
| The board (`board/`) | Reliquary Virtual Tabletop: one published page, player and GM views, its own database. Below. | [board.md](best-practices/board.md), [design](design/board.md) |
| GM guides (`docs/gm/`, `rulesets/pf2e/gm.md`) | How Claude runs a game: secrecy, narration, the ledger, dice, foes, exploration, combat, time, loot, quests, preparing an area, sessions, house rules, a pre-flight checklist; the PF2E guide adds the system's secret checks, reactions, conditions, healing and rulings. Reviewed rule by rule with the user (2026-11-13). | [running-a-game.md](gm/running-a-game.md) |
| Sound set (`sounds/`) | 97 effects, 24 cues, 38 ambient loops, 49 music pieces, 13 stings (about 150 MB), kept with **Git LFS** and published with the board; rendered by `tools/sound/`. | [sound.md](best-practices/sound.md) |
| Tests | `npm test` (about 640) and the validator; headless browser checks in `tools/headless/`. | [development.md](best-practices/development.md) |

## The board today

- **Title line:** the campaign's title, its game system's badge ("PF2e"), the map menu on the current map's name (travel, entrances, the GM's
  previews), the game clock. The top menu is empty and hidden.
- **The map:** tokens (drag, Space waypoints with running distances, group moves, arrow keys), doors, fog and
  light, terrain, area templates, map notes, effect badges, targets (T), the token HUD (right-click: target,
  status effects, templates; left column: height, Enter Combat, the GM's Hide), Token Quick-View (double-click),
  pings and visual effects, Stride ranges during an encounter. Hidden tokens never reach players. Tokens show
  their creature's art (the Quick-View the whole picture); **object tokens** (chests, shelves, hazards) hold items or a
  note, open in Quick-View and send what is taken to the Party stash with where it was found (board/objects.js).
- **"Claude is thinking"**: a banner over the map on every screen while Claude resolves a batch
  (`tools/replay.mjs`, or `tools/think.mjs` for anything else): one random line and the time elapsed; "still thinking" after
  5 quiet minutes, gone after 30; the GM can clear it.
- **Sidebar tabs, top to bottom** (each pops out as a window; GM-only ones are absent in the player view):

| Tab | State |
|---|---|
| Chat | Built: Claude's narration (the heart of it), rulings, NPC lines, initiative, check and damage cards (no events: those are the GM's audit log's) |
| Replay | Built: Claude's batches revealed step by step (anyone presses Next; slides, rings, camera, effects; roll details per view; narration steps right after the actions they tell; combat, exploration and social icons; reaction stops) |
| Encounter | Built: initiative (roll dialog, drag to reorder), turns and rounds with the turn rules, hide, defeated, target, ping |
| Actions | Placeholder ("coming soon") |
| Exploration | Built: each PC's activity while travelling (players and GM; from the system's list, what a PC cannot do greyed with why; options such as who to follow), the party's pace from the rules, the GM's travel box moving the clock, the GM's reminders for a new area, Defend, Scout and Avoid Notice applied when combat starts, a badge on each PC token outside encounters (`tools/exploration.mjs` for Claude); at its top, the party's **marching order** (2026-11-14): a 4 x 4 grid under a forward arrow, anyone moves anyone, the GM adds companions and allies; only the shape counts; arrivals and Claude's moves keep it, turned in 8 directions, in column where it does not fit, never onto unexplored ground (`tools/marching.mjs` for Claude) |
| Party loot | Built: total party wealth (coins and the items' known values in the stash and on the characters; the GM also the true wealth), the purse (split evenly, breaking larger coins so shares come out even; hand coins over), the stash (carried by nobody; take, with how many), each PC's coins and items with how they are carried, invested, put back and give, a Bulk bar with encumbered put on and taken off automatically; every item's kind, usage and level on its row, and details that unfold in place (traits with their glossary words, stats by kind, description, source, where it was found; the GM: identify DC and sale price), filters by kind and unidentified; players see vague names and only what a look can tell until items are identified, and values once known; the GM adds custom items, identifies, appraises, removes (`tools/loot.mjs` for Claude: library items, buying and selling) |
| Notes | Built: add, list, hover highlights the pin, edit, remove |
| Quest log | Placeholder |
| Visual effects | Built: this screen's switch; the GM's preview library |
| Sound | Built: this screen's mixer (master, music, ambience, effects, interface, each channel with its own mute, mute all), now playing and why; the GM's mood (automatic, six moods, silence), boss switch, pause and resume, Next, this map's music, soundboard (stings and cues for every screen), ambient sounds on the map. Every visual effect has its sound; table cues for dice, turns, rounds, doors and deaths; music in step on every screen by mood; ambient loops heard from the listener through walls (`tools/sound.mjs` for Claude; [sound.md](best-practices/sound.md)) |
| Landing page | Built (2026-11-13): an adventure's cover as a map of kind "landing" where the party waits while players join; the GM moves the party off it (and back) from the map menu, and PCs return to their own squares ([design](design/board.md)) |
| Lighting (GM), Walls (GM) | Built. Veils: the GM dispels or raises one with a click; players see a standing veil as a dark band |
| Dice statistics | Built: by die, faces, roller; PCs and NPCs, this session or all time, kind of roll; the GM's resets |
| Ledger (GM) | Built: the campaign ledger, the GM's memory: improvisations (each says who invented it: Claude, or which player through which character, from the campaign's player list), secrets, rulings, threads, quests, timed events, session summaries; search, kind filters, story so far, the GM's own entries (`tools/ledger.mjs` and `tools/players.mjs` for Claude) |
| Audit log (GM) | Built: every state change and the board's warnings |

- **Board info** (GM only): a collapsible see-through panel in the map's lower-left corner: the square under the
  pointer (fog, light, region, terrain), explored size, lookers, animation cost, listeners, the build.

## Standards the user set (keep to them)

- **Every sidebar tab pops out**, resizes, collapses and remembers where it was. New features get a **tab**, not a menu.
- **Modal dialogs sit above every window.**
- **GM-only means absent in the player view** (lighting, walls, audit log, Board info, hidden tokens), not just disabled.
- **The highlight standard**: hovering or focusing a list entry points its thing out on the map with a pulsing ring
  in the thing's colour (steady with reduced motion). Selection, targets, the acting ring and pings keep their own.
- **The chat is the players' story; the audit log is the GM's record.** Every state change goes to the audit log;
  the chat has no events (2026-11-12): players learn what happened from the cards and the narration.
- **Narration is the heart of the game** (2026-11-12): Claude resolves anything with several steps as a replay, and
  each beat of story is a narration step right after the actions it tells (narrate as you go; `replay.mjs show`
  checks the order). The banner goes up before the first change of any adjudication.
- **Players see a PC's rolls whole and other creatures' as results**; a foe's AC or DC shows as "?"; the GM sees all.
- **Listeners stay few**: a tab that reads the database for its own pane watches it only while it is seen.
- **System-free board, engine and tools**: anything a game system defines lives in `rulesets/<system>/`.
- **Book content never enters the repo or a shared link.**

## What is next

- **The character builder** (2026-11-14, [design](design/game-data.md) section 9): steps 1 to 5 built; next, step 6: a level-1 character with the user for each kind of class, and levelling.

- Adventure events and subsystems are built (2026-11-14; [events.md](best-practices/events.md)); the Beginner Box
  adventure has its five events and two subsystems. Next for them: events on the first real session, and a GM button
  to start a manual event from the Events tab (today Claude runs them).

- From the GM guide review (2026-11-13; the campaign ledger, FR-20, and Party loot, FR-28, are built): the
  adventure importer making areas ready for play (FR-21, FR-22), reactions on the tracker (FR-24), XP on the
  characters (FR-26), and the Quest log tab (FR-30).
- The adventure importer's later items ([future/adventure-importer.md](../future/adventure-importer.md)): map-sheet
  splitting (#6), matching book pawns to creatures (#9), token-sheet slicing (#11). The second round (#14-#25) is
  built; its weakest parts are the wall suggestions and the links between levels.
- Party loot next: using consumables from the tab (FR-31) and adding library items from the board (FR-32).
- The placeholder tabs: Actions, Quest log.
- The board rolling attacks, saves and damage itself (its own check and damage cards; today only initiative rolls on
  the board, and Claude's rolls come from `tools/check.mjs`, `tools/dice.mjs` and `tools/actor.mjs`).
- From play: shields in the turn rules and Shield Block (FR-17), weapon traits applied by the tools (FR-18), healing
  cards and focus points (FR-19), and later spell and action cards with their text.
- The open backlog in [future/backlog.md](../future/backlog.md): roll visibility (FR-10), several encounters at once
  (FR-11), tracker settings (FR-12), threat and XP (FR-13), aura notes on turns (FR-14), a home for the old
  Selection card's buttons (FR-15), two-finger touchpad panning (FR-16), touch screens (FR-2, FR-5), and the rest.
- Ideas not yet scheduled: [future/](../future/README.md).
