import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daylightLights, skyTest, DAYLIGHT } from '../engine/light/daylight.js';
import { LightMap, LightCache, BRIGHT, DIM, DARK } from '../engine/light/light.js';

// A roofed room x 4..12, y 4..12 on an indoor map; outside it is a sky region. The west wall has a
// two-square window at y 6..8, the east wall a door at y 7..8, the south wall an arrow slit.
const GRID = { cols: 20, rows: 20 };
const regions = [{ id: 'yard', level: 'sky', rects: [[0, 0, 20, 4], [0, 4, 4, 8], [12, 4, 8, 8], [0, 12, 20, 8]] }];
const segs = [
  { id: 'n', t: 'solid', a: [4, 4], b: [12, 4] },
  { id: 'w1', t: 'solid', a: [4, 4], b: [4, 6] },
  { id: 'win', t: 'window', a: [4, 6], b: [4, 8] },
  { id: 'w2', t: 'solid', a: [4, 8], b: [4, 12] },
  { id: 'e1', t: 'solid', a: [12, 4], b: [12, 7] },
  { id: 'door', t: 'door', a: [12, 7], b: [12, 8], door: { id: 'd1' } },
  { id: 'e2', t: 'solid', a: [12, 8], b: [12, 12] },
  { id: 's1', t: 'solid', a: [4, 12], b: [8, 12] },
  { id: 'slit', t: 'slit', a: [8, 12], b: [8.375, 12] },
  { id: 's2', t: 'solid', a: [8.375, 12], b: [12, 12] },
];
const lit = (sky, state = {}) => {
  const lights = daylightLights(segs, state, { grid: GRID, sky, regions });
  const patches = new LightCache(GRID).patchesFor(lights, segs, state, JSON.stringify(state.doors || {}));
  return { lights, map: new LightMap(GRID, { base: 'dark', sky, regions, patches }) };
};

test('the sky test follows the regions, and an outdoor map is sky everywhere it is not roofed', () => {
  const t = skyTest(GRID, { regions });
  assert.equal(t(2, 7), true);
  assert.equal(t(8, 8), false);
  const outdoor = skyTest(GRID, { outdoor: true, regions: [{ id: 'hut', level: 'dark', rects: [[4, 4, 8, 8]] }] });
  assert.equal(outdoor(2, 7), true);
  assert.equal(outdoor(8, 8), false);
});

test('by day a window lights the room: bright near it, fading through dim further in', () => {
  const { lights, map } = lit('bright');
  const win = lights.filter((l) => l.opening === 'win');
  assert.equal(win.length, 2, 'one light per square of window');
  assert.ok(win.every((l) => l.bright === DAYLIGHT.bright && l.dim === DAYLIGHT.dim && l.rotation === 0), 'facing east, into the room');
  assert.equal(map.at(5.5, 7), BRIGHT);
  assert.equal(map.at(4 + 2.6, 6.5), BRIGHT, '13 ft in from the window light');
  assert.equal(map.at(11.5, 7), DIM, '35 ft in');
  assert.equal(map.at(5.5, 4.5), BRIGHT, 'it spreads sideways inside the room');
  assert.equal(map.at(2, 7), BRIGHT, 'outside is the sky');
});

test('the light only comes in through the opening: walls still block it', () => {
  const { map } = lit('bright');
  assert.equal(map.at(5, 11.5) > DARK, true, 'the room\'s far corner is reached from the window');
  assert.equal(map.at(14, 7.5), BRIGHT, 'the yard is sky');
  const lights = daylightLights(segs, {}, { grid: GRID, sky: 'bright', regions });
  assert.ok(!lights.some((l) => l.opening === 'door'), 'a closed door lets nothing in');
});

test('an open door lets daylight in; closing it again shuts it out', () => {
  const open = { doors: { d1: { state: 'open' } } };
  const lights = daylightLights(segs, open, { grid: GRID, sky: 'bright', regions });
  const door = lights.filter((l) => l.opening === 'door');
  assert.equal(door.length, 1);
  assert.equal(door[0].rotation, 180, 'facing west, into the room');
  const segsNoWindow = segs.filter((s) => s.id !== 'win' && s.id !== 'slit').concat([{ id: 'wfix', t: 'solid', a: [4, 6], b: [4, 8] }, { id: 'sfix', t: 'solid', a: [8, 12], b: [8.375, 12] }]);
  const only = (state) => {
    const ls = daylightLights(segsNoWindow, state, { grid: GRID, sky: 'bright', regions });
    return new LightMap(GRID, { base: 'dark', sky: 'bright', regions, patches: new LightCache(GRID).patchesFor(ls, segsNoWindow, state, JSON.stringify(state.doors || {})) });
  };
  assert.equal(only(open).at(10.5, 7.5), BRIGHT);
  assert.equal(only({}).at(10.5, 7.5), DARK);
});

test('at dusk only dim light comes in, and not as far; at night none', () => {
  const dusk = lit('dim');
  assert.ok(dusk.lights.every((l) => l.bright === 0 && l.dim <= DAYLIGHT.dusk));
  assert.equal(dusk.map.at(5.5, 7), DIM);
  assert.equal(dusk.map.at(4.5 + 4, 7), DARK, '20 ft in');
  assert.equal(lit('dark').lights.length, 0);
});

test('an arrow slit lets in a thin beam, scaled to its width', () => {
  const { lights } = lit('bright');
  const slit = lights.filter((l) => l.opening === 'slit');
  assert.equal(slit.length, 1);
  assert.ok(Math.abs(slit[0].bright - DAYLIGHT.bright * 0.375) < 1e-9);
  assert.equal(slit[0].rotation, 270, 'facing north, into the room');
});

test('an opening with sky on both sides or roof on both sides lets in nothing', () => {
  const inside = [{ id: 'inner', t: 'window', a: [8, 5], b: [8, 6] }];
  assert.equal(daylightLights(inside, {}, { grid: GRID, sky: 'bright', regions }).length, 0);
  const outside = [{ id: 'fence', t: 'grate', a: [16, 0], b: [16, 2] }];
  assert.equal(daylightLights(outside, {}, { grid: GRID, sky: 'bright', regions }).length, 0);
});
