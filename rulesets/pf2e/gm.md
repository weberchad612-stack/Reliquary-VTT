# Running a Pathfinder 2E game: Claude's GM guide (PF2E)

The PF2E additions to the general guide, [docs/gm/running-a-game.md](../../docs/gm/running-a-game.md):
read that first, then this. Packaged with the PF2E ruleset because every rule here uses the system's own
words and numbers. Reviewed with the user rule by rule on 2026-11-13; the old rule's id is in brackets.

## 0. Sources

- **Rules sources, in order:** our content (`content/pf2e`: actions, spells, feats, conditions, creatures,
  with their rules text), then the books' extracted text in the user's private folder (Player Core, Player
  Core 2, GM Core, Monster Core), then Archives of Nethys (2e.aonprd.com) as a last resort. _(F1)_

## 1. Secrecy

- **A foe's AC is never told to the players**, not even after a hit (the board shows it as "?"). _(A6)_
- **What the party learns about a foe comes through Recall Knowledge**, by its rulings: abilities,
  weaknesses, resistances, immunities and the like are revealed by a successful Recall Knowledge check, or
  when the party sees them happen. _(A6)_
- **The secret trait decides which rolls are secret** ("The GM rolls the check for this ability in
  secret"). Any check from an action, activity, feat or spell with the secret trait is rolled in secret
  (`dice.mjs --gm`): never show the die, modifiers or total, and narrate only what the character believes.
  The trait is on the action in our content (`content/pf2e`); check it there, never from memory. Common
  ones: Seek, Sense Motive, Hide, Sneak, Lie, Impersonate, Recall Knowledge, Identify Magic, Identify
  Alchemy, Decipher Writing, Gather Information, Sense Direction; feats such as Battle Assessment and
  Recognize Spell. Stealth rolled for initiative is open (it is initiative, not Sneak). This replaces the
  old exception that showed Recall Knowledge and Identify Magic rolls. _(A9)_
- **Knowledge checks have four degrees.** Recall Knowledge, Identify Magic and similar checks: a critical
  failure gives false information the character believes (the general rule "Unknown stays unknown"). _(A8)_
- **Identifying items** (Identify Magic or Identify Alchemy, secret, 10 minutes; DC by the item's level and
  rarity): success `loot.mjs identify <item>`; failure, the item stays unknown (a retry needs a new day or new
  information, as the action says); critical failure `loot.mjs identify <item> --as "False name"` with a ledger
  secret. Appraising gems and art (Society or Crafting) is `loot.mjs appraise <item>`. Bulk, the encumbered
  condition (over 5 + Str), carried armor's extra Bulk, backpacks and the 10 invested items are the board's
  (`rulesets/pf2e/loot.js`). _(A8, H2)_

## 2. Dice, checks and reactions

- **Reactions to watch for** (the general rule "Stop for reactions"): each creature has one reaction per
  round, refreshed at the start of its turn. Common PC reactions: Shield Block (after a hit, with a raised
  shield), Reactive Shield (a different reaction: raise the shield when hit), Nimble Dodge (when targeted,
  +2 AC), Reactive Strike (a foe in reach uses a manipulate or move action, or a ranged attack), Aid
  (prepared on an earlier turn), and any class or ancestry reaction on the sheet; check the
  sheet's actions in our content. The multiple attack penalty never applies to a Strike made as a reaction
  outside one's own turn. _(C2, C4)_
- **Traits change the roll: read them every time.** Before an attack or skill check, read the action's and
  the weapon's traits in our content. The tools apply the multiple attack penalty (agile -4/-8, otherwise
  -5/-10); until FR-18 the other weapon traits are mine to apply and show as named parts
  (`check.mjs --bonus`): backswing, deadly, fatal, forceful, sweep, propulsive, thrown, finesse... Any
  action with the attack trait counts toward the penalty (Escape, Trip, Shove, Grapple, Disarm). _(C4)_
- **Critical hits double the damage.** Roll the damage once and double the total (`dice.mjs --crit`).
  Extra dice from deadly, and fatal's extra die, are rolled after the doubling and not doubled; fatal also
  raises the weapon's die size before the roll. _(C5)_
