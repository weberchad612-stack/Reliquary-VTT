// The character builder's completeness sweep (docs/design/game-data.md 9.13): build every class, ancestry, heritage
// and background, try every option of every choice they ask, and report what goes wrong: a problem, a rule the
// builder cannot run, a choice with no options, a choice whose options are only a placeholder, a granted feat taken
// back. A choice the builder never asks for is the text check's to find (textcheck.js); this finds what it asks
// for and gets wrong.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILLS, ATTRIBUTES, boostSlots } from './build.js';
import { LANGUAGES } from './languages.js';

const OPEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'pf2e');
const keysIn = (source, folder) => fs.readdirSync(path.join(OPEN, source, folder)).filter((f) => f.endsWith('.json')).map((f) => `${source}:${folder}/${f.slice(0, -5)}`);

/**
 * Fill a build's open steps the way a player might, choosing the first option each time, except those in `fixed`
 * (step -> value). Feat slots are filled only with fillFeats. Returns {build, stuck: [{id, why}]}.
 */
export function autoFill(B, build, { fixed = {}, fillFeats = false, rounds = 25 } = {}) {
  let b = JSON.parse(JSON.stringify(build));
  let stuck = new Map();   // a step stuck now may come free once a later step is made (a summoner's spells wait on its tradition)
  const tried = new Set(), made = new Set();
  for (let i = 0; i < rounds; i++) {
    const { steps } = B.steps(b);
    let moved = false;
    for (const s of steps) {
      if (tried.has(s.id)) continue;
      if (s.step.startsWith('feat.') && !fillFeats) continue;
      tried.add(s.id);
      let values;
      if (fixed[s.id] !== undefined || fixed[s.step] !== undefined) values = [].concat(fixed[s.id] ?? fixed[s.step]);
      else if (s.step === 'gear') values = ['done'];
      else if (s.step === 'tradition') continue;
      else if (s.choice && s.choice.owned) continue;   // chosen from the gear, once bought
      else {
        const { options } = B.options(b, s.id);
        let usable = options.filter((o) => !o.blocked && !o.needs && !/^[<-]/.test(String(o.value)));
        // a Lore the player names: any subject will do here
        if (!usable.length && options.some((o) => o.value === '<subject>' || o.value === '<name>')) usable = [{ value: 'Sweeping' }];
        if (!usable.length) { stuck.set(s.id, options.length ? `only ${options.length} option(s) that need approval or are placeholders` : 'no options'); tried.delete(s.id); continue; }
        const n = s.step.startsWith('boosts.') ? s.count : ['skills', 'trained', 'languages'].includes(s.step) || s.step.startsWith('spells.') ? (s.choice && s.choice.count) || s.count : 1;
        values = usable.slice(0, n).map((o) => o.value);
        if (s.step.startsWith('boosts.')) {
          // boosts one at a time: each slot's options depend on the last
          for (let k = 0; k < s.count; k++) { const o = B.options(b, s.id).options.filter((x) => !x.blocked); if (!o.length) break; b = B.apply(b, s.id, o[0].value); }
          moved = true;
          continue;
        }
      }
      try { b = B.apply(b, s.id, values); moved = true; stuck.delete(s.id); made.add(s.id); } catch (e) { stuck.set(s.id, e.message); }
    }
    if (!moved) break;
  }
  // what is still open at the end, and stuck
  const open = new Set(B.steps(b).steps.map((s) => s.id));
  return { build: b, made: [...made], stuck: [...stuck].filter(([id]) => open.has(id)).map(([id, why]) => ({ id, why })) };
}

const issuesOf = (r) => [
  ...r.problems.map((p) => ({ kind: 'problem', text: p })),
  ...r.unsupported.map((u) => ({ kind: 'cannot run', text: `${u.from}: ${u.why}` })),
  // a grant taken back is the rules working (Sarenrae's scimitar is not simple: no Deadly Simplicity); kept as a note
  ...(r.notGranted || []).map((n) => ({ kind: 'note', text: `${n.feat} not granted (from ${n.from}): ${n.unmet.join('; ')}` })),
];


