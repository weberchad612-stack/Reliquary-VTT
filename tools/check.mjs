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
// modifier given by Claude (cover, aid). Prints JSON {total, dc, degree, lines}. Docs: docs/best-practices/game-data.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { degreeOf, describeStatistic } from '../engine/rules/rules.js';
import { loadGame, creature } from './actor.mjs';

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

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  try {
    const num = (v, what) => { if (v === undefined) return undefined; const n = Number(v); if (!Number.isFinite(n)) throw new Error(`${what} is a number`); return n; };
    const roll = num(opt('--roll'), '--roll'), bonus = num(opt('--bonus'), '--bonus') || 0, dcOpt = num(opt('--dc'), '--dc'), modOpt = num(opt('--mod'), '--mod');
    const rec = opt('--records'), who = opt('--who'), statName = opt('--stat'), strike = opt('--strike'), against = opt('--against'), defense = opt('--defense'), attackN = num(opt('--attack'), '--attack') || 1;
    if (modOpt !== undefined) { console.log(JSON.stringify(resolveCheck({ mod: modOpt, dc: dcOpt, roll, bonus }), null, 2)); return 0; }
    const [pack, save] = args;
    if (!pack || !save || !who) throw new Error('give --mod, or a pack folder, a save folder and --who');
    const game = loadGame(pack, save, rec ? JSON.parse(fs.readFileSync(rec, 'utf8')) : null);
    const c = creature(game, who), p = c.prepared;
    let st, label, extra = 0;
    if (strike) {
      const s = p.strikes.find((x) => x.name.toLowerCase() === strike.toLowerCase());
      if (!s) throw new Error(`${c.name} has no Strike "${strike}" (${p.strikes.map((x) => x.name).join(', ')})`);
      st = s.attack; extra = s.map[Math.max(0, Math.min(2, attackN - 1))]; label = `${c.shown}: ${s.name} Strike${attackN > 1 ? ` (attack ${attackN}, ${extra})` : ''}`;
    } else {
      if (!statName) throw new Error('give --stat or --strike');
      st = statOf(p, statName); label = `${c.shown}: ${st.label}`;
    }
    let dc = dcOpt, dcLabel = '';
    if (against) {
      const t = creature(game, against), def = statOf(t.prepared, defense || (strike ? 'ac' : ''));
      dc = def.slug === 'ac' || /dc/.test(def.slug) ? def.value : 10 + def.value;
      dcLabel = ` (${t.shown}'s ${def.label}${def.slug === 'ac' || /dc/.test(def.slug) ? '' : ' DC'})`;
    }
    const r = resolveCheck({ mod: st.value + extra, dc, roll, bonus, label, dcLabel });
    r.lines.push(describeStatistic(st));
    console.log(JSON.stringify(r, null, 2));
    return 0;
  } catch (e) {
    console.error(`check: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
