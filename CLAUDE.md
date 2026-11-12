# Reliquary-VTT: notes for Claude

A virtual tabletop framework that Claude uses to run tabletop RPGs. Engine, rulesets and adventure packs are separate; adventure packs are built from books the user owns and stay private.

## Read first

- Best practices for each core feature: [docs/best-practices/](docs/best-practices/README.md). Follow the guide for the feature you are working on.
- Design: [docs/design/maps.md](docs/design/maps.md); lighting and vision: [docs/design/lighting.md](docs/design/lighting.md); the board (client): [docs/design/board.md](docs/design/board.md); game data and rules: [docs/design/game-data.md](docs/design/game-data.md).
- Future ideas, not yet scheduled: [future/](future/README.md). When an idea comes up and is deferred, write it up there.
- Plan for the whole rebuild: the user's `PF2E_Claude_VTT\future\reimplementation-plan.md` (not in this repo).

## Standing rules

- **Document best practices for every core feature** you build or change, in `docs/best-practices/`, including the lessons learned while doing it.
- **Map importing:** read the adventure text for every keyed area and use the book's labelled map, not only the map image. Where the map explicitly draws something, the drawing wins; the text fills in what the drawing cannot show. Record every decision in the map's `import.json`.
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
| `engine/` | Walls, doors, sight, light, fog, movement, terrain, measurement, tokens, visual effect primitives, the system-free rules machinery, dice, time (calendar, clock, durations, encounters) (dependency-free JavaScript) |
| `board/` | Reliquary Virtual Tabletop, the board page: modules bundled into one page, its stores and record layout ([guide](docs/best-practices/board.md)) |
| `schemas/` | JSON schemas for maps, walls, terrain, lighting and map state |
| `rulesets/` | Game-system rules and configuration (PF2E: measurement, areas, conditions, movement, terrain, light and senses, visual effects library, creatures' rules: statistics, damage and healing, rule keys, turn rules, Golarion's calendar); `systems.js` lists the systems |
| `tools/` | Validator, sight/move/fog query tools, area templates, tokens, map notes, effect badges and visual effects from chat (`token.mjs`, `area.mjs`, `note.mjs`, `effect.mjs`, `fx.mjs`), creatures' numbers, damage and checks (`actor.mjs`, `check.mjs`), the clock and encounters (`clock.mjs`, `encounter.mjs`), the content library (`library.mjs`), the Foundry PF2E importer (`import/`), id conversion (`ids.mjs`), campaign load/save, bundler, wall overlay, map importer (`mapimport/`, Python) |
| `content/` | Open game content: all of the Foundry PF2E system's open data in our format (ORC and OGL; [NOTICE.md](NOTICE.md)), with the import manifest and report ([content/pf2e/README.md](content/pf2e/README.md)) |
| `examples/` | Original sample pack (Sample Crypt for tests, Sample Keep as the 48 x 48 test bench), save, test campaigns (`campaigns/keep-test`, `crypt-test`) and the engine demo page |
| `tests/` | `npm test` |
| `future/` | Thought-through ideas not yet scheduled (for example, faster sight); check here before planning new work |
| `packs/`, `saves/`, `pdfsource/` | Private, git-ignored |
