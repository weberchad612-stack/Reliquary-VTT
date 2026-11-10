import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LightMap, LightCache, lightShape, lightPatch, prepareLight, parseColour, DARK, DIM, BRIGHT, DIM_GLOW, DIM_FRINGE } from '../engine/light/light.js';
import { perceive, senseList, lightSpec, LIGHT_PRESETS } from '../rulesets/pf2e/light.js';

const GRID = { cols: 20, rows: 20 };
// A room x 0..10, y 0..10 with a wall at x = 10, a window at x = 10 for y 4..5, and a closed door at y 6..7.
const segs = [
  { id: 'w1', t: 'solid', a: [10, 0], b: [10, 4] },
  { id: 'win', t: 'window', a: [10, 4], b: [10, 5] },
  { id: 'w2', t: 'solid', a: [10, 5], b: [10, 6] },
  { id: 'd', t: 'door', a: [10, 6], b: [10, 7], door: { id: 'd1' } },
  { id: 'w3', t: 'solid', a: [10, 7], b: [10, 20] },
];
const mapWith = (lights, state = {}, o = {}) => {
  const prepared = prepareLight(segs, state);
  const patches = lights.map((l) => lightPatch(lightShape(l, prepared), GRID));
  return new LightMap(GRID, { base: 'dark', ...o, patches });
};

test('a torch: bright to 20 ft, dim for 20 ft more, dark beyond', () => {
  const m = mapWith([{ id: 't', at: [3.5, 10.5], bright: 20, dim: 20 }]);
  assert.equal(m.at(3.5, 10.5), BRIGHT);
  assert.equal(m.at(3.5 + 3.9, 10.5), BRIGHT);   // 19.5 ft
  assert.equal(m.at(3.5, 10.5 + 5), DIM);         // 25 ft
  assert.equal(m.at(3.5, 10.5 + 8.5), DARK);      // 42.5 ft
});

test('walls stop light; windows let it through; a closed door blocks it until opened', () => {
  const at = { id: 't', at: [8.5, 5], bright: 20, dim: 20 };
  const m = mapWith([at]);
  assert.equal(m.at(11.5, 4.5), BRIGHT, 'through the window');
  assert.equal(m.at(11.5, 2), DARK, 'behind the wall');
  assert.equal(m.at(11.5, 7.5), DARK, 'behind the closed door'); // the line from the torch crosses x = 10 at y 6.25, in the doorway
  assert.equal(mapWith([at], { doors: { d1: { state: 'open' } } }).at(11.5, 7.5), BRIGHT, 'door open');
});

test('a light that walls do not constrain shines through them', () => {
  const m = mapWith([{ id: 'g', at: [8.5, 2], bright: 20, dim: 0, walls: false }]);
  assert.equal(m.at(11.5, 2), BRIGHT);
});

test('a static cone lights only its arc', () => {
  const m = mapWith([{ id: 'beam', at: [2, 2], bright: 30, dim: 0, angle: 60, rotation: 0 }]); // east
  assert.equal(m.at(6, 2.2), BRIGHT);
  assert.equal(m.at(2.2, 6), DARK, 'south is outside the cone');
});

test('regions: fixed levels and sky regions following the sky light', () => {
  const regions = [{ id: 'cave', level: 'dim', rects: [[0, 0, 2, 2]] }, { id: 'roof', level: 'sky', cells: [[5, 5]] }];
  const day = new LightMap(GRID, { base: 'dark', sky: 'bright', regions });
  assert.equal(day.at(1, 1), DIM);
  assert.equal(day.at(5.5, 5.5), BRIGHT);
  assert.equal(day.at(8, 8), DARK);
  const night = new LightMap(GRID, { base: 'dark', sky: 'dark', regions });
  assert.equal(night.at(5.5, 5.5), DARK);
  const outdoors = new LightMap(GRID, { base: 'sky', sky: 'dim' });
  assert.equal(outdoors.at(8, 8), DIM);
});

test('lights add to regions: a torch carried into a dark region lights it', () => {
  const m = mapWith([{ id: 't', at: [1, 1], bright: 20, dim: 20 }], {}, { regions: [{ id: 'r', level: 'dark', rects: [[0, 0, 4, 4]] }] });
  assert.equal(m.at(1.5, 1.5), BRIGHT);
});

test('the cache recomputes a light only when it moves or doors change', () => {
  const c = new LightCache(GRID);
  const torch = { id: 't', at: [3, 3], bright: 20, dim: 20 };
  c.patchesFor([torch], segs, {}, 'a'); c.patchesFor([torch], segs, {}, 'a');
  assert.equal(c.computed, 1);
  c.patchesFor([{ ...torch, at: [4, 3] }], segs, {}, 'a');
  assert.equal(c.computed, 2);
  c.patchesFor([{ ...torch, at: [4, 3] }], segs, {}, 'b');
  assert.equal(c.computed, 3);
});

// ---- PF2E ----

