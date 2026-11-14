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
//   node tools/builder.mjs finish <save> <id> [--actor ID]                   writes <save>/actors/<ID>.json (no step or
//       problem may be left); the token goes on the board in step 5 (section 9.4)
//   node tools/builder.mjs settings <save> [--books "A|B"] [--all-books]      the campaign's books (default: all)
//   node tools/builder.mjs books [--system pf2e]                              the books in the open content
//   node tools/builder.mjs report [--system pf2e] [--json] [--class <slug>]  the building rules it cannot run yet

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
const settingsOf = (save) => { const f = path.join(save, 'builder.json'); return fs.existsSync(f) ? readJson(f) : { sources: null }; };
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
    if (flags['all-books'] || flags.books) writeJson(path.join(save, 'builder.json'), st);
    return out(st.sources ? `Books: ${st.sources.join('; ')}` : 'Books: all the open content');
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
  const id = pos[1];
  const d = readDraft(save, id);
  if (cmd === 'next') { const r = stepLines(B, d, 100); return out(flags.json ? { steps: r.steps, problems: r.result.problems, checks: r.result.checks } : r.lines.join('\n')); }
  if (cmd === 'options') {
    const step = pos[2];
    const { step: s, options } = B.options(d.build, step, { all: !!flags.all, search: typeof flags.search === 'string' ? flags.search : undefined });
    const lim = Number(flags.limit) || (flags.json ? Infinity : 60);
    if (flags.json) return out({ step: s, count: options.length, options: options.slice(0, lim) });
    const line = (o) => `${o.value}${o.name !== o.value ? ` = ${o.name}` : ''}${o.level !== undefined ? ` [${o.level}]` : ''}${o.rarity ? ` (${o.rarity})` : ''}${o.legacy ? ' (legacy)' : ''}${o.needs ? ` NEEDS ${o.needs}` : ''}${o.gmChecks ? ` GM CHECKS: ${o.gmChecks.join('; ')}` : ''}${o.blocked ? ` BLOCKED: ${o.blocked.join('; ')}` : ''}${o.summary ? `\n    ${o.summary}` : ''}`;
    return out([`${step}: ${s.text || ''} (${options.length} option${options.length === 1 ? '' : 's'})`, ...options.slice(0, lim).map(line), ...(options.length > lim ? [`... ${options.length - lim} more (--limit, --search)`] : [])].join('\n'));
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
    const actorId = typeof flags.actor === 'string' ? flags.actor : d.actor || `tok-${crypto.randomBytes(4).toString('hex')}`;
    writeJson(path.join(save, 'actors', `${actorId}.json`), result.actor);
    d.status = 'finished'; d.actor = actorId;
    saveDraft(save, d);
    return out(`Finished ${d.name}: ${save}/actors/${actorId}.json${(result.checks || []).length ? ` (${result.checks.length} prerequisite(s) for the GM to check)` : ''}. Its token goes on the board in step 5.`);
  }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
