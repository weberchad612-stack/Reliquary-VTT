// Light animations, first set: torch, flicker, pulse, ghostly, chroma. Drawing only: an animation never
// changes a light's radii or the rules (docs/design/lighting.md section 14; later sets in
// future/light-animations.md). Dependency-free; runs in the browser and in Node.
//
// Each animated light gets, for any moment, a brightness factor around 1 (how much brighter or darker it
// looks than normal) and a hue shift in degrees (chroma only). The board draws those on a layer of its
// own every frame; nothing else is recomputed. Each light's motion is seeded from its id, so two torches
// side by side never flicker in step, and the same light moves the same way on every screen.

/** Animation types of the first set, with what they look like. */
export const ANIMATION_TYPES = Object.freeze({
  none: 'Steady',
  torch: 'Torch: an uneven flutter over a slow sway',
  flicker: 'Flicker: quicker and more broken, a guttering flame',
  pulse: 'Pulse: a smooth, steady rise and fall',
  ghostly: 'Ghostly: a slow waver with now and then a deep fade',
  chroma: 'Chroma: the colour cycles through the hues',
});

/** Settings with their defaults: speed and intensity 1-10, reverse on or off. */
export const ANIMATION_DEFAULTS = Object.freeze({ type: 'none', speed: 5, intensity: 5, reverse: false });

/** The largest brightness swing (intensity 10), as a fraction of normal brightness. */
export const MAX_SWING = 0.3;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** A light's animation settings filled out with the defaults; null when it does not animate. */
export function animationOf(a) {
  if (!a || !a.type || a.type === 'none' || !ANIMATION_TYPES[a.type]) return null;
  return {
    type: a.type,
    speed: clamp(Math.round(a.speed ?? ANIMATION_DEFAULTS.speed), 1, 10),
    intensity: clamp(Math.round(a.intensity ?? ANIMATION_DEFAULTS.intensity), 1, 10),
    reverse: !!a.reverse,
  };
}

/** A whole-number seed from a light's id. */
export function seedOf(id) {
  let h = 2166136261;
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Repeatable pseudo-random value in -1..1 for an integer step of a seeded sequence. */
function rand(seed, i) {
  let h = Math.imul(seed ^ Math.imul(i, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Smooth noise in -1..1: random values at whole steps, eased between them. */
export function noise(seed, x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return rand(seed, i) * (1 - u) + rand(seed, i + 1) * u;
}

/**
 * How an animated light looks at a moment.
 * @param {object} a  animationOf() output (or raw settings)
 * @param {string} id  the light's id (seeds its motion)
 * @param {number} t  time in seconds
 * @returns {{brightness: number, hue: number}}  brightness: a factor around 1 (within 1 +- MAX_SWING at
 *   intensity 10); hue: degrees to turn the light's colour (chroma; 0 otherwise)
 */
export function animationAt(a, id, t) {
  const anim = a && a.speed && a.intensity !== undefined && a.reverse !== undefined ? a : animationOf(a);
  if (!anim) return { brightness: 1, hue: 0 };
  const s = seedOf(id), k = anim.speed / 5;   // speed 5 is the natural pace
  const amp = (anim.intensity / 10) * MAX_SWING;
  let v = 0, hue = 0;
  switch (anim.type) {
    case 'torch':   // a quick flutter over a slow sway
      v = 0.65 * noise(s, t * 6 * k) + 0.35 * noise(s + 1, t * 1.2 * k);
      break;
    case 'flicker': {   // faster and broken: sudden short dips
      const dip = Math.max(0, noise(s + 2, t * 3 * k) - 0.55) / 0.45;
      v = 0.6 * noise(s, t * 11 * k) - 0.9 * dip;
      break;
    }
    case 'pulse':   // one smooth breath every 4 s at speed 5
      v = Math.sin(2 * Math.PI * t * 0.25 * k + (s % 628) / 100);
      break;
    case 'ghostly': {   // a slow waver, and now and then a deep fade
      const fade = Math.max(0, -noise(s + 3, t * 0.35 * k) - 0.45) / 0.55;
      v = 0.5 * noise(s, t * 0.8 * k) - 1.4 * fade;
      break;
    }
    case 'chroma':   // a full turn of the hues every 20 s at speed 5
      hue = ((anim.reverse ? -1 : 1) * 360 * t * 0.05 * k) % 360;
      if (hue < 0) hue += 360;
      break;
    default:
      break;
  }
  return { brightness: 1 + amp * clamp(v, -1.4, 1), hue };
}
