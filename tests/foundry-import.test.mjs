// The full Foundry PF2E import (tools/import/foundry-pf2e.mjs --release): converters for every kind, links between
// documents, and tracking from one import to the next (new, changed by Foundry, changed by us, renamed, retired,
// overrides). Original fixtures shaped like Foundry's data (invented names and numbers), never its real data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importRelease, importDocs, applyOverride } from '../tools/import/foundry-pf2e.mjs';
import { convertRule, predicateOk } from '../tools/import/foundry/convert.mjs';
import { validateOpenContent } from '../tools/validate.mjs';
import { kindDir } from '../rulesets/pf2e/content.js';

const PUB = { license: 'ORC', title: 'Imaginary Core', remaster: true };
const SPELL = { _id: 'spellAAAAAAAAAA1', name: 'Ember Spray', type: 'spell', system: {
  level: { value: 2 }, traits: { value: ['fire', 'concentrate'], traditions: ['arcane'] }, time: { value: '2' }, range: { value: '30 feet' },
  area: { type: 'cone', value: 15 }, defense: { save: { statistic: 'reflex', basic: true } }, damage: { 0: { formula: '3d6', type: 'fire', kinds: ['damage'] } },
  heightening: { type: 'interval', interval: 1, damage: { 0: '1d6' } }, duration: { value: '' }, publication: PUB, description: { value: '<p>Sparks.</p>' } } };
const ANCESTRY = { _id: 'ancAAAAAAAAAAAA1', name: 'Mossfolk', type: 'ancestry', system: { hp: 8, size: 'sm', speed: 20, boosts: { 0: { value: ['wis'] }, 1: { value: ['str', 'dex'] } }, flaws: { 0: { value: ['cha'] } }, languages: { value: ['common'] }, additionalLanguages: { count: 1, value: ['sylvan'] }, items: { a: { name: 'Moss Skin', level: 0, uuid: 'Compendium.pf2e.ancestryfeatures.Item.Moss Skin' } }, publication: PUB, traits: { value: ['humanoid'] } } };
const FEATURE = { _id: 'featAAAAAAAAAAA1', name: 'Moss Skin', type: 'feat', system: { category: 'ancestryfeature', level: { value: 0 }, actionType: { value: 'passive' }, actions: { value: null }, publication: PUB, traits: { value: [] }, rules: [{ key: 'Resistance', type: 'fire', value: 1 }] } };
const HERITAGE = { _id: 'herAAAAAAAAAAAA1', name: 'Deep Moss', type: 'heritage', system: { ancestry: { name: 'Mossfolk', uuid: 'Compendium.pf2e.ancestries.Item.ancAAAAAAAAAAAA1' }, publication: PUB, traits: { value: [] } } };
const HAZARD = { _id: 'hazAAAAAAAAAAAA1', name: 'Creaking Floor', type: 'hazard', system: { attributes: { ac: { value: 12 }, hardness: 2, hasHealth: true, hp: { max: 8 }, stealth: { value: 5, details: '' } }, details: { level: { value: 0 }, isComplex: false, disable: '<p>@Check[thievery|dc:15]</p>', publication: PUB }, saves: { reflex: { value: 3 } }, traits: { value: ['trap'] } }, items: [{ name: 'Creak', type: 'action', system: { actionType: { value: 'reaction' }, description: { value: 'It creaks.' }, traits: { value: [] } } }] };
const NPC = { _id: 'npcAAAAAAAAAAAA1', name: 'Hedge Witch', type: 'npc', system: {
  abilities: { str: { mod: 0 }, dex: { mod: 1 }, con: { mod: 1 }, int: { mod: 2 }, wis: { mod: 3 }, cha: { mod: 0 } },
  attributes: { ac: { value: 15 }, hp: { max: 20 }, speed: { value: 25 } }, details: { level: { value: 1 }, publication: PUB, languages: { value: ['common'] } },
  perception: { mod: 7 }, saves: { fortitude: { value: 4 }, reflex: { value: 5 }, will: { value: 9 } }, traits: { size: { value: 'med' }, value: ['human'] } },
  items: [
    { _id: 'entryAAAAAAAAAA1', name: 'Primal Spells', type: 'spellcastingEntry', system: { tradition: { value: 'primal' }, prepared: { value: 'prepared' }, spelldc: { dc: 17, value: 9 } } },
    { name: 'Ember Spray', type: 'spell', _stats: { compendiumSource: 'Compendium.pf2e.spells-srd.Item.spellAAAAAAAAAA1' }, system: { location: { value: 'entryAAAAAAAAAA1' }, level: { value: 2 } } },
    { name: 'Lost Cantrip', type: 'spell', _stats: { compendiumSource: 'Compendium.pf2e.spells-srd.Item.goneAAAAAAAAAAA1' }, system: { location: { value: 'entryAAAAAAAAAA1' }, level: { value: 1 }, description: { value: 'Old.' } } },
    { name: 'Sickle', type: 'weapon', system: { quantity: 1, description: { value: '' } } },
  ] };
