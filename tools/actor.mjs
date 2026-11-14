#!/usr/bin/env node
// Creatures' game data from chat: every number with how it is made up, and the rules for damage, healing,
// temporary HP, recovery checks, resources and raising a shield. Reads the campaign (a pack and a save on
// disk), optionally overlaid with the board's current records; prints what changed and the records to write.
//
// Usage:
//   node tools/actor.mjs <pack-dir> <save-dir> [--records FILE] <command> ...
//     list                                     every creature: HP, temporary HP, conditions, health band
//     show <who> [--all]                       statistics with breakdowns (--all: every skill)
//     damage <who> <amount> [type] [--crit] [--nonlethal] [--parts "5 fire, 3 slashing"] [--from DICE.json,...]
//                                       (also writes the damage card for the chat; --from: the tools/dice.mjs
//                                       damage rolls it came from, shown on the card)
//     heal <who> <amount>
//     temp <who> <amount>                      temporary HP (the larger amount is kept)
//     recover <who> --roll N                   a recovery check while dying (N: the d20)
//     resource <who> <name> <+N|-N|N>          hero points, focus points...
//     shield <who> raise|lower
//     create <who> <content-key> [--name NAME]   give a token game data: a creature from the library
//                                              (creature/goblin-warrior, or pathfinder-monster-core:creature/...)
//     give <who> <content-key>                 an item from the library, carried by reference
//     option <who> <option> on|off             turn a roll option on or off ("raging", "flanking"): the
//                                              situations its rules depend on (the live state's tags)
//
// create and give also write the content record the creature now uses (content/...), so the board holds it;
// tools/campaign.mjs tidy removes the ones nothing uses after a save.
//
// <who> is a token's name, alias or id. --records: a JSON file of the board's records ({path: data}, as db_list
// gives them: tokens/, actors/, actorstate/), used over the save so the numbers are the live ones. Prints JSON
// {lines, writes: [{op, path, data}]}: write each with db_write (read first for its version) and tell the story
// from the lines; they name creatures as the players know them (an alias until the name is learned). Players see foes' health only as a band, never the numbers.
// Docs: docs/best-practices/game-data.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareActor, describeStatistic } from '../engine/rules/rules.js';
import { systemConfig } from '../rulesets/systems.js';
import { readCampaign } from './campaign.mjs';
import { contentLibrary, contentView, parseKey } from './library.mjs';
import { contentPath, contentKey } from '../board/records.js';
import { chatPath, chatMessage } from '../board/chat.js';
import { spaceDistance } from '../engine/measure/measure.js';
import { resolveToken, nameFor, publicName } from '../board/names.js';
import { gameArgs } from './campaign.mjs';

/**
 * The game as the tools see it: tokens (all maps), actors, live state, content and the ruleset.
 * `records` ({path: data}) from the board override the save's.
 */
export function loadGame(packDir, saveDir, records = null) {
  const c = readCampaign(packDir, saveDir);
  const tokens = {};
  for (const [map, st] of Object.entries(c.mapStates)) for (const [id, t] of Object.entries(st.tokens || {})) tokens[id] = { ...t, map };
  const actors = { ...c.actors }, states = { ...c.actorStates }, onBoard = { ...c.content };
  if (records) {
    for (const [p, d] of Object.entries(records)) {
      const [coll, id] = p.split('/');
      if (coll === 'tokens') tokens[id] = d;
      if (coll === 'actors') actors[id] = d;
      if (coll === 'actorstate') states[id] = d;
      if (coll === 'content') onBoard[contentKey(p)] = d;
    }
  }
  // the clock and the encounter: the board's records over the save's
  const clock = (records && records['state/clock']) || c.campaign.clock || null;
  const encounter = (records && records['state/encounter']) || c.campaign.encounter || null;
  // the content: what the board holds first, then the whole library (read from files only when asked for)
  const lib = contentLibrary(c.pack, packDir, { extra: onBoard });
  const sys = systemConfig(c.campaign.ruleset || c.pack.ruleset);
  if (!sys || !sys.actors) throw new Error(`the ruleset "${c.campaign.ruleset}" has no creature rules`);
  const game = { tokens, actors, states, content: contentView(lib), lib, onBoard, sys, ruleset: sys.actors, clock, encounter, pack: c.pack, campaign: c.campaign };
  game.auras = null;   // worked out when first needed (auraEffects)
  game.records = records || {};   // the board's records as given (other tools read their own collections from them)
  // the adventure's events and the flags: the board's records over the save's (engine/events/events.js)
  const recEvents = Object.entries(records || {}).filter(([p]) => p.startsWith('events/'));
  game.events = recEvents.length ? Object.fromEntries(recEvents.map(([p, d]) => [p.slice(7), d])) : ((c.events && c.events.events) || {});
  game.flags = (records && records['state/flags']) || (c.events && c.events.flags) || {};
  const recSubs = Object.entries(records || {}).filter(([p]) => p.startsWith('subsystems/'));
  game.subsystems = recSubs.length ? Object.fromEntries(recSubs.map(([p, d]) => [p.slice(11), d])) : ((c.events && c.events.subsystems) || {});
  return game;
}

