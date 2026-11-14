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

// ---- step 3: the step-by-step builder (docs/design/game-data.md 9.8) ----

import { deriveCharacter, boostSlots, ATTRIBUTES, SKILLS, maxSkillRank, itemMatches, configList, predicateHolds as holds, backgroundLore } from './build.js';
import { LANGUAGES, languageRarity } from './languages.js';
import { CHARACTER_WEALTH, priceCp, cpLabel, GEAR_KINDS, isConsumable } from './startgear.js';
import { prereqFacts, prereqCheck } from './prereqs.js';

const ALIGNED = /\b(lawful|chaotic|good|evil|neutral) alignment\b|\balignment\b/i;
const ALIGN_TRAITS = ['good', 'evil', 'lawful', 'chaotic'];

/** Every document in a content folder, with its key, read once. */
function folderDocs(source, folder, cache) {
  const k = `${source}/${folder}`;
  if (!cache.has(k)) cache.set(k, keysIn(source, folder).map((key) => ({ key, doc: JSON.parse(fs.readFileSync(path.join(OPEN, source, folder, key.split('/').pop() + '.json'), 'utf8')) })));
  return cache.get(k);
}

/** A line about a document for a list: its first sentence, short. */
function summary(doc) {
  let t = String((doc && doc.text) || '').replace(/\s+/g, ' ').trim();
  // the stat lines a feat opens with (Access, Frequency, Trigger, Requirements) are not what it does
  for (let i = 0; i < 4; i++) t = t.replace(/^-+\s*/, '').replace(/^(Access|Frequency|Trigger|Requirements?|Prerequisites?|Cost|Cast|Duration|Range|Targets?) [^.]*\.\s*/, '');
  const first = (/^(.{20,200}?[.!?])(\s|$)/.exec(t) || [null, t.slice(0, 160)])[1];
  return first.length > 200 ? `${first.slice(0, 197)}...` : first;
}

/**
 * The builder for one campaign: settings {sources: [book titles] | null (all)}. Returns
 * {derive(build), steps(build), options(build, stepId, {all, search}), apply(build, stepId, values), clear(build, stepId)}.
 * A step id is "<level>:<step>" ("1:feat.class", "1:boosts.free", "5:choice.fighter-weapon-mastery.fighterWeaponMastery").
 */