- **Initiative reflects what each was doing.** Perception for alertness, searching or listening; Stealth
  for anyone Sneaking or Avoiding Notice; Deception, Diplomacy or Intimidation in a social scene;
  Athletics, Acrobatics, Survival or Thievery when that is the activity (`encounter.mjs roll --stat`). The
  initiative card names the check. Ties: foes act before PCs (the book; the tracker does it); between two
  PCs the user chooses. _(C6)_
- **Hero Points.** Every PC starts each session with 1 (`actor.mjs <who> resource heroPoints 1`). Spend 1
  to reroll a check (the second roll stands), or all of them to avoid dying. Award one when a PC's action
  earns it (GM Core: a brave last stand, protecting others, a clever plan that saves the day, finishing a
  tough foe, a well-handled social challenge, a real accomplishment), about one an hour after the first,
  spread around the party; at most 3 held; unspent points vanish at the session's end. Say who got one and
  why. NPC allies can earn them too. _(C7)_
- **Identifying items.** Identify Magic (and Identify Alchemy) takes 10 minutes per item; each character
  works on one item at a time, and several can work in parallel. Failure: nothing, and that character
  can't retry on the item until after their next daily preparations; another character may try. Critical
  failure: false information the character believes. Success: what the item is, what it does and how to
  activate it. All are secret checks. _(C8)_

## 3. NPCs and monsters

- **Where stat blocks come from, in order:** the adventure's own bestiary in `content/pf2e` (Foundry's
  adventure packs, such as `abomination-vaults-bestiary`), Monster Core and the other bestiaries in
  `content/pf2e`, then the book in the private pack. Pre-remaster creatures are converted on the fly
  (flat-footed is off-guard, and so on). _(D2)_
- **The actions a foe can choose from** (the general rule "Foes fight smart"): Trip, Shove, Grapple,
  Disarm (Athletics), Demoralize (Intimidation), Create a Diversion and Feint (Deception), Tumble Through
  (Acrobatics), Hide, Sneak, Seek, Aid, Take Cover, Escape, Step, Stride, Ready. A third Strike at -8/-10
  that hits on about 25% or less is usually wasted: prefer an action without the attack trait, or
  repositioning. Combine with the stat block (an off-guard target for sneak attack). _(D3a)_
- **Unlisted skill = untrained.** A stat block lists only the skills a creature is trained in. Any other
  skill uses its attribute modifier alone (no proficiency, no level). Actions that need training (Feint,
  Treat Wounds...) are not available untrained; untrained Trip, Shove, Grapple, Disarm, Demoralize, Create
  a Diversion, Hide, Seek and Aid are. A target's DC is 10 + its modifier (Reflex DC to Trip or Disarm,
  Fortitude DC to Shove or Grapple, Will DC to Demoralize, Perception DC to Create a Diversion or Feint).
  Choose the action before rolling; never skip a foe's action (Strike is the fallback). _(D3b)_
- **Language and actions.** Demoralize takes a -4 circumstance penalty if the target doesn't understand the
  language you're speaking (or you aren't speaking one); an effect with the linguistic trait works only on
  a target that understands the language. _(D5)_

## 4. Combat

- **Ask before rolling initiative.** If any PC has an ability that triggers when initiative is about to be
  rolled (a free action or reaction such as the swashbuckler's After You, or another initiative feat), ask
  the user whether they use it before rolling anyone's initiative. Check the PCs' sheets for such abilities
  when the campaign starts and note them in the campaign notes. _(E1a)_
- **A turn is 3 actions, plus 1 reaction and any free actions.** Price each queued action from its action
  cost in our content (Sudden Charge is 2, including its Strike; Raise a Shield 1; Strike 1; Stride 1).
  _(E2a)_
- **Reactive Strike's trigger** (and similar reactions; read each foe's own in its stat block): a creature
  within reach uses a manipulate action or a move action, makes a ranged attack, or leaves a square during
  a move action it's using. Most spells with somatic or material parts, drawing or stowing an item, and
  Interact are manipulate actions. A critical hit disrupts a manipulate action. _(E2)_
- **One reaction per round**, refreshed at the start of the creature's own turn. Aid is prepared on the
  aider's turn and uses the reaction on the ally's turn. _(E5)_
