// Pathfinder 2E treasure and carrying: coins, Bulk, identifying and selling items. The board's Party loot tab
// (board/loot.js, board/lootui.js) and tools/loot.mjs ask the campaign's system for these through system.loot;
// a system without them gets plain fallbacks (board/loot.js PLAIN_LOOT). Player Core and GM Core rules (ORC
// licence), paraphrased:
//
// - Coins: 1 pp = 10 gp = 100 sp = 1,000 cp. 1,000 coins of any kind are 1 Bulk; fewer weigh nothing.
// - Bulk: a light item (L, 0.1 here) counts as a tenth: ten light items are 1 Bulk, fractions dropped. Negligible
//   items (0) weigh nothing. Armor carried rather than worn counts 1 Bulk more (light armor becomes 1 Bulk).
// - Containers: a worn container (a backpack) holds up to its capacity, and the first Bulk inside it, its
//   `ignored`, does not count. The board does not track which container holds what: everything stowed shares the
//   worn (or held) containers, and their ignored Bulk comes off the stowed items' total.
// - Limits: a creature carrying more than 5 + its Strength modifier in Bulk is encumbered (clumsy 1, -10 feet to
//   its Speeds); it cannot carry more than 10 + its Strength modifier.
// - Invested items (the trait): a character can have up to 10 invested at once; an invested item works only worn
//   and invested.
// - Identifying: magical and alchemical items need Identify Magic or Identify Alchemy before their nature is known
//   (until then a player sees a vague name); mundane items are known at a glance. A critical failure gives a false
//   identification. Gems, art objects and other treasure are valued by appraisal (a Society or Crafting check).
// - Selling: items sell for half their price; coins, gems, art objects and raw materials (treasure) for full.

/** Coins, largest first: id, label and value in copper. */
const COINS = Object.freeze([
  Object.freeze({ id: 'pp', label: 'pp', name: 'platinum', cp: 1000 }),
  Object.freeze({ id: 'gp', label: 'gp', name: 'gold', cp: 100 }),
  Object.freeze({ id: 'sp', label: 'sp', name: 'silver', cp: 10 }),
  Object.freeze({ id: 'cp', label: 'cp', name: 'copper', cp: 1 }),
]);

/** Ways an item is carried: held in hand, worn, or stowed in a container. */
const CARRY = Object.freeze([
  Object.freeze({ id: 'held', label: 'Held' }),
  Object.freeze({ id: 'worn', label: 'Worn' }),
  Object.freeze({ id: 'stowed', label: 'Stowed' }),
]);

const MAGIC_TRAITS = new Set(['magical', 'arcane', 'divine', 'occult', 'primal']);
const SLOT_WORDS = { cloak: 'Cloak', mask: 'Mask', headwear: 'Headwear', eyepiece: 'Eyepiece', shoes: 'Footwear', garment: 'Garment', gloves: 'Gloves', belt: 'Belt', bracers: 'Bracers', backpack: 'Container', necklace: 'Necklace', ring: 'Ring', amulet: 'Amulet', anklets: 'Anklets', armbands: 'Armbands', circlet: 'Circlet', collar: 'Collar', horseshoes: 'Horseshoes', wrist: 'Wristband', epaulet: 'Epaulet', barding: 'Barding' };
const title = (s) => String(s).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Price ({gp, sp, cp, pp}) in copper. */
export function priceCp(price) {
  if (typeof price === 'number') return Math.round(price);
  if (!price) return 0;
  return COINS.reduce((n, c) => n + Math.round((price[c.id] || 0) * c.cp), 0);
}

/** Copper as coin words: 1250 -> '12 gp 5 sp' (pp only for amounts of whole platinum over 1,000 gp). */
export function priceLabel(cp) {
  let n = Math.round(cp || 0);
  if (!n) return '0 gp';
  const out = [];
  for (const c of COINS) {
    if (c.id === 'pp') continue;   // prices are written in gold
    const k = Math.floor(n / c.cp);
    if (k) { out.push(`${k.toLocaleString('en-US')} ${c.label}`); n -= k * c.cp; }
  }
  return out.join(' ');
}

