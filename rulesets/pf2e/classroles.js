// The PF2E classes by the role each mainly fills in a party, for the character builder's class step (the user,
// 2026-11-14: classes are shown grouped by role by default). Many classes can lean another way with their subclass
// and feats; `also` names the other roles a class fills well. The pitch lines are this project's own words.
// A class not listed here (from a book added later) is shown under "Other" until it is placed.

export const ROLES = Object.freeze([
  { id: 'tank', label: 'Tank', about: 'holds the line and takes the hits' },
  { id: 'melee', label: 'Damage (melee)', about: 'deals damage up close' },
  { id: 'ranged', label: 'Damage (ranged)', about: 'deals damage from a distance' },
  { id: 'spells', label: 'Damage (spells)', about: 'deals damage with spells' },
  { id: 'healer', label: 'Healer', about: 'keeps the party on its feet' },
  { id: 'support', label: 'Support', about: 'makes the rest of the party better' },
  { id: 'utility', label: 'Utility', about: 'skills, knowledge and problem-solving' },
  { id: 'other', label: 'Other', about: 'not yet placed' },
]);

export const CLASS_ROLES = Object.freeze({
  guardian: { role: 'tank', pitch: 'Heavy armour, taunts foes and takes hits meant for allies.' },
  champion: { role: 'tank', also: ['healer'], pitch: 'Heavy armour, a shield and reactions that protect allies; some healing.' },
  fighter: { role: 'tank', also: ['melee'], pitch: 'The best weapon accuracy; a shield wall or a damage dealer.' },
  monk: { role: 'tank', also: ['melee'], pitch: 'Unarmoured, very mobile, strong saves; tanks through high AC.' },
  barbarian: { role: 'melee', pitch: 'Rages for big damage and extra HP; the most HP of any class.' },
  rogue: { role: 'melee', also: ['utility'], pitch: 'Sneak attack and the most skills of any class.' },
  swashbuckler: { role: 'melee', pitch: 'Builds panache with stylish moves, then lands big finishers.' },
  magus: { role: 'melee', also: ['spells'], pitch: 'Puts arcane spells into weapon strikes.' },
  exemplar: { role: 'melee', pitch: 'A demigod whose divine sparks live in its gear (ikons).' },
  ranger: { role: 'ranged', also: ['melee'], pitch: 'Hunts one chosen target with bow or blade; animal companion optional.' },
  gunslinger: { role: 'ranged', pitch: 'The best firearm and crossbow accuracy.' },
  kineticist: { role: 'ranged', also: ['utility'], pitch: 'Elemental blasts at will, with no spell slots to run out.' },
  sorcerer: { role: 'spells', pitch: 'Spontaneous casting with the most slots; the tradition comes from its bloodline.' },
  wizard: { role: 'spells', also: ['utility'], pitch: 'Prepares arcane spells from a spellbook; the widest choice of spells.' },
  psychic: { role: 'spells', pitch: 'Few slots, but powerful boosted cantrips.' },
  necromancer: { role: 'spells', pitch: 'An occult caster who raises and spends undead thralls.' },
  cleric: { role: 'healer', also: ['support'], pitch: 'Extra heal (or harm) spells every day; built for battle or for casting.' },
  oracle: { role: 'healer', also: ['support'], pitch: 'A spontaneous divine caster with a mystery and a curse.' },
  druid: { role: 'healer', also: ['utility'], pitch: 'A primal caster with healing, nature magic and an order (animal, storm...).' },
  animist: { role: 'healer', also: ['support'], pitch: 'A divine caster who channels spirits (apparitions).' },
  bard: { role: 'support', pitch: 'Compositions boost the whole party; an occult caster.' },
  commander: { role: 'support', pitch: 'Battlefield tactics that move allies and give them extra actions.' },
  witch: { role: 'support', pitch: 'Hexes and a familiar; the tradition comes from its patron.' },
  summoner: { role: 'support', also: ['melee'], pitch: 'Fights beside a powerful eidolon, with a little casting.' },
  investigator: { role: 'utility', pitch: 'Plans attacks with clever deductions; huge skill coverage.' },
  thaumaturge: { role: 'utility', also: ['melee'], pitch: "Exploits monsters' weaknesses with esoteric tools." },
  alchemist: { role: 'utility', also: ['healer'], pitch: 'Makes bombs, elixirs and mutagens every day.' },
  inventor: { role: 'utility', also: ['melee'], pitch: 'Builds a weapon, armour or construct innovation and overdrives it.' },
  runesmith: { role: 'utility', pitch: 'Traces and detonates magical runes on allies and foes.' },
});

/** A class's role entry: {role, label, also?, pitch?}. */
export function classRole(slug) {
  const r = CLASS_ROLES[slug] || { role: 'other' };
  return { ...r, label: ROLES.find((x) => x.id === r.role).label };
}
