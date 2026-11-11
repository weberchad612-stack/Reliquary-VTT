# engine

Board page source and the game-system-independent logic behind it: maps and grid, walls, sight and fog, tokens, dice, initiative, replay, effects, music, notes and handouts.

The engine has no game-system or adventure knowledge. Rulesets fill its extension points.

## Modules

| Module | What it does |
|---|---|
| `walls/presets.js` | The eight wall types and their movement, sight, light and sound values; door and secret-door behaviour; 1/8 cell snapping; one-way sides. |
| `doors/leaf.js` | Door leaves for drawing: `leafShapes` (closed panel, open panel swung on its hinge, swing arc, centre), `leafEnds`, `pairOf` (the other leaf of a double door), `sideNormal`. |
| `terrain/terrain.js` | The terrain layer: `TerrainMap` (areas that apply now, by square), `entered` (areas a move enters), `terrainEnterCost` (the movement `enterCost` option from a ruleset), `routeTerrain` (extra cost and checks along a route), `areaCells`, `cellsToRects`. |
| `light/light.js` | Light: `lightShape` (where a light reaches through walls; cones; a thin dim fringe, `DIM_FRINGE`, for bright-only lights), `lightPatch`, `LightMap` (the rule level at every point from base, regions and lights, plus for drawing only a brightness `glow` that fades across dim light and at region edges, `REGION_FADE_FT`, scaled by intensity, and the mixed `colour` of coloured light), `LightCache` (recomputes a light only when it moves or doors change; colour and intensity ride along), `parseColour`, `DARK`/`DIM`/`BRIGHT`. `fog/view.js` `partyView` takes a light map and the ruleset's light rules to work out what the party perceives. |
| `light/animate.js` | Light animation, first set (torch, flicker, pulse, ghostly, chroma): `animationAt` (brightness factor and hue turn for a moment, seeded per light), `animationOf`, `noise`, `ANIMATION_TYPES`, `ANIMATION_DEFAULTS`. Drawing only. |
| `light/daylight.js` | Daylight indoors: `daylightLights` turns every window, grate, arrow slit and open door with open sky on one side into half-circle lights facing into the room (`DAYLIGHT`: bright 15 ft then dim 50 ft by day, dim 15 ft at dusk, none at night); `skyTest`. |
| `measure/measure.js` | Distances: `gridDistance` (diagonal patterns such as 5-10-5), `rulerLength` (through waypoints), `spaceDistance` (between creatures, for reach and range). |
| `areas/areas.js` | Area templates: `burstCells`, `coneCells`, `emanationCells`, `lineCells` (diagonals by the system's pattern), `aimArea` (aim from a caster toward a point, as the mouse does: cones in 8 directions from the caster's edge, lines at any angle, bursts on grid corners), `effectBlockers` and `reachedCells` (line of effect: walls that block movement, minus the system's `passes` list; open doors never block), `buildArea`, `tokensInCells`, `cornerDistance`, `describeArea`. |
| `sight/visibility.js` | The sight engine: `prepare` (segments for one sense, with door states applied), `visPolygon` (area visible from a point; unlimited range by default, stopping at the map's edge), `canSee` (line of sight between two points), `footprintPoints`, `viewpoints`, `tokenSight` and `tokenCanSee` (sight for tokens of any size, Tiny to Gargantuan), plus polygon helpers. |
| `movement/movement.js` | Movement: `canStep` (one 8-way step of a token's whole space, no corner cutting), `fits` (does a space fit), `path` (cheapest route), `reach` (every position within a movement allowance) and `strideReach` (exactly where one, two and three Strides reach: leftover feet lost, diagonal count kept through the turn). Diagonal costs, difficult terrain, occupied squares and squeezing come from the ruleset as options. |
| `fog/explored.js` | Explored areas: `ExploredMask` (a 1/8-cell bitmap) and `mergeExplored`, which adds what the party sees now to what it has seen before and stores the result as outlines that round-trip exactly. `displayPolys` / `displayOutlines` give straightened outlines for painting. |
| `fog/view.js` | `partyView` (what PCs see now and which tokens players may see; with `canLook` and `alwaysShown`, one creature's own view), `fogStateAt` (visible, explored or hidden) and `paintFog` (paints the player or GM fog onto a canvas; remembered areas dark for players). |
| `tokens/tiny.js` | Tiny tokens: `layoutTiny` (centred when alone, even inside a big creature; a stable quadrant each when sharing with other Tiny tokens, up to four, or with a Small or Medium creature), `spaceOf` (space for sight and drawing) and `moveSpaceOf` (space for movement). |
| `tokens/occupancy.js` | Sharing space: `mayShare` and `blockersAt` under the table rule (a footprint at least two squares wider may share; Tiny shares with anyone). |
| `tokens/display.js` | How big a token is drawn in its space: Small creatures (`small: true`) at 0.75 of a Medium token, centred. |

All are dependency-free ES modules that run in the browser and in Node. Tools reach them through `tools/sight.mjs`, `tools/move.mjs`, `tools/fog.mjs` and `tools/area.mjs`.

Design: [docs/design/maps.md](../docs/design/maps.md). The board page that uses these modules is in `board/` (design: [docs/design/board.md](../docs/design/board.md)).