/** An item's Bulk each, as carried: 0.1 is light, 0 negligible; carried armor counts 1 more. */
export function bulkOf(doc, carry = null) {
  const b = typeof doc.bulk === 'number' ? doc.bulk : 0;
  if (doc.kind === 'armor' && carry && carry !== 'worn') return b < 1 ? 1 : b + 1;
  return b;
}

/** A Bulk in words: 0 -> '-', 0.1 -> 'L', 3 -> '3', and a total in tenths: 3.4 -> '3; 4 L'. */
export function bulkLabel(n) {
  if (!n) return '—';
  const t = Math.round(n * 10), whole = Math.floor(t / 10), light = t % 10;
  if (!whole) return light === 1 ? 'L' : `${light} L`;
  return light ? `${whole}; ${light} L` : String(whole);
}

/** Whether a worn or held item is one of the containers whose contents partly do not count. */
const isContainer = (doc) => doc.kind === 'backpack' || (typeof doc.capacity === 'number' && doc.capacity > 0);

/**
 * A character's Bulk. items: [{doc (the resolved item), qty, carry}], coins: {pp, gp, sp, cp}.
 * Returns {value (whole Bulk, the light ones counted ten to one), tenths, items, coins, ignored, capacity,
 * stowed, over (stowed Bulk past the containers' capacity), parts: [{name, each, qty, total, carry}]}.
 */
export function bulkTotal(items = [], coins = {}) {
  let tenths = 0, stowedT = 0, ignoredT = 0, capacityT = 0;
  const parts = [];
  for (const it of items) {
    const doc = it.doc || it, qty = Math.max(0, it.qty ?? 1), carry = it.carry || null;
    const each = bulkOf(doc, carry), t = Math.round(each * 10) * qty;
    parts.push({ name: doc.name, each, qty, total: t / 10, carry });
    tenths += t;
    if (carry === 'stowed') stowedT += t;
    else if (isContainer(doc)) { ignoredT += Math.round((doc.ignored || 0) * 10) * qty; capacityT += Math.round((doc.capacity || 0) * 10) * qty; }
  }
  const off = Math.min(stowedT, ignoredT);
  const coinCount = COINS.reduce((n, c) => n + Math.max(0, coins[c.id] || 0), 0);
  const coinBulk = Math.floor(coinCount / 1000);
  const t = tenths - off + coinBulk * 10;
  return { value: Math.floor(t / 10) + 0, tenths: t, light: t % 10, items: tenths / 10, coins: coinBulk, coinCount, ignored: off / 10, capacity: capacityT / 10, stowed: stowedT / 10, over: capacityT ? Math.max(0, stowedT - capacityT) / 10 : 0, parts };
}

/** A character's Bulk limits from its attributes ({str}): {encumbered: past this, max}. */
export function bulkLimits(attributes = {}) {
  const s = attributes.str || 0;
  return { encumbered: 5 + s, max: 10 + s };
}

/** Whether an item needs identifying before a player knows what it is (magical or alchemical, or runed). */
export function needsIdentify(doc) {
  const traits = doc.traits || [];
  if (traits.some((t) => MAGIC_TRAITS.has(t)) || traits.includes('alchemical')) return true;
  const r = doc.runes || {};
  return !!(r.potency || r.striking || r.resilient || (r.property || []).length);
}

/** The skill check that identifies it: 'alchemy' (Identify Alchemy) or 'magic' (Identify Magic), or null. */
export function identifyBy(doc) {
  if (!needsIdentify(doc)) return null;
  return (doc.traits || []).includes('alchemical') && !(doc.traits || []).some((t) => MAGIC_TRAITS.has(t)) ? 'alchemy' : 'magic';
}