export function builder({ get = contentGetter(), resolve, settings = {} } = {}) {
  resolve = resolve || foundryResolver(JSON.parse(fs.readFileSync(path.join(OPEN, 'import-manifest.json'), 'utf8')));
  let knownNames = null;
  const known = () => (knownNames = knownNames || knownFeatNames());
  const cache = new Map();
  const derive = (b) => deriveCharacter(b, get, { resolve, knownNames: known() });
  let groups = null;
  const weaponGroups = () => (groups = groups || [...new Set(folderDocs('equipment', 'item', cache).filter((x) => x.doc.kind === 'weapon' && x.doc.group).map((x) => x.doc.group))].sort());

  // the gates every option passes: the campaign's books, the remaster (no alignment), rarity (the GM's leave)
  const gate = (key, doc, b) => {
    const book = (doc.source || {}).title;
    if (settings.sources && settings.sources.length && book && !settings.sources.includes(book)) return { out: `not in the campaign's books (${book})` };
    if ((doc.traits || []).some((t) => ALIGN_TRAITS.includes(t)) || (doc.prerequisites || []).some((p) => ALIGNED.test(p))) return { out: 'relies on alignment, which the remaster removed' };
    const rarity = doc.rarity || 'common';
    if (rarity !== 'common' && !(b.approvals || []).some((a) => a.what === key)) return { needs: `the GM's leave (${rarity})` };
    return {};
  };
  const entry = (key, doc, extra = {}) => ({ value: key, name: doc.name, ...(doc.level !== undefined ? { level: doc.level } : {}), ...(doc.rarity ? { rarity: doc.rarity } : {}),
    book: (doc.source || {}).title, ...((doc.source || {}).remaster ? {} : { legacy: true }), summary: summary(doc), ...extra });

  /** The steps still to take, grouped: [{id, level, step, count, text, choice?}] in order. */
  const steps = (b) => {
    const r = derive(b);
    const out = [];
    for (const p of r.pending) {
      const id = `${p.level}:${p.step}`;
      const have = out.find((x) => x.id === id);
      if (have) { have.count += 1; continue; }
      out.push({ id, level: p.level, step: p.step, count: 1, text: p.text, ...(p.choice ? { choice: p.choice } : {}) });
    }
    return { steps: out, result: r };
  };

  const featOptions = (b, r, kind, level, all) => {
    const A = r.actor, cls = get(b.class), anc = get(b.ancestry), her = b.heritage ? get(b.heritage) : null;
    const ancTraits = new Set([...(anc ? [anc.slug, ...(anc.traits || [])] : []), ...(her && (her.versatile || !her.ancestry) ? [her.slug, ...(her.traits || [])] : []), ...(r.rollOptions || []).filter((o) => o.startsWith('self:trait:')).map((o) => o.slice(11))]);
    const taken = new Map();
    for (const f of A.feats || []) taken.set(f.ref, (taken.get(f.ref) || 0) + 1);
    const facts = { ...prereqFacts(A, b), knownNames: known() };
    // a dedication waits until two more feats of the last archetype are taken
    const dedications = (A.feats || []).filter((f) => /-dedication$/.test(f.slug));
    const lastDed = dedications[dedications.length - 1];
    const lockedDed = lastDed && (A.feats || []).filter((f) => f !== lastDed && (get(f.ref) || {}).prerequisites && get(f.ref).prerequisites.some((p) => p.toLowerCase().includes(lastDed.name.toLowerCase()))).length < 2;
    const out = [];
    for (const { key, doc } of folderDocs('feats', 'feat', cache)) {
      const tr = doc.traits || [];
      const fits = kind === 'ancestry' ? doc.category === 'ancestry' && tr.some((t) => ancTraits.has(t))
        : kind === 'class' ? doc.category === 'class' && (tr.includes(cls && cls.slug) || tr.includes('archetype'))
        : kind === 'general' ? tr.includes('general')
        : kind === 'skill' ? tr.includes('skill') : false;
      if (!fits || (doc.level || 0) > level) continue;
      const why = [];
      const g = gate(key, doc, b);
      if (g.out) why.push(g.out);
      const max = doc.maxTakable === 'unlimited' ? Infinity : doc.maxTakable || 1;
      if ((taken.get(key) || 0) >= max) why.push('taken already');
      if (lockedDed && tr.includes('dedication')) why.push(`two more ${lastDed.name.replace(/ Dedication$/, '')} feats come before another dedication`);
      const pc = prereqCheck(doc, { ...facts, names: facts.names });
      if (pc.met === false) why.push(`prerequisite not met: ${pc.unmet.join('; ')}`);
      if (why.length && !all) continue;
      out.push(entry(key, doc, { ...(g.needs ? { needs: g.needs } : {}), ...(pc.unread.length ? { gmChecks: pc.unread } : {}), ...(why.length ? { blocked: why } : {}), ...(doc.prerequisites && doc.prerequisites.length ? { prerequisites: doc.prerequisites } : {}) }));
    }
    return out.sort((x, y) => (y.level || 0) - (x.level || 0) || x.name.localeCompare(y.name));
  };

  const docOptions = (b, list, all) => list.map(({ key, doc }) => {
    const g = gate(key, doc, b);
    if (g.out && !all) return null;
    return entry(key, doc, { ...(g.needs ? { needs: g.needs } : {}), ...(g.out ? { blocked: [g.out] } : {}) });
  }).filter(Boolean).sort((x, y) => x.name.localeCompare(y.name));

  // the spells a step can take: of the character's tradition, not focus spells, of the rank the step asks
  const spellOptions = (b, r, s, all) => {
    const sc = r.actor.spellcasting || {};
    const sp = b.spells || {};
    const step = s.step;
    const isCantrip = (d) => (d.traits || []).includes('cantrip');
    const isFocus = (d) => (d.traits || []).includes('focus') || !(d.traditions || []).length;
    const top = Math.max(0, ...Object.keys(sc.slots || {}).map(Number).filter((n) => n < 10));
    const chosen = new Set([...(sp.cantrips || []), ...Object.values(sp.repertoire || {}).flat(), ...(sp.book || [])]);
    if (/^spells\.signature/.test(step)) {
      const rank = Number(step.slice(16));
      return (sc.spells || []).filter((x) => x.rank === rank).map((x) => ({ value: x.ref, name: x.name }));
    }
    let want;
    if (step === 'spells.cantrips' || step === 'spells.bookCantrips') want = (d) => isCantrip(d);
    else if (/^spells\.rank\d+$/.test(step)) { const n = Number(step.slice(11)); want = (d) => !isCantrip(d) && (d.rank || 1) <= n; }
    else if (step === 'spells.book1') want = (d) => !isCantrip(d) && (d.rank || 1) === 1;
    else if (step === 'spells.book') want = (d) => !isCantrip(d) && (d.rank || 1) <= top;
    else return [];
    if (!sc.tradition) return [{ value: '-', name: 'the tradition is not known yet: choose the subclass first' }];
    const out = [];
    for (const { key, doc } of folderDocs('spells', 'spell', cache)) {
      if (doc.kind !== 'spell' || isFocus(doc) || !(doc.traditions || []).includes(sc.tradition) || !want(doc)) continue;
      const g = gate(key, doc, b);
      const why = [...(g.out ? [g.out] : []), ...(chosen.has(key) ? ['chosen already'] : [])];
      if (why.length && !all) continue;
      out.push(entry(key, doc, { rank: isCantrip(doc) ? 0 : doc.rank, ...(g.needs ? { needs: g.needs } : {}), ...(why.length ? { blocked: why } : {}) }));
    }
    return out.sort((x, y) => (y.rank || 0) - (x.rank || 0) || x.name.localeCompare(y.name));
  };

  // the items a gear step can take: a permanent item of the slot's level or lower, or anything the purse affords
  // (consumables up to the character's level, permanent items one level lower)
  const gearOptions = (b, r, s, all) => {
    const L = r.actor.level;
    const wealth = CHARACTER_WEALTH[L] || CHARACTER_WEALTH[20];
    const perm = /^gear\.permanent(\d+)$/.exec(s.step);
    const left = (r.coins ? r.coins.gp * 100 + r.coins.sp * 10 + r.coins.cp : wealth.gp * 100);
    const out = [];
    for (const { key, doc } of folderDocs('equipment', 'item', cache)) {
      if (!GEAR_KINDS.includes(doc.kind) || doc.kind === 'treasure') continue;
      const cons = isConsumable(doc);
      const cost = priceCp(doc, 1);
      if (cost === null) continue;
      const why = [];
      if (perm) { if (cons || (doc.level || 0) > Number(perm[1])) continue; }
      else {
        if ((doc.level || 0) > (cons ? L : Math.max(0, L - 1))) continue;
        if (cost > left) why.push(`costs ${cpLabel(cost)}, ${cpLabel(left)} left`);
      }
      const g = gate(key, doc, b);
      if (g.out) why.push(g.out);
      if (why.length && !all) continue;
      out.push(entry(key, doc, { kind: doc.kind, price: cpLabel(cost) + (doc.price && doc.price.per > 1 ? ` for ${doc.price.per}` : ''), ...(doc.bulk !== undefined ? { bulk: doc.bulk } : {}), ...(g.needs ? { needs: g.needs } : {}), ...(why.length ? { blocked: why } : {}) }));
    }
    return out.sort((x, y) => (perm ? (y.level || 0) - (x.level || 0) : 0) || x.kind.localeCompare(y.kind) || x.name.localeCompare(y.name));
  };

  /** The options for a step: [{value, name, level?, rarity?, book?, legacy?, needs?, gmChecks?, blocked?, summary?}]. */
  const options = (b, id, { all = false, search } = {}) => {
    const { steps: st, result: r } = steps(b);
    const s = st.find((x) => x.id === id) || { id, level: Number(id.split(':')[0]) || 1, step: id.split(':').slice(1).join(':') };
    const P = r.actor.proficiencies;
    let out;
    const step = s.step;
    if (step === 'ancestry') out = docOptions(b, folderDocs('ancestries', 'ancestry', cache), all);
    else if (step === 'heritage') out = docOptions(b, folderDocs('heritages', 'heritage', cache).filter(({ doc }) => !doc.ancestry || doc.ancestry.ref === b.ancestry), all);
    else if (step === 'background') out = docOptions(b, folderDocs('backgrounds', 'background', cache), all);
    else if (step === 'class') out = docOptions(b, folderDocs('classes', 'class', cache), all);
    else if (step === 'deity') out = docOptions(b, folderDocs('deities', 'deity', cache).filter(({ doc }) => !s.choice || !s.choice.filter || itemMatches(s.choice.filter, doc) !== false), all);
    else if (step === 'keyAttribute') { const k = (get(b.class) || {}).keyAttribute || []; out = (k.length ? k : ATTRIBUTES).map((a) => ({ value: a, name: a })); }
    else if (step.startsWith('boosts.')) {
      const which = step.slice(7);
      const src = which === 'ancestry' ? get(b.ancestry) : which === 'background' ? get(b.background) : null;
      const chosen = which.startsWith('level') ? ((b.levels || {})[s.level] || {}).boosts || [] : (b.boosts || {})[which] || [];
      const slots = src ? boostSlots(src) : Array.from({ length: 4 }, () => ({ options: [...ATTRIBUTES], free: true }));
      const i = slots.findIndex((sl, n) => !sl.fixed && !chosen[n]);
      const sl = slots[i] || { options: [...ATTRIBUTES] };
      out = sl.options.filter((a) => !chosen.includes(a) && !slots.some((x) => x.fixed === a)).map((a) => ({ value: a, name: a, ...(sl.free ? { free: true } : {}) }));
    } else if (['skills', 'trained', 'deitySkill'].includes(step)) out = SKILLS.filter((k) => !P.skills[k]).map((k) => ({ value: k, name: k }));
    else if (step === 'skillIncrease') {
      const cap = maxSkillRank(s.level);
      out = [...SKILLS.filter((k) => (P.skills[k] || 0) >= 1 && (P.skills[k] || 0) < cap).map((k) => ({ value: k, name: k, rank: P.skills[k] })),
        ...Object.entries(P.lore || {}).filter(([, v]) => v < cap).map(([k, v]) => ({ value: `lore:${k}`, name: `${k} Lore`, rank: v }))];
    } else if (step === 'languages') {
      const anc = get(b.ancestry);
      const list = new Set(((anc && anc.additionalLanguages) || {}).choices || []);
      const knownL = new Set(r.actor.languages || []);
      out = [...LANGUAGES.common, ...LANGUAGES.uncommon, ...LANGUAGES.rare].filter((l) => !knownL.has(l)).map((l) => {
        const free = LANGUAGES.common.includes(l) || list.has(l);
        const ok = free || (b.approvals || []).some((a) => a.what === `language:${l}`);
        return { value: l, name: l, rarity: languageRarity(l), ...(ok ? {} : { needs: `the GM's leave (${languageRarity(l)})` }), ...(list.has(l) ? { ancestry: true } : {}) };
      }).filter((o) => all || !o.needs || o.ancestry);
    } else if (step === 'lore') { const named = ((s.choice || {}).options || []).map((o) => ({ value: o.value, name: o.label })); out = named.length ? named : [{ value: '<subject>', name: 'the subject the background describes (the player names it)' }]; }
    else if (step.startsWith('feat.')) out = featOptions(b, r, step.slice(5), s.level, all);
    else if (step.startsWith('spells.')) out = spellOptions(b, r, s, all);
    else if (step === 'gear' || step.startsWith('gear.permanent')) out = gearOptions(b, r, s, all);
    else if (step === 'tradition') out = [{ value: '-', name: 'chosen with the subclass: make that choice first' }];
    else if (step.startsWith('choice.') && s.choice) {
      const c = s.choice, rolls = new Set(r.rollOptions || []);
      if (c.options) out = c.options.map((o) => ({ value: o.value, name: o.label, ...(o.predicate && holds(o.predicate, { level: r.actor.level, tags: rolls }) === false ? { blocked: ['not open to this character'] } : {}) })).filter((o) => all || !o.blocked);
      else if (c.config) {
        const list = configList(c.config, { weaponGroups: weaponGroups(), deity: b.deity ? get(b.deity) : null });
        out = list ? list.filter((o) => c.config !== 'skills' || all || !P.skills[o.value]).map((o) => ({ value: o.value, name: o.label })) : [{ value: '<value>', name: `a ${c.config} (the builder has no list: the GM names it)` }];
      } else if (c.filter) {
        const pools = c.itemType === 'deity' ? [['deities', 'deity']] : [['feats', 'feat'], ['class-features', 'feat'], ['ancestry-features', 'feat']];
        const ctx = { classSlug: (get(b.class) || {}).slug, ancestrySlug: (get(b.ancestry) || {}).slug, tags: rolls };
        const facts = { ...prereqFacts(r.actor, b), knownNames: known() };
        out = [];
        for (const [src, fol] of pools) for (const { key, doc } of folderDocs(src, fol, cache)) {
          if (itemMatches(c.filter, doc, ctx) !== true) continue;
          const g = gate(key, doc, b);
          const pc = prereqCheck(doc, facts);
          const why = [...(g.out ? [g.out] : []), ...(pc.met === false ? [`prerequisite not met: ${pc.unmet.join('; ')}`] : [])];
          if (why.length && !all) continue;
          out.push(entry(key, doc, { ...(g.needs ? { needs: g.needs } : {}), ...(pc.unread.length ? { gmChecks: pc.unread } : {}), ...(why.length ? { blocked: why } : {}) }));
        }
        out.sort((x, y) => x.name.localeCompare(y.name));
      } else if (c.owned) out = [{ value: '<item>', name: 'one of the character\'s own items: chosen once the gear is bought (step 5)' }];
    }
    out = out || [];
    if (search) { const w = search.toLowerCase(); out = out.filter((o) => `${o.name} ${o.summary || ''}`.toLowerCase().includes(w)); }
    return { step: s, options: out };
  };

  /** The build with a choice made: values for the step (several for a step taken several times). */
  const apply = (b0, id, values) => {
    const b = JSON.parse(JSON.stringify(b0 || { v: 1, level: 1 }));
    const [lvS, ...rest] = id.split(':');
    const level = Number(lvS) || 1, step = rest.join(':');
    const vals = [].concat(values).filter((v) => v !== undefined && v !== null && v !== '');
    const lv = () => { b.levels = b.levels || {}; return (b.levels[level] = b.levels[level] || {}); };
    const one = () => { if (vals.length !== 1) throw new Error(`${id}: one value, not ${vals.length}`); return vals[0]; };
    if (['ancestry', 'heritage', 'background', 'class', 'deity', 'keyAttribute', 'deitySkill'].includes(step)) {
      b[step] = one();
      if (step === 'ancestry') { delete b.heritage; if (b.boosts) delete b.boosts.ancestry; }
      if (step === 'background' && b.boosts) delete b.boosts.background;
    } else if (step.startsWith('boosts.')) {
      const which = step.slice(7);
      const src = which === 'ancestry' ? get(b.ancestry) : which === 'background' ? get(b.background) : null;
      const slots = src ? boostSlots(src) : Array.from({ length: 4 }, () => ({}));
      const arr = which.startsWith('level') ? (lv().boosts = lv().boosts || []) : ((b.boosts = b.boosts || {})[which] = (b.boosts[which] || []));
      const queue = [...vals];
      slots.forEach((sl, n) => { if (!sl.fixed && !arr[n] && queue.length) arr[n] = queue.shift(); else if (sl.fixed && arr[n] === undefined) arr[n] = null; });
      if (queue.length) throw new Error(`${id}: ${queue.length} more boost${queue.length > 1 ? 's' : ''} than open slots`);
    } else if (step === 'skills') { b.skills = b.skills || {}; b.skills.trained = [...(b.skills.trained || []), ...vals]; }
    else if (step === 'lore') { b.skills = b.skills || {}; b.skills.lore = [...(b.skills.lore || []), ...vals]; }
    else if (step === 'trained') lv().trained = [...(lv().trained || []), ...vals];
    else if (step === 'languages') { if (level === 1) b.languages = [...(b.languages || []), ...vals]; else lv().languages = [...(lv().languages || []), ...vals]; }
    else if (step === 'skillIncrease') lv().skillIncrease = one();
    else if (step.startsWith('feat.')) { lv().feats = lv().feats || {}; lv().feats[step.slice(5)] = one(); }
    else if (step.startsWith('choice.')) { b.selections = b.selections || {}; b.selections[step.slice(7)] = one(); }
    else if (step === 'gear') {
      // "<key>" or "<key> x3" to buy, "-<key>" to put back, "done" when the shopping is over
      const g = (b.gear = b.gear || {});
      g.items = g.items || [];
      for (const v of vals) {
        if (v === 'done') { g.done = true; continue; }
        if (v === 'undone') { delete g.done; continue; }
        const m = /^(-)?(\S+?)(?:\s*[x*](\d+))?$/.exec(String(v).trim());
        if (!m) throw new Error(`${id}: "${v}" is "<key>", "<key> x3", "-<key>" or "done"`);
        const qty = Number(m[3] || 1);
        const have = g.items.find((x) => x.ref === m[2]);
        if (m[1]) { if (!have) throw new Error(`${id}: ${m[2]} is not in the gear`); have.qty = (have.qty || 1) - qty; if (have.qty <= 0) g.items = g.items.filter((x) => x !== have); }
        else if (have) have.qty = (have.qty || 1) + qty;
        else g.items.push({ ref: m[2], ...(qty > 1 ? { qty } : {}) });
      }
    }
    else if (step.startsWith('gear.permanent')) { const lvl = step.slice(14); const g = (b.gear = b.gear || {}); g.permanent = g.permanent || {}; g.permanent[lvl] = [...(g.permanent[lvl] || []), ...vals]; }
    else if (step.startsWith('spells.')) {
      const sp = (b.spells = b.spells || {});
      if (step === 'spells.cantrips') sp.cantrips = [...(sp.cantrips || []), ...vals];
      else if (/^spells\.rank\d+$/.test(step)) { const n = step.slice(11); sp.repertoire = sp.repertoire || {}; sp.repertoire[n] = [...(sp.repertoire[n] || []), ...vals]; }
      else if (/^spells\.signature\d+$/.test(step)) { sp.signature = sp.signature || {}; sp.signature[step.slice(16)] = one(); }
      else if (['spells.bookCantrips', 'spells.book1', 'spells.book'].includes(step)) sp.book = [...(sp.book || []), ...vals];
      else throw new Error(`${id}: not a spell step`);
    }
    else throw new Error(`${id}: not a step the builder knows`);
    return b;
  };

  /** The build with a step's choice taken back (and what depended on it is asked again). */
  const clear = (b0, id) => {
    const b = JSON.parse(JSON.stringify(b0));
    const [lvS, ...rest] = id.split(':');
    const level = Number(lvS) || 1, step = rest.join(':');
    const L = (b.levels || {})[level] || {};
    if (['ancestry', 'heritage', 'background', 'class', 'deity', 'keyAttribute', 'deitySkill'].includes(step)) delete b[step];
    else if (step.startsWith('boosts.')) { const w = step.slice(7); if (w.startsWith('level')) delete L.boosts; else if (b.boosts) delete b.boosts[w]; }
    else if (step === 'skills' && b.skills) delete b.skills.trained;
    else if (step === 'lore' && b.skills) delete b.skills.lore;
    else if (step === 'languages') { if (level === 1) delete b.languages; else delete L.languages; }
    else if (['trained', 'skillIncrease'].includes(step)) delete L[step];
    else if (step.startsWith('feat.') && L.feats) delete L.feats[step.slice(5)];
    else if (step.startsWith('choice.') && b.selections) delete b.selections[step.slice(7)];
    else if (step === 'gear' && b.gear) { delete b.gear.items; delete b.gear.done; }
    else if (step.startsWith('gear.permanent') && b.gear && b.gear.permanent) delete b.gear.permanent[step.slice(14)];
    else if (step.startsWith('spells.') && b.spells) {
      if (step === 'spells.cantrips') delete b.spells.cantrips;
      else if (/^spells\.rank\d+$/.test(step) && b.spells.repertoire) delete b.spells.repertoire[step.slice(11)];
      else if (/^spells\.signature\d+$/.test(step) && b.spells.signature) delete b.spells.signature[step.slice(16)];
      else if (/^spells\.book/.test(step)) delete b.spells.book;
    }
    return b;
  };

  return { derive, steps, options, apply, clear, get };
}

