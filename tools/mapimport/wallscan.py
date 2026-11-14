#!/usr/bin/env python3
"""Measure where walls are drawn, from the art, for hand-placed straight walls (lines.add with "fixed": true;
docs/best-practices/map-importer.md section 4d).

Usage:
    python3 tools/mapimport/wallscan.py <map-dir> [--max-value 25] [--min-px 1] SPEC [SPEC ...]

SPEC is  v:Y0:Y1:X0:X1  (vertical walls: the columns from X0 to X1, each the median over the rows Y0 to Y1)
     or  h:X0:X1:Y0:Y1  (horizontal walls: the rows from Y0 to Y1, each the median over the columns X0 to X1),
in squares, in the map's grid (map.json). Pick a stretch along the walls that crosses no door, window or furniture.

Prints the dark runs met crossing the band, in squares: [start, end, width]. A wall drawn between two black outlines
shows as two thin runs: the wall is the outer edge of the first to the outer edge of the second. With
--max-value 70 the wall's fill and its drop shadow join the runs too (the shadow is on one side only: do not take
the centre from such a run).
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def runs(profile, max_value, min_px):
    out, start = [], None
    for i, p in enumerate(list(profile) + [999]):
        if p < max_value and start is None:
            start = i
        if p >= max_value and start is not None:
            if i - start >= min_px:
                out.append((start, i))
            start = None
    return out


def scan(value, g, spec, max_value=25, min_px=1):
    """[(start, end, width)] in squares for one SPEC string."""
    c, (ox, oy) = g["cell_px"], g["origin_px"]
    kind, a, b, lo, hi = spec.split(":")
    a, b, lo, hi = map(float, (a, b, lo, hi))
    if kind == "v":
        y0, y1, x0, x1 = [max(0, int(v)) for v in (oy + a * c, oy + b * c, ox + lo * c, ox + hi * c)]
        prof, base, o = np.median(value[y0:y1, x0:x1], axis=0), x0, ox
    elif kind == "h":
        x0, x1, y0, y1 = [max(0, int(v)) for v in (ox + a * c, ox + b * c, oy + lo * c, oy + hi * c)]
        prof, base, o = np.median(value[y0:y1, x0:x1], axis=1), y0, oy
    else:
        raise ValueError(f"{spec}: start with v: or h:")
    return [(round((base + s - o) / c, 2), round((base + e - o) / c, 2), round((e - s) / c, 2))
            for s, e in runs(prof, max_value, min_px)]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("map_dir")
    ap.add_argument("specs", nargs="+")
    ap.add_argument("--max-value", type=float, default=25)
    ap.add_argument("--min-px", type=int, default=1)
    a = ap.parse_args(argv)
    m = json.load(open(os.path.join(a.map_dir, "map.json"), encoding="utf-8"))
    value = np.asarray(Image.open(os.path.join(a.map_dir, m["image"]["file"])).convert("RGB")).astype(float).max(2)
    for s in a.specs:
        print(s, scan(value, m["grid"], s, a.max_value, a.min_px))
    return 0


if __name__ == "__main__":
    sys.exit(main())
