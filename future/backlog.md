# Feature backlog

Feature requests from the user, one ticket each. A ticket records what was asked and what is already known;
it is not a design. When a ticket is picked up, design it with the user (one question at a time), then
move the decisions into `docs/design/` and the best-practices guides, and mark the ticket done here.

Status: **open** (not started), **designing**, **building**, **done**.

| # | Feature | Status | Raised |
|---|---|---|---|
| FR-1 | [Party marching order](#fr-1-party-marching-order) | open (partly decided) | 2026-11-10 |
| FR-2 | [Targeting on touch screens](#fr-2-targeting-on-touch-screens) | open | 2026-11-11 |
| FR-3 | [Light ranges by the system's measurement](#fr-3-light-ranges-by-the-systems-measurement) | open | 2026-11-11 |
| FR-4 | [Who an area or effect can affect](#fr-4-who-an-area-or-effect-can-affect) | open | 2026-11-11 |
| FR-5 | [Map notes on touch screens](#fr-5-map-notes-on-touch-screens) | open | 2026-11-11 |
| FR-6 | [Editing effects on the board](#fr-6-editing-effects-on-the-board) | done (token HUD, 2026-11-11) | 2026-11-11 |
| FR-7 | [Height in the rules](#fr-7-height-in-the-rules) | done for distances and areas (2026-11-11); movement and sight open | 2026-11-11 |
| FR-8 | [Tilting area templates up and down](#fr-8-tilting-area-templates-up-and-down) | open (designed, not built) | 2026-11-11 |
| FR-9 | [Light at a height](#fr-9-light-at-a-height) | open | 2026-11-11 |
| FR-10 | [Roll visibility](#fr-10-roll-visibility) | open | 2026-11-12 |
| FR-11 | [Several encounters at once](#fr-11-several-encounters-at-once) | open | 2026-11-12 |
| FR-12 | [Encounter tracker settings](#fr-12-encounter-tracker-settings) | open | 2026-11-12 |
| FR-13 | [Encounter threat and XP](#fr-13-encounter-threat-and-xp) | open | 2026-11-12 |
| FR-14 | [Aura notes on the board's turns](#fr-14-aura-notes-on-the-boards-turns) | open | 2026-11-12 |
| FR-15 | [A home for the Selection card's controls](#fr-15-a-home-for-the-selection-cards-controls) | open | 2026-11-12 |
| FR-16 | [Two-finger touchpad panning](#fr-16-two-finger-touchpad-panning) | open | 2026-11-12 |

---

## FR-1: Party marching order

**Asked for:** a party marching order (2026-11-10).

**Decided so far (the user, 2026-11-10)**
- A **tool on the board** sets the marching order, at any time during play: both each PC's **position** in
  the formation and the formation's **orientation**.
- It is set **per adventure pack**. Packs themselves are read-only book data, so this probably means it is
  kept with the campaign that plays the pack, in its save. Confirm when designing.

**What is known**
- The previous board ran it as a GM rule, not a board feature (`PF2E_Claude_VTT/game/rules/gm-rules.md`,
  rule I4): when the party moves, place them as a 2x2 block. Kerra is in the front row and Pip and Jix in
  the back row. The block is turned to face the way they are heading. Chuck goes beside the front row
  unless told otherwise. Only free squares are used, and walls are respected. The same rules file also
  moves the party "in marching order" when it travels back through explored places.
- On this board, the party's arrival through an entrance or at a starting area places the PCs in
  alphabetical order (`travelPlan` and `planArrival` in `board/travel.js`): the first PC takes the first
  arrival square. Marching order would replace that order.
- PF2E uses marching order in exploration: who walks first meets traps and ambushes first, and who is at
  the back is the one surprised from behind.

**Where it would show up**
- Party moves between maps (entrances and starting areas): the PCs arrive in marching order.
- When Claude moves the party (exploration, retracing explored ground): Claude places them in formation.
- The board tool that sets it (position and orientation).

**Open questions for the design**
- What the tool looks like: a small grid to drag PCs into, or rows and slots? Player view, GM view, or both?
  Can Claude also set it from chat?
- Orientation: set by hand only, or also turned automatically to face the direction of travel, as rule I4 does?
- "Per adventure pack": kept in the campaign's save (one per campaign), or truly one per pack shared by
  every campaign that plays it?
- How are companions, summons and new party members fitted in?

**Not in scope (the user, 2026-11-11):** moving several selected tokens together (box select, Ctrl+click)
never uses marching order. A group move always keeps the group's own spacing.

---

## FR-2: Targeting on touch screens

**Asked for:** deferred from the targeting design (the user, 2026-11-11): touch screens have no hover, so
the hover squares, distance line and T key do not work there.

**What is known:** targeting is built for mouse and keyboard (docs/design/board.md, section 7). A long press
to toggle a target was one option offered; the user chose to do touch later.

**Open questions:** long press, a targeting mode button, or a target button on the selection card (the
card is being redesigned)? How is the distance shown without hover?

---

## FR-3: Light ranges by the system's measurement

**Asked for:** raised while building the system configuration (2026-11-11), left for later by the user.

**What is known:** light and vision radii are drawn as true circles (engine/light). In PF2E a light's
radius is counted like any other distance, on the grid (5-10-5), so a torch's 20 ft would follow the grid
count, not a circle. The system configuration's `measurement` already holds the rule; light would need
to read it (a grid-shaped emanation instead of a circle) without breaking walls, colours and animation.

**Open questions:** grid-shaped light everywhere, or only for the rules (who is in bright or dim light)
while drawing stays round? Performance of grid-shaped light polygons.

---

## FR-4: Who an area or effect can affect

**Asked for:** the user, 2026-11-11, while area templates were being built: "In PF2E and D&D, there's a
concept of what's eligible to be effected; creatures (all tokens), enemies, and allies." To consider once
real spells and combat actions are in the game.

**What is known:** placing a template now targets every visible creature in the area (caster included when
inside; an emanation's caster by default), whatever side they are on (docs/design/board.md, section 7).
Many effects say whom they affect: all creatures, only enemies, only allies, or "you and allies". Tokens
already have kinds (pc, ally, neutral, foe), which is a start for sides, but "enemy" is relative to the
caster (a foe's enemies are the PCs).

**Open questions:** where the eligibility lives (on the spell or action, with the system configuration
naming the choices); how sides are worked out relative to the caster (kind, a faction field, or a GM
ruling per token); whether the board filters the targets on placing or shows everyone and dims the
ineligible; how neutrals count.

---

## FR-5: Map notes on touch screens

**Asked for:** the user, 2026-11-11, while designing map notes: mouse and keyboard only for now, with a
ticket for touch.

**What is known:** map notes (docs/design/board.md, section 7) are added with Map ▸ Add note and a click, or
N under the mouse; moved by dragging the pin (Shift snaps); edited by clicking the bubble. On a touch screen
Add note and a tap may already open the editor, but there is no N, no Shift, and a one-finger drag on the
map pans.

**Open questions:** add by tapping after Add note, or a long press on the map? Move by long-pressing a pin
and dragging? How to snap without Shift? Should the bubble's ✕ be larger on touch?

---

## FR-6: Editing effects on the board

**Status:** done the same day: the token HUD (right-click a token) with a status palette, after Foundry's
(docs/design/board.md, section 7). Custom effects and GM-only effects are still set from chat only.

**Asked for:** the user, 2026-11-11, while designing effect badges: "Let's do this as a future feature ... for
now Claude will manually assign token effect badges."

**What is known:** effect badges (docs/design/board.md, section 7) are set by Claude with `tools/effect.mjs`.
The offered design was a GM-view dialog (from the menu, a hotkey, or by clicking a badge): condition buttons
with a value, custom effects, a GM-only box, unconscious, dying and dead. The selection card is being
redesigned, so the editor should not be built into it.

**Open questions:** where the editor opens (menu, E key, a badge, the new selection card); whether the
player view may set effects on their own PCs (raising a shield); how it fits with initiative, which will
tick frightened and durations down.

---

## FR-7: Height in the rules

**Status:** distances and area templates count height (docs/design/board.md, section 7, Height), built
2026-11-11 with the user's rulings: diagonal counting, creatures as tall as wide, bursts at a chosen height.
Still open: flying movement (routes and Stride outlines), sight over low walls, tilted cones and lines.

**Asked for:** the user, 2026-11-11, with token elevation: "Our rules engine will end up using height for
some of its calculations."

**What is known:** tokens carry `elevation` in feet (docs/design/board.md, section 7), shown as "+15 ft" and
set from the token HUD or `tools/effect.mjs`. Nothing counts it yet: the distance label, reach, Stride
outlines, area templates and sight are flat. In PF2E, distance in three dimensions is counted like flat
distance, with the vertical gap as a third leg (diagonals alternating 5 and 10 feet); a flying creature
above an area's squares may or may not be in it depending on the area (a burst reaches up as far as its
radius, a cone or line in its direction).

**Open questions:** the 3-D distance rule in the system configuration (`measurement`), and every place that
measures (the distance label, reach, areas, sight over low walls); whether areas get a height; how to show
a token's height when it changes during a move.

---

## FR-8: Tilting area templates up and down

**Asked for:** the user, 2026-11-11, after height in areas (FR-7): "What are your thoughts about tilting area of
effects up and down?" Logged as a backlog feature with the thinking so far.

**What is known (as of FR-7):** every template has a height (a burst's point; cones, lines and emanations start
at the caster's elevation) and runs level. Who it reaches is worked out per square on the fly (engine
`areaReaches`, `tokensInArea`): bursts and cones reach as far up and down as is left of their size at that
square, emanations their size from the caster's height column, lines one square tall. Creatures in the squares
but beyond that reach are listed as out of reach and not targeted.

**Rules footing:** PF2E areas are three-dimensional, and nothing stops a cone or line from being aimed upward
(at a flyer, out of a pit), but the rules give no method. What we build is a ruling in software, like FR-7's
height counting, and belongs in the system configuration where it varies by system.

**Proposed model: a height band per square.**
- Make the per-square reach explicit: every square of an area carries the lowest and highest point it reaches
  there ([zmin, zmax], feet). A token is hit if its height column (elevation up to elevation + height by
  size) overlaps the band in any square it stands in: one test for every shape, flat or tilted.
- A flat burst or cone fills its bands from today's dome rule, so nothing changes for level areas.
- A tilted cone or line is a different footprint, each square with its own band: a line rising toward a
  flyer is low in its first squares and higher further out.
- The template record keeps the pitch (and, for a line, the height at its far end) so the save, the board
  and `tools/area.mjs` agree.

**Per shape.**
- **Lines:** any pitch. Aimed at something 30 ft up and 30 ft away, a line climbs about 5 ft per square. Still
  one square thick, so it passes over whoever it rises past.
- **Cones:** snap to 0, 45 or 90 degrees, as the 8 compass directions snap. A 45-degree cone is the
  vertical-plane version of the diagonal cone, so the grid count stays honest; straight up (90 degrees)
  covers the caster's column and its neighbours, for a creature directly overhead.
- **Bursts:** no tilt (they already have a height). **Emanations:** no tilt (centred on the caster).

**Aiming on the board.**
- **Aim at a token (the easy way):** while aiming a cone or line, clicking a token aims it at that creature,
  height included ("lightning bolt at the dragon"). This is what players will want nearly every time.
- **By hand:** while aiming, the arrow keys up and down tilt: 45-degree steps for a cone, 5 ft at the far end
  for a line. The aim bar says "rising 45 degrees" or "to 30 ft up".
- **Drawing:** the squares stay flat on the map but are shaded by height (lighter where the area is high), and
  the template's label says "rising to 30 ft", so it is clear it passes over those beneath.
- **From chat:** `tools/area.mjs` gains `--pitch DEG` (cones: 0, 45, 90; down with negatives) and
  `--toward-token ID` (aim at a creature in 3-D), and reports bands and who is out of reach as now.

**Cost and limits.**
- The engine change (bands, tilted footprints) is modest and testable; the aiming controls are most of the
  work.
- Walls stay full height: a tilted line cannot pass over a low wall until walls have heights (a separate idea).
- Line of effect for a tilted area still uses the flat wall test from its start square.

**Suggested order:** tilted **lines** first, with aim-at-a-token (where it matters most at the table); tilted
cones later if fights with flyers are common. Until then: GM rulings, helped by the out-of-reach list.

**Open questions:** should a line aimed at a token stop at the token or run its full length (PF2E lines run
their full length)? Do downward cones from a flyer need their own snap angles (-45, -90)? How is the band
drawn when two templates overlap?

---

## FR-9: Light at a height

**Asked for:** the user, 2026-11-11, after token elevation and height in distances (FR-7): "Kerra holding a
torch light source, if she's 50 feet up in the air technically the floor of the map isn't lit."

**What is known:** the light engine (engine/light, docs/design/lighting.md) is flat: every light, carried or
static, lights the floor around it as if it stood on the floor, and the light map has one level, the floor.
Tokens now carry `elevation` and are as tall as their size (FR-7), and the system counts height as a third
direction with the same 5-10-5 diagonals (`measurement.vertical`). A torch gives 20 ft of bright light and
20 ft of dim light beyond it: 40 ft in every direction, so a torch 50 ft up lights nothing on the floor.

**What it would take.**
- **A light has a height:** a carried light at its bearer's elevation (in the hand: about the middle of the
  creature's height column), a static light at its own `height` in the lighting file (a wall sconce at 5 ft, a
  chandelier at 20 ft; the importer and the map editor would set it, 0 by default).
- **Light on the floor:** for each floor square, the 3-D distance from the light counted the system's way
  (the flat distance and the vertical gap combined, as FR-7 does), against the bright and dim radii. A
  light raised by v squares lights a smaller patch of floor; above its full reach, none. With FR-3 (light
  ranges by the system's measurement) this replaces the true circle with the grid count.
- **Light where a creature is:** whether a creature is in bright, dim or no light depends on its own height
  too: a flyer next to Kerra's torch at 50 ft is lit while the floor below is dark. The light map stays a
  floor map for drawing; "the light at this creature" (used by the light rules' `perceive`: concealment,
  what darkvision and low-light vision see) asks the light sources in 3-D for the creature's height column.
- **Sight and fog:** what the party perceives on the floor follows the floor's light; a creature at a height
  is seen by the light at its height. The explored area stays a floor map.
- **Walls** stay full height for light, as for sight and areas (walls with heights are a separate idea).
- **Daylight and sky regions** are not affected: the sky lights every height.

**Cost:** the light map already rebuilds a light only when it moves (`LightCache`); a height is one more input.
The per-square 3-D test is cheap; the work is mostly in threading heights through the light rules and the
board's "light at this creature" lookups, and tests.

**Open questions:** where in a creature's column its carried light sits (feet, middle, top); whether static
lights need heights now or only carried ones; whether the floor patch of an elevated light should be drawn
dimmer than the same light on the floor (PF2E has only bright and dim, so the rules level is enough);
whether to do this together with FR-3.


## FR-10: Generated ids and unique names (decided and built 2026-11-12)

Today tokens have hand-picked ids (`rat1`, `kerra`) and duplicates share a name ("Rat"), so the hover label,
the change log and chat cannot tell three rats apart; notes, templates and effect plays each use a slightly
different id scheme. The previous board solved names with rule D1 (a unique adjective plus the creature type,
"Hollow-Cheeked Morlock"; `game/rules/gm-rules.md`), with plain numbered ids behind them and shared
`artKey`/`statKey` for art and stat blocks. Decided with the user by questionnaire:

**Ids**
- **Format:** a type prefix and 8 random base-36 characters (`tok-k3x9q2m7`, `note-…`, `tpl-…`), from one
  shared id maker (replacing `templateId`, `noteId` and hand-picked token ids).
- **Scope: game objects only** (tokens, notes, templates and future objects such as items, journal entries,
  quests). Streams keep time-sortable ids (`chat/<time36>-…`, `fx/<time>-<n>`): they are read in order and never
  pointed at. Map chunks keep their map names (`walls/<map>.<n>`, `explored/<map>.<n>`). Maps and packs keep
  their authored ids (`sample-keep`, `sample-pack`).
- **PCs get generated ids too** (one rule for everything).
- **Convert every existing id now**, with every reference: the test campaigns' saves, targets, templates'
  casters, records on the live board, and docs and tests that name `kerra` or `rat1`.

**Names**
- **Creatures and NPCs without a proper name:** a unique adjective plus the creature type ("Wet-Nosed Rat"),
  never a number. Claude chooses the adjectives, fitting how the creature looks.
- **PCs keep their names.**
- **Proper names are never changed:** a named NPC ("Djarek Evergloam", "Chillwind", "Xinthe Y'Baine") keeps
  its `name` exactly as written; no tool, check, conversion or board code renames, shortens, numbers or
  makes it generic.
- **Names the party has not learned:** an optional `alias` (written by the adjective rule, "Soot-Skinned Imp")
  is what players see until Claude sets `known: true`; then players see the proper name everywhere (hover, log,
  effects, replay). No alias: the proper name shows from the start. The GM view and Claude always see the name.
- **Duplicates are a warning only** (validator and the add-token tool), never an error.

**Tools** accept a name or an id (`--to "Wet-Nosed Rat"` or `--to tok-k3x9q2m7`); a name matching two tokens
is refused.

**Type key:** one `type` field (`giant-rat`) for what kind of creature a token is; art and stat blocks are
looked up by it (replacing the old `artKey`/`statKey`).

**Token letter:** a fallback, drawn only when a token has no image (token images are coming): the first letter
of the adjective (of the proper name for a named NPC), unique within the token's **`group`** (its encounter
set, such as `b14-morlocks`, set when Claude places it; no group = a group of one). A repeat is a warning
only; a group of more than 26 uses two letters ("HC").

## FR-11: After the full Foundry import (noted 2026-11-12, not scheduled)

Left over from importing all of Foundry PF2E 8.7.0 (docs/design/game-data.md section 7.4):
- **Character converter:** the 160 pregenerated characters (iconics, Paizo pregens) and 5 familiars were
  skipped; they need Foundry's character build turned into our actor format (with the character builder).
- **Rule elements to support next** (content/pf2e/import-report.md): ActiveEffectLike, ItemAlteration,
  ChoiceSet, GrantItem of features (the character builder); RollOption with choices (sheets); AdjustModifier,
  DamageAlteration, the rest of AdjustStrike and DamageDice (attacks). Formulas, number conditions, roll options,
  damage dice, auras, turn rules and the rest were built 2026-11-12 (design sections 7.5 and 8).
- **Lights from effects** stay on the token when the effect ends; remove them by hand for now.
- **Values still missing**: a weapon's damage dice, rune potency, sheet choices (`rulesSelections`), the
  creature's land Speed ("a climb Speed equal to your Speed", 30 rules), facts about the target (distance, size).
- **Three creatures with impossible Strength** (Marala +30, Glittercrag Strix +25, Okoa +19): check the books
  and correct them with overrides.
- **Kingmaker armies** (kingdom rules) were skipped.

---

## FR-10: Roll visibility

**Asked for:** when rolling on the board (first in the initiative roll dialog), choosing who sees the roll, as
Foundry's dialog does: public, private to the GM, or blind to the GM (2026-11-12). Not an immediate priority.

**Known so far:** rolls are kept on the encounter record today, which every view reads, so a private or blind
roll needs the result kept where only the GM view (or only Claude) reads it, and the tracker showing "rolled"
without the number. It belongs with the dice service and the roll log (docs/design/game-data.md section 3.7,
step 3).

---

## FR-11: Several encounters at once

**Asked for:** more than one encounter running at the same time, as Foundry's tracker allows (a number box to
switch between them; 2026-11-12). Not high priority.

**Known so far:** the board keeps one encounter, `state/encounter`; several would become `encounters/<id>` with
one marked current, and the clock moves only with the current one's rounds (two encounters must not both move
it).

---

## FR-12: Encounter tracker settings

**Asked for:** the tracker's settings (Foundry's gear: whether to skip defeated creatures, which resource to
show on each row; 2026-11-12). Not high priority.

---

## FR-13: Encounter threat and XP

**Asked for:** the encounter's threat (trivial, low, moderate, severe, extreme) and the XP it awards, shown in the
tracker as Foundry shows them (2026-11-12). Not high priority.

**Known so far:** this is the system's encounter budget (PF2E: XP by each creature's level against the party's,
and the party's size), so it belongs in `rulesets/pf2e/` and reaches the tracker through the system configuration;
a system without one shows nothing.

---

## FR-14: Aura notes on the board's turns

**Known so far (2026-11-12, from building the encounter tracker):** when Claude moves a turn on
(`tools/encounter.mjs`), a creature starting its turn inside another's aura gets a line ("Kerra starts her turn in
the ogre's Frightful Presence: Will save"). The board's tracker runs the same turn rules but not that note, because
working out auras needs every creature's position and their prepared auras (`tools/actor.mjs auraEffects`), which
only the tools have. To do: move the aura check into the ruleset or engine (pure, from tokens and prepared
creatures) so the board and the tools share it. Until then Claude says it.

---

## FR-15: A home for the Selection card's controls

**Known so far (2026-11-12):** the side panel's Selection card was retired with the move to Foundry's sidebar. It
also held a few controls that now have no button: lighting or putting out a token's carried light, the GM's carried
light colour and animation, marking an unseen foe's hidden position for players, and the GM's reminder of the name
players see for a named NPC. Candidates: the token HUD (as Foundry's light toggle), Token Quick-View, or a token tab.
Its code was removed on 2026-11-12 (dead: it drew into a hidden element); what it did, for rebuilding: the light
button flipped `t.light.on` and recomputed; the GM's carried-light row set `t.light.colour`, `intensity` and
`animation` through the same `lightRow`/`animRow` controls the Lighting tab still uses; "Mark hidden for players"
set or cleared `S.hiddenMarks[id] = [x, y]` (saved as the map state's `hidden_marks`) for a foe the party does not
see. Claude can still do all of these from chat (`tools/token.mjs`, the map state).

## FR-16: Two-finger touchpad panning

**Asked for:** the user asked whether two-finger dragging pans the map (2026-11-12); a ticket for later.

**What is known:** on a touch screen it already does: two fingers pan and pinch-zoom together (`pinchStep` in
`board/gestures.js`), and one finger on empty floor pans. On a laptop touchpad it does not: a two-finger swipe reaches
the page as wheel events, and the board treats every wheel event as zoom (`onWheel` in `board/app.js`), so a swipe
zooms. A touchpad pinch zooms, as it should. With a mouse, the right button drags to pan.

**Proposed** (not decided): as Figma and Google Maps do, a two-finger swipe pans (both directions), a pinch zooms
round the pointer (browsers send it as a wheel event with `ctrlKey`), and a mouse wheel keeps zooming. Browsers do
not say which device sent a wheel event, so tell them apart by how they look: touchpads send small, smooth deltas in
pixels (`deltaMode` 0), often with sideways movement; a mouse wheel sends larger notched steps or lines. Ctrl+wheel
always zooms, for a mouse the guess gets wrong.

**Open questions:** is the guess good enough on the user's machines, or should a setting choose "wheel pans" /
"wheel zooms"? Should Shift+wheel pan sideways with a mouse?
