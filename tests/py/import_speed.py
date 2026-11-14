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
