#!/usr/bin/env node
// The character builder from chat (docs/design/game-data.md section 9): Claude and a player build a character step
// by step. The game system's builder is rulesets/<system>/builder.js (the campaign's ruleset); this tool keeps the
// drafts and reaches it.
//
// A draft lives in the campaign save, <save>/builds/<id>.json, until it is finished; the campaign's builder settings
// (the books its options come from) in <save>/builder.json. A step is "<level>:<step>" as `next` prints it.
//
//   node tools/builder.mjs new <save> --name NAME [--player P] [--level N]      a draft; prints its id and first steps
//   node tools/builder.mjs list <save>                                          the drafts
//   node tools/builder.mjs next <save> <id> [--json]                            the steps still to take, problems, GM checks
//   node tools/builder.mjs options <save> <id> <step> [--all] [--search W] [--limit N] [--json]
//       What the step offers (--all: with the blocked ones and why). Needs: the GM's leave; GM checks: prerequisites
//       the builder cannot read.
//   node tools/builder.mjs choose <save> <id> <step> <value> [value...]      make a choice; prints the next steps
//   node tools/builder.mjs clear <save> <id> <step>                          take a choice back
//   node tools/builder.mjs approve <save> <id> <what> [--by NAME]            the GM allows an uncommon or rare option
//   node tools/builder.mjs level <save> <id> <n>                             the level to build to
//   node tools/builder.mjs preview <save> <id> [--json]                      the character as it stands
//   node tools/builder.mjs finish <save> <id> --to party|swap|bullpen [--out NAME] [--at X,Y] [--map ID]
//        [--image FILE --crop face|top|center] [--records FILE]
//       The character is done (no step or problem may be left): writes <save>/actors/<id>.json and its coins, then
//       party: its token joins the party on the party's map (beside them, or --at); swap: it takes the place of
//       --out, who goes to the bullpen; bullpen: it waits in <save>/bullpen.json, off the board. --image: the
//       player's picture, made into its token and portrait by the adventure importer's tokenart.py (the pack's
//       art/pcs/). Prints {lines, writes}: the board's records to write (db_write) for a campaign that is loaded.
//   node tools/builder.mjs bullpen <save>                                    the characters waiting
//   node tools/builder.mjs field <save> <name> --to party|swap [--out NAME] [--at X,Y] [--records FILE]
//   node tools/builder.mjs bench <save> <name> [--records FILE]              a PC leaves the board for the bullpen
//   node tools/builder.mjs settings <save> [--books "A|B"] [--all-books] [--series "S|T"]
//       the campaign's books (default: all) and its adventure's name(s): options from its books (a player's guide)
//       are the campaign's own, listed first and marked * (the packs' "series" set them too)
//   node tools/builder.mjs books [--system pf2e]                              the books in the open content
//   node tools/builder.mjs report [--system pf2e] [--json] [--class <slug>]  the building rules it cannot run yet

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gameArgs, findPackDir, campaignPackIds } from './campaign.mjs';
import { loadMarching } from './marching.mjs';
import { readRecords } from './replay.mjs';
import { prepareMove, fits, canStep } from '../engine/movement/movement.js';
import { blockersAt } from '../engine/tokens/occupancy.js';
import { marchMembers, marchSlots } from '../engine/tokens/marching.js';
import { contentPath } from '../board/records.js';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n'); };

/** The game system's builder module (rulesets/<system>/builder.js). */
export async function systemBuilder(system = 'pf2e') {
  const f = path.join(ROOT, 'rulesets', system, 'builder.js');
  if (!fs.existsSync(f)) throw new Error(`ruleset "${system}" has no character builder (rulesets/${system}/builder.js)`);
  return import(pathToFileURL(f).href);
}

