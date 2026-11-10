# Best practices: terrain

For Claude, when adding terrain to a map at import and when using it in play (`terrain.json`, `engine/terrain/`, `rulesets/pf2e/terrain.js`, `tools/mapimport/terrain.py`; design: [maps.md](../design/maps.md) sections 9a and 9b).

## 1. Read the text, then the art

The map importer guide's first rule applies here too: read the adventure text for every keyed area before deciding any terrain. List, room by room:

- **General rules first.** Adventures often state one for a whole level (Gauntlight Ruins: "areas drawn as rubble are difficult terrain and open to the sky"). That makes the drawing decide *where* and the text decide *what*.
- **Named terrain:** difficult or greater difficult terrain, water and its depth, mud, slopes or pits with a Climb DC, uneven ground or narrow surfaces with a Balance DC, hazards and their damage.
- **Terrain that appears during play:** a bridge or pier that collapses, a room that floods. These are areas with `active: false`, switched on in the save when it happens.
- **Creatures with exceptions** ("skitters over the rubble", "ignores difficult terrain from natural features"): these go on the creature as `ignoreDifficult`, not on the terrain; make sure the area's `cause` lets the ruleset match it (`rubble`).
- **Where the text is vague** (water "relatively shallow", with no cost given), choose the closest rule, say so in the area's note, and list it for the user to confirm.

Check room numbers against the text itself, not earlier notes: a note made during wall import put Gauntlight's broken glass in A22; the text puts it in A23.

Paraphrase in notes; never copy the book's sentences.

## 2. Find the squares

The importer's terrain block builds each area from selectors and the art:

- **Colour classes for drawn terrain** (rubble, water). Sample them the same way as the wall mask: pick squares you have confirmed by eye are the terrain, are bare floor, and are things that look similar (moss, grass, wood), and print how much of each square falls in the colour range. Aim for a clear gap (Gauntlight rubble: 81% of a rubble square, 8% of bare floor, 40% of rubble under moss; threshold 30%).
- **Use brightness as well as hue** when two things share a hue: Gauntlight's overgrown marsh and the island's grass have the same hue, but the water is darker.
- **Restrict colour to where it is reliable:** wooden stairs, bridges, piers, boats, earth banks and trees often match rubble colours. Leave them out with `minus`, by name in the area's note.
- **Add back what the art hides** (`plus`): a compass rose drawn over water.
- **Shapes from the text:** a sinkhole's steep slopes are a ring (`climb`) round a floor of rubble (`difficult`); model the ring and the floor as two areas, or every step across the floor would need a Climb.
- **One area per room** (`split: true` with the settings' `rooms` block, the keyed room points from the book's labelled map): a room's rubble can then be switched off on its own when the party clears it, and labels read "Rubble (A7)". Use `room_overrides` for terrain that spilled out of a room (rubble outside a collapsed boathouse belongs to the boathouse).
- Squares in hidden areas (insets of other maps) never get terrain.

## 3. Check it

| Check | How |
|---|---|
| Every area | `node tools/validate.mjs <pack>`: no errors; any warning explained in the area's note (a swim area with no DC because the text gives none). |
| Coverage | Plot every area over the map, coloured by kind, with its id. Look at every room and the outdoors: nothing on stairs, wood, banks or trees; nothing missing where the art shows rubble. |
| Squares at the edges | For anything doubtful, render a zoomed tile with the grid and square numbers and decide square by square. |
| Movement | Build the demo, drag a token through each kind: the route label shows the extra feet and the checks; deep water and climbs are routed round; an area that starts off can be switched on by the GM. |
| Decisions | Add one line to the map's `decisions` list naming every judgment call, and tell the user which need confirming. |

## 4. In play

- Ask the engine for costs and checks (`routeCost`, `routeTerrain`, `path` with the ruleset's `enterCost`); never count terrain by eye.
- Tell the table the effect when terrain matters ("the rubble costs 5 ft more per square; that is 30 ft, beyond your 25"), and name checks with their DC (Balance DC 11, Climb DC 12).
- When terrain changes (rubble cleared, a bridge collapses, a spell creates entangling plants), change the save: `terrain_off`, `terrain_on`, or a temporary area in `terrain` with `source` and `until`. Remove temporary areas when they end.
- You cannot Step into difficult terrain: a one-square move into it is a Stride.
- Larger creatures pay once per step for the worst new square (a table ruling until the user confirms otherwise).