test('PF2E: dim light conceals unless the observer has low-light vision or darkvision', () => {
  assert.equal(perceive(BRIGHT, []).state, 'observed');
  assert.equal(perceive(DIM, []).state, 'concealed');
  assert.equal(perceive(DIM, senseList(['low-light'])).state, 'observed');
  assert.equal(perceive(DIM, senseList(['darkvision'])).state, 'observed');
});

test('PF2E: darkness is unseen without darkvision, and seen in black and white with it', () => {
  assert.equal(perceive(DARK, []).state, 'unseen');
  assert.equal(perceive(DARK, senseList(['low-light'])).state, 'unseen');
  assert.deepEqual(perceive(DARK, senseList(['darkvision'])), { state: 'observed', mono: true });
  assert.deepEqual(perceive(DARK, senseList(['greater-darkvision'])), { state: 'observed', mono: true });
});

test('a sense with a range works only within it (other systems, special senses)', () => {
  const dv60 = senseList([{ type: 'darkvision', range: 60 }]);
  assert.equal(perceive(DARK, dv60, 55).state, 'observed');
  assert.equal(perceive(DARK, dv60, 65).state, 'unseen');
});

test('PF2E light presets', () => {
  const radii = (l) => { const { bright, dim } = lightSpec(l); return { bright, dim }; };
  assert.deepEqual(radii({ preset: 'torch' }), { bright: 20, dim: 20 });
  assert.deepEqual(radii({ preset: 'hooded-lantern' }), { bright: 30, dim: 30 });
  assert.deepEqual(radii({ preset: 'light' }), { bright: 20, dim: 20 });
  assert.deepEqual(radii({ preset: 'light', rank: 4 }), { bright: 60, dim: 60 });
  assert.deepEqual(lightSpec({ preset: 'bullseye-lantern' }), lightSpec({ preset: 'hooded-lantern' }));
  assert.deepEqual(radii({ preset: 'torch', bright: 10 }), { bright: 10, dim: 20 });
  assert.throws(() => lightSpec({ preset: 'candel' }), /unknown light preset/);
  assert.ok(Object.keys(LIGHT_PRESETS).length >= 6);
});

test('dim light fades: full brightness at the bright edge, falling to nothing at the outer edge', () => {
  const m = mapWith([{ id: 't', at: [3.5, 10.5], bright: 20, dim: 20 }]);
  assert.equal(m.glowAt(3.5, 10.5), 1);
  assert.ok(m.glowAt(3.5, 10.5 + 4.1) > 0.95, 'just past the bright edge');
  assert.ok(Math.abs(m.glowAt(3.5, 10.5 + 6) - 0.5) < 0.05, 'half way across the dim band');
  assert.ok(m.glowAt(3.5, 10.5 + 7.9) < 0.05, 'at the outer edge');
  assert.equal(m.at(3.5, 10.5 + 7.9), DIM, 'still dim light for the rules');
  assert.equal(m.glowAt(3.5, 10.5 + 8.5), 0);
});

test('dim regions and a dim sky draw at a steady half brightness; overlapping lights take the brighter', () => {
  const regions = [{ id: 'cave', level: 'dim', rects: [[0, 0, 8, 8]] }];
  const m = mapWith([{ id: 't', at: [0.5, 0.5], bright: 5, dim: 20 }], {}, { regions });
  assert.equal(m.glowAt(5.5, 5.5), DIM_GLOW / 255, 'the torch has faded below the region here');
  assert.ok(m.glowAt(1.5, 1.5) > DIM_GLOW / 255, 'the torch is brighter than the region here');
});

test('a light with only bright light gets a thin dim fringe; one with only dim light has none bright', () => {
  const shape = lightShape({ id: 'b', at: [3, 3], bright: 10 }, prepareLight(segs));
  assert.equal(shape.bright, 2);
  assert.ok(Math.abs(shape.reach - 2.2) < 1e-9, 'a 10 ft bright light fades over 1 ft');
  const m = mapWith([{ id: 'c', at: [3.5, 3.5], dim: 10 }]);
  assert.equal(m.at(3.5, 3.5), DIM);
  assert.equal(DIM_FRINGE, 0.1);
});

test('region edges fade in the drawing over a couple of feet, except along a wall; the rules do not fade', () => {
  const regions = [{ id: 'fungus', level: 'dim', rects: [[2, 2, 4, 4]] }];
  const wall = [{ id: 'w', t: 'solid', a: [2, 0], b: [2, 10] }];   // the region's west edge is a wall
  const m = new LightMap(GRID, { base: 'dark', regions, walls: prepareLight(wall) });
  const half = DIM_GLOW / 255;
  assert.equal(m.glowAt(4, 4), half, 'the middle is steady dim');
  assert.ok(m.glowAt(5.97, 4) < 0.2 * half, 'at the open east edge it has faded almost to the dark beyond');
  assert.ok(m.glowAt(5.8, 4) > 0.2 * half && m.glowAt(5.8, 4) < 0.8 * half, 'part way in it is part bright');
  assert.equal(m.glowAt(5.5, 4), half, 'past the fade it is steady');
  assert.equal(m.glowAt(6.05, 4), 0, 'the fade is all on the lit side');
  assert.equal(m.glowAt(2.05, 4), half, 'the west edge is a wall: no fade');
  assert.equal(m.glowAt(1.95, 4), 0);
  assert.equal(m.at(5.95, 4), DIM, 'rules: dim right up to the square line');
  assert.equal(m.at(6.05, 4), DARK);
  const sharp = new LightMap(GRID, { base: 'dark', regions, fadeFt: 0 });
  assert.equal(sharp.glowAt(5.95, 4), half);
});

