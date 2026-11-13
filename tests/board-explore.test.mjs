// Exploration (board/explore.js): choices, needs, pace, combat requests, reminders, badges and travel time; the PF2E
// rules (rulesets/pf2e/exploration.js); the tab's HTML (board/exploreui.js); Claude's tool (tools/exploration.mjs) and
// the encounter tool's use of it; the save (board/records.js, tools/campaign.mjs, schemas/exploration.schema.json);
// raised shields lowering at the turn's start (rulesets/pf2e/turns.js); the board code free of the system.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { PLAIN_EXPLORATION, exploreRules, exploreChoice, availability, pcExplore, partyPace, combatRequests, initiativeHint, startRequests, reminders, badgeFor, travelTime, durationWords } from '../board/explore.js';
import { pickerHtml, optionsHtml, cardHtml } from '../board/exploreui.js';
import { PF2E_EXPLORATION as X, travelSpeed, groupPace, paceWords, skillRank, expertBonus } from '../rulesets/pf2e/exploration.js';
import { PF2E_SYSTEM } from '../rulesets/pf2e/system.js';
import { turnRules } from '../rulesets/pf2e/turns.js';
import { runExploration } from '../tools/exploration.mjs';
import { runEncounter } from '../tools/encounter.mjs';
import { loadGame } from '../tools/actor.mjs';
import { campaignRecords, saveFromRecords } from '../board/records.js';
import { buildRecords, readCampaign, roundTrip, SAVE_COLLECTIONS } from '../tools/campaign.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// a party: Kerra with a shield, expert Athletics; Pip a caster, trained Stealth; Lyra trained Survival
const pc = (id, name, actor, prepared) => ({ id, name, actor, prepared, dead: false });
const KERRA = pc('tok-kerra001', 'Kerra', { attributes: { con: 2 }, proficiencies: { skills: { athletics: 2, survival: 1 } } }, { speeds: { land: { value: 25 } }, shield: { name: 'Steel Shield' }, attributes: { con: 2 } });
const PIP = pc('tok-pip00001', 'Pip', { spellcasting: { tradition: 'arcane' }, attributes: { con: 1 }, proficiencies: { skills: { stealth: 1 } } }, { speeds: { land: { value: 25 } }, shield: null, attributes: { con: 1 } });
const LYRA = pc('tok-lyra0001', 'Lyra', { attributes: { con: 3 }, proficiencies: { skills: { survival: 1, stealth: 2 } } }, { speeds: { land: { value: 30 } }, shield: null, attributes: { con: 3 } });
const PARTY = [KERRA, PIP, LYRA];

test('PF2E exploration rules: the travel table, the group pace, Hustle, Follow the Expert', () => {
  assert.deepEqual(travelSpeed(25), { perMinute: 250, mph: 2.5, perDay: 20 }, 'Player Core\'s table: Speed 25 is 250 ft/min, 2½ mph, 20 miles a day');
  assert.deepEqual(travelSpeed(15), { perMinute: 150, mph: 1.5, perDay: 12 });
  const pcs = (acts, opts = {}) => [{ id: 'k', name: 'Kerra', speed: 25, con: 2, activity: acts[0] }, { id: 'l', name: 'Lyra', speed: 30, con: 1, activity: acts[1], options: opts }];
  const full = groupPace(pcs([null, null]));
  assert.equal(full.speed, 25, 'the slowest');
  assert.equal(full.factor, 1);
  assert.equal(groupPace(pcs(['defend', null])).factor, 0.5, 'one half-speed activity halves the group');
  const hustle = groupPace(pcs(['hustle', 'hustle']));
  assert.equal(hustle.factor, 2);
  assert.deepEqual(hustle.limit, { minutes: 10, text: 'Hustle lasts 10 minutes (the lowest Constitution)' });
  assert.equal(groupPace(pcs(['hustle', null])).factor, 1, 'the group Hustles only together');
  assert.equal(groupPace(pcs(['avoid-notice', 'follow-the-expert'], { expert: 'k' })).factor, 0.5, 'Follow the Expert matches the expert\'s pace');
  assert.equal(groupPace(pcs([null, 'follow-the-expert'], { expert: 'k' })).factor, 1);
  assert.equal(paceWords(groupPace(pcs(['search', null]))), 'half speed: 125 ft per minute, 1¼ mph, 10 miles a day');
  assert.equal(skillRank({ proficiencies: { skills: { stealth: 3 } } }, 'stealth'), 3);
  assert.deepEqual([expertBonus(1), expertBonus(2), expertBonus(3), expertBonus(4)], [0, 2, 3, 4]);
  assert.ok(X.activities.every((a) => a.ref && a.ref.startsWith('actions:action/') && fs.existsSync(path.join(ROOT, 'content/pf2e/actions/action', `${a.ref.split('/').pop()}.json`))), 'every activity\'s rules text is in our content');
  assert.equal(PF2E_SYSTEM.exploration, X);
});

