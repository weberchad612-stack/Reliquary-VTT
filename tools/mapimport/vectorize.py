"""Step 5 of the map importer: turn the wall mask into wall segments.

Walls are traced along their outlines (decision 2 of the importer): every outer edge and every
hole of the wall mask becomes a closed ring of segments, simplified with tolerance_cells and
snapped to the 1/8 cell grid. Rings are closed, so a room's boundary never has a gap.
"""
import cv2
import numpy as np

SNAP = 0.125

DEFAULTS = {
    "tolerance_cells": 0.15,    # how far a simplified outline may stray from the traced one
    "min_ring_cells": 0.1,      # drop wall islands smaller than this many square cells
}


def settings(cfg):
    s = dict(DEFAULTS)
    s.update(cfg or {})
    return s


def snap(v):
    return round(round(v / SNAP) * SNAP, 3)


def to_cells(p, grid):
    cs, (ox, oy) = grid["cell_px"], grid["origin_px"]
    x = min(max((p[0] - ox) / cs, 0), grid["cols"])
    y = min(max((p[1] - oy) / cs, 0), grid["rows"])
    return [snap(x), snap(y)]


def rings(mask, grid, cfg=None):
    """Closed rings (lists of [x, y] in cells, on the 1/8 grid) along the wall mask's outlines."""
    s = settings(cfg)
    cs = grid["cell_px"]
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in contours:
        if abs(cv2.contourArea(c)) < s["min_ring_cells"] * cs * cs:
            continue
        approx = cv2.approxPolyDP(c, s["tolerance_cells"] * cs, True).reshape(-1, 2)
        pts = [to_cells(p, grid) for p in approx]
        pts = _clean(pts)
        if len(pts) >= 3:
            out.append(pts)
    return out


def _clean(pts):
    """Drop repeated points and points on a straight line between their neighbours."""
    res = []
    for p in pts:
        if not res or p != res[-1]:
            res.append(p)
    if len(res) > 1 and res[0] == res[-1]:
        res.pop()
    changed = True
    while changed and len(res) >= 3:
        changed = False
        for i in range(len(res)):
            a, b, c = res[i - 1], res[i], res[(i + 1) % len(res)]
            cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
            if abs(cross) < 1e-9 or a == b:
                res.pop(i)
                changed = True
                break
    return res


def segments(rings_cells):
    """Wall segments from rings: [{a, b}] (ids are assigned by the caller)."""
    segs = []
    for r in rings_cells:
        for i in range(len(r)):
            a, b = r[i], r[(i + 1) % len(r)]
            if a != b:
                segs.append({"a": a, "b": b})
    return segs
