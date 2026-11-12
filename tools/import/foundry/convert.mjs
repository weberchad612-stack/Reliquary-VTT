// Foundry PF2E documents in our content format (rulesets/pf2e/schemas/content.schema.json), one converter per kind.
// Every converter takes the Foundry document and a context: ctx.report (flagged problems, unsupported rules)
// and ctx.ref(uuid) (a Foundry link as one of our content keys, or null when it points outside what we import).
// Docs: docs/design/game-data.md sections 5 and 7.

import { parseExpr } from '../../../engine/rules/expr.js';
import { kindDir, ITEM_KINDS } from '../../../rulesets/pf2e/content.js';

export const SIZES = { tiny: 'tiny', sm: 'small', med: 'medium', lg: 'large', huge: 'huge', grg: 'gargantuan' };
/** The licences open content may carry (NOTICE.md). */
export const OPEN_LICENSES = Object.freeze(['ORC', 'OGL']);

/** Foundry document type -> our kind (null: not imported, with the reason in SKIP). */
export const KIND_OF = {
  npc: 'creature', hazard: 'hazard', vehicle: 'vehicle',
  armor: 'armor', shield: 'shield', weapon: 'weapon', equipment: 'equipment', consumable: 'consumable',
  ammo: 'ammo', treasure: 'treasure', backpack: 'backpack', kit: 'kit',
  feat: 'feat', action: 'action', effect: 'effect', condition: 'condition', spell: 'spell',
  ancestry: 'ancestry', heritage: 'heritage', background: 'background', class: 'class', deity: 'deity',
  campaignFeature: 'campaign-feature',
};
export const SKIP = {
  character: 'pregenerated characters need the character converter (the character-builder step)',
  familiar: 'familiars need the character converter (the character-builder step)',
  army: 'Kingmaker armies need the kingdom rules (not planned yet)',
  script: 'a Foundry macro: code for Foundry, not game data',
  journal: 'a Foundry journal: rules text with no open licence recorded',
  table: 'a Foundry rollable table: no open licence recorded',
};

export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** A Foundry document's type, recognising the journals and tables that carry none. */
export function foundryType(d) {
  if (!d || typeof d !== 'object') return null;
  if (Array.isArray(d.pages)) return 'journal';
  if (Array.isArray(d.results)) return 'table';
  return d.type || null;
}

