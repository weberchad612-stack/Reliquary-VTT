// Travelling between maps, and the menu of maps on the current map's name (docs/design/board.md, section 7).
//
// - The GM view lists every map in the adventure with every entrance; unfound entrances are marked.
//   Choosing one previews that map, centred on the entrance, on this screen only: no token moves.
// - The player view lists the maps the party has discovered (and the map it is on), each with the
//   entrances the party knows. Choosing one moves the PCs on the current map there, overflowing onto the
//   nearest free squares that can be walked to. An entrance on the current map is taken: the party goes
//   through to its partner entrance on the map it leads to. Arrival squares follow the pack format
//   (docs/design/maps.md, section 3): a link's `arrive` cells are on the map it leads to, so arriving at
//   entrance E uses the arrive cells of E's partner (the link that leads to E), else E's own cells.
// - An area map (kind "area": a town) has no entrances and no sub-menu: it is one entry. The GM previews it;
//   players travel to it (the PCs go with the party, undrawn) and leave it by choosing an entrance of a
//   battle map, where they arrive on the entrance's own squares. A battle map's entrance may lead to an
//   area map; taking it goes there.
// - Every battle map has a starting area (`start`): the first item of its sub-menu. The GM previews it;
//   players travel there (from another map) and are placed on its squares, overflowing as at an entrance.
// - Discovery is never automatic: Claude marks maps discovered (state/table `discovered`) and entrances
//   found (`links_found` in each map's state), by ruling or because the user says so. The one exception:
//   arriving through an entrance makes the way back known (the entrance and its partner on the map the
//   party came from).
//
// Pure functions; the engine's movement and occupancy functions are passed in, so the tests use the real
// engine and the board uses the bundled one.

/** Is this entrance known to the party: found in the pack, or found in play? */
export function isKnown(mapId, link, linksFound = {}) {
  return !!link.found || (linksFound[mapId] || []).includes(link.id);
}

/** The entrance a link leads to on its target map (its partner), if the pack pairs them. */
export function partnerOf(link, maps) {
  if (!link.to_link) return null;
  const target = maps.find((m) => m.id === link.to_map);
  const l = target && (target.links || []).find((x) => x.id === link.to_link);
  return l ? { map: target, link: l } : null;
}

/** The link id that stands for a battle map's starting area (pack ids never start with "_"). */
export const START = '_start';

/** Menu ids for travel entries: 'travel:<view|go>:<map>[:<link>]'. */
export const travelId = (kind, mapId, linkId) => ['travel', kind, mapId, linkId].filter(Boolean).join(':');
export function parseTravelId(id) {
  const [t, kind, map, link] = String(id).split(':');
  return t === 'travel' ? { kind, map, link: link || null } : null;
}

/**
 * The menu on the current map's name (a definition for board/menu.js).
 * @param {object} o
 * @param {Array} o.maps        [{id, name, links}] in the campaign's order
 * @param {string} o.view       'player' or 'gm'
 * @param {string} o.current    the map the party is on
 * @param {string} [o.shown]    the map on screen (differs while the GM previews)
 * @param {Array} [o.discovered]  map ids the party has discovered
 * @param {object} [o.linksFound] map id -> ids of entrances found in play
 */
export function travelMenu({ maps, view, current, shown = current, discovered = [], linksFound = {} }) {
  const byId = new Map(maps.map((m) => [m.id, m]));
  const name = (id) => (byId.get(id) && byId.get(id).name) || id;
  const gm = view === 'gm';
  const visible = gm ? maps : maps.filter((m) => m.id === current || discovered.includes(m.id));
  const isArea = (id) => (byId.get(id) || {}).kind === 'area';
  const items = visible.map((m) => {
    if (m.kind === 'area') {
      const here = m.id === current;
      if (gm) return { id: travelId('view', m.id), label: m.name || m.id, kind: 'command', tag: here ? 'party here' : m.id === shown ? 'previewing' : undefined, hint: `Preview ${m.name || m.id} on this screen` };
      return { id: travelId('go', m.id), label: m.name || m.id, kind: 'command', disabled: here, tag: here ? 'here' : undefined, hint: here ? undefined : `Move the party to ${m.name || m.id}` };
    }
    const sub = [];
    if (gm) sub.push({ id: travelId('view', m.id), label: 'Whole map', kind: 'command', hint: `Preview ${m.name || m.id} on this screen` });
    if (m.start) {
      if (gm) sub.push({ id: travelId('view', m.id, START), label: 'Starting area', kind: 'command', hint: 'Preview, centred on the starting area' });
      else if (m.id === current) sub.push({ id: travelId('go', m.id, START), label: 'Starting area', kind: 'command', disabled: true, tag: 'here' });
      else sub.push({ id: travelId('go', m.id, START), label: 'Starting area', kind: 'command', hint: `Move the party to the starting area of ${m.name || m.id}` });
    }
    const links = (m.links || []).filter((l) => gm || isKnown(m.id, l, linksFound));
    if (gm && links.length) sub.push({ sep: true });
    for (const l of links) {
      const known = isKnown(m.id, l, linksFound);
      const e = { id: travelId(gm ? 'view' : 'go', m.id, l.id), label: l.label, kind: 'command' };
      if (gm) {
        e.hint = `Preview, centred on ${l.label}`;
        if (!known) { e.tag = 'not found'; e.dim = true; }
      } else if (m.id === current) {
        // An entrance here is taken: through to its partner on the map it leads to.
        const p = partnerOf(l, maps);
        e.label = `${l.label} → ${discovered.includes(l.to_map) ? name(l.to_map) : 'unexplored'}`;
        if (!p && !isArea(l.to_map)) { e.disabled = true; e.tag = 'not linked'; }
        else e.hint = `Take the ${l.label} with the party`;
      } else {
        e.hint = `Move the party to the ${l.label} in ${m.name || m.id}`;
      }
      sub.push(e);
    }
    if (!gm && !links.length && !m.start) sub.push({ id: travelId('none', m.id), label: 'No known entrances', kind: 'command', disabled: true });
    const tag = m.id === current ? (gm ? 'party here' : 'here') : m.id === shown ? 'previewing' : undefined;
    return { id: 'travel-map:' + m.id, label: m.name || m.id, tag, items: sub };
  });
  return [{ id: 'menu-travel', label: name(shown), hint: gm ? 'Every map and entrance: preview any of them' : 'Maps you have discovered', items }];
}

