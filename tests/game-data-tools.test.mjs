// Game data around the rules: the Foundry PF2E importer (on original fixtures shaped like Foundry's data, never
// its real data), Claude's actor and check tools, saves with actors, and the validator's checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importDocs, cleanText, convertRule, convertValue, privateTarget } from '../tools/import/foundry-pf2e.mjs';
import { loadGame, creature, runCommand } from '../tools/actor.mjs';
import { resolveCheck, statOf } from '../tools/check.mjs';
import { validate } from '../tools/validate.mjs';
import { buildRecords, writeSave, verifySave } from '../tools/campaign.mjs';
import { contentFromRecords, contentPath, contentKey } from '../board/records.js';
import { prepareActor } from '../engine/rules/rules.js';
import { PF2E_SYSTEM } from '../rulesets/pf2e/system.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'examples/sample-pack'), KEEP = path.join(ROOT, 'examples/campaigns/keep-test');
const tmpCopy = () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'rvtt-gd-'));
  fs.cpSync(PACK, path.join(t, 'pack'), { recursive: true }); fs.cpSync(KEEP, path.join(t, 'save'), { recursive: true });
  return t;
};

// Original fixtures in Foundry PF2E's shapes (invented names and numbers)
const NPC = {
  _id: 'x1', name: 'Gloomfang Bat', type: 'npc', img: '',
  system: {
    abilities: { str: { mod: 1 }, dex: { mod: 4 }, con: { mod: 1 }, int: { mod: -4 }, wis: { mod: 2 }, cha: { mod: -2 } },
    attributes: { ac: { value: 16 }, hp: { max: 14, value: 14 }, speed: { value: 10, otherSpeeds: [{ type: 'fly', value: 30 }] }, weaknesses: [{ type: 'sonic', value: 3 }], immunities: [{ type: 'bleed' }], resistances: [{ type: 'cold', value: 2, exceptions: ['magical'] }] },
    details: { level: { value: 1 }, publicNotes: '<p>A bat with <strong>gloomy</strong> fangs.</p>', publication: { license: 'ORC', remaster: true, title: 'Imaginary Bestiary' }, languages: { value: [] } },
    perception: { mod: 8, senses: [{ type: 'echolocation', acuity: 'precise', range: 40 }] },
    saves: { fortitude: { value: 5 }, reflex: { value: 9 }, will: { value: 6 } },
    skills: { acrobatics: { base: 8 }, stealth: { base: 9, special: [{ base: 11, label: 'in darkness', predicate: ['darkness'] }] } },
    traits: { rarity: 'common', size: { value: 'sm' }, value: ['animal'] },
  },
  items: [
    { name: 'Fangs', type: 'melee', system: { bonus: { value: 9 }, damageRolls: { a: { damage: '1d6+2', damageType: 'piercing' } }, traits: { value: ['agile', 'finesse'] }, attackEffects: { value: ['gloom-drain'] } } },
    { name: 'Gloom Drain', type: 'action', system: { actionType: { value: 'action' }, actions: { value: 1 }, traits: { value: ['void'] }, description: { value: '<p>The target attempts a @Check[fortitude|dc:17|basic] save or becomes @UUID[Compendium.pf2e.conditionitems.Item.Drained]{Drained 1} for [[/gmr 1d4 #rounds]]{1d4 rounds}; it takes @Damage[(1d6)[void]] damage.</p><hr /><p>Area @Template[emanation|distance:10].</p>' }, rules: [{ key: 'FlatModifier', selector: 'attack', type: 'status', value: 1, predicate: ['dark'] }, { key: 'RollOption', option: 'bat' }] } },
    { name: 'Innate Spells', type: 'spellcastingEntry', system: { description: { value: '' } } },
    { name: 'Cave Lore', type: 'lore', system: { mod: { value: 7 } } },
  ],
};
const ARMOR = { name: 'Quilted Coat', type: 'armor', system: { acBonus: 1, dexCap: 3, checkPenalty: 0, speedPenalty: 0, strength: 0, category: 'light', group: null, bulk: { value: 1 }, price: { value: { sp: 5 } }, traits: { value: ['comfort'] }, publication: { license: 'ORC', title: 'Imaginary Armoury' }, description: { value: '<p>Soft &amp; warm.</p>' }, rules: [] } };
const FEAT = { name: 'Thick Hide', type: 'feat', system: { level: { value: 1 }, traits: { value: ['general'] }, publication: { license: 'OGL', title: 'Imaginary Feats' }, description: { value: '' }, rules: [{ key: 'FlatModifier', selector: 'hp', value: '@actor.level' }, { key: 'Resistance', type: 'fire', value: 'max(1, @actor.level)' }, { key: 'FlatModifier', selector: 'ac', value: '@item.system.level.value' }, { key: 'BaseSpeed', selector: 'swim', value: 15 }, { key: 'Sense', selector: 'darkvision' }] } };

