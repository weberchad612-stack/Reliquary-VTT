#!/usr/bin/env node
// Visual effects from chat: the record Claude writes to the board to play an effect (fx/<id>), the effects a
// ruleset (and a pack) has, and a check of a pack's effects.json.
//
// Usage:
//   node tools/fx.mjs play <effect> --map MAP [--from TOKEN|X,Y] [--to TOKEN|ID,ID|targets|X,Y|template:ID]
//        [--result hit|crit|miss] [--results ID=hit,ID=miss] [--text "-12"] [--texts ID=-12,ID=-6]
//        [--n 3] [--colour #hex] [--kind strike|ranged|projectile|area|heal|buff|condition] [--traits fire,cold] [--gm]
//   node tools/fx.mjs list [--ruleset pf2e] [--pack PACK-DIR] [--group TEXT] [--search TEXT]
//   node tools/fx.mjs check <pack-dir>
//
// play prints JSON {path, record}: write `record` to the board's store at `path` (db_write, a new record; it is
// played once by every open board and removed after ten minutes). X,Y are cells (3.5,4.5 is the centre of square
// 3,4). An unknown effect name still plays: the board falls back by --kind and --traits (a fire area becomes the
// ruleset's fire burst). Floating text shows only what the players know: damage ("-12"), healing ("+8"), a
// condition's name; never hit points, AC or an ability the party has not seen. Use --gm for a play only the GM
// view should see. Docs: docs/best-practices/board.md (visual effects).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fxRecord, fxId, FX_COLLECTION, libraries, previewList } from '../board/fx.js';
import { resolveEffect, checkLibrary } from '../engine/fx/fx.js';
import { systemConfig } from '../rulesets/systems.js';

const KINDS = ['strike', 'ranged', 'projectile', 'beam', 'area', 'heal', 'buff', 'condition'];
const num = (v) => v !== '' && Number.isFinite(Number(v));
/** "3,4" -> [3, 4]; "kerra" -> "kerra"; "a,b" -> ["a", "b"]; "targets", "template:t1" as they are. */
export function parseTo(v) {
  if (v === undefined) return undefined;
  const parts = String(v).split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length === 2 && parts.every(num)) return parts.map(Number);
  return parts.length > 1 ? parts : parts[0];
}
const pairs = (v, f = (x) => x) => (v === undefined ? undefined : Object.fromEntries(String(v).split(',').map((kv) => { const i = kv.indexOf('='); if (i < 1) throw new Error(`"${kv}": give ID=value`); return [kv.slice(0, i).trim(), f(kv.slice(i + 1).trim())]; })));

/** Load a pack's effects.json (or the file pack.json names), or null. */
export function packEffects(packDir) {
  if (!packDir) return null;
  const pj = path.join(packDir, 'pack.json'), pack = fs.existsSync(pj) ? JSON.parse(fs.readFileSync(pj, 'utf8')) : {};
  const f = path.join(packDir, pack.effects || 'effects.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

/** Build a play from options (the CLI's work, without printing). */
export function playFromOptions({ name, map, from, to, result, results, text, texts, n, colour, kind, traits, gm, now = Date.now(), ruleset = 'pf2e', pack = null }) {
  if (kind && !KINDS.includes(kind)) throw new Error(`--kind is one of ${KINDS.join(', ')}`);
  const o = { result, results, text, texts, n, colour, kind, traits: traits && traits.length ? traits : undefined, gm: gm || undefined };
  const record = fxRecord({ map, name, from, to, o, by: 'claude', now });
  const sys = systemConfig(ruleset);
  const found = resolveEffect(name, libraries(pack, sys && sys.effects), { kind, traits });
  return { path: `${FX_COLLECTION}/${fxId(now)}`, record, plays: found.name, via: found.via };
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const cmd = args.shift();
    if (cmd === 'play') {
      const o = {
        map: opt('--map'), from: parseTo(opt('--from')), to: parseTo(opt('--to')), result: opt('--result'), results: pairs(opt('--results')),
        text: opt('--text'), texts: pairs(opt('--texts')), colour: opt('--colour'), kind: opt('--kind'),
        traits: (opt('--traits') || '').split(',').map((x) => x.trim()).filter(Boolean), gm: flag('--gm'),
        ruleset: opt('--ruleset') || 'pf2e', pack: packEffects(opt('--pack')),
      };
      const nv = opt('--n'); if (nv !== undefined) o.n = Number(nv);
      if (Array.isArray(o.from) && typeof o.from[0] === 'string') throw new Error('--from is one token or X,Y');
      if (args.length !== 1) throw new Error('give one effect name');
      if (!o.map) throw new Error('--map is the map the play is on (the party\'s map)');
      const out = playFromOptions({ ...o, name: args[0] });
      if (out.via === 'fallback') console.error(`fx: "${args[0]}" is not in the library; it plays as "${out.plays}"`);
      console.log(JSON.stringify({ path: out.path, record: out.record }, null, 2));
      return 0;
    }
    if (cmd === 'list') {
      const sys = systemConfig(opt('--ruleset') || 'pf2e'), pack = packEffects(opt('--pack')), group = (opt('--group') || '').toLowerCase();
      if (!sys || !sys.effects) throw new Error('no such ruleset, or it has no effects');
      for (const g of previewList(libraries(pack, sys.effects), opt('--search') || '')) {
        if (group && !g.group.toLowerCase().includes(group)) continue;
        console.log(`\n${g.group}`);
        for (const it of g.items) console.log(`  ${it.name.padEnd(20)} ${it.label}${it.attack ? '  [attack]' : ''}${it.area ? '  [area]' : ''}${it.via === 'pack' ? '  (pack)' : ''}`);
      }
      return 0;
    }
    if (cmd === 'check') {
      const dir = args[0];
      if (!dir) throw new Error('give a pack folder');
      const pj = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8')), lib = packEffects(dir);
      if (!lib) { console.log('This pack has no effects of its own.'); return 0; }
      const sys = systemConfig(pj.ruleset), problems = checkLibrary(lib, (sys && sys.effects) || {});
      for (const p of problems) console.log(`  ${p}`);
      console.log(problems.length ? `${problems.length} problem(s)` : `OK: ${Object.keys(lib.effects || {}).length} effect(s)`);
      return problems.length ? 1 : 0;
    }
    throw new Error('commands: play, list, check');
  } catch (e) {
    console.error(`fx: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
