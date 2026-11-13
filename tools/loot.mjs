#!/usr/bin/env node
// Party loot from chat (board/loot.js): the party's stash, what each character carries, and the coins. Players move
// things on the board's Party loot tab; Claude adds what the party finds, identifies and appraises it, and buys and
// sells. The rules (Bulk, identifying, selling, coins) are the campaign's system's (system.loot).
//
// Usage: node tools/loot.mjs <pack-dir> <save-dir> [--records FILE] <command> ...
//   (--records: the board's records, {path: data} or a db_list result: loot/, state/purse, tokens/, actors/,
//    actorstate/, content/, state/clock and state/table; with it the board is the truth for the stash and purse)
//   list [--view player]                    the purse, the stash and each character's load (the player view: as they see it)
//   find "words" [--limit N]                library items by name, with level, price and key
//   add <item/key | "Custom name"> [--qty N] [--to PC] [--value "5 gp"] [--bulk L|1] [--text T] [--kind K]
//        [--rarity uncommon] [--level N] [--identified | --unidentified] [--mystery "a strange idol"]
//        [--from "the bugbear"] [--area B12] [--map M] [--link chat/<id>]
//                                           found loot: into the stash (or straight to a character with --to)
//   identify <item> [--as "False name" [--text T]] [--pc PC]   identified (--as: a critical failure's false identity)
//   unidentify <item> [--pc PC]
//   appraise <item> [--pc PC]               its value is known
//   take <item> <PC> [--qty N] [--carry held|worn|stowed]       from the stash to a character
//   putback <PC> <item> [--qty N]           from a character to the stash
//   give <PC> <item> <PC2> [--qty N]        between characters
//   carry <PC> <item> held|worn|stowed      how it is carried (stowed items are not in use)
//   invest <PC> <item> on|off
//   remove <item> [--qty N]                 out of the stash (used up, lost, left behind)
//   sell <item> [--pc PC] [--qty N] [--price "x gp"] [--to PC]   coins to the purse (or --to a character)
//   buy <item/key> [--qty N] [--price "x gp"] [--from PC] [--to PC]   paid from the purse (or --from a character's coins)
//   coins add|take "5 gp 3 sp" [--pc PC]    the purse's (or a character's) coins
//   coins move "5 gp" --from purse|PC --to purse|PC
//   split [--between "Kerra, Lyra"]         the purse shared evenly between the party (what does not split stays)
// <item>: a stash item's id (after loot/), or a name (the true one, or what the players call it), or a character's
// item by its number in `list` or its name (with --pc, or the command's PC). <PC>: a token's name, alias or id.
// Changing commands print {lines, writes} (db_write each; an update needs no version, a set of an existing record
// does); they write the content record a newly added library item needs, the audit lines, and put the system's
// encumbered condition on (or off) a character whose Bulk crosses its limit. Docs: docs/best-practices/board.md
// (Party loot), docs/gm/running-a-game.md section 9.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGame } from './actor.mjs';
import { readRecords } from './replay.mjs';
import { readCampaign } from './campaign.mjs';
import { sourceDir, parseKey } from './library.mjs';
import { contentPath } from '../board/records.js';
import { auditPath, auditEntry } from '../board/audit.js';
import { resolveToken } from '../board/names.js';
import { gameNow } from './ledger.mjs';
import {
  LOOT, PURSE, lootRules, lootPath, lootItem, resolveLoot, lootView, takeLoot, putBack, giveLoot, setCarry, setInvested,
  splitQty, asCarried, stashMerge, coinsOf, coinLabel, addCoins, parseCoins, takeCoins, splitCoins, carried, encumberedEffects, itemWords,
} from '../board/loot.js';

const KEY_RE = /^(?:[a-z0-9][a-z0-9-]*:)?item\/[a-z0-9][a-z0-9-]*$/;
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** The loot state: stash [{id, data}], purse, from the board's records (or the save when there are none). */
function lootState(game, records, saveLoot) {
  if (records) {
    const stash = Object.entries(records).filter(([p]) => p.startsWith(`${LOOT}/`)).map(([p, data]) => ({ id: p.slice(LOOT.length + 1), data })).sort((a, b) => (a.id < b.id ? -1 : 1));
    return { stash, purse: records[PURSE] || {} };
  }
  return { stash: ((saveLoot && saveLoot.items) || []).map(({ id, ...data }) => ({ id, data })), purse: (saveLoot && saveLoot.purse) || {} };
}

