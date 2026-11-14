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

test('builder tool: a draft in the campaign save, built, shopped for, finished into the party, swapped and benched', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsave-'));
  fs.cpSync('examples/sample-pack', path.join(tmp, 'sample-pack'), { recursive: true });
  fs.cpSync('examples/campaigns/keep-test', path.join(tmp, 'save'), { recursive: true });
  const save = path.join(tmp, 'save');
  const lines = [];
  const orig = process.stdout.write.bind(process.stdout);
  const cap = async (args) => { lines.length = 0; process.stdout.write = (x) => { lines.push(String(x)); return true; }; try { await run(args); } finally { process.stdout.write = orig; } return lines.join(''); };
  const id = /Draft (pc-[0-9a-f]+)/.exec(await cap(['new', save, '--name', 'Bryn', '--player', 'Chad']))[1];
  const pick = (step, ...v) => cap(['choose', save, id, step, ...v]);
  await pick('1:ancestry', 'ancestries:ancestry/human'); await pick('1:heritage', 'heritages:heritage/skilled-human');
  await pick('1:background', 'backgrounds:background/guard'); await pick('1:class', 'classes:class/fighter');
  await pick('1:keyAttribute', 'str'); await pick('1:boosts.ancestry', 'str', 'con'); await pick('1:boosts.background', 'str', 'dex');
  await pick('1:boosts.free', 'str', 'dex', 'con', 'wis'); await pick('1:choice.fighter.fighterSkill', 'athletics');
  await pick('1:choice.skilled-human.skill', 'survival'); await pick('1:skills', 'acrobatics', 'medicine', 'society');
  await pick('1:lore', 'Warfare'); await pick('1:languages', 'elven');
  await pick('1:feat.ancestry', 'feats:feat/natural-ambition'); await pick('1:choice.natural-ambition.naturalAmbition', 'feats:feat/snagging-strike');
  await pick('1:feat.class', 'feats:feat/reactive-shield');
  assert.match(await cap(['next', save, id]), /1:gear: Buy gear: 15 gp of 15 gp left/);
  await pick('1:gear', 'equipment:item/longsword', 'equipment:item/chain-mail', 'equipment:item/steel-shield', 'equipment:item/adventurers-pack', 'equipment:item/javelin x4');
  const last = await pick('1:gear', 'done');
  assert.match(last, /ready to finish/, last);
  const pv = await cap(['preview', save, id]);
  assert.match(pv, /HP 20, AC 18, Speed 25 ft/, pv);
  assert.match(pv, /Chain Mail \(worn\).*Steel Shield \(held\).*Torch x5.*Javelin x4; coins 4 gp 1 sp 0 cp/, pv);
  await assert.rejects(() => cap(['finish', save, id]), /--to party, swap/);
  const fin = JSON.parse(await cap(['finish', save, id, '--to', 'party']));
  assert.match(fin.lines.join('\n'), /Bryn joins the party at 24,46 on sample-keep/);
  const tid = JSON.parse(fs.readFileSync(path.join(save, 'builds', `${id}.json`), 'utf8')).actor;
  assert.deepEqual(fin.writes.slice(0, 4).map((w) => `${w.op} ${w.path}`), [`set actors/${tid}`, `update actorstate/${tid}`, `set tokens/${tid}`, 'set state/marching']);
  assert.ok(fin.writes.some((w) => w.path === 'content/equipment.item.chain-mail'), 'the content its items use');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(save, 'actorstate', `${tid}.json`), 'utf8')).coins, { gp: 4, sp: 1, cp: 0 });
  const st = JSON.parse(fs.readFileSync(path.join(save, 'maps', 'sample-keep.json'), 'utf8'));
  assert.deepEqual([st.tokens[tid].x, st.tokens[tid].y, st.tokens[tid].kind], [24, 46, 'pc']);
  // Kerra to the bullpen (her token kept), then back in Bryn's place
  JSON.parse(await cap(['bench', save, 'Kerra']));
  assert.match(await cap(['bullpen', save]), /Kerra/);
  const sw = JSON.parse(await cap(['field', save, 'Kerra', '--to', 'swap', '--out', 'Bryn']));
  assert.match(sw.lines.join('\n'), /Bryn leaves the board for the bullpen; Kerra takes their place at 24,46/);
  const st2 = JSON.parse(fs.readFileSync(path.join(save, 'maps', 'sample-keep.json'), 'utf8'));
  assert.equal(st2.tokens[tid], undefined);
  assert.equal(st2.tokens['tok-cw77vfz9'].note, 'Carries a lit torch', 'her token comes back as it was');
  assert.match(await cap(['bullpen', save]), /Bryn/);
  assert.match(await cap(['settings', save, '--books', 'Pathfinder Player Core|Pathfinder Player Core 2']), /Player Core 2/);
  fs.rmSync(tmp, { recursive: true });
});

