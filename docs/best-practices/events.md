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

## 3. Lessons

- Keep the definition and the state in one record per event: the GM tab shows both, and `--update` refreshes the
  definition while keeping the state fields (`EVENT_STATE_FIELDS`).
- `tick` makes a few passes: a stage that sets a flag can make the next stage due at once.
- A fight's end is a flag with its game time (`ended:<group>`), so a stage chained to it fires only for a fight that
  ended after the stage began.
- A new sidebar tab needs its `<section class="sb-pane" data-pane="...">` in board/index.html as well as its entry in app.js's tab list; without it `sidebar.panel()` is null and the board fails to start (the headless check caught it).
- Party level is the average of the PCs' levels, rounded; the party's areas are every keyed room a living PC stands in
  on the current map.
