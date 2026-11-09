# Design: maps, walls, sight and fog

Status: design agreed 2026-11-09. Nothing here is built yet.

This document describes how maps work in Reliquary-VTT: what a map is, how walls and doors are stored, how sight and fog of war are computed, and how a map gets from a book PDF into a usable pack. It builds on the earlier wall-system plan from the first implementation and replaces its raster wall trace with vector wall segments.

## 1. Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Wall precision | Segment endpoints snap to **1/8 cell** (7.5 inches on a 5 ft grid). |
| 2 | Explored area | Stored as **smooth outlines** (polygons) at the same 1/8 cell precision, not as an image. |
| 3 | Remembered vs. visible | Areas explored earlier but not visible now are shown **dimmed**. Only what a PC can see right now is fully lit. |
| 4 | Tokens in remembered areas | Foe and NPC tokens are **hidden from players** unless a PC can currently see them. |
| 5 | Light and vision types | Built **after sight and movement**. The data model reserves the fields now. |
| 6 | Special walls in the first version | Windows, arrow slits, portcullises and grates, one-way walls and terrain walls are all supported and tested from the start. |

Other principles carried over from the reimplementation plan:

- **No wall editor in the board.** Claude builds wall segments when preparing a map, renders an overlay for review, and corrections are made by editing data files.
- **One implementation.** Sight, fog and movement logic is written once, in JavaScript, and shared by the board and the tools.
- **Cells, not pixels.** Everything after grid calibration is measured in grid cells, so data does not depend on the image resolution.
- **Content and state are separate.** The adventure pack holds the shape of a map. The campaign save holds what changes in play.

## 2. Where map data lives

| Layer | Holds | Example |
|---|---|---|
| Adventure pack | Map image, grid calibration, wall segments, door and secret definitions, links between maps | `packs/<pack>/maps/<map>/` |
| Campaign save | Current map, door states, found secrets, explored outlines, token positions | `saves/<save>/maps/<map>.json` |
| Engine | Rendering, the sight and movement engine, the player and GM views | `engine/` |
| Ruleset | Vision range, vision types, movement rules (diagonals, difficult terrain) | `rulesets/<system>/` |

The engine never contains a map id, a level name or a game-system rule.

## 3. Map record (pack)

One folder per map: `maps/<map-id>/` with `map.json`, the image, `walls.json` and the import working files.

```json
{
  "id": "lower-cellars",
  "name": "Lower Cellars",
  "image": { "file": "lower-cellars.webp", "w": 1278, "h": 1655 },
  "grid": {
    "cell_px": 38.29,
    "origin_px": [12.0, 29.9],
    "cols": 33,
    "rows": 42,
    "feet_per_cell": 5
  },
  "walls": "walls.json",
  "links": [
    {
      "id": "stairs-up",
      "label": "Stairs up",
      "at": [[4, 7], [5, 7]],
      "to_map": "upper-hall",
      "arrive": [[20, 3], [21, 3], [20, 4], [21, 4]],
      "found": false
    }
  ]
}
```

- `grid.origin_px` is the pixel position of the corner of cell (0,0). Cell (x,y) covers pixels `origin + [x, y] * cell_px` to `origin + [x+1, y+1] * cell_px`.
- `links` replace the old `game/maps` arrival table. `at` lists the cells that trigger the link, `arrive` lists the cells where travellers are placed on the other map, in order. `found` is the starting state; the save tracks it after that.
- No namespace strings. Saves key per-map state by `id`.

## 4. Wall segments (pack)

`walls.json`:

