# Where things stand

A one-page map of what is built, for a new conversation getting its bearings. Each line points at the guide that
says how to use or change it. Keep this page short and current: when a feature lands, changes or moves, update its
line here in the same commit. Last brought up to date: 2026-11-12.

## The pieces

| Area | What exists | Read |
|---|---|---|
| Engine (`engine/`) | Walls and doors, sight and fog, light (daylight, colour, intensity, animation), movement (paths, Stride ranges, waypoints), terrain, measurement and height, areas, tokens (Tiny layout, occupancy), visual effects, the rules machinery, dice, time (calendar, clock, durations, encounters). System-free. | [engine/README.md](../engine/README.md), the best-practices guides |
| Pathfinder 2e (`rulesets/pf2e/`) | Measurement, areas, conditions, terrain, light and senses, creatures' statistics, damage and healing, rule keys, turn rules (they report their dice), Golarion's calendar, Quick-View's stat block, traits, initiative, roll kinds, the title line's badge. | [game-data.md](best-practices/game-data.md) |
| Open content (`content/pf2e/`) | All of Foundry PF2E's open data (ORC and OGL), imported by `tools/import/foundry-pf2e.mjs`. | [content/pf2e/README.md](../content/pf2e/README.md) |
| Map importer (`tools/mapimport/`) | Book maps to packs: grid, walls, doors, terrain, lighting, with every decision in `import.json`. Packs stay private. | [map-importer.md](best-practices/map-importer.md) |
| Claude's tools (`tools/`) | Campaign load, save and switch; tokens, templates, notes, effects, visual effects; creatures, checks, dice; the clock and encounters; chat messages, events and audit lines. | [tools/README.md](../tools/README.md) |
| The board (`board/`) | Reliquary Virtual Tabletop: one published page, player and GM views, its own database. Below. | [board.md](best-practices/board.md), [design](design/board.md) |
| Tests | `npm test` (about 450) and the validator; headless browser checks in `tools/headless/`. | [development.md](best-practices/development.md) |

## The board today

- **Title line:** the campaign's title, its game system's badge ("PF2e"), the map menu on the current map's name (travel, entrances, the GM's
  previews), the game clock. The top menu is empty and hidden.
- **The map:** tokens (drag, Space waypoints with running distances, group moves, arrow keys), doors, fog and
  light, terrain, area templates, map notes, effect badges, targets (T), the token HUD (right-click: target,
  status effects, templates; left column: height, Enter Combat, the GM's Hide), Token Quick-View (double-click),
  pings and visual effects, Stride ranges during an encounter. Hidden tokens never reach players.
- **Sidebar tabs, top to bottom** (each pops out as a window; GM-only ones are absent in the player view):

| Tab | State |
|---|---|
| Chat | Built: Claude's narration (the heart of it), rulings, NPC lines, roll cards, table events |
| Encounter | Built: initiative (roll dialog, drag to reorder), turns and rounds with the turn rules, hide, defeated, target, ping |
| Replay, Actions, Exploration, Party loot | Placeholders ("coming soon") |
| Notes | Built: add, list, hover highlights the pin, edit, remove |
| Quest log | Placeholder |
| Visual effects | Built: this screen's switch; the GM's preview library |
| Lighting (GM), Walls (GM) | Built |
| Dice statistics | Built: by die, faces, roller; PCs and NPCs, this session or all time, kind of roll; the GM's resets |
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
  only what players should know goes to the chat as an event.
- **Listeners stay few**: a tab that reads the database for its own pane watches it only while it is seen.
- **System-free board, engine and tools**: anything a game system defines lives in `rulesets/<system>/`.
- **Book content never enters the repo or a shared link.**

## What is next

- The placeholder tabs: Replay, Actions, Exploration, Party loot, Quest log.
- Roll cards and dice for attacks, saves, skill checks and damage (only initiative rolls on the board today; Claude's
  rolls are logged through `tools/dice.mjs` and `tools/check.mjs`).
- The open backlog in [future/backlog.md](../future/backlog.md): roll visibility (FR-10), several encounters at once
  (FR-11), tracker settings (FR-12), threat and XP (FR-13), aura notes on turns (FR-14), a home for the old
  Selection card's buttons (FR-15), two-finger touchpad panning (FR-16), touch screens (FR-2, FR-5), and the rest.
- Ideas not yet scheduled: [future/](../future/README.md).
