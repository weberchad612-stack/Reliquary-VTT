// Party loot (board/loot.js): items, secrecy, stacks, moves, coins, Bulk and the encumbered condition; the PF2E rules
// (rulesets/pf2e/loot.js); the tab's HTML (board/lootui.js); Claude's tool (tools/loot.mjs); the stash and purse in
// the save (board/records.js, tools/campaign.mjs, schemas/loot.schema.json); items in use (rulesets/pf2e/actor.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  PLAIN_LOOT, lootRules, lootItem, resolveLoot, lootView, stackKey, mergeInto, stashMerge, splitQty, takeLoot, putBack, giveLoot, setCarry,
  setInvested, lootDetails, lootGroup, partyValue, coinsOf, coinValue, coinLabel, addCoins, parseCoins, takeCoins, splitCoins, carried, encumberedEffects, asCarried,
} from '../board/loot.js';
import { PF2E_LOOT as L, bulkTotal, mysteryName, needsIdentify, valueKnown, sellCp, inUse, priceLabel, bulkLabel, levelDC, seenTraits, itemKind, itemUsage, itemStats, unitCp } from '../rulesets/pf2e/loot.js';
import { stashRowHtml, pcCardHtml, detailsHtml, summaryHtml, filtersHtml, valueHtml } from '../board/lootui.js';
import { runLoot } from '../tools/loot.mjs';
import { loadGame } from '../tools/actor.mjs';
import { campaignRecords, saveFromRecords } from '../board/records.js';
import { buildRecords, readCampaign, writeSave, roundTrip, SAVE_COLLECTIONS } from '../tools/campaign.mjs';
import { prepareActor } from '../engine/rules/rules.js';
import { PF2E_SYSTEM } from '../rulesets/pf2e/system.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const item = (slug) => JSON.parse(fs.readFileSync(path.join(ROOT, 'content/pf2e/equipment/item', `${slug}.json`), 'utf8'));

const POTION = item('healing-potion-minor'), BACKPACK = item('backpack'), CHAIN = item('chain-mail'), ROPE = { kind: 'equipment', name: 'Rope', bulk: 0.1, price: { sp: 5 } };
const C = { 'item/healing-potion-minor': POTION, 'item/backpack': BACKPACK, 'item/chain-mail': CHAIN, 'item/rope': ROPE };

test('PF2E rules: prices, Bulk words, identifying, mystery names, values, selling', () => {
  assert.equal(L.priceCp({ gp: 4, sp: 5 }), 450);
  assert.equal(priceLabel(1250), '12 gp 5 sp');
  assert.equal(priceLabel(500000), '5,000 gp');
  assert.deepEqual([bulkLabel(0), bulkLabel(0.1), bulkLabel(0.4), bulkLabel(3), bulkLabel(3.4)], ['—', 'L', '4 L', '3', '3; 4 L']);
  assert.ok(needsIdentify(POTION), 'a magic potion');
  assert.ok(!needsIdentify(ROPE), 'mundane gear is known at a glance');
  assert.ok(needsIdentify({ kind: 'weapon', runes: { potency: 1 } }), 'a runed weapon');
  assert.equal(L.identifyBy({ traits: ['alchemical', 'elixir'] }), 'alchemy');
  assert.equal(mysteryName(POTION), 'Unidentified Potion');
  assert.equal(mysteryName({ kind: 'weapon', slug: 'flaming-longsword', baseItem: 'longsword' }), 'Longsword (unidentified)');
  assert.equal(mysteryName({ kind: 'equipment', usage: 'worncloak' }), 'Unidentified Cloak');
  assert.equal(mysteryName({ kind: 'equipment', mystery: 'a humming box' }), 'a humming box', 'the GM\'s own vague name');
  // value: appraised, or identified and common; treasure always by appraisal
  assert.equal(valueKnown(POTION, {}), false);
  assert.equal(valueKnown(POTION, { identified: true }), true);
  assert.equal(valueKnown({ ...POTION, rarity: 'uncommon' }, { identified: true }), false);
  assert.equal(valueKnown({ ...POTION, rarity: 'uncommon' }, { identified: true, appraised: true }), true);
  assert.equal(valueKnown({ kind: 'treasure', price: { gp: 50 } }, {}), false);
  assert.equal(valueKnown(POTION, { identified: true, misidentified: { name: 'x' } }), false);
  assert.equal(sellCp(POTION), 200, 'half price');
  assert.equal(sellCp({ kind: 'treasure', price: { gp: 50 } }), 5000, 'treasure sells at full price');
});

