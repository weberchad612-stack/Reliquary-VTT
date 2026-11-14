// Stat block matching (tools/advimport/statmatch.mjs with the system's reader, rulesets/pf2e/bookimport.js). The page
// text is invented; no book content.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchBlocks, nameVariants, systemReader } from '../tools/advimport/statmatch.mjs';

const PAGE = `
THE MOSSY HALLS
A2. LANTERN ROOM
Two lantern beetles cling to the ceiling.
BEETLES, LANTERN (2)
Perception +4; darkvision
AC 14; Fort +6, Ref +4, Will +1
HP 12
Stride [one-action] 20 feet, climb 20 feet
Melee [one-action] mandibles +5, Damage 1d6 piercing
TREASURE
A small copper ring.
`;

const creature = (name, stats, strikes) => ({ name, stats, items: strikes.map(([n, attack]) => ({ kind: 'strike', name: n, attack })) });
const cands = [
  { key: 'demo:creature/lantern-beetle', name: 'lantern beetle',
    doc: creature('Lantern Beetle', { perception: 6, ac: 16, hp: 18, saves: { fortitude: 8, reflex: 6, will: 3 }, speeds: { land: 20, climb: 20 } }, [['Mandibles', 7]]) },
  { key: 'demo:creature/lantern-moth', name: 'lantern moth', doc: creature('Lantern Moth', {}, []) },
];

test('statmatch: names as printed, turned round and made singular', () => {
  const v = nameVariants('BEETLES, LANTERN (2)');
  assert.ok(v.includes('lantern beetle'));
  assert.ok(nameVariants('WEAK MOSS TROLL').includes('moss troll'));
});

test('statmatch: the PF2E reader finds the block, skips running heads and furniture, and calls a weak creature weak', async () => {
  const sys = await systemReader('pf2e');
  const blocks = sys.parseBlocks(PAGE, 7, { skip: /^THE MOSSY HALLS/ });
  assert.equal(blocks.length, 1);
  const [b] = blocks;
  assert.deepEqual([b.name, b.count, b.perception, b.ac, b.hp], ['BEETLES, LANTERN', 2, 4, 14, 12]);
  assert.deepEqual(b.speeds, { land: 20, climb: 20 });
  const [r] = matchBlocks(blocks, cands, ['demo'], sys.compare);
  assert.equal(r.proposal, 'demo:creature/lantern-beetle');
  assert.equal(r.how, 'name');
  assert.equal(r.verdict, 'weak');
  assert.ok(r.diffs.some((d) => d.what === 'mandibles attack' && d.book === 5 && d.open === 7));
});

test('statmatch: a game system with no reader is reported, not guessed', async () => {
  await assert.rejects(systemReader('no-such-system'), /no printed stat block reader/);
});
