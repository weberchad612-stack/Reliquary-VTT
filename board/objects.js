// Object tokens (docs/design/board.md, Object tokens): things on the map that hold items or a note. A chest, a
// shelf, a coffin, an altar; a hazard (falling shelves, a wall of grasping shadows) when its game data names one.
// System-free: what an item is and what coins exist come from the ruleset's loot rules (board/loot.js).
//
// The token (tokens/<id>) has kind 'object', a name and usually `hidden` until the party finds it. Its game data is
// actors/<id>: {system, kind: 'object', name, text?, note?, items?, coins?, hazard?, locked?, find_dc?, room?}
//   text     what the party sees when they look at it (players and GM)
//   note     the GM's notes: checks, DCs, what happens (GM only)
//   items    what is inside, the stash's item shape (a library item by ref, or a custom one)
//   coins    loose coins by the system's kinds
//   hazard   a content key (hazard/falling-shelves): the object is a hazard; its stat block is in the content
//   locked   how it opens ("Thievery DC 15, 2 successes"): the GM opens it when the party gets in
//   find_dc  the Perception DC to find what is inside (a buried footlocker, a shard under a pot)
//   room     the keyed area it is in (A14), for where loot was found
// Its live state is actorstate/<id>: {open: true} once the party may see inside (the GM opens it; an unlocked
// container with no find DC opens when a player looks in).

import { lootItem } from './loot.js';

export const isObject = (t) => !!t && t.kind === 'object';

/** Whether the party may see inside: opened, or nothing stands in the way (unlocked, nothing to find). */
export function isOpen(actor = {}, state = {}) {
  return !!state.open || (!actor.locked && !actor.find_dc);
}

/**
 * What a view sees of an object: {name, text, note?, hazard?, locked?, find_dc?, open, items: [{i, item}], coins}.
 * Players see the contents only when it is open; the GM always does.
 */
export function objectView(actor = {}, state = {}, view = 'player') {
  const gm = view === 'gm', open = isOpen(actor, state);
  const items = (actor.items || []).map((item, i) => ({ i, item }));
  const coins = actor.coins && Object.values(actor.coins).some((n) => n > 0) ? actor.coins : null;
  return {
    name: actor.name || '',
    text: actor.text || '',
    note: gm ? actor.note || '' : '',
    hazard: gm ? actor.hazard || null : null,
    locked: actor.locked && (gm || !open) ? actor.locked : null,
    find_dc: gm ? actor.find_dc || null : null,
    open,
    items: gm || open ? items : [],
    coins: gm || open ? coins : null,
    empty: !items.length && !coins,
  };
}

/**
 * Take item i (all of it) out of an object into the stash: {actor (with the item gone), stashItem}. found says
 * where it came from: {from: the object's name, where: {map, area}, game?}.
 */
export function takeFromObject(actor, i, found, now = new Date().toISOString(), by = 'gm') {
  const items = [...(actor.items || [])];
  const item = items[i];
  if (!item) throw new Error(`no item ${i} in ${actor.name || 'the object'}`);
  items.splice(i, 1);
  const { carry: _c, invested: _v, ...rest } = item;
  const stashItem = { ...lootItem({ ...rest, by }, now), ...(rest.runes ? { runes: rest.runes } : {}), ...(rest.usage ? { usage: rest.usage } : {}) };
  if (rest.identified === false) stashItem.identified = false;
  if (found) stashItem.found = found;
  return { actor: { ...actor, items }, stashItem };
}

/** Take everything: {actor (empty), stashItems, coins (or null)}. */
export function takeAllFromObject(actor, found, now, by) {
  let a = actor;
  const stashItems = [];
  while ((a.items || []).length) {
    const r = takeFromObject(a, 0, found, now, by);
    a = r.actor;
    stashItems.push(r.stashItem);
  }
  const coins = actor.coins && Object.values(actor.coins).some((n) => n > 0) ? actor.coins : null;
  const { coins: _c, ...rest } = a;
  return { actor: rest, stashItems, coins };
}

/** Where loot from this object was found. */
export function foundAt(actor = {}, token = {}, mapId = null, game = null) {
  return {
    from: actor.name || token.name || 'an object',
    where: Object.fromEntries(Object.entries({ map: mapId, area: actor.room }).filter(([, v]) => v)),
    ...(game ? { game } : {}),
  };
}

