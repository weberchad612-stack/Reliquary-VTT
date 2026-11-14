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
| 1 | Straight-wall snapping | **Build now**, and have the tool **propose candidate straight walls itself** for Claude to accept or reject |
| 2 | Room-interior erase from the room table | **Build now** |
| 3 | Grid-line suppression | **Build now** |
| 4 | One check command (sight against the room table's shapes, routes) | **Build now** |
| 5 | Room table from the book's registered crops | **Build now** |
| 6 | Map-sheet splitting | Later |
| 7 | Veil wall type (engine and board) | **Build now** |
| 8 | Saved mask profiles per art style | **Build now** |
| 9 | Matching book pawns to creatures | Later |
| 10 | Stat block matching, with the book's differences flagged | **Build now** (matching and comparison) |
| 11 | Token-sheet slicing | Later |
