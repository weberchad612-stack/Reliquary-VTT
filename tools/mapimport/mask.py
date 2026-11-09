"""Step 3 of the map importer: which pixels are wall, door, window.

Settings come from the map's import settings ("mask" block). Defaults suit maps whose walls are
dark, grey or brownish stone and whose floors, ground and water are lighter or clearly coloured.

- wall: dark (value below max_value) and not strongly coloured (saturation below max_saturation),
  with hues that belong to water or vegetation excluded; thin lines (the grid, floor details) are removed with an
  opening of open_px; specks smaller than min_area_cells are dropped; holes smaller than
  fill_holes_cells (texture inside thick walls) are filled.
  Very dark thin lines (thin drawn walls) are kept separately with a smaller opening. Only wall
  shapes that come within near_floor_cells of a room floor are kept: real walls border rooms,
  while dark patches out in the terrain do not.
- door: near-white bars.
- window: glass colour (cyan by default).
- exclude: rectangles in cells (insets, compass roses, titles) that never count as anything.
"""
import cv2
import numpy as np

DEFAULTS = {
    "max_value": 80,
    "max_saturation": 140,
    "exclude_hues": [[35, 100]],   # OpenCV hue 0-180: greens and teals (water, marsh, foliage)
    "grey_saturation": 25,         # pixels this grey count as wall at any hue
    "open_px": 5,
    "thin_max_value": 45,          # very dark lines (thin drawn walls) ...
    "thin_open_px": 3,             # ... kept when at least this thick
    "floor_min_value": 140,        # light, grey pixels count as room floor
    "floor_max_saturation": 60,
    "near_floor_cells": 0.6,       # a wall must come this close to a floor somewhere
    "min_area_cells": 0.2,
    "fill_holes_cells": 0.5,
    "door_min_value": 235,
    "window_hsv": [[80, 110], [120, 255], [150, 255]],   # cyan glass
    "exclude": [],
}


def settings(cfg):
    s = dict(DEFAULTS)
    s.update(cfg or {})
    return s


def _exclude_mask(shape, grid, rects):
    m = np.zeros(shape, bool)
    cs, (ox, oy) = grid["cell_px"], grid["origin_px"]
    for r in rects:
        x0, y0, x1, y1 = r["cells"] if isinstance(r, dict) else r
        m[max(0, int(oy + y0 * cs)):max(0, int(oy + y1 * cs)), max(0, int(ox + x0 * cs)):max(0, int(ox + x1 * cs))] = True
    return m


def build_masks(rgb, grid, cfg=None):
    """Return {"wall", "door", "window"} as boolean arrays the size of the image."""
    s = settings(cfg)
    a = np.asarray(rgb)
    hsv = cv2.cvtColor(a, cv2.COLOR_RGB2HSV).astype(np.int16)
    H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    cell_area = grid["cell_px"] ** 2
    excl = _exclude_mask(H.shape, grid, s["exclude"])

    hue_ok = np.ones(H.shape, bool)
    for lo, hi in s["exclude_hues"]:
        hue_ok &= ~((H >= lo) & (H <= hi))
    dark = (V < s["max_value"]) & (S < s["max_saturation"]) & (hue_ok | (S < s["grey_saturation"])) & ~excl
    ell = lambda k: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    wall = cv2.morphologyEx(dark.astype(np.uint8), cv2.MORPH_OPEN, ell(s["open_px"])) if s["open_px"] else dark.astype(np.uint8)
    thin = ((V < s["thin_max_value"]) & hue_ok & ~excl).astype(np.uint8)
    thin = cv2.morphologyEx(thin, cv2.MORPH_OPEN, ell(s["thin_open_px"]))
    wall = (wall | thin).astype(np.uint8)
    wall = _drop_small(wall, s["min_area_cells"] * cell_area)
    floor = ((V >= s["floor_min_value"]) & (S <= s["floor_max_saturation"]) & ~excl).astype(np.uint8)
    floor = cv2.morphologyEx(floor, cv2.MORPH_OPEN, ell(5))
    reach = max(1, int(round(s["near_floor_cells"] * grid["cell_px"])))
    wall = _keep_touching(wall, cv2.dilate(floor, ell(2 * reach + 1)))
    wall = _fill_holes(wall, s["fill_holes_cells"] * cell_area)

    rgbmin = a.min(axis=2)
    door = (rgbmin >= s["door_min_value"]) & ~excl
    (h0, h1), (s0, s1), (v0, v1) = s["window_hsv"]
    window = (H >= h0) & (H <= h1) & (S >= s0) & (S <= s1) & (V >= v0) & (V <= v1) & ~excl
    return {"wall": wall.astype(bool), "door": door, "window": window}


def _keep_touching(m, region):
    """Keep only the connected parts of m that overlap region."""
    n, lab = cv2.connectedComponents(m, connectivity=8)
    hit = np.zeros(n, np.uint8)
    hit[np.unique(lab[(region > 0) & (m > 0)])] = 1
    hit[0] = 0
    return hit[lab]


def _drop_small(m, min_area):
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    keep = np.zeros(n, np.uint8)
    keep[1:] = (st[1:, cv2.CC_STAT_AREA] >= min_area).astype(np.uint8)
    return keep[lab]


def _fill_holes(m, max_area):
    inv = (1 - m).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(inv, connectivity=4)
    h, w = m.shape
    fill = np.zeros(n, np.uint8)
    for i in range(1, n):
        x, y, bw, bh, area = st[i]
        touches_edge = x == 0 or y == 0 or x + bw == w or y + bh == h
        if area <= max_area and not touches_edge:
            fill[i] = 1
    return (m | fill[lab]).astype(np.uint8)
