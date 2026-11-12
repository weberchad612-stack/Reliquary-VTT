// What PF2E does at turn boundaries and when time passes (Player Core, paraphrased), answering the encounter
// engine's events (engine/time/encounter.js) and the clock's:
//   end of a turn     persistent damage, then a DC 15 flat check to end it; frightened goes down by 1
//   start of a turn   fast healing and regeneration; temporary HP that renews each turn; a dying creature's
//                     recovery check
//   any boundary      effects whose duration has run out are removed, with the conditions they granted
//   encounter end     effects that last for the encounter end
// Pure: takes the creatures and returns what changed (tokens' effects, live state) and lines for the log.
// Docs: docs/design/game-data.md section 8.

import { expireEffects } from '../../engine/time/clock.js';
import { rollFormula, rollDie } from '../../engine/rules/dice.js';
import { applyDamage, applyHealing, setTempHp, recoveryCheck } from './damage.js';

const valueOf = (effects, id) => ((effects || []).find((e) => e.id === id) || {}).value || 0;

/** Persistent damage on a badge: its detail "2d6 fire" or "1d4 bleed, 3 poison" -> [{formula, type}]. */
export function persistentParts(effect) {
  const out = [];
  for (const part of String(effect.detail || '').split(/,|\bplus\b|\band\b/)) {
    const m = /^\s*(\d+d\d+(?:\s*[+-]\s*\d+)?|\d+)\s+([a-z-]+)/i.exec(part);
    if (m) out.push({ formula: m[1].replace(/\s+/g, ''), type: m[2].toLowerCase() });
  }
  return out;
}

/**
 * Answer a list of events. ctx: {events, now, encounter, tokens: {id: token}, states: {id: state},
 * prepare(id, token, state) -> prepared or null (no game data), roundSeconds, rng}.
 * Returns {tokens: {id: token} (changed ones), states: {id: state} (changed ones), lines}.
 */
export function turnRules(ctx) {
  const tokens = {}, states = {}, lines = [];
  const tok = (id) => tokens[id] || ctx.tokens[id];
  const st = (id) => states[id] || ctx.states[id] || {};
  const setTok = (id, t) => { tokens[id] = t; };
  const name = (id) => (ctx.names && ctx.names[id]) || (tok(id) || {}).name || id;
  const combatants = ctx.encounter && !ctx.encounter.ended ? ctx.encounter.combatants.map((c) => c.token) : [];
  const rng = ctx.rng || Math.random;

  const expire = (event) => {
    for (const id of Object.keys(ctx.tokens)) {
      const t = tok(id);
      const { kept, gone } = expireEffects(t.effects, { now: ctx.now, event, combatants, roundSeconds: ctx.roundSeconds });
      if (!gone.length) continue;
      setTok(id, { ...t, effects: kept });
      for (const e of gone) lines.push(`${name(id)}: ${e.name || e.id} ends${e.grants && e.grants.length ? ` (and ${e.grants.join(', ')})` : ''}`);
    }
  };

  for (const ev of ctx.events) {
    if (ev.type === 'turn-end') {
      const id = ev.token, t = tok(id);
      if (t && !t.dead) {
        // persistent damage, then the flat check to end it (each damage type on its own)
        const pd = (t.effects || []).find((e) => e.id === 'persistent');
        if (pd) {
          const parts = persistentParts(pd);
          const p = ctx.prepare(id, tok(id), st(id));
          if (parts.length && p) {
            const rolled = parts.map((x) => ({ ...x, roll: rollFormula(x.formula, rng) }));
            const hit = applyDamage(p, st(id), tok(id).effects || [], { parts: rolled.map((x) => ({ amount: x.roll.total, type: x.type })) });
            states[id] = hit.state;
            setTok(id, { ...tok(id), effects: hit.effects, ...(hit.dead ? { dead: true } : {}) });
            lines.push(`${name(id)}: persistent damage ${rolled.map((x) => `${x.roll.text} ${x.type}`).join(', ')}; ${hit.lines.join('; ')}`);
          } else if (parts.length) lines.push(`${name(id)}: persistent damage ${parts.map((x) => `${x.formula} ${x.type}`).join(', ')} (no game data: apply it by hand)`);
          if (parts.length) {
            const left = [];
            for (const x of parts) {
              const die = rollDie(20, rng), ok = die >= 15;
              lines.push(`${name(id)}: flat check to end ${x.formula} ${x.type} persistent damage: ${die} against DC 15, ${ok ? 'it ends' : 'it continues'}`);
              if (!ok) left.push(`${x.formula} ${x.type}`);
            }
            const fx = (tok(id).effects || []).filter((e) => e.id !== 'persistent');
            setTok(id, { ...tok(id), effects: left.length ? [...fx, { ...pd, detail: left.join(', ') }] : fx });
          }
        }
        // frightened goes down by 1 at the end of each of its turns (unless a ruling holds it)
        const fr = (tok(id).effects || []).find((e) => e.id === 'frightened');
        if (fr && !fr.noDecrease) {
          const nv = (fr.value || 1) - 1;
          const fx = (tok(id).effects || []).filter((e) => e !== fr);
          setTok(id, { ...tok(id), effects: nv > 0 ? [...fx, { ...fr, value: nv }] : fx });
          lines.push(`${name(id)}: frightened ${nv > 0 ? `goes down to ${nv}` : 'ends'}`);
        }
      }
    }
    if (ev.type === 'turn-start') {
      const id = ev.token, t = tok(id);
      if (t && !t.dead) {
        const p = ctx.prepare(id, t, st(id));
        if (p) {
          // a dying creature attempts its recovery check
          if (valueOf(t.effects, 'dying')) {
            const die = rollDie(20, rng), r = recoveryCheck(p, t.effects || [], die);
            setTok(id, { ...t, effects: r.effects, ...(r.dead ? { dead: true } : {}) });
            lines.push(`${name(id)}: recovery check ${die}: ${r.lines.join('; ')}`);
          }
          // fast healing and regeneration
          const heal = (p.fastHealing || []).reduce((n, f) => n + (f.value || 0), 0);
          if (heal && !tok(id).dead && !valueOf(tok(id).effects, 'dying') && p.hp.value < p.hp.max.value) {
            const h = applyHealing(p, st(id), tok(id).effects || [], heal);
            states[id] = h.state;
            setTok(id, { ...tok(id), effects: h.effects });
            const regen = (p.fastHealing || []).find((f) => f.kind === 'regeneration');
            lines.push(`${name(id)}: ${regen ? 'regeneration' : 'fast healing'} ${heal}; ${h.lines.join('; ')}${regen && regen.deactivatedBy.length ? ` (unless ${regen.deactivatedBy.join(' or ')} damage stopped it since its last turn)` : ''}`);
          }
          // temporary HP that renews at the start of each turn
          const renew = (p.tempHp || []).filter((x) => x.onTurnStart).reduce((n, x) => Math.max(n, x.value || 0), 0);
          if (renew) {
            const pp = ctx.prepare(id, tok(id), st(id)) || p;
            const r = setTempHp(pp, st(id), renew);
            states[id] = r.state;
            lines.push(`${name(id)}: ${r.lines.join('; ')}`);
          }
        }
      }
    }
    if (['turn-start', 'turn-end', 'round-end', 'encounter-end', 'time'].includes(ev.type)) expire(ev);
  }
  return { tokens, states, lines };
}