test('Foundry markup becomes plain text with checks, damage, links and templates in words', () => {
  const t = cleanText(NPC.items[1].system.description.value);
  assert.match(t, /DC 17 basic Fortitude save/);
  assert.match(t, /becomes Drained 1 for 1d4 rounds/);
  assert.match(t, /takes 1d6 void damage/);
  assert.match(t, /---/);
  assert.match(t, /Area 10-foot emanation/);
  assert.equal(cleanText('<p>a &amp; b</p><p>c</p>'), 'a & b\nc');
});

test('rule elements: ours where we can, kept untouched (and reported) where not', () => {
  assert.equal(convertValue('-@item.badge.value'), '-@value');
  assert.equal(convertValue('min(-1 * @actor.level,-1) * @item.badge.value'), 'min(-1 * @level,-1) * @value');
  assert.equal(convertValue('@item.system.level.value'), null, 'data we do not have');
  assert.deepEqual(convertRule({ key: 'FlatModifier', selector: 'attack', type: 'status', value: 1, predicate: ['dark'] }).rule, { key: 'modifier', selector: 'attack-roll', type: 'status', value: 1, when: ['dark'] });
  assert.deepEqual(convertRule({ key: 'Weakness', type: 'silver', value: 5 }).rule, { key: 'weakness', type: 'silver', value: 5 });
  const kept = convertRule({ key: 'ChoiceSet', choices: [] });
  assert.equal(kept.rule.key, 'unsupported'); assert.deepEqual(kept.rule.foundry, { key: 'ChoiceSet', choices: [] }); assert.match(kept.why, /ChoiceSet/);
});

test('the importer converts creatures and items, keeps licences, and reports what it could not do', () => {
  const { docs, report } = importDocs([{ file: 'bat.json', data: NPC }, { file: 'coat.json', data: ARMOR }, { file: 'feat.json', data: FEAT },
    { file: 'c.json', data: { name: 'Clumsy', type: 'condition', system: {} } }, { file: 'h.json', data: { name: 'Trap', type: 'hazard', system: {} } },
    { file: 'pc.json', data: { name: 'Hero', type: 'character', system: {} } }, { file: 'bad.json', data: null }]);
  const by = Object.fromEntries(docs.map((d) => [d.key, d.doc]));
  const bat = by['creature/gloomfang-bat'];
  assert.equal(bat.size, 'small'); assert.equal(bat.level, 1);
  assert.deepEqual(bat.source, { title: 'Imaginary Bestiary', license: 'ORC', remaster: true, from: 'foundry-pf2e' });
  assert.deepEqual(bat.stats.speeds, { land: 10, fly: 30 });
  assert.deepEqual(bat.stats.skills.stealth, { value: 9, special: [{ value: 11, label: 'in darkness', when: ['darkness'] }] });
  assert.equal(bat.stats.skills['cave-lore'], 7);
  assert.deepEqual(bat.stats.iwr, { immunities: ['bleed'], weaknesses: [{ type: 'sonic', value: 3 }], resistances: [{ type: 'cold', value: 2, except: 'magical' }] });
  assert.deepEqual(bat.items[0], { kind: 'strike', name: 'Fangs', attack: 9, traits: ['agile', 'finesse'], damage: [{ dice: '1d6+2', type: 'piercing' }], effects: ['gloom-drain'] });
  assert.equal(bat.items[1].actions, 1);
  assert.equal(bat.items[1].rules[0].key, 'modifier'); assert.equal(bat.items[1].rules[1].key, 'unsupported');
  assert.equal(bat.text, 'A bat with gloomy fangs.');
  const coat = by['item/quilted-coat'];
  assert.deepEqual([coat.kind, coat.category, coat.acBonus, coat.dexCap, coat.source.license, coat.text], ['armor', 'light', 1, 3, 'ORC', 'Soft & warm.']);
  const feat = by['item/thick-hide'];
  assert.deepEqual(feat.rules.map((r) => r.key), ['modifier', 'resistance', 'unsupported', 'speed', 'sense']);
  assert.equal(report.converted.length, 3);
  assert.ok(report.flagged.some((f) => /RollOption/.test(f.what)));
  assert.ok(report.flagged.some((f) => /spellcastingEntry/.test(f.what)));
  assert.deepEqual(report.skipped.map((s) => s.why.split(' ')[0]).sort(), ['characters', 'conditions', 'hazards', 'not']);
  // an imported creature runs through the rules, its unsupported rules listed for Claude
  const p = prepareActor({ actor: { system: 'pf2e', kind: 'npc', base: 'creature/gloomfang-bat' }, content: by, ruleset: PF2E_SYSTEM.actors });
  assert.deepEqual([p.ac.value, p.hp.max.value, p.speeds.fly.value, p.problems.length], [16, 14, 30, 0]);
  assert.equal(p.unsupported.length, 1);
  // only private places
  assert.equal(privateTarget(path.join(ROOT, 'packs', 'abomination-vaults')), true);
  assert.equal(privateTarget(os.tmpdir()), true);
  assert.equal(privateTarget(path.join(ROOT, 'examples', 'sample-pack')), false);
  assert.equal(privateTarget(ROOT), false);
});

