#!/usr/bin/env node
// Effect badges from chat: change a token's effects (conditions and custom effects) and its dead state.
// Reads a token record (as db_get or db_list gives it, or the token from a map state), prints the changed
// token. Write it back with db_write (update, with the version you read) and a log entry.
//
// Usage:
//   node tools/effect.mjs <token.json> add <condition> [VALUE] [--detail TEXT] [--until TEXT] [--source TEXT] [--gm-only]
//   node tools/effect.mjs <token.json> custom "<name>" [--kind good|bad|neutral] [--value N] [--detail ...] [--until ...] [--source ...] [--gm-only]
//   node tools/effect.mjs <token.json> apply <content-key> [--level N] [--value N] [--name NAME] [--kind ...] [--pack DIR] [...]
//       an effect from the content (spells:effect/..., spell-effects:effect/spell-effect-heroism): a badge by its
//       name whose rules change the creature's numbers, at the level given (a spell's rank; default the
//       document's). Also prints the content record (content/...) for the board to hold; --pack resolves a key
//       without a source through that pack's library.
//   node tools/effect.mjs <token.json> remove <condition | custom name>
//   node tools/effect.mjs <token.json> clear            (every effect)
//   node tools/effect.mjs <token.json> dead | alive
//   node tools/effect.mjs <token.json> elevation <FEET>   (height above the ground; negative below; 0 clears it)
//   node tools/effect.mjs list                           (the system's conditions)
//   Any of these takes [--ruleset ID] (default pf2e) for the system's conditions.
//
// Adding a condition the token already has replaces it (frightened 2 -> frightened 1). Unconscious and
// dying grey the token; dead fades it, stops it blocking and seeing, and takes it out of targeting.
// Prints JSON {token, changed: [what changed]}. Docs: docs/best-practices/board.md (effect badges).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withEffect, withoutEffect } from '../board/effects.js';
import { systemConfig } from '../rulesets/systems.js';
import { contentLibrary, parseKey } from './library.mjs';
import { contentPath } from '../board/records.js';

/** A friendly badge name for an effect document: "Spell Effect: Heroism" -> "Heroism". */
export const effectName = (doc) => String(doc.name || '').replace(/^(Spell |Feat |Equipment |Bestiary |Other |Stance |Aura )?Effect: /i, '').trim() || doc.name;

/** Apply one command to a token. Returns {token, changed}. */
export function applyEffect(token, cmd, args, opts, conditions) {
  const t = { ...token, effects: [...(token.effects || [])] };
  const changed = [];
  const base = { detail: opts.detail, until: opts.until, source: opts.source, gm_only: !!opts.gmOnly };
  if (cmd === 'add') {
    const [id, v] = args;
    if (!id) throw new Error('add needs a condition id');
    const c = conditions[id];
    const value = v !== undefined ? Number(v) : undefined;
    if (v !== undefined && !Number.isInteger(value)) throw new Error(`value "${v}" is not a whole number`);
    t.effects = withEffect(t.effects, { id, value, ...base }, conditions);
    changed.push(`${c ? c.label : id}${value !== undefined ? ' ' + value : ''}`);
  } else if (cmd === 'custom') {
    const [name] = args;
    const value = opts.value !== undefined ? Number(opts.value) : undefined;
    if (opts.kind && !['good', 'bad', 'neutral'].includes(opts.kind)) throw new Error('--kind is good, bad or neutral');
    if (name && conditions[name]) throw new Error(`"${name}" is a condition: use add`);
    t.effects = withEffect(t.effects, { name, kind: opts.kind || 'neutral', value, ...base }, conditions);
    changed.push(name);
  } else if (cmd === 'apply') {
    const [key] = args, doc = opts.doc;
    if (!key || !doc) throw new Error('apply needs a content key of an effect (spell-effects:effect/spell-effect-heroism)');
    if (doc.kind !== 'effect') throw new Error(`${key} is ${doc.kind === 'item' ? 'an item' : `a ${doc.kind}`}, not an effect`);
    const level = opts.level !== undefined ? Number(opts.level) : undefined, value = opts.value !== undefined ? Number(opts.value) : undefined;
    if (level !== undefined && !Number.isInteger(level)) throw new Error(`--level "${opts.level}" is not a whole number`);
    if (value !== undefined && !Number.isInteger(value)) throw new Error(`--value "${opts.value}" is not a whole number`);
    if (opts.kind && !['good', 'bad', 'neutral'].includes(opts.kind)) throw new Error('--kind is good, bad or neutral');
    const name = opts.name || effectName(doc);
    t.effects = withEffect(t.effects, { name, kind: opts.kind || 'good', ref: key, level, value, ...base }, conditions);
    changed.push(`${name}${level !== undefined ? ` (level ${level})` : ''}`);
  } else if (cmd === 'remove') {
    const [key] = args;
    const before = t.effects.length;
    t.effects = withoutEffect(t.effects, key);
    if (t.effects.length === before) throw new Error(`the token has no effect "${key}"`);
    changed.push(`removed ${(conditions[key] && conditions[key].label) || key}`);
  } else if (cmd === 'clear') {
    changed.push(`cleared ${t.effects.length} effect(s)`);
    t.effects = [];
  } else if (cmd === 'dead') {
    t.dead = true; changed.push('dead');
  } else if (cmd === 'alive') {
    delete t.dead; changed.push('no longer dead');
  } else if (cmd === 'elevation') {
    const n = Number(args[0]);
    if (args[0] === undefined || !Number.isInteger(n)) throw new Error('elevation needs a whole number of feet (negative for below)');
    if (n) t.elevation = n; else delete t.elevation;
    changed.push(n ? `elevation ${n > 0 ? '+' : ''}${n} ft` : 'elevation 0');
  } else throw new Error(`unknown command "${cmd}"`);
  if (!t.effects.length) delete t.effects;
  return { token: t, changed };
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const sys = systemConfig(opt('--ruleset') || 'pf2e');
    if (!sys) throw new Error('unknown --ruleset');
    const conditions = sys.conditions || {};
    const opts = { detail: opt('--detail'), until: opt('--until'), source: opt('--source'), kind: opt('--kind'), value: opt('--value'), level: opt('--level'), name: opt('--name'), gmOnly: flag('--gm-only') };
    const packDir = opt('--pack');
    if (args[0] === 'list') {
      for (const [id, c] of Object.entries(conditions)) console.log(`${c.icon}  ${id.padEnd(12)} ${c.kind.padEnd(8)} ${c.valued ? 'value' : '     '}  ${c.label}`);
      return 0;
    }
    const [file, cmd, ...rest] = args;
    if (!file || !cmd) throw new Error('give a token file and a command (add, custom, apply, remove, clear, dead, alive, elevation)');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const token = raw.data && !raw.x ? raw.data : raw;   // a db_get/db_list entry, or the token itself
    let content = null;
    if (cmd === 'apply') {
      parseKey(rest[0]);
      const pack = packDir ? JSON.parse(fs.readFileSync(path.join(packDir, 'pack.json'), 'utf8')) : { ruleset: 'pf2e' };
      opts.doc = contentLibrary(pack, packDir || null).get(rest[0]);
      if (!opts.doc) throw new Error(`no content "${rest[0]}"${packDir ? '' : ' (a key without a source needs --pack)'}`);
      content = { op: 'set', path: contentPath(rest[0]), data: opts.doc };
    }
    const out = applyEffect(token, cmd, rest, opts, conditions);
    console.log(JSON.stringify(content ? { ...out, content } : out, null, 2));
    return 0;
  } catch (e) {
    console.error(`effect: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
