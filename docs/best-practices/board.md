# Best practices: the board

For Claude, when running a game on the board (Reliquary Virtual Tabletop) and when loading, saving and switching campaigns (`board/`, `board/records.js`, `tools/campaign.mjs`; design: [board.md](../design/board.md)).

## 1. What lives where

| Place | What | Who writes it |
|---|---|---|
| The board's database | The **active** campaign only, as small two-part records (`board/meta`, `maps/`, `walls/`, `terrain/`, `lighting/`, `state/table`, `mapstate/`, `tokens/`, `explored/`, `log/`; layout in the design, section 3) | Claude; the board for the player's moves, doors, lights, the GM view and the explored area |
| The board's own record, `app/build` | The version of the board last published (section 7); not part of any campaign | Claude, after each publish |
| The board's file storage | Map images, uploaded once and reused across switches (matched by SHA-256) | Claude |
| The PC: `saves/<campaign>/` in the user's Reliquary-VTT folder | Every campaign's save (`campaign.json`, `maps/<id>.json`) and its `backups/` (the last five) | Claude, through the desktop app |
| The pack (`examples/sample-pack`, or a private `packs/<id>`) | Maps, walls, terrain and lighting: never changed by play | The importer |

The database is the truth during play; the PC save is the truth between sessions and for any campaign that is not loaded. `saves/` and `packs/` are private and git-ignored: book content goes only onto the user's own private board, never into the repository or anything shared.

## 2. During play

- **Read before you write.** Get the record (`db_get`, or `db_list` for a collection) for its version, then write with `ifVersion`. A token the player has been dragging changes version on every move (Pip reached version 41 in one test), so read it right before writing.
- **Change one record at a time** for small changes (`update` a token's `x`/`y`, `merge` a door into `mapstate/<map>`), and add a log entry in the same call. The board redraws every open page within a moment.
- **Log entries use the board's own format**, so they sort and show correctly in the change log:
  path `log/<time36>-<n><rand>` with `time36 = Date.now().toString(36).padStart(9, '0')` (for example `log/0mwbam9my-0clde`), and data `{by: "claude", at: <ISO time>, map: <map id>, what: "<one line>"}`. (An entry first written as `{t, text}` with an id lacking the leading zero showed wrongly and sorted last.)
- **Read the log to see what the player did** since you last looked (moves, doors, lights). In GM view the user can read the same log to audit Claude.
- The player moves their PCs, opens doors and toggles their own light; everything else is Claude's (or the GM view's). Do not undo a player's move silently: say why in chat and in the log.

## 3. Save the game (when the user says so, and before every switch)

1. **Read the save's collections** with their versions: `board`, `state`, `mapstate`, `tokens`, `explored` (`SAVE_COLLECTIONS` in `tools/campaign.mjs`). Write them as `{"records": {"<collection>/<id>": data, ...}}`.
2. **Copy the PC save into the workspace** (stage `saves/<campaign>/` from the PC, or use the identical copy kept in the outputs folder), then
   `node tools/campaign.mjs save records.json <save-copy>`: it backs up the previous save into `backups/<time>/` (keeps 5) and writes the new one.
3. **Verify:** `node tools/campaign.mjs verify records.json <pack> <save-copy>` must print "save matches the board". Stop if it does not.
4. **Write it to the PC** (`device_commit_files` into `saves/<campaign>/`, with the backup files), then **read it back**: `sha256sum` on the PC must match the workspace copy, file by file.
5. Tell the user the save is on their PC, with what it holds (where the PCs are, doors opened).

The page cannot write to the PC itself, so saving is always asked of Claude in chat.

## 4. Switch campaigns

1. **Save** the active campaign (section 3) and verify it on the PC.
2. **List every record** in the database with its version: all ten campaign collections, including the pack records and `log` (not `app/`, the board's own). Build a listing `{path: version}` and run `node tools/campaign.mjs ops-clear listing.json --out clear.json`.
3. **Clear**, with `board/meta` **first** in the first call, so an open board shows "No campaign is loaded" rather than half a campaign. Every delete needs the record's current version; a call of up to 50 ops commits all or none, so a stale version refuses the whole call and writes nothing: read again and resend. Wait 2 seconds between big calls.
4. **Build the load:** list the board's uploaded files (`list_assets`, saved as `assets.json`), then
   `node tools/campaign.mjs ops-load <pack> <save> --assets assets.json --out load.json`. Upload every image under `upload` (usually none: images stay uploaded and are matched by SHA-256), then run `ops-load` again so the map records carry the asset ids.
5. **Load:** write each batch as new records (no `ifVersion`), with an idempotency key so a retry cannot write twice; then a log entry and `board/meta` **last**. An open board (even one showing "No campaign is loaded") reloads into the new campaign by itself.
6. **Ask the user to confirm** the board switched without a manual refresh, and that the PCs, doors and explored area look as they were saved.

Tested on 2026-11-10: Keep to Crypt and back. Sizes: the Keep is 26 load records (about 26 KB), the Crypt 20; a clear after a short session was 37 deletes (15 of them log entries).

## 5. Lessons

- **Two-part paths only.** The platform's database takes `collection/record`; deeper paths are refused, which is why walls and the explored area are chunked as `walls/<map>.<nnn>`.
- **Meta first on clear, last on load.** The board watches `board/meta`: it reloads when it changes and waits on an empty board until it appears.
- **Every move is a write.** A player dragging a token writes its record and a log entry each square. Fine for one table; the board keeps only the newest 300 log entries. Watch it if writes become a cost.
- **Images are matched by fingerprint.** `list_assets` returns each file's SHA-256, the same fingerprint the map record holds, so a switch re-uploads nothing.
- **Verify on the PC, not just in the workspace.** The read-back checksum is what proves the save reached the user's disk.
- **Do not trust a log entry you wrote by hand** until you have compared it with one the board wrote (section 2).

## 6. Maps, entrances, area maps and discovery

- **Mark a map discovered** when the party learns of it (your ruling, or the user says so): add its id to `discovered` in `state/table` (read for the version, `update`), with a log entry ("Claude: the party learns of the Stairwell"). Players see it in the map menu at once.
- **Mark an entrance found** the same way: add its id to `links_found` in `mapstate/<map>`. The pack's `found` is only the starting state.
- **Never mark anything just because it would be convenient**: discovery is a ruling. The board marks one thing by itself: arriving through an entrance makes the way back known.
- **When the party moves**, the board writes the PCs' tokens (map and square), any newly known entrances, a log entry by the player, and `current_map` last. Read the log to narrate the arrival. If an entrance has no room, the board refuses and tells the player to ask you: place the PCs yourself.
- **Moving the party yourself:** write each PC's `map`, `x`, `y`, then `current_map` last (every open board reloads on it). Use the arrival squares and the same overflow rule (`planArrival` in `board/travel.js`, with the target map's walls and doors).
- **Give every battle map a starting area** (`start`) where the party would logically arrive: the road or path into it, never inside a wall. The validator warns about a battle map without one.
- **Pair entrances in packs** with `to_link`, both ways; the validator warns about an unpaired one. A link's `arrive` cells are on the map it leads to.

