#!/usr/bin/env node
// Dice for Claude, logged for the board's Dice tab (board/dice.js): roll a formula, or record dice rolled elsewhere
// (a player's physical dice, a d20 given to tools/check.mjs with --roll). Prints the result and the dice/<id>
// record to write with db_write; the Dice tab's statistics count it, and the save keeps it (dice.json).
//
// Usage: node tools/dice.mjs roll <formula> --who NAME [--kind K] [--side party|others] [--gm] [--seed N]
//          [--crit] [--type T] [--label L]   (damage: --crit doubles the total; --type is the damage type)
//        node tools/dice.mjs log --who NAME [--kind K] [--side party|others] [--gm] d20=14 2d6=3,5
//        add --pack <pack-dir> --save <save-dir> [--records FILE] to find the roller's token (its public name and
//        side); without them --side says the side (default others).
// --kind is one of the ruleset's roll kinds (initiative, attack, save, skill, perception, damage, flat, recovery,
// other for Pathfinder); --gm marks a roll players must not know about (a hidden creature's). The output's `roll` is
// the roll in parts, which tools/replay.mjs puts in a replay step's details (board/rolldetail.js).
// Docs: docs/best-practices/board.md (dice statistics).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollFormula, seededRandom } from '../engine/rules/dice.js';
import { dicePath, diceRecord, formulaDice, sideOf } from '../board/dice.js';
import { resolveToken, publicName } from '../board/names.js';

/** Dice given as words: "d20=14", "2d6=3,5" -> [{sides, v}]. */
export function parseDice(words) {
  return words.flatMap((w) => {
    const m = /^(\d*)d(\d+)=([\d,]+)$/i.exec(String(w).trim());
    if (!m) throw new Error(`"${w}" is not dice like d20=14 or 2d6=3,5`);
    const vals = m[3].split(',').map(Number), n = m[1] ? Number(m[1]) : vals.length;
    if (vals.length !== n) throw new Error(`"${w}": ${n} dice but ${vals.length} values`);
    return vals.map((v) => ({ sides: Number(m[2]), v }));
  });
}

/**
 * The record for a command: {lines, writes}. game (optional): {tokens} to find the roller.
 * cmd: 'roll' (args: the formula) or 'log' (args: dice words).
 */
export function runDice(cmd, args, opts = {}, game = null) {
  if (!opts.who) throw new Error('--who is needed (the roller)');
  let token = null, who = opts.who, side = opts.side === 'party' ? 'party' : 'others';
  if (game) { token = resolveToken(game.tokens, opts.who); const t = game.tokens[token]; who = publicName(t) || t.name || who; side = opts.side || sideOf(t); }
  const rec = (dice) => diceRecord({ who, token, side, kind: opts.kind || 'other', dice, by: 'claude', gm: !!opts.gm });
  if (cmd === 'roll') {
    const r = rollFormula(args.join(' '), opts.seed !== undefined ? seededRandom(Number(opts.seed)) : Math.random);
    const dice = formulaDice(r);
    if (!dice.length) throw new Error('the formula rolls no dice');
    // --crit doubles the total (a critical hit's damage); the roll in parts goes in a replay step's details
    const total = opts.crit ? r.total * 2 : r.total;
    const damage = (opts.kind || 'other') === 'damage';
    const roll = damage
      ? { type: 'damage', token, who, label: opts.label || 'Damage', formula: r.text.split(' = ')[0], text: r.text, rolled: r.total, ...(opts.crit ? { crit: true } : {}), total, ...(opts.type ? { damageType: opts.type } : {}) }
      : { type: 'roll', token, who, label: opts.label || (opts.kind || 'Roll'), text: r.text, total };
    return { lines: [`${who}: ${r.text}${opts.crit ? `, doubled: ${total} (critical)` : ''}`], total, roll, writes: [{ op: 'set', path: dicePath(), data: rec(dice) }] };
  }
  if (cmd === 'log') {
    const dice = parseDice(args);
    return { lines: [`${who}: ${dice.map((d) => `d${d.sides} ${d.v}`).join(', ')} logged`], writes: [{ op: 'set', path: dicePath(), data: rec(dice) }] };
  }
  throw new Error('commands: roll <formula>, log <dice>');
}

async function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const pack = opt('--pack'), save = opt('--save'), rec = opt('--records');
    const opts = { who: opt('--who'), kind: opt('--kind'), side: opt('--side'), seed: opt('--seed'), gm: flag('--gm'), crit: flag('--crit'), type: opt('--type'), label: opt('--label') };
    const [cmd, ...rest] = args;
    let game = null;
    if (pack && save) { const { loadGame } = await import('./actor.mjs'); game = loadGame(pack, save, rec ? JSON.parse(fs.readFileSync(rec, 'utf8')) : null); }
    console.log(JSON.stringify(runDice(cmd, rest, opts, game), null, 2));
    return 0;
  } catch (e) {
    console.error(`dice: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv).then((c) => process.exit(c));
