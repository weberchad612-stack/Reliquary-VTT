# rulesets

One folder per game system (`pf2e` first, then `dnd5e`).

A ruleset declares the character model, action economy, check resolution, conditions, rest and time rules, encounter math, and stat block and sheet schemas. It knows nothing about any adventure. The map engine asks it for the game rules of movement (diagonal costs, terrain costs, who may share a space), so the engine itself stays system-free.

Only open-licensed rules content (Pathfinder ORC, D&D 5e SRD) may be committed here, paraphrased.

| File | What |
|---|---|
| `systems.js` | The systems the board knows, by ruleset id, and `creatureDistance` (distance between creatures by a system's measurement). |
| `pf2e/system.js` | The Pathfinder 2E system configuration the board and tools read: `measurement` (5-ft squares, 5-10-5 diagonals, distance between creatures from nearest square to nearest square) and `areas` (burst, cone, emanation and line: where each starts, cone directions, line width, the quick sizes, and line of effect: walls that block movement block areas, except grates and portcullises). |
| `pf2e/terrain.js` | Pathfinder 2e terrain and movement: difficult and greater difficult terrain costs, no stacking, ignoring difficult terrain, no Step into difficult terrain, Swim and Climb, Balance and hazards; the diagonal pattern (5-10-5). See `docs/design/maps.md` section 9a. |
| `pf2e/light.js` | Pathfinder 2e light and vision: light presets (torch, lanterns, the light cantrip...) with their natural colours and animations for drawing, senses (low-light vision, darkvision, greater darkvision), and what each light level means to an observer (observed, concealed, unseen). See `docs/design/lighting.md`. |
