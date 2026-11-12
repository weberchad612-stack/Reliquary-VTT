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
| Game content: stat blocks, items, spells, feats, ancestries... | the library: the open content `content/pf2e/<source>/<folder>/<slug>.json` (all of Foundry's open PF2E data) and a pack's own `content/<folder>/<slug>.json`; on the board only the documents its creatures use, `content/<folder>.<slug>` | the importer (open content), the sample pack (original), private packs, Claude |
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

- **Know a creature's numbers:** `node tools/actor.mjs <pack> <save> show "Kerra"`. Every number comes with
  how it is made up ("AC 18 = 10 base + 1 Dexterity (capped at 1) + 5 medium armour (trained) + 4 Chain Mail
  (item) − 2 Frightened 2 (status)"), so a ruling can be explained. `list` shows everyone's HP and health band.
- **Use the live numbers:** during play the board is the truth. Pass `--records FILE` with the board's
  `tokens/`, `actors/` and `actorstate/` records (from `db_list`) so conditions and HP are current.
- **Checks:** `node tools/check.mjs <pack> <save> --who "Lyra" --stat stealth --against "Sleepy-Eyed Guard"
  --defense perception --roll 4`; Strikes with `--strike Longsword --attack 2` (the multiple attack penalty)
  `--against <target>` (its AC). `--bonus` adds a situational modifier you rule (cover, Aid). Until the dice
  service exists (step 3), roll the d20 yourself and give it.
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
  @value`), parsed, never run as code; `when` is a predicate over tags (a condition's id, a trait, a situation
  Claude sets in the live state's `tags`). Selectors are the ruleset's (`rulesets/pf2e/rules.js`: `ac`,
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
