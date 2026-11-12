// PF2E creatures: every statistic of the sample party worked out by hand from the rules and compared;
// creatures' printed numbers; what each condition does; damage, healing, temporary HP, dying and recovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareActor } from '../engine/rules/rules.js';
import { PF2E_SYSTEM } from '../rulesets/pf2e/system.js';
import { activeConditions, healthBand, CONDITION_RULES } from '../rulesets/pf2e/rules.js';
import { PF2E_CONDITIONS } from '../rulesets/pf2e/conditions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = PF2E_SYSTEM.actors;
const content = {};
for (const k of ['item', 'creature']) for (const f of fs.readdirSync(path.join(ROOT, 'examples/sample-pack/content', k))) { const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/sample-pack/content', k, f), 'utf8')); content[`${k}/${d.slug}`] = d; }
const actor = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/campaigns/keep-test/actors', id + '.json'), 'utf8'));
const KERRA = 'tok-cw77vfz9', PIP = 'tok-rf053o2i', LYRA = 'tok-s85mkapz', RAT = 'tok-gqrwstot', SKEL = 'tok-e6km1o1q', CULTIST = 'tok-u1t8r9h7', IMP = 'tok-6tf660tm';
const prep = (id, { state, effects } = {}) => prepareActor({ actor: actor(id), state, effects, content, ruleset: R });
const v = (p, key) => key.split('.').reduce((o, k) => o[k], p).value;

test('Kerra (human fighter 3) worked by hand', () => {
  const p = prep(KERRA);
  assert.deepEqual(p.problems, []);
  // AC 10 + Dex 2 capped at 1 by chain mail + trained in medium armour (2 + level 3) + chain mail +4 = 20
  assert.equal(p.ac.value, 20);
  // Fortitude: Con 2 + expert (4 + 3) = 9; Reflex: Dex 2 + 7 = 9; Will (Bravery, expert): Wis 1 + 7 = 8; Perception expert: 1 + 7 = 8
  assert.deepEqual([v(p, 'saves.fortitude'), v(p, 'saves.reflex'), v(p, 'saves.will'), p.perception.value], [9, 9, 8, 8]);
  // HP: human 8 + (fighter 10 + Con 2) x 3 + Toughness (level) 3 = 47
  assert.equal(p.hp.max.value, 47);
  // Speed 25: chain mail's -5 is cancelled because her Strength (+4) meets its Strength (+3)
  assert.equal(p.speeds.land.value, 25);
  // +1 longsword: Str 4 + expert martial 7 + potency 1 = +12, damage 1d8+4 slashing
  const ls = p.strikes.find((s) => s.name === 'Longsword');
  assert.equal(ls.attack.value, 12); assert.equal(ls.damage.formula, '1d8+4 slashing'); assert.deepEqual(ls.map, [0, -5, -10]);
  // dagger: agile, multiple attack penalty -4 and -8
  assert.deepEqual(p.strikes.find((s) => s.name === 'Dagger').map, [0, -4, -8]);
  // Athletics: Str 4 + expert 7 = 11; no armour check penalty (Strength met; chain mail is flexible anyway)
  assert.equal(p.skills.athletics.value, 11);
  // Stealth: Dex 2, untrained; chain mail is noisy, so its -2 check penalty applies despite her Strength
  assert.equal(p.skills.stealth.value, 0);
  assert.ok(p.skills.stealth.modifiers.some((m) => m.slug === 'armor-check-penalty' && m.applied));
  // Class DC: 10 + Str 4 + trained 5 = 19
  assert.equal(p.classDC.value, 19);
  assert.equal(p.lore.warfare.value, 5, 'Warfare Lore: Int 0 + trained 5');
  // a raised shield: +2 circumstance to AC
  assert.equal(prep(KERRA, { state: { shieldRaised: true } }).ac.value, 22);
  assert.equal(p.shield.hardness, 5); assert.equal(p.shield.maxHp, 20); assert.equal(p.shield.brokenAt, 10);
});

test('Pip (goblin wizard 3) and Lyra (elf ranger 3) worked by hand', () => {
  const p = prep(PIP);
  // AC 10 + Dex 2 + trained unarmored 5 + explorer's clothing 0 = 17; HP goblin 6 + (6 + 2) x 3 = 30
  assert.deepEqual([p.ac.value, p.hp.max.value, v(p, 'saves.fortitude'), v(p, 'saves.reflex'), v(p, 'saves.will'), p.perception.value], [17, 30, 7, 7, 8, 6]);
  // spells: Int 4 + trained 5 = +9 attack, DC 19; Arcana expert: 4 + 7 = 11
  assert.deepEqual([p.spell.attack.value, p.spell.dc.value, p.skills.arcana.value], [9, 19, 11]);
  // fist: finesse, so Dex 2 (higher than Str 0) + trained 5 = 7; staff: Str 0 + 5 = 5, 1d4
  assert.equal(p.strikes.find((s) => s.name === 'Fist').attack.value, 7);
  assert.equal(p.strikes.find((s) => s.name === 'Staff').damage.formula, '1d4 bludgeoning');
  assert.equal(p.size, 'small');
  assert.ok(p.senses.some((s) => s.type === 'darkvision'));
  const l = prep(LYRA);
  // AC 10 + Dex 4 (leather caps at 4) + trained light 5 + 1 = 20; HP elf 6 + (10 + 1) x 3 = 39; Speed 30
  assert.deepEqual([l.ac.value, l.hp.max.value, l.speeds.land.value], [20, 39, 30]);
  assert.deepEqual([v(l, 'saves.fortitude'), v(l, 'saves.reflex'), v(l, 'saves.will'), l.perception.value], [8, 11, 9, 9]);
  // shortbow: Dex 4 + trained 5 = +9, 1d6 with no Strength (not thrown, not propulsive)
  const bow = l.strikes.find((s) => s.name === 'Shortbow');
  assert.equal(bow.attack.value, 9); assert.equal(bow.damage.formula, '1d6 piercing'); assert.equal(bow.ranged, true);
  // dagger: finesse Dex 4 + 5 = +9, damage with Strength +1
  assert.equal(l.strikes.find((s) => s.name === 'Dagger').damage.formula, '1d4+1 piercing');
  // Stealth expert: 4 + 7 = 11; leather's -1 check penalty does not apply (Strength 0 needed, she has +1)
  assert.equal(l.skills.stealth.value, 11);
});

test('creatures: printed numbers, a base with its own name, unlisted skills from attributes', () => {
  const r = prep(RAT);
  assert.deepEqual([r.ac.value, r.hp.max.value, r.perception.value, v(r, 'saves.reflex'), r.speeds.land.value, r.speeds.climb.value], [14, 7, 4, 6, 25, 10]);
  assert.equal(r.strikes[0].attack.value, 6); assert.equal(r.strikes[0].damage.formula, '1d4+1 piercing');
  assert.equal(r.skills.thievery.value, 3, 'an unlisted skill: the attribute modifier (Dex +3)');
  assert.equal(r.usesDying, false, 'a creature dies at 0 HP');
  assert.equal(prep(CULTIST).usesDying, true, 'unless its actor says it uses the dying rules');
  const s = prep(SKEL);
  assert.ok(s.iwr.resistances.some((x) => x.type === 'slashing' && x.value === 5));
  assert.ok(s.iwr.immunities.some((x) => x.type === 'mental'));
  assert.equal(prep(RAT, { state: { hp: 3 } }).hp.value, 3);
});

test('conditions change the numbers the way the rules say', () => {
  const base = prep(KERRA);
  const withc = (effects) => prep(KERRA, { effects });
  // frightened 2: -2 status to all checks and DCs
  const f = withc([{ id: 'frightened', value: 2 }]);
  assert.deepEqual([f.ac.value, v(f, 'saves.will'), f.perception.value, f.skills.athletics.value, f.classDC.value, f.strikes[0].attack.value], [18, 6, 6, 9, 17, 10]);
  // clumsy 2: Dex-based only: AC and Reflex, not Fortitude
  const c = withc([{ id: 'clumsy', value: 2 }]);
  assert.deepEqual([c.ac.value, v(c, 'saves.reflex'), v(c, 'saves.fortitude')], [18, 7, 9]);
  // status penalties don't stack: clumsy 1 and frightened 2 give -2 to AC, not -3
  assert.equal(withc([{ id: 'clumsy', value: 1 }, { id: 'frightened', value: 2 }]).ac.value, 18);
  // a status and a circumstance penalty do: frightened 1 and off-guard
  assert.equal(withc([{ id: 'frightened', value: 1 }, { id: 'off-guard' }]).ac.value, 17);
  // prone: off-guard (-2 AC) and -2 circumstance to attack rolls
  const pr = withc([{ id: 'prone' }]);
  assert.deepEqual([pr.ac.value, pr.strikes[0].attack.value], [18, 10]);
  // enfeebled 1: Strength-based attacks and damage, Athletics
  const en = withc([{ id: 'enfeebled', value: 1 }]);
  assert.deepEqual([en.strikes[0].attack.value, en.strikes[0].damage.formula, en.skills.athletics.value], [11, '1d8+3 slashing', 10]);
  // drained 2 at level 3: -2 to Fortitude, max HP -6
  const dr = withc([{ id: 'drained', value: 2 }]);
  assert.deepEqual([v(dr, 'saves.fortitude'), dr.hp.max.value], [7, 41]);
  // fatigued: -1 AC and saves; fascinated -2 Perception and skills; sickened 1 like frightened
  const fa = withc([{ id: 'fatigued' }]);
  assert.deepEqual([fa.ac.value, v(fa, 'saves.will'), fa.perception.value], [19, 7, 8]);
  assert.deepEqual([withc([{ id: 'fascinated' }]).perception.value, withc([{ id: 'fascinated' }]).skills.athletics.value], [6, 9]);
  assert.equal(withc([{ id: 'sickened', value: 1 }]).ac.value, 19);
  // stupefied: Int, Wis and Cha-based (Will, Perception), not AC
  const st = prep(PIP, { effects: [{ id: 'stupefied', value: 2 }] });
  assert.deepEqual([st.spell.dc.value, v(st, 'saves.will'), st.perception.value, st.ac.value], [17, 6, 4, 17]);
  // unconscious: -4 status to AC, Perception, Reflex, and blinded (-4 Perception: the same type, so -4 in all), off-guard, prone
  const un = withc([{ id: 'unconscious' }]);
  assert.deepEqual([un.ac.value, un.perception.value, v(un, 'saves.reflex')], [14, 4, 5]);
  assert.deepEqual(activeConditions([{ id: 'unconscious' }]).map((x) => x.id).sort(), ['blinded', 'off-guard', 'prone', 'unconscious']);
  // encumbered: clumsy 1 and -10 ft (25 becomes 15)
  const ec = withc([{ id: 'encumbered' }]);
  assert.deepEqual([ec.speeds.land.value, ec.ac.value], [15, 19]);
  // a granted condition never lowers a stronger one: clumsy 2 with encumbered stays clumsy 2
  assert.equal(activeConditions([{ id: 'clumsy', value: 2 }, { id: 'encumbered' }]).find((x) => x.id === 'clumsy').value, 2);
  // the creature's conditions work the same way
  assert.equal(prep(RAT, { effects: [{ id: 'frightened', value: 1 }] }).ac.value, 13);
  assert.equal(prep(RAT, { effects: [{ id: 'enfeebled', value: 2 }] }).strikes[0].attack.value, 6, 'the rat bites with finesse: Dex-based, not enfeebled');
  // nothing in the base was changed by all this
  assert.equal(base.ac.value, 20);
});

test('every condition with rules is a condition the board knows, and every one runs', () => {
  for (const id of Object.keys(CONDITION_RULES)) assert.ok(PF2E_CONDITIONS[id], id);
  for (const id of Object.keys(PF2E_CONDITIONS)) {
    const p = prep(KERRA, { effects: [{ id, value: PF2E_CONDITIONS[id].valued ? 1 : undefined }] });
    assert.deepEqual(p.problems, [], id);
  }
});

test('custom effects with rules: a spell giving a status bonus', () => {
  const p = prep(KERRA, { effects: [{ name: 'Heroism', value: 1, rules: [{ key: 'modifier', selector: ['attack-roll', 'saving-throw', 'skill-check'], type: 'status', value: '@value' }] }] });
  assert.deepEqual([p.strikes[0].attack.value, v(p, 'saves.will'), p.ac.value], [13, 9, 20]);
});

test('damage: resistance, weakness, immunity; temporary HP first; massive damage', () => {
  const s = prep(SKEL);
  let r = R.applyDamage(s, {}, [], { parts: [{ amount: 7, type: 'slashing' }] });
  assert.equal(r.state.hp, 3, 'resistance 5 to slashing: 7 becomes 2');
  r = R.applyDamage(s, {}, [], { parts: [{ amount: 4, type: 'bludgeoning' }, { amount: 3, type: 'fire' }] });
  assert.equal(r.total, 4, '4 bludgeoning gets through; fire 3 - 5 resisted = 0'); assert.equal(r.dead, false);
  const imp = prep(IMP);
  assert.equal(R.applyDamage(imp, {}, [], { amount: 5, type: 'fire' }).total, 0, 'immune to fire');
  assert.equal(R.applyDamage(imp, {}, [], { amount: 2, type: 'holy' }).total, 5, 'weakness 3 to holy');
  assert.equal(R.applyDamage(imp, {}, [], { amount: 6, type: 'slashing' }).total, 3, 'physical resistance 3 covers slashing');
  // temporary HP first
  const k = prep(KERRA, { state: { hp: 40, temp: 5 } });
  r = R.applyDamage(k, { hp: 40, temp: 5 }, [], { amount: 8, type: 'slashing' });
  assert.deepEqual([r.state.temp, r.state.hp], [0, 37]);
  // a creature dies at 0; massive damage kills anyone at once
  assert.equal(R.applyDamage(prep(RAT), {}, [], { amount: 7, type: 'piercing' }).dead, true);
  assert.equal(R.applyDamage(prep(KERRA), {}, [], { amount: 94, type: 'fire' }).dead, true, 'double her 47 maximum HP');
});

test('dying and wounded: knocked out, worse when hurt, healed awake, recovery checks, doomed', () => {
  const k = (hp, effects = []) => prep(KERRA, { state: { hp }, effects });
  let r = R.applyDamage(k(10), { hp: 10 }, [], { amount: 15, type: 'slashing' });
  assert.equal(r.state.hp, 0); assert.equal(r.dead, false);
  assert.deepEqual(r.effects.map((e) => `${e.id}${e.value || ''}`).sort(), ['dying1', 'unconscious']);
  // a critical hit: dying 2; wounded 1 adds to it
  r = R.applyDamage(k(10, [{ id: 'wounded', value: 1 }]), { hp: 10 }, [{ id: 'wounded', value: 1 }], { amount: 15, type: 'slashing', critical: true });
  assert.equal(r.effects.find((e) => e.id === 'dying').value, 3);
  // hurt while dying: +1 (or +2 from a critical hit); at dying 4 she dies
  r = R.applyDamage(k(0, [{ id: 'dying', value: 2 }, { id: 'unconscious' }]), { hp: 0 }, [{ id: 'dying', value: 2 }, { id: 'unconscious' }], { amount: 3, type: 'fire', critical: true });
  assert.equal(r.dead, true);
  // doomed 1: death at dying 3
  r = R.applyDamage(k(0, [{ id: 'dying', value: 2 }, { id: 'unconscious' }, { id: 'doomed', value: 1 }]), { hp: 0 }, [{ id: 'dying', value: 2 }, { id: 'unconscious' }, { id: 'doomed', value: 1 }], { amount: 3, type: 'fire' });
  assert.equal(r.dead, true);
  // nonlethal: unconscious, not dying
  r = R.applyDamage(k(5), { hp: 5 }, [], { amount: 9, type: 'bludgeoning', nonlethal: true });
  assert.deepEqual(r.effects.map((e) => e.id), ['unconscious']);
  // healed from 0 while dying: dying ends, wounded 1 (or +1), awake
  const down = [{ id: 'dying', value: 1 }, { id: 'unconscious' }, { id: 'wounded', value: 1 }];
  const h = R.applyHealing(k(0, down), { hp: 0 }, down, 8);
  assert.equal(h.state.hp, 8);
  assert.deepEqual(h.effects.map((e) => `${e.id}${e.value || ''}`), ['wounded2']);
  assert.equal(R.applyHealing(k(40), { hp: 40 }, [], 50).state.hp, 47, 'never above the maximum');
  assert.match(R.applyHealing(k(0), { hp: 0 }, [], 5, { dead: true }).lines[0], /dead/);
  // recovery checks: DC 10 + dying
  const dying2 = [{ id: 'dying', value: 2 }, { id: 'unconscious' }];
  assert.equal(R.recoveryCheck(k(0, dying2), dying2, 13).effects.find((e) => e.id === 'dying').value, 1, '13 vs DC 12: success, dying -1');
  assert.equal(R.recoveryCheck(k(0, dying2), dying2, 20).effects.some((e) => e.id === 'dying'), false, 'a natural 20: critical success, dying 2 - 2 = 0');
  assert.equal(R.recoveryCheck(k(0, dying2), dying2, 20).effects.find((e) => e.id === 'wounded').value, 1, 'losing dying leaves wounded 1');
  assert.ok(R.recoveryCheck(k(0, dying2), dying2, 20).effects.some((e) => e.id === 'unconscious'), 'still unconscious at 0 HP');
  assert.equal(R.recoveryCheck(k(0, dying2), dying2, 1).dead, true, 'a natural 1: critical failure, dying 4');
  assert.equal(R.recoveryCheck(k(0, dying2), dying2, 5).effects.find((e) => e.id === 'dying').value, 3, 'failure: +1');
});

test('temporary HP never stack; health bands in PF2E\'s words', () => {
  const k = prep(KERRA, { state: { temp: 5 } });
  assert.equal(R.setTempHp(k, { temp: 5 }, 3).state.temp, 5);
  assert.equal(R.setTempHp(k, { temp: 5 }, 8).state.temp, 8);
  assert.deepEqual([47, 40, 30, 15, 1, 0].map((hp) => healthBand(hp, 47)), ['Unharmed', 'Scratched', 'Wounded', 'Badly wounded', 'Near death', 'Down']);
  assert.equal(healthBand(10, 47, true), 'Dead');
  assert.equal(prep(RAT, { state: { hp: 3 } }).band, 'Badly wounded');
});
