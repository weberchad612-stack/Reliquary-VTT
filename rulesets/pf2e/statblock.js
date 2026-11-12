// Pathfinder 2E stat block for Token Quick-View: a creature laid out like a Monster Core stat block, a PC as a
// short sheet, and the public card (what the party can tell by looking). Reached by the board through the system
// configuration (system.js, `statBlock`); the board's Quick-View (board/quickview.js) decides who may open what,
// writes the title's name and passes its helpers as `o.kit` ({esc, sgn, cap, num, effectsLine}), so this file
// imports nothing from the board. Docs: docs/best-practices/board.md (Token Quick-View).

import { traitLabel, traitEntry, traitApplied } from './traits.js';
import { featKeys } from './content.js';

const ACTIONS = { 1: '◆', 2: '◆◆', 3: '◆◆◆', reaction: '⟲', free: '◇' };
const SIZE_SPACE = { tiny: 'less than a 5-foot square (several can share one)', small: 'a 5-foot square', medium: 'a 5-foot square', large: 'a 10-foot square (2 by 2 squares)', huge: 'a 15-foot square (3 by 3 squares)', gargantuan: 'a 20-foot square or more (4 by 4 squares)' };

/** The helpers that need the board's kit: built once per call. */
function parts(k, glossary = {}) {
  const { esc, sgn, cap } = k;
  const traitTip = (t, strike) => {
    const e = traitEntry(t, glossary), applied = traitApplied(t, strike);
    return [e ? `${e.name}: ${e.text}` : `${traitLabel(t)}: no description in the glossary.`, applied].filter(Boolean).join('\n\n');
  };
  const traitWord = (t, strike) => `<span class="qv-trait" tabindex="0" title="${esc(traitTip(t, strike))}">${esc(traitLabel(t))}</span>`;
  const actionGlyph = (a) => (ACTIONS[a] ? `<span class="qv-act" title="${a === 'reaction' ? 'reaction' : a === 'free' ? 'free action' : `${a} action${a > 1 ? 's' : ''}`}">${ACTIONS[a]}</span>` : '');
  const traitsRow = (rarity, size, traits) => {
    const chip = (t, cls, tip) => `<span class="qv-tr${cls ? ` ${cls}` : ''}" tabindex="0" title="${esc(tip || traitTip(t))}">${esc(cap(traitLabel(t)))}</span>`;
    const chips = [...(rarity && rarity !== 'common' ? [chip(rarity, esc(rarity))] : []),
      ...(size ? [chip(size, 'size', `Size ${cap(size)}: takes up ${SIZE_SPACE[size] || 'its space'}.`)] : []),
      ...(traits || []).map((t) => chip(t))];
    return chips.length ? `<div class="qv-traits">${chips.join('')}</div>` : '';
  };
  const abilityLine = (a) => {
    const traits = a.traits && a.traits.length ? ` (${a.traits.map((t) => traitWord(t)).join(', ')})` : '';
    const text = a.text ? ` ${esc(a.text).replace(/\n+/g, ' ')}` : '';
    return `<p><b>${esc(a.name)}</b> ${actionGlyph(a.actions)}${traits}${text}</p>`;
  };
  const strikeLine = (s, describe, pc) => {
    const kind = s.ranged ? 'Ranged' : 'Melee';
    const maps = `<span class="qv-map">[${sgn(s.attack.value + s.map[1])}/${sgn(s.attack.value + s.map[2])}]</span>`;
    const words = (s.traits || []).map((t) => traitWord(t, { pc }));
    if (s.range && !(s.traits || []).some((t) => /^thrown-/.test(t))) words.push(`range ${s.range} feet`);
    const traits = words.length ? ` (${words.join(', ')})` : '';
    const crit = s.damage.criticalExtra ? `; critical also ${esc(s.damage.criticalExtra)}` : '';
    return `<p><b>${kind}</b> ${actionGlyph(1)} ${esc(s.name)} ${k.num(s.attack, describe, { printed: s.attack.parts.reduce((n, x) => n + x.value, 0) })} ${maps}${traits}, <b>Damage</b> ${esc(s.damage.formula)}${crit}${s.effects && s.effects.length ? ` plus ${esc(s.effects.join(', '))}` : ''}</p>`;
  };
  return { traitsRow, abilityLine, strikeLine };
}

