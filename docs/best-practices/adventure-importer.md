# Best practices: the adventure importer

For Claude, when turning one or more adventure PDFs the user owns into a private pack and a campaign: maps, lighting, sound, tokens and their art, objects and treasure, and GM notes. It builds on the [map importer](map-importer.md). The tools only propose: Claude reads, looks and decides, and records every decision. First done end to end with the Pathfinder Beginner Box adventure (2026-11-13).

The user's decisions (2026-11-13): index every book, prepare one level at a time; review on a private review page and as a GM preview on the board; containers, features and hazards become **object tokens** (hidden until found, clickable, holding loot or a note, no initiative unless a hazard); treasure lives inside object tokens and moves to the Party stash with where it was found; room text becomes **paraphrased notes with page references, as complete as possible**; every token gets an image.

## 1. Privacy first

- PDFs go in `pdfsource/`, everything pulled out of them in `extracted/`, the pack in `packs/<pack>/`, the campaign in `saves/<pack>/`. All four are git-ignored. Check before every commit: `git ls-files | grep -cE "^(pdfsource|extracted|packs|saves)/"` must print 0.
- Notes are paraphrased. Never copy read-aloud text or rules text into the pack; give page numbers instead.
- The adventure's art, maps and the demo built from them go to the user as files, never as a published link. On the board they are uploaded as the board's private assets, like map images.
- Tools in `tools/advimport/` are generic and committed; anything naming the book's rooms or creatures lives in the pack.

## 2. The steps