/** Foundry's text markup and HTML as plain text, with checks, damage and links in words. */
export function cleanText(html) {
  let s = String(html || '');
  s = s.replace(/@UUID\[[^\]]*?([^.\]]+)\]\{([^}]*)\}/g, '$2').replace(/@UUID\[[^\]]*?([^.\]]+)\]/g, '$1');
  s = s.replace(/@Check\[([^\]]+)\](?:\{([^}]*)\})?/g, (_, body, label) => {
    if (label) return label;
    const parts = body.split('|'), type = parts[0].replace(/^type:/, ''), dc = (parts.find((p) => p.startsWith('dc:')) || '').slice(3);
    const basic = parts.includes('basic') || parts.includes('basic:true');
    return `${dc ? `DC ${dc} ` : ''}${basic ? 'basic ' : ''}${type ? type[0].toUpperCase() + type.slice(1) : ''}${/^(fortitude|reflex|will)$/.test(type) ? ' save' : ' check'}`;
  });
  s = s.replace(/@Damage\[((?:[^[\]]|\[[^\]]*\])*)\](?:\{([^}]*)\})?/g, (_, body, label) => label || body.replace(/\(([^)]+)\)/g, '$1').replace(/\[([^\]]+)\]/g, ' $1').replace(/\|.*$/, ''));
  s = s.replace(/@Template\[([^\]]+)\](?:\{([^}]*)\})?/g, (_, body, label) => { if (label) return label; const t = body.split('|'), d = (t.find((x) => x.startsWith('distance:')) || '').slice(9); return `${d ? `${d}-foot ` : ''}${t[0].replace(/^type:/, '')}`; });
  s = s.replace(/\[\[\/[a-z]+ ([^\]#]+?)(?:\s*#[^\]]*)?\]\](?:\{([^}]*)\})?/g, (_, expr, label) => label || expr.trim());
  s = s.replace(/@Localize\[[^\]]*\]/g, '').replace(/@[A-Za-z]+\[[^\]]*\](?:\{([^}]*)\})?/g, (_, label) => label || '');
  s = s.replace(/<hr\s*\/?>/gi, '\n---\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d|div|tr)>/gi, '\n').replace(/<li>/gi, '- ').replace(/<\/t[dh]>/gi, ' | ').replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&mdash;/g, '—').replace(/&ndash;/g, '–');
  return s.split('\n').map((l) => l.trim()).filter((l, i, a) => l || (i && a[i - 1])).join('\n').trim();
}

/**
 * Foundry's value expressions in ours: @item.badge.value -> @value, @actor.level -> @level, the level of what
 * grants the rule (@item.level, a spell's rank) -> @itemLevel; Foundry's ternary and comparisons are ours too.
 * Null if it uses anything else.
 */
const VALUE_REFS = new Set(['value', 'level', 'itemLevel']);
export function convertValue(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const s = v.replace(/@item\.badge\.value/g, '@value').replace(/@actor\.(system\.details\.)?level(\.value)?\b/g, '@level')
    .replace(/@(item\.(system\.)?level(\.value)?|spell\.level|spell\.rank)\b/g, '@itemLevel');
  try { const refs = []; (function walk(x) { if ('ref' in x) refs.push(x.ref); if ('neg' in x) walk(x.neg); if ('args' in x) x.args.forEach(walk); if ('a' in x) { walk(x.a); walk(x.b); } })(parseExpr(s)); return refs.every((r) => VALUE_REFS.has(r)) ? s : null; } catch { return null; }
}

/** One Foundry rule element in our form, or kept as it was ({key: 'unsupported', foundry}) with the reason. */
/** The numbers a condition may compare (rulesets/pf2e/actor.js gives them to engine/rules testPredicate). */
const FACT = /^(self:level|hp-percent|hp-remaining|self:condition:[a-z-]+)$/;
/**
 * A predicate our engine can test: option strings combined with and, or, not, and comparisons
 * ({gte: [a, b]}...) of numbers and the facts it knows (engine/rules/rules.js).
 */
export function predicateOk(p) {
  if (typeof p === 'string') return true;
  if (Array.isArray(p)) return p.every(predicateOk);
  if (p && typeof p === 'object') {
    const keys = Object.keys(p);
    if (keys.length !== 1) return false;
    const k = keys[0];
    if (k === 'and' || k === 'or') return Array.isArray(p[k]) && p[k].every(predicateOk);
    if (k === 'not') return predicateOk(p.not);
    if (['gt', 'gte', 'lt', 'lte', 'eq'].includes(k)) return Array.isArray(p[k]) && p[k].length === 2 && p[k].every((x) => typeof x === 'number' || (typeof x === 'string' && FACT.test(x)));
  }
  return false;
}

const SIZE_SLUGS = { tiny: 'tiny', sm: 'small', med: 'medium', lg: 'large', huge: 'huge', grg: 'gargantuan', small: 'small', medium: 'medium', large: 'large', gargantuan: 'gargantuan' };
const plain = (s) => typeof s === 'string' && s && !s.includes('{') && !s.includes('@');
/** A Foundry link to a condition as our condition id ("Compendium.pf2e.conditionitems.Item.Off-Guard" -> off-guard). */
function conditionOf(uuid, ctx) {
  const key = ctx && ctx.ref ? ctx.ref(uuid) : null;
  if (key && /^conditions:condition\//.test(key)) return key.split('/').pop().replace(/^persistent-damage$/, 'persistent');
  const m = /conditionitems\.Item\.([A-Za-z -]+)$/.exec(String(uuid || ''));
  return m ? slugify(m[1]) : null;
}

export function convertRule(r, ctx = null) {
  const keep = (why) => ({ rule: { key: 'unsupported', foundry: r }, why, unsupported: (r && r.key) || '(no key)' });
  if (!r || typeof r !== 'object') return keep('not a rule element');
  const when = r.predicate && r.predicate.length ? r.predicate : undefined;
  if (when && !predicateOk(when)) return keep('its condition compares numbers our engine does not know yet');
  switch (r.key) {
    case 'FlatModifier': {
      const value = convertValue(r.value);
      if (value === null) return keep(`value "${r.value}" uses data we do not have`);
      if (r.selector === undefined) return keep('no selector');
      const sel = [].concat(r.selector).map((x) => (x === 'attack' ? 'attack-roll' : x));
      return { rule: { key: 'modifier', selector: sel.length === 1 ? sel[0] : sel, type: r.type || 'untyped', value, ...(r.slug ? { slug: r.slug } : {}), ...(when ? { when } : {}), ...(r.damageType ? { damageType: r.damageType } : {}) } };
    }
    case 'Resistance': case 'Weakness': {
      const value = convertValue(r.value);
      if (value === null) return keep(`value "${r.value}" uses data we do not have`);
      return { rule: { key: r.key.toLowerCase(), type: [].concat(r.type)[0], value, ...(r.exceptions && r.exceptions.length ? { except: [].concat(r.exceptions).map((e) => (typeof e === 'string' ? e : e.type || e.label)).join(', ') } : {}), ...(when ? { when } : {}) } };
    }
    case 'Immunity':
      return { rule: { key: 'immunity', type: [].concat(r.type)[0], ...(r.exceptions && r.exceptions.length ? { except: [].concat(r.exceptions).map((e) => (typeof e === 'string' ? e : e.type || e.label)).join(', ') } : {}), ...(when ? { when } : {}) } };
    case 'BaseSpeed': {
      const value = convertValue(r.value);
      if (value === null) return keep(`value "${r.value}" uses data we do not have`);
      return { rule: { key: 'speed', type: r.selector, value, ...(when ? { when } : {}) } };
    }
    case 'Sense': {
      const range = r.range === undefined || r.range === null || r.range === '' ? undefined : convertValue(r.range);
      if (range === null) return keep(`range "${r.range}" uses data we do not have`);
      return { rule: { key: 'sense', type: r.selector, ...(range !== undefined ? { range } : {}), ...(r.acuity ? { acuity: r.acuity } : {}), ...(when ? { when } : {}) } };
    }
    case 'Note':
      return { rule: { key: 'note', selector: r.selector, text: cleanText(r.text || r.title || ''), ...(r.outcome ? { outcome: r.outcome } : {}), ...(when ? { when } : {}) } };
    // ---- PF2E's own keys (rulesets/pf2e/rule-keys.js) ----
    case 'RollOption': {
      if (!plain(r.option)) return keep('its option is built from data we do not have');
      if (r.suboptions && (Array.isArray(r.suboptions) ? r.suboptions.length : true)) return keep('a switch with choices (comes with sheets)');
      // an option for one kind of roll ("damage") holds for the creature: the rules it switches name their rolls
      return { rule: { key: 'roll-option', option: r.option, ...(r.domain && r.domain !== 'all' ? { domain: r.domain } : {}), ...(r.toggleable ? { toggleable: true } : {}), ...(r.label ? { label: cleanText(r.label) } : {}), ...(r.toggleable && r.value === true ? { default: true } : {}), ...(when ? { when } : {}) } };
    }
    case 'ActorTraits': {
      const add = [].concat(r.add || []), remove = [].concat(r.remove || []);
      if (![...add, ...remove].every(plain)) return keep('traits built from data we do not have');
      return { rule: { key: 'trait', ...(add.length ? { add } : {}), ...(remove.length ? { remove } : {}), ...(when ? { when } : {}) } };
    }
    case 'CreatureSize': {
      const size = SIZE_SLUGS[r.value];
      if (!size) return keep(`size "${r.value}" (a change by steps comes later)`);
      return { rule: { key: 'size', size, ...(when ? { when } : {}) } };
    }
    case 'DamageDice': {
      if (r.override || r.brackets) return keep('changes the dice or depends on level brackets');
      const dice = convertValue(r.diceNumber ?? 1);
      if (dice === null || !/^d(4|6|8|10|12|20)$/.test(String(r.dieSize || ''))) return keep('dice built from data we do not have');
      if (r.damageType !== undefined && !plain(r.damageType)) return keep('a damage type chosen on the sheet');
      return { rule: { key: 'damage-dice', selector: r.selector, dice, die: r.dieSize, ...(r.damageType ? { type: r.damageType } : {}), ...(r.category ? { category: r.category } : {}), ...(r.critical ? { critical: true } : {}), ...(r.label ? { label: cleanText(r.label) } : {}), ...(when ? { when } : {}) } };
    }
    case 'AdjustStrike': {
      if (!['traits', 'weapon-traits'].includes(r.property) || !['add', 'remove'].includes(r.mode) || !plain(r.value)) return keep(`changes a Strike's ${r.property || 'data'} (comes with attacks)`);
      if (r.definition && !predicateOk(r.definition)) return keep('picks Strikes by numbers our engine does not know yet');
      const pick = [...(r.definition || []), ...(when || [])];
      return { rule: { key: 'strike-trait', mode: r.mode, traits: [r.value], ...(pick.length ? { when: pick } : {}) } };
    }
    case 'Strike': {
      const b = (r.damage || {}).base || {};
      if (!/^d(4|6|8|10|12)$/.test(String(b.die || '')) || !plain(b.damageType || 'x') || (r.label && !plain(r.label))) return keep('a Strike built from data we do not have');
      return { rule: { key: 'strike', name: cleanText(r.label || r.slug || 'Strike'), category: r.category || 'unarmed', ...(r.group ? { group: r.group } : {}), die: b.die, ...(b.dice > 1 ? { dice: b.dice } : {}), type: b.damageType, ...([].concat(r.traits || []).filter(plain).length ? { traits: [].concat(r.traits).filter(plain) } : {}), ...(r.range ? { range: typeof r.range === 'object' ? r.range.increment : r.range } : {}), ...(when ? { when } : {}) } };
    }
    case 'AdjustDegreeOfSuccess': {
      const adj = r.adjustment || {};
      if (!Object.keys(adj).length) return keep('no adjustment');
      return { rule: { key: 'degree', selector: r.selector, adjust: Object.fromEntries(Object.entries(adj).map(([k, v]) => [k.replace(/([A-Z])/g, '-$1').toLowerCase(), v])), ...(when ? { when } : {}) } };
    }
    case 'RollTwice':
      return { rule: { key: 'roll-twice', selector: r.selector, keep: r.keep === 'lower' ? 'lower' : 'higher', ...(when ? { when } : {}) } };
    case 'MultipleAttackPenalty': {
      const value = convertValue(r.value);
      if (value === null) return keep(`value "${r.value}" uses data we do not have`);
      return { rule: { key: 'map', selector: r.selector, value, ...(when ? { when } : {}) } };
    }
    case 'CriticalSpecialization':
      if (r.alternate) return keep('a different critical specialization effect');
      return { rule: { key: 'crit-spec', ...(when ? { when } : {}) } };
    case 'EphemeralEffect': {
      const cond = conditionOf(r.uuid, ctx), ref = cond ? null : ctx && ctx.ref ? ctx.ref(r.uuid) : null;
      if (!cond && !ref) return keep('an effect we could not find');
      return { rule: { key: 'ephemeral', selector: r.selectors || r.selector, affects: r.affects === 'origin' ? 'origin' : 'target', ...(cond ? { condition: cond } : { ref }), ...(when ? { when } : {}) } };
    }
    case 'TempHP': {
      const value = convertValue(r.value);
      if (value === null) return keep(`value "${r.value}" uses data we do not have`);
      const ev = r.events || {};
      return { rule: { key: 'temp-hp', value, ...(ev.onCreate === false ? { onCreate: false } : {}), ...(ev.onTurnStart ? { onTurnStart: true } : {}) } };
    }
    case 'FastHealing': {
      const value = convertValue(r.value);
      if (value === null) return keep(`value "${r.value}" uses data we do not have`);
      if (when) return keep('conditional fast healing');
      return { rule: { key: 'fast-healing', value, kind: r.type === 'regeneration' ? 'regeneration' : 'fast-healing', ...(r.deactivatedBy && r.deactivatedBy.length ? { deactivatedBy: [].concat(r.deactivatedBy) } : {}) } };
    }
    case 'Aura': {
      const radius = convertValue(r.radius);
      if (radius === null) return keep(`radius "${r.radius}" uses data we do not have`);
      const effects = [];
      for (const e of r.effects || []) {
        const ref = ctx && ctx.ref ? ctx.ref(e.uuid) : null;
        if (!ref) return keep('an aura effect we could not find');
        if (e.predicate && e.predicate.length) return keep('an aura effect with its own condition');
        effects.push({ ref, affects: ['enemies', 'allies', 'all'].includes(e.affects) ? e.affects : 'all', ...(e.save ? { save: { type: e.save.type, dc: e.save.dc } } : {}), ...(e.includesSelf ? { includesSelf: true } : {}) });
      }
      // an aura with no effects of its own (frightful presence): who is in it is reported for Claude to rule on
      return { rule: { key: 'aura', slug: r.slug || 'aura', radius, effects, ...([].concat(r.traits || []).filter(plain).length ? { traits: [].concat(r.traits).filter(plain) } : {}), ...(when ? { when } : {}) } };
    }
    case 'TokenLight': {
      const v = r.value || {};
      if (typeof v.bright !== 'number' && typeof v.dim !== 'number') return keep('a light built from data we do not have');
      return { rule: { key: 'light', bright: v.bright || 0, dim: v.dim || 0, ...(typeof v.color === 'string' && /^#[0-9a-f]{6}$/i.test(v.color) ? { colour: v.color.toLowerCase() } : {}) } };
    }
    case 'GrantItem': {
      const cond = conditionOf(r.uuid, ctx);
      if (!cond) return keep('grants an item or feature (comes with the character builder)');
      const alt = (r.alterations || []).find((a) => a.property === 'badge-value');
      return { rule: { key: 'grant-condition', condition: cond, ...(alt && Number.isInteger(alt.value) ? { value: alt.value } : {}) } };
    }
    default:
      return keep(`rule "${r.key}" is not supported yet`);
  }
}

export function convertRules(rules, where, ctx) {
  const out = [];
  for (const r of rules || []) {
    const c = convertRule(r, ctx);
    out.push(c.rule);
    if (c.unsupported) {
      const u = ctx.report.unsupported;
      u[c.unsupported] = (u[c.unsupported] || 0) + 1;
      if (ctx.report.flagged.length < 100000) ctx.report.flagged.push({ where, what: c.why });
    }
  }
  return out;
}

/** Where a document comes from: its book and licence (under system.publication, or system.details for actors). */
export function sourceOf(d) {
  const sys = (d && d.system) || {};
  const pub = sys.publication || (sys.details || {}).publication || null;
  return pub ? { title: pub.title || 'unknown', license: pub.license || '', ...(pub.remaster ? { remaster: true } : {}), from: 'foundry-pf2e' } : null;
}

// --- shared pieces ------------------------------------------------------------------------------------------------

const num = (v, d = undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const int = (v, d = undefined) => (Number.isInteger(v) ? v : (typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : d));
const strs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
const prune = (o) => {
  if (Array.isArray(o)) return o.map(prune);
  if (!o || typeof o !== 'object') return o;
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '') continue;
    const p = prune(v);
    if (Array.isArray(p) && !p.length) continue;
    if (p && typeof p === 'object' && !Array.isArray(p) && !Object.keys(p).length) continue;
    out[k] = p;
  }
  return out;
};
/** A Foundry action count: 1, 2, 3, 'reaction', 'free', or null (passive). */
function actionsOf(s) {
  const t = (s.actionType || {}).value;
  if (t === 'action') return int((s.actions || {}).value, null);
  if (t === 'reaction' || t === 'free') return t;
  return null;
}
/** A spell's casting time: '1', '2', '3', '1 to 3', 'reaction', 'free', '10 minutes'. */
function castTime(v) {
  const s = String(v || '').trim();
  if (/^[123]$/.test(s)) return Number(s);
  return s || null;
}
const prices = (p) => { const v = Object.fromEntries(Object.entries((p && p.value) || {}).filter(([, n]) => typeof n === 'number' && n > 0)); return Object.keys(v).length ? { ...v, ...(p.per && p.per > 1 ? { per: p.per } : {}) } : undefined; };
const iwrOf = (at) => prune({
  immunities: (at.immunities || []).map((x) => (x.exceptions && x.exceptions.length ? { type: x.type, except: x.exceptions.map((e) => (typeof e === 'string' ? e : e.label || e.type)).join(', ') } : x.type)),
  weaknesses: (at.weaknesses || []).map((x) => ({ type: x.type, value: x.value, ...(x.exceptions && x.exceptions.length ? { except: x.exceptions.map((e) => (typeof e === 'string' ? e : e.label || e.type)).join(', ') } : {}) })),
  resistances: (at.resistances || []).map((x) => ({ type: x.type, value: x.value, ...(x.exceptions && x.exceptions.length ? { except: x.exceptions.map((e) => (typeof e === 'string' ? e : e.label || e.type)).join(', ') } : {}), ...(x.doubleVs && x.doubleVs.length ? { doubleVs: x.doubleVs.join(', ') } : {}) })),
});
const linkOf = (ctx, uuid, name) => { const ref = uuid ? ctx.ref(uuid, name) : null; return prune({ name, ref }); };

/** The fields every document has. */
function base(d, kind, ctx, extra = {}) {
  const s = d.system || {}, tr = s.traits || {};
  const level = int((s.level || {}).value, int(((s.details || {}).level || {}).value, undefined));
  const doc = {
    kind, slug: ctx.slug, system: 'pf2e', name: d.name, source: sourceOf(d) || { title: 'unknown', license: 'unknown' },
    ...(level !== undefined ? { level } : {}),
    ...(tr.rarity && tr.rarity !== 'common' ? { rarity: tr.rarity } : {}),
    ...(strs(tr.value).length ? { traits: strs(tr.value) } : {}),
    ...extra,
  };
  const text = cleanText((s.description || {}).value ?? (typeof s.description === 'string' ? s.description : ''));
  if (text) doc.text = text;
  if (Array.isArray(s.rules) && s.rules.length) doc.rules = convertRules(s.rules, `${kindDir(kind)}/${ctx.slug}`, ctx);
  return doc;
}

// --- creatures, hazards, vehicles ---------------------------------------------------------------------------------

/** The things a creature, hazard or vehicle has: strikes, abilities, spellcasting, gear. */
function actorItems(d, ctx, where, skills) {
  const items = [], entries = new Map(), spells = [];
  for (const it of d.items || []) {
    const is = it.system || {};
    if (it.type === 'melee') {
      items.push(prune({
        kind: 'strike', name: it.name, attack: int((is.bonus || {}).value, 0), traits: strs((is.traits || {}).value),
        range: int((is.range || {}).increment) ?? undefined, maxRange: int((is.range || {}).max) ?? undefined,
        damage: Object.values(is.damageRolls || {}).filter((r) => r.damage).map((r) => prune({ dice: String(r.damage), type: r.damageType || 'untyped', category: r.category || undefined })),
        effects: strs((is.attackEffects || {}).value),
      }));
    } else if (it.type === 'action') {
      items.push(prune({
        kind: 'ability', name: it.name, actions: actionsOf(is), category: is.category || undefined, traits: strs((is.traits || {}).value),
        text: cleanText((is.description || {}).value), frequency: is.frequency && is.frequency.max ? { max: is.frequency.max, per: is.frequency.per } : undefined,
        rules: Array.isArray(is.rules) && is.rules.length ? convertRules(is.rules, `${where}: ${it.name}`, ctx) : undefined,
      }));
    } else if (it.type === 'spellcastingEntry') {
      const e = prune({
        kind: 'spellcasting', name: it.name, tradition: (is.tradition || {}).value || undefined, type: (is.prepared || {}).value || undefined,
        dc: int((is.spelldc || {}).dc), attack: int((is.spelldc || {}).value),
      });
      e.spells = [];
      entries.set(it._id, e);
      items.push(e);
    } else if (it.type === 'spell') {
      spells.push(it);
    } else if (it.type === 'lore') {
      skills[`${slugify(it.name).replace(/-lore$/, '')}-lore`] = int((is.mod || {}).value, 0);
    } else if (ITEM_KINDS.includes(it.type)) {
      const src = (it._stats || {}).compendiumSource;
      items.push(prune({ kind: 'gear', name: it.name, ref: src ? ctx.ref(src, it.name) : undefined, type: it.type, quantity: int(is.quantity, 1) > 1 ? is.quantity : undefined, text: src ? undefined : cleanText((is.description || {}).value) || undefined }));
    } else if (it.type === 'condition' || it.type === 'effect') {
      items.push(prune({ kind: 'ability', name: it.name, text: cleanText((is.description || {}).value) }));
    }
  }
  for (const sp of spells) {
    const is = sp.system || {}, e = entries.get((is.location || {}).value);
    const src = (sp._stats || {}).compendiumSource;
    const entry = prune({ name: sp.name, rank: int((is.location || {}).heightenedLevel, int((is.level || {}).value, 0)), ref: src ? ctx.ref(src, sp.name) : undefined, uses: (is.location || {}).uses && (is.location.uses.max > 1) ? is.location.uses.max : undefined });
    if (!entry.ref) entry.text = cleanText((is.description || {}).value) || undefined;
    if (e) e.spells.push(prune(entry)); else items.push(prune({ kind: 'spell', ...entry }));
  }
  return items;
}

/** A Foundry NPC as one of our creatures. */
export function convertCreature(d, ctx) {
  const s = d.system || {}, at = s.attributes || {}, where = `creature/${ctx.slug}`;
  const skills = {};
  for (const [k, v] of Object.entries(s.skills || {})) {
    const b = v.base ?? v.value ?? v.mod;
    skills[k] = v.special && v.special.length ? { value: b, special: v.special.map((x) => prune({ value: x.base, label: x.label, when: x.predicate })) } : b;
  }
  const speeds = { land: int((at.speed || {}).value, 0) };
  for (const o of (at.speed || {}).otherSpeeds || []) if (int(o.value) !== undefined) speeds[o.type] = int(o.value);
  const doc = base(d, 'creature', ctx, {
    level: int(((s.details || {}).level || {}).value, 0),
    size: SIZES[((s.traits || {}).size || {}).value] || 'medium',
  });
  doc.stats = prune({
    ac: int((at.ac || {}).value, 10), hp: int((at.hp || {}).max, 1), perception: int((s.perception || {}).mod, 0),
    saves: Object.fromEntries(Object.entries(s.saves || {}).map(([k, v]) => [k, int(v.value, 0)])),
    attributes: Object.fromEntries(Object.entries(s.abilities || {}).map(([k, v]) => [k, int(v.mod, 0)])),
    skills, speeds,
    senses: ((s.perception || {}).senses || []).map((x) => prune({ type: x.type, range: x.range, acuity: x.acuity })),
    languages: strs(((s.details || {}).languages || {}).value),
    iwr: iwrOf(at),
    notes: prune({ ac: (at.ac || {}).details, hp: (at.hp || {}).details, saves: at.allSaves && at.allSaves.value, perception: (s.perception || {}).details, speed: (at.speed || {}).details, languages: ((s.details || {}).languages || {}).details }),
  });
  if (doc.stats.hp < 1) doc.stats.hp = 1;
  doc.items = actorItems(d, ctx, where, doc.stats.skills || (doc.stats.skills = {}));
  if (!Object.keys(doc.stats.skills).length) delete doc.stats.skills;
  const text = cleanText((s.details || {}).publicNotes);
  if (text) doc.text = text; else delete doc.text;
  const blurb = (s.details || {}).blurb;
  if (blurb) doc.blurb = cleanText(blurb);
  return prune(doc);
}

/** A Foundry hazard (trap, haunt, environmental). */
export function convertHazard(d, ctx) {
  const s = d.system || {}, at = s.attributes || {}, det = s.details || {};
  const doc = base(d, 'hazard', ctx, { level: int((det.level || {}).value, 0), complex: !!det.isComplex });
  doc.stats = prune({
    ac: int((at.ac || {}).value), hardness: int(at.hardness), hp: at.hasHealth ? int((at.hp || {}).max) : undefined,
    stealth: prune({ value: int((at.stealth || {}).value), details: cleanText((at.stealth || {}).details) }),
    saves: Object.fromEntries(Object.entries(s.saves || {}).filter(([, v]) => int(v.value)).map(([k, v]) => [k, int(v.value)])),
    iwr: iwrOf(at),
  });
  doc.disable = cleanText(det.disable) || undefined;
  doc.reset = cleanText(det.reset) || undefined;
  doc.routine = cleanText(det.routine) || undefined;
  doc.items = actorItems(d, ctx, `hazard/${ctx.slug}`, {});
  const text = cleanText(det.description);
  if (text) doc.text = text;
  return prune(doc);
}

/** A Foundry vehicle. */
export function convertVehicle(d, ctx) {
  const s = d.system || {}, at = s.attributes || {}, det = s.details || {};
  const doc = base(d, 'vehicle', ctx, { level: int((det.level || {}).value, 0), size: SIZES[((s.traits || {}).size || {}).value] || 'large' });
  doc.stats = prune({
    ac: int((at.ac || {}).value), hardness: int(at.hardness), hp: int((at.hp || {}).max),
    saves: Object.fromEntries(Object.entries(s.saves || {}).map(([k, v]) => [k, int(v.value, 0)])),
    collision: prune({ dc: int((at.collisionDC || {}).value), damage: (at.collisionDamage || {}).value }),
    iwr: iwrOf(at),
  });
  Object.assign(doc, prune({ crew: det.crew, passengers: det.passengers, piloting: cleanText(det.pilotingCheck), speed: det.speed, space: det.space, price: int(det.price) }));
  doc.items = actorItems(d, ctx, `vehicle/${ctx.slug}`, {});
  const text = cleanText(det.description);
  if (text) doc.text = text;
  return prune(doc);
}

// --- items --------------------------------------------------------------------------------------------------------

/** A physical item: armour, shields, weapons, equipment, consumables, ammunition, treasure, containers, kits. */
export function convertItem(d, ctx) {
  const s = d.system || {}, kind = KIND_OF[d.type] || d.type;
  const doc = base(d, kind, ctx, { level: int((s.level || {}).value, 0) });
  if (kind === 'armor') Object.assign(doc, { category: s.category, group: s.group ?? null, acBonus: int(s.acBonus, 0), dexCap: int(s.dexCap, 0), checkPenalty: Math.min(0, int(s.checkPenalty, 0)), speedPenalty: Math.min(0, int(s.speedPenalty, 0)), strength: int(s.strength, null) });
  if (kind === 'shield') Object.assign(doc, { acBonus: int(s.acBonus, 0), hardness: int(s.hardness, 0), hp: int((s.hp || {}).max, 0), brokenAt: Math.floor(int((s.hp || {}).max, 0) / 2), ...(s.speedPenalty ? { speedPenalty: Math.min(0, int(s.speedPenalty, 0)) } : {}) });
  if (kind === 'weapon') {
    const dmg = s.damage || {};
    Object.assign(doc, prune({
      category: s.category, group: s.group ?? null,
      damage: prune({ die: /^d(4|6|8|10|12)$/.test(dmg.die || '') ? dmg.die : undefined, type: dmg.damageType, dice: int(dmg.dice, 1) > 1 ? dmg.dice : undefined, ...(dmg.die && !/^d(4|6|8|10|12)$/.test(dmg.die) ? { flat: dmg.die } : {}) }),
      range: int(s.range, null), reload: (s.reload || {}).value || undefined, hands: (s.usage || {}).value || null,
      splash: int((s.splashDamage || {}).value) || undefined, bonusDamage: int((s.bonusDamage || {}).value) || undefined,
      baseItem: s.baseItem || undefined,
    }));
    if (doc.range === undefined) doc.range = null;
    if (doc.hands === undefined) doc.hands = null;
    if (doc.group === undefined) doc.group = null;
  }
  if (kind === 'consumable') Object.assign(doc, prune({
    category: s.category, uses: (s.uses || {}).max > 1 ? { max: s.uses.max, autoDestroy: !!s.uses.autoDestroy } : undefined,
    damage: s.damage && s.damage.formula ? { formula: s.damage.formula, type: s.damage.type, kind: s.damage.kind } : undefined,
    spell: s.spell ? prune({ name: s.spell.name, rank: int(((s.spell.system || {}).location || {}).heightenedLevel, int(((s.spell.system || {}).level || {}).value)), ref: ((s.spell._stats || {}).compendiumSource) ? ctx.ref(s.spell._stats.compendiumSource, s.spell.name) : undefined }) : undefined,
  }));
  if (kind === 'ammo') Object.assign(doc, prune({ uses: (s.uses || {}).max > 1 ? { max: s.uses.max } : undefined, baseItem: s.baseItem || undefined }));
  if (kind === 'treasure') Object.assign(doc, prune({ category: s.category }));
  if (kind === 'backpack') Object.assign(doc, prune({ capacity: num((s.bulk || {}).capacity), ignored: num((s.bulk || {}).ignored) }));
  if (kind === 'kit') {
    const walk = (items) => Object.values(items || {}).map((x) => prune({ name: x.name, ref: x.uuid ? ctx.ref(x.uuid, x.name) : undefined, quantity: int(x.quantity, 1) > 1 ? x.quantity : undefined, contents: x.isContainer ? walk(x.items) : undefined }));
    doc.contents = walk(s.items);
  }
  if (['equipment', 'consumable', 'backpack', 'treasure', 'ammo'].includes(kind) && (s.usage || {}).value) doc.usage = s.usage.value;
  if ((s.material || {}).type) doc.material = prune({ type: s.material.type, grade: s.material.grade });
  if ((s.hp || {}).max && kind !== 'shield') doc.durability = { hardness: int(s.hardness, 0), hp: int(s.hp.max, 0) };
  if (s.bulk && s.bulk.value !== undefined) doc.bulk = num(s.bulk.value, 0);
  const price = prices(s.price);
  if (price) doc.price = price;
  if (s.runes && Object.values(s.runes).some((v) => (Array.isArray(v) ? v.length : v))) doc.runes = s.runes;
  return prune(doc);
}

// --- abilities: feats, actions, effects, conditions, campaign features ------------------------------------------

export function convertFeat(d, ctx) {
  const s = d.system || {};
  return prune(base(d, 'feat', ctx, {
    level: int((s.level || {}).value, 0), category: s.category, actions: actionsOf(s),
    prerequisites: ((s.prerequisites || {}).value || []).map((p) => (typeof p === 'string' ? p : p.value)).filter(Boolean),
    frequency: s.frequency && s.frequency.max ? { max: s.frequency.max, per: s.frequency.per } : undefined,
    maxTakable: int(s.maxTakable) > 1 || s.maxTakable === null ? s.maxTakable ?? 'unlimited' : undefined,
  }));
}

export function convertAction(d, ctx) {
  const s = d.system || {};
  return prune(base(d, 'action', ctx, {
    actions: actionsOf(s), category: s.category,
    frequency: s.frequency && s.frequency.max ? { max: s.frequency.max, per: s.frequency.per } : undefined,
    selfEffect: s.selfEffect ? linkOf(ctx, s.selfEffect.uuid, s.selfEffect.name) : undefined,
  }));
}

export function convertEffect(d, ctx) {
  const s = d.system || {}, du = s.duration || {};
  return prune(base(d, 'effect', ctx, {
    level: int((s.level || {}).value, 0),
    duration: du.unit === 'unlimited' ? { unit: 'unlimited' } : prune({ value: int(du.value), unit: du.unit, expiry: du.expiry, sustained: du.sustained || undefined }),
    badge: s.badge ? prune({ type: s.badge.type, value: s.badge.value, max: (s.badge.max ?? undefined), labels: s.badge.labels }) : undefined,
  }));
}

export function convertCondition(d, ctx) {
  const s = d.system || {};
  return prune(base(d, 'condition', ctx, { valued: !!(s.value || {}).isValued, group: s.group || undefined, note: 'Reference text: the ruleset defines how conditions work (rulesets/pf2e/rules.js).' }));
}

export function convertCampaignFeature(d, ctx) {
  const s = d.system || {};
  return prune(base(d, 'campaign-feature', ctx, {
    level: int((s.level || {}).value), campaign: s.campaign, category: s.category, actions: actionsOf(s),
    prerequisites: ((s.prerequisites || {}).value || []).map((p) => (typeof p === 'string' ? p : p.value)).filter(Boolean),
  }));
}

// --- spells --------------------------------------------------------------------------------------------------------

export function convertSpell(d, ctx) {
  const s = d.system || {}, tr = s.traits || {}, def = s.defense || {};
  const traits = strs(tr.value);
  const doc = base(d, 'spell', ctx, {
    rank: int((s.level || {}).value, 1), cantrip: traits.includes('cantrip') || undefined, focus: traits.includes('focus') || undefined,
    ritual: s.ritual ? prune({ primary: (s.ritual.primary || {}).check, secondary: prune({ checks: (s.ritual.secondary || {}).checks, casters: int((s.ritual.secondary || {}).casters) }) }) : undefined,
    traditions: strs(tr.traditions),
    actions: castTime((s.time || {}).value), cost: (s.cost || {}).value || undefined, requirements: s.requirements || undefined,
    range: (s.range || {}).value || undefined,
    area: s.area && s.area.type ? prune({ type: s.area.type, value: int(s.area.value), details: s.area.details }) : undefined,
    target: (s.target || {}).value || undefined,
    duration: prune({ value: (s.duration || {}).value, sustained: (s.duration || {}).sustained || undefined }),
    defense: def.save ? { save: def.save.statistic, basic: !!def.save.basic } : def.passive ? { against: def.passive.statistic } : undefined,
    damage: Object.values(s.damage || {}).map((x) => prune({ formula: x.formula, type: x.type, kind: x.kinds && x.kinds.length ? x.kinds : undefined, category: x.category || undefined, materials: x.materials && x.materials.length ? x.materials : undefined })),
    counteraction: s.counteraction || undefined,
  });
  delete doc.level;
  const h = s.heightening;
  if (h && h.type === 'interval') doc.heightening = prune({ every: int(h.interval), damage: h.damage && Object.keys(h.damage).length ? h.damage : undefined, area: int(h.area) || undefined });
  if (h && h.type === 'fixed') doc.heightening = { ranks: Object.fromEntries(Object.entries(h.levels || {}).map(([rank, ch]) => [rank, prune({ damage: ch.damage ? Object.values(ch.damage).map((x) => prune({ formula: x.formula, type: x.type })) : undefined, area: ch.area ? int(ch.area.value) : undefined, target: ch.target ? ch.target.value : undefined, range: ch.range ? ch.range.value : undefined, duration: ch.duration ? ch.duration.value : undefined })])) };
  const over = Object.values(s.overlays || {}).filter((o) => o.overlayType === 'override').sort((a, b) => (a.sort || 0) - (b.sort || 0));
  if (over.length) doc.variants = over.map((o) => { const v = o.system || {}; return prune({ name: o.name, actions: castTime((v.time || {}).value), area: v.area ? prune({ type: v.area.type, value: int(v.area.value) }) : undefined, range: (v.range || {}).value, target: (v.target || {}).value, damage: v.damage ? Object.values(v.damage).map((x) => prune({ formula: x.formula, type: x.type })) : undefined, defense: v.defense && v.defense.save ? { save: v.defense.save.statistic, basic: !!v.defense.save.basic } : undefined }); });
  return prune(doc);
}

// --- character options ---------------------------------------------------------------------------------------------

const boostSets = (b) => Object.values(b || {}).map((x) => strs(x.value)).filter((x) => x.length);
const grants = (items, ctx) => Object.values(items || {}).sort((a, b) => (a.level || 0) - (b.level || 0) || String(a.name).localeCompare(String(b.name))).map((x) => prune({ name: x.name, level: int(x.level), ref: x.uuid ? ctx.ref(x.uuid, x.name) : undefined }));

export function convertAncestry(d, ctx) {
  const s = d.system || {};
  return prune(base(d, 'ancestry', ctx, {
    hp: int(s.hp, 0), size: SIZES[s.size] || 'medium', speed: int(s.speed, 25), reach: int(s.reach), hands: int(s.hands), vision: s.vision || undefined,
    boosts: boostSets(s.boosts), flaws: boostSets(s.flaws),
    languages: strs((s.languages || {}).value), additionalLanguages: prune({ count: int((s.additionalLanguages || {}).count), choices: strs((s.additionalLanguages || {}).value) }),
    features: grants(s.items, ctx),
  }));
}

export function convertHeritage(d, ctx) {
  const s = d.system || {}, a = s.ancestry;
  return prune(base(d, 'heritage', ctx, { ancestry: a ? linkOf(ctx, a.uuid, a.name) : undefined, versatile: !a || undefined }));
}

export function convertBackground(d, ctx) {
  const s = d.system || {};
  return prune(base(d, 'background', ctx, {
    boosts: boostSets(s.boosts), skills: strs((s.trainedSkills || {}).value), lore: strs((s.trainedSkills || {}).lore),
    feats: grants(s.items, ctx),
  }));
}

export function convertClass(d, ctx) {
  const s = d.system || {};
  return prune(base(d, 'class', ctx, {
    hp: int(s.hp, 0), keyAttribute: strs((s.keyAbility || {}).value), perception: int(s.perception, 0),
    saves: prune({ fortitude: int((s.savingThrows || {}).fortitude), reflex: int((s.savingThrows || {}).reflex), will: int((s.savingThrows || {}).will) }),
    skills: prune({ trained: strs((s.trainedSkills || {}).value), additional: int((s.trainedSkills || {}).additional) }),
    attacks: prune({ simple: int((s.attacks || {}).simple), martial: int((s.attacks || {}).martial), advanced: int((s.attacks || {}).advanced), unarmed: int((s.attacks || {}).unarmed), other: (s.attacks || {}).other && (s.attacks.other.name ? { name: s.attacks.other.name, rank: int(s.attacks.other.rank) } : undefined) }),
    defenses: prune({ unarmored: int((s.defenses || {}).unarmored), light: int((s.defenses || {}).light), medium: int((s.defenses || {}).medium), heavy: int((s.defenses || {}).heavy) }),
    classDC: int(s.classDC) ?? undefined, spellcasting: int(s.spellcasting) || undefined,
    featLevels: prune({ ancestry: (s.ancestryFeatLevels || {}).value, class: (s.classFeatLevels || {}).value, general: (s.generalFeatLevels || {}).value, skill: (s.skillFeatLevels || {}).value }),
    skillIncreaseLevels: (s.skillIncreaseLevels || {}).value,
    features: grants(s.items, ctx),
  }));
}

export function convertDeity(d, ctx) {
  const s = d.system || {};
  return prune(base(d, 'deity', ctx, {
    category: s.category, attribute: strs(s.attribute), skill: strs([].concat(s.skill || [])), weapons: strs(s.weapons), font: strs(s.font),
    domains: prune({ primary: strs((s.domains || {}).primary), alternate: strs((s.domains || {}).alternate) }),
    sanctification: s.sanctification && s.sanctification.what && s.sanctification.what.length ? { modal: s.sanctification.modal, what: s.sanctification.what } : undefined,
    spells: Object.entries(s.spells || {}).map(([rank, uuid]) => prune({ rank: int(rank), ref: ctx.ref(uuid), name: String(uuid).split('.').pop() })),
  }));
}

/** The converter for each of our kinds. */
export const CONVERTERS = {
  creature: convertCreature, hazard: convertHazard, vehicle: convertVehicle,
  armor: convertItem, shield: convertItem, weapon: convertItem, equipment: convertItem, consumable: convertItem,
  ammo: convertItem, treasure: convertItem, backpack: convertItem, kit: convertItem,
  feat: convertFeat, action: convertAction, effect: convertEffect, condition: convertCondition, spell: convertSpell,
  ancestry: convertAncestry, heritage: convertHeritage, background: convertBackground, class: convertClass, deity: convertDeity,
  'campaign-feature': convertCampaignFeature,
};
