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
  const p = priceCp(doc.price);
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
  priceCp, priceLabel, bulkOf, bulkLabel, bulkTotal, bulkLimits, needsIdentify, identifyBy, mysteryName, valueKnown, sellCp, invests, carryOptions, inUse,
  // the condition put on a token over its Bulk limit, and the words its effect carries (so only that one is taken off)
  encumbered: Object.freeze({ condition: 'encumbered', source: 'Bulk' }),
});