const rulesetOf = (save) => { const f = path.join(save, 'campaign.json'); return fs.existsSync(f) ? readJson(f).ruleset || 'pf2e' : 'pf2e'; };
const settingsOf = (save) => {
  const f = path.join(save, 'builder.json');
  const st = fs.existsSync(f) ? readJson(f) : { sources: null };
  // the adventure the campaign plays: each pack's "series" (its Adventure Path or adventure's name), and any the
  // builder settings add; options from its books are the campaign's own (docs/design/game-data.md 9.12)
  const series = new Set(st.series || []);
  try {
    const c = readJson(path.join(save, 'campaign.json'));
    for (const id of campaignPackIds(c)) { try { const p = readJson(path.join(findPackDir(id, [save]), 'pack.json')); for (const x of [].concat(p.series || [])) series.add(x); } catch { /* a pack not here */ } }
  } catch { /* no campaign file */ }
  return { ...st, series: [...series] };
};
const draftFile = (save, id) => path.join(save, 'builds', `${id}.json`);
const readDraft = (save, id) => { const f = draftFile(save, id); if (!fs.existsSync(f)) throw new Error(`no draft ${id} in ${save}/builds`); return readJson(f); };
const saveDraft = (save, d) => writeJson(draftFile(save, d.id), { ...d, updated: new Date().toISOString() });

/** The steps, problems and GM checks of a draft, as lines for chat. */
function stepLines(B, d, max = 8) {
  const { steps, result } = B.steps(d.build);
  const lines = [];
  if (!steps.length && !result.problems.length) lines.push('Nothing left to choose: ready to finish.');
  for (const s of steps.slice(0, max)) lines.push(`${s.id}${s.count > 1 ? ` (x${s.count})` : ''}: ${s.text}`);
  if (steps.length > max) lines.push(`... and ${steps.length - max} more`);
  for (const p of result.problems) lines.push(`PROBLEM: ${p}`);
  for (const c of result.checks || []) lines.push(`GM CHECK: ${c.feat} (level ${c.level}) needs "${c.prerequisite}"`);
  return { lines, steps, result };
}

