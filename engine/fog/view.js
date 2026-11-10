// The party's view of a map: what is visible now, which tokens players may see, and how the fog is painted.
// Implements docs/design/maps.md section 8. Dependency-free; paintFog needs a Canvas 2D context.

import { tokenSight, tokenCanSee, viewpoints, footprintPoints, canSee } from '../sight/visibility.js';
import { ExploredMask } from './explored.js';

/** Token kinds that players always see (their own characters and markers). */
const ALWAYS_SHOWN = new Set(['pc', 'marker']);

/**
 * Work out what the party sees right now.
 * @param {Array<{id, kind, x, y, size?, hidden?, dead?}>} tokens  every token on the map
 * @param {Array} prepared  sight segments from prepare(segs, state, 'sight')
 * @param {object} opts  {rangeFt, feetPerCell}
 * @param {object} [opts.canLook]  (token) => boolean: which PCs are looking. Default: living, not
 *   GM-hidden PCs. The ruleset narrows this (unconscious, blinded) and sets per-token ranges.
 * @param {function} [opts.rangeOf]  (token) => feet: a token's own vision range; default opts.rangeFt
 * @param {Set<string>} [opts.alwaysShown]  token kinds shown whether or not anyone sees them; default PCs
 *   and markers (the players' own). Pass just markers for one creature's own view (docs/design/lighting.md
 *   section 11): then even PCs show only when it sees them.
 * @returns {{visible: Array, seen: Set<string>, lookers: Array<string>}}
 *   visible: visibility polygons (their union is the area visible now)
 *   seen: ids of tokens players may see
 */
export function partyView(tokens, prepared, opts) {
  if (opts.light) return litPartyView(tokens, prepared, opts);
  const canLook = opts.canLook || ((t) => t.kind === 'pc' && !t.hidden && !t.dead);
  const rangeOf = opts.rangeOf || (() => opts.rangeFt);
  const lookers = tokens.filter(canLook);
  const shown = opts.alwaysShown || ALWAYS_SHOWN, lookerIds = new Set(lookers.map((t) => t.id));
  const visible = [];
  for (const t of lookers) visible.push(...tokenSight(t, prepared, { ...opts, rangeFt: rangeOf(t) }));
  const seen = new Set();
  for (const t of tokens) {
    if (t.hidden) continue; // GM-hidden tokens are never shown to players
    if (shown.has(t.kind) || lookerIds.has(t.id)) { seen.add(t.id); continue; }
    if (lookers.some((l) => tokenCanSee(l, t, prepared, { ...opts, rangeFt: rangeOf(l) }))) seen.add(t.id);
  }
  return { visible, seen, lookers: lookers.map((t) => t.id) };
}

/**
 * The party's view with light (docs/design/lighting.md sections 1, 2 and 6). Same inputs as partyView plus:
 * @param {object} opts.light  a LightMap (engine/light/light.js)
 * @param {object} opts.rules  the ruleset's light rules: {perceive(level, senses, distFt), senseList(senses), sensesHaveRange(list)}
 * @param {function} [opts.sensesOf]  (token) => its senses as the ruleset names them; default token.senses
 * @param {{cols, rows}} opts.grid
 * @returns {{visible, seen, lookers, perceived: ExploredMask, dim: ExploredMask, mono: ExploredMask,
 *   concealedFrom: Object<string, string[]>}}
 *   visible: the lookers' line-of-sight polygons (as without light); perceived: what some PC actually
 *   perceives now (add it to the explored area); dim and mono: the parts of it in dim light and the parts
 *   seen only by darkvision (drawn darkened and in greyscale); seen: tokens players may see now;
 *   concealedFrom: for each seen token concealed from some PC who sees it, those PCs' ids.
 */
