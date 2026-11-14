# Adventure events and subsystems

Pathfinder adventures are full of events: combat events (a fight that starts when something happens, reinforcements
on round 3), social events (a scene with an NPC, often an Influence encounter), and narrated skill challenges (the
Beginner Box's lift, Victory Points). Today they live in the area notes and the ledger's timed events, and only
Claude remembers to check them. This write-up records what was found and what the user decided (2026-11-13).
**Built 2026-11-14:** the engine, save and records, `tools/events.mjs`, the checklist's event facts, the GM Events tab
and the tracker's hook, the subsystems and `tools/subsystem.mjs`, generated battle maps; how to use them:
[docs/best-practices/events.md](../docs/best-practices/events.md). The shape below is kept as the design record.

## What exists elsewhere (researched 2026-11-13)

- **The Foundry PF2E system** (8.7.0, the release `content/pf2e/` comes from) has no event or subsystem engine:
  hazards carry their routine and reset as text, encounters compute threat and XP, Kingmaker's kingdom and army are
  modelled, and its scene-region behaviours cover environment features and difficult terrain. The open data has
  only the rules text (the Influence action, NPCs' skills).
- **Foundry's core** has the event engine the official adventure modules use: Scene Regions with behaviours fired
  by events (a token enters, exits or moves in a region; a token's turn or round starts or ends; the behaviour is
  switched on or off), whose actions run a script, pause the game, teleport a token, toggle another behaviour or
  change darkness and movement cost. Core Foundry is not open source: the idea is borrowed, not the code. Our room
  table already gives every keyed area its squares, and the tracker and clock give rounds and time.
- **PF2e Subsystems** (github.com/WBHarry/pf2e-subsystems, MIT) models Influence, Chase, Infiltration and Research,
  every part with a hidden flag the GM reveals; it has no triggers. Its fields are a good model (credit it if its
  structure is followed):
  - Influence: the NPC's Perception and Will, Influence Points, a time limit, discoveries (skill and DC), influence
    skills, thresholds, weaknesses, resistances, penalties.
  - Chase: rounds, participants and where they are, obstacles with Chase Point goals and how to overcome them.
  - Infiltration: Awareness Points with breakpoints, objectives with obstacles, complications with triggers,
    opportunities, preparation activities, Edge Points.
  - Research: Research Points, a time limit, checks, thresholds, research events.

## The worked example: a chapter 1 event in Abomination Vaults (p 37)

Its shape only (the book's text stays in the private pack): a trigger of party level, night, and being outdoors
within sight of a landmark, with the GM choosing the moment; a narrated beat seen from afar; a branch if the party
takes more than a couple of hours to respond, and an NPC who prompts them if they hesitate; a fight against undead
scattered so none is within 30 ft of another, who converge on any fight, with frightened NPC allies who may help if
persuaded and flee if attacked; a second fight chained to the end of the first, a creature appearing among the
party (a skill other than Perception for initiative; a Recall Knowledge check explains it); and an aftermath of a
quest with a reward, a town's mood, and the event able to fire again after a month at the GM's choice.

What the design must therefore include, beyond area-entered triggers: conditions on level, time of day, being
outdoors on given maps; stages chained on "an encounter ended"; branches on time passed since the event began;
decision points (do the NPC allies help?); placement by rule (scattered, a minimum distance apart, around the party)
as well as by square; a map for a fight the book sets somewhere with no battle map; and repeats with a cooldown.

## The user's decisions (2026-11-13)

| Question | Decision |
|---|---|
| When an event's conditions are met | **Claude runs it** as soon as it is due, as the book's GM would, and tells the user afterwards (decision points inside it are Claude's, recorded in the ledger) |
| Where the GM sees events | **A GM-only Events tab**: every event with its state (waiting, due, running, done), trigger and stages; players see only what happens (narration, cards, effects) |
| A fight with no battle map | **Claude generates a map** for it from the book's description (walls, terrain, a few features, as an original image and our map data) |
| The importer and events | **Find and check**: the area checklist flags every event in the text (trigger phrasing, chained fights, skill challenges, Victory Point and Influence blocks); Claude writes each into adventure.json (paraphrased, with page refs); the checklist confirms none was missed |
| What players see of a subsystem | **Revealed parts**: points and progress, and whatever the GM reveals as it is found; DCs, thresholds and hidden parts stay GM-only |
| Who advances a subsystem | **From the rolls**: a check card's degree of success adds the subsystem's points (per its rules); a threshold reached fires its stage; Claude or the GM can adjust |
| Which subsystems | **All of them**: Victory Points (the base), Influence, Chase, Infiltration and Research |
| Round-based combat events | **Both**: the tracker fires events on a round's start, a creature's turn or an HP fraction, and Claude watches for them too (a pre-flight checklist item) |

## Shape (proposed, to settle when building)

- **Engine (system-free):** events as `{id, title, pages, where, trigger: {all|any: [conditions]}, stages: [{id,
  when, actions, branches}], repeat?: {cooldown}}`; conditions: party level, time of day, clock after, party in an
  area or outdoors on a map, a flag, an item carried, an encounter ended, a round or turn or HP fraction; actions:
  narrate (a paraphrase from the notes), show a card, visual effect, sound, light and sky changes, place tokens (by
  square or by rule), reveal, start an encounter (initiative skill), open a door or veil, set a flag, ledger entries
  (quest, fact, event), XP, a decision point. A points-and-thresholds tracker for subsystems.
- **Ruleset (PF2E):** the subsystems' definitions (points per degree of success, thresholds' meanings, Influence's
  discoveries and weaknesses, Chase obstacles), and the words the importer looks for.
- **Tools:** `events.mjs due` (what is due from the campaign's state; Claude runs it with every move, rest, round and
  clock change), `events.mjs run <id>`; the area checklist's event facts.
- **Board:** the GM Events tab; a players' subsystem card (revealed parts); tracker hooks.
- **Maps:** a generated battle map for a fight with none (original art and our map data).
