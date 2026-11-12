// Pathfinder 2E damage and healing: immunities, weaknesses and resistances, temporary Hit Points first, then
// Hit Points; at 0 HP a character (or a creature using the dying rules) is knocked out and dying, others die;
// massive damage; healing that wakes the dying (and leaves them wounded); temporary HP that never stacks;
// recovery checks. Pure functions: they return the new live state and conditions with a description, and
// write nothing. Rules from Player Core (ORC), paraphrased. Docs: docs/design/game-data.md.

import { degreeOf } from '../../engine/rules/rules.js';
import { DAMAGE_GROUPS } from './rules.js';

const setEffect = (effects, id, value) => {
  const rest = (effects || []).filter((e) => e.id !== id);
  return value === null || value === undefined || value === false ? rest : [...rest, value === true ? { id } : { id, value }];
};
const valueOf = (effects, id) => ((effects || []).find((e) => e.id === id) || {}).value || 0;
const has = (effects, id) => (effects || []).some((e) => e.id === id);
const covers = (entry, type) => entry.type === type || entry.type === 'all-damage' || (DAMAGE_GROUPS[entry.type] || []).includes(type);

/**
 * How much of each damage instance gets through: immunity (none), weakness (the highest that applies, added),
 * resistance (the highest that applies, taken off, never below 0).
 * @param {object} iwr  {immunities, weaknesses, resistances} from preparePf2e
 * @param {Array<{amount, type}>} parts
 * @returns {{total, lines: string[], parts: Array<{type, amount, taken}>}}
 */
export function adjustDamage(iwr, parts) {
  const lines = [], out = [];
  for (const p of parts) {
    let taken = Math.max(0, Math.floor(p.amount)), note = [];
    if ((iwr.immunities || []).some((i) => covers(i, p.type))) { out.push({ ...p, taken: 0 }); lines.push(`immune to ${p.type}`); continue; }
    const weak = Math.max(0, ...(iwr.weaknesses || []).filter((w) => covers(w, p.type)).map((w) => w.value || 0));
    if (weak && taken > 0) { taken += weak; note.push(`weakness ${weak}`); }
    const res = Math.max(0, ...(iwr.resistances || []).filter((r) => covers(r, p.type)).map((r) => r.value || 0));
    if (res) { taken = Math.max(0, taken - res); note.push(`resistance ${res}`); }
    out.push({ ...p, taken });
    if (note.length) lines.push(`${p.amount} ${p.type}: ${note.join(', ')} → ${taken}`);
  }
  return { total: out.reduce((s, p) => s + p.taken, 0), lines, parts: out };
}

/**
 * Damage a prepared creature.
 * @param {object} prepared  preparePf2e's result
 * @param {object} state     live state ({hp, temp, ...})
 * @param {Array} effects    the token's effects (conditions)
 * @param {object} hit       {parts: [{amount, type}]} or {amount, type}; critical (from a critical hit or a
 *                           critically failed save); nonlethal
 * @returns {{state, effects, dead, total, lines}}
 */
export function applyDamage(prepared, state, effects, hit) {
  const parts = hit.parts || [{ amount: hit.amount, type: hit.type || 'untyped' }];
  const adj = adjustDamage(prepared.iwr, parts);
  const lines = [...adj.lines], max = prepared.hp.max.value;
  let hp = prepared.hp.value, temp = prepared.hp.temp, left = adj.total, fx = [...(effects || [])], dead = false;
  if (temp && left) { const t = Math.min(temp, left); temp -= t; left -= t; lines.push(`${t} taken by temporary HP`); }
  const wasDown = hp <= 0;
  hp = Math.max(0, hp - left);
  lines.push(`${adj.total} damage: ${prepared.hp.value} → ${hp} HP`);
  if (adj.total >= 2 * max) { dead = true; lines.push('massive damage (at least double maximum HP): dies at once'); }
  else if (hp === 0 && adj.total > 0) {
    if (!prepared.usesDying) { dead = true; lines.push('reduced to 0 HP: dies'); }
    else if (wasDown && has(fx, 'dying')) {
      const d = valueOf(fx, 'dying') + (hit.critical ? 2 : 1);
      fx = setEffect(fx, 'dying', d); lines.push(`damaged while dying: dying ${d}`);
    } else if (hit.nonlethal) {
      fx = setEffect(fx, 'unconscious', true); lines.push('nonlethal: knocked out, unconscious and not dying');
    } else {
      const d = (hit.critical ? 2 : 1) + valueOf(fx, 'wounded');
      fx = setEffect(setEffect(fx, 'dying', d), 'unconscious', true);
      lines.push(`knocked out: dying ${d}${valueOf(fx, 'wounded') ? ` (wounded ${valueOf(fx, 'wounded')} added)` : ''}`);
    }
    if (!dead && valueOf(fx, 'dying') >= prepared.dying.max) { dead = true; lines.push(`dying ${valueOf(fx, 'dying')} reaches ${prepared.dying.max}: dies`); }
  }
  if (dead) fx = setEffect(setEffect(fx, 'dying', null), 'unconscious', null);
  return { state: { ...state, hp, temp }, effects: fx, dead, total: adj.total, lines };
}

