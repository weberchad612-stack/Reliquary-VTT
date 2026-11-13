# Where things stand

A one-page map of what is built, for a new conversation getting its bearings. Each line points at the guide that
says how to use or change it. Keep this page short and current: when a feature lands, changes or moves, update its
line here in the same commit. Last brought up to date: 2026-11-13 (Party loot).

## The pieces

| Area | What exists | Read |
|---|---|---|
| Engine (`engine/`) | Walls and doors, sight and fog, light (daylight, colour, intensity, animation), movement (paths, Stride ranges, waypoints), terrain, measurement and height, areas, tokens (Tiny layout, occupancy), visual effects, the rules machinery, dice, time (calendar, clock, durations, encounters). System-free. | [engine/README.md](../engine/README.md), the best-practices guides |
| Pathfinder 2e (`rulesets/pf2e/`) | Measurement, areas, conditions, terrain, light and senses, creatures' statistics, damage and healing, rule keys, turn rules (they report their dice), Golarion's calendar, Quick-View's stat block, traits, initiative, roll kinds, the title line's badge, loot (coins, Bulk, identifying, selling). | [game-data.md](best-practices/game-data.md) |
| Open content (`content/pf2e/`) | All of Foundry PF2E's open data (ORC and OGL), imported by `tools/import/foundry-pf2e.mjs`. | [content/pf2e/README.md](../content/pf2e/README.md) |
| Map importer (`tools/mapimport/`) | Book maps to packs: grid, walls, doors, terrain, lighting, with every decision in `import.json`. Packs stay private. | [map-importer.md](best-practices/map-importer.md) |
| Claude's tools (`tools/`) | Campaign load, save and switch; tokens, templates, notes, effects, visual effects; creatures, checks, dice; the clock and encounters; chat messages, check and damage cards, audit lines; replays (`replay.mjs`: resolve a batch in a draft, narration steps) and the thinking banner (`think.mjs`); the campaign ledger (`ledger.mjs`) and the campaign's players (`players.mjs`); party loot (`loot.mjs`: find, add, identify, appraise, move, buy, sell, coins). | [tools/README.md](../tools/README.md) |
| The board (`board/`) | Reliquary Virtual Tabletop: one published page, player and GM views, its own database. Below. | [board.md](best-practices/board.md), [design](design/board.md) |
| GM guides (`docs/gm/`, `rulesets/pf2e/gm.md`) | How Claude runs a game: secrecy, narration, the ledger, dice, foes, exploration, combat, time, loot, quests, preparing an area, sessions, house rules, a pre-flight checklist; the PF2E guide adds the system's secret checks, reactions, conditions, healing and rulings. Reviewed rule by rule with the user (2026-11-13). | [running-a-game.md](gm/running-a-game.md) |
| Tests | `npm test` (about 480) and the validator; headless browser checks in `tools/headless/`. | [development.md](best-practices/development.md) |

## The board today

- **Title line:** the campaign's title, its game system's badge ("PF2e"), the map menu on the current map's name (travel, entrances, the GM's
  previews), the game clock. The top menu is empty and hidden.
- **The map:** tokens (drag, Space waypoints with running distances, group moves, arrow keys), doors, fog and
  light, terrain, area templates, map notes, effect badges, targets (T), the token HUD (right-click: target,
  status effects, templates; left column: height, Enter Combat, the GM's Hide), Token Quick-View (double-click),
  pings and visual effects, Stride ranges during an encounter. Hidden tokens never reach players.
- **"Claude is thinking"**: a banner over the map on every screen while Claude resolves a batch
  (`tools/replay.mjs`, or `tools/think.mjs` for anything else): one random line and the time elapsed; "still thinking" after
  5 quiet minutes, gone after 30; the GM can clear it.
- **Sidebar tabs, top to bottom** (each pops out as a window; GM-only ones are absent in the player view):

| Tab | State |
|---|---|
| Chat | Built: Claude's narration (the heart of it), rulings, NPC lines, initiative, check and damage cards (no events: those are the GM's audit log's) |
| Replay | Built: Claude's batches revealed step by step (anyone presses Next; slides, rings, camera, effects; roll details per view; narration steps right after the actions they tell; combat, exploration and social icons; reaction stops) |
| Encounter | Built: initiative (roll dialog, drag to reorder), turns and rounds with the turn rules, hide, defeated, target, ping |
| Actions, Exploration | Placeholders ("coming soon") |
| Party loot | Built: the party's loot value (known values in the stash and on the characters, with coins; the GM also the true value), the purse (split evenly, breaking larger coins so shares come out even; hand coins over), the stash (carried by nobody; take, with how many), each PC's coins and items with how they are carried, invested, put back and give, a Bulk bar with encumbered put on and taken off automatically; every item's kind, usage and level on its row, and details that unfold in place (traits with their glossary words, stats by kind, description, source, where it was found; the GM: identify DC and sale price), filters by kind and unidentified; players see vague names and only what a look can tell until items are identified, and values once known; the GM adds custom items, identifies, appraises, removes (`tools/loot.mjs` for Claude: library items, buying and selling) |
| Notes | Built: add, list, hover highlights the pin, edit, remove |
| Quest log | Placeholder |
| Visual effects | Built: this screen's switch; the GM's preview library |
| Lighting (GM), Walls (GM) | Built |
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

- From the GM guide review (2026-11-13; the campaign ledger, FR-20, and Party loot, FR-28, are built): the
  adventure importer making areas ready for play (FR-21, FR-22), reactions on the tracker (FR-24), XP on the
  characters (FR-26), and the Quest log tab (FR-30).
- Party loot next: using consumables from the tab (FR-31) and adding library items from the board (FR-32).
- The placeholder tabs: Actions, Exploration, Quest log.
- The board rolling attacks, saves and damage itself (its own check and damage cards; today only initiative rolls on
  the board, and Claude's rolls come from `tools/check.mjs`, `tools/dice.mjs` and `tools/actor.mjs`).
- From play: shields in the turn rules and Shield Block (FR-17), weapon traits applied by the tools (FR-18), healing
  cards and focus points (FR-19), and later spell and action cards with their text.
- The open backlog in [future/backlog.md](../future/backlog.md): roll visibility (FR-10), several encounters at once
  (FR-11), tracker settings (FR-12), threat and XP (FR-13), aura notes on turns (FR-14), a home for the old
  Selection card's buttons (FR-15), two-finger touchpad panning (FR-16), touch screens (FR-2, FR-5), and the rest.
- Ideas not yet scheduled: [future/](../future/README.md).
