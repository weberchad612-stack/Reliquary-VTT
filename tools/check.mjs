#!/usr/bin/env node
// Checks from chat: a creature's statistic (or a Strike) against a DC (or a target's defence), with the degree
// of success by the ruleset's rules. The dice service comes later (docs/design/game-data.md, step 3); until
// then the d20 is given (--roll), and the total is worked out from the creature's numbers.
//
// Usage:
//   node tools/check.mjs --mod 7 --dc 15 --roll 12
//   node tools/check.mjs <pack-dir> <save-dir> [--records FILE] --who NAME --stat reflex|perception|athletics|... (--dc N | --against NAME --defense will|ac|...) --roll N [--bonus N]
//   node tools/check.mjs <pack-dir> <save-dir> [--records FILE] --who NAME --strike Longsword [--attack 2] --against NAME --roll N
//
// --attack is which attack this turn (1, 2, 3: the multiple attack penalty); --bonus adds a situational
// modifier given by Claude (cover, aid). Prints JSON {total, dc, degree, lines, writes} (writes: the d20s, for the
// Dice tab's statistics: write them). Docs: docs/best-practices/game-data.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { degreeOf, describeStatistic } from '../engine/rules/rules.js';
import { loadGame, creature, prepareAt } from './actor.mjs';
import { dicePath, diceRecord, sideOf } from '../board/dice.js';
import { publicName } from '../board/names.js';

const DEGREE = { 'critical-success': 'critical success', success: 'success', failure: 'failure', 'critical-failure': 'critical failure' };

/** A statistic of a prepared creature by name: ac, fortitude, reflex, will, perception, a skill, class-dc, spell-dc, spell-attack, <x>-lore. */
export function statOf(p, name) {
  const n = String(name).toLowerCase();
  if (n === 'ac') return p.ac;
  if (p.saves[n]) return p.saves[n];
  if (n === 'perception' || n === 'initiative') return p.perception;
  if (p.skills[n]) return p.skills[n];
  if (n === 'class-dc' && p.classDC) return p.classDC;
  if (n === 'spell-dc' && p.spell) return p.spell.dc;
  if (n === 'spell-attack' && p.spell) return p.spell.attack;
  const lore = n.replace(/-lore$/, '');
  if (p.lore && p.lore[lore]) return p.lore[lore];
  throw new Error(`no statistic "${name}"`);
}

/** Resolve a check: {total, dc, degree, lines}. */
export function resolveCheck({ mod, dc, roll, bonus = 0, label = 'check', dcLabel = '' }) {
  if (!Number.isInteger(roll) || roll < 1 || roll > 20) throw new Error('--roll is the d20 (1 to 20)');
  if (!Number.isFinite(dc)) throw new Error('a DC is needed');
  const total = roll + mod + bonus, degree = degreeOf(total, dc, roll);
  const lines = [`${label}: ${roll} + ${mod}${bonus ? ` ${bonus < 0 ? '−' : '+'} ${Math.abs(bonus)}` : ''} = ${total} against DC ${dc}${dcLabel}: ${DEGREE[degree]}${roll === 20 || roll === 1 ? ` (natural ${roll})` : ''}`];
  return { total, dc, degree, lines };
}

/**
 * A creature's check from the tools: a statistic or a Strike against a DC or a target's defence, with the
 * creature's own check rules: rolling twice (give both dice, "12,7"), degree of success changes, and one-roll
 * effects on the target (an off-guard target for this Strike). opts: {who, stat?, strike?, attack?, against?,
 * defense?, dc?, roll, bonus?}. Returns {total, dc, degree, lines}.
 */
