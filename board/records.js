// A campaign as database records, and back (docs/design/board.md section 3).
//
// On disk a campaign is a pack (pack.json and maps/<id>/: map.json, walls, terrain, lighting, image) and a
// save folder (campaign.json and maps/<id>.json, one map state per map). In the board's database the
// same campaign is a set of small records, all paths two parts long:
//
//   board/meta         which campaign is loaded: campaign, pack and ruleset ids, schema, when loaded and saved
//   maps/<map>         a map record (map.json without file names) and its image: {asset, fingerprint, w, h}
//   walls/<map>.<n>    wall segments in chunks of WALL_CHUNK
//   terrain/<map>      {map, areas}
//   lighting/<map>     {map, regions, lights}
//   state/table        the table's settings: current map, sky, colour and animation switches, notes
//   state/clock        the game clock: {now, start} in seconds since year 1 of the ruleset's calendar
//   state/encounter    the encounter under way: round, turn, combatants in initiative order (engine/time/encounter.js)
//   mapstate/<map>     a map's state without its tokens and explored area
//   tokens/<id>        one record per token, with the map it is on
//   explored/<map>.<n> the party's explored area on a map, in chunks of EXPLORED_CHUNK rings
//   templates/<id>     one placed area template, with the map it is on
//   notes/<id>         one map note, with the map it is on
//   actors/<id>        a creature's game data (same id as its token): a PC's build, or a stat block reference
//                      and its own differences (docs/design/game-data.md)
//   actorstate/<id>    what is happening to it now: HP, temporary HP, resources spent (written often)
//   content/<kind>.<slug>  the game content the campaign's creatures use, only those documents: stat blocks, items
//                          (content key <kind>/<slug>; one naming its source is content/<source>.<kind>.<slug>)
//   fxlib/pack         the pack's visual effects ({palette, effects, fallbacks}; its effects.json), if it has any
//   fx/<time>-<n>      a visual effect playing now (written by Claude; not part of the save; board/fx.js)
//   chat/<time36>-<n>  a chat message: Claude's narration, a ruling, an NPC speaking, a roll card, a table event
//                      (board/chat.js); part of the save (chat.json)
//   dice/<time36>-<n>  a roll's dice, for the dice statistics (board/dice.js); part of the save (dice.json)
//   state/session      when this session began, for the dice statistics: {started} (saved as campaign.session)
//   replay/<id>        a batch of resolved actions the table reveals step by step (board/replay.js); the save keeps the
//                      ones not finished and the last KEEP_REPLAYS finished (replays.json)
//   state/adjudicating "Claude is adjudicating": the banner over the map while Claude resolves a batch (not saved)
//   audit/<time36>-<n> the GM's audit log: every change to the game, in words (board/audit.js); part of the save
//                      (audit.json). A chat message of the retired kind 'log' becomes an audit entry on load and save.
//
// Pure functions, no I/O: tools/campaign.mjs reads and writes the files, the board reads and writes the store.

export const SCHEMA = 1;
export const WALL_CHUNK = 400;
export const EXPLORED_CHUNK = 200;
export const KEEP_REPLAYS = 5;   // finished replays a save keeps (every unfinished one is kept)

/** Fields of a map state kept in its mapstate record (tokens and explored have records of their own). */
const MAPSTATE_SKIP = new Set(['$schema', 'tokens', 'explored', 'templates', 'notes']);
/** Fields of campaign.json kept in the table state record. */
export const TABLE_FIELDS = ['current_map', 'discovered', 'sky_light', 'light_colour', 'light_animation', 'notes'];

const chunks = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out.length ? out : [[]];
};
const pad = (n) => String(n).padStart(3, '0');

/**
 * Records for a whole campaign.
 * @param {object} c
 * @param {object} c.campaign   campaign.json: {id, title, pack: {id, version}, ruleset, current_map, ...}
 * @param {object} c.pack       pack.json: {id, title, version, ruleset, maps}
 * @param {Array}  c.maps       [{id, map (map.json), segs, terrain (areas), lighting, image: {asset, fingerprint, w, h}}]
 * @param {object} c.mapStates  {mapId: map state (as in saves/<campaign>/maps/<id>.json)}
 * @param {object} [c.effects]  the pack's effects.json: {palette, effects, fallbacks} (rulesets/<id>/effects.js form)
 * @param {string} [c.now]      ISO time for board/meta
 * @returns {object}  {path: data}
 */
