"""Small checks for the map importer's helpers (run by tests/mapimport-tools.test.mjs)."""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from mapimport import extract, wallscan  # noqa: E402
from mapimport import build  # noqa: E402

# rotate: a 4 x 2 image with a red top-left pixel, turned a quarter clockwise, is 2 x 4 with red at the top right
img = Image.new("RGB", (4, 2), "white"); img.putpixel((0, 0), (255, 0, 0))
r = extract.crop_scale(img, rotate=90)
assert r.size == (2, 4), r.size
assert r.getpixel((1, 0)) == (255, 0, 0), "a quarter turn clockwise moves the top-left corner to the top right"
assert extract.crop_scale(img, rotate=180).getpixel((3, 1)) == (255, 0, 0)
try:
    extract.crop_scale(img, rotate=45); raise SystemExit("rotate 45 should be refused")
except ValueError:
    pass

# wallscan: two black outlines 10 px apart across a white band, 40 px squares, grid at the origin
v = np.full((200, 200), 255.0); v[:, 80:83] = 0; v[:, 90:93] = 0
runs = wallscan.scan(v, {"cell_px": 40, "origin_px": [0, 0]}, "v:1:4:0:5")
assert [(a, b) for a, b, _ in runs] == [(2.0, 2.08), (2.25, 2.33)], runs
# the band may start off the image (a negative grid origin)
assert wallscan.scan(v, {"cell_px": 40, "origin_px": [-20, -20]}, "v:1:4:0:5"), "a negative origin still scans"

# fixed lines: placed exactly, never measured
lc = {"auto": False, "add": [{"axis": "v", "at": 2.1, "from": 0, "to": 3, "w": 0.3, "fixed": True}]}
mask = np.zeros((200, 200), bool)
report = {}
segs = build.straight_walls(lc, mask, {"cell_px": 40, "origin_px": [0, 0]}, [], [], {}, report)
assert len(segs) == 1 and segs[0]["w"] == 0.3 and segs[0]["a"][0] == 2.1, segs
print("ok")
