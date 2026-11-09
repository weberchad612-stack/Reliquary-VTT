# Reliquary-VTT

A virtual table top framework for use by Claude AI to run TTRPGs for you.

## Status

Early development. Nothing playable yet. Work is starting with maps: see [docs/design/maps.md](docs/design/maps.md).

Built so far:

- JSON schemas for maps, wall segments and map state (`schemas/`)
- Wall types and sense values shared by the engine and tools (`engine/walls/presets.js`)
- A validator and a wall overlay renderer (`tools/`)
- An original sample map pack and save (`examples/`)

## Development

Requires Node.js 20 or newer, and Python 3 with Pillow for the image tools.

```
npm install
npm test
node tools/validate.mjs examples/sample-pack --save examples/sample-save
```

## License

The framework code is released under the [MIT License](LICENSE), copyright Cahoots Creative, LLC.

No publisher game content (rulebooks, adventures, maps or art) is included in this repository. Users supply their own.
