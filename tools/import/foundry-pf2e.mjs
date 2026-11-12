#!/usr/bin/env node
// Import Foundry PF2E data (the Foundry VTT Pathfinder 2E system's open compendium JSON) into our content format,
// into a private pack. Creatures (NPCs), items (armour, shields, weapons, equipment, consumables), effects and
// feats are converted; their rule elements are translated where we support them and kept untouched otherwise
// (listed in the report). Conditions are skipped (the ruleset defines them); hazards and characters are not
// imported yet. Each document keeps its licence and book.
//
// Usage:
//   node tools/import/foundry-pf2e.mjs <file-or-folder> [...] --public <source> [--dry-run]
//   node tools/import/foundry-pf2e.mjs <file-or-folder> [...] --out <pack-dir> [--dry-run]
//
// --public <source>: the open content in this repository, content/pf2e/<source>/<creature|item>/<slug>.json
// (<source> names the Foundry pack, such as pathfinder-monster-core). Only documents licensed ORC or OGL are
// written; any other is skipped (NOTICE.md, content/pf2e/README.md).
// --out <pack-dir>: a private pack (packs/<id> in this repository, git-ignored, or a folder outside it), for
// anything that is not open; writes <pack-dir>/content/<creature|item>/<slug>.json.
// Both write an import report (import-report.json beside the content) and print its summary.
// Docs: docs/design/game-data.md section 5, docs/best-practices/game-data.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExpr } from '../../engine/rules/expr.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIZES = { tiny: 'tiny', sm: 'small', med: 'medium', lg: 'large', huge: 'huge', grg: 'gargantuan' };
const ITEM_TYPES = new Set(['armor', 'shield', 'weapon', 'equipment', 'consumable', 'effect', 'feat']);
/** The licences open content may carry (NOTICE.md). */
export const OPEN_LICENSES = Object.freeze(['ORC', 'OGL']);
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Foundry's text markup and HTML as plain text, with checks, damage and links in words. */
export function cleanText(html) {
  let s = String(html || '');
  s = s.replace(/@UUID\[[^\]]*?([^.\]]+)\]\{([^}]*)\}/g, '$2').replace(/@UUID\[[^\]]*?([^.\]]+)\]/g, '$1');
  s = s.replace(/@Check\[([^\]]+)\](?:\{([^}]*)\})?/g, (_, body, label) => {
    if (label) return label;
    const parts = body.split('|'), type = parts[0].replace(/^type:/, ''), dc = (parts.find((p) => p.startsWith('dc:')) || '').slice(3);
    const basic = parts.includes('basic') || parts.includes('basic:true');
    return `${dc ? `DC ${dc} ` : ''}${basic ? 'basic ' : ''}${type[0].toUpperCase()}${type.slice(1)}${/^(fortitude|reflex|will)$/.test(type) ? ' save' : ' check'}`;
  });
  s = s.replace(/@Damage\[((?:[^[\]]|\[[^\]]*\])*)\](?:\{([^}]*)\})?/g, (_, body, label) => label || body.replace(/\(([^)]+)\)/g, '$1').replace(/\[([^\]]+)\]/g, ' $1').replace(/\|.*$/, ''));
  s = s.replace(/@Template\[([^\]]+)\](?:\{([^}]*)\})?/g, (_, body, label) => { if (label) return label; const t = body.split('|'), d = (t.find((x) => x.startsWith('distance:')) || '').slice(9); return `${d ? `${d}-foot ` : ''}${t[0].replace(/^type:/, '')}`; });
  s = s.replace(/\[\[\/[a-z]+ ([^\]#]+?)(?:\s*#[^\]]*)?\]\](?:\{([^}]*)\})?/g, (_, expr, label) => label || expr.trim());
  s = s.replace(/@Localize\[[^\]]*\]/g, '').replace(/@[A-Za-z]+\[[^\]]*\](?:\{([^}]*)\})?/g, (_, label) => label || '');
  s = s.replace(/<hr\s*\/?>/gi, '\n---\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d|div)>/gi, '\n').replace(/<li>/gi, '- ').replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  return s.split('\n').map((l) => l.trim()).filter((l, i, a) => l || (i && a[i - 1])).join('\n').trim();
}

/** Foundry's value expressions in ours (@item.badge.value -> @value, @actor.level -> @level); null if not ours. */
export function convertValue(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const s = v.replace(/@item\.badge\.value/g, '@value').replace(/@actor\.level/g, '@level').replace(/@actor\.system\.details\.level\.value/g, '@level');
  try { const refs = []; (function walk(x) { if ('ref' in x) refs.push(x.ref); if ('neg' in x) walk(x.neg); if ('args' in x) x.args.forEach(walk); if ('a' in x) { walk(x.a); walk(x.b); } })(parseExpr(s)); return refs.every((r) => r === 'value' || r === 'level') ? s : null; } catch { return null; }
}

/** One Foundry rule element in our form, or kept as it was ({key: 'unsupported', foundry}) with the reason. */
export function convertRule(r) {
  const keep = (why) => ({ rule: { key: 'unsupported', foundry: r }, why });
  const when = r.predicate && r.predicate.length ? r.predicate : undefined;
  switch (r.key) {
    case 'FlatModifier': {
      const value = convertValue(r.value);
      if (value === null) return keep(`value "${r.value}" uses data we do not have`);
      const sel = [].concat(r.selector).map((x) => (x === 'attack' ? 'attack-roll' : x));
      return { rule: { key: 'modifier', selector: sel.length === 1 ? sel[0] : sel, type: r.type || 'untyped', value, ...(r.slug ? { slug: r.slug } : {}), ...(when ? { when } : {}), ...(r.damageType ? { damageType: r.damageType } : {}) } };
    }
    case 'Resistance': case 'Weakness': {
      const value = convertValue(r.value);
      if (value === null) return keep(`value "${r.value}" uses data we do not have`);
      return { rule: { key: r.key.toLowerCase(), type: [].concat(r.type)[0], value, ...(r.exceptions && r.exceptions.length ? { except: [].concat(r.exceptions).map((e) => (typeof e === 'string' ? e : e.type || e.label)).join(', ') } : {}) } };
    }
    case 'Immunity':
      return { rule: { key: 'immunity', type: [].concat(r.type)[0], ...(r.exceptions && r.exceptions.length ? { except: [].concat(r.exceptions).join(', ') } : {}) } };
    case 'BaseSpeed': {
      const value = convertValue(r.value);
      if (value === null) return keep(`value "${r.value}" uses data we do not have`);
      return { rule: { key: 'speed', type: r.selector, value } };
    }
    case 'Sense':
      return { rule: { key: 'sense', type: r.selector, ...(r.range ? { range: convertValue(r.range) ?? r.range } : {}), ...(r.acuity ? { acuity: r.acuity } : {}) } };
    case 'Note':
      return { rule: { key: 'note', selector: r.selector, text: cleanText(r.text || r.title || ''), ...(r.outcome ? { outcome: r.outcome } : {}), ...(when ? { when } : {}) } };
    default:
      return keep(`rule "${r.key}" is not supported yet`);
  }
}

function convertRules(rules, where, report) {
  const out = [];
  for (const r of rules || []) {
    const c = convertRule(r);
    out.push(c.rule);
    if (c.why) report.flagged.push({ where, what: c.why });
  }
  return out;
}

/** Where a document comes from: its book and licence (an item's under system.publication, a creature's under system.details). */
const source = (d, sys) => {
  const pub = sys.publication || (sys.details || {}).publication || {};
  return { title: pub.title || '', license: pub.license || 'OGL', ...(pub.remaster ? { remaster: true } : {}), from: 'foundry-pf2e' };
};

/** A Foundry NPC as one of our creatures. */
export function convertCreature(d, report) {
  const s = d.system || {}, at = s.attributes || {}, slug = slugify(d.name), where = `creature/${slug}`;
  const skills = {};
  for (const [k, v] of Object.entries(s.skills || {})) {
    const base = v.base ?? v.value ?? v.mod;
    skills[k] = v.special && v.special.length ? { value: base, special: v.special.map((x) => ({ value: x.base, label: x.label, when: x.predicate })) } : base;
  }
  const speeds = { land: (at.speed || {}).value ?? 25 };
  for (const o of (at.speed || {}).otherSpeeds || []) speeds[o.type] = o.value;
  const iwr = {
    immunities: (at.immunities || []).map((x) => (x.exceptions && x.exceptions.length ? { type: x.type, except: x.exceptions.join(', ') } : x.type)),
    weaknesses: (at.weaknesses || []).map((x) => ({ type: x.type, value: x.value })),
    resistances: (at.resistances || []).map((x) => ({ type: x.type, value: x.value, ...(x.exceptions && x.exceptions.length ? { except: x.exceptions.map((e) => (typeof e === 'string' ? e : e.label || e.type)).join(', ') } : {}) })),
  };
  const items = [];
  for (const it of d.items || []) {
    const is = it.system || {};
    if (it.type === 'melee') {
      items.push({
        kind: 'strike', name: it.name, attack: (is.bonus || {}).value ?? 0, traits: (is.traits || {}).value || [],
        ...(is.range && is.range.increment ? { range: is.range.increment } : {}),
        damage: Object.values(is.damageRolls || {}).map((r) => ({ dice: r.damage, type: r.damageType })),
        ...((is.attackEffects || {}).value && is.attackEffects.value.length ? { effects: is.attackEffects.value } : {}),
      });
    } else if (it.type === 'action') {
      const actions = (is.actionType || {}).value === 'action' ? (is.actions || {}).value : (is.actionType || {}).value;
      items.push({ kind: 'ability', name: it.name, actions: actions ?? null, traits: (is.traits || {}).value || [], text: cleanText((is.description || {}).value), ...(is.rules && is.rules.length ? { rules: convertRules(is.rules, `${where}: ${it.name}`, report) } : {}) });
    } else if (it.type === 'spellcastingEntry' || it.type === 'spell') {
      report.flagged.push({ where, what: `${it.type} "${it.name}" kept as text (spells come later)` });
      items.push({ kind: it.type === 'spell' ? 'spell' : 'ability', name: it.name, text: cleanText((is.description || {}).value) });
    } else if (it.type === 'lore') {
      skills[`${slugify(it.name).replace(/-lore$/, '')}-lore`] = (is.mod || {}).value ?? 0;
    }
  }
  const doc = {
    kind: 'creature', slug, system: 'pf2e', name: d.name, level: ((s.details || {}).level || {}).value ?? 0,
    size: SIZES[((s.traits || {}).size || {}).value] || 'medium', rarity: (s.traits || {}).rarity || 'common', traits: (s.traits || {}).value || [],
    source: source(d, s),
    stats: {
      ac: (at.ac || {}).value, hp: (at.hp || {}).max, perception: (s.perception || {}).mod ?? 0,
      saves: Object.fromEntries(Object.entries(s.saves || {}).map(([k, v]) => [k, v.value])),
      attributes: Object.fromEntries(Object.entries(s.abilities || {}).map(([k, v]) => [k, v.mod])),
      skills, speeds, senses: ((s.perception || {}).senses || []).map((x) => ({ type: x.type, ...(x.range ? { range: x.range } : {}), ...(x.acuity ? { acuity: x.acuity } : {}) })),
      languages: ((s.details || {}).languages || {}).value || [], iwr,
    },
    items, text: cleanText((s.details || {}).publicNotes),
  };
  if (s.rules && s.rules.length) doc.rules = convertRules(s.rules, where, report);
  return doc;
}

/** A Foundry item (armour, shield, weapon, equipment, consumable, effect, feat) as one of ours. */
export function convertItem(d, report) {
  const s = d.system || {}, slug = slugify(d.name), where = `item/${slug}`;
  const doc = { kind: d.type, slug, system: 'pf2e', name: d.name, source: source(d, s), level: (s.level || {}).value ?? 0, traits: (s.traits || {}).value || [] };
  if (d.type === 'armor') Object.assign(doc, { category: s.category, group: s.group, acBonus: s.acBonus, dexCap: s.dexCap, checkPenalty: s.checkPenalty || 0, speedPenalty: s.speedPenalty || 0, strength: s.strength ?? null });
  if (d.type === 'shield') Object.assign(doc, { acBonus: s.acBonus, hardness: s.hardness, hp: (s.hp || {}).max, brokenAt: Math.floor(((s.hp || {}).max || 0) / 2) });
  if (d.type === 'weapon') Object.assign(doc, { category: s.category, group: s.group, damage: { die: (s.damage || {}).die, type: (s.damage || {}).damageType, ...((s.damage || {}).dice > 1 ? { dice: s.damage.dice } : {}) }, range: s.range ?? null, hands: (s.usage || {}).value || null });
  if (s.bulk && s.bulk.value !== undefined) doc.bulk = s.bulk.value;
  if (s.price && s.price.value) doc.price = s.price.value;
  if (s.runes && Object.values(s.runes).some((v) => (Array.isArray(v) ? v.length : v))) doc.runes = s.runes;
  const text = cleanText((s.description || {}).value);
  if (text) doc.text = text;
  if (s.rules && s.rules.length) doc.rules = convertRules(s.rules, where, report);
  return doc;
}

/** Import documents: {docs: [{key, doc}], report}. `open`: only documents licensed ORC or OGL (the rest skipped). */
export function importDocs(list, { open = false } = {}) {
  const report = { converted: [], flagged: [], skipped: [] }, docs = [];
  for (const { file, data: d } of list) {
    if (!d || typeof d !== 'object' || !d.type) { report.skipped.push({ file, why: 'not a Foundry document' }); continue; }
    if (open && (d.type === 'npc' || ITEM_TYPES.has(d.type))) {
      const lic = source(d, d.system || {}).license, pub = (d.system || {}).publication || ((d.system || {}).details || {}).publication;
      if (!pub || !OPEN_LICENSES.includes(lic)) { report.skipped.push({ file, name: d.name, why: `licence "${pub ? lic : 'none recorded'}" is not open (ORC or OGL): import it into a private pack` }); continue; }
    }
    if (d.type === 'npc') { const c = convertCreature(d, report); docs.push({ key: `creature/${c.slug}`, doc: c }); report.converted.push({ name: d.name, as: `creature/${c.slug}`, license: c.source.license }); }
    else if (ITEM_TYPES.has(d.type)) { const c = convertItem(d, report); docs.push({ key: `item/${c.slug}`, doc: c }); report.converted.push({ name: d.name, as: `item/${c.slug}`, license: c.source.license }); }
    else if (d.type === 'condition') report.skipped.push({ file, name: d.name, why: 'conditions are defined by the ruleset (rulesets/pf2e/rules.js)' });
    else if (d.type === 'hazard') report.skipped.push({ file, name: d.name, why: 'hazards are not imported yet' });
    else if (d.type === 'character') report.skipped.push({ file, name: d.name, why: 'characters need the character-building rules (a later step); Claude builds them in our format' });
    else report.skipped.push({ file, name: d.name, why: `type "${d.type}" is not imported` });
  }
  const seen = new Map();
  for (const x of docs) { if (seen.has(x.key)) report.flagged.push({ where: x.key, what: 'two documents with the same name: the later one is kept' }); seen.set(x.key, x); }
  return { docs: [...seen.values()], report };
}

/** Files under the paths given (folders read recursively, .json only; Foundry's _folders.json skipped). */
export function readInputs(paths) {
  const out = [];
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) { for (const n of fs.readdirSync(p).sort()) if (!n.startsWith('_')) walk(path.join(p, n)); return; }
    if (p.endsWith('.json')) { try { out.push({ file: p, data: JSON.parse(fs.readFileSync(p, 'utf8')) }); } catch (e) { out.push({ file: p, data: null }); } }
  };
  for (const p of paths) walk(p);
  return out;
}