/**
 * Where a party arrives: the entrance's arrival squares first, then the nearest free squares that can be
 * walked to from them (breadth-first by steps, diagonals allowed, through walls never).
 * @param {object} o
 * @param {object} o.pm          the target map prepared for movement (Engine.prepareMove)
 * @param {Array} o.cells        the entrance's arrival squares [[x, y], ...]
 * @param {Array} o.travellers   [{id, size}] in the order they are placed
 * @param {Array} o.occupants    tokens already on the target map (they block as usual)
 * @param {object} o.engine      {fits, canStep, blockersAt}
 * @param {number} [o.limit=2000] squares searched at most
 * @returns {{placed: Array<{id, x, y}>, unplaced: Array<string>}}
 */
export function planArrival({ pm, cells, travellers, occupants = [], engine, limit = 2000 }) {
  const { fits, canStep, blockersAt } = engine;
  const key = (x, y) => x + ',' + y;
  const order = [];
  const seen = new Set();
  const queue = [];
  for (const [x, y] of cells) {
    if (seen.has(key(x, y)) || !fits(pm, x, y, 1)) continue;
    seen.add(key(x, y)); order.push([x, y]); queue.push([x, y]);
  }
  // Breadth-first outward from the arrival squares, one step at a time, as a Medium creature walks.
  for (let i = 0; i < queue.length && order.length < limit; i++) {
    const [x, y] = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (seen.has(key(nx, ny))) continue;
      if (!canStep(pm, { x, y, size: 1 }, dx, dy)) continue;
      seen.add(key(nx, ny)); order.push([nx, ny]); queue.push([nx, ny]);
    }
  }
  const placed = [], unplaced = [];
  const here = occupants.slice();
  for (const t of travellers) {
    const size = t.size || 1;
    const spot = order.find(([x, y]) => fits(pm, x, y, size) && !blockersAt({ ...t, size }, x, y, here).length);
    if (!spot) { unplaced.push(t.id); continue; }
    placed.push({ id: t.id, x: spot[0], y: spot[1] });
    here.push({ ...t, size, x: spot[0], y: spot[1] });
  }
  return { placed, unplaced };
}

/**
 * The party's move to entrance `linkId` on map `toMap`, as record changes for the store.
 * @returns {{target: {map, link}, via: object|null, cells: Array, found: object, travellers: Array}}: `cells`
 *   are the arrival squares on the target map, in order; `found` is
 *   map id -> entrance ids to add to that map's links_found (the arrival entrance and, when it pairs with
 *   an entrance on the map the party left, that one: the way back).
 */
export function travelPlan({ maps, from, toMap, linkId, tokens }) {
  const fromMap = maps.find((m) => m.id === from);
  let target = null, via = null;
  const area = (id) => (maps.find((m) => m.id === id) || {}).kind === 'area';
  if (toMap === from) {
    // Taking an entrance on this map: through to its partner, or to the area map it leads to.
    via = ((fromMap && fromMap.links) || []).find((l) => l.id === linkId) || null;
    target = via && (area(via.to_map) ? { map: maps.find((m) => m.id === via.to_map), link: null } : partnerOf(via, maps));
  } else if (area(toMap)) {
    target = { map: maps.find((m) => m.id === toMap), link: null };
  } else if (linkId === START) {
    // The starting area of a battle map: its own squares; nothing becomes known.
    const m = maps.find((x) => x.id === toMap);
    if (!m || !m.start) return null;
    const travellers = Object.entries(tokens).filter(([, t]) => t.kind === 'pc' && !t.dead).map(([id, t]) => ({ ...t, id }))
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
    return { target: { map: m, link: null, start: true }, via: null, cells: m.start.map((c) => c.slice()), found: {}, travellers };
  } else {
    const m = maps.find((x) => x.id === toMap);
    const l = m && (m.links || []).find((x) => x.id === linkId);
    if (l) target = { map: m, link: l };
  }
  if (!target) return null;
  const travellers = Object.entries(tokens).filter(([, t]) => t.kind === 'pc' && !t.dead).map(([id, t]) => ({ ...t, id }))
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  if (!target.link) return { target, via, cells: null, found: {}, travellers };   // an area map: no squares
  // Arrival squares (on the target map): the arrive cells of the link that leads to the target entrance.
  const into = via || (() => {
    const p = partnerOf(target.link, maps);
    return p && p.link.to_map === target.map.id && p.link.to_link === target.link.id ? p.link : null;
  })();
  const cells = (into && into.arrive && into.arrive.length ? into.arrive : target.link.at).map((c) => c.slice());
  const found = { [target.map.id]: [target.link.id] };
  const back = target.link.to_map === from && target.link.to_link ? target.link.to_link : via && via.id;
  if (back && target.link.to_map === from) found[from] = [back];
  return { target, via, cells, found, travellers };
}