test('PF2E Bulk: light items ten to one, coins, carried armor, worn containers, limits', () => {
  // 3 Bulk and 12 light stowed in a worn backpack (2 ignored), worn chain mail, 1,500 coins
  const b = bulkTotal([{ doc: BACKPACK, carry: 'worn' }, { doc: { bulk: 1 }, qty: 3, carry: 'stowed' }, { doc: ROPE, qty: 12, carry: 'stowed' }, { doc: CHAIN, carry: 'worn' }], { gp: 1500 });
  assert.equal(b.tenths, 52);   // 3 + 1.2 stowed - 2 ignored + 2 armor + 1 coins
  assert.equal(b.value, 5);
  assert.equal(b.over, 0.2, '4.2 stowed in a backpack that holds 4');
  assert.equal(bulkTotal([{ doc: CHAIN, carry: 'stowed' }]).value, 3, 'armor carried, not worn, counts 1 more');
  assert.equal(bulkTotal([{ doc: { kind: 'armor', bulk: 0.1 }, carry: 'stowed' }]).value, 1, 'light armor carried is 1 Bulk');
  assert.equal(bulkTotal([], { gp: 999 }).value, 0, 'fewer than 1,000 coins weigh nothing');
  assert.deepEqual(L.bulkLimits({ str: 4 }), { encumbered: 9, max: 14 });
});

test('items in use: stowed items do nothing, armor works worn, invested items worn and invested', () => {
  assert.ok(inUse({}), 'older characters\' items (no carry) are in use');
  assert.ok(!inUse({ carry: 'stowed' }));
  assert.ok(!inUse({ carry: 'held' }, { kind: 'armor' }), 'armor in hand gives no AC');
  assert.ok(inUse({ carry: 'worn' }, { kind: 'armor' }));
  const ring = { traits: ['invested', 'magical'] };
  assert.ok(inUse({ carry: 'worn' }, ring));
  assert.ok(!inUse({ carry: 'worn', invested: false }, ring));
  assert.ok(!inUse({ equipped: false }));
  // the creature rules follow it: Kerra's chain mail stowed is no AC from armor
  const kerra = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/campaigns/keep-test/actors/tok-cw77vfz9.json'), 'utf8'));
  const content = { 'item/chain-mail': CHAIN, 'item/steel-shield': item('steel-shield'), 'item/longsword': item('longsword'), 'item/dagger': item('dagger') };
  const ac = (a) => prepareActor({ actor: a, state: {}, effects: [], content, ruleset: PF2E_SYSTEM.actors }).ac.value;
  const worn = ac(kerra), stowed = ac({ ...kerra, items: kerra.items.map((it) => (it.ref === 'item/chain-mail' ? { ...it, carry: 'stowed' } : it)) });
  assert.ok(worn > stowed, `AC ${worn} worn, ${stowed} stowed`);
});

test('stash items: library or custom, provenance, what each view sees', () => {
  assert.throws(() => lootItem({}), /ref|name/);
  assert.throws(() => lootItem({ name: 'x', qty: 0 }), /quantity/);
  const p = lootItem({ ref: 'item/healing-potion-minor', qty: 3, found: { from: 'the bugbear', where: { map: 'keep', area: 'B12' }, game: { now: 5, label: 'Day 1' } }, by: 'claude' }, 'T');
  assert.deepEqual(p, { ref: 'item/healing-potion-minor', qty: 3, found: { from: 'the bugbear', where: { map: 'keep', area: 'B12' }, game: { now: 5, label: 'Day 1' } }, added: { at: 'T', by: 'claude' } });
  const pv = lootView(p, C, 'player', L), gv = lootView(p, C, 'gm', L);
  assert.equal(pv.name, 'Unidentified Potion');
  assert.equal(pv.text, '');
  assert.equal(pv.valueLabel, '?');
  assert.deepEqual(pv.traits, [], 'no traits give it away');
  assert.equal(gv.name, 'Healing Potion (Minor)');
  assert.equal(gv.valueLabel, '4 gp');
  assert.equal(gv.real.believed, 'Unidentified Potion', 'the GM sees what the players see');
  // identified: the truth and (common) the value
  assert.equal(lootView({ ...p, identified: true }, C, 'player', L).valueLabel, '4 gp');
  // misidentified: the false name, for players only
  const mis = { ...p, misidentified: { name: 'Potion of Swimming', text: 'You can swim.' } };
  assert.equal(lootView(mis, C, 'player', L).name, 'Potion of Swimming');
  assert.equal(lootView(mis, C, 'gm', L).name, 'Healing Potion (Minor)');
  // custom items: own words and numbers; a GM's vague name
  const idol = lootItem({ name: 'Silver toad idol', value: 2500, bulk: 1, identified: false, mystery: 'a strange idol', text: 'Cursed.' });
  assert.equal(lootView(idol, {}, 'player', L).name, 'a strange idol');
  assert.equal(lootView(idol, {}, 'gm', L).valueLabel, '25 gp');
  assert.equal(lootView({ ...idol, appraised: true }, {}, 'player', L).valueLabel, '25 gp', 'appraised: value known though unidentified');
  // content missing on the board: flagged, named from its key
  const lost = lootView({ ref: 'item/vorpal-spoon' }, {}, 'gm', L);
  assert.equal(lost.missing, true);
  assert.equal(lost.name, 'vorpal spoon');
  // a system without loot rules: plain fallbacks
  assert.equal(lootRules({}), PLAIN_LOOT);
  assert.equal(lootView(p, C, 'player', PLAIN_LOOT).name, 'Healing Potion (Minor)', 'everything known');
});

