import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare } from '../engine/sight/visibility.js';
import { partyView } from '../engine/fog/view.js';
import { LightMap, LightCache } from '../engine/light/light.js';
import { lightRules } from '../rulesets/pf2e/light.js';

const GRID = { cols: 40, rows: 12 };
// One long hall, 40 x 12, no inner walls.
const segs = [
  { id: 'n', t: 'solid', a: [0, 0], b: [40, 0] }, { id: 'e', t: 'solid', a: [40, 0], b: [40, 12] },
  { id: 's', t: 'solid', a: [40, 12], b: [0, 12] }, { id: 'w', t: 'solid', a: [0, 12], b: [0, 0] },
];
const sight = prepare(segs, {}, 'sight');
function view(tokens, { lights = [], regions = [], base = 'dark' } = {}) {
  const cache = new LightCache(GRID);
  const light = new LightMap(GRID, { base, regions, patches: cache.patchesFor(lights, segs, {}, '') });
  return partyView(tokens, sight, { rangeFt: 200, feetPerCell: 5, grid: GRID, light, rules: lightRules });
}
const pc = (id, x, y, extra = {}) => ({ id, kind: 'pc', x, y, size: 1, ...extra });
const foe = (id, x, y) => ({ id, kind: 'foe', x, y, size: 1 });
const torchAt = (id, t) => ({ id, at: [t.x + 0.5, t.y + 0.5], bright: 20, dim: 20 });

test('a PC in the dark without darkvision perceives nothing and explores nothing', () => {
  const v = view([pc('k', 2, 5)]);
  assert.ok(v.perceived.empty());
  assert.ok(v.visible.length > 0, 'line of sight is still computed');
});

test('a torch-bearer perceives its circle: bright, then dim, then nothing', () => {
  const k = pc('k', 2, 5);
  const v = view([k], { lights: [torchAt('torch', k)] });
  assert.ok(v.perceived.at(5, 5.5), 'within 20 ft: bright');
  assert.ok(v.perceived.at(9, 5.5) && v.dim.at(9, 5.5), 'about 33 ft: dim');
  assert.ok(!v.perceived.at(15, 5.5), 'beyond 40 ft: dark');
});

test('darkvision perceives the dark hall, in greyscale', () => {
  const v = view([pc('d', 2, 5, { senses: ['darkvision'] })]);
  assert.ok(v.perceived.at(30, 5.5));
  assert.ok(v.mono.at(30, 5.5));
});

test('where one PC sees in colour, nothing is drawn in greyscale', () => {
  const k = pc('k', 2, 5), d = pc('d', 3, 5, { senses: ['darkvision'] });
  const v = view([k, d], { lights: [torchAt('torch', k)] });
  assert.ok(!v.mono.at(4, 5.5), 'lit by the torch: colour');
  assert.ok(v.mono.at(30, 5.5), 'dark, seen only by darkvision: greyscale');
});

test('a far lit area is perceived across a dark gap', () => {
  const v = view([pc('k', 2, 5)], { regions: [{ id: 'lamp', level: 'bright', rects: [[34, 4, 4, 4]] }] });
  assert.ok(v.perceived.at(35, 5.5));
  assert.ok(!v.perceived.at(20, 5.5));
});

test('a foe in dim light is concealed from normal vision but not from low-light vision', () => {
  const k = pc('k', 2, 5), e = pc('elf', 2, 7, { senses: ['low-light'] });
  const f = foe('skel', 9, 5); // about 35 ft from the torch: dim
  const v = view([k, e, f], { lights: [torchAt('torch', k)] });
  assert.ok(v.seen.has('skel'));
  assert.deepEqual(v.concealedFrom.skel, ['k']);
});

test('a foe in darkness is not seen without darkvision, and seen with it', () => {
  const f = foe('skel', 25, 5);
  assert.ok(!view([pc('k', 2, 5), f]).seen.has('skel'));
  const v = view([pc('d', 2, 5, { senses: ['darkvision'] }), f]);
  assert.ok(v.seen.has('skel'));
  assert.equal(v.concealedFrom.skel, undefined);
});

test('a torch-bearer is seen from the dark', () => {
  const f = foe('guard', 30, 5);
  const v = view([pc('k', 2, 5), f], { lights: [torchAt('gtorch', f)] });
  assert.ok(v.seen.has('guard'));
  assert.equal(v.concealedFrom.guard, undefined);
});

test('PCs are always shown, whatever the light', () => {
  assert.ok(view([pc('k', 2, 5), pc('p', 30, 5)]).seen.has('p'));
});
