# Reliquary-VTT

A virtual table top framework for use by Claude AI to run TTRPGs for you.

## Status

Early development. The board (Reliquary Virtual Tabletop) runs a map table: maps, light and fog, tokens, movement, targets, area templates, notes, effect badges and visual effects. Design: [docs/design/maps.md](docs/design/maps.md) and [docs/design/board.md](docs/design/board.md). Best practices for each core feature: [docs/best-practices/](docs/best-practices/README.md). Ideas for later: [future/](future/README.md).

Built so far:

- JSON schemas for maps, wall segments, terrain, lighting and map state (`schemas/`)
- Wall types and sense values shared by the engine and tools (`engine/walls/presets.js`)
- The sight engine: visibility polygons and line of sight for every wall type and token size (`engine/sight/`)
- Movement: steps, fitting large creatures, pathfinding, reach and exact one, two and three Stride ranges (`engine/movement/`); distances and rulers (`engine/measure/`)
- Terrain: difficult, greater difficult, hazardous, uneven, narrow, climb and swim areas and their movement costs (`engine/terrain/`)
- Light and vision: light sources and regions, darkness and dim light, darkvision and low-light vision, concealment, daylight through windows and open doors, fading dim light, colour, intensity and flickering or pulsing light (`engine/light/`)
- Fog of war: explored-area merging and the three-state player and GM fog, and one creature's own view (`engine/fog/`)
- The Pathfinder 2e rules and configuration the engine and board ask for: measurement, area shapes and line of effect, conditions, movement and terrain, light and senses, and a library of about 90 visual effects (`rulesets/pf2e/`)
- Area templates (burst, cone, emanation, line) with line of effect (`engine/areas/`)
- Game data and rules: creatures' statistics computed from PC builds and stat blocks with breakdowns, every condition's effect on the numbers, damage and healing with resistances, dying and wounded, degrees of success, PF2E's own rule keys and turn rules (`engine/rules/`, `rulesets/pf2e/`)
- Open game content: all of Foundry PF2E's open data (ORC and OGL) converted into our format, with an importer that reports what is new, changed, renamed and retired at each release, and 568 trait descriptions (`content/pf2e/`, `tools/import/`)
- Time: calendars (Golarion's), the game clock and the day of the adventure, durations counted as Foundry does, and encounters with initiative, rounds and turns (`engine/time/`, `tools/clock.mjs`, `tools/encounter.mjs`)
- Visual effects: genre-neutral drawing primitives (fantasy, sci-fi and modern shapes) that rulesets and packs compose into named effects, with hit, critical and miss results (`engine/fx/`)
- The board, Reliquary Virtual Tabletop (`board/`): one page with the player and GM views, a top menu, travel between maps and area maps (towns), zoom and pan, multi-select and group moves, dragging through waypoints (Space) with running distances, hover and distance, targeting, area templates, map notes, effect badges with unconscious, dying and dead, a Foundry-style sidebar (tabs that pop out into windows, collapse, resize; lighting and walls for the GM) with a chat of roll cards, Claude's narration, rulings and NPC lines, and the change log, a right-click token menu with a status palette, visual effects played from chat, the game clock and calendar in the title line (the GM can change it), Token Quick-View (double-click a token for its live stat block or sheet, with traits, feats and features explained on hover), an encounter tracker (Enter Combat, a roll dialog with every modifier, roll cards in the chat, initiative set by dragging, hide, defeated and target from each row, turns that run the rules and move the clock, Stride ranges shown while it runs), tokens the GM hides from players, and tokens with generated ids and unique names (a named NPC shows players an alias until they learn the name); it runs on its own private database, and Claude loads, saves and switches campaigns with `tools/campaign.mjs`
- A map importer that turns a map in a PDF you own into wall, terrain and lighting data for a private pack (`tools/mapimport/`)
- A validator; sight, movement and fog query tools; token, area template, map note, effect badge, visual effect, creature and check tools for Claude, a Foundry PF2E importer, and an id converter; and a wall overlay renderer (`tools/`)
- An original sample map pack and save, and an interactive demo of the engine on it (`examples/`)

## Development

Requires Node.js 20 or newer, and Python 3 with Pillow for the image tools (the map importer also needs `tools/mapimport/requirements.txt` and poppler's `pdfimages`).

```
npm install
npm test
node tools/validate.mjs examples/sample-pack --save examples/sample-save
```

## License

The framework code is released under the [MIT License](LICENSE), copyright Cahoots Creative, LLC.

No publisher game content (rulebooks, adventures, maps or art) is included in this repository. Users supply their own.

## Licences

Code: MIT ([LICENSE](LICENSE)). Pathfinder game content in `content/pf2e/` is converted from the Foundry VTT PF2E system's open data under the ORC License and the Open Game License 1.0a, and uses Paizo trademarks and copyrights under Paizo's Community Use Policy: see [NOTICE.md](NOTICE.md). Reliquary VTT is not published, endorsed, or specifically approved by Paizo, and is free.
