#!/usr/bin/env python3
"""Run the map importer for one map, from its import settings file.

Usage:
    python3 tools/mapimport/build.py <map-folder>/import.json [--repo DIR]

The settings file lives in the map's folder inside a (private) pack and names the source PDF,
the page, and every setting and correction for this map. The importer writes, next to it:
map.json, walls.json, terrain.json (when the settings have a terrain block), the map image, and
import-report.json (counts and what was applied).
Paths in the settings are relative to the repository root (--repo, default: two folders up from
this script).

Settings (all optional except source and map):
  source:     {pdf, page, image?, crop_px?, scale?}     where the map image is; crop_px [x0, y0, x1, y1] (source
              pixels) cuts one map out of a sheet holding several; scale resizes (1/3 for a 300 ppi print map)
  map:        {id, name, feet_per_cell?, start?, links?, note?}   start and links are copied into map.json
  grid:       "auto" or {cell_px, origin_px, cols, rows}   (in the cropped, scaled image's pixels)
  detect_cell_px: pixels per square for detection (default 50); a sharper image is traced on a smaller copy
  mask:       wall/door/window detection settings, including exclude rectangles (cells);
              an exclude with "hide": true (an inset of another map) also becomes a hidden area
  features:   door, window and slit detection settings
  vectorize:  {tolerance_cells, min_ring_cells}
  erase:      [{cells: [x0, y0, x1, y1] | poly: [[x, y], ...], note}]   not walls (stairs, rubble)
  slits:      {reject_near: [[x, y], ...], note}   detected slits to drop (moss, unclear art)
  openings:   [{kind: slit|secret|veil|door|window, at: [x, y], width_cells?, angle_deg?, ...props, note}]
              cut an opening through a wall and put a segment of that kind across it
  doors:      [{near: [x, y], ...props}]          properties for detected doors; {near, drop: true} removes a
              false detection (a bed's white edge)
  windows:    [{near: [x, y], ...props}]          properties for detected windows
  add:        [{t, a: [x, y], b: [x, y], door?: {...}, ...props, note}]   explicit segments (secret
              doors placed from the adventure's map; pair them with an erase that opens the wall)
  terrain:    {classes: {name: {hsv}}, areas: [{kind, cause, label, dc, active, select, art, minus, split, note}]}
              difficult terrain, water, slopes; see terrain.py
  lighting:   {outdoor, base, regions: [{level, select, minus, note}], lights: [{at, preset, ...}]}  see lighting.py
  rooms:      {label: [x, y]}  a point inside each keyed room, from the book's labelled map (registered
              to the image); terrain split by room is named after them
Segment props: id, label, initial, dc, stuck_dc, blocked, auto_find, sight, light, sound, prox, room, note.
"""
import argparse
import json
import math
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from mapimport import extract, grid as gridmod, mask as maskmod, features, vectorize, terrain as terrainmod  # noqa: E402
from mapimport import lighting as lightingmod  # noqa: E402
from mapimport import lines as linesmod  # noqa: E402
from mapimport import cache as cachemod  # noqa: E402

SEG_PROPS = ("sight", "light", "sound", "move", "dir", "prox", "room", "note", "w", "line")
DOOR_PROPS = ("id", "label", "initial", "dc", "stuck_dc", "blocked", "auto_find", "pair", "hinge", "swing")


def cells_to_px(p, g):
    return np.array([g["origin_px"][0] + p[0] * g["cell_px"], g["origin_px"][1] + p[1] * g["cell_px"]])


def seg_cells(a, b, g):
    return vectorize.to_cells(a, g), vectorize.to_cells(b, g)


def dist_point_seg(p, a, b):
    p, a, b = map(np.asarray, (p, a, b))
    ab = b - a
    t = float(np.clip(((p - a) @ ab) / max(ab @ ab, 1e-9), 0, 1))
    return float(np.linalg.norm(p - (a + t * ab)))


def clear_doorway(wall, door, cs):
    """Cut a detected door's whole opening through the wall mask.

    Door art usually sits in a dark frame that the wall mask picks up. Traced as it is, the wall outline
    funnels in toward the door bar or runs along it, so the open door still cannot be seen or walked
    through. Clearing the span between the jambs, through the full thickness of the wall, gives square
    jambs and a clear doorway.
    """
    import cv2
    a, b = np.asarray(door["a"], float), np.asarray(door["b"], float)
    d = (b - a) / np.linalg.norm(b - a)
    n = np.array([-d[1], d[0]])
    into = features.DEFAULTS["end_into_wall_cells"] * cs
    a0, b0 = a + d * into, b - d * into          # the jamb faces
    # Wall thickness, measured just inside each jamb on both sides of the door line.
    half = cs * 0.25
    for end, out in ((a0, -d), (b0, d)):
        p = end + out * cs * 0.25
        half = max(half, features._walk_to_free(wall, p, n, cs), features._walk_to_free(wall, p, -n, cs))
    half = min(half, cs) + 2
    corners = [a0 + n * half, b0 + n * half, b0 - n * half, a0 - n * half]
    w8 = wall.astype(np.uint8)
    cv2.fillPoly(w8, [np.round(np.array(corners)).astype(np.int32)], 0)
    wall[:] = w8.astype(bool)


