# schemas

JSON schemas (draft 2020-12) for pack and save records. The design is in [docs/design/maps.md](../docs/design/maps.md).

| Schema | Describes | Lives in |
|---|---|---|
| `map.schema.json` | One map: image, grid calibration, wall files, links to other maps, hidden areas (insets of other maps) | pack: `maps/<id>/map.json` |
| `walls.schema.json` | Wall segments in grid cells (8 types, doors, secret doors, one-way, proximity); doors may be stuck (`stuck_dc`), blocked, or found automatically (`auto_find`) | pack: `maps/<id>/walls.json` |
| `map-state.schema.json` | Door states, found secrets, explored outlines, token cells on one map | save: `maps/<id>.json` |

A schema cannot check everything. `tools/validate.mjs` adds the rest: 1/8 cell snapping, grid bounds, unique ids, door and link references, and proximity distances.

Still to come: `pack`, `room`, `creature ref`, `encounter`, `trigger`, `quest`, `item`, and the rest of the campaign save.