test('content records: keys and paths both ways', () => {
  assert.equal(contentPath('item/chain-mail'), 'content/item.chain-mail');
  assert.equal(contentKey('content/item.chain-mail'), 'item/chain-mail');
  const { records } = buildRecords(PACK, KEEP, { now: 't' });
  const content = contentFromRecords(records);
  assert.ok(content['creature/rat'] && content['item/longsword']);
  assert.ok(records['actors/tok-cw77vfz9'] && records['actorstate/tok-cw77vfz9'].hp === 40);
});

test('the actor tool: list, show, damage, heal, temporary HP, resources, shield, recovery', () => {
  const game = loadGame(PACK, KEEP);
  assert.match(runCommand(game, 'list', []).lines.join('\n'), /Kerra: HP 40\/47, Scratched/);
  const show = runCommand(game, 'show', ['Kerra']).lines.join('\n');
  assert.match(show, /AC 20 = 10 base \+ 1 Dexterity \(capped at 1\)/);
  assert.match(show, /Longsword attack 12/);
  // damage to the named NPC: lines use the name players know
  const d = runCommand(game, 'damage', ['Varsha Kell', '25', 'slashing']);
  assert.match(d.lines[0], /^Hooded Cultist: .*knocked out: dying 1/, 'uses the dying rules; named as players know her');
  assert.deepEqual(d.writes.map((w) => w.path), ['actorstate/tok-u1t8r9h7', 'tokens/tok-u1t8r9h7']);
  // a rat dies
  const r = runCommand(game, 'damage', ['Wet-Nosed Rat', '3']);
  assert.equal(r.writes.find((w) => w.path.startsWith('tokens/')).data.dead, true);
  assert.match(r.lines[1], /players see: Dead/);
  // several damage types at once, with a resistance
  assert.match(runCommand(game, 'damage', ['Cracked-Skull Skeleton', '0'], { parts: '6 slashing, 2 fire' }).lines[0], /6 slashing: resistance 5 → 1; 2 fire: resistance 5 → 0/);
  assert.match(runCommand(game, 'heal', ['Kerra', '10']).lines[0], /healed 7: 40 → 47 HP \(full\)/);
  assert.equal(runCommand(game, 'temp', ['Kerra', '4']).writes[0].data.temp, 4);
  assert.equal(runCommand(game, 'resource', ['Kerra', 'heroPoints', '-1']).writes[0].data.resources.heroPoints, 0);
  assert.throws(() => runCommand(game, 'resource', ['Kerra', 'heroPoints', '-2']), /only 1/);
  assert.throws(() => runCommand(game, 'resource', ['Kerra', 'mana', '1']), /no resource "mana"/);
  assert.equal(runCommand(game, 'shield', ['Kerra', 'raise']).writes[0].data.shieldRaised, true);
  assert.throws(() => runCommand(game, 'shield', ['Pip', 'raise']), /no shield/);
  assert.match(runCommand(game, 'recover', ['Kerra'], { roll: '10' }).lines[0], /not dying/);
  assert.throws(() => runCommand(game, 'damage', ['Rat', '1']), /no token is called "Rat"/);
  // the board's records over the save: the live numbers
  const live = loadGame(PACK, KEEP, { 'actorstate/tok-cw77vfz9': { hp: 12 }, 'tokens/tok-cw77vfz9': { ...game.tokens['tok-cw77vfz9'], effects: [{ id: 'frightened', value: 1 }] } });
  const k = creature(live, 'Kerra');
  assert.deepEqual([k.prepared.hp.value, k.prepared.ac.value], [12, 19]);
});