COMPASS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"]


def _compass(v):
    """Compass name of a direction in image coordinates (y down)."""
    return COMPASS[int(round(math.degrees(math.atan2(v[1], v[0])) / 45)) % 8]


def swing_cost(wall, hinge, free, side):
    """Fraction of wall pixels in the quarter disc a leaf sweeps when it opens toward `side`."""
    d = np.asarray(free, float) - np.asarray(hinge, float)
    L = float(np.linalg.norm(d))
    u = d / L
    n = np.array([u[1], -u[0]]) if side == "left" else np.array([-u[1], u[0]])   # y down
    h, w = wall.shape
    hits = total = 0
    for r in np.linspace(0.25, 0.95, 6):
        for t in np.linspace(0.1, 1.45, 8):
            p = np.asarray(hinge, float) + L * r * (math.cos(t) * u + math.sin(t) * n)
            x, y = int(round(p[0])), int(round(p[1]))
            total += 1
            if not (0 <= x < w and 0 <= y < h) or wall[y, x]:
                hits += 1
    return hits / total


def door_leaves(d, wall, g):
    """Door segments, one per leaf, for a detected opening. A double door's leaves hinge at the outer
    ends, are paired, and are named by compass direction; the swing side is the one with room to open."""
    pts = [np.asarray(d["a"], float)] + [np.asarray(c, float) for c in d.get("cuts", [])] + [np.asarray(d["b"], float)]
    into = features.DEFAULTS["end_into_wall_cells"] * g["cell_px"]
    u = (pts[-1] - pts[0]) / np.linalg.norm(pts[-1] - pts[0])
    face = [pts[0] + u * into] + pts[1:-1] + [pts[-1] - u * into]   # jamb faces instead of segment ends
    n = len(pts) - 1
    if n == 1:
        options = [(h, sw) for h in ("a", "b") for sw in ("left", "right")]
        cost = lambda h, sw: swing_cost(wall, face[0] if h == "a" else face[1], face[1] if h == "a" else face[0], sw)
        hinge, swing = min(options, key=lambda o: (round(cost(*o), 2), options.index(o)))
        hinges = [hinge]
    else:
        hinges = ["a"] + ["a"] * (n - 2) + ["b"]
        def total(sw):
            c = 0.0
            for k in range(n):
                hp, fp = (face[k], face[k + 1]) if hinges[k] == "a" else (face[k + 1], face[k])
                c += swing_cost(wall, hp, fp, sw)
            return round(c, 2)
        swing = min(("left", "right"), key=lambda sw: (total(sw), sw != "left"))
    mid = (pts[0] + pts[-1]) / 2
    leaves = []
    for k in range(n):
        a, b = seg_cells(pts[k], pts[k + 1], g)
        door = {"label": "Door" if n == 1 else "Double door", "hinge": hinges[k], "swing": swing}
        leaf = {"a": a, "b": b, "t": "door", "door": door}
        if n > 1:
            leaf["_leafname"] = f"{_compass((pts[k] + pts[k + 1]) / 2 - mid)} leaf"
            door["label"] = f'Double door, {leaf["_leafname"]}'
        leaves.append(leaf)
    if n == 2:
        leaves[0]["door"]["_partner"], leaves[1]["door"]["_partner"] = leaves[1], leaves[0]
    return leaves


