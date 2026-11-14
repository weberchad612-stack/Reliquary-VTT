# Best practices: the adventure importer

For Claude, when turning one or more adventure PDFs the user owns into a private pack and a campaign: maps, lighting, sound, tokens and their art, objects and treasure, and GM notes. It builds on the [map importer](map-importer.md). The tools only propose: Claude reads, looks and decides, and records every decision. First done end to end with the Pathfinder Beginner Box adventure (2026-11-13).

The user's decisions (2026-11-13): index every book, prepare one level at a time; review on a private review page and as a GM preview on the board; containers, features and hazards become **object tokens** (hidden until found, clickable, holding loot or a note, no initiative unless a hazard); treasure lives inside object tokens and moves to the Party stash with where it was found; room text becomes **paraphrased notes with page references, as complete as possible**; every token gets an image; every adventure gets a **landing page** (its cover, where the party waits while players join; 2026-11-13).

## 1. Privacy first

- PDFs go in `pdfsource/`, everything pulled out of them in `extracted/`, the pack in `packs/<pack>/`, the campaign in `saves/<pack>/`. All four are git-ignored. Check before every commit: `git ls-files | grep -cE "^(pdfsource|extracted|packs|saves)/"` must print 0.
- Notes are paraphrased. Never copy read-aloud text or rules text into the pack; give page numbers instead.
- The adventure's art, maps and the demo built from them go to the user as files, never as a published link. On the board they are uploaded as the board's private assets, like map images.
- Tools in `tools/advimport/` are generic and committed; anything naming the book's rooms or creatures lives in the pack.

## 2. The steps

**One command runs them (2026-11-13).** `node tools/advimport/run.mjs packs/<pack> init` writes the pack's
`pipeline.json` with the standard steps; fill in its `vars` (the PDFs, the room-crop levels, the adventure's pages,
the book's running heads) and change what this book needs (the Unlit Star's landing page uses page 2's art, for
instance). Then `run.mjs packs/<pack> run` runs what is out of date, in order, and stops at a failure; `status` is
the table (up to date, out of date and why, failed, waiting for review); `approve <step>` marks a review step done
once Claude has looked; `mark <steps>` records results made by hand before the pack had a pipeline. A step is out of
date when its definition changed, an output is missing, or an input changed since it last ran. Review steps (the
maps, the landing page, statmatch, the area checklist, loot, links, the review sheet) wait for `approve` after
every run, and the table shows them until then. The table below is what each step does and what to check.