export async function run(argv) {
  const [cmd, ...rest] = argv;
  const flags = {}, pos = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) { const k = rest[i].slice(2); const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; flags[k] = v; } else pos.push(rest[i]);
  }
  const out = (x) => process.stdout.write((typeof x === 'string' ? x : JSON.stringify(x, null, 1)) + '\n');
  if (cmd === 'report' || cmd === 'books') {
    const sb = await systemBuilder(flags.system || 'pf2e');
    if (cmd === 'books') return out(flags.json ? sb.books() : sb.books().map((x) => `${x.title} (${x.options})`).join('\n'));
    const r = sb.report({ only: flags.class });
    return out(flags.json ? r : sb.markdown(r));
  }
  const save = pos[0];
  if (!save || !fs.existsSync(save)) throw new Error('usage: node tools/builder.mjs <command> <save> ... (see the header)');
  const sb = await systemBuilder(rulesetOf(save));
  if (cmd === 'settings') {
    const st = settingsOf(save);
    if (flags['all-books']) st.sources = null;
    if (typeof flags.books === 'string') st.sources = flags.books.split('|').map((x) => x.trim()).filter(Boolean);
    if (typeof flags.series === 'string') st.series = flags.series.split('|').map((x) => x.trim()).filter(Boolean);
    const own = fs.existsSync(path.join(save, 'builder.json')) ? readJson(path.join(save, 'builder.json')) : {};
    if (flags['all-books'] || flags.books || flags.series) writeJson(path.join(save, 'builder.json'), { ...own, sources: st.sources, ...(typeof flags.series === 'string' ? { series: st.series } : {}) });
    return out([st.sources ? `Books: ${st.sources.join('; ')}` : 'Books: all the open content', `The campaign's own options: ${st.series.length ? st.series.join('; ') : 'none (set "series" in the pack, or --series)'}`].join('\n'));
  }
  const B = sb.builder({ settings: settingsOf(save) });
  if (cmd === 'new') {
    if (!flags.name) throw new Error('new: --name NAME');
    const id = `pc-${crypto.randomBytes(4).toString('hex')}`;
    const d = { v: 1, id, name: flags.name, ...(typeof flags.player === 'string' ? { player: flags.player } : {}), ruleset: rulesetOf(save), status: 'draft', created: new Date().toISOString(),
      build: { v: 1, level: Number(flags.level) || 1, name: flags.name } };
    saveDraft(save, d);
    return out([`Draft ${id}: ${d.name}`, ...stepLines(B, d).lines].join('\n'));
  }
  if (cmd === 'list') {
    const dir = path.join(save, 'builds');
    const list = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(dir, f))) : [];
    return out(list.length ? list.map((d) => `${d.id}: ${d.name}${d.player ? ` (${d.player})` : ''}, level ${d.build.level}, ${d.status}${d.actor ? ` -> actors/${d.actor}` : ''}`).join('\n') : 'No drafts.');
  }
  if (cmd === 'bullpen') { const bp = readBullpen(save); return out(bp.pcs.length ? bp.pcs.map((x) => `${x.id}: ${x.name} (since ${x.since})`).join('\n') : 'The bullpen is empty.'); }
  if (cmd === 'field' || cmd === 'bench') {
    const who = pos[1];
    const g = gameFor(save, typeof flags.records === 'string' ? flags.records : null);
    if (cmd === 'bench') {
      const hit = Object.entries(g.tokens).find(([tid, t]) => t.kind === 'pc' && (tid === who || String(t.name).toLowerCase() === String(who).toLowerCase()));
      if (!hit) throw new Error(`no PC "${who}" on the board`);
      const [tid, t] = hit;
      const { x: _x, y: _y, map: _m, ...keep } = t;
      const placed = placeCharacter(save, g, { id: tid, actor: { name: t.name }, mode: 'bullpen', token: keep });
      const f = path.join(save, 'maps', `${t.map}.json`);
      if (fs.existsSync(f)) { const st = readJson(f); delete (st.tokens || {})[tid]; writeJson(f, st); }
      for (const op of placed.saveOps) op();
      const marching = { slots: { ...((g.marching || {}).slots || {}) }, extra: [...((g.marching || {}).extra || [])] };
      delete marching.slots[tid];
      return out(JSON.stringify({ lines: [`${t.name} leaves the board for the bullpen.`], writes: [{ op: 'delete', path: `tokens/${tid}` }, { op: 'set', path: 'state/marching', data: marching }] }, null, 1));
    }
    const bp = readBullpen(save);
    const e = bp.pcs.find((x) => x.id === who || String(x.name).toLowerCase() === String(who).toLowerCase());
    if (!e) throw new Error(`no "${who}" in the bullpen`);
    const actor = readJson(path.join(save, 'actors', `${e.id}.json`));
    const at = typeof flags.at === 'string' ? flags.at.split(',').map(Number) : null;
    const placed = placeCharacter(save, g, { id: e.id, actor, mode: flags.to === 'swap' ? 'swap' : 'party', out: flags.out, at, map: flags.map });
    for (const op of placed.saveOps) op();
    return out(JSON.stringify({ lines: placed.lines, writes: placed.writes }, null, 1));
  }
  const id = pos[1];
  const d = readDraft(save, id);
  if (cmd === 'next') { const r = stepLines(B, d, 100); return out(flags.json ? { steps: r.steps, problems: r.result.problems, checks: r.result.checks } : r.lines.join('\n')); }
  if (cmd === 'options') {
    const step = pos[2];
    const { step: s, options } = B.options(d.build, step, { all: !!flags.all, search: typeof flags.search === 'string' ? flags.search : undefined });
    const lim = Number(flags.limit) || (flags.json ? Infinity : 60);
    if (flags.json) return out({ step: s, count: options.length, options: options.slice(0, lim) });
    const line = (o) => `${o.campaign ? '* ' : ''}${o.value}${o.name !== o.value ? ` = ${o.name}` : ''}${o.hp ? ` (${o.hp} HP, ${o.key})` : ''}${o.also ? ` also ${o.also.join(', ')}` : ''}${o.level !== undefined ? ` [${o.level}]` : ''}${o.rarity ? ` (${o.rarity})` : ''}${o.legacy ? ' (legacy)' : ''}${o.needs ? ` NEEDS ${o.needs}` : ''}${o.gmChecks ? ` GM CHECKS: ${o.gmChecks.join('; ')}` : ''}${o.campaign ? ` CAMPAIGN: ${o.campaign}` : ''}${o.blocked ? ` BLOCKED: ${o.blocked.join('; ')}` : ''}${o.summary ? `\n    ${o.summary}` : ''}`;
    // options a system groups (classes by role) are printed under their group's heading
    const shown = [];
    let group = null;
    for (const o of options.slice(0, lim)) { if (o.group && o.group !== group) { group = o.group; shown.push(`-- ${group} --`); } shown.push(line(o)); }
    return out([`${step}: ${s.text || ''} (${options.length} option${options.length === 1 ? '' : 's'})`, ...shown, ...(options.length > lim ? [`... ${options.length - lim} more (--limit, --search)`] : [])].join('\n'));
  }
  if (cmd === 'choose' || cmd === 'clear') {
    const step = pos[2];
    d.build = cmd === 'choose' ? B.apply(d.build, step, pos.slice(3)) : B.clear(d.build, step);
    saveDraft(save, d);
    return out([`${cmd === 'choose' ? 'Chose' : 'Cleared'} ${step}${cmd === 'choose' ? `: ${pos.slice(3).join(', ')}` : ''}`, ...stepLines(B, d).lines].join('\n'));
  }
  if (cmd === 'approve') {
    const what = pos[2];
    d.build.approvals = [...(d.build.approvals || []).filter((a) => a.what !== what), { what, by: typeof flags.by === 'string' ? flags.by : 'GM', at: new Date().toISOString().slice(0, 10) }];
    saveDraft(save, d);
    return out(`Approved ${what}`);
  }
  if (cmd === 'level') { d.build.level = Number(pos[2]); saveDraft(save, d); return out([`Level ${d.build.level}`, ...stepLines(B, d).lines].join('\n')); }
  if (cmd === 'preview') {
    const r = B.derive(d.build);
    const pv = sb.preview(r, B.get);
    return out(flags.json ? { actor: r.actor, lines: pv.lines } : [...pv.lines, ...stepLines(B, d, 4).lines.map((l) => `  ${l}`)].join('\n'));
  }
  if (cmd === 'finish') {
    const { steps, result } = stepLines(B, d);
    if (steps.length || result.problems.length) throw new Error(`finish: ${steps.length} step(s) and ${result.problems.length} problem(s) left (next ${id})`);
    const mode = flags.to;
    if (!['party', 'swap', 'bullpen'].includes(mode)) throw new Error('finish: --to party, swap (--out NAME) or bullpen: ask the player and the GM which');
    const actorId = d.actor || `tok-${crypto.randomBytes(4).toString('hex')}`;
    const art = typeof flags.image === 'string' ? makeArt(save, actorId, flags.image, typeof flags.crop === 'string' ? flags.crop : undefined) : null;
    const g = mode === 'bullpen' ? { tokens: {}, marching: {} } : gameFor(save, typeof flags.records === 'string' ? flags.records : null);
    const at = typeof flags.at === 'string' ? flags.at.split(',').map(Number) : null;
    const placed = placeCharacter(save, g, { id: actorId, actor: result.actor, mode, out: flags.out, at, map: flags.map, art: art && art.key });
    // the save: the actor, its coins, the map and the bullpen; the board: the same records, and the content its items use
    writeJson(path.join(save, 'actors', `${actorId}.json`), result.actor);
    const coins = result.coins || null;
    if (coins) { const f = path.join(save, 'actorstate', `${actorId}.json`); writeJson(f, { ...(fs.existsSync(f) ? readJson(f) : {}), coins }); }
    for (const op of placed.saveOps) op();
    const writes = [{ op: 'set', path: `actors/${actorId}`, data: result.actor }, ...(coins ? [{ op: 'update', path: `actorstate/${actorId}`, data: { coins } }] : []), ...placed.writes];
    for (const it of result.actor.items || []) { const doc = B.get(it.ref); if (doc) writes.push({ op: 'set', path: contentPath(it.ref), data: doc }); }
    d.status = 'finished'; d.actor = actorId; d.placed = mode;
    saveDraft(save, d);
    const lines = [`Finished ${d.name} (${actorId}).`, ...placed.lines,
      ...(art ? [`Token art made from the player's picture (${path.relative(process.cwd(), art.file)}): reload the campaign (campaign.mjs ops-load) for the board to show it.`] : ['No picture yet: the board draws the token with its letter until the player gives one (finish again is not needed: run tokenart and set the token\'s art).']),
      ...(d.player ? [`Player: ${d.player} (tools/players.mjs set "${d.player}" --pcs ... to record who plays whom).`] : []),
      ...((result.checks || []).length ? [`${result.checks.length} prerequisite(s) for the GM to check.`] : [])];
    return out(flags.json ? { lines, writes } : JSON.stringify({ lines, writes }, null, 1));
  }
  throw new Error(`unknown command ${cmd}`);
}

