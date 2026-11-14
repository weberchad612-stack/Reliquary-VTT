#!/usr/bin/env python3
"""The room table: each keyed area of a map as its board squares, so Claude can tell which room the party is in
(GM guide, preparing an area: D11).

Usage:
    python3 tools/advimport/roomtable.py <pack-dir> <spec.json> [--max-cells N]
    python3 tools/advimport/roomtable.py <pack-dir> --from-labels <map-id>[,<map-id>...] [--overrides <spec.json>]
        [--max-cells N] [--write-spec <spec.json>]
    python3 tools/advimport/roomtable.py <pack-dir> --from-crops <roomcrops.json> --levels A=level-a,B=level-b,C=roof
        [--overrides <spec.json>] [--write-spec <spec.json>]

--from-crops proposes the spec from the book (tools/advimport/roomcrops.py): a key printed on a labelled level map
gives its exact point; otherwise a room crop with one caption ("A5. Lavatory") gives its key, title and the crop's
centre. Crops with several captions (B6 & B7) give titles only. --overrides (the same spec format) corrects or adds
points, titles, pages and clips (a room open to its neighbours); its entries win. --write-spec saves the merged spec.

--from-labels takes each room's point from the area keys printed on the map (the page's text layer, through the
map's crop, scale and rotation: tools/advimport/maplabels.py); --overrides adds titles and pages.
--max-cells caps a room (default: the whole map). A room that floods past it has no walls round it (a street, a lot,
a yard open to the road): it keeps a box round its label instead (`box`: [w, h], default 4 x 4), drawn after the
walled rooms and never over their squares, and is reported so a `clip` can give its real extent.

spec.json: {"<map id>": {"<key>": {"at": [x, y], "title": "...", "pages": "...", "clip"?: [x0, y0, x1, y1],
                                     "box"?: [w, h]}}}
Each room is the squares reachable from `at` without crossing a wall or a closed door (every door counts as closed),
kept inside `clip` when given (a room open to its neighbours: a ruined wall, a hall). A square claimed by two rooms
is reported. Writes <pack>/maps/<map>/rooms.json: {"v": 1, "rooms": {key: {title, pages, at, rects: [[x, y, w, h]]}}}.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from mapimport import terrain as T  # noqa: E402


def rects_of(cells):
    """Squares as rectangles: runs along each row, merged down while they line up."""
    rows = {}
    for x, y in cells:
        rows.setdefault(y, []).append(x)
    runs = []
    for y in sorted(rows):
        xs = sorted(rows[y]); s = xs[0]; p = s
        for x in xs[1:] + [None]:
            if x is not None and x == p + 1:
                p = x; continue
            runs.append([s, y, p - s + 1, 1])
            if x is not None:
                s = p = x
    out = []
    for r in runs:
        hit = next((o for o in out if o[0] == r[0] and o[2] == r[2] and o[1] + o[3] == r[1]), None)
        if hit: hit[3] += 1
        else: out.append(list(r))
    return out


PACK_DIR = []


def spec_from_crops(crops_file, levels):
    """{map: {key: {at, title}}} from the registered crops: labels first, then single captions at the crop's centre."""
    d = json.load(open(crops_file))
    spec, titles = {}, {}
    for rec in d["pages"]:
        for key, title in rec.get("captions") or []:
            titles.setdefault(key, title)
    for rec in d["pages"]:
        m = levels.get(rec.get("level"))
        if not m:
            continue
        for lab in rec.get("label") or []:
            spec.setdefault(m, {})[lab["text"]] = {"at": lab["cell"], "source": f"label on p {rec['page']}"}
    for rec in d["pages"]:
        m = levels.get(rec.get("level"))
        caps = {k for k, _ in rec.get("captions") or []}
        if not m or len(caps) != 1 or not rec.get("centre"):
            continue
        key = caps.pop()
        if key not in spec.get(m, {}):
            spec.setdefault(m, {})[key] = {"at": rec["centre"], "source": f"crop centre, p {rec['page']}"}
    # a label that falls off its map (a second map printed on the same sheet) is not this map's
    for m, rooms in spec.items():
        mf = os.path.join(PACK_DIR[0], "maps", m, "map.json") if PACK_DIR else None
        if mf and os.path.exists(mf):
            g = json.load(open(mf))["grid"]
            for k in [k for k, r in rooms.items() if not (0 <= r["at"][0] < g["cols"] and 0 <= r["at"][1] < g["rows"])]:
                rooms.pop(k)
    for m in spec.values():
        for key, r in m.items():
            base = key.rstrip("abcdefgh") if key not in titles else key
            if titles.get(key) or titles.get(base):
                r.setdefault("title", titles.get(key) or titles.get(base))
    return spec