const SYSTEM = { version: '1.0.0', packs: [
  { name: 'spells-srd', path: 'packs/spells', type: 'Item' }, { name: 'ancestries', path: 'packs/ancestries', type: 'Item' },
  { name: 'ancestryfeatures', path: 'packs/ancestry-features', type: 'Item' }, { name: 'heritages', path: 'packs/heritages', type: 'Item' },
  { name: 'hazards', path: 'packs/hazards', type: 'Actor' }, { name: 'npc-gallery', path: 'packs/npc-gallery', type: 'Actor' },
  { name: 'macros', path: 'packs/macros', type: 'Macro' },
] };
const clone = (x) => JSON.parse(JSON.stringify(x));

/** A Foundry checkout in miniature: system.pf2e.json and packs/pf2e/<folder>/*.json. */
function makeRelease(dir, docs, version = '1.0.0') {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'system.pf2e.json'), JSON.stringify({ ...SYSTEM, version }));
  for (const [folder, list] of Object.entries(docs)) {
    fs.mkdirSync(path.join(dir, 'packs', 'pf2e', folder), { recursive: true });
    for (const d of list) fs.writeFileSync(path.join(dir, 'packs', 'pf2e', folder, `${d.name.toLowerCase().replace(/[^a-z]+/g, '-')}.json`), JSON.stringify(d));
  }
}
const DOCS = () => ({ spells: [clone(SPELL)], ancestries: [clone(ANCESTRY)], 'ancestry-features': [clone(FEATURE)], heritages: [clone(HERITAGE)], hazards: [clone(HAZARD)], 'npc-gallery': [clone(NPC)], macros: [{ _id: 'macAAAAAAAAAAAA1', name: 'Roll It', type: 'script', command: '' }] });
const readDoc = (dest, rel) => JSON.parse(fs.readFileSync(path.join(dest, rel), 'utf8'));

test('content kinds: physical items share item/, every other kind has its own folder', () => {
  assert.deepEqual(['weapon', 'kit', 'spell', 'creature', 'campaign-feature', 'nonsense'].map(kindDir), ['item', 'item', 'spell', 'creature', 'campaign-feature', undefined]);
});

test('rules with conditions our engine cannot test are kept, not run', () => {
  assert.equal(predicateOk(['a', { or: ['b', { not: 'c' }] }]), true);
  assert.equal(predicateOk([{ gte: ['self:level', 5] }, { lt: ['hp-percent', 50] }, { gte: ['self:condition:frightened', 2] }]), true, 'facts our engine knows');
  assert.equal(predicateOk([{ lte: ['target:distance', 30] }]), false, 'a fact it does not know yet');
  assert.equal(convertRule({ key: 'FlatModifier', selector: 'ac', value: 1, predicate: [{ lte: ['target:distance', 30] }] }).rule.key, 'unsupported');
  assert.deepEqual(convertRule({ key: 'Sense', selector: 'darkvision', predicate: ['night'] }).rule, { key: 'sense', type: 'darkvision', when: ['night'] });
  assert.deepEqual(convertRule({ key: 'Resistance', type: 'fire', value: 5, predicate: ['raging'] }).rule, { key: 'resistance', type: 'fire', value: 5, when: ['raging'] });
  assert.deepEqual(convertRule({ key: 'Sense', selector: 'scent', range: 30, acuity: 'imprecise' }).rule, { key: 'sense', type: 'scent', range: 30, acuity: 'imprecise' });
});

