// Claude's marching order tool (tools/marching.mjs) on the test keep: the grid, setting it, moving the party.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMarching, runMarching } from '../tools/marching.mjs';

const SAVE = 'examples/campaigns/keep-test';
const KERRA = 'tok-cw77vfz9', PIP = 'tok-rf053o2i', LYRA = 'tok-s85mkapz';

test('marching tool: show, set and add read and write state/marching', () => {
  const g = loadMarching(null, SAVE);
  assert.match(runMarching(g, 'show', []).lines.join('\n'), /front .*Kerra .*Lyra/);
  const set = runMarching(g, 'set', ['Pip=0,0', 'Kerra=3,3']);
  assert.deepEqual(set.writes[0].data.slots[PIP], [0, 0]);
  assert.deepEqual(set.writes[0].data.slots[KERRA], [3, 3]);
  assert.throws(() => runMarching(g, 'set', ['Pip=4,0']), /0 to 3/);
  assert.throws(() => runMarching(g, 'add', ['Kerra']), /is a PC/);
});

test('marching tool: a move faces the way the party heads, the front on the destination; with no room it writes nothing', () => {
  // the party together near 23,46, heading north to 23,40
  const records = {
    [`tokens/${KERRA}`]: { name: 'Kerra', kind: 'pc', map: 'sample-keep', x: 23, y: 46 },
    [`tokens/${LYRA}`]: { name: 'Lyra', kind: 'pc', map: 'sample-keep', x: 24, y: 46 },
    [`tokens/${PIP}`]: { name: 'Pip', kind: 'pc', map: 'sample-keep', x: 23, y: 47 },
  };
  const g = loadMarching(null, SAVE, records);
  const r = runMarching(g, 'move', [], { to: '23,40' });
  assert.equal(r.dir, 'n');
  const at = Object.fromEntries(r.writes.map((w) => [w.path.slice(7), [w.data.x, w.data.y]]));
  assert.deepEqual(at[KERRA], [23, 40], 'the front row reaches the destination');
  assert.deepEqual(at[LYRA], [24, 40], 'Lyra to her right, facing north');
  assert.deepEqual(at[PIP], [23, 41], 'Pip one row behind');
  // a destination inside solid rock: no room on explored ground, nothing written
  const bad = runMarching(g, 'move', [], { to: '0,0' });
  assert.equal(bad.writes.length, 0);
  assert.match(bad.lines.at(-1), /NOT MOVED/);
});
