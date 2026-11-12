# Best practices

How to use and change each core feature well. Written for Claude, who runs the tools and the game, and useful to anyone contributing. Each guide records lessons learned while building and using the feature; update it whenever the feature changes.

| Feature | Guide |
|---|---|
| Map importer (`tools/mapimport/`) | [map-importer.md](map-importer.md) |
| Walls, doors and openings (`walls.json`) | [walls-and-doors.md](walls-and-doors.md) |
| Sight and fog of war (`engine/sight/`, `engine/fog/`) | [sight-and-fog.md](sight-and-fog.md) |
| Movement and tokens (`engine/movement/`, `engine/tokens/`; Stride bands on the board) | [movement-and-tokens.md](movement-and-tokens.md) |
| Lighting and vision (`engine/light/` with daylight, colour, intensity and animation; light-aware `partyView`; a creature's own view; `rulesets/pf2e/light.js`; importer lighting step) | [lighting.md](lighting.md) |
| Terrain and distance (`engine/terrain/`, `engine/measure/`, `rulesets/pf2e/terrain.js`, importer terrain step) | [terrain.md](terrain.md) |
| The board: playing on it, saving to the PC, switching campaigns, the top menu, zoom and selection, targets, area templates, map notes, effect badges, the token HUD, visual effects, names and ids, the game clock, Token Quick-View, the encounter tracker, the sidebar and chat (`board/`, `tools/campaign.mjs`, `tools/area.mjs`, `tools/note.mjs`, `tools/effect.mjs`, `tools/fx.mjs`, `tools/token.mjs`, `tools/ids.mjs`) | [board.md](board.md) |
| Game data and rules: creatures' numbers, conditions, damage and healing, checks, PC builds, stat blocks, importing Foundry PF2E data (`engine/rules/`, `rulesets/pf2e/`, `tools/actor.mjs`, `tools/check.mjs`, `tools/import/`) | [game-data.md](game-data.md) |
| Working on the repository | [development.md](development.md) |

The design behind these features is in [docs/design/maps.md](../design/maps.md) and, for light and vision, [docs/design/lighting.md](../design/lighting.md), for the board, [docs/design/board.md](../design/board.md), and for game data, [docs/design/game-data.md](../design/game-data.md).
