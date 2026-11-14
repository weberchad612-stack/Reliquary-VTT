# Design: maps, walls, sight and fog

Status: design agreed 2026-11-09. Nothing here is built yet.

This document describes how maps work in Reliquary-VTT: what a map is, how walls and doors are stored, how sight and fog of war are computed, and how a map gets from a book PDF into a usable pack. It builds on the earlier wall-system plan from the first implementation and replaces its raster wall trace with vector wall segments.

## 1. Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Wall precision | Segment endpoints snap to **1/8 cell** (7.5 inches on a 5 ft grid); maps imported at print resolution use **1/32 cell** (`snap: 0.03125`, 2026-11-13) with nearly-meeting ends welded together. |
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
| Adventure pack | Map image, grid calibration, wall segments, door and secret definitions, terrain areas, links between maps | `packs/<pack>/maps/<map>/` |
| Campaign save | Current map, door states, found secrets, explored outlines, token positions, temporary terrain and terrain switched on or off | `saves/<save>/maps/<map>.json` |
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
      "to_link": "stairs-down",
      "arrive": [[20, 3], [21, 3], [20, 4], [21, 4]],
      "found": false
    }
  ]
}
```

- `grid.origin_px` is the pixel position of the corner of cell (0,0). Cell (x,y) covers pixels `origin + [x, y] * cell_px` to `origin + [x+1, y+1] * cell_px`.
- `links` replace the old `game/maps` arrival table. `at` lists the cells that trigger the link, `arrive` lists the cells where travellers are placed on the other map, in order. `to_link` names the partner entrance on the other map (the one that leads back), so the board knows where the party arrives and which way back becomes known; the validator warns when it is missing or does not lead back. `found` is the starting state; the save tracks it after that (`links_found`).
- `start` (battle maps): the starting area, cells where the party is placed when it travels here without
  an entrance (from the map menu, or from a town), in order; more PCs overflow onto the nearest free squares
  that can be walked to. Every battle map should have one (the validator warns): put it where the party
  would logically arrive, like the road or path into the map (the Sample Keep's is on the path south of
  the gate).
- No namespace strings. Saves key per-map state by `id`.

### 3a. Area maps (towns and regions)

A map with `"kind": "area"` is a picture with places, not a battle map: no grid, walls, terrain, lighting,
links, tokens or fog (the schema refuses those fields). The board shows it fitted to the window with each
place as a pin (docs/design/board.md, section 7). The party travels to it as a whole; where it goes inside
is told in chat.

```json
{
  "id": "otari", "name": "Otari", "kind": "area",
  "image": { "file": "otari.webp", "w": 922, "h": 1197 },
  "places": [
    { "id": "rockfish", "name": "The Rowdy Rockfish", "type": "Tavern and inn", "address": "50 Zarmavdian Street",
      "note": "Paraphrased, player-safe description.", "at": [317, 921] },
    { "id": "hideout", "name": "A hideout", "at": [300, 800], "public": false, "gm_note": "..." },
    { "id": "road-north", "name": "Road north", "at": [862, 102], "shape": "wide", "size": 130 }
  ]
}
```

- Adventure maps print their own location numbers. Put `at` on the printed marker and set `size` so the
  pin rings it; `number` repeats the printed number ("14") for the card. The pin is only a ring: its inside
  stays clear, and selection, hover and a waiting request show on and outside the ring. A GM-only place's
  number is still printed on the picture; only its pin and card are hidden (strip it with
  `tools/mapimport/strip_numbers.py`: docs/best-practices/map-importer.md, section 5b).
- `at` is the pin's centre in image pixels; `size` its width in pixels (default 4.5% of the image width);
  `shape: "wide"` is a pill 5.5 times as wide as tall, for roads and districts at the edges.
- `public: false` keeps a place GM-only until Claude marks it found (`places_found` in the map state).
- Places do not link to battle maps: the map menu is the way to other maps (agreed with the user).
- A battle map's link may lead to an area map (`to_map` only, no `to_link`: an area map has no entrances).
  Leaving an area map, the party arrives on the chosen entrance's own squares.

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

- Every coordinate is a multiple of `snap` (0.125, or 0.03125 for maps imported at print resolution). The validator rejects anything else.
- **Thickness** `w` (cells, up to 2): the segment is a wall's centre line and the wall is a box w wide, squared off w/2 past each end. Light, sound and movement meet the box's four faces; sight, from each viewer, stops at the box's far face and its two end caps, so the fog reveals the whole drawn wall and two thick walls meeting at a corner leave no gap. Without `w` a wall is a line. Not allowed on doors, veils, one-way or proximity walls.
- `id` is stable for the life of the pack. Saves, narration and journal entries refer to segments and doors by id.
- `t` is a preset (section 5). Any segment may override the four sense values with `move`, `sight`, `light`, `sound`.
- `dir`: 0 = blocks from both sides (default), 1 = blocks only from the left of a→b, 2 = only from the right.
- `door.initial` is `closed`, `open` or `locked`. The live state lives in the save.
- **Door leaves.** Every door segment is one leaf. A double door is two leaves that meet end to end on one line and name each other in `door.pair`; each leaf has its own state, icon and click, and a page may offer "both leaves" (the demo: Shift+click). `door.hinge` (`a` or `b`, default `a`) is the end the leaf turns on; `door.swing` (`left` or `right` of a→b, default `left`) is the side it opens toward. Double-door leaves hinge at the outer ends. `engine/doors/leaf.js` gives the shapes to draw: the panel in the doorway when closed, swung 90 degrees on its hinge when open, and the swing arc. Players see a door only where they have explored; a known lock shows a padlock.
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
| `veil` | A visible magical barrier (a curtain of darkness, a shimmering ward): door-like, with a `door` id; it stands (`closed`) or is dispelled (`open`, 0 for everything); never locked, no leaf; the GM switches it with one click, players only see it | 20 | 20 | 20 | 0 |

One-way walls are any type with `dir` set. The `light` values are stored now and used when light is built.

## 6. Sense semantics

For one sense, a ray from source P to target Q:

1. Collect the segments the ray crosses. Ignore a segment whose `dir` makes it transparent from P's side.
2. **0 none:** ignore.
3. **20 normal:** the ray stops.
4. **10 limited:** the ray passes the first limited segment and stops at a second limited segment or any normal one.
5. **30 proximity:** treated as none if P is within `prox` feet of the segment, otherwise as normal.
6. **40 reverse proximity:** the opposite: none if P is farther than `prox` feet, otherwise normal.
7. **Doors:** open doors (and dispelled veils) are 0 for every sense. Closed and locked doors use their type's values. An unfound secret door uses `solid`.

The engine applies the same function to sight, movement and light, and to sound: the board muffles effects and ambient sounds behind walls that stop sound (2026-11-13, docs/best-practices/sound.md).

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

**Visibility polygon.** `visPolygon(origin, prepared, {rangeFt, feetPerCell})` returns the area visible from a point. It casts a ray toward every wall endpoint in range (and a hair to either side of it) plus 180 evenly spaced rays for the range circle, applies the semantics in section 6 along each ray, and joins the hit points in angular order. Range defaults to unlimited, as PF2E vision has none (walls and darkness limit sight): a ray that hits nothing stops just past the map's edge (`grid` option, or the walls' extent). A ruleset or a special sense can still pass a range. (Until 2026-11-10 the board used 200 ft.) Built in `engine/sight/visibility.js`; about 80 ms for four PCs on a 300-segment map, recomputed only when a token moves or a door changes.

**Token footprints.** A token's `size` is the side of its space in cells. The ruleset maps size names to footprints (PF2E: Tiny 0.5, Small and Medium 1, Large 2, Huge 3, Gargantuan 4 or more); the engine only sees the number. A Small creature occupies a full square, like a Medium one, so its footprint stays 1x1 for sight, movement and sharing. Only its token is drawn smaller: 0.75 of a Medium token, centred in the square (`small: true` on the token; `engine/tokens/display.js`).

A Tiny token's position is its square (whole-number x, y); `engine/tokens/tiny.js` lays it out inside the square:

- Alone in its square: centred.
- With other Tiny tokens: one quadrant each, up to four per square (a fifth is reported as overfull; the board warns, the GM decides). Free quadrants are handed out top-left, bottom-right, top-right, bottom-left, so two tokens sit on a diagonal. Each token keeps its quadrant (`slot`, stored on the token) while others arrive or leave; a token that moves to another square gives its quadrant up.
- Alone in a square that a Large, Huge or Gargantuan creature covers: centred, drawn on top of it.
- Sharing its square with a Small or Medium creature: a quadrant, so the two tokens do not cover each other's centres.

Sight, being seen and drawing use the laid-out space; movement uses the centre of the square, so Tiny tokens move square to square.

**Viewing points.** A token sees from points spread around the edge of its space: the four corners (inset slightly) plus the centre of every cell along the edge. A 1x1 token uses its centre and four corners (5 points); 2x2 uses 8, 3x3 uses 12, 4x4 uses 16. Interior cells add nothing, because anything they could see is also visible from the edge. A viewpoint that the token's own centre cannot see is dropped, so a large token pushed against or squeezing past a wall never sees through that wall. What a token sees is the union of the polygons from its viewpoints. Built as `viewpoints()` in `engine/sight/visibility.js`.

**Being seen.** A token is visible when a viewer can see any of its sample points (the same set of points as above), so a Huge creature with part of its space past a corner is spotted. This follows the Player Core rule that a creature has no line of effect only when it is entirely behind a barrier.

**Cover is separate.** Cover uses the rulebook's centre-to-centre line (and the large-creature cover rule). It belongs to the ruleset, which uses the engine's line test.

**A creature's own view.** Selecting a token shows the board through its eyes: only what it perceives now, using its own viewpoints, senses and the light; nothing remembered; only the tokens it sees. The GM can select any token (NPC, foe or PC), a player only a PC. This is display only: it never changes the explored area. Clicking empty map or pressing Esc returns to the whole map. (First built as a shaded overlay; replaced 2026-11-10, see [lighting.md](lighting.md) section 11.)

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

**Clearance.** Walls may poke up to 0.3 cells (1.5 ft) into a square without blocking it (`CLEARANCE`, overridable per call). Hand-drawn maps rarely line doorways up with the grid: Gauntlight Ruins' A1 door is 1.5 cells wide and centred on a grid line, leaving a quarter-cell jamb in each square. A creature needs its width minus 0.6 cells of clear space, so a 2x2 creature still cannot use a 5-ft door. Known limit: a 5-ft doorway offset by half a cell puts a jamb through the middle of both squares beside it, so grid movement cannot pass it; the board warns and the GM decides.

**Paths and reach.** `path()` finds the cheapest route to a destination and `reach()` lists every position within a movement allowance (for showing where a token can go). `strideReach()` gives where one, two and three Strides reach: each Stride is its own move up to the creature's Speed, so feet left over from one are lost, while the 5-10-5 diagonal count runs across the whole turn (Player Core: it resets only at the end of the turn); Stride k searches from every position and diagonal count Stride k-1 can end on, so the bands are exact. All use a shortest-cost search over positions. The ruleset supplies the rules as options:

| Option | Purpose | PF2E | D&D 5e |
|---|---|---|---|
| `diagonalCosts` | Cost of successive diagonal steps, in cells, repeating | `[1, 2]` (5-10-5, the default) | `[1]` |
| `enterCost(x, y, size, fromX, fromY)` | Extra cost for moving the space from one position to the next; `Infinity` when walking cannot do it (deep water, a slope to climb) | from the terrain layer (section 9a): +1 difficult, +2 greater difficult | +1 per difficult square |
| `passable(x, y, size)` | Spaces the mover cannot pass (other creatures) | three-size rule, Tiny sharing | ruleset's own |
| `size` | Move with a smaller footprint | when squeezing is allowed | ruleset's own |

**Sharing space.** Two creatures may end their move in the same squares when one footprint is at least two squares wider than the other: a 1x1 with a 3x3 or 4x4, and a 2x2 with a 4x4. Tiny creatures share with anyone (up to four Tiny per square). `engine/tokens/occupancy.js` holds this as data (`SHARE_RULE = {tiny: true, minGap: 2}`) with `mayShare` and `blockersAt`, so a table or ruleset can change it. This is this table's rule; the Player Core as written only lets a creature move through the space of one three or more sizes larger, not end its move there. The board warns when a move ends somewhere sharing is not allowed and never prevents it; smaller creatures are drawn on top of bigger ones.

**Which walls block movement:** solid, terrain, grate (portcullis), window, slit, closed and locked doors, and secret doors until found and opened. Ethereal barriers and open doors do not.

**Board behaviour.** The board may warn when a PC token is dragged through a blocking wall or into a space it does not fit. It never prevents the move; the GM decides.

**Performance.** On a 40 x 40 map with 300 walls: about 37 ms for three long paths (1x1, 2x2, 4x4), and about 13 ms for every position a Medium creature can reach in 50 ft.

## 9a. Terrain

Terrain is a separate layer from walls: walls stop movement and sight along lines; terrain changes what moving through whole squares costs and what it calls for. (The wall type `terrain` is a different thing, a low wall or curtain that limits sight; see section 5.)

**Data.** A map may name a terrain file (`map.json` `terrain`, schema `schemas/terrain.schema.json`). It holds areas; each area is a set of squares (`rects` `[x, y, w, h]` and/or `cells`) with:

| Field | Meaning |
|---|---|
| `kind` | `difficult`, `greater_difficult` (cost extra movement); `swim`, `climb` (need that action unless the creature has the speed); `uneven`, `narrow` (Balance); `hazardous` (damage) |
| `cause` | What makes it so: `rubble`, `mud`, `water`, `glass`, `sinkhole`, `plants`... Rulesets use it for creatures that ignore some terrain ("skitters over rubble") |
| `magical` | Created by magic; abilities that ignore natural terrain do not ignore it, and flying creatures are still affected |
| `dc`, `damage` | The check the area calls for; the damage of hazardous terrain |
| `active` | `false`: the area starts switched off (a bridge or pier that will collapse into water and mud) |
| `label`, `room`, `note` | For the board, narration and the GM |

Whole squares, not shapes: the PF2E rules count terrain per square entered, and so do D&D and most grid games. If gridless play is ever needed, an area can gain a polygon; the square list stays the grid answer.

**The save** adds temporary areas (`terrain`, the same shape plus `source` and `until`: a spell's entangling plants), switches pack areas off (`terrain_off`: the rubble has been cleared) and on (`terrain_on`: the drawbridge has collapsed). The validator checks every id.

**Engine.** `engine/terrain/terrain.js` knows where areas are and nothing about what they cost:

- `TerrainMap(packAreas, state)`: the areas that apply now, indexed by square; `at(x, y)`, `inSpace(x, y, size)`.
- `entered(fromX, fromY, toX, toY, size)`: the areas a move enters, counting only squares of the new space that were not part of the old one. A creature already in difficult terrain pays again for each new square.
- `terrainEnterCost(terrain, rules, mover)` gives the movement engine its `enterCost` option for one creature; `routeTerrain(...)` lists, step by step, the extra cost and the checks a route calls for (board warnings, narration).

**Ruleset.** `rulesets/pf2e/terrain.js` holds the Pathfinder 2e rules (Player Core, paraphrased):

- Entering a square of difficult terrain costs 5 ft more, greater difficult terrain 10 ft more. The extra is the same on a diagonal: the 5-10-5 pattern still applies underneath (a diagonal into difficult terrain costs 10 or 15 ft).
- Terrain does not stack: on one step the worst area entered counts.
- A creature that ignores difficult terrain treats greater difficult terrain as difficult. A mover describes what it ignores: `ignoreDifficult: true`, `{causes: ['rubble']}`, or `{natural: true}` (not magical areas).
- You cannot Step into difficult terrain (`canStepInto`); the board logs such a move as a Stride.
- Swim and climb areas need the Swim or Climb action unless the creature has that speed: walking routes go round them (`Infinity`) and the board lists the check. Uneven ground and narrow surfaces call for Balance; hazardous terrain deals its damage. Flying creatures pass over ordinary ground terrain but not magical areas (a GM call either way).
- **Larger creatures (a table ruling to confirm):** the rules do not say how terrain applies to a creature larger than one square. The engine charges a Large or bigger creature once per step, for the worst area among the new squares it enters.
- **Not yet wired:** this table's ruling that moving through an ally's square counts as difficult terrain needs the token layer; it fits the same `enterCost` hook.

**Import.** The importer's terrain step (`tools/mapimport/terrain.py`) builds areas from the adventure text and the art: squares chosen by room, rectangle or polygon, filtered by how much of each square shows a sampled colour (rubble, water), with explicit additions and exclusions, split into one area per keyed room where useful. See the best-practices guide for terrain.

**Board.** Each square of an area carries a mark (red up-chevrons for difficult terrain, two for greater difficult, waves for swim, an arrow for climb, a zigzag for Balance, ! for hazards) and each area a thin outline. Marks are drawn on the map under the fog, so players see terrain only where they have explored, dimmed where it is only remembered. Areas that start switched off show to the GM as dashed outlines. Routes and movement ranges include terrain costs; the route label shows the extra feet and any checks.

## 9b. Distance and measurement

`engine/measure/measure.js`. Terrain never changes a distance; it changes what moving costs.

- `gridDistance(dx, dy, diagonalCosts, parity)`: cells to cover a displacement with the ruleset's diagonal pattern (PF2E 5-10-5).
- `rulerLength(points)`: a ruler through waypoints, the diagonal pattern carrying on from one leg to the next as it does in one continuous move.
- `spaceDistance(a, b)`: distance between two creatures' spaces for reach and range, from a square of one to the nearest square of the other (adjacent is 5 ft).
- `pathVia(walls, token, points, opts)` (in `engine/movement/movement.js`): the cheapest path through waypoints, leg by leg, the diagonal count carrying on between legs; the board's Space waypoints while dragging a token use it.
- `routeCost(walls, token, cells, opts)` (in `engine/movement/movement.js`): the cost of a route the mover chooses through waypoints, rather than the cheapest one, step by step, flagging steps that are not legal moves without refusing them.

The board's drag-through-waypoints movement uses `pathVia` (a ruler tool would use `rulerLength`); Claude's narration and the query tools use the same functions so the board and Claude never disagree about a distance.

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

**As built (`tools/mapimport/`, first used on Gauntlight Ruins, 2026-11-09).** One settings file per map (`import.json` in the private pack) drives the whole run, so re-running gives the same result:

- The map image is the largest image on the PDF page that is not shared with other pages (page backgrounds are). The grid is found automatically and refused when no clear grid shows (manual values always work).
- Walls are dark, not strongly coloured pixels with water and vegetation hues excluded; very dark thin lines are kept separately for thin drawn walls; only shapes that come near a room floor count. A smoothing step seals moss bites and block joints.
- Doors are long, thin near-white bars; two in line are a double door, made into two paired leaves split halfway between the bars and named by compass direction ("west leaf"). The swing side (and a single door's hinge) is the one whose sweep crosses the least wall in the art; a `doors` correction can set `swing` (and `hinge` on a single door). Windows are runs of glass colour. Segment ends reach into the wall so nothing leaks beside them. Each detected door's opening is cleared through the full wall thickness before tracing; otherwise the dark frame around the door art makes the wall outline pinch the doorway (on Gauntlight Ruins, 18 of 29 doors were pinched, several shut completely).
- Arrow slits are proposed where the smoothing bridged a gap that joins two spaces and the original art is open through it. Moss over a wall can pass that test too, so each map's settings accept or reject the proposals (`slits.reject_near`) and can add slits the drawing does not show (`openings`).
- Corrections in cell coordinates: `erase` (rectangles or polygons: stairs, rubble), `add` (explicit segments, such as secret doors placed from the book's labelled map), `doors` and `windows` (properties such as stuck, blocked, barred window, stained glass), and exclusions (`hide: true` makes an inset a hidden area of the map).
- Checks: the schema validator, then a leak check that looks from inside every room with all doors closed and flags anything outside that it can see. On Gauntlight Ruins it found five real gaps, all fixed, and three openings that the drawing shows on purpose. The validator also checks the opposite: that every open door can be seen and walked through (a "walls pinch the doorway" warning).
- **Print-quality, thin-line maps (2026-11-13, the first adventure import).** A map names an art-style profile (`profiles.json`) and overrides only what differs. Detection runs on a smaller copy; grid lines are suppressed; straight walls are proposed by the tool (or listed by hand), measured to their centre line and thickness, and written as thick segments (`w`); doors and windows are moved onto their line and cut out of it; each keyed room's interior is erased from the mask; what is left is traced, walls near the axes are squared, and nearly-meeting ends are welded on the 1/32 snap. Barriers the text says vanish are `veil` walls. The check is `tools/mapcheck.mjs`: sight from every keyed room (the room table) with doors closed, and listed walking routes with doors open. Guide: [map-importer.md](../best-practices/map-importer.md) section 4b.
- The rule for drawing versus text (Chad, 2026-11-09): where the map explicitly draws something, the drawing wins; the adventure text fills in what the drawing cannot show (secret doors, arrow slits, stuck doors, what a window is made of). Every decision is listed in the map's `import.json`.

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
5. The import pipeline, then converting the first campaign's levels into a private pack and running the private golden positions. Pipeline and Level 1 done; Levels 2 and 3 to follow.
6. Light and vision types (darkvision, low-light), then sound. Light and vision done: [lighting.md](lighting.md). Sound done (2026-11-13): [sound.md](../best-practices/sound.md).

## 16. Open items

- Maps with several floors or heights in one image (balconies, pits).
- How map images are hosted for the board (published as artifact files, referenced by id from the pack).
- ~~Wall edges at the limit of sight~~: settled by wall thickness (2026-11-13): a wall with `w` is seen to its far face, so the whole drawn wall is revealed.
- Whether `links` need conditions beyond `found` (one-way links, links that need a key).
