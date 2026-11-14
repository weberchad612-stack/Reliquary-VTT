# Reliquary-VTT

A virtual table top framework for use by Claude AI to run TTRPGs for you.

## Status

Early development. The board (Reliquary Virtual Tabletop) runs a map table: maps, light and fog, tokens, movement, targets, area templates, notes, effect badges and visual effects. Design: [docs/design/maps.md](docs/design/maps.md) and [docs/design/board.md](docs/design/board.md). Best practices for each core feature: [docs/best-practices/](docs/best-practices/README.md). Ideas for later: [future/](future/README.md).

Built so far:

- JSON schemas for maps, wall segments, terrain, lighting and map state (`schemas/`)
- Wall types and sense values shared by the engine and tools (`engine/walls/presets.js`)
- The sight engine: visibility polygons and line of sight for every wall type and token size (`engine/sight/`)
- Movement: steps, fitting large creatures, pathfinding, reach and exact one, two and three Stride ranges (`engine/movement/`); distances and rulers (`engine/measure/`)
- Terrain: difficult, greater difficult, hazardous, uneven, narrow, climb and swim areas and their movement costs (`engine/terrain/`)
- Light and vision: light sources and regions, darkness and dim light, darkvision and low-light vision, concealment, daylight through windows and open doors, fading dim light, colour, intensity and flickering or pulsing light (`engine/light/`)
- Fog of war: explored-area merging and the three-state player and GM fog, and one creature's own view (`engine/fog/`)
- The Pathfinder 2e rules and configuration the engine and board ask for: measurement, area shapes and line of effect, conditions, movement and terrain, light and senses, and a library of about 90 visual effects (`rulesets/pf2e/`)
- Area templates (burst, cone, emanation, line) with line of effect (`engine/areas/`)
- Game data and rules: creatures' statistics computed from PC builds and stat blocks with breakdowns, every condition's effect on the numbers, damage and healing with resistances, dying and wounded, degrees of success, PF2E's own rule keys and turn rules (`engine/rules/`, `rulesets/pf2e/`)
- Open game content: all of Foundry PF2E's open data (ORC and OGL) converted into our format, with an importer that reports what is new, changed, renamed and retired at each release, and 568 trait descriptions (`content/pf2e/`, `tools/import/`)
- Time: calendars (Golarion's), the game clock and the day of the adventure, durations counted as Foundry does, and encounters with initiative, rounds and turns (`engine/time/`, `tools/clock.mjs`, `tools/encounter.mjs`)
- Visual effects: genre-neutral drawing primitives (fantasy, sci-fi and modern shapes) that rulesets and packs compose into named effects, with hit, critical and miss results (`engine/fx/`)
- Sound: every visual effect's sound (hit, critical and miss, timed to the impact), table cues (dice, turns, rounds, doors, deaths), music by mood that plays in step on every screen (exploring, combat, boss by the system's rule, town, tension, rest), and ambient sounds placed on maps, heard from the selected token or the party and muffled through walls (`engine/sound/`, `board/sound.js`). The sound set is orchestral and original, performed with the CC0 VSCO 2 samples by a generator in `tools/sound/`, and kept with Git LFS in `sounds/`
- The board, Reliquary Virtual Tabletop (`board/`): one page with the player and GM views, a title line with the map menu and the game clock, travel between maps and area maps (towns), zoom and pan, multi-select and group moves, dragging through waypoints (Space) with running distances, hover and distance, targeting, area templates, map notes, effect badges with unconscious, dying and dead, a Foundry-style sidebar (tabs that pop out into windows, collapse, resize: chat, encounter, notes, visual effects, dice statistics, replay, and for the GM lighting, walls, the Events tab (every adventure event and its state, combat events marked due by the tracker), the campaign ledger (the GM's memory of improvisations, each with who invented it and through which character, secrets, rulings, threads, quests and session summaries) and the audit log, a subsystem card above the chat (points and what has been revealed), party loot for everyone (the purse, the stash, each character's coins and items with Bulk and encumbered, vague names until identified), exploration (each PC's activity while travelling, the party's pace, travel moving the clock, the activities applied when combat starts, a badge on each PC), the party's marching order (a 4 x 4 grid anyone arranges; arrivals and Claude's moves keep it, turned the way the party heads, in column through narrow places, never onto unexplored ground), and sound (a mixer with a mute per channel, now playing; for the GM the mood, boss music, pause and resume, Next, a map's music, a soundboard and the map's ambient sounds); actions and the quest log to come) with the players' chat (Claude's story narration, rulings, NPC lines, roll cards and table events) the GM's audit log of every change, replays of Claude's batches revealed step by step (roll details per view, narration steps, combat, exploration and social icons) with a "Claude is thinking" banner, check and damage cards in the chat, and dice statistics for everyone (by die, face, roller, session and kind of roll), a right-click token menu with a status palette, visual effects played from chat, the game clock and calendar in the title line (the GM can change it), Token Quick-View (double-click a token for its live stat block or sheet, with traits, feats and features explained on hover), an encounter tracker (Enter Combat, a roll dialog with every modifier, roll cards in the chat, initiative set by dragging, hide, defeated and target from each row, turns that run the rules and move the clock, Stride ranges shown while it runs), tokens the GM hides from players, and tokens with generated ids and unique names (a named NPC shows players an alias until they learn the name); it runs on its own private database, and Claude loads, saves and switches campaigns with `tools/campaign.mjs`
- A map importer that turns a map in a PDF you own into wall, terrain and lighting data for a private pack: straight thick walls measured from the art, art-style profiles, and a map check of sight per room and walking routes (`tools/mapimport/`, `tools/mapcheck.mjs`)
- An adventure importer that turns an adventure you own into a private pack and a campaign: paraphrased notes, maps, start squares from the book's pawns, token art, the cast with their stat blocks (and the book's changes to them), object tokens with treasure, room tables, sounds, the GM's ledger, a landing page (the cover, where the party waits as players join), the adventure's events and subsystems, and its kickoff (the book's way of starting the story, mandatory). One command runs the whole import from the pack's pipeline with a status table. Its checks cover every keyed area of the book against the pack, loot and hazards, links between levels, rooms against the book's crops and the book's events and opening, with a review sheet per map. A campaign updates from its pack without losing play, and the pack syncs to the user's PC without overwriting their edits (`tools/advimport/`)
- A validator; sight, movement and fog query tools; token, area template, map note, effect badge, visual effect, creature, check, dice, replay (with narration steps), thinking-banner, ledger, players, party loot, exploration, marching order, adventure events and subsystems, and sound tools for Claude, a battle map generator for fights the book gives no map, a Foundry PF2E importer, and an id converter; and a wall overlay renderer (`tools/`)
- An original sample map pack and save, and an interactive demo of the engine on it (`examples/`)

## Development

Requires Node.js 20 or newer, Git LFS for the sound set (`sounds/`; clone with `GIT_LFS_SKIP_SMUDGE=1` to skip the audio), and Python 3 with Pillow for the image tools (the map importer also needs `tools/mapimport/requirements.txt` and poppler's `pdfimages`; the sound generator needs numpy, scipy, soundfile, ffmpeg and the VSCO 2 CE samples: [docs/best-practices/sound.md](docs/best-practices/sound.md)).

```
npm install
npm test
node tools/validate.mjs examples/sample-pack --save examples/sample-save
```

## License

The framework code is released under the [MIT License](LICENSE), copyright Cahoots Creative, LLC.

No publisher game content (rulebooks, adventures, maps or art) is included in this repository. Users supply their own.

## Licences

Code: MIT ([LICENSE](LICENSE)). Pathfinder game content in `content/pf2e/` is converted from the Foundry VTT PF2E system's open data under the ORC License and the Open Game License 1.0a, and uses Paizo trademarks and copyrights under Paizo's Community Use Policy: see [NOTICE.md](NOTICE.md). Reliquary VTT is not published, endorsed, or specifically approved by Paizo, and is free.