test('checks: totals, DCs from a target, the multiple attack penalty, degrees', () => {
  assert.deepEqual(resolveCheck({ mod: 7, dc: 15, roll: 12 }).degree, 'success');
  assert.equal(resolveCheck({ mod: 7, dc: 15, roll: 20 }).degree, 'critical-success');
  assert.throws(() => resolveCheck({ mod: 7, dc: 15, roll: 21 }), /d20/);
  const game = loadGame(PACK, KEEP), p = creature(game, 'Pip').prepared;
  assert.equal(statOf(p, 'spell-dc').value, 19);
  assert.equal(statOf(p, 'arcana').value, 11);
  assert.throws(() => statOf(p, 'flying'), /no statistic/);
});

test('saves keep actors and live state; the validator checks them', () => {
  const t = tmpCopy();
  const { records } = buildRecords(path.join(t, 'pack'), path.join(t, 'save'), { now: 't' });
  records['actorstate/tok-s85mkapz'] = { hp: 20 };
  delete records['actorstate/tok-gqrwstot'];
  writeSave(records, path.join(t, 'save'), { now: new Date('2026-11-12T12:00:00Z') });
  assert.equal(JSON.parse(fs.readFileSync(path.join(t, 'save/actorstate/tok-s85mkapz.json'), 'utf8')).hp, 20);
  assert.equal(fs.existsSync(path.join(t, 'save/actorstate/tok-gqrwstot.json')), false, 'a state no longer on the board is removed (the backup keeps it)');
  assert.ok(fs.existsSync(path.join(t, 'save/backups', fs.readdirSync(path.join(t, 'save/backups'))[0], 'actorstate/tok-gqrwstot.json')));
  assert.deepEqual(verifySave(records, path.join(t, 'pack'), path.join(t, 'save')), []);
  // validator: bad actors and state are caught
  const w = (f, d) => fs.writeFileSync(path.join(t, f), JSON.stringify(d));
  w('save/actors/tok-gqrwstot.json', { system: 'pf2e', kind: 'npc', base: 'creature/dragon' });
  w('save/actors/tok-qh4ah0b8.json', { system: 'pf2e', kind: 'character', name: 'X', level: 1, ancestry: { name: 'A', hp: 6, speed: 25 }, class: { name: 'C', hp: 8, keyAttribute: 'str' }, attributes: { str: 2 }, proficiencies: {}, items: [{ ref: 'item/vorpal-sword' }], feats: [{ name: 'Odd', rules: [{ key: 'glow' }, { key: 'modifier', selector: 'ac', value: '@nope +' }] }] });
  w('save/actors/kerra.json', { system: 'pf2e', kind: 'npc', base: 'creature/rat' });
  w('save/actorstate/tok-zzzzzzzz.json', { hp: 3 });
  w('save/actorstate/tok-cw77vfz9.json', { hp: 99, mana: 3 });
  const msgs = validate(path.join(t, 'pack'), { save: path.join(t, 'save') }).items.map((i) => `${i.level}: ${path.basename(i.file)}: ${i.msg}`).join('\n');
  assert.match(msgs, /error: tok-gqrwstot.json: base: no "creature\/dragon"/);
  assert.match(msgs, /error: tok-qh4ah0b8.json: items\[0\]: no "item\/vorpal-sword"/);
  assert.match(msgs, /error: tok-qh4ah0b8.json: .*unknown rule key "glow"/);
  assert.match(msgs, /error: tok-qh4ah0b8.json: .*value: /);
  assert.match(msgs, /error: kerra.json: "kerra" is not a token id/);
  assert.match(msgs, /error: tok-zzzzzzzz.json: live state for a creature with no actor/);
  assert.match(msgs, /error: tok-cw77vfz9.json: .*mana/);
  fs.rmSync(t, { recursive: true, force: true });
  // a pack's content: the ruleset's schema and duplicate slugs
  const t2 = tmpCopy();
  fs.writeFileSync(path.join(t2, 'pack/content/creature/broken.json'), JSON.stringify({ kind: 'creature', slug: 'broken', system: 'pf2e', name: 'Broken', level: 1, source: { title: 'x', license: 'original' }, stats: { ac: 10 } }));
  fs.writeFileSync(path.join(t2, 'pack/content/item/rat.json'), JSON.stringify({ kind: 'weapon', slug: 'longsword', system: 'pf2e', name: 'Dup', source: { title: 'x', license: 'original' } }));
  const m2 = validate(path.join(t2, 'pack')).items.map((i) => `${path.basename(i.file)}: ${i.msg}`).join('\n');
  assert.match(m2, /broken.json: .*hp/);
  assert.match(m2, /rat.json: its kind and slug make "item\/longsword"/);
  fs.rmSync(t2, { recursive: true, force: true });
});