function iwrLine(iwr, { esc, cap }) {
  const out = [];
  if ((iwr.immunities || []).length) out.push(`<b>Immunities</b> ${iwr.immunities.map((x) => esc(cap(typeof x === 'string' ? x : x.type) + (x.except ? ` (except ${x.except})` : ''))).join(', ')}`);
  if ((iwr.weaknesses || []).length) out.push(`<b>Weaknesses</b> ${iwr.weaknesses.map((x) => esc(`${cap(x.type)} ${x.value}`)).join(', ')}`);
  if ((iwr.resistances || []).length) out.push(`<b>Resistances</b> ${iwr.resistances.map((x) => esc(`${cap(x.type)} ${x.value}${x.except ? ` (except ${x.except})` : ''}`)).join(', ')}`);
  return out.join('; ');
}

const FEAT_KIND = { classfeature: 'Class feature', ancestryfeature: 'Ancestry feature', general: 'General feat', skill: 'Skill feat', class: 'Class feat', ancestry: 'Ancestry feat', archetype: 'Archetype feat', bonus: 'Bonus feat', pfsboon: 'Boon' };
const TIP_MAX = 1400;
/**
 * A character's feats and features, once each (a feature may also be listed as a feat), as hoverable names: the
 * description from the content (featKeys: the first document found), with its kind and level.
 */
