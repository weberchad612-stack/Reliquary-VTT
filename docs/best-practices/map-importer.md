# Best practices: the map importer

For Claude, when turning a map from an adventure the user owns into a map in their private pack (`tools/mapimport/`). The tool only proposes; these practices decide what goes into the pack.

## 1. Read the adventure before you trust the image

The map image shows what things look like. The adventure text says what they are. Before any correction, read the text for **every keyed area** on the map and list everything that affects walls, sight or movement:

- **Doors:** which are stuck (and the DC to Force Open), locked (DC, key), blocked by rubble, barred, or have windows in them.
- **Secret doors:** player maps usually do not draw them. The book's labelled (GM) map marks them, typically with an "S". Note the DC and how they open.
- **Openings:** arrow slits, windows and what they are made of (clear glass, stained glass, bars), murder holes, grates and portcullises.
- **Damage:** collapsed walls, breaches, caved-in ceilings, rubble.
- **Things drawn like walls that are not walls:** stairs, ladders, furniture, statues, daises, pits and sinkholes.
- **Terrain:** rubble, water and its depth, mud, slopes, broken glass, hazards, and terrain that appears during play (a bridge or pier that collapses). Note any general rule for the level ("drawn rubble is difficult terrain"). See [terrain.md](terrain.md).
- **Exits to other maps:** stairs, trap doors, holes, tunnels, and whether they are hidden.

Read the full room entries, not only a keyword search: a sentence that matters often sits next to the one a search finds (an arrow slit mentioned in passing in a room's description, a secret door's location in the treasure paragraph). Paraphrase what you learn; never copy passages from the book into the pack or the repo.

## 2. Use the book's labelled map, registered to the image

- Extract the room labels from the labelled map page's text layer (`pdftotext -bbox`). Marks drawn into the art (such as "S" for secret doors) need the rendered page.
- **Register** the labelled page to the map image with feature matching (ORB plus RANSAC, an affine or similarity transform) instead of eyeballing positions. A median error under about a pixel is normal for the same artwork.
- Convert every label and mark to grid cells, then zoom in on each one with the cell grid drawn over the image before placing anything.

## 3. Drawing versus text

The user's standing rule:

> **Where the map explicitly draws something, the drawing wins. The adventure text fills in what the drawing cannot show.**

- The text decides what the drawing cannot express: secret doors, stuck or locked doors, what a window is made of, arrow slits the art does not show as gaps, DCs.
- The drawing decides geometry: a door drawn where the text says the frame rotted stays a closed door; walls drawn intact where the text says a building collapsed stay walls (the collapse becomes rubble terrain); a wall drawn broken stays open.
- If a conflict is not covered by this rule, ask the user before deciding.
- Record **every** decision, with its reason, in the map's `import.json` (`decisions`, and the `note` on each correction).

## 4. The workflow, with a check at each step

