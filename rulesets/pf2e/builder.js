// The PF2E character builder's Node side (docs/design/game-data.md section 9), reached through tools/builder.mjs.
// report(): what the builder cannot yet run in the open content: for each class (its own rules, its class features
// and everything they grant), and for the ancestries, heritages, backgrounds and feats, the "pick one", "you gain
// this" and proficiency rules it has to leave to the GM, and why. The rules a character uses at the table
// (modifiers, notes, roll options) are not counted: they are read in play, not at building.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { foundryResolver, predicateHolds, textGains, classSection, rankFormula, BUILD_RULES } from './build.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OPEN = path.join(ROOT, 'content', 'pf2e');

/** The open content by key ('<source>:<folder>/<slug>'). */
export function contentGetter(dir = OPEN) {
  const cache = new Map();
  return (key) => {
    if (cache.has(key)) return cache.get(key);
    const m = /^([^:]+):([^/]+)\/(.+)$/.exec(key || '');
    const f = m && path.join(dir, m[1], m[2], m[3] + '.json');
    const d = f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : undefined;
    cache.set(key, d);
    return d;
  };
}

/** The names (lower case) of every feat and feature in the open content: prerequisites that name one. */
export function knownFeatNames(dir = OPEN) {
  const out = new Set();
  for (const [source, folder] of [['feats', 'feat'], ['class-features', 'feat'], ['ancestry-features', 'feat'], ['heritages', 'heritage']]) {
    const d = path.join(dir, source, folder);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) out.add(JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')).name.toLowerCase().replace(/[’']/g, "'"));
  }
  return out;
}

const keysIn = (source, folder) => {
  const d = path.join(OPEN, source, folder);
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => `${source}:${folder}/${f.slice(0, -5)}`) : [];
};

// the roll options a build gives a character (rulesets/pf2e/build.js deriveCharacter), and those its choices give
const BUILT = /^(class|feat|feature|ancestry|heritage|background|self:trait|self:heritage):|^deity$|^parent:granter(:|$)/;
function knower(get) {
  const opts = new Set();
  for (const [source, folder] of [['classes', 'class'], ['class-features', 'feat'], ['feats', 'feat'], ['ancestries', 'ancestry'], ['heritages', 'heritage'], ['backgrounds', 'background'], ['ancestry-features', 'feat']]) {
    for (const k of keysIn(source, folder)) for (const r of (get(k) || {}).rules || []) if (r.foundry && r.foundry.key === 'ChoiceSet' && r.foundry.rollOption) opts.add(r.foundry.rollOption);
  }
  return (t) => BUILT.test(t) || opts.has(t) || [...opts].some((o) => t.startsWith(o + ':'));
}

const strings = (x) => (typeof x === 'string' ? [x] : Array.isArray(x) ? x.flatMap(strings) : x && typeof x === 'object' ? Object.values(x).flatMap(strings) : []);
const REF = /\{(?!item\|flags\.system\.rulesSelections\.|actor\|flags\.)[^}]*\}/i;

/** The building rules in one document the builder cannot run: [{rule, why, detail}]. */
export function unrunnable(d, { resolve, knows, classFeature = false, className }) {
  const ANY = { level: 20, tags: { has: () => true }, knows };
  const out = [];
  const rules = (d.rules || []).map((r) => (r.key === 'unsupported' ? r.foundry : null)).filter((fr) => fr && BUILD_RULES.includes(fr.key));
  const covered = rules.some((fr) => fr.key === 'MartialProficiency' || /\.rank$/.test(fr.path || ''));
  if (classFeature && !covered) for (const u of textGains(classSection(d.text, className)).unread) out.push({ rule: 'text', why: 'a proficiency gain the player says how to apply', detail: u });
  for (const fr of rules) {
    // a roll option under a condition of play (a spellshape, a finisher) is set at the table, not at building
    if (fr.key === 'RollOption') continue;
    if (predicateHolds(fr.predicate, ANY) === null) { out.push({ rule: fr.key, why: 'a condition the builder cannot check', detail: JSON.stringify(fr.predicate) }); continue; }
    if (fr.key === 'ChoiceSet') {
      const c = fr.choices;
      if (c && typeof c === 'object' && !Array.isArray(c) && c.ownedItems) out.push({ rule: fr.key, why: 'a choice among the character\'s own gear (made once the gear is bought, step 5)', detail: JSON.stringify(c).slice(0, 120) });
      else if (!(Array.isArray(c) || (c && typeof c === 'object' && (c.filter || c.config)) || typeof c === 'string')) out.push({ rule: fr.key, why: 'a choice of a kind the builder does not read', detail: JSON.stringify(c).slice(0, 120) });
    } else if (fr.key === 'GrantItem') {
      const u = String(fr.uuid || '');
      if (REF.test(u)) out.push({ rule: fr.key, why: 'a grant worked out from something other than a choice or a flag', detail: u });
      else if (/^Compendium\./.test(u) && !u.includes('{') && !resolve(u)) out.push({ rule: fr.key, why: 'a grant of something not in the open content', detail: u });
    } else if (fr.key === 'MartialProficiency') {
      if (strings(fr.definition).some((x) => REF.test(x)) || (typeof fr.value === 'string' && rankFormula(fr.value, 20, () => 0) === null)) out.push({ rule: fr.key, why: 'a weapon proficiency the builder cannot work out', detail: JSON.stringify(fr.definition).slice(0, 120) });
    } else {
      const p = String(fr.path || '');
      if (!/\.rank$/.test(p) || !/^system\.(skills|proficiencies|saves|perception|attributes\.perception)\./.test(p)) continue;
      if (REF.test(p)) out.push({ rule: fr.key, why: 'a proficiency path worked out from something other than a choice', detail: p });
      else if (!(typeof fr.value === 'number' || /^\d+$/.test(String(fr.value))) && !/^\{item\|flags\.system\.rulesSelections\.[A-Za-z0-9_]+\}$/i.test(String(fr.value)) && rankFormula(String(fr.value).replace(/@item\.flags\.system\.rulesSelections\.[A-Za-z0-9_]+(?![.A-Za-z])/g, '1'), 20, () => 0) === null) out.push({ rule: fr.key, why: 'a proficiency rank that is a formula the builder cannot work out', detail: `${p} = ${JSON.stringify(fr.value)}` });
      else if (!['upgrade', 'override', 'add'].includes(fr.mode)) out.push({ rule: fr.key, why: `a ${fr.mode} the builder does not apply`, detail: p });
    }
  }
  return out;
}