test('stacks, splits and moves between the stash and characters', () => {
  const a = { ref: 'item/healing-potion-minor', found: { where: { area: 'A1' } } }, b = { ref: 'item/healing-potion-minor', qty: 2, found: { where: { area: 'B2' } } };
  assert.equal(stackKey(a), stackKey(b), 'where it was found does not matter');
  assert.notEqual(stackKey(a), stackKey({ ...a, identified: true }), 'known and unknown do not stack');
  assert.equal(mergeInto([a], b)[0].qty, 3);
  assert.deepEqual(splitQty({ ref: 'x', qty: 3 }, 2), [{ ref: 'x', qty: 2 }, { ref: 'x' }]);
  assert.throws(() => splitQty({ ref: 'x' }, 2), /only 1/);
  // take: an unknown potion goes onto the character marked unknown, stowed
  const stash = { ref: 'item/healing-potion-minor', qty: 3, added: { at: 'T', by: 'gm' } };
  const t = takeLoot(stash, [], 2, null, L, C);
  assert.deepEqual(t.stash, { ref: 'item/healing-potion-minor', added: { at: 'T', by: 'gm' } });
  assert.deepEqual(t.items, [{ ref: 'item/healing-potion-minor', qty: 2, identified: false, carry: 'stowed' }]);
  assert.equal(takeLoot({ ref: 'item/chain-mail' }, [], 1, null, L, C).moved.carry, 'worn', 'armor goes on');
  // a character's own gear (no identified) is known; put back, it says so for the stash
  assert.equal(lootView(asCarried({ ref: 'item/healing-potion-minor' }), C, 'player', L).name, 'Healing Potion (Minor)');
  const back = putBack([{ ref: 'item/healing-potion-minor', carry: 'stowed' }], 0, 1, L, C);
  assert.deepEqual(back, { items: [], stashItem: { ref: 'item/healing-potion-minor', identified: true } });
  // give: into the other's pack, uninvested
  const g = giveLoot([{ ref: 'item/rope', qty: 2, carry: 'held' }], 0, [], 1);
  assert.deepEqual(g.from, [{ ref: 'item/rope', carry: 'held' }]);
  assert.deepEqual(g.to, [{ ref: 'item/rope', carry: 'stowed' }]);
  assert.deepEqual(setCarry([{ ref: 'r', carry: 'worn', invested: false }], 0, 'stowed'), [{ ref: 'r', carry: 'stowed' }]);
  assert.deepEqual(setInvested([{ ref: 'r', carry: 'worn' }], 0, false), [{ ref: 'r', carry: 'worn', invested: false }]);
});

