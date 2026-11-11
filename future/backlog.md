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