// every option of every choice the filled build made (choice.*), one at a time, each tried from the start with the
// later steps filled after it (a sorcerer's spells follow its bloodline); only the choices `which` accepts
function vary(B, start, build, made, fixed, out, which) {
  const seen = new Set();
  for (const id of made) {
    if (!/choice\./.test(id) || !which(id)) continue;
    const without = B.clear(build, id);
    const { options } = B.options(without, id, { all: false });
    if (!options.length) { out.push({ where: id, kind: 'stuck', text: 'no options' }); continue; }
    // an option the player cannot read (a Steadfast Tanuki's blank choices)
    const blank = options.filter((o) => !String(o.name || o.label || '').trim() || /^PF2E\./.test(String(o.name || o.label)));
    if (blank.length) out.push({ where: id, kind: 'unreadable', text: `${blank.length} option(s) without a readable name: ${blank.slice(0, 3).map((o) => o.value).join(', ')}` });
    for (const o of options.filter((x) => !x.needs && !/^[<-]/.test(String(x.value))).slice(0, 40)) {
      const key = `${id}=${o.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const f = autoFill(B, start, { fixed: { ...fixed, [id]: o.value } });
      for (const s of f.stuck) out.push({ where: key, kind: 'stuck', text: `${s.id}: ${s.why}` });
      for (const i of issuesOf(B.derive(f.build))) out.push({ where: key, ...i });
    }
  }
}

/**
 * Sweep one class: the base build filled, then each choice's every option tried in turn (with the rest filled).
 * base: the ancestry, heritage, background to build on. Returns [{where, kind, text}].
 */
export function sweepClass(B, classKey, { level = 1, base = {}, fixed = {} } = {}) {
  const out = [];
  const add = (where, list) => { for (const i of list) out.push({ where, ...i }); };
  const start = { v: 1, level, ancestry: 'ancestries:ancestry/human', heritage: 'heritages:heritage/skilled-human', background: 'backgrounds:background/acolyte', ...base, class: classKey };
  const { build, stuck, made } = autoFill(B, start, { fixed });
  add('base', stuck.map((s) => ({ kind: 'stuck', text: `${s.id}: ${s.why}` })));
  add('base', issuesOf(B.derive(build)));
  vary(B, start, build, made, fixed, out, (id) => true);
  // the same issue from many options is one issue
  const uniq = new Map();
  for (const i of out) { const k = `${i.kind}|${i.text}`; if (!uniq.has(k)) uniq.set(k, { ...i, count: 0 }); uniq.get(k).count++; }
  return [...uniq.values()];
}

/** Every ancestry with each of its heritages (and the versatile ones on a human), and every background. */
export function sweepOrigins(B, { classKey = 'classes:class/fighter' } = {}) {
  const out = [];
  // the origin's own choices (and what they grant), not the class's
  const cls = B.get(classKey);
  const classOwn = new Set(((cls && cls.features) || []).map((f) => String(f.ref || '').split('/').pop()).concat(classKey.split('/').pop()));
  const notClass = (id) => !classOwn.has(String(id).replace(/^\d+:choice\./, '').split('.')[0]);
  const hers = keysIn('heritages', 'heritage').map((k) => [k, B.get(k)]);
  for (const a of keysIn('ancestries', 'ancestry')) {
    const own = hers.filter(([, d]) => d && d.ancestry && d.ancestry.ref === a).map(([k]) => k);
    const list = a === 'ancestries:ancestry/human' ? [...own, ...hers.filter(([, d]) => d && !d.ancestry).map(([k]) => k)] : own;
    for (const h of list) {
      const b = { v: 1, level: 1, ancestry: a, heritage: h, background: 'backgrounds:background/acolyte', class: classKey, approvals: [{ what: a }, { what: h }] };
      const f = autoFill(B, b);
      for (const s of f.stuck) out.push({ where: h, kind: 'stuck', text: `${s.id}: ${s.why}` });
      for (const i of issuesOf(B.derive(f.build))) out.push({ where: h, ...i });
      vary(B, b, f.build, f.made, {}, out, notClass);
    }
  }
  for (const g of keysIn('backgrounds', 'background')) {
    const b = { v: 1, level: 1, ancestry: 'ancestries:ancestry/human', heritage: 'heritages:heritage/skilled-human', background: g, class: classKey, approvals: [{ what: g }] };
    const f = autoFill(B, b);
    for (const s of f.stuck) out.push({ where: g, kind: 'stuck', text: `${s.id}: ${s.why}` });
    for (const i of issuesOf(B.derive(f.build))) out.push({ where: g, ...i });
    vary(B, b, f.build, f.made, {}, out, notClass);
  }
  return out;
}

export { keysIn };