| Step | Do | Check |
|---|---|---|
| Extract | `extract.py` picks the largest image on the page that is not shared with other pages. | The chosen image is the map, not the page background. |
| Grid | Automatic calibration. | Strength above about 2 (a clear grid) and square cells. Draw the grid over the image at **two far corners** and look. |
| Wall mask | Thresholds in the map's `mask` settings. | Sample colours from small boxes you have **confirmed by eye are inside walls**, floors, ground and water. Do not guess thresholds. Render the mask over the map and look. |
| Features | Doors (one segment per leaf; double doors paired), windows, proposed arrow slits. | Count the doors against the art, counting each leaf of a double door. Check each door's swing side; correct it with a `doors` entry when the text or art says otherwise. Every slit proposal is accepted or rejected by looking at the original art beside it. |
| Corrections | `erase`, `add`, `openings`, `doors`, `windows`, `slits`, excludes with `hide`. | Render zoomed tiles of every corrected spot with the cell grid and the segments drawn. |
| Terrain | The settings' `terrain` block and `rooms` block: rubble, water, slopes, hazards from the text and the art (see [terrain.md](terrain.md)). | Plot every area over the map; no terrain on stairs, wood, banks or trees; judgment calls listed in `decisions`. |
| Lighting | The settings' `lighting` block: the level's rule from the text, the outdoors by sealed flood, roofless areas from the terrain, fixed lights with both radii, colour and intensity from the text (see [lighting.md](lighting.md)). Daylight through windows and open doors is automatic. | Plot the regions; list every room the outdoor flood reaches: each must be a drawn opening, or it is a wall gap to fix. |
| Validate | `node tools/validate.mjs <pack>`. | No errors, no unexplained warnings. **No "walls pinch the doorway" warnings**: every door must be clear to see and walk through when open. |
| Doorways | Render a zoomed tile of **every** door and secret door with the segments drawn. | Square jambs, nothing crossing or running along the door line, the opening as wide as the gap in the art. |
| Leak check | `node tools/mapcheck.mjs <map-dir>` (section 4b): sight from every keyed room with every door closed, and the walking routes in `checks.routes`, in one report. | Nothing outside the room is visible except where the drawing shows an opening on purpose. Trace each leak to its gap and fix it. |
| Movement | Route a Medium creature through doors and passages. | Doors that should be usable are; 5-ft doors stop Large creatures. |
| Sight spot checks | Stand beside each special feature. | Arrow slits work only up close; barred door windows only beside the door; stained glass blocks sight; secret doors block until found and opened. |
| Look at it | Build the demo page on the map and walk it. | It plays the way the adventure reads. |

## 4a. Print-quality maps and sheets with several maps (2026-11-13)

