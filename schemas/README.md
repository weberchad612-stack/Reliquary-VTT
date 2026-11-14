# schemas

JSON schemas (draft 2020-12) for pack and save records. The design is in [docs/design/maps.md](../docs/design/maps.md).

| Schema | Describes | Lives in |
|---|---|---|
| `pack.schema.json` | A pack's manifest: id, version, the ruleset it targets, its maps, its visual effects file, and the open content its campaigns use (`content`: `pf2e/<source>`) | pack: `pack.json` |
| `campaign.schema.json` | A campaign save's own record: its pack (or, for an Adventure Path, its `packs`, one per book) and ruleset, current map, maps discovered, table settings (sky, colour, animation), notes (a test campaign's tips), the players (who plays which PCs), the music (mood, boss switch, the shared run, pause, maps' themes), the party's marching order (`marching`: slots and the members the GM added) | save: `campaign.json` |
| `map.schema.json` | One map (kind battle, area or landing; a landing page is a picture only): image, grid calibration, wall files, links to other maps (an entrance's optional `facing` for marching order), the starting area and its optional `start_facing`, hidden areas (insets of other maps) | pack: `maps/<id>/map.json` |
| `walls.schema.json` | Wall segments in grid cells (9 types: doors, secret doors and veils among them; one-way, proximity; thickness `w`; `snap` 1/8 or 1/32); doors may be stuck (`stuck_dc`), blocked, or found automatically (`auto_find`); door leaves have a `hinge` and `swing`, and the two leaves of a double door name each other in `pair` | pack: `maps/<id>/walls.json` |
| `terrain.schema.json` | Terrain areas in whole squares (difficult, greater difficult, swim, climb, uneven, narrow, hazardous) with cause, DC, damage, and areas that start switched off | pack: `maps/<id>/terrain.json` |
| `lighting.schema.json` | Lighting regions (squares open to the sky or with a fixed level, colour, intensity) and static light sources (position, preset or radii, colour, intensity, animation, walls, cone, initial state) | pack: `maps/<id>/lighting.json` |
| `actor.schema.json` | A creature's game data, the part every system shares (system, kind, base); the ruleset's own schema (`rulesets/<id>/schemas/`) checks the rest | save: `actors/<id>.json` |
| `actorstate.schema.json` | What is happening to a creature now: HP, temporary HP, resources, a raised shield, situation tags, the coins it carries | save: `actorstate/<id>.json` |
| `chat.schema.json` | The chat: narration, rulings, NPC lines, initiative, check and damage cards (retired kinds `event` and `log` still load) | save: `chat.json` |
| `audit.schema.json` | The GM's audit log: every change, in words | save: `audit.json` |
| `exploration.schema.json` | The PCs' exploration activities while travelling: an activity from the system's list with its choices, or a note | save: `exploration.json` |
| `events.schema.json` | The adventure's events (trigger, stages, actions; engine/events/events.js) with their state in play, and the campaign's flags | save: `events.json` |
| `loot.schema.json` | The party's stash (items carried by nobody, each a library item or a custom one, with what the party knows of it and where it was found) and its purse | save: `loot.json` |
| `ledger.schema.json` | The campaign ledger, the GM's memory: improvisations (who invented each: Claude, or which player through which character), secrets, rulings, threads, quests, timed events, session summaries | save: `ledger.json` |
| `dice.schema.json` | Every die rolled, for the Dice statistics | save: `dice.json` |
| `replay.schema.json` | Replays: batches revealed step by step (changes, posts, moves, roll details, narration steps), the unfinished ones and the last few finished | save: `replays.json` |
| `map-state.schema.json` | Door states, found secrets, explored outlines, tokens by generated id (`tok-…`; a PC keeps its square on each battle map it left in `last_square`; tokens built from the adventure carry `source: "adventure"`) with their names (adjective names, proper names with an alias until learned), type, group and letter, token cells, temporary terrain and terrain switched on or off, sky light, static lights and regions changed in play (on/off, colour, intensity, animation), the table's coloured-light switch and strength and animation switch, carried lights and senses, token effect badges (conditions and custom effects), dead and elevation, placed area templates, map notes and ambient sounds (by generated ids, `tpl-…`, `note-…`, `amb-…`), area-map places and entrances found, on one map | save: `maps/<id>.json` |

A schema cannot check everything. `tools/validate.mjs` adds the rest: snapping to the file's `snap`, no thickness on doors, veils, one-way or proximity walls, veils never locked, grid bounds, unique ids, door and link references, double-door pairs, clear doorways, and proximity distances.

Still to come: `pack`, `room`, `creature ref`, `encounter`, `trigger`, `quest`, `item`, and the rest of the campaign save.
