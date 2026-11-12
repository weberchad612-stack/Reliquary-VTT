// PF2E's own rule keys (rulesets/pf2e/rule-keys.js): converted from Foundry's rule elements and run by the
// rules: roll options and switches, traits, size, extra damage dice, Strike traits, granted Strikes, the
// multiple attack penalty, critical specialization, degree of success, rolling twice, one-roll effects on a
// target, temporary HP, fast healing, auras from token positions, light, conditions granted by effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertRule } from '../tools/import/foundry/convert.mjs';
import { prepareActor } from '../engine/rules/rules.js';
import { PF2E_SYSTEM } from '../rulesets/pf2e/system.js';
import { adjustDegree } from '../rulesets/pf2e/rule-keys.js';
import { loadGame, runCommand, auraEffects, creature } from '../tools/actor.mjs';
import { runCheck } from '../tools/check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'examples/sample-pack'), KEEP = path.join(ROOT, 'examples/campaigns/keep-test');
const R = PF2E_SYSTEM.actors;
const KERRA = 'tok-cw77vfz9', RAT = 'tok-gqrwstot', VARSHA = 'tok-u1t8r9h7';
const refs = { 'Compendium.pf2e.conditionitems.Item.Off-Guard': 'conditions:condition/off-guard', 'Compendium.pf2e.spell-effects.Item.Aura': 'spell-effects:effect/test-aura' };
const ctx = { ref: (u) => refs[u] || null };
const conv = (r) => convertRule(r, ctx);

test('Foundry rule elements become PF2E rule keys, or are kept with the reason', () => {
  assert.deepEqual(conv({ key: 'RollOption', option: 'rage', toggleable: true, label: 'Raging' }).rule, { key: 'roll-option', option: 'rage', toggleable: true, label: 'Raging' });
  assert.equal(conv({ key: 'RollOption', option: 'x', toggleable: true, suboptions: [{ label: 'a', value: 'a' }] }).rule.key, 'unsupported');
  assert.equal(conv({ key: 'RollOption', option: 'stance:{item|slug}' }).rule.key, 'unsupported');
  assert.deepEqual(conv({ key: 'ActorTraits', add: ['undead'] }).rule, { key: 'trait', add: ['undead'] });
  assert.deepEqual(conv({ key: 'CreatureSize', value: 'lg' }).rule, { key: 'size', size: 'large' });
  assert.equal(conv({ key: 'CreatureSize', value: 1 }).rule.key, 'unsupported');
  assert.deepEqual(conv({ key: 'DamageDice', selector: 'strike-damage', diceNumber: 1, dieSize: 'd6', damageType: 'fire', predicate: ['rage'] }).rule, { key: 'damage-dice', selector: 'strike-damage', dice: 1, die: 'd6', type: 'fire', when: ['rage'] });
  assert.equal(conv({ key: 'DamageDice', selector: 'strike-damage', override: { dieSize: 'd12' } }).rule.key, 'unsupported');
  assert.deepEqual(conv({ key: 'AdjustStrike', mode: 'add', property: 'weapon-traits', value: 'agile', definition: ['item:slug:jaws'] }).rule, { key: 'strike-trait', mode: 'add', traits: ['agile'], when: ['item:slug:jaws'] });
  assert.equal(conv({ key: 'AdjustStrike', mode: 'add', property: 'materials', value: 'silver' }).rule.key, 'unsupported');
  assert.deepEqual(conv({ key: 'Strike', label: 'Claw', category: 'unarmed', damage: { base: { die: 'd6', damageType: 'slashing', dice: 1 } }, traits: ['agile', 'finesse'] }).rule, { key: 'strike', name: 'Claw', category: 'unarmed', die: 'd6', type: 'slashing', traits: ['agile', 'finesse'] });
  assert.deepEqual(conv({ key: 'AdjustDegreeOfSuccess', selector: 'will', adjustment: { success: 'one-degree-better' } }).rule, { key: 'degree', selector: 'will', adjust: { success: 'one-degree-better' } });
  assert.deepEqual(conv({ key: 'RollTwice', selector: 'perception', keep: 'higher' }).rule, { key: 'roll-twice', selector: 'perception', keep: 'higher' });
  assert.deepEqual(conv({ key: 'MultipleAttackPenalty', selector: 'strike-attack-roll', value: -4 }).rule, { key: 'map', selector: 'strike-attack-roll', value: -4 });
  assert.deepEqual(conv({ key: 'CriticalSpecialization', predicate: ['item:group:sword'] }).rule, { key: 'crit-spec', when: ['item:group:sword'] });
  assert.deepEqual(conv({ key: 'EphemeralEffect', selectors: ['strike-attack-roll'], uuid: 'Compendium.pf2e.conditionitems.Item.Off-Guard', affects: 'target' }).rule, { key: 'ephemeral', selector: ['strike-attack-roll'], affects: 'target', condition: 'off-guard' });
  assert.deepEqual(conv({ key: 'TempHP', value: '@actor.level', events: { onTurnStart: true } }).rule, { key: 'temp-hp', value: '@level', onTurnStart: true });
  assert.deepEqual(conv({ key: 'FastHealing', value: 5, type: 'regeneration', deactivatedBy: ['fire'] }).rule, { key: 'fast-healing', value: 5, kind: 'regeneration', deactivatedBy: ['fire'] });
  assert.deepEqual(conv({ key: 'Aura', slug: 'test', radius: 10, effects: [{ uuid: 'Compendium.pf2e.spell-effects.Item.Aura', affects: 'allies' }] }).rule, { key: 'aura', slug: 'test', radius: 10, effects: [{ ref: 'spell-effects:effect/test-aura', affects: 'allies' }] });
  assert.deepEqual(conv({ key: 'Aura', slug: 'frightful-presence', radius: 30, effects: [] }).rule, { key: 'aura', slug: 'frightful-presence', radius: 30, effects: [] });
  assert.deepEqual(conv({ key: 'TokenLight', value: { bright: 20, dim: 40, color: '#FFAA00' } }).rule, { key: 'light', bright: 20, dim: 40, colour: '#ffaa00' });
  assert.deepEqual(conv({ key: 'GrantItem', uuid: 'Compendium.pf2e.conditionitems.Item.Frightened', alterations: [{ mode: 'override', property: 'badge-value', value: 2 }] }).rule, { key: 'grant-condition', condition: 'frightened', value: 2 });
  assert.equal(conv({ key: 'GrantItem', uuid: 'Compendium.pf2e.feats-srd.Item.Toughness' }).rule.key, 'unsupported');
});

