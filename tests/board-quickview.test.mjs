// Token Quick-View (board/quickview.js): who may open what, the public card, and the live stat block in the book's
// layout, from the creatures of the Keep test campaign through the real rules. The page is checked headless.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quickViewAccess, quickViewTitle, quickViewBody, quickViewKeys } from '../board/quickview.js';
import { describeStatistic } from '../engine/rules/rules.js';
import { PF2E_CONDITIONS } from '../rulesets/pf2e/conditions.js';
import { PF2E_SYSTEM } from '../rulesets/pf2e/system.js';
import { publicName } from '../board/names.js';
import { loadGame, creature } from '../tools/actor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const game = () => loadGame(path.join(ROOT, 'examples/sample-pack'), path.join(ROOT, 'examples/campaigns/keep-test'));
const strip = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const view = (g, who, v, extra = {}) => {
  const c = creature(g, who), base = c.actor.base ? g.content[c.actor.base] : null;
  const o = { token: c.token, actor: c.actor, state: c.state, prepared: c.prepared, base, view: v, access: quickViewAccess(c.token, v, true), conditions: PF2E_CONDITIONS, describe: describeStatistic, publicName, system: PF2E_SYSTEM, ...extra };
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
    view: 'gm', access: 'full', conditions: {}, describe: () => '', publicName: () => '', system: PF2E_SYSTEM });
  assert.match(strip(html), /Arcane Prepared Spells DC 20, attack \+12 ; 3rd Fireball; Cantrips Light, Shield/);
  assert.match(strip(quickViewBody({ token: { name: 'Statue' }, prepared: null, view: 'gm', access: 'full', conditions: {} })), /Statue has no game data yet/);
  assert.deepEqual(quickViewKeys({ base: 'creature/rat', items: [{ ref: 'item/dagger' }, { name: 'x' }] }, { effects: [{ ref: 'x:effect/y' }, { id: 'prone' }] }), ['creature/rat', 'item/dagger', 'x:effect/y']);
});

test('traits: written the Pathfinder way, their rules on hover, and what the board applies', async () => {
  const { traitLabel, traitEntry, traitApplied } = await import('../rulesets/pf2e/traits.js');
  const { traitGlossary } = await import('../tools/library.mjs');
  assert.deepEqual(['reach-10', 'deadly-d10', 'versatile-p', 'two-hand-d8', 'thrown-20', 'backswing'].map(traitLabel), ['reach 10 feet', 'deadly d10', 'versatile P', 'two hand d8', 'thrown 20 feet', 'backswing']);
  const G = (traitGlossary('pf2e') || {}).entries;
  assert.ok(G && Object.keys(G).length > 500, 'the glossary from the open content');
  assert.equal(traitEntry('reach-10', G).name, 'Reach');
  assert.equal(traitEntry('deadly-d10', G).name, 'Deadly');
  assert.equal(traitEntry('versatile-p', G).name, 'Versatile');
  assert.equal(traitEntry('no-such-trait', G), null);
  assert.match(traitApplied('agile', { pc: false }), /−4 and −8/);
  assert.match(traitApplied('finesse', { pc: true }), /Dexterity for the attack/);
  assert.match(traitApplied('backswing', { pc: true }), /Not automated/);
  assert.match(traitApplied('backswing', { pc: false }), /printed numbers count it/);
  assert.equal(traitApplied('undead', null), null, 'a creature trait: no Strike line');
  // the ogre's greatclub: every trait with its description on hover
  const g = game();
  const html = view(g, 'Scar-Browed Ogre', 'gm', { glossary: G }).html;
  assert.match(html, /title="Backswing: You can use the momentum from a missed attack[^"]*printed numbers count it[^"]*">backswing<\/span>/);
  assert.match(html, />reach 10 feet<\/span>/);
  assert.match(html, /title="Giant: [^"]*">Giant<\/span>/);
});

test('the board knows no game system: a system without a layout gets a plain card, and no other system\'s traits', async () => {
  const src = (await import('node:fs')).readFileSync(path.join(ROOT, 'board/quickview.js'), 'utf8');
  assert.doesNotMatch(src, /Fort|Monster Core|Recall Knowledge|agile|feet'/, 'nothing Pathfinder in the board\'s Quick-View');
  const prepared = { kind: 'npc', level: 2, traits: ['undead', 'skeleton'], hp: { value: 4, max: { value: 10 } }, band: 'Badly hurt' };
  const o = { token: { name: 'Bones', effects: [{ id: 'prone' }] }, actor: {}, state: {}, prepared, base: null, view: 'gm', access: 'full', conditions: {}, describe: () => '', publicName: () => '', system: { id: 'other' }, glossary: { undead: { name: 'Undead', text: 'x' } } };
  const text = strip(quickViewBody(o));
  assert.match(text, /Traits undead, skeleton/);
  assert.match(text, /HP 4\/10/);
  assert.match(text, /no stat block layout/);
  assert.doesNotMatch(quickViewBody(o), /title="Undead/, 'no trait descriptions without the system\'s layout');
  assert.equal(quickViewTitle(o).kind, 'Level 2');
  assert.match(strip(quickViewBody({ ...o, view: 'player', access: 'public' })), /Traits undead, skeleton Health Badly hurt Now Prone/);
  assert.equal(PF2E_SYSTEM.statBlock.kind({ kind: 'npc', level: 1 }), 'Creature 1');
  const { traitGlossary } = await import('../tools/library.mjs');
  assert.equal(traitGlossary('no-such-system'), null);
  assert.equal(traitGlossary('pf2e').system, 'pf2e');
});
