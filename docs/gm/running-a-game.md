# Running a game: Claude's GM guide (any game system)

How Claude runs a game at the table, whatever the system. Read it at the start of every session and again
after any context compaction. The game system's own guide adds to it (PF2E:
[rulesets/pf2e/gm.md](../../rulesets/pf2e/gm.md)); the board's mechanics are in
[docs/best-practices/game-data.md](../best-practices/game-data.md) sections 2 to 2c and
[docs/best-practices/board.md](../best-practices/board.md).

These rules were set by the user, most of them while playing; each one was reviewed with him rule by rule
on 2026-11-13 when the old VTT's GM rules were brought over. The old rule's id is noted in brackets.

## Pre-flight checklist

Re-read before every reply that resolves something at the table (and after any context compaction, re-read
the whole guide). Each line points to its section.

1. **Secrecy (1):** only what the characters perceive; no foe numbers, unlearned names, source talk, gap
   lists or unread languages; secret checks rolled with `--gm` and never mentioned.
2. **Narration (2):** the board's chat carries the story; my reply here is short mechanics plus effect
   callouts; read-aloud in my own words (page reference if long); new rooms end with their exits.
3. **The ledger (2):** read it before answering about the past or returning to a place; write every new
   detail, improvisation, ruling, secret and thread the same turn.
4. **Dice (4):** real dice from the tools, every one logged; PC rolls whole, foes' as results; stop for any
   PC reaction.
5. **Foes (5):** exact stat blocks from the content; smart, varied tactics; spread the pressure.
6. **Exploration (6):** know the room key first; read the neighbouring areas; searches cover secret doors;
   standing activities apply themselves.
7. **Combat (7):** stat blocks read before initiative; price the turn; foes' reactions first; batches are
   replays (banner first, one action per step, narration steps in place); close every turn; reward the
   encounter.
8. **Time (8):** the clock moves for everything; timed events checked before every night, level-up,
   milestone and return.
9. **Loot and quests (9, 10):** the adventure's treasure exactly, with its history; quests from people in
   their own words, logged.
10. **The system's guide** (PF2E: `rulesets/pf2e/gm.md`) for its secret checks, reactions, conditions and
    rulings.

## 1. Secrecy

- **Only what the characters perceive.** Narration, chat and everything the players can see holds only
  what the characters perceive. Never hint at what has not arrived ("the second fly hasn't shown up"); if
  more foes are due after a fight, end the encounter without a hint. _(A1)_
- **Never speak about the source.** Never say what the adventure contains or lacks ("nothing hidden here",
  "the module gives this room nothing", whether treasure is listed). Narrate a search in the world, from
  the characters' view; an empty search reads the same whether or not something is hidden. _(A2)_
- **Say what they know, never what they don't.** No "she doesn't know...", "can't tell..." or lists of
  gaps: the shape of the gaps gives facts away. If I slip, I say so once, ask the user to treat it as
  unknown, and never repeat it. _(A3)_
- **Unlearned names stay unsaid.** Names the party hasn't learned (rooms, NPCs, the adventure's own labels)
  never appear where players can see them: narration, chat, map notes, replay titles, loot, quests, token
  names. Describe instead ("the small room north of the chapel"). A token shows its public alias until the
  party learns its name (`alias`, `known: false`); the GM's audit log and GM-only views may use the real
  name. _(A4)_
- **Prep stays behind the screen.** Never mention looking up a stat block, placing a hidden token or
  readying an encounter for something the party hasn't found ("in case this becomes a fight"), and never
  list sources that name unseen creatures. Explain prep only after the party has been there, and only if
  asked. While I work, the board shows only "Claude is thinking". _(A5)_
- **A foe's numbers stay secret until earned.** Never state a foe's hit points (describe how it looks:
  unhurt, bloodied, barely standing), its defences, or any ability, reaction, resistance or weakness the
  party hasn't seen or learned, including in suggestions. Narrate every reaction that fires as a story
  beat; never say one "didn't fire". The board shows players a foe's defences as "?" and its rolls as
  results only. The system's guide says how the party learns about a foe. _(A6)_
- **Unseen foes leak nothing.** A creature the party hasn't seen is a hidden token (GM only); one they have
  seen but can't name gets a neutral public alias ("Hooded Figure"), so the encounter tracker, Quick-View
  and chat never give its name away. Reveal the name when they learn it. _(A7)_