### Area maps (towns)

- **Requests.** A player's "The party goes to …" is in `state/request` (`{by, at, map, place, what, status}`) and in the change log. When the user next writes, read it, rule, narrate, then **delete `state/request`** (with its version) so the pin's waiting dot clears. One at a time: a new request replaces the old.
- **Reveal a GM-only place** (the party finds the hideout): add its id to `places_found` in `mapstate/<area map>`. Public places need nothing.
- **A scene that needs a battle map** (the graveyard): the players take it from the map menu (its starting area, or a known entrance), or you move the PCs yourself, as for any move (their `map`, `x`, `y`, then `current_map` last). Places never link to battle maps.
- **PCs on an area map** keep their last square but are not drawn. When the party leaves for a battle map, they arrive on its starting area or on the chosen entrance's squares.
- **Printed numbers:** most adventure maps number their locations on the image. Centre each pin on the printed marker, size it to ring it (a little larger than the marker), and copy the number into `number`. Check the result on the board: every number must stay readable when its pin is hovered or selected. To remove a number that gives a secret away, see [map-importer.md section 5b](map-importer.md) (`tools/mapimport/strip_numbers.py`, and what it can and cannot do).
- **Building one** from a book: an area map is written by hand, not by the importer. The image goes into the private pack; each place gets a paraphrased, player-safe `note` and, if needed, a `gm_note`. Mark anything the players should not know yet `public: false`. Validate with `tools/validate.mjs`.

## 7. The version badge and publishing

- The bundler stamps every build (`/*@BUILD@*/`): the badge shows the version, the tooltip the commit and whether there were uncommitted changes. Commit before publishing when you can, so the badge points at real code.
- **After every publish, write the version to `app/build`** (`{version, commit, at}`; read it first for its version). Open boards with an older build then offer to reload. `app/` is not a campaign collection: leave it out of saves and out of the clear listing when switching campaigns.

## 8. The top menu

- **Add an entry to `MENU`** in `board/menu.js`, not markup: `{id, label, kind}` (`command`, `toggle`, `radio`, or `button` on the bar), `items` for a menu or sub-menu, `{sep: true}` for a line. Optional: `hint` (tooltip), `gm: true`, `key` (shown, not bound), `badge: true`.
- **Wire it in `app.js`**, in the menu's `onSelect(id, item, state)`: one `case` per id. Ids are unique; a repeat fails at start-up and in the tests.
- **Keep the menu in step** when the board changes a toggle some other way (`menu.setToggle(id, on)`), and use `setBadge(id, n)` for counts (Replay, Narration) and `setPending(menuId, true)` for a menu that needs attention.
- **One level of sub-menu.** Deeper menus are hard to use with a mouse and on a phone; split the menu instead.
- Test the rules in `tests/board-menu.test.mjs`; check the page by hand (or headless) for clicking, hovering across the bar, the keyboard and a narrow window.

## 9. Zoom and pan

- Gestures are in `board/gestures.js` (the arithmetic, tested in `tests/board-gestures.test.mjs`) and wired in `app.js` next to the canvas's pointer handlers. Keep new pointer features in that one place: a press is a token drag, a pan, or one of the click actions (door, lamp, terrain), decided on the press.
- Clicks that act on empty floor must act on release, not on press, so a drag can still become a pan.
- Test in a browser with a real touch pinch (DevTools touch emulation, or `Input.dispatchTouchEvent` headless) as well as the wheel. A token placed near a map edge may be off screen when zoomed: scroll to it first.
- Avoid `export const f = (a, b = X) => ...` in board modules: the bundler takes the default argument for a second export. Write a function.

## 10. Changing the board

- Edit the modules in `board/`, then bundle: `node tools/bundle.mjs board/index.html <out.html>` (add `--data seed=<seed.json>` from `campaign.mjs seed` for a board running on memory) and publish the result to the same artifact (keep its slug; the database stays).
- `npm test` runs the board on a memory store headless (`tests/board-*.test.mjs`, `tests/demo.test.mjs`); add a test for any change to the record layout, and keep `records.js`, the schemas and the design's section 3 in step.
- A change to the record layout is a migration: save every campaign to the PC first, then load them again with the new tools.