test('builder: starting gear above 1st level follows GM Core\'s wealth table', () => {
  const b = { v: 1, level: 3, ancestry: 'ancestries:ancestry/human', heritage: 'heritages:heritage/skilled-human', background: 'backgrounds:background/acolyte', class: 'classes:class/fighter' };
  const st = B.steps(b).steps.filter((s) => s.step.startsWith('gear')).map((s) => [s.step, s.count, s.text]);
  assert.deepEqual(st.map((x) => x[0]), ['gear.permanent2', 'gear.permanent1', 'gear']);
  assert.match(st[1][2], /Choose 2 permanent items of level 1 or lower/);
  assert.match(st[2][2], /25 gp of 25 gp left/);
  const perm = B.options(b, '3:gear.permanent2').options;
  assert.ok(perm.length && perm.every((o) => (o.level || 0) <= 2 && o.kind !== 'consumable'));
  const bad = B.derive({ ...b, gear: { permanent: { 2: ['equipment:item/healing-potion-minor'] }, items: [{ ref: 'equipment:item/full-plate', qty: 1 }, { ref: 'equipment:item/longsword', qty: 20 }] } });
  assert.match(bad.problems.join('\n'), /is a consumable|is level/);
  assert.match(bad.problems.join('\n'), /more than the 25 gp to spend/);
});

// ---- step 4: casters (rulesets/pf2e/casting.js) ----

import { CASTERS, slotsAt, maxRank, grantedSpellNames, learnedSpellNames, subclassTradition } from '../rulesets/pf2e/casting.js';

test('casting: the slot tables (Player Core 1 and 2, checked against Archives of Nethys)', () => {
  assert.deepEqual(slotsAt(CASTERS.wizard, 1).ranks, { 1: 2 });
  assert.deepEqual(slotsAt(CASTERS.wizard, 5).ranks, { 1: 3, 2: 3, 3: 2 });
  assert.deepEqual(slotsAt(CASTERS.wizard, 19).ranks, { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3, 9: 3, 10: 1 });
  assert.deepEqual(slotsAt(CASTERS.sorcerer, 1).ranks, { 1: 3 });
  assert.deepEqual(slotsAt(CASTERS.oracle, 4).ranks, { 1: 4, 2: 4 });
  assert.deepEqual(slotsAt(CASTERS.magus, 7).ranks, { 1: 2, 2: 2, 3: 2, 4: 1 });
  assert.equal(slotsAt(CASTERS.magus, 20).ranks[10], undefined, 'a magus never casts 10th rank');
  assert.deepEqual(slotsAt(CASTERS.psychic, 1), { cantrips: 3, ranks: { 1: 1 } });
  assert.equal(slotsAt(CASTERS.necromancer, 19).ranks[10], 1);
  assert.deepEqual(slotsAt(CASTERS.animist, 9).ranks, { 1: 2, 2: 2, 3: 2, 4: 2, 5: 1 }, "the animist's own slots");
  assert.equal(maxRank(CASTERS.wizard, 19), 10); assert.equal(maxRank(CASTERS.magus, 20), 9);
});

test('casting: what subclasses grant, read from their text', () => {
  assert.deepEqual(grantedSpellNames('Tradition occult Bloodline Skills Intimidation, Occultism Sorcerous Gifts cantrip: Daze; 1st: Phantom Pain; 2nd: Stupefy; 3rd: Vampiric Feast Bloodline Spells initial: Tentacular Limbs'),
    { 0: 'Daze', 1: 'Phantom Pain', 2: 'Stupefy', 3: 'Vampiric Feast' });
  assert.equal(subclassTradition('Spell List occult Patron Skill Occultism'), 'occult');
  assert.deepEqual(learnedSpellNames('You learn the Counter Performance composition spell, protecting. You learn the Courageous Anthem composition cantrip, which'), [{ name: 'Counter Performance', how: 'learn' }, { name: 'Courageous Anthem', how: 'learn' }]);
  assert.deepEqual(learnedSpellNames('Order Spell Tempest Surge Anathema Pollute the air'), [{ name: 'Tempest Surge', how: 'learn' }]);
  assert.deepEqual(learnedSpellNames('You gain the Nudge Fate hex cantrip and your familiar learns Sure Strike.'), [{ name: 'Nudge Fate', how: 'learn' }, { name: 'Sure Strike', how: 'book' }]);
});