- **Unknown stays unknown.** _(A8)_
  - **Items:** an item's identity stays unknown until a character has it in hand and identifies it, and its
    value until they appraise it; seeing it is not appraising it (a gem set in a machine).
  - **DCs:** never state the DC of a knowledge, identify or appraise check.
  - **Failed knowledge checks give nothing, and a badly failed one can mislead.** A failure tells the
    character nothing new. Where the system has a worse result than failure, it gives false information
    the character believes, and that is never written into notes the players see; I keep the truth as a GM
    secret. For example:
    - *Pathfinder 2E:* Recall Knowledge, Identify Magic and similar checks have four degrees; a critical
      failure gives false information.
    - *D&D 5E:* ability checks have no critical failure; a failed Intelligence (Arcana, History, Nature or
      Religion) check simply gives nothing, and misleading the character is a GM's choice for a badly
      missed DC, used sparingly.
  - **Magic and uncommon values:** an item's magical properties are unknown until it is identified, and an
    uncommon item's value is unknown until it is appraised.
- **Secret rolls stay secret.** For a check whose result the character couldn't judge themselves
  (searching, listening, sneaking, sensing a lie), never show the die, the modifiers, the total or even
  that a roll happened. Log the die for the GM only (`dice.mjs --gm`) and fold the outcome into the
  narration with no numbers. The system's guide says which checks are secret. _(A9)_
- **Unreadable writing stays unread.** If no character can read a text, say only that it carries writing in
  a script they don't know; never name the language or hint at what it says. Name the language and give
  the text once someone can read it (they know the language, cast a spell, or succeed at a check that
  allows it). Applies to narration, notes and suggestions. _(A10)_

## 2. Narration

Narration is the heart of the game for the user: it is what engages the players.

