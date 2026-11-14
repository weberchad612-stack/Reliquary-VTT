# Adventure importer: features for the next import

Collected while importing the first whole adventure (a Beginner Box adventure, 2026-11-13). Each one is a step Claude did by hand this time and a tool could do next time. None of this is book content.

## Maps

- **Straight-wall snapping (`lines` in import.json).** On clean, grid-aligned art, Claude lists rough lines ("vertical at x 16 from y 9 to 26, gaps for doors") and the importer measures the exact line from the full-resolution image (darkest band within a few tenths of a cell), extends each end into its neighbour, and leaves door gaps where door bars are found. This time it was done with a throwaway script and pasted into `add`.
- **Room-interior erase from the room table.** Once every keyed area has a rectangle or polygon (the room table), erase the wall mask inside each one, inset a little, in one setting. Dark grid lines and floor detail inside rooms were traced as walls this time and erased room by room.
- **Grid-line suppression.** Remove thin lines at the known grid positions before tracing, keeping thicker strokes (walls drawn on grid lines).
- **Leak and route checks as one command.** `tools/mapimport/check.py <map> --rooms rooms.json`: sight from every room with doors closed (list points outside the room's shape, not its bounding box), and routes between named points with doors open. Done this time with two small scripts.
- **Room table from the book.** Register each per-room crop (done: `tools/advimport/roomcrops.py`), then turn each crop's footprint plus the walls into a polygon per keyed area, for terrain, lighting, notes and the review page.
- **Map-sheet splitting.** One PDF page often holds two maps (a level and an inset roof). Detect the divider band and propose the `crop_px` for each map.
- **Veil walls.** A wall type for magical darkness or force curtains that the GM removes in play (now a secret door with a note).
- **Profiles for art styles.** Mask settings that worked for a publisher's map style (thin black walls on grey stone; thick brown stone walls on parchment), named, so the next map in that style starts from them.

## Cast, objects, art

- **Marker pawns to tokens.** The registered crop markers already give start squares and portrait images; match each marker image to the creature named in the room text (and to the token PDF's pawn) automatically by image similarity.
- **Stat block matching.** Match each encounter's creature names against the open content (the Beginner Box creatures are in one bestiary with a `-bb` suffix) and propose the content key, flagging adjustments the text asks for (weak or elite).
- **Token PDF slicing.** Cut each pawn on a token sheet into an image with its printed name, ready for the token art step.

## The user's decisions (2026-11-13)

| # | Feature | Decision |
|---|---|---|
| 1 | Straight-wall snapping | **Built 2026-11-13**; decided: build now, and have the tool **propose candidate straight walls itself** for Claude to accept or reject; traced segments within about 3° of horizontal or vertical are squared up |
| 2 | Room-interior erase from the room table | **Built 2026-11-13**; decided: build now |
| 3 | Grid-line suppression | **Built 2026-11-13**; decided: build now |
| 4 | One check command (sight against the room table's shapes, routes) | **Built 2026-11-13**; decided: build now |
| 5 | Room table from the book's registered crops | **Built 2026-11-13**; decided: build now |
| 6 | Map-sheet splitting | Later |
| 7 | Veil wall type (engine and board) | **Built 2026-11-13**; decided: build now |
| 8 | Saved mask profiles per art style | **Built 2026-11-13**; decided: build now |
| 9 | Matching book pawns to creatures | Later |
| 10 | Stat block matching, with the book's differences flagged | **Built 2026-11-13**; decided: build now (matching and comparison) |
| 11 | Token-sheet slicing | Later |
| 12 | **Wall thickness** (engine, board, importer) | **Built 2026-11-13**; decided: build now (2026-11-13): a wall is a centre line with a width `w` (squares) measured from the drawn wall; sight and movement test its two faces, so walls are solid through and junctions meet at the centre with no gaps; fog reveals a seen wall to its far face; light brightens the lit face. Walls without `w` (outline-traced maps) work as before. Resolves the open question in docs/design/maps.md on wall edges at the limit of sight. |
| 13 | **Finer wall snap: 1/32 of a square** (was 1/8) | **Built 2026-11-13**; decided: build now, with #12 (2026-11-13): new maps snap endpoints to 1/32 (about 6 px at 200 px a square); each walls.json keeps its own `snap`, so older maps stay at 1/8 and the validator, tools and board read the snap from the file. Comes with **welding** (endpoints within a small distance joined into one point) and the squaring rule from #1, so the finer snap does not let small gaps or tracing wobble through. |

## The second round (the user's decisions, 2026-11-13, after the Unlit Star re-walling)

Proposed from where the time and the misses went on the first import. Build order (the user's choice): **speed
first** (#20, #22, #23), then #14 to #18 and #21, then #19, then the two smaller ones.

| # | Feature | Decision |
|---|---|---|
| 14 | **Area completeness check.** Split the book's text by area key (A1., A2. ...) into a checklist per area: every DC and check, creature, treasure line, door mention, light and terrain word. Flag anything the pack's notes, `adventure.json`, walls or room table do not account for. | **Build now** |
| 15 | **Proposals from the text for doors, light and terrain.** Read phrases per area ("locked (DC 20 Thievery)", "stuck", "the room is dark", "torches burn", "shallow water") and propose door settings, lighting and terrain for that room's squares or its nearest door, for Claude to review. Builds on #14's per-area text; the words are the game system's and the book's, so the patterns live in the ruleset. | **Build now** (doors, light and terrain) |
| 16 | **Item and hazard matching.** Like `statmatch.mjs`: match each treasure line and hazard to the open content, compare values (price, level, DCs, damage) and flag the book's differences. | **Build now** |
| 17 | **Walls hidden by clutter.** Propose joining straight wall pieces that line up on one line with rock, webs or furniture between them; and compare each room's shape on our map with the book's registered room crop, so a missing wall shows as a mismatch. All four hand-listed walls on the first import were this kind. | **Build now** (both parts) |
| 18 | **Automatic routes and explained leaks.** The map check makes its own routes (through every door from both sides, between neighbouring rooms) and says what sight leaving a room went through: a window, a veil, a doorway or a real gap. | **Build now** |
| 19 | **Re-importing without losing play.** An update mode for a running campaign: refresh walls, notes and art from the pack, keep tokens (same ids) and their state, door states and explored areas. | **Build now** |
| 20 | **Rebuild only what changed.** Save each map-import step's result and reuse it while its settings are unchanged; allow rebuilding one room's area. A level A rebuild takes about a minute today. | **Build now** (both parts) |
| 21 | **Review sheet.** One image per map: each room's book crop beside our walls, doors and room squares, with changes since the last build highlighted. | **Build now, for Claude's checking**; the user sees it only on request |
| 22 | **One import command with a status table.** Run every step for a pack in order; show what is out of date, what failed and what waits for review. | **Build now** |
| 23 | **Sync to the user's PC.** One command: pack what changed, send it, check it arrived intact, extract into the checkout (overwrite in place; stale files to `_to_delete`). | **Build now** |
| 24 | **Face-centred token crops.** Centre each round token on the creature's face. | **Build now** |
| 25 | **Auto-link stairs and lifts** between levels from the maps' stair and lift markers. | **Build now** |