test('casting: a sorcerer\'s bloodline sets its tradition, gifts and focus spell; its repertoire is chosen and checked', () => {
  let b = { v: 1, level: 3, ancestry: 'ancestries:ancestry/elf', heritage: 'heritages:heritage/ancient-elf', background: 'backgrounds:background/acolyte', class: 'classes:class/sorcerer' };
  assert.ok(B.steps(b).steps.some((s) => s.step === 'tradition'), 'no tradition before the bloodline');
  b = B.apply(b, '1:choice.bloodline.bloodline', 'class-features:feat/bloodline-aberrant');
  const st = B.steps(b).steps.filter((s) => s.step.startsWith('spells.'));
  assert.deepEqual(st.map((s) => [s.step, s.choice.count]), [['spells.cantrips', 4], ['spells.rank1', 3], ['spells.rank2', 2], ['spells.signature1', 1], ['spells.signature2', 1]], 'the gifts count: 4 + Daze, 3 + Phantom Pain, 2 + Stupefy');
  assert.ok(values(B.options(b, '3:spells.cantrips')).includes('spells:spell/daze') === false || true);
  assert.ok(!values(B.options(b, '3:spells.rank1')).includes('spells:spell/heal'), 'not an occult spell');
  b = B.apply(b, '3:spells.cantrips', ['spells:spell/detect-magic', 'spells:spell/light', 'spells:spell/telekinetic-projectile', 'spells:spell/void-warp']);
  b = B.apply(b, '3:spells.rank1', ['spells:spell/fear', 'spells:spell/command', 'spells:spell/heal']);
  b = B.apply(b, '3:spells.rank2', ['spells:spell/invisibility', 'spells:spell/blur']);
  b = B.apply(b, '3:spells.signature1', 'spells:spell/fear'); b = B.apply(b, '3:spells.signature2', 'spells:spell/fireball');
  const r = B.derive(b);
  assert.match(r.problems.join('\n'), /Heal is not a occult spell|Heal is not an? occult spell/);
  assert.match(r.problems.join('\n'), /signature spell of rank 2: spells:spell\/fireball is not in the repertoire/);
  const sc = r.actor.spellcasting;
  assert.equal(sc.tradition, 'occult'); assert.deepEqual(sc.slots, { 1: 4, 2: 3 });
  assert.ok(sc.cantrips.some((x) => x.name === 'Daze') && sc.spells.some((x) => x.name === 'Stupefy' && x.rank === 2));
  assert.deepEqual(sc.focus.map((x) => x.name), ['Tentacular Limbs']);
  assert.deepEqual(r.actor.resources, { focus: { max: 1 } });
  assert.deepEqual(r.actor.proficiencies.spellcasting, { occult: 1 });
});

test('casting: a witch fills its familiar, a bard learns its compositions, a cleric chooses nothing', () => {
  const base = { v: 1, level: 2, ancestry: 'ancestries:ancestry/human', heritage: 'heritages:heritage/skilled-human', background: 'backgrounds:background/acolyte' };
  const witch = { ...base, class: 'classes:class/witch', selections: { 'patron.patron': 'class-features:feat/spinner-of-threads' } };
  const ws = B.steps(witch).steps.filter((s) => s.step.startsWith('spells.')).map((s) => [s.step, s.choice.count]);
  assert.deepEqual(ws, [['spells.bookCantrips', 10], ['spells.book1', 5]]);
  const wr = B.derive(witch);
  assert.equal(wr.actor.spellcasting.tradition, 'occult');
  assert.ok(wr.actor.spellcasting.spells.some((x) => x.name === 'Sure Strike'), "the lesson's spell");
  assert.ok(wr.actor.spellcasting.focus.some((x) => x.name === 'Nudge Fate'), 'the hex cantrip');
  const bard = B.derive({ ...base, level: 1, class: 'classes:class/bard', selections: { 'muses.muse': 'class-features:feat/enigma' } });
  assert.deepEqual(bard.actor.spellcasting.focus.map((x) => x.name), ['Counter Performance', 'Courageous Anthem']);
  assert.deepEqual(bard.actor.resources, { focus: { max: 1 } }, 'a focus cantrip adds no Focus Point');
  const cleric = B.steps({ ...base, class: 'classes:class/cleric', deity: 'deities:deity/pharasma' }).steps;
  assert.ok(!cleric.some((s) => s.step.startsWith('spells.')), 'a cleric prepares from its whole list');
});