test('choices, needs and cards: what a PC can do, with the reason when not', () => {
  const R = X;
  assert.throws(() => exploreChoice({ activity: 'juggle' }, R), /no exploration activity/);
  assert.deepEqual(exploreChoice({ activity: 'defend', options: { x: '' }, by: 'player' }, R, 'T'), { activity: 'defend', at: 'T', by: 'player' });
  assert.deepEqual(exploreChoice({ activity: null, note: '  whistling ' }, R, 'T'), { activity: null, at: 'T', by: 'gm', note: 'whistling' });
  const need = (id, act) => (availability(R, id, PARTY, {}).find((x) => x.activity.id === act) || {}).need;
  assert.equal(need(KERRA.id, 'defend'), null);
  assert.deepEqual(need(PIP.id, 'defend'), { text: 'needs a shield in use', soft: false });
  assert.equal(need(PIP.id, 'detect-magic'), null, 'a caster');
  assert.equal(need(KERRA.id, 'detect-magic').soft, true, 'allowed, with a warning');
  assert.deepEqual(need(PIP.id, 'track'), { text: 'needs trained Survival', soft: false });
  assert.equal(need(PIP.id, 'follow-the-expert'), null, 'Kerra and Lyra are experts');
  // Follow the Expert: who and which skill; the bonus by the expert's rank; a warning when they are not expert
  const ch = { [PIP.id]: { activity: 'follow-the-expert', options: { expert: LYRA.id, skill: 'stealth' } } };
  const card = pcExplore(R, PIP.id, PARTY, ch);
  assert.equal(card.title, 'Follow the Expert');
  assert.equal(card.detail, 'following Lyra in Stealth: +2 circumstance, and level added if untrained');
  assert.equal(card.warning, null);
  assert.match(pcExplore(R, PIP.id, PARTY, { [PIP.id]: { activity: 'follow-the-expert', options: { expert: KERRA.id, skill: 'stealth' } } }).warning, /Kerra is untrained in Stealth/);
  assert.match(pcExplore(R, PIP.id, PARTY, { [PIP.id]: { activity: 'defend' } }).warning, /needs a shield/);
  const none = pcExplore(R, KERRA.id, PARTY, {});
  assert.equal(none.activity, null);
  assert.equal(none.title, 'Travelling');
  assert.equal(none.speed, 25);
  // pace from the prepared numbers
  assert.equal(partyPace(R, PARTY, { [KERRA.id]: { activity: 'defend' } }).perMinute, 125);
  assert.equal(partyPace(R, PARTY, {}).slowest, 'Kerra');
});

