# Best practices: walls, doors and openings

For Claude, when writing or correcting wall data (`walls.json`; design: [maps.md](../design/maps.md) sections 4 to 6).

## Choosing the wall type

| Use | Type | Notes |
|---|---|---|
| Stone, wood, any ordinary wall | `solid` | |
| Door | `door` | Live state (open, locked) belongs in the save; `door.initial` is the starting state. |
| Secret door | `secret` | Acts as a solid wall, with no icon, until found. Give `dc`; use `auto_find: true` when the text says it is obvious (left ajar, visible from one side). A door that a puzzle or event reveals has neither: leave the validator's "no dc" warning and say why in the import notes (`auto_find` would show it the moment it is seen). |
| Magical barrier the players can see, which goes away (a curtain of darkness, a ward, a wall of force that a key or ritual ends) | `veil` | Door-like: give it a `door` with an id and a label. Blocks movement, sight and light while it stands; dispelled (`open`), nothing. Never locked or paired. The GM dispels it with one click; Claude merges `{doors: {<id>: {state: "open"}}}` into `mapstate/<map>`. Not a secret door: players must see it. |
| Arrow slit, peephole | `slit` | Proximity sight: set `prox.sight` to 5 ft plus half the wall's thickness, so standing at the inner face counts as close. The importer does this for detected and placed slits. |
| Glass window | `window` | Sight passes by default. Stained or frosted glass: override `sight: 20` (blocks sight; light still passes). |
| Portcullis, bars, grate | `grate` | Sight, light and sound pass; movement does not. |
| Curtain, low wall, tall grass | `terrain` | See past one, not two. |
| Force barrier you can walk through | `ethereal` | |
| Illusory or one-way wall | any type with `dir` | Check the side with the overlay arrow: "left of a to b" with y downward. |

## Doors

- A door with a small barred window: type `door` with `sight: 30` and `prox: {sight: 5}`. Closed, it blocks movement, but someone beside it can look through.
- Stuck doors: `stuck_dc`. Doors blocked by rubble: `blocked`, saying what blocks it and how to get past.
- **Double doors are two leaves**: two door segments meeting end to end, each naming the other in `door.pair`, each with its own id, state and label ("..., west leaf"). Never make a double door one segment: players must be able to open one leaf.
- Every leaf has a `hinge` (`a`/`b`) and a `swing` side (`left`/`right` of a→b). Double-door leaves hinge at the outer ends. Pick the swing from the art or the text (into the room, or onto the space the drawing leaves open); when nothing says, choose the side with room to open.
- Give every door a `label` a GM recognises ("A4-A11 door (stuck)"), and put the text's details in `note` in your own words.

## Geometry

- Endpoints on the file's `snap`: 1/8 cell, or 1/32 for maps imported at print resolution (the validator enforces it).
- **Thickness** (`w`, cells): give a wall its drawn thickness when it lies on a measured straight line (the importer does this for the lines it finds or that you list). The segment is the centre line; light, sound and movement meet the faces, and sight reveals the whole wall. Not on doors, veils, one-way or proximity walls. Odd traced shapes stay lines.
- **A doorway must be clear.** No other wall may cross a door or run along it inside the opening; jambs end square at the door. Otherwise an open door still blocks sight and movement. The validator warns ("walls pinch the doorway") when less than the door's length minus 0.4 cells (and under 0.5 cells) is clear; treat that warning as a bug.
- Openings carry daylight: a window, grate, arrow slit or open door with sky on the other side lights the room behind it (lighting design section 10). A window drawn as a solid wall leaves its room dark by day, so get the opening types right.
- Every room boundary must be closed. A door, window, slit or added wall must reach a little way into the walls on both sides; a segment that only touches a wall's corner leaves a sliver for sight to leak through.
- Never refer to segments by id in corrections or notes that must survive a re-import; ids change when a map is vectorized again. Door ids (`door.id`) are stable and are what saves and narration use.

## Checks

- Look at every door in the demo page with all doors closed and then all open: panels sit in the doorway, open leaves swing into open floor, never through a wall, and each leaf of a double door works on its own.

- `node tools/validate.mjs <pack>` after every change.
- `node tools/mapcheck.mjs <map-dir>`: sight from inside every keyed room with all doors closed, and the walking routes in `import.json` `checks.routes` with all doors open (veils dispelled). It must say OK; allowed views go in `checks.sees` with a reason.
- Spot-check each special wall from both sides with `node tools/sight.mjs <map> --from X,Y --to X,Y`.
