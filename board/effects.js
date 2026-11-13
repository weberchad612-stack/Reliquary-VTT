// Token effects: the badges on a token, and the states unconscious, dying and dead. Pure functions over the
// system's conditions (SYS.conditions, e.g. rulesets/pf2e/conditions.js); board/app.js draws them and
// tools/effect.mjs edits them. Docs: docs/design/board.md section 7 (effect badges).
//
// On a token: effects: [{id, value?, detail?, gm_only?, until?, source?}] for a system condition, or
// [{name, kind?, value?, detail?, gm_only?, until?, source?}] for a custom effect; dead: true.

/** Badges per column (Foundry's layout: columns of five from the token's top-left, then the next column). */
export const BADGES_PER_COLUMN = 5;
export const KIND_COLOURS = Object.freeze({ good: '#4cc38a', bad: '#ff5d5d', neutral: '#e3b341' });

/** The effects a view shows on a token: GM-only ones only in the GM view; none on a dead token. */
export function visibleEffects(token, view) {
  if (!token || token.dead) return [];
  return (token.effects || []).filter((e) => e && (view === 'gm' || !e.gm_only));
}

/** One badge: {key, icon, letter?, kind, value, label, text (hover), gm, down} from an effect. */
export function badgeOf(e, conditions = {}) {
  const c = e.id ? conditions[e.id] : null;
  if (c) {
    const label = c.label + (c.valued && e.value != null ? ` ${e.value}` : '') + (e.detail ? ` (${e.detail})` : '');
    return {
      key: e.id, icon: c.icon, kind: c.kind || 'neutral', value: c.valued ? e.value ?? null : null, label,
      text: [label + ': ' + c.rule, e.source && `From ${e.source}.`, e.until && `Until ${e.until}.`, e.gm_only && 'GM only.'].filter(Boolean).join(' '),
      gm: !!e.gm_only, down: c.state === 'down', blinds: !!c.blinds,
    };
  }
  const name = String(e.name || e.id || '?');
  const label = name + (e.value != null ? ` ${e.value}` : '') + (e.detail ? ` (${e.detail})` : '');
  const letter = (name.match(/[A-Za-z0-9]/) || ['•'])[0].toUpperCase();
  return {
    key: 'custom:' + name, icon: null, letter, kind: ['good', 'bad', 'neutral'].includes(e.kind) ? e.kind : 'neutral', value: e.value ?? null, label,
    text: [label, e.source && `From ${e.source}.`, e.until && `Until ${e.until}.`, e.gm_only && 'GM only.'].filter(Boolean).join(' '),
    gm: !!e.gm_only, down: false, blinds: false,
  };
}

/** The badges a view shows on a token, the token-state ones (dying, unconscious) first. */
export function badgesFor(token, view, conditions) {
  const all = visibleEffects(token, view).map((e) => badgeOf(e, conditions));
  return all.sort((a, b) => (b.down - a.down));
}

/** Where badge i goes: column and row, in columns of `per` from the top-left. */
export function badgeSlot(i, per = BADGES_PER_COLUMN) {
  return { col: Math.floor(i / per), row: i % per };
}

/**
 * How the token itself looks: 'dead' (faded, grey, a red ✕), 'down' (greyed: unconscious or dying, from the
 * system's conditions marked state 'down'), or null. GM-only effects count only in the GM view.
 */
export function tokenState(token, view, conditions = {}) {
  if (!token) return null;
  if (token.dead) return 'dead';
  return visibleEffects(token, view).some((e) => e.id && conditions[e.id] && conditions[e.id].state === 'down') ? 'down' : null;
}

/** True when the creature cannot see now (dead, or a condition marked blinds: blinded, unconscious, ...). */
export function cannotSee(token, conditions = {}) {
  if (!token) return true;
  if (token.dead) return true;
  return (token.effects || []).some((e) => e && e.id && conditions[e.id] && conditions[e.id].blinds);
}

// ---- editing (tools/effect.mjs; later the GM view) ----

/** Add an effect, or replace the one with the same condition id (or custom name). Returns the new list. */
export function withEffect(effects, e, conditions = {}) {
  const c = e.id ? conditions[e.id] : null;
  if (e.id && !c) throw new Error(`"${e.id}" is not a condition of this system; give a custom effect a name instead`);
  if (c && c.valued && !(Number.isInteger(e.value) && e.value >= 1)) throw new Error(`${c.label} needs a value of 1 or more`);
  if (c && !c.valued && e.value != null) throw new Error(`${c.label} takes no value`);
  if (c && c.max && e.value > c.max) throw new Error(`${c.label} goes no higher than ${c.max}`);
  if (!e.id && !String(e.name || '').trim()) throw new Error('a custom effect needs a name');
  const out = {};
  for (const k of ['id', 'name', 'kind', 'value', 'ref', 'level', 'duration', 'start', 'grants', 'noDecrease', 'detail', 'gm_only', 'until', 'source']) if (e[k] !== undefined && e[k] !== null && e[k] !== false && e[k] !== '') out[k] = e[k];
  const same = (x) => (out.id ? x.id === out.id : !x.id && x.name === out.name);
  const list = (effects || []).filter((x) => !same(x));
  return [...list, out];
}

/**
 * One click in the status palette (Foundry PF2E's way). dir +1 (click): a plain condition is toggled; a valued
 * one is added at 1 or raised by 1 (up to its max). dir -1 (right-click): a valued condition is lowered by 1
 * and removed at 0; a plain one is removed. Other fields of the effect (source, until) are kept.
 */
export function stepCondition(effects, id, dir, conditions = {}) {
  const c = conditions[id];
  if (!c) throw new Error(`"${id}" is not a condition of this system`);
  const list = effects || [], cur = list.find((x) => x.id === id);
  if (!c.valued) {
    if (dir > 0 && !cur) return [...list, { id }];
    return list.filter((x) => x.id !== id);
  }
  const v = (cur ? cur.value || 0 : 0) + (dir > 0 ? 1 : -1);
  if (v <= 0) return list.filter((x) => x.id !== id);
  const value = c.max ? Math.min(c.max, v) : v;
  return cur ? list.map((x) => (x.id === id ? { ...x, value } : x)) : [...list, { id, value }];
}

/** Lines for a token's effects and dead state (the GM's audit log): "frightened 2", "no longer prone", "dead". */
export function describeEffects(name, before = {}, after = {}, conditions = {}) {
  const out = [];
  if (!!before.dead !== !!after.dead) out.push(`${name} ${after.dead ? 'is dead' : 'is no longer dead'}`);
  const key = (e) => e.id || 'custom:' + e.name;
  const label = (e) => { const c = e.id && conditions[e.id]; return (c ? c.label.toLowerCase() : e.name) + (e.value != null ? ` ${e.value}` : ''); };
  const b = new Map((before.effects || []).map((e) => [key(e), e])), a = new Map((after.effects || []).map((e) => [key(e), e]));
  for (const [k, e] of a) {
    const o = b.get(k);
    if (!o) out.push(`${name} ${label(e)}${e.gm_only ? ' (GM only)' : ''}`);
    else if (o.value !== e.value) out.push(`${name} ${label(e)} (was ${o.value})`);
  }
  for (const [k, e] of b) if (!a.has(k)) out.push(`${name} no longer ${label({ ...e, value: undefined })}${e.gm_only ? ' (GM only)' : ''}`);
  return out;
}

/** Remove an effect by condition id or custom name. */
export const withoutEffect = (effects, key) => (effects || []).filter((x) => x.id !== key && x.name !== key);
