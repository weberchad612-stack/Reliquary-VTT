// Item and hazard matching (tools/advimport/lootmatch.mjs with the PF2E reader). Invented text and a stub content index.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchLoot } from '../tools/advimport/lootmatch.mjs';
import * as pf2e from '../rulesets/pf2e/bookimport.js';

test('loot: prices after names, treasure text, hazard numbers (PF2E reader)', () => {
  assert.deepEqual(pf2e.priceAfter('a silver comb (2 gp, 5 sp) and a rope', 'silver comb'), { gp: 2, sp: 5 });
  assert.equal(pf2e.priceAfter('a silver comb and a rope (1 sp)', 'silver comb'), null, 'a price after another item is not this one\'s');
  assert.equal(pf2e.priceCp({ gp: 2, sp: 5 }), 250);
  assert.match(pf2e.treasureText('X1. Hall\nIntro.\nTreasure\nA lantern of ghost light.\nX2. Next\nmore'), /lantern of ghost light/);
  assert.deepEqual(pf2e.hazardNumbers('Notice DC 20 Perception check\nDisable DC 18 Athletics or DC 18 Thievery to stop it\nAC 14; HP 30'), { stealth: 20, disable: [18, 18], ac: 14, hp: 30 });
  assert.deepEqual(pf2e.hazardContent({ stats: { ac: 14, stealth: { value: 10 } }, disable: 'DC 18 Athletics check or DC 18 Thievery check' }), { stealth: 20, stealthMod: 10, disable: [18, 18], ac: 14, hp: null });
});

test('loot: wrong prices, possible refs, unplaced treasure and hazard differences are listed', () => {
  const docs = {
    'item/lantern-ghost': { name: 'Lantern of Ghost Light', price: { gp: 10 }, traits: [] },
    'item/silver-comb': { name: 'Silver Comb', price: { gp: 1 }, traits: [] },
    'item/shadow': { name: 'Shadow', traits: ['rune'] },
    'hazard/bell': { name: 'Cracked Bell', stats: { ac: 12, stealth: { value: 8 } }, disable: 'DC 15 Thievery' },
  };
  const content = { doc: (k) => docs[k] || null, byName: new Map([
    ['lantern of ghost light', { key: 'item/lantern-ghost' }], ['silver comb', { key: 'item/silver-comb' }], ['shadow', { key: 'item/shadow' }], ['cracked bell', { key: 'hazard/bell' }]]) };
  const idx = { rooms: { X1: { rects: [] } } };
  const areas = { X1: { key: 'X1', pages: [4], text: 'X1. Hall\nThe silver comb (2 gp) lies here.\nCRACKED BELL\nNotice DC 20 Perception check\nAC 12; HP 8\nTreasure\nA lantern of ghost light hangs in the shadow.\n' } };
  const adv = { objects: [
    { room: 'X1', name: 'Shelf', items: [{ ref: 'item/silver-comb' }, { name: 'Silver comb' }, { ref: 'item/missing' }] },
    { room: 'X1', name: 'The bell', hazard: 'hazard/bell' },
  ] };
  const f = matchLoot(adv, areas, idx, content, pf2e).map((x) => `${x.kind}: ${x.what}`);
  assert.ok(f.some((x) => /^price: Silver Comb: the book says \{"gp":2\}/.test(x)));
  assert.ok(f.some((x) => /^propose: Shelf: "Silver comb" could be item\/silver-comb/.test(x)));
  assert.ok(f.some((x) => /^missing: Shelf: no content item "item\/missing"/.test(x)));
  assert.ok(f.some((x) => /^unplaced: "lantern of ghost light"/.test(x)));
  assert.ok(!f.some((x) => /"shadow"/.test(x)), 'a rune\'s plain-word name is not treasure');
  assert.ok(f.some((x) => /^hazard: The bell \(hazard\/bell\): Stealth\/Notice DC 20 \(content 18\)/.test(x)));
});
