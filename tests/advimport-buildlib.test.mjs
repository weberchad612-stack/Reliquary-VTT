// Shared builders (tools/advimport/buildlib.py, areamap.py, rulesets/pf2e/advbuild.py): shorthands, names, checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PY = process.platform === 'win32' ? 'python' : 'python3';
const run = (code) => spawnSync(PY, ['-c', `import sys, json\nsys.path.insert(0, "tools/advimport")\n${code}`], { encoding: 'utf8' });

function pack() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-'));
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ id: 'p', ruleset: 'pf2e', maps: ['cave', 'yard'] }));
  fs.mkdirSync(path.join(dir, 'art'));
  fs.writeFileSync(path.join(dir, 'art', 'art.json'), JSON.stringify({ wolf: { src: 'book/w.webp' } }));
  fs.mkdirSync(path.join(dir, 'notes'));
  fs.writeFileSync(path.join(dir, 'notes', 'ch1.md'), '# Chapter 1');
  return dir.replace(/\\/g, '/');
}

test('buildlib: shorthands, unique names and the PF2E adjustment', () => {
  const r = run(`
from buildlib import *
MC = source("pathfinder-monster-core")
enc = [encounter("a1", "cave", "A1", "4", 40, [creature("Wolf", MC("wolf"), [1, 1]), creature("Wolf", MC("wolf"), [2, 1]), creature("Giant rat", MC("giant-rat"), [3, 1])]),
       encounter("a2", "cave", "A2", "5", 20, [creature("Wolf", MC("wolf"), [5, 5])])]
unique_names(enc)
print(json.dumps([[c["name"], c.get("note")] for e in enc for c in e["creatures"]]))
print(MC("wolf"), item("dagger", qty=2))
import importlib.util
spec = importlib.util.spec_from_file_location("a", "rulesets/pf2e/advbuild.py"); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(json.dumps(m.elite(10)[2]), json.dumps(m.weak(-10)[0]))
`);
  assert.equal(r.status, 0, r.stderr);
  const [names, refs, adj] = r.stdout.trim().split('\n');
  assert.deepEqual(JSON.parse(names), [['Amber wolf', null], ['Bristling wolf', null], ['Giant rat', null], ['Crooked wolf', null]]);
  assert.match(refs, /^pathfinder-monster-core:creature\/wolf \{'ref': 'item\/dagger', 'qty': 2\}$/);
  assert.match(adj, /"selector": "hp", "value": 10, "label": "Elite"/);
  assert.match(adj, /"selector": "all", "value": -2, "label": "Weak"/);
});

test('buildlib: write_adventure checks before writing, and fills maps and notes from the pack', () => {
  const dir = pack();
  const bad = run(`
from buildlib import *
try:
    write_adventure("${dir}", title="T", encounters=[encounter("a1", "mars", "A1", "4", 40, [creature("Wolf", None, None, "fox")]), encounter("a1", "cave", "A1", "4", 40, [])])
except BuildError as e:
    print(e)
`);
  assert.equal(bad.status, 0, bad.stderr);
  assert.match(bad.stdout, /encounter id a1 used twice/);
  assert.match(bad.stdout, /map mars is not in pack\.json/);
  assert.match(bad.stdout, /Wolf has no square/);
  assert.match(bad.stdout, /art fox is not in art\/art\.json/);
  assert.ok(!fs.existsSync(path.join(dir, 'adventure.json')), 'nothing written');
  const ok = run(`
from buildlib import *
write_adventure("${dir}", title="T", start={"map": "cave"}, encounters=[encounter("a1", "cave", "A1", "4", 40, [creature("Wolf", None, [1, 1], "wolf")])])
`);
  assert.equal(ok.status, 0, ok.stderr);
  const adv = JSON.parse(fs.readFileSync(path.join(dir, 'adventure.json'), 'utf8'));
  assert.deepEqual(adv.maps, ['cave', 'yard']);
  assert.deepEqual(adv.notes, ['notes/ch1.md']);
  assert.deepEqual(Object.keys(adv).slice(0, 4), ['title', 'maps', 'start', 'notes']);
});

test('buildlib: write_events wants one kickoff and real encounters and subsystems', () => {
  const dir = pack();
  fs.writeFileSync(path.join(dir, 'adventure.json'), JSON.stringify({ encounters: [{ id: 'a1' }] }));
  const r = run(`
from buildlib import *
ev = [{"id": "start", "title": "S", "kind": "story", "stages": [{"id": "s", "actions": [start_encounter("a9"), show_subsystem("chase")]}]}]
try:
    write_events("${dir}", ev, [victory("farm", "Farm", "4", 5, [check("nature", None, "an hour")], "x")])
except BuildError as e:
    print(e)
ev[0]["kickoff"] = True
ev[0]["stages"][0]["actions"] = [start_encounter("a1"), show_subsystem("farm")]
write_events("${dir}", ev, [victory("farm", "Farm", "4", 5, [check("nature", None, "an hour")], "x")])
`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /0 kickoff events/);
  assert.match(r.stdout, /encounter a9 is not an encounter/);
  assert.match(r.stdout, /subsystem chase does not exist/);
  const ev = JSON.parse(fs.readFileSync(path.join(dir, 'adventure-events.json'), 'utf8'));
  assert.equal(ev.subsystems[0].parts[0].checks[0].dc, undefined, 'a check with no DC is left for dcfill');
});

test('area maps: labels inside each map\'s box become its places; unknown and missing ones stop the map', () => {
  const r = run(`
from areamap import places_for
labels = [("W2", 300, 50), ("W1", 100, 40), ("W1", 900, 40), ("P", 20, 700), ("D1", 50, 650), ("P", 80, 720), ("W9", 10, 10)]
town = {"id": "town", "box": [0, 0, 1000, 600], "labels": "^W\\\\d+$", "places": {"W1": {"name": "Inn", "type": "Inn"}, "W2": {"name": "Mill", "public": False}, "W9": {"name": "Gate"}}}
p, probs = places_for(town, labels)
print(json.dumps([(x["id"], x["at"], x.get("public", True)) for x in p]), probs)
region = {"id": "region", "box": [0, 600, 1000, 1200], "labels": "^(D\\\\d+|P)$", "places": {"D1": {"name": "Town"}, "D2": {"name": "Lake"}},
          "repeat": {"P": {"id": "p", "name": "Grove", "public": False, "size": 60}}}
p, probs = places_for(region, labels)
print(json.dumps([(x["id"], x["at"]) for x in p]), probs)
`);
  assert.equal(r.status, 0, r.stderr);
  const [town, region] = r.stdout.trim().split('\n');
  assert.equal(town, '[["w1", [100, 40], true], ["w1-b", [900, 40], true], ["w2", [300, 50], false], ["w9", [10, 10], true]] []');
  assert.match(region, /\["d1", \[50, 50\]\], \["p1", \[20, 100\]\], \["p2", \[80, 120\]\]/);
  assert.match(region, /place D2 has no label on the map/);
});
