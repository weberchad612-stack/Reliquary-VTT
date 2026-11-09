#!/usr/bin/env python3
"""Draw a map's wall segments for review (docs/design/maps.md section 12, step 8).

Usage:
    python3 tools/wall_overlay.py <map-dir> [--out FILE] [--blank] [--no-labels]
                                  [--sight X,Y ...] [--state FILE] [--range FEET]

By default the walls are drawn over the map image and saved as <map-dir>/overlay.png.
--blank draws on a plain floor with a grid instead of the image (used to make the
original sample map images in examples/). Needs Pillow (pip install pillow).

Colours: solid black, terrain orange, grate grey dashed, window cyan, slit magenta,
ethereal violet, door red, secret door gold. One-way walls get an arrow showing the
side they block from.

--sight X,Y shades the area visible from that point (in cells; repeat for several viewers),
computed by the JavaScript sight engine through `node tools/sight.mjs`. --state applies door
states and found secrets from a save's map-state file.
"""
import argparse
import json
import math
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

COLOURS = {
    "solid": (20, 20, 20),
    "terrain": (230, 140, 20),
    "grate": (120, 120, 120),
    "window": (20, 190, 220),
    "slit": (220, 40, 200),
    "ethereal": (140, 90, 230),
    "door": (210, 30, 30),
    "secret": (225, 180, 0),
}
FLOOR = (205, 196, 176)
GRIDLINE = (175, 165, 145)


def load(map_dir):
    with open(os.path.join(map_dir, "map.json"), encoding="utf-8") as f:
        m = json.load(f)
    files = m["walls"] if isinstance(m["walls"], list) else [m["walls"]]
    segs = []
    for wf in files:
        with open(os.path.join(map_dir, wf), encoding="utf-8") as f:
            segs.extend(json.load(f)["segs"])
    return m, segs


TOOLS = os.path.dirname(os.path.abspath(__file__))


def sight_polygon(map_dir, origin, state, range_ft):
    cmd = ["node", os.path.join(TOOLS, "sight.mjs"), map_dir, "--from", origin, "--range", str(range_ft)]
    if state:
        cmd += ["--state", state]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(res.stderr.strip() or "sight.mjs failed")
    return json.loads(res.stdout)


def dashed(draw, a, b, colour, width, dash=6):
    length = math.dist(a, b)
    if length == 0:
        return
    n = max(1, int(length // dash))
    for i in range(0, n, 2):
        t0, t1 = i / n, min(1, (i + 1) / n)
        draw.line([(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0),
                   (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)], fill=colour, width=width)


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("map_dir")
    ap.add_argument("--out")
    ap.add_argument("--blank", action="store_true", help="plain floor and grid instead of the map image")
    ap.add_argument("--no-labels", action="store_true", help="do not write segment ids")
    ap.add_argument("--sight", action="append", default=[], metavar="X,Y", help="shade what is visible from X,Y (cells)")
    ap.add_argument("--state", help="map-state file from a save (door states, found secrets)")
    ap.add_argument("--range", type=float, default=200, help="vision range in feet (default 200)")
    a = ap.parse_args(argv)

    m, segs = load(a.map_dir)
    g = m["grid"]
    cs, ox, oy = g["cell_px"], g["origin_px"][0], g["origin_px"][1]
    w, h = m["image"]["w"], m["image"]["h"]

    if a.blank:
        img = Image.new("RGB", (w, h), FLOOR)
        d = ImageDraw.Draw(img)
        for c in range(g["cols"] + 1):
            d.line([(ox + c * cs, oy), (ox + c * cs, oy + g["rows"] * cs)], fill=GRIDLINE, width=1)
        for r in range(g["rows"] + 1):
            d.line([(ox, oy + r * cs), (ox + g["cols"] * cs, oy + r * cs)], fill=GRIDLINE, width=1)
    else:
        img = Image.open(os.path.join(a.map_dir, m["image"]["file"])).convert("RGB")
        d = ImageDraw.Draw(img)

    px = lambda p: (ox + p[0] * cs, oy + p[1] * cs)

    if a.sight:
        shade = Image.new("RGBA", img.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(shade)
        for origin in a.sight:
            res = sight_polygon(a.map_dir, origin, a.state, a.range)
            sd.polygon([px(p) for p in res["polygon"]], fill=(255, 220, 60, 90))
        img = Image.alpha_composite(img.convert("RGBA"), shade).convert("RGB")
        d = ImageDraw.Draw(img)
        for origin in a.sight:
            x, y = px([float(v) for v in origin.split(",")])
            d.ellipse([x - 6, y - 6, x + 6, y + 6], fill=(30, 110, 255), outline=(255, 255, 255), width=2)
    width = max(3, int(cs / 10))
    font = ImageFont.load_default()

    for s in segs:
        pa, pb = px(s["a"]), px(s["b"])
        col = COLOURS[s["t"]]
        if s["t"] in ("grate", "window"):
            d.line([pa, pb], fill=(255, 255, 255), width=width)
            dashed(d, pa, pb, col, width)
        else:
            d.line([pa, pb], fill=col, width=width + (2 if s["t"] in ("door", "secret") else 0))
        if s.get("dir", 0):
            # arrow from the segment midpoint toward the side it blocks from
            mx, my = (pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2
            dx, dy = pb[0] - pa[0], pb[1] - pa[1]
            ln = math.hypot(dx, dy) or 1
            nx, ny = (dy / ln, -dx / ln) if s["dir"] == 1 else (-dy / ln, dx / ln)
            tip = (mx + nx * cs * 0.45, my + ny * cs * 0.45)
            d.line([(mx, my), tip], fill=col, width=2)
            d.ellipse([tip[0] - 4, tip[1] - 4, tip[0] + 4, tip[1] + 4], fill=col)
        if not a.no_labels and not a.blank:
            mx, my = (pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2
            d.text((mx + 3, my + 3), s["id"], fill=col, font=font)

    out = a.out or os.path.join(a.map_dir, m["image"]["file"] if a.blank else "overlay.png")
    img.save(out)
    print(f"wrote {out} ({len(segs)} segments)")


if __name__ == "__main__":
    main(sys.argv[1:])