test('a whole release: every kind converted, links resolved, the report, then a clean re-import changes nothing', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'rvtt-rel-')), rel = path.join(t, 'foundry'), dest = path.join(t, 'content');
  makeRelease(rel, DOCS());
  const r = importRelease(rel, { dest, today: '2026-11-12' });
  assert.deepEqual(r.report.errors, []);
  assert.equal(r.report.counts.new, 6);
  assert.equal(r.report.counts.skipped, 1, 'the macro');
  const spell = readDoc(dest, 'spells/spell/ember-spray.json');
  assert.deepEqual([spell.rank, spell.actions, spell.range, spell.area, spell.defense, spell.damage[0].formula, spell.heightening.every, spell.text], [2, 2, '30 feet', { type: 'cone', value: 15 }, { save: 'reflex', basic: true }, '3d6', 1, 'Sparks.']);
  assert.equal(spell.level, undefined, 'spells have a rank, not a level');
  const anc = readDoc(dest, 'ancestries/ancestry/mossfolk.json');
  assert.deepEqual([anc.size, anc.speed, anc.boosts, anc.flaws, anc.features], ['small', 20, [['wis'], ['str', 'dex']], [['cha']], [{ name: 'Moss Skin', level: 0, ref: 'ancestry-features:feat/moss-skin' }]]);
  assert.deepEqual(readDoc(dest, 'heritages/heritage/deep-moss.json').ancestry, { name: 'Mossfolk', ref: 'ancestries:ancestry/mossfolk' });
  const haz = readDoc(dest, 'hazards/hazard/creaking-floor.json');
  assert.deepEqual([haz.stats.ac, haz.stats.hp, haz.stats.stealth, haz.disable, haz.items[0].actions], [12, 8, { value: 5 }, 'DC 15 Thievery check', 'reaction']);
  const npc = readDoc(dest, 'npc-gallery/creature/hedge-witch.json');
  const casting = npc.items.find((i) => i.kind === 'spellcasting');
  assert.deepEqual(casting, { kind: 'spellcasting', name: 'Primal Spells', tradition: 'primal', type: 'prepared', dc: 17, attack: 9, spells: [{ name: 'Ember Spray', rank: 2, ref: 'spells:spell/ember-spray' }, { name: 'Lost Cantrip', rank: 1, text: 'Old.' }] });
  assert.deepEqual(npc.items.find((i) => i.kind === 'gear'), { kind: 'gear', name: 'Sickle', type: 'weapon' });
  assert.equal(r.report.unresolved['spells-srd'], 1, 'the link to a spell Foundry no longer has');
  // the manifest, the report, and the validator
  const man = readDoc(dest, 'import-manifest.json');
  assert.deepEqual(man.foundry, { version: '1.0.0', commit: null, imported: '2026-11-12' });
  assert.equal(man.documents['spells/spellAAAAAAAAAA1'].key, 'spell/ember-spray');
  const md = fs.readFileSync(path.join(dest, 'import-report.md'), 'utf8');
  assert.match(md, /Release \*\*1\.0\.0\*\*/); assert.match(md, /the first import/); assert.match(md, /a Foundry macro/);
  assert.deepEqual(validateOpenContent(dest).errors, []);
  // the same release again: nothing changes, nothing is rewritten
  const again = importRelease(rel, { dest, today: '2026-11-13' });
  assert.deepEqual([again.report.counts.new, again.report.counts.unchanged, again.written], [0, 6, 0]);
  fs.rmSync(t, { recursive: true, force: true });
});