/** The report: {classes: {slug: [{item, rule, why, detail}]}, other: {kind: [...]}, totals}. */
export function report({ get = contentGetter(), resolve, only } = {}) {
  resolve = resolve || foundryResolver(JSON.parse(fs.readFileSync(path.join(OPEN, 'import-manifest.json'), 'utf8')));
  const classes = {}, other = {};
  const knows = knower(get);
  let className;
  const walk = (key, d, list, seen, classFeature) => {
    if (!d || seen.has(key)) return;
    seen.add(key);
    for (const u of unrunnable(d, { resolve, knows, classFeature, className })) list.push({ item: d.name, ...u });
    for (const r of d.rules || []) {
      const fr = r.key === 'unsupported' ? r.foundry : null;
      if (!fr || fr.key !== 'GrantItem' || String(fr.uuid || '').includes('{')) continue;
      const gk = resolve(fr.uuid);
      const g = gk && get(gk);
      if (g) walk(gk, g, list, seen, g.category === 'classfeature');
    }
  };
  for (const k of keysIn('classes', 'class')) {
    const c = get(k);
    if (only && c.slug !== only) continue;
    const list = [], seen = new Set();
    className = c.name;
    walk(k, c, list, seen, false);
    for (const f of c.features || []) if (f.ref) walk(f.ref, get(f.ref), list, seen, true);
    // a choice of subclass (research field, instinct, muse) offers class features found by tag: walk those too
    for (const f of c.features || []) {
      const d = f.ref && get(f.ref);
      for (const r of (d && d.rules) || []) {
        const fr = r.key === 'unsupported' ? r.foundry : null;
        const tag = fr && fr.key === 'ChoiceSet' && fr.choices && Array.isArray(fr.choices.filter) && fr.choices.filter.find((t) => typeof t === 'string' && t.startsWith('item:tag:'));
        if (!tag) continue;
        for (const ck of keysIn('class-features', 'feat')) { const cd = get(ck); if ((cd.tags || []).includes(tag.slice(9))) walk(ck, cd, list, seen, true); }
      }
    }
    classes[c.slug] = list;
  }
  className = undefined;
  if (!only) {
    for (const [kind, source, folder] of [['ancestry', 'ancestries', 'ancestry'], ['heritage', 'heritages', 'heritage'], ['background', 'backgrounds', 'background']]) {
      other[kind] = [];
      for (const k of keysIn(source, folder)) walk(k, get(k), other[kind], new Set(), false);
    }
    other.feat = [];
    for (const k of keysIn('feats', 'feat')) { const d = get(k); if (['ancestry', 'class', 'general', 'skill'].includes(d.category)) walk(k, d, other.feat, new Set(), false); }
  }
  const all = [...Object.values(classes).flat(), ...Object.values(other).flat()];
  const byWhy = {};
  for (const u of all) byWhy[u.why] = (byWhy[u.why] || 0) + 1;
  return { classes, other, totals: { rules: all.length, byWhy } };
}

export function markdown(r) {
  const lines = ['# What the character builder cannot run yet', '', `${r.totals.rules} building rules in all.`, '', '| Why | Rules |', '|---|---:|'];
  for (const [w, n] of Object.entries(r.totals.byWhy).sort((a, b) => b[1] - a[1])) lines.push(`| ${w} | ${n} |`);
  lines.push('', '## By class', '', '| Class | Rules | Items |', '|---|---:|---|');
  for (const [c, list] of Object.entries(r.classes)) lines.push(`| ${c} | ${list.length} | ${[...new Set(list.map((u) => u.item))].join(', ') || 'none'} |`);
  for (const [k, list] of Object.entries(r.other)) lines.push('', `## ${k[0].toUpperCase() + k.slice(1).replace(/y$/, "ie")}s: ${list.length}`, '', ...[...new Set(list.map((u) => u.item))].slice(0, 40).map((x) => `- ${x}`), ...(new Set(list.map((u) => u.item)).size > 40 ? ['- ...'] : []));
  return lines.join('\n') + '\n';
}
