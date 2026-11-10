# Reliquary-VTT

A virtual table top framework for use by Claude AI to run TTRPGs for you.

## Status

Early development. Nothing playable yet. Work is starting with maps: see [docs/design/maps.md](docs/design/maps.md). Best practices for each core feature: [docs/best-practices/](docs/best-practices/README.md). Ideas for later: [future/](future/README.md).

Built so far:

- JSON schemas for maps, wall segments, terrain, lighting and map state (`schemas/`)
- Wall types and sense values shared by the engine and tools (`engine/walls/presets.js`)
- The sight engine: visibility polygons and line of sight for every wall type and token size (`engine/sight/`)
- Movement: steps, fitting large creatures, pathfinding, reach and exact one, two and three Stride ranges (`engine/movement/`); distances and rulers (`engine/measure/`)
- Terrain: difficult, greater difficult, hazardous, uneven, narrow, climb and swim areas and their movement costs (`engine/terrain/`)
- Light and vision: light sources and regions, darkness and dim light, darkvision and low-light vision, concealment, daylight through windows and open doors, fading dim light, colour, intensity and flickering or pulsing light (`engine/light/`)
- Fog of war: explored-area merging and the three-state player and GM fog, and one creature's own view (`engine/fog/`)
- The Pathfinder 2e rules the engine asks for: movement and terrain, light and senses (`rulesets/pf2e/`)
- A map importer that turns a map in a PDF you own into wall, terrain and lighting data for a private pack (`tools/mapimport/`)
- A validator, sight, movement and fog query tools, and a wall overlay renderer (`tools/`)
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