- **Conditions on the tokens, rules from the content.** Every condition goes on the token as an effect
  badge the moment it starts (`effect.mjs`), and comes off when it ends; the badge carries the rule. The
  turn rules tick down frightened and run out timed effects; the rest is mine: _(E7)_
  - Confused: I choose its targets at random among creatures in reach or range; the user picks the PC's
    weapon or cantrip.
  - Wounded ends when someone restores HP with Treat Wounds, or at full HP after 10 minutes' rest.
  - At 0 HP a PC is unconscious and dying: say so, and remind the user they can't act.
- **Temporary immunities are timed effects.** Treat Wounds (1 hour), Demoralize (10 minutes), guidance
  (1 hour), a haunt's or fear effect's immunity: put each on the creature as an effect with its duration
  (`effect.mjs ... custom "Immune to Treat Wounds" --duration "1 hour"`), so it shows on the token and runs
  out with the clock. Check it before allowing the action again. _(E8)_
- **Experience points.** 1,000 XP per level. Each foe or hazard by its level relative to the party's: -4 =
  10, -3 = 15, -2 = 20, -1 = 30, same = 40, +1 = 60, +2 = 80, +3 = 120, +4 = 160 (for four PCs; GM Core
  adjusts for party size). Difficulty from the adventure or the budget: Trivial 40 or less, Low 60,
  Moderate 80, Severe 120, Extreme 160. Story milestones as the adventure gives them. _(E10)_
- **Spells: slots, focus and sustaining.** Say what every cast spends ("a rank-1 slot, 2 of 3 left";
  cantrips and focus spells use no slot, focus spells a Focus Point) and update the caster's resources the
  same turn (`actor.mjs resource`). At the start of a caster's turn, remind the user of any spell they can
  Sustain. A spell with a sustained duration ends if not sustained; one with a fixed duration and an
  optional Sustain keeps running but stops growing. Say which in one line. _(E11)_
- **A held creature ties up the limb holding it.** Grab and similar holds use the body part that made the
  Strike; while that part holds someone, the creature can't Strike or Grab with it elsewhere until it
  Releases (a free action). A creature with several limbs can hold several creatures. Swallow Whole frees
  the jaws again. _(E17, N addendum)_
- **Shields and gear take damage.** Shield Block prevents damage up to the shield's Hardness; the shield and
  the creature each take what is left. Say both in my reply and record the shield's HP (broken at its
  Broken Threshold, destroyed at 0). Repair (Crafting, 10 minutes, a repair kit, a DC near the item's
  Craft DC): success restores 5 HP plus 5 per Crafting proficiency rank (10 trained), a critical success
  10 plus 10 per rank (20 trained); a critical failure deals 2d6 to the item. Until FR-17, keep shield HP
  in the campaign ledger. _(F3)_

- **Boss music (the board's rule, `rulesets/pf2e/sound.js`):** a unique creature, or one 2 or more levels above the
  party's average, in a running encounter brings boss music. A pack of lower-level foes making a severe encounter
  doesn't trigger it: switch it on with `sound.mjs boss on` when the fight deserves it.

## 5. Time, rest and healing

- **A full night's rest** is 8 hours: it restores HP equal to Constitution modifier x level (at least 1 x
  level) and reduces drained and doomed by 1; daily preparations (about 1 hour) restore spell slots, Focus
  Points and daily abilities. The evening before is healing time (Treat Wounds). _(G2)_
- **Treat Wounds** (from the content's action): Medicine, 10 minutes, a healer's toolkit; DC 15 trained
  (an expert may choose DC 20 for +10 HP, a master DC 30 for +30, legendary DC 40 for +50). Success 2d8 HP
  and removes wounded, critical success 4d8 and removes wounded, critical failure 1d8 damage. Treating the
  same patient for a full hour after a success doubles the HP regained. The patient is then immune to
  Treat Wounds for 1 hour (a timed effect; the hour includes the 10 minutes), success or not. _(G3)_
- **Drained comes off one a night.** Drained N lowers the creature's max HP by N x level (and its current
  HP by the same) while it lasts. After every full night's rest, lower it by 1 and say so in one line; the
  HP lost doesn't come back by itself. _(G4)_
