# Lighting and vision: design

Status: agreed with Chad on 2026-11-09 and built the same day (section 9). A lean first version; later additions are listed in section 8 and in [future/](../../future/README.md). Builds on the sight engine and fog in [maps.md](maps.md) section 8.

## 1. Light changes the rules, not just the picture

Pathfinder 2e (Player Core, paraphrased) has three light levels:

- **Bright light:** creatures and objects are observed normally.
- **Dim light:** creatures and objects in it are concealed (DC 5 flat check to target), unless the observer has low-light vision, darkvision, or a precise sense other than vision.
- **Darkness:** creatures and objects in it are hidden or undetected, unless the observer has darkvision or a precise non-visual sense.
- A creature that can see into a lit area observes the creatures there normally: a torch-bearer is visible from the dark.

The engine works out the light level at any point (section 4), and for each viewer combines it with the viewer's senses (section 3) into observed, concealed or not visible. Line of sight still comes from the walls; light is a second test. The result feeds:

- **the fog:** what each PC actually perceives (section 2);
- **which foes the players see:** a foe in dim light seen only by PCs without low-light vision or darkvision is shown with a **concealed** badge; a foe in darkness (to PCs without darkvision) is not shown. When the party knows where it is (heard it, it attacked), the GM places a **hidden** marker on its square; the board does not infer hidden or undetected itself;
- **Claude's narration:** "the skeleton at the edge of your torchlight is concealed: DC 5 flat check to target it".

The engine reports light levels and senses; the ruleset decides what they mean, so another system can reuse the engine with its own rules.

## 2. Exploring needs light

A point joins the explored area only when some PC perceives it: in bright or dim light, anyone; in darkness, a PC with darkvision. A dark room down a corridor stays unexplored until a light reaches it or a darkvision PC looks in; a lit room far away is explored across a dark corridor. Explored areas are still stored exactly and never forgotten; light only decides what is added. In practice a PC's new explored area is its visibility polygon clipped to the lit area, unless it has darkvision.

**On the players' board**, areas visible now are drawn:

| Light where the party sees | Drawn as |
|---|---|
| Bright | the map at full brightness |
| Dim | the map slightly darkened (where light falls off and concealment applies) |
| Seen only by darkvision | the map in greyscale (PF2E darkvision is black and white) |
| In line of sight but dark, no darkvision | like unexplored fog |

## 3. Senses

Senses come from the creature's data (the PC's character, the foe's stat block) through the ruleset, not from the token. First version: normal vision, low-light vision, darkvision, greater darkvision. Each sense records which light levels it works in, an optional range (PF2E darkvision has none; D&D's has 60 ft; some PF2E special senses have ranges) and whether it is precise. A temporary change (a PC under the darkvision spell) goes in the save with its source and end, like temporary terrain.

## 4. The light on a map

