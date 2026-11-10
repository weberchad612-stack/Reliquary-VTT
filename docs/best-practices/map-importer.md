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
| Leak check | From a point inside every room, with every door closed, compute what is visible. | Nothing outside the room is visible except where the drawing shows an opening on purpose. Trace each leak to its gap and fix it. |
| Movement | Route a Medium creature through doors and passages. | Doors that should be usable are; 5-ft doors stop Large creatures. |
| Sight spot checks | Stand beside each special feature. | Arrow slits work only up close; barred door windows only beside the door; stained glass blocks sight; secret doors block until found and opened. |
| Look at it | Build the demo page on the map and walk it. | It plays the way the adventure reads. |

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

## 6. Licensing and privacy

- Book-derived files (map images, walls, settings that name rooms and creatures, demo pages built on them) live only in the user's private `packs/` folder, which git ignores. Before every commit, check that nothing under `packs/` or `pdfsource/` is staged.
- A demo built on a private pack contains the publisher's map: deliver it as a file to the user, never as a published or shared link.
- The repository's tests and examples use original sample maps only.
