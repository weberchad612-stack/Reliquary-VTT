// Token Quick-View: double-click a token (or select it and press Enter) for its stat block, live. The GM view
// opens any creature's full stat block; the player view opens their PCs' sheets and, for any other creature
// they can see, a public card (its name as they know it, size, traits, health band, the conditions they can
// see). Laid out like a Monster Core stat block, with the numbers as they are now: a number changed by a
// condition or effect is marked, and every number shows its breakdown on hover. Read-only.
// Pure: builds the window's HTML from a prepared creature (engine prepareActor), its data and its token.
// Docs: docs/best-practices/board.md (Token Quick-View).

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sgn = (v) => (v < 0 ? `−${-v}` : `+${v}`);
const cap = (s) => String(s || '').replace(/(^|[-\s])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/-/g, ' ');
const ACTIONS = { 1: '◆', 2: '◆◆', 3: '◆◆◆', reaction: '⟲', free: '◇' };

// ---- traits: the words in brackets and the chips, each with its rule on hover ----
/** A trait as Pathfinder writes it: "reach-10" -> "reach 10 feet", "deadly-d10" -> "deadly d10", "versatile-p" -> "versatile P". */
export function traitLabel(t) {
  const s = String(t);
  let m = /^(reach|thrown|volley|range|range-increment|splash|jousting-reach)-(\d+)$/.exec(s);
  if (m) return `${m[1].replace(/-/g, ' ')} ${m[2]} feet`;
  m = /^(.*)-(d\d+)$/.exec(s);
  if (m) return `${m[1].replace(/-/g, ' ')} ${m[2]}`;
  m = /^versatile-([a-z]+)$/.exec(s);
  if (m) return `versatile ${m[1].toUpperCase()}`;
  return s.replace(/-/g, ' ');
}
/** A trait's entry in the glossary ({slug: {name, text}}): the trait itself, or the trait without its number or die. */
export function traitEntry(t, glossary = {}) {
  const s = String(t);
  return glossary[s] || glossary[s.replace(/-(d\d+|\d+)$/, '')] || glossary[s.replace(/-[a-z]$/, '')] || null;
}
/**
 * What the board's rules do with a Strike's trait (shown under its description), or null when the trait is not a
 * Strike's. strike: {pc: a character's Strike (worked out from its build) or a creature's (printed)}.
 */
export function traitApplied(t, strike) {
  const base = String(t).replace(/-(d\d+|\d+|[a-z])$/, '');
  if (!strike) return null;
  if (base === 'agile') return 'Applied: the multiple attack penalty is −4 and −8.';
  if (!strike.pc) return 'The printed numbers count it; anything else it does is not automated: Claude applies it.';
  if (base === 'finesse') return 'Applied: Dexterity for the attack when it is higher than Strength.';
  if (base === 'thrown') return 'Applied: thrown at its range, with Strength added to damage.';
  if (base === 'propulsive') return 'Applied: half your Strength (if positive) added to damage.';
  if (base === 'unarmed') return 'Applied: your unarmed proficiency.';
  return 'Not automated: Claude applies it.';
}
function traitTip(t, glossary, strike) {
  const e = traitEntry(t, glossary), applied = traitApplied(t, strike);
  return [e ? `${e.name}: ${e.text}` : `${traitLabel(t)}: no description in the glossary.`, applied].filter(Boolean).join('\n\n');
}
const traitWord = (t, glossary, strike) => `<span class="qv-trait" tabindex="0" title="${esc(traitTip(t, glossary, strike))}">${esc(traitLabel(t))}</span>`;
const actionGlyph = (a) => (ACTIONS[a] ? `<span class="qv-act" title="${a === 'reaction' ? 'reaction' : a === 'free' ? 'free action' : `${a} action${a > 1 ? 's' : ''}`}">${ACTIONS[a]}</span>` : '');

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

