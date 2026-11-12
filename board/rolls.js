// Rolls on the board: the chat message a roll leaves (a roll card, board/chat.js), shared by the board and Claude's
// tools so both write the same thing. Pure. Docs: docs/design/board.md (the encounter tracker: the roll card).

import { chatMessage } from './chat.js';

/**
 * A roll's chat message. o: {by ('claude' | 'gm' | 'player'), token, name (as players know it), check
 * ('initiative'), stat ({slug, label}), roll ({dice, kept, mode, sides}), mod, total, parts ([{label, type, value}]),
 * notes ([{text, from}]), at, gm (the GM's only: a creature hidden from the players or out of their sight)}.
 */
export function rollRecord(o) {
  const r = o.roll || {};
  return chatMessage({
    kind: 'roll', by: o.by || 'claude', at: o.at, token: o.token, name: o.name, check: o.check || 'check',
    stat: o.stat, dice: r.dice || [], kept: r.kept, mode: r.mode || 'normal', sides: r.sides || 20,
    mod: o.mod ?? 0, total: o.total, parts: o.parts || [], notes: o.notes || [], gm: !!o.gm,
  });
}
