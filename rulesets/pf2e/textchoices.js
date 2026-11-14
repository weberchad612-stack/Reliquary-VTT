// Choices written only in a record's text, with no rule for them in Foundry's data (docs/design/game-data.md 9.13):
// a wellspring gnome's tradition and cantrip, a born-of-item tanuki's Lore, a lorekeeper shisk's skills, a
// camouflage tripkee's terrain, Additional Lore's subject. Found by reading the text the same way for every record,
// so a new book's heritage that says "Choose arcane, divine, or occult. You gain one cantrip from that magical
// tradition's spell list" works without code for it.

const TRADITIONS = ['arcane', 'divine', 'occult', 'primal'];
const WORDS = { one: 1, a: 1, an: 1, two: 2, three: 3 };
// the skills each attribute keys (Player Core); a lorekeeper's "Intelligence- or Wisdom-based skill"
export const SKILL_ATTRIBUTE = Object.freeze({
  acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int', deception: 'cha', diplomacy: 'cha', intimidation: 'cha',
  medicine: 'wis', nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis', society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
});
const ATTR = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };

/** The part of a record's text that is its own: not a form it takes only with a feat, not its Special note. */
export function ownText(text) {
  return String(text || '').replace(/\r/g, '')
    .replace(/\n-\s*Yaoguai Form\b[^\n]*/g, '')          // a yaoguai's other form comes with a feat
    .split(/\n\s*---\s*\n\s*Special\b/)[0];
}

/**
 * The choices a record's text asks: [{flag, kind, prompt, options?, tradition?, from?, count?, attributes?, expertAt?}].
 * kinds: tradition (options), cantrip (tradition, or from: the flag holding it), lore (named by the player), skill
 * (attributes), word (options), name (named by the player).
 */