test('open content: only ORC and OGL documents in public mode; the validator checks licences; packs draw on it', async () => {
  const { OPEN_LICENSES } = await import('../tools/import/foundry-pf2e.mjs');
  const { validateOpenContent } = await import('../tools/validate.mjs');
  const { readContent } = await import('../tools/campaign.mjs');
  assert.deepEqual([...OPEN_LICENSES], ['ORC', 'OGL']);
  const closed = { ...ARMOR, name: 'Secret Coat', system: { ...ARMOR.system, publication: { license: 'Paizo', title: 'X' } } };
  const none = { ...ARMOR, name: 'Unknown Coat', system: { ...ARMOR.system, publication: undefined } };
  const ogl = { ...NPC, name: 'Old Bat', system: { ...NPC.system, details: { ...NPC.system.details, publication: { license: 'OGL', title: 'Old Book' } } } };
  const { docs, report } = importDocs([{ file: 'a', data: NPC }, { file: 'b', data: closed }, { file: 'c', data: none }, { file: 'd', data: ogl }], { open: true });
  assert.deepEqual(docs.map((d) => d.key).sort(), ['creature/gloomfang-bat', 'creature/old-bat']);
  assert.ok(report.skipped.some((s) => s.name === 'Secret Coat' && /licence "Paizo" is not open/.test(s.why)));
  assert.ok(report.skipped.some((s) => s.name === 'Unknown Coat' && /none recorded/.test(s.why)));
  assert.equal(importDocs([{ file: 'b', data: closed }]).docs.length, 1, 'private packs take anything');
  // the validator: an open document must carry ORC or OGL
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'rvtt-open-'));
  const put = (p, d) => { fs.mkdirSync(path.dirname(path.join(t, p)), { recursive: true }); fs.writeFileSync(path.join(t, p), JSON.stringify(d)); };
  put('src-a/item/fine-coat.json', { kind: 'armor', slug: 'fine-coat', system: 'pf2e', name: 'Fine Coat', source: { title: 'X', license: 'ORC' } });
  put('src-a/item/shut-coat.json', { kind: 'armor', slug: 'shut-coat', system: 'pf2e', name: 'Shut Coat', source: { title: 'X', license: 'original' } });
  const msgs = validateOpenContent(t).items.map((i) => `${path.basename(i.file)}: ${i.msg}`).join('\n');
  assert.match(msgs, /shut-coat.json: licence "original": open content must be ORC or OGL/);
  assert.doesNotMatch(msgs, /fine-coat/);
  // the repository's own open content is valid
  assert.deepEqual(validateOpenContent(path.join(ROOT, 'content', 'pf2e')).errors, []);
  fs.rmSync(t, { recursive: true, force: true });
  // a pack lists open sources; its own content overrides them; a missing source is an error
  assert.throws(() => readContent({ content: ['pf2e/no-such-source'] }, PACK), /no open content "pf2e\/no-such-source"/);
  assert.ok(readContent({}, PACK)['creature/rat'], 'the pack\'s own content');
});