/** Prepare a creature as it would be with this token and state (for turn rules working on changes). */
export function prepareAt(game, id, token, state) {
  const actor = game.actors[id];
  if (!actor) return null;
  const effects = [...(token.effects || []), ...auraEffects(game, id)];
  const p = prepareActor({ actor, state: state || {}, effects, content: game.content, ruleset: game.ruleset });
  if (!p.name) p.name = token.name;
  return p;
}

/**
 * Auras: for every creature with an aura (an emanation from its space), the effects it puts on the creatures
 * within it, by side (enemies, allies, all). Effects that call for a save are listed, not applied: Claude
 * rolls the save. Worked out from token positions on the same map. Returns the in-memory effects for `id`.
 */
export function auraEffects(game, id) {
  if (!game.auras) {
    const on = {}, saves = [], inside = [];
    const ids = Object.keys(game.actors).filter((x) => game.tokens[x] && !game.tokens[x].dead);
    const prep = {};
    for (const x of ids) { try { prep[x] = prepareActor({ actor: game.actors[x], state: game.states[x] || {}, effects: game.tokens[x].effects || [], content: game.content, ruleset: game.ruleset }); } catch { /* reported by show */ } }
    const foe = (t) => (t.kind || 'foe') === 'foe';
    for (const src of ids) {
      const ps = prep[src];
      if (!ps || !ps.auras || !ps.auras.length) continue;
      const S = game.tokens[src];
      for (const aura of ps.auras) {
        for (const tgt of Object.keys(game.tokens)) {
          const T = game.tokens[tgt];
          if (T.map !== S.map || T.dead) continue;
          const self = tgt === src;
          const sq = game.ruleset.sizeSquares || (() => 1);
          const dist = spaceDistance({ x: S.x, y: S.y, size: sq(ps.size) }, { x: T.x, y: T.y, size: sq(prep[tgt] ? prep[tgt].size : 'medium') }) * 5;
          if (dist > aura.radius) continue;
          if (!aura.effects.length && !self) inside.push({ token: tgt, from: src, aura: aura.slug });
          for (const e of aura.effects) {
            if (self && !e.includesSelf) continue;
            if (!self && e.affects === 'enemies' && foe(S) === foe(T)) continue;
            if (!self && e.affects === 'allies' && foe(S) !== foe(T)) continue;
            if (!e.ref) continue;
            if (e.save) { saves.push({ token: tgt, from: src, aura: aura.slug, save: e.save, ref: e.ref }); continue; }
            const doc = game.content[e.ref];
            (on[tgt] = on[tgt] || []).push({ name: doc ? doc.name.replace(/^[A-Za-z ]*Effect: /, '') : e.ref, ref: e.ref, level: aura.level, aura: src });
          }
        }
      }
    }
    game.auras = { on, saves, inside };
  }
  return game.auras.on[id] || [];
}