function litPartyView(tokens, prepared, opts) {
  const { light, rules, grid } = opts;
  const canLook = opts.canLook || ((t) => t.kind === 'pc' && !t.hidden && !t.dead);
  const rangeOf = opts.rangeOf || (() => opts.rangeFt);
  const sensesOf = opts.sensesOf || ((t) => t.senses || []);
  const fpc = opts.feetPerCell || 5;
  const lookers = tokens.filter(canLook);
  const shown = opts.alwaysShown || ALWAYS_SHOWN, lookerIds = new Set(lookers.map((t) => t.id));
  const visible = [];
  const perceived = new ExploredMask(grid), dim = new ExploredMask(grid), mono = new ExploredMask(grid);
  const res = perceived.res, w = perceived.w;
  const lv = light.levels;
  const info = new Map();
  for (const t of lookers) {
    const senses = rules.senseList(sensesOf(t));
    const ranged = rules.sensesHaveRange(senses);
    const table = [0, 1, 2].map((l) => rules.perceive(l, senses, 0));
    info.set(t.id, { senses, ranged });
    const polys = tokenSight(t, prepared, { ...opts, rangeFt: rangeOf(t) });
    visible.push(...polys);
    const sight = new ExploredMask(grid);
    sight.add(polys);
    const cx = t.x + (t.size || 1) / 2, cy = t.y + (t.size || 1) / 2;
    for (let k = 0; k < sight.bits.length; k++) {
      if (!sight.bits[k]) continue;
      const l = lv[k];
      let p = table[l];
      if (ranged) {
        const dx = ((k % w) + 0.5) / res - cx, dy = (Math.floor(k / w) + 0.5) / res - cy;
        p = rules.perceive(l, senses, Math.hypot(dx, dy) * fpc);
      }
      if (p.state === 'unseen') continue;
      perceived.bits[k] = 1;
      if (l === 1) dim.bits[k] = 1;
      if (p.mono) mono.bits[k] = 1;
    }
  }
  // Seen-only-by-darkvision means no PC sees it in colour: drop mono pixels where light is dim or bright.
  for (let k = 0; k < mono.bits.length; k++) if (mono.bits[k] && lv[k] > 0) mono.bits[k] = 0;

  const seen = new Set(), concealedFrom = {};
  for (const t of tokens) {
    if (t.hidden) continue;
    if (shown.has(t.kind) || lookerIds.has(t.id)) { seen.add(t.id); continue; }
    const targets = footprintPoints(t.x, t.y, t.size || 1);
    const from = [];
    let any = false;
    for (const l of lookers) {
      const { senses } = info.get(l.id);
      const range = { rangeFt: rangeOf(l), feetPerCell: fpc };
      const vps = viewpoints(l.x, l.y, l.size || 1, prepared, range);
      let best = 'unseen';
      for (const p of targets) {
        if (!vps.some((v) => canSee(v, p, prepared, range))) continue;
        const d = Math.hypot(p[0] - (l.x + (l.size || 1) / 2), p[1] - (l.y + (l.size || 1) / 2)) * fpc;
        const s = rules.perceive(light.at(p[0], p[1]), senses, d).state;
        if (s === 'observed') { best = s; break; }
        if (s === 'concealed') best = s;
      }
      if (best === 'unseen') continue;
      any = true;
      if (best === 'concealed') from.push(l.id);
    }
    if (any) { seen.add(t.id); if (from.length) concealedFrom[t.id] = from; }
  }
  return { visible, seen, lookers: lookers.map((t) => t.id), perceived, dim, mono, concealedFrom };
}

/**
 * Fog state of a point for players: 'visible', 'explored' or 'hidden'.
 * @param {[number, number]} p  point in cells
 * @param {Array} visible  polygons from partyView
 * @param {import('./explored.js').ExploredMask} mask
 * @param {function} pointInPolygon  from visibility.js (passed in to keep this module small)
 */
export function fogStateAt(p, visible, mask, pointInPolygon) {
  if (visible.some((poly) => pointInPolygon(p, poly))) return 'visible';
  return mask.at(p[0], p[1]) ? 'explored' : 'hidden';
}

/** Default look; the board passes its theme colours. */
export const FOG_STYLE = Object.freeze({
  colour: '#14110e',
  player: { hidden: 1, explored: 0.75 }, // opacity of the fog over each state: remembered areas are kept dark
  gm: { hidden: 0.35, explored: 0.15 },
  softenPx: 3, // blur on the explored edge, in canvas pixels, to hide its 1/8-cell steps
});

/**
 * Paint the fog layer onto a canvas sized like the map image.
 * Player view: unexplored is fully fogged, explored-but-not-visible is dimmed, visible is clear.
 * GM view: everything shows, with a light tint over what the party has not explored or cannot see now.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o
 * @param {{cell_px, origin_px, cols, rows}} o.grid
 * @param {Array} o.explored  explored rings (save.explored.polys)
 * @param {Array} o.visible   visibility polygons (partyView().visible)
 * @param {'player'|'gm'} [o.mode='player']
 * @param {number} o.width   canvas width in pixels
 * @param {number} o.height  canvas height in pixels
 */
export function paintFog(ctx, o) {
  const style = o.style || FOG_STYLE;
  const a = style[o.mode || 'player'];
  const { cell_px: cs, origin_px: [ox, oy] } = o.grid;
  const path = (rings) => {
    ctx.beginPath();
    for (const r of rings) {
      if (!r || r.length < 3) continue;
      ctx.moveTo(ox + r[0][0] * cs, oy + r[0][1] * cs);
      for (let i = 1; i < r.length; i++) ctx.lineTo(ox + r[i][0] * cs, oy + r[i][1] * cs);
      ctx.closePath();
    }
  };
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, o.width, o.height);
  ctx.globalAlpha = a.hidden;
  ctx.fillStyle = style.colour;
  ctx.fillRect(0, 0, o.width, o.height);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  // Explored: cut the fog down from `hidden` to `explored` opacity (holes use the even-odd rule).
  if (o.explored && o.explored.length && a.hidden > 0) {
    ctx.globalAlpha = 1 - a.explored / a.hidden;
    if (style.softenPx && 'filter' in ctx) ctx.filter = `blur(${style.softenPx}px)`;
    path(o.explored);
    ctx.fill('evenodd');
    if ('filter' in ctx) ctx.filter = 'none';
  }
  // Visible now: cut the fog away completely. Each polygon is filled on its own (union).
  ctx.globalAlpha = 1;
  for (const poly of o.visible || []) {
    path([poly]);
    ctx.fill('nonzero');
  }
  ctx.restore();
}