test('the next release: new, changed by Foundry, renamed, retired, and our corrections', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'rvtt-rel2-')), rel = path.join(t, 'foundry'), dest = path.join(t, 'content');
  makeRelease(rel, DOCS());
  importRelease(rel, { dest, today: '2026-11-12' });
  // a correction we keep: the hazard's AC (written against the original Foundry gave us)
  const man = readDoc(dest, 'import-manifest.json');
  fs.mkdirSync(path.join(dest, 'overrides', 'hazards', 'hazard'), { recursive: true });
  fs.writeFileSync(path.join(dest, 'overrides', 'hazards', 'hazard', 'creaking-floor.json'), JSON.stringify({ why: 'the book says AC 14', foundry: man.documents['hazards/hazAAAAAAAAAAAA1'].original, set: { 'stats.ac': 14 } }));
  const fixed = importRelease(rel, { dest, today: '2026-11-12' });
  assert.equal(readDoc(dest, 'hazards/hazard/creaking-floor.json').stats.ac, 14);
  assert.deepEqual([fixed.report.counts.ours, fixed.report.ours[0].key, fixed.report.overrides.length], [1, 'hazard/creaking-floor', 0], 'our change, not Foundry\'s');
  // release 1.1.0: a spell fixed, the heritage renamed, the feature removed, a new spell, the hazard touched by Foundry
  const next = DOCS();
  next.spells[0].system.range.value = '60 feet';
  next.spells.push({ ...clone(SPELL), _id: 'spellBBBBBBBBBB1', name: 'Frost Spray' });
  next.heritages[0].name = 'Deepmoss';
  next['ancestry-features'] = [];
  next.hazards[0].system.attributes.hardness = 3;
  makeRelease(rel, next, '1.1.0');
  const dry = importRelease(rel, { dest, today: '2026-12-01', dryRun: true });
  assert.equal(readDoc(dest, 'spells/spell/ember-spray.json').range, '30 feet', 'a dry run writes nothing');
  const r = importRelease(rel, { dest, today: '2026-12-01' });
  assert.deepEqual(dry.report.counts, r.report.counts);
  // the ancestry's own data is the same, but its link to the removed feature is gone: a change on our side
  assert.deepEqual(r.report.counts, { new: 1, changed: 2, ours: 1, renamed: 1, unchanged: 1, retired: 1, skipped: 1 });
  assert.deepEqual(r.report.ours.map((x) => x.key), ['ancestry/mossfolk']);
  assert.deepEqual(r.report.new.map((x) => x.key), ['spell/frost-spray']);
  assert.deepEqual(r.report.changed.map((x) => x.key).sort(), ['hazard/creaking-floor', 'spell/ember-spray']);
  assert.equal(readDoc(dest, 'spells/spell/ember-spray.json').range, '60 feet');
  // renamed: the new file, and the old one kept, pointing to it
  assert.deepEqual(r.report.renamed, [{ source: 'heritages', key: 'heritage/deepmoss', name: 'Deepmoss', from: 'heritage/deep-moss' }]);
  assert.deepEqual(readDoc(dest, 'heritages/heritage/deep-moss.json').retired, { since: '1.1.0', replacedBy: 'heritages:heritage/deepmoss' });
  assert.equal(readDoc(dest, 'heritages/heritage/deepmoss.json').retired, undefined);
  // retired: kept so saves still load, marked, and in the manifest
  assert.deepEqual(readDoc(dest, 'ancestry-features/feat/moss-skin.json').retired, { since: '1.1.0' });
  assert.equal(readDoc(dest, 'import-manifest.json').documents['ancestry-features/featAAAAAAAAAAA1'].retired, '1.1.0');
  assert.equal(readDoc(dest, 'ancestries/ancestry/mossfolk.json').features[0].ref, undefined, 'a link to a removed document keeps the name only');
  // our correction still applies, and Foundry's change to that document asks us to review it
  assert.equal(readDoc(dest, 'hazards/hazard/creaking-floor.json').stats.ac, 14);
  assert.equal(r.report.overrides.length, 1);
  assert.match(fs.readFileSync(path.join(dest, 'import-report.md'), 'utf8'), /Corrections to review[\s\S]*Creaking Floor/);
  assert.match(fs.readFileSync(path.join(dest, 'import-report.md'), 'utf8'), /compared with the previous import of 1\.0\.0/);
  assert.deepEqual(validateOpenContent(dest).errors, []);
  // a retired document that comes back is new again
  makeRelease(rel, DOCS(), '1.2.0');
  const back = importRelease(rel, { dest, today: '2026-12-02' });
  assert.ok(back.report.new.some((x) => x.key === 'feat/moss-skin'));
  assert.equal(readDoc(dest, 'ancestry-features/feat/moss-skin.json').retired, undefined);
  // an override for a document that no longer exists is an error
  fs.mkdirSync(path.join(dest, 'overrides', 'spells', 'spell'), { recursive: true });
  fs.writeFileSync(path.join(dest, 'overrides', 'spells', 'spell', 'no-such.json'), JSON.stringify({ set: { rank: 3 } }));
  assert.match(importRelease(rel, { dest, dryRun: true }).report.errors.join('\n'), /override spells\/spell\/no-such: no document/);
  fs.rmSync(t, { recursive: true, force: true });
});

test('overrides: set and remove fields; a place that no longer exists is a problem', () => {
  const doc = { stats: { ac: 10, saves: { fortitude: 2 } }, items: [{ name: 'a' }, { name: 'b' }] };
  assert.deepEqual(applyOverride(doc, { set: { 'stats.ac': 12, 'items.1.name': 'B', 'stats.saves.will': 4 }, remove: ['stats.saves.fortitude'] }), []);
  assert.deepEqual(doc, { stats: { ac: 12, saves: { will: 4 } }, items: [{ name: 'a' }, { name: 'B' }] });
  assert.equal(applyOverride(doc, { set: { 'stats.gone.x': 1 }, remove: ['nope'] }).length, 2);
});

test('slugs stay stable: a second document of the same name gets the start of its Foundry id', () => {
  const a = { ...clone(FEATURE), _id: 'aaaaaaAAAAAAAAAA' }, b = { ...clone(FEATURE), _id: 'bbbbbbBBBBBBBBBB' };
  const { docs } = importDocs([{ file: 'a', data: a }, { file: 'b', data: b }]);
  assert.deepEqual(docs.map((d) => d.key).sort(), ['feat/moss-skin', 'feat/moss-skin-bbbbbb']);
});
