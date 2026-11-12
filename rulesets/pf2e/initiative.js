// Pathfinder 2E initiative for the board's roll dialog and the tools: which statistics a creature may roll
// (Perception, or a skill such as Stealth when Avoiding Notice), that statistic with the modifiers and notes keyed
// to initiative (Incredible Initiative, Battle Cry), the types its parts and modifiers have, and the types a
// reader may add. Reached through the system configuration (system.js, `initiative`). Docs:
// docs/design/board.md (the encounter tracker).

import { makeStatistic, modifiersFor } from '../../engine/rules/rules.js';
import { ATTRIBUTE_NAMES, BONUS_TYPES, stacks } from './rules.js';

const ATTR_LABELS = new Set(Object.values(ATTRIBUTE_NAMES));
/** The type of a statistic's part: attribute, proficiency or base (a stat block's printed number). */
function partType(label) {
  const l = String(label || '');
  if (ATTR_LABELS.has(l.replace(/ \(.*$/, ''))) return 'attribute';
  if (/proficiency/.test(l)) return 'proficiency';
  return 'base';
}

/** The statistics a creature may roll initiative with: Perception first, then its skills and lores. [{slug, label}] */
function statistics(p) {
  if (!p) return [];
  const out = p.perception ? [{ slug: 'perception', label: 'Perception' }] : [];
  for (const [slug, st] of Object.entries(p.skills || {})) out.push({ slug, label: st.label });
  for (const [slug, st] of Object.entries(p.lore || {})) out.push({ slug: `lore:${slug}`, label: st.label });
  return out;
}

const baseOf = (p, slug) => (slug === 'perception' ? p.perception : slug.startsWith('lore:') ? (p.lore || {})[slug.slice(5)] : (p.skills || {})[slug]);

/** The initiative statistic using `slug` (default Perception), with initiative's own modifiers; null if it has none. */
function statistic(p, slug = 'perception') {
  const s = p && baseOf(p, slug);
  if (!s) return null;
  const mods = [...(s.modifiers || []).map(({ applied: _a, reason: _r, ...m }) => m), ...modifiersFor(p.rollModifiers || [], ['initiative'])];
  return makeStatistic({ slug: 'initiative', label: `Initiative: ${s.label}`, base: s.base, parts: (s.parts || []).map((x) => ({ ...x, type: x.type || partType(x.label) })),
    modifiers: mods, tags: new Set(p.tags || []), facts: p.facts || {}, stacks });
}

/** The selectors a roll's notes answer to: initiative, and the statistic used. */
const noteSelectors = (slug = 'perception') => ['initiative', slug.startsWith('lore:') ? 'lore' : slug];

export const PF2E_INITIATIVE = Object.freeze({
  statistics, statistic, noteSelectors, stacks,
  addTypes: BONUS_TYPES,                                     // what a reader may add in the roll dialog
  die: 20,
});
