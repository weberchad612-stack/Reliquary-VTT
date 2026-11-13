// The board's top menu (board/menu.js): the definition and the rules that need no page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU, menuForView, menuIndex, activeMenus, moveIndex } from '../board/menu.js';

test('menu: every id is used once, and every menu on the bar has items', () => {
  for (const e of MENU) if (e.items) assert.ok(e.items.some((i) => !i.sep), e.id);
  assert.throws(() => menuIndex([{ id: 'x', label: 'X' }, { id: 'm', label: 'M', items: [{ id: 'x', label: 'again' }] }]), /used twice/);
});

test('menu: the top menu is empty: everything moved to the sidebar (2026-11-12)', () => {
  const idx = menuIndex(MENU);
  assert.equal(idx.size, 0);
  for (const id of ['menu-play', 'narration', 'actions', 'exploration', 'menu-records', 'loot', 'quests', 'dice', 'replay', 'fx-on', 'fx-preview', 'menu-map', 'add-note', 'reload']) assert.equal(idx.get(id), undefined, id);
});

test('menu: GM-only entries are hidden from players, with empty menus and stray separators', () => {
  const def = [
    { id: 'm', label: 'M', items: [{ id: 'a', label: 'A', kind: 'command' }, { sep: true }, { id: 'g', label: 'G', kind: 'command', gm: true }] },
    { id: 'gmenu', label: 'GM only', items: [{ id: 'h', label: 'H', kind: 'command', gm: true }] },
    { id: 's', label: 'S', items: [{ sep: true }, { id: 'b', label: 'B', kind: 'command' }, { sep: true }, { sep: true }, { id: 'c', label: 'C', kind: 'command' }] },
  ];
  const player = menuForView(def, 'player');
  assert.deepEqual(player.map((e) => e.id), ['m', 's']);
  assert.deepEqual(player[0].items.map((e) => e.id || 'sep'), ['a']);
  assert.deepEqual(player[1].items.map((e) => e.id || 'sep'), ['b', 'sep', 'c']);
  const gm = menuForView(def, 'gm');
  assert.deepEqual(gm.map((e) => e.id), ['m', 'gmenu', 's']);
  assert.deepEqual(gm[0].items.map((e) => e.id || 'sep'), ['a', 'sep', 'g']);
});

test('menu: a menu shows as active while one of its toggles (at any depth) is on', () => {
  const def = [
    { id: 'm', label: 'M', items: [{ id: 't', label: 'T', kind: 'toggle' }, { id: 'sub', label: 'Sub', items: [{ id: 'u', label: 'U', kind: 'toggle' }] }] },
    { id: 'n', label: 'N', items: [{ id: 'c', label: 'C', kind: 'command' }] },
  ];
  assert.deepEqual([...activeMenus(def, new Set())], []);
  assert.deepEqual([...activeMenus(def, new Set(['t']))], ['m']);
  assert.deepEqual([...activeMenus(def, new Set(['u']))].sort(), ['m', 'sub']);
  assert.deepEqual([...activeMenus(def, new Set(['c']))], [], 'a command is never "on"');
});

test('menu: Up, Down, Home and End move within a menu and wrap', () => {
  assert.equal(moveIndex('ArrowDown', 0, 3), 1);
  assert.equal(moveIndex('ArrowDown', 2, 3), 0);
  assert.equal(moveIndex('ArrowUp', 0, 3), 2);
  assert.equal(moveIndex('Home', 2, 3), 0);
  assert.equal(moveIndex('End', 0, 3), 2);
  assert.equal(moveIndex('ArrowLeft', 1, 3), null);
  assert.equal(moveIndex('ArrowDown', 0, 0), null);
});
