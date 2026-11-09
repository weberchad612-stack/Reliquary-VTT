# engine

Board page source and the game-system-independent logic behind it: maps and grid, walls, sight and fog, tokens, dice, initiative, replay, effects, music, notes and handouts.

The engine has no game-system or adventure knowledge. Rulesets fill its extension points.

## Modules

| Module | What it does |
|---|---|
| `walls/presets.js` | The eight wall types and their movement, sight, light and sound values; door and secret-door behaviour; 1/8 cell snapping; one-way sides. |
| `sight/visibility.js` | The sight engine: `prepare` (segments for one sense, with door states applied), `visPolygon` (area visible from a point), `canSee` (line of sight between two points), `footprintPoints`, `viewpoints`, `tokenSight` and `tokenCanSee` (sight for tokens of any size, Tiny to Gargantuan), plus polygon helpers. |

Both are dependency-free ES modules that run in the browser and in Node. Tools reach them through `tools/sight.mjs`.

Design: [docs/design/maps.md](../docs/design/maps.md). The board page itself is not built yet.
