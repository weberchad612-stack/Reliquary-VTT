import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExploredMask, mergeExplored, displayOutlines, RES, STRAIGHTEN_PX } from '../engine/fog/explored.js';
import { partyView, fogStateAt, paintFog, FOG_STYLE } from '../engine/fog/view.js';
import { prepare, pointInPolygon, visPolygon } from '../engine/sight/visibility.js';
import { onSnap } from '../engine/walls/presets.js';
import { loadMap } from '../tools/sight.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRID = { cols: 10, rows: 10 };
const sq = (x, y, w, h = w) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const OPTS = { rangeFt: 200, feetPerCell: 5 };

/** Round-trip: mask -> outlines -> mask must give identical bits. */
function roundTrips(m, grid = GRID) {
  const back = ExploredMask.fromExplored({ polys: m.toPolys() }, grid);
  return back.bits.every((b, i) => b === m.bits[i]);
}

test('a filled square covers exactly its pixels', () => {
  const m = new ExploredMask(GRID);
  m.add([sq(2, 3, 2, 1)]);
  assert.equal(m.count(), 2 * 1 * RES * RES);
  assert.ok(m.at(2.1, 3.1) && m.at(3.9, 3.9));
  assert.ok(!m.at(1.9, 3.5) && !m.at(4.01, 3.5));
});

test('pixels are sampled at their centres', () => {
  const m = new ExploredMask(GRID);
  m.add([sq(0.03, 0.03, 1)]); // just past cell (0,0) on every side
  assert.equal(m.count(), RES * RES, 'exactly one cell of pixels');
  assert.ok(m.at(0.01, 0.5) && m.at(0.99, 0.5), 'cell (0,0) fully explored');
  assert.ok(!m.at(1.05, 0.5) && !m.at(0.5, 1.05), 'nothing spills into the next cell');
});

test('outlines are on the 1/8 grid and round-trip exactly', () => {
  const m = new ExploredMask(GRID);
  m.add([[[1, 1], [8.3, 2.2], [3.7, 9.1]]]); // a triangle with off-grid corners
  const polys = m.toPolys();
  for (const r of polys) for (const p of r) assert.ok(onSnap(p[0]) && onSnap(p[1]), `${p}`);
  assert.ok(roundTrips(m));
});

test('repeated save and reload never drifts the explored area', () => {
  let explored = { v: 0, polys: [] };
  explored = mergeExplored(explored, [[[0.3, 0.2], [9.1, 1.7], [5.2, 8.9], [1.1, 6.6]]], GRID).explored;
  const first = ExploredMask.fromExplored(explored, GRID).count();
  for (let i = 0; i < 10; i++) {
    const m = ExploredMask.fromExplored(explored, GRID);
    explored = { v: explored.v, polys: m.toPolys() };
  }
  assert.equal(ExploredMask.fromExplored(explored, GRID).count(), first);
});

test('merging: separate areas stay separate, overlapping areas join', () => {
  const two = mergeExplored(undefined, [sq(1, 1, 2), sq(6, 6, 2)], GRID).explored;
  assert.equal(two.polys.length, 2);
  const joined = mergeExplored(two, [sq(2, 2, 5)], GRID).explored;
  assert.equal(joined.polys.length, 1);
  assert.equal(joined.v, 2);
});

test('merging: a ring of explored area keeps its hole', () => {
  const frame = [sq(1, 1, 8, 1), sq(1, 8, 8, 1), sq(1, 2, 1, 6), sq(8, 2, 1, 6)];
  const { explored } = mergeExplored(undefined, frame, GRID);
  assert.equal(explored.polys.length, 2, 'outer ring and hole');
  const m = ExploredMask.fromExplored(explored, GRID);
  assert.ok(m.at(1.5, 5) && !m.at(5, 5), 'frame explored, middle not');
  assert.equal(m.count(), (64 - 36) * RES * RES);
});

test('merging: areas touching only at a corner round-trip correctly', () => {
  const m = new ExploredMask(GRID);
  m.add([sq(2, 2, 1), sq(3, 3, 1)]);
  assert.ok(roundTrips(m));
  assert.equal(m.toPolys().length, 2);
});

test('merging: nothing new means unchanged, same object, same version', () => {
  const a = mergeExplored(undefined, [sq(1, 1, 3)], GRID).explored;
  const b = mergeExplored(a, [sq(1.5, 1.5, 1)], GRID);
  assert.equal(b.changed, false);
  assert.equal(b.explored, a);
});