test('presets come with natural colours; a light can override or remove its colour', () => {
  assert.equal(lightSpec({ preset: 'torch' }).colour, '#ff9a3c');
  assert.equal(lightSpec({ preset: 'hooded-lantern' }).colour, '#ffd27a');
  assert.equal(lightSpec({ preset: 'torch', colour: '#3355ff' }).colour, '#3355ff');
  assert.equal(parseColour(lightSpec({ preset: 'torch', colour: 'none' }).colour), null);
  assert.equal(lightSpec({ bright: 10, dim: 10 }).colour, undefined, 'a light without a preset is uncoloured unless it says');
  assert.equal(lightSpec({ preset: 'torch', intensity: 40 }).intensity, 40);
  assert.deepEqual(parseColour('#ff8000'), [255, 128, 0]);
});

test('intensity scales the drawing brightness only, for lights and regions', () => {
  const full = mapWith([{ id: 't', at: [3.5, 10.5], bright: 20, dim: 20 }]);
  const faint = new LightMap(GRID, { base: 'dark', patches: [{ ...lightPatch(lightShape({ id: 't', at: [3.5, 10.5], bright: 20, dim: 20 }, prepareLight(segs)), GRID), intensity: 25 }] });
  assert.equal(full.glowAt(3.5, 10.5), 1);
  assert.ok(Math.abs(faint.glowAt(3.5, 10.5) - 0.25) < 0.01);
  assert.equal(faint.at(3.5, 10.5), BRIGHT, 'still bright light for the rules');
  const glow = new LightMap(GRID, { base: 'dark', regions: [{ id: 'f', level: 'dim', rects: [[0, 0, 6, 6]], intensity: 50 }] });
  assert.ok(Math.abs(glow.glowAt(3, 3) - DIM_GLOW / 255 / 2) < 0.01);
  assert.equal(glow.at(3, 3), DIM);
});

test('colour: a lone coloured light tints fully; overlapping colours mix by brightness; uncoloured light dilutes', () => {
  const prepared = prepareLight(segs);
  const patch = (l) => ({ ...lightPatch(lightShape(l, prepared), GRID), colour: l.colour });
  const red = { id: 'r', at: [3.5, 12], bright: 10, dim: 0, colour: '#ff0000' };
  const blue = { id: 'b', at: [6.5, 12], bright: 10, dim: 0, colour: '#0000ff' };
  const white = { id: 'w', at: [3.5, 16], bright: 10, dim: 0 };
  const m = new LightMap(GRID, { base: 'dark', patches: [patch(red), patch(blue), patch(white)] });
  const at = (x, y) => { const k = Math.floor(y * 8) * m.w + Math.floor(x * 8); return { rgb: [...m.colour.rgb.slice(k * 3, k * 3 + 3)], share: m.colour.share[k] }; };
  assert.deepEqual(at(2, 11), { rgb: [255, 0, 0], share: 255 }, 'only the red light reaches here');
  const mid = at(5, 12);
  assert.ok(Math.abs(mid.rgb[0] - mid.rgb[2]) < 3 && mid.rgb[0] > 100, 'half way between red and blue: purple');
  assert.ok(at(3.5, 14).share < 200 && at(3.5, 14).share > 50, 'red and uncoloured light together: a weaker tint');
  assert.equal(new LightMap(GRID, { base: 'dark', patches: [patch(white)] }).colour, null, 'nothing coloured: no colour layer');
});

test('changing a light\'s colour or intensity does not recompute it', () => {
  const cache = new LightCache(GRID);
  const l = { id: 't', at: [3, 3], bright: 20, dim: 20, colour: '#ff9a3c' };
  cache.patchesFor([l], segs, {}, '');
  const p = cache.patchesFor([{ ...l, colour: '#00ff00', intensity: 30 }], segs, {}, '');
  assert.equal(cache.computed, 1);
  assert.equal(p[0].colour, '#00ff00');
  assert.equal(p[0].intensity, 30);
});

test('presets bring an animation; a light can change or stop it', () => {
  assert.deepEqual(lightSpec({ preset: 'torch' }).animation, { type: 'torch', speed: 5, intensity: 5 });
  assert.equal(lightSpec({ preset: 'hooded-lantern' }).animation.type, 'flicker');
  assert.equal(lightSpec({ preset: 'light' }).animation, undefined, 'magical light is steady');
  assert.deepEqual(lightSpec({ preset: 'torch', animation: { speed: 9 } }).animation, { type: 'torch', speed: 9, intensity: 5 });
  assert.equal(lightSpec({ preset: 'torch', animation: { type: 'none' } }).animation.type, 'none');
});
