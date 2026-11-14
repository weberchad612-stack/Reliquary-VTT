# Adventure events

Adventures are full of things that happen when a condition is met: at night once the party reaches a level, when a
fight ends, after hours have passed since something began, on a given round, when a creature is badly hurt. They are
data in the campaign, run by Claude the moment they are due. Design and decisions: [future/adventure-events.md](../../future/adventure-events.md).

| Part | Where |
|---|---|
| The engine (conditions, what is due, moving an event's state) | `engine/events/events.js` (system-free) |
| The save | `events.json` (`schemas/events.schema.json`): each event's definition and its state, and the flags; on the board `events/<id>` and `state/flags` (GM only) |
| The tool | `tools/events.mjs`: `status`, `due`, `tick`, `run`, `next`, `go`, `finish`, `reset`, `decide`, `flag`, `unflag`, `context` |
| Where they come from | the pack's `adventure.json` `events`, carried into the save by `tools/advimport/campaign.mjs` |
| A fight's end | `tools/encounter.mjs end` sets `ended:<group>` for each group in it |

## 1. Writing an event (adventure.json)

```json
{ "id": "bell-at-dusk", "title": "The bell at dusk", "kind": "combat", "pages": "12-13",
  "where": { "map": "keep", "area": "S1" },
  "trigger": { "all": [ { "level": { "min": 2 } }, { "time": "night" }, { "outdoors": true }, { "manual": true } ] },
  "stages": [
    { "id": "seen", "actions": [ { "do": "narrate", "text": "paraphrase, in our words" } ],
      "branches": [ { "if": { "elapsed": { "seconds": 7200 } }, "go": "late" } ], "next": "fight" },
    { "id": "late", "actions": [ { "do": "note", "text": "what changes if they dawdle" } ], "next": "fight" },
    { "id": "fight", "actions": [ { "do": "map", "text": "a churchyard, low walls, graves" },
      { "do": "place", "group": "bell-1", "rule": "scattered, none within 30 ft of another" },
      { "do": "decision", "id": "allies", "question": "Do the townsfolk help?", "options": ["help", "flee"] },
      { "do": "encounter", "group": "bell-1" } ] },
    { "id": "second", "when": { "encounter_ended": "bell-1" }, "actions": [ { "do": "encounter", "group": "bell-2", "initiative": "a skill other than Perception" } ] },
    { "id": "after", "when": { "encounter_ended": "bell-2" }, "actions": [
      { "do": "ledger", "kind": "quest", "title": "...", "text": "...", "status": "open" }, { "do": "xp", "amount": 30 } ] }
  ],
  "repeat": { "cooldown": 2592000 } }
```

- **Conditions:** `all`, `any`, `not`; `level {min,max}`; `time` night|day; `after` (game seconds); `elapsed {seconds,
  since: event|stage}`; `map`; `area` (the room keys of the map's `rooms.json`); `outdoors` (the map, or a room marked
  `outdoor`); `flag` (with `is`); `carrying` (an item's ref or name); `event {id, status}`; `encounter_ended` (a group
  or `any`, since the event or stage began); `round {n, group}`; `turn` (a group or a token's name); `hp_below
  {fraction, group}`; `manual` (never true by itself: the GM's moment, `run`).
- **Stages** follow one another: a `branch` is taken when its condition holds; else the `next` (or the following)
  stage starts when its `when` holds, or when Claude moves it on (`next`) if it has none.
- **Actions** are Claude's checklist; `flag` and `ledger` are written by the tool. Kinds: narrate, card, fx, sound,
  light, place, reveal, encounter, door, map, xp, decision, flag, ledger, note.
- **Book content:** an event lives in the private pack. Text in it is a paraphrase with page references, never the
  book's words.
- `checkEvents` (the importer and the validator) catches unknown conditions and links to stages that do not exist.

## 2. Running them

`events.mjs due` after every move into a new area, rest, clock jump, fight's end and new round; `tick` does what is
due and prints each entered stage's actions. Claude carries them out in order (a replay when there are several
steps), then `next <id>`. Decisions: `decide <id> <point> <choice>` (also a ledger fact). GM rules: running-a-game.md
section 11b; the pre-flight checklist's item 10.

## 2b. On the board

- **The Events tab (GM only):** every event, running and due first, with its stage; opened, its trigger in words,
  its stages (the current one marked) with their actions, decisions and history. A badge counts the running and due
  ones. It only shows: Claude runs events.
- **The tracker's hook:** the GM's board works out, whenever the encounter, the flags or a creature's state changes,
  which events tied to a round, a turn or wounds are now due, and marks them (`state/eventsdue`, an audit line, a
  toast). Each is marked once per run. Conditions the board cannot see (the party's rooms, what they carry) do not hold
  there; Claude's own `due` covers them. `events.mjs due` lists the marks; `tick` clears them.

## 2c. Subsystems

Victory Points, Influence, Chase, Infiltration and Research (PF2E GM Core chapter 4) are points and thresholds:
`engine/events/subsystem.js` keeps the numbers; the system's kinds (`rulesets/pf2e/subsystems.js`) give each one's
words, default scoring and shape; `tools/subsystem.mjs` runs them; the save keeps them in `events.json`
(`subsystems`), on the board `subsystems/<id>`.

- **In adventure.json:** `"subsystems": [{"id": "lift", "kind": "victory", "title": "...", "pages": "7", "goal": 4,
  "thresholds": [{"at": 4, "id": "fixed", "label": "...", "end": "success"}]}]`. Infiltration: `obstacles` (`goal`,
  `individual`, `checks: [{skill, dc}]`), `awareness` thresholds (default: 5, 10, 15, 20). Influence: `npcs` (each with
  thresholds, checks, notes for discoveries, resistances and weaknesses), `rounds`. Chase: `obstacles`, `opponent`.
  Research: `goal`, `thresholds`, `sections`, `rounds`. A book's own scoring replaces the default with `scoring`.
- **Points come from the rolls.** `subsystem.mjs check <id> <part> --who PC --skill S --roll N` rolls through
  check.mjs against the part's DC (raised by thresholds reached: an infiltration's Awareness), posts the check card and
  scores the degree. `score` is for a degree already rolled; `add` for points by hand (a spell, a complication);
  `round` for a new round (Awareness +1 each round in an infiltration).
- **Events and subsystems talk through flags:** a threshold reached sets `<id>:<threshold>` (or its own `flag`), an
  overcome part `<id>:<part>`, the end `<id>:success|failure`. An event stage starts a subsystem with
  `{"do": "subsystem", "id": "...", "show": true}` and waits on its end with `{"flag": "<id>:success"}`.
- **What players see** (the user's decision): the card above the chat shows the points and progress, the parts,
  notes and skills revealed (`reveal`); DCs, thresholds and hidden parts stay the GM's. The GM sees everything, marked
  GM, with the DCs as adjusted.
- Defaults checked against GM Core (Archives of Nethys, 2026-11-14): Victory Points, Influence, Chase and Research: critical
  success +2, success +1, failure 0, critical failure -1 (Research never below 0); Infiltration: +2 and +1 Infiltration
  Points, failure 1 and critical failure 2 Awareness Points, and 1 more at the end of each round.

## 2d. Generated battle maps

A fight the book sets somewhere with no battle map (a churchyard, a road, a rooftop) gets one made from the book's
description (the user's decision): `python3 tools/genmap/genmap.py <spec.json> packs/<pack>/maps/<id>`.

- **The spec is Claude's, in its own words:** size in squares, ground, the party's start, and features: buildings
  (walls with doors and windows), walls, low walls (with gaps where paths cross), rocks and pillars, trees,
  undergrowth, rubble, mud, water (deep is Swim), graves, paths, fires and lights, hazards. The tool paints original
  art from it and writes the walls, terrain and light from the same spec, so they agree. Full list: the tool's header.
- **Place it like the book's:** put the map in the private pack (`maps/<id>`), add it to `pack.json` and the
  adventure's `maps`, run `campaign.mjs --update` (it adds the map and keeps play), and point the event's
  `{"do": "map", "map": "<id>"}` at it. The spec stays beside the map as `genmap.json`, so it can be made again after
  a change.
- Read the spec against the book's description once more before the fight: what stands where, what blocks sight
  (walls and rocks do; trees and headstones do not, they give cover by ruling), what is difficult terrain.
- Same spec, same picture (seeded from the map id). Check it on the board before the party arrives.

## 3. Lessons

- Keep the definition and the state in one record per event: the GM tab shows both, and `--update` refreshes the
  definition while keeping the state fields (`EVENT_STATE_FIELDS`).
- `tick` makes a few passes: a stage that sets a flag can make the next stage due at once.
- A fight's end is a flag with its game time (`ended:<group>`), so a stage chained to it fires only for a fight that
  ended after the stage began.
- A new sidebar tab needs its `<section class="sb-pane" data-pane="...">` in board/index.html as well as its entry in app.js's tab list; without it `sidebar.panel()` is null and the board fails to start (the headless check caught it).
- A value of 0 is a real game time: test `=== undefined`, never truthiness (a threshold reached at time 0 looked unreached until a test caught it).
- Every export of an engine module lands in one flat `Engine` object on the board: names must be unique across the engine (`subsystemRound`, not `nextRound`).
- Generated maps: scattered features (graves) stay off paths and structures, and a rock's own outline is its wall (drawing the wall line over it made it read as a hut); terrain `cause` must be a slug (`low-wall`).
- Party level is the average of the PCs' levels, rounded; the party's areas are every keyed room a living PC stands in
  on the current map.
