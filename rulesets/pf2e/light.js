// Pathfinder 2e (remaster) light, vision and light sources for the map engine. Paraphrased from the Player
// Core's perception rules and equipment (ORC licence); see docs/design/lighting.md.
//
// - Bright light: creatures and objects are observed.
// - Dim light: concealed, unless the observer has low-light vision, darkvision or greater darkvision.
// - Darkness: unseen (hidden or undetected: the GM decides which), unless the observer has darkvision or
//   greater darkvision; darkvision sees in black and white, so such areas are drawn in greyscale.
// - Darkvision has no range in PF2E; a sense may still carry one (other systems, special senses).
//
// Senses: a list of names or {type, range} objects: 'low-light', 'darkvision', 'greater-darkvision'.
// Normal vision needs no entry. Light sources: {preset, rank?} plus any overrides of bright / dim (feet).

import { DARK, DIM, BRIGHT } from '../../engine/light/light.js';

/**
 * Light presets: `bright` is the radius of bright light, `dim` how much further dim light reaches (feet);
 * `colour` is the natural colour the board tints it (drawing only): firelight warm orange, lanterns a soft
 * yellow, magical light near-white.
 * The bull's-eye lantern's light is a cone, which carried lights cannot be yet: it acts as a hooded
 * lantern until they can (docs/design/lighting.md section 5).
 */
export const LIGHT_PRESETS = Object.freeze({
  torch: { label: 'Torch', bright: 20, dim: 20, colour: '#ff9a3c' },
  'everburning-torch': { label: 'Everburning torch', bright: 20, dim: 20, colour: '#ff9a3c' },
  sunrod: { label: 'Sunrod', bright: 20, dim: 20, colour: '#fff3d6' },
  'hooded-lantern': { label: 'Hooded lantern', bright: 30, dim: 30, colour: '#ffd27a' },
  'bullseye-lantern': { label: "Bull's-eye lantern (as a hooded lantern)", bright: 30, dim: 30, colour: '#ffd27a' },
  light: { label: 'Light (cantrip)', bright: 20, dim: 20, colour: '#eef2ff', heightened: { 4: { bright: 60, dim: 60 } } },
});

/**
 * Radii, colour and intensity for a light: its preset (heightened to `rank` where the preset says so),
 * then any overrides on the light itself. Colour 'none' makes a preset light uncoloured.
 */
export function lightSpec(light) {
  const base = light.preset ? LIGHT_PRESETS[light.preset] : null;
  if (light.preset && !base) throw new Error(`unknown light preset "${light.preset}"`);
  let bright = base ? base.bright : 0, dim = base ? base.dim : 0;
  if (base && base.heightened && light.rank) {
    for (const r of Object.keys(base.heightened).map(Number).sort((a, b) => a - b)) {
      if (light.rank >= r) ({ bright, dim } = base.heightened[r]);
    }
  }
  if (light.bright !== undefined) bright = light.bright;
  if (light.dim !== undefined) dim = light.dim;
  const colour = light.colour !== undefined ? light.colour : base ? base.colour : undefined;
  const intensity = light.intensity !== undefined ? light.intensity : base ? base.intensity : undefined;
  return { bright, dim, colour, intensity };
}

const VISION = new Set(['low-light', 'darkvision', 'greater-darkvision']);

/** Normalise a creature's senses to [{type, range}]. */
export function senseList(senses = []) {
  return senses.map((s) => (typeof s === 'string' ? { type: s } : s)).filter((s) => VISION.has(s.type));
}

const has = (list, types, distFt) => list.some((s) => types.includes(s.type) && (s.range === undefined || distFt <= s.range));

/**
 * What an observer with these senses makes of a point at this light level.
 * @param {number} level  DARK, DIM or BRIGHT
 * @param {Array} senses  senseList() output
 * @param {number} [distFt=0]  distance to the point, for senses with a range
 * @returns {{state: 'observed'|'concealed'|'unseen', mono: boolean}}  mono: seen only in black and white
 */
export function perceive(level, senses, distFt = 0) {
  if (level >= BRIGHT) return { state: 'observed', mono: false };
  const dark = has(senses, ['darkvision', 'greater-darkvision'], distFt);
  if (level === DIM) return { state: dark || has(senses, ['low-light'], distFt) ? 'observed' : 'concealed', mono: false };
  return dark ? { state: 'observed', mono: true } : { state: 'unseen', mono: false };
}

/** True when any sense has a range (perception then depends on distance, not only on light). */
export const sensesHaveRange = (senses) => senses.some((s) => s.range !== undefined);

/** The rules object the engine's light-aware party view expects. */
export const lightRules = { perceive, senseList, lightSpec, sensesHaveRange, LEVELS: { DARK, DIM, BRIGHT } };