// ---- finishing: the character onto the board, into the bullpen, or in place of another (section 9.10) ----

const bullpenFile = (save) => path.join(save, 'bullpen.json');
const readBullpen = (save) => (fs.existsSync(bullpenFile(save)) ? readJson(bullpenFile(save)) : { v: 1, pcs: [] });

/** A free square for a newcomer beside the party on a map: next to a PC, reachable from them, not occupied. */
function besideParty(g, mapId, size = 1) {
  const m = g.c.maps.find((x) => x.id === mapId);
  if (!m || !m.map.grid) return null;
  const st = g.records[`mapstate/${mapId}`] || g.c.mapStates[mapId] || {};
  const pm = prepareMove(m.segs, st, m.map.grid);
  const here = Object.entries(g.tokens).filter(([, t]) => t.map === mapId).map(([id, t]) => ({ ...t, id }));
  const pcs = here.filter((t) => t.kind === 'pc' && !t.dead);
  const probe = { kind: 'pc', size };
  for (const pc of pcs) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const x = pc.x + dx, y = pc.y + dy;
      if (!fits(pm, x, y, size) || !canStep(pm, pc, dx, dy)) continue;
      if (blockersAt({ ...probe, x, y }, x, y, here).length) continue;
      return [x, y];
    }
  }
  return null;
}

