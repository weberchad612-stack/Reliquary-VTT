// Party loot: the party's stash, what each character carries, and the coins (docs/design/board.md, Party loot).
// Pure functions shared by the board (board/lootui.js) and Claude's tool (tools/loot.mjs); no I/O.
//
// Records:
//   loot/<time36>-<n>  one item (or stack) in the party's stash, carried by nobody: no Bulk counts
//   state/purse        the party's shared coins: {pp, gp, sp, cp} (the system's coins)
//   actors/<id>.items  what a character carries: the same item shape, with how it is carried
//   actorstate/<id>.coins  the coins a character carries
//
// An item, in the stash or carried, is one shape:
//   {ref?: '<kind>/<slug>' (a library item; its document is content/<kind>.<slug> on the board), name?, text?, price?,
//    bulk?, kind?, traits?, rarity?, level?, usage? (a custom item's own words and numbers, or a library item's own
//    differences), qty?: 1, carry?: 'held' | 'worn' | 'stowed' (characters only), invested?: boolean,
//    identified?: boolean (missing: known unless the item needs identifying), misidentified?: {name, text} (a critical
//    failure's false identification: what the players believe), mystery?: the GM's own vague name for it,
//    appraised?: true, found?: {from?, where?: {map, area}, game?: {now, label}, link?}, added?: {at, by}}
//
// Secrecy (docs/gm/running-a-game.md section 1): the GM sees the truth; a player sees a vague name until the item
// is identified (or the false one after a misidentification) and a value only when the system says it is known.
// The rules (Bulk, identifying, selling, coins) come from the campaign's system (system.loot); PLAIN_LOOT stands in
// for a system without them: one kind of coin, no Bulk, everything known.

export const LOOT = 'loot';
export const PURSE = 'state/purse';

/** The fallback for a system without loot rules: plain coins, nothing weighs anything, everything is known. */
export const PLAIN_LOOT = Object.freeze({
  coins: Object.freeze([Object.freeze({ id: 'coins', label: 'coins', name: 'coins', cp: 1 })]),
  carry: Object.freeze([Object.freeze({ id: 'held', label: 'Held' }), Object.freeze({ id: 'worn', label: 'Worn' }), Object.freeze({ id: 'stowed', label: 'Stowed' })]),
  investedLimit: 0,
  identifyWords: Object.freeze({}),
  words: Object.freeze({ bulk: 'weight', encumbered: 'overloaded', invested: 'attuned', coins: '5', value: '25' }),
  bareCoin: 'coins',
  bulkChoices: Object.freeze([['', 'No weight']]),
  priceCp: (p) => (typeof p === 'number' ? p : (p && p.coins) || 0),
  priceLabel: (n) => `${n} coins`,
  bulkOf: () => 0,
  bulkLabel: () => '',
  bulkTotal: () => ({ value: 0, tenths: 0, light: 0, coins: 0, ignored: 0, capacity: 0, stowed: 0, over: 0, parts: [] }),
  bulkLimits: () => null,
  needsIdentify: () => false,
  identifyBy: () => null,
  mysteryName: (d) => d.mystery || 'Unknown item',
  valueKnown: () => true,
  sellCp: (d) => Math.floor(((d.price && d.price.coins) || d.price || 0) / 2),
  invests: () => false,
  carryOptions: () => ['stowed', 'held', 'worn'],
  inUse: (it) => it.equipped !== false && it.carry !== 'stowed',
  encumbered: null,
});

/** The campaign's loot rules, or the plain ones. */
export const lootRules = (sys) => (sys && sys.loot) || PLAIN_LOOT;

let seq = 0;
/** A new stash record's path: time-sortable like chat. */
export function lootPath(now = Date.now(), rnd = Math.random) {
  return `${LOOT}/${Math.floor(now).toString(36).padStart(9, '0')}-${(seq++).toString(36)}${rnd().toString(36).slice(2, 6)}`;
}

