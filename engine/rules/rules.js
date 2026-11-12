// The system-free rules machinery: predicates, statistics with breakdowns, rule elements, degrees of success,
// and preparing a creature from its data, its items and its conditions. A ruleset (rulesets/<id>/) supplies
// the system's shapes and rules: which bonus types stack, what a selector covers, what each condition does,
// how statistics are computed. Docs: docs/design/game-data.md section 4.

import { evalExpr } from './expr.js';

/**
 * Does a predicate hold for a set of tags? A predicate is a list that must all hold; each entry a tag
 * (string), {or: [...]}, {and: [...]} or {not: entry}. No predicate always holds.
 */
export function testPredicate(pred, tags) {
  if (pred === undefined || pred === null) return true;
  const has = (t) => (tags instanceof Set ? tags.has(t) : (tags || []).includes(t));
  const one = (p) => {
    if (typeof p === 'string') return has(p);
    if (Array.isArray(p)) return p.every(one);
    if (p && Array.isArray(p.or)) return p.or.some(one);
    if (p && Array.isArray(p.and)) return p.and.every(one);
    if (p && typeof p === 'object' && 'not' in p) return !one(p.not);
    throw new Error(`bad predicate ${JSON.stringify(p)}`);
  };
  return Array.isArray(pred) ? pred.every(one) : one(pred);
}

/**
 * A statistic from a base and modifiers, with a breakdown that says what counted and why.
 * @param {object} o
 *   slug, label; base: number; parts: [{label, value}] what makes up the base (shown, already in base);
 *   modifiers: [{slug, label, type, value, when?, origin?}]; tags: what holds now (for `when`);
 *   stacks(type): true when every modifier of that type adds up (untyped), false when only the best bonus
 *   and the worst penalty of that type count; floor: lowest value allowed (speeds).
 * @returns {{slug, label, value, base, parts, modifiers: Array<{..., applied: boolean, reason?: string}>}}
 */
export function makeStatistic({ slug, label, base = 0, parts = [], modifiers = [], tags = [], stacks = () => false, floor = -Infinity }) {
  const rows = modifiers.map((m) => ({ ...m, value: Number(m.value) || 0, applied: false }));
  const live = [];
  for (const m of rows) {
    if (!m.value) { m.reason = 'zero'; continue; }
    if (!testPredicate(m.when, tags)) { m.reason = 'does not apply now'; continue; }
    live.push(m);
  }
  // the same modifier twice (frightened from two sources, a condition granted twice): only the strongest
  const bySlug = new Map();
  for (const m of live) {
    const k = m.slug ? `${m.slug}|${m.value < 0 ? '-' : '+'}` : null;
    if (!k) continue;
    const prev = bySlug.get(k);
    if (!prev || Math.abs(m.value) > Math.abs(prev.value)) { if (prev) prev.reason = 'the same modifier counts once'; bySlug.set(k, m); }
    else m.reason = 'the same modifier counts once';
  }
  const kept = live.filter((m) => !m.reason);
  // typed: the best bonus and the worst penalty of each type; untyped: all
  const best = new Map();
  for (const m of kept) {
    if (stacks(m.type)) { m.applied = true; continue; }
    const k = `${m.type}|${m.value < 0 ? '-' : '+'}`, prev = best.get(k);
    if (!prev || Math.abs(m.value) > Math.abs(prev.value)) { if (prev) { prev.applied = false; prev.reason = `a bigger ${m.type} ${m.value < 0 ? 'penalty' : 'bonus'} applies`; } best.set(k, m); m.applied = true; }
    else m.reason = `a bigger ${m.type} ${m.value < 0 ? 'penalty' : 'bonus'} applies`;
  }
  const total = base + rows.filter((m) => m.applied).reduce((s, m) => s + m.value, 0);
  return { slug, label, value: Math.max(floor, total), base, parts, modifiers: rows };
}

/** A breakdown in words: "AC 18 = 10 base + 2 Dex + 5 proficiency (trained) + 4 armour (item) − 1 clumsy (status)". */
export function describeStatistic(st) {
  const sign = (v) => (v < 0 ? `− ${-v}` : `+ ${v}`);
  const parts = st.parts.map((p, i) => (i ? `${sign(p.value)} ${p.label}` : `${p.value} ${p.label}`));
  for (const m of st.modifiers) if (m.applied) parts.push(`${sign(m.value)} ${m.label || m.slug}${m.type && m.type !== 'untyped' ? ` (${m.type})` : ''}`);
  return `${st.label} ${st.value} = ${parts.join(' ') || st.base}`;
}

/** Rule-element keys every ruleset gets; a ruleset may add its own (rules[key](rule, ctx, out)). */
export const BASE_RULE_KEYS = Object.freeze(['modifier', 'resistance', 'weakness', 'immunity', 'speed', 'sense', 'note']);

