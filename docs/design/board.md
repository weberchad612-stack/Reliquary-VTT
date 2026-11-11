# The board (client): design

The client is called **Reliquary Virtual Tabletop**: that is the published page's title and the name the page shows when no campaign is loaded.

Status: agreed with the user on 2026-11-10. Version 1 (map table) built on 2026-11-10: the board page (`board/`), its memory and database stores, the campaign tool, saving to the PC and switching campaigns (tested Keep to Crypt and back). How to run it: [best practices: the board](../best-practices/board.md). The board is the live table page: the map
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
5. Write `board/meta` last: the board sees the new campaign and redraws with its ruleset. (On clearing,
   delete it first, so an open board shows that no campaign is loaded.)

The exact commands are in [best practices: the board](../best-practices/board.md), section 4.

The page cannot write to the PC itself, so switching and saving are always asked of Claude in chat.

## 6. Secrecy

The user owns the board and its database, so nothing can be hidden from the user; the GM switch only
prevents accidental spoilers. When other people play on a board, the secrecy model in the rebuild plan
(a player projection that never receives GM-only data) is separate, later work.

## 7. The title line and the top menu

**The title line**, left to right (agreed with the user on 2026-11-10):

1. **The campaign's title**, from `board/meta`.
2. **The version badge**, generated by the build (`tools/bundle.mjs`): the build's local date and time,
   `v<yy>.<mm>.<dd>-<hhmm>`, so versions sort in order. Its tooltip names the commit it was built from and
   says "+ uncommitted changes" when files differed. After every publish Claude writes the version to
   `app/build`; an open page with an older version shows "A newer version of the board is ready. Reload"
   (dismissable). `app/` is the board's own collection: not part of any campaign, never saved or cleared.