/** Fields that say where an item is and how it got there, not what it is. */
const PLACE = new Set(['qty', 'carry', 'invested', 'found', 'added']);
/** Fields that say what the party knows of it. */
const KNOW = new Set(['identified', 'misidentified', 'appraised', 'mystery']);

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)));

/**
 * A new item for the stash. f: {ref} (a library item) or {name, text?, value? (copper), bulk?, kind?, rarity?, level?,
 * traits?} (a custom one); qty, identified, mystery, found {from, where: {map, area}, game, link}, by ('gm' | 'claude').
 */
export function lootItem(f, now = new Date().toISOString()) {
  if (!f.ref && !String(f.name || '').trim()) throw new Error('an item needs a library key (ref) or a name');
  const qty = f.qty === undefined ? 1 : Math.floor(Number(f.qty));
  if (!(qty >= 1)) throw new Error('quantity must be 1 or more');
  const out = clean({
    ref: f.ref || null,
    name: f.ref ? (f.name || null) : String(f.name).trim(),
    text: f.text ? String(f.text) : null,
    price: f.value !== undefined && f.value !== null && f.value !== '' ? { cp: Math.round(Number(f.value)) } : (f.price || null),
    bulk: f.bulk !== undefined && f.bulk !== null && f.bulk !== '' ? Number(f.bulk) : null,
    kind: f.kind || null, rarity: f.rarity && f.rarity !== 'common' ? f.rarity : null, level: f.level ?? null,
    traits: f.traits && f.traits.length ? [...f.traits] : null,
    qty: qty === 1 ? null : qty,
    identified: typeof f.identified === 'boolean' ? f.identified : null,
    mystery: f.mystery || null,
    found: f.found ? clean({ ...f.found, where: f.found.where ? clean(f.found.where) : null }) : null,
    added: { at: now, by: f.by || 'gm' },
  });
  if (out.found && !Object.keys(out.found).length) delete out.found;
  if (out.found && out.found.where && !Object.keys(out.found.where).length) delete out.found.where;
  return out;
}

/** The item as one document: its library document (content[ref]) with its own fields over it. */
export function resolveLoot(item, content = {}) {
  const base = item.ref ? content[item.ref] || null : null;
  const own = Object.fromEntries(Object.entries(item).filter(([k]) => k !== 'ref' && !PLACE.has(k) && !KNOW.has(k)));
  const doc = { ...(base || {}), ...own, ...(item.mystery ? { mystery: item.mystery } : {}) };
  if (!doc.name) doc.name = item.ref ? item.ref.split('/').pop().replace(/-/g, ' ') : 'Item';
  return { doc, missing: !!item.ref && !base };
}

/** Whether the item is known for what it is. */
export function isIdentified(item, doc, L) {
  if (item.misidentified) return false;
  return item.identified ?? !L.needsIdentify(doc);
}

/**
 * The item as one view sees it (pure): {name, text, value (copper) or null, valueLabel, bulk, bulkLabel, qty, unknown
 * (players see a vague name), misidentified, appraised, needs ('magic' | 'alchemy' | null), rarity, level, traits, real
 * (the GM's: the true name when it differs)}.
 */
export function lootView(item, content, view, L) {
  const { doc, missing } = resolveLoot(item, content);
  const qty = item.qty ?? 1, gm = view === 'gm';
  const identified = isIdentified(item, doc, L);
  const needs = identified ? null : L.identifyBy(doc) || (L.needsIdentify(doc) ? 'magic' : null);
  let name = doc.name, text = doc.text || '';
  if (!gm && item.misidentified) { name = item.misidentified.name; text = item.misidentified.text || ''; }
  else if (!gm && !identified) { name = L.mysteryName(doc); text = ''; }
  const known = gm || L.valueKnown(doc, item);
  const each = L.priceCp(doc.price);
  const b = L.bulkOf(doc, item.carry || null);
  return {
    name, text, qty, missing,
    value: known && doc.price ? each : null, valueLabel: !doc.price ? '—' : known ? L.priceLabel(each) : '?',
    bulk: b, bulkLabel: L.bulkLabel(b),
    unknown: !identified, mysterious: L.needsIdentify(doc) || !!item.mystery || item.identified !== undefined, misidentified: !!item.misidentified, appraised: !!item.appraised, needs,
    rarity: gm || identified ? doc.rarity || null : null, level: gm || identified ? doc.level ?? null : null,
    traits: gm || identified ? doc.traits || [] : [], kind: doc.kind || null,
    real: gm && (item.misidentified || !identified) ? { believed: item.misidentified ? item.misidentified.name : L.mysteryName(doc) } : null,
    invested: !!L.invests(doc), carry: item.carry || null, isInvested: item.invested !== false && L.invests(doc) && item.carry === 'worn',
  };
}

