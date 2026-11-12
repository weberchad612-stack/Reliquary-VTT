// PF2E's own rule keys, beyond the engine's (modifier, resistance, weakness, immunity, speed, sense, note): how
// each is collected (engine/rules/rules.js collectRules calls these) and how the prepared creature uses it.
// Converted from Foundry's rule elements by tools/import/foundry/convert.mjs. Docs: docs/design/game-data.md 8.
//
//   roll-option    {option, toggleable?, label?, default?, when?}   a situation tag; a switch when toggleable
//   trait          {add?: [], remove?: []}                          traits the creature gains or loses
//   size           {size}                                           the creature's size
//   damage-dice    {selector, dice, die, type?, category?, critical?, label?, when?}   extra damage dice
//   strike-trait   {mode: add|remove, traits: [], when?}            Strikes matching `when` gain or lose traits
//   strike         {name, category, group?, die, dice?, type, traits?, range?}         a granted Strike
//   degree         {selector, adjust: {success: 'one-degree-better', ...}, when?}      degree of success changes
//   roll-twice     {selector, keep: higher|lower, when?}
//   map            {selector, value}                                multiple attack penalty (second attack)
//   crit-spec      {when?}                                          critical specialization effects apply
//   ephemeral      {selector, affects: target|origin, condition?|ref?, when?}           only for that roll
//   temp-hp        {value, onCreate?, onTurnStart?}
//   fast-healing   {value, kind: fast-healing|regeneration, deactivatedBy?: []}
//   aura           {slug, radius, effects: [{ref, affects, save?, includesSelf?}], traits?}  (no effects: who is
//                  inside is reported, for Claude to apply the ability's text)
//   light          {bright, dim, colour?}                           the creature sheds light
//   grant-condition {condition, value?}                             an effect puts a condition on the creature

import { evalExpr } from '../../engine/rules/expr.js';

const list = (out, k) => (out[k] = out[k] || []);
const sels = (r) => [].concat(r.selector || []);
const v = (x, ctx) => (x === undefined ? undefined : evalExpr(x, ctx.vars));

export const PF2E_RULE_HANDLERS = Object.freeze({
  'roll-option': (r, ctx, out) => list(out, 'options').push({ option: r.option, toggleable: !!r.toggleable, label: r.label || r.option, default: !!r.default, when: r.when, origin: ctx.origin }),
  trait: (r, ctx, out) => list(out, 'traitChanges').push({ add: r.add || [], remove: r.remove || [], when: r.when, origin: ctx.origin }),
  size: (r, ctx, out) => list(out, 'sizes').push({ value: r.size, when: r.when, origin: ctx.origin }),
  'damage-dice': (r, ctx, out) => list(out, 'damageDice').push({ selectors: sels(r), dice: v(r.dice ?? 1, ctx), die: r.die, type: r.type, category: r.category, critical: !!r.critical, label: r.label || ctx.origin.label, when: r.when, origin: ctx.origin }),
  'strike-trait': (r, ctx, out) => list(out, 'strikeTraits').push({ mode: r.mode, traits: [].concat(r.traits || []), when: r.when, origin: ctx.origin }),
  strike: (r, ctx, out) => list(out, 'grantedStrikes').push({ ...r, origin: ctx.origin }),
  degree: (r, ctx, out) => list(out, 'degree').push({ selectors: sels(r), adjust: r.adjust || {}, when: r.when, origin: ctx.origin }),
  'roll-twice': (r, ctx, out) => list(out, 'rollTwice').push({ selectors: sels(r), keep: r.keep === 'lower' ? 'lower' : 'higher', when: r.when, origin: ctx.origin }),
  map: (r, ctx, out) => list(out, 'mapRules').push({ selectors: sels(r), value: v(r.value, ctx), when: r.when, origin: ctx.origin }),
  'crit-spec': (r, ctx, out) => list(out, 'critSpec').push({ when: r.when, origin: ctx.origin }),
  ephemeral: (r, ctx, out) => list(out, 'ephemeral').push({ selectors: sels(r), affects: r.affects || 'target', condition: r.condition, value: r.value, ref: r.ref, when: r.when, origin: ctx.origin }),
  'temp-hp': (r, ctx, out) => list(out, 'tempHp').push({ value: v(r.value, ctx), onCreate: r.onCreate !== false, onTurnStart: !!r.onTurnStart, origin: ctx.origin }),
  'fast-healing': (r, ctx, out) => list(out, 'fastHealing').push({ value: v(r.value, ctx), kind: r.kind === 'regeneration' ? 'regeneration' : 'fast-healing', deactivatedBy: r.deactivatedBy || [], origin: ctx.origin }),
  aura: (r, ctx, out) => list(out, 'auras').push({ slug: r.slug, radius: v(r.radius, ctx), effects: r.effects || [], traits: r.traits || [], level: ctx.vars.itemLevel, when: r.when, origin: ctx.origin }),
  light: (r, ctx, out) => list(out, 'lights').push({ bright: r.bright || 0, dim: r.dim || 0, colour: r.colour, origin: ctx.origin }),
  'grant-condition': (r, ctx, out) => list(out, 'grantsConditions').push({ condition: r.condition, value: r.value, origin: ctx.origin }),
});
export const PF2E_RULE_KEYS = Object.freeze(Object.keys(PF2E_RULE_HANDLERS));

/** Selectors of a check, for degree and roll-twice rules (and the tools' checks). */
export function checkSelectors(kind, slug) {
  if (kind === 'save') return [slug, 'saving-throw', 'all'];
  if (kind === 'skill') return [slug, 'skill-check', 'all'];
  if (kind === 'lore') return [`${slug}-lore`, 'lore', 'skill-check', 'all'];
  if (kind === 'perception') return ['perception', 'perception-check', 'all'];
  if (kind === 'strike') return [`${slug}-attack`, 'strike-attack-roll', 'attack-roll', 'attack', 'all'];
  if (kind === 'spell-attack') return ['spell-attack-roll', 'attack-roll', 'attack', 'all'];
  return [slug, 'all'];
}

const DEGREE_STEPS = { 'one-degree-better': 1, 'two-degrees-better': 2, 'one-degree-worse': -1, 'two-degrees-worse': -2, 'to-critical-failure': 'critical-failure', 'to-failure': 'failure', 'to-success': 'success', 'to-critical-success': 'critical-success' };
const DEGREES = ['critical-failure', 'failure', 'success', 'critical-success'];
/** A degree of success after the creature's degree rules ({success: 'one-degree-better'}); returns {degree, by}. */
export function adjustDegree(degree, rules) {
  let d = degree;
  const by = [];
  for (const r of rules || []) {
    const how = r.adjust[d] || r.adjust.all;
    if (!how) continue;
    const step = DEGREE_STEPS[how];
    const i = typeof step === 'number' ? Math.max(0, Math.min(3, DEGREES.indexOf(d) + step)) : DEGREES.indexOf(step);
    if (i >= 0 && DEGREES[i] !== d) { by.push(`${r.origin.label}: ${d} becomes ${DEGREES[i]}`); d = DEGREES[i]; }
  }
  return { degree: d, by };
}