/**
 * Heal a prepared creature: up to its maximum; at 0 HP and dying, 1 HP or more ends dying (wounded 1, or +1)
 * and wakes it. The dead are not healed.
 */
export function applyHealing(prepared, state, effects, amount, { dead = false } = {}) {
  if (dead) return { state, effects, lines: ['dead: healing has no effect'] };
  const max = prepared.hp.max.value, from = prepared.hp.value, hp = Math.min(max, from + Math.max(0, Math.floor(amount)));
  let fx = [...(effects || [])];
  const lines = [`healed ${hp - from}: ${from} → ${hp} HP${hp === max ? ' (full)' : ''}`];
  if (from === 0 && hp > 0) {
    if (has(fx, 'dying')) { fx = setEffect(fx, 'dying', null); const w = valueOf(fx, 'wounded') + 1; fx = setEffect(fx, 'wounded', w); lines.push(`no longer dying: wounded ${w}`); }
    if (has(fx, 'unconscious')) { fx = setEffect(fx, 'unconscious', null); lines.push('wakes up'); }
  }
  return { state: { ...state, hp }, effects: fx, lines };
}

/** Temporary HP: they never add up; the creature keeps the larger amount. */
export function setTempHp(prepared, state, amount) {
  const temp = Math.max(prepared.hp.temp, Math.max(0, Math.floor(amount)));
  return { state: { ...state, temp }, lines: [temp > prepared.hp.temp ? `temporary HP ${temp}` : `keeps ${prepared.hp.temp} temporary HP (they do not stack)`] };
}

/**
 * A recovery check for a dying creature: a flat check against DC 10 + dying. Critical success: dying −2;
 * success −1; failure +1; critical failure +2. Reaching 0 ends dying (wounded +1, still unconscious at 0 HP);
 * reaching the maximum (4 less doomed) is death.
 */
export function recoveryCheck(prepared, effects, die) {
  const d0 = valueOf(effects, 'dying');
  if (!d0) return { effects, lines: ['not dying: no recovery check'], degree: null, dead: false };
  const dc = 10 + d0, degree = degreeOf(die, dc, die);
  const step = { 'critical-success': -2, success: -1, failure: 1, 'critical-failure': 2 }[degree];
  const d = Math.max(0, d0 + step);
  let fx = [...effects], dead = false;
  const lines = [`recovery check: ${die} against DC ${dc}, ${degree.replace('-', ' ')}: dying ${d0} → ${d}`];
  if (d === 0) { fx = setEffect(fx, 'dying', null); const w = valueOf(fx, 'wounded') + 1; fx = setEffect(fx, 'wounded', w); lines.push(`no longer dying, still unconscious at 0 HP: wounded ${w}`); }
  else if (d >= prepared.dying.max) { dead = true; fx = setEffect(setEffect(fx, 'dying', null), 'unconscious', null); lines.push(`dying ${d} reaches ${prepared.dying.max}: dies`); }
  else fx = setEffect(fx, 'dying', d);
  return { effects: fx, lines, degree, dead };
}