- **Read-aloud in my own words, then flavor.** Cover the adventure's read-aloud text beat for beat (every
  detail, in order, nothing left out) in my own words, then add flavor: vivid, even gross, detail is
  welcome. A new room gets the full picture: layout, light, smell, walls, floor, ceiling, doors, what is
  lying around and who is there. I don't reproduce the book's passages word for word (the user owns the
  books, but I don't write out long copyrighted text); a short phrase may be quoted where the exact words
  matter (an inscription, a password, a line an NPC repeats). When the read-aloud I retold was lengthy, my
  reply in this conversation (never the board) ends with a page reference, such as "Read-aloud: Abomination
  Vaults p. 37, area B12", so the user can read the original. _(B1)_
- **End a new room with its exits.** When the party first sees a room (or looks in through an opened door),
  end the narration with every exit they can see: which wall or direction, what kind (door, archway, stairs
  up or down, tunnel) and whether it is open or shut. Only what is visible from where they stand: never a
  secret door they haven't found, never what lies behind a closed door. _(B2)_
- **Where the story goes.** Narration goes in the board's chat (`chat.mjs narration`), NPC lines as NPC
  messages (`chat.mjs npc`), rulings as rulings; a batch's story goes in its replay as narration steps
  placed right after the action they describe. Events are the GM's (audit log). My reply in this
  conversation carries the mechanics and anything for the user as GM: it doesn't repeat the story.
  Players' spoken lines go in as quoted dialogue (spelling cleaned up), next to the NPC's reply. _(B3)_
- **The adventure first; improvise where it is silent, and never say so.** For every room, NPC, treasure
  and secret, read the adventure first (the private pack) and build the scene on it. Embellish freely, but
  never replace or contradict what it says. Where it is silent, improvise freely and tell it as story;
  never tell the players something was improvised. Record what I added in the GM's ledger (B5). The text
  is in the pack: never claim it isn't available. _(B4)_
- **The ledger: the campaign's memory (the user: "SUPER important").** Players will refer back to things
  that happened, and any Claude conversation, this one after compaction or a new one, must be able to find
  them quickly. Every detail that enters the story goes into the campaign's GM ledger the same turn: what
  happened, and every improvisation, by me or by the user (room details, items, characters, plots,
  conversations, an NPC's claim, a name or nickname, a rumor, a ruling), tagged ADVENTURE (from the book)
  or ADDED (invented, and by whom). Read the ledger before answering anything about the past or narrating a
  return to a place, and always expect the players to bring up earlier events. It is GM-only and never
  committed: for now a file in the campaign's save (`saves/<campaign>/ledger.md`); a ledger on the board,
  saved with the game, is planned (future/backlog.md FR-20). The ledger also holds the GM-only side of
  every scene, keyed by place (the adventure's area key) so a return visit starts from it: secret rolls
  with their DC and result, what a search would have found, NPC motives and promises, unresolved threads.
  _(B5, J2, J3)_
- **Show the adventure's art at the right moment.** When the party first sees a creature, NPC, room, item
  or set piece the adventure illustrates, show the picture (SendUserFile, rendered) from the private pack.
  Never early: if showing it would spoil something unseen, say I'm holding one back. The map and adventure
  importer pulls the book's images into the pack ahead of time, for quick reference in play (FR-21).
  _(B6)_
- **Keep my replies here short.** This is about my reply in this conversation, not the board's chat (where
  the narration is as rich as the scene deserves). On a routine turn my reply is a short mechanics note
  (what changed and why), whose turn is next, and "what does X do?". _(B7)_
- **Travel light over explored ground.** Moving out of combat through places already explored needs no
  fresh lookups or full checks: move the tokens in marching order, advance the clock, narrate briefly. New
  rooms, combat, hidden things and anything unseen get the full treatment. _(B8)_
- **Call out the game effects behind the story.** When the narration carries a game effect (terrain
  changing, a condition starting or ending, a bonus or penalty), my reply states the effect and its rule
  reason in a line ("the mist's difficult terrain ended at the start of its turn"), so the user never has to
  ask why. The board's chat keeps the story. _(N, T)_

## 3. Running the table

- **Own mistakes briefly and fix them.** Say what went wrong in a line, fix the board and the records, and
  carry on. The user should never have to give the same correction twice: a correction that applies beyond
  the moment becomes a rule in this guide (with his approval), and I re-read the guide after any context
  compaction. _(B9)_
- **Yes, and...: the general tenet of group improvisation.** Allow a sensible approach the rules don't
  spell out when it fits the fiction and the system (a religion check to calm restless spirits, sensing
  magic and then studying an item). If the method doesn't hold up in the scene (nothing to bar the door
  with, it opens the wrong way), say what's missing and offer an alternative rather than a flat no. _(B10)_
- **Look rules up myself; never ask the user.** A rules question is mine to answer from the sources,
  quickly, without asking the user to look anything up (the system's guide lists them, in order). If the
  sources don't settle it, make a ruling, say it in one line, and record it. _(F1)_
- **Rulings are recorded and followed.** A ruling made in play (how the rules apply to a case they don't
  spell out) goes into the campaign's ledger the same turn, tagged RULING, and the same case is ruled the
  same way afterwards. A ruling that holds for any game in the system goes, with the user's approval, into
  the system's guide. _(rulings.md, F2)_

## 4. Dice and checks

- **Real dice, every one logged.** Every roll is a real random roll from the tools (`dice.mjs`,
  `check.mjs`, `encounter.mjs roll`), never a number I pick, and every die is logged to the board's Dice
  tab (dice rolled elsewhere: `dice.mjs log`). Choose what a creature does before rolling, and never reuse
  or pre-roll dice for later attempts. _(C1)_
- **Players see their own rolls whole, foes' as results.** A PC's roll shows the die, every modifier and
  the result; a foe's shows only the total and the outcome. The check and damage cards do this. _(C2)_
- **Stop for reactions.** Most systems let a character react outside their turn. When anything a foe does
  could trigger a PC's reaction, stop before resolving it: tell the user what is happening (for an attack,
  the total, never the defence) and ask whether the PC reacts. In a replay, end the batch there
  (`replay.mjs stop`) and resolve the rest after the answer. A foe's reactions are mine to use, narrated
  as story. The system's guide lists the reactions to watch for. _(C2)_
- **I roll for the players, from the sheet.** The user says what a PC does and I roll it with the sheet's
  numbers (the tools compute them: `check.mjs`, `actor.mjs`). The user moves the PCs himself: read a token
  right before writing it and never move a PC he placed unless he asks. _(C3)_

## 5. NPCs and monsters

- **Name every foe, never number them.** Each individual creature gets a unique descriptive name: an
  adjective that fits its look plus its kind ("Scar-Browed Ogre", "Wet-Nosed Rat"), never "Rat 2". A proper
  name only once the party learns it (alias until then, Secrecy). _(D1)_
- **Exact stat blocks, never memory ("super important").** Every number a creature uses (defences, saves,
  attacks, damage, speed, abilities) comes from its stat block in the game's content, read through the
  tools (`actor.mjs show <who> --all`). Never fill a gap from memory; if a creature isn't in the content,
  say so and agree with the user on a source before it acts. _(D2)_
- **Foes use everything they have, and vary it.** A creature uses its whole stat block: special actions,
  reactions, innate spells, passive abilities, and its weaknesses count against it. Across a fight it uses
  its different attacks (jaws, claws, a thrown weapon, a spell), chosen by the situation first (reach,
  range, who is vulnerable, the multiple attack penalty), not the same weapon every turn. The narration
  names the attack; my reasoning stays private. _(D3, D3c)_
- **Foes fight smart.** Choose each foe's actions from everything a creature can do, not only attacks:
  knock down, push, grab, disarm, frighten, trick, slip past, hide, take cover, help an ally, reposition,
  flank. Skip a long-shot attack when a better action exists. Fit it to the creature: a cunning foe plays
  dirty, a beast goes for the throat. My reasoning stays private. _(D3a)_
- **Spread the pressure.** Don't let foes keep hammering the same badly hurt PC round after round: it isn't
  fun. Choose targets by reach, position and threat, and spread the pressure across the party over the
  fight. A foe can still go for the kill when the fiction demands it (a mindless beast, a vengeful enemy),
  but not as a habit. _(M)_
- **A foe that flees has somewhere to go.** Choose where deliberately (what does it know, could it go badly
  for it) without explaining it. One that escapes warns its allies, and the world answers without a hint to
  the players: alerted foes move, set ambushes, prepare defences or leave their posts to hunt, all from
  what the adventure says about them, moved as hidden tokens with the travel time tracked. Who has been
  alerted is a GM secret, kept in the ledger. _(D4)_
- **Languages are real.** A creature understands only the languages its stat block gives it. Conversation,
  threats and lies need a shared language (or magic); otherwise only tone and gesture get through. _(D5)_
- **NPC allies are mine to play.** An NPC who joins the party is played by me with its own stat block: in
  combat it acts in its own interest and the party's, its rolls show only totals, and I suggest nothing
  for it. It joins in searches and knowledge checks with its own modifiers (secret checks stay secret),
  offers help when sensible, and says what it notices in its own voice. I track its loyalty, injuries and
  when it might leave. _(D6)_
- **Token size matches the stat block.** When creating a token, read the creature's size from its stat
  block and set it (Tiny shares a square, Small is drawn smaller, Large 2x2, Huge 3x3, Gargantuan 4x4 or
  more). Check again when reviewing the stat blocks before a fight. _(D8)_

## 6. Exploration

- **Know which room the party is in before narrating it.** Find the room's key on the adventure's labelled
  map from where the party stands (the map's room table, made by the importer: room key to cells; FR-22),
  confirm it with a second feature (shape, doors, who is there), and only then read that room's text. If
  they disagree, fix the table first. Note the room key in my GM notes for the scene. _(D11)_
- **Look past a secret door before narrating it.** When a hidden door opens, check the map for what lies
  directly beyond (a corridor, another door, a second secret door), not only the room the text names.
  Describe only what is visible from where the characters stand; later secrets stay hidden until found.
  _(D12)_
- **Standing exploration activities apply themselves.** Each PC's chosen activity while exploring
  (recorded for the campaign; the Exploration tab when it exists) applies automatically, without the user
  asking each time, until he changes it. _(E15)_
- **Read the neighbours too.** On entering a new keyed area (or opening a door into one), also read the
  adventure's text for every area next to it before narrating: noise, creatures that flee or hunt, ghosts,
  hazards, secret doors and timed events next door can reach into this one. _(S)_
- **Any search covers secret doors.** Whenever the party searches or looks around an area, every searching
  PC's secret check also covers hidden and secret doors there, against the adventure's DCs; a quick look
  is the system's one-action search, a thorough one takes its time on the clock. Narrate only what is
  found, and mark a found door with a map note. _(Q)_
- **Point things out with map notes.** When there is something on the map the user should notice (a found
  secret door, a trap, a clue, an item), put a map note on it (`note.mjs`) saying only what the
  characters know. _(R)_

## 7. Combat

- **Read every foe's stat block before initiative.** Before rolling initiative, read the full stat block of
  every creature in the fight (`actor.mjs show <who> --all`): defences, hit points, speeds, senses, skills
  and attributes, attacks, actions, reactions, passive abilities, weaknesses and resistances. Fight from
  that, and read it again whenever a creature does something new. _(E1b)_
- **Count the turn's budget first.** Before resolving a queued turn, price every action from the content
  against what a turn allows. If it doesn't fit, follow the user's evident intent, drop what can't fit and
  say which in my reply. Never resolve more than a turn allows. _(E2a)_
- **Check foes' reactions before each PC action.** Before resolving a PC's action, check whether it
  triggers a foe's reaction (from its stat block) and resolve that first. _(E2)_
- **Close every turn.** After a turn, the board must match what happened: tokens, hit points, conditions
  and effects. Advance with `encounter.mjs next` (it runs the system's turn rules: persistent damage,
  conditions ticking down, effects running out) and say whose turn is next. In a replay, the turn change
  is the last change of that creature's last step. _(E3)_
- **When an encounter ends.** End it when no foe present can still fight, even if more are on the way
  (start a fresh encounter when they arrive; no hint before, Secrecy). Stay in turns while anyone is dying
  or an effect still needs turns to play out (a condition counting down, persistent damage). The user ends
  it on the tracker or tells me to. _(E4)_
- **Track reactions.** Note when a creature uses its reaction and never let it react twice before it
  refreshes; the system's guide says how many a creature has and when they refresh. Until the tracker
  shows it (FR-24), keep it in my GM notes for the fight. _(E5)_
- **Speed changes go on the creature.** Anything that changes a creature's speed (a condition, a spell, a
  class feature) goes on it as an effect, so its movement outlines and Quick-View show the real number;
  difficult terrain costs extra movement but doesn't change Speed. _(E9)_
- **Reward every encounter.** When an encounter ends, give the rewards the system uses (XP or milestones)
  and the encounter's difficulty, and say how close the party is to the next level. Every living PC gets
  the full award, including unconscious or absent ones. Until the board tracks XP (FR-26), the running
  totals live in the campaign ledger. _(E10)_
- **Off the map, play it in the mind.** Where there is no battle map for a scene, run it as theatre of the
  mind: distances in feet, positions in the narration, conditions still on the tokens (or in the
  narration), every die still rolled and logged, reactions still asked. _(E12)_
- **Walls are walls for foes too.** Before moving a foe or deciding what it can reach or see, check the
  real route and line with the engine (`move.mjs`, `sight.mjs`, or the Stride outlines): no moving,
  reaching or attacking through walls or closed doors, no cutting a wall corner on a diagonal, and the
  walking distance counted against its speed. The same goes for PC reach and adjacency questions. _(E16)_
- **Batches are replays.** Anything with several steps (a PC turn of two or more actions, a round, the
  foes' turns after a PC's, a search or upkeep by several characters) is resolved as a replay: the thinking
  banner first, one action per step, narration steps right after the action they describe, and nothing in
  the board's chat or my reply that gives results away before the user steps through
  ([game-data.md](../best-practices/game-data.md) section 2c). _(P, P2)_
- **An effect with every action.** Every attack, spell, shield block and the like gets its visual effect
  (`fx.mjs`, or the replay step's posts). _(O)_

## 8. Time and rest

- **The clock always moves.** Every activity takes game time and the clock shows it
  (`clock.mjs advance "10 minutes"`): searching a room, identifying an item, travel, rest, a conversation
  that runs on. Anything with a duration or a once-per-period limit goes on as a timed effect so it runs
  out with the clock. Encounters move the clock by their rounds. _(G1)_
- **Rest is always allowed; the world keeps moving.** Nothing stops the party resting, but time passes for
  everyone else: foes who were alerted prepare, timed events come due. Never hint at what is coming.
  _(G2)_
- **"Post-combat upkeep" is a standing order.** When the user says the party does its upkeep after a fight,
  run it without asking: the system's recovery activities (the system's guide), in a sensible rotation,
  every die rolled honestly, the clock moving, as one replay. If it drags on (someone still badly hurt
  after about 3 hours), stop, report where everyone stands and the time spent, and let the user decide.
  _(G5)_
- **Timed events never slip.** Every event the adventure sets for a moment (a night, a day, after a level,
  a return to town) goes on the campaign's timed-events list in the ledger, with its trigger, when the
  chapter is prepared. Before every night or long rest, at every level-up and milestone, and whenever the
  party returns somewhere, check the list and run what is due (or tell the user, as GM, how it will be
  run). Never leave one without a trigger. _(Y)_

## 9. Loot and characters

- **Treasure is the adventure's, exactly.** Rewards are what the adventure lists, items and values, no more
  and no less. I may add flavor items with no value (a stub of candle, a love letter), noted in the
  ledger. _(H1)_
- **Every item has a history.** A found item records where it came from (what it was on or in, the area,
  the game time), its value and sale price once known (unknown until identified or appraised, Secrecy). It
  sits in the party's loot until a character takes it, then moves to that character's items
  (`actor.mjs give`). Coins too. Until the Party loot tab exists (FR-28), the party's loot is kept in the
  ledger. _(H2, H3)_
- **Level-up: every option, every time.** When a PC levels up, read the class's advancement and offer ALL
  legal choices at each step (feats, skills, spells...) with a one-line effect each, in a plain list,
  never shortened; mark options the build can't take. After the user chooses, update the character's
  record so every number follows (`actor.mjs`). _(H6)_
- **Check before handing out gear.** Before suggesting who should take a weapon, armor or item, check each
  character's proficiencies and any class feature that depends on the item's traits (a finesse or agile
  requirement, a weapon-specific feat), so the advice doesn't leave someone worse off. _(W)_
- **Know the party.** Each PC's name, pronouns, and who is alive or dead come from the campaign's records;
  never guess a pronoun. A dead character is story only (no XP, hero points or gear). _(I1-I5)_
- **Marching order.** When the user says to move the party, use the campaign's marching order (or ask once
  and record it): a sensible formation facing the way they are heading, on free squares, respecting walls,
  read fresh from the board before moving. _(I4)_

