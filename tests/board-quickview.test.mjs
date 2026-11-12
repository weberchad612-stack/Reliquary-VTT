// Token Quick-View (board/quickview.js): who may open what, the public card, and the live stat block in the book's
// layout, from the creatures of the Keep test campaign through the real rules. The page is checked headless.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quickViewAccess, quickViewTitle, quickViewBody, quickViewKeys } from '../board/quickview.js';
import { describeStatistic } from '../engine/rules/rules.js';
import { PF2E_CONDITIONS } from '../rulesets/pf2e/conditions.js';
import { publicName } from '../board/names.js';
import { loadGame, creature } from '../tools/actor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const game = () => loadGame(path.join(ROOT, 'examples/sample-pack'), path.join(ROOT, 'examples/campaigns/keep-test'));
const strip = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const view = (g, who, v, extra = {}) => {
  const c = creature(g, who), base = c.actor.base ? g.content[c.actor.base] : null;
  const o = { token: c.token, actor: c.actor, state: c.state, prepared: c.prepared, base, view: v, access: quickViewAccess(c.token, v, true), conditions: PF2E_CONDITIONS, describe: describeStatistic, publicName, ...extra };
  return { o, title: quickViewTitle(o), html: quickViewBody(o) };
};

test('who may open what: the GM any token; players their PCs in full, other creatures they see as a card', () => {
  assert.equal(quickViewAccess({ kind: 'foe' }, 'gm', false), 'full');
  assert.equal(quickViewAccess({ kind: 'pc' }, 'player', false), 'full');
  assert.equal(quickViewAccess({ kind: 'foe' }, 'player', true), 'public');
  assert.equal(quickViewAccess({ kind: 'npc' }, 'player', false), null, 'not seen: nothing');
  assert.equal(quickViewAccess(null, 'gm'), null);
});

test('the public card: the name players know, health band, visible conditions; no numbers, nothing secret', () => {
  const g = game();
  const id = 'tok-u1t8r9h7';
  g.tokens[id].effects = [{ id: 'frightened', value: 2 }, { id: 'off-guard', gm_only: true }];
  g.states[id] = { hp: 9 };
  const { title, html } = view(g, id, 'player');
  assert.deepEqual(title, { name: 'Hooded Cultist', kind: '' });
  const text = strip(html);
  assert.match(text, /Health Wounded/);
  assert.match(text, /Now Frightened 2/);
  assert.doesNotMatch(text, /Off-guard|AC|HP 9|Varsha|Perception/);
});

test('the GM stat block: book layout, live numbers marked with their breakdown, the alias noted', () => {
  const g = game();
  const id = 'tok-u1t8r9h7';
  g.tokens[id].effects = [{ id: 'frightened', value: 2 }];
  g.states[id] = { hp: 9 };
  const { title, html } = view(g, id, 'gm');
  assert.equal(title.name, 'Varsha Kell');
  assert.match(title.kind, /^Creature 1$/);
  assert.match(title.also, /players see "Hooded Cultist"/);
  const text = strip(html);
  for (const re of [/Perception −?\+?\d/, /Skills Deception/, /Str \+1, Dex \+2/, /AC 13 ; Fort/, /HP 9 \/18/, /Speed 25 feet/, /Melee ◆ Sickle/, /Dark Zeal/]) assert.match(text, re);
  assert.match(html, /class="qv-n down" title="Perception 4 = 6 stat block − 2 Frightened 2 \(status\) \(printed \+6\)"/);
  assert.match(text, /Now Frightened 2/);
});

test('a PC sheet: trained skills only, items, shield, class DC, resources, feats', () => {
  const g = game();
  const { title, html } = view(g, 'Kerra', 'player');
  assert.deepEqual([title.name, title.kind], ['Kerra', 'Level 3']);
  const text = strip(html);
  assert.match(text, /Skills Acrobatics \+7 , Athletics \+11/);
  assert.doesNotMatch(text, /Arcana/, 'untrained skills are left out');
  for (const re of [/Items chain mail, steel shield, longsword, dagger/, /AC 20 ; Fort \+9 , Ref \+9 , Will \+8/, /Shield Steel Shield: Hardness 5/, /Class DC 19/, /Resources Hero Points 1\/3/, /Feats and features Toughness/]) assert.match(text, re);
});

test('a creature with spellcasting and no game data; the content a Quick-View needs', () => {
  const html = quickViewBody({ token: { name: 'Mage' }, actor: {}, state: {}, base: { items: [{ kind: 'spellcasting', name: 'Arcane Prepared Spells', dc: 20, attack: 12, spells: [{ name: 'Fireball', rank: 3 }, { name: 'Light', rank: 0 }, { name: 'Shield', rank: 0 }] }], stats: {} },
    prepared: { kind: 'npc', level: 5, traits: [], size: 'medium', attributes: {}, skills: {}, saves: {}, speeds: {}, strikes: [], iwr: {}, hp: { value: 30, max: { value: 30 } }, abilities: [] },
    view: 'gm', access: 'full', conditions: {}, describe: () => '', publicName: () => '' });
  assert.match(strip(html), /Arcane Prepared Spells DC 20, attack \+12 ; 3rd Fireball; Cantrips Light, Shield/);
  assert.match(strip(quickViewBody({ token: { name: 'Statue' }, prepared: null, view: 'gm', access: 'full', conditions: {} })), /Statue has no game data yet/);
  assert.deepEqual(quickViewKeys({ base: 'creature/rat', items: [{ ref: 'item/dagger' }, { name: 'x' }] }, { effects: [{ ref: 'x:effect/y' }, { id: 'prone' }] }), ['creature/rat', 'item/dagger', 'x:effect/y']);
});
