// Generated ids and token names: the id maker, what each view shows, letters by group, lookups, the naming checks,
// the token tool, the id converter and the sample data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeId, isId, idPattern, ID_PREFIX } from '../board/ids.js';
import { publicName, nameFor, letterOf, pickLetter, lettersInGroup, resolveToken, nameProblems, groupOf } from '../board/names.js';
import { addToken, revealToken } from '../tools/token.mjs';
import { planIds, convertState, convertRecords } from '../tools/ids.mjs';
import { validate } from '../tools/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEEP = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/campaigns/keep-test/maps/sample-keep.json'), 'utf8'));

test('ids: a type prefix and 8 base-36 characters, never one already taken', () => {
  for (const kind of Object.keys(ID_PREFIX)) assert.match(makeId(kind), idPattern(kind));
  assert.match(makeId('token'), /^tok-[0-9a-z]{8}$/);
  const many = new Set(Array.from({ length: 2000 }, () => makeId('note')));
  assert.equal(many.size, 2000);
  // a random source that repeats: the taken id is skipped
  let n = 0; const bytes = (k) => Uint8Array.from({ length: k }, (_, i) => (n < 1 ? 0 : (i + 1) % 36));
  const first = makeId('token', { bytes: (k) => Uint8Array.from({ length: k }, () => 0) });
  assert.equal(first, 'tok-00000000');
  const second = makeId('token', { taken: new Set([first]), bytes: (k) => { const b = n++ < 1 ? Uint8Array.from({ length: k }, () => 0) : bytes(k); return b; } });
  assert.notEqual(second, first);
  assert.throws(() => makeId('token', { taken: { 'tok-00000000': 1 }, bytes: (k) => Uint8Array.from({ length: k }, () => 0) }), /could not make/);
  assert.throws(() => makeId('spell'), /no id prefix/);
  assert.ok(isId('tok-k3x9q2m7', 'token') && !isId('tok-k3x9q2m7', 'note') && isId('tpl-k3x9q2m7') && !isId('kerra') && !isId('tok-K3X9Q2M7'));
  // bytes of 252 and above are skipped, so every character is equally likely
  assert.equal(makeId('token', { bytes: (k) => Uint8Array.from({ length: k }, (_, i) => (i % 2 ? 255 : 37)) }), 'tok-11111111');
});

test('names: players see the alias until the name is learned; the GM always sees the name', () => {
  const kell = { name: 'Varsha Kell', alias: 'Hooded Cultist', known: false }, rat = { name: 'Wet-Nosed Rat' };
  assert.equal(publicName(kell), 'Hooded Cultist');
  assert.equal(nameFor(kell, 'player'), 'Hooded Cultist');
  assert.equal(nameFor(kell, 'gm'), 'Varsha Kell');
  assert.equal(publicName({ ...kell, known: true }), 'Varsha Kell');
  assert.equal(nameFor(rat, 'player'), 'Wet-Nosed Rat');
  assert.equal(publicName({ name: 'Chillwind' }), 'Chillwind', 'a proper name with no alias shows as it is');
  assert.equal(publicName({ name: "Xinthe Y'Baine", alias: 'Veiled Woman', known: true }), "Xinthe Y'Baine", 'never changed or made generic');
});

test('letters: the adjective\'s initial, unique within a group, two letters when needed', () => {
  assert.equal(letterOf({ name: 'Wet-Nosed Rat' }), 'W');
  assert.equal(letterOf({ name: 'Varsha Kell', alias: 'Hooded Cultist' }), 'H', 'from what players see');
  assert.equal(letterOf({ name: 'x', short: 'Q' }), 'Q');
  assert.equal(pickLetter('Wet-Nosed Rat'), 'W');
  assert.equal(pickLetter('Wet-Nosed Rat', new Set(['W'])), 'N');
  assert.equal(pickLetter('Wet-Nosed Rat', new Set(['W', 'N', 'R'])), 'WN');
  assert.equal(pickLetter("Xinthe Y'Baine"), 'X');
  const tokens = { a: { name: 'Wet-Nosed Rat', group: 'g' }, b: { name: 'Wan Rat', group: 'h' }, c: { name: 'Wiry Rat', img: 'x.webp', group: 'g' } };
  assert.deepEqual([...lettersInGroup(tokens, 'g')], ['W'], 'other groups and tokens with images do not count');
  assert.equal(groupOf({}, 'tok-1'), 'tok-1', 'no group: a group of one');
});