/** The token for a PC: name, kind, square, speed and the letter (the board draws the art when there is some). */
function pcToken(actor, at, mapId, art) {
  const name = actor.name || 'New character';
  return { name, kind: 'pc', x: at[0], y: at[1], map: mapId, speed: (actor.ancestry || {}).speed || 25, short: name[0].toUpperCase(), ...(art ? { art } : {}) };
}

/** The player's picture as the PC's token and portrait (tools/advimport/tokenart.py, the NPCs' look). */
function makeArt(save, key, image, crop) {
  const c = readJson(path.join(save, 'campaign.json'));
  const packDir = findPackDir(campaignPackIds(c)[0], [save]);
  const dir = path.join(packDir, 'art');
  fs.mkdirSync(path.join(dir, 'pcs'), { recursive: true });
  const src = `pcs/${key}${path.extname(image).toLowerCase() || '.png'}`;
  fs.copyFileSync(image, path.join(dir, src));
  const artFile = path.join(dir, 'art.json');
  const art = fs.existsSync(artFile) ? readJson(artFile) : {};
  art[key] = { ...(art[key] || {}), src, crop: crop || 'face', source: 'the player' };
  writeJson(artFile, art);
  execFileSync('python3', [path.join(ROOT, 'tools', 'advimport', 'tokenart.py'), artFile], { stdio: 'pipe' });
  return { key, file: path.join(dir, `${key}-token.webp`) };
}