3. **The map menu**, on the current map's name (`board/travel.js`): each map with a sub-menu of its
   entrances.
   - **GM view:** every map in the adventure and every entrance; unfound ones are marked "not found".
     Choosing an entrance previews its map centred on it; "Whole map" previews it all. A preview is this
     screen only: no token moves, nothing is written, a bar says so with a way back to the party's map.
     (The preview reloads the page with `#preview=<map>[:<entrance>]`; the GM view survives that reload.)
   - **Player view:** the maps the party has discovered (and the one it is on), each with the entrances
     it knows. Choosing an entrance on another map, after a confirmation, moves the living PCs on the
     current map there; an entrance on the current map is taken, to its partner on the map it leads to.
     PCs arrive on the arrival squares (the `arrive` cells of the link leading there) and overflow onto the
     nearest free squares that can be walked to from them; foes and others stay behind. The table follows
     the party to the new map.
   - **Starting areas:** every battle map has one (`start`), first in its sub-menu. The GM previews it;
     players travel there from another map (from a town, for instance) and are placed on its squares,
     overflowing as at an entrance.
   - **Discovery is never automatic.** Claude marks maps discovered (`discovered` in `state/table`) and
     entrances found (`links_found` in the map's state), by ruling or because the user says so. The one
     exception: arriving through an entrance makes the way back known (the arrival entrance and its
     partner on the map the party left). Entrances pair through `to_link` (docs/design/maps.md, section 3).

**Area maps** (`board/area.js`; format: docs/design/maps.md, section 3a), agreed on 2026-11-10 from the
previous board's separate Otari town page. A town or region loads in the same board in place of a battle
map, fitted to the window, its places as pins.
- **Map menu:** an area map is one entry, no sub-menu. GM: preview it. Players (once it is discovered):
  move the party there; the PCs go with the party but are not drawn.
- **Pins:** players see public places and those found in play; the GM sees all, GM-only ones dashed.
  Clicking a pin shows its card (kind of place, name, address, a short description; for the GM also the GM
  note and whether it is GM-only). Places do not link to battle maps: the map menu is the way there.
- **Requests:** the card's "The party goes here" leaves one pending request (`state/request`), shown as a
  red dot on the pin and in the change log. A new request replaces it (with a confirmation); the player
  can withdraw it. The board cannot message Claude: the user tells Claude in chat, Claude rules, narrates
  and clears it.
- The shared pieces (menus, travel, preview, version banner) are `board/shell.js`, used by both views.

**Zoom and pan on the battle map** (`board/gestures.js`, built 2026-11-11):
- The mouse wheel zooms about the pointer, one notch about 12%. A trackpad's two-finger scroll zooms too, and
  its pinch (sent as Ctrl+wheel) zooms faster. The + and − buttons, Fit, and the + − 0 keys still work.
- On a touch screen, two fingers pinch to zoom about their midpoint, and pan as they move together. A
  second finger cancels a token drag in progress (the token goes back).
- Panning: hold the right mouse button and drag, anywhere on the map. The pointer is the normal arrow
  until then and becomes a hand only while the right button is held (the user's choice, 2026-11-11). The
  left button never pans: it selects, drags tokens and clicks doors, and a click on empty floor clears the
  selection. On a touch screen (no right button), one finger dragged on empty floor pans; a touch that
  moves less than 4 px is a tap and clears the selection.
- Zoom changes are applied at most once per frame.
- The area view still fits its picture to the window (no zoom yet).

**Selecting several tokens** (agreed with the user and built 2026-11-11):
- A left drag from empty floor draws a selection box. A token is picked if its centre is inside. In the
  player view the box picks PCs only; in the GM view it picks every token, including foes the party cannot
  see and dead creatures. Every box starts a new selection. A plain click on empty floor clears it (on
  release, so a drag can become a box). A box starts only on empty floor: a press on a token still drags
  it, and a press on a door still opens it.
- A selected token is marked by a thin amber square on exactly the grid squares it occupies, not by a
  thicker outline (the user's choice, 2026-11-11). A Tiny creature alone in its square: that square. Tiny
  creatures sharing a square: each selected one gets its own quarter-square, around its quadrant.
- Group moves keep the Tiny stacking rules (`layoutTiny`), even when only some of a square's Tiny creatures
  are selected: those moving give up their quadrants and take free ones where they land; those left behind
  keep theirs, or are centred if now alone. A group drag shows this while dragging, not only on release.
- A group move may put more than four Tiny creatures in one square: it is allowed, without a warning, like
  every other group move; the extras stack on used quadrants (`layoutTiny`), so one can be drawn over
  another. A single token's move into a full square still warns. (The user's choice, 2026-11-11, after
  weighing overflow to the nearest free square, a warning, and refusing the move.)
- Ctrl+click (Cmd+click on a Mac) adds a token to the selection or takes it away (players: their PCs only).
- Dragging any selected token moves the whole selection together, keeping its spacing. No route or cost is
  shown, and no warnings are given for walls, taken squares or Speed (the GM decides). The arrow keys step
  the whole selection one square. Group moves never use marching order (FR-1).
- With two or more selected, the map shows the same view as with nothing selected (the party's view; the
  whole map for the GM), with no movement outlines and no single creature's eyes. The Selection card is
  left as it is (it is being redesigned) and shows its nothing-selected text.
- The selection is this screen's only: not saved, not shared, not logged. The moves are logged as usual.
- Touch screens have no box yet: one finger on empty floor pans.

**The top menu** (`board/menu.js`), modelled on the previous board's top bar and on Foundry's menus:

- **Bar:** Map (Measure, Add note, Show walls, Turn view; Reload), Play (Actions, Exploration, Templates with
  a sub-menu: Burst, Cone, Line, Emanation, Clear templates), Records (Party loot, Quest log, Dice), and two
  buttons straight on the bar, Replay and Narration, which can show a count.
- **Behaviour:** click a menu to open it; once one is open, pointing at another opens that one; one menu
  open at a time; picking an item, clicking outside or Escape closes it. A menu shows as active (amber)
  while one of its toggles is on, and a red dot when something inside is waiting. One level of sub-menu,
  which flips to the other side at the window's edge. Items can carry a tag ("here", "not found"), be
  dimmed, or be shown but disabled.
- **Keyboard:** the WAI-ARIA menubar pattern (arrows along the bar and inside menus, Right and Left into
  and out of a sub-menu, Home and End, Escape one level, Tab out).
- **Views:** an entry marked `gm` shows only in the GM view.
- **Data, not markup:** the menu is a definition (`MENU`); the page only reports what was chosen. Status:
  built on 2026-11-10 with nothing wired; every item says "not built yet". The Export DB item of the
  previous board is gone: saving is Claude's job now (section 5). The rest of the menu is designed later.

## 8. Build order

1. `board/` from the demo, as modules, bundled; the board running from an in-memory store so it can be
   tested headless.
2. The database store: loading, listening, writing, the change log; the GM switch.
3. `tools/campaign.mjs`: pack and save to records and back, with a round-trip check.
4. Publish the board; load the Sample Keep as a campaign; play-test moves, doors, fog and Claude's changes.
5. Save to the PC and switch to the Sample Crypt and back.
6. Best-practice guide for running and maintaining the board.