test('coins: words, parsing, change from larger coins, splitting evenly', () => {
  assert.deepEqual(coinsOf({ gp: '3', xp: 5 }, L), { pp: 0, gp: 3, sp: 0, cp: 0 });
  assert.equal(coinValue({ pp: 1, gp: 2, sp: 3, cp: 4 }, L), 1234);
  assert.equal(coinLabel({ gp: 3, sp: 4 }, L), '3 gp 4 sp');
  assert.equal(coinLabel({}, L), 'no coins');
  assert.deepEqual(parseCoins('5 gp 3sp, 2 cp', L), { pp: 0, gp: 5, sp: 3, cp: 2 });
  assert.deepEqual(parseCoins('1,200', L), { pp: 0, gp: 1200, sp: 0, cp: 0 }, 'a bare number is gold');
  assert.throws(() => parseCoins('lots', L), /not an amount/);
  assert.deepEqual(addCoins({ gp: 1 }, { gp: 2, sp: 1 }, L), { pp: 0, gp: 3, sp: 1, cp: 0 });
  assert.deepEqual(takeCoins({ gp: 2, sp: 40 }, { gp: 5 }, L), { left: { pp: 0, gp: 0, sp: 10, cp: 0 }, taken: { pp: 0, gp: 2, sp: 30, cp: 0 } });
  assert.deepEqual(takeCoins({ pp: 1 }, { sp: 3, cp: 5 }, L).left, { pp: 0, gp: 9, sp: 6, cp: 5 }, 'a platinum piece broken down');
  assert.throws(() => takeCoins({ gp: 1 }, { gp: 2 }, L), /not enough/);
  assert.deepEqual(splitCoins({ gp: 10, sp: 5 }, 3, L), { each: { pp: 0, gp: 3, sp: 5, cp: 0 }, left: { pp: 0, gp: 0, sp: 0, cp: 0 } }, 'the gold left over is broken into silver');
  assert.deepEqual(splitCoins({ pp: 1, gp: 2, cp: 1 }, 3, L), { each: { pp: 0, gp: 4, sp: 0, cp: 0 }, left: { pp: 0, gp: 0, sp: 0, cp: 1 } }, 'the user\'s purse, 2026-11-13');
  assert.deepEqual(splitCoins({ gp: 1 }, 3, L), { each: { pp: 0, gp: 0, sp: 3, cp: 3 }, left: { pp: 0, gp: 0, sp: 0, cp: 1 } });
  assert.deepEqual(splitCoins({ gp: 6 }, 3, L).each, { pp: 0, gp: 2, sp: 0, cp: 0 }, 'nothing broken when it divides');
});

test('a character\'s load: Bulk, limits, warnings, invested count; the encumbered condition follows it', () => {
  const pip = { kind: 'character', attributes: { str: 0 }, items: [{ ref: 'item/backpack', carry: 'worn' }, { ref: 'item/chain-mail', carry: 'stowed' }, { name: 'Anvil', bulk: 4, carry: 'held' }] };
  const c = carried(pip, { gp: 10 }, C, L);
  assert.equal(c.bulk.value, 5, 'chain mail carried 3, less the backpack\'s 2, and the anvil');
  assert.equal(c.encumbered, false, 'at 5 + Str exactly, not over');
  const heavier = carried({ ...pip, items: [...pip.items, { ref: 'item/rope', qty: 10 }] }, {}, C, L);
  assert.equal(heavier.encumbered, true);
  assert.match(heavier.warnings.join(), /encumbered/);
  const rings = { kind: 'character', items: Array.from({ length: 11 }, (_, i) => ({ name: `Ring ${i}`, traits: ['invested', 'magical'], carry: 'worn' })) };
  assert.match(carried(rings, {}, {}, L).warnings.join(), /11 invested items: the limit is 10/);
  // the condition: on when over, off only if this put it on
  assert.deepEqual(encumberedEffects([], true, L), [{ id: 'encumbered', source: 'Bulk' }]);
  assert.equal(encumberedEffects([{ id: 'encumbered', source: 'Bulk' }], true, L), null, 'already on');
  assert.deepEqual(encumberedEffects([{ id: 'encumbered', source: 'Bulk' }, { id: 'frightened', value: 1 }], false, L), [{ id: 'frightened', value: 1 }]);
  assert.equal(encumberedEffects([{ id: 'encumbered' }], false, L), null, 'the GM\'s own encumbered stays');
  assert.equal(encumberedEffects([], true, PLAIN_LOOT), null, 'no system rule, no condition');
});

test('the tab\'s HTML: players see vague names and no GM controls; Bulk bars', () => {
  const e = { id: 'a', data: { ref: 'item/healing-potion-minor', qty: 2, found: { from: 'the bugbear' } } };
  const pcs = [{ id: 'tok-1', name: 'Kerra' }];
  const player = stashRowHtml(e, lootView(e.data, C, 'player', L), { gm: false, write: true, pcs });
  assert.match(player, /Unidentified Potion/);
  assert.doesNotMatch(player, /Healing|bugbear|data-act="identify"/);
  assert.match(player, /data-act="take"/);
  const gm = stashRowHtml(e, lootView(e.data, C, 'gm', L), { gm: true, write: true, pcs });
  assert.match(gm, /Healing Potion \(Minor\)/);
  assert.match(gm, /Players see: Unidentified Potion/);
  assert.match(gm, /data-act="identify"/);
  assert.doesNotMatch(gm, /bugbear/, 'details are closed');
  const opened = stashRowHtml(e, lootView(e.data, C, 'player', L), { gm: false, write: true, pcs, open: () => true }, lootDetails(e.data, C, 'player', L));
  assert.match(opened, /Found on the bugbear/, 'players see where it was found (the user, 2026-11-13)');
  assert.match(opened, /Not identified/);
  assert.doesNotMatch(stashRowHtml(e, lootView(e.data, C, 'gm', L), { gm: true, write: false, pcs }), /data-act="(take|identify|appraise|remove)"/, 'read-only: only opening the details');
  const pip = { kind: 'character', attributes: { str: 0 }, items: [{ name: 'Anvil', bulk: 6, carry: 'held' }] };
  const card = pcCardHtml({ id: 'tok-2', name: 'Pip' }, carried(pip, {}, {}, L), { gm: false, write: true, pcs, coins: { gp: 3 }, L });
  assert.match(card, /lt-bar lt-enc/);
  assert.match(card, /encumbered/);
  assert.match(card, /3 gp/);
});

