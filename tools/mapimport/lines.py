"""Straight walls, grid lines and wall thickness for the map importer (2026-11-14).

On clean, grid-aligned art (thin drawn walls on a tiled floor) the outline tracer misses thin walls or turns grid
lines and floor shading into walls. This module instead finds straight walls as straight walls:

- suppress_grid(mask, g, cfg): clear thin dark lines lying on the known grid lines before anything is traced; a wall
  drawn along a grid line survives because it is thicker than the grid line.
- find_lines(mask, g, cfg): every long horizontal or vertical run of wall pixels, with its centre line and its
  thickness measured from the art, in cells. These are proposals: settings reject some (reject_near) and add
  others by hand (add, measured the same way within a window around the given line).
- cut_openings(lines, openings, g): doors and windows split the lines they lie on.
- to_segments(lines, ...): centre-line wall segments with their thickness `w` (engine/sight/visibility.js reads it).
- square_up(segs, deg): traced segments within `deg` of horizontal or vertical made exactly so.
- weld(segs, tol, snap): endpoints within tol joined into one point, then everything snapped to the file's grid.

All lengths in settings are in cells, so they hold at any detection resolution.
"""
import math

import cv2
import numpy as np

DEFAULTS = {
    "grid_line_max_cells": 0.035,   # a dark line on the grid this thin (or thinner) is a grid line, not a wall
    "grid_band_cells": 0.06,        # how far from the exact grid position a grid line may sit
    "min_len_cells": 0.6,           # shortest straight wall proposed
    "min_w_cells": 0.02,            # thinnest
    "max_w_cells": 0.6,             # thickest (thicker runs are rooms of dark floor, not walls)
    "fill_ratio": 0.85,             # share of the band's length that must be wall pixels
    "measure_window_cells": 0.3,    # a hand-listed line is searched for this far either side of where it is given
    "door_gap_cells": 0.1,          # a door within this distance of a line's centre cuts it
    "side_clear": 0.6,
    "merge_gap_cells": 0.15,        # parallel runs this close (beyond their half widths) are one wall
    "align_cells": 0.15,            # walls in one line within this of each other share a centre line
    "align_gap_cells": 2.5,         # ... across a gap (a door) up to this long              # share of open floor needed along at least one side of a proposed wall
}


def settings(cfg):
    s = dict(DEFAULTS)
    s.update(cfg or {})
    return s


def suppress_grid(mask, g, cfg=None):
    """Clear grid lines from the wall mask: pixels near a grid line whose dark run across the line is thinner than
    a grid line. Returns (mask, cleared pixel count)."""
    s = settings(cfg)
    cs, (ox, oy) = g["cell_px"], g["origin_px"]
    H, W = mask.shape
    thin = max(1, int(round(s["grid_line_max_cells"] * cs)))
    band = max(1, int(round(s["grid_band_cells"] * cs)))
    out = mask.copy()
    cleared = 0
    # run length of wall pixels across each pixel, horizontally (for vertical grid lines) and vertically
    def runs(m, axis):
        r = np.zeros(m.shape, np.int32)
        a = m if axis == 1 else m.T
        rr = r if axis == 1 else r.T
        for i in range(a.shape[0]):
            row = a[i]
            if not row.any():
                continue
            d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
            st, en = np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]
            for s0, e0 in zip(st, en):
                rr[i, s0:e0] = e0 - s0
        return r
    across_x = runs(mask, 1)   # horizontal run length: thickness of a vertical line
    across_y = runs(mask, 0)   # vertical run length: thickness of a horizontal line
    for k in range(int(g["cols"]) + 1):
        x = int(round(ox + k * cs))
        x0, x1 = max(0, x - band), min(W, x + band + 1)
        sl = out[:, x0:x1]
        kill = sl & (across_x[:, x0:x1] <= thin)
        cleared += int(kill.sum()); sl[kill] = False
    for k in range(int(g["rows"]) + 1):
        y = int(round(oy + k * cs))
        y0, y1 = max(0, y - band), min(H, y + band + 1)
        sl = out[y0:y1, :]
        kill = sl & (across_y[y0:y1, :] <= thin)
        cleared += int(kill.sum()); sl[kill] = False
    return out, cleared