/** What a player calls an item not yet identified, from what it looks like: "Unidentified Potion", "Longsword (unidentified)". */
export function mysteryName(doc) {
  if (doc.mystery) return doc.mystery;
  const base = doc.baseItem && doc.baseItem !== doc.slug ? title(doc.baseItem) : null;
  if (['weapon', 'armor', 'shield'].includes(doc.kind)) {
    if (base && !/^alchemical-bomb$/.test(doc.baseItem)) return `${base} (unidentified)`;
    if (doc.kind === 'weapon' && (doc.traits || []).includes('bomb')) return 'Unidentified Bomb';
    return `Unidentified ${title(doc.kind)}`;
  }
  if (doc.kind === 'consumable') {
    if ((doc.traits || []).includes('bomb')) return 'Unidentified Bomb';
    return doc.category && doc.category !== 'other' ? `Unidentified ${title(doc.category)}` : 'Unidentified Consumable';
  }
  if (doc.kind === 'ammo') return 'Unidentified Ammunition';
  if (doc.kind === 'backpack') return 'Unidentified Container';
  if (doc.kind === 'treasure') return 'Unidentified Treasure';
  const u = String(doc.usage || '');
  const slot = u.startsWith('worn') ? u.slice(4) : '';
  if (slot && SLOT_WORDS[slot]) return `Unidentified ${SLOT_WORDS[slot]}`;
  if (/tattoo/.test(u)) return 'Unidentified Tattoo';
  if (/affixed|etched/.test(u)) return 'Unidentified Talisman or Rune';
  return 'Unidentified Item';
}

/** Whether a player can see the item's value: appraised, or identified and common (treasure always needs appraising). */
export function valueKnown(doc, item = {}) {
  if (item.appraised) return true;
  if (item.misidentified) return false;
  if (doc.kind === 'treasure') return false;
  const identified = item.identified ?? !needsIdentify(doc);
  return !!identified && (!doc.rarity || doc.rarity === 'common');
}

/** What the item sells for, in copper: half its price; treasure (coins, gems, art objects, raw materials) full. */
export function sellCp(doc) {
  const p = unitCp(doc.price);
  return doc.kind === 'treasure' ? p : Math.floor(p / 2);
}

/** Whether the item is invested (the trait). */
export const invests = (doc) => (doc.traits || []).includes('invested');

/** The ways it can sensibly be carried, first the usual: worn things worn, held things held, everything stowed. */
export function carryOptions(doc) {
  const u = String(doc.usage || doc.hands || '');
  if (doc.kind === 'armor') return ['worn', 'stowed', 'held'];
  if (u.startsWith('worn') || /tattoo|implant|affixed|etched/.test(u)) return ['worn', 'stowed'];
  if (doc.kind === 'weapon' || doc.kind === 'shield' || u.startsWith('held')) return ['held', 'stowed', 'worn'];
  return ['stowed', 'held', 'worn'];
}

/**
 * Whether a carried item is in use for the rules (its armor, shield, strikes and rule elements apply): not stowed,
 * armor worn, and an invested item invested. Items with no `carry` (older characters) are in use.
 */
export function inUse(item, doc = item) {
  if (item.equipped === false) return false;
  const c = item.carry;
  if (c === 'stowed') return false;
  if (doc.kind === 'armor' && c && c !== 'worn') return false;
  if (invests(doc) && (item.invested === false || (c && c !== 'worn'))) return false;
  return true;
}

/** The price of one: a price for several ({sp: 1, per: 10}: ammunition) divided. */
export function unitCp(price) {
  const p = priceCp(price), per = (price && typeof price === 'object' && price.per) || 1;
  return per > 1 ? p / per : p;
}

// GM Core's DCs by level (Table 10-5) and the rarity adjustments (Table 10-6: uncommon +2, rare +5, unique +10);
// identifying an item uses its level's DC adjusted for its rarity (checked against Archives of Nethys, 2026-11-13).
const DC_BY_LEVEL = Object.freeze([14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50]);
const RARITY_DC = Object.freeze({ uncommon: 2, rare: 5, unique: 10 });
/** The DC to identify (or Recall Knowledge about) a thing of this level and rarity. */
export function levelDC(level = 0, rarity = null) {
  const l = Math.max(0, Math.min(DC_BY_LEVEL.length - 1, Math.round(level || 0)));
  return DC_BY_LEVEL[l] + (RARITY_DC[rarity] || 0);
}