/** Apply a tool's writes to a records object (update merges top-level fields). */
function apply(records, writes) {
  for (const w of writes) {
    if (w.op === 'delete') delete records[w.path];
    else if (w.op === 'update') records[w.path] = { ...(records[w.path] || {}), ...w.data };
    else records[w.path] = w.data;
  }
  return records;
}

test('tools/loot.mjs: find, add, identify, take, give, put back, carry, coins, split, sell, buy', () => {
  const pack = path.join(ROOT, 'examples/sample-pack'), save = path.join(ROOT, 'examples/campaigns/keep-test');
  const records = buildRecords(pack, save, { now: 'T' }).records;
  const run = (cmd, args, o = {}) => { const game = loadGame(pack, save, records); game.packDir = pack; const out = runLoot(game, records, null, cmd, args, o); apply(records, out.writes); return out; };
  assert.match(run('find', ['healing', 'potion'], { limit: 2 }).lines.join('\n'), /item\/healing-potion-minor/);
  // found loot: the content record comes with it; the players see a vague name
  let out = run('add', ['item/healing-potion-minor'], { qty: 3, from: 'the bugbear', area: 'B12' });
  assert.ok(out.writes.some((w) => w.path === 'content/item.healing-potion-minor'), 'the content record');
  assert.ok(out.writes.some((w) => w.path.startsWith('audit/')), 'an audit line');
  assert.match(out.lines[0], /players see "Unidentified Potion"/);
  run('add', ['Silver toad idol'], { value: '25 gp', bulk: '1', text: 'Cursed.' });
  const stash = () => Object.entries(records).filter(([p]) => p.startsWith('loot/'));
  assert.equal(stash().length, 2);
  // identify the potions; misidentify the idol (it needs no identifying, so --unidentified first)
  run('identify', ['Healing Potion (Minor)']);
  run('identify', ['Silver toad idol'], { as: 'Idol of Luck' });
  assert.equal(stash().find(([, d]) => d.name === 'Silver toad idol')[1].misidentified.name, 'Idol of Luck');
  // take 2 potions to Kerra, give 1 to Lyra, put Lyra's back
  run('take', ['Healing Potion (Minor)', 'Kerra'], { qty: 2 });
  const kerra = () => records['actors/tok-cw77vfz9'].items, lyra = () => records['actors/tok-s85mkapz'].items;
  assert.deepEqual(kerra().at(-1), { ref: 'item/healing-potion-minor', qty: 2, found: kerra().at(-1).found, identified: true, carry: 'stowed' });
  run('give', ['Kerra', 'Healing Potion (Minor)', 'Lyra'], { qty: 1 });
  assert.equal(kerra().at(-1).qty, undefined, 'one left');
  assert.equal(lyra().at(-1).ref, 'item/healing-potion-minor');
  run('putback', ['Lyra', 'Healing Potion (Minor)']);
  assert.equal(lyra().length, 3);
  assert.equal(stash().filter(([, d]) => d.ref === 'item/healing-potion-minor').reduce((n, [, d]) => n + (d.qty || 1), 0), 2);
  // carry: Kerra stows her chain mail (her AC drops; the tool says so through the rules, not here)
  run('carry', ['Kerra', 'Chain Mail', 'stowed']);
  assert.equal(kerra()[0].carry, 'stowed');
  // coins: into the purse, split three ways, moved between PCs
  run('coins', ['add', '10 gp 5 sp']);
  out = run('split', []);
  assert.match(out.lines.at(-1), /3 gp 5 sp each/);
  assert.deepEqual(records['state/purse'], { pp: 0, gp: 0, sp: 0, cp: 0 });
  run('coins', ['move', '2 gp'], { from: 'Kerra', to: 'Pip' });
  assert.equal(records['actorstate/tok-rf053o2i'].coins.gp, 5);
  // sell the idol (half of 25 gp) to the purse; buy a rope for Pip from the purse
  out = run('sell', ['Silver toad idol']);
  assert.match(out.lines[0], /12 gp 5 sp/);
  assert.equal(records['state/purse'].gp, 12);
  out = run('buy', ['item/backpack'], { to: 'Pip' });
  assert.match(out.lines[0], /Bought Backpack for 1 sp/);
  assert.equal(records['actors/tok-rf053o2i'].items.at(-1).carry, 'worn');
  // an anvil makes Pip encumbered: the condition goes on the token, and off when it goes back
  out = run('add', ['Anvil'], { bulk: '7', to: 'Pip' });   // stowed: the backpack takes 2 off
  assert.ok(records['tokens/tok-rf053o2i'].effects.some((e) => e.id === 'encumbered' && e.source === 'Bulk'), out.lines.join(' / '));
  run('putback', ['Pip', 'Anvil']);
  assert.ok(!(records['tokens/tok-rf053o2i'].effects || []).some((e) => e.id === 'encumbered'));
  assert.throws(() => run('take', ['nothing here', 'Kerra']), /nothing in the stash/);
  assert.throws(() => run('coins', ['take', '500 gp']), /not enough/);
  // list, as the players see it
  const list = run('list', [], { view: 'player' }).lines.join('\n');
  assert.match(list, /Purse: /);
  assert.match(list, /Party loot value \(as the players know it\): /);
  assert.doesNotMatch(list, /Silver toad idol/);
});

