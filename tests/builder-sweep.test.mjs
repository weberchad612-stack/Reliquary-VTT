// The character builder's completeness sweep and text check (rulesets/pf2e/sweep.js, textcheck.js, textchoices.js)
// and the gaps they found: choices written only in text, choices built from the character's own flags, weapon
// filters, a feature not offered twice, skills applied level by level, a background's variants.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { builder } from '../rulesets/pf2e/builder.js';
import { sweepClass } from '../rulesets/pf2e/sweep.js';
import { textCheckOrigins } from '../rulesets/pf2e/textcheck.js';
import { textChoices, textGrants } from '../rulesets/pf2e/textchoices.js';

const B = builder();
const doc = (k) => B.get(k);
const at = (level, extra) => ({ v: 1, level, ancestry: 'ancestries:ancestry/human', heritage: 'heritages:heritage/skilled-human', background: 'backgrounds:background/acolyte', ...extra });
const issues = (list) => list.filter((i) => i.kind !== 'note');

test('sweep: the classes whose choices hang on flags, weapons and later features build with every option', () => {
  for (const c of ['kineticist', 'thaumaturge', 'summoner', 'commander', 'exemplar', 'inventor']) {
    const k = `classes:class/${c}`;
    assert.deepEqual(issues(sweepClass(B, k, { level: 1, base: { approvals: [{ what: k }] } })), [], c);
  }
});

test('sweep: every heritage and background says nothing the builder does not act on', () => {
  assert.deepEqual(textCheckOrigins(B), []);
});

test('text choices: a tradition and its cantrip, a Lore and a skill, a word from a list', () => {
  assert.deepEqual(textChoices(doc('heritages:heritage/wellspring-gnome').text).map((c) => [c.kind, c.options || c.from]), [['tradition', ['arcane', 'divine', 'occult']], ['cantrip', 'tradition']]);
  assert.deepEqual(textChoices(doc('heritages:heritage/lorekeeper-shisk').text).map((c) => [c.kind, c.expertAt, c.attributes]), [['lore', 5, undefined], ['skill', 5, ['int', 'wis']]]);
  assert.deepEqual(textChoices(doc('heritages:heritage/camouflage-tripkee').text).map((c) => [c.flag, c.options]), [['terrain', ['aquatic', 'forest', 'swamp']]]);
  // a yaoguai's other form comes with a feat: not the heritage's own choice
  assert.deepEqual(textChoices(doc('heritages:heritage/born-of-celestial').text), []);
});

test('text choices: a wellspring gnome picks a tradition, then an innate cantrip of it', () => {
  let b = at(1, { ancestry: 'ancestries:ancestry/gnome', heritage: 'heritages:heritage/wellspring-gnome', class: 'classes:class/fighter' });
  assert.ok(B.derive(b).pending.some((p) => p.step === 'choice.wellspring-gnome.tradition'));
  b = B.apply(b, '1:choice.wellspring-gnome.tradition', 'occult');
  const opts = B.options(b, '1:choice.wellspring-gnome.cantrip').options.map((o) => o.value);
  assert.ok(opts.includes('spells:spell/daze') && !opts.includes('spells:spell/electric-arc'));
  b = B.apply(b, '1:choice.wellspring-gnome.cantrip', 'spells:spell/daze');
  const r = B.derive(b);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.actor.granted.find((g) => g.innate), { name: 'Daze', kind: 'spell', ref: 'spells:spell/daze', from: 'Wellspring Gnome', innate: 'occult' });
});

test('text choices: a lorekeeper shisk names a Lore and a skill, both expert at 5th', () => {
  let b = at(5, { ancestry: 'ancestries:ancestry/shisk', heritage: 'heritages:heritage/lorekeeper-shisk', class: 'classes:class/fighter' });
  b = B.apply(b, '1:choice.lorekeeper-shisk.lore', 'Shisk History');
  b = B.apply(b, '1:choice.lorekeeper-shisk.skill', 'medicine');
  const r = B.derive(b);
  assert.equal(r.actor.proficiencies.lore['shisk-history'], 2);
  assert.equal(r.actor.proficiencies.skills.medicine, 2);
});

