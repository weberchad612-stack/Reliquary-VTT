# Feature backlog

Feature requests from the user, one ticket each. A ticket records what was asked and what is already known;
it is not a design. When a ticket is picked up, design it with the user (one question at a time), then
move the decisions into `docs/design/` and the best-practices guides, and mark the ticket done here.

Status: **open** (not started), **designing**, **building**, **done**.

| # | Feature | Status | Raised |
|---|---|---|---|
| FR-1 | [Party marching order](#fr-1-party-marching-order) | open (partly decided) | 2026-11-10 |

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
