# Best practices: movement and tokens

For Claude and for board code using `engine/movement/` and `engine/tokens/` (design: [maps.md](../design/maps.md) sections 8 and 9).

## Movement

- Check routes with the engine (`path`, `reach`, or `node tools/move.mjs`) before narrating that a creature gets somewhere, and use the save's door states.
- The board **warns and never prevents**. A move with no legal route, beyond a creature's Speed, into a space it does not fit, or onto a creature it may not share with is allowed and logged as a GM call.
- Game rules come in as options from the ruleset: diagonal costs (PF2E 5-10-5 is the default; D&D 5e is `[1]`), terrain (`enterCost`, built with `terrainEnterCost` from the map's terrain and the ruleset; see [terrain.md](terrain.md)), creatures in the way (`passable`), squeezing (a smaller `size`). Do not put system rules in the engine.
- Every call that moves a creature needs that creature's terrain costs: build the options per mover (speeds, flying, what it ignores), not once for the board.
- **Movement range on the board:** dashed outlines, no fill (a fill reads as light), round where one, two and three Strides reach (`strideReach`: light, medium and dark green, long, medium and short dashes, each with a dark edge, drawn at 50 % opacity; where bands share an edge, as down a dead-end corridor or along a wall, only the nearest band's line is drawn; dash lengths and widths scale with the grid). Shown for the selected token (a player's PC; any token for the GM) and while it is dragged, **only while an encounter is under way** (begun and not ended; the user's choice, 2026-11-12: outside combat they are clutter). The encounter tracker tells the board (`onEncounter`) when one begins or ends. Drawn only over squares the current view sees, so the outline never traces walls in the fog; the real walls still decide what is reachable. To answer "can I reach him with two actions?", use `strideReach`, not `reach` with double the Speed: two Strides can reach less (feet left over are lost).
- Distances (reach, range, rulers) come from `engine/measure/`; terrain never changes a distance, only what moving costs.
- Clearance: walls may poke 0.3 cells into a square without blocking it, because drawn doorways are often off-grid. A 5-ft doorway offset by half a cell still blocks grid movement; that is a GM call.

## Sharing space

- The table's rule (data, `SHARE_RULE`): two creatures may share squares when one footprint is at least two squares wider (1x1 with 3x3 or 4x4; 2x2 with 4x4). Tiny creatures share with anyone, up to four per square.
- This is looser than the Player Core as written (move through, not end in, a space three or more sizes larger). Say so if a player asks what the rule is.

## Tokens

- `size` is the footprint in cells: Tiny 0.5, Small and Medium 1, Large 2, Huge 3, Gargantuan 4. The ruleset sets it from the creature's size.
- Small creatures: `small: true`. Their space is a full square; only the token is drawn at 3/4 size.
- Tiny creatures: position is their square. Store the `slot` that `layoutTiny` returns so each keeps its quadrant; clear it when the token moves to another square. Alone in a square (even inside a big creature), a Tiny token is centred.
- Draw tokens biggest first, so a creature sharing a bigger one's space stays visible.
- **Waypoints while dragging** (Space, as the old board's ruler; 2026-11-12): dragging one token, Space drops a waypoint where the token is now, Backspace takes the last one back. With no waypoints the route is the cheapest path; with waypoints each leg is the cheapest path from the point before (`pathVia`), and the diagonal count carries on from leg to leg, as in one move. Each waypoint shows as a dot with the distance travelled so far stamped beside it (the sum of `pathVia`'s `legs` up to it; terrain included; the user's choice, 2026-11-12); the label gives the total, the leg being drawn ("this leg 15 ft") and how many waypoints there are. The label sits above the goal square, lifted above the height label ("+50 ft") when the token has one, which would otherwise cover it. It works in and out of combat, and it is this screen's only: nothing is shared until the token is dropped. A group drag has no route, so no waypoints. Use `pathVia` too when a player describes a route ("round the pillar, then to the door").
- **Click priority on the board:** a token's drawn disc takes a click before a door, then a door, then the rest of a token's square. Doors often run through the middle of a square, and a token standing in a doorway must still be draggable; the parts of the door outside the token stay clickable (the other leaf of a double door, the door's ends).

## Moving the party together: marching order (2026-11-14)

- A party arriving on a map, or moved by Claude in narration, is placed by `placeFormation` (`engine/tokens/marching.js`).
  Each member goes to its place in the marching order's block, turned the way the party heads. Where the block does
  not fit, the party goes in column. Only squares that can be walked to are used, never one behind a wall, and never
  a square the party has not explored except a member's own place and the arrival or destination square.
- Only the formation's shape counts (the bounding box of the occupied squares), not where on the 4 x 4 grid it was
  drawn.
- Several selected tokens dragged together keep their own spacing; that is not marching order.
- The board and Claude's tool: [board.md](board.md) (Marching order); the design: docs/design/board.md ("The party's
  marching order").