def cut_opening(wall, at_px, g, width_px, angle_deg=None):
    """Cut a straight opening through the wall at at_px. Returns (segment end a, end b, thickness px)."""
    cs = g["cell_px"]
    if angle_deg is None:
        r = int(cs)
        cx, cy = int(at_px[0]), int(at_px[1])
        ys, xs = np.nonzero(wall[max(0, cy - r):cy + r, max(0, cx - r):cx + r])
        if len(xs) < 20:
            raise ValueError(f"no wall near {at_px / cs}")
        _, d, _, _ = features._axis(np.column_stack([xs + max(0, cx - r), ys + max(0, cy - r)]))
    else:
        d = np.array([math.cos(math.radians(angle_deg)), math.sin(math.radians(angle_deg))])
    n = np.array([-d[1], d[0]])
    t1 = features._walk_to_free(wall, at_px, n, cs * 2)
    t2 = features._walk_to_free(wall, at_px, -n, cs * 2)
    mid = at_px + n * (t1 - t2) / 2
    thick = t1 + t2
    half = thick / 2 + 3
    import cv2
    corners = [mid + n * sn * half + d * sd * width_px / 2 for sn, sd in ((1, 1), (1, -1), (-1, -1), (-1, 1))]
    w8 = wall.astype(np.uint8)
    cv2.fillPoly(w8, [np.round(np.array(corners)).astype(np.int32)], 0)
    wall[:] = w8.astype(bool)
    into = features.DEFAULTS["end_into_wall_cells"] * cs
    return mid - d * (width_px / 2 + into), mid + d * (width_px / 2 + into), thick


def apply_props(seg, props):
    door = seg.get("door")
    for k, v in props.items():
        if k in DOOR_PROPS and door is not None:
            door[k] = v
        elif k in SEG_PROPS:
            seg[k] = v


PROFILES = os.path.join(HERE, "profiles.json")


def deep_merge(base, over):
    out = dict(base)
    for k, v in over.items():
        out[k] = deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def with_profile(cfg):
    """Settings from a named art-style profile (profiles.json), with the map's own settings over them."""
    name = cfg.get("profile")
    if not name:
        return cfg
    profiles = json.load(open(PROFILES, encoding="utf-8"))
    if name not in profiles:
        raise ValueError(f'no profile "{name}" in {PROFILES} (have: {", ".join(k for k in profiles if not k.startswith("_"))})')
    prof = {k: v for k, v in profiles[name].items() if k not in ("note", "learned_from")}
    return deep_merge(prof, cfg)


def straight_walls(lc, mask, g, door_segs, special, cfg, report):
    """Straight walls: the proposals found in the mask (lc.auto), minus rejected ones, plus hand-listed lines measured
    from the art; split by doors and windows; as centre lines with thickness. Their pixels leave the mask so the
    tracer does not draw them again."""
    cs = g["cell_px"]
    found = linesmod.find_lines(mask, g, lc) if lc.get("auto", True) else []
    rej = lc.get("reject_near", [])

    def near(L, p, d=0.3):
        u, v = (p[0], p[1]) if L["axis"] == "h" else (p[1], p[0])
        return abs(v - L["c"]) <= d and L["lo"] - d <= u <= L["hi"] + d
    kept = [L for L in found if not any(near(L, p) for p in rej)]
    report["lines_proposed"] = len(found)
    report["lines_rejected"] = len(found) - len(kept)
    for spec in lc.get("add", []):
        m = linesmod.measure(spec, mask, g, lc)
        if not m["found"]:
            m["w"] = spec.get("w", 0.06)
            report.setdefault("lines_not_found", []).append(spec)
        kept.append(m)
    openings = [x for x in door_segs + special if x["t"] in ("door", "secret", "veil", "window", "ethereal", "terrain")]
    kept = linesmod.consolidate(kept, lc)
    # a door, window or hand-placed opening on a straight wall sits exactly on its centre line
    aligned = 0
    for o in openings:
        (ax, ay), (bx, by) = o["a"], o["b"]
        for L in kept:
            if L["axis"] == "h" and abs(ay - by) < 0.05 and abs((ay + by) / 2 - L["c"]) <= max(0.15, L["w"]) and min(ax, bx) < L["hi"] + 1.5 and max(ax, bx) > L["lo"] - 1.5:
                o["a"], o["b"] = [ax, L["c"]], [bx, L["c"]]; aligned += 1; break
            if L["axis"] == "v" and abs(ax - bx) < 0.05 and abs((ax + bx) / 2 - L["c"]) <= max(0.15, L["w"]) and min(ay, by) < L["hi"] + 1.5 and max(ay, by) > L["lo"] - 1.5:
                o["a"], o["b"] = [L["c"], ay], [L["c"], by]; aligned += 1; break
    report["openings_aligned"] = aligned
    pieces = linesmod.cut_openings(kept, openings, lc)
    segs = linesmod.to_segments(pieces)
    # the drawn wall under each line leaves the mask
    import cv2
    w8 = mask.astype(np.uint8)
    for L in pieces:
        a, b = (cells_to_px([L["lo"], L["c"]], g), cells_to_px([L["hi"], L["c"]], g)) if L["axis"] == "h" else (cells_to_px([L["c"], L["lo"]], g), cells_to_px([L["c"], L["hi"]], g))
        cv2.line(w8, tuple(int(round(v)) for v in a), tuple(int(round(v)) for v in b), 0, max(1, int(round(L["w"] * cs)) + 4))
    mask[:] = w8.astype(bool)
    report["lines"] = len(segs)
    return segs


