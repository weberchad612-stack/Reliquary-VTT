# Best practices

How to use and change each core feature well. Written for Claude, who runs the tools and the game, and useful to anyone contributing. Each guide records lessons learned while building and using the feature; update it whenever the feature changes.

| Feature | Guide |
|---|---|
| Map importer (`tools/mapimport/`) | [map-importer.md](map-importer.md) |
| Walls, doors and openings (`walls.json`) | [walls-and-doors.md](walls-and-doors.md) |
| Sight and fog of war (`engine/sight/`, `engine/fog/`) | [sight-and-fog.md](sight-and-fog.md) |
| Movement and tokens (`engine/movement/`, `engine/tokens/`; Stride bands during encounters and waypoints while dragging on the board) | [movement-and-tokens.md](movement-and-tokens.md) |
| Lighting and vision (`engine/light/` with daylight, colour, intensity and animation; light-aware `partyView`; a creature's own view; `rulesets/pf2e/light.js`; importer lighting step) | [lighting.md](lighting.md) |
| Terrain and distance (`engine/terrain/`, `engine/measure/`, `rulesets/pf2e/terrain.js`, importer terrain step) | [terrain.md](terrain.md) |
| The board: playing on it, saving to the PC, switching campaigns, the title line, Board info, zoom and selection, targets, area templates, map notes, effect badges, the token HUD, visual effects, names and ids, the game clock, Token Quick-View, the encounter tracker, hiding tokens, the highlight standard, the Notes tab, the sidebar, the chat (check and damage cards) and the audit log, the campaign ledger and the campaign's players, Party loot (the stash, purse, characters' coins and items, Bulk, identifying, item details, total party wealth), Exploration (activities, pace, travel, combat start, badges), dice statistics, replays and the "Claude is thinking" banner (`board/`, `tools/campaign.mjs`, `tools/encounter.mjs`, `tools/chat.mjs`, `tools/dice.mjs`, `tools/replay.mjs`, `tools/think.mjs`, `tools/ledger.mjs`, `tools/players.mjs`, `tools/area.mjs`, `tools/note.mjs`, `tools/effect.mjs`, `tools/fx.mjs`, `tools/token.mjs`, `tools/ids.mjs`) | [board.md](board.md) |
| Game data and rules: creatures' numbers, conditions, damage and healing, checks, PC builds, stat blocks, time and encounters, resolving a batch as a replay with narration steps (section 2c), importing Foundry PF2E data (`engine/rules/`, `rulesets/pf2e/`, `tools/actor.mjs`, `tools/check.mjs`, `tools/replay.mjs`, `tools/import/`) | [game-data.md](game-data.md) |
| Running a game as GM: Claude's table rules for any system, and the system's own guide ([PF2E](../../rulesets/pf2e/gm.md)) | [running-a-game.md](../gm/running-a-game.md) |
| Working on the repository | [development.md](development.md) |

The design behind these features is in [docs/design/maps.md](../design/maps.md) and, for light and vision, [docs/design/lighting.md](../design/lighting.md), for the board, [docs/design/board.md](../design/board.md), and for game data, [docs/design/game-data.md](../design/game-data.md).
