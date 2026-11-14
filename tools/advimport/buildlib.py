"""Shared pieces of a pack's builders (docs/best-practices/adventure-importer.md section 13).

A book's own builder (<pack>/build_adventure.py, build_events.py) holds only that book's content: its encounters,
objects, ledger, events and subsystems, paraphrased. Everything the books share comes from here:

    import sys; sys.path.insert(0, "tools/advimport")
    from buildlib import *

    MC = source("pathfinder-monster-core")              # MC("goblin-warrior") -> "pathfinder-monster-core:creature/goblin-warrior"
    enc = [encounter("a1-goblins", "level-a", "A1", "4", 40, [creature("Goblin warrior", MC("goblin-warrior"), [3, 4])])]
    unique_names(enc)                                    # two goblin warriors on one map: "Amber warrior", "Bristling warrior"
    write_adventure("packs/<pack>", title=..., book=..., pages=..., start=..., encounters=enc, objects=..., ledger=...)
    write_events("packs/<pack>", events, subsystems)

write_adventure and write_events check what a hand-written builder used to get wrong, and stop before writing: ids
used twice, a map the pack does not have, a creature with no square, token art that art.json does not list, an
events file with no kickoff or two, an event that names an encounter or subsystem that does not exist.
Game-system pieces (a creature's weak or elite adjustment) come from rulesets/<system>/advbuild.py: system(pack).
"""
import glob
import importlib.util
import json
import os
from collections import Counter

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class BuildError(ValueError):
    """The builder's data is wrong; nothing was written."""


# ---- content references and shorthands ----

def source(name, kind="creature"):
    """A content source as a function: source("pathfinder-monster-core")("goblin-warrior")."""
    return lambda slug: f"{name}:{kind}/{slug}"


def creature(name, ref, at, art=None, **k):
    return {"name": name, **({"ref": ref} if ref else {}), "at": at, **({"art": art} if art else {}), **k}


def encounter(eid, map_id, room, pages, xp, creatures, hidden=True, friendly=False, **k):
    return {"id": eid, "map": map_id, "room": room, "pages": pages, "xp": xp, "hidden": hidden,
            **({"friendly": True} if friendly else {}), "creatures": creatures, **k}


def obj(oid, map_id, room, at, name, kind, **k):
    return {"id": oid, "map": map_id, "room": room, "at": at, "name": name, "kind": kind, **k}


def item(ref, **k):
    return {"ref": "item/" + ref, **k}


# ---- events and subsystems ----

note = lambda t: {"do": "note", "text": t}
narrate = lambda t: {"do": "narrate", "text": t}
xp = lambda n, why: {"do": "xp", "amount": n, "why": why}
ledger = lambda kind, title, text, **k: {"do": "ledger", "kind": kind, "title": title, "text": text, **k}
flag = lambda name: {"do": "flag", "name": name}
show_subsystem = lambda sid: {"do": "subsystem", "id": sid, "show": True}
start_encounter = lambda group, **k: {"do": "encounter", "group": group, **k}
reveal = lambda group: {"do": "reveal", "group": group}


def check(skill, dc, why):
    """A subsystem check; dc None is filled with the level-based DC by dcfill.mjs (section 11)."""
    return {"skill": skill, **({"dc": dc} if dc is not None else {}), "revealed": True, "note": why}


def victory(sid, title, pages, goal, checks, why, **k):
    """A Victory Points task with one part and a goal (the common shape of a book's side tasks)."""
    return {"id": sid, "kind": "victory", "title": title, "pages": pages, "label": "Victory Points", "goal": goal,
            "shown": True, "thresholds": [{"at": goal, "id": "done", "label": "Done", "end": "success"}],
            "parts": [{"id": "task", "label": title, "revealed": True, "checks": checks}], "note": why, **k}


# ---- names: never a number (board/names.js) ----

ADJECTIVES = ["Amber", "Bristling", "Crooked", "Dusky", "Eager", "Fretful", "Gaunt", "Hollow", "Inky", "Jagged", "Knotted",
              "Lanky", "Mottled", "Nimble", "Oily", "Pallid", "Quiet", "Ragged", "Sallow", "Twitchy", "Umber", "Vexed",
              "Wiry", "Yellowed", "Ashen", "Brittle", "Cinder", "Drab", "Ebon", "Flinty", "Grizzled", "Hulking", "Ivory",
              "Jittery", "Keen", "Lurid", "Mangy", "Nervous"]


def unique_names(encounters, adjectives=ADJECTIVES):
    """Creatures sharing a name on one map get a unique adjective with the noun ("Amber centipede"), first letters
    differing inside each encounter; the full name goes into the note. Changes the encounters in place."""
    count = Counter((e["map"], c["name"]) for e in encounters for c in e["creatures"])
    used = {}
    for e in encounters:
        letters = set()
        for c in e["creatures"]:
            if count[(e["map"], c["name"])] < 2:
                continue
            base = c["name"].split(" (")[0]
            noun = base.split()[-1].lower() if len(base.split()) > 1 else base.lower()
            for a in adjectives:
                cand = f"{a} {noun}"
                if a[0] not in letters and cand not in used.setdefault(e["map"], set()):
                    used[e["map"]].add(cand)
                    letters.add(a[0])
                    c["note"] = "; ".join(x for x in (c.get("note"), base if base.lower() != noun else None) if x) or None
                    if c["note"] is None:
                        c.pop("note")
                    c["name"] = cand
                    break
            else:
                raise BuildError(f"{e['id']}: ran out of adjectives for {base}")
    return encounters


