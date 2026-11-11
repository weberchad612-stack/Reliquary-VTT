// The game systems the board knows, by ruleset id (a campaign's `ruleset`). Each entry is that system's
// configuration (rulesets/<id>/system.js). Add a system here when its pack is added.

import { PF2E_SYSTEM } from './pf2e/system.js';

export const SYSTEMS = Object.freeze({ pf2e: PF2E_SYSTEM });

/** A system's configuration by ruleset id, or null if the board does not have it. */
export function systemConfig(id) {
  return SYSTEMS[id] || null;
}

/**
 * The distance between two creatures' spaces ({x, y, size}, in squares) by the system's measurement, in its
 * unit. `spaceDistance` is the engine's nearest-square count (engine/measure), passed in so this file
 * stays free of the engine.
 */
export function creatureDistance(system, a, b, spaceDistance) {
  const m = system.measurement;
  return spaceDistance(a, b, m.diagonalCosts) * m.squareFeet;
}