/** The party: tokens of kind pc with game data. */
const party = (game) => Object.entries(game.tokens).filter(([id, t]) => t.kind === 'pc' && game.actors[id]).map(([id, t]) => ({ id, name: t.name }));

export function runLoot(game, records, saveLoot, cmd, args, o = {}) {
  const L = lootRules(game.sys), content = game.content, view = o.view === 'player' ? 'player' : 'gm';
  const st = lootState(game, records, saveLoot);
  const writes = [], lines = [];
  const audit = (text) => writes.push({ op: 'set', path: auditPath(), data: auditEntry({ text, by: 'claude' }) });
  const contentFor = (ref) => { if (ref && !game.onBoard[ref]) { const d = game.lib.get(ref); if (!d) throw new Error(`no item "${ref}" in the library (tools/loot.mjs find "words")`); writes.push({ op: 'set', path: contentPath(ref), data: d }); game.onBoard[ref] = d; } };
  const pc = (who) => { const id = resolveToken(game.tokens, who); if (!game.actors[id]) throw new Error(`${game.tokens[id].name} has no game data`); return id; };
  const nameOf = (id) => (game.tokens[id] || {}).name || id;
  const coinsOfPc = (id) => coinsOf((game.states[id] || {}).coins, L);
  const itemsOf = (id) => game.actors[id].items || [];
  const viewOf = (it) => lootView(it, content, view, L);

  // the stash item meant: an id, or a name (true, or as the players call it)
  const stashItem = (ref) => {
    const id = String(ref).replace(/^loot\//, '');
    const byId = st.stash.find((e) => e.id === id);
    if (byId) return byId;
    const w = norm(ref);
    const hits = st.stash.filter((e) => [resolveLoot(e.data, content).doc.name, lootView(e.data, content, 'player', L).name].some((n) => norm(n) === w));
    const loose = hits.length ? hits : st.stash.filter((e) => norm(resolveLoot(e.data, content).doc.name).includes(w));
    if (loose.length === 1) return loose[0];
    if (!loose.length) throw new Error(`nothing in the stash is called "${ref}"`);
    throw new Error(`"${ref}" matches ${loose.length} stash items (${loose.map((e) => e.id).join(', ')}): give the id`);
  };
  // a character's item: its number in `list` (1-based) or its name
  const pcItem = (id, ref) => {
    const items = itemsOf(id);
    if (/^\d+$/.test(String(ref))) { const i = Number(ref) - 1; if (!items[i]) throw new Error(`${nameOf(id)} has no item ${ref}`); return i; }
    const w = norm(ref);
    const idx = items.map((it, i) => ({ i, names: [resolveLoot(it, content).doc.name, lootView(asCarried(it), content, 'player', L).name].map(norm) })).filter((x) => x.names.includes(w) || x.names[0].includes(w));
    if (idx.length === 1) return idx[0].i;
    if (!idx.length) throw new Error(`${nameOf(id)} carries nothing called "${ref}"`);
    throw new Error(`"${ref}" matches ${idx.length} of ${nameOf(id)}'s items: give its number from list`);
  };
  const setItems = (id, items) => { game.actors[id] = { ...game.actors[id], items }; writes.push({ op: 'update', path: `actors/${id}`, data: { items } }); };
  const setPcCoins = (id, coins) => { game.states[id] = { ...(game.states[id] || {}), coins }; writes.push({ op: 'update', path: `actorstate/${id}`, data: { coins } }); };
  const setPurse = (coins) => { st.purse = coins; writes.push({ op: 'set', path: PURSE, data: coins }); };
  const setStash = (e, data) => { if (data) { e.data = data; writes.push({ op: 'set', path: `${LOOT}/${e.id}`, data }); } else { st.stash = st.stash.filter((x) => x !== e); writes.push({ op: 'delete', path: `${LOOT}/${e.id}` }); } };
  const addStash = (data) => { const p = lootPath(); st.stash.push({ id: p.slice(LOOT.length + 1), data }); writes.push({ op: 'set', path: p, data }); };
  // after a character's load changes: its Bulk in words, and the encumbered condition on or off
  const loadCheck = (id) => {
    const c = carried(game.actors[id], coinsOfPc(id), content, L, 'gm');
    if (!c.limits) return;
    lines.push(`${nameOf(id)}: Bulk ${L.bulkLabel(c.bulk.tenths / 10)} (encumbered over ${c.limits.encumbered}, most ${c.limits.max})${c.warnings.length ? `; ${c.warnings.join('; ')}` : ''}`);
    const t = game.tokens[id], eff = encumberedEffects(t.effects, c.encumbered, L);
    if (eff) { game.tokens[id] = { ...t, effects: eff }; writes.push({ op: 'update', path: `tokens/${id}`, data: { effects: eff } }); lines.push(`${nameOf(id)} is ${c.encumbered ? 'now encumbered' : 'no longer encumbered'}.`); }
    if (c.overMax) lines.push(`WARNING: ${nameOf(id)} cannot carry this much: move something off them.`);
  };
  const found = () => {
    const f = {};
    if (o.from) f.from = o.from;
    if (o.area || o.map) f.where = { ...(o.map ? { map: o.map } : {}), ...(o.area ? { area: o.area } : {}) };
    const g = records ? gameNow(records) : null;
    if (g) f.game = g;
    if (o.link) f.link = o.link;
    return Object.keys(f).length ? f : null;
  };
  const qty = o.qty !== undefined ? Number(o.qty) : undefined;

  if (cmd === 'list') {
    lines.push(`Purse: ${coinLabel(coinsOf(st.purse, L), L)}`);
    lines.push(`Stash (${st.stash.length}):`);
    for (const e of st.stash) {
      const v = viewOf(e.data), d = resolveLoot(e.data, content).doc;
      const flags = [v.unknown ? (v.misidentified ? `misidentified as "${e.data.misidentified.name}"` : `unidentified: players see "${L.mysteryName(d)}"`) : null, e.data.appraised ? 'appraised' : null, v.missing ? 'MISSING CONTENT' : null].filter(Boolean);
      const f = e.data.found;
      lines.push(`  ${e.id}  ${v.qty > 1 ? `${v.qty} × ` : ''}${v.name}  ${v.valueLabel}${v.bulkLabel && v.bulkLabel !== '—' ? `, ${v.bulkLabel} Bulk` : ''}${flags.length && view === 'gm' ? `  [${flags.join('; ')}]` : ''}${f && view === 'gm' ? `  (found${f.from ? ` on ${f.from}` : ''}${f.where && f.where.area ? ` in ${f.where.area}` : ''}${f.game && f.game.label ? `, ${f.game.label}` : ''})` : ''}`);
    }
    for (const p of party(game)) {
      const c = carried(game.actors[p.id], coinsOfPc(p.id), content, L, view);
      lines.push(`${p.name}: ${coinLabel(coinsOfPc(p.id), L)}; Bulk ${L.bulkLabel(c.bulk.tenths / 10) || 0}${c.limits ? ` (encumbered over ${c.limits.encumbered}, most ${c.limits.max})` : ''}${c.investedLimit ? `; invested ${c.invested}/${c.investedLimit}` : ''}${c.warnings.length ? `; ${c.warnings.join('; ')}` : ''}`);
      for (const r of c.rows) lines.push(`  ${r.i + 1}. ${r.view.qty > 1 ? `${r.view.qty} × ` : ''}${r.view.name} (${r.item.carry || 'in use'}${r.view.invested ? (r.view.isInvested ? ', invested' : ', not invested') : ''})${r.view.unknown && view === 'gm' ? ' [unidentified]' : ''}`);
    }
    return { lines, writes };
  }
  if (cmd === 'find') {
    const words = norm(args.join(' ')).split(' ').filter(Boolean);
    if (!words.length) throw new Error('find what?');
    const dirs = [game.packDir ? path.join(game.packDir, 'content') : null, ...((game.pack.content) || []).map(sourceDir)].filter(Boolean);
    const seen = new Set(), hits = [];
    for (const d of dirs) {
      const dir = path.join(d, 'item');
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        const slug = f.slice(0, -5);
        if (seen.has(slug)) continue;
        seen.add(slug);
        const hay = slug.replace(/-/g, ' ');
        if (!words.every((w) => hay.includes(w))) continue;
        const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        hits.push({ key: `item/${slug}`, doc });
      }
    }
    hits.sort((a, b) => (a.doc.level || 0) - (b.doc.level || 0) || a.key.localeCompare(b.key));
    const lim = Number(o.limit) || 25;
    for (const h of hits.slice(0, lim)) lines.push(`${h.key}  ${h.doc.name}, level ${h.doc.level ?? 0}${h.doc.rarity ? `, ${h.doc.rarity}` : ''}, ${L.priceLabel(L.priceCp(h.doc.price))}${h.doc.price && h.doc.price.per > 1 ? ` for ${h.doc.price.per}` : ''}, ${L.bulkLabel(L.bulkOf(h.doc)) || 'no'} Bulk`);
    if (hits.length > lim) lines.push(`... ${hits.length - lim} more: narrow the words or --limit`);
    if (!hits.length) lines.push('No library item matches.');
    return { lines, writes };
  }
  if (cmd === 'add') {
    const what = args.join(' ').trim();
    if (!what) throw new Error('add what? (a library key such as item/healing-potion-minor, or a custom item\'s name)');
    const isKey = KEY_RE.test(what);
    if (isKey) { parseKey(what); contentFor(what); }
    const f = isKey ? { ref: what } : { name: what, text: o.text, kind: o.kind, rarity: o.rarity, level: o.level !== undefined ? Number(o.level) : undefined, traits: o.traits ? o.traits.split(',').map((x) => x.trim()).filter(Boolean) : undefined, bulk: o.bulk === 'L' ? 0.1 : o.bulk, value: o.value ? Object.entries(parseCoins(o.value, L)).reduce((n, [k, v]) => n + v * L.coins.find((c) => c.id === k).cp, 0) : undefined };
    if (isKey && o.name) f.name = o.name;
    const item = lootItem({ ...f, qty, identified: o.identified ? true : o.unidentified ? false : undefined, mystery: o.mystery, found: found(), by: 'claude' });
    const words = itemWords(item, content);
    if (o.to) {
      const id = pc(o.to);
      const r = takeLoot(item, itemsOf(id), undefined, o.carry, L, content);
      delete r.moved.added;
      setItems(id, r.items);
      lines.push(`${nameOf(id)} takes ${words}.`);
      audit(`loot: ${nameOf(id)} got ${words}`);
      loadCheck(id);
    } else {
      addStash(item);
      lines.push(`Added to the stash: ${words}${item.identified === false || (item.identified === undefined && L.needsIdentify(resolveLoot(item, content).doc)) ? ` (players see "${lootView(item, content, 'player', L).name}")` : ''}.`);
      audit(`loot: ${words} added to the party's stash`);
    }
    return { lines, writes };
  }
  // the item named, in the stash or (with a PC) carried: {where: 'stash'|id, e|i, item}
  const anyItem = (ref, pcName) => {
    if (pcName) { const id = pc(pcName); const i = pcItem(id, ref); return { at: id, i, item: itemsOf(id)[i] }; }
    const e = stashItem(ref); return { at: 'stash', e, item: e.data };
  };
  const putItem = (x, item) => {
    if (x.at === 'stash') setStash(x.e, item);
    else { const items = itemsOf(x.at).slice(); items[x.i] = item; setItems(x.at, items); }
  };
  if (cmd === 'identify' || cmd === 'unidentify' || cmd === 'appraise') {
    const x = anyItem(args.join(' '), o.pc), it = { ...x.item };
    const carriedView = (z) => (x.at === 'stash' ? z : asCarried(z));
    const before = lootView(carriedView(it), content, 'player', L).name, truth = resolveLoot(it, content).doc.name;
    if (cmd === 'appraise') { it.appraised = true; }
    else if (cmd === 'unidentify') { it.identified = false; delete it.misidentified; }
    else if (o.as) { it.misidentified = { name: o.as, ...(o.text ? { text: o.text } : {}) }; delete it.identified; }
    else { it.identified = true; delete it.misidentified; }
    putItem(x, it);
    const after = lootView(carriedView(it), content, 'player', L);
    if (cmd === 'appraise') lines.push(`${truth} appraised: players now see its value, ${after.valueLabel}.`);
    else if (o.as) lines.push(`${truth} misidentified: players now believe it is "${o.as}" (GM secret: the ledger should note it).`);
    else lines.push(`${before} is now "${after.name}" to the players.`);
    audit(`loot: ${truth} ${cmd === 'appraise' ? 'appraised' : cmd === 'unidentify' ? 'marked unidentified' : o.as ? `misidentified as "${o.as}"` : 'identified'}${x.at !== 'stash' ? ` (${nameOf(x.at)}'s)` : ''}`);
    return { lines, writes };
  }
  if (cmd === 'take') {
    const [ref, who] = args;
    const e = stashItem(ref), id = pc(who);
    const r = takeLoot(e.data, itemsOf(id), qty, o.carry, L, content);
    setStash(e, r.stash);
    setItems(id, r.items);
    lines.push(`${nameOf(id)} takes ${itemWords(r.moved, content)} from the stash (${r.moved.carry}).`);
    audit(`loot: ${nameOf(id)} took ${itemWords(r.moved, content)} from the stash`);
    loadCheck(id);
    return { lines, writes };
  }
  if (cmd === 'putback') {
    const [who, ...rest] = args;
    const id = pc(who), i = pcItem(id, rest.join(' '));
    const r = putBack(itemsOf(id), i, qty, L, content);
    setItems(id, r.items);
    const m = stashMerge(st.stash, r.stashItem, content, L);   // onto a matching stack, if there is one
    if (m.id) setStash(st.stash.find((e) => e.id === m.id), m.data); else addStash(m.data);
    lines.push(`${nameOf(id)} puts ${itemWords(r.stashItem, content)} back in the stash.`);
    audit(`loot: ${nameOf(id)} put ${itemWords(r.stashItem, content)} in the stash`);
    loadCheck(id);
    return { lines, writes };
  }
  if (cmd === 'give') {
    const [who, ref, to] = args;
    const a = pc(who), b = pc(to), i = pcItem(a, ref);
    if (a === b) throw new Error('give it to someone else');
    const r = giveLoot(itemsOf(a), i, itemsOf(b), qty, L, content);
    setItems(a, r.from); setItems(b, r.to);
    lines.push(`${nameOf(a)} hands ${itemWords(r.moved, content)} to ${nameOf(b)}.`);
    audit(`loot: ${nameOf(a)} gave ${itemWords(r.moved, content)} to ${nameOf(b)}`);
    loadCheck(a); loadCheck(b);
    return { lines, writes };
  }
  if (cmd === 'carry' || cmd === 'invest') {
    const [who, ...rest] = args;
    const how = rest.pop();
    const id = pc(who), i = pcItem(id, rest.join(' '));
    const name = itemWords(itemsOf(id)[i], content);
    if (cmd === 'carry') {
      if (!L.carry.some((c) => c.id === how)) throw new Error(`carry it ${L.carry.map((c) => c.id).join(', ')}`);
      setItems(id, setCarry(itemsOf(id), i, how));
      lines.push(`${nameOf(id)}: ${name} ${how}.`);
      audit(`loot: ${nameOf(id)}'s ${name} now ${how}`);
    } else {
      if (!['on', 'off'].includes(how)) throw new Error('invest on or off');
      const { doc } = resolveLoot(itemsOf(id)[i], content);
      if (!L.invests(doc)) throw new Error(`${doc.name} is not an invested item`);
      setItems(id, setInvested(itemsOf(id), i, how === 'on'));
      lines.push(`${nameOf(id)} ${how === 'on' ? 'invests' : 'stops investing'} ${name}.`);
      audit(`loot: ${nameOf(id)} ${how === 'on' ? 'invested' : 'uninvested'} ${name}`);
    }
    loadCheck(id);
    return { lines, writes };
  }
  if (cmd === 'remove') {
    const e = stashItem(args.join(' '));
    const [taken, rest] = splitQty(e.data, qty);
    setStash(e, rest);
    lines.push(`${itemWords(taken, content)} taken out of the stash.`);
    audit(`loot: ${itemWords(taken, content)} removed from the stash`);
    return { lines, writes };
  }
  const coinCp = (c) => L.coins.reduce((n, k) => n + (c[k.id] || 0) * k.cp, 0);
  // a whole-coin amount for a price in copper, in the system's coins: gold and smaller (no platinum)
  const priceCoins = (cp) => { const out = coinsOf({}, L); let n = cp; for (const k of L.coins.filter((c) => c.id !== 'pp')) { out[k.id] = Math.floor(n / k.cp); n -= out[k.id] * k.cp; } return out; };
  if (cmd === 'sell') {
    const x = anyItem(args.join(' '), o.pc);
    const { doc } = resolveLoot(x.item, content);
    const [taken, rest] = splitQty(x.item, qty);
    const n = taken.qty ?? 1;
    const cp = o.price ? coinCp(parseCoins(o.price, L)) : Math.floor(L.sellCp(doc) * n);
    if (x.at === 'stash') setStash(x.e, rest);
    else { const items = itemsOf(x.at).slice(); if (rest) items[x.i] = rest; else items.splice(x.i, 1); setItems(x.at, items); }
    const coins = priceCoins(cp);
    if (o.to) { const id = pc(o.to); setPcCoins(id, addCoins(coinsOfPc(id), coins, L)); } else setPurse(addCoins(coinsOf(st.purse, L), coins, L));
    lines.push(`Sold ${itemWords(taken, content)} for ${coinLabel(coins, L)}${o.to ? ` (to ${nameOf(pc(o.to))})` : ' (to the purse)'}.`);
    audit(`loot: sold ${itemWords(taken, content)} for ${coinLabel(coins, L)}`);
    if (x.at !== 'stash') loadCheck(x.at);
    if (o.to) loadCheck(pc(o.to));
    return { lines, writes };
  }
  if (cmd === 'buy') {
    const key = args.join(' ').trim();
    if (!KEY_RE.test(key)) throw new Error('buy a library item by its key (tools/loot.mjs find "words")');
    contentFor(key);
    const doc = game.lib.get(key), n = qty || 1;
    const cp = o.price ? coinCp(parseCoins(o.price, L)) : Math.round((L.unitCp || L.priceCp)(doc.price) * n);
    const pay = priceCoins(cp);
    if (o.from) { const id = pc(o.from); const r = takeCoins(coinsOfPc(id), pay, L); setPcCoins(id, r.left); }
    else { const r = takeCoins(coinsOf(st.purse, L), pay, L); setPurse(r.left); }
    const item = lootItem({ ref: key, qty: n, identified: true, by: 'claude' });
    item.appraised = true;
    let carrier = null;
    if (o.to) {
      carrier = pc(o.to);
      const r = takeLoot(item, itemsOf(carrier), undefined, o.carry, L, content);
      setItems(carrier, r.items);
    } else { const m = stashMerge(st.stash, item, content, L); if (m.id) setStash(st.stash.find((e) => e.id === m.id), m.data); else addStash(m.data); }
    lines.push(`Bought ${itemWords(item, content)} for ${coinLabel(pay, L)}${o.from ? ` (${nameOf(pc(o.from))} pays)` : ' (from the purse)'}${o.to ? `; ${nameOf(pc(o.to))} carries it` : '; into the stash'}.`);
    audit(`loot: bought ${itemWords(item, content)} for ${coinLabel(pay, L)}`);
    if (carrier) loadCheck(carrier);
    if (o.from && pc(o.from) !== carrier) loadCheck(pc(o.from));
    return { lines, writes };
  }
  if (cmd === 'coins') {
    const [sub, ...rest] = args;
    const amount = parseCoins(rest.join(' '), L);
    const holder = (w) => (!w || norm(w) === 'purse' || norm(w) === 'party' ? 'purse' : pc(w));
    const get = (h) => (h === 'purse' ? coinsOf(st.purse, L) : coinsOfPc(h));
    const put = (h, c) => (h === 'purse' ? setPurse(c) : setPcCoins(h, c));
    const label = (h) => (h === 'purse' ? 'the purse' : nameOf(h));
    if (sub === 'add') { const h = holder(o.pc); put(h, addCoins(get(h), amount, L)); lines.push(`${coinLabel(amount, L)} into ${label(h)}: now ${coinLabel(get(h), L)}.`); audit(`coins: ${coinLabel(amount, L)} added to ${label(h)}`); if (h !== 'purse') loadCheck(h); }
    else if (sub === 'take') { const h = holder(o.pc); const r = takeCoins(get(h), amount, L); put(h, r.left); lines.push(`${coinLabel(r.taken, L)} out of ${label(h)}: ${coinLabel(r.left, L)} left.`); audit(`coins: ${coinLabel(r.taken, L)} taken from ${label(h)}`); if (h !== 'purse') loadCheck(h); }
    else if (sub === 'move') {
      const a = holder(o.from), b = holder(o.to);
      if (a === b) throw new Error('move coins from one holder to another (--from and --to)');
      const r = takeCoins(get(a), amount, L);
      put(a, r.left); put(b, addCoins(get(b), r.taken, L));
      lines.push(`${coinLabel(r.taken, L)} from ${label(a)} to ${label(b)}.`);
      audit(`coins: ${coinLabel(r.taken, L)} from ${label(a)} to ${label(b)}`);
      for (const h of [a, b]) if (h !== 'purse') loadCheck(h);
    } else throw new Error('coins add, take or move');
    return { lines, writes };
  }
  if (cmd === 'split') {
    const ids = o.between ? o.between.split(',').map((s) => pc(s.trim())) : party(game).map((p) => p.id);
    const r = splitCoins(st.purse, ids.length, L);
    if (!coinCp(r.each)) throw new Error(`the purse (${coinLabel(coinsOf(st.purse, L), L)}) is too small to split ${ids.length} ways`);
    setPurse(r.left);
    for (const id of ids) { setPcCoins(id, addCoins(coinsOfPc(id), r.each, L)); loadCheck(id); }
    lines.push(`Split the purse: ${coinLabel(r.each, L)} each to ${ids.map(nameOf).join(', ')}; ${coinLabel(r.left, L)} stays in the purse.`);
    audit(`coins: the purse split ${ids.length} ways, ${coinLabel(r.each, L)} each`);
    return { lines, writes };
  }
  throw new Error(`unknown command "${cmd}"`);
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const rec = opt('--records');
    const o = {};
    for (const k of ['qty', 'to', 'value', 'bulk', 'text', 'kind', 'rarity', 'level', 'traits', 'mystery', 'from', 'area', 'map', 'link', 'as', 'pc', 'carry', 'price', 'between', 'limit', 'view', 'name']) o[k] = opt(`--${k}`);
    o.identified = flag('--identified'); o.unidentified = flag('--unidentified');
    const [pack, save, cmd, ...rest] = args;
    if (!pack || !save || !cmd) throw new Error('give a pack folder, a save folder and a command');
    const records = rec ? readRecords(JSON.parse(fs.readFileSync(rec, 'utf8'))) : null;
    const game = loadGame(pack, save, records);
    game.packDir = pack;
    const saveLoot = records ? null : readCampaign(pack, save).loot;
    const out = runLoot(game, records, saveLoot, cmd, rest, o);
    if (cmd === 'list' || cmd === 'find') console.log(out.lines.join('\n'));
    else console.log(JSON.stringify(out, null, 2));
    return 0;
  } catch (e) {
    console.error(`loot: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
