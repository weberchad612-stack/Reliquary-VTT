// Shared by tools/clock.mjs and tools/encounter.mjs: run the ruleset's turn rules for a list of events and turn
// what changed into records to write. Docs: docs/best-practices/game-data.md.

import { randomInt } from 'node:crypto';
import { seededRandom } from '../engine/rules/dice.js';
import { prepareAt, auraEffects } from './actor.mjs';
import { publicName } from '../board/names.js';
import { dicePath, diceRecord, sideOf } from '../board/dice.js';

/** A random source: seeded (repeatable) or from the operating system. */
export const randomSource = (seed) => (seed !== undefined && seed !== null && seed !== '' ? seededRandom(Number(seed)) : () => randomInt(0, 2 ** 32) / 2 ** 32);

/** Answer events with the ruleset's turn rules: {lines, writes, tokens, states} (writes: tokens/, actorstate/ and the dice rolled, dice/). */
export function runTurnRules(game, events, { now, encounter, rng }) {
  const T = game.sys.time;
  if (!T || !T.turnRules || !events.length) return { lines: [], writes: [], tokens: {}, states: {} };
  const names = Object.fromEntries(Object.entries(game.tokens).map(([id, t]) => [id, t.name || publicName(t) || id]));
  const r = T.turnRules({ events, now, encounter, tokens: game.tokens, states: game.states, names, roundSeconds: T.roundSeconds, rng,
    prepare: (id, token, state) => { try { return prepareAt(game, id, token, state); } catch { return null; } } });
  const writes = [];
  for (const [id, t] of Object.entries(r.tokens)) {
    const data = { effects: t.effects || [] };
    if (t.dead) data.dead = true;
    writes.push({ op: 'update', path: `tokens/${id}`, data });
    game.tokens[id] = { ...game.tokens[id], ...t };
  }
  for (const [id, s] of Object.entries(r.states)) {
    const data = Object.fromEntries(Object.entries(s).filter(([k, v]) => v !== undefined && v !== null && !(k === 'temp' && v === 0)));
    writes.push({ op: 'set', path: `actorstate/${id}`, data });
    game.states[id] = s;
  }
  // the dice the rules rolled (persistent damage, flat and recovery checks), for the Dice tab's statistics
  for (const d of r.dice || []) {
    const t = game.tokens[d.token] || {}, gm = !!t.hidden || !!((encounter && encounter.combatants) || []).find((c) => c.token === d.token && c.hidden);
    writes.push({ op: 'set', path: dicePath(), data: diceRecord({ who: publicName(t) || t.name || d.token, token: d.token, side: sideOf(t), kind: d.kind, dice: d.dice, by: 'claude', gm }) });
  }
  game.auras = null;
  // a creature starting its turn inside an aura: say so (saves and abilities with no automatic effect)
  for (const ev of events.filter((e) => e.type === 'turn-start')) {
    auraEffects(game, ev.token);
    for (const a of [...game.auras.saves, ...game.auras.inside].filter((x) => x.token === ev.token)) r.lines.push(`${names[ev.token]} starts its turn in ${names[a.from]}'s ${a.aura}${a.save ? ` (${a.save.type} save DC ${a.save.dc}: ${a.ref})` : ''}`);
  }
  return { ...r, writes };
}
