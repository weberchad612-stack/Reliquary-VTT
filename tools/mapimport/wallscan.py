#!/usr/bin/env python3
"""Measure where walls are drawn, from the art, for hand-placed straight walls (lines.add with "fixed": true;
docs/best-practices/map-importer.md section 4d).

Usage:
    python3 tools/mapimport/wallscan.py <map-dir> [--max-value 25] [--min-px 1] SPEC [SPEC ...]
    python3 tools/mapimport/wallscan.py <map-dir> --propose [--max-value 12] [--accept]

SPEC is  v:Y0:Y1:X0:X1  (vertical walls: the columns from X0 to X1, each the median over the rows Y0 to Y1)
     or  h:X0:X1:Y0:Y1  (horizontal walls: the rows from Y0 to Y1, each the median over the columns X0 to X1),
in squares, in the map's grid (map.json). Pick a stretch along the walls that crosses no door, window or furniture.

Prints the dark runs met crossing the band, in squares: [start, end, width]. A wall drawn between two black outlines
shows as two thin runs: the wall is the outer edge of the first to the outer edge of the second. With
--max-value 70 the wall's fill and its drop shadow join the runs too (the shadow is on one side only: do not take
the centre from such a run).

--propose finds the walls itself (section 4f): thin near-black strokes, long and straight, paired into walls (the
outer edge of one outline to the outer edge of the other), merged where they continue each other. It prints them as
lines.add entries with "fixed": true and says which the import.json has already. --accept adds the new ones to
import.json, each with a note "proposed by wallscan": look at every one on the review sheet. Doors, windows and
walls with no straight outline (rubble, curves) are still placed by hand. On the first book it was tried on, it found
93% of the hand-placed walls, and 87% of what it proposed was a wall.
"""
import argparse
import json
import os
import sys

import cv2
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


def strokes(dark, axis, c, min_len=0.5, max_thick=0.25):
    """Straight dark strokes along one axis: [(lo, hi along; a0, a1 across)] in pixels. The thickness is the median
    across the stroke's length, so one dark spot (a shadow, a corner) does not widen it."""
    L = max(3, int(min_len * c))
    m = cv2.morphologyEx(dark, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (L, 1) if axis == "h" else (1, L)))
    if axis == "v":
        m = np.ascontiguousarray(m.T)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, _a = st[i]
        if w < L:
            continue
        sub = lab[y:y + h, x:x + w] == i
        cols = sub.any(0)
        top = sub.argmax(0)[cols]
        bot = (h - 1 - sub[::-1].argmax(0))[cols]
        t0, t1 = float(np.median(top)), float(np.median(bot)) + 1
        if t1 - t0 > max_thick * c:
            continue
        xs = np.where(cols)[0]
        out.append((x + int(xs[0]), x + int(xs[-1]) + 1, y + t0, y + t1))
    return out


def pair(st, c, max_gap=0.6, min_overlap=0.5):
    """Two parallel outlines a wall's width apart, overlapping along: [(lo, hi, a0, a1)], outer edge to outer edge."""
    st = sorted(st, key=lambda s: s[2])
    used, out = set(), []
    for i, A in enumerate(st):
        if i in used:
            continue
        best = None
        for j in range(i + 1, len(st)):
            B = st[j]
            gap = B[2] - A[3]
            if gap > max_gap * c:
                break
            if j in used or gap < 0.02 * c:
                continue
            ov = min(A[1], B[1]) - max(A[0], B[0])
            if ov >= min_overlap * c and (best is None or gap < best[0]):
                best = (gap, j)
        if best:
            B = st[best[1]]
            used |= {i, best[1]}
            out.append((max(A[0], B[0]), min(A[1], B[1]), A[2], B[3]))
    return out


def merge(walls, at_tol=0.1, gap=0.3):
    """Pieces of one wall (same axis, same line, touching or overlapping) become one."""
    out = []
    for w in sorted(walls, key=lambda w: (w["axis"], w["at"], w["from"])):
        last = out[-1] if out else None
        if last and last["axis"] == w["axis"] and abs(last["at"] - w["at"]) <= at_tol and w["from"] <= last["to"] + gap:
            span_l, span_w = last["to"] - last["from"], w["to"] - w["from"]
            last["at"] = round((last["at"] * span_l + w["at"] * span_w) / (span_l + span_w) * 32) / 32
            last["w"] = round(max(last["w"], w["w"]), 2)
            last["to"] = max(last["to"], w["to"])
        else:
            out.append(dict(w))
    return out