test('text grants: an innate cantrip, a background feat, a background\'s variants', () => {
  const elf = B.derive(at(1, { ancestry: 'ancestries:ancestry/elf', heritage: 'heritages:heritage/seer-elf', class: 'classes:class/fighter' }));
  assert.equal(elf.actor.granted.find((g) => g.innate).name, 'Detect Magic');
  assert.ok(B.derive(at(1, { background: 'backgrounds:background/aeronaut', class: 'classes:class/fighter' })).actor.feats.some((f) => f.name === 'Assurance'));
  // a 2nd-level feat a background gives at 1st
  const aa = B.derive(at(1, { background: 'backgrounds:background/archival-assistant', class: 'classes:class/fighter' }));
  assert.deepEqual(aa.problems, []);
  assert.ok(aa.actor.feats.some((f) => f.name === 'Assured Identification'));
  assert.equal(textGrants(doc('backgrounds:background/brevic-noble').text).variants.length, 6);
  // Foundry's lineage choice gives the skill and feat; the Lore comes from the text
  const bn = B.derive(B.apply(at(1, { background: 'backgrounds:background/brevic-noble', class: 'classes:class/fighter' }), '1:choice.brevic-noble.lineage', 'orlovsky'));
  assert.deepEqual(bn.actor.proficiencies.lore, { brevoy: 1 });
  assert.ok(bn.actor.feats.some((f) => f.name === 'Group Impression'));
  assert.ok(!bn.pending.some((p) => p.step === 'lore'));
});

test('kineticist: a dual gate cannot take one element twice; a threshold offers the gates the character has', () => {
  let b = at(5, { class: 'classes:class/kineticist', selections: { 'kinetic-gate.kineticGate': 'dual-gate', 'kinetic-gate.elementOne': 'class-features:feat/air-gate' } });
  assert.ok(!B.options(b, '1:choice.kinetic-gate.elementTwo').options.some((o) => o.value === 'class-features:feat/air-gate'));
  b = { ...b, selections: { 'kinetic-gate.kineticGate': 'single-gate', 'kinetic-gate.elementOne': 'class-features:feat/air-gate', 'gates-threshold.gatesThreshold': 'expand' } };
  assert.deepEqual(B.options(b, '5:choice.gates-threshold.element').options.map((o) => o.value), ['air']);
  const imp = B.options(b, '5:choice.gates-threshold.impulseExpand').options.map((o) => o.value);
  assert.ok(imp.length && imp.every((k) => (doc(k).traits || []).includes('air')));
});

test('weapon filters: an exemplar\'s ikon weapons, a thaumaturge\'s one-handed weapon', () => {
  let b = at(1, { class: 'classes:class/exemplar', selections: { 'divine-spark-and-ikons.firstIkon': 'class-features:feat/mortal-harvest', 'mortal-harvest.mortalHarvest': 'granted' } });
  const harvest = B.options(b, '1:choice.mortal-harvest.grantedIkon').options.map((o) => o.value);
  assert.ok(harvest.includes('equipment:item/sickle') && !harvest.includes('equipment:item/longsword'));
  b = at(1, { class: 'classes:class/thaumaturge', selections: { 'first-implement-and-esoterica.implement': 'class-features:feat/weapon' } });
  const one = B.options(b, '1:choice.weapon.weaponImplement').options.map((o) => o.value);
  assert.ok(one.includes('equipment:item/longsword') && !one.includes('equipment:item/greatsword'));
});

test('skills go level by level: a skill trained by Intelligence at 5th can be raised later', () => {
  const b = at(20, { class: 'classes:class/rogue' });
  const r0 = B.derive(b);
  const free = ['arcana', 'crafting', 'diplomacy', 'medicine', 'nature', 'occultism', 'society', 'survival'].find((s) => !r0.actor.proficiencies.skills[s]);
  const levels = { 5: { trained: [free] }, 13: { skillIncrease: free } };
  const r = B.derive({ ...b, levels });
  assert.ok(!r.problems.some((p) => p.includes(free)), r.problems.join('; '));
});

test('a genie sorcerer\'s variable granted spells follow the genie type; Battle Creed has no First Doctrine gap', () => {
  const g = doc('class-features:feat/bloodline-genie').text;
  assert.ok(fs.existsSync('content/pf2e/spells/spell/enlarge.json'));
  const r = B.derive(at(5, { class: 'classes:class/sorcerer', selections: { 'bloodline.bloodline': 'class-features:feat/bloodline-genie', 'bloodline-genie.genie': 'ifrit' } }));
  assert.ok(!r.unsupported.some((u) => /variable/.test(u.why)), JSON.stringify(r.unsupported));
  assert.ok(g.includes('Ifrit'));
  const c = B.derive(at(1, { class: 'classes:class/cleric', deity: 'deities:deity/sarenrae', selections: { 'doctrine.doctrine': 'class-features:feat/battle-creed' } }));
  assert.ok(!c.unsupported.some((u) => /firstDoctrine/.test(u.why)));
});
