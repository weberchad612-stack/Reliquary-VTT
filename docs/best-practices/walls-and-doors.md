# Best practices: walls, doors and openings

For Claude, when writing or correcting wall data (`walls.json`; design: [maps.md](../design/maps.md) sections 4 to 6).

## Choosing the wall type

| Use | Type | Notes |
|---|---|---|
| Stone, wood, any ordinary wall | `solid` | |
| Door | `door` | Live state (open, locked) belongs in the save; `door.initial` is the starting state. |
| Secret door | `secret` | Acts as a solid wall, with no icon, until found. Give `dc`; use `auto_find: true` when the text says it is obvious (left ajar, visible from one side). |
| Arrow slit, peephole | `slit` | Proximity sight: set `prox.sight` to 5 ft plus half the wall's thickness, so standing at the inner face counts as close. The importer does this for detected and placed slits. |
| Glass window | `window` | Sight passes by default. Stained or frosted glass: override `sight: 20` (blocks sight; light still passes). |
| Portcullis, bars, grate | `grate` | Sight, light and sound pass; movement does not. |
| Curtain, low wall, tall grass | `terrain` | See past one, not two. |
| Force barrier you can walk through | `ethereal` | |
| Illusory or one-way wall | any type with `dir` | Check the side with the overlay arrow: "left of a to b" with y downward. |

## Doors

- A door with a small barred window: type `door` with `sight: 30` and `prox: {sight: 5}`. Closed, it blocks movement, but someone beside it can look through.
- Stuck doors: `stuck_dc`. Doors blocked by rubble: `blocked`, saying what blocks it and how to get past.
- Double doors are one segment.
- Give every door a `label` a GM recognises ("A4-A11 door (stuck)"), and put the text's details in `note` in your own words.

## Geometry

- Endpoints on the 1/8-cell grid (the validator enforces it).
- **A doorway must be clear.** No other wall may cross a door or run along it inside the opening; jambs end square at the door. Otherwise an open door still blocks sight and movement. The validator warns ("walls pinch the doorway") when less than the door's length minus 0.4 cells (and under 0.5 cells) is clear; treat that warning as a bug.
- Every room boundary must be closed. A door, window, slit or added wall must reach a little way into the walls on both sides; a segment that only touches a wall's corner leaves a sliver for sight to leak through.
- Never refer to segments by id in corrections or notes that must survive a re-import; ids change when a map is vectorized again. Door ids (`door.id`) are stable and are what saves and narration use.

## Checks

- `node tools/validate.mjs <pack>` after every change.
- The leak check from inside every room with all doors closed.
- Spot-check each special wall from both sides with `node tools/sight.mjs <map> --from X,Y --to X,Y`.