```json
{
  "v": 1,
  "unit": "cell",
  "snap": 0.125,
  "segs": [
    { "id": "w0001", "a": [12.0, 7.0], "b": [18.5, 7.0], "t": "solid" },
    { "id": "w0002", "a": [18.5, 7.0], "b": [18.5, 9.0], "t": "door",
      "door": { "id": "d07", "label": "Kitchen door", "initial": "closed" } },
    { "id": "w0003", "a": [3.0, 11.0], "b": [3.0, 12.0], "t": "secret",
      "door": { "id": "s02", "label": "Behind the tapestry", "initial": "closed", "dc": 20 },
      "room": "C4" },
    { "id": "w0004", "a": [9.0, 2.0], "b": [9.375, 2.0], "t": "slit",
      "prox": { "sight": 5 } },
    { "id": "w0005", "a": [6.0, 4.0], "b": [6.0, 6.0], "t": "solid", "dir": 1,
      "note": "Illusory wall, see-through from the west" }
  ]
}
```

Rules:

- Every coordinate is a multiple of `snap` (1/8 cell). The validator rejects anything else.
- `id` is stable for the life of the pack. Saves, narration and journal entries refer to segments and doors by id.
- `t` is a preset (section 5). Any segment may override the four sense values with `move`, `sight`, `light`, `sound`.
- `dir`: 0 = blocks from both sides (default), 1 = blocks only from the left of a→b, 2 = only from the right.
- `door.initial` is `closed`, `open` or `locked`. The live state lives in the save.
- `prox` distances are in feet and apply only to proximity senses.
- `room` and `note` are GM-only annotations for tools and Claude.
- Documents are kept under 200 KiB; a large map is split into `walls.json`, `walls-2.json`, and so on.

## 5. Wall types and sense values