export function campaignRecords({ campaign, pack, maps, mapStates = {}, effects = null, actors = {}, actorStates = {}, content = {}, chat = [], audit = [], dice = [], replays = [], now = new Date().toISOString() }) {
  if (campaign.pack && campaign.pack.id && campaign.pack.id !== pack.id) {
    throw new Error(`campaign "${campaign.id}" is for pack "${campaign.pack.id}", not "${pack.id}"`);
  }
  const ruleset = campaign.ruleset || pack.ruleset;
  if (pack.ruleset && ruleset !== pack.ruleset) throw new Error(`campaign ruleset "${ruleset}" does not match pack ruleset "${pack.ruleset}"`);
  const r = {};
  r['board/meta'] = {
    schema: SCHEMA,
    campaign: { id: campaign.id, title: campaign.title || campaign.id },
    pack: { id: pack.id, title: pack.title || pack.id, version: pack.version || '0' },
    ruleset,
    maps: maps.map((m) => m.id),
    loaded_at: now,
    saved_at: campaign.saved_at || null,
  };
  for (const m of maps) {
    const { walls, terrain, lighting, ...map } = m.map;
    r[`maps/${m.id}`] = { ...map, id: m.id, image: { ...(m.map.image || {}), ...(m.image || {}) } };
    if (m.map.kind !== 'area') chunks(m.segs || [], WALL_CHUNK).forEach((segs, n) => { r[`walls/${m.id}.${pad(n)}`] = { map: m.id, n, segs }; });
    if (m.terrain && m.terrain.length) r[`terrain/${m.id}`] = { map: m.id, areas: m.terrain };
    if (m.lighting) {
      const { $schema, ...lighting } = m.lighting;
      r[`lighting/${m.id}`] = { map: m.id, ...lighting };
    }
  }
  for (const [id, a] of Object.entries(actors)) r[`actors/${id}`] = a;
  for (const [id, s] of Object.entries(actorStates)) r[`actorstate/${id}`] = s;
  for (const [key, doc] of Object.entries(content)) r[contentPath(key)] = doc;
  for (const { id, ...m } of chat) { if (m.kind === 'log') r[`audit/${id}`] = auditFromLog(m); else r[`chat/${id}`] = m; }
  for (const { id, ...e } of audit) r[`audit/${id}`] = e;
  for (const { id, ...d } of dice) r[`dice/${id}`] = d;
  for (const { id, ...d } of replays) r[`replay/${id}`] = d;
  if (effects && effects.effects && Object.keys(effects.effects).length) r['fxlib/pack'] = { palette: effects.palette || {}, effects: effects.effects, fallbacks: effects.fallbacks || [] };
  r['state/table'] = Object.fromEntries(TABLE_FIELDS.filter((k) => campaign[k] !== undefined).map((k) => [k, campaign[k]]));
  if (!r['state/table'].current_map) r['state/table'].current_map = maps[0] && maps[0].id;
  if (campaign.clock) r['state/clock'] = campaign.clock;
  if (campaign.encounter) r['state/encounter'] = campaign.encounter;
  if (campaign.session) r['state/session'] = campaign.session;
  for (const [mapId, st] of Object.entries(mapStates)) {
    r[`mapstate/${mapId}`] = Object.fromEntries(Object.entries(st).filter(([k]) => !MAPSTATE_SKIP.has(k)));
    r[`mapstate/${mapId}`].map = mapId;
    for (const [tid, t] of Object.entries(st.tokens || {})) r[`tokens/${tid}`] = { ...t, map: mapId };
    for (const [aid, a] of Object.entries(st.templates || {})) r[`templates/${aid}`] = { ...a, map: mapId };
    for (const [nid, n] of Object.entries(st.notes || {})) r[`notes/${nid}`] = { ...n, map: mapId };
    const polys = (st.explored && st.explored.polys) || [];
    if (polys.length) {
      chunks(polys, EXPLORED_CHUNK).forEach((p, n) => { r[`explored/${mapId}.${pad(n)}`] = { map: mapId, n, v: st.explored.v || 1, polys: p }; });
    }
  }
  return r;
}

/** A content key ('item/longsword') as a record path ('content/item.longsword'), and back. */
// A key naming one source ('pathfinder-monster-core:creature/goblin-warrior') is 'content/<source>.<kind>.<slug>'.
export function contentPath(key) {
  const s = String(key), c = s.indexOf(':'), src = c >= 0 ? s.slice(0, c) : null, [kind, slug] = s.slice(c + 1).split('/');
  return `content/${src ? `${src}.` : ''}${kind}.${slug}`;
}
export function contentKey(path) {
  const parts = (String(path).split('/')[1] || '').split('.');
  return parts.length === 3 ? `${parts[0]}:${parts[1]}/${parts[2]}` : `${parts[0]}/${parts.slice(1).join('.')}`;
}
/** The content held in records: {'<kind>/<slug>': document}. */
export function contentFromRecords(records) {
  const out = {};
  for (const [p, d] of Object.entries(records)) if (p.startsWith('content/')) out[contentKey(p)] = d;
  return out;
}