def main(argv):
    pack = argv[0]
    PACK_DIR.append(pack)
    if "--from-crops" in argv:
        opt = lambda k: argv[argv.index(k) + 1] if k in argv else None
        levels = dict(x.split("=") for x in opt("--levels").split(","))
        spec = spec_from_crops(opt("--from-crops"), levels)
        if opt("--overrides"):
            for m, rooms in json.load(open(opt("--overrides"))).items():
                for k, r in rooms.items():
                    spec.setdefault(m, {}).setdefault(k, {}).update(r)
        if opt("--write-spec"):
            json.dump(spec, open(opt("--write-spec"), "w"), indent=1)
    elif "--from-labels" in argv:
        from advimport import maplabels  # noqa: E402
        opt = lambda k: argv[argv.index(k) + 1] if k in argv else None
        spec = {}
        for mid in opt("--from-labels").split(","):
            spec.update(maplabels.labels(pack, mid))
        if opt("--overrides"):
            for m, rooms in json.load(open(opt("--overrides"))).items():
                for k, r in rooms.items():
                    spec.setdefault(m, {}).setdefault(k, {}).update(r)
        if opt("--write-spec"):
            json.dump(spec, open(opt("--write-spec"), "w"), indent=1)
    else:
        spec = json.load(open(argv[1]))
    cap = int(argv[argv.index("--max-cells") + 1]) if "--max-cells" in argv else None
    problems = 0
    for map_id, rooms in spec.items():
        d = os.path.join(pack, "maps", map_id)
        m = json.load(open(os.path.join(d, "map.json")))
        segs = json.load(open(os.path.join(d, m["walls"])))["segs"]
        g = m["grid"]
        find = T.room_finder(segs, g, max_cells=cap or g["cols"] * g["rows"])
        owner, out, open_rooms = {}, {}, []
        for key, r in rooms.items():
            try:
                cells = find(r["at"], r.get("clip"))
            except ValueError:
                open_rooms.append(key)   # no walls round it: a box, after the walled rooms
                continue
            for c in cells:
                if c in owner:
                    print(f"{map_id}: square {c} is in both {owner[c]} and {key}"); problems += 1
                owner[c] = key
            out[key] = {k: r[k] for k in ("title", "pages") if k in r}
            out[key].update(at=r["at"], rects=rects_of(cells))
            print(f"{map_id} {key}: {len(cells)} squares")
        for key in open_rooms:
            r = rooms[key]
            bw, bh = r.get("box", [4, 4])
            x0, y0 = math.floor(r["at"][0] - bw / 2 + 0.5), math.floor(r["at"][1] - bh / 2 + 0.5)   # centred, halves up
            cells = [(x, y) for y in range(max(0, y0), min(g["rows"], y0 + bh)) for x in range(max(0, x0), min(g["cols"], x0 + bw))
                     if (x, y) not in owner]
            for c in cells:
                owner[c] = key
            out[key] = {k: r[k] for k in ("title", "pages") if k in r}
            out[key].update(at=r["at"], rects=rects_of(cells), open=True)
            print(f"{map_id} {key}: open (more than {cap} squares without walls): a {bw} x {bh} box round its label, {len(cells)} squares; give a clip for its real extent")
        json.dump({"v": 1, "rooms": out}, open(os.path.join(d, "rooms.json"), "w"), indent=1)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
