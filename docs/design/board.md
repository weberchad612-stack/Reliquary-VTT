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
| `tokens/<id>` | One record per token, with the map it is on; its effect badges (`effects`) and `dead` | Claude; the board (the player's PCs, the GM view) |
| `explored/<map>.<n>` | The party's explored area, in chunks of 200 outlines | The board (a moment after it grows) |
| `notes/<id>` | One map note with the map it is on: text, the exact point, author (`player`, `gm`, `claude`), GM-only flag, when last changed | The board (Map ▸ Add note, N); Claude (`tools/note.mjs`) |
| `templates/<id>` | One placed area template (burst, cone, emanation, line) with the map it is on: shape, size, caster, origin, the squares it reaches, colour, who placed it | The board (the token HUD's Area template); Claude (`tools/area.mjs`) |
| `log/<time>-<n>` | Change log: who (`claude`, `gm`, `player`), when, what. The board keeps the newest 300 | Whoever made the change |

The page listens to nine of these (the meta record, the table, the current map's state, and the token,
explored, targets, templates, notes and log collections), far under the platform's limit of 64. Records are per token and per map,
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

**Hover, distance and targeting** (agreed with the user and built 2026-11-11; `board/targeting.js`):
- Hovering a token that is not selected shows the selection's thin square in the token's kind colour:
  green for PCs and allies, yellow for neutrals, red for foes (token kinds `pc`, `ally`, `neutral`, `foe`;
  any other kind counts as a foe). A selected token's square stays amber. Only tokens this view can see can
  be hovered; a hidden foe's "?" marker cannot.
- The pointer is the pointing hand over every token, in both views, the same as over a door (the user's
  choice, 2026-11-11), and the closed (grabbing) hand from the press that starts a drag until release,
  single token or group; in the player view only tokens the party can see count, so it never gives away an
  unseen foe.
- The hovered token's name shows centred under its square, in a small label outlined in its kind colour;
  a Tiny creature sharing a square gets its name under the whole square, not its quarter (the user's
  choice, 2026-11-11). It is drawn on the overlay, like the hover square.
- With exactly one token selected, hovering another draws a straight line between their centres, under both
  tokens (drawn on the overlay and cut away where the two tokens are, so hovering never redraws the map), and a label above the hovered one with the distance by the system's measurement (PF2E: nearest
  square to nearest square, diagonals 5-10-5, in feet).
- **T** over a hovered token targets it, and again un-targets it; T over others adds them. **Shift+T**
  clears this view's targets. Targets are any visible token (foes, PCs, the selected token itself), are
  independent of the selection, and show as filled triangles in the four corners of the token's square,
  pointing inward, in its kind colour, small (about an eighth of the square), and under the token's
  hover or selection square; they pulse inward toward the token and back (still with reduced
  motion; the user's choice of shape, 2026-11-11).
- **Holding T while drawing a selection box** makes it a targeting box (asked for 2026-11-11): what counts is
  whether T is down on release, and the box shows a different border while it is. It adds every token
  this view can see whose centre is inside to this view's targets (already targeted ones stay); the
  selection is left as it was. A held key repeats, but only T's first press acts, so holding T over a
  token does not flip its target.
- Targets are shared through the store: `targets/player` and `targets/gm`, each `{ids}`. The player view
  edits and shows the player's; the GM view edits its own and also shows the player's (as outlined,
  unfilled triangles). Claude reads `targets/player` when the user says "I attack my target". Targets are not logged
  and not saved to the PC; switching campaigns clears them.
- Touch screens: no targeting yet (FR-2). Light ranges still use true circles, not the measurement setting
  (FR-3).

**Game-system configuration** (`rulesets/<id>/system.js`, listed in `rulesets/systems.js`): the board
loads the campaign's system by its `ruleset` and refuses a campaign whose system it does not have. Its
first entry is `measurement`: the unit, the square's size (`squareFeet`), the diagonal pattern
(`diagonalCosts`) and how distance between creatures is counted. Everything that measures reads it: the
distance label, movement routes and costs, the Stride outlines (through the movement options) and
`tools/move.mjs` (`--ruleset`). A map's own `feet_per_cell` still sets its scale; without one, the system's
square is used. PF2E's terrain rules take their diagonals from the same configuration.

**Area templates** (the token HUD's Area template; designed with the user and built 2026-11-11, from the previous board's
templates). The shapes are defined in the system configuration (`areas`) and built by `engine/areas`; the
board's part is `board/templates.js` and the templates section of `board/app.js`.

- **Starting** (from the token HUD since 2026-11-11; it was Play ▸ Templates in the top menu): right-click
  the caster, **Area template**, pick a shape (Burst, Cone, Emanation, Line), then a size: the system's quick
  sizes as tiles (PF2E 5, 10, 15, 20, 30, 60 ft; the last one used is marked) or a custom size, rounded to
  whole squares. The player view has the button on its own PCs, the GM view on any token. There is no
  "Clear templates" any more: each template has its remove button.
- **Aiming:** a dashed preview in the next free colour follows the mouse, drawn on the overlay (never a map
  redraw). A **cone** snaps to 8 directions and its start slides along the caster's edge in half squares; a
  **burst** sits on the nearest grid corner and the aim bar shows its distance from the caster; a **line**
  goes from the caster's edge at any angle, one square wide; an **emanation** is placed at once round the
  caster. The aim bar names who is in the area. Click places; Escape, right-click or the bar's Cancel
  button cancels (Escape then leaves the selection alone).
- **Walls (line of effect):** a square is in the area only if the line from the area's start to the square's
  centre crosses no wall that blocks movement: walls, closed or locked doors, unfound secret doors and glass
  windows block; open doors do not, and neither do the wall types the system lists as letting effects
  through (PF2E: grates and portcullises). A cone or line starts just inside the caster's space, so a caster
  standing against a wall cannot aim through it; a burst on a wall's corner spreads both ways; an emanation
  reaches a square if any square of the caster's space has a clear line to it. The squares are worked out
  when the template is placed and kept; opening a door later does not change a placed template.
- **Targets:** placing replaces this view's targets with every creature in the area it can see (the GM view:
  every creature; the player view: those the party sees), markers and GM notes excepted, the caster
  included when inside. An emanation also targets its caster, though the caster's own space is not part of
  the area; T removes them. The toast names who is targeted.
- **Placed templates** stay until removed, are shared on the board and saved with the campaign (map state
  `templates`). Each has its own palette colour (the first free of ten), drawn as filled squares with an
  outline, above the fog and under the tokens. Each has the shared remove button (below) just past its start, above the target triangles; its
  tooltip names the template. The player view removes the templates it placed; the GM view removes any
  (templates this view may not remove have no button). Placing and removing are in the change log.
- **Claude** places templates from chat with `tools/area.mjs` (section 3: `templates/<id>`), and reads who
  is in one from its output.
- **Later:** who an area may affect (creatures, enemies, allies) when spells and actions arrive (FR-4).

**Map notes** (Map ▸ Add note, or N; designed with the user and built 2026-11-11, from the previous board's
player notes). Helpers in `board/notes.js`; the notes section of `board/app.js`.

- **Adding:** Map ▸ Add note turns note mode on (crosshair; Escape turns it off) and the next click on the map
  opens the editor there; **N** opens it straight under the mouse (with the mouse off the map, N turns note
  mode on). The editor: up to 500 characters, Enter saves, Shift+Enter a new line, Escape cancels, clicking
  away saves. Both views add notes; the GM view's editor has a **GM only** box, ticked by default for a new
  note. Claude adds notes from chat with `tools/note.mjs`.
- **Where:** pinned to the exact point clicked (fractions of a square), on the map, not on a token.
- **Showing:** a pin (a small note sheet) and a bubble to its right with the text and its author ("You" or
  "Player", "GM", "Claude"; "GM only" when it is). Bubbles are open by default; clicking a pin collapses or
  reopens its bubble, remembered in this browser only (per campaign and map). Notes show to players
  everywhere, fog or not; GM-only notes show only in the GM view. Colours by author: the player view
  orange, the GM view purple, Claude the board's accent (amber); GM-only notes have a dashed outline.
- **Changing:** the player view edits, moves and deletes the notes it wrote; the GM view any note, Claude's
  included. Click the bubble's text to edit (saving it empty deletes); drag the pin to move (Shift: the
  centre of a square); the bubble's shared remove button (below) removes it.
