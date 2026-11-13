# Best practices: game data and rules

For Claude and for code working with creatures' game data: `engine/rules/` (system-free), `rulesets/pf2e/`
(`actor.js`, `damage.js`, `rules.js`, `schemas/`), the records `actors/`, `actorstate/` and `content/`, the content
library (`tools/library.mjs`, `rulesets/pf2e/content.js`, `content/pf2e/`), and the tools `actor.mjs`, `check.mjs`
and `import/foundry-pf2e.mjs`. Design: [game-data.md](../design/game-data.md).

## 1. Where things live

| What | Where | Who writes it |
|---|---|---|
| A creature's build or stat-block reference | `actors/<id>` on the board; `saves/<campaign>/actors/<id>.json` (same id as its token) | Claude |
| What is happening to it now: HP, temporary HP, resources, a raised shield | `actorstate/<id>`; `saves/<campaign>/actorstate/<id>.json` | Claude (later the board) |
| Its conditions | the token's `effects` (the badges), as before; the rules read them from there | Claude, the GM view, the player (own PCs) |
| Game content: stat blocks, items, spells, feats, ancestries... | the library: the open content `content/pf2e/<source>/<folder>/<slug>.json` (all of Foundry's open PF2E data) and a pack's own `content/<folder>/<slug>.json`; on the board only the documents its creatures use, `content/<folder>.<slug>`, plus its characters' feat and feature descriptions and the system's trait glossary (`content/glossary.traits`) | the importer (open content), the sample pack (original), private packs, Claude |
| Condition rules, bonus stacking, selectors, health bands | `rulesets/pf2e/rules.js` | code |

**Content keys** name one document: `<folder>/<slug>` (`creature/goblin-warrior`, `item/longsword`,
`spell/fireball`, `feat/toughness`), looked for in the pack's own `content/` first and then each open source its
`pack.json` lists, in order; or `<source>:<folder>/<slug>` (`pathfinder-monster-core:creature/goblin-warrior`)
for one source by name, listed or not. Physical items share `item/`; every other kind has a folder of its own
name (`rulesets/pf2e/content.js`). Links inside imported documents always name their source.

**The board holds only what is in use.** Loading a campaign copies onto the board just the content its
creatures reference (each `base` and each item `ref`); `actor.mjs create` and `give` write a document's record
when a creature starts using it; after a save, `node tools/campaign.mjs tidy <records-file>` gives the delete
ops for content nothing uses any more. The tools read the whole library from files, so they never need the
board to hold a document first.

**Nothing computed is stored.** AC, saves, max HP, Strike bonuses: always ask the rules (`prepareActor`), never
write a number into an actor that the rules can work out. The board and the tools call the same code.

## 2. During play (Claude)

The table rules (secrecy, narration, the ledger, tactics, rulings) are in the GM guides:
[docs/gm/running-a-game.md](../gm/running-a-game.md) and [rulesets/pf2e/gm.md](../../rulesets/pf2e/gm.md). This section is the tools.

- **The ledger** (the GM's memory: improvisations, secrets, rulings, threads, quests, timed events, session
  summaries): `node tools/ledger.mjs add <kind> "text" --subjects "..." --records FILE`, `find`, `story`
  ([board.md](board.md), the ledger). Write it the same turn; read it before answering about the past.


- **Know a creature's numbers:** `node tools/actor.mjs <pack> <save> show "Kerra"`. Every number comes with
  how it is made up ("AC 18 = 10 base + 1 Dexterity (capped at 1) + 5 medium armour (trained) + 4 Chain Mail
  (item) − 2 Frightened 2 (status)"), so a ruling can be explained. `list` shows everyone's HP and health band.
- **Use the live numbers:** during play the board is the truth. Pass `--records FILE` with the board's
  `tokens/`, `actors/` and `actorstate/` records (from `db_list`) so conditions and HP are current.
- **Checks:** `node tools/check.mjs <pack> <save> --who "Lyra" --stat stealth --against "Sleepy-Eyed Guard"
  --defense perception --roll 4`; Strikes with `--strike Longsword --attack 2` (the multiple attack penalty)
  `--against <target>` (its AC). `--bonus` adds a situational modifier you rule (cover, Aid). Until the dice
  service exists (step 3), roll the d20 yourself and give it.
- **Log the dice:** `check.mjs` prints `writes` with the d20s given (`--roll`); write them so the board's Dice tab counts them. Every other roll Claude makes goes through `tools/dice.mjs` (`roll 2d6+3 --who Kerra --kind damage`).
- **Damage and healing:** `actor.mjs damage <who> <amount> [type] [--crit] [--nonlethal]` (or `--parts "5
  fire, 3 slashing"`), `heal`, `temp`, `recover --roll N`, `resource <who> heroPoints -1`, `shield <who> raise`.
  Each prints `{lines, writes}`: write every record (`db_write`; read first for its version) and tell the story
  from the lines. The rules handle immunities, weaknesses and resistances, temporary HP first, massive damage,
  knocked out and dying (+1, or +2 from a critical hit, plus wounded), dying worse when hurt, healing waking the
  dying (wounded +1), and death at dying 4 less doomed.
- **What players may hear:** the tools name creatures as the players know them (an alias until the name is
  learned) and give foes' health as a band ("Badly wounded"). Never say a foe's HP, AC or DCs in chat.
- **Conditions are badges:** set them with `tools/effect.mjs` as before; the numbers change by themselves.
  Status penalties don't stack (clumsy 1 and frightened 2 is −2, not −3); a status and a circumstance penalty do.

## 2b. Time and encounters (Claude)

- **The GM can move the clock on the board too** (click the date in the GM view): read `state/clock` before you
  narrate time, and the log for what the GM changed.
- **Set the clock when a campaign starts:** `node tools/clock.mjs <pack> <save> set "1 Pharast 4725 AR, 08:00"`
  (the first set makes that day Day 1; `start` moves Day 1 to today). `show` gives "Starday, 1 Pharast 4725 AR,
  08:00 (Day 1)". Move it on as the story does: `advance "10 minutes"`, `advance "8 hours"`, `until 07:00`.
  Every effect with a duration counts against it; advancing removes the ones that ran out.
- **Run an encounter:** `encounter.mjs start "Kerra" "Lyra" "Sleepy-Eyed Guard"` (or `--all` on the current
  map), `roll <who>` (d20 + Perception, or `--stat stealth` for someone sneaking; `--roll D` uses a die you
  were given), `init <who> N` for a player's own roll, `begin`, then `next` after each turn. Write every record
  it prints and put its lines in the log; tell the story from them. `delay`, `resume <who>`, `remove <who>`,
  `end`, `previous` (a correction), `defeat <who>` and `hide <who>` (`--undo` for either). `roll` takes
  initiative's own modifiers and notes (Incredible Initiative, Battle Cry), `--mode higher|lower` for rolling
  twice, and also writes the roll card (a chat message, `chat/`) every board shows. Post narration, rulings and NPC lines with `tools/chat.mjs` (docs/best-practices/board.md, chat). While an encounter is under way, time
  moves only by rounds.
- **The board runs encounters too** (the encounter tracker, 2026-11-12): the GM and the players add creatures
  (Enter Combat), roll, and move turns on, writing the same `state/encounter`. Read it before acting
  (`--records`), and expect the players to have rolled their own initiative. The board does not yet note a
  creature starting its turn inside an aura: say it yourself (future/backlog.md FR-14).
- **What happens by itself at turn boundaries:** persistent damage and its flat check, frightened going down
  (a ruling can hold it: `noDecrease: true` on the badge), fast healing and regeneration, renewing temporary HP,
  a dying creature's recovery check, effects running out with the conditions they granted, and a note when a
  creature starts its turn inside an aura. Read the lines: regeneration names what stops it, and a save from an
  aura is yours to roll.
- **Timed effects:** `effect.mjs <token.json> apply spell-effects:effect/spell-effect-heroism --level 6
  --records <records.json>` takes the effect's own duration and starts it now, on the acting creature's turn;
  `custom "Feinted" --duration "1 round" --expiry turn-end --turn-of tok-...` for an effect of your own
  ("until the end of your next turn" counts from the creature whose turn it was). A condition with a time limit
  is an effect that grants it.
- **Switches:** when a player says "I rage" or "I'm flanking", `actor.mjs option <who> rage on`; `show` lists a
  creature's switches. Situations no rule names can still be set as tags for your own rulings.
- **Checks with the creature's own rules:** `check.mjs` applies degree of success changes, asks for two dice
  when the creature rolls twice (`--roll 12,7`), and makes a target off-guard (or similar) for a Strike when the
  attacker's rules say so.

## 2c. Replays: resolving a batch (Claude)

**Raise the banner first, for any adjudication**: `node tools/think.mjs start --what "..."` (write what it prints;
`--what` goes to the GM's audit log only) puts "Claude is thinking" on every screen; `ping` keeps it up, `stop` takes
it down. Use it for anything that is not a replay too: an exploration check, a social scene, a rest. A replay begun
while it is up carries on with it, and the replay's `end` takes it down.

When several actions resolve together (the foes' turns, a round of fighting, a trap going off, a search of an area), resolve them as a
**replay** (`tools/replay.mjs`, built 2026-11-12): the table watches them step by step on the board, and nothing
lands early.

1. **Read the board** (`db_list` of `tokens`, `actors`, `actorstate`, `state` and `replay`, into one `{path: data}`
   file) and **open a draft**: `node tools/replay.mjs begin --records board.json --title "The goblins' turn" --kind combat --map
   sample-keep`. The title names what is being resolved ("Round 2", "Searching the southern grounds"); `--kind`
   (combat, exploration, social) is its icon on the board. Write what it prints: `state/adjudicating` puts the **"Claude is thinking" banner** over every
   screen, and the audit log notes the start. Replays not yet revealed are applied to the working copy first.
2. **Resolve each action with the usual tools, against the working copy**: `--records $(node tools/replay.mjs
   records)`. Save each tool's JSON to a file; do **not** write its writes to the board.
3. **Make it a step**: `node tools/replay.mjs step --side npc --actor "Gap-Toothed Ogre" --text "The ogre clubs
   Kerra: a hit, 12 bludgeoning." --in check.json --in dice.json --in damage.json --in fx.json --move
   "Gap-Toothed Ogre:10,10"`. One action per step; a condition goes on the step that causes it. Chat messages,
   dice, audit lines and visual effects become the step's posts, written (with fresh times) when it is revealed;
   every other record becomes a change. An output without a path (effect.mjs's token) is `--in tokens/<id>=FILE`;
   `replay.mjs get tokens/<id> > t.json` gives effect.mjs its input. `--move TOKEN:X,Y[:VX,VY;VX,VY]` moves a token
   (the board slides it along its path). `--gm` keeps a step from players altogether (a hidden creature's).
   Each step prints a refreshed `state/adjudicating`: **write it**, or the banner says "Claude is still thinking" after
   5 minutes and goes after 30. Before a long think or long narration, `replay.mjs ping` and write that too.
   **Roll details**: give each action's outputs in order, the check (`check.mjs`), the damage roll (`dice.mjs roll
   1d8+4 --kind damage --type slashing [--crit] --pack P --save S --records W`, so the roller is known) and the
   damage applied (`actor.mjs damage ... --from dd.json`, which also writes the damage card); the step shows them as the
   table's roll details, and their check and damage cards reach the chat when the step is revealed. No chat events
   (the user, 2026-11-12): a condition, a death or a new round is told by the cards and the narration. `--crit` on the damage roll
   doubles it: give its `total` to `actor.mjs damage ... --crit`. A situational modifier is `check.mjs --bonus "1
   backswing"`, so its name shows.
4. **Narration is a step** (the user, 2026-11-12: narration is what engages the players): after the actions a beat
   of story tells, `replay.mjs narrate "..." --focus "Kerra,Scar-Browed Ogre"` adds a narration step right there. The
   table reveals it with its own Next; it posts the paragraph to the chat as narration, frames and rings the
   creatures it names, and Auto lingers on it for reading. Tell each beat close to its actions (a creature's turn,
   a find, a reply), and **end with a narration step** that ties together whatever the others did not tell. `--gm`
   for a note only the GM should read. Good narration is the point of the replay: give it the care the rolls get.
5. **Reactions:** stop the batch before a step where a PC could react: `replay.mjs stop "Can anyone react to the
   ogre's swing?"`, `end`, and ask. The next batch (a new `begin`) starts from the board plus this one.
6. **End**: `node tools/replay.mjs end` prints the `replay/<id>` record, the banner's delete and an audit line:
   write them. Then tell the user it is ready to watch (the Replay tab opens on every screen); don't narrate the
   results in this chat before the table has seen them. `replay.mjs show` lists the draft; `abort` drops it
   (nothing was applied). A draft left open (a turn that broke off) makes the next `begin` ask for `--resume` or
   `--discard`.

Lessons from the first live replay (2026-11-12, a round of the keep test):

- **Raise the banner before the first change of any adjudication**, initiative included: `begin` first, then
  roll. The first run rolled initiative straight to the board and the table saw no banner.
- **A critical hit's damage**: `dice.mjs roll ... --crit` doubles it (since 2026-11-12); `actor.mjs damage ... --crit`
  does not (its flag is for the dying rule).
- **Mind the weapon traits**: a greatclub's backswing gives +1 to the next Strike after a miss (`check.mjs
  --bonus "1 backswing"`); the tools do not track it.
- (Retired 2026-11-12: steps post check and damage cards, not chat events.) **One chat event per step read best first**: the step's own event before what the turn rules added ("is
  dead", "Round 2"), so the chat reads in story order.
- Put each turn's `encounter.mjs next` in that creature's last step, so the tracker moves on as the table watches.
- **Narrate as you go, right after each action** (2026-11-12): rolling two Treat Wounds checks first and narrating
  afterwards put the story of the first after the second, and the table saw it out of place. Resolve an action,
  make its step, narrate it, then the next. `narrate --after N` places a beat noticed late, and `replay.mjs show`
  before `end` lists each narration with the step it follows: check the order there.

What the board does with it: docs/best-practices/board.md (Replay).

## 3. Writing game data

- **A PC** is a build: ancestry (HP, size, Speed, senses), class (HP per level, key attribute), attribute
  modifiers, proficiency ranks (0 untrained to 4 legendary, as they stand at the PC's level), items (references
  into the content, `{"ref": "item/longsword", "runes": {"potency": 1}}`), feats with rule elements, resources
  with their maximum. Update the ranks and attributes at level-up until a builder can apply class progressions.
- **A creature** is `{system, kind: "npc", base: "creature/<slug>"}` plus anything of its own (a stronger
  one's HP, `usesDying: true` for a named NPC who should go down dying rather than dead). Its name is the
  token's. `node tools/actor.mjs <pack> <save> create <token> pathfinder-monster-core:creature/goblin-warrior`
  writes it (and the stat block's record if the board lacks it); `give <who> item/rope` adds an item.
- **Which stat block:** an adventure's own bestiary first (`abomination-vaults-bestiary:creature/...`), then
  Monster Core and Monster Core 2 (the remastered ones), then the older Bestiaries. Name the source in the key
  when two sources share a slug.
- **Rule elements** are `{key, selector, type, value, when}`; keys `modifier`, `resistance`, `weakness`,
  `immunity`, `speed`, `sense`, `note`; values are expressions (`-@value`, `@level`, `min(-1 * @level, -1) *
  @value`, `ternary(gte(@itemLevel, 6), 2, 1)`), parsed, never run as code. In a value, `@value` is the
  source's badge value, `@level` the creature's level and `@itemLevel` the level of what grants the rule (a
  feat's, an item's, or an effect's as cast: a spell's rank). Functions: `min max floor ceil abs round`, the
  comparisons `gt gte lt lte eq ne` (1 or 0) and `ternary(test, then, else)`. `when` is a predicate over tags (a
  condition's id, a trait, a situation Claude sets in the live state's `tags`) that may also compare numbers:
  `{"lt": ["hp-percent", 50]}`, with the facts `self:level`, `hp-percent`, `hp-remaining` and
  `self:condition:<id>` (its value); a fact the rules don't know never holds. Every key takes `when` (a
  resistance only while raging).
- **Effects from the content on a token** (`{name, ref, level}`, set by `tools/effect.mjs apply`): the effect
  document's rules apply at that level. A token's effects are part of what the campaign uses, so loading keeps
  the document on the board and tidying leaves it while the badge is there. Selectors are the ruleset's (`rulesets/pf2e/rules.js`: `ac`,
  `saving-throw`, `dex-based`, `attack-roll`, `<strike>-damage`...).
- **Check with the validator** (`tools/validate.mjs <pack> --save <save>`): schemas, references into the
  content, unknown rule keys and bad expressions are errors; imported rules not supported yet are warnings.
- **Test by hand-working the numbers** from the rules, as `tests/pf2e-actors.test.mjs` does for the sample
  party; a rule change that moves a number must say why.

## 4. Importing content (Foundry PF2E)

- **Open content (the user's decision, 2026-11-12):** all of Foundry PF2E's open data is in this repository,
  `content/pf2e/<source>/<folder>/<slug>.json`, one folder per Foundry pack, flavour descriptions and adventure
  bestiaries included. Only documents licensed **ORC or OGL** are written. The notices are in `NOTICE.md` and
  `licenses/` (ORC attribution, OGL Section 15, Paizo's Community Use Policy): keep them, and keep the project
  free. Check with `node tools/validate.mjs --content content/pf2e`.
- **A new Foundry release, step by step:**
  1. Find the release's commit. Foundry PF2E stopped tagging releases in git after 7.8.0: each release is the
     commit "Release notes X.Y.Z" on the main branch (`git log --grep "Release notes"`); `system.pf2e.json`
     there holds the version.
  2. Check it out sparsely (`/packs/pf2e/`, `/system.pf2e.json`, `/build/uuid-redirects/`; about 360 MB).
  3. `node tools/import/foundry-pf2e.mjs --release <checkout> --dry-run`, then read
     `content/pf2e/import-report.md`: new, changed by Foundry, changed on our side, renamed, retired,
     corrections to review, rules we cannot run yet, links pointing outside the import, what was skipped.
  4. Show the user the summary; import without `--dry-run`; validate; `git diff --stat content/pf2e` shows each
     changed document field by field. Commit the content, the manifest and the report together.
- **Never edit an imported document by hand.** A Foundry data error is corrected with an override,
  `content/pf2e/overrides/<source>/<folder>/<slug>.json`: `{"why": "...", "foundry": "<the document's
  original hash from import-manifest.json>", "set": {"stats.ac": 14}, "remove": ["path"]}`. It is applied
  after every import; when Foundry changes that document the report asks us to check whether they fixed it (and
  the override can go); an override whose place no longer exists is an error. Our own improvements go into the
  converter, then re-import.
- **Retired documents stay**: a document Foundry removed keeps its file, marked `retired: {since}`; a renamed
  one points to its new key (`replacedBy`). Saves that use them still load; the validator warns.
- **Rules we cannot run yet** stay in the documents as `{key: "unsupported", foundry: {...}}` (with any rule
  whose condition compares numbers); the report counts them by type, which is the list of what to build next.
  The creature works without them (`show` lists them, for Claude to apply by hand).
- **A pack uses open content** by listing sources in `pack.json` (`"content": ["pf2e/abomination-vaults-bestiary",
  "pf2e/pathfinder-monster-core"]`); its own `content/` folder comes first (a creature adjusted for this
  adventure).
- **Anything not open** goes into a private pack: `node tools/import/foundry-pf2e.mjs <files> --out
  packs/<pack-id>`, which refuses any folder in the repository except `packs/`.
- **Never commit text, maps or art from books** (adventure text, keyed rooms): those stay private, whatever
  Foundry's data holds. Never import into the sample pack: it holds only original data.

## 5. Lessons (2026-11-12, step 1)

- **Use the published rule data to check our rules.** Foundry PF2E's condition files gave the exact effects
  (unconscious also makes the creature prone; deafened's penalty applies only to sound and initiative); our
  first notes from memory had gaps.
- **Status penalties not stacking is the rule most easily got wrong by hand**; the breakdown shows which
  penalty counted and why the other did not.
- **Messages for the table must use public names**: a damage line about a named NPC said her real name until
  the tools were changed to use the alias.
- **Foundry keeps a creature's book under `details.publication`**, an item's under `publication`: the
  importer's first run recorded every creature as OGL with no book.
- **The private-pack guard must refuse the repository's root itself**, not only folders inside it.
- **Check what a licence covers before relying on it.** Foundry's data is open (ORC or OGL on every document),
  but Paizo's names and descriptions are Product Identity, used under the Community Use Policy: hence the
  notices, and the project staying free.

## 6. Lessons (2026-11-12, the full import)

- **Foundry stopped tagging releases** after 7.8.0; the newest tag was a year old. The release is the "Release
  notes" commit, and the version is in `system.pf2e.json`, not `static/system.json` (which still says 6.12.4).
- **The built system and the source repository name packs differently** (`packs/<name>` against
  `packs/pf2e/<name>`), and links use Foundry's compendium names (`spells-srd`, `equipment-srd`), not folders:
  read the mapping from `system.pf2e.json`.
- **Links by id, then by name**: an NPC's spell links to the spell by id; when Foundry has replaced the spell
  (about 400 legacy spells), the link is kept as the spell's name and text, and the report counts it.
- **Empty values hide in Foundry data** (a Strike with an empty damage roll, a creature with Strength +30):
  the schema catches the first, the validator warns about impossible numbers so an override can correct them.
- **Predicates that compare numbers** (`{"gte": ["self:level", 5]}`) crashed the rules on 109 creatures;
  rules carrying them are now kept as unsupported at import, and every one of the 6,606 creatures prepares.
- **A stat block's own entries can name content** (its gear, its spells); they are notes, not items it uses,
  so the rules do not resolve them.
- **30,000 small files are fine**: the import takes six seconds and the validator one; one file per document
  keeps every later import's diff readable.

## 7. Lessons (2026-11-12, formulas and effects)

- **Measure before promising.** The estimate of 1,700 rules was the ones whose key we support; 1,117 now run.
  The rest need values we do not have yet: a weapon's damage dice, rune potency, choices made on a sheet
  ("@item.flags.system.rulesSelections"), "a climb Speed equal to your land Speed", or facts about the target.
- **One statistic can depend on HP** ("+2 AC while below half HP"), and HP is itself a statistic: the creature
  is prepared once, and again with its HP known only when a rule asks.
- **Only the branch taken is worked out** in `ternary`, so a formula guarded against an edge case does not fail
  on it.
- **Re-importing the same release is the test of the tracking**: 851 documents "changed on our side", 29,116
  untouched, none rewritten needlessly.

## 8. Lessons (2026-11-12, time, encounters and rule keys)

- **Read the source before deciding.** Foundry keeps conditions on the creature, but its unlinked tokens each
  have their own creature, so "conditions on the token" is what it does in practice; and it gives durations
  only to effects. Both shaped our design; its missing frightened decrease is one thing we do differently.
- **Name tags the way the imported data does.** Foundry's conditions test "self:condition:frightened" and
  "item:trait:agile": adding those names to our tags made thousands of imported conditions meaningful with no
  rewriting.
- **A rule value is not always a number.** Size was first stored as `value: "large"` and the validator, rightly,
  tried to read it as a formula; each key now has a field of its own.
- **An aura with no effects still matters**: frightful presence and its like have their rules in text. Saying
  who is inside is most of what Claude needs.
- **Event order is the log's order**: running the turn rules once per event (end of turn, new round, next turn)
  keeps the lines in the order things happened.