- **Post-combat upkeep in PF2E** (the general standing order): Refocus for anyone with focus spells
  (10 minutes, 1 Focus Point), Treat Wounds by the party's healers in rotation (worst-hurt first; one
  patient per healer per 10 minutes; each patient once an hour), and retching off sickened (an action:
  Fortitude save against the source's DC). _(G5)_

## 6. Exploration

- **The exploration activities, applied automatically** (the general rule "Standing exploration
  activities apply themselves"; the rules in `rulesets/pf2e/exploration.js`). _(E15)_
  - Defend: the board raises the shield when the encounter begins (`shieldRaised`, its AC bonus); it lowers
    at the start of the PC's first turn.
  - Scout: the board adds +1 circumstance to every PC's initiative (the roll dialog, Roll All,
    `encounter.mjs roll`).
  - Avoid Notice: the board rolls Stealth for initiative.
  - Search (mine): on entering a new area, a free secret Seek for hidden doors, hazards and objects.
  - Detect Magic (mine): a one-line in-world note of whether magic is present within 30 feet (only what the
    adventure places; nothing at all if none).
  - Investigate (mine): a secret Recall Knowledge with the chosen skill on the area's clues.
  - Follow the Expert: +2/+3/+4 circumstance (the expert's rank) to the follower's check, level added if
    untrained; the tab warns when the one followed is not expert.
  - Pace: the slowest Speed, halved for any half-speed activity, doubled only when all Hustle (Constitution
    x 10 minutes, at least 10); difficult terrain halves travel, greater difficult terrain cuts it to a third.

## 7. Rulings

Rulings made in play that hold for any PF2E game (the general rule "Rulings are recorded and followed").
Campaign-only rulings stay in that campaign's ledger. Brought over from the old VTT's rulings file and
reviewed with the user on 2026-11-13.

- **Follow the Expert and Aid.** Follow the Expert needs an ally at least expert in the skill. Aid is a
  reaction prepared on your turn (helping one ally with one check); its DC and bonuses come from the
  content's Aid action (Remaster: DC 15, adjusted for particularly hard or easy tasks).
- **Targets and cover.** Prone and flanked creatures are off-guard. Attacking a hidden creature needs a
  DC 11 flat check, a concealed one DC 5. A creature in the line of an attack gives lesser cover (+1 AC);
  standard cover is +2 AC and Reflex, greater +4.
- **Doorway cover.** An attack made from the corner of a doorway at a target, or at a creature standing in
  the corner of a doorway, has standard cover (+2 AC and Reflex). _(V)_
- **Falling.** Bludgeoning damage equal to half the distance fallen in feet (land prone if damaged); Cat
  Fall and similar feats treat the fall as shorter; dropping from a hanging position shortens the fall by
  the creature's reach.
- **Ropes and boosts.** An anchored rope gives a +2 circumstance bonus to Climb; an ally can boost someone to
  a high ledge or trapdoor with Aid (prepared, then the reaction).
- **Noisy armor.** Armor with the noisy trait applies its check penalty to Stealth even when the wearer
  meets its Strength requirement (read the armor's traits in the content).
- **Reload, dropped weapons, grabbed.** A weapon's reload value is the Interact actions to reload it after
  each shot (crossbow 1). Picking up a dropped weapon is an Interact. Grabbed: off-guard and immobilized;
  manipulate actions need a DC 5 flat check; Escape against the grabber's DC.
- **Stabilizing and waking.** Administer First Aid to stabilize: DC 5 + the recovery check DC (= 15 + dying
  value). A creature at 0 HP that is unconscious but not dying regains 1 HP and wakes after 10 minutes
  (sooner with healing).
- **Bravado.** A swashbuckler's action with the bravado trait gives panache on a success; on a failure (not
  a critical failure) panache until the end of their next turn.
- **Summoned creatures and minions.** A summoned creature acts right after the casting (2 actions) and has
  the minion trait: each later turn the caster spends an action (Sustain or command) to give it 2 actions;
  it has no reactions unless its rules say so; it vanishes at 0 HP or when the spell ends.
- **Identifying and appraising.** An item with no tradition trait (runes, talismans) can be identified with
  Arcana, Occultism, Religion or Nature at its level-based DC. Appraising is Crafting (or a relevant Lore)
  against the item's level-based DC; failure gives nothing, and a value is recorded only after a success.
- **Selling and runes.** Gear sells for half its price; shoddy items can't be sold. A property rune needs a
  potency rune on the item first.
- **Distracted foes.** Creatures the adventure describes as busy and turned away when the party bursts in
  take a -2 circumstance penalty to initiative (they still roll Perception); they are not off-guard unless
  the party got the drop on them unnoticed (Stealth for initiative and undetected).