/** Two items stack when they are the same thing known the same way (where they were found does not matter). */
export function stackKey(item) {
  const o = Object.fromEntries(Object.entries(item).filter(([k]) => !PLACE.has(k)).sort(([a], [b]) => (a < b ? -1 : 1)));
  return JSON.stringify(o);
}

/** A list of items with one more, stacked onto a matching one (same carry, for characters). */
export function mergeInto(list, item) {
  const k = stackKey(item), out = list.map((x) => ({ ...x }));
  const hit = out.find((x) => stackKey(x) === k && (x.carry || null) === (item.carry || null));
  if (hit) { const n = (hit.qty ?? 1) + (item.qty ?? 1); if (n === 1) delete hit.qty; else hit.qty = n; return out; }
  out.push({ ...item });
  return out;
}

/** Split n off an item: [the n taken, what is left or null]. */
export function splitQty(item, n) {
  const have = item.qty ?? 1;
  const k = n === undefined || n === null ? have : Math.floor(Number(n));
  if (!(k >= 1)) throw new Error('move at least one');
  if (k > have) throw new Error(`there ${have === 1 ? 'is only 1' : `are only ${have}`}`);
  const taken = { ...item }, rest = { ...item };
  if (k === 1) delete taken.qty; else taken.qty = k;
  if (have - k === 1) delete rest.qty; else rest.qty = have - k;
  return [taken, have - k > 0 ? rest : null];
}

/** The carry a character starts an item with: worn armor and worn things worn, everything else stowed. */
export function defaultCarry(doc, L) {
  const o = L.carryOptions(doc);
  return o[0] === 'worn' ? 'worn' : 'stowed';
}

/**
 * What the party knows is written down when an item changes hands: in the stash a missing `identified` means "as the
 * system says" (a magic item unknown), on a character it means known (a character's own starting gear). So an
 * unknown item taken from the stash gets identified: false, and a known one put back gets identified: true.
 */
function settleKnown(item, content, L, toCarrier) {
  if (item.identified !== undefined || item.misidentified) return item;
  const { doc } = resolveLoot(item, content);
  if (!L.needsIdentify(doc)) return item;
  return { ...item, identified: !toCarrier };
}
const forCarrier = (item, content, L) => { const o = settleKnown({ ...item }, content, L, true); delete o.added; return o; };
const forStash = (item, content, L) => { const o = settleKnown({ ...item }, content, L, false); delete o.carry; delete o.invested; return o; };
/** A carried item as the views read it: no `identified` means known. */
export const asCarried = (item) => (item.identified === undefined && !item.misidentified ? { ...item, identified: true } : item);

/** Take n of a stash item onto a character: {stash: the stash item left or null (remove), items: the character's new items, moved}. */
export function takeLoot(stashItem, items, n, carry, L, content = {}) {
  const [taken, rest] = splitQty(stashItem, n);
  const { doc } = resolveLoot(taken, content);
  const moved = { ...forCarrier(taken, content, L), carry: carry || defaultCarry(doc, L) };
  return { stash: rest, items: mergeInto(items || [], moved), moved };
}

/** Put n of a character's item i back in the stash: {items, stashItem}. */
export function putBack(items, i, n, L = PLAIN_LOOT, content = {}) {
  if (!items || !items[i]) throw new Error('no such item');
  const [taken, rest] = splitQty(items[i], n);
  const out = items.slice();
  if (rest) out[i] = rest; else out.splice(i, 1);
  return { items: out, stashItem: forStash(taken, content, L) };
}

