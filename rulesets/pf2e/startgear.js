// PF2E starting gear for the character builder (docs/design/game-data.md 9.10). The user's choices (2026-11-14):
// a 1st-level character shops with Player Core's 15 gp; a character built above 1st level takes GM Core's
// Character Wealth table: permanent items of set levels, which the player picks, plus currency to spend on
// consumables and lower-level permanent items (GM Core pg. 61, checked against Archives of Nethys, 2026-11-14).

/** GM Core Table 10-10, Character Wealth: by level, permanent items {item level: how many} and currency in gp. */
export const CHARACTER_WEALTH = Object.freeze({
  1: { items: {}, gp: 15 },
  2: { items: { 1: 1 }, gp: 20 },
  3: { items: { 2: 1, 1: 2 }, gp: 25 },
  4: { items: { 3: 1, 2: 2, 1: 1 }, gp: 30 },
  5: { items: { 4: 1, 3: 2, 2: 1, 1: 2 }, gp: 50 },
  6: { items: { 5: 1, 4: 2, 3: 1, 2: 2 }, gp: 80 },
  7: { items: { 6: 1, 5: 2, 4: 1, 3: 2 }, gp: 125 },
  8: { items: { 7: 1, 6: 2, 5: 1, 4: 2 }, gp: 180 },
  9: { items: { 8: 1, 7: 2, 6: 1, 5: 2 }, gp: 250 },
  10: { items: { 9: 1, 8: 2, 7: 1, 6: 2 }, gp: 350 },
  11: { items: { 10: 1, 9: 2, 8: 1, 7: 2 }, gp: 500 },
  12: { items: { 11: 1, 10: 2, 9: 1, 8: 2 }, gp: 700 },
  13: { items: { 12: 1, 11: 2, 10: 1, 9: 2 }, gp: 1000 },
  14: { items: { 13: 1, 12: 2, 11: 1, 10: 2 }, gp: 1500 },
  15: { items: { 14: 1, 13: 2, 12: 1, 11: 2 }, gp: 2250 },
  16: { items: { 15: 1, 14: 2, 13: 1, 12: 2 }, gp: 3250 },
  17: { items: { 16: 1, 15: 2, 14: 1, 13: 2 }, gp: 5000 },
  18: { items: { 17: 1, 16: 2, 15: 1, 14: 2 }, gp: 7500 },
  19: { items: { 18: 1, 17: 2, 16: 1, 15: 2 }, gp: 12000 },
  20: { items: { 19: 1, 18: 2, 17: 1, 16: 2 }, gp: 20000 },
});

const CP = { pp: 1000, gp: 100, sp: 10, cp: 1 };

/** An item's price for a quantity, in copper (a price "per" a number is for that many). null when it has none. */
export function priceCp(doc, qty = 1) {
  const p = doc && doc.price;
  if (!p) return null;
  const each = Object.entries(CP).reduce((n, [k, v]) => n + (p[k] || 0) * v, 0);
  return Math.ceil(qty / (p.per || 1)) * each;
}

/** Copper as coins, largest first, without platinum (as a starting purse is counted). */
export function coinsOf(cp) {
  const out = { gp: 0, sp: 0, cp: 0 };
  out.gp = Math.floor(cp / 100); cp -= out.gp * 100;
  out.sp = Math.floor(cp / 10); cp -= out.sp * 10;
  out.cp = cp;
  return out;
}
export const cpLabel = (cp) => { const c = coinsOf(cp); return [c.gp && `${c.gp} gp`, c.sp && `${c.sp} sp`, c.cp && `${c.cp} cp`].filter(Boolean).join(' ') || '0 gp'; };

export const GEAR_KINDS = Object.freeze(['weapon', 'armor', 'shield', 'equipment', 'consumable', 'ammo', 'backpack', 'kit', 'treasure']);
/** A consumable (used up once used): its kind, ammunition, or the consumable trait. */
export const isConsumable = (d) => d.kind === 'consumable' || d.kind === 'ammo' || (d.traits || []).includes('consumable');

/** How a starting item is carried: armour worn, weapons and shields in hand, the rest stowed. */
export function carryOf(doc) {
  if (doc.kind === 'armor') return 'worn';
  if (doc.kind === 'weapon' || doc.kind === 'shield') return 'held';
  return 'stowed';
}

/** A kit's contents, flattened: [{ref, qty}] (an Adventurer's Pack: a backpack, rope, torches...). */
export function kitContents(doc) {
  const out = [];
  const walk = (list) => { for (const c of list || []) { if (c.ref) out.push({ ref: c.ref, qty: c.quantity || 1 }); walk(c.contents); } };
  walk(doc && doc.contents);
  return out;
}
