# Best practices: game data and rules

For Claude and for code working with creatures' game data: `engine/rules/` (system-free), `rulesets/pf2e/`
(`actor.js`, `damage.js`, `rules.js`, `schemas/`), the records `actors/`, `actorstate/` and `content/`, and the
tools `actor.mjs`, `check.mjs` and `import/foundry-pf2e.mjs`. Design: [game-data.md](../design/game-data.md).

## 1. Where things live

| What | Where | Who writes it |
|---|---|---|
| A creature's build or stat-block reference | `actors/<id>` on the board; `saves/<campaign>/actors/<id>.json` (same id as its token) | Claude |
| What is happening to it now: HP, temporary HP, resources, a raised shield | `actorstate/<id>`; `saves/<campaign>/actorstate/<id>.json` | Claude (later the board) |
| Its conditions | the token's `effects` (the badges), as before; the rules read them from there | Claude, the GM view, the player (own PCs) |
| Stat blocks and items | the pack's `content/<creature|item>/<slug>.json`; on the board `content/<kind>.<slug>` | the sample pack (original), private packs (imported), Claude |
| Condition rules, bonus stacking, selectors, health bands | `rulesets/pf2e/rules.js` | code |

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
  token's.
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

- `node tools/import/foundry-pf2e.mjs <files or folders> --out packs/<pack-id>` converts creatures, items,
  effects and feats from Foundry PF2E's open data into a **private pack**: it refuses any folder in the
  repository except `packs/` (git-ignored). Each document keeps its licence and book.
- Read the report (`content/import-report.json`): rules we do not support yet are kept untouched under
  `foundry` and listed, and the creature works without them (`show` lists them as unsupported, for Claude to
  apply by hand). Spellcasting is kept as text until spells are built; hazards and characters are skipped.
- **One pack per adventure** (its creatures, hazards and maps, Foundry's adventure bestiaries are a good
  start, checked against the book), and shared rules content (items, generic creatures) in a pack of its own,
  so it is not copied into every adventure.
- Never commit imported content, and never import into the sample pack: it holds only original data.

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
