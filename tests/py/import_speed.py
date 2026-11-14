"""Checks for the map importer's step cache and one-room rebuild (run by tests/importer-speed.test.mjs)."""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))
import numpy as np  # noqa: E402
from mapimport import cache, build  # noqa: E402

d = tempfile.mkdtemp()
cache.DIR = os.path.join(d, ".cache")
calls = []


def slow(arr, cfg):
    calls.append(1)
    return int(arr.sum()) + cfg["k"]


a = np.ones((20, 20), bool)
assert cache.memo("s", slow, a, {"k": 1}) == 401
assert cache.memo("s", slow, a, {"k": 1}) == 401 and len(calls) == 1, "the same inputs are reused"
b = a.copy(); b[3, 3] = False
assert cache.memo("s", slow, b, {"k": 1}) == 400 and len(calls) == 2, "a changed array runs again"
assert cache.memo("s", slow, b, {"k": 2}) == 401 and len(calls) == 3, "a changed setting runs again"
cache.DIR = None
assert cache.memo("s", slow, b, {"k": 2}) == 401 and len(calls) == 4, "no cache: always computed"

# one room rebuilt: walls outside the room are kept as they were; an opening in it keeps its ids
json.dump({"rooms": {"R1": {"rects": [[0, 0, 4, 4]]}, "R2": {"rects": [[6, 0, 4, 4]]}}}, open(os.path.join(d, "rooms.json"), "w"))
old = [{"id": "w0001", "t": "solid", "a": [0, 0], "b": [4, 0]},
       {"id": "w0002", "t": "solid", "a": [6, 0], "b": [10, 0]},
       {"id": "door01", "t": "door", "a": [1, 4], "b": [2, 4], "door": {"id": "d01", "label": "Door"}}]
json.dump({"v": 1, "segs": old}, open(os.path.join(d, "walls.json"), "w"))
new = [{"id": "w0001", "t": "solid", "a": [0, 0.5], "b": [4, 0.5]},
       {"id": "w0009", "t": "solid", "a": [6, 0.25], "b": [10, 0.25]},
       {"id": "door03", "t": "door", "a": [1.1, 4], "b": [2.1, 4], "door": {"id": "d03", "label": "Door"}}]
rep = {}
out = build.merge_room(new, d, "R1", rep)
by = {s["id"]: s for s in out}
assert by["w0002"]["a"] == [6, 0], "R2's wall is kept, the new one there ignored"
assert "w0009" not in by
assert by["w0001"]["a"] == [0, 0.5], "R1's wall is the new one"
assert by["door01"]["door"]["id"] == "d01" and by["door01"]["a"] == [1.1, 4], "the rebuilt door keeps its ids"
assert rep["room_rebuilt"]["room"] == "R1"
print("ok")

# #17: walls hidden by clutter (lines.near_misses, lines.gap_joins)
from mapimport import lines  # noqa: E402
g = {"cell_px": 50, "origin_px": [0, 0], "cols": 10, "rows": 10}
m = np.zeros((500, 500), bool)
m[100:104, 50:450] = True            # a clean wall: found by the search
m[300:340, 50:450] = True            # a wall with a dark mass under it (40 px thick): too thick, a near miss
found = lines.find_lines(m, g, {"max_w_cells": 0.25})
assert any(abs(L["c"] - 2.04) < 0.1 for L in found), found
nm = lines.near_misses(m, g, {"max_w_cells": 0.25})
assert any(P["why"].startswith("thick") and 5.5 < P["c"] < 7 for P in nm), nm
assert not any(abs(P["c"] - 2.04) < 0.2 for P in nm), "the clean wall is found, not a near miss"
L = [{"axis": "h", "c": 2.0, "lo": 1.0, "hi": 4.0, "w": 0.1}, {"axis": "h", "c": 2.02, "lo": 5.5, "hi": 9.0, "w": 0.1},
     {"axis": "h", "c": 7.0, "lo": 1.0, "hi": 4.0, "w": 0.1}, {"axis": "h", "c": 7.0, "lo": 5.0, "hi": 9.0, "w": 0.1}]
door = [{"a": [4.0, 7.0], "b": [5.0, 7.0]}]
gaps = lines.gap_joins(L, door)
assert len(gaps) == 1 and gaps[0]["lo"] == 4.0 and gaps[0]["hi"] == 5.5, gaps   # the doorway's gap is filled
print("ok walls")

# #21: the review sheet's tile: our map with walls, room squares, suggestions and changes drawn
from PIL import Image  # noqa: E402
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools", "advimport"))
import reviewsheet  # noqa: E402
img = Image.new("RGB", (500, 500), (40, 40, 40))
grid = {"cell_px": 50, "origin_px": [0, 0], "cols": 10, "rows": 10}
segs = [{"t": "solid", "a": [1, 1], "b": [5, 1]}, {"t": "door", "a": [5, 1], "b": [6, 1], "door": {"id": "d1"}}]
prev = {reviewsheet.seg_key(segs[0]), ("solid", (1.0, 3.0), (5.0, 3.0))}
t = reviewsheet.our_tile(img, grid, [0, 0, 8, 4], segs, prev, [[1, 1, 4, 2]], [{"axis": "v", "c": 7, "lo": 0, "hi": 3}], 20)
assert t.size == (160, 80)
px = t.load()
assert px[60, 20][0] > 200, "the solid wall in white"
assert px[110, 22][1] > 180 and px[110, 22][0] < 120, "the new door marked green beside it (it was not there before)"
assert px[60, 60][0] > 200 and px[60, 60][1] < 100, "the removed wall in red"
assert px[140, 4][0] > 200 and px[140, 4][2] > 180, "a suggested wall dashed magenta"
print("ok sheet")