// a test creature with rules in our format
const base = (rules, extra = {}) => ({ kind: 'creature', slug: 't', system: 'pf2e', name: 'Test Brute', level: 4, source: { title: 'x', license: 'ORC' }, traits: ['humanoid'], size: 'medium',
  stats: { ac: 20, hp: 60, perception: 10, saves: { fortitude: 12, reflex: 9, will: 8 }, attributes: { str: 4, dex: 1 }, speeds: { land: 25 } },
  items: [{ kind: 'strike', name: 'Jaws', attack: 12, traits: ['unarmed'], damage: [{ dice: '1d10+6', type: 'piercing' }] }, { kind: 'strike', name: 'Claw', attack: 12, traits: ['agile'], damage: [{ dice: '1d6+6', type: 'slashing' }] }], rules, ...extra });
const prep = (doc, state = {}) => prepareActor({ actor: { system: 'pf2e', kind: 'npc', base: 'creature/t' }, state, content: { 'creature/t': doc }, ruleset: R });

test('switches, traits and size; rules that hold only while a switch is on', () => {
  const doc = base([
    { key: 'roll-option', option: 'rage', toggleable: true, label: 'Raging' },
    { key: 'modifier', selector: 'ac', type: 'status', value: -1, when: ['rage'] },
    { key: 'trait', add: ['undead'], remove: ['humanoid'] },
    { key: 'size', size: 'large', when: ['rage'] },
    { key: 'roll-option', option: 'always-angry' },
  ]);
  const calm = prep(doc);
  assert.deepEqual(calm.options, [{ option: 'rage', label: 'Raging', on: false, from: 'Test Brute' }]);
  assert.deepEqual([calm.ac.value, calm.size, calm.traits], [20, 'medium', ['undead']]);
  assert.ok(calm.tags.includes('always-angry') && calm.tags.includes('self:trait:undead'));
  const angry = prep(doc, { tags: ['rage'] });
  assert.deepEqual([angry.options[0].on, angry.ac.value, angry.size], [true, 19, 'large']);
});