# ---- the game system's pieces ----

def system(pack_dir):
    """rulesets/<system>/advbuild.py for the pack's ruleset (pack.json), or None."""
    rs = json.load(open(os.path.join(pack_dir, "pack.json")))["ruleset"]
    f = os.path.join(REPO, "rulesets", rs, "advbuild.py")
    if not os.path.exists(f):
        return None
    spec = importlib.util.spec_from_file_location(f"advbuild_{rs}", f)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---- writing, with the checks ----

def _dupes(ids):
    return sorted(k for k, n in Counter(ids).items() if n > 1)


def check_adventure(pack_dir, adv):
    """Problems with an adventure before it is written: [str]."""
    pack = json.load(open(os.path.join(pack_dir, "pack.json")))
    maps = set(pack.get("maps", []))
    art_f = os.path.join(pack_dir, "art", "art.json")
    art = set(json.load(open(art_f))) if os.path.exists(art_f) else None
    out = []
    encs, objs = adv.get("encounters", []), adv.get("objects", [])
    out += [f"encounter id {i} used twice" for i in _dupes(e["id"] for e in encs)]
    out += [f"object id {i} used twice" for i in _dupes(o["id"] for o in objs)]
    for e in encs:
        if e["map"] not in maps:
            out.append(f"encounter {e['id']}: map {e['map']} is not in pack.json")
        for c in e["creatures"]:
            if not (isinstance(c.get("at"), list) and len(c["at"]) == 2):
                out.append(f"encounter {e['id']}: {c['name']} has no square")
            if art is not None and c.get("art") and c["art"] not in art:
                out.append(f"encounter {e['id']}: {c['name']}'s art {c['art']} is not in art/art.json")
        names = [c["name"] for c in e["creatures"]]
        out += [f"encounter {e['id']}: two creatures named {n} (unique_names)" for n in _dupes(names)]
    for o in objs:
        if o["map"] not in maps:
            out.append(f"object {o['id']}: map {o['map']} is not in pack.json")
    if adv.get("start", {}).get("map") and adv["start"]["map"] not in maps:
        out.append(f"start map {adv['start']['map']} is not in pack.json")
    return out


def write_adventure(pack_dir, **adv):
    """adventure.json from the book's content; maps from pack.json and notes from notes/*.md unless given."""
    adv.setdefault("maps", json.load(open(os.path.join(pack_dir, "pack.json")))["maps"])
    adv.setdefault("notes", sorted(os.path.relpath(f, pack_dir).replace(os.sep, "/") for f in glob.glob(os.path.join(pack_dir, "notes", "*.md"))))
    order = ["title", "book", "pages", "maps", "start", "landing", "notes", "encounters", "objects", "ledger"]
    adv = {**{k: adv[k] for k in order if k in adv}, **{k: v for k, v in adv.items() if k not in order}}
    probs = check_adventure(pack_dir, adv)
    if probs:
        raise BuildError("adventure.json not written:\n  " + "\n  ".join(probs))
    with open(os.path.join(pack_dir, "adventure.json"), "w") as f:
        json.dump(adv, f, indent=1)
    encs = adv.get("encounters", [])
    print(len(encs), "encounters", sum(len(e["creatures"]) for e in encs), "creatures", len(adv.get("objects", [])), "objects")
    return adv


def check_events(pack_dir, events, subsystems):
    """Problems with the events and subsystems before they are written: [str]."""
    out = [f"event id {i} used twice" for i in _dupes(e["id"] for e in events)]
    out += [f"subsystem id {i} used twice" for i in _dupes(s["id"] for s in subsystems)]
    kick = [e["id"] for e in events if e.get("kickoff")]
    if len(kick) != 1:
        out.append(f"{len(kick)} kickoff events (exactly one: the book's way of starting the story)")
    af = os.path.join(pack_dir, "adventure.json")
    groups = {e["id"] for e in json.load(open(af)).get("encounters", [])} if os.path.exists(af) else None
    subs = {s["id"] for s in subsystems}

    def acts(e):
        for st in e.get("stages", []):
            yield from st.get("actions", [])
        yield from e.get("actions", [])
    for e in events:
        for a in acts(e):
            if a.get("do") in ("encounter", "reveal") and groups is not None and a.get("group") not in groups:
                out.append(f"event {e['id']}: {a['do']} {a.get('group')} is not an encounter in adventure.json")
            if a.get("do") == "subsystem" and a.get("id") not in subs:
                out.append(f"event {e['id']}: subsystem {a.get('id')} does not exist")
    return out


def write_events(pack_dir, events, subsystems):
    probs = check_events(pack_dir, events, subsystems)
    if probs:
        raise BuildError("adventure-events.json not written:\n  " + "\n  ".join(probs))
    with open(os.path.join(pack_dir, "adventure-events.json"), "w") as f:
        json.dump({"events": events, "subsystems": subsystems}, f, indent=1)
    print(len(events), "events", len(subsystems), "subsystems")