test('the stash and purse in the save: records both ways, the round trip, the schema', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loot-'));
  const pack = path.join(ROOT, 'examples/sample-pack'), src = path.join(ROOT, 'examples/campaigns/keep-test');
  fs.cpSync(src, tmp, { recursive: true });
  const loot = { purse: { gp: 12, sp: 3 }, items: [{ id: '0mwe00000-0a', ref: 'item/healing-potion-minor', qty: 2, found: { where: { area: 'B12' } } }, { id: '0mwe00001-0b', name: 'Silver toad idol', price: { cp: 2500 }, identified: false }] };
  fs.writeFileSync(path.join(tmp, 'loot.json'), JSON.stringify({ $schema: '../../../schemas/loot.schema.json', ...loot }));
  const c = readCampaign(pack, tmp);
  assert.deepEqual(c.loot, loot);
  assert.ok(c.content['item/healing-potion-minor'], 'the stash\'s library items come with the campaign');
  const r = campaignRecords({ ...c, now: 'T' });
  assert.deepEqual(r['state/purse'], loot.purse);
  assert.equal(r['loot/0mwe00001-0b'].name, 'Silver toad idol');
  assert.deepEqual(saveFromRecords(r).loot, loot);
  assert.deepEqual(roundTrip(pack, tmp), []);
  writeSave(r, tmp, { now: new Date('2026-11-13T00:00:00Z') });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, 'loot.json'), 'utf8')).items, loot.items);
  assert.ok(SAVE_COLLECTIONS.includes('loot'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const v = ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/loot.schema.json'), 'utf8')));
  assert.ok(v(loot), JSON.stringify(v.errors));
  assert.ok(!v({ items: [{ id: '0mwe00000-0a' }] }), 'an item needs a ref or a name');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('PF2E item words: kind, usage, stats by kind, identify DCs, what a look can tell', () => {
  assert.deepEqual([levelDC(0), levelDC(3), levelDC(10), levelDC(25), levelDC(6, 'uncommon'), levelDC(6, 'rare'), levelDC(6, 'unique')], [14, 18, 27, 50, 24, 27, 32]);
  assert.equal(itemKind(item('longsword')), 'Martial weapon · Sword');
  assert.equal(itemKind(CHAIN), 'Medium armor · Chain');
  assert.equal(itemKind(POTION), 'Potion');
  assert.equal(itemKind({ kind: 'equipment', usage: 'worncloak' }), 'Worn cloak');
  assert.equal(itemKind({ kind: 'treasure', category: 'gem' }), 'Gem');
  assert.equal(itemUsage(item('longsword')), '1 hand');
  assert.equal(itemUsage(item('shortbow')), '1+ hands');
  assert.deepEqual(itemStats(item('shortbow')), [['Damage', '1d6 piercing'], ['Range', '60 ft'], ['Reload', '0']]);
  assert.deepEqual(itemStats(CHAIN), [['AC', '+4'], ['Dex cap', '+1'], ['Check penalty', '−2'], ['Speed', '−5 ft'], ['Strength', '+3']]);
  assert.deepEqual(itemStats(item('steel-shield')), [['AC raised', '+2'], ['Hardness', '5'], ['HP', '20 (BT 10)']]);
  assert.deepEqual(itemStats(POTION), [['Heals', '1d8']]);
  assert.deepEqual(itemStats(POTION, false), [], 'a potion\'s effect waits for identifying');
  assert.deepEqual(itemStats(BACKPACK), [['Holds', '4 Bulk; the first 2 don\'t count']]);
  const spiral = item('ladys-spiral');
  assert.deepEqual(itemStats(spiral), [['Damage', '2d4 slashing'], ['Runes', '+1 striking disrupting']]);
  assert.deepEqual(itemStats(spiral, false), [['Damage', '1d4 slashing']], 'a whip\'s own damage, no runes');
  assert.deepEqual(seenTraits(['disarm', 'finesse', 'magical', 'fire', 'deadly-d10', 'potion', 'invested'], false), ['disarm', 'finesse', 'deadly-d10', 'potion']);
  assert.equal(unitCp({ sp: 1, per: 10 }), 1, 'ammunition priced for ten');
});

test('item details: secrecy per view, the GM\'s identify DC and sale price, items not in use, filter groups', () => {
  const p = { ref: 'item/healing-potion-minor', found: { from: 'the bugbear', where: { area: 'B12' }, game: { now: 1, label: 'Day 2' } } };
  const pd = lootDetails(p, C, 'player', L);
  assert.equal(pd.kind, 'Potion');
  assert.equal(pd.level, null);
  assert.deepEqual(pd.traits, ['consumable', 'potion'], 'its form, not its magic');
  assert.deepEqual(pd.stats, []);
  assert.equal(pd.text, '');
  assert.equal(pd.source, '');
  assert.equal(pd.identify, undefined, 'the DC is the GM\'s');
  assert.deepEqual(pd.found, p.found, 'players see where it was found');
  const gd = lootDetails(p, C, 'gm', L);
  assert.equal(gd.level, 1);
  assert.deepEqual(gd.identify, { by: 'magic', words: 'Identify Magic', dc: 15 });
  assert.equal(gd.sell, '2 gp');
  assert.match(gd.text, /ruby-red/);
  assert.equal(gd.source, 'Pathfinder GM Core');
  // identified: players see all of it
  const kd = lootDetails({ ...p, identified: true }, C, 'player', L);
  assert.equal(kd.level, 1);
  assert.deepEqual(kd.stats, [['Heals', '1d8']]);
  // misidentified: the false words, nothing of the truth
  const md = lootDetails({ ...p, misidentified: { name: 'Potion of Swimming', text: 'You can swim.' } }, C, 'player', L);
  assert.equal(md.text, 'You can swim.');
  assert.equal(md.level, null);
  // carried: a character's own gear is known; stowed armor is not in use
  assert.equal(lootDetails({ ref: 'item/chain-mail', carry: 'stowed' }, C, 'player', L, { carriedBy: true }).notInUse, 'stowed: not in use');
  assert.equal(lootDetails({ ref: 'item/rope', carry: 'stowed' }, C, 'player', L, { carriedBy: true }).notInUse, undefined, 'rope in a pack is fine');
  assert.equal(lootDetails({ name: 'Ring', traits: ['invested', 'magical'], carry: 'worn', invested: false }, {}, 'gm', L, { carriedBy: true }).notInUse, 'not invested: not working');
  assert.deepEqual([lootGroup(item('longsword')), lootGroup(CHAIN), lootGroup(item('steel-shield')), lootGroup(POTION), lootGroup({ kind: 'treasure' }), lootGroup(ROPE)], ['weapon', 'armor', 'armor', 'consumable', 'treasure', 'other']);
  // HTML: the summary line, traits with their glossary words, stats, the GM's line
  assert.equal(summaryHtml(gd), '<div class="lt-sum">Potion · 1 hand · level 1</div>');
  const html = detailsHtml(gd, lootView(p, C, 'gm', L), { gm: true, trait: (t) => ({ label: t, text: t === 'potion' ? 'Potion: drunk' : '' }) });
  assert.match(html, /title="Potion: drunk">potion</);
  assert.match(html, /<dt>Heals<\/dt><dd>1d8<\/dd>/);
  assert.match(html, /Identify: Identify Magic DC 15 · Sells for 2 gp/);
  assert.match(html, /Found on the bugbear, in B12, Day 2 · Source: Pathfinder GM Core/);
  assert.doesNotMatch(detailsHtml(pd, lootView(p, C, 'player', L), { gm: false }), /Identify|Sells/);
  const f = filtersHtml({ group: 'weapon', unknown: false }, { weapon: 2, consumable: 1 }, 1);
  assert.match(f, /data-group="weapon" aria-pressed="true">Weapons <span>2/);
  assert.match(f, /All <span>3/);
  assert.doesNotMatch(f, /Treasure/, 'only the kinds there are');
  assert.match(f, /Unidentified <span>1/);
});

test('moves stack: a taken item joins the character\'s matching stack, a put-back one the stash\'s (the user, 2026-11-13)', () => {
  const DAG = { kind: 'weapon', name: 'Dagger', bulk: 0.1, price: { sp: 2 } }, CC = { ...C, 'item/dagger': DAG };
  // Kerra's own dagger (no carry: in use) and a dagger from the stash
  const t = takeLoot({ ref: 'item/dagger', qty: 2, found: { from: 'the cultist' } }, [{ ref: 'item/dagger' }], 1, null, L, CC);
  assert.deepEqual(t.items, [{ ref: 'item/dagger', qty: 2 }], 'one line, the stack keeps its carry');
  // a known healing potion from the stash joins a character's own potions
  const k = takeLoot({ ref: 'item/healing-potion-minor', identified: true }, [{ ref: 'item/healing-potion-minor', carry: 'stowed' }], 1, null, L, CC);
  assert.equal(k.items.length, 1);
  assert.equal(k.items[0].qty, 2);
  // an unknown one does not join known ones
  assert.equal(takeLoot({ ref: 'item/healing-potion-minor' }, [{ ref: 'item/healing-potion-minor' }], 1, null, L, CC).items.length, 2);
  // put back: onto the stash's matching stack, whoever added it and wherever it was found
  const stash = [{ id: 'a', data: { ref: 'item/dagger', found: { from: 'the cultist' }, added: { at: 'T', by: 'claude' } } }, { id: 'b', data: { ref: 'item/healing-potion-minor' } }];
  const back = putBack([{ ref: 'item/dagger', qty: 2, carry: 'held' }], 0, 2, L, CC);
  assert.deepEqual(stashMerge(stash, back.stashItem, CC, L), { id: 'a', data: { ref: 'item/dagger', qty: 3, found: { from: 'the cultist' }, added: { at: 'T', by: 'claude' } } });
  // a character's known potion does not join the stash's unknown ones
  const kp = putBack([{ ref: 'item/healing-potion-minor' }], 0, 1, L, CC);
  assert.equal(stashMerge(stash, kp.stashItem, CC, L).id, null);
  // give: onto the other's matching stack
  assert.deepEqual(giveLoot([{ ref: 'item/dagger', carry: 'held' }], 0, [{ ref: 'item/dagger', carry: 'stowed' }], 1, L, CC).to, [{ ref: 'item/dagger', carry: 'stowed', qty: 2 }]);
});

test('the party\'s worth: known values in the stash and on every character, coins, and the GM\'s truth', () => {
  const stash = [{ id: 'a', data: { ref: 'item/healing-potion-minor', qty: 3 } }, { id: 'b', data: { ref: 'item/healing-potion-minor', qty: 2, identified: true } }, { id: 'c', data: { name: 'Idol', price: { cp: 2500 }, identified: false, appraised: true } }];
  const actors = [{ actor: { items: [{ ref: 'item/chain-mail' }, { ref: 'item/rope', qty: 2 }] }, coins: { gp: 5 } }];
  const pv = partyValue(stash, actors, { gp: 10, sp: 5 }, C, L, 'player');
  assert.equal(pv.stash, 800 + 2500, 'two known potions and the appraised idol; three unknown potions do not count');
  assert.equal(pv.carried, 600 + 100, 'a character\'s own gear is known: chain mail and two ropes');
  assert.equal(pv.unknown, 1);
  assert.equal(pv.coins, 1550);
  assert.equal(pv.total, pv.items + 1550);
  const tv = partyValue(stash, actors, {}, C, L, 'gm');
  assert.equal(tv.stash, 2000 + 2500, 'the GM knows every value');
  const html = valueHtml(pv, L, tv);
  assert.match(html, /Party loot value<\/b><span class="lt-coins lt-big">40 gp<\/span>/);
  assert.match(html, /1 not appraised/);
  assert.match(html, /GM: true value 52 gp/);
  assert.doesNotMatch(valueHtml(pv, L, null), /GM/);
});