// Traits a look can tell before an item is identified: how a weapon or armor handles, and what form a consumable
// takes. Everything else (magical, invested, elements, effects) waits for identifying.
const SEEN_TRAITS = new Set(['agile', 'attached', 'backstab', 'backswing', 'brace', 'brutal', 'capacity', 'concealable', 'concussive', 'critical-fusion', 'deadly', 'disarm', 'double-barrel', 'fatal', 'fatal-aim', 'finesse', 'forceful', 'free-hand', 'grapple', 'hampering', 'jousting', 'kickback', 'modular', 'monk', 'nonlethal', 'parry', 'propulsive', 'ranged-trip', 'reach', 'recovery', 'repeating', 'resonant', 'scatter', 'shove', 'sweep', 'tethered', 'thrown', 'trip', 'twin', 'two-hand', 'unarmed', 'versatile', 'volley', 'combination', 'cobbled', 'tearing', 'climbing', 'injection', 'razing', 'reload', 'flexible', 'noisy', 'bulwark', 'comfort', 'laminar', 'ponderous', 'entrench', 'hindering', 'inured', 'potion', 'elixir', 'oil', 'scroll', 'wand', 'staff', 'talisman', 'tattoo', 'bomb', 'snare', 'gadget', 'mechanical', 'clockwork', 'consumable', 'ingested', 'injury', 'contact', 'inhaled', 'splash', 'ammunition', 'drug', 'fulu', 'catalyst', 'mutagen', 'poison']);
const traitBase = (t) => String(t).replace(/-(d\d+|\d+|[a-z])$/, '');
/** The traits a player sees: all of them once known, else only what a look can tell. */
export function seenTraits(traits = [], known = true) {
  return known ? [...traits] : traits.filter((t) => SEEN_TRAITS.has(String(t)) || SEEN_TRAITS.has(traitBase(t)));
}

const HANDS = { 'held-in-one-hand': '1 hand', 'held-in-two-hands': '2 hands', 'held-in-one-plus-hands': '1+ hands', 'affixed-or-held-in-one-hand': 'affixed or 1 hand' };
const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
const TREASURE = { 'art-object': 'Art object', gem: 'Gem', coin: 'Coins' };

/** What kind of item it is, in words: "Martial weapon · Sword", "Medium armor · Chain", "Potion", "Worn cloak". */
export function itemKind(doc) {
  const g = doc.group ? ` · ${title(doc.group)}` : '';
  if (doc.kind === 'weapon') return `${doc.category ? `${title(doc.category)} weapon` : 'Weapon'}${g}`;
  if (doc.kind === 'armor') return `${doc.category ? (doc.category === 'unarmored' ? 'Clothing' : `${title(doc.category)} armor`) : 'Armor'}${g}`;
  if (doc.kind === 'shield') return 'Shield';
  if (doc.kind === 'ammo') return 'Ammunition';
  if (doc.kind === 'backpack') return 'Container';
  if (doc.kind === 'kit') return 'Kit';
  if (doc.kind === 'treasure') return TREASURE[doc.category] || 'Treasure';
  if (doc.kind === 'consumable') return doc.category && doc.category !== 'other' ? title(doc.category) : 'Consumable';
  const u = String(doc.usage || '');
  if (u.startsWith('worn') && u.length > 4) return `Worn ${(SLOT_WORDS[u.slice(4)] || title(u.slice(4))).toLowerCase()}`;
  if (u === 'worn') return 'Worn item';
  if (/tattoo/.test(u)) return 'Tattoo';
  if (/affixed|etched/.test(u)) return 'Talisman or rune';
  return doc.kind && doc.kind !== 'equipment' ? title(doc.kind) : 'Gear';
}

/** How it is used: "1 hand", "2 hands", "worn", "affixed to armor", or ''. */
export function itemUsage(doc) {
  const h = doc.hands || doc.usage || '';
  if (typeof h === 'number' || /^\d$/.test(String(h))) return `${h} hand${Number(h) === 1 ? '' : 's'}`;   // older data: hands as a number
  if (HANDS[h]) return HANDS[h];
  if (String(h).startsWith('worn')) return 'worn';
  if (/^held/.test(h)) return title(h).toLowerCase();
  return h && h !== 'other' && h !== 'carried' ? String(h).replace(/-/g, ' ') : '';
}

/**
 * The item's numbers by kind, as [label, value] rows. known: false gives only what a look can tell (the base item's
 * damage, an armor's protection), never runes or a consumable's effect.
 */