/** A creature ready to use: {id, token, actor, state, effects, prepared}. */
export function creature(game, who) {
  const id = resolveToken(game.tokens, who);
  const actor = game.actors[id];
  if (!actor) throw new Error(`${game.tokens[id].name || id} has no game data (no actors/${id})`);
  const token = game.tokens[id], state = game.states[id] || {}, effects = token.effects || [];
  const prepared = prepareActor({ actor, state, effects: [...effects, ...auraEffects(game, id)], content: game.content, ruleset: game.ruleset });
  if (!prepared.name) prepared.name = token.name;
  // name: the token's real name (for the GM); shown: what players know it as (for anything said at the table)
  return { id, token, actor, state, effects, prepared, game, name: token.name || prepared.name, shown: publicName(token) || prepared.name };
}

const compact = (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => v !== undefined && v !== null && !(k === 'temp' && v === 0) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)));
const stateWrite = (id, st) => ({ op: 'set', path: `actorstate/${id}`, data: compact(st) });
const tokenWrite = (c, effects, dead) => {
  const data = { effects };
  if (dead !== undefined) data.dead = dead;
  return { op: 'update', path: `tokens/${c.id}`, data };
};

/** A creature's numbers in words, for the GM (Claude): every statistic with its breakdown. */
export function showCreature(c, { all = false } = {}) {
  const p = c.prepared, d = describeStatistic, out = [];
  out.push(`${c.name}${p.name && p.name !== c.name ? ` (${p.name})` : ''}: ${p.kind === 'character' ? 'character' : 'creature'} level ${p.level}; players see "${nameFor(c.token, 'player')}", health ${p.band}`);
  out.push(`HP ${p.hp.value}/${p.hp.max.value}${p.hp.temp ? ` + ${p.hp.temp} temporary` : ''}  (${d(p.hp.max)})`);
  if (p.conditions.length) out.push(`Conditions: ${p.conditions.map((x) => `${x.id}${x.value ? ' ' + x.value : ''}${x.from ? ` (from ${x.from})` : ''}`).join(', ')}`);
  if (p.dying.value) out.push(`Dying ${p.dying.value} (dies at ${p.dying.max})`);
  for (const s of [p.ac, ...Object.values(p.saves), p.perception]) out.push(d(s));
  if (p.classDC) out.push(d(p.classDC));
  if (p.spell) out.push(d(p.spell.attack), d(p.spell.dc));
  for (const s of p.strikes) out.push(`${d(s.attack)}; MAP ${s.map.slice(1).join('/')}; damage ${s.damage.formula}${s.traits.length ? `; ${s.traits.join(', ')}` : ''}`);
  out.push(`Speeds: ${Object.values(p.speeds).map((s) => `${s.label} ${s.value} ft`).join(', ')}`);
  const sk = Object.values(p.skills).filter((s) => all || s.parts.some((x) => /trained|expert|master|legendary|stat block/.test(x.label) && x.value) || s.modifiers.some((m) => m.applied));
  if (sk.length) out.push(`Skills: ${sk.map((s) => `${s.label} ${s.value >= 0 ? '+' : ''}${s.value}`).join(', ')}`);
  for (const s of Object.values(p.lore || {})) out.push(d(s));
  const iwr = p.iwr;
  if (iwr.immunities.length) out.push(`Immunities: ${iwr.immunities.map((x) => x.type).join(', ')}`);
  if (iwr.weaknesses.length) out.push(`Weaknesses: ${iwr.weaknesses.map((x) => `${x.type} ${x.value}`).join(', ')}`);
  if (iwr.resistances.length) out.push(`Resistances: ${iwr.resistances.map((x) => `${x.type} ${x.value}${x.except ? ` (except ${x.except})` : ''}`).join(', ')}`);
  if (p.senses.length) out.push(`Senses: ${p.senses.map((x) => x.type + (x.range ? ` ${x.range} ft` : '')).join(', ')}`);
  if (p.shield) out.push(`Shield: ${p.shield.name}, Hardness ${p.shield.hardness}, HP ${p.shield.hp}/${p.shield.maxHp} (broken at ${p.shield.brokenAt})${p.shield.raised ? ', raised' : ''}`);
  for (const n of p.notes) out.push(`Note (${n.selectors.join(', ')}): ${n.text}`);
  for (const a of p.abilities || []) out.push(`${a.name}: ${a.text || ''}`);
  if ((p.options || []).length) out.push(`Switches: ${p.options.map((o) => `${o.option} ${o.on ? 'on' : 'off'}`).join(', ')} (actor.mjs option)`);
  for (const s of p.strikes || []) { if (s.damage.criticalExtra) out.push(`${s.name}: on a critical hit also ${s.damage.criticalExtra}`); if (s.critSpec) out.push(`${s.name}: critical specialization applies`); }
  const cr = p.checkRules || {};
  for (const d of cr.degree || []) out.push(`Degree of success (${d.selectors.join(', ')}): ${Object.entries(d.adjust).map(([k, v]) => `${k} ${v.replace(/-/g, ' ')}`).join(', ')} (${d.origin.label})`);
  for (const r of cr.rollTwice || []) out.push(`Rolls twice and keeps the ${r.keep} (${r.selectors.join(', ')}): ${r.origin.label}`);
  for (const f of p.fastHealing || []) out.push(`${f.kind === 'regeneration' ? 'Regeneration' : 'Fast healing'} ${f.value}${f.deactivatedBy.length ? ` (deactivated by ${f.deactivatedBy.join(', ')})` : ''}`);
  for (const a of p.auras || []) out.push(`Aura ${a.slug} ${a.radius} feet${a.effects.length ? `: ${a.effects.map((e) => `${e.ref || '?'} on ${e.affects}${e.save ? ` (save: ${e.save.type} DC ${e.save.dc})` : ''}`).join('; ')}` : ' (see its ability)'}`);
  const au = c.game ? c.game.auras : null;
  for (const x of au ? [...au.saves, ...au.inside].filter((y) => y.token === c.id) : []) out.push(`Inside ${x.aura} of ${(c.game.tokens[x.from] || {}).name || x.from}${x.save ? ` (${x.save.type} save DC ${x.save.dc})` : ''}`);
  if (p.light) out.push(`Sheds light: bright ${p.light.bright} ft, dim ${p.light.dim} ft`);
  for (const pr of p.problems) out.push(`PROBLEM: ${pr}`);
  return out;
}