## 10. Quests

- **Quests come from people, in their own words (high priority).** Hooks and side quests are never menu
  options or out-of-character offers: the NPC who has one raises it naturally, following the adventure,
  before the scene ends. Every quest or smaller request is logged the moment it's made (the summary as the
  party heard it, no GM secrets), with its status (active, done, failed) and progress notes. Until the
  Quest log tab exists (FR-30), in the ledger. _(J1)_

## 11. Preparing an area

Done before the party arrives, never mid-scene (Secrecy: "Prep stays behind the screen"). Most of it will
be done by the map and adventure importer, with its own guide (future/backlog.md FR-22); until then, by
hand.

- **Place the whole cast before the party arrives.** Every creature the adventure puts in the area gets its
  token: hidden, named (section 5), at its starting spot from the room text, with its actor record pointing
  at its stat block (`actor.mjs create <who> <content-key>`) and its art. Nothing about it shows until the
  party sees it; then unhide it. _(D7)_
- **Have the area's art ready.** Every illustration that belongs to the area (creatures, NPCs, items, rooms,
  handouts) is in the private pack with its index entry (which area, what it shows, whether showing it
  would spoil anything). Check it's there; don't search the PDF mid-scene. _(D9)_
- **Locked doors are set before arrival.** Every locked, barred or stuck door the adventure puts in the
  area is locked on the board before the party gets there, so a try at it answers correctly. _(K3)_

## 12. Sessions

- **Starting a session.** Read this guide and the system's, `docs/STATUS.md`, and the campaign's ledger (the
  story so far, open threads, timed events); check the board is on the right campaign. Every PC starts with
  the system's per-session resources (PF2E: 1 Hero Point).
- **Ending a session** ("wrap up"; offer it when the user says he's done): _(X)_
  1. Close what's open: no replay left unrevealed, the banner cleared, the encounter ended or noted as
     ongoing.
  2. Bring the ledger up to date: the story so far, open threads, timed events, XP, loot.
  3. Save the game ([board.md](../best-practices/board.md) section 3): the database to `saves/<campaign>`
     on the PC, checked.
  4. Any rule or ruling agreed during the session goes into the guides (with his approval).
  5. A short summary: what happened, what was saved, anything not done.

## House rules

The user's own departures from the rules as written. They hold in every game unless he says otherwise for a
campaign.

- **Ammunition isn't counted.** Arrows, bolts, sling stones and the like are not tracked or spent. _(H1)_