/** Records belonging to one map, from a {path: data} object or a list: walls joined, chunks in order. */
export function mapFromRecords(records, mapId) {
  const get = (p) => records[p] ?? null;
  const map = get(`maps/${mapId}`);
  if (!map) return null;
  const inColl = (coll) => Object.entries(records)
    .filter(([p, d]) => p.startsWith(coll + '/') && d && d.map === mapId)
    .sort((a, b) => a[1].n - b[1].n).map(([, d]) => d);
  const lighting = get(`lighting/${mapId}`);
  return {
    map,
    segs: inColl('walls').flatMap((d) => d.segs),
    terrain: (get(`terrain/${mapId}`) || {}).areas || [],
    lighting: lighting ? (({ map: _m, ...l }) => l)(lighting) : null,
  };
}

/** The explored area of a map from its chunk records: {v, polys}. */
export function exploredFromRecords(chunkRecords) {
  const list = [...chunkRecords].sort((a, b) => a.n - b.n);
  return { v: Math.max(1, ...list.map((d) => d.v || 1)), polys: list.flatMap((d) => d.polys) };
}

/** Explored-area chunk records for one map (to replace the old chunks wholesale). */
export function exploredRecords(mapId, explored) {
  const out = {};
  chunks((explored && explored.polys) || [], EXPLORED_CHUNK).forEach((p, n) => {
    if (p.length || n === 0) out[`explored/${mapId}.${pad(n)}`] = { map: mapId, n, v: (explored && explored.v) || 1, polys: p };
  });
  return out;
}

/**
 * The save on disk from the records: campaign.json and one map state per map.
 * @param {object} records  {path: data} (everything the store holds)
 * @param {object} [base]   the campaign.json being updated (fields the board does not hold are kept)
 * @returns {{campaign: object, mapStates: object, actors: object, actorStates: object}}
 */
export function saveFromRecords(records, base = {}) {
  const meta = records['board/meta'];
  if (!meta) throw new Error('no campaign is loaded (board/meta is missing)');
  const table = records['state/table'] || {};
  const campaign = { ...base, id: meta.campaign.id, title: meta.campaign.title, pack: { id: meta.pack.id, version: meta.pack.version }, ruleset: meta.ruleset };
  for (const k of TABLE_FIELDS) { if (table[k] !== undefined) campaign[k] = table[k]; else delete campaign[k]; }
  for (const k of ['clock', 'encounter', 'session']) { if (records[`state/${k}`]) campaign[k] = records[`state/${k}`]; else delete campaign[k]; }
  const mapStates = {}, actors = {}, actorStates = {}, chat = [], audit = [], dice = [], replays = [];
  const ensure = (id) => (mapStates[id] = mapStates[id] || { map: id });
  for (const [p, d] of Object.entries(records)) {
    const [coll] = p.split('/');
    if (coll === 'mapstate') Object.assign(ensure(d.map), d);
    if (coll === 'tokens') { const { map, ...t } = d; (ensure(map).tokens = ensure(map).tokens || {})[p.split('/')[1]] = t; }
    if (coll === 'templates') { const { map, ...t } = d; (ensure(map).templates = ensure(map).templates || {})[p.split('/')[1]] = t; }
    if (coll === 'notes') { const { map, ...n } = d; (ensure(map).notes = ensure(map).notes || {})[p.split('/')[1]] = n; }
    if (coll === 'actors') actors[p.split('/')[1]] = d;
    if (coll === 'actorstate') actorStates[p.split('/')[1]] = d;
    if (coll === 'chat') { if (d.kind === 'log') audit.push({ id: p.split('/')[1], ...auditFromLog(d) }); else chat.push({ id: p.split('/')[1], ...d }); }
    if (coll === 'audit') audit.push({ id: p.split('/')[1], ...d });
    if (coll === 'dice') dice.push({ id: p.split('/')[1], ...d });
    if (coll === 'replay') replays.push({ id: p.split('/')[1], ...d });
  }
  chat.sort((a, b) => (a.id < b.id ? -1 : 1));
  audit.sort((a, b) => (a.id < b.id ? -1 : 1));
  dice.sort((a, b) => (a.id < b.id ? -1 : 1));
  replays.sort((a, b) => (a.id < b.id ? -1 : 1));
  const done = replays.filter((x) => (x.n || 0) >= (x.steps || []).length), keep = new Set(done.slice(-KEEP_REPLAYS).map((x) => x.id));
  const savedReplays = replays.filter((x) => (x.n || 0) < (x.steps || []).length || keep.has(x.id));
  for (const id of meta.maps || []) {
    const ex = Object.entries(records).filter(([p, d]) => p.startsWith('explored/') && d.map === id).map(([, d]) => d);
    if (ex.length) ensure(id).explored = exploredFromRecords(ex);
  }
  for (const st of Object.values(mapStates)) delete st.$schema;
  return { campaign, mapStates, actors, actorStates, chat, audit, dice, replays: savedReplays };
}

/** A chat message of the retired kind 'log' (a change-log line) as an audit entry. */
export function auditFromLog(m) {
  const out = { at: m.at, by: m.by || 'gm', text: m.text || '' };
  if (m.map) out.map = m.map;
  return out;
}
