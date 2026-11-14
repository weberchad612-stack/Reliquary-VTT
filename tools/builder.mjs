#!/usr/bin/env node
// The character builder from chat (docs/design/game-data.md section 9). The game system's builder is
// rulesets/<system>/builder.js; this tool only reaches it.
//
//   node tools/builder.mjs report [--system pf2e] [--json] [--class <slug>]
//       What the builder cannot run yet in the system's open content (the building rules it leaves to the GM, and
//       why), by class and for the ancestries, heritages, backgrounds and feats.
//
// Steps to come add next, options, choose, preview and finish (section 9.4).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The game system's builder module (rulesets/<system>/builder.js). */
export async function systemBuilder(system = 'pf2e') {
  const f = path.join(ROOT, 'rulesets', system, 'builder.js');
  if (!fs.existsSync(f)) throw new Error(`ruleset "${system}" has no character builder (rulesets/${system}/builder.js)`);
  return import(pathToFileURL(f).href);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd !== 'report') { console.error('usage: node tools/builder.mjs report [--system pf2e] [--json] [--class <slug>]'); process.exit(2); }
  const b = await systemBuilder(opt('--system') || 'pf2e');
  const r = b.report({ only: opt('--class') });
  if (rest.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else process.stdout.write(b.markdown(r));
}
