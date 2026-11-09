// The party's view of a map: what is visible now, which tokens players may see, and how the fog is painted.
// Implements docs/design/maps.md section 8. Dependency-free; paintFog needs a Canvas 2D context.

import { tokenSight, tokenCanSee } from '../sight/visibility.js';

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
 * @returns {{visible: Array, seen: Set<string>, lookers: Array<string>}}
 *   visible: visibility polygons (their union is the area visible now)
 *   seen: ids of tokens players may see
 */
export function partyView(tokens, prepared, opts) {
  const canLook = opts.canLook || ((t) => t.kind === 'pc' && !t.hidden && !t.dead);
  const rangeOf = opts.rangeOf || (() => opts.rangeFt);
  const lookers = tokens.filter(canLook);
  const visible = [];
  for (const t of lookers) visible.push(...tokenSight(t, prepared, { ...opts, rangeFt: rangeOf(t) }));
  const seen = new Set();
  for (const t of tokens) {
    if (t.hidden) continue; // GM-hidden tokens are never shown to players
    if (ALWAYS_SHOWN.has(t.kind)) { seen.add(t.id); continue; }
    if (lookers.some((l) => tokenCanSee(l, t, prepared, { ...opts, rangeFt: rangeOf(l) }))) seen.add(t.id);
  }
  return { visible, seen, lookers: lookers.map((t) => t.id) };
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
  player: { hidden: 1, explored: 0.55 }, // opacity of the fog over each state
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