def propose(value, g, max_value=12, min_w=0.15, min_len=0.75):
    """Proposed straight walls, in squares, as lines.add entries with "fixed": true."""
    dark = (value < max_value).astype(np.uint8)
    c, (ox, oy) = g["cell_px"], g["origin_px"]
    q = lambda p, o: round((p - o) / c * 32) / 32
    res = []
    for axis in ("h", "v"):
        o_along, o_across = (ox, oy) if axis == "h" else (oy, ox)
        for lo, hi, a0, a1 in pair(strokes(dark, axis, c), c):
            res.append({"axis": axis, "at": q((a0 + a1) / 2, o_across), "from": q(lo, o_along), "to": q(hi, o_along),
                        "w": round((a1 - a0) / c, 2), "fixed": True})
    # thinner than any wall measured (a door bar, a rug's edge) or too short to be one (a crate)
    return [w for w in merge(res) if w["w"] >= min_w and w["to"] - w["from"] >= min_len]


def same_wall(p, k, tol=0.15):
    """A proposal and a placed line are one wall: same axis and line, overlapping by half the shorter."""
    if p["axis"] != k["axis"] or abs(p["at"] - k["at"]) > tol:
        return False
    lo = max(min(p["from"], p["to"]), min(k["from"], k["to"]))
    hi = min(max(p["from"], p["to"]), max(k["from"], k["to"]))
    return hi - lo >= 0.5 * min(abs(k["to"] - k["from"]), abs(p["to"] - p["from"]))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("map_dir")
    ap.add_argument("specs", nargs="*")
    ap.add_argument("--max-value", type=float, default=None, help="darkest value counted as wall ink (25; 12 with --propose)")
    ap.add_argument("--min-px", type=int, default=1)
    ap.add_argument("--propose", action="store_true", help="find the straight walls and print them as lines.add entries")
    ap.add_argument("--accept", action="store_true", help="with --propose: add the new ones to import.json")
    a = ap.parse_args(argv)
    m = json.load(open(os.path.join(a.map_dir, "map.json"), encoding="utf-8"))
    value = np.asarray(Image.open(os.path.join(a.map_dir, m["image"]["file"])).convert("RGB")).astype(float).max(2)
    if a.propose:
        props = propose(value, m["grid"], a.max_value or 12)
        ip = os.path.join(a.map_dir, "import.json")
        imp = json.load(open(ip, encoding="utf-8")) if os.path.exists(ip) else {}
        placed = [l for l in (imp.get("lines") or {}).get("add", []) if l.get("fixed")]
        # straight segments added by hand count as placed too
        for seg in imp.get("add", []):
            (x0, y0), (x1, y1) = seg.get("a", (0, 0)), seg.get("b", (0, 0))
            if y0 == y1:
                placed.append({"axis": "h", "at": y0, "from": min(x0, x1), "to": max(x0, x1)})
            elif x0 == x1:
                placed.append({"axis": "v", "at": x0, "from": min(y0, y1), "to": max(y0, y1)})
        new = [p for p in props if not any(same_wall(p, k) for k in placed)]
        for p in props:
            print(("NEW   " if p in new else "have  ") + json.dumps(p))
        print(f"{len(props)} wall(s) proposed: {len(props) - len(new)} placed already, {len(new)} new")
        if a.accept and new:
            for p in new:
                p["note"] = "proposed by wallscan: check on the review sheet"
            imp.setdefault("lines", {}).setdefault("add", []).extend(new)
            with open(ip, "w", encoding="utf-8") as f:
                json.dump(imp, f, indent=1)
                f.write("\n")
            print(f"added {len(new)} to {ip}")
        return 0
    if not a.specs:
        ap.error("give SPECs, or --propose")
    a.max_value = a.max_value or 25
    for s in a.specs:
        print(s, scan(value, m["grid"], s, a.max_value, a.min_px))
    return 0


if __name__ == "__main__":
    sys.exit(main())