/** Hand n of item i from one character to another: {from, to, moved}. */
export function giveLoot(fromItems, i, toItems, n) {
  if (!fromItems || !fromItems[i]) throw new Error('no such item');
  const [taken, rest] = splitQty(fromItems[i], n);
  const from = fromItems.slice();
  if (rest) from[i] = rest; else from.splice(i, 1);
  const moved = { ...taken, carry: 'stowed' };   // handed over: it goes into the other's pack until they say otherwise
  delete moved.invested;
  return { from, to: mergeInto(toItems || [], moved), moved };
}

/** Change how item i is carried (and invest a worn invested item by default). */
export function setCarry(items, i, carry) {
  if (!items || !items[i]) throw new Error('no such item');
  const out = items.slice(), it = { ...out[i], carry };
  if (carry !== 'worn') delete it.invested;
  out[i] = it;
  return out;
}

/** Invest or uninvest item i. */
export function setInvested(items, i, on) {
  if (!items || !items[i]) throw new Error('no such item');
  const out = items.slice(), it = { ...out[i] };
  if (on) delete it.invested; else it.invested = false;
  out[i] = it;
  return out;
}

// ---- coins ----

/** Coins with every one of the system's kinds as a whole number (missing: 0). */
export function coinsOf(c, L) {
  const out = {};
  for (const k of L.coins) out[k.id] = Math.max(0, Math.floor(Number((c || {})[k.id]) || 0));
  return out;
}
/** Their value in the smallest coin. */
export const coinValue = (c, L) => L.coins.reduce((n, k) => n + (Number((c || {})[k.id]) || 0) * k.cp, 0);
/** Coins in words: "3 gp 4 sp", or "no coins". */
export function coinLabel(c, L) {
  const parts = L.coins.filter((k) => (c || {})[k.id]).map((k) => `${Number(c[k.id]).toLocaleString('en-US')} ${k.label}`);
  return parts.length ? parts.join(' ') : 'no coins';
}
/** Two sets of coins together. */
export function addCoins(a, b, L) {
  const out = coinsOf(a, L), add = coinsOf(b, L);
  for (const k of L.coins) out[k.id] += add[k.id];
  return out;
}
/** Read "5 gp 3 sp", "12gp" or "250" into coins (a bare number is the system's bareCoin, else its first coin). */
export function parseCoins(s, L) {
  const out = coinsOf({}, L), text = String(s || '').trim();
  if (!text) throw new Error('how many coins?');
  const ids = L.coins.map((k) => k.id);
  const re = new RegExp(`(-?\\d[\\d,]*)\\s*(${ids.join('|')})?`, 'gi');
  let m, any = false;
  while ((m = re.exec(text))) {
    const n = Number(m[1].replace(/,/g, '')), id = (m[2] || (ids.includes(L.bareCoin) ? L.bareCoin : ids[0])).toLowerCase();
    if (n < 0) throw new Error('coins cannot be negative');
    out[id] += n; any = true;
  }
  if (!any) throw new Error(`"${text}" is not an amount of coins`);
  return out;
}

/**
 * Take coins worth `want` from `have`: the coins asked for where they are there, the rest by value, breaking a larger
 * coin into smaller ones when needed (a gold piece into ten silver). Returns {left, taken}; throws when not enough.
 */