const SIZE_SPACE = { tiny: 'less than a 5-foot square (several can share one)', small: 'a 5-foot square', medium: 'a 5-foot square', large: 'a 10-foot square (2 by 2 squares)', huge: 'a 15-foot square (3 by 3 squares)', gargantuan: 'a 20-foot square or more (4 by 4 squares)' };
const traitsRow = (rarity, size, traits, glossary = {}) => {
  const chip = (t, cls, tip) => `<span class="qv-tr${cls ? ` ${cls}` : ''}" tabindex="0" title="${esc(tip || traitTip(t, glossary))}">${esc(cap(traitLabel(t)))}</span>`;
  const chips = [...(rarity && rarity !== 'common' ? [chip(rarity, esc(rarity))] : []),
    ...(size ? [chip(size, 'size', `Size ${cap(size)}: takes up ${SIZE_SPACE[size] || 'its space'}.`)] : []),
    ...(traits || []).map((t) => chip(t))];
  return chips.length ? `<div class="qv-traits">${chips.join('')}</div>` : '';
};

const iwrLine = (iwr) => {
  const parts = [];
  if ((iwr.immunities || []).length) parts.push(`<b>Immunities</b> ${iwr.immunities.map((x) => esc(cap(typeof x === 'string' ? x : x.type) + (x.except ? ` (except ${x.except})` : ''))).join(', ')}`);
  if ((iwr.weaknesses || []).length) parts.push(`<b>Weaknesses</b> ${iwr.weaknesses.map((x) => esc(`${cap(x.type)} ${x.value}`)).join(', ')}`);
  if ((iwr.resistances || []).length) parts.push(`<b>Resistances</b> ${iwr.resistances.map((x) => esc(`${cap(x.type)} ${x.value}${x.except ? ` (except ${x.except})` : ''}`)).join(', ')}`);
  return parts.join('; ');
};

const hpLine = (p) => `<b>HP</b> <span class="qv-n${p.hp.value < p.hp.max.value ? ' down' : ''}" title="current of maximum">${p.hp.value}</span>/${p.hp.max.value}${p.hp.temp ? ` (+${p.hp.temp} temporary)` : ''}`;

function strikeLine(s, describe, glossary, pc) {
  const kind = s.ranged ? 'Ranged' : 'Melee';
  const maps = `<span class="qv-map">[${sgn(s.attack.value + s.map[1])}/${sgn(s.attack.value + s.map[2])}]</span>`;
  const words = (s.traits || []).map((t) => traitWord(t, glossary, { pc }));
  if (s.range && !(s.traits || []).some((t) => /^thrown-/.test(t))) words.push(`range ${s.range} feet`);
  const traits = words.length ? ` (${words.join(', ')})` : '';
  const crit = s.damage.criticalExtra ? `; critical also ${esc(s.damage.criticalExtra)}` : '';
  return `<p><b>${kind}</b> ${actionGlyph(1)} ${esc(s.name)} ${num(s.attack, describe, { printed: s.attack.parts.reduce((n, x) => n + x.value, 0) })} ${maps}${traits}, <b>Damage</b> ${esc(s.damage.formula)}${crit}${s.effects && s.effects.length ? ` plus ${esc(s.effects.join(', '))}` : ''}</p>`;
}

function abilityLine(a, glossary) {
  const traits = a.traits && a.traits.length ? ` (${a.traits.map((t) => traitWord(t, glossary)).join(', ')})` : '';
  const text = a.text ? ` ${esc(a.text).replace(/\n+/g, ' ')}` : '';
  return `<p><b>${esc(a.name)}</b> ${actionGlyph(a.actions)}${traits}${text}</p>`;
}

function spellcasting(entry) {
  const byRank = new Map();
  for (const s of entry.spells || []) { const r = s.rank ?? 0; if (!byRank.has(r)) byRank.set(r, []); byRank.get(r).push(s.name + (s.uses ? ` (×${s.uses})` : '')); }
  const ranks = [...byRank.entries()].sort((a, b) => b[0] - a[0]).map(([r, list]) => `<b>${r ? `${r}${['th', 'st', 'nd', 'rd'][r] || 'th'}` : 'Cantrips'}</b> ${esc(list.join(', '))}`).join('; ');
  const head = `${esc(entry.name)}${entry.dc ? ` DC ${entry.dc}` : ''}${entry.attack ? `, attack ${sgn(entry.attack)}` : ''}`;
  return `<p><b>${head}</b>${ranks ? `; ${ranks}` : ''}</p>`;
}

