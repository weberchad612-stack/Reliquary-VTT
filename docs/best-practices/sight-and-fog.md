# Best practices: sight and fog of war

For Claude and for board code using `engine/sight/` and `engine/fog/` (design: [maps.md](../design/maps.md) section 8).

## Sight

- Answer "can X see Y?" with the engine (`tokenCanSee`, or `node tools/sight.mjs`), never by reading the map picture. This is what stops narrating rooms, doors or creatures the party cannot actually see.
- Pass the save's door states (`prepare(segs, state)`): an open door or a found secret door changes everything behind it.
- Tokens see from their whole space (`footprintPoints`, `viewpoints`), and are seen if any part of their space is visible. Do not reduce a creature to its centre point.
- Vision has no range by default (PF2E has none: walls and darkness limit sight). Pass the map's `grid` so rays that hit nothing stop just past the map's edge. A range, and who can look (unconscious, blinded), come from the ruleset through `partyView` options, not from engine code.
- On maps with lighting, pass the light map and the ruleset's light rules to `partyView`: what a PC perceives depends on light and senses, and only that joins the explored area (see [lighting.md](lighting.md)).
- Cover is not sight. PF2E measures cover centre to centre; that belongs to the ruleset.

## Fog

- **Store** explored areas with `ExploredMask.toPolys()` (pixel-exact outlines). **Paint** them with `displayPolys()` / `displayOutlines()` (straight edges). Never save display outlines: re-straightening an already straightened shape pushes it outward on every save.
- Merge new sight into the explored area as play goes on, but write the save only after a short delay, not on every step.
- Foes and NPCs are shown to players only while a PC sees them; GM-hidden tokens never are; PCs and markers always are (in the party's view; see below for one creature's view).
- Remembered areas (explored, not visible now) are drawn dark for players (75 % fog), the same everywhere: never shade memory by today's light, which would show players a room being lit after they left it.
- Cover a map's `hidden_areas` (insets of other maps) at all times.
- **One creature's view.** Selecting a token shows only what it perceives now: no remembered areas, only the tokens it sees (`partyView` with `canLook` for that token and `alwaysShown` set to markers only, so even PCs show only when it sees them). The GM may select anyone, a player only a PC. It is display only: the explored area is always the party's. Deselect for the whole explored map.

## Checks

- After any change to wall data, re-run the leak check and look at the fog in the demo page in both views, with nothing selected and with a PC and a foe selected.
- Performance: measure a full update for four PCs on the real map. On Gauntlight Ruins (about 700 segments) it is 260 ms today; a spatial index for rays is planned.
