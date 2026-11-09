"""Step 2 of the map importer: find the map's grid (cell size and origin) from the image.

Grid lines are thin dark lines over lighter ground. A black-hat filter brings them out; summing it
down columns and along rows gives two profiles with a spike at every grid line. The cell size is
the period of those spikes (autocorrelation, then a fine search), and the origin is where the
spikes line up. Square cells are assumed (the usual battle-map grid).
"""
import math

import cv2
import numpy as np


def _profiles(rgb):
    g = cv2.cvtColor(np.asarray(rgb), cv2.COLOR_RGB2GRAY).astype(np.float32)
    bh = cv2.morphologyEx(g, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)))
    return bh.sum(axis=0), bh.sum(axis=1)


def _period(profile, lo, hi):
    p = profile - profile.mean()
    ac = np.correlate(p, p, "full")[len(p) - 1:]
    ac = ac / ac[0]
    k = lo + int(np.argmax(ac[lo:hi]))
    y0, y1, y2 = ac[k - 1], ac[k], ac[k + 1]
    den = y0 - 2 * y1 + y2
    return k + (0.5 * (y0 - y2) / den if den else 0.0)


def _score(profile, cell, offset):
    idx = np.round(np.arange(offset, len(profile), cell)).astype(int)
    idx = idx[(idx >= 0) & (idx < len(profile))]
    return profile[idx].mean() / profile.mean()


def _fit(profile, cell):
    best = (0.0, cell, 0.0)
    for c in np.arange(cell - 0.25, cell + 0.25, 0.005):
        for o in np.arange(0, c, 0.25):
            s = _score(profile, c, o)
            if s > best[0]:
                best = (s, c, o)
    return best


class NoGridFound(ValueError):
    """The image shows no clear grid; give the grid by hand in the import settings."""


def calibrate(rgb, min_cell=16, max_cell=120, min_strength=2.0):
    """Find the grid. Returns {cell_px, origin_px, cols, rows, strength}.

    origin_px is the top-left corner of cell (0, 0) and may be negative (a partial first row or
    column). strength is how much brighter the grid lines are than average (above ~2 is a clear grid).
    """
    w, h = rgb.size
    cols_p, rows_p = _profiles(rgb)
    rough = (_period(cols_p, min_cell, max_cell) + _period(rows_p, min_cell, max_cell)) / 2
    sx, cx, ox = _fit(cols_p, rough)
    sy, cy, oy = _fit(rows_p, rough)
    if min(sx, sy) < min_strength:
        raise NoGridFound(f"no clear grid (strength {min(sx, sy):.2f}, need {min_strength}); give the grid by hand")
    if abs(cx - cy) > 0.5:
        raise NoGridFound(f"cells are not square ({cx:.2f} x {cy:.2f} px); give the grid by hand")
    cell = round(float(cx + cy) / 2, 3)
    # origin: the grid line at or just before the image's left/top edge
    ox = ox - cell * math.ceil(ox / cell - 1e-9) if ox > 0 else ox
    oy = oy - cell * math.ceil(oy / cell - 1e-9) if oy > 0 else oy
    # a row or column that is at least 90% inside the image counts
    cols = int(math.floor((w - ox) / cell + 0.1))
    rows = int(math.floor((h - oy) / cell + 0.1))
    return {"cell_px": cell, "origin_px": [round(float(ox), 2), round(float(oy), 2)], "cols": cols, "rows": rows,
            "strength": round(float(min(sx, sy)), 2)}