test('Strikes: added traits, the multiple attack penalty, extra damage dice, critical specialization', () => {
  const doc = base([
    { key: 'strike-trait', mode: 'add', traits: ['agile'], when: ['item:slug:jaws'] },
    { key: 'damage-dice', selector: 'strike-damage', dice: 1, die: 'd6', type: 'fire', label: 'Flaming' },
    { key: 'damage-dice', selector: 'jaws-damage', dice: 2, die: 'd6', category: 'precision', critical: true },
    { key: 'map', selector: 'claw-attack', value: -3 },
    { key: 'crit-spec', when: ['item:slug:claw'] },
  ]);
  const p = prep(doc), jaws = p.strikes.find((s) => s.name === 'Jaws'), claw = p.strikes.find((s) => s.name === 'Claw');
  assert.ok(jaws.traits.includes('agile'));
  assert.deepEqual(jaws.map, [0, -4, -8], 'agile now');
  assert.deepEqual(claw.map, [0, -3, -6]);
  assert.equal(jaws.damage.formula, '1d10+6 piercing plus 1d6 fire');
  assert.equal(jaws.damage.criticalExtra, '2d6');
  assert.equal(claw.critSpec, true);
  assert.equal(jaws.critSpec, undefined);
});

test('a character gains a Strike from a feature (claws), worked out with its unarmed proficiency', () => {
  const game = loadGame(PACK, KEEP);
  const kerra = { ...game.actors[KERRA], feats: [...(game.actors[KERRA].feats || []), { name: 'Claws', rules: [{ key: 'strike', name: 'Claws', category: 'unarmed', die: 'd6', type: 'slashing', traits: ['agile', 'finesse'] }] }] };
  const p = prepareActor({ actor: kerra, state: {}, content: game.content, ruleset: R });
  const claws = p.strikes.find((s) => s.name === 'Claws');
  assert.ok(claws && claws.damage.formula.startsWith('1d6+4 slashing'));
  assert.deepEqual(claws.map, [0, -4, -8]);
  assert.ok(!p.strikes.some((s) => s.name === 'Fist'), 'a granted unarmed attack replaces the fist');
});

test('checks: degree of success changes, rolling twice, and a one-roll effect on the target', () => {
  assert.deepEqual(adjustDegree('success', [{ adjust: { success: 'one-degree-better' }, origin: { label: 'Juggernaut' } }]).degree, 'critical-success');
  assert.deepEqual(adjustDegree('failure', [{ adjust: { success: 'one-degree-better' }, origin: { label: 'X' } }]).degree, 'failure');
  const game = loadGame(PACK, KEEP);
  game.actors[KERRA] = { ...game.actors[KERRA], feats: [...(game.actors[KERRA].feats || []),
    { name: 'Iron Will', rules: [{ key: 'degree', selector: 'will', adjust: { success: 'one-degree-better' } }] },
    { name: 'Keen Eyes', rules: [{ key: 'roll-twice', selector: 'perception', keep: 'higher' }] },
    { name: 'Sneaky Strikes', rules: [{ key: 'ephemeral', selector: 'strike-attack-roll', affects: 'target', condition: 'off-guard' }] }] };
  const will = runCheck(game, { who: 'Kerra', stat: 'will', dc: 15, roll: '8' });   // 8 + 8 = 16: a success, made a critical success
  assert.equal(will.degree, 'critical-success');
  assert.match(will.lines.join('\n'), /Iron Will: success becomes critical-success/);
  const per = runCheck(game, { who: 'Kerra', stat: 'perception', dc: 20, roll: '4,15' });
  assert.match(per.lines.join('\n'), /rolls twice \(4 and 15\) and keeps the higher: 15/);
  assert.equal(per.total, 15 + 8);
  assert.match(runCheck(game, { who: 'Kerra', stat: 'perception', dc: 20, roll: '4' }).lines.join('\n'), /give both dice/);
  // the Strike against the rat: off-guard for this roll, AC 2 lower
  const ratAc = creature(game, 'Wet-Nosed Rat').prepared.ac.value;
  const hit = runCheck(game, { who: 'Kerra', strike: 'Longsword', against: 'Wet-Nosed Rat', roll: '10' });
  assert.equal(hit.dc, ratAc - 2);
  assert.match(hit.lines.join('\n'), /for this roll Wet-Nosed Rat is off-guard \(Sneaky Strikes\)/);
});

