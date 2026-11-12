# Best practices: lighting and vision

For Claude, when adding lighting to a map at import and when using light in play (`lighting.json`, `engine/light/`, the light-aware `partyView`, `rulesets/pf2e/light.js`, `tools/mapimport/lighting.py`; design: [lighting.md](../design/lighting.md)).

## 1. Read the text for light, room by room

Before deciding any lighting, read the adventure's overview for the level and every keyed area:

- **A level-wide rule first.** Gauntlight Ruins: "the only illumination is whatever sunlight filters in through the fog". That makes every roofed room dark, and the outdoors and every place open to the sky follow the sky light.
- **What is open to the sky.** Drawn rubble ("areas drawn as rubble are open to the sky"), rooms whose ceiling the text says has collapsed (A8: almost the whole ceiling), holes in roofs. A plan cannot show ceilings, so here the text decides where the drawing is silent.
- **Fixed light sources:** braziers, lamps, magical glows, fungus. Each becomes a light (position, preset or radii, whether walls block it, initial state) or a region with a fixed level. **Give every static light both radii**, bright and dim, from the text or the nearest preset; a source that sheds only dim light (a candle, fungus) gets just `dim`. A light with only `bright` gets an automatic fringe of a tenth of its radius and an importer warning.
- **Animation.** Flames move: braziers, hearths and fires get `animation: {type: "torch"}` (speed and strength about 3-4 for a steady fire, higher for a roaring one); presets already bring theirs (torches flutter, lanterns flicker faintly). Use pulse, ghostly or chroma only where the text describes a magical light that throbs, wavers or shifts colour. Animation never changes the rules.
- **Colour and intensity.** Set them from the text: "a faint green glow" is a green colour and an intensity of about 25; "brightly lit braziers" an orange colour at 100. Presets already bring their natural colour, so do not repeat it. Fire with no preset (braziers, hearths): a warm orange such as `#ff8a33`. Colour and intensity never change the rules: a faint glow is still dim light.
- **Windows and doors to the outside.** Daylight comes in by itself through every window, grate, arrow slit and open door that has sky on the other side, so do not add lights or bright regions for "light from the windows". Check instead that windows are drawn as windows (not solid walls) and that the outdoors region reaches the outside of each one. On an outdoor map, give each building a roofed region, or its windows will not count.
- **Light that belongs to a creature** (a glowing will-o'-wisp) is not a fixture: leave it to the creature's token.
- **Check which room a sentence belongs to** against the heading above it, not by searching for a phrase: the collapsed corner first noted for Gauntlight's A11 is A12's.

Paraphrase in notes; never copy the book's sentences.

## 2. Build the regions

- **The outdoors**: `{"outside": {"from": [a corner], "seal": [...]}}`, a flood fill from outside the buildings. Openings drawn on purpose (a breach, a collapsed wall) join the outdoors to rooms; seal them for this fill with lines across the opening, or the roofed room behind becomes sky.
- **The flood is also a leak check, and a strict one.** It moves between square centres, so it finds gaps in walls that the sight leak check missed: on Gauntlight it found three (two where moss over a wall bit a hole in the traced outline, one where a correction that erased a stair drawing also erased the wall). Before choosing seals, list every keyed room the outdoor flood reaches; anything that is not a drawn opening is a wall gap to fix in the walls, not a seal.
- **Roofless areas** reuse the terrain: `{"terrain": "rubble"}` takes every rubble area; add rooms by `room_at`.
- Plot the regions over the map (dark where roofed, clear where sky) and look at every building.

## 3. Check it

| Check | How |
|---|---|
| Validator | `node tools/validate.mjs <pack>`: no errors; presets known; lights inside the grid; colours `#rrggbb` or `none`; intensities 0-100. |
| Regions | The plot above: every building dark unless the text opens it; the outdoors whole; insets excluded. |
| In the demo | Walk a PC in by day without a light (a room with no window or open door stays dark and unexplored; one with a window is lit near it, fading across the room), light a torch (the room appears), set the Sky to night (only the torch's circle outdoors, no daylight indoors). Put a foe in dim light and check its concealed badge; give a PC darkvision and check the greyscale. Select a PC and a foe and check each sees only what it should. |
| Decisions | One line in the map's `decisions` list: the level's rule, what is open to the sky, the lights, and anything to confirm with the user (fog making daylight dim). |

## 4. In play

- Ask the engine what a PC perceives (`partyView` with the light map); never judge light by looking at the picture.
- Light changes play: say so. "The skeleton at the edge of your torchlight is concealed from you, Kerra: DC 5 flat check to target it." A foe in darkness is not on the board for a PC without darkvision; when the party knows where it is (they heard it, it attacked), place a hidden marker on its square.
- Keep light state in the save: carried lights on the token (`light`, with `on`, `colour`, `intensity`), static lights in `lights` (`on`, `colour`, `intensity`), regions in `regions` and `regions_off`, the sky in `sky_light`, the table's coloured-light switch and strength in `light_colour`. Lighting or dousing a light is an Interact action; update the save when it happens.
- Senses come from the creature (darkvision, low-light vision); a temporary one (a darkvision elixir, a spell) goes on the token's `senses` with its `source`, and comes off when it ends.
- A lit area with no lamp mark is a lighting region (glowing fungus, an altar's glow): hover over it in GM view to see its name; GM view outlines every region.
- Colour and intensity can change in play (a brazier burning low, a spell turning a flame blue): change them in the GM's Lighting card (lamps, regions) or a token's selection panel (carried light), so they are kept in the save, and describe the change.
- Animation can be turned off for the whole table with the Animation button in the sidebar's Lighting tab (GM view), for a player who finds it distracting or a slow machine; the hover bar shows its cost per frame.
- Lamp marks on the board are GM-only (players see the light, not the mark). Describe a lamp to players only as their characters would see it.
- To check what one creature sees, select it on the board: the board then shows only its own view. Deselect for the party's explored map.
- Light fades in the drawing, not in the rules: a creature in the faint outer edge of a torch's light is still in dim light (concealed). Read the light level from the engine (the board's hover readout shows both the level and the brightness).
- Carried lights are circles. A bull's-eye lantern acts as a hooded lantern until carried cones exist; tell the player when it matters.

## 5. Engine notes

- Region edges are faded in `glow` only (`fadeRegionEdges`): pass the light walls (`prepareLight`) to `LightMap` so edges along walls stay sharp.
- Colour mixes by brightness in the light map (`LightMap.colour`); the board draws it as a tint layer under the shade, keyed on the light map so colour and intensity edits rebuild only the light map (`relight()`), never the party view.
- A view that sees nothing must show nothing: an empty visible area is not "no clip". The animation layer once skipped its clip when the selected creature saw nothing (night, torch out) and flickered every lamp on the map.
- Animation never touches the light map or the party view: it is a separate layer drawn from per-light sprites (`animSprite`) and `animationAt`, clipped to the view. Keep it that way: anything that redraws the board per frame will not keep up.
- The light map holds two things: `levels` for the rules (three steps) and `glow` for drawing (0-255). Never decide anything from `glow`.
- Daylight lights are generated (`daylightLights`) from the walls, the door states, the sky and the sky regions every update and handed to the same `LightCache` as the static and carried lights; their ids (`day:<wall>:<n>`) are stable, so they are only recomputed when a door or the sky changes.
- The player's light shade is drawn blurred and clipped to the visible area; pixels outside the view count as dark in the shade image so the blur does not leave a light rim at the edge of the view.
- One view decides everything drawn: the party's, or the selected creature's (`shown()` in the demo page). Fog, shade, tokens, badges, doors, movement outlines, hover readout and click targets all read it, so they cannot disagree.
- Light, sight and the explored area share the 1/8-cell grid, so filtering sight by light is a pixel test and the result is traced into straight-edged outlines like the fog.
- `export const A = 1, B = 2;` exports only `A` from the bundled page (the bundler now refuses it): one export per declaration. Tests in `tests/demo.test.mjs` check that every module export reaches the bundled engine; Node tests alone cannot see bundling problems.
