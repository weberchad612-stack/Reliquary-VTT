# Future implementation ideas

Write-ups of work we have thought through but not scheduled. Each one says why it is waiting, what it would take, and in what order to do it. When an idea is built, move what was decided into the design docs (`docs/design/`) and the best-practices guides, and delete or mark the write-up.

| Idea | Write-up | Pick up |
|---|---|---|
| Faster sight and fog rendering | [sight-performance.md](sight-performance.md) | With the light phase, or if play feels slow (on phones, or for live sight while dragging) |

Other ideas raised but not yet written up (from the comparison with the first implementation, 2026-11-09):

- Removing falsely detected doors in the importer (`remove` on a `doors` correction); needed for Level 2.
- Showing wall bodies at the edge of sight (thin walls whole, thick walls to their middle), display only.
- A scouting marker that reveals what can be seen from its square.
- GM-revealed "known" areas shown as a dimmed, blurred map (the party has a map or a description).
- A player-facing turn view during combat.
- Pillars kept as small closed walls on import.

Terrain follow-ups (from building the terrain layer, 2026-11-09):

- Hidden terrain: a GM-only area (quicksand, a covered pit) that players learn of when someone enters it or Seeks.
- This table's ruling that moving through an ally's square is difficult terrain: needs the token layer; it uses the same `enterCost` hook.
- How terrain applies to creatures larger than one square: the engine charges once per step for the worst new square, a table ruling to confirm.
- Gridless measurement and terrain shapes, if a map or ruleset ever needs them (areas would gain a polygon; the square list stays the grid answer).

Lighting, after the first version (design agreed 2026-11-09 in [docs/design/lighting.md](../docs/design/lighting.md)):

- Light animations beyond the first set (sweeping beams, sparkles, ripples, swirling fog, energy fields, sound-reactive light): see [light-animations.md](light-animations.md). Colour and intensity are built (lighting design section 13); torch, flicker, pulse, ghostly and chroma animations are built (lighting design section 14).
- Magical darkness, and greater darkvision seeing through it.
- Imprecise senses (scent, tremorsense, hearing): hidden markers placed for foes automatically, suggested for PCs.
- Time of day driving the sky light (outdoor maps and sky regions).
- Daylight spilling sideways from a hole in the roof (a sky region inside a building) into the roofed part of the room around it. Daylight through windows and open doors is built (lighting design section 10); open roof edges have no wall to emit from yet.
- Roofed regions for buildings on outdoor maps, filled by the importer from the room outlines, so their windows let daylight in.
- Carried cone lights (bull's-eye lantern) and token facing.

