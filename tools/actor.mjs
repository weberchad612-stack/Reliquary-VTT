#!/usr/bin/env node
// Creatures' game data from chat: every number with how it is made up, and the rules for damage, healing,
// temporary HP, recovery checks, resources and raising a shield. Reads the campaign (a pack and a save on
// disk), optionally overlaid with the board's current records; prints what changed and the records to write.
//
// Usage:
//   node tools/actor.mjs <pack-dir> <save-dir> [--records FILE] <command> ...
//     list                                     every creature: HP, temporary HP, conditions, health band
//     show <who> [--all]                       statistics with breakdowns (--all: every skill)
//     damage <who> <amount> [type] [--crit] [--nonlethal] [--parts "5 fire, 3 slashing"]
//     heal <who> <amount>
//     temp <who> <amount>                      temporary HP (the larger amount is kept)
//     recover <who> --roll N                   a recovery check while dying (N: the d20)
//     resource <who> <name> <+N|-N|N>          hero points, focus points...
//     shield <who> raise|lower
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
import { resolveToken, nameFor, publicName } from '../board/names.js';

/**
 * The game as the tools see it: tokens (all maps), actors, live state, content and the ruleset.
 * `records` ({path: data}) from the board override the save's.
 */
export function loadGame(packDir, saveDir, records = null) {
  const c = readCampaign(packDir, saveDir);
  const tokens = {};
  for (const [map, st] of Object.entries(c.mapStates)) for (const [id, t] of Object.entries(st.tokens || {})) tokens[id] = { ...t, map };
  const actors = { ...c.actors }, states = { ...c.actorStates };
  if (records) {
    for (const [p, d] of Object.entries(records)) {
      const [coll, id] = p.split('/');
      if (coll === 'tokens') tokens[id] = d;
      if (coll === 'actors') actors[id] = d;
      if (coll === 'actorstate') states[id] = d;
    }
  }
  const sys = systemConfig(c.campaign.ruleset || c.pack.ruleset);
  if (!sys || !sys.actors) throw new Error(`the ruleset "${c.campaign.ruleset}" has no creature rules`);
  return { tokens, actors, states, content: c.content, sys, ruleset: sys.actors };
}

/** A creature ready to use: {id, token, actor, state, effects, prepared}. */
export function creature(game, who) {
  const id = resolveToken(game.tokens, who);
  const actor = game.actors[id];
  if (!actor) throw new Error(`${game.tokens[id].name || id} has no game data (no actors/${id})`);
  const token = game.tokens[id], state = game.states[id] || {}, effects = token.effects || [];
  const prepared = prepareActor({ actor, state, effects, content: game.content, ruleset: game.ruleset });
  if (!prepared.name) prepared.name = token.name;
  // name: the token's real name (for the GM); shown: what players know it as (for anything said at the table)
  return { id, token, actor, state, effects, prepared, name: token.name || prepared.name, shown: publicName(token) || prepared.name };
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
  for (const pr of p.problems) out.push(`PROBLEM: ${pr}`);
  return out;
}

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
    return { lines: [`${c.shown}: ${r.lines.join('; ')}`, `players see: ${after}`], writes };
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
  throw new Error('commands: list, show, damage, heal, temp, recover, resource, shield');
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const rec = opt('--records'), parts = opt('--parts'), roll = opt('--roll');
    const o = { crit: flag('--crit'), nonlethal: flag('--nonlethal'), all: flag('--all'), parts, roll };
    const [pack, save, cmd, ...rest] = args;
    if (!pack || !save || !cmd) throw new Error('give a pack folder, a save folder and a command');
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