def _bands(mask, cs, s, axis):
    """Straight runs along `axis` ('h': rows, 'v': columns) as {axis, c, lo, hi, w} in pixels."""
    m = mask if axis == "h" else mask.T
    min_len = int(s["min_len_cells"] * cs)
    # keep pixels that belong to a long run along the axis
    longm = np.zeros(m.shape, np.uint8)
    for i in range(m.shape[0]):
        row = m[i]
        if not row.any():
            continue
        d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
        st, en = np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]
        for s0, e0 in zip(st, en):
            if e0 - s0 >= min_len:
                longm[i, s0:e0] = 1
    n, lab, stats, _ = cv2.connectedComponentsWithStats(longm, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if w < min_len or h < s["min_w_cells"] * cs or h > s["max_w_cells"] * cs:
            continue
        sub = lab[y:y + h, x:x + w] == i
        prof = sub.sum(axis=0)   # thickness along the run
        cover = prof > 0
        if cover.mean() < s["fill_ratio"]:
            continue
        # a wall has open floor on at least one side; a run inside a dark mass (rock, shadow) does not
        pad = max(2, int(0.06 * cs))
        above = m[max(0, y - pad):y, x:x + w]
        below = m[y + h:y + h + pad, x:x + w]
        clear = lambda band: band.size and (1 - band.mean()) > s["side_clear"]
        if not (clear(above) or clear(below)):
            continue
        rows = np.nonzero(sub.any(axis=1))[0]
        weights = sub.sum(axis=1)[rows]
        c = y + float((rows * weights).sum() / weights.sum()) + 0.5
        thick = float(np.median(prof[cover]))
        out.append({"axis": axis, "c": c, "lo": float(x), "hi": float(x + w), "w": thick})
    return out


def find_lines(mask, g, cfg=None):
    """Proposed straight walls, in cells: [{axis: 'h'|'v', c, lo, hi, w}] (c: the centre line's y for 'h', x for 'v')."""
    s = settings(cfg)
    cs, (ox, oy) = g["cell_px"], g["origin_px"]
    res = []
    for b in _bands(mask, cs, s, "h") + _bands(mask, cs, s, "v"):
        o_c, o_l = (oy, ox) if b["axis"] == "h" else (ox, oy)
        res.append({"axis": b["axis"], "c": (b["c"] - o_c) / cs, "lo": (b["lo"] - o_l) / cs, "hi": (b["hi"] - o_l) / cs, "w": b["w"] / cs})
    return res


def measure(spec, mask, g, cfg=None):
    """A hand-listed line ({axis, at, from, to}) measured from the mask: its centre and thickness within the window."""
    s = settings(cfg)
    cs, (ox, oy) = g["cell_px"], g["origin_px"]
    axis, at, lo, hi = spec["axis"], spec["at"], min(spec["from"], spec["to"]), max(spec["from"], spec["to"])
    win = s["measure_window_cells"]
    m = mask if axis == "h" else mask.T
    o_c, o_l = (oy, ox) if axis == "h" else (ox, oy)
    r0, r1 = int(o_c + (at - win) * cs), int(o_c + (at + win) * cs) + 1
    c0, c1 = int(o_l + lo * cs), int(o_l + hi * cs)
    r0, c0 = max(r0, 0), max(c0, 0)
    sub = m[r0:r1, c0:c1]
    if not sub.size or not sub.any():
        return {"axis": axis, "c": at, "lo": lo, "hi": hi, "w": None, "found": False}
    prof = sub.mean(axis=1)            # share of the length that is wall, per row
    rows = np.nonzero(prof > 0.5 * prof.max())[0]
    # the band of rows around the darkest row
    best = int(np.argmax(prof))
    keep = [best]
    for d in (-1, 1):
        k = best + d
        while 0 <= k < len(prof) and k in rows:
            keep.append(k); k += d
    keep = sorted(keep)
    c = r0 + (keep[0] + keep[-1] + 1) / 2
    return {"axis": axis, "c": (c - o_c) / cs, "lo": lo, "hi": hi, "w": len(keep) / cs, "found": True}


def consolidate(lines, cfg=None):
    """Tidy proposals: two parallel runs that overlap and lie within a wall's width of each other are one wall (the art
    drew its two edges, or a trim along it), measured from outer edge to outer edge; walls in one line across a gap
    (a door) share one centre line, so the door between them sits on it too."""
    s = settings(cfg)
    L = [dict(x) for x in lines]
    merged = True
    while merged:
        merged = False
        for i in range(len(L)):
            for j in range(i + 1, len(L)):
                a, b = L[i], L[j]
                if a["axis"] != b["axis"]:
                    continue
                overlap = min(a["hi"], b["hi"]) - max(a["lo"], b["lo"])
                if overlap <= 0 or abs(a["c"] - b["c"]) > (a["w"] + b["w"]) / 2 + s["merge_gap_cells"]:
                    continue
                top = min(a["c"] - a["w"] / 2, b["c"] - b["w"] / 2)
                bot = max(a["c"] + a["w"] / 2, b["c"] + b["w"] / 2)
                L[i] = dict(a, c=(top + bot) / 2, w=bot - top, lo=min(a["lo"], b["lo"]), hi=max(a["hi"], b["hi"]))
                L.pop(j)
                merged = True
                break
            if merged:
                break
    # collinear across gaps: one centre line
    used = [False] * len(L)
    for i in range(len(L)):
        if used[i]:
            continue
        group = [i]
        for j in range(i + 1, len(L)):
            if used[j] or L[j]["axis"] != L[i]["axis"] or abs(L[j]["c"] - L[i]["c"]) > s["align_cells"]:
                continue
            gap = max(L[j]["lo"], L[i]["lo"]) - min(L[j]["hi"], L[i]["hi"])
            if gap <= s["align_gap_cells"]:
                group.append(j)
        if len(group) > 1:
            tot = sum(L[k]["hi"] - L[k]["lo"] for k in group)
            c = sum(L[k]["c"] * (L[k]["hi"] - L[k]["lo"]) for k in group) / tot
            for k in group:
                L[k]["c"] = c; used[k] = True
    return L


def cut_openings(lines, openings, cfg=None):
    """Split lines where a door, secret door or window lies along them. openings: [{a, b}] in cells."""
    s = settings(cfg)
    out = []
    for L in lines:
        pieces = [(L["lo"], L["hi"])]
        for o in openings:
            (ax, ay), (bx, by) = o["a"], o["b"]
            if L["axis"] == "h":
                if abs(ay - by) > 0.05 or abs((ay + by) / 2 - L["c"]) > max(s["door_gap_cells"], L["w"]):
                    continue
                u0, u1 = sorted((ax, bx))
            else:
                if abs(ax - bx) > 0.05 or abs((ax + bx) / 2 - L["c"]) > max(s["door_gap_cells"], L["w"]):
                    continue
                u0, u1 = sorted((ay, by))
            nxt = []
            for p0, p1 in pieces:
                if u1 <= p0 or u0 >= p1:
                    nxt.append((p0, p1)); continue
                if u0 - p0 > 0.05: nxt.append((p0, u0))
                if p1 - u1 > 0.05: nxt.append((u1, p1))
            pieces = nxt
        for p0, p1 in pieces:
            out.append(dict(L, lo=p0, hi=p1))
    return out


def to_segments(lines, *, jamb_pad=True):
    """Centre-line segments with thickness: [{t: 'solid', a, b, w}]. Ends are pulled in by w/2 (the engine squares
    a thick wall off w/2 past each end), so a wall meets its neighbour or a door's jamb exactly at the drawn edge."""
    out = []
    for L in lines:
        h = L["w"] / 2 if jamb_pad else 0
        lo, hi = L["lo"] + h, L["hi"] - h
        if hi - lo < 0.02:
            lo = hi = (L["lo"] + L["hi"]) / 2
            hi += 0.02
        a, b = ([lo, L["c"]], [hi, L["c"]]) if L["axis"] == "h" else ([L["c"], lo], [L["c"], hi])
        out.append({"t": "solid", "a": a, "b": b, "w": round(L["w"], 4), "line": True})
    return out


def square_up(segs, deg=3.0):
    """Traced segments within `deg` of horizontal or vertical become exactly so (both ends on their mean)."""
    n = 0
    for s in segs:
        (ax, ay), (bx, by) = s["a"], s["b"]
        ang = math.degrees(math.atan2(by - ay, bx - ax)) % 180
        if min(ang, 180 - ang) <= deg and ay != by:
            m = (ay + by) / 2; s["a"], s["b"] = [ax, m], [bx, m]; n += 1
        elif abs(ang - 90) <= deg and ax != bx:
            m = (ax + bx) / 2; s["a"], s["b"] = [m, ay], [m, by]; n += 1
    return n


def snap_value(v, step):
    return round(round(v / step) * step, 6)


def weld(segs, tol=0.08, step=0.03125):
    """Join endpoints within `tol` cells into one point (their mean), then snap every point to `step`."""
    pts = [(i, k) for i in range(len(segs)) for k in ("a", "b")]
    coords = np.array([segs[i][k] for i, k in pts], float) if pts else np.zeros((0, 2))
    group = list(range(len(pts)))

    def find(x):
        while group[x] != x:
            group[x] = group[group[x]]; x = group[x]
        return x
    if len(coords):
        order = np.argsort(coords[:, 0])
        for ii in range(len(order)):
            i = order[ii]
            for jj in range(ii + 1, len(order)):
                j = order[jj]
                if coords[j, 0] - coords[i, 0] > tol:
                    break
                if abs(coords[j, 1] - coords[i, 1]) <= tol and math.hypot(*(coords[j] - coords[i])) <= tol:
                    group[find(i)] = find(j)
    # an end that lies on a thick straight wall (inside its box, or within tol of it) moves onto its centre line,
    # so the end is buried in the wall and no ray slips between them
    boxes = [(i, np.array(x["a"], float), np.array(x["b"], float), x["w"]) for i, x in enumerate(segs) if x.get("line") and x.get("w")]
    for idx, (i, k) in enumerate(pts):
        if segs[i].get("line"):
            continue
        p = coords[idx]
        for j, a, b, w in boxes:
            d = b - a; L = float(np.hypot(*d)) or 1.0; u = d / L
            t = float(np.dot(p - a, u))
            off = abs(float(u[0] * (p - a)[1] - u[1] * (p - a)[0]))
            if -w / 2 - tol <= t <= L + w / 2 + tol and off <= w / 2 + tol:
                coords[idx] = a + u * t   # onto the centre line, moved only across it (the box covers w/2 past each end)
                break
    # where a group meets, the most trusted point wins: a measured straight wall, then a door, then the mean
    rank = lambda idx: 0 if segs[pts[idx][0]].get("line") else 1 if segs[pts[idx][0]].get("door") else 2
    members_of = {}
    for idx in range(len(pts)):
        members_of.setdefault(find(idx), []).append(idx)
    welded = 0
    for r, members in members_of.items():
        best = min(rank(m) for m in members)
        top = [coords[m] for m in members if rank(m) == best]
        p = np.mean(top, axis=0)
        for m in members:
            i, k = pts[m]
            # a measured straight wall never moves (two that meet already overlap at the corner); others go to it
            q = coords[m] if rank(m) == 0 else p
            if rank(m) > 0 and len(members) > 1:
                # a square wall stays square: it moves only along its own direction
                o = coords[pts.index((i, "b" if k == "a" else "a"))]
                if abs(o[0] - coords[m][0]) < 1e-9:
                    q = np.array([coords[m][0], q[1]])
                elif abs(o[1] - coords[m][1]) < 1e-9:
                    q = np.array([q[0], coords[m][1]])
            if len(members) > 1:
                welded += 1
            segs[i][k] = [snap_value(q[0], step), snap_value(q[1], step)]
    return welded