export function takeCoins(have, want, L) {
  const left = coinsOf(have, L), w = coinsOf(want, L), taken = coinsOf({}, L);
  const need = coinValue(w, L);
  if (coinValue(left, L) < need) throw new Error(`not enough coins: ${coinLabel(left, L)} is less than ${coinLabel(w, L)}`);
  let R = need;
  for (const k of L.coins) { const n = Math.min(left[k.id], w[k.id]); left[k.id] -= n; taken[k.id] += n; R -= n * k.cp; }
  const order = L.coins;   // largest first
  for (let guard = 0; R > 0 && guard < 100; guard++) {
    for (const k of order) { const n = Math.min(left[k.id], Math.floor(R / k.cp)); left[k.id] -= n; taken[k.id] += n; R -= n * k.cp; }
    if (R <= 0) break;
    // break the smallest coin larger than what is still owed
    const big = [...order].reverse().find((k) => left[k.id] > 0 && k.cp > R);
    if (!big) break;
    const idx = order.indexOf(big), small = order[idx + 1];
    left[big.id] -= 1; left[small.id] += big.cp / small.cp;
  }
  if (R > 0) throw new Error('those coins cannot make that amount');
  return { left, taken };
}

/** Split coins evenly between n: {each, left} (what does not split stays). */
export function splitCoins(have, n, L) {
  const h = coinsOf(have, L), each = coinsOf({}, L), left = coinsOf({}, L);
  if (!(n >= 1)) throw new Error('nobody to split between');
  for (const k of L.coins) { each[k.id] = Math.floor(h[k.id] / n); left[k.id] = h[k.id] - each[k.id] * n; }
  return { each, left };
}

// ---- carrying ----

/**
 * What a character carries, for the tab and the rules: {rows: [{i, item, view}], bulk (system.bulkTotal), limits
 * ({encumbered, max} or null), encumbered, overMax, invested (count), investedLimit, warnings: [words]}.
 */
export function carried(actor, coins, content, L, view = 'gm') {
  const items = (actor && actor.items) || [];
  const rows = items.map((item, i) => ({ i, item, view: lootView(asCarried(item), content, view, L), doc: resolveLoot(item, content).doc })).filter((r) => !r.doc.kind || !STAT_BLOCK.has(r.doc.kind));
  const bulk = L.bulkTotal(rows.map((r) => ({ doc: r.doc, qty: r.item.qty ?? 1, carry: r.item.carry || (r.doc.kind === 'armor' ? 'worn' : null) })), coins || {});
  const limits = L.bulkLimits(actor && actor.attributes ? actor.attributes : {});
  const invested = rows.filter((r) => r.view.isInvested || (L.invests(r.doc) && !r.item.carry && r.item.invested !== false)).length;
  const warnings = [], W = L.words || PLAIN_LOOT.words;
  const enc = !!limits && bulk.tenths > limits.encumbered * 10;
  const overMax = !!limits && bulk.tenths > limits.max * 10;
  if (overMax) warnings.push(`over the most it can carry (${limits.max} ${W.bulk})`);
  else if (enc) warnings.push(`${W.encumbered} (over ${limits.encumbered} ${W.bulk})`);
  if (bulk.over) warnings.push(`its containers are ${L.bulkLabel(bulk.over)} ${W.bulk} over their capacity`);
  if (L.investedLimit && invested > L.investedLimit) warnings.push(`${invested} ${W.invested} items: the limit is ${L.investedLimit}`);
  return { rows, bulk, limits, encumbered: enc, overMax, invested, investedLimit: L.investedLimit, warnings };
}
const STAT_BLOCK = new Set(['action', 'feat', 'spell', 'melee', 'ranged', 'lore', 'effect', 'condition']);

/**
 * A token's effects with the system's encumbered condition put on or taken off to match `on`; null when nothing
 * changes. Only the one this put on (its `source`) is ever taken off; one the GM set stays.
 */
export function encumberedEffects(effects, on, L) {
  const e = L.encumbered;
  if (!e) return null;
  const list = effects || [];
  const mine = list.find((x) => x.id === e.condition && x.source === e.source);
  const any = list.some((x) => x.id === e.condition);
  if (on && !any) return [...list, { id: e.condition, source: e.source }];
  if (!on && mine) return list.filter((x) => x !== mine);
  return null;
}

/** An item in words for the audit log and the tool: "2 × Healing Potion (Minor)" (the truth). */
export function itemWords(item, content) {
  const { doc } = resolveLoot(item, content);
  const q = item.qty ?? 1;
  return `${q > 1 ? `${q} × ` : ''}${doc.name}`;
}
