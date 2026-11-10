# Best practices: movement and tokens

For Claude and for board code using `engine/movement/` and `engine/tokens/` (design: [maps.md](../design/maps.md) sections 8 and 9).

## Movement

- Check routes with the engine (`path`, `reach`, or `node tools/move.mjs`) before narrating that a creature gets somewhere, and use the save's door states.
- The board **warns and never prevents**. A move with no legal route, beyond a creature's Speed, into a space it does not fit, or onto a creature it may not share with is allowed and logged as a GM call.
- Game rules come in as options from the ruleset: diagonal costs (PF2E 5-10-5 is the default; D&D 5e is `[1]`), terrain (`enterCost`, built with `terrainEnterCost` from the map's terrain and the ruleset; see [terrain.md](terrain.md)), creatures in the way (`passable`), squeezing (a smaller `size`). Do not put system rules in the engine.
- Every call that moves a creature needs that creature's terrain costs: build the options per mover (speeds, flying, what it ignores), not once for the board.
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
