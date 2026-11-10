# The board (client): design

The client is called **Reliquary Virtual Tabletop**: that is the published page's title and the name the page shows when no campaign is loaded.

Status: agreed with the user on 2026-11-10. Built: the board page (`board/`), its memory and database stores, the campaign tool, and the Sample Keep loaded on the published board; still to do: saving to the PC and switching campaigns (section 5), and the guide. The board is the live table page: the map
engine running against a campaign's data, kept in sync with Claude, who runs the game. The demo page in
`examples/demo/` is its test bench and the starting point for its code.

## 1. Decisions

1. **Version 1 is the map table only:** maps, walls and doors, tokens, fog, light, terrain, movement, the
   player and GM views, saving, and switching campaigns. Dice, initiative, the table log of rolls,
   character panels and handouts come in later versions.
2. **A private board.** The board is a page published in the Claude app, private to its owner. Book
   content (maps, walls, terrain, lighting from a book the user owns) may go onto the owner's own private
   board, as database records and uploaded files. It never goes into the repository and is never shared.
   Development and tests use the Sample Keep and Sample Crypt, which are original and may be published.
3. **One board, many campaigns, any system.** A campaign is an adventure pack, the ruleset the pack names,
   and a save. The board holds the engine and every ruleset in the repository and no adventure; it
   loads whichever campaign is active and uses that campaign's ruleset. Switching adventures, or game
   systems, needs no rebuild or republish.
4. **One campaign in the database at a time (swap-out).** The platform gives a page exactly one database
   and one file store. Instead of sharing them between campaigns, only the active campaign is in the
   database. Switching (see section 5) saves the active campaign to the user's PC, checks the copy,
   clears the database and loads the other campaign from the PC. The database limits therefore apply per
   campaign, and the PC always holds a complete copy of every campaign not being played.
5. **When the game is saved to the PC:** whenever the user says so ("save the game"), and always as part of
   switching. Each save also keeps a dated copy, so the last few can be restored.
6. **Who changes what.** The player, on the board: moves their PCs, opens and closes doors their PCs can
   see, lights or puts out their own PC's carried light, and selects a PC to look through its eyes.
   Claude, through its tools: everything else (foes and NPCs, secret doors, lights, sky, terrain,
   colour and animation settings, the active campaign). The board warns and never blocks, as now.
7. **A deliberate GM switch.** The board always opens in the player view. The GM view sits behind a clearly
   marked button that asks for confirmation ("This reveals unseen foes, secret doors and other
   spoilers") and is dropped on reload. The user uses it to audit how Claude runs the game, so the GM view
   shows exactly what Claude's tools see, and a **change log**: every change, Claude's and the player's,
   with who made it and when.
8. **The Sample Keep is the first campaign;** the Sample Crypt is the second, to prove switching. The user's
   running Abomination Vaults campaign is not migrated from the old board for now; it can start fresh on
   this board later.

## 2. Pieces

| Piece | Where | What |
|---|---|---|
| Board source | `board/` | The page, its styles and the board code (drawing, input, views, sync), split into modules; grown out of `examples/demo/map-demo.html` |
| Bundle | `tools/bundle.mjs` | One self-contained page: board code, engine and every ruleset; no campaign data |
| Campaign tool | `tools/campaign.mjs` | Turns a pack and a save on disk into database records and back; checks a round trip |
| Publish | Claude's artifact tools | Publishes the bundled page as the user's board and declares its database and file storage |
| Database | the board's own | The active campaign (section 3) |
| File storage | the board's own | Map images and other media, by fingerprint |
| Master copy | the user's PC folder (`packs/`, `saves/`) | Every campaign, active or not |

## 3. What is in the database

Small records, so a change rewrites little and the 256 KiB per-record limit is never near. The platform's
database takes two-part paths (`collection/record`), so every path is two parts (layout and conversion in
`board/records.js`):

| Path | Holds | Written by |
|---|---|---|
| `board/meta` | Active campaign: id and title, pack id, title and version, ruleset, schema version, its maps, when loaded, when last saved to the PC | Claude, last when loading |
| `maps/<map>` | The map record: grid, image (uploaded file id and SHA-256 fingerprint), links | Claude (loading) |
| `walls/<map>.<n>` | Wall segments in chunks of 400 | Claude (loading) |
| `terrain/<map>`, `lighting/<map>` | Terrain areas; lighting regions and lights | Claude (loading) |
| `state/table` | Current map, sky, colour and animation switches, notes (a test campaign's tips) | Claude; the GM view |
| `mapstate/<map>` | Door states, found secrets, lights and regions changed in play, terrain switched on or off, hidden markers | Claude; the board (doors, GM view) |
| `tokens/<id>` | One record per token, with the map it is on | Claude; the board (the player's PCs, the GM view) |
| `explored/<map>.<n>` | The party's explored area, in chunks of 200 outlines | The board (a moment after it grows) |
| `log/<time>-<n>` | Change log: who (`claude`, `gm`, `player`), when, what. The board keeps the newest 300 | Whoever made the change |

The page listens to six of these (the meta record, the table, the current map's state, and the token,
explored and log collections), far under the platform's limit of 64. Records are per token and per map,
so the player and Claude changing different things never overwrite each other. Measured: the whole Sample
Keep campaign (three maps, thirteen tokens) is 27 records and about 25 KB.

## 4. How a change flows

- **The player drags a PC:** the board updates the token record and adds a log entry; Claude reads both.
- **Claude moves a foe or opens a secret door:** Claude writes the record and a log entry; every open board
  redraws within a moment.
- **Fog:** the board merges what the party sees into the explored area and writes it a short delay after
  the last change (as the design for the explored area already says), not on every step.

## 5. Switching campaigns (Claude, with the desktop app connected)

1. Read the whole active campaign from the database and write it into its save folder on the PC, with a
   dated copy.
2. Read the written files back and compare them with the database; stop if they differ.
3. Clear the database.
4. Load the other campaign: its pack (maps, walls, terrain, lighting) and its save. Upload any image whose
   fingerprint is not already in file storage; images stay uploaded between switches.
5. Write `board/meta` last: the board sees the new campaign and redraws with its ruleset.

The page cannot write to the PC itself, so switching and saving are always asked of Claude in chat.

## 6. Secrecy

The user owns the board and its database, so nothing can be hidden from the user; the GM switch only
prevents accidental spoilers. When other people play on a board, the secrecy model in the rebuild plan
(a player projection that never receives GM-only data) is separate, later work.

## 7. Build order

1. `board/` from the demo, as modules, bundled; the board running from an in-memory store so it can be
   tested headless.
2. The database store: loading, listening, writing, the change log; the GM switch.
3. `tools/campaign.mjs`: pack and save to records and back, with a round-trip check.
4. Publish the board; load the Sample Keep as a campaign; play-test moves, doors, fog and Claude's changes.
5. Save to the PC and switch to the Sample Crypt and back.
6. Best-practice guide for running and maintaining the board.