test('simplification keeps outlines small', () => {
  const m = new ExploredMask({ cols: 40, rows: 40 });
  m.add([visPolygon([20, 20], [], { rangeFt: 75, feetPerCell: 5 })]); // a 15-cell-radius circle
  const pts = m.toPolys().reduce((n, r) => n + r.length, 0);
  assert.ok(pts < 1000, `${pts} points`);
  assert.ok(roundTrips(m, { cols: 40, rows: 40 }));
});

// ---- Display outlines: straight diagonals for painting ----

/** Every pixel `b` adds over `a` lies within `px` pixels of a pixel set in `a`. */
function addsOnlyNear(a, b, px) {
  const r = Math.ceil(px);
  for (let j = 0; j < a.h; j++) {
    for (let i = 0; i < a.w; i++) {
      const k = j * a.w + i;
      if (!b.bits[k] || a.bits[k]) continue;
      let near = false;
      for (let dj = -r; dj <= r && !near; dj++) {
        for (let di = -r; di <= r && !near; di++) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < a.w && jj < a.h && a.bits[jj * a.w + ii] && Math.hypot(di, dj) <= px + 0.5) near = true;
        }
      }
      if (!near) return false;
    }
  }
  return true;
}

test('display outlines draw diagonals as straight lines', () => {
  const G2 = { cols: 20, rows: 20 };
  const m = new ExploredMask(G2);
  m.add([[[2, 2], [18, 5.3], [17.1, 9.7]]]);
  const stored = m.toPolys(), shown = m.displayPolys();
  const pts = (r) => r.reduce((n, x) => n + x.length, 0);
  assert.ok(pts(stored) > 150, `stored outline is a staircase (${pts(stored)} points)`);
  assert.ok(pts(shown) < 20, `display outline is straight (${pts(shown)} points)`);
});

test('display outlines never hide explored area and add at most a sliver', () => {
  const G2 = { cols: 20, rows: 20 };
  const m = new ExploredMask(G2);
  m.add([[[2, 2], [18, 5.3], [17.1, 9.7]], [[3, 12], [16, 13.4], [9.2, 19]]]);
  const shown = ExploredMask.fromExplored({ polys: m.displayPolys() }, G2);
  assert.ok(m.bits.every((b, i) => !b || shown.bits[i]), 'covers every explored pixel');
  assert.ok(addsOnlyNear(m, shown, STRAIGHTEN_PX), `adds nothing farther than ${STRAIGHTEN_PX} px from explored area`);
});

test('display outlines: holes only shrink', () => {
  const G2 = { cols: 20, rows: 20 };
  const m = new ExploredMask(G2);
  m.add([sq(1, 1, 18)]);
  // carve a diagonal-edged hole by building the mask from a frame polygon with an inner triangle
  const frame = { polys: [sq(1, 1, 18), [[5, 5], [5.3, 14.2], [14.6, 9.1]]] };
  const mm = ExploredMask.fromExplored(frame, G2);
  const shown = ExploredMask.fromExplored({ polys: mm.displayPolys() }, G2);
  assert.ok(mm.bits.every((b, i) => !b || shown.bits[i]), 'explored frame fully covered');
  assert.ok(!shown.at(9, 9.5), 'the middle of the hole stays unexplored');
  assert.ok(addsOnlyNear(mm, shown, STRAIGHTEN_PX));
});

test('display outlines never feed back: stored area is unchanged by many merges', () => {
  const G2 = { cols: 20, rows: 20 };
  let ex = mergeExplored(undefined, [[[2, 2], [18, 5.3], [17.1, 9.7]]], G2).explored;
  const triArea = (polys) => {
    const mm = ExploredMask.fromExplored({ polys }, G2);
    let n = 0;
    for (let j = 0; j < 12 * RES; j++) for (let i = 0; i < mm.w; i++) n += mm.bits[j * mm.w + i];
    return n;
  };
  const stored0 = triArea(ex.polys), shown0 = triArea(displayOutlines(ex, G2));
  for (let k = 0; k < 20; k++) ex = mergeExplored(ex, [sq(1 + (k % 9) * 2, 15, 1)], G2).explored;
  assert.equal(triArea(ex.polys), stored0, 'stored');
  assert.equal(triArea(displayOutlines(ex, G2)), shown0, 'display');
});

// ---- Party view on the sample crypt ----

const crypt = loadMap(path.join(ROOT, 'examples', 'sample-pack', 'maps', 'sample-crypt'));
const view = (tokens, state = {}) => partyView(tokens, prepare(crypt.segs, state), { ...OPTS, feetPerCell: 5 });
const T = (id, kind, x, y, extra = {}) => ({ id, kind, x, y, ...extra });

