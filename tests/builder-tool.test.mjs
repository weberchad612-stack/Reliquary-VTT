// The step-by-step character builder (rulesets/pf2e/builder.js builder(), tools/builder.mjs): options, choices, the
// campaign's books, rarity, the remaster, the deity, dedications, and a draft built and finished from the tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { builder } from '../rulesets/pf2e/builder.js';
import { run } from '../tools/builder.mjs';

const B = builder();
const values = (o) => o.options.map((x) => x.value);
const HUMAN = { v: 1, level: 1, ancestry: 'ancestries:ancestry/human', heritage: 'heritages:heritage/skilled-human', background: 'backgrounds:background/acolyte' };

test('builder: steps come grouped, ancestries and heritages are listed with their rarity', () => {
  const { steps } = B.steps({ v: 1, level: 1 });
  assert.deepEqual(steps.map((s) => [s.id, s.count]).slice(0, 4), [['1:ancestry', 1], ['1:background', 1], ['1:class', 1], ['1:boosts.free', 4]]);
  const anc = B.options({ v: 1, level: 1 }, '1:ancestry').options;
  assert.ok(anc.find((o) => o.value === 'ancestries:ancestry/dwarf' && !o.needs));
  assert.match(anc.find((o) => o.value === 'ancestries:ancestry/android').needs, /GM's leave \(rare\)/);
  const her = values(B.options({ v: 1, level: 1, ancestry: 'ancestries:ancestry/dwarf' }, '1:heritage'));
  assert.ok(her.includes('heritages:heritage/rock-dwarf') && her.includes('heritages:heritage/changeling'), 'its own and the versatile heritages');
  assert.ok(!her.includes('heritages:heritage/skilled-human'));
});

test('builder: choices go into the build, boosts into their open slots, and can be taken back', () => {
  let b = B.apply({ v: 1, level: 1 }, '1:ancestry', 'ancestries:ancestry/dwarf');
  b = B.apply(b, '1:boosts.ancestry', 'str');
  assert.deepEqual(b.boosts.ancestry, [null, null, 'str'], 'the dwarf\'s two fixed boosts keep their slots');
  assert.throws(() => B.apply(b, '1:boosts.ancestry', 'dex'), /more boost/);
  b = B.apply(b, '1:boosts.free', ['str', 'dex', 'con', 'wis']);
  assert.deepEqual(b.boosts.free, ['str', 'dex', 'con', 'wis']);
  assert.deepEqual(B.options({ ...b, background: 'backgrounds:background/guard' }, '1:boosts.background').options.map((o) => o.value), ['cha', 'str']);
  b = B.clear(b, '1:boosts.free');
  assert.equal(b.boosts.free, undefined);
  assert.throws(() => B.apply(b, '1:nonsense', 'x'), /not a step/);
});

test('builder: class feats fit the class, hide unmet prerequisites, and archetype dedications wait their turn', () => {
  const fighter = { ...HUMAN, class: 'classes:class/fighter', keyAttribute: 'str', boosts: { ancestry: ['str', 'dex'], background: ['wis', 'str'], free: ['str', 'dex', 'con', 'wis'] } };
  const lv1 = values(B.options(fighter, '1:feat.class'));
  assert.ok(lv1.includes('feats:feat/reactive-shield') && lv1.includes('feats:feat/sudden-charge'));
  assert.ok(!lv1.includes('feats:feat/arcane-sense') && !lv1.includes('feats:feat/fighter-dedication'), 'not a fighter feat, or a dedication of its own class at 1st level');
  const rogue = { ...fighter, level: 6, class: 'classes:class/rogue', keyAttribute: 'dex', levels: { 2: { feats: { class: 'feats:feat/fighter-dedication' } } } };
  const at4 = B.options(rogue, '4:feat.class', { all: true }).options;
  assert.ok(at4.find((o) => o.value === 'feats:feat/basic-maneuver' && !o.blocked), 'the archetype\'s own feats are open');
  assert.match(at4.find((o) => o.value === 'feats:feat/wizard-dedication').blocked.join(), /two more Fighter feats come before another dedication/);
  assert.ok(!values(B.options(rogue, '4:feat.class')).includes('feats:feat/wizard-dedication'));
  const skill = B.options(fighter, '2:feat.skill', { all: true }).options;
  assert.match(skill.find((o) => o.value === 'feats:feat/arcane-sense').blocked.join(), /prerequisite not met: trained in Arcana/);
});

test('builder: the campaign\'s books and the remaster gate the options', () => {
  const only = builder({ settings: { sources: ['Pathfinder Player Core'] } });
  const anc = only.options({ v: 1, level: 1 }, '1:ancestry', { all: true }).options;
  assert.ok(anc.find((o) => o.value === 'ancestries:ancestry/dwarf' && !o.blocked));
  assert.match(anc.find((o) => o.value === 'ancestries:ancestry/android').blocked.join(), /not in the campaign's books/);
  // legacy options with no remaster version are offered; those that rely on alignment are not
  const feats = B.options({ ...HUMAN, class: 'classes:class/fighter', level: 1 }, '1:feat.ancestry', { all: true }).options;
  assert.ok(feats.some((o) => o.legacy && !o.blocked), 'legacy feats are offered freely');
  const all = B.options({ ...HUMAN, class: 'classes:class/champion', level: 20 }, '20:feat.class', { all: true }).options;
  assert.ok(all.some((o) => (o.blocked || []).some((w) => /alignment/.test(w))), 'something relies on alignment');
});

test('builder: a cleric chooses a deity, and the deity decides the font and the warpriest\'s grants', () => {
  const cleric = { ...HUMAN, class: 'classes:class/cleric', selections: { 'doctrine.doctrine': 'class-features:feat/warpriest' } };
  assert.ok(B.steps(cleric).steps.some((s) => s.id === '1:deity'));
  const torag = { ...cleric, deity: 'deities:deity/torag' };
  assert.deepEqual(values(B.options(torag, '1:choice.divine-font.divineFont')), ['heal']);
  assert.deepEqual(values(B.options({ ...cleric, deity: 'deities:deity/irori' }, '1:choice.divine-font.divineFont')), ['heal', 'harm']);
  const t = B.derive(torag);
  assert.ok(!t.actor.feats.some((f) => f.slug === 'deadly-simplicity'), 'a warhammer is not simple');
  assert.deepEqual(t.notGranted.map((x) => x.feat), ['Deadly Simplicity']);
  const p = B.derive({ ...cleric, deity: 'deities:deity/pharasma' });
  assert.ok(p.actor.feats.some((f) => f.slug === 'deadly-simplicity'), 'a dagger is');
  assert.equal(p.actor.proficiencies.skills.medicine, 1, 'Pharasma\'s skill');
  assert.ok(p.rollOptions.includes('deity:primary:favored-weapon:dagger'));
});

test('builder: a background\'s Lore written only in its text, and a choice of records (a dwarf\'s clan)', () => {
  const guard = { ...HUMAN, background: 'backgrounds:background/guard', class: 'classes:class/fighter' };
  assert.deepEqual(values(B.options(guard, '1:lore')), ['Legal', 'Warfare']);
  assert.equal(B.derive(B.apply(guard, '1:lore', 'Warfare')).actor.proficiencies.lore.warfare, 1);
  const dwarf = { v: 1, level: 1, ancestry: 'ancestries:ancestry/dwarf', heritage: 'heritages:heritage/rock-dwarf', class: 'classes:class/fighter', levels: { 1: { feats: { ancestry: 'feats:feat/clan-lore' } } } };
  assert.ok(values(B.options(dwarf, '1:choice.clan-lore.clan')).includes('breakiron'));
  const s = B.derive(B.apply(dwarf, '1:choice.clan-lore.clan', 'breakiron')).actor.proficiencies.skills;
  assert.equal(s.crafting, 1); assert.equal(s.survival, 1);
});

test('builder tool: a draft in the campaign save, built and finished', async () => {
  const save = fs.mkdtempSync(path.join(os.tmpdir(), 'bsave-'));
  fs.writeFileSync(path.join(save, 'campaign.json'), JSON.stringify({ v: 1, id: 't', title: 'T', ruleset: 'pf2e' }));
  const lines = [];
  const orig = process.stdout.write.bind(process.stdout);
  const cap = async (args) => { lines.length = 0; process.stdout.write = (x) => { lines.push(String(x)); return true; }; try { await run(args); } finally { process.stdout.write = orig; } return lines.join(''); };
  const id = /Draft (pc-[0-9a-f]+)/.exec(await cap(['new', save, '--name', 'Kerra', '--player', 'Chad']))[1];
  const pick = (step, ...v) => cap(['choose', save, id, step, ...v]);
  await pick('1:ancestry', 'ancestries:ancestry/human'); await pick('1:heritage', 'heritages:heritage/skilled-human');
  await pick('1:background', 'backgrounds:background/guard'); await pick('1:class', 'classes:class/fighter');
  await pick('1:keyAttribute', 'str'); await pick('1:boosts.ancestry', 'str', 'con'); await pick('1:boosts.background', 'str', 'dex');
  await pick('1:boosts.free', 'str', 'dex', 'con', 'wis'); await pick('1:choice.fighter.fighterSkill', 'athletics');
  await pick('1:choice.skilled-human.skill', 'survival'); await pick('1:skills', 'acrobatics', 'medicine', 'society');
  await pick('1:lore', 'Warfare'); await pick('1:languages', 'elven');
  await pick('1:feat.ancestry', 'feats:feat/natural-ambition'); await pick('1:choice.natural-ambition.naturalAmbition', 'feats:feat/snagging-strike');
  const last = await pick('1:feat.class', 'feats:feat/reactive-shield');
  assert.match(last, /ready to finish/, last);
  assert.match(await cap(['preview', save, id]), /HP 20, AC 15/);
  assert.match(await cap(['options', save, id, '1:feat.class', '--search', 'shield', '--all']), /reactive-shield.*BLOCKED: taken already/);
  const fin = await cap(['finish', save, id, '--actor', 'tok-kerra']);
  assert.match(fin, /Finished Kerra/);
  const actor = JSON.parse(fs.readFileSync(path.join(save, 'actors', 'tok-kerra.json'), 'utf8'));
  assert.equal(actor.name, 'Kerra');
  assert.equal(JSON.parse(fs.readFileSync(path.join(save, 'builds', `${id}.json`), 'utf8')).status, 'finished');
  assert.match(await cap(['settings', save, '--books', 'Pathfinder Player Core|Pathfinder Player Core 2']), /Player Core 2/);
  fs.rmSync(save, { recursive: true });
});
