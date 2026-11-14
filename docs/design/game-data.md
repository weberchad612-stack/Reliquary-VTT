# Game data: design

The game data behind each token: a creature's statistics, its state in play, PC builds, rules content, and
the automation that resolves actions. Status: **step 1 (data, rules and the Foundry importer) built 2026-11-12; step 2 (the board) next.**
How to use it: [best practices: game data](../best-practices/game-data.md). The previous board's implementation is deliberately not used as a model (the user had no say in it).

## 1. Requirements (from the user, 2026-11-12)

**Who uses the data**
- Claude, from chat: reads and changes everything.
- The GM view: sees and edits any creature's data.
- Players: see and change their own PCs' data.

**How much the system does**
- **Resolves actions**, not only stores numbers: rolls attacks, saves and damage and applies them by the
  rules, with derived values (AC with conditions, max HP with drained, speed) computed by the ruleset.
- **Player tokens:** the client runs much of the combat automation for a player's actions; the results are
  queued for Claude to game-master and narrate.
- **NPC tokens:** Claude runs them completely.
- **Replay:** batches of Claude-driven combat actions are played out step by step (built 2026-11-12: `replay/<id>`, below).

**Dice**
- Several ways to roll: Claude rolls its own dice; the client rolls for its automated mechanics; a player
  can pick up a virtual die and throw it across the table, with an animated result.

**What players see of foes**
- Health as word bands (for example Unhurt, Hurt, Badly hurt, Near death), never numbers.
- Secrecy on screen is enough: only trusted people use the board, so the player view simply does not show
  GM data (the database itself is readable by anyone the board is shared with).

**Scope of data**
- Live combat state: HP, temporary HP, conditions, resources spent.
- Full stat blocks for every creature, viewable by the GM.
- Full PC builds: attributes, skills, feats, spells, gear, levelling.
- Inventory and loot: gear, coins, Bulk, party loot.

**Game systems**
- Only PF2E for now, but the model must stay swappable (rulesets bring their own data shapes and rules,
  as they do for conditions, areas and visual effects).

**Getting data in**
- PC builds: Claude builds them for now; a character builder in the client is a future enhancement.
- Rules content (spells, feats, items, monsters) may come from all of: the Foundry PF2E system's open data,
  the user's own PDFs (private packs only), Archives of Nethys, and Claude entering what the campaign needs.
  Licences to be checked before relying on any; book content never enters the repository.

**Left to the research**
- Where a PC's build lives: in each campaign's save, or in a character library that campaigns draw on.
- How Claude learns that the board has queued player actions (what the platform allows).

## 2. Research (2026-11-12)

**Foundry VTT** (the most automated PF2E table today):
- A small set of core *document* types, of which a game system customises mainly two: **Actor** (a creature)
  and **Item** (anything an actor has: a weapon, a feat, a spell, a condition). Each carries a `system`
  object whose shape the game system defines with a data model (fields, defaults, migrations). Items and
  **ActiveEffects** are embedded in the actor that has them.
- **Linked and unlinked tokens.** A linked token *is* its actor (PCs, unique NPCs): every token of it, on any
  scene, shows the same data. An unlinked token (a generic goblin or bandit) points at a base actor and stores
  only its own differences (an *actor delta*: its own HP, its own conditions). Change the base, and every
  unlinked copy changes except where it has its own value. Foundry advises not linking generic creatures, so
  each has its own resources.
- **Prototype token:** the actor holds the default look of tokens made from it.
- **Derived data** is prepared every time data loads (base, then embedded items and effects, then derived
  values), never stored.
- **PF2E rule elements:** most automation of feats, equipment, effects and conditions is data, not code. A
  rule element is a small JSON object on an item: a `key` (what kind of rule, such as FlatModifier), a
  `selector` (what it applies to: a skill, a save, AC, attack rolls), a bonus `type` (item, status,
  circumstance) and a `value`. Every modifier has a slug, so others can refer to it. Example: a +2 item
  bonus to Athletics is `{key: "FlatModifier", selector: "athletics", type: "item", value: 2}`.
- **Licence:** the system's code is Apache 2.0; its game data is under the Open Game License (Paizo's remaster
  content is ORC), and much of it relies on Paizo's Community Use Policy for names. The data (every creature,
  spell, feat and item, with rule elements) is open, but carries those notices.

**Fantasy Grounds:** the ruleset defines the record types (PC, NPC, item, spell) and how they interact, and
the campaign database's format; the database is a tree of nodes. Its *effects* are text tags that modify
rolls (a bonus to attacks, to AC), parsed from the books' wording; its developers say they would rather
have one data field describing each power's automation, which is what Foundry's rule elements are.

**Roll20:** characters belong to a campaign; the *Character Vault* (now Roll20 Characters) is a separate
library a character is copied into and out of, so one character travels between campaigns, and GMs keep
pre-made characters and NPCs there.

**What the board's platform allows** (checked with the artifact tools): a page can keep shared data (the
database it uses now), reach everyone who has the page open right now (`room`), and ask Claude through
`sample`. But `sample` is a separate, memoryless call (no campaign, no GM rules, no chat), so it cannot
game-master; and a page has no way to post into this chat. Claude sees the board's data only when it reads
it during a turn.

**Lessons that carry over regardless of system:**
- Separate what a creature *is* (its build or stat block) from what is *happening to it* (HP lost, conditions,
  resources spent), and store the second small, because it changes all the time and several people change it.
- Share one stat block between all creatures of a kind, with each keeping only its own differences.
- Never store a derived value; compute it from base data, items and effects, in a fixed order.
- Put rule automation in data (rule elements), so new content needs no code.

## 3. Proposal (for review; nothing is built)

### 3.1 Layers