test('lookups: by id, name or alias, letter case and spaces ignored; a shared name is refused', () => {
  const tokens = { 'tok-a': { name: 'Wet-Nosed Rat' }, 'tok-b': { name: 'Varsha Kell', alias: 'Hooded Cultist' }, 'tok-c': { name: 'Rat' }, 'tok-d': { name: 'Rat' } };
  assert.equal(resolveToken(tokens, 'tok-a'), 'tok-a');
  assert.equal(resolveToken(tokens, '  wet-nosed   RAT '), 'tok-a');
  assert.equal(resolveToken(tokens, 'Hooded Cultist'), 'tok-b');
  assert.equal(resolveToken(tokens, 'Varsha Kell'), 'tok-b');
  assert.throws(() => resolveToken(tokens, 'Rat'), /matches 2 tokens \(tok-c, tok-d\): give the id/);
  assert.throws(() => resolveToken(tokens, 'Nobody'), /no token is called/);
});

test('naming checks: shared names, numbered names and shared letters in a group are warnings', () => {
  const p = nameProblems({
    a: { name: 'Rat', kind: 'foe', group: 'g' }, b: { name: 'rat', kind: 'foe', group: 'g' }, c: { name: 'Rat 3', kind: 'foe' },
    d: { name: 'Bound Thief (one)', kind: 'npc' }, e: { name: 'Kerra', kind: 'pc' }, f: { name: 'K', kind: 'marker' },
  }).join('\n');
  assert.match(p, /a, b share the name/);
  assert.match(p, /c: "Rat 3" is numbered/);
  assert.match(p, /d: "Bound Thief \(one\)" is numbered/);
  assert.match(p, /a, b share the letter R in group g/);
  assert.doesNotMatch(p, /\be\b:|Kerra/);
  assert.deepEqual(nameProblems(KEEP().tokens), [], 'the sample campaign is named by the rules');
});

test('the token tool adds creatures with a fresh id and a free letter, and reveals names', () => {
  const tokens = KEEP().tokens;
  const r = addToken({ tokens, map: 'sample-keep', name: 'Squeaky Rat', type: 'rat', group: 'cellar-rats', at: [12, 28], size: 0.5 });
  assert.match(r.path, /^tokens\/tok-[0-9a-z]{8}$/);
  assert.equal(r.record.map, 'sample-keep');
  assert.equal(r.record.short, 'SR', 'S (Scabby-Tailed) and R (Ragged-Eared) are taken in the cellar rats: two letters');
  assert.deepEqual(r.warnings, []);
  const dup = addToken({ tokens, map: 'sample-keep', name: 'Wet-Nosed Rat', type: 'rat', at: [1, 1] });
  assert.ok(dup.warnings.some((w) => /share the name/.test(w)), 'a duplicate name is a warning, not an error');
  const named = addToken({ tokens, map: 'sample-keep', name: 'Djarek Evergloam', alias: 'Grey-Cloaked Stranger', kind: 'npc', type: 'human', at: [5, 5] });
  assert.equal(named.record.name, 'Djarek Evergloam');
  assert.equal(named.record.known, false);
  assert.equal(named.record.short, 'G', 'the letter comes from what players see');
  assert.throws(() => addToken({ tokens, map: 'm', name: 'Rat', at: [1, 1] }), /--type/);
  assert.throws(() => addToken({ tokens, map: 'm', name: 'X', type: 'Big Rat', at: [1, 1] }), /--type/);
  const rev = revealToken(tokens, 'Hooded Cultist');
  assert.equal(rev.record.known, true); assert.equal(rev.record.name, 'Varsha Kell');
  assert.throws(() => revealToken(tokens, 'Kerra'), /no alias/);
});