/**
 * Run the rule elements of a creature's sources (items, feats, conditions, effects).
 * @param {Array<{origin: {kind, id, label}, value?: number, rules: object[]}>} sources
 * @param {object} vars  values for expressions: {level, ...}; each source's own value is @value
 * @param {object} [extra]  extra rule keys a ruleset handles: {key: (rule, ctx, out) => void}
 * @returns {{modifiers, resistances, weaknesses, immunities, speeds, senses, notes, unknown, errors, skipped}}  skipped: imported
 *   rules kept for later ({foundry: original}), never run
 */
export function collectRules(sources, vars = {}, extra = {}) {
  const out = { modifiers: [], resistances: [], weaknesses: [], immunities: [], speeds: [], senses: [], notes: [], unknown: [], errors: [], skipped: [] };
  for (const src of sources) {
    for (const rule of src.rules || []) {
      if (rule.foundry) { out.skipped.push({ origin: src.origin, rule }); continue; }   // imported, not supported yet: listed, not run
      const ctx = { origin: src.origin, vars: { ...vars, value: src.value ?? 0 } };
      const val = (v) => (v === undefined ? undefined : evalExpr(v, ctx.vars));
      try {
        switch (rule.key) {
          case 'modifier':
            out.modifiers.push({ slug: rule.slug || src.origin.id, label: rule.label || src.origin.label, type: rule.type || 'untyped', value: val(rule.value), selectors: [].concat(rule.selector || []), when: rule.when, origin: src.origin, damageType: rule.damageType });
            break;
          case 'resistance': case 'weakness':
            out[rule.key === 'resistance' ? 'resistances' : 'weaknesses'].push({ type: rule.type, value: val(rule.value), except: rule.except, origin: src.origin });
            break;
          case 'immunity':
            out.immunities.push({ type: rule.type, except: rule.except, origin: src.origin });
            break;
          case 'speed':
            out.speeds.push({ type: rule.type || 'land', value: val(rule.value), origin: src.origin });
            break;
          case 'sense':
            out.senses.push({ type: rule.type, range: val(rule.range), acuity: rule.acuity, origin: src.origin });
            break;
          case 'note':
            out.notes.push({ selectors: [].concat(rule.selector || []), text: rule.text, outcome: rule.outcome, when: rule.when, origin: src.origin });
            break;
          default:
            if (extra[rule.key]) extra[rule.key](rule, ctx, out);
            else out.unknown.push({ origin: src.origin, rule });
        }
      } catch (e) {
        out.errors.push({ origin: src.origin, rule, error: e.message });
      }
    }
  }
  return out;
}

/** The modifiers that apply to a statistic: those whose selectors include any of the statistic's. */
export function modifiersFor(modifiers, selectors) {
  const want = new Set(selectors);
  return modifiers.filter((m) => m.selectors.some((s) => want.has(s)));
}

/**
 * Degree of success of a check: critical success when the total beats the DC by `margin` or more, success
 * at the DC or above, critical failure when it misses by `margin` or more, else failure; a natural 20 is one
 * degree better and a natural 1 one worse (when the ruleset uses that rule).
 * @returns {'critical-success'|'success'|'failure'|'critical-failure'}
 */
export function degreeOf(total, dc, die, { margin = 10, naturalShift = true } = {}) {
  const order = ['critical-failure', 'failure', 'success', 'critical-success'];
  let d = total >= dc + margin ? 3 : total >= dc ? 2 : total <= dc - margin ? 0 : 1;
  if (naturalShift && die === 20) d = Math.min(3, d + 1);
  if (naturalShift && die === 1) d = Math.max(0, d - 1);
  return order[d];
}

/** Deep merge for a creature over its base: objects merge, arrays and values replace; null removes. */
export function mergeData(base, over) {
  if (over === undefined) return base;
  if (over === null) return undefined;
  if (Array.isArray(over) || typeof over !== 'object' || typeof base !== 'object' || base === null || Array.isArray(base)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) { const m = mergeData(base[k], v); if (m === undefined) delete out[k]; else out[k] = m; }
  return out;
}

/**
 * Prepare a creature for play: its data merged over its base (a stat block in the content), its rule
 * sources gathered (its items and feats, its conditions as the ruleset defines them), and the ruleset's
 * prepare() computing every statistic. Nothing is stored.
 * @param {object} o  actor (actors/<id>), state (live state), effects (conditions on its token), content
 *                    ({'<kind>/<slug>': document}), ruleset (rulesets/<id>/system.js's `actors`)
 */
export function prepareActor({ actor, state = {}, effects = [], content = {}, ruleset }) {
  if (!ruleset || typeof ruleset.prepare !== 'function') throw new Error('the ruleset cannot prepare creatures');
  let data = actor;
  if (actor.base) {
    const base = content[actor.base];
    if (!base) throw new Error(`no content "${actor.base}" for ${actor.name || 'this creature'}`);
    const { base: _b, ...own } = actor;
    data = mergeData(base, own);
  }
  return ruleset.prepare(data, state, effects, { content });
}