test('combat requests: Avoid Notice rolls Stealth, Scout helps the whole party, Defend raises the shield', () => {
  const R = X, ch = { [KERRA.id]: { activity: 'defend' }, [PIP.id]: { activity: 'avoid-notice' }, [LYRA.id]: { activity: 'scout' } };
  assert.deepEqual(initiativeHint(R, PIP.id, PARTY, ch), { stat: 'stealth', add: [{ label: 'Scout', type: 'circumstance', value: 1 }] });
  assert.deepEqual(initiativeHint(R, KERRA.id, PARTY, ch), { stat: null, add: [{ label: 'Scout', type: 'circumstance', value: 1 }] });
  const start = startRequests(R, PARTY, ch, [KERRA.id, PIP.id]);
  assert.deepEqual(start.map((q) => [q.kind, q.token, q.patch]), [['state', KERRA.id, { shieldRaised: true }]]);
  assert.deepEqual(startRequests(R, PARTY, ch, [PIP.id]), [], 'only PCs in the encounter');
  // an activity a PC cannot do asks for nothing; a dead PC asks for nothing
  assert.deepEqual(combatRequests(R, PARTY, { [PIP.id]: { activity: 'defend' } }), []);
  assert.deepEqual(combatRequests(R, [{ ...LYRA, dead: true }, KERRA], { [LYRA.id]: { activity: 'scout' } }), []);
  // reminders for Claude
  const rem = reminders(R, PARTY, { [KERRA.id]: { activity: 'search' }, [PIP.id]: { activity: 'detect-magic' }, [LYRA.id]: { activity: 'investigate', options: { skill: 'nature' } } });
  assert.deepEqual(rem.map((r) => r.id), [KERRA.id, PIP.id, LYRA.id]);
  assert.match(rem[0].text, /free secret Seek/);
  assert.match(rem[2].text, /Investigating \(Nature\)/);
  // the token badge
  assert.deepEqual(badgeFor(R, 'Kerra', { activity: 'defend' }), { icon: '🛡', text: 'Kerra: Defend (half speed): Moves at half speed with a shield raised; it is up before the first turn when combat starts.' });
  assert.equal(badgeFor(R, 'Kerra', null), null, 'nothing chosen: no badge');
  assert.equal(badgeFor(R, 'Kerra', { activity: null }), null, 'just travelling: no badge');
});

test('travel time: a distance at the pace, terrain, or a time straight', () => {
  const pace = travelSpeed(12.5);   // half of 25
  assert.equal(travelTime(pace, { value: 600, unit: 'ft' }).seconds, 288);
  assert.equal(travelTime(pace, { value: 3, unit: 'mi' }, 0.5).seconds, 15206, '3 miles through difficult terrain at 62.5 ft a minute');
  assert.deepEqual(travelTime(pace, { value: 10, unit: 'min' }), { seconds: 600, feet: 1250 });
  assert.equal(travelTime(null, { value: 2, unit: 'hr' }).seconds, 7200, 'a time needs no pace');
  assert.throws(() => travelTime(null, { value: 100, unit: 'ft' }), /no pace/);
  assert.throws(() => travelTime(pace, { value: 0, unit: 'ft' }), /how far/);
  assert.equal(durationWords(15206), '4 hours 13 minutes');
  assert.equal(durationWords(45), '45 seconds');
});

test('a system without exploration rules: a note per PC, pace from Speed, no requests', () => {
  const R = exploreRules({});
  assert.equal(R, PLAIN_EXPLORATION);
  assert.deepEqual(R.activities, []);
  assert.equal(partyPace(R, PARTY, {}).speed, 25);
  assert.deepEqual(combatRequests(R, PARTY, { [KERRA.id]: { activity: null, note: 'humming' } }), []);
  assert.deepEqual(badgeFor(R, 'Kerra', { activity: null, note: 'humming' }), { icon: '🚶', text: 'Kerra: humming' });
  const html = cardHtml(pcExplore(R, KERRA.id, PARTY, {}), { R, party: PARTY, choices: {}, gm: false, write: true });
  assert.match(html, /data-f="note"/);
  assert.doesNotMatch(html, /data-f="activity"/);
});