- **Base:** `outdoor: true` maps are lit by the sky; indoor maps default to darkness, or to the level the adventure gives for the whole level. Until time of day exists, sky light is bright; the GM can set it dim or dark in the save (dusk, night).
- **Lighting regions:** areas of whole squares, like terrain areas, each either `sky` (open to the sky: follows the sky light; Gauntlight's roofless rubble areas, the A4 breach) or a fixed level `bright`, `dim` or `dark` (a fungus-lit cave, a permanent magical light, a room the text says is lit by its windows). The importer fills them from the text; where the text says areas open to the sky are the ones drawn as rubble, the sky regions come from the rubble squares already detected. The save can change a region (a magical light dispelled). The board softens region edges when drawing.
- **Light sources** add on top (section 5): a torch carried into a dark region lights it.
- The light level at a point is the brightest of the base, the region and every light source that reaches it.

## 5. Light sources

- **Shape:** bright radius and how far dim light extends beyond it; whether walls constrain it (default yes).
- **Walls:** light passes walls according to each wall type's existing `light` value: solid walls and closed doors block it; open doors, windows and grates pass it; arrow slits pass it only close up; low walls and curtains pass one, not two. Overrides work as for sight (stained glass blocks sight but lets light through).
- **On or off:** every light has a state; the pack gives the initial state (a brazier lit or cold), the save the current one, like doors. A hooded lantern's shutters are the same switch.
- **Static lights** belong to the map pack (position, shape, initial state; braziers, a magical glow), placed by the importer from the text. Only static lights may have an **emission angle and rotation** (a cone, a lighthouse beam).
- **Carried lights** belong to a token in the save (a torch, a lantern) and move with it. They are always circles: tokens have no facing.
- **Presets** come from the ruleset, so numbers are never typed by hand: a light is `{preset: "torch"}` or `{preset: "light", rank: 4}` plus any overrides. PF2E presets: torch, everburning torch, sunrod 20 ft bright + 20 ft dim; hooded lantern 30 + 30; light cantrip 20 + 20 (4th rank 60 + 60), an orb placed within 120 ft, so a light marker of its own; bull's-eye lantern: a 60-ft cone, which carried lights cannot be, so it acts as a hooded lantern until carried cones exist (known limit). Candles: check the Player Core before adding.

## 6. Parties whose members see differently

The players' board shows the **combined view** of the party (everything any PC perceives, drawn as in section 2), and the explored area grows from it. A player may click their own PC to shade exactly what that PC sees (the GM's vision view, limited to the player's own characters). Concealed badges follow the selected PC; with none selected, a foe shows the badge if it is concealed from at least one PC who sees it, and the tooltip names who ("concealed from Kerra: dim light").

## 7. Cost

Bases and regions are lookups per square. Combining light and senses at a point is arithmetic. The cost is light sources: each is a visibility polygon, like a PC's sight, but short-ranged (a torch reaches 40 ft), so it involves only nearby walls. Static lights are computed once and again only when a nearby door changes; a carried light only when its carrier moves. Light is painted into its own layer when it changes, never per frame. The ray index planned in [future/sight-performance.md](../../future/sight-performance.md) speeds all of it up when needed.

## 8. Not in the first version

Light colour and intensity; animations (flickering torches); magical darkness and greater darkvision seeing through it; imprecise senses (scent, tremorsense, hearing) and automatic hidden markers; time of day changing the sky light; carried cone lights and token facing; a darkness scale finer than PF2E's three light levels for the rules (the drawing now fades: section 10). Daylight through windows was added later (section 10).

## 9. As built

- **Files.** `map.json`: `outdoor`, `base_light`, `lighting` (file name). `lighting.json` (schema `schemas/lighting.schema.json`): `regions` (squares, level `sky`/`bright`/`dim`/`dark`) and `lights` (`at`, `preset` or `bright`/`dim` in feet, `walls`, `angle`, `rotation`, `on`). Save (`map-state`): `sky_light`, `lights` ({id: {on}}), `regions_off`, and on each token `light` (a carried light: preset, rank, radii, on) and `senses` (names or {type, range, source}).
- **Engine.** `engine/light/light.js`: `lightShape` (a visibility polygon through the walls' `light` values, or a circle when walls do not constrain it; cones for static lights), `lightPatch` (the pixels it lights on the 1/8-cell grid, bright or dim by distance), `LightMap` (base, regions, then the brightest light at each pixel), `LightCache` (a light is recomputed only when its position, shape or the door states change). `partyView(..., {light, rules, grid})` filters each looker's sight by light and senses into `perceived`, `dim` and `mono` masks (traced into straight-edged outlines for drawing, like the fog) and reports `seen` and `concealedFrom`.
- **Ruleset.** `rulesets/pf2e/light.js`: `LIGHT_PRESETS`, `lightSpec`, `senseList`, `perceive(level, senses, distFt)`.
- **Board** (the demo page): light effects drawn under the terrain marks and the fog; the GM sees the light everywhere as a soft shade and clicks a lamp to light it or put it out; concealed badges (half-shaded disc); GM "hidden" markers (a ? on a square, cleared when the creature is seen); a Sky selector on maps with sky; carried lights lit and put out from the selection panel.
- **Sky.** Until time of day exists, sky light is bright; the GM sets it dim or dark (dusk, night) with the Sky selector, held in the save as `sky_light`.
- **Measured** (Level 1, two PCs and six other tokens, one torch; cloud workspace): a light polygon about 4 ms the first time, nothing when cached; the light-aware party view about 10 ms more than without light; tracing the three masks for drawing about 20 ms. In the demo page (headless browser, no GPU): a full update with a moving torch 245 ms (162 ms before lighting), a redraw 71 ms (37 ms). See [future/sight-performance.md](../../future/sight-performance.md).

## 10. Second pass: fading light, daylight indoors, darker memory (agreed with the user, 2026-11-10)

- **Dim light fades.** The rules keep PF2E's three levels. The drawing does not: the light map also keeps a brightness for each pixel (`glow`, 0-255), full in bright light, falling in a straight line across a light's dim band to nothing at its outer edge. Dim regions and a dim sky draw at a steady half brightness. Where lights overlap the brighter wins. Both views shade by brightness through one curve (GM: up to 60 % shade in darkness; players: up to 70 % over what they perceive, none over what only darkvision shows, which stays greyscale). A creature at the far edge of a torch's light looks nearly dark but is still in dim light: concealed, not unseen.
- **Light radii.** A static light should give both radii. A light with only dim light is allowed (a candle, glowing fungus). A light with bright light and no dim radius gets a thin dim fringe of a tenth of its bright radius (`DIM_FRINGE`), so it fades instead of stopping at a hard edge; the importer warns when that happens.
- **Daylight indoors.** Any opening that light passes (window, grate, arrow slit, open door) with open sky on one side and roof on the other lets the sky in: a row of half-circle lights just inside it, one per square of opening, facing into the room. Day: bright for 15 ft, then dim for 50 ft more (65 ft in all; first built as 30 ft, extended at the user's request the same day). Dusk: dim for 15 ft. Night: none. An opening narrower than a square lets in proportionally less (an arrow slit, a thin beam). Walls block it as any light; closing the door shuts it out. "Sky" is what the light map says: an outdoor map's sky, or `sky` regions; on an outdoor map, a building needs a roofed region (`dark` or a fixed level) for its windows to count. Engine: `engine/light/daylight.js` (`daylightLights`, `skyTest`, `DAYLIGHT`). They are ordinary lights to the cache: recomputed only when a door or the sky changes.
- **Remembered areas are darker.** The player fog over explored-but-not-visible areas went from 55 % to 75 %, the same everywhere (the user chose this over shading memory by light, which would show players a room being lit after they left it).

## 11. A selected creature's own view (agreed with the user, 2026-11-10)

With a creature selected, the board shows only what it perceives now: the fog cut to its view alone, nothing remembered, its own dim and greyscale shading, only the tokens it sees (PCs included), concealed badges from its point of view, doors only where it sees them. The GM may select anyone (seeing through a foe's eyes); a player only a PC. Deselect (click empty floor, Escape) for the whole explored map. This replaces the yellow "what it sees" tint. Engine: `partyView` with `canLook` set to the one creature and `alwaysShown` set to markers only. The party keeps exploring underneath; the explored area is the party's whatever is selected.

## 12. Lamp marks and sight range (agreed with the user, 2026-11-10)

- **Lamp marks are the GM's.** Players never see the mark of a static light, only its light. The GM view shows every mark at all times, also while looking through a creature's eyes, so a lamp can always be clicked to light it or put it out.
- **Sight has no range.** PF2E vision has none; walls and darkness limit it. `visPolygon` defaults to unlimited range and stops a ray that hits nothing just past the map's edge (pass `grid`). The board and the sight and fog tools no longer use 200 ft; `--range` still limits the tools, and a sense or ruleset can still give one.