/** The window's title: the name this view may use, and what the creature is. */
export function quickViewTitle({ token, prepared, base, view, access, publicName }) {
  const shownName = view === 'gm' ? (token.name || publicName(token) || 'Creature') : (publicName(token) || token.name || 'Creature');
  if (access === 'public' || !prepared) return { name: shownName, kind: '' };
  const kind = prepared.kind === 'character' ? `Level ${prepared.level}` : `Creature ${prepared.level}`;
  return { name: shownName, kind, also: view === 'gm' && token.alias && !token.known ? `players see "${token.alias}"` : (view === 'gm' && base && base.name && base.name !== token.name ? base.name : '') };
}

/**
 * The window's body. o: {token, actor, prepared (or null), base (the stat block document, or null), view,
 * access ('full' | 'public'), conditions (the system's), describe (engine describeStatistic), publicName}.
 */
export function quickViewBody(o) {
  const { token, prepared: p, base, view, access, conditions = {}, describe } = o;
  const G = o.glossary || {};
  const out = [];
  // the public card: what anyone at the table can tell by looking
  if (access === 'public') {
    const traits = p ? p.traits : (base && base.traits) || [];
    out.push(traitsRow(null, p ? p.size : base && base.size, traits, G));
    out.push(`<p><b>Health</b> ${esc(p ? p.band : token.dead ? 'Dead' : 'Unknown')}</p>`);
    out.push(effectsLine(token, view, conditions));
    out.push('<p class="qv-muted">What the party can tell by looking. Recall Knowledge may tell you more: ask Claude.</p>');
    return out.join('');
  }
  if (!p) {
    out.push(effectsLine(token, view, conditions));
    out.push(`<p class="qv-muted">${esc(token.name || 'This token')} has no game data yet${view === 'gm' ? ' (Claude gives it some with tools/actor.mjs create)' : ''}.</p>`);
    return out.join('');
  }
  const sec = (rows) => { const r = rows.filter(Boolean); if (r.length) out.push(`<div class="qv-sec">${r.join('')}</div>`); };
  const S = (base && base.stats) || {};
  out.push(traitsRow(base ? base.rarity : null, p.size, p.traits, G));
  out.push(effectsLine(token, view, conditions));
  if (p.dying && p.dying.value) out.push(`<p class="qv-live"><b>Dying ${p.dying.value}</b> (dies at ${p.dying.max})${p.wounded ? `; wounded ${p.wounded}` : ''}</p>`);
  const isPc = p.kind === 'character';
  // top: perception, languages, skills, attributes, items
  const senses = (p.senses || []).map((s) => `${s.type}${s.acuity && s.acuity !== 'precise' ? ` (${s.acuity})` : ''}${s.range ? ` ${s.range} feet` : ''}`).join(', ');
  const skills = Object.entries(p.skills || {}).filter(([k, st]) => isPc ? st.parts.some((x) => /\((trained|expert|master|legendary)\)/.test(x.label)) : (S.skills || {})[k] !== undefined).map(([, st]) => `${esc(st.label)} ${num(st, describe)}`);
  for (const st of Object.values(p.lore || {})) skills.push(`${esc(st.label)} ${num(st, describe)}`);
  const attrs = ['str', 'dex', 'con', 'int', 'wis', 'cha'].map((a) => `<b>${cap(a)}</b> ${sgn(p.attributes[a] || 0)}`).join(', ');
  const languages = isPc ? (o.actor.languages || []) : (S.languages || []);
  const gear = isPc ? (o.actor.items || []).map((i) => i.name || (i.ref || '').split('/').pop().replace(/-/g, ' ')) : ((base && base.items) || []).filter((i) => i.kind === 'gear' || i.kind === 'item').map((i) => i.name + (i.quantity ? ` (${i.quantity})` : ''));
  sec([
    `<p><b>Perception</b> ${num(p.perception, describe)}${senses ? `; ${esc(senses)}` : ''}</p>`,
    languages.length ? `<p><b>Languages</b> ${esc(languages.map(cap).join(', '))}</p>` : '',
    skills.length ? `<p><b>Skills</b> ${skills.join(', ')}</p>` : '',
    `<p>${attrs}</p>`,
    gear.length ? `<p><b>Items</b> ${esc(gear.join(', '))}</p>` : '',
  ]);
  // defence
  const notes = S.notes || {};
  const saves = [['fortitude', 'Fort'], ['reflex', 'Ref'], ['will', 'Will']].map(([s, w]) => `<b>${w}</b> ${num(p.saves[s], describe)}`).join(', ');
  const iwr = iwrLine(p.iwr || {});
  const passive = (p.abilities || []).filter((a) => !a.actions || a.actions === 'reaction' || a.category === 'defensive');
  sec([
    `<p><b>AC</b> ${num(p.ac, describe, { bonus: false })}${notes.ac ? ` (${esc(notes.ac)})` : ''}; ${saves}${notes.saves ? `; ${esc(notes.saves)}` : ''}</p>`,
    `<p>${hpLine(p)}${notes.hp ? ` (${esc(notes.hp)})` : ''}${iwr ? `; ${iwr}` : ''}</p>`,
    p.shield ? `<p><b>Shield</b> ${esc(p.shield.name)}: Hardness ${p.shield.hardness}, HP ${p.shield.hp}/${p.shield.maxHp} (broken at ${p.shield.brokenAt})${p.shield.raised ? ', raised' : ''}</p>` : '',
    ...passive.map((a) => abilityLine(a, G)),
  ]);
  // offence
  const speeds = Object.values(p.speeds || {}).map((s) => `${s.label === 'Speed' ? '' : `${esc(s.label.replace(/ Speed$/, '').toLowerCase())} `}<span class="qv-n${s.value !== s.base ? (s.value > s.base ? ' up' : ' down') : ''}" title="${esc(describe(s))}">${s.value} feet</span>`).join(', ');
  const casting = ((base && base.items) || []).filter((i) => i.kind === 'spellcasting');
  const active = (p.abilities || []).filter((a) => a.actions && a.actions !== 'reaction' && a.category !== 'defensive');
  sec([
    `<p><b>Speed</b> ${speeds}</p>`,
    ...(p.strikes || []).map((s) => strikeLine(s, describe, G, isPc)),
    p.classDC ? `<p><b>Class DC</b> ${num(p.classDC, describe, { bonus: false })}</p>` : '',
    p.spell ? `<p><b>Spell attack</b> ${num(p.spell.attack, describe)}, <b>DC</b> ${num(p.spell.dc, describe, { bonus: false })}</p>` : '',
    ...casting.map(spellcasting),
    ...active.map((a) => abilityLine(a, G)),
  ]);
  if (isPc) {
    const res = Object.entries(p.resources || {}).map(([k, r]) => `${esc(cap(k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()))} ${typeof r === 'object' ? `${(o.state.resources || {})[k] ?? r.max}/${r.max}` : r}`);
    const feats = [...new Set([...(o.actor.feats || []).map((f) => f.name), ...(o.actor.features || []).filter((f) => typeof f === 'string').map(cap)])];
    sec([res.length ? `<p><b>Resources</b> ${res.join(', ')}</p>` : '', feats.length ? `<p><b>Feats and features</b> ${esc(feats.join(', '))}</p>` : '']);
  }
  if ((p.options || []).length) sec([`<p><b>Switches</b> ${p.options.map((x) => `${esc(x.label)} ${x.on ? 'on' : 'off'}`).join(', ')}</p>`]);
  if (base && base.text && !isPc) out.push(`<p class="qv-text">${esc(base.text).replace(/\n+/g, '<br>')}</p>`);
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