- A 300 ppi print map is 300 px a square. Ask the user what the board should show (they chose 200 px a square: under every GPU's texture limit) and set `source.scale`. Detection runs on a smaller copy (`detect_cell_px`, default 50; 150 for thin-line art), so tracing stays fast whatever the image size.
- A sheet with two maps (a level and its roof): one `import.json` each with `source.crop_px` (source pixels, before scaling), and `grid` in the cropped, scaled image's pixels.
- Thin black wall lines turn grey when downscaled: sample colours at full resolution. If the tracer still breaks them up or picks up grid lines, hand-place the straight walls on their measured lines (`add`) and erase each room's interior (`erase`), as in the [adventure importer](adventure-importer.md) section 6.
- `features.door_reach_cells`: how far past a door bar to look for its jamb (default 0.6). Lower it to about 0.1 where the bars are drawn on the wall line itself.
- `doors: [{near, drop: true}]` removes a false door (a bed's white edge); a mask `exclude` stops it being seen at all.
- `map.start` and `map.links` in the settings are copied into `map.json`.

## 4b. Straight walls, thickness, profiles, veils and the map check (2026-11-13)

Built for the thin-line, grey-stone maps of the first adventure import, and kept general: a map picks a **profile** and
overrides only what differs.

- **Profiles** (`tools/mapimport/profiles.json`): `"profile": "thin-lines-grey-stone"` in `import.json` merges a saved
  set of settings (snap, detection size, mask thresholds, grid-line suppression, straight walls, interior erase,
  squaring, welding) under the map's own; the map's values win. When a new art style needs a different set, save it
  as a new profile rather than copying numbers between maps.
- **Grid-line suppression** (`grid_lines.suppress`) removes thin straight runs on the grid lines before tracing, so the
  printed grid is never read as wall.
- **Straight walls** (`lines`): with `auto`, the tool proposes every long, straight, solid run in the wall mask (with
  clear floor on at least one side, so the inside of solid rock is not proposed) and measures its centre line and
  thickness; `add` lists lines by hand (`{a, b}` in cells, roughly placed; the tool measures the real line nearby, and
  reports any it cannot find in `lines_not_found`); `reject_near` drops a proposal. Double-edged walls are merged and
  collinear walls aligned. Doors and windows on a line are moved onto it and cut out of it. Each line becomes one
  thick segment along its centre (`w`), and its pixels are taken out of the mask, so the tracer only sees what is left
  (curves, rubble, odd corners).
- **Interior erase** (`interior_erase`): each keyed room is flooded from its point, bounded by the mask and the known
  segments; the room's interior (less a margin) is cleared from the mask, which removes furniture, rugs, and grid
  marks that would otherwise be traced as walls. `clip` keeps a flood inside the room where a doorway is open;
  `skip` leaves a room alone (a room whose furniture is drawn walls, or whose floor is not closed).
- **Squaring and welding:** traced walls within `square_up_deg` (3) of the grid's axes are made exactly square. Ends
  closer than `weld_cells` meet at one point: measured lines never move, an end inside a thick wall is buried on its
  centre line, square walls stay square, and everything lands on the snap (1/32 for print-resolution maps). Welding
  can fold a traced outline's two sides onto one line; the importer keeps one of each.
- **Wall thickness** (`w`, docs/design/maps.md section 4): light, sound and movement meet the drawn wall's faces, and
  sight reveals the whole drawn wall. Use it for walls on measured lines; leave traced odd shapes as lines.
- **Veils** (`t: "veil"`, a `door` with an id): a magical barrier the players can see, which the GM dispels in one
  click (the board) and which blocks movement, sight and light until then. Use it for a curtain of darkness, a ward or
  anything the text says vanishes when a condition is met; do not model these as secret doors (players would not see
  them, and they could be "found" and opened). A veil has no leaf, so the doorway pinch check skips it.
- **The map check** (`tools/mapcheck.mjs <map-dir> [--json] [--thorough]`): sight from every keyed room (`rooms.json`,
  room squares) with every door closed must stay inside the room, and every route in `checks.routes`
  (`{from, to, blocked?, note}`) must be walkable with every door open (veils dispelled, secret doors found), except
  that a route marked `blocked` must fail. Views the text allows (a balcony over a hall, outside through a window) go
  in `checks.sees` with a reason. Run it after every change to an import; a map is done when it says OK.
- **Lessons:** a line the eye sees at once may need listing by hand when it lies against rock, webs or a bench; list it
  in `lines.add` with a note naming what hides it, instead of lowering thresholds for the whole map. Erase boxes near
  corners eat walls; check with the map check, not by eye.

## 5. Pitfalls already met

- **Page backgrounds** are often the largest image on a page. They are shared across pages; the map is not.
- **Wall colours:** stone walls can be quite saturated (dark brown). Separate walls by darkness and hue, not low saturation. Marsh water and foliage are separated by hue.
- **Moss and vines** over walls bite holes in the wall mask. Smoothing seals them, but it also seals real narrow gaps, so slits are detected separately.
- **Arrow slits versus moss:** a through-gap test cannot always tell them apart. Detection proposes; review decides, using the text.
- **Rubble against walls** makes wall faces bulge into rooms. Erase it, and add a wall segment if the face needs redrawing.
- **Stairs, spiral stairs, furniture** and dark floor details get detected as walls. Erase them, with a note naming the text that says what they are.
- **White text and frames** (compass letters, inset borders) look like door bars. Exclude insets and legends; mark insets `hide: true` so the board covers them.
- **Pinched doorways.** Door art sits in a dark frame that the wall mask picks up, so the traced wall outline funnels in toward the door bar or runs straight along it. The door then opens but nobody can see or walk through it. The importer now clears each detected door's opening (between the jambs, through the full wall thickness) before tracing. Hand-placed doors and secret doors (`add` with an `erase`) get no such help: erase the whole opening through the wall, not just part of it, and confirm with the validator and a zoomed tile. Fix the cause in the import, never by nudging single segments.
- **Off-grid doorways:** art rarely lines doors up with the grid. The movement engine's clearance (0.3 cells) handles most cases; check routes through every door.
- **Moss over walls can leave gaps the sight leak check misses.** The outdoor flood in the lighting step moves between square centres and found three on Gauntlight; an `erase` box that is too wide can also remove a wall next to what it was meant to erase (A21's stairs took its west wall). Run the flood on every map.
- **Added segments must reach into the walls they join.** A segment that ends exactly at a wall's corner leaves a sliver for sight to leak through; extend each end an eighth of a cell or more into the wall.
- **Segment ids change** every time a map is vectorized again. Corrections are geometric, in cell coordinates, never by segment id.

## 5a. Area maps are not imported

A town or region map (`kind: "area"`, docs/design/maps.md section 3a) has no walls to trace: write its `map.json` by hand from the book's map and text, one place per keyed site, paraphrased. Keep secret sites `public: false`. Places never link to battle maps.

Every **battle** map the importer writes needs a starting area (`start` in `map.json`): choose it from the text and the map (where the adventure has the party arrive, else the road or path in) and record the decision in `import.json`.

## 5b. Printed location numbers on area maps

Almost every adventure's town or region map prints its location numbers on the image. Two ways to live with them:

1. **Keep them, and ring them.** This is the default. Centre each place's pin on its printed marker, size it a little larger than the marker, and copy the number into `number`. The board's pins are rings with a clear inside, so the number stays readable when a pin is hovered, selected or waiting. Check this on the board.
2. **Strip some of them.** Use this for numbers that give something away: a GM-only place whose number is printed, so players would see it. Prefer an unlabelled player version of the map if the user owns one; it is far cleaner. Otherwise run:

   ```
   python3 tools/mapimport/strip_numbers.py packs/<pack>/maps/<area-map> --only 14,17
   ```

   It writes `<image>-stripped`, `<image>-mask.png` and `<image>-strip-check.png` beside the image and never changes the original. Look at the check sheet (original | mask in red | result) for every place before using the stripped image. Then point `image.file` at it and re-upload; the fingerprint changes.

How the tool works, and what was learned on Otari (Abomination Vaults, 2026-11-10):

- **Finding the marker is reliable; filling it is not.** The pin says where to look. Light pixels within `--radius` of the pin, in shapes at least `--min-height` pixels tall, are the marker. That means bare digits (Otari: bold white digits with a black outline) or a light disc behind dark digits (the Sample Village); holes inside a kept shape are filled. Street names next to a number are shorter and are left alone. The mask grows by `--grow` pixels to take the outline.
- **Measure the marker first.** Otari's digits were about 20 px tall in the 1424 px wide scan. A first guess of 22 px found nothing, and a too-large radius would catch street lettering. Crop a few markers, look at them, then set `--min-height` and `--radius`.
- **What the fill can do.** It is OpenCV inpainting (Telea), which spreads the surrounding colours and texture inward. It does not redraw anything.
  - Flat or evenly textured ground fills cleanly: grass, water, a plain roof (Otari 5).
  - Busy detail under a number leaves a soft smudge: a building's corner (Otari 10), market stalls (Otari 12, the worst), a roof ridge line (the Sample Village).
  - Dark rubble blurs but passes (Otari 14).
- **Scale matters.** At the size the board shows a whole town map, stripped spots are hard to find. Zoomed in, every one shows. Strip only what must go.
- **For better results on busy spots**, hand `<image>-mask.png` to a generative fill tool (Photoshop's Generative Fill, for example), which can redraw the detail.
- `--scale` converts pins placed on a different-size copy of the map: Otari's old pins were on the 922 px copy, so `--scale 1.5445` for the 1424 px scan.
- Stripped images are book content: private pack only, never committed. The tool's check sheets too.

## 6. Licensing and privacy

- Book-derived files (map images, walls, settings that name rooms and creatures, demo pages built on them) live only in the user's private `packs/` folder, which git ignores. Before every commit, check that nothing under `packs/` or `pdfsource/` is staged.
- A demo built on a private pack contains the publisher's map: deliver it as a file to the user, never as a published or shared link.
- The repository's tests and examples use original sample maps only.