| Step | Do | Check |
|---|---|---|
| Ingest | Copy the PDFs to `pdfsource/` (from the PC: `device_stage_files`). `pdftotext -layout` per page into `extracted/<pack>/text/`; `pdfimages -list` into `extracted/<pack>/images.txt`. Read the contents page to find where the adventure, the creatures, hazards and items are. | Every page has text (no scans); page numbers match the printed ones. |
| Read | Read the **whole** adventure, every keyed area, plus its own stat blocks, hazards and items. | Nothing skimmed: the sentence that matters often sits next to the one a search finds. |
| Notes | Write `packs/<pack>/notes/<level>.md`: per area, what is there (paraphrased read-aloud), the creatures and their tactics, triggers, every check and DC, treasure, XP, where it leads, with page refs. Stat lines in short. | Could Claude run the room from the notes alone? Puzzles have their answers; conversations have what the NPC knows and what wins them over. |
| Room crops | `python3 tools/advimport/roomcrops.py <book.pdf> --level A=<maps.pdf>:<page>[:x0,y0,x1,y1] ... --out extracted/<pack>/roomcrops.json --images extracted/<pack>/markers` registers each page's map crop to the level maps. | Inliers in the hundreds, error under a pixel. A page with few inliers (under 30) needs a look. Each crop's room captions ("A5. Lavatory") are read too; `--refresh <book> <json>` re-reads them without registering again. |
| Maps | The [map importer](map-importer.md), one map per level (`crop_px` cuts several out of one sheet), at the resolution the user chose (`scale`). Walls, doors and their states from the notes, secret doors from the crops' "S" marks, terrain and lighting from the text. Start squares and links between levels in `map.json`. | `node tools/mapcheck.mjs packs/<pack>/maps/<map>` says OK (sight from every room with doors closed; the routes in `checks.routes`); validator clean or every warning explained. A barrier the text says vanishes is a `veil`, not a secret door. |
| Landing page | `python3 tools/advimport/landing.py packs/<pack> --pdf <book.pdf> --page N [--xref X \| --clip ...]` or `--image <cover>`: the book's cover as a landing page, first in `pack.json`; name it in `adventure.json` (`"landing": "landing"`) so the campaign starts there. When the book has no cover, ask the user which art to use (the Unlit Star used its first chapter's opening art). | Opaque, the whole picture; the campaign's `current_map` is the landing page. |
| Art | `python3 tools/advimport/pdfart.py <pdf> --out packs/<pack>/art/<source> [--labels any] [--skip-repeated]` pulls candidate pictures with their labels. Choose one per creature in the user's order (below), write `art/art.json`, run `python3 tools/advimport/tokenart.py packs/<pack>/art/art.json --sheet check.png`. | Look at the check sheet: a face or the whole creature in every circle; give `crop: [x, y, size]` where `top` or `center` misses. |
| Cast and objects | Write `packs/<pack>/adventure.json` (format in `tools/advimport/campaign.mjs`): encounters with their creatures (open stat block key, start square, art key, the book's differences as `stats` or `rules`), objects with their contents (library items by `ref`, custom ones by name), DCs, locks and hazards. | `node tools/advimport/statmatch.mjs packs/<pack> extracted/<pack>/text --pages A-B --skip '<running heads>'` matches every printed stat block with the open content and lists what the book changes (weak, elite, HP, a Speed); every difference is applied (`stats`, `rules`) or explained. The reader is the game system's (`rulesets/<system>/bookimport.js`). |
| Rooms | `python3 tools/advimport/roomtable.py packs/<pack> --from-crops extracted/<pack>/roomcrops.json --levels A=<map>,... --overrides <spec.json> --write-spec <merged.json>` proposes each room's point and title from the book's labelled maps and crops; the overrides fix the rest (key, a point inside, title, pages; `clip` for a room open to its neighbours). Writes each map's `rooms.json`, which the map check uses. | No square in two rooms; sizes plausible. |
| Illustrations | `art/illustrations.json`: every picture that belongs to an area (file, page, area, what it shows, spoiler, when to show it). | Spoilers marked. |
| Sound and memory | In `adventure.json`: `ambient` (a loop per sound source the text gives: fires, water, magic, a crypt), `music.themes` (each map's music out of combat), `map_state` (a light that starts off), `ledger` (the quest, threads, secrets, timed events). | Loops exist in `sounds/sounds.json`; the ledger holds what Claude must not forget. |
| Campaign | `node tools/advimport/campaign.mjs packs/<pack> saves/<pack>` (a campaign already there: `--update`, section 7), then `node tools/validate.mjs packs/<pack> --save saves/<pack>`. | No errors. |
| Area checklist | `node tools/advimport/areas.mjs packs/<pack> extracted/<pack>/text --pages A-B --skip '<running heads>' --proposals <file>` (#14, #15): every keyed area's checks and DCs, doors (locked, stuck, barred, secret), light, terrain, treasure, stat blocks and events (a timed beat, a fight's reinforcements, something that happens once the party does something, a skill challenge or subsystem block), against the notes, `adventure.json`, the room's doors, lighting (lights reaching it count) and terrain. For doors, light and terrain it proposes `import.json` entries; for an event, an `adventure.json` events entry to fill in (paraphrase, page refs; [events.md](events.md)). An event counts for its `where.area` and any `areas`. | Nothing to check. Each item is fixed, or explained in `checklist.json` (`{"explained": [{"area", "match", "why"}]}`). On the first import it found the A4 light my notes had and the map lacked. |
| Loot | `node tools/advimport/lootmatch.mjs packs/<pack> extracted/<pack>/text --pages A-B --skip '...'` (#16): item refs and hazard keys exist; prices printed after a name; named items that could be content items; treasure text no object holds; hazards' printed numbers (from their own block) against the content. | Nothing to check, or explained in `checklist.json`. |
| Levels | `node tools/advimport/links.mjs packs/<pack> extracted/<pack>/text --pages A-B --skip '...'` (#25): stairs, lifts, ladders and trapdoors the text names, paired with the area they reach on another map, against the maps' links; `--json` gives the missing ones in `map.links` format. | A pair "named" in one sentence is reliable; "likely" (a way up meeting a way down) usually; "weak" is a list to look through. Move each proposed square onto the drawn stairs. |
| Crops | `node tools/advimport/cropcheck.mjs packs/<pack> extracted/<pack>/roomcrops.json --levels A=<map>,...` (#17): each room's squares against its book crop's footprint. | No room reaches outside its crop (a missing wall lets the room's flood run on). |
| Review sheet | `python3 tools/advimport/reviewsheet.py packs/<pack> --book <book.pdf> --crops extracted/<pack>/roomcrops.json --levels A=<map>,...` (#21): `packs/<pack>/review/<map>.png`, each room's book crop beside our walls (by type), its squares, the importer's wall suggestions (dashed magenta) and what changed since the last build (green new, red removed). For Claude; the user sees it on request. | Look at every room. Each suggestion is a missing wall (add it to `lines.add`) or not (`lines.dismiss_near`, with a note). |
| Review page | `python3 tools/advimport/review.py packs/<pack> --save saves/<pack>`: one file, sent to the user. | Everything above on one page. |
| Review | The campaign opens on the landing page (`campaign.mjs` warns when there is none). Bundle a board on memory (`campaign.mjs seed`, `bundle.mjs --data seed=...`) and walk it in GM view; send it to the user as a file. With "publish", load the campaign into the board as its own campaign. | Tokens show their art, objects open and Take works, lights and doors behave as the notes say. |

## 2b. Events and subsystems

Every event the area checklist finds (a timed beat, reinforcements, something that happens once the party does
something, a skill challenge or subsystem block) is written into `adventure.json` `events` (and `subsystems`), or
explained in `checklist.json` when the notes or an encounter already carry it (a room rule, a puzzle's XP, where a
creature starts). Paraphrase with page references. Then `campaign.mjs --update` and a dry run of each event on a
scratch copy of the save with a PC placed in its area: due, tick, the subsystem's checks, each branch
([events.md](events.md)). The first adventure's dry runs found two engine bugs before play.

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
- **A barrier the text says vanishes is a `veil`**, not a secret door: players see it, and the GM dispels it in one click when the text's trigger happens.
- **Clean, thin-line maps defeat the wall tracer's defaults.** Sample colours at full resolution (thin black lines read as grey when downscaled) and use the `thin-lines-grey-stone` profile: detection at 150 px a square, grid lines suppressed, straight walls found and measured by the tool as thick walls, room interiors erased, traced walls squared and welded on the 1/32 snap ([map-importer.md](map-importer.md) section 4b). On the first import this cut the hand corrections on level A from 79 to 21 and removed three sight leaks the hand-built walls had. Walls hidden against rock, webs or furniture still need listing by hand (`lines.add`).
- **Measure door bars.** Doors drawn on the wall line need `features.door_reach_cells` near 0.1, or every door grows by most of a square.
- **The labelled map may not be in the PDF** (an inside cover): the per-room crops and the text together still place every key.
- **The book's simplified stat blocks differ from the open data in small ways** (weak creatures, a young creature's HP, a speed): `statmatch.mjs` lists every one; apply them as the actor's differences and say so in its note. It found two that had been missed by reading.
- **One sheet, two maps:** a level and its roof printed together are imported as two maps with `crop_px`, linked by the lift.
- Features for the next import are listed in [future/adventure-importer.md](../../future/adventure-importer.md).

## 7. Updating a campaign that is being played (#19)

`campaign.mjs <pack> <save> --update` refreshes a campaign from its pack without losing play. Use it whenever the
pack changes after the campaign exists. The pipeline's campaign step always uses it; `--force` starts over and is
for a campaign nobody has played.

- **From the pack:** tokens' art, notes, size, type and group. Creatures' stat blocks and the book's changes.
  Objects' text, notes, DCs, locks and hazards.
- **Kept from play:** where every token is, hidden, dead, effects, names learned and kind after a ruling. Door
  states and explored areas. What was taken from objects (`items` and `coins`). PCs and every token added in
  play. The table, the clock, music, players. The ledger's own entries.
- **Added:** new creatures and objects, new maps, new ambient sounds, and adventure ledger entries not there yet.
- **Reported, not deleted:** creatures and objects the adventure no longer has. Tokens built from the adventure
  carry `source: "adventure"` so this can be told.
- **Dropped:** door states for doors no longer on a map (also reported).

## 8. Sending the pack to the user's PC (#23)

`node tools/advimport/sync.mjs packs/<pack> --save saves/<pack>` packs what changed since the last sync into parts
the device bridge can carry, with `manifest.json` and `apply.sh`, and prints the two steps:

1. `device_commit_files` puts every file into `<checkout>/_sync/<stamp>/`.
2. `device_bash` runs `bash .../apply.sh <checkout>`.

On the PC, `apply.sh` handles each file like this:

- It checks the archive's md5 first.
- It writes a file only when the PC's copy is the one last sent, and overwrites in place (deleting is not allowed
  there).
- A file the user changed there is kept, and the new copy goes to `incoming/` beside it. This is how a save
  written after play is protected.
- A first-time overwrite backs up the PC's copy into `_to_delete/<stamp>/replaced/`.
- Files gone from the pack move to `_to_delete/<stamp>/`.

For the first sync of a pack the PC already holds, list the PC's files first:

    find packs/<pack> saves/<pack> -type f ! -path '*/.cache/*' -exec md5sum {} + > _pc-md5.txt

Stage that file and pass it as `--pc <file>`. Left out of every sync: caches, run state, and the art step's working
`art/candidates/` (`pdfart.py` makes them again). `art/book/` is sent, because it holds the chosen art's sources.

## 9. What the second round of tools found on the first import (2026-11-13)

- **Area checklist:** one real miss. The A4 light was in my notes, but not on the map.
- **Map check, reachability:** A12 and A13 could not be reached. The import had blocked their doors, but the
  drawing puts the rubble between the doors in the hall. It also found two door leaves that open onto the rubble.
- **Statmatch:** two misses earlier (the weak slimes, a swim Speed).
- **Wall suggestions:** they find one of the four walls once listed by hand. They're useful as a pointer on the
  review sheet, not as a replacement for looking.
- **Links between levels:** weak on a book that describes its lift outside the keyed areas.
- **Speed:** level A's rebuild went from 68 s to 5 s.