/**
 * Put a character on the board or in the bullpen. g: the game (loadMarching); mode party|swap|bullpen.
 * Returns {lines, writes, saveOps} (saveOps: functions that write the save).
 */
function placeCharacter(save, g, { id, actor, mode, out, at, map, art, token }) {
  const lines = [], writes = [], saveOps = [];
  const mapId = map || g.partyMap;
  const bp = readBullpen(save);
  const setMapToken = (mid, tid, tok) => saveOps.push(() => {
    const f = path.join(save, 'maps', `${mid}.json`);
    const st = fs.existsSync(f) ? readJson(f) : { map: mid, tokens: {} };
    st.tokens = st.tokens || {};
    if (tok) { const { map: _m, ...rest } = tok; st.tokens[tid] = rest; } else delete st.tokens[tid];
    writeJson(f, st);
  });
  let marching = { slots: { ...((g.marching || {}).slots || {}) }, extra: [...((g.marching || {}).extra || [])] };
  if (mode === 'bullpen') {
    bp.pcs = [...bp.pcs.filter((x) => x.id !== id), { id, name: actor.name, since: new Date().toISOString().slice(0, 10), ...(token ? { token } : {}) }];
    saveOps.push(() => writeJson(bullpenFile(save), bp));
    lines.push(`${actor.name} waits in the bullpen (off the board).`);
    return { lines, writes, saveOps };
  }
  let square = at, placeMap = mapId;
  if (mode === 'swap') {
    if (!out) throw new Error('--out NAME: the PC who leaves the board');
    const hit = Object.entries(g.tokens).find(([tid, t]) => t.kind === 'pc' && (tid === out || String(t.name).toLowerCase() === String(out).toLowerCase()));
    if (!hit) throw new Error(`no PC "${out}" on the board`);
    const [oid, ot] = hit;
    square = square || [ot.x, ot.y];
    placeMap = ot.map;
    // the one leaving: off the board, into the bullpen, and the newcomer takes their place in the marching order
    const { x: _ox, y: _oy, map: _om, ...keepOut } = ot;
    bp.pcs = [...bp.pcs.filter((x) => x.id !== oid), { id: oid, name: ot.name, since: new Date().toISOString().slice(0, 10), token: keepOut }];
    saveOps.push(() => writeJson(bullpenFile(save), bp));
    setMapToken(ot.map, oid, null);
    writes.push({ op: 'delete', path: `tokens/${oid}` });
    if (marching.slots[oid]) { marching.slots[id] = marching.slots[oid]; delete marching.slots[oid]; }
    lines.push(`${ot.name} leaves the board for the bullpen; ${actor.name} takes their place at ${square.join(',')} on ${ot.map}.`);
    return finishPlace();
  }
  if (!square) {
    square = besideParty(g, mapId);
    if (!square) throw new Error(`no free square beside the party on ${mapId}: give --at X,Y`);
  }
  lines.push(`${actor.name} joins the party at ${square.join(',')} on ${mapId}.`);
  return finishPlace();

  function finishPlace() {
    const mid = placeMap;
    const kept = (readBullpen(save).pcs.find((x) => x.id === id) || {}).token;
    const tok = kept ? { ...kept, x: square[0], y: square[1], map: mid } : pcToken(actor, square, mid, art);
    setMapToken(mid, id, tok);
    writes.push({ op: 'set', path: `tokens/${id}`, data: tok });
    const tokens = { ...g.tokens, [id]: tok };
    marching.slots = marchSlots(marchMembers(tokens, marching), marching.slots);
    writes.push({ op: 'set', path: 'state/marching', data: marching });
    bp.pcs = bp.pcs.filter((x) => x.id !== id);
    saveOps.push(() => writeJson(bullpenFile(save), bp));
    return { lines, writes, saveOps };
  }
}

/** The game for placing: the save (and the board's records over it, when given). */
function gameFor(save, recordsFile) {
  const [pack] = gameArgs([save]);
  const records = recordsFile ? readRecords(readJson(recordsFile)) : null;
  return loadMarching(pack, save, records);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