test('the tab\'s HTML: the picker greys out what a PC cannot do for players; options; rules text', () => {
  const R = X;
  const player = pickerHtml(R, PIP.id, PARTY, {}, false), gm = pickerHtml(R, PIP.id, PARTY, {}, true);
  assert.match(player, /<option value="defend" disabled>🛡 Defend \(needs a shield in use\)/);
  assert.match(gm, /<option value="defend">🛡 Defend \(needs a shield in use\)/, 'the GM can still pick it');
  assert.match(player, /<optgroup label="Exploration activities">/);
  assert.match(player, /<optgroup label="Skill activities">/);
  assert.match(player, /<option value="" selected>🚶 Travelling/);
  const fe = R.activities.find((a) => a.id === 'follow-the-expert');
  const opts = optionsHtml(R, fe, PIP.id, PARTY, { expert: LYRA.id, skill: 'stealth' });
  assert.match(opts, /<option value="tok-lyra0001" selected>Lyra/);
  assert.doesNotMatch(opts, /value="tok-pip00001"/, 'not yourself');
  assert.match(opts, /<option value="stealth" selected>Stealth/);
  const inv = optionsHtml(R, R.activities.find((a) => a.id === 'investigate'), PIP.id, PARTY, {});
  assert.doesNotMatch(inv, /Athletics/, 'only Recall Knowledge skills');
  const card = cardHtml(pcExplore(R, KERRA.id, PARTY, { [KERRA.id]: { activity: 'defend' } }), { R, party: PARTY, choices: { [KERRA.id]: { activity: 'defend' } }, gm: false, write: true, open: true, doc: { text: 'You move at half speed.', traits: ['exploration'], source: { title: 'Player Core' } }, trait: (t) => ({ label: t, text: 'Exploration: out of combat' }) });
  assert.match(card, /half speed<\/span>/);
  assert.match(card, /You move at half speed\./);
  assert.match(card, /title="Exploration: out of combat">exploration</);
  assert.match(card, /Speed 25 ft/);
});

test('the board\'s exploration code holds no Pathfinder words (the system brings them)', () => {
  for (const f of ['board/explore.js', 'board/exploreui.js']) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    for (const w of ['Stealth', 'Scout', 'Defend', 'Hustle', 'Pathfinder', 'shieldRaised', 'Constitution', 'Avoid Notice']) assert.ok(!code.includes(w), `${f} says "${w}"`);
  }
});

/** Apply a tool's writes to a records object (update merges top-level fields). */
function apply(records, writes) {
  for (const w of writes) {
    if (w.op === 'delete') delete records[w.path];
    else if (w.op === 'update') records[w.path] = { ...(records[w.path] || {}), ...w.data };
    else records[w.path] = w.data;
  }
}