export function textChoices(text) {
  const t = ownText(text).replace(/\s+/g, ' ');
  const out = [];
  let m;
  const tradRe = /\bChoose (?:either )?((?:arcane|divine|occult|primal)(?:,? (?:or )?(?:arcane|divine|occult|primal))+)\./i;
  if ((m = tradRe.exec(t))) {
    out.push({ flag: 'tradition', kind: 'tradition', prompt: 'choose the magical tradition', options: TRADITIONS.filter((x) => new RegExp(`\\b${x}\\b`, 'i').test(m[1])) });
    if (/\bone cantrip from that (?:magical )?tradition's spell list\b/i.test(t)) out.push({ flag: 'cantrip', kind: 'cantrip', prompt: 'choose the cantrip (cast as an innate spell at will)', from: 'tradition' });
  } else if ((m = /\bChoose (?:one|a) (common )?cantrip from the (arcane|divine|occult|primal) spell list\b/i.exec(t))) {
    out.push({ flag: 'cantrip', kind: 'cantrip', prompt: `choose a ${m[1] ? 'common ' : ''}${m[2].toLowerCase()} cantrip (cast as an innate spell at will)`, tradition: m[2].toLowerCase(), ...(m[1] ? { common: true } : {}) });
  }
  // Lore of the player's choosing
  const expert = /\bAt (\d+)(?:st|nd|rd|th) level, you become expert in (?:the chosen skills?|this skill|that skill|these skills)\b/i.exec(t);
  const expertAt = expert ? Number(expert[1]) : undefined;
  if ((m = /\bChoose (one|a) Lore skill(?: subcategory)?\b/i.exec(t)) || (m = /\btrained in (one|two|three) Lore skills?\b/i.exec(t))) {
    const n = WORDS[m[1].toLowerCase()] || 1;
    for (let i = 1; i <= n; i++) out.push({ flag: i === 1 ? 'lore' : `lore${i}`, kind: 'lore', prompt: `name ${n > 1 ? `Lore skill ${i} of ${n}` : 'the Lore skill'} (the text says "${m[0]}")`, ...(expertAt ? { expertAt } : {}) });
  }
  if ((m = /\bone other ([A-Z][a-z]+)-? or ([A-Z][a-z]+)-based skill of your choice\b/.exec(t)) || (m = /\bone ([A-Z][a-z]+)-based skill of your choice\b/.exec(t))) {
    const attributes = [m[1], m[2]].filter(Boolean).map((x) => ATTR[x.toLowerCase()]).filter(Boolean);
    out.push({ flag: 'skill', kind: 'skill', prompt: `choose a ${attributes.join(' or ')}-based skill to become trained in`, attributes, ...(expertAt ? { expertAt } : {}) });
  }
  // a word from a short list ("Choose either aquatic, forest, or swamp terrain.")
  if (!out.some((c) => c.kind === 'tradition') && (m = /\bChoose (?:either )?([a-z]+(?:, [a-z]+)*,? or [a-z]+) ([a-z]+)\./.exec(t))) {
    out.push({ flag: m[2], kind: 'word', prompt: `choose the ${m[2]}`, options: m[1].split(/,\s*(?:or\s+)?|\s+or\s+/).map((x) => x.trim()).filter(Boolean) });
  }
  // something the player names ("Choose a type of animal such as bat, eagle ...", "Choose one deity from the dwarven pantheon")
  if ((m = /\bChoose (?:a|one) (type of [a-z]+|deity from the [a-z]+ pantheon)\b/i.exec(t))) out.push({ flag: m[1].startsWith('type') ? m[1].replace(/^type of /, '') : 'deity', kind: 'name', prompt: `name the ${m[1]}` });
  return out;
}

const NOT_OWN = /(?<!even )\b(if|when|whenever|unless|instead|so long as|as long as|might|may)\b/i;

/**
 * What a record's text grants with no rule for it in Foundry's data: innate spells ("You can cast the Detect Magic
 * cantrip as an arcane innate spell at will"), feats ("You gain the Assurance skill feat with Piloting Lore"), and a
 * background's variants written as one paragraph each ("Orlovsky: ... You're trained in the Diplomacy skill and the
 * Brevoy Lore skill. You gain the Group Impression skill feat."). Lines of a list and conditional sentences are not
 * the record's own grants. Returns {spells: [{name, innate}], feats: [{name, with?}], variants: [{name, skills, lore, feat}]}.
 */
export function textGrants(text) {
  const t = ownText(text);
  const spells = [], feats = [], variants = [];
  const plain = t.split('\n').filter((l) => !/^\s*-\s/.test(l) && !/^[A-Z][\w' -]{1,30}:\s/.test(l)).join('\n');
  for (const sen of plain.split(/(?<=[.!?])\s+|\n+/)) {
    if (NOT_OWN.test(sen)) continue;
    let m;
    if ((m = /\b[Yy]ou can cast the ([A-Z][\w’' -]+?) (?:cantrip|spell) as an? (arcane|divine|occult|primal) innate spell\b/.exec(sen))) spells.push({ name: m[1].trim(), innate: m[2] });
    for (m of sen.matchAll(/\b[Yy]ou gain the ([A-Z][\w’' -]+?) (?:general |skill )?feat\b(?: with ([A-Z][\w ]+?)(?=[.(]|$))?/g)) feats.push({ name: m[1].trim(), ...(m[2] ? { with: m[2].trim() } : {}) });
  }
  // variants: "Name: ... trained in the X skill and the Y Lore skill. You gain the Z skill feat."
  for (const line of t.split('\n')) {
    const m = /^([A-Z][\w' -]{1,30}):\s(.*)$/.exec(line.trim());
    if (!m) continue;
    const tr = /trained in the ([A-Z][a-z]+) skill and the ([A-Z][\w ]+?) Lore skill/.exec(m[2]);
    const ft = /You gain the ([A-Z][\w’' -]+?) (?:general |skill )?feat/.exec(m[2]);
    if (tr || ft) variants.push({ name: m[1].trim(), skills: tr ? [tr[1].toLowerCase()] : [], lore: tr ? [`${tr[2].trim()} Lore`] : [], feat: ft ? ft[1].trim() : null });
  }
  return { spells, feats, variants: variants.length > 1 ? variants : [] };
}