test('auras: effects on the creatures within the emanation by side, and a report of who is inside one with no effect', () => {
  const game = loadGame(PACK, KEEP);
  const map = game.tokens[KERRA].map;
  // Varsha (a foe) radiates an aura of fear 10 feet around her (an effect on enemies) and a frightful presence
  game.lib.get = ((get) => (k) => (k === 'x:effect/dread' ? { kind: 'effect', slug: 'dread', name: 'Effect: Dread', rules: [{ key: 'modifier', selector: 'will', type: 'status', value: -1 }] } : get(k)))(game.lib.get);
  game.actors[VARSHA] = { ...game.actors[VARSHA], rules: [{ key: 'aura', slug: 'dread', radius: 10, effects: [{ ref: 'x:effect/dread', affects: 'enemies' }] }, { key: 'aura', slug: 'frightful-presence', radius: 30, effects: [] }] };
  Object.assign(game.tokens[VARSHA], { map, x: 10, y: 10 });
  Object.assign(game.tokens[KERRA], { map, x: 12, y: 10 });   // 2 squares away: 10 feet
  Object.assign(game.tokens[RAT], { map, x: 11, y: 10 });     // an ally of hers
  game.auras = null;
  assert.deepEqual(auraEffects(game, KERRA).map((e) => [e.name, e.aura]), [['Dread', VARSHA]]);
  assert.deepEqual(auraEffects(game, RAT), [], 'not her allies');
  const before = creature(game, 'Kerra').prepared.saves.will.value;
  Object.assign(game.tokens[KERRA], { x: 13 }); game.auras = null;   // 15 feet: outside
  assert.equal(creature(game, 'Kerra').prepared.saves.will.value, before + 1);
  assert.match(runCommand(game, 'show', ['Kerra']).lines.join('\n'), /Inside frightful-presence of Varsha Kell/);
});

test('light: a creature that sheds light gets it on its token when it is given game data', () => {
  const game = loadGame(PACK, KEEP);
  game.lib.get = ((get) => (k) => (k === 'x:creature/glowbug' ? { kind: 'creature', slug: 'glowbug', system: 'pf2e', name: 'Glowbug', level: 0, source: { title: 'x', license: 'ORC' }, stats: { ac: 12, hp: 5 }, rules: [{ key: 'light', bright: 10, dim: 20 }] } : get(k)))(game.lib.get);
  delete game.actors[RAT]; delete game.tokens[RAT].light;
  const out = runCommand(game, 'create', [RAT, 'x:creature/glowbug']);
  assert.deepEqual(out.writes.find((w) => w.path === `tokens/${RAT}`).data, { light: { bright: 10, dim: 20 } });
  assert.match(out.lines[0], /sheds light/);
});

test('the actor tool turns switches on and off in the live state', () => {
  const game = loadGame(PACK, KEEP);
  game.actors[KERRA] = { ...game.actors[KERRA], feats: [...(game.actors[KERRA].feats || []), { name: 'Rage', rules: [{ key: 'roll-option', option: 'rage', toggleable: true }, { key: 'roll-option', option: 'focused', toggleable: true, default: true }] }] };
  const on = runCommand(game, 'option', ['Kerra', 'rage', 'on']);
  assert.deepEqual(on.writes[0].data.tags, ['rage']);
  game.states[KERRA] = on.writes[0].data;
  const off = runCommand(game, 'option', ['Kerra', 'focused', 'off']);
  assert.deepEqual(off.writes[0].data.tags, ['rage', '!focused'], 'a switch that is on by default is turned off with a mark');
  game.states[KERRA] = off.writes[0].data;
  assert.deepEqual(creature(game, 'Kerra').prepared.options.map((o) => `${o.option} ${o.on}`), ['rage true', 'focused false']);
  assert.match(runCommand(game, 'option', ['Kerra', 'hiding', 'on']).lines[0], /kept as a situation tag/);
});
