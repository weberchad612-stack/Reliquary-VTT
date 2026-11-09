#!/usr/bin/env python3
"""Run the map importer for one map, from its import settings file.

Usage:
    python3 tools/mapimport/build.py <map-folder>/import.json [--repo DIR]

The settings file lives in the map's folder inside a (private) pack and names the source PDF,
the page, and every setting and correction for this map. The importer writes, next to it:
map.json, walls.json, the map image, and import-report.json (counts and what was applied).
Paths in the settings are relative to the repository root (--repo, default: two folders up from
this script).

Settings (all optional except source and map):
  source:     {pdf, page, image?}                       where the map image is
  map:        {id, name, feet_per_cell?}
  grid:       "auto" or {cell_px, origin_px, cols, rows}
  mask:       wall/door/window detection settings, including exclude rectangles (cells);
              an exclude with "hide": true (an inset of another map) also becomes a hidden area
  features:   door, window and slit detection settings
  vectorize:  {tolerance_cells, min_ring_cells}
  erase:      [{cells: [x0, y0, x1, y1] | poly: [[x, y], ...], note}]   not walls (stairs, rubble)
  slits:      {reject_near: [[x, y], ...], note}   detected slits to drop (moss, unclear art)
  openings:   [{kind: slit|secret|door|window, at: [x, y], width_cells?, angle_deg?, ...props, note}]
              cut an opening through a wall and put a segment of that kind across it
  doors:      [{near: [x, y], ...props}]          properties for detected doors
  windows:    [{near: [x, y], ...props}]          properties for detected windows
  add:        [{t, a: [x, y], b: [x, y], door?: {...}, ...props, note}]   explicit segments (secret
              doors placed from the adventure's map; pair them with an erase that opens the wall)
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

from mapimport import extract, grid as gridmod, mask as maskmod, features, vectorize  # noqa: E402

SEG_PROPS = ("sight", "light", "sound", "move", "dir", "prox", "room", "note")
DOOR_PROPS = ("id", "label", "initial", "dc", "stuck_dc", "blocked", "auto_find")


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


def build(cfg_path, repo):
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)
    out_dir = os.path.dirname(os.path.abspath(cfg_path))
    report = {"applied": []}

    src = cfg["source"]
    img, chosen = extract.extract_map(os.path.join(repo, src["pdf"]), src["page"], src.get("image"))
    report["source"] = {"page": src["page"], "image": chosen["num"], "size": list(img.size)}

    g = cfg.get("grid", "auto")
    if g == "auto":
        g = gridmod.calibrate(img)
        report["grid"] = dict(g, found="auto")
    else:
        report["grid"] = dict(g, found="given")
    cs = g["cell_px"]
    fpc = cfg["map"].get("feet_per_cell", 5)

    m = maskmod.build_masks(img, g, cfg.get("mask"))
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

    fcfg = cfg.get("features")
    pre, _ = features.smooth_and_find_slits(wall, door_px | window_px, cs, fpc, fcfg)
    doors = features.find_doors(door_px, pre, cs, fcfg)
    rej = (cfg.get("slits") or {}).get("reject_near", [])
    smooth, slits = features.smooth_and_find_slits(wall, door_px | window_px, cs, fpc, fcfg, doors=doors,
                                                   reject_px=[cells_to_px(r, g) for r in rej])
    for r in rej:
        report["applied"].append({"slit_rejected_near": r})

    special = []
    for o in cfg.get("openings", []):
        kind = o["kind"]
        width = o.get("width_cells", {"slit": 0.25, "secret": 1.0, "door": 1.0, "window": 1.0}[kind]) * cs
        a, b, thick = cut_opening(smooth, cells_to_px(o["at"], g), g, width, o.get("angle_deg"))
        seg = {"t": kind}
        if kind in ("door", "secret"):
            seg["door"] = {"id": o.get("id"), "label": o.get("label", "Secret door" if kind == "secret" else "Door")}
        if kind == "slit":
            near = features.DEFAULTS["slit_near_ft"] + (thick / cs) * fpc / 2
            seg["prox"] = {"sight": round(near * 2) / 2, "light": round(near * 2) / 2}
        apply_props(seg, {k: v for k, v in o.items() if k not in ("kind", "at", "width_cells", "angle_deg")})
        seg["a"], seg["b"] = seg_cells(a, b, g)
        special.append(seg)
        report["applied"].append({"opening": kind, "at": o["at"], "note": o.get("note", "")})

    doors = features.find_doors(door_px, smooth, cs, fcfg)
    for d in doors:
        clear_doorway(smooth, d, cs)
    wins = features.find_windows(window_px, smooth, cs, fcfg)

    door_segs = []
    for d in doors:
        a, b = seg_cells(d["a"], d["b"], g)
        door_segs.append({"a": a, "b": b, "t": "door", "door": {"label": "Double door" if d["leaves"] == 2 else "Door"}})
    for p in cfg.get("doors", []):
        best = min(door_segs, key=lambda s: dist_point_seg(p["near"], s["a"], s["b"]), default=None)
        if best is None or dist_point_seg(p["near"], best["a"], best["b"]) > 1.0:
            raise ValueError(f"no detected door near {p['near']}")
        apply_props(best, {k: v for k, v in p.items() if k != "near"})
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

    rings = vectorize.rings(smooth, g, cfg.get("vectorize"))
    walls = [dict(s, t="solid") for s in vectorize.segments(rings)]
    for x in cfg.get("add", []):
        seg = {"t": x["t"], "a": [vectorize.snap(v) for v in x["a"]], "b": [vectorize.snap(v) for v in x["b"]]}
        if x.get("door") is not None:
            seg["door"] = dict(x["door"])
        apply_props(seg, {k: v for k, v in x.items() if k not in ("t", "a", "b", "door")})
        special.append(seg)
        report["applied"].append({"add": x["t"], "a": x["a"], "b": x["b"], "note": x.get("note", "")})

    # ids: stable, in reading order (top to bottom, left to right) per kind
    def order(s):
        return (round((s["a"][1] + s["b"][1]) / 2, 2), round((s["a"][0] + s["b"][0]) / 2, 2))
    out = []
    other = [s for s in special if s["t"] not in ("slit", "window", "door", "secret")]
    for prefix, group in (("w", walls + other), ("slit", slit_segs + [s for s in special if s["t"] == "slit"]),
                          ("win", win_segs + [s for s in special if s["t"] == "window"]),
                          ("door", door_segs + [s for s in special if s["t"] == "door"]),
                          ("secret", [s for s in special if s["t"] == "secret"])):
        for i, s in enumerate(sorted(group, key=order), 1):
            sid = f"{prefix}{i:04d}" if prefix == "w" else f"{prefix}{i:02d}"
            if s.get("door") is not None:
                s["door"].setdefault("id", None)
                if not s["door"]["id"]:
                    s["door"]["id"] = f"d{i:02d}" if prefix == "door" else f"s{i:02d}"
                s["door"].setdefault("initial", "closed")
            seg = {"id": sid, "a": s["a"], "b": s["b"], "t": s["t"]}
            for k in SEG_PROPS:
                if k in s:
                    seg[k] = s[k]
            if s.get("door") is not None:
                seg["door"] = {k: v for k, v in s["door"].items() if v is not None}
            if seg["a"] != seg["b"]:
                out.append(seg)

    mp = cfg["map"]
    img_name = f'{mp["id"]}.webp'
    img.save(os.path.join(out_dir, img_name), "WEBP", quality=88, method=6)
    map_rec = {
        "id": mp["id"], "name": mp["name"],
        "image": {"file": img_name, "w": img.size[0], "h": img.size[1]},
        "grid": {"cell_px": round(float(cs), 3), "origin_px": [float(v) for v in g["origin_px"]],
                 "cols": int(g["cols"]), "rows": int(g["rows"]), "feet_per_cell": fpc},
        "walls": "walls.json",
    }
    hidden = [{"cells": e["cells"], **({"note": e["note"]} if e.get("note") else {})}
              for e in (cfg.get("mask") or {}).get("exclude", []) if isinstance(e, dict) and e.get("hide")]
    if hidden:
        map_rec["hidden_areas"] = hidden
    if mp.get("note"):
        map_rec["note"] = mp["note"]
    with open(os.path.join(out_dir, "map.json"), "w", encoding="utf-8") as f:
        json.dump(map_rec, f, indent=1)
        f.write("\n")
    with open(os.path.join(out_dir, "walls.json"), "w", encoding="utf-8") as f:
        json.dump({"v": 1, "unit": "cell", "snap": 0.125, "segs": out}, f, separators=(",", ":"))
        f.write("\n")
    counts = {}
    for s in out:
        counts[s["t"]] = counts.get(s["t"], 0) + 1
    report["counts"] = counts
    report["segments"] = len(out)
    with open(os.path.join(out_dir, "import-report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1, default=float)
        f.write("\n")
    return report


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("config")
    ap.add_argument("--repo", default=os.path.dirname(os.path.dirname(HERE)))
    a = ap.parse_args(argv)
    r = build(a.config, a.repo)
    print(json.dumps({"segments": r["segments"], "counts": r["counts"], "grid": r["grid"]}, default=float))


if __name__ == "__main__":
    main(sys.argv[1:])
