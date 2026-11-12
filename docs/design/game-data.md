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
- **Replay:** batches of Claude-driven combat actions are played out step by step (a feature to build soon).

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
  rolls, and a player's thrown virtual die (animated, later). Every roll is a record (`rolls/<id>`: who, what,
  dice, result, who may see it), so the log and replay show the same thing.
- **Actions are ruleset data:** a check (attack roll against AC, save against a DC), degrees of success, and
  what each degree does (damage, conditions). The engine resolves; the ruleset supplies the rules.
- **Player actions** resolved by the board become **queue records** (`queue/<id>`: the action, rolls, proposed
  results) marked for Claude. Applying a result is a separate step: Claude confirms and narrates, or adjusts.
  The board shows that the queue is waiting.
- **How Claude learns of it:** the platform cannot message this chat, so the queue is read at the start of
  every turn during play (a standing rule), and the board's queue badge tells the user to send any message
  ("go") when they want it resolved. (A scheduled check is possible but slow and costly; not proposed.)
- **Replay** (soon) plays queue and NPC action records step by step, with the visual effects.

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
   changing the numbers.
3. The dice service and roll records; Claude's dice tool; the roll log.
4. Actions: Strike, saving throws, damage and healing for PCs on the board, resolved and queued for Claude.
5. Replay of queued and NPC actions with effects.
6. Items, inventory and loot; spells and resources; levelling; a character library; a builder; thrown 3-D dice.

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

**The importer** (`tools/import/foundry-pf2e.mjs`):
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
