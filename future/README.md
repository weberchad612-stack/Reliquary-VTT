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
