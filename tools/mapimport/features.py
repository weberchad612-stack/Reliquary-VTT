"""Step 4 of the map importer: doors, windows and arrow slits, from the masks.

Everything here works in image pixels; the caller converts to cells. Each feature becomes a
segment whose ends reach a little way into the wall on both sides, so no gap is left beside it.

- Doors: near-white bars that are long and thin. Two bars side by side on one line are a double
  door and become one segment.
- Windows: runs of glass colour along a wall; one segment per window opening.
- Arrow slits: narrow gaps through a wall. Smoothing the wall mask (a closing) bridges them; a
  bridged gap is a slit when it joins two different spaces (inside and outside) AND the original,
  unsmoothed art is open all the way through it (checked locally). A bite out of a wall face
  (moss, vines) fails one test or the other. Gaps beside a door belong to the door. The wall is given a clean channel at each slit
  and a slit segment across it.
"""
import math

import cv2
import numpy as np

DEFAULTS = {
    "close_px": 9,               # smoothing that seals moss bites and narrow joints
    "door_min_len_cells": 0.4,
    "door_max_len_cells": 1.6,
    "door_max_thick_cells": 0.35,
    "door_min_aspect": 1.8,
    "double_door_gap_cells": 0.35,
    "end_into_wall_cells": 0.15,  # how far segment ends reach into the wall
    "slit_channel_cells": 0.25,   # width of the channel cut through the wall at a slit
    "slit_min_px": 4,            # smallest bridged gap considered
    "slit_near_ft": 5,            # see through a slit from this close to the wall face
}


def settings(cfg):
    s = dict(DEFAULTS)
    s.update(cfg or {})
    return s


def _ell(k):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))


def _axis(points):
    """Centre, unit direction of the long axis, length along it, thickness across it."""
    pts = points.astype(np.float64)
    c = pts.mean(axis=0)
    u, sv, vt = np.linalg.svd(pts - c, full_matrices=False)
    d = vt[0]
    proj = (pts - c) @ d
    across = (pts - c) @ np.array([-d[1], d[0]])
    return c, d, proj.max() - proj.min() + 1, across.max() - across.min() + 1


def _walk_to_wall(wall, p, d, max_px):
    """Distance from p along d to the first wall pixel (or max_px)."""
    h, w = wall.shape
    for t in np.arange(0, max_px, 0.5):
        x, y = int(round(p[0] + d[0] * t)), int(round(p[1] + d[1] * t))
        if 0 <= x < w and 0 <= y < h and wall[y, x]:
            return t
    return max_px


def find_doors(door_mask, wall, cell_px, cfg=None):
    """Door segments in pixels: [{a, b, leaves}]. `leaves` is 2 for a double door."""
    s = settings(cfg)
    n, lab, st, _ = cv2.connectedComponentsWithStats(door_mask.astype(np.uint8), 8)
    bars = []
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < 10:
            continue
        ys, xs = np.nonzero(lab == i)
        c, d, length, thick = _axis(np.column_stack([xs, ys]))
        if not (s["door_min_len_cells"] * cell_px <= length <= s["door_max_len_cells"] * cell_px):
            continue
        if thick > s["door_max_thick_cells"] * cell_px or length / max(thick, 1) < s["door_min_aspect"]:
            continue
        # snap nearly axis-aligned bars exactly to the axis
        ang = math.degrees(math.atan2(d[1], d[0])) % 180
        for target in (0, 90, 180):
            if abs(ang - target) < 4:
                r = math.radians(target)
                d = np.array([math.cos(r), math.sin(r)])
        bars.append({"c": c, "d": d, "len": length})
    # join bars that lie end to end on one line into double doors
    used, doors = set(), []
    gap = s["double_door_gap_cells"] * cell_px
    for i, b in enumerate(bars):
        if i in used:
            continue
        group = [b]
        for j, o in enumerate(bars):
            if j <= i or j in used:
                continue
            same_dir = abs(abs(float(b["d"] @ o["d"])) - 1) < 0.02
            off = o["c"] - b["c"]
            along = abs(float(off @ b["d"]))
            across = abs(float(off @ np.array([-b["d"][1], b["d"][0]])))
            if same_dir and across < 3 and along <= (b["len"] + o["len"]) / 2 + gap:
                group.append(o)
                used.add(j)
        d = group[0]["d"]
        ends = []
        for g in group:
            ends += [g["c"] - d * g["len"] / 2, g["c"] + d * g["len"] / 2]
        proj = [float((e - group[0]["c"]) @ d) for e in ends]
        a0 = group[0]["c"] + d * min(proj)
        b0 = group[0]["c"] + d * max(proj)
        # reach into the wall on both ends
        into = s["end_into_wall_cells"] * cell_px
        ta = _walk_to_wall(wall, a0, -d, cell_px * 0.6)
        tb = _walk_to_wall(wall, b0, d, cell_px * 0.6)
        doors.append({"a": a0 - d * (ta + into), "b": b0 + d * (tb + into), "leaves": len(group)})
    return doors


def find_windows(window_mask, wall, cell_px, cfg=None):
    """Window segments in pixels: one per run of glass along a wall, ends reaching into the wall."""
    s = settings(cfg)
    m = cv2.morphologyEx(window_mask.astype(np.uint8), cv2.MORPH_CLOSE, _ell(max(3, int(cell_px * 0.8)) | 1))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    out = []
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < 10:
            continue
        ys, xs = np.nonzero(lab == i)
        c, d, length, _ = _axis(np.column_stack([xs, ys]))
        if length < cell_px * 0.5:
            continue
        a0, b0 = c - d * length / 2, c + d * length / 2
        into = s["end_into_wall_cells"] * cell_px
        ta = _walk_to_wall(wall, a0, -d, cell_px)
        tb = _walk_to_wall(wall, b0, d, cell_px)
        out.append({"a": a0 - d * (ta + into), "b": b0 + d * (tb + into)})
    return out


