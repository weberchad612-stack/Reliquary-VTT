// Pathfinder 2e (remaster) terrain and movement rules for the map engine. Paraphrased from the
// Player Core terrain rules (ORC licence): see docs/design/maps.md section 9a for the summary.
//
// - Difficult terrain: entering a square costs 5 ft more. Greater difficult terrain: 10 ft more.
//   The extra cost is the same on a diagonal; the 5-10-5 diagonal pattern still applies underneath.
// - Terrain does not stack: the worst area entered on a step counts.
// - A creature that ignores difficult terrain treats greater difficult terrain as difficult.
// - You cannot Step into difficult or greater difficult terrain.
// - Climbing and swimming need the Climb or Swim action (an Athletics check) unless the creature has a
//   climb or swim Speed; the board routes walking movement round them and lists the check.
// - Uneven ground and narrow surfaces call for Acrobatics to Balance; hazardous terrain deals damage.
//
// A mover describes the creature: {speeds?: {land, climb, swim, fly, burrow}, flying?: boolean,
//   ignoreDifficult?: true | {causes: string[]} | {natural: true}}.
// `ignoreDifficult` covers abilities such as a creature that skitters over rubble ({causes: ['rubble']})
// or one that ignores natural difficult terrain ({natural: true}).

export const DIAGONAL_COSTS = [1, 2];
export const FEET_PER_CELL = 5;

/** Extra squares of movement for each kind; kinds missing here cost nothing extra. */
const DIFFICULTY = { difficult: 1, greater_difficult: 2 };
/** Kinds that need another action than Stride, and the speed that lets a creature move normally. */
const SPECIAL_MOVE = { climb: { speed: 'climb', action: 'Climb' }, swim: { speed: 'swim', action: 'Swim' } };
/** Kinds that only matter to creatures on the ground. */
const GROUND = new Set(['difficult', 'greater_difficult', 'uneven', 'narrow', 'hazardous', 'climb', 'swim']);

function ignoresDifficulty(area, mover) {
  const ig = mover && mover.ignoreDifficult;
  if (!ig) return false;
  if (ig === true) return true;
  if (ig.natural && !area.magical) return true;
  if (ig.causes && area.cause && ig.causes.includes(area.cause)) return true;
  return false;
}

/**
 * Cost of entering the given areas on one step.
 * @returns {{extra: number, blocked: boolean, notes: string[]}}
 *   extra: additional squares of movement; blocked: walking (Stride) cannot enter, another action is
 *   needed; notes: checks and effects to tell the table about.
 */
export function cost(areas, mover = {}) {
  let level = 0, blocked = false;
  const notes = [];
  for (const a of areas) {
    // A flying creature passes over ordinary ground terrain; magical areas still affect it unless the GM rules otherwise.
    if (mover.flying && GROUND.has(a.kind) && !a.magical) continue;
    let d = DIFFICULTY[a.kind] || 0;
    if (d && ignoresDifficulty(a, mover)) d -= 1;
    level = Math.max(level, d);
    const special = SPECIAL_MOVE[a.kind];
    if (special && !(mover.speeds && mover.speeds[special.speed])) {
      blocked = true;
      notes.push(`${special.action}${a.dc ? ' DC ' + a.dc : ''}${a.label ? ' (' + a.label + ')' : ''}`);
    }
    if (a.kind === 'uneven' || a.kind === 'narrow') notes.push(`Balance (Acrobatics)${a.dc ? ' DC ' + a.dc : ''}${a.label ? ' (' + a.label + ')' : ''}`);
    if (a.kind === 'hazardous') notes.push(`Hazardous${a.damage ? ': ' + a.damage : ''}${a.label ? ' (' + a.label + ')' : ''}`);
  }
  return { extra: level, blocked, notes };
}

/** Can the creature Step (move 5 ft without triggering reactions) into these areas? Not into difficult terrain. */
export function canStepInto(areas, mover = {}) {
  return !areas.some((a) => !(mover.flying && !a.magical) && (DIFFICULTY[a.kind] || 0) - (ignoresDifficulty(a, mover) ? 1 : 0) > 0);
}

/** The rules object the engine's terrainEnterCost and routeTerrain expect. */
export const terrainRules = { cost, canStepInto };