export function itemStats(doc, known = true) {
  const out = [], r = doc.runes || {};
  if (doc.kind === 'weapon' && doc.damage && doc.damage.die) {
    const dice = 1 + (known ? (r.striking || 0) : 0);
    out.push(['Damage', `${dice}${doc.damage.die} ${doc.damage.type || ''}`.trim()]);
  }
  if (doc.range) out.push(['Range', `${doc.range} ft`]);
  if (doc.reload !== undefined && doc.reload !== null && doc.reload !== '' && doc.kind === 'weapon' && doc.range) out.push(['Reload', String(doc.reload) === '-' ? '—' : String(doc.reload)]);
  if (doc.kind === 'armor') {
    if (typeof doc.acBonus === 'number') out.push(['AC', signed(doc.acBonus + (known ? (r.potency || 0) : 0))]);
    if (typeof doc.dexCap === 'number' && doc.category !== 'unarmored') out.push(['Dex cap', signed(doc.dexCap)]);
    if (doc.checkPenalty) out.push(['Check penalty', signed(doc.checkPenalty)]);
    if (doc.speedPenalty) out.push(['Speed', `${signed(doc.speedPenalty)} ft`]);
    if (doc.strength) out.push(['Strength', signed(doc.strength)]);
  }
  if (doc.kind === 'shield') {
    if (typeof doc.acBonus === 'number') out.push(['AC raised', signed(doc.acBonus)]);
    if (doc.hardness !== undefined) out.push(['Hardness', String(doc.hardness)]);
    if (doc.hp !== undefined) out.push(['HP', `${doc.hp}${doc.brokenAt !== undefined ? ` (BT ${doc.brokenAt})` : ''}`]);
  }
  if (known && doc.kind !== 'weapon' && doc.damage && (doc.damage.formula || doc.damage.die)) {
    const f = doc.damage.formula || `1${doc.damage.die}`;
    out.push([doc.damage.kind === 'healing' ? 'Heals' : 'Damage', doc.damage.kind === 'healing' ? f : `${f} ${doc.damage.type || ''}`.trim()]);
  }
  if (typeof doc.capacity === 'number' && doc.capacity > 0) out.push(['Holds', `${doc.capacity} Bulk${doc.ignored ? `; the first ${doc.ignored} don't count` : ''}`]);
  if (known && (r.potency || r.striking || r.resilient || (r.property || []).length)) {
    const words = [r.potency ? `+${r.potency}` : '', r.striking ? ['striking', 'greater striking', 'major striking'][r.striking - 1] : '', r.resilient ? ['resilient', 'greater resilient', 'major resilient'][r.resilient - 1] : '', ...(r.property || [])].filter(Boolean);
    out.push(['Runes', words.join(' ')]);
  }
  if (known && invests(doc)) out.push(['Invested', 'works only worn and invested']);
  return out;
}

export const PF2E_LOOT = Object.freeze({
  coins: COINS,
  carry: CARRY,
  coinsPerBulk: 1000,
  investedLimit: 10,
  identifyWords: Object.freeze({ magic: 'Identify Magic', alchemy: 'Identify Alchemy', appraise: 'Society or Crafting to appraise' }),
  // the words and examples the board shows: the load's name, the over-limit condition, examples in the forms
  words: Object.freeze({ bulk: 'Bulk', encumbered: 'encumbered', invested: 'invested', coins: '5 gp', value: '25 gp' }),
  bareCoin: 'gp',   // a plain number of coins typed in the board or the tool is gold
  bulkChoices: Object.freeze([['', 'No Bulk'], ['0.1', 'L'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]),
  priceCp, unitCp, priceLabel, levelDC, seenTraits, itemKind, itemUsage, itemStats, bulkOf, bulkLabel, bulkTotal, bulkLimits, needsIdentify, identifyBy, mysteryName, valueKnown, sellCp, invests, carryOptions, inUse,
  // the condition put on a token over its Bulk limit, and the words its effect carries (so only that one is taken off)
  encumbered: Object.freeze({ condition: 'encumbered', source: 'Bulk' }),
});