/** Is a folder a place imported content may go: outside this repository, or under its git-ignored packs/? */
export function privateTarget(dir) {
  const abs = path.resolve(dir), rel = path.relative(ROOT, abs);
  const inside = !rel.startsWith('..') && !path.isAbsolute(rel);   // '' is the repository's own root
  return !inside || rel.split(path.sep)[0] === 'packs';
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const out = opt('--out'), pub = opt('--public'), dry = flag('--dry-run');
    if ((!out && !pub) || (out && pub) || !args.length) throw new Error('give the Foundry files or folders and one of --public <source> or --out <pack-dir>');
    if (pub && !/^[a-z0-9][a-z0-9-]*$/.test(pub)) throw new Error('--public: the source\'s name, lower case with dashes (pathfinder-monster-core)');
    if (out && !privateTarget(out)) throw new Error(`"${out}" is inside the repository: open content goes in with --public, anything else into a private pack (packs/<id>) or a folder outside the repository`);
    const dest = pub ? path.join(ROOT, 'content', 'pf2e', pub) : path.join(out, 'content');
    const { docs, report } = importDocs(readInputs(args), { open: !!pub });
    if (!dry) {
      for (const { key, doc } of docs) {
        const [kind, slug] = key.split('/'), f = path.join(dest, kind, `${slug}.json`);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, JSON.stringify(doc, null, 2) + '\n');
      }
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, 'import-report.json'), JSON.stringify(report, null, 2) + '\n');
    }
    console.log(`${report.converted.length} converted, ${report.flagged.length} flagged, ${report.skipped.length} skipped${dry ? ' (dry run: nothing written)' : ` into ${dest}`}`);
    for (const f of report.flagged.slice(0, 30)) console.log(`  flagged ${f.where}: ${f.what}`);
    for (const s of report.skipped.slice(0, 10)) console.log(`  skipped ${s.name || s.file}: ${s.why}`);
    return 0;
  } catch (e) {
    console.error(`import: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
