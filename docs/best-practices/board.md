# Best practices: the board

For Claude, when running a game on the board (Reliquary Virtual Tabletop) and when loading, saving and switching campaigns (`board/`, `board/records.js`, `tools/campaign.mjs`; design: [board.md](../design/board.md)).

## 1. What lives where

| Place | What | Who writes it |
|---|---|---|
| The board's database | The **active** campaign only, as small two-part records (`board/meta`, `maps/`, `walls/`, `terrain/`, `lighting/`, `state/table`, `mapstate/`, `tokens/`, `explored/`, `templates/`, `notes/`, `targets/`, `chat/` (Claude's narration and messages, roll cards, table events), `audit/` (the GM's audit log), `dice/` (the dice statistics), `state/encounter`, `actors/`, `actorstate/`, `content/`, `fxlib/pack`, and `fx/` while effects play; layout in the design, section 3) | Claude; the board for the player's moves, doors, lights, the GM view and the explored area |
| The board's own record, `app/build` | The version of the board last published (section 7); not part of any campaign | Claude, after each publish |
| The board's file storage | Map images, uploaded once and reused across switches (matched by SHA-256) | Claude |
| The PC: `saves/<campaign>/` in the user's Reliquary-VTT folder | Every campaign's save (`campaign.json`, `maps/<id>.json`) and its `backups/` (the last five) | Claude, through the desktop app |
| The pack (`examples/sample-pack`, or a private `packs/<id>`) | Maps, walls, terrain and lighting, and optionally its own visual effects (`effects.json`): never changed by play | The importer; Claude for effects |

The database is the truth during play; the PC save is the truth between sessions and for any campaign that is not loaded. `saves/` and `packs/` are private and git-ignored: book content goes only onto the user's own private board, never into the repository or anything shared.

## 2. During play

- **Read before you write.** Get the record (`db_get`, or `db_list` for a collection) for its version, then write with `ifVersion`. A token the player has been dragging changes version on every move (Pip reached version 41 in one test), so read it right before writing.
- **Change one record at a time** for small changes (`update` a token's `x`/`y`, `merge` a door into `mapstate/<map>`), and add an audit line in the same call (and a chat event when players should know: damage, a condition, a death). The board redraws every open page within a moment.
- **Audit lines and chat events use the board's own format**, so they sort and show correctly: make them with `tools/chat.mjs audit "..."` and `tools/chat.mjs event "..."` (or `board/audit.js` `auditPath`/`auditEntry` and `board/chat.js` `chatPath`/`eventMessage`). An audit entry is `audit/<time36>-<n><rand>` with `time36 = Date.now().toString(36).padStart(9, '0')` (for example `audit/0mwbam9my-0clde`) and data `{at: <ISO time>, by: "claude", text: "<one line>", map: <map id>, level?: "warn"}`. (An entry with an id lacking the leading zero sorts last.)
- **Read the audit log to see what the player did** since you last looked (moves, doors, lights, conditions). In the GM view the user reads the same log to audit Claude.
- **What the player does on the board:** moves their PCs, opens doors they can see, toggles their own light, targets (T, a targeting box, or right-click a token), places and removes their own area templates (right-click a PC, Area template), adds and changes their own map notes (the Notes tab's Add note, or N over the map; edited and removed on the map or in the tab), and sets status effects on their own PCs (right-click, Assign status effects). Everything else is Claude's (or the GM view's). Do not undo a player's change silently: say why in chat (a ruling) and in the audit log.
- **Claude's tools at the table** (each prints the record to write with `db_write`; details in section 12):

  | To | Use | Writes |
  |---|---|---|
  | Add a creature (fresh id, free letter) | `node tools/token.mjs add --state <save>/maps/<map>.json --name "Wet-Nosed Rat" --type rat --group cellar-rats --at 12,27` (`reveal`, `find`, `check`) | `tokens/<id>` |
  | Place an area template (and see who is in it) | `node tools/area.mjs <map-dir> --shape cone --ft 15 --caster "Lyra" --dir north --state <save>/maps/<map>.json` | `templates/<id>` |
  | Pin a note to the map (shared or GM-only) | `node tools/note.mjs <map-dir> --at X,Y --text "..." [--gm-only]` | `notes/<id>` |
  | Set conditions, custom effects, dead, elevation | `node tools/effect.mjs <token.json> add frightened 2` (`custom`, `remove`, `clear`, `dead`, `alive`, `elevation 15`; `list`) | `tokens/<id>` |
  | Play a visual effect (an attack, a spell, a heal) | `node tools/fx.mjs play strike_slash --map <map> --state <save>/maps/<map>.json --from "Kerra" --to "Wet-Nosed Rat" --result crit --text "-18"` (`list` shows the effects) | `fx/<time>-<n>` |
  | A creature's numbers, damage, healing, checks | `node tools/actor.mjs <pack> <save> show "Kerra"`, `damage`, `heal`...; `node tools/check.mjs ...` ([game data guide](game-data.md)) | `actorstate/<id>`, `tokens/<id>` |
  | Know the player's targets | read `targets/player` | (nothing) |
  | Measure, route, sight, fog | `tools/move.mjs`, `tools/sight.mjs`, `tools/fog.mjs` | (nothing) |

## 3. Save the game (when the user says so, and before every switch)

1. **Read the save's collections** with their versions: `board`, `state`, `mapstate`, `tokens`, `explored`, `templates`, `notes`, `actors`, `actorstate`, `chat`, `audit`, `dice`, `replay` (`SAVE_COLLECTIONS` in `tools/campaign.mjs`; when a collection is added there, add it here too). Write them as `{"records": {"<collection>/<id>": data, ...}}`.
2. **Copy the PC save into the workspace** (stage `saves/<campaign>/` from the PC, or use the identical copy kept in the outputs folder), then
   `node tools/campaign.mjs save records.json <save-copy>`: it backs up the previous save into `backups/<time>/` (keeps 5) and writes the new one.
3. **Verify:** `node tools/campaign.mjs verify records.json <pack> <save-copy>` must print "save matches the board". Stop if it does not.
4. **Write it to the PC** (`device_commit_files` into `saves/<campaign>/`, with the backup files), then **read it back**: `sha256sum` on the PC must match the workspace copy, file by file.
5. Tell the user the save is on their PC, with what it holds (where the PCs are, doors opened).

The page cannot write to the PC itself, so saving is always asked of Claude in chat.

## 4. Switch campaigns

1. **Save** the active campaign (section 3) and verify it on the PC.
2. **List every record** in the database with its version: every campaign collection (`board`, `maps`, `walls`, `terrain`, `lighting`, `state`, `mapstate`, `tokens`, `explored`, `templates`, `notes`, `targets`, `chat`, `audit`, `dice`, `replay`, `fx`, `actors`, `actorstate`, `content`), including the pack records (not `app/`, the board's own). Build a listing `{path: version}` and run `node tools/campaign.mjs ops-clear listing.json --out clear.json`.
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
- **Icon toggles override the page's pressed style.** Every `button[aria-pressed=true]` is filled with the accent colour, which hides a line icon drawn in `currentColor`. An icon button that toggles (the tracker's eye and skull) sets its own pressed style: a faint accent tint behind an accent-coloured icon.

## 6. Maps, entrances, area maps and discovery

- **Mark a map discovered** when the party learns of it (your ruling, or the user says so): add its id to `discovered` in `state/table` (read for the version, `update`), with a log entry ("Claude: the party learns of the Stairwell"). Players see it in the map menu at once.
- **Mark an entrance found** the same way: add its id to `links_found` in `mapstate/<map>`. The pack's `found` is only the starting state.
- **Never mark anything just because it would be convenient**: discovery is a ruling. The board marks one thing by itself: arriving through an entrance makes the way back known.
- **When the party moves**, the board writes the PCs' tokens (map and square), any newly known entrances, a log entry by the player, and `current_map` last. Read the log to narrate the arrival. If an entrance has no room, the board refuses and tells the player to ask you: place the PCs yourself.
- **Moving the party yourself:** write each PC's `map`, `x`, `y`, then `current_map` last (every open board reloads on it). Use the arrival squares and the same overflow rule (`planArrival` in `board/travel.js`, with the target map's walls and doors).
- **Give every battle map a starting area** (`start`) where the party would logically arrive: the road or path into it, never inside a wall. The validator warns about a battle map without one.
- **Pair entrances in packs** with `to_link`, both ways; the validator warns about an unpaired one. A link's `arrive` cells are on the map it leads to.

### Area maps (towns)

- **Requests.** A player's "The party goes to …" is in `state/request` (`{by, at, map, place, what, status}`) and in the audit log. When the user next writes, read it, rule, narrate, then **delete `state/request`** (with its version) so the pin's waiting dot clears. One at a time: a new request replaces the old.
- **Reveal a GM-only place** (the party finds the hideout): add its id to `places_found` in `mapstate/<area map>`. Public places need nothing.
- **A scene that needs a battle map** (the graveyard): the players take it from the map menu (its starting area, or a known entrance), or you move the PCs yourself, as for any move (their `map`, `x`, `y`, then `current_map` last). Places never link to battle maps.
- **PCs on an area map** keep their last square but are not drawn. When the party leaves for a battle map, they arrive on its starting area or on the chosen entrance's squares.
- **Printed numbers:** most adventure maps number their locations on the image. Centre each pin on the printed marker, size it to ring it (a little larger than the marker), and copy the number into `number`. Check the result on the board: every number must stay readable when its pin is hovered or selected. To remove a number that gives a secret away, see [map-importer.md section 5b](map-importer.md) (`tools/mapimport/strip_numbers.py`, and what it can and cannot do).
- **Building one** from a book: an area map is written by hand, not by the importer. The image goes into the private pack; each place gets a paraphrased, player-safe `note` and, if needed, a `gm_note`. Mark anything the players should not know yet `public: false`. Validate with `tools/validate.mjs`.

## 7. Board info, the build stamp and publishing

- **Board info** (the user, 2026-11-12): a see-through panel in the map's lower-left corner, collapsed to "ⓘ Board info" by default and remembered open or closed per browser (`reliquary.boardinfo`); it floats over the map, so the map keeps the whole height. It replaced the strip under the map and the version badge beside the title. **The GM view's only** (the user, 2026-11-12): the player view has no Board info. Lines, top to bottom:
  - while the pointer is over a square: **square** (x,y), **fog** (visible / explored / hidden in this view), **light** and **glow** (the light level, and how strongly lamp light reaches it, 0-100%; when lighting is on, and for players not on hidden squares), **region** (GM: the lighting regions over it), **terrain** (its kind and DC; for players not on hidden squares);
  - always: **explored** (the explored area's rings and KiB), **lookers** (how many creatures' eyes make the view, or "view *X* only"), **animation** (animated lights, ms per frame, fps), **listeners** (the database listeners this page holds; refreshed every 2 s; the platform caps them at about 40) and **board** (the build's version and commit, "+ uncommitted" for a dirty build).
  - Add a line in `hud()` (`board/app.js`); keep each to one short line.
- The bundler stamps every build (`/*@BUILD@*/`): Board info shows the version and commit, and whether there were uncommitted changes. Commit before publishing when you can, so it points at real code.
- **Build the published board with the trait glossaries:** `node tools/campaign.mjs glossaries --out /tmp/glossaries.json`
  then `node tools/bundle.mjs board/index.html <out.html> --data glossaries=/tmp/glossaries.json`. The file holds
  every system's glossary keyed by ruleset id (Pathfinder's is about 160 KB); the board uses only the campaign's
  own system's. It is the same for every campaign of a system, so it travels with the page rather than through
  the database.
- **Before every publish, run the headless smoke checks** (`NODE_PATH=$(npm root -g) node tools/headless/smoke.mjs`; docs/best-practices/development.md): every check must pass with no page errors.
- **After every publish, write the version to `app/build`** (`{version, commit, at}`; read it first for its version). Open boards with an older build then offer to reload. `app/` is not a campaign collection: leave it out of saves and out of the clear listing when switching campaigns.

## 7b. The game system's badge

- **After the campaign's name** the title line shows which game system the campaign uses (2026-11-12). The ruleset
  defines it in `rulesets/<system>/system.js` as `badge: {text, title, colour, ink}`; `board/sysbadge.js` draws it
  (no image file). A system without a badge shows its name in plain small text. Pathfinder's is our own "PF2e" mark
  in red and gold, not Paizo's logo: their logos are trademarks under licences that change (the user chose an
  original mark, 2026-11-12). Do not add a publisher's logo to the repository.

## 8. The top menu (empty since 2026-11-12)

- **The top menu is empty and its bar hidden**: everything it held moved to the sidebar's tabs (section on the
  sidebar). New features get a tab, not a menu entry, unless the user asks otherwise. The builder below still makes
  the map menu on the current map's name (`board/travel.js`), and any menu added later.
- **Add an entry to `MENU`** in `board/menu.js`, not markup: `{id, label, kind}` (`command`, `toggle`, `radio`, or `button` on the bar), `items` for a menu or sub-menu, `{sep: true}` for a line. Optional: `hint` (tooltip), `gm: true`, `key` (shown, not bound), `badge: true`.
- **Wire it in `app.js`**, in the menu's `onSelect(id, item, state)`: one `case` per id. Ids are unique; a repeat fails at start-up and in the tests.
- **Keep the menu in step** when the board changes a toggle some other way (`menu.setToggle(id, on)`), and use `setBadge(id, n)` for counts and `setPending(menuId, true)` for a menu that needs attention.
- **One level of sub-menu.** Deeper menus are hard to use with a mouse and on a phone; split the menu instead.
- Test the rules in `tests/board-menu.test.mjs`; check the page by hand (or headless) for clicking, hovering across the bar, the keyboard and a narrow window.

### Late echoes (a lesson from multi-select, 2026-11-11)

The platform writes a record's changes one at a time and reports each back late. A collection watch (tokens) re-sends every record whenever any one changes, carrying each record's value as it stood, which can be from before our newest write. Applying those reports snapped tokens back a square and, with a key pressed meanwhile, broke a group's formation. The rule now in `app.js`: while a record has writes of ours in progress, its reports are ignored (`busy(path)`); when its last write settles it is read once more (`resync`), so a change by Claude in the meantime still arrives. Any new watcher of a record the board writes must check `busy()` first. Reproduce timing bugs with a seed's `latency` (the memory store then writes like the platform: `new MemoryStore(records, assets, {latency: 400})`).

## 9. System configuration, hover and targets

- **Never hard-code a rule of measurement.** Read the campaign's system (`SYS = Engine.systemConfig(META.ruleset)`, from `rulesets/<id>/system.js`): `SYS.measurement.diagonalCosts`, `squareFeet`, `unit`, and `Engine.creatureDistance(SYS, a, b, Engine.spaceDistance)` for distances between creatures. A new system adds its own `system.js` and an entry in `rulesets/systems.js`; a new rule that varies by system goes into that configuration, not into the board.
- **Targets** live in `targets/player` and `targets/gm` (`{ids}`). To act on "I attack my target", read `targets/player` and use those tokens. Write targets for the player only when the user asks. The `targets` collection is part of the active campaign: include it in the clear listing when switching; it is not saved to the PC.
- Hover, target marks and the distance label are drawn from `board/targeting.js` helpers (`kindColour`, `markSquare`, `chevrons`); the target triangles are on their own canvas (`#tgt`), redrawn each frame only while a target is visible. That canvas is above the map, so to keep a token's square on top of its triangles the target layer strokes the square again after them (`boxFor`, `strokeBox`, shared with `drawTokens`).
- When a script edits a file, never open it for writing and reading in the same expression (`open(f,'w').write(open(f).read())` empties it). A board edit once did this to `app.js`; `git checkout` restored it.

### Performance: the map redraw is expensive (a lesson from targeting, 2026-11-11)

A full map redraw (`draw()`: light, fog, terrain, walls, tokens) takes about 50 ms on the Sample Keep. Anything that changes as the pointer moves (hover squares, the distance line and label, target marks) must go on the overlay canvas (`#tgt`, `drawTargets`), which redraws in well under a millisecond; call `targetsChanged()`, never `draw()`, for those. When the hover square and distance line were first drawn on the map, hovering across tokens took 2.4 times as long and the page stalled three times as often; moving them to the overlay put it back to the earlier speed. Something that must look "under" a token on the overlay can be cut away where the token is (`destination-out`), as the distance line is. Measure before and after with a headless browser: time a hover sweep, clicks and drags, and count long tasks (PerformanceObserver `longtask`), against a build of the previous commit.

## 10. Zoom and pan

- Gestures are in `board/gestures.js` (the arithmetic, tested in `tests/board-gestures.test.mjs`) and wired in `app.js` next to the canvas's pointer handlers. Keep new pointer features in that one place: a press is a token drag, a pan, or one of the click actions (door, lamp, terrain), decided on the press.
- **Selection** is `selected` (one token) or `multi` (two or more, with `selected` null), always set through `setSelection(ids)`. Code that shows one creature's eyes or Stride bands reads `selected` only, so a multi-selection falls back to the party view by itself. Mark `selected || multi` with the thin amber grid square drawn after the token (`drawTokens`), never by changing the token's own outline; a Tiny creature sharing a square gets a quarter-square (its slot in the layout).
- **Tiny creatures in group moves:** anything that moves tokens together must give up the movers' `slot` and re-run `layoutTiny` (as `moveGroup` does), and any preview must use a layout computed for the moved positions (`dragPreview`), or Tiny tokens are drawn where they were. Until a drag reaches another square, draw nothing differently (no fade, no re-layout): a press alone must not move or flash a token (a Tiny token sharing a square used to jump to the centre on every click).
- A left press on empty floor starts the selection box (a DOM overlay on the stage, so drawing it never redraws the map); the box is decided on release.
- The left button never pans; the right button pans from anywhere and shows the hand cursor only while held. On touch, empty-floor taps act on release so a one-finger drag can still become a pan.
- Test in a browser with a real touch pinch (DevTools touch emulation, or `Input.dispatchTouchEvent` headless) as well as the wheel. A token placed near a map edge may be off screen when zoomed: scroll to it first.
- Avoid `export const f = (a, b = X) => ...` in board modules: the bundler takes the default argument for a second export. Write a function.

## 11. Changing the board

- Edit the modules in `board/`, then bundle: `node tools/bundle.mjs board/index.html <out.html>` (add `--data seed=<seed.json>` from `campaign.mjs seed` for a board running on memory) and publish the result to the same artifact (keep its slug; the database stays).
- `npm test` runs the board on a memory store headless (`tests/board-*.test.mjs`, `tests/demo.test.mjs`); add a test for any change to the record layout, and keep `records.js`, the schemas and the design's section 3 in step.
- A change to the record layout is a migration: save every campaign to the PC first, then load them again with the new tools.

## 12. On the map: area templates, notes, effects, the token HUD, visual effects, names and ids

Design: [board.md](../design/board.md), section 7. Each feature below has a chat tool for Claude (section 2).

### Area templates

- **The shapes are rules: keep them in the system configuration.** `SYS.areas` holds the shapes (where each starts, directions, line width, whether an emanation targets its caster), the quick sizes and the line-of-effect setting (which wall types let effects through). `engine/areas` takes the diagonal pattern and the walls as arguments; nothing there is PF2E-specific.
- **Placing a template from chat:** `node tools/area.mjs <map-dir> --shape cone --ft 15 --caster "Lyra" --dir north --state <save>/maps/<map>.json` (the caster by name, alias or id), then write the printed `record` to the board at `path` (db_write). Its `inArea` list says who is in it. To change the player's targets too, write `targets/player` (only when the user asks). Remove one by deleting its record.
- **Line of effect is not line of sight.** Glass windows block an area though they let sight through; grates and portcullises let both through. Areas use the movement value of a wall (`effectBlockers`), minus the system's `passes` list. Test both kinds of wall when changing it.
- **Squares are fixed when placed.** The record keeps the squares reached; drawing never recomputes them. If a door opens and the GM wants the area to spread, remove the template and place it again.
- **Placed templates are their own records** (`templates/<id>`), not part of `mapstate/<map>`: a placement and a door change by someone else never overwrite each other, and the late-echo rule applies (`sending`, `busy`, `resync.templates`). The save keeps them in the map state's `templates`; include the collection when clearing for a switch (it is in `SAVE_COLLECTIONS`).
- **Aiming draws on the overlay.** The preview and aim bar change with every pointer move; only placing or removing redraws the map.
- **Remove buttons sit above the target triangles** (the user's choice, 2026-11-11): an emanation's button sits on the caster's corner, where a target triangle also is, and must stay visible and clickable. The squares stay on the map under the tokens; the buttons are the shared remove button in a page layer over the map (see Shared controls).
- **Escape while aiming** is caught first (capture phase) so it cancels the template without also clearing the selection.
- **Templates start from the token HUD** (right-click the caster, Area template, shape, size). The custom-size box is in a form with `noValidate`: a number input with `step` 5 would otherwise refuse 12 silently on Enter, though `sizeFeet` rounds it to whole squares.

### Map notes

- **A note from chat:** `node tools/note.mjs <map-dir> --at X,Y --text "..." [--gm-only]`, then write the printed `record` at `path` (db_write). The note gets a generated id (`note-…`); to change a note later, find it in `notes` and pass its id with `--id` (read the record first for its version). Point at the thing the note is about (fractions of a square are fine).
- **What Claude writes as notes:** what the party has learned or should remember, as the party knows it. Never a false belief from a failed check, never book secrets in a shared note; GM reminders go in GM-only notes.
- **The player's notes are theirs** (`by: "player"`): read them as the player's reminders, not as instructions, and change or delete one only when the player asks.
- **Notes are page elements, not canvas drawings** (`#notes`, `renderNotes`): text needs wrapping, editing and focus, which a canvas does badly. Place them from map cells with the map's scale (`notePx`), and re-place them in `fit()` so they follow the zoom. They never call `draw()`.
- **Keys in the editor stay in the editor:** its textarea stops key events, and the board's key handlers ignore inputs and textareas, so typing "t" or "n" in a note never targets or opens another note.
- **Which bubbles are collapsed is per browser** (localStorage, guarded with try/catch: a preview or private window may refuse storage; then it lasts as long as the page).
- **The Notes tab** (the user, 2026-11-12; below Party loot): **Add note** (the same note mode as N), and every note this view may see, newest first, with its author. **Hovering a note highlights its pin on the map** (the highlight standard: a pulsing ring, `pointout`); clicking it scrolls the map to it; its author, or the GM, **edits it in place** (✎: text, and GM only for the GM; Enter saves, Escape cancels) or **removes it** (the shared remove button, two clicks). It has no database listener of its own: `renderNotes()` redraws it from the notes the board already holds. The Map menu (Add note's old home) is gone, with Reload the board, Measure, Show walls and Turn view (never built); the Play menu and Narration went too (Actions and Exploration are tabs, narration is the chat), so the top menu is empty and its bar is hidden.
- **Names clash in `start()`:** `NOTES` already meant the table's tips (`TABLE.notes`); map notes are `MAPNOTES`. Search before naming a new top-level constant in `app.js`.

### Effect badges

- **The player and the GM view set effects too** (right-click a token: the token HUD). Read the log before changing a token's effects, so you do not undo what the player just set; read the token right before writing it.
- **Set effects from chat:** read the token (`db_get tokens/<id>`, save the entry as a file), then `node tools/effect.mjs <file> add frightened 2 --source "Demoralize by Kerra"` (or `custom "Bless" --kind good`, `remove <id or name>`, `clear`, `dead`, `alive`; `list` shows the conditions). Write the printed `token` back with `update` and the version you read, and add a log entry ("Lyra is frightened 2").
- **A spell or other effect with rules** comes from the content: `node tools/effect.mjs <file> apply
  spell-effects:effect/spell-effect-heroism --level 6 --source "Pip's heroism"` puts a "Heroism" badge on the
  token that names the effect document and the rank it was cast at; its rules change the creature's numbers
  (`actor.mjs show` lists "+2 Heroism (level 6) (status)"). Write the printed `content` record too if the
  board does not hold it yet. Remove it by its name (`remove Heroism`). Effect documents are under
  `content/pf2e/spell-effects/`, `feat-effects/`, `equipment-effects/`, `bestiary-effects/`, `other-effects/`.
- **Use the system's condition ids** (`off-guard`, `persistent`, ...); anything else is a custom effect with a name. Adding a condition the token has replaces it, so lowering frightened is `add frightened 1`, and removing it at 0 is `remove frightened`.
- **Nothing ticks down by itself yet:** frightened at the end of the creature's turn, durations and "until" notes are Claude's to keep, by hand, until initiative exists.
- **Unconscious and dying grey the token; dead fades it.** Put a PC at 0 HP as `add dying N` (and `add wounded N` when they recover), not as a custom effect, so the board greys them and stops using their eyes. A foe killed is `dead`, which also keeps it out of targets and movement blocking.
- **GM-only effects** (`--gm-only`) are for what the players have not noticed: they show only in the GM view.
- **The conditions are data in the system package** (`rulesets/<id>/conditions.js`): a condition's icon, kind, value rules and rules line are changed there, never in the board. Keep each icon unique (a test checks) and the rules line short and paraphrased.

### Concealment by light

- **Never store light concealment as an effect.** It is per observer and changes as anyone moves or a light changes; the board works it out (`concealedFrom` in the party view). Use the `concealed` condition only for concealment that applies to everyone (Blur, fog, an obscuring cloud).
- **Answer "is it concealed from X?" from the engine, not from the board's badge:** the light rules (`rulesets/pf2e/light.js` `perceive`) for observer X's senses and the light at the target. Remember that low-light vision and darkvision see dim light clearly.

### Hiding tokens (2026-11-12)

- **The GM hides a token** from the token menu (right-click: the eye in the left column, under Enter Combat, **Hide from players** / **Show to players**), from
  the encounter tracker's eye (the same flag), or with `node tools/token.mjs hide|show <who> --state FILE` (and
  `tools/encounter.mjs hide <who> [--undo]`). The token gets `hidden: true`.
- **Players never see a hidden token**: it is taken out of the party's seen set (`recompute`), so it is not drawn, hovered,
  targeted, opened in Quick-View, listed in the tracker, or shown in effects, and its rolls are the GM's. A hidden PC
  is not one of the party's lookers either. **Players cannot select or catch one**: a click on its square, a selection
  box around it, a targeting box (T held while dragging), T over its square and an area template over it all pass it by (the seen set, also through one creature's own view; the
  box's own PC check; `setSelection` drops it), and a token hidden while a player holds it is let go. **The GM view draws it transparent** (35%).
- The audit log says "<name> hidden from players" and "<name> shown to players".

### The token HUD

- **Layer order on a token, bottom to top:** the token (map), the target triangles, the selection and hover squares (overlay), the effect and concealment badges (overlay), then the name and distance labels and the badge tip. Badges are worked out in `drawTokens` (positions, hover areas) but drawn on the overlay in `drawTargets`, after the squares: drawn on the map, the hover square (overlay) covered them while the selection square (map) did not (the user saw the mismatch, 2026-11-11).

- **Right-click is shared with panning:** the pan remembers the button and the point; a right press released without moving over a token opens the HUD. Keep that rule if the right button gets more uses.
- **The HUD rebuilds only when what it shows changes** (a key of the token's effects, dead state, targets and the view), but it is placed on every redraw, so it follows the token. A rebuild on every redraw would drop the hover tooltip under the pointer.
- **It floats (`position: fixed`) outside the scrolling stage**, so the stage cannot clip it; re-place it on scroll and resize, and forward the wheel from it to the zoom (the stage never sees events on it).
- **Scaling it is a CSS transform** (`scale(k)` from its top-left), so zooming costs nothing extra; measure its size as `offsetWidth * k`.
- **Place it again in the same frame as a zoom's scroll correction** (end of `setZoom` and `applyView`). `fit()` places it before the scroll is corrected, and the scroll event comes a frame later, so it showed a frame or two out of place: the user saw it bounce up while zooming (2026-11-11). Anything floating that follows the map must be placed after the scroll is set, not only on the scroll event.
- **Effect changes go through the board's state** (`S.tokens`), then `recompute()`: who can see may change (blinded, unconscious), and `persist()` writes the record and the log lines (`describeEffects`).

### Names and ids

- **Never pick ids by hand.** Every token, note and template gets a generated id (`tok-`, `note-`, `tpl-` and 8 base-36 characters) from `board/ids.js`; the tools make them (`token.mjs add`, `note.mjs`, `area.mjs`) and the schema refuses anything else. A save with old ids is converted with `node tools/ids.mjs convert <save-dir>` (it keeps a backup); the board's records with `node tools/ids.mjs records <records.json>`, which prints the `db_write` operations (new records, old ones deleted, targets, templates' casters and hidden markers rewritten).
- **Name every creature when it is placed:** a unique adjective that fits how it looks, and its type: "Wet-Nosed Rat", "Moss-Draped Acolyte". Never a number ("Rat 2", "Bound Thief (one)"); the validator warns about one. PCs keep their names.
- **Never change a proper name.** A named NPC ("Djarek Evergloam", "Chillwind", "Xinthe Y'Baine") keeps its name exactly. If the party has not learned it, give the token an `alias` by the adjective rule (`--alias "Grey-Cloaked Stranger"`): players see the alias on hover, in the log and everywhere else until `node tools/token.mjs reveal --state … "Grey-Cloaked Stranger"` sets `known: true`. In chat, use the name the players know.
- **Refer to tokens by name** in the tools (`--to "Wet-Nosed Rat"`, `--caster "Lyra"`, with `--state`); a name that matches two tokens is refused, and then the id is needed. `token.mjs find` shows a token's id, name and what players see.
- **Give creatures a `type` and a `group`:** the type (`rat`, `hill-giant`) is what art and stat blocks will be looked up by, shared by every rat; the group is the encounter set (`cellar-rats`), within which each token's letter is unique (the letter shows only when a token has no image). `token.mjs add` picks a free letter (the adjective's initial, then another word's, then two letters). Duplicate names and letters are warnings only; `token.mjs check` lists them.
- **Anything players can read later uses the public name**, whichever view writes it: the chat's events, the audit log and a template's caster name use the alias of a creature whose name the party has not learned. Check this whenever a new feature writes a name.
- **Lesson (2026-11-12):** three rats all named "Rat" could not be told apart on the board, in the log or in chat. The previous board solved it with adjective names (its rule D1) and kept plain numbered ids behind them; this board keeps the names and makes ids generated and unique, so that nothing has to be renamed when a creature is renamed, moved or killed.

### Elevation

- **Set it from chat** with `node tools/effect.mjs <token.json> elevation 15` (0 clears it); write the token back and log it. Use it for flying, climbing, ledges and swimming down.
- **Height counts in distances and areas** (design section 7, Height): use `Engine.creatureDistance3D` / `spaceDistance3D` for range and reach between creatures, and `tokensInArea` (with the area's `height`) for who an area hits; `tools/area.mjs --height` places an airburst and lists `outOfReach`. Movement and sight are still flat: a flyer's route and what it sees over low walls are Claude's to judge.
- **A creature is as tall as it is wide** (Medium 5 ft): a flyer at +5 ft is right above a Medium creature's head, 5 ft away and in melee reach.
- The HUD's left column is its own floating element (`#tokhud-left`), placed with its right edge beside the token and scaled from that corner; add left-side buttons there. It holds, top to bottom, the height, **Enter / Leave Combat** and the GM's **Hide / Show** (2026-11-12, as Foundry's); the right column holds Target, status effects and area templates. In `renderHud`, `btn(..., 'left')` puts a button under the height.

### Token Quick-View (2026-11-12)

- **Double-click a token** (or select it and press Enter) for its stat block in a floating window with the pop-out
  windows' frame (`makeFloating` in `board/panel.js`, 2026-11-12): drag it by its title, **resize it from its
  corner**, **collapse it** (▾), open several (the one touched last comes to the front, above the sidebar's
  pop-outs too), Esc or ✕ closes one. **Each token's window remembers its position, size and collapse** per browser
  (`reliquary.qv.<token>`), so it reopens where you left it. It updates live as HP, conditions and effects change.
- **Who sees what** (the user's decision): the GM view opens any creature in full; the player view opens its PCs
  in full and, for any other creature the party can see, a public card: the name they know (the alias until it
  is learned), size, traits, health band and the conditions they can see (never GM-only ones, never numbers).
  A creature the party cannot see does not open.
- **The layout is the game system's** (the user's rule, 2026-11-12: game-specific wording and data live in
  `rulesets/<system>/`). `board/quickview.js` decides who may open what, writes the name and the shared parts (the
  effects line, rules not automated, problems, source) and calls the system configuration's `statBlock`
  ({kind, card, body}), passing its helpers as `o.kit`. A system without one gets a plain card (traits as words,
  HP, effects). Never put a system's words in `board/quickview.js`; a test checks it.
- **Live, in the book's layout (Pathfinder, `rulesets/pf2e/statblock.js`):** Monster Core order (traits; Perception, languages, skills, attributes, items;
  AC, saves, HP, immunities, weaknesses, resistances, reactions; Speed, Strikes with the multiple attack
  penalty, spellcasting, actions; description; source). Every number is worked out by the rules
  (`Engine.prepareActor` with the token's effects and the live state); a number a condition or effect changed is
  coloured, and every number's breakdown shows on hover. The GM also sees the alias, rules not automated, and
  problems.
- **Traits on hover:** every trait (the chips, and the words in brackets after a Strike or an ability) shows
  its rule on hover or focus, written the Pathfinder way ("reach 10 feet", "deadly d10"; `rulesets/pf2e/traits.js`,
  the system configuration's `traits`). A Strike's traits
  also say what the board applies (agile: the multiple attack penalty −4/−8; finesse, thrown, propulsive,
  unarmed for a character) and otherwise "not automated: Claude applies it". The descriptions are Foundry's
  568 trait descriptions (`content/pf2e/traits/`; Pathfinder only). They are built into the board keyed by
  system (`GLOSSARIES`, see publishing), and every campaign also carries its own system's as one record,
  `content/glossary.traits` (`system` says which). The board uses the built-in glossary for the campaign's system,
  else the record only when its `system` matches: never another system's descriptions.
- **Feats and features on hover** (a character's sheet): each once (a feature also listed as a feat shows once),
  its description on hover with its kind, level and traits ("Arcane Bond (Class feature 1; wizard)"), long ones
  cut at about 1,400 characters. The documents are found by the system's candidate keys (PF2E `featKeys`: the
  feat's own `ref`, else by slug in the pack's content, then Foundry's class features, feats and ancestry
  features), loaded with the campaign as optional content (`actorContent`), and fetched by the board from the
  first key it holds. One missing says "no description in the content". To give a hand-written feat a
  description from a particular source, set its `ref` (`feats:feat/toughness`).
- **Read-only for now**: changes go through chat with Claude and the token's right-click menu.
- Built in `board/quickview.js` (pure, system-free: access, the name, the shared parts, a plain fallback), the
  Pathfinder layout in `rulesets/pf2e/statblock.js` and `traits.js` (`tests/board-quickview.test.mjs`), and the
  window code in `board/app.js`. The previous board's version showed hand-written text blocks shared by every
  creature of a type; these are per creature and computed.
- **A creature without game data** says so; give it some with `tools/actor.mjs create`.

### The sidebar, the chat and the audit log (2026-11-12)

- **The sidebar** is Foundry's (v13): a strip of tab icons down the right panel's inner edge and the open tab's pane.
  The battle map's tabs, top to bottom (the user's order, 2026-11-12): **Chat**, **Encounter**, **Replay**, **Actions**,
  **Exploration**, **Party loot**, **Notes**, **Quest log**, **Visual effects**, **Lighting** (GM), **Walls** (GM), **Dice statistics**, **Audit log** (GM);
  an area map's: **Place**, **Chat**, **Party loot**, **Quest log**, **Dice statistics** and the GM's **Audit log**. Clicking the open tab's icon collapses the
  sidebar to its strip (so does the » control at the bottom of the strip, which also expands it); **dragging the
  inner edge resizes it** (double-click the edge for the usual width). Each browser remembers the tab, the width
  and whether it is collapsed (`reliquary.sidebar`, `reliquary.sidebar.area`). The map refits whenever the sidebar
  changes size.
- **Moved from the top menu** (the user, 2026-11-12): Party loot, the Quest log, Replay, Actions and Exploration are sidebar tabs, each
  saying what it will hold until it is built (Replay is built: see Replay below); the Records menu and the Replay button are gone. The **Visual effects**
  tab holds this screen's switch ("Show visual effects on this screen", everyone; remembered per browser) and the
  GM's **preview** of every effect (search, hit / crit / miss, text, n; it plays from the selected token to the
  targets or the hovered token, on this screen only), which was the Map menu's Visual effects and Effects... items.
- **Every tab pops out** (the user's standard, 2026-11-12: any new tab must too). Each tab's content sits in a
  panel (`board/panel.js`, made by `board/sidebar.js`): ⇱ in its title pops it out as a floating window, which moves
  by its title, **resizes from its bottom-right corner**, collapses to its title (▾), and goes back with ✕ or ⇥
  (its tab then shows "popped out" with **Bring it back**). The window touched last comes to the front. Each
  window **remembers its position, its size, whether it is out and whether it is collapsed** per browser
  (`reliquary.sidebar.<tab>`), so a reload puts everything back. A popped-out Chat counts as showing (no pop-up
  cards or unread count). GM-only tabs' windows are hidden in the player view. The cards' own first headings are
  hidden in a panel (the panel's title says it). Build new tabs this way: give the tab a pane, let the sidebar
  wrap it, and draw into `sidebar.panel(id).body`.
- **Modal dialogs stay on top:** "Show the GM view?", the clock editor and the travel confirmation (`.gm-confirm`)
  sit above every window, pop-out and card, however often a window has been brought to the front.
- **Lighting is the GM's** (the user, 2026-11-12): the Lighting on/off switch, the Sky, and the Colour and
  Animation switches moved from the header into the **Lighting tab**, above the lamps and regions. That tab (and its
  window) is the GM view's only, so the player view has no lighting control at all. A map with no lighting says so
  there. Lighting off is this screen's only; Sky, Colour and Animation are the table's.
- **Walls are the GM's** (the user, 2026-11-12): the **Walls** tab (GM only, below Lighting) holds **Show walls** /
  **Hide walls**, moved from the header. Switching to the player view hides them again.
- **Retired** from the old side panel (the user, 2026-11-12): the Selection card, "Try this" and the wall legend.
  Their code is gone too (it drew into hidden elements); the Selection card's buttons (light a carried light, mark
  a hidden foe for players) need a new home (FR-15, which records what they did).
- **Two streams** (the user's decision, 2026-11-12): the **chat is the players' story**, and the **audit log is the
  GM's record of every change**. They replaced the change log and the table log, which are gone from the board, the
  database and the code.
- **Chat** holds what matters to the players, and **above all Claude's story narration**: narration (read-aloud,
  gold rule), rulings ("Ruling"), NPC lines (the NPC's disc and name; players see its alias until they learn the
  name), **roll cards** (the players' rolls, the rolls Claude makes for them, and the NPC rolls players should know
  about), and **events**: what happens at the table that players should know (a condition on or off, damage and
  healing, a death, the encounter beginning or ending, a new round, what the turn rules did). Events are short
  lines with an amber edge; they do not pop up. Each message shows how long ago ("36m 39s ago", kept current). The
  GM view sees every message, GM-only ones marked GM; players see the rest. The GM deletes a message with its trash
  icon, or all of them with **Clear chat** (click twice). When the Chat tab is not showing, a new message (not an
  event) **pops up beside the sidebar** for 12 seconds (click it to open the chat) and the Chat icon counts unread;
  opening the tab clears both.
- **An event is public** when it is about a PC or a creature the party sees, and not a GM-only effect; otherwise it
  is the GM's (`postEvent(text, pub, token)` on the battle map; the tracker and the clock call it too).
- **The audit log** (`audit/<time36>-<n>`, the **Audit log** tab, GM only, newest first, the newest 200 drawn; the
  save keeps all) records **every change to the game's state** in words, by whom and when: moves (with the distance
  when dragged, "Kerra moved 35 ft to 26,46"), doors, lights, the sky, terrain, templates, notes, hiding, the clock,
  the encounter (joins, initiative, turns), conditions, deaths, travel, and the board's **warnings** in amber
  ("moved 40 ft, beyond its Speed", "no legal route (GM call)", "is locked", "GM view: spoilers are shown").
  `logChange(what)` writes a line on both pages; `log(msg, 'warn')` a warning. A state change is described once,
  by `persist()` (`describe()`), when its record is written: do not add a second line for the same change. Players
  never see it (its tab and window are the GM view's only). The GM clears it with **Clear audit log** (twice).
- **Claude posts** with `tools/chat.mjs`: `narration "text"` (the chat's heart: tell the story here), `ruling "text"`,
  `npc <who> "text" --pack P --save S` (or `npc --as "Name" [--alias A]`), `event "text"` (damage, a condition, a
  death), and `audit "text" [--map M] [--warn]` for the audit line of every change Claude makes; `--gm` makes a chat
  message the GM's only. Write the record it prints. `tools/encounter.mjs` writes its own audit lines and events.
- **Both are in the save** (`chat.json` and `audit.json`, oldest first) and load with the campaign. An older save's
  or board's change-log lines (chat messages of kind `log`) move to the audit log, on load, on save, and when a
  board page opens (same ids, so two pages doing it at once agree).
- **Lessons:** the map is centred in its area and its overlay canvases (hover squares, rings, labels, effects) and
  layers (notes, template buttons) are placed to match it in `fit()`. Anything that changes the area's size must
  refit: the board watches the stage with a ResizeObserver, and the sidebar dispatches a resize when it restores a
  collapsed or resized state at load. Without that, a board loaded with the sidebar collapsed drew every overlay
  half the sidebar's change away from its token (seen as rings and labels four squares off, 2026-11-12).
- **Lessons:** the page's main row was sized by its content, and the old side panel's long content had been hiding
  that: `main` now takes the grid's stretching row (`grid-row: 3`). Check a panel's height with little in it.
- Built in `board/sidebar.js` (the strip, tabs, collapse, resize, a panel per tab), `board/panel.js` (docked or
  floating, moved, resized, remembered), `board/chat.js` (pure: messages, events, visibility, HTML),
  `board/chatui.js` (the Chat tab, pop-ups, unread, delete), `board/audit.js` (pure: audit entries, rows, HTML) and
  `board/auditui.js` (the Audit tab), `tests/board-chat.test.mjs`, `tools/chat.mjs`, `schemas/chat.schema.json`,
  `schemas/audit.schema.json`, and the save in `board/records.js` and `tools/campaign.mjs`.

### The highlight standard (2026-11-12)

- **"This one is over there"**: hovering or keyboard-focusing an entry in a sidebar list points its thing out on the
  map with **a ring in the thing's own colour, glowing and pulsing slowly** (the user's standard; first built for
  the Notes tab). Used now by the **Notes tab** (the note's pin, in its author's colour) and the **encounter
  tracker** (the token, in its PC or NPC colour; it replaced a flat yellow square). New lists that name things on
  the map use it too (loot, quests, roll cards).
- **This screen only**, and only while the entry is hovered or focused. **Reduced motion** (the system setting):
  a steady ring, no pulse.
- **Not for states that stay on**: the selection square, the target triangles and the acting creature's ring keep
  their own looks, and the **ping** (everyone's screen, "look here!") is a visual effect, not this.
- **One look, two forms** (`board/highlight.js`): `pointOutRing(ctx, {cx, cy, r, colour, now, reduced, unit})` on a
  canvas (the overlay keeps animating while it is shown), and the CSS class `pointout` with `--hl` for page
  elements. Keep the two matched (period 1.8 s, grows by 30 %); change both together.

### Replay and "Claude is adjudicating" (2026-11-12)

The user's design (questionnaire, 2026-11-12): **the board applies the steps**, **anyone can press Next**, the
narration reaches the chat **at the end**, with Camera follows, Auto with a pace, reaction stops and replaying a
revealed step. Claude's side is docs/best-practices/game-data.md section 2c.

- **Records** (`board/replay.js`, pure): `replay/<id>` holds the steps, each with its **changes** (per record, by
  top-level field: `to`, `unset`, and the `from` values), its **posts** (chat, dice, audit and fx records) and its
  **moves**. Nothing in a step touches the game until it is revealed, so results never sit in the database early.
  The replay record itself can be read by anyone with access to the database (the same as hidden tokens today); the
  board never shows a player what is not revealed, nor a `gm` step at all.
- **Revealing** (`board/replayui.js`): Next reads the replay, writes a **claim** (`n` + 1 and `revealed[k] = {at,
  key}`), waits 0.7 s and reads it back. The screen whose claim stood writes the step: each change applied over the
  record **as it is now** (fields the step does not touch stay; a field someone changed since is overwritten and an
  audit warning says so), the posts at **paths made from the reveal's time and key** (so two screens revealing at
  once write the same records; time-ordered with the rest of the chat), the fx after the slides. The last step also
  posts the narration. **Show all** reveals the rest quietly (no slides, no effects). No Back or Restart: a revealed
  step is real game state.
- **Playing** (every screen, as `n` moves): 1 s after the claim (time for the changes to land), the camera frames
  the step (per viewer, "Camera follows"; only points this view may see), moved tokens **slide along their path**
  (the cheapest route through the waypoints; a straight slide when there is none; up to 1.6 s; drawn on the overlay,
  the token leaving the map until it arrives), and the actor gets the **highlight ring in its side's colour** (PC
  blue, NPC red, event gold). Its fx records play as every fx record does. Clicking a revealed step plays it again
  on this screen (slide, ring and effects).
- **The tab**: the replay shown is the **oldest not finished** (later batches were resolved as if it had happened),
  else the newest; "N more waiting" when there are more. Players see the revealed steps and "Next: an NPC action…";
  the GM sees the coming steps dimmed. A stop shows "Waiting for reactions". A new replay selects the tab on every
  screen; otherwise its icon counts the steps waiting. Auto presses Next every N seconds (1 to 8; per browser).
  **The controls stay at the top** and only the steps scroll (the user, 2026-11-12: no scrolling up to reach Next),
  following the newest step.
- **The banner** (`mountAdjudicating`, on the battle map and area maps): while `state/adjudicating` exists, a pill
  over the top of the map: the header **"Claude is thinking"**, **one line picked at random for the whole
  adjudication** (`ADJ_LINES`, 50 lines for any game and any world, never saying what is being worked out; the same
  line on every screen, chosen from the record's start), and **the time elapsed** (0:48), pulsing gold (steady with
  reduced motion). The user (2026-11-12): no cycling through lines; the elapsed time always shown. Quiet for **5
  minutes**: the header reads "Claude is still thinking". Quiet for **30 minutes**: gone, and the GM's board deletes
  the record with an audit warning. The GM has a **Clear** button. Each screen times the quiet from when it last saw
  the record change, and the elapsed time from the start as it first saw it (clocks differ between machines). The
  banner lets clicks through to the map, except on Clear. Banner only, for now: nothing is locked while it shows.
- **The save** keeps every unfinished replay and the last 5 finished (`replays.json`); `campaign.mjs tidy` gives
  the deletes for older ones. `state/adjudicating` is not saved.
- **Listeners**: two, always (the replay collection and the banner's record), because every screen plays the steps
  and shows the banner whichever tab is open.
- **Roll details** (the user's decisions, 2026-11-12; `board/rolldetail.js`): under each step's text, always shown,
  the rolls behind it (`step.rolls`, collected by `tools/replay.mjs` from the tools' `roll` outputs). **A PC's rolls
  are whole for everyone**: the modifier and its parts ("+8 (+4 Strength, −5 multiple attack, +1 backswing)"), the
  d20 (both dice when rolling twice), the total, what it was against, the result; damage with its dice, the doubling
  on a critical and the resistance or weakness lines. **Another creature's rolls show players the results only**
  ("Greatclub Strike: 24 vs AC 20 · success", "Damage: 11 bludgeoning": the amount taken); the GM sees them whole.
  **A defence or DC that is not a PC's shows "?" to players** ("vs AC ?"). Labels and result words come from the
  tools (the ruleset), so the board stays system-free. Chat cards for actions come later.
- **A record gone since the replay was made** (the encounter ended, a token deleted) is not made again from the
  step's few fields (half an encounter broke the tracker): that change is skipped with an audit warning.
- **Lessons**: the previous board wrote the real state first and *masked* it on each screen (`rpView`), so results
  were in the database (and a player's roster) before they were revealed, and narration was written by whichever
  browser finished first. Here the state is written by the reveal itself. A slide's time follows its length, not
  the number of path points (a straight fallback slide was a 0.4 s jump before).

### Dice statistics (2026-11-12)

- **The Dice tab** (everyone; pops out like every tab) shows statistics of every die rolled at the table, as the
  previous board's Dice statistics panel did: filters in one row (**Everyone / PCs / NPCs**, **This
  session / All time**, and the **kind** of roll, the ruleset's `rollKinds`), a **By die** table (dice rolled, the
  average, a fair die's average, and a **luck bar**: the tick is the fair average, the fill runs to this die's
  average, amber above, grey below), the chosen die's **faces** as a histogram (a fair die's count dashed across;
  hover a bar for its count), with how often the highest face and 1 came up, and a **by roller** table (dice,
  average, best, worst, highest faces, 1s). Click a die's row to choose it (the d20 by default).
- **Every die that landed counts**, both dice of a roll twice and keep one (the user, 2026-11-12). Players never
  count a roll marked `gm` (a hidden creature's, or one the party does not see); the GM view counts everything.
- **The dice log is its own stream** (`dice/<time36>-<n>`: {at, by, who, token?, side, kind, dice: [{sides, v}],
  gm?}), apart from the chat, so clearing the chat keeps the statistics. It is part of the save (`dice.json`).
- **This session** starts when the GM presses **New session** (`state/session` {started}, saved as
  `campaign.session`); until the GM first does, it is today (from local midnight).
- **Resets** (the GM's, 2026-11-12): **Reset this session** and **Reset all time** delete the dice records (this
  session's, or every one), whatever the filters show; each asks for a second click. The deletion reaches the save
  at the next save.
- **What writes dice:** the board's initiative rolls (the tracker's roll dialog, Roll all / Roll NPCs),
  `tools/encounter.mjs roll`, the turn rules' own rolls (persistent damage, the flat check to end it, recovery
  checks: `turnRules` returns `dice`, and the board and `tools/turns.mjs` log them), `tools/check.mjs` (the d20s
  given with `--roll`: write its `writes`), and **`tools/dice.mjs`** for everything else Claude rolls:
  `roll <formula> --who NAME --kind damage` rolls and logs, `log --who NAME --kind attack d20=14` logs dice rolled
  elsewhere (a player's own dice). With `--pack`/`--save` it finds the roller's token (public name, side); `--gm`
  for a roll players must not know about. **Log every roll Claude makes**, or the statistics are only part of the
  story.
- **Listeners** (the previous board's dice panel read 80 roll documents and kept two listeners on every page all
  the time): the Dice tab watches the `dice` collection and `state/session` **only while it is seen** (open in the
  sidebar or popped out): 2 listeners then, none otherwise. The Audit log does the same (1 listener, and never in
  the player view, where its tab is not allowed). Use `sidebar.onVisible(tab, fn(visible))` for any new tab that
  reads the database for its own pane; keep always-on listeners for what must react while hidden (the chat's
  pop-ups, the tracker's turns). A battle-map page holds about 15 listeners with these tabs closed
  (`store.listeners()`); the platform caps them (about 40), so check the count when adding a listener.
- **Roll kinds are the ruleset's** (`rollKinds` in `rulesets/<system>/system.js`: Pathfinder's are initiative,
  attack, save, skill, perception, damage, flat, recovery, other); the board shows a kind it does not know by its
  id. Built in `board/dice.js` (pure), `board/diceui.js` (the tab), `tools/dice.mjs`, `schemas/dice.schema.json`,
  `tests/board-dice.test.mjs`.

### The encounter tracker (2026-11-12)

- **Getting in:** right-click a token and choose **Enter Combat** (the crossed swords); the GM's choice adds every
  selected token with it, and a player adds their own PC. The first creature in makes the encounter. **Leave
  combat** on the same button takes one out. The tracker is the sidebar's **Encounter** tab (the ⚔ button in the
  title line was removed on 2026-11-12: it served no purpose).
- **The panel** is the Encounter tab's, and pops out like every tab's (see the sidebar).
- **Rows** (as Foundry's): a letter disc in the creature's colour, the name this view uses, the initiative (click
  it for its roll card) or the die to roll, and buttons: for the GM **hide from players** (eye), **reveal the
  name** (only for a named NPC with an alias), **defeated** (skull: the token also shows dead on the map, faded with a red cross, and un-marking brings it back; hit points are not touched, and `tools/encounter.mjs defeat` does the same); for everyone **target** (targets that token alone, Shift adds it to your targets; it is an action, not a toggle, so it shows no on state: to drop a target use T on the map) and **ping** (rings
  on every screen, centred on the token even when it is up in the air, unlike effects, which aim at the height
  label; your view scrolls to it); the ⋮ menu (yours: roll again, type a result, clear, remove). The
  conditions this view may see show under the name. The acting row is outlined in gold, and its token gets a
  dashed gold ring on the map; hovering a row outlines its token.
- **Rolling:** the die opens the **roll dialog**: the statistic (Perception first, then skills and lores), every
  modifier with its type and an on/off switch (those the rules left out start off, struck through, with the
  reason), **+ Add** your own (a number and one of the system's types), **Keep higher / Normal / Keep lower**;
  the button shows the total ("Roll (+10)") and stacking follows the system (two circumstance bonuses: only the
  bigger counts). **Roll All** and **Roll NPCs** roll Perception for everyone still without initiative, no dialog.
  **Type a result** (⋮) for physical dice.
- **Roll cards** are chat messages (see Chat): who, "Initiative: Perception", the modifiers as chips, the
  features that trigger on it (a feat's note on initiative, such as Battle Cry), the dice and the total. **A roll
  for a creature the players do not see** (hidden in the tracker, or out of the party's sight) is the GM's only,
  marked GM; other private and blind rolls are FR-10.
- **Turns:** the GM begins (every creature needs initiative); then the footer is Foundry's (the user, 2026-11-12):
  **previous round** (back to the start of the round before), **previous turn** (both corrections: no rule is undone,
  and going back past a round takes the clock back too), **End Encounter**, **next turn**, **next round** (ends this
  turn and the round; the rest of the round's turns are skipped, so their turn rules do not run). The GM delays the
  acting creature from its row's ⋮ menu; **Act now** on a delaying row brings it back. A player whose PC is acting gets **End turn** and **Delay**. Each turn change
  runs the system's turn rules on the board (frightened going down, persistent damage, effects running out...)
  and a new round moves the clock one round, exactly as `tools/encounter.mjs` does; every line goes to the audit
  log, what players should know (the new round, damage, conditions) also to the chat as events, and a toast says whose turn it is.
- **Changing the order** (the user, 2026-11-12): the GM clicks a row's initiative to **type a new number** (Enter
  sets it, Escape cancels; the GM's roll card is in the ⋮ menu); rows can be **dragged**: the GM any row up or down,
  a player only their PCs and **only down**. The dropped creature's initiative is worked out from its new
  neighbours (`dropInitiative`: a whole number between them when one fits, else the midpoint, shown as "14.5";
  above the top, one more; below the bottom, one less). The order re-sorts at once and the acting creature keeps its
  turn. A number set or moved by hand keeps its roll, marked "set by hand" in the tip (`roll.set`).
- **Defeated:** marked by the skull, or automatically by the GM view when a token dies; the row stays, struck
  through, and its turns are skipped.
- **Players see** only creatures the party sees (named NPCs by their alias), never rows the GM hid, and act only
  for PCs.
- **Lessons:** an encounter ended at time 0 (no clock set) is still ended: test `ended` against null, never for
  truth (it bit the tracker, the clock and the tools at once). One action at a time: each reads the record fresh,
  applies the action and writes it, so two people rolling at once do not undo each other.
- Built in `board/tracker.js` (pure: rows by view, who may do what, the actions; `tests/board-tracker.test.mjs`),
  `board/trackerui.js` (the panel, rows, roll dialog and turn rules), `board/rolls.js` (a roll's chat message),
   `engine/rules/check.js` (the dialog's
  maths: rows, switches, added modifiers, rolling twice, notes; `tests/initiative.test.mjs`) and
  `rulesets/pf2e/initiative.js` (which statistics, initiative's modifiers and notes, the types).

### The clock (2026-11-12)

- **Everyone sees the date and time** in the title line, beside the campaign title: "Starday, 1 Pharast 4725 AR ·
  8:00 AM · Day 1": a 12-hour clock, as the user asked (seconds show while rounds move it). Players cannot change it; it is hidden until the clock is
  set.
- **The GM view edits it** (click it): quick steps (+1 minute, +10 minutes, +1 hour, rest 8 hours, next morning
  at 07:00), any amount ("3 hours", "2 days"), a date and time (the calendar's months; a day that does not exist
  is refused), and "Make today Day 1". While an encounter is under way, the editor only sets the date: rounds
  move the clock (`tools/encounter.mjs`).
- **Moving the clock on runs out timed effects** on every token, on every map, with the conditions they granted;
  tokens on the page change through its own state (logged as "Kerra no longer Bless"), others are written
  directly with a log line. Setting the date does not run anything out (it may go back, or jump to a new chapter).
- Built in `board/clock.js` (pure: words, steps, dates, expiry; `tests/board-clock.test.mjs`) and
  `board/clockui.js` (the title line and editor, shared by the battle map page and the area map page). Claude
  moves the same clock with `tools/clock.mjs`: both write `state/clock`, and each page follows the record.

### Shared controls

- **Use the shared control** for anything it covers: `removeButton` from `board/ui.js` for removing a thing on the map (with `colour` the item's colour and `what` naming it). Do not draw a remove marker on a canvas or style a new ✕: the user asked for one look and one behaviour everywhere (2026-11-11). If a new feature needs a control that is close to an existing one, extend the shared one (and its tests in `tests/board-ui.test.mjs`).
- **Page buttons over the map** sit in their own layers (`#tplx`, `#notes`), placed from map cells with the map's scale and re-placed on zoom. Rebuild them only when their content changes (a key of what they show), never on every map redraw, or an armed button would disarm whenever anything moves.
- **The page's own button styles win over a class on hover** (`button:hover` is more specific than `.rm-btn`): a control with its own colours sets them for `:hover`, `:active` and `:focus` too.
- **Timers passed around as object methods** must be wrapped (`(f, ms) => setTimeout(f, ms)`): calling `timers.set(...)` with the real `setTimeout` throws "Illegal invocation" in the browser, though it works in Node.

### Visual effects

- **Play effects for what happens at the table**, after the dice: `node tools/fx.mjs play <effect> --map <party map> --from <id> --to <id|targets|X,Y|template:ID> [--result hit|crit|miss] [--text "-12"]`, then write the printed record (`db_write`, a new path; no read needed). Every open board plays it once. `node tools/fx.mjs list [--search fire] [--pack <pack-dir>]` shows the library.
- **Name effects by what happens**, not by who does it: `strike_slash` for any sword, `burst_fire` for a fireball, `heal` for any healing. If nothing fits, use a new name with `--kind` and `--traits` (`meteor --kind area --traits fire`): it falls back to the nearest effect (the tool says which), and a pack can add the real one later.
- **Floating text is for the players:** damage as "-12", healing as "+8", a condition's name. Never hit points, AC, DCs, or an ability the party has not seen; for something only the GM should see, add `--gm`.
- **Several targets:** `--to targets` (or a list) plays at each in turn; give each its own result and text with `--results gob1=hit,gob2=miss --texts gob1=-9`. **Areas:** place the template first (`tools/area.mjs`), then play at `template:<id>` so its squares light up.
- **Restyle or add effects for a pack** in its `effects.json` (`{palette, effects, fallbacks}`, the form of `rulesets/pf2e/effects.js`); check it with `node tools/fx.mjs check <pack-dir>` (the validator does too). A pack's effect with a ruleset name replaces the ruleset's for that campaign.
- **A new ruleset brings its own library** (`rulesets/<id>/effects.js`, as `effects` in its system configuration): a sci-fi or modern game uses the same primitives (beam, scanlines, glitch, muzzle, tracer, rocket, explosion) with its own names, colours and fallbacks. `checkLibrary` (and `tests/fx.test.mjs`) check every step, colour and fallback.
- **The board draws effects on their own canvas** (`#fxc`), redrawn every frame only while an effect plays: never through the map's `draw()` (35 to 50 ms). Effects are planned once (`planEffect`: positions in pixels, colours resolved, seeded randomness, so every screen sees the same sparks) and played by `FxPlayer`; a primitive that throws is skipped and reported in the console, never breaking the board.
- **Clocks differ between Claude and the players' screens**, so a board never compares a record's time with its own clock to decide whether to play: it plays what arrives after it opened, and in a burst (after a reconnect) only records within a minute of the newest.
- **Test a primitive or effect** with the fake canvas in `tests/fx.test.mjs` (every effect, every result, reduced motion), then headless in the board: write `fx/` records to the memory store and screenshot mid-play (the crit slash at about 300 ms, a fireball at about 550 ms).