def erase_interiors(cfg, mask, g, segs, report):
    """Each keyed room's inside loses its traced wall pixels, except within margin_cells of the room's edge: grid
    lines, floor shading and furniture outlines inside a room never become walls. The room is the floor reached from
    its point (cfg rooms) without crossing wall pixels or the walls known so far (straight walls, doors, hand-placed
    segments), kept inside its clip rectangle if it has one; dark islands inside it are its floor detail."""
    import cv2
    ic = cfg["interior_erase"] if isinstance(cfg["interior_erase"], dict) else {}
    margin = ic.get("margin_cells", 0.15)
    skip = set(ic.get("skip", []))
    cs, (ox, oy) = g["cell_px"], g["origin_px"]
    H, W = mask.shape
    barrier = mask.astype(np.uint8)
    for x in segs:
        if x.get("w"):   # a thick wall: its whole box, squared off w/2 past its ends, as the engine sees it
            a, b, h = np.array(x["a"], float), np.array(x["b"], float), x["w"] / 2 + 1.5 / cs
            u = (b - a) / (np.linalg.norm(b - a) or 1); n = np.array([u[1], -u[0]])
            box = [a - u * h + n * h, b + u * h + n * h, b + u * h - n * h, a - u * h - n * h]
            cv2.fillPoly(barrier, [np.round(np.array([cells_to_px(q, g) for q in box])).astype(np.int32)], 1)
            continue
        a, b = cells_to_px(x["a"], g), cells_to_px(x["b"], g)
        cv2.line(barrier, tuple(int(round(v)) for v in a), tuple(int(round(v)) for v in b), 1, 3)
    total = 0
    k = max(1, int(round(margin * cs)))
    for key, at in cfg["rooms"].items():
        if key in skip:
            continue
        bar = barrier.copy()
        clip = (ic.get("clip") or {}).get(key)
        if clip:
            p0, p1 = cells_to_px(clip[:2], g), cells_to_px(clip[2:], g)
            keep = np.zeros_like(bar); keep[max(0, int(p0[1])):int(p1[1]), max(0, int(p0[0])):int(p1[0])] = 1
            bar[keep == 0] = 1
        sx, sy = (int(round(v)) for v in cells_to_px(at, g))
        if bar[sy, sx]:   # the point is on a wall: the nearest floor pixel
            ys, xs = np.nonzero(bar == 0)
            if not len(xs):
                continue
            n = int(np.argmin((xs - sx) ** 2 + (ys - sy) ** 2)); sx, sy = int(xs[n]), int(ys[n])
        ff = np.zeros((H + 2, W + 2), np.uint8)
        region = (1 - bar).astype(np.uint8)
        cv2.floodFill(region, ff, (sx, sy), 2)
        room = (region == 2).astype(np.uint8)
        if room.sum() > 0.5 * H * W:
            report.setdefault("interior_erase_problems", []).append(f"{key}: the room leaks (give it a clip)")
            continue
        # the room with its holes (dark floor detail) filled, pulled in from its edge by the margin
        cnts, _ = cv2.findContours(room, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        full = np.zeros_like(room)
        cv2.drawContours(full, cnts, -1, 1, -1)
        inner = cv2.erode(full, np.ones((2 * k + 1, 2 * k + 1), np.uint8)).astype(bool)
        hit = mask & inner
        total += int(hit.sum())
        mask[hit] = False
    report["interior_erased_px"] = total


def merge_room(new, out_dir, room, report, margin=0.5):
    """One room rebuilt: the walls in and around room `room` (its squares in rooms.json, plus `margin` cells) come
    from this run; every other wall is kept from the map's walls.json exactly as it was. A door, window or other
    opening rebuilt in the room keeps its old id (and door id) when one of the same type lies within half a square,
    so saves that name it still work. docs/best-practices/map-importer.md section 4c."""
    rooms = json.load(open(os.path.join(out_dir, "rooms.json"))).get("rooms", {})
    if room not in rooms:
        raise ValueError(f"no room {room} in rooms.json")
    rects = [(x - margin, y - margin, x + w + margin, y + h + margin) for x, y, w, h in rooms[room]["rects"]]
    inside = lambda s: any(x0 <= (s["a"][0] + s["b"][0]) / 2 <= x1 and y0 <= (s["a"][1] + s["b"][1]) / 2 <= y1 for x0, y0, x1, y1 in rects)
    old = json.load(open(os.path.join(out_dir, "walls.json")))["segs"]
    kept = [s for s in old if not inside(s)]
    used = {s["id"] for s in kept}
    mid = lambda s: ((s["a"][0] + s["b"][0]) / 2, (s["a"][1] + s["b"][1]) / 2)
    old_in = [s for s in old if inside(s)]
    fresh = 0
    for s in [x for x in new if inside(x)]:
        twin = min((o for o in old_in if o["t"] == s["t"] and o["id"] not in used and s["t"] != "solid"),
                   key=lambda o: math.dist(mid(o), mid(s)), default=None)
        if twin is not None and math.dist(mid(twin), mid(s)) <= 0.5:
            s["id"] = twin["id"]
            if s.get("door") and twin.get("door"):
                s["door"]["id"] = twin["door"]["id"]
        if s["id"] in used:
            n = 1
            while f"r{n:04d}" in used:
                n += 1
            s["id"] = f"r{n:04d}"
            fresh += 1
        used.add(s["id"])
        kept.append(s)
    report["room_rebuilt"] = {"room": room, "replaced": len(old_in), "now": len(kept) - (len(old) - len(old_in)), "new_ids": fresh}
    return kept


def build(cfg_path, repo, use_cache=True, room=None):
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)
    cachemod.DIR = os.path.join(os.path.dirname(os.path.abspath(cfg_path)), ".cache") if use_cache else None
    cachemod.HITS.clear(); cachemod.MISSES.clear()
    cfg = with_profile(cfg)
    step = cfg.get("snap", 0.125)   # endpoint precision: 1/8 cell, or 1/32 for print-resolution maps (2026-11-14)
    vectorize.SNAP = step
    out_dir = os.path.dirname(os.path.abspath(cfg_path))
    report = {"applied": []}

    src = cfg["source"]
    pdf = os.path.join(repo, src["pdf"])
    src_key = cachemod.key(cachemod.file_id(pdf), src["page"], src.get("image"), src.get("crop_px"), src.get("scale"))

    # The full image is pulled out of the PDF only when something needs it (the first run, a changed source or grid,
    # the board's image missing); otherwise only its size and the smaller detection copy come from the cache.
    _full = {}

    def full():
        if "img" not in _full:
            im, ch = extract.extract_map(pdf, src["page"], src.get("image"))
            _full["img"], _full["chosen"] = extract.crop_scale(im, src.get("crop_px"), src.get("scale")), ch
        return _full["img"]
    size, chosen_num = cachemod.memo("source-info", lambda: (full().size, _full["chosen"]["num"]), key_extra=src_key)
    report["source"] = {"page": src["page"], "image": chosen_num, "size": list(size),
                        **({"crop_px": src["crop_px"]} if src.get("crop_px") else {}),
                        **({"scale": src["scale"]} if src.get("scale") else {})}

    g = cfg.get("grid", "auto")
    if g == "auto":
        g = cachemod.memo("grid", lambda: gridmod.calibrate(full()), key_extra=src_key)
        report["grid"] = dict(g, found="auto")
    else:
        report["grid"] = dict(g, found="given")
    # Detection runs on a copy at about detect_cell_px per square (default 50): a print-quality map at 200-300 px per
    # square takes many minutes and gigabytes to trace and gains nothing, because every result is in cells.
    # The board still gets the full image and its grid.
    full_g = g
    want = cfg.get("detect_cell_px", 50)
    k = want / g["cell_px"] if g["cell_px"] > want * 1.5 else 1.0
    img = cachemod.memo("detect", lambda: full().resize((max(1, round(size[0] * k)), max(1, round(size[1] * k))), Image.LANCZOS) if k < 1 else full(),
                        key_extra=[src_key, k])
    if k < 1:
        g = dict(g, cell_px=g["cell_px"] * k, origin_px=[v * k for v in g["origin_px"]])
        report["detect"] = {"cell_px": round(g["cell_px"], 3), "size": list(img.size)}
    cs = g["cell_px"]
    fpc = cfg["map"].get("feet_per_cell", 5)

    m = cachemod.memo("masks", maskmod.build_masks, img, g, cfg.get("mask"))
    wall, door_px, window_px = m["wall"], m["door"], m["window"]
    import cv2
    for e in cfg.get("erase", []):
        if "poly" in e:
            pts = np.round(np.array([cells_to_px(p, g) for p in e["poly"]])).astype(np.int32)
            w8 = wall.astype(np.uint8)
            cv2.fillPoly(w8, [pts], 0)
            wall = w8.astype(bool)
        else:
            x0, y0, x1, y1 = e["cells"]
            p0, p1 = cells_to_px([x0, y0], g), cells_to_px([x1, y1], g)
            wall[max(0, int(round(p0[1]))):max(0, int(round(p1[1]))), max(0, int(round(p0[0]))):max(0, int(round(p1[0])))] = False
        report["applied"].append({"erase": e.get("cells") or e.get("poly"), "note": e.get("note", "")})

    gl = cfg.get("grid_lines") or {}
    if gl.get("suppress"):
        wall, n = linesmod.suppress_grid(wall, g, gl)
        report["grid_lines_cleared_px"] = n

    fcfg = cfg.get("features")
    pre, _ = features.smooth_and_find_slits(wall, door_px | window_px, cs, fpc, fcfg)
    doors = cachemod.memo("doors-pre", features.find_doors, door_px, pre, cs, fcfg)
    rej = (cfg.get("slits") or {}).get("reject_near", [])
    smooth, slits = features.smooth_and_find_slits(wall, door_px | window_px, cs, fpc, fcfg, doors=doors,
                                                   reject_px=[cells_to_px(r, g) for r in rej])
    for r in rej:
        report["applied"].append({"slit_rejected_near": r})

    special = []
    for o in cfg.get("openings", []):
        kind = o["kind"]
        width = o.get("width_cells", {"slit": 0.25, "secret": 1.0, "veil": 1.0, "door": 1.0, "window": 1.0}[kind]) * cs
        a, b, thick = cut_opening(smooth, cells_to_px(o["at"], g), g, width, o.get("angle_deg"))
        seg = {"t": kind}
        if kind in ("door", "secret", "veil"):
            seg["door"] = {"id": o.get("id"), "label": o.get("label", {"secret": "Secret door", "veil": "Veil"}.get(kind, "Door"))}
        if kind == "slit":
            near = features.DEFAULTS["slit_near_ft"] + (thick / cs) * fpc / 2
            seg["prox"] = {"sight": round(near * 2) / 2, "light": round(near * 2) / 2}
        apply_props(seg, {k: v for k, v in o.items() if k not in ("kind", "at", "width_cells", "angle_deg")})
        seg["a"], seg["b"] = seg_cells(a, b, g)
        special.append(seg)
        report["applied"].append({"opening": kind, "at": o["at"], "note": o.get("note", "")})

    doors = cachemod.memo("doors", features.find_doors, door_px, smooth, cs, fcfg)
    for d in doors:
        clear_doorway(smooth, d, cs)
    wins = cachemod.memo("windows", features.find_windows, window_px, smooth, cs, fcfg)

    door_segs = []
    openings = []        # one list of leaves per detected door opening
    for d in doors:
        leaves = door_leaves(d, smooth, g)
        openings.append(leaves)
        door_segs += leaves
    for p in cfg.get("doors", []):
        best = min(door_segs, key=lambda s: dist_point_seg(p["near"], s["a"], s["b"]), default=None)
        if best is None or dist_point_seg(p["near"], best["a"], best["b"]) > 1.0:
            raise ValueError(f"no detected door near {p['near']}")
        group = next(o for o in openings if any(x is best for x in o))
        if p.get("drop"):   # not a door: furniture or art the detector misread (a bed's white edge)
            door_segs = [s for s in door_segs if not any(s is x for x in group)]
            openings.remove(group)
            report["applied"].append({"door_dropped": p["near"], "note": p.get("note", "")})
            continue
        props = {k: v for k, v in p.items() if k != "near"}
        if len(group) > 1 and "hinge" in props:
            raise ValueError(f"door near {p['near']}: the leaves of a double door hinge at its outer ends; set swing only")
        for leaf in group:   # properties apply to the whole opening (both leaves of a double door)
            q = dict(props)
            if len(group) > 1 and "label" in q:
                q["label"] = f'{q["label"]}, {leaf["_leafname"]}'
            apply_props(leaf, q)
        report["applied"].append({"door_props": p["near"], "note": p.get("note", "")})
    win_segs = []
    for w in wins:
        a, b = seg_cells(w["a"], w["b"], g)
        win_segs.append({"a": a, "b": b, "t": "window"})
    for p in cfg.get("windows", []):
        best = min(win_segs, key=lambda s: dist_point_seg(p["near"], s["a"], s["b"]), default=None)
        if best is None or dist_point_seg(p["near"], best["a"], best["b"]) > 1.0:
            raise ValueError(f"no detected window near {p['near']}")
        apply_props(best, {k: v for k, v in p.items() if k != "near"})
        report["applied"].append({"window_props": p["near"], "note": p.get("note", "")})
    slit_segs = []
    for s in slits:
        a, b = seg_cells(s["a"], s["b"], g)
        slit_segs.append({"a": a, "b": b, "t": "slit", "prox": {"sight": s["near_ft"], "light": s["near_ft"]}})

    for x in cfg.get("add", []):
        seg = {"t": x["t"], "a": [vectorize.snap(v) for v in x["a"]], "b": [vectorize.snap(v) for v in x["b"]]}
        if x.get("door") is not None:
            seg["door"] = dict(x["door"])
        apply_props(seg, {k: v for k, v in x.items() if k not in ("t", "a", "b", "door")})
        special.append(seg)
        report["applied"].append({"add": x["t"], "a": x["a"], "b": x["b"], "note": x.get("note", "")})
    line_segs = []
    lc = cfg.get("lines")
    if lc:
        line_segs = straight_walls(lc, smooth, g, door_segs + win_segs, special, cfg, report)
    if cfg.get("interior_erase") and cfg.get("rooms"):
        erase_interiors(cfg, smooth, g, line_segs + door_segs + win_segs + special, report)
    rings = vectorize.rings(smooth, g, cfg.get("vectorize"))
    walls = [dict(s, t="solid") for s in vectorize.segments(rings)]
    sq = (cfg.get("square_up_deg") if cfg.get("square_up_deg") is not None else (3.0 if lc else 0))
    if sq:
        report["squared_up"] = linesmod.square_up(walls, sq)
    walls += line_segs

    # ids: stable, in reading order (top to bottom, left to right) per kind
    def order(s):
        return (round((s["a"][1] + s["b"][1]) / 2, 2), round((s["a"][0] + s["b"][0]) / 2, 2))
    out = []
    other = [s for s in special if s["t"] not in ("slit", "window", "door", "secret", "veil")]
    for prefix, group in (("w", walls + other), ("slit", slit_segs + [s for s in special if s["t"] == "slit"]),
                          ("win", win_segs + [s for s in special if s["t"] == "window"]),
                          ("door", door_segs + [s for s in special if s["t"] == "door"]),
                          ("secret", [s for s in special if s["t"] == "secret"]),
                          ("veil", [s for s in special if s["t"] == "veil"])):
        for i, s in enumerate(sorted(group, key=order), 1):
            sid = f"{prefix}{i:04d}" if prefix == "w" else f"{prefix}{i:02d}"
            if s.get("door") is not None:
                s["door"].setdefault("id", None)
                if not s["door"]["id"]:
                    s["door"]["id"] = {"door": f"d{i:02d}", "veil": f"v{i:02d}"}.get(prefix, f"s{i:02d}")
                s["door"].setdefault("initial", "closed")
            # keep every endpoint on the grid (a wall drawn along the map's edge, or extended into a corner)
            clamp = lambda q: [min(max(q[0], 0), int(g["cols"])), min(max(q[1], 0), int(g["rows"]))]
            seg = {"id": sid, "a": clamp(s["a"]), "b": clamp(s["b"]), "t": s["t"]}
            for k in SEG_PROPS:
                if k in s:
                    seg[k] = s[k]
            if s.get("door") is not None:
                seg["door"] = {k: v for k, v in s["door"].items() if v is not None}
            if seg["a"] != seg["b"]:
                out.append(seg)
    # welding: ends that nearly meet become one point (a measured wall's end wins), then all on the file's grid
    if cfg.get("weld_cells", 0.08 if lc else 0):
        report["welded_ends"] = linesmod.weld(out, cfg.get("weld_cells", 0.08), step)
        out = [x for x in out if x["a"] != x["b"]]
        # welding can fold a traced outline's two sides onto one line: keep one of each plain wall with the same ends
        seen, kept = set(), []
        for x in out:
            key = (x["t"], x.get("w"), tuple(sorted([tuple(x["a"]), tuple(x["b"])])))
            if x.get("door") is None and key in seen:
                report["duplicates_dropped"] = report.get("duplicates_dropped", 0) + 1
                continue
            seen.add(key)
            kept.append(x)
        out = kept
    for x in out:
        x.pop("line", None)
    # Double doors: each leaf names the other (ids are known only now).
    for seg in out:
        door = seg.get("door")
        if door and "_partner" in door:
            door["pair"] = door.pop("_partner")["door"]["id"]
        if door:
            door.pop("_leafname", None)
    if room:
        out = merge_room(out, out_dir, room, report)

    mp = cfg["map"]
    img_name = f'{mp["id"]}.webp'
    # the board's image: written again only when the source changed or the file is gone
    img_path = os.path.join(out_dir, img_name)
    marker = os.path.join(cachemod.DIR, "image.key") if cachemod.DIR else None
    if not (marker and os.path.exists(img_path) and os.path.exists(marker) and open(marker).read() == src_key):
        full().save(img_path, "WEBP", quality=88, method=6)
        if marker:
            os.makedirs(cachemod.DIR, exist_ok=True)
            with open(marker, "w") as f:
                f.write(src_key)
    map_rec = {
        "id": mp["id"], "name": mp["name"],
        "image": {"file": img_name, "w": size[0], "h": size[1]},
        "grid": {"cell_px": round(float(full_g["cell_px"]), 3), "origin_px": [float(v) for v in full_g["origin_px"]],
                 "cols": int(g["cols"]), "rows": int(g["rows"]), "feet_per_cell": fpc},
        "walls": "walls.json",
    }
    hidden_rects = [e["cells"] for e in (cfg.get("mask") or {}).get("exclude", []) if isinstance(e, dict) and e.get("hide")]
    areas = terrainmod.build_terrain(cfg.get("terrain"), np.asarray(img.convert("RGB")), g, smooth, out, report,
                                     keyed_rooms=cfg.get("rooms"), hidden=hidden_rects)
    if areas:
        map_rec["terrain"] = "terrain.json"
        with open(os.path.join(out_dir, "terrain.json"), "w", encoding="utf-8") as f:
            json.dump({"v": 1, "areas": areas}, f, indent=1)
            f.write("\n")
        report["terrain"] = {a["id"]: sum(r[2] * r[3] for r in a["rects"]) for a in areas}
    light_fields, lighting = lightingmod.build_lighting(cfg.get("lighting"), g, out, areas or [], report,
                                                        keyed_rooms=cfg.get("rooms"), hidden=hidden_rects)
    map_rec.update(light_fields)
    if lighting:
        map_rec["lighting"] = "lighting.json"
        with open(os.path.join(out_dir, "lighting.json"), "w", encoding="utf-8") as f:
            json.dump(lighting, f, indent=1)
            f.write("\n")
        report["lighting"] = {r["id"]: sum(x[2] * x[3] for x in r["rects"]) for r in lighting.get("regions", [])}
    hidden = [{"cells": e["cells"], **({"note": e["note"]} if e.get("note") else {})}
              for e in (cfg.get("mask") or {}).get("exclude", []) if isinstance(e, dict) and e.get("hide")]
    if hidden:
        map_rec["hidden_areas"] = hidden
    for k in ("start", "links"):   # chosen by hand from the text: the party's arrival squares, exits to other maps
        if mp.get(k):
            map_rec[k] = mp[k]
    if mp.get("note"):
        map_rec["note"] = mp["note"]
    with open(os.path.join(out_dir, "map.json"), "w", encoding="utf-8") as f:
        json.dump(map_rec, f, indent=1)
        f.write("\n")
    with open(os.path.join(out_dir, "walls.json"), "w", encoding="utf-8") as f:
        json.dump({"v": 1, "unit": "cell", "snap": step, "segs": out}, f, separators=(",", ":"))
        f.write("\n")
    counts = {}
    for s in out:
        counts[s["t"]] = counts.get(s["t"], 0) + 1
    report["counts"] = counts
    report["segments"] = len(out)
    if cachemod.DIR:
        report["cache"] = {"reused": list(cachemod.HITS), "computed": list(cachemod.MISSES)}
    with open(os.path.join(out_dir, "import-report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1, default=float)
        f.write("\n")
    return report


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("config")
    ap.add_argument("--repo", default=os.path.dirname(os.path.dirname(HERE)))
    ap.add_argument("--no-cache", action="store_true", help="compute every step again and rewrite the cache")
    ap.add_argument("--room", help="rebuild only this room's walls (rooms.json); keep every other wall as it is")
    a = ap.parse_args(argv)
    r = build(a.config, a.repo, use_cache=not a.no_cache, room=a.room)
    print(json.dumps({**({"room_rebuilt": r["room_rebuilt"]} if r.get("room_rebuilt") else {}), "segments": r["segments"], "counts": r["counts"], "grid": r["grid"], **({"cache": r["cache"]} if r.get("cache") else {})}, default=float))


if __name__ == "__main__":
    main(sys.argv[1:])
