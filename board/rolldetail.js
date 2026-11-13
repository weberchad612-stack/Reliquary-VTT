// The rolls behind a replay step, and who may see how much of them (the user's decisions, 2026-11-12). Pure and
// system-free: every label, result word and damage type comes from the tools (and so from the ruleset); this module
// only decides what each view shows. board/replayui.js draws the lines; tools/check.mjs, tools/dice.mjs and
// tools/actor.mjs make the entries; tools/replay.mjs collects them into step.rolls. Docs: docs/best-practices/board.md
// (Replay: roll details).
//
// Entries:
//   check    {type, token, who, label, dice: [d20...], kept, mod, parts: [{label, value}], total,
//             vs?: {label, value, token?}, result, degree}
//   damage   {type, token, who, label, formula, text ("1d8+4 = (8)+4 = 12"), rolled, crit?, total, damageType?}
//   applied  {type, token (the one hurt), who, amount, adjust: [text], taken}
//   roll     {type, token, who, label, text, total}   any other roll (a flat check)
//
// Who sees what: a PC's rolls are shown whole to everyone; another creature's only as results to players (the
// total, what it was against when that is a PC's defence, the result word; damage as the amount taken); the GM view
// shows everything. A defence or DC that is not a PC's shows as "?" to players.

const sign = (v) => (v < 0 ? `−${-v}` : `+${v}`);
const partText = (p) => `${sign(p.value)} ${p.label}`;

/** Whether a view sees a roll whole: the GM always; players a PC's. */
export function seesWhole(e, { gm = false, isPc = () => false } = {}) { return gm || !!(e && isPc(e.token)); }
/** What a roll was against, as a view may see it: " vs AC 17", or " vs AC ?" for a defence that is not a PC's. */
export function vsWords(vs, { gm = false, isPc = () => false } = {}) {
  if (!vs) return '';
  const show = gm || (vs.token && isPc(vs.token));
  return ` vs ${vs.label} ${show && Number.isFinite(vs.value) ? vs.value : '?'}`;
}

/** Display lines for a step's rolls: [{cls, text}]. o: {gm: boolean, isPc(tokenId) -> boolean}. */
export function rollLines(rolls, { gm = false, isPc = () => false } = {}) {
  const out = [];
  const full = (e) => seesWhole(e, { gm, isPc });
  const vsText = (vs) => vsWords(vs, { gm, isPc });
  (rolls || []).forEach((e, i) => {
    if (!e || !e.type) return;
    if (e.type === 'check') {
      const res = e.result ? ` · ${e.result}` : '';
      if (full(e)) {
        const parts = (e.parts || []).filter((p) => p && p.value).map(partText).join(', ');
        const dice = (e.dice || []).length > 1 ? `d20 ${e.dice.join(' and ')}, kept ${e.kept}` : `d20 ${e.kept ?? (e.dice || [])[0]}`;
        out.push({ cls: 'rl-check', text: `${e.label} ${sign(e.mod || 0)}${parts ? ` (${parts})` : ''} · ${dice} = ${e.total}${vsText(e.vs)}${res}` });
      } else out.push({ cls: 'rl-check', text: `${e.label}: ${e.total}${vsText(e.vs)}${res}` });
      return;
    }
    if (e.type === 'damage') {
      const type = e.damageType ? ` ${e.damageType}` : '';
      // the amount taken, when the next entry applies this damage: what players of a foe's roll see
      const applied = (rolls[i + 1] && rolls[i + 1].type === 'applied') ? rolls[i + 1] : null;
      if (full(e)) {
        out.push({ cls: 'rl-dmg', text: `${e.label || 'Damage'} ${e.text || e.total}${e.crit ? ` · doubled: ${e.total} (critical)` : ''}${type}` });
        if (applied) for (const a of applied.adjust || []) out.push({ cls: 'rl-adj', text: a });
      } else out.push({ cls: 'rl-dmg', text: `${e.label || 'Damage'}: ${applied ? applied.taken : e.total}${type}` });
      return;
    }
    if (e.type === 'applied') {
      // shown with its damage roll above; alone (damage given without a roll), as the amount taken
      if (rolls[i - 1] && rolls[i - 1].type === 'damage') return;
      out.push({ cls: 'rl-dmg', text: `${e.who || ''} takes ${e.taken}` });
      if (gm) for (const a of e.adjust || []) out.push({ cls: 'rl-adj', text: a });
      return;
    }
    if (e.type === 'roll') out.push({ cls: 'rl-roll', text: full(e) ? `${e.label} ${e.text || e.total}` : `${e.label}: ${e.total}` });
  });
  return out;
}
