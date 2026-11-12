# rulesets

One folder per game system (`pf2e` first, then `dnd5e`).

A ruleset declares the character model, action economy, check resolution, conditions, rest and time rules, encounter math, and stat block and sheet schemas. It knows nothing about any adventure. The map engine asks it for the game rules of movement (diagonal costs, terrain costs, who may share a space), so the engine itself stays system-free.

Only open-licensed rules content (Pathfinder ORC, D&D 5e SRD) may be committed here, paraphrased.

| File | What |
|---|---|
| `systems.js` | The systems the board knows, by ruleset id, `creatureDistance` (distance between creatures by a system's measurement) and `creatureDistance3D` (with height, when the system counts it). |
| `pf2e/system.js` | The Pathfinder 2E system configuration the board and tools read: `measurement` (5-ft squares, 5-10-5 diagonals, distance between creatures from nearest square to nearest square, height counted as a third direction with the same diagonals, creatures as tall as they are wide) `conditions` (every Player Core condition from `pf2e/conditions.js`: icon, good or bad, whether it takes a number, which grey the token or stop it seeing, a paraphrased rules line) and `areas` (burst, cone, emanation and line: where each starts, cone directions, line width, the quick sizes, and line of effect: walls that block movement block areas, except grates and portcullises) and `effects` (the visual effects library, `pf2e/effects.js`), and `actors` (creatures' game data and rules: `actor.js`, `damage.js`, `rules.js`). |
| `pf2e/rules.js` | PF2E rules as data: bonus types and stacking, proficiency, skills and saves with their attributes, the selectors rule elements may name, every condition's rules and the conditions it brings (from the published rule data), health bands, damage groups. |
| `pf2e/actor.js` | `preparePf2e`: every statistic of a character from its build (attributes, proficiency ranks, level, armour, shield, weapons, feats) and of a creature from its stat block, with conditions and effects applied and a breakdown for each. |
| `pf2e/damage.js` | Damage (immunities, weaknesses, resistances, temporary HP, massive damage, knocked out, dying and wounded, nonlethal), healing (waking the dying), temporary HP, recovery checks. |
| `pf2e/schemas/` | The PF2E actor (character, NPC) and content (creature, item) formats, as JSON schemas the validator uses. |
| `pf2e/effects.js` | The Pathfinder 2E visual effects library: a palette by damage type and trait, about 90 effects named by what happens (weapon strikes, ranged, spell projectiles, areas, healing and buffs, conditions and social, creature attacks, movement) composed from the engine's primitives (`engine/fx/fx.js`), and fallbacks by kind and trait. Data only; another ruleset brings its own (a sci-fi one with beams, glitches and tracers). |
| `pf2e/terrain.js` | Pathfinder 2e terrain and movement: difficult and greater difficult terrain costs, no stacking, ignoring difficult terrain, no Step into difficult terrain, Swim and Climb, Balance and hazards; the diagonal pattern (5-10-5). See `docs/design/maps.md` section 9a. |
| `pf2e/light.js` | Pathfinder 2e light and vision: light presets (torch, lanterns, the light cantrip...) with their natural colours and animations for drawing, senses (low-light vision, darkvision, greater darkvision), and what each light level means to an observer (observed, concealed, unseen). See `docs/design/lighting.md`. |