test('tools/exploration.mjs and tools/encounter.mjs: set, pace, travel; Stealth, Scout and Defend at combat start', () => {
  const pack = path.join(ROOT, 'examples/sample-pack'), save = path.join(ROOT, 'examples/campaigns/keep-test');
  const records = buildRecords(pack, save, { now: 'T' }).records;
  records['state/clock'] = { now: 149136906012, start: 149136904200 };
  const ex = (cmd, args, o = {}) => { const g = loadGame(pack, save, records); const r = runExploration(g, cmd, args, o); apply(records, r.writes); return r; };
  const en = (cmd, args, o = {}) => { const g = loadGame(pack, save, records); const r = runEncounter(g, cmd, args, o); apply(records, r.writes); return r; };
  ex('set', ['Kerra', 'defend']); ex('set', ['Pip', 'avoid-notice']); ex('set', ['Lyra', 'scout']);
  assert.equal(records['explore/tok-cw77vfz9'].activity, 'defend');
  assert.ok(Object.keys(records).some((p) => p.startsWith('audit/')), 'audit lines');
  assert.match(ex('set', ['Pip', 'defend']).lines[0], /WARNING: Pip needs a shield/);
  ex('set', ['Pip', 'avoid-notice']);
  assert.match(ex('pace', []).lines[0], /half speed: 125 ft per minute/);
  const t = ex('travel', ['3', 'mi'], { terrain: 'difficult' });
  assert.match(t.lines[0], /travels 3 miles through difficult terrain .*: 4 hours 13 minutes/);
  assert.equal(records['state/clock'].now, 149136906012 + 253 * 60);
  assert.throws(() => ex('set', ['Kerra', 'juggle']), /no activity|no exploration activity/);
  // the encounter: Pip rolls Stealth with Scout's +1, Kerra Perception with +1; Defend's shield before the first turn
  en('start', ['Kerra', 'Pip', 'tok-sxodpi74']);
  const pip = en('roll', ['Pip'], { roll: 10 });
  assert.match(pip.lines[0], /Pip: initiative 10 \+ 8 \(Stealth; Scout \+1\) = 18/);
  assert.match(en('roll', ['Kerra'], { roll: 5 }).lines[0], /\(Perception; Scout \+1\)/);
  assert.match(en('roll', ['Pip'], { roll: 10, stat: 'perception' }).lines[0], /\(Perception; Scout \+1\)/, 'an explicit --stat wins');
  en('init', ['tok-sxodpi74', '40']);
  const b = en('begin', []);
  assert.ok(b.lines.includes("Defend: Kerra's shield is raised until the start of their first turn"));
  assert.equal(records['actorstate/tok-cw77vfz9'].shieldRaised, true, 'the ogre acts first: the shield is up');
  // Pip's turn, then Kerra's: when hers starts, the raised shield lowers
  en('next', []);
  assert.equal(records['actorstate/tok-cw77vfz9'].shieldRaised, true, 'still up on Pip\'s turn');
  const n = en('next', []);
  assert.ok(n.lines.some((l) => /Kerra's shield is lowered/.test(l)), n.lines.join(' | '));
  assert.equal(records['actorstate/tok-cw77vfz9'].shieldRaised, undefined);
  // the content records the board needs for the rules text
  const c = ex('content', []);
  assert.ok(c.writes.some((w) => w.path === 'content/actions.action.defend') || c.lines[0].startsWith('0'));
});

test('a raised shield lowers at its owner\'s turn start (PF2E turn rules)', () => {
  const r = turnRules({ events: [{ type: 'turn-start', token: 'a' }], now: 0, tokens: { a: { name: 'Kerra' } }, states: { a: { hp: 5, shieldRaised: true } }, names: { a: 'Kerra' }, prepare: () => null });
  assert.deepEqual(r.states.a, { hp: 5 });
  assert.match(r.lines[0], /Kerra's shield is lowered/);
});

test('the PCs\' activities in the save: records both ways, the round trip, the schema', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-'));
  const pack = path.join(ROOT, 'examples/sample-pack');
  fs.cpSync(path.join(ROOT, 'examples/campaigns/keep-test'), tmp, { recursive: true });
  const exploration = { choices: { 'tok-cw77vfz9': { activity: 'defend', at: 'T', by: 'gm' }, 'tok-rf053o2i': { activity: 'follow-the-expert', options: { expert: 'tok-s85mkapz', skill: 'stealth' }, at: 'T', by: 'player' } } };
  fs.writeFileSync(path.join(tmp, 'exploration.json'), JSON.stringify({ $schema: '../../../schemas/exploration.schema.json', ...exploration }));
  const c = readCampaign(pack, tmp);
  assert.deepEqual(c.exploration, exploration);
  const r = campaignRecords({ ...c, now: 'T' });
  assert.equal(r['explore/tok-cw77vfz9'].activity, 'defend');
  assert.deepEqual(saveFromRecords(r).exploration, exploration);
  assert.deepEqual(roundTrip(pack, tmp), []);
  assert.ok(SAVE_COLLECTIONS.includes('explore'));
  assert.ok(c.content['actions:action/defend'], 'the activities\' rules text comes with the campaign');
  const v = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/exploration.schema.json'), 'utf8')));
  assert.ok(v(exploration), JSON.stringify(v.errors));
  assert.ok(!v({ choices: { 'not-a-token': { activity: 'defend' } } }));
  fs.rmSync(tmp, { recursive: true, force: true });
});