- **Data:** each note is a record (section 3), written as it changes, in the change log (added, edited,
  moved, deleted, with the note's first line), and saved with the campaign (map state `notes`).
- **Drawing:** pins, bubbles and the editor are page elements in a layer over the map (`#notes`), placed by
  the map's scale; they follow zoom and pan, never redraw the map, and sit above the target triangles and
  template markers. The right button still pans when pressed on a note.
- **Later:** touch screens (FR-5).

**Effect badges and unconscious, dying, dead** (designed with the user and built 2026-11-11, from the previous
board's status icons). Helpers in `board/effects.js`; the conditions are the system's.

- **What:** a token's `effects` list holds the system's conditions by id (PF2E: every Player Core condition,
  `rulesets/pf2e/conditions.js`, part of the system configuration as `conditions`) with an optional number
  (frightened 2) or detail (persistent damage: 2d6 fire), and custom effects by name (a spell, an aura) with
  good, bad or neutral. Any effect may be GM-only, and may say where it came from and when it ends (in
  words: nothing ends or ticks down by itself until initiative exists).
- **Who sets them:** Claude, from chat (`tools/effect.mjs`), and the token HUD (below): the GM view on any
  token, the player view on its own PCs (changed from Claude-and-GM-only when the HUD was designed,
  2026-11-11).
- **Look** (Foundry's layout, from the user's screenshot, 2026-11-11): square badges inside the token's space
  from its top-left corner, in columns of five, then the next column to the right; each a fifth of the
  token's side (never under 10 px on screen), so they scale with the token. Each condition its own emoji, a
  custom effect its first letter; the number in the bottom-right corner; the border green, red or amber for
  good, bad or neutral (kept, though Foundry has none); GM-only ones with a purple dashed frame (GM view
  only). Drawn after all tokens, so none covers them. Shown on every token the view can see.
- **Hover:** the badge's name and value, the condition's rules line (paraphrased in the system's list),
  where it came from and when it ends. Drawn on the overlay.
- **Unconscious and dying** (conditions the system marks `state: 'down'`) grey the token; **dead**
  (`dead: true` on the token) fades it, greys it and draws a red ✕, and hides its badges. A dead token does
  not block movement (as before), cannot be targeted (T, a targeting box or an area) and does not see.
- **Who sees:** a PC who is dead, or has a condition the system marks `blinds` (PF2E: blinded,
  unconscious, dying, petrified), adds nothing to what the party sees, and selecting them shows nothing:
  they cannot see (Player Core: the unconscious are blinded). Added by Claude while building; kept by the
  user (2026-11-11).

**Concealment by light** (kept separate from the effect badges, the user's choice, 2026-11-11). Concealment
from dim light is between two creatures: it depends on the light where the target stands and the observer's
senses (Kerra with normal vision; Pip with darkvision and Lyra with low-light vision see the same rat clearly).
So it is worked out, never stored, and follows the board's eyes: with a creature selected, concealed from
that creature; with none, concealed from at least one PC who sees it. It shows as a badge in the token's
bottom-right corner, the same square as the effect badges (green border), holding a half-shaded disc; its
hover names who it is concealed from and why ("Concealed from Kerra: in dim light. Targeting it takes a DC 5
flat check."). The stored **concealed** condition (a spell, fog: concealed from everyone) is an ordinary
badge; when a creature has it, the light badge is not shown. A rules engine (later) asks the engine, not the
badge: the light rules' `perceive` gives observed, concealed or unseen for one observer; a query for one
observer and one target (`observe`) is the planned way to ask it.

**The token HUD** (right-click a token; designed with the user and built 2026-11-11, after Foundry's Token
HUD). The token HUD section of `board/app.js` (`openHud`, `statusPalette`).

- **Opening:** a right-click on a token without dragging (a right-drag still pans), in either view, on any
  token that view can see. The player view gets only Target on foes and NPCs (asked for 2026-11-11: "Players
  should be able to right-click an NPC token ... to select/deselect it"); Assign status effects is the GM
  view's on every token and the player view's on its own PCs. Escape, a left click on the map, another right-click
  elsewhere or switching views closes it.
- **Buttons**, in a column to the right of the token (to its left when there is no room): **Target**
  (toggles this view's target, as T; refused on the dead), **Assign status effects** (opens the palette
  beside them) and **Area template** (the shapes and sizes, with this token as the caster; see Area
  templates). More buttons can be added later.
- **Elevation** (asked for 2026-11-11, after Foundry's): a box in a column on the token's left, showing the
  token's height in feet (0 on the ground). Click it to type a number (negative is below the ground); Enter
  saves, Escape cancels the typing only. A token off the ground shows "+15 ft" (or "−10 ft") above it, with
  the badges; the distance label moves up above it. Stored as `elevation` on the token (left out at 0),
  shared and logged ("Kerra elevation +15 ft"). The player view sets it on its own PCs, the GM view on any
  token; Claude with `tools/effect.mjs <token> elevation 15`. Nothing uses it in rules yet: distances,
  reach, areas and sight ignore height until the rules engine does (FR-7).
- **The status palette:** every condition of the system in a grid five wide (alphabetical), then **Dead**.
  Active ones are lit with an orange frame, the rest dimmed; valued ones show their number. Click toggles a
  plain condition and adds a valued one at 1 or raises it; right-click lowers a valued one (removing it at
  0) or removes a plain one (Foundry PF2E's way). Dead switches the token's dead state. Hovering a tile
  shows its name and rules line.
- **Saving:** each change writes the token record (shared at once) and a change-log line ("Lyra frightened
  3 (was 2)", "Lyra no longer prone", "Ogre is dead").
- The HUD floats over the page and stays inside the window; it follows the token, the zoom and scrolling.
- **It scales with the zoom**, as Foundry's does (asked for 2026-11-11): normal size when a square is 48 px
  on screen, never below 0.7x or above 1.5x, by a CSS transform (no re-layout, so it keeps up with the wheel).
  The wheel zooms over it too.

**Shared controls** (`board/ui.js`; asked for 2026-11-11: "consistent UI elements"). A kind of control
looks and behaves the same everywhere; a new feature uses the shared one rather than making its own.

- **The remove button** (`removeButton`, styles `.rm-btn`): every removable thing on the map (area
  templates, map notes, and later ones). A 20 px circle at any zoom, in the item's colour with a white
  border and a white ✕; the first click (or Enter) turns it into a "Remove?" pill for 3 seconds, a second
  removes, and a toast confirms ("Template removed.", "Note removed."). It is a real page button: a tooltip
  and screen-reader label name the item, and it can be reached with Tab. Items this view may not remove get
  no button. The user's choices (2026-11-11): arm then confirm, the template look, a fixed size.
- Not a remove button: the GM lighting card's "×" next to a colour means "make uncoloured".

**The top menu** (`board/menu.js`), modelled on the previous board's top bar and on Foundry's menus:

- **Bar:** Map (Measure, Add note, Show walls, Turn view; Reload), Play (Actions, Exploration), Records (Party loot, Quest log, Dice), and two
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
  built on 2026-11-10 with nothing wired; items say "not built yet" until the page answers them (`onCommand`;
Map ▸ Add note since 2026-11-11). The Export DB item of the
  previous board is gone: saving is Claude's job now (section 5). The rest of the menu is designed later.
  Area templates moved out of Play into the token HUD (2026-11-11).

## 8. Build order

1. `board/` from the demo, as modules, bundled; the board running from an in-memory store so it can be
   tested headless.
2. The database store: loading, listening, writing, the change log; the GM switch.
3. `tools/campaign.mjs`: pack and save to records and back, with a round-trip check.
4. Publish the board; load the Sample Keep as a campaign; play-test moves, doors, fog and Claude's changes.
5. Save to the PC and switch to the Sample Crypt and back.
6. Best-practice guide for running and maintaining the board.