| Layer | Holds | Example |
|---|---|---|
| Engine (`engine/`) | System-free machinery: a statistic pipeline (a base plus modifiers, each with a slug, a type and conditions on when it applies), a rule-element runner, dice, the action resolver, queues. | "AC = 10 + modifiers; drop the ones whose predicate fails" |
| Ruleset (`rulesets/pf2e/`) | The system's shapes and rules as data and small functions: the actor schema (which fields a character and an NPC have), the statistics (AC, saves, skills, Perception, speeds, HP), how bonus types stack, the rule-element keys it supports, conditions' rules, degrees of success, actions (Strike, saving throws, damage), health bands, what players may see. | "Status bonuses: only the highest applies. Clumsy N: -N status to AC and Dexterity checks." |
| Content | Creatures, items, spells, feats as data with rule elements: the sample pack (original, in the repo), the user's private packs (from Foundry PF2E data, PDFs, Archives of Nethys, or entered by Claude). | "Wet-Nosed Rat: level -1, AC 15, jaws +7 ..." |
| Campaign | The actors in play and their state. | "Kerra has 31 of 47 HP, clumsy 2, 1 hero point" |

### 3.2 Records

- **`actors/<id>`** (same id as the token): what the creature is. A PC or a unique NPC holds its whole build
  (linked, as in Foundry). A generic creature holds `base: "<type>"` (its stat block from the content) and
  only what is its own, the way Foundry's unlinked tokens do. Items (equipment, feats, spells, abilities) are
  embedded in the actor, each with its rule elements.
