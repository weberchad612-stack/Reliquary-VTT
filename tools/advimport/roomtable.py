#!/usr/bin/env python3
"""The room table: each keyed area of a map as its board squares, so Claude can tell which room the party is in
(GM guide, preparing an area: D11).

Usage:
    python3 tools/advimport/roomtable.py <pack-dir> <spec.json>

spec.json: {"<map id>": {"<key>": {"at": [x, y], "title": "...", "pages": "...", "clip"?: [x0, y0, x1, y1]}}}
Each room is the squares reachable from `at` without crossing a wall or a closed door (every door counts as closed),
kept inside `clip` when given (a room open to its neighbours: a ruined wall, a hall). A square claimed by two rooms
is reported. Writes <pack>/maps/<map>/rooms.json: {"v": 1, "rooms": {key: {title, pages, at, rects: [[x, y, w, h]]}}}.
"""
import json
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


def main(argv):
    pack, spec_file = argv[:2]
    spec = json.load(open(spec_file))
    problems = 0
    for map_id, rooms in spec.items():
        d = os.path.join(pack, "maps", map_id)
        m = json.load(open(os.path.join(d, "map.json")))
        segs = json.load(open(os.path.join(d, m["walls"])))["segs"]
        g = m["grid"]
        find = T.room_finder(segs, g, max_cells=g["cols"] * g["rows"])
        owner, out = {}, {}
        for key, r in rooms.items():
            cells = find(r["at"], r.get("clip"))
            for c in cells:
                if c in owner:
                    print(f"{map_id}: square {c} is in both {owner[c]} and {key}"); problems += 1
                owner[c] = key
            out[key] = {k: r[k] for k in ("title", "pages") if k in r}
            out[key].update(at=r["at"], rects=rects_of(cells))
            print(f"{map_id} {key}: {len(cells)} squares")
        json.dump({"v": 1, "rooms": out}, open(os.path.join(d, "rooms.json"), "w"), indent=1)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
