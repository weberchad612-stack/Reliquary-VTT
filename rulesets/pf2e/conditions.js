// Pathfinder 2E conditions: what the board shows as effect badges on tokens (docs/design/board.md, section 7).
// Part of the system configuration (rulesets/pf2e/system.js: PF2E_SYSTEM.conditions); the board reads it from
// there and knows no condition itself. Rules lines paraphrase Player Core (ORC licence); keep them short.
//
// Each entry: label, icon (one emoji, unique in this list), kind ('good' | 'bad' | 'neutral', from the point
// of view of the creature that has it), valued (takes a number: frightened 2), max (largest value, where the
// rules set one), rule (one line for the badge's hover), and for the conditions that change how the token
// itself looks, state: 'down' (greyed: unconscious, dying); blinds: true for the conditions that leave the
// creature unable to see, so its eyes add nothing to what the party sees (blinded, unconscious, dying, petrified).

export const PF2E_CONDITIONS = Object.freeze({
  blinded:     { label: 'Blinded', icon: '🙈', kind: 'bad', blinds: true, rule: "Can't see; everything is hidden from you; −4 status penalty to Perception checks that need sight." },
  clumsy:      { label: 'Clumsy', icon: '🦶', kind: 'bad', valued: true, rule: 'Status penalty equal to the value to Dexterity-based checks and DCs, including AC and Reflex saves.' },
  concealed:   { label: 'Concealed', icon: '🌫️', kind: 'good', rule: 'Hard to see: whoever targets you must succeed at a DC 5 flat check.' },
  confused:    { label: 'Confused', icon: '😵', kind: 'bad', rule: 'Off-guard; treats no one as an ally; attacks or moves at random; may recover when damaged (DC 11 flat check).' },
  controlled:  { label: 'Controlled', icon: '🕹️', kind: 'bad', rule: 'Another creature decides your actions.' },
  dazzled:     { label: 'Dazzled', icon: '🔆', kind: 'bad', rule: 'Everything you can only see is concealed from you.' },
  deafened:    { label: 'Deafened', icon: '🔇', kind: 'bad', rule: "Can't hear; −2 status penalty to Perception and initiative; auditory actions may fail (DC 5 flat check)." },
  doomed:      { label: 'Doomed', icon: '⚰️', kind: 'bad', valued: true, rule: 'You die at dying 4 minus the value; drops by 1 after a full night\'s rest.' },
  drained:     { label: 'Drained', icon: '🩸', kind: 'bad', valued: true, rule: 'Status penalty equal to the value to Constitution-based checks; lose HP equal to level × value; drops by 1 after a full night\'s rest.' },
  dying:       { label: 'Dying', icon: '💀', kind: 'bad', valued: true, max: 4, state: 'down', blinds: true, rule: 'Unconscious and near death: a recovery check each turn; dying 4 (less doomed) is death.' },
  encumbered:  { label: 'Encumbered', icon: '🎒', kind: 'bad', rule: 'Clumsy 1 and a −10-foot penalty to all Speeds (minimum 5 feet).' },
  enfeebled:   { label: 'Enfeebled', icon: '🥀', kind: 'bad', valued: true, rule: 'Status penalty equal to the value to Strength-based rolls and DCs, including melee attack and damage rolls.' },
  fascinated:  { label: 'Fascinated', icon: '🌀', kind: 'bad', rule: "−2 status penalty to Perception and skill checks; can't use concentrate actions unrelated to the subject; ends if a creature acts hostile to you or your allies." },
  fatigued:    { label: 'Fatigued', icon: '🥱', kind: 'bad', rule: "−1 status penalty to AC and saves; can't use exploration activities while travelling; ends after a full night's rest." },
  fleeing:     { label: 'Fleeing', icon: '🏃', kind: 'bad', rule: 'Must spend your actions moving away from the source; no reactions, no attacks.' },
  frightened:  { label: 'Frightened', icon: '😨', kind: 'bad', valued: true, rule: 'Status penalty equal to the value to all checks and DCs; drops by 1 at the end of each of your turns.' },
  grabbed:     { label: 'Grabbed', icon: '✊', kind: 'bad', rule: 'Off-guard and immobilized; manipulate actions need a DC 5 flat check.' },
  hidden:      { label: 'Hidden', icon: '👤', kind: 'good', rule: 'Others know your space but not exactly: off-guard to you; they must succeed at a DC 11 flat check to target you.' },
  immobilized: { label: 'Immobilized', icon: '⚓', kind: 'bad', rule: "Can't use move actions to leave your space." },
  invisible:   { label: 'Invisible', icon: '👻', kind: 'good', rule: "Can't be seen: undetected to everyone unless they Seek; at best hidden to those who do." },
  'off-guard': { label: 'Off-guard', icon: '🎯', kind: 'bad', rule: '−2 circumstance penalty to AC.' },
  paralyzed:   { label: 'Paralyzed', icon: '🧊', kind: 'bad', rule: "Off-guard; can't act except Recall Knowledge and mental actions." },
  persistent:  { label: 'Persistent damage', icon: '🔥', kind: 'bad', rule: 'Take the damage at the end of each of your turns, then a DC 15 flat check to end it.' },
  petrified:   { label: 'Petrified', icon: '🗿', kind: 'bad', blinds: true, rule: "Turned to stone: can't act or sense anything; an object with Bulk and Hardness." },
  prone:       { label: 'Prone', icon: '🛌', kind: 'bad', rule: 'Off-guard; −2 circumstance penalty to attack rolls; can only Crawl and Stand to move; +1 cover against ranged attacks.' },
  quickened:   { label: 'Quickened', icon: '⚡', kind: 'good', rule: 'An extra action at the start of each turn, for the uses the effect allows.' },
  restrained:  { label: 'Restrained', icon: '⛓️', kind: 'bad', rule: "Off-guard and immobilized; can't use attack or manipulate actions except to Escape or Force Open." },
  sickened:    { label: 'Sickened', icon: '🤢', kind: 'bad', valued: true, rule: "Status penalty equal to the value to all checks and DCs; can't willingly ingest anything; spend an action retching to try to reduce it." },
  slowed:      { label: 'Slowed', icon: '🐌', kind: 'bad', valued: true, rule: 'Lose that many actions at the start of each turn.' },
  stunned:     { label: 'Stunned', icon: '💫', kind: 'bad', valued: true, rule: "Can't act; lose that many actions as you regain them (or stunned for a duration)." },
  stupefied:   { label: 'Stupefied', icon: '🧠', kind: 'bad', valued: true, rule: 'Status penalty equal to the value to Intelligence-, Wisdom- and Charisma-based checks and DCs; casting may be disrupted (flat check 5 + value).' },
  unconscious: { label: 'Unconscious', icon: '💤', kind: 'bad', state: 'down', blinds: true, rule: "Can't act; blinded and off-guard; −4 status penalty to AC, Perception and Reflex saves." },
  undetected:  { label: 'Undetected', icon: '🕳️', kind: 'good', rule: 'Others do not know where you are: they must guess a square and succeed at a DC 11 flat check.' },
  unnoticed:   { label: 'Unnoticed', icon: '🤫', kind: 'good', rule: 'Others do not know you are there at all.' },
  wounded:     { label: 'Wounded', icon: '🩹', kind: 'bad', valued: true, rule: 'Dying again adds the value to dying; ends after being restored to full HP or 10 minutes of Treat Wounds.' },
});