- **`actorstate/<id>`** (its own record, the user's choice; named `actorstate` because `state/` already holds
  the table's settings): what is happening to it now: HP, temporary HP,
  conditions and effects with durations, resources spent (hero points, focus points, spell slots, shield HP,
  ammunition). Small and written often, so Claude, the GM view and a player changing different things do not
  overwrite each other (the board already works this way with one record per token).
- **The token** keeps only position and look, as now.
- **Content** (stat blocks, items, spells) is loaded from the ruleset and the pack into the database only as
  the campaign needs it (`content/<type>/<slug>`), so the board can show and compute it without holding a
  whole compendium.
- **Derived values are never stored:** effective AC, saves, speed, max HP and attack bonuses are computed by
  the ruleset from base data, items, effects and conditions. The board and Claude's tools call the same
  function, so they always agree.

### 3.3 Visibility and ownership

- The ruleset marks each field: everyone, the owner, or the GM. Players see their own PCs whole and change
  what the ruleset lets owners change (HP, resources, prepared spells); foes show players only a health band
  (Unhurt, Hurt, Badly hurt, Near death; the ruleset defines the bands); the GM view sees and edits all.
  Hiding is on screen only (the user's choice).

### 3.4 Dice, actions and the queue

- **One dice service** for every way of rolling: Claude's rolls (a tool, like `fx.mjs`), the board's automated
  rolls, and a player's thrown virtual die (animated, later). Every roll is a record (a `chat/<time36>-<n>` message of kind `roll`, since 2026-11-12: who, what,
  dice, result, who may see it), so the log and replay show the same thing.
- **Actions are ruleset data:** a check (attack roll against AC, save against a DC), degrees of success, and
  what each degree does (damage, conditions). The engine resolves; the ruleset supplies the rules.
- **Player actions** resolved by the board become **queue records** (`queue/<id>`: the action, rolls, proposed
  results) marked for Claude. Applying a result is a separate step: Claude confirms and narrates, or adjusts.
  The board shows that the queue is waiting.
- **How Claude learns of it:** the platform cannot message this chat, so the queue is read at the start of
  every turn during play (a standing rule), and the board's queue badge tells the user to send any message
  ("go") when they want it resolved. (A scheduled check is possible but slow and costly; not proposed.)
- **Replay** (built 2026-11-12) plays a batch of resolved actions step by step, with the visual effects. Claude
  resolves the batch in a draft (`tools/replay.mjs`): the tools work on a working copy of the records, so each step
  sees the ones before, and each step keeps its changes (per record, by field, with the values before), its posts
  (chat, dice, audit, fx) and its moves. The board writes a step's changes and posts only when someone reveals it
  (anyone may press Next; a shared counter with a claim, so every screen follows and a step is written once);
  narration is a step of its own, right after the actions it tells, and check and damage cards reach the chat with
  their step. `state/adjudicating` shows "Claude is thinking" on every screen
  while the draft is open. Player actions from the queue will become replay steps the same way. Details:
  docs/best-practices/board.md (Replay), docs/best-practices/game-data.md section 2c.

### 3.5 Where a PC's build lives (research answer)

Foundry keeps actors in the world (the campaign) with compendiums for reuse; Roll20 keeps them in the campaign
with a separate vault to carry them between games. Proposal: **in the campaign save** (the board's database
during play, `saves/<campaign>/actors/` between sessions), with **export and import to a character library**
on the PC (`characters/<id>.json`) when one PC moves to another campaign. One place is the truth at any time.

### 3.6 Rules content

- **Foundry PF2E data** is the richest source (every creature, item, spell and feat, with rule elements). Its
  licences allow use with notices. **Decision (the user, 2026-11-12): open in this repository too**, in
  `content/pf2e/`, documents licensed ORC or OGL only, flavour descriptions and adventure bestiaries included,
  with the notices in `NOTICE.md` and `licenses/`. Its rule-element shape is the model for ours, adapted.
- **The user's PDFs** and **Archives of Nethys**: for what is missing or to check; private packs only.
- **Claude** enters what a campaign needs when nothing else has it.
- **The sample pack** gets a few original creatures, items and two sample PCs, so every test runs on open data.

### 3.7 Build order (proposed)

1. The statistic pipeline and rule elements in the engine; the PF2E actor schema, statistics and condition
   rules; actor and state records; sample content; derived values in tools for Claude.
2. On the board: the GM's stat window, the player's own PC sheet (live state), foe health bands, conditions
   changing the numbers. **Read-only part built 2026-11-12** as Token Quick-View (docs/design/board.md); editing
   on the board waits.
3. The dice service and roll records; Claude's dice tool; the roll log.
4. Actions: Strike, saving throws, damage and healing for PCs on the board, resolved and queued for Claude.
5. Replay of queued and NPC actions with effects (NPC and Claude's batches built 2026-11-12; the queue waits for step 4).
6. Items, inventory and loot (**built 2026-11-13** as Party loot: the stash, the purse, characters' coins, how items are carried, Bulk and encumbered, identifying; board/loot.js, rulesets/pf2e/loot.js); spells and resources; levelling; a character library; a builder; thrown 3-D dice.

### 3.8 Decisions (the user, 2026-11-12)

- **Live state has its own record** (`state/<id>`, beside `actors/<id>`).
- **Foe health in the ruleset's own words:** each ruleset defines its bands and wording; PF2E gets its own set.
- **Play stays a conversation:** the user describes what they do in chat and Claude game-masters and narrates
  (a narration log will keep the story). The board makes the user less dependent on Claude for a PC's basic
  actions (moving, attacking, casting damage spells): it works out the mechanics of what was asked and queues
  it; the user tells Claude in chat when to start resolving, and Claude reviews, applies and narrates.
- **One set of features at a time, built and fully tested before the next.** First: the underlying data and
  rules (3.7 step 1) only.
- **Our own format, with an importer** for Foundry PF2E data (the rule elements we support carried over, the
  rest flagged for Claude). Not Foundry-compatible: our shapes stay clean and swappable.
- **A PC's numbers are computed from the build** (attributes, proficiency ranks, level, items), so a level-up
  or new armour changes them by the rules.
- **Step 1 covers:** statistics and modifiers (bonus types and stacking); conditions changing the numbers;
  damage and healing (temporary HP, resistances, weaknesses, immunities, dying and wounded, healing); degrees
  of success.
- **Sample content:** original builds for the test PCs (Kerra a fighter, Pip a wizard, Lyra a ranger) and
  original stat blocks for the test creatures, in the sample pack.

## 4. Step 1: data and rules (spec, for review)

**Engine (`engine/rules/`, system-free)**
- `statistic(base, modifiers, ctx)`: a value from a base and modifiers. A modifier: `{slug, label, type, value,
  selector, predicate?}`. Which modifiers stack is the ruleset's (`stacking(type)`); the engine applies it,
  drops modifiers whose predicate fails, and returns the total with a breakdown (each modifier kept or
  dropped, and why), so Claude and the board can explain every number.
- Rule elements: data on items, effects and conditions; the ruleset registers the keys it supports
  (`Modifier`, `Resistance`, `Weakness`, `Immunity`, `BaseSpeed`, `Sense`, `Note`... as needed). Unknown keys
  are reported, never silently ignored.
- `prepareActor(actor, state, content, ruleset)`: builds the effective creature in a fixed order (base data,
  items, effects and conditions, derived statistics). Never stored.
- `degreeOf(total, dc, die, rules)`: degrees of success with the ruleset's thresholds and natural 20 and 1
  shifts.
- `applyDamage(prepared, state, damage)` and `applyHealing(...)`: through the ruleset's rules (PF2E:
  immunities, weaknesses, resistances, temporary HP first, 0 HP: dying and wounded); return the new state and
  a description of what happened, never write anything themselves.

**PF2E ruleset (`rulesets/pf2e/`)**
- The actor schema: character (ancestry, heritage, background, class, level, attributes, proficiency ranks,
  items: armour, shield, weapons, worn items, feats as items with rules) and NPC (level, traits, size, flat
  statistics as printed: AC, saves, Perception, skills, HP, speeds, strikes, IWR, abilities).
- Statistics: AC, Fortitude, Reflex, Will, Perception, the 16 skills and Lore, class DC, spell attack and DC,
  strikes (attack and damage), speeds, max HP, Bulk later.
- Bonus types: circumstance, item, status (highest of each; penalties: worst of each), untyped (all stack).
- Condition rules for every condition in `conditions.js` that changes a number (clumsy, enfeebled, drained,
  frightened, sickened, stupefied, off-guard, prone, blinded, dazzled, fatigued, slowed and quickened,
  clumsy's Dex checks, drained's max HP...).
- Damage: IWR, persistent damage noted, dying and wounded, recovery checks (degrees of success), healing
  limits.
- Health bands in PF2E's own words, chosen in review.
- What players may see: their own PCs whole; foes the health band only.

**Records and data files**
- `actors/<id>`, `actorstate/<id>`, `content/<kind>.<slug>` on the board; in a save `actors/` and `actorstate/`
  beside `maps/`; content in packs (`content/<kind>/<slug>.json`), the sample pack holding the originals.
- Conditions stay on the token's effects (the badges the board already edits); the rules read them there.
  Whether they move into the live state is a step 2 decision.
- Schemas for each, and the validator checking them (and that every rule-element key is known).

**Claude's tools**
- `tools/actor.mjs`: show a creature's effective numbers with breakdowns; damage, heal, temporary HP;
  conditions (through the existing badges); resources; by name or id.
- `tools/check.mjs`: a check against a DC with degrees of success (the dice service comes in step 3; until
  then a roll is given).

**Not in step 1:** the board's sheets and windows (step 2), dice (3), actions (4), replay (5), inventory and
spells beyond what statistics need. The Foundry importer is in step 1, designed with the data format (section
5; the user's choice, 2026-11-12).

**Tests:** every statistic for each sample PC worked by hand from the rules and compared; every condition's
effect; stacking; damage and healing cases (resistance, weakness, temporary HP, dying, wounded, massive
damage); degrees of success including natural 20 and 1; the validator on good and bad data.

## 5. The content format and the Foundry importer (spec, for review)

**What Foundry PF2E's data looks like** (read from its repository, 2026-11-12; a few files fetched to a
scratch folder, nothing kept):
- One JSON file per document, in packs by book or kind (`packs/pf2e/pathfinder-monster-core/giant-rat.json`,
  `conditions/clumsy.json`, `equipment/longsword.json`, `classes/fighter.json`, `iconics/valeros/...`).
- Every document records its licence and book (`publication: {license: "ORC", remaster: true, title:
  "Pathfinder Monster Core"}`), so the importer can keep both.
- **Creatures (NPCs)** hold printed numbers: AC, HP, Perception with senses, saves, skills (with special cases
  such as "+4 to Climb or Swim"), attribute modifiers, speeds, traits, size, level; strikes, abilities and
  spells are embedded items (a strike: attack bonus, traits, damage dice and type, attack effects).
- **Items:** armour (AC bonus, Dex cap, check and speed penalties, Strength, group, runes), weapons (damage
  die, type, group, category, traits, runes), shields (AC bonus, Hardness, HP), equipment, consumables.
- **Conditions** are items with rule elements: clumsy is a status penalty of its value to Dexterity-based
  statistics; frightened to everything; off-guard is -2 circumstance to AC; drained lowers Constitution-based
  statistics and max HP by level times its value. Values are small expressions (`-@item.badge.value`,
  `min(-1 * @actor.level,-1) * @item.badge.value`).
- **PCs** are built from items: ancestry, heritage, background, class (base proficiencies, HP per level,
  feature levels), feats with rule elements (some needing choices, some granting other items), attribute
  boosts by level, skill ranks. Their saves and Perception come from the class and its features at each level:
  computing them means implementing PF2E's character-building rules (a builder's job).

**Our format** (our own, system-swappable; the ruleset defines each kind's fields with a JSON schema):
```
{ "kind": "creature", "slug": "giant-rat", "name": "Giant Rat", "system": "pf2e", "level": -1,
  "source": { "title": "Pathfinder Monster Core", "license": "ORC", "from": "foundry-pf2e" },
  "traits": ["animal"], "rarity": "common", "size": "small",
  "stats": { "ac": 15, "hp": 8, "perception": 5, "saves": { "fortitude": 6, "reflex": 7, "will": 3 },
             "attributes": { "str": 1, "dex": 3, ... }, "skills": { "acrobatics": 5, "athletics": 2 },
             "speeds": { "land": 30, "climb": 10 }, "senses": [...], "iwr": {...} },
  "items": [ { "kind": "strike", "name": "Jaws", "attack": 7, "traits": ["agile", "finesse", "unarmed"],
               "damage": [{ "dice": "1d6+1", "type": "piercing" }], "effects": ["filth-fever"] }, ... ],
  "rules": [ ... ], "text": "..." }
```
- **Rule elements**, ours: `{key, selector, type, value, slug, when}`. Keys in step 1: `modifier`,
  `resistance`, `weakness`, `immunity`, `speed`, `sense`, `note`. Values are a small safe expression language
  (numbers, `@value` for a condition's or effect's value, `@level`, `+ - * /`, `min`, `max`, `floor`,
  parentheses; parsed, never evaluated as code). `when` is a predicate (a list of tags that must hold, with
  `or` and `not`), the tags named by the ruleset.
- **Selectors** are the ruleset's vocabulary (`ac`, `fortitude`, `saving-throw`, `perception`, skill names,
  `dex-based`, `attack-roll`, `damage`, `hp`, `speed`, `all`...).

**The importer** (`tools/import/foundry-pf2e.mjs`; superseded in part by section 7: open content now comes from a whole release with `--release`, and every kind is converted):
- Reads Foundry PF2E JSON (a pack folder or single files, from a copy of their repository or an export) and
  writes our format: `--public <source>` into the open content (`content/pf2e/<source>/`, ORC and OGL only),
  `--out` into a private pack (`packs/<pack>/content/...`) for anything else; it keeps each document's
  licence and book. A pack lists the open sources it uses in `pack.json` (`content`).
- Converts creatures, hazards (later), items (armour, weapons, shields, equipment, consumables), conditions
  and effects, and feats (as reference, with the rule elements we support).
- **Rule elements:** `FlatModifier` becomes `modifier`; `Resistance`, `Weakness`, `Immunity`, `BaseSpeed`,
  `Sense`, `Note` map directly; value expressions are translated (`@item.badge.value` to `@value`,
  `@actor.level` to `@level`). `GrantItem` is resolved at import (the granted item is embedded). Anything
  else (`ChoiceSet`, `RollOption`, `ActiveEffectLike`, `AdjustModifier`...) is kept untouched under
  `foundry` on the rule and listed in an import report, so Claude knows what needs a hand.
- Text: Foundry's markup (`@UUID[...]{Sickened 1}`, `@Check[fortitude|dc:14]`, `[[/gmr 1d4 #hours]]`) becomes
  plain text with our own small links (a condition, a check with its DC), so the board can show it.
- **PCs from Foundry are not imported in step 1:** they need the character-building rules (a builder, step
  6). Claude builds PCs in our format directly; a later importer for Pathbuilder 2e exports (which record final
  attributes and ranks) is the easier path when it is wanted.
- **Report:** what was converted, what was flagged and why, per document.

**Tests:** importer runs on a few Foundry-shaped fixtures written for the tests (original names and numbers,
the same shapes), never on Foundry's real data in the repository.

## 6. Step 1 as built (2026-11-12)

- **Engine** (`engine/rules/`): `expr.js` (the expression language), `rules.js` (predicates, `makeStatistic`
  with breakdowns and stacking, `collectRules`, `modifiersFor`, `degreeOf`, `mergeData`, `prepareActor`,
  `describeStatistic`). Imported rules we do not support are skipped and listed, never run.
- **PF2E** (`rulesets/pf2e/`): `rules.js` (bonus types, ranks, skills, selectors, every condition's rules and
  what it brings with it, health bands, damage groups), `actor.js` (`preparePf2e`: characters from builds,
  creatures from stat blocks), `damage.js` (damage, healing, temporary HP, recovery checks), `schemas/` (the
  actor and content formats). In the system configuration as `actors`.
- **Records and saves:** `actors/`, `actorstate/`, `content/` load and save with the campaign
  (`tools/campaign.mjs`), round trip checked; the validator checks them.
- **Tools:** `tools/actor.mjs`, `tools/check.mjs`, `tools/import/foundry-pf2e.mjs`.
- **Sample data:** original builds for Kerra (human fighter 3), Pip (goblin wizard 3), Lyra (elf ranger 3);
  original stat blocks for the test creatures; standard items from the open rules.
- **Checked on real data** (scratch folder only): Foundry's Abomination Vaults book 1 bestiary imported with
  no schema errors, and every creature prepared without problems.
- **Health bands (PF2E, approved by the user 2026-11-12):** Unharmed, Scratched, Wounded, Badly wounded,
  Near death, Down, Dead.

## 7. Full Foundry import: change tracking and as-needed loading (decided and built 2026-11-12)

The user wants all of Foundry's open PF2E data imported in one go, and every later import to show what is new and what changed, because Foundry keeps adding data and sometimes fixes data bugs.

### 7.1 Decisions (the user, 2026-11-12)

| Question | Decision |
|---|---|
| Snapshot | Import only from Foundry's **tagged releases**. The manifest records the release version and commit. |
| Corrections to Foundry's data bugs | **Patch files**: `content/pf2e/overrides/<source>/<kind>/<slug>.json`, listing only the corrected fields, applied after every import. |
| Documents gone from Foundry | **Keep, mark retired**: the file stays (saves that use it still load), it is flagged `retired` and the report lists it. Renames are matched by Foundry id. |
| Report | **Markdown + JSON**: a readable summary committed with each import, a full JSON list for tools, and a summary in chat. |
| Kinds | **Everything**: creatures and hazards, equipment, spells, character options (feats, ancestries, heritages, backgrounds, classes, class features, deities). Converters for hazards, spells and character options still need building. |
| Storage | **One file per document**: `content/pf2e/<source>/<kind>/<slug>.json`, so each re-import's diff stays small. |
| Unsupported Foundry rules | **Import, list in the report** (counted by rule type, so we know what to build next); the GM view shows them on the sheet. |
| Tidying the board | **At save**: content stays on the board during play; saving removes records no actor references. |

### 7.2 Proposed design

- **Manifest** `content/pf2e/import-manifest.json`: the Foundry release and commit; for every document its Foundry id, our slug, source and kind, a hash of Foundry's original, a hash of our converted file, and `retired` if Foundry dropped it.
- **Each import sorts every document** into new, changed by Foundry (original's hash differs), changed by us (same original, converter output differs), removed or renamed (by Foundry id), and unchanged. Unchanged files are not rewritten.
- **Dry run first**: the report is produced before anything is written; I show the summary and wait for the go-ahead.
- **Overrides**: when Foundry changes a document we have an override for, the report flags it so we can check whether Foundry fixed the same bug and drop our patch. An override whose field paths no longer exist is an error.
- **Report files**: `content/pf2e/import-report.md` (counts by source and kind; lists of new, changed, retired; overrides to review; unsupported rules by type; documents skipped for licence) and `import-report.json`.
- **Licence**: only ORC or OGL documents are written; everything else is counted in the report. No art or icons.
- **As-needed loading**: `campaign.mjs` copies onto the board only the content referenced by the campaign's actors (each `base` and item `ref`, following references inside content); tools that add a creature or give an item write its content record at the same time; saving drops content no actor references. The validator checks every reference resolves.
- **Size**: about 30,000 documents, roughly 100 to 150 MB. One file per document, plain JSON.

### 7.3 Build order (proposed)

1. As-needed loading and the content-reference checks.
2. Manifest, change sorting, dry run, report, overrides, retired documents.
3. Converters for hazards, spells and character options (each with its own schema and tests, against real Foundry samples).
4. The full import from the latest tagged release, reviewed through the report before committing.

### 7.4 As built (2026-11-12)

All four steps built and run. Foundry stopped tagging releases in git after 7.8.0, so "a tagged release" is the
release's "Release notes X.Y.Z" commit; the first import is **8.7.0** (commit `52dfeee`, 2026-11-04).

- **The import:** 30,417 Foundry documents read; **29,967 imported** into 93 source folders (154 MB), 450
  skipped: 160 pregenerated characters and 5 familiars (need the character converter), 22 Kingmaker armies,
  81 macros, 113 journals and 69 tables (no licence recorded; not game data). Every imported document is
  licensed ORC or OGL; every one passes the schema; all 6,606 creatures prepare through the rules.
- **Converters** (`tools/import/foundry/convert.mjs`): creatures (now with spellcasting entries listing their
  spells as links, and their gear), hazards, vehicles, every physical item kind (armour, shields, weapons,
  equipment, consumables with their spells, ammunition, treasure, containers, kits with their contents), feats
  and class features, actions, effects, conditions (reference text: the ruleset's own rules are what runs),
  spells (rank, traditions, actions, range, area, defence, damage, heightening, variants), ancestries,
  heritages, backgrounds, classes, deities, Kingmaker features.
- **Links** between documents become content keys naming their source (`spells:spell/fireball`): by Foundry
  id, then by name, following Foundry's redirects. 409 links point to documents Foundry no longer has (legacy
  spells replaced in the remaster); they keep the name and text.
- **Tracking** (`tools/import/foundry/track.mjs`): `content/pf2e/import-manifest.json` (5 MB) holds each
  document's Foundry id, key and two fingerprints (Foundry's original, our converted file). A re-import sorts
  every document into new, changed by Foundry, changed on our side (converter, correction, or a linked
  document gone), renamed (new key; the old file kept, retired, pointing to it), retired (gone from Foundry,
  kept) and unchanged (not rewritten). A retired document that comes back is new again.
- **Overrides:** `content/pf2e/overrides/<source>/<folder>/<slug>.json` with `set` and `remove` by field path;
  the report asks for review when Foundry changes a corrected document; a missing place is an error. None yet:
  the validator flags three creatures with impossible Strength (Marala +30, Glittercrag Strix +25, Okoa +19)
  to check against the books.
- **Rules not supported yet:** about 24,000 rule elements kept as `unsupported`; the most common are
  RollOption, ActiveEffectLike, ItemAlteration, DamageDice, GrantItem, Aura and ChoiceSet. The report's table is
  the list of what to build next. Rules whose condition compares numbers are kept too.
- **As-needed loading** (`tools/library.mjs`): content keys `<folder>/<slug>` (the pack's own content, then
  the sources `pack.json` lists, in order) or `<source>:<folder>/<slug>`; loading copies only what the
  creatures use; `actor.mjs create`/`give` add documents with the creature; `campaign.mjs tidy` gives the
  deletes after a save. The validator and the tools read the library lazily.
  Optional documents (2026-11-12): a system may name documents a creature's sheet shows without its rules needing
  them (`system.content.actorContent`; PF2E: each feat's and feature's description, `rulesets/pf2e/content.js`
  `featKeys`: its `ref`, else `feat/<slug>`, then `class-features:`, `feats:`, `ancestry-features:`). Loading
  copies the first one found of each; none found is not an error; tidy keeps any of the candidates.
- **Validator:** `--content` checks each document against its own kind's schema, counts unsupported rules and
  unknown selectors instead of listing 24,000 warnings, and warns about impossible attribute values.

### 7.5 Formulas and effects on tokens (built 2026-11-12)

- **Formulas:** the expression language has `ternary` and the comparisons; `@itemLevel` is the level of what
  grants a rule (Foundry's `@item.level`, a spell's rank). Only the branch taken is evaluated.
- **Conditions comparing numbers:** `testPredicate` takes facts: `self:level`, `hp-percent`, `hp-remaining`,
  `self:condition:<id>`. A creature whose rules compare its HP is prepared a second time with its HP known.
- **Every rule key takes `when`**: conditional resistances, weaknesses, immunities, speeds and senses.
  Creatures also gain speeds their rules grant.
- **Effects from the content on tokens:** an effect badge may carry `ref` (an effect document) and `level`;
  its rules apply at that level. `tools/effect.mjs apply` sets it; such effects count as content in use.
- **Re-import of 8.7.0:** 851 documents changed on our side; rules kept as unsupported went from 24,012 to
  22,895 (1,117 now run). The real Heroism at rank 6 gives Kerra +2 status to attacks, saves, skills and
  Perception, with its breakdown.
- **Still kept** (the next candidates): values from a weapon's damage dice, rune potency, sheet choices, the
  creature's land Speed, and facts about the target (distance, size).


## 8. Time, encounters, turn rules and PF2E's rule keys (decided and built 2026-11-12)

### 8.1 Decisions (the user, 2026-11-12)

| Question | Decision |
|---|---|
| Where conditions live | **On the token**, as badges (researched first: in Foundry PF2E a condition is an item on the creature, and an unlinked token has its own copy of the creature, so in practice conditions are per token). |
| Durations | **On effects only, Foundry's way.** A timed condition comes from an effect that grants it and goes with it; plain conditions stay until removed. |
| Initiative | **Build the underlying concept now** (encounters, order, rounds, turns, events); the board's tracker UI later. |
| Frightened and the like | **Decrease automatically** at the end of the creature's turn (Foundry leaves it manual); a ruling can hold one (`noDecrease`). |
| Effects running out | **Removed, and logged**, with the conditions they granted. |
| Game clock | **One clock**, with Golarion's calendar (Absalom Reckoning) and the day of the adventure ("Day 1"). |
| Rule types now | **Rules-only, turns and positions**; the character builder's (ActiveEffectLike, GrantItem of features, ChoiceSet, ItemAlteration) wait for the builder. |
| Switches (roll options) | **Claude flips them by chat** until sheets exist. |

### 8.2 Research: how Foundry PF2E does it (8.7.0 source)

- Conditions are items on the actor (`ConditionPF2e`); the token HUD toggles them; the same condition from two
  sources: the highest value is active. Conditions have no duration. Only persistent damage does anything at
  the end of a turn (rolled; the recovery check is a button). Frightened's decrease is not automated.
- Effects (`EffectPF2e`) have `duration {value, unit (rounds, minutes, hours, days, encounter, unlimited),
  expiry (turn-start, turn-end, round-end)}` and `start {value (world time), initiative}`; an effect runs out
  when world time passes start + duration, and on the last moment at the start or end of the turn of whoever's
  initiative it began on, or at the end of the round (`calculateRemainingDuration`). Expired effects are removed
  or kept per a world setting. Effects can grant conditions (`GrantItem`), which go with them.
- Encounters: combatants with initiative; a round is 6 seconds of world time; ties go to foes before PCs
  (tiebreak priority). `onStartTurn` runs rule hooks (fast healing, temporary HP) and recharges round abilities;
  `onEndTurn` runs persistent damage and turn-end effect events.

### 8.3 As built

- **Calendar and clock** (`engine/time/calendar.js`, `rulesets/pf2e/calendar.js`): months, weekdays, leap day at
  the end of Calistril every four years (4724 AR was one), weekdays matching ours 2,700 years on (1 Abadius 4724
  AR was a Moonday: Pathfinder Wiki gives no anchor, this is Paizo's convention). The clock is seconds since
  year 1; `state/clock {now, start}` on the board, `clock` in `campaign.json`. `tools/clock.mjs`: show, set,
  start (Day 1), advance, until.
- **Durations** (`engine/time/clock.js`): Foundry's counting, event-driven: an effect's `start {time, turnOf,
  round}` names the creature whose turn it began on, and `effectExpired` answers each event. Outside an
  encounter, an effect runs out once its time has passed.
- **Encounters** (`engine/time/encounter.js`): add, initiative, sort (the ruleset's tiebreak), begin, next,
  delay (turn-end rules happen now), resume (acts before whoever was next), remove, end; events turn-start,
  turn-end, round-start, round-end, encounter-end; the clock moves one round per round. `state/encounter` on
  the board, `encounter` in `campaign.json`; the validator checks its combatants. `tools/encounter.mjs` drives
  it from chat.
- **Turn rules** (`rulesets/pf2e/turns.js`): end of turn: persistent damage (rolled) and a DC 15 flat check per
  damage type, frightened down by 1; start of turn: a dying creature's recovery check, fast healing and
  regeneration, temporary HP that renews; at every boundary and as time passes, expired effects are removed
  with the conditions they granted (unless another effect still grants them). Rolls use `engine/rules/dice.js`
  (random, or seeded with `--seed`).
- **Effects with durations** (`tools/effect.mjs`): `--duration`, `--expiry`, a start from the clock and the
  encounter; `apply` takes the document's duration, adds the conditions it grants (`grants`) and its light.
- **PF2E rule keys** (`rulesets/pf2e/rule-keys.js`), converted from Foundry: roll options (always-on, and
  switches flipped by `actor.mjs option`), traits, size, damage dice (and critical-only dice), Strike traits,
  granted Strikes, multiple attack penalty, critical specialization, degree of success, rolling twice, one-roll
  effects on a target (`check.mjs`), temporary HP, fast healing and regeneration, auras (worked out from token
  positions; effects on the creatures inside by side, saves listed; an aura with no effects reports who is
  inside), light (on the token when it is given game data or the effect is applied), conditions granted by
  effects. Our tags include Foundry's names (`self:trait:`, `self:condition:`, `self:effect:`, `item:trait:`,
  `item:slug:`), so the imported conditions on rules mean what they say.
- **Re-import of 8.7.0:** rules kept as unsupported went from 22,895 to **12,654** (10,241 more run); every
  creature still prepares. The rest: ActiveEffectLike 3,009, ItemAlteration 2,693, ChoiceSet 1,418, GrantItem
  (of features) 1,405, RollOption with choices 833, AdjustModifier 542, and formula values we do not have yet.

### 8.4 Trait descriptions (built 2026-11-12)

The user's decisions: import Foundry's 568 trait descriptions (its language file, `PF2E.TraitDescription*`);
show them on hover for every trait on Token Quick-View; for a Strike's traits, also say what the board applies.
They are a source of their own, `traits` (kind `trait`, tracked by the manifest like the rest), licence
`ORC/OGL` (the file gives no per-entry licence; Paizo's rules text is under one or the other). They are Pathfinder's
only (the user, 2026-11-12: game-specific data stays with its system). The board is built with every system's
glossary keyed by ruleset id (`tools/campaign.mjs glossaries`, bundled as `GLOSSARIES`) and uses the campaign's own
system's; every campaign also carries its system's as one record, `content/glossary.traits` (`traitGlossary`,
with `system`), used only when that matches. How traits are written and what a Strike's trait does on the board
are in `rulesets/pf2e/traits.js`.

### 8.5 Feats and features on hover (built 2026-11-12)

The user asked for a character's feats and features to show their descriptions on Token Quick-View, as traits do
("Arcane Bond", "Arcane School" on Pip). Each shows once, with its kind, level and traits, then the description
from the open content. A character names its features by slug and its feats by name, so the system says where
to look (`rulesets/pf2e/content.js`: `featKeys`, the feat's own `ref` first, then `feat/<slug>` in the pack, then
Foundry's class features, feats and ancestry features). These are optional content (`actorContent`, section 7):
loading copies the first one found, tidy keeps them, and the board fetches the first key it holds.


## 9. The character builder (designed 2026-11-14)

A first pass at making PF2E characters, and next at levelling them up, with the same framework. There is no editor
on the board: **Claude walks the player through it in chat, step by step**, and a tool does the rules.

### 9.1 Decisions (the user, 2026-11-14)

- **No full UI editor for now.** Claude presents each step's options and the player chooses: the questionnaire form
  for small choices; for long lists (357 heritages, 547 backgrounds) Claude first asks what the player is after,
  then offers a few fitting options, and the player may always name another.
- **Levelling up comes next**, with the same steps and the same questionnaire form.
- **Remaster supersedes an equivalent legacy option.** Foundry's current data has already dropped the legacy Core
  Rulebook material, and no legacy ancestry, heritage or background shares a remastered one's name. The builder
  hides a legacy option when a remastered option has the same name; a list in the ruleset
  (`rulesets/pf2e/build.js`, `SUPERSEDED`) names any renamed pair found later. Legacy options with no remastered
  equivalent (Kitsune, Poppet, the Mwangi ancestries) are offered.
- **Uncommon and rare options are offered with the GM's approval**: common options freely; an uncommon or rare one
  is shown as such and taken only once the GM (the user) says yes, recorded in the build with who approved it.
- **No variant rules in the first pass.** Each variant is flagged for later: future/backlog.md FR-17 to FR-24 (Free
  Archetype, Ancestry Paragon, Gradual Attribute Boosts, Automatic Bonus Progression, Dual Class, Proficiency
  Without Level, alternate ancestry boosts and voluntary flaws, Level 0 and Stamina).
- **Every class, spellcasters included**: spells are chosen at creation and when levelling.

### 9.2 What is there, and what is missing

- **There:** all of Foundry's build content, imported (section 7): 54 ancestries, 357 heritages, 547 backgrounds, 29
  classes, every class feature, ancestry feature and feat, and every spell. A class document holds its HP, key
  attribute, starting proficiencies, feat levels, skill increase levels and its features by level.
- **Missing:** the rules inside them that a build runs on, kept by the importer as `unsupported`:
  - `ChoiceSet` (1,418): "choose one": from a list (178 in build content), from a filter over the content (96: a
    research field, an instinct), or a configured set (skills).
  - `GrantItem` (1,405): "you gain this": a fixed feature (490) or the one a choice picked (137:
    `{item|flags.system.rulesSelections.<flag>}`).
  - `ActiveEffectLike` (3,009): most proficiency changes (`system.skills.<skill>.rank` upgrade,
    `system.proficiencies.attacks.<group>.rank`), and class-specific flags.
- **Spell slots and casting style are not in Foundry's data** (its players set up spellcasting by hand). Each caster
  class's tradition, prepared or spontaneous, slots per level and cantrips, repertoire or spellbook sizes go in the
  ruleset (`rulesets/pf2e/build.js`): game rules, committed like the rest of the ruleset.
- **Today's PCs are results, not builds** (`examples/.../actors/`: attributes and proficiency ranks as numbers). They
  cannot be levelled. Built PCs keep both: the build record, and the actor derived from it.

### 9.3 Design (for review)

1. **A build record per PC: the choices, not the results** (`actors/<id>` `build`):
   `{ancestry, heritage, background, class, levels: {1: {boosts, skills, feats: {ancestry, class, ...}, selections:
   {<flag>: value}, spells}, 2: {...}}, approvals: [{what, by, at}]}`, every option by its content key. The sheet's
   numbers (attributes, proficiencies, HP, features, feats, spells) are worked out from it by the engine
   (`deriveCharacter`), so a level-up adds that level's choices and a mistake is put right at the level it was made.
2. **The rules a build needs, run by the engine**: ChoiceSet (list, filter and configured sets), GrantItem (fixed
   and chosen), and ActiveEffectLike's proficiency upgrades and flags, enough for every class's features and the
   common ancestries, heritages and backgrounds. Anything a build meets that it cannot run is listed for the GM,
   never silently dropped.
3. **A builder tool Claude drives** (`tools/builder.mjs`): `next` (the step the character is on and what it must
   choose), `options` (only what the character qualifies for: level, prerequisites, the campaign's sources, rarity,
   remaster over legacy; with a one-line summary each), `choose` (checks the choice and records it), `preview`
   (the sheet as it stands), `finish` (writes the PC to the campaign). Claude never works out the rules itself.
4. **The steps of creation**, in the book's order: ancestry, heritage, background, class (with its subclass
   choices), attribute boosts (ancestry, background, class, four free; flaws), skills, ancestry and class feats (and
   the background's skill feat), spells for a caster, starting equipment (wealth and kit), name and details.
5. **Levelling** (next pass): `next` lists what the new level gives (HP, class features and their choices, feats by
   kind, a skill increase, boosts at 5, 10, 15 and 20, new spells and slots), and Claude walks through it the same
   way.
6. **On the board**: the finished PC is a token with its actor; Token Quick-View shows the sheet. Players see their
   own character's build; the GM sees all.

### 9.4 Build order (proposed)

1. **The build record and the derivation**: the record's schema, `deriveCharacter` for the parts with no rules to run
   (ancestry, heritage, background and class basics, boosts, skills, HP, the class's proficiency table), checked
   against the sample PCs rebuilt as builds.
2. **The build rules**: ChoiceSet, GrantItem and ActiveEffectLike's proficiency upgrades, so class features and
   subclasses work; a report of every class, ancestry and background feature they still cannot run.
3. **The builder tool**: `next`, `options`, `choose`, `preview`, `finish`; the campaign's sources and rarity; remaster
   over legacy; GM approval for uncommon and rare.
4. **Spellcasters**: each caster class's casting in the ruleset; spells chosen at creation.
5. **Equipment** at creation (starting wealth, class kits) and **finishing**: the PC on the board.
6. **A full level-1 character with the user**, step by step, for each kind of class; then **levelling** (section 9.3,
   point 5).

### 9.5 Step 1 as built (2026-11-14): the build record and the derivation

- `rulesets/pf2e/build.js` `deriveCharacter(build, get)` returns `{actor, pending, problems}`. `actor` is in the
  character format the engine already runs (the build kept in it as `build`). `pending` lists what is still to
  choose, by level and step (`ancestry`, `heritage`, `boosts.free`, `keyAttribute`, `skills`, `feat.class`,
  `skillIncrease`...), each with a sentence for the player. `problems` lists wrong choices; a wrong choice is never
  silently taken.
- Worked out so far:
  - **Attributes:** fixed and chosen boosts from ancestry and background, the ancestry's flaw, the class's key
    attribute and four free boosts; two boosts from one source never to one attribute; the boosts at 5, 10, 15 and
    20, a boost at +4 or more being partial (two raise it by one).
  - **HP inputs:** the ancestry's and class's HP; the engine adds Constitution and level.
  - **Proficiencies:** the class's Perception, saves, class DC, armour and weapons at 1st level.
  - **Skills:** trained skills from class and background; the player's picks (the class's number plus Intelligence,
    one more for each skill two sources both train); lore; skill increases capped at expert before 7th level and
    master before 15th; skills an Intelligence increase adds.
  - **Feats and features:** one feat per slot by the class's feat levels, the background's feat, and class features
    up to the character's level.
- The schema (`rulesets/pf2e/schemas/actor.schema.json`) gains `build`, and feats gain `ref`, `level` and `slot`.
- **Tested** (`tests/pf2e-build.test.mjs`) against numbers worked out from the rules, not against the hand-made
  sample PCs (they were made as test data, not from the rules). A 1st-level human fighter runs in the engine with
  the right HP, saves and Perception.
- **Left for step 2:** everything in a rule (the fighter's Acrobatics-or-Athletics, a subclass, Versatile Human's
  general feat, the proficiency gains of later class features). **Left for step 3:** choices written only in a
  background's text, such as the Guard's "Legal Lore or Warfare Lore", which Foundry does not encode.
