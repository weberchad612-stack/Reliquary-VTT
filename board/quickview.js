// Token Quick-View: double-click a token (or select it and press Enter) for its stat block, live. The GM view
// opens any creature's full stat block; the player view opens their PCs' sheets and, for any other creature
// they can see, a public card (its name as they know it, size, traits, health band, the conditions they can
// see). The layout is the game system's (its configuration's `statBlock`: kind, card and body; Pathfinder's is
// rulesets/pf2e/statblock.js), with the numbers as they are now: a number changed by a condition or effect is
// marked, and every number shows its breakdown on hover. A system without a layout gets a plain card. This file
// knows no game system: it decides who may open what, writes the name and the parts every system shares, and
// passes the system its helpers (QV_KIT). Read-only.
// Pure: builds the window's HTML from a prepared creature (engine prepareActor), its data and its token.
// Docs: docs/best-practices/board.md (Token Quick-View).

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sgn = (v) => (v < 0 ? `−${-v}` : `+${v}`);
const cap = (s) => String(s || '').replace(/(^|[-\s])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/-/g, ' ');
/**
 * Who may open what: the GM view any token; the player view its PCs (the sheet) and other creatures it can
 * see (the public card). Returns 'full', 'public' or null.
 */
export function quickViewAccess(token, view, seen = true) {
  if (!token) return null;
  if (view === 'gm') return 'full';
  if (token.kind === 'pc') return 'full';
  return seen ? 'public' : null;
}

/** A statistic's number, marked when conditions or effects changed it, with its breakdown on hover. */
function num(st, describe, { bonus = true, printed } = {}) {
  if (!st) return '—';
  const base = printed ?? st.base, diff = st.value - base;
  const cls = diff > 0 ? ' up' : diff < 0 ? ' down' : '';
  const text = bonus ? sgn(st.value) : String(st.value);
  const title = `${describe(st)}${diff ? ` (printed ${bonus ? sgn(base) : base})` : ''}`;
  return `<span class="qv-n${cls}" title="${esc(title)}">${text}</span>`;
}

/** The conditions and effects on the token that this view may see, in words. */
function effectsLine(token, view, conditions) {
  const fx = (token.effects || []).filter((e) => e && (view === 'gm' || !e.gm_only));
  const words = fx.map((e) => {
    const label = e.id ? ((conditions[e.id] || {}).label || cap(e.id)) : e.name;
    return `${esc(label)}${e.value ? ` ${e.value}` : ''}${e.detail ? ` (${esc(e.detail)})` : ''}`;
  });
  if (token.dead) words.unshift('dead');
  return words.length ? `<p class="qv-live"><b>Now</b> ${words.join(', ')}</p>` : '';
}

/** The helpers a system's stat block uses (o.kit): escaping, signs, capitals, a live number, the effects line. */
export const QV_KIT = Object.freeze({ esc, sgn, cap, num, effectsLine });

/** The words of a creature's traits, plainly: for a system with no layout of its own. */
const plainTraits = (traits) => ((traits || []).length ? `<p><b>Traits</b> ${esc(traits.map((t) => String(t).replace(/-/g, ' ')).join(', '))}</p>` : '');

/** The window's title: the name this view may use, and what the creature is (the system's words). */
export function quickViewTitle({ token, prepared, base, view, access, publicName, system }) {
  const shownName = view === 'gm' ? (token.name || publicName(token) || 'Creature') : (publicName(token) || token.name || 'Creature');
  if (access === 'public' || !prepared) return { name: shownName, kind: '' };
  const L = system && system.statBlock;
  const kind = L && L.kind ? L.kind(prepared) : (prepared.level != null ? `Level ${prepared.level}` : '');
  return { name: shownName, kind, also: view === 'gm' && token.alias && !token.known ? `players see "${token.alias}"` : (view === 'gm' && base && base.name && base.name !== token.name ? base.name : '') };
}

/**
 * The window's body. o: {token, actor, state, prepared (or null), base (the stat block document, or null), view,
 * access ('full' | 'public'), conditions (the system's), describe (engine describeStatistic), publicName,
 * system (the campaign's system configuration: its statBlock lays the creature out), glossary (the system's
 * trait glossary entries)}.
 */
export function quickViewBody(o) {
  const { token, prepared: p, base, view, access, conditions = {} } = o;
  const L = o.system && o.system.statBlock;
  const so = { ...o, kit: QV_KIT, glossary: o.glossary || {} };
  const out = [];
  // the public card: what anyone at the table can tell by looking
  if (access === 'public') {
    if (L && L.card) return L.card(so);
    out.push(plainTraits(p ? p.traits : base && base.traits));
    if (p && p.band) out.push(`<p><b>Health</b> ${esc(p.band)}</p>`);
    out.push(effectsLine(token, view, conditions));
    return out.join('');
  }
  if (!p) {
    out.push(effectsLine(token, view, conditions));
    out.push(`<p class="qv-muted">${esc(token.name || 'This token')} has no game data yet${view === 'gm' ? ' (Claude gives it some with tools/actor.mjs create)' : ''}.</p>`);
    return out.join('');
  }
  if (L && L.body) out.push(L.body(so));
  else {
    out.push(plainTraits(p.traits), effectsLine(token, view, conditions));
    if (p.hp && p.hp.max) out.push(`<p><b>HP</b> ${p.hp.value}/${p.hp.max.value ?? p.hp.max}</p>`);
    out.push('<p class="qv-muted">This game system has no stat block layout yet (its configuration\'s statBlock).</p>');
  }
  if (view === 'gm' && (p.unsupported || []).length) out.push(`<p class="qv-muted" title="${esc(p.unsupported.join('\n'))}">${p.unsupported.length} imported rule(s) are not automated: apply them by hand (hover for the list).</p>`);
  if (view === 'gm' && (p.problems || []).length) out.push(`<p class="qv-warn">${p.problems.map(esc).join('<br>')}</p>`);
  if (base && base.source && base.source.title) out.push(`<p class="qv-src">${esc(base.source.title)}${base.source.license ? ` · ${esc(base.source.license)}` : ''}</p>`);
  return out.join('');
}

/** The content keys a creature's Quick-View needs: its stat block, its items, its token's content effects. */
export function quickViewKeys(actor, token) {
  const keys = new Set();
  if (actor && actor.base) keys.add(actor.base);
  for (const it of (actor && actor.items) || []) if (it && it.ref) keys.add(it.ref);
  for (const e of (token && token.effects) || []) if (e && e.ref) keys.add(e.ref);
  return [...keys];
}