test('party view: foes are seen only while a PC can see them', () => {
  const ogre = T('ogre', 'foe', 9, 3, { size: 2 }), guard = T('guard', 'foe', 3, 8);
  const closed = view([T('kerra', 'pc', 1, 1), ogre, guard]);
  assert.deepEqual([...closed.seen].sort(), ['guard', 'kerra'], 'guard through the portcullis, ogre behind the closed door');
  const open = view([T('kerra', 'pc', 6, 4), ogre, guard], { doors: { d01: { state: 'open' } } });
  assert.ok(open.seen.has('ogre'), 'from the open doorway');
});

test('party view: GM-hidden tokens are never shown; dead PCs do not look; markers always show', () => {
  const v = view([
    T('kerra', 'pc', 1, 1),
    T('lurker', 'foe', 2, 2, { hidden: true }),
    T('jix', 'pc', 8, 7, { dead: true }),
    T('rat', 'foe', 9, 8),
    T('ping', 'marker', 10, 9),
  ]);
  assert.ok(!v.seen.has('lurker'));
  assert.ok(!v.seen.has('rat'), 'only the dead PC could have seen it');
  assert.ok(v.seen.has('ping'));
  assert.ok(v.seen.has('jix'), 'party tokens always show, alive or not');
  assert.deepEqual(v.lookers, ['kerra']);
});

test('party view: the ruleset can narrow who looks and set vision ranges', () => {
  const tokens = [T('kerra', 'pc', 1, 1), T('guard', 'foe', 3, 8)];
  const blind = partyView(tokens, prepare(crypt.segs), { ...OPTS, canLook: (t) => t.kind === 'pc' && false });
  assert.equal(blind.visible.length, 0);
  assert.ok(!blind.seen.has('guard'));
  const short = partyView(tokens, prepare(crypt.segs), { ...OPTS, rangeOf: () => 10 });
  assert.ok(!short.seen.has('guard'), 'guard is 35 ft away, beyond a 10-ft range');
});

test('fog state of a point: visible, explored, hidden', () => {
  const v = view([T('kerra', 'pc', 1, 1)]);
  const m = new ExploredMask(crypt.map.grid);
  m.add(v.visible);
  m.add([sq(6, 0, 6, 5)]); // north-east room remembered from earlier
  assert.equal(fogStateAt([3, 3], v.visible, m, pointInPolygon), 'visible');
  assert.equal(fogStateAt([9, 2], v.visible, m, pointInPolygon), 'explored');
  assert.equal(fogStateAt([9, 8], v.visible, m, pointInPolygon), 'hidden');
});

// ---- Painting (with a recording stand-in for a canvas) ----

function fakeCtx() {
  const ops = [];
  const ctx = { ops, globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', filter: 'none' };
  for (const f of ['save', 'restore', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'closePath']) {
    ctx[f] = (...a) => ops.push([f, ...a]);
  }
  ctx.fill = (rule) => ops.push(['fill', rule, ctx.globalAlpha, ctx.globalCompositeOperation, ctx.filter]);
  return ctx;
}
const grid = { cell_px: 50, origin_px: [10, 20], cols: 10, rows: 10 };

test('paintFog (player): full fog, explored cut to 55%, visible cut fully', () => {
  const ctx = fakeCtx();
  paintFog(ctx, { grid, explored: [sq(0, 0, 4)], visible: [sq(1, 1, 1), sq(2, 2, 1)], width: 510, height: 520 });
  const fills = ctx.ops.filter((o) => o[0] === 'fill');
  assert.equal(fills.length, 3);
  const [ex, v1, v2] = fills;
  assert.equal(ex[1], 'evenodd');
  assert.equal(ex[3], 'destination-out');
  assert.ok(Math.abs((1 - ex[2]) * FOG_STYLE.player.hidden - FOG_STYLE.player.explored) < 1e-9, 'explored ends at 55% fog');
  assert.equal(ex[4], `blur(${FOG_STYLE.softenPx}px)`, 'explored edge softened');
  assert.equal(v1[2], 1);
  assert.equal(v2[4], 'none', 'visible edge stays sharp');
  assert.deepEqual(ctx.ops.find((o) => o[0] === 'moveTo'), ['moveTo', 10, 20], 'cell (0,0) maps to the grid origin');
});

test('paintFog (gm): light tint only', () => {
  const ctx = fakeCtx();
  const alphas = [];
  ctx.fillRect = () => alphas.push(ctx.globalAlpha);
  paintFog(ctx, { grid, explored: [sq(0, 0, 4)], visible: [], mode: 'gm', width: 510, height: 520 });
  assert.equal(alphas[0], FOG_STYLE.gm.hidden);
  const ex = ctx.ops.find((o) => o[0] === 'fill');
  assert.ok(Math.abs((1 - ex[2]) * FOG_STYLE.gm.hidden - FOG_STYLE.gm.explored) < 1e-9);
});