/** A document from the library, or an error naming the key. */
function libDoc(game, key) {
  parseKey(key);
  const doc = game.lib.get(key);
  if (!doc) throw new Error(`no content "${key}" (the pack's content/, the open sources pack.json lists, or <source>:<kind>/<slug>)`);
  return doc;
}
/** Writes putting content on the board that it does not hold yet. */
const contentWrites = (game, keys) => keys.filter((k) => !game.onBoard[k]).map((k) => ({ op: 'set', path: contentPath(k), data: game.lib.get(k) }));

/** Run one command; returns {lines, writes}. */
export function runCommand(game, cmd, args, opts = {}) {
  const R = game.ruleset;
  if (cmd === 'list') {
    const lines = [];
    for (const id of Object.keys(game.actors)) {
      if (!game.tokens[id]) continue;
      const c = creature(game, id), p = c.prepared;
      lines.push(`${c.name}: HP ${p.hp.value}/${p.hp.max.value}${p.hp.temp ? ` +${p.hp.temp}` : ''}, ${p.band}${p.conditions.length ? `, ${p.conditions.map((x) => x.id + (x.value ? ' ' + x.value : '')).join(', ')}` : ''}${c.token.dead ? ', dead' : ''}`);
    }
    return { lines, writes: [] };
  }
  if (cmd === 'option') {
    const [who, option, onoff] = args, c = creature(game, who);
    if (!option || !['on', 'off'].includes(onoff)) throw new Error('option <who> <option> on|off');
    const known = (c.prepared.options || []).find((o) => o.option === option);
    const tags = (c.state.tags || []).filter((t) => t !== option && t !== `!${option}`);
    if (onoff === 'on') tags.push(option); else if (known && known.on) tags.push(`!${option}`);
    const st = { ...c.state, tags };
    if (!tags.length) delete st.tags;
    return { lines: [`${c.name}: ${option} ${onoff}${known ? '' : ' (no rule of this creature switches it: kept as a situation tag)'}`], writes: [stateWrite(c.id, st)] };
  }
  if (cmd === 'create') {
    const [who, key] = args;
    const id = resolveToken(game.tokens, who), token = game.tokens[id];
    if (game.actors[id]) throw new Error(`${token.name || id} already has game data (actors/${id})`);
    if (!key) throw new Error('create <who> <content-key>: which stat block (creature/goblin-warrior)');
    const doc = libDoc(game, key);
    if (doc.kind !== 'creature' && doc.kind !== 'hazard') throw new Error(`${key} is ${doc.kind === 'item' ? 'an item' : `a ${doc.kind}`}, not a creature or hazard`);
    const actor = { system: doc.system || 'pf2e', kind: 'npc', base: key, ...(opts.name ? { name: opts.name } : {}) };
    const g2 = { ...game, actors: { ...game.actors, [id]: actor } }, made = creature(g2, id);
    const lit = made.prepared.light && !token.light ? [{ op: 'update', path: `tokens/${id}`, data: { light: { bright: made.prepared.light.bright, dim: made.prepared.light.dim, ...(made.prepared.light.colour ? { colour: made.prepared.light.colour } : {}) } } }] : [];
    return { lines: [`${made.name}: game data from ${doc.name} (level ${doc.level}${doc.source ? `, ${doc.source.title}` : ''}); HP ${made.prepared.hp.max.value}, AC ${made.prepared.ac.value}${lit.length ? `; sheds light (bright ${made.prepared.light.bright} ft, dim ${made.prepared.light.dim} ft)` : ''}`, ...made.prepared.problems.map((x) => `PROBLEM: ${x}`)],
      writes: [...contentWrites(game, [key]), { op: 'set', path: `actors/${id}`, data: actor }, ...lit] };
  }
  if (cmd === 'give') {
    const [who, key] = args, c = creature(game, who);
    if (!key) throw new Error('give <who> <content-key>: which item (item/longsword)');
    const doc = libDoc(game, key);
    if (parseKey(key).kind !== 'item') throw new Error(`${key} is not an item (item/<slug>)`);
    const actor = { ...c.actor, items: [...(c.actor.items || []), { ref: key }] };
    return { lines: [`${c.name} now carries ${doc.name}`], writes: [...contentWrites(game, [key]), { op: 'set', path: `actors/${c.id}`, data: actor }] };
  }
  const c = creature(game, args[0]), p = c.prepared;
  if (cmd === 'show') return { lines: showCreature(c, { all: opts.all }), writes: [] };
  if (cmd === 'damage') {
    const parts = opts.parts
      ? String(opts.parts).split(',').map((s) => { const [a, ...t] = s.trim().split(/\s+/); return { amount: Number(a), type: t.join(' ') || 'untyped' }; })
      : [{ amount: Number(args[1]), type: args[2] || 'untyped' }];
    if (parts.some((x) => !Number.isFinite(x.amount) || x.amount < 0)) throw new Error('damage amounts are whole numbers');
    if (c.token.dead) throw new Error(`${c.name} is already dead`);
    const r = R.applyDamage(p, c.state, c.effects, { parts, critical: !!opts.crit, nonlethal: !!opts.nonlethal });
    const writes = [stateWrite(c.id, r.state)];
    if (JSON.stringify(r.effects) !== JSON.stringify(c.effects) || r.dead) writes.push(tokenWrite(c, r.effects, r.dead || undefined));
    const after = R.healthBand(r.state.hp, p.hp.max.value, r.dead);
    // the damage taken, for a replay step's details (board/rolldetail.js), and the damage card for the chat: the
    // damage rolls it came from (opts.from: tools/dice.mjs outputs) and what was taken
    const roll = { type: 'applied', token: c.id, who: c.shown, amount: parts.reduce((t, x) => t + x.amount, 0), adjust: r.adjust || [], taken: r.total };
    const rolls = (opts.from || []).map((o) => o.roll).filter((x) => x && x.type === 'damage');
    const dealer = rolls.length && rolls[0].token ? game.tokens[rolls[0].token] : null;
    writes.push({ op: 'set', path: chatPath(), data: chatMessage({ kind: 'damage', by: 'claude', token: rolls.length ? rolls[0].token || undefined : undefined, name: rolls.length ? rolls[0].who : c.shown, rolls, applied: roll, gm: !!c.token.hidden || !!(dealer && dealer.hidden) }) });
    return { lines: [`${c.shown}: ${r.lines.join('; ')}`, `players see: ${after}`], roll, writes };
  }
  if (cmd === 'heal') {
    const r = R.applyHealing(p, c.state, c.effects, Number(args[1]), { dead: !!c.token.dead });
    const writes = [stateWrite(c.id, r.state)];
    if (JSON.stringify(r.effects) !== JSON.stringify(c.effects)) writes.push(tokenWrite(c, r.effects));
    return { lines: [`${c.shown}: ${r.lines.join('; ')}`], writes };
  }
  if (cmd === 'temp') {
    const r = R.setTempHp(p, c.state, Number(args[1]));
    return { lines: [`${c.shown}: ${r.lines.join('; ')}`], writes: [stateWrite(c.id, r.state)] };
  }
  if (cmd === 'recover') {
    const die = Number(opts.roll);
    if (!Number.isInteger(die) || die < 1 || die > 20) throw new Error('--roll is the d20 (1 to 20)');
    const r = R.recoveryCheck(p, c.effects, die);
    const writes = JSON.stringify(r.effects) !== JSON.stringify(c.effects) || r.dead ? [tokenWrite(c, r.effects, r.dead || undefined)] : [];
    return { lines: [`${c.shown}: ${r.lines.join('; ')}`], writes };
  }
  if (cmd === 'resource') {
    const name = args[1], spec = String(args[2] || ''), def = (p.resources || {})[name];
    if (!def) throw new Error(`${c.name} has no resource "${name}" (${Object.keys(p.resources || {}).join(', ') || 'none'})`);
    const now = ((c.state.resources || {})[name]) ?? def.max ?? 0;
    const m = spec.match(/^([+-]?)(\d+)$/);
    if (!m) throw new Error('give +N, -N or N');
    let next = m[1] === '+' ? now + Number(m[2]) : m[1] === '-' ? now - Number(m[2]) : Number(m[2]);
    if (next < 0) throw new Error(`${c.name} has only ${now} ${name}`);
    if (def.max !== undefined && next > def.max) next = def.max;
    return { lines: [`${c.shown}: ${name} ${now} → ${next}${def.max !== undefined ? ` of ${def.max}` : ''}`], writes: [stateWrite(c.id, { ...c.state, resources: { ...(c.state.resources || {}), [name]: next } })] };
  }
  if (cmd === 'shield') {
    if (!p.shield) throw new Error(`${c.name} has no shield`);
    const raise = args[1] === 'raise';
    if (!raise && args[1] !== 'lower') throw new Error('shield raise or shield lower');
    const st = { ...c.state, shieldRaised: raise || undefined };
    return { lines: [`${c.shown} ${raise ? `raises the ${p.shield.name}: +${p.shield.acBonus} circumstance to AC until the start of the next turn` : 'lowers the shield'}`], writes: [stateWrite(c.id, st)] };
  }
  throw new Error('commands: list, show, damage, heal, temp, recover, resource, shield, create, give, option');
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const rec = opt('--records'), parts = opt('--parts'), roll = opt('--roll'), name = opt('--name'), fromFiles = opt('--from');
    // --from a.json,b.json: the tools/dice.mjs damage rolls this damage came from (for the damage card)
    const from = fromFiles ? fromFiles.split(',').map((f) => JSON.parse(fs.readFileSync(f.trim(), 'utf8'))) : [];
    const o = { crit: flag('--crit'), nonlethal: flag('--nonlethal'), all: flag('--all'), parts, roll, name, from };
    const [pack, save, cmd, ...rest] = gameArgs(args);
    if (!save || !cmd) throw new Error('give a save folder (or a pack folder and a save folder) and a command');
    const game = loadGame(pack, save, rec ? JSON.parse(fs.readFileSync(rec, 'utf8')) : null);
    const out = runCommand(game, cmd, rest, o);
    if (cmd === 'show' || cmd === 'list') console.log(out.lines.join('\n'));
    else console.log(JSON.stringify(out, null, 2));
    return 0;
  } catch (e) {
    console.error(`actor: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