test('the id converter: one id per creature across maps, with every reference', () => {
  const a = { tokens: { kerra: { x: 1, y: 1 }, rat1: { x: 2, y: 2 } }, hidden_marks: { rat1: [3, 3] }, notes: { n1: { text: 'x' } }, templates: { t1: { caster: 'kerra', cells: [] } } };
  const b = { tokens: { kerra: { x: 5, y: 5 }, 'tok-k3x9q2m7': { x: 1, y: 1 } } };
  const map = planIds([a, b], { kerra: 'tok-kerrakrr' });
  assert.equal(map.token.kerra, 'tok-kerrakrr', 'a given id is used');
  assert.ok(!('tok-k3x9q2m7' in map.token), 'ids already generated are kept');
  const ca = convertState(a, map), cb = convertState(b, map);
  assert.deepEqual(Object.keys(ca.tokens), ['tok-kerrakrr', map.token.rat1]);
  assert.deepEqual(Object.keys(ca.hidden_marks), [map.token.rat1]);
  assert.match(Object.keys(ca.notes)[0], /^note-/);
  const [tid, tpl] = Object.entries(ca.templates)[0];
  assert.match(tid, /^tpl-/); assert.equal(tpl.caster, 'tok-kerrakrr');
  assert.deepEqual(Object.keys(cb.tokens), ['tok-kerrakrr', 'tok-k3x9q2m7'], 'the same PC on another map: the same id');
  // the board's records: new records set, old deleted, references rewritten
  const { mapping, ops } = convertRecords({
    'tokens/kerra': { map: 'm', x: 1, y: 1 }, 'targets/player': { ids: ['kerra'] }, 'templates/t1': { map: 'm', caster: 'kerra' },
    'mapstate/m': { map: 'm', hidden_marks: { kerra: [1, 1] } }, 'log/0abc': { what: 'Kerra moved' },
  }, { kerra: 'tok-kerrakrr' });
  const by = (p) => ops.filter((o) => o.path === p);
  assert.deepEqual(by('tokens/tok-kerrakrr')[0], { op: 'set', path: 'tokens/tok-kerrakrr', data: { map: 'm', x: 1, y: 1 } });
  assert.equal(by('tokens/kerra')[0].op, 'delete');
  assert.deepEqual(by('targets/player')[0].data, { ids: ['tok-kerrakrr'] });
  assert.equal(by(`templates/${mapping.template.t1}`)[0].data.caster, 'tok-kerrakrr');
  assert.deepEqual(by('mapstate/m')[0].data, { hidden_marks: { 'tok-kerrakrr': [1, 1] } });
  assert.equal(by('log/0abc').length, 0, 'the log is a stream: untouched');
});

test('saves need generated ids, and name warnings show in the validator', () => {
  const run = (change) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rvtt-names-'));
    fs.cpSync(path.join(ROOT, 'examples/sample-pack'), path.join(tmp, 'pack'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'examples/campaigns/keep-test'), path.join(tmp, 'save'), { recursive: true });
    const f = path.join(tmp, 'save', 'maps', 'sample-keep.json'), st = JSON.parse(fs.readFileSync(f, 'utf8'));
    change(st.tokens);
    fs.writeFileSync(f, JSON.stringify(st));
    const r = validate(path.join(tmp, 'pack'), { save: path.join(tmp, 'save') });
    fs.rmSync(tmp, { recursive: true, force: true });
    return { errs: r.errors.map((e) => e.msg).join('\n'), warns: r.warnings.map((e) => e.msg).join('\n') };
  };
  assert.match(run((t) => { t.rat9 = { x: 1, y: 1 }; }).errs, /"rat9" must match pattern.*tools\/ids\.mjs/, 'a hand-picked id is refused, by name');
  const dup = run((t) => { t['tok-dupdup01'] = { name: 'Wet-Nosed Rat', kind: 'foe', x: 2, y: 2, group: 'cellar-rats' }; });
  assert.equal(dup.errs, '', 'duplicates are never errors');
  assert.match(dup.warns, /share the name "Wet-Nosed Rat"/);
  assert.match(dup.warns, /share the letter W in group cellar-rats/);
});