Sense values (Foundry's scale): 0 none, 10 limited, 20 normal, 30 proximity, 40 reverse proximity. Movement uses only 0 and 20.

| Type `t` | Use | Move | Sight | Light | Sound |
|---|---|---|---|---|---|
| `solid` | Ordinary wall | 20 | 20 | 20 | 20 |
| `terrain` | Low wall, curtain, tall grass: see past one, not two | 20 | 10 | 10 | 10 |
| `grate` | Portcullis, bars, grate | 20 | 0 | 0 | 0 |
| `window` | Glass window | 20 | 0 | 0 | 10 |
| `slit` | Arrow slit, peephole: see through only from close by | 20 | 30 | 30 | 10 |
| `ethereal` | Ghostly or force barrier you can walk through but not see through | 0 | 20 | 20 | 0 |
| `door` | Door; closed or locked uses these values, open is 0 for everything | 20 | 20 | 20 | 20 |
| `secret` | Secret door: behaves as `solid` and has no icon until found, then as `door` | 20 | 20 | 20 | 20 |

One-way walls are any type with `dir` set. The `light` values are stored now and used when light is built.

## 6. Sense semantics

For one sense, a ray from source P to target Q:

1. Collect the segments the ray crosses. Ignore a segment whose `dir` makes it transparent from P's side.
2. **0 none:** ignore.
3. **20 normal:** the ray stops.
4. **10 limited:** the ray passes the first limited segment and stops at a second limited segment or any normal one.
5. **30 proximity:** treated as none if P is within `prox` feet of the segment, otherwise as normal.
6. **40 reverse proximity:** the opposite: none if P is farther than `prox` feet, otherwise normal.
7. **Doors:** open doors are 0 for every sense. Closed and locked doors use their type's values. An unfound secret door uses `solid`.

The engine applies the same function to sight now, movement next, and light and sound later.

## 7. Map state (save)

`saves/<save>/maps/<map-id>.json`:

```json
{
  "map": "lower-cellars",
  "doors": { "d07": { "state": "open" }, "s02": { "state": "closed", "found": true } },
  "locked_known": ["d09"],
  "links_found": ["stairs-up"],
  "explored": {
    "v": 3,
    "polys": [ [[10.0, 4.125], [18.5, 4.125], [18.5, 9.0], [10.0, 9.0]] ]
  },
  "tokens": { "...": "..." }
}
```

- `doors` only lists doors whose state differs from `door.initial`, plus found secrets.
- `explored.polys` is a list of outer rings in cell coordinates at 1/8 precision. Holes are allowed as rings in the opposite winding order.
- The save also holds `current_map` at the top level. Switching maps changes that pointer; per-map state stays where it is.

## 8. Sight, fog and token visibility

**Visibility polygon.** `visPolygon(origin, prepared, {rangeFt, feetPerCell})` returns the area visible from a point. It casts a ray toward every wall endpoint in range (and a hair to either side of it) plus 180 evenly spaced rays for the range circle, applies the semantics in section 6 along each ray, and joins the hit points in angular order. Range comes from the ruleset (for PF2E the current table uses 200 ft). Built in `engine/sight/visibility.js`; about 80 ms for four PCs on a 300-segment map, recomputed only when a token moves or a door changes.

**Token footprints.** A token's `size` is the side of its space in cells. The ruleset maps size names to footprints (PF2E: Tiny 0.5, Small and Medium 1, Large 2, Huge 3, Gargantuan 4 or more); the engine only sees the number. A Small creature occupies a full square, like a Medium one, so its footprint stays 1x1 for sight, movement and sharing. Only its token is drawn smaller: 0.75 of a Medium token, centred in the square (`small: true` on the token; `engine/tokens/display.js`).

A Tiny token's position is its square (whole-number x, y); `engine/tokens/tiny.js` lays it out inside the square:

- Alone in its square: centred.
- With other Tiny tokens: one quadrant each, up to four per square (a fifth is reported as overfull; the board warns, the GM decides). Free quadrants are handed out top-left, bottom-right, top-right, bottom-left, so two tokens sit on a diagonal. Each token keeps its quadrant (`slot`, stored on the token) while others arrive or leave; a token that moves to another square gives its quadrant up.
- Sharing its square with a bigger creature: a quadrant, so it is not hidden under the bigger token.

Sight, being seen and drawing use the laid-out space; movement uses the centre of the square, so Tiny tokens move square to square.

**Viewing points.** A token sees from points spread around the edge of its space: the four corners (inset slightly) plus the centre of every cell along the edge. A 1x1 token uses its centre and four corners (5 points); 2x2 uses 8, 3x3 uses 12, 4x4 uses 16. Interior cells add nothing, because anything they could see is also visible from the edge. A viewpoint that the token's own centre cannot see is dropped, so a large token pushed against or squeezing past a wall never sees through that wall. What a token sees is the union of the polygons from its viewpoints. Built as `viewpoints()` in `engine/sight/visibility.js`.

**Being seen.** A token is visible when a viewer can see any of its sample points (the same set of points as above), so a Huge creature with part of its space past a corner is spotted. This follows the Player Core rule that a creature has no line of effect only when it is entirely behind a barrier.

**Cover is separate.** Cover uses the rulebook's centre-to-centre line (and the large-creature cover rule). It belongs to the ruleset, which uses the engine's line test.

**GM vision view.** In the GM view, clicking any token (NPC, foe or PC) shades the area that token can see right now, using its own viewpoints and vision range. This is display only: it never changes the explored area and never reaches the player view. Clicking empty map or pressing Esc clears it.

**Three fog states for players:**

| State | Shown as |
|---|---|
| Visible now (union of every living, visible PC's polygon) | Clear |
| Explored but not visible now | Dimmed map, no foe or NPC tokens |
| Never explored | Fog |

**Explored update.** When the visible area changes, it is merged into `explored` (`engine/fog/explored.js`). The engine keeps a bitmap with 8 x 8 pixels per cell (1/8 cell), sampled at pixel centres: it fills in the stored outlines, adds the new visibility polygons, and traces the pixel edges back into outlines. The traced outlines are simplified only when the simplified version fills exactly the same pixels, so saving and reloading can never grow or shrink the explored area on its own. Where two explored areas touch only at a corner, tracing keeps them as separate rings.

The board keeps the bitmap in memory while play goes on and traces outlines only when it saves, a short delay after the last change. Measured on a 33 x 42 level with 200 walls: about 35 ms per merge (62 ms worst), and 30 moves of exploring produced 28 rings, 308 points, 3.6 KiB.

**Stored versus painted outlines.** Tracing pixel edges turns every diagonal into a staircase of 1/8-cell steps. The stored outlines keep that staircase, because they must fill exactly the explored pixels: that is what guarantees saving and reloading never changes the explored area. For painting, `displayPolys()` / `displayOutlines()` straighten each outline: the inner corner of every one-pixel step is cut and nearly straight runs are merged, so a diagonal becomes one straight line (a long wedge goes from about 186 points to 12). Straightening only ever adds explored area, at most 1.5 pixels (about 11 inches) and typically 3 to 4 inches, and is checked to cover every explored pixel. Display outlines are recomputed from the stored ones and never saved: straightening an already straightened shape would push its edges out further on every save (measured at about 100 pixels per merge before this rule).

**Painting.** `paintFog` (`engine/fog/view.js`) paints the fog onto a canvas: fog over everything, cut down to the dimmed level over explored areas (drawn from the display outlines), and cut away over what is visible now. The explored edge gets a light 3-pixel blur; the edge of what is visible now stays sharp. The GM view uses the same painter with a light tint instead of fog.

**Who looks and who is seen.** `partyView` returns the visible polygons and the set of tokens players may see. By default every living PC that is not GM-hidden looks, using the map-wide vision range; the ruleset narrows this (unconscious, blinded) and gives tokens their own ranges. GM-hidden tokens are never shown to players; PCs and markers always are.

**Tokens.** A foe or NPC token is shown to players only if a PC can currently see one of its sample points (see Being seen). PCs and the party's own markers are always shown. The GM view shows everything.

**Doors.** A door icon appears once its segment lies in an explored area. Unfound secret doors never get an icon in the player view.

## 9. Movement

Built in `engine/movement/movement.js`; tools reach it through `tools/move.mjs`.

**A step.** `canStep(walls, token, dx, dy)` checks one 8-way step of a token's whole space:

- The space at the destination must fit: inside the grid, and no movement-blocking wall through it.
- The area swept by the step must not cross a wall. For a diagonal step that is the whole box around the start and end spaces, so a diagonal never cuts past a wall corner.
- One-way walls block only when the token's centre starts on their restricted side.
- A token already overlapping a wall (squeezing) may step away from it but not deeper into it.

**Fitting.** Large creatures need room for their whole space: a 2x2 ogre cannot pass a 5-ft door or corridor. `fits(walls, x, y, size)` answers whether a space is clear.

**Paths and reach.** `path()` finds the cheapest route to a destination and `reach()` lists every position within a movement allowance (for showing where a token can go). Both use a shortest-cost search over positions. The ruleset supplies the rules as options:

| Option | Purpose | PF2E | D&D 5e |
|---|---|---|---|
| `diagonalCosts` | Cost of successive diagonal steps, in cells, repeating | `[1, 2]` (5-10-5, the default) | `[1]` |
| `enterCost(x, y, size)` | Extra cost for entering a space | +1 per difficult square, +2 greater difficult | +1 per difficult square |
| `passable(x, y, size)` | Spaces the mover cannot pass (other creatures) | three-size rule, Tiny sharing | ruleset's own |
| `size` | Move with a smaller footprint | when squeezing is allowed | ruleset's own |

**Sharing space.** Two creatures may end their move in the same squares when one footprint is at least two squares wider than the other: a 1x1 with a 3x3 or 4x4, and a 2x2 with a 4x4. Tiny creatures share with anyone (up to four Tiny per square). `engine/tokens/occupancy.js` holds this as data (`SHARE_RULE = {tiny: true, minGap: 2}`) with `mayShare` and `blockersAt`, so a table or ruleset can change it. This is this table's rule; the Player Core as written only lets a creature move through the space of one three or more sizes larger, not end its move there. The board warns when a move ends somewhere sharing is not allowed and never prevents it; smaller creatures are drawn on top of bigger ones.

**Which walls block movement:** solid, terrain, grate (portcullis), window, slit, closed and locked doors, and secret doors until found and opened. Ethereal barriers and open doors do not.

**Board behaviour.** The board may warn when a PC token is dragged through a blocking wall or into a space it does not fit. It never prevents the move; the GM decides.

**Performance.** On a 40 x 40 map with 300 walls: about 37 ms for three long paths (1x1, 2x2, 4x4), and about 13 ms for every position a Medium creature can reach in 50 ft.

## 10. Secrecy

The player view receives a projection of the map data:

- Unfound `secret` segments become plain `solid` segments with no door data.
- `room`, `note`, door `label` (for unfound doors) and `dc` are removed.
- Locked doors look closed until `locked_known` lists them.

The GM view and Claude read the full records.

## 11. One engine, two callers

- The sight, fog and movement code is a dependency-free JavaScript module in `engine/` that runs in the browser and in Node.
- Tools that need sight or movement answers (Claude checking "can this foe see that PC", a pathfinding check) call it through a small Node command-line wrapper in `tools/`.
- A shared table of rays and expected results tests the semantics in section 6.

## 12. Import pipeline

A map goes from a PDF the user owns to pack data in these steps, all run by Claude in its workspace:

1. **Extract** the map image from the PDF.
2. **Calibrate** the grid: cell size and origin, checked by overlaying the grid at far corners.
3. **Detect** walls and doors from the image (a port of the first implementation's detector, with its `rock` and `dark_outline` modes).
4. **Vectorize** the detected walls into segments, snap endpoints to 1/8 cell and merge collinear runs.
5. **Correct** with `corrections.json` in cell coordinates: erase areas, add segments, delete or retype segments.
6. **Add specials** from the module text and keyed map in `walls-extra.json`: secret doors, windows, arrow slits, grates, one-way and terrain walls.
7. **Validate:** endpoints on the 1/8 grid, unique ids, every door has a door id, and a closed-rooms check that flags gaps where sight could leak.
8. **Review** an overlay image (colour per wall type, arrows for one-way walls, door markers) quarter by quarter.

Steps 3 and 4 only propose. Nothing is written into a pack without review.

## 13. Licensing

Maps from commercial adventures, and walls traced from them, are derived from the publisher's book. They live only in the user's private `packs/` folder, which git ignores. The repository's tests and `examples/` use small original maps drawn for this project.

## 14. Tests

- **Semantics table:** rays and expected results for every rule in section 6 (limited needs two walls to stop, proximity both ways, direction, open doors, unfound secret doors).
- **Sample maps:** golden positions on the original example maps: viewer cell plus the cells expected visible, plus movement checks.
- **Private golden positions:** for a user's own packs, such as the known problem spots from the first campaign. Run locally and never committed.

## 15. Build order

1. JSON schemas for the map record, wall segments and map state, plus a validator. Done.
2. The sight engine and its semantics tests, using a small original sample map. Done.
3. Movement (`canStep`, `fits`, `path`, `reach`). Done.
4. Explored-area merging and the three-state fog renderer. Done.
5. The import pipeline, then converting the first campaign's levels into a private pack and running the private golden positions.
6. Light and vision types (darkvision, low-light), then sound.

## 16. Open items

- Maps with several floors or heights in one image (balconies, pits).
- How map images are hosted for the board (published as artifact files, referenced by id from the pack).
- Wall edges at the limit of sight: visibility stops at a wall's centre line, so half of a drawn wall can stay fogged. The first implementation revealed thin walls whole and thick walls to their middle; decide whether to do the same when the board is built.
- Whether `links` need conditions beyond `found` (one-way links, links that need a key).