def _open_through(raw_free, spaces, a_label, b_label, center, radius):
    """Within radius of center, does one piece of raw free space touch both spaces?"""
    h, w = raw_free.shape
    cx, cy = int(center[0]), int(center[1])
    y0, y1, x0, x1 = max(0, cy - radius), min(h, cy + radius), max(0, cx - radius), min(w, cx + radius)
    win = raw_free[y0:y1, x0:x1].astype(np.uint8)
    n, lab = cv2.connectedComponents(win, connectivity=4)
    sp = spaces[y0:y1, x0:x1]
    for k in range(1, n):
        labels = set(np.unique(sp[lab == k]))
        if a_label in labels and b_label in labels:
            return True
    return False


def smooth_and_find_slits(wall, blockers, cell_px, feet_per_cell=5, cfg=None, doors=(), reject_px=()):
    """Smooth the wall mask and find arrow slits.

    wall: raw wall mask. blockers: door and window pixels (they separate rooms for the slit test).
    doors: detected doors (gaps beside them are not slits). reject_px: points (pixels) whose
    candidate slits are dropped, as listed in a map's import settings.
    Returns (smoothed wall mask with a clean channel cut at each slit, [slit segments in pixels]).
    """
    s = settings(cfg)
    w = wall.astype(np.uint8)
    closed = cv2.morphologyEx(w, cv2.MORPH_CLOSE, _ell(s["close_px"]))
    bridged = (closed > 0) & (w == 0) & ~blockers
    # spaces once the wall is sealed; doors and windows count as closed
    sealed = (closed > 0) | blockers
    nspace, spaces = cv2.connectedComponents((~sealed).astype(np.uint8), connectivity=4)
    n, lab, st, cen = cv2.connectedComponentsWithStats(bridged.astype(np.uint8), 8)
    slits = []
    out = closed.copy()
    chan = s["slit_channel_cells"] * cell_px
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < s["slit_min_px"]:
            continue
        comp = (lab == i).astype(np.uint8)
        ring = cv2.dilate(comp, _ell(5)) > 0
        touched = sorted(set(np.unique(spaces[ring & ~sealed])) - {0})
        if len(touched) < 2:
            continue  # a bite out of one face, not a gap through the wall
        if any(_dist_to_seg(np.array(cen[i]), np.asarray(dr["a"]), np.asarray(dr["b"])) < 0.7 * cell_px for dr in doors):
            continue  # part of a door's opening
        if any(np.hypot(cen[i][0] - r[0], cen[i][1] - r[1]) < 0.75 * cell_px for r in reject_px):
            continue  # rejected in the map's import settings
        raw_free = (w == 0) & ~blockers
        r_win = int(cell_px * 1.2)
        if not any(_open_through(raw_free, spaces, touched[p], touched[q], cen[i], r_win)
                   for p in range(len(touched)) for q in range(p + 1, len(touched))):
            continue  # sealed in the original art: only the smoothing made it look like a gap
        # wall direction near the gap: principal axis of sealed wall pixels within a cell
        cx, cy = cen[i]
        r = int(cell_px)
        y0, y1 = max(0, int(cy) - r), min(w.shape[0], int(cy) + r)
        x0, x1 = max(0, int(cx) - r), min(w.shape[1], int(cx) + r)
        ys, xs = np.nonzero(closed[y0:y1, x0:x1])
        if len(xs) < 20:
            continue
        _, d, _, _ = _axis(np.column_stack([xs + x0, ys + y0]))
        nrm = np.array([-d[1], d[0]])
        c = np.array([cx, cy])
        # wall thickness across the gap
        t1 = _walk_to_free(closed, c, nrm, cell_px * 2)
        t2 = _walk_to_free(closed, c, -nrm, cell_px * 2)
        mid = c + nrm * (t1 - t2) / 2
        thick = t1 + t2
        # cut a straight channel through the wall, a little past both faces
        half_len = thick / 2 + 3
        corners = [mid + nrm * sgn_n * half_len + d * sgn_d * chan / 2 for sgn_n, sgn_d in ((1, 1), (1, -1), (-1, -1), (-1, 1))]
        cv2.fillPoly(out, [np.round(np.array(corners)).astype(np.int32)], 0)
        into = s["end_into_wall_cells"] * cell_px
        a = mid - d * (chan / 2 + into)
        b = mid + d * (chan / 2 + into)
        near = s["slit_near_ft"] + (thick / cell_px) * feet_per_cell / 2
        slits.append({"a": a, "b": b, "near_ft": round(near * 2) / 2, "thick_px": thick})
    return out.astype(bool), slits


def _dist_to_seg(p, a, b):
    ab = b - a
    t = float(np.clip(((p - a) @ ab) / max(ab @ ab, 1e-9), 0, 1))
    return float(np.linalg.norm(p - (a + t * ab)))


def _walk_to_free(mask, p, d, max_px):
    h, w = mask.shape
    for t in np.arange(0, max_px, 0.5):
        x, y = int(round(p[0] + d[0] * t)), int(round(p[1] + d[1] * t))
        if not (0 <= x < w and 0 <= y < h) or not mask[y, x]:
            return t
    return max_px
