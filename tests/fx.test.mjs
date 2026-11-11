// Visual effects: primitives draw without error, the planner's rules, lookup and fallbacks, and the PF2E library.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRIMITIVES, ENGINE_EFFECTS, BASE_PALETTE, makeRng, planEffect, resolveEffect, checkLibrary, FxPlayer } from '../engine/fx/fx.js';
import { PF2E_EFFECTS } from '../rulesets/pf2e/effects.js';
import { PF2E_SYSTEM } from '../rulesets/pf2e/system.js';

/** A fake 2-D context that accepts every call and records them, and checks numbers passed are finite. */
function fakeContext() {
  const calls = [];
  const target = { calls };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return (...args) => { for (const v of args) assert.ok(Number.isFinite(v), `${k}: ${args}`); return { addColorStop() {} }; };
      return (...args) => {
        for (const v of args) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${String(k)}(${args.join(', ')})`);
        calls.push(k);
      };
    },
    set(t, k, v) { if (typeof v === 'number') assert.ok(Number.isFinite(v), `${String(k)} = ${v}`); t[k] = v; return true; },
  });
}

const CS = 50, A = { x: 100, y: 100 }, B = { x: 400, y: 250 };
const CELLS = [{ x: 350, y: 200 }, { x: 400, y: 200 }, { x: 350, y: 250 }];

/** Draw every job of a plan at many moments; returns the player's last error, if any. */
function playAll(jobs, { snapshot } = {}) {
  const env = { cs: CS, rng: makeRng(7), reduced: false, snapshot };
  const pl = new FxPlayer(); pl.add(jobs, 0, env);
  const end = Math.max(0, ...jobs.map((j) => j.after + j.ms));
  const g = fakeContext();
  for (let t = 0; t <= end + 20; t += 17) pl.draw(g, t);
  assert.equal(pl.busy, false, 'every job finishes');
  return { error: pl.lastError, calls: g.calls };
}

test('every primitive draws at every stage without error', () => {
  for (const [name, prim] of Object.entries(PRIMITIVES)) {
    const env = { cs: CS, rng: makeRng(3), reduced: false, snapshot: () => {} };
    const s = { at: B, from: A, to: B, colour: '#ff8a2a', cells: CELLS, angle: 0.4, ms: prim.ms };
    const state = prim.init ? prim.init(s, env) : null;
    for (const p of [0, 0.01, 0.25, 0.5, 0.75, 0.99]) {
      const g = fakeContext();
      assert.doesNotThrow(() => prim.draw(g, p, s, env, state), name);
    }
    assert.ok(prim.ms > 0, `${name} has a duration`);
  }
});

test('the missile draws every shape, and zero-length moves are safe', () => {
  for (const shape of ['arrow', 'bolt', 'javelin', 'dart', 'stone', 'rock', 'flask', 'boulder', 'bullet']) {
    const g = fakeContext();
    PRIMITIVES.missile.draw(g, 0.5, { from: A, to: B, colour: '#fff', shape, arcHeight: 0.4 }, { cs: CS });
    assert.ok(g.calls.includes('fill') || g.calls.includes('stroke'), shape);
  }
  for (const name of ['orb', 'streak', 'bolt', 'beam', 'tracer', 'rocket', 'missile']) {
    const env = { cs: CS, rng: makeRng(1) }, s = { from: A, to: A, at: A, colour: '#fff' };
    assert.doesNotThrow(() => PRIMITIVES[name].draw(fakeContext(), 0.5, s, env, PRIMITIVES[name].init ? PRIMITIVES[name].init(s, env) : null), name);
  }
});

test('the shake asks the board to redraw the map under the token, and does nothing with reduced motion', () => {
  const seen = [];
  PRIMITIVES.shake.draw(fakeContext(), 0.3, { at: B }, { cs: CS, snapshot: (g, x, y, r, dx, dy) => seen.push([x, y, r, dx, dy]) });
  assert.equal(seen.length, 1); assert.equal(seen[0][0], B.x); assert.ok(seen[0][2] > 0);
  PRIMITIVES.shake.draw(fakeContext(), 0.3, { at: B }, { cs: CS, reduced: true, snapshot: () => seen.push(1) });
  assert.equal(seen.length, 1);
});

test('the same seed makes the same random numbers', () => {
  const a = makeRng('fx/123'), b = makeRng('fx/123'), c = makeRng('fx/124');
  const xs = [a(), a(), a()];
  assert.deepEqual(xs, [b(), b(), b()]);
  assert.notDeepEqual(xs, [c(), c(), c()]);
  for (const x of xs) assert.ok(x >= 0 && x < 1);
});

const plan = (name, o = {}, extra = {}) => planEffect(PF2E_EFFECTS.effects[name], { a: A, b: B, cells: CELLS, cs: CS, o, palette: PF2E_EFFECTS.palette, rng: makeRng(5), ...extra });

test('a hit glows, sparks and shakes the target after the impact', () => {
  const jobs = plan('strike_slash', { result: 'hit' });
  const ps = jobs.map((j) => j.p);
  assert.ok(ps.includes('arc') && ps.includes('glow') && ps.includes('sparks') && ps.includes('shake'));
  assert.ok(!ps.includes('text'), 'no text on a plain hit');
  const glow = jobs.find((j) => j.p === 'glow');
  assert.equal(glow.after, PF2E_EFFECTS.effects.strike_slash.impact);
  assert.deepEqual(glow.s.at, B);
});

test('a critical hit adds a gold ring and CRIT!; a miss goes wide and says Miss', () => {
  const crit = plan('strike_slash', { result: 'crit' });
  assert.ok(crit.some((j) => j.p === 'text' && j.s.text === 'CRIT!' && j.s.colour === BASE_PALETTE.gold));
  assert.ok(crit.some((j) => j.p === 'ring' && j.s.colour === BASE_PALETTE.gold));
  assert.ok(crit.find((j) => j.p === 'sparks').s.count > plan('strike_slash').find((j) => j.p === 'sparks').s.count);

  const miss = plan('ranged_arrow', { result: 'miss' });
  const arrow = miss.find((j) => j.p === 'missile');
  assert.notDeepEqual(arrow.s.to, B, 'the arrow goes wide');
  const d = Math.hypot(arrow.s.to.x - B.x, arrow.s.to.y - B.y);
  assert.ok(d > CS && d < CS * 2, `lands beside the target (${d})`);
  const t = miss.find((j) => j.p === 'text');
  assert.equal(t.s.text, 'Miss'); assert.deepEqual(t.s.at, B, 'the word shows on the target itself');
  assert.ok(!miss.some((j) => j.p === 'shake' || j.p === 'sparks'));
});

test('floating text: damage red, healing green, and a crit\'s text after CRIT!', () => {
  const dmg = plan('strike_slash', { result: 'hit', text: '-12' }).find((j) => j.p === 'text');
  assert.equal(dmg.s.text, '-12'); assert.equal(dmg.s.colour, BASE_PALETTE.damage);
  const heal = plan('heal', { text: '+9' }).find((j) => j.p === 'text');
  assert.equal(heal.s.colour, BASE_PALETTE.healing); assert.equal(heal.after, PF2E_EFFECTS.effects.heal.textAt);
  const crit = plan('strike_slash', { result: 'crit', text: '-24' }).filter((j) => j.p === 'text');
  assert.equal(crit.length, 2); assert.ok(crit.find((j) => j.s.text === '-24').after > crit.find((j) => j.s.text === 'CRIT!').after);
  assert.ok(!plan('strike_slash', { result: 'miss', text: '-12' }).some((j) => j.s.text === '-12'), 'a miss never shows damage');
});

test('an effect\'s own result steps replace the shared ones, and $text uses the play\'s text', () => {
  const stuck = plan('ranged_web', { result: 'hit' });
  assert.ok(stuck.some((j) => j.p === 'text' && j.s.text === 'Stuck'));
  assert.ok(!stuck.some((j) => j.p === 'shake'));
  const named = plan('ranged_web', { result: 'hit', text: 'Immobilized' }).filter((j) => j.p === 'text');
  assert.ok(named.some((j) => j.s.text === 'Immobilized'));
  assert.equal(plan('demoralize', { result: 'miss' }).find((j) => j.p === 'text').s.text, 'Unmoved');
});

test('repeat "n" makes one missile per count, staggered and curved differently', () => {
  for (const n of [1, 2, 3]) {
    const orbs = plan('force_missiles', { n }).filter((j) => j.p === 'orb');
    assert.equal(orbs.length, n);
    if (n === 3) {
      assert.deepEqual(orbs.map((j) => j.after), [0, 130, 260]);
      assert.deepEqual(orbs.map((j) => j.s.curve), [-0.9, 0, 0.9]);
    }
  }
  assert.equal(plan('force_missiles', { n: 40 }).filter((j) => j.p === 'orb').length, 5, 'capped at max');
});

test('area effects fill the template\'s squares', () => {
  const jobs = plan('burst_fire');
  const fill = jobs.find((j) => j.p === 'fill');
  assert.deepEqual(fill.s.cells, CELLS);
  assert.equal(fill.s.colour, PF2E_EFFECTS.palette.fire);
  assert.ok(!jobs.some((j) => j.s.text === 'Miss'), 'areas have no attack result');
  const r = playAll(jobs); assert.equal(r.error, undefined);
});

test('colours: palette names, main (the play\'s colour), traits and #hex', () => {
  const main = plan('buff', { colour: '#123456' });
  assert.ok(main.every((j) => j.s.colour === '#123456'));
  assert.equal(plan('buff').find((j) => j.p === 'ring').s.colour, BASE_PALETTE.gold);
  assert.equal(plan('ray_fire', { result: 'hit' }).find((j) => j.p === 'glow').s.colour, PF2E_EFFECTS.palette.fire, 'the hit glow is the damage colour');
});

test('back moves a swing or a thrust behind the target, toward the attacker', () => {
  const arc = plan('strike_slash').find((j) => j.p === 'arc');
  assert.ok(Math.hypot(arc.s.at.x - A.x, arc.s.at.y - A.y) < Math.hypot(B.x - A.x, B.y - A.y));
  const thrust = plan('strike_pierce').find((j) => j.p === 'streak');
  assert.ok(Math.abs(Math.hypot(thrust.s.from.x - B.x, thrust.s.from.y - B.y) - 1.3 * CS) < 0.01);
  assert.deepEqual(thrust.s.to, B);
});

test('reduced motion keeps fades, text and fills, and drops particles, rings and shakes', () => {
  const jobs = plan('burst_fire', {}, { reduced: true });
  const ps = new Set(jobs.map((j) => j.p));
  assert.ok(ps.has('fill') && ps.has('glow') && ps.has('orb'));
  assert.ok(!ps.has('sparks') && !ps.has('ring'));
  const hit = plan('strike_bludgeon', { result: 'crit', text: '-30' }, { reduced: true });
  assert.ok(!hit.some((j) => j.p === 'shake'));
  assert.ok(hit.some((j) => j.s.text === 'CRIT!') && hit.some((j) => j.s.text === '-30'));
  const bolt = plan('arc_lightning', {}, { reduced: true });
  assert.ok(bolt.some((j) => j.p === 'streak') && !bolt.some((j) => j.p === 'bolt'), 'lightning becomes a calm streak');
});

test('effects at the source alone (no target) still plan', () => {
  const jobs = planEffect(PF2E_EFFECTS.effects.emanation_anthem, { a: A, cs: CS, palette: PF2E_EFFECTS.palette, rng: makeRng(1) });
  assert.ok(jobs.length > 0 && jobs.every((j) => j.s.at.x === A.x));
  assert.equal(playAll(jobs).error, undefined);
});

test('lookup: the pack first, then the ruleset, then the engine, then fallbacks by kind and trait', () => {
  const pack = { via: 'pack', effects: { strike_slash: { group: 'Pack', label: 'Red slash', attack: true, steps: [] }, sewer_gas: { group: 'Pack', label: 'Gas', kind: 'area', steps: [] } } };
  const rules = { via: 'ruleset', ...PF2E_EFFECTS };
  assert.equal(resolveEffect('strike_slash', [pack, rules]).via, 'pack');
  assert.equal(resolveEffect('sewer_gas', [pack, rules]).via, 'pack');
  assert.equal(resolveEffect('burst_fire', [pack, rules]).via, 'ruleset');
  assert.equal(resolveEffect('projectile', [pack, rules]).via, 'engine');
  const fb = (name, hint) => resolveEffect(name, [pack, rules], hint);
  assert.equal(fb('meteor_swarm', { kind: 'area', traits: ['fire'] }).name, 'burst_fire');
  assert.equal(fb('greataxe_strike', { kind: 'strike', traits: ['slashing'] }).name, 'strike_slash');
  assert.equal(fb('warhammer', { kind: 'strike', traits: ['bludgeoning'] }).name, 'strike_bludgeon');
  assert.equal(fb('mystery_jab', { kind: 'strike' }).name, 'strike_slash');
  assert.equal(fb('polar_ray', { kind: 'projectile', traits: ['cold'] }).name, 'ray_cold');
  assert.equal(fb('whatever', {}).name, 'hit');
  assert.equal(resolveEffect('whatever', [], { kind: 'area' }).name, 'burst', 'no library: the engine\'s plain effects');
  assert.equal(resolveEffect('whatever', [], { kind: 'heal' }).name, 'buff');
});

test('every engine and PF2E effect plans and plays for every result without error', () => {
  const libs = [['engine', { effects: ENGINE_EFFECTS }], ['pf2e', PF2E_EFFECTS]];
  for (const [lib, L] of libs) {
    for (const [name, e] of Object.entries(L.effects)) {
      for (const result of e.attack ? ['hit', 'crit', 'miss'] : [undefined]) {
        for (const reduced of [false, true]) {
          const jobs = planEffect(e, { a: A, b: B, cells: CELLS, cs: CS, o: { result, text: '-7', n: 2 }, palette: L.palette, rng: makeRng(name), reduced });
          for (const j of jobs) {
            assert.ok(PRIMITIVES[j.p], `${lib}/${name}: ${j.p}`);
            assert.ok(/^(#|rgb)/.test(j.s.colour), `${lib}/${name}: ${j.p} colour ${j.s.colour}`);
            assert.ok(Number.isFinite(j.after) && j.ms > 0, `${lib}/${name}: timing`);
          }
          const { error } = playAll(jobs, { snapshot: () => {} });
          assert.equal(error, undefined, `${lib}/${name} ${result || ''}: ${error}`);
        }
      }
    }
  }
});

test('the PF2E library is complete, valid and part of the system configuration', () => {
  assert.deepEqual(checkLibrary(PF2E_EFFECTS), []);
  assert.deepEqual(checkLibrary({ effects: ENGINE_EFFECTS }), []);
  assert.equal(PF2E_SYSTEM.effects, PF2E_EFFECTS);
  const groups = new Set(Object.values(PF2E_EFFECTS.effects).map((e) => e.group));
  for (const g of ['Weapon strikes', 'Ranged', 'Spell projectiles', 'Areas', 'Healing and buffs', 'Conditions and social', 'Creature attacks', 'Movement']) assert.ok(groups.has(g), g);
  assert.ok(Object.keys(PF2E_EFFECTS.effects).length >= 80, `${Object.keys(PF2E_EFFECTS.effects).length} effects`);
  for (const [name, e] of Object.entries(PF2E_EFFECTS.effects)) {
    assert.ok(!/chuck|kerra|pip|jix|lyra|level ?\d/i.test(name + e.label), `${name}: no character or level names`);
  }
});

test('checkLibrary reports what is wrong with a pack\'s library', () => {
  const bad = { palette: { teal: '#0ff' }, effects: {
    'Bad-Name': { group: 'X', label: 'x', steps: [] },
    nogroup: { steps: [] },
    nosteps: { group: 'X', label: 'x' },
    oddstep: { group: 'X', label: 'x', traits: ['plasma'], steps: [{ p: 'teleporter', colour: 'teal' }, { p: 'glow', colour: 'octarine' }] },
  }, fallbacks: [{ kind: 'area', effect: 'missing' }] };
  const out = checkLibrary(bad).join('\n');
  for (const s of ['Bad-Name: names', 'nogroup: needs a group', 'nosteps: no steps', 'unknown primitive "teleporter"', 'unknown colour "octarine"', 'trait "plasma"', 'unknown effect "missing"']) assert.ok(out.includes(s), s);
  assert.ok(!out.includes('"teal"'), 'the library\'s own palette counts');
  assert.deepEqual(checkLibrary({ effects: { burn: { group: 'P', label: 'Burn', steps: [{ p: 'glow', colour: 'fire' }] } } }, PF2E_EFFECTS), [], 'a pack can use the ruleset\'s colours');
});

test('the player keeps jobs until they finish and survives a bad step', () => {
  const pl = new FxPlayer(), env = { cs: CS, rng: makeRng(1) };
  pl.add([{ p: 'glow', after: 100, ms: 200, s: { at: B, colour: '#fff' } }, { p: 'nope', after: 0, ms: 100, s: {} }], 1000, env);
  assert.equal(pl.jobs.length, 1, 'unknown primitives are skipped');
  const g = fakeContext();
  assert.equal(pl.draw(g, 1050), true); assert.equal(g.calls.length, 0, 'not started yet');
  assert.equal(pl.draw(g, 1200), true); assert.ok(g.calls.includes('fill'));
  assert.equal(pl.draw(g, 1300), false); assert.equal(pl.busy, false);
  pl.add([{ p: 'ring', after: 0, ms: 100, s: { at: null, colour: '#fff' } }], 0, env);
  assert.doesNotThrow(() => pl.draw(fakeContext(), 50));
  assert.ok(pl.lastError, 'the error is kept for the board to report');
  pl.clear(); assert.equal(pl.busy, false);
});