export function runCheck(game, o) {
  const R = game.ruleset, c = creature(game, o.who), p = c.prepared;
  let st, label, extra = 0, kind, slug;
  if (o.strike) {
    const s = p.strikes.find((x) => x.name.toLowerCase() === String(o.strike).toLowerCase());
    if (!s) throw new Error(`${c.name} has no Strike "${o.strike}" (${p.strikes.map((x) => x.name).join(', ')})`);
    const n = o.attack || 1;
    st = s.attack; extra = s.map[Math.max(0, Math.min(2, n - 1))]; label = `${c.shown}: ${s.name} Strike${n > 1 ? ` (attack ${n}, ${extra})` : ''}`;
    kind = 'strike'; slug = String(s.slug || s.name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  } else {
    if (!o.stat) throw new Error('give --stat or --strike');
    st = statOf(p, o.stat); label = `${c.shown}: ${st.label}`;
    const n = String(o.stat).toLowerCase();
    kind = p.saves[n] ? 'save' : n === 'perception' ? 'perception' : p.skills[n] ? 'skill' : /-lore$/.test(n) ? 'lore' : n === 'spell-attack' ? 'spell-attack' : 'other';
    slug = n.replace(/-lore$/, '');
  }
  const sels = R.checkSelectors ? R.checkSelectors(kind, slug) : [slug, 'all'];
  const applies = (r) => r.selectors.some((x) => sels.includes(x));
  const cr = p.checkRules || {}, notes = [];
  // the d20: rolling twice keeps the higher (or lower) of two dice
  const dice = String(o.roll ?? '').split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x !== 0);
  const twice = (cr.rollTwice || []).find(applies);
  let roll = dice[0];
  if (twice) {
    if (dice.length < 2) notes.push(`${c.shown} rolls twice and keeps the ${twice.keep} (${twice.origin.label}): give both dice, --roll A,B`);
    else { roll = twice.keep === 'lower' ? Math.min(dice[0], dice[1]) : Math.max(dice[0], dice[1]); notes.push(`rolls twice (${dice[0]} and ${dice[1]}) and keeps the ${twice.keep}: ${roll} (${twice.origin.label})`); }
  }
  let dc = o.dc, dcLabel = '';
  if (o.against) {
    const t = creature(game, o.against);
    // one-roll effects on the target for this roll (an attack against an off-guard target)
    const eph = (cr.ephemeral || []).filter((e) => e.affects === 'target' && e.condition && applies(e));
    let tp = t.prepared;
    if (eph.length) {
      const fx = [...(t.token.effects || []), ...eph.map((e) => ({ id: e.condition, ...(e.value ? { value: e.value } : {}) }))];
      tp = prepareAt(game, t.id, { ...t.token, effects: fx }, t.state) || tp;
      notes.push(`for this roll ${t.shown} is ${eph.map((e) => e.condition).join(', ')} (${eph.map((e) => e.origin.label).join(', ')})`);
    }
    const def = statOf(tp, o.defense || (o.strike ? 'ac' : ''));
    dc = def.slug === 'ac' || /dc/.test(def.slug) ? def.value : 10 + def.value;
    dcLabel = ` (${t.shown}'s ${def.label}${def.slug === 'ac' || /dc/.test(def.slug) ? '' : ' DC'})`;
  }
  const r = resolveCheck({ mod: st.value + extra, dc, roll, bonus: o.bonus || 0, label, dcLabel });
  // degree of success changes ("a success becomes a critical success")
  const deg = (cr.degree || []).filter(applies);
  if (deg.length && R.adjustDegree) {
    const a = R.adjustDegree(r.degree, deg);
    if (a.degree !== r.degree) { r.lines.push(...a.by); r.degree = a.degree; r.lines[0] = r.lines[0].replace(/: [a-z ]+( \(natural \d+\))?$/, `: ${DEGREE[a.degree]}$1`); }
  }
  r.lines.push(...notes, describeStatistic(st));
  // the d20s given, for the Dice tab's statistics (board/dice.js): write r.writes with the result
  const d20 = dice.filter((v) => Number.isInteger(v) && v >= 1 && v <= 20).slice(0, twice ? 2 : 1);
  const rollKind = { strike: 'attack', 'spell-attack': 'attack', save: 'save', perception: 'perception', skill: 'skill', lore: 'skill' }[kind] || 'other';
  if (d20.length && c.token) r.writes = [{ op: 'set', path: dicePath(), data: diceRecord({ who: publicName(c.token) || c.token.name || c.id, token: c.id, side: sideOf(c.token), kind: rollKind, dice: d20.map((v) => ({ sides: 20, v })), by: 'claude', gm: !!c.token.hidden }) }];
  return r;
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  try {
    const num = (v, what) => { if (v === undefined) return undefined; const n = Number(v); if (!Number.isFinite(n)) throw new Error(`${what} is a number`); return n; };
    const rollRaw = opt('--roll'), roll = rollRaw !== undefined && !String(rollRaw).includes(',') ? num(rollRaw, '--roll') : undefined, bonus = num(opt('--bonus'), '--bonus') || 0, dcOpt = num(opt('--dc'), '--dc'), modOpt = num(opt('--mod'), '--mod');
    const rec = opt('--records'), who = opt('--who'), statName = opt('--stat'), strike = opt('--strike'), against = opt('--against'), defense = opt('--defense'), attackN = num(opt('--attack'), '--attack') || 1;
    if (modOpt !== undefined) { console.log(JSON.stringify(resolveCheck({ mod: modOpt, dc: dcOpt, roll, bonus }), null, 2)); return 0; }
    const [pack, save] = args;
    if (!pack || !save || !who) throw new Error('give --mod, or a pack folder, a save folder and --who');
    const game = loadGame(pack, save, rec ? JSON.parse(fs.readFileSync(rec, 'utf8')) : null);
    const r = runCheck(game, { who, stat: statName, strike, attack: attackN, against, defense, dc: dcOpt, roll: rollRaw, bonus });
    console.log(JSON.stringify(r, null, 2));
    return 0;
  } catch (e) {
    console.error(`check: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