import { prepareActor } from '../../engine/rules/rules.js';
import { systemConfig } from '../systems.js';

/** The books in the open content a character's options come from (for a campaign's list). */
export function books() {
  const out = new Map();
  for (const [source, folder] of [['ancestries', 'ancestry'], ['heritages', 'heritage'], ['backgrounds', 'background'], ['classes', 'class'], ['feats', 'feat'], ['deities', 'deity']]) {
    const d = path.join(OPEN, source, folder);
    for (const f of fs.readdirSync(d)) { const t = (JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')).source || {}).title; if (t) out.set(t, (out.get(t) || 0) + 1); }
  }
  return [...out].sort((a, b) => b[1] - a[1]).map(([title, n]) => ({ title, options: n }));
}

/** A character's sheet in short, from the engine: what Claude shows the player as the build goes. */
export function preview(result, get = contentGetter()) {
  const A = result.actor;
  const content = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? get(k) : undefined) });
  const p = prepareActor({ actor: A, state: {}, effects: [], content, ruleset: systemConfig('pf2e').actors });
  const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);
  const R = ['U', 'T', 'E', 'M', 'L'];
  const P = A.proficiencies;
  const lines = [
    `${A.name}, level ${A.level} ${A.ancestry.name}${A.heritage ? ` (${A.heritage})` : ''} ${A.class.name}${A.background ? `, ${A.background}` : ''}`,
    `Attributes: ${Object.entries(A.attributes).map(([k, v]) => `${k.toUpperCase()} ${sign(v)}`).join(', ')}`,
    `HP ${p.hp.max.value}, AC ${p.ac.value}${(A.items || []).some((i) => i.carry === 'worn' && (get(i.ref) || {}).kind === 'armor') ? '' : ' (unarmoured)'}, Speed ${p.speeds && p.speeds.land ? p.speeds.land.value : A.ancestry.speed} ft; Perception ${sign(p.perception.value)} (${R[P.perception]})`,
    `Saves: Fortitude ${sign(p.saves.fortitude.value)} (${R[P.fortitude]}), Reflex ${sign(p.saves.reflex.value)} (${R[P.reflex]}), Will ${sign(p.saves.will.value)} (${R[P.will]}); class DC ${p.classDC.value}${p.spell ? `; spell DC ${p.spell.dc.value}, spell attack ${sign(p.spell.attack.value)} (${p.spell.tradition})` : ''}`,
    `Skills: ${Object.entries(p.skills).filter(([k]) => (P.skills || {})[k]).map(([k, v]) => `${k} ${sign(v.value)} (${R[P.skills[k]]})`).join(', ') || 'none yet'}${Object.keys(p.lore || {}).length ? `; ${Object.values(p.lore).map((v) => `${v.label} ${sign(v.value)}`).join(', ')}` : ''}`,
    `Feats: ${(A.feats || []).map((f) => `${f.name} (${f.slot}${f.slot === 'granted' && f.from ? ` by ${f.from}` : ''}, ${f.level})`).join('; ') || 'none yet'}`,
    `Features: ${(A.features || []).map((f) => (typeof f === 'string' ? f : f.name)).join(', ') || 'none'}`,
    ...(A.spellcasting && A.spellcasting.slots ? [`Spells (${A.spellcasting.tradition}, ${A.spellcasting.kind}): slots ${Object.entries(A.spellcasting.slots).map(([r, n]) => `${r}:${n}`).join(' ')}; cantrips ${(A.spellcasting.cantrips || []).map((x) => x.name).join(', ') || 'none yet'}; spells ${(A.spellcasting.spells || []).map((x) => `${x.name} (${x.rank})`).join(', ') || 'none yet'}${(A.spellcasting.signature || []).length ? `; signature ${A.spellcasting.signature.map((x) => x.name).join(', ')}` : ''}`] : []),
    ...(A.spellcasting && (A.spellcasting.focus || []).length ? [`Focus spells: ${A.spellcasting.focus.map((x) => x.name).join(', ')} (pool ${((A.resources || {}).focus || {}).max || 0})`] : []),
    ...(A.items && A.items.length ? [`Gear: ${A.items.map((i) => `${i.name}${i.qty > 1 ? ` x${i.qty}` : ''}${i.carry === 'worn' ? ' (worn)' : i.carry === 'held' ? ' (held)' : ''}`).join(', ')}; coins ${result.coins ? `${result.coins.gp} gp ${result.coins.sp} sp ${result.coins.cp} cp` : '-'}`] : []),
    `Languages: ${(A.languages || []).join(', ')}${A.build && A.build.deity ? `; deity ${(get(A.build.deity) || {}).name}` : ''}`,
  ];
  return { lines, prepared: p };
}