| Step | Do | Check |
|---|---|---|
| Ingest | Copy the PDFs to `pdfsource/` (from the PC: `device_stage_files`). `pdftotext -layout` per page into `extracted/<pack>/text/`; `pdfimages -list` into `extracted/<pack>/images.txt`. Read the contents page to find where the adventure, the creatures, hazards and items are. | Every page has text (no scans); page numbers match the printed ones. |
| Read | Read the **whole** adventure, every keyed area, plus its own stat blocks, hazards and items. | Nothing skimmed: the sentence that matters often sits next to the one a search finds. |
| Notes | Write `packs/<pack>/notes/<level>.md`: per area, what is there (paraphrased read-aloud), the creatures and their tactics, triggers, every check and DC, treasure, XP, where it leads, with page refs. Stat lines in short. | Could Claude run the room from the notes alone? Puzzles have their answers; conversations have what the NPC knows and what wins them over. |
| Room crops | `python3 tools/advimport/roomcrops.py <book.pdf> --level A=<maps.pdf>:<page>[:x0,y0,x1,y1] ... --out extracted/<pack>/roomcrops.json --images extracted/<pack>/markers` registers each page's map crop to the level maps. | Inliers in the hundreds, error under a pixel. A page with few inliers (under 30) needs a look. |
| Maps | The [map importer](map-importer.md), one map per level (`crop_px` cuts several out of one sheet), at the resolution the user chose (`scale`). Walls, doors and their states from the notes, secret doors from the crops' "S" marks, terrain and lighting from the text. Start squares and links between levels in `map.json`. | Validator clean or every warning explained; sight from every room with doors closed; routes through every door with doors open. |
| Art | `python3 tools/advimport/pdfart.py <pdf> --out packs/<pack>/art/<source> [--labels any] [--skip-repeated]` pulls candidate pictures with their labels. Choose one per creature in the user's order (below), write `art/art.json`, run `python3 tools/advimport/tokenart.py packs/<pack>/art/art.json --sheet check.png`. | Look at the check sheet: a face or the whole creature in every circle; give `crop: [x, y, size]` where `top` or `center` misses. |
| Cast and objects | Write `packs/<pack>/adventure.json` (format in `tools/advimport/campaign.mjs`): encounters with their creatures (open stat block key, start square, art key, the book's differences as `stats` or `rules`), objects with their contents (library items by `ref`, custom ones by name), DCs, locks and hazards. | Every creature's stat block exists (`content/pf2e/...`); adjustments the text asks for (weak, elite, a different HP) are applied and noted. |
| Campaign | `node tools/advimport/campaign.mjs packs/<pack> saves/<pack>`, then `node tools/validate.mjs packs/<pack> --save saves/<pack>`. | No errors. |
| Review | Bundle a board on memory (`campaign.mjs seed`, `bundle.mjs --data seed=...`) and walk it in GM view; send it to the user as a file. With "publish", load the campaign into the board as its own campaign. | Tokens show their art, objects open and Take works, lights and doors behave as the notes say. |

## 3. Start positions from the book's pawns

Beginner adventures (and many others) print a crop of the map beside each room with pawn markers laid on top. `roomcrops.py` registers the crop to the level map (ORB features + RANSAC similarity) and converts each marker's centre to a grid cell. The markers are the creature's portrait, saved as candidate art. Creatures the book does not show (a monster that appears later) are placed from the text and noted.

When registering, the level map is extracted once at a third of its size; the tool normalises the grid so cell 0 is the first full cell, as `map.json` has it.

## 4. Token art, in the user's order

1. The adventure PDF's own art (its bestiary pages carry one large picture per creature; uniques often have their own portrait elsewhere in the book).
2. A token pack PDF that comes with the adventure (pawn sheets: the name is printed across the bottom of each pawn).
3. The Monster Core books on the PC (`PF2E_Claude_VTT/pdfsource`, `Reliquary-VTT/pdfsource`).
4. The web, through Claude in Chrome on the user's PC, saved into the private pack; list every token that used web art.

Every token gets an image. The round token is a square crop (512 px); the Quick-View shows the whole picture, contained, never cropped. **Neither is ever transparent:** a soft mask is composited onto the picture's own background (white for pawn sheets, the page colour otherwise).

## 5. What the board does with it

- **Token art** (`token.art`, a key of the pack's `art/art.json`): the art replaces the letter in the token's circle, with a ring in its side's colour; the Quick-View opens with the full picture. Loaded like map images: `campaign.mjs` lists each file with its fingerprint, uploads what the board does not have yet, and writes `art/<key>` records.
- **Object tokens** (`kind: "object"`, game data in `actors/<id>` with `kind: "object"`; board/objects.js): drawn as rounded squares; never block movement; usually `hidden` until the party finds them. Quick-View: the description; the GM's notes, find DC, lock and hazard (GM only); the contents, each with **Take**, and **Take everything**. Players see inside once it is open: nothing in the way, or the GM pressed "Open to players". Taken items go to the Party stash with `found: {from, where: {map, area}, game}`; coins go to the purse; each take is written to the audit log.
- **Friendly creatures** (a ghost, a merchant) are `neutral` tokens (gold ring). A creature with no stat block (a merchant who never fights) is a token with a note and no game data.

## 6. Lessons from the first import

- **Read every keyed area in full before touching a map.** Doors' states, the veils, the underwater crossings and the blocked hall were all in the text, not the art.
- **Clean, thin-line maps defeat the wall tracer's defaults.** Sample colours at full resolution (thin black lines read as grey when downscaled), trace at about 150 px a square with a dark threshold, hand-place straight walls on their measured lines, and erase each room's interior so grid lines and floor detail do not become walls.
- **Measure door bars.** Doors drawn on the wall line need `features.door_reach_cells` near 0.1, or every door grows by most of a square.
- **The labelled map may not be in the PDF** (an inside cover): the per-room crops and the text together still place every key.
- **The book's simplified stat blocks differ from the open data in small ways** (weak creatures, a young creature's HP, a speed): apply them as the actor's differences and say so in its note.
- **One sheet, two maps:** a level and its roof printed together are imported as two maps with `crop_px`, linked by the lift.
- Features for the next import are listed in [future/adventure-importer.md](../../future/adventure-importer.md).
