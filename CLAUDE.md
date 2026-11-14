# Reliquary-VTT: notes for Claude

A virtual tabletop framework that Claude uses to run tabletop RPGs. Engine, rulesets and adventure packs are separate; adventure packs are built from books the user owns and stay private.

## Read first

- **Where things stand:** [docs/STATUS.md](docs/STATUS.md), one page: what is built, the board today, the user's standards, what is next. Start here; keep it current.
- Best practices for each core feature: [docs/best-practices/](docs/best-practices/README.md). Follow the guide for the feature you are working on.
- **Running a game (GM rules):** [docs/gm/running-a-game.md](docs/gm/running-a-game.md) (any system) and the system's own guide ([rulesets/pf2e/gm.md](rulesets/pf2e/gm.md) for PF2E). Read both at the start of every session and after any context compaction, and re-read the guide's pre-flight checklist before every reply that resolves something at the table.
- **Running a game on the board:** [docs/best-practices/game-data.md](docs/best-practices/game-data.md) sections 2 to 2c (the thinking banner first; anything with several steps as a replay, narrated step by step) and [docs/best-practices/board.md](docs/best-practices/board.md) (records, chat cards, saving).
- Design: [docs/design/maps.md](docs/design/maps.md); lighting and vision: [docs/design/lighting.md](docs/design/lighting.md); the board (client): [docs/design/board.md](docs/design/board.md); game data and rules: [docs/design/game-data.md](docs/design/game-data.md).
- Future ideas, not yet scheduled: [future/](future/README.md). When an idea comes up and is deferred, write it up there.
- Plan for the whole rebuild: the user's `PF2E_Claude_VTT\future\reimplementation-plan.md` (not in this repo).

## Standing rules

- **Document best practices for every core feature** you build or change, in `docs/best-practices/`, including the lessons learned while doing it.
- **Map importing:** read the adventure text for every keyed area and use the book's labelled map, not only the map image. Where the map explicitly draws something, the drawing wins; the text fills in what the drawing cannot show. Record every decision in the map's `import.json`, and finish with `node tools/mapcheck.mjs <map-dir>` saying OK ([map-importer.md](docs/best-practices/map-importer.md), [adventure-importer.md](docs/best-practices/adventure-importer.md)).
- **Adventure importing:** run the pack's pipeline (`node tools/advimport/run.mjs packs/<pack> run`) until `status` shows every step up to date and every review step approved after Claude has looked. Refresh a campaign that exists with `campaign.mjs --update` (it keeps play), never `--force`. Send packs and saves to the PC with `tools/advimport/sync.mjs`, which never overwrites a file the user changed there.
- **Never commit or publish book content.** Text, maps and art from the user's books stay private: `pdfsource/`, `extracted/`, `packs/` and `saves/` are git-ignored. Check before every commit.
- **Open game content may be committed** (the user's decision, 2026-11-12): Pathfinder data converted from the Foundry VTT PF2E system's open data, licensed **ORC or OGL**, flavour descriptions and adventure bestiaries included, goes in `content/pf2e/` (only through `tools/import/foundry-pf2e.mjs --release`, never by hand; data errors are corrected with overrides in `content/pf2e/overrides/`), with the notices in `NOTICE.md` and `licenses/`. The project must stay free (Paizo's Community Use Policy).
- **Keep the board, engine and tools free of any one game system.** Anything a game system defines (its words,
  layouts, traits, numbers, rules text, glossaries) lives in `rulesets/<system>/` and reaches the board through the
  system's configuration (`rulesets/<system>/system.js`) or data keyed by system. Built-in data is keyed by ruleset
  id and used only for a campaign of that system. A system that lacks a piece gets a plain fallback, never another
  system's.
- Run `npm test` and the validator before every commit. Commit to `main`.

## Layout

| Folder | What |
|---|---|
| `engine/` | Walls, doors, sight, light, fog, movement, terrain, measurement, tokens, visual effect primitives, sound (mixer, listeners, music timeline), the system-free rules machinery, adventure events and subsystems, dice, time (calendar, clock, durations, encounters) (dependency-free JavaScript) |
| `board/` | Reliquary Virtual Tabletop, the board page: modules bundled into one page, its stores and record layout, the sidebar tabs (chat with check and damage cards, replay, encounter, exploration, party loot, notes, sound, dice, the GM's ledger, events and audit log) and the "Claude is thinking" banner ([guide](docs/best-practices/board.md)) |
| `schemas/` | JSON schemas for maps, walls, terrain, lighting, map state, and the save's campaign, chat, audit log, dice, replays, ledger, party loot (stash and purse), the PCs' exploration activities and the adventure's events |
| `rulesets/` | Game-system rules and configuration (PF2E: measurement, areas, conditions, movement, terrain, light and senses, visual effects library, creatures' rules: statistics, damage and healing, rule keys, turn rules, Golarion's calendar, Token Quick-View's stat block, traits, where feats and features are found, initiative, roll kinds, the title line's badge, loot: coins, Bulk, identifying, selling, exploration: activities, pace, combat-start requests, sound: what is a boss, subsystems: Victory Points, Influence, Chase, Infiltration, Research); `systems.js` lists the systems |
| `tools/` | Validator, sight/move/fog query tools, area templates, tokens, map notes, effect badges and visual effects from chat (`token.mjs`, `area.mjs`, `note.mjs`, `effect.mjs`, `fx.mjs`), creatures' numbers, damage, checks and dice (`actor.mjs`, `check.mjs`, `dice.mjs`), the clock and encounters (`clock.mjs`, `encounter.mjs`), replays and the thinking banner (`replay.mjs`, `think.mjs`), the campaign ledger and its players (`ledger.mjs`, `players.mjs`), party loot (`loot.mjs`), exploration (`exploration.mjs`), adventure events and subsystems (`events.mjs`, `subsystem.mjs`), sound (`sound.mjs`; the sound set's generator in `sound/`, Python), Claude's chat messages and audit lines (`chat.mjs`), the content library (`library.mjs`), the Foundry PF2E importer (`import/`), id conversion (`ids.mjs`), campaign load/save, bundler, wall overlay, map importer (`mapimport/`, Python) and the map check (`mapcheck.mjs`), adventure importer (`advimport/`: `run.mjs` runs a pack's pipeline, `sync.mjs` sends it to the PC) |
| `content/` | Open game content: all of the Foundry PF2E system's open data in our format (ORC and OGL; [NOTICE.md](NOTICE.md)), with the import manifest and report ([content/pf2e/README.md](content/pf2e/README.md)) |
| `sounds/` | The board's sound set (effects, cues, ambient loops, music, `sounds.json`), kept with **Git LFS**; rendered by `tools/sound/`, published with the board ([guide](docs/best-practices/sound.md)). Clone with `GIT_LFS_SKIP_SMUDGE=1` unless the audio is needed |
| `examples/` | Original sample pack (Sample Crypt for tests, Sample Keep as the 48 x 48 test bench), save, test campaigns (`campaigns/keep-test`, `crypt-test`) and the engine demo page |
| `tests/` | `npm test` |
| `future/` | Thought-through ideas not yet scheduled (for example, faster sight); check here before planning new work |
| `packs/`, `saves/`, `pdfsource/` | Private, git-ignored |
