# engine

Board page source and the game-system-independent logic behind it: maps and grid, walls, sight and fog, tokens, dice, initiative, replay, effects, music, notes and handouts.

The engine has no game-system or adventure knowledge. Rulesets fill its extension points.

## Modules

| Module | What it does |
|---|---|
| `walls/presets.js` | The eight wall types and their movement, sight, light and sound values; door and secret-door behaviour; 1/8 cell snapping; one-way sides. |
| `sight/visibility.js` | The sight engine: `prepare` (segments for one sense, with door states applied), `visPolygon` (area visible from a point), `canSee` (line of sight between two points), `footprintPoints`, `viewpoints`, `tokenSight` and `tokenCanSee` (sight for tokens of any size, Tiny to Gargantuan), plus polygon helpers. |
| `movement/movement.js` | Movement: `canStep` (one 8-way step of a token's whole space, no corner cutting), `fits` (does a space fit), `path` (cheapest route) and `reach` (every position within a movement allowance). Diagonal costs, difficult terrain, occupied squares and squeezing come from the ruleset as options. |
| `fog/explored.js` | Explored areas: `ExploredMask` (a 1/8-cell bitmap) and `mergeExplored`, which adds what the party sees now to what it has seen before and stores the result as outlines that round-trip exactly. `displayPolys` / `displayOutlines` give straightened outlines for painting. |
| `fog/view.js` | `partyView` (what PCs see now and which tokens players may see), `fogStateAt` (visible, explored or hidden) and `paintFog` (paints the player or GM fog onto a canvas). |
| `tokens/tiny.js` | Tiny tokens: `layoutTiny` (centred when alone, a stable quadrant each when sharing a square, up to four), `spaceOf` (space for sight and drawing) and `moveSpaceOf` (space for movement). |

All are dependency-free ES modules that run in the browser and in Node. Tools reach them through `tools/sight.mjs`, `tools/move.mjs` and `tools/fog.mjs`.

Design: [docs/design/maps.md](../docs/design/maps.md). The board page itself is not built yet.
