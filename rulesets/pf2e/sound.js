// Pathfinder 2E's sound rules: what counts as a boss for the music (the board switches to boss music while one is
// in a running encounter; the GM and Claude can override it). The board reaches these through system.sound
// (board/sound.js); a system without them never switches to boss music by itself.

const levelOf = (actor) => (actor && Number.isFinite(actor.level) ? actor.level : null);
const unique = (actor) => ((actor && actor.traits) || []).map((t) => String(t).toLowerCase()).includes('unique');

/**
 * A boss: a creature 2 or more levels above the party (GM Core's creature level against party level: a severe or
 * extreme threat on its own), or a unique creature (a named villain). Characters are never bosses.
 */
function isBoss(actor, partyLevel) {
  if (!actor || actor.kind === 'character') return false;
  if (unique(actor)) return true;
  const lv = levelOf(actor);
  return lv !== null && partyLevel !== null && partyLevel !== undefined && lv >= partyLevel + 2;
}

function bossWhy(actor, partyLevel) {
  if (unique(actor)) return `${actor.name || 'a creature'} is unique`;
  return `${actor.name || 'a creature'} is level ${levelOf(actor)}, the party ${partyLevel}`;
}

export const PF2E_SOUND = Object.freeze({ isBoss, levelOf, bossWhy });