function featWords(actor, content, { esc, cap }) {
  const seen = new Set(), out = [];
  for (const f of [...(actor.feats || []), ...(actor.features || [])]) {
    const keys = featKeys(f), slug = (keys[0] || '').split('/').pop() || (typeof f === 'string' ? f : f && f.name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const doc = keys.map((k) => content[k]).find(Boolean);
    const name = (doc && doc.name) || (typeof f === 'string' ? cap(f) : f.name);
    let tip = `${name}: no description in the content.`;
    if (doc) {
      const kind = [FEAT_KIND[doc.category] || 'Feat', doc.level].filter((x) => x != null).join(' ');
      const text = String(doc.text || '').length > TIP_MAX ? `${String(doc.text).slice(0, TIP_MAX).replace(/\s+\S*$/, '')} …` : String(doc.text || '');
      tip = `${name} (${kind}${(doc.traits || []).length ? `; ${doc.traits.join(', ')}` : ''})${text ? `\n\n${text}` : ''}`;
    }
    out.push(`<span class="qv-trait" tabindex="0" title="${esc(tip)}">${esc(name)}</span>`);
  }
  return out;
}

const hpLine = (p) => `<b>HP</b> <span class="qv-n${p.hp.value < p.hp.max.value ? ' down' : ''}" title="current of maximum">${p.hp.value}</span>/${p.hp.max.value}${p.hp.temp ? ` (+${p.hp.temp} temporary)` : ''}`;

function spellcasting(entry, { esc, sgn }) {
  const byRank = new Map();
  for (const s of entry.spells || []) { const r = s.rank ?? 0; if (!byRank.has(r)) byRank.set(r, []); byRank.get(r).push(s.name + (s.uses ? ` (×${s.uses})` : '')); }
  const ranks = [...byRank.entries()].sort((a, b) => b[0] - a[0]).map(([r, list]) => `<b>${r ? `${r}${['th', 'st', 'nd', 'rd'][r] || 'th'}` : 'Cantrips'}</b> ${esc(list.join(', '))}`).join('; ');
  const head = `${esc(entry.name)}${entry.dc ? ` DC ${entry.dc}` : ''}${entry.attack ? `, attack ${sgn(entry.attack)}` : ''}`;
  return `<p><b>${head}</b>${ranks ? `; ${ranks}` : ''}</p>`;
}

/** What the creature is, after its name in the title: "Level 3" for a character, "Creature 1" for the rest. */
function kind(prepared) {
  return prepared.kind === 'character' ? `Level ${prepared.level}` : `Creature ${prepared.level}`;
}

/** The public card: what anyone at the table can tell by looking. */
function card(o) {
  const k = o.kit, { token, prepared: p, base, view, conditions = {} } = o;
  const { traitsRow } = parts(k, o.glossary);
  const traits = p ? p.traits : (base && base.traits) || [];
  return [
    traitsRow(null, p ? p.size : base && base.size, traits),
    `<p><b>Health</b> ${k.esc(p ? p.band : token.dead ? 'Dead' : 'Unknown')}</p>`,
    k.effectsLine(token, view, conditions),
    '<p class="qv-muted">What the party can tell by looking. Recall Knowledge may tell you more: ask Claude.</p>',
  ].join('');
}

/** The full stat block (a creature) or sheet (a PC), live. */
function body(o) {
  const k = o.kit, { esc, sgn, cap, num } = k;
  const { token, prepared: p, base, view, conditions = {}, describe } = o;
  const { traitsRow, abilityLine, strikeLine } = parts(k, o.glossary);
  const out = [];
  const sec = (rows) => { const r = rows.filter(Boolean); if (r.length) out.push(`<div class="qv-sec">${r.join('')}</div>`); };
  const S = (base && base.stats) || {};
  out.push(traitsRow(base ? base.rarity : null, p.size, p.traits));
  out.push(k.effectsLine(token, view, conditions));
  if (p.dying && p.dying.value) out.push(`<p class="qv-live"><b>Dying ${p.dying.value}</b> (dies at ${p.dying.max})${p.wounded ? `; wounded ${p.wounded}` : ''}</p>`);
  const isPc = p.kind === 'character';
  // top: perception, languages, skills, attributes, items
  const senses = (p.senses || []).map((s) => `${s.type}${s.acuity && s.acuity !== 'precise' ? ` (${s.acuity})` : ''}${s.range ? ` ${s.range} feet` : ''}`).join(', ');
  const skills = Object.entries(p.skills || {}).filter(([key, st]) => isPc ? st.parts.some((x) => /\((trained|expert|master|legendary)\)/.test(x.label)) : (S.skills || {})[key] !== undefined).map(([, st]) => `${esc(st.label)} ${num(st, describe)}`);
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
  const iwr = iwrLine(p.iwr || {}, k);
  const passive = (p.abilities || []).filter((a) => !a.actions || a.actions === 'reaction' || a.category === 'defensive');
  sec([
    `<p><b>AC</b> ${num(p.ac, describe, { bonus: false })}${notes.ac ? ` (${esc(notes.ac)})` : ''}; ${saves}${notes.saves ? `; ${esc(notes.saves)}` : ''}</p>`,
    `<p>${hpLine(p)}${notes.hp ? ` (${esc(notes.hp)})` : ''}${iwr ? `; ${iwr}` : ''}</p>`,
    p.shield ? `<p><b>Shield</b> ${esc(p.shield.name)}: Hardness ${p.shield.hardness}, HP ${p.shield.hp}/${p.shield.maxHp} (broken at ${p.shield.brokenAt})${p.shield.raised ? ', raised' : ''}</p>` : '',
    ...passive.map(abilityLine),
  ]);
  // offence
  const speeds = Object.values(p.speeds || {}).map((s) => `${s.label === 'Speed' ? '' : `${esc(s.label.replace(/ Speed$/, '').toLowerCase())} `}<span class="qv-n${s.value !== s.base ? (s.value > s.base ? ' up' : ' down') : ''}" title="${esc(describe(s))}">${s.value} feet</span>`).join(', ');
  const casting = ((base && base.items) || []).filter((i) => i.kind === 'spellcasting');
  const active = (p.abilities || []).filter((a) => a.actions && a.actions !== 'reaction' && a.category !== 'defensive');
  sec([
    `<p><b>Speed</b> ${speeds}</p>`,
    ...(p.strikes || []).map((s) => strikeLine(s, describe, isPc)),
    p.classDC ? `<p><b>Class DC</b> ${num(p.classDC, describe, { bonus: false })}</p>` : '',
    p.spell ? `<p><b>Spell attack</b> ${num(p.spell.attack, describe)}, <b>DC</b> ${num(p.spell.dc, describe, { bonus: false })}</p>` : '',
    ...casting.map((c) => spellcasting(c, k)),
    ...active.map(abilityLine),
  ]);
  if (isPc) {
    const res = Object.entries(p.resources || {}).map(([key, r]) => `${esc(cap(key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()))} ${typeof r === 'object' ? `${((o.state || {}).resources || {})[key] ?? r.max}/${r.max}` : r}`);
    const feats = featWords(o.actor, o.content || {}, k);
    sec([res.length ? `<p><b>Resources</b> ${res.join(', ')}</p>` : '', feats.length ? `<p><b>Feats and features</b> ${feats.join(', ')}</p>` : '']);
  }
  if ((p.options || []).length) sec([`<p><b>Switches</b> ${p.options.map((x) => `${esc(x.label)} ${x.on ? 'on' : 'off'}`).join(', ')}</p>`]);
  if (base && base.text && !isPc) out.push(`<p class="qv-text">${esc(base.text).replace(/\n+/g, '<br>')}</p>`);
  return out.join('');
}

export const PF2E_STAT_BLOCK = Object.freeze({ kind, card, body });
