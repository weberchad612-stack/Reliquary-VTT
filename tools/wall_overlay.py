#!/usr/bin/env python3
"""Draw a map's wall segments for review (docs/design/maps.md section 12, step 8).

Usage:
    python3 tools/wall_overlay.py <map-dir> [--out FILE] [--blank] [--no-labels]
                                  [--sight X,Y ...] [--token X,Y,SIZE ...] [--state FILE] [--range FEET]
                                  [--path X,Y,SIZE:GX,GY ...] [--reach X,Y,SIZE:FEET]
                                  [--fog player|gm] [--fog-token ID:KIND:X,Y[,SIZE] ...]

By default the walls are drawn over the map image and saved as <map-dir>/overlay.png.
--blank draws on a plain floor with a grid instead of the image (used to make the
original sample map images in examples/). Needs Pillow (pip install pillow).

Colours: solid black, terrain orange, grate grey dashed, window cyan, slit magenta,
ethereal violet, door red, secret door gold. One-way walls get an arrow showing the
side they block from.

--sight X,Y shades the area visible from that point (in cells; repeat for several viewers),
computed by the JavaScript sight engine through `node tools/sight.mjs`. --token X,Y,SIZE does the
same for a whole token (top-left cell and size in cells), the way the GM vision view shades it.

--path X,Y,SIZE:GX,GY draws the cheapest route for a token to (GX,GY) and its cost, and
--reach X,Y,SIZE:FEET shades every position the token can reach, both through `node tools/move.mjs`
(PF2E 5-10-5 diagonals).

--fog player|gm paints the fog of war for the tokens in --state (plus any --fog-token), through
`node tools/fog.mjs`: unexplored fogged, explored dimmed, visible clear. Tokens are drawn as rings
(blue PCs, red others); in the player view, tokens the party cannot see are left out. --state applies door
states and found secrets from a save's map-state file.
"""
import argparse
import json
import math
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

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


def sight_polygons(map_dir, flag, value, state, range_ft):
    cmd = ["node", os.path.join(TOOLS, "sight.mjs"), map_dir, flag, value, "--range", str(range_ft)]
    if state:
        cmd += ["--state", state]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(res.stderr.strip() or "sight.mjs failed")
    out = json.loads(res.stdout)
    return out["polygons"] if "polygons" in out else [out["polygon"]]


def run_move(map_dir, token, flag, value, state):
    cmd = ["node", os.path.join(TOOLS, "move.mjs"), map_dir, "--token", token, flag, value]
    if state:
        cmd += ["--state", state]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(res.stderr.strip() or "move.mjs failed")
    return json.loads(res.stdout)


def run_fog(map_dir, state, tokens):
    cmd = ["node", os.path.join(TOOLS, "fog.mjs"), map_dir, "--state", state]
    for t in tokens:
        cmd += ["--token", t]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(res.stderr.strip() or "fog.mjs failed")
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
    ap.add_argument("--token", action="append", default=[], metavar="X,Y,SIZE", help="shade what a token sees (top-left cell, size in cells)")
    ap.add_argument("--path", action="append", default=[], metavar="X,Y,SIZE:GX,GY", help="draw a token's cheapest route")
    ap.add_argument("--reach", metavar="X,Y,SIZE:FEET", help="shade every position a token can reach")
    ap.add_argument("--fog", choices=["player", "gm"], help="paint the fog of war (needs --state)")
    ap.add_argument("--fog-token", action="append", default=[], metavar="ID:KIND:X,Y[,SIZE]", help="add or move a token for --fog")
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

    if a.sight or a.token:
        # Union of all visible areas: draw every polygon into one mask, then tint once.
        mask = Image.new("L", img.size, 0)
        md = ImageDraw.Draw(mask)
        for flag, values in (("--from", a.sight), ("--token", a.token)):
            for v in values:
                for poly in sight_polygons(a.map_dir, flag, v, a.state, a.range):
                    md.polygon([px(p) for p in poly], fill=255)
        tint = Image.new("RGBA", img.size, (255, 220, 60, 90))
        shade = Image.new("RGBA", img.size, (0, 0, 0, 0))
        shade.paste(tint, (0, 0), mask)
        img = Image.alpha_composite(img.convert("RGBA"), shade).convert("RGB")
        d = ImageDraw.Draw(img)
        for t in a.token:
            tx, ty, ts = [float(v) for v in t.split(",")]
            x0, y0 = px([tx, ty])
            d.rectangle([x0 + 3, y0 + 3, x0 + ts * cs - 3, y0 + ts * cs - 3], outline=(200, 30, 30), width=3)
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

    if a.reach:
        tok, feet = a.reach.split(":")
        res = run_move(a.map_dir, tok, "--reach", feet, a.state)
        tx, ty, ts = [float(v) for v in tok.split(",")]
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        for c in res["cells"]:
            for i in range(int(ts)):
                for j in range(int(ts)):
                    x0, y0 = px([c["x"] + i, c["y"] + j])
                    ld.rectangle([x0 + 1, y0 + 1, x0 + cs - 1, y0 + cs - 1], fill=(60, 170, 90, 45))
        img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
        d = ImageDraw.Draw(img)
        x0, y0 = px([tx, ty])
        d.rectangle([x0 + 3, y0 + 3, x0 + ts * cs - 3, y0 + ts * cs - 3], outline=(30, 110, 255), width=3)
        d.text((x0 + 6, y0 + 6), f"{feet} ft", fill=(30, 60, 160), font=font)

    for spec in a.path:
        tok, goal = spec.split(":")
        res = run_move(a.map_dir, tok, "--to", goal, a.state)
        tx, ty, ts = [float(v) for v in tok.split(",")]
        r = res["result"]
        x0, y0 = px([tx, ty])
        d.rectangle([x0 + 3, y0 + 3, x0 + ts * cs - 3, y0 + ts * cs - 3], outline=(30, 110, 255), width=3)
        if r is None:
            d.text((x0 + 6, y0 + 6), "no route", fill=(200, 0, 0), font=font)
            continue
        pts = [px([p[0] + ts / 2, p[1] + ts / 2]) for p in r["path"]]
        d.line(pts, fill=(30, 110, 255), width=4)
        for q in pts:
            d.ellipse([q[0] - 4, q[1] - 4, q[0] + 4, q[1] + 4], fill=(30, 110, 255))
        gx, gy = r["path"][-1]
        g0 = px([gx, gy])
        d.rectangle([g0[0] + 3, g0[1] + 3, g0[0] + ts * cs - 3, g0[1] + ts * cs - 3], outline=(30, 110, 255), width=2)
        d.text((g0[0] + 6, g0[1] + 6), f"{r['feet']:g} ft", fill=(20, 40, 140), font=font)

    if a.fog:
        if not a.state:
            sys.exit("--fog needs --state")
        res = run_fog(a.map_dir, a.state, a.fog_token)
        alpha = {"player": (255, 140), "gm": (90, 38)}[a.fog]
        fog = Image.new("L", img.size, alpha[0])
        # explored: even-odd over all rings, done by XOR-ing each ring into a mask
        ex = Image.new("1", img.size, 0)
        for ring in res["explored"]["polys"]:
            r = Image.new("1", img.size, 0)
            ImageDraw.Draw(r).polygon([px(p) for p in ring], fill=1)
            ex = Image.frombytes("1", img.size, bytes(x ^ y for x, y in zip(ex.tobytes(), r.tobytes())))
        # soften the explored edge (its outline steps in 1/8 cells), like the board does
        exl = ex.convert("L").filter(ImageFilter.GaussianBlur(2))
        fog = Image.composite(Image.new("L", img.size, alpha[1]), fog, exl)
        fd = ImageDraw.Draw(fog)
        for poly in res["visible"]:
            fd.polygon([px(p) for p in poly], fill=0)
        dark = Image.new("RGBA", img.size, (20, 17, 14, 255))
        dark.putalpha(fog)
        img = Image.alpha_composite(img.convert("RGBA"), dark).convert("RGB")
        d = ImageDraw.Draw(img)
        with open(a.state, encoding="utf-8") as f:
            toks = dict(json.load(f).get("tokens", {}))
        for t in a.fog_token:
            tid, kind, pos = t.split(":")
            n = [float(v) for v in pos.split(",")]
            toks[tid] = {"kind": kind, "x": n[0], "y": n[1], **({"size": n[2]} if len(n) > 2 else {})}
        seen = set(res["seen"])
        for tid, t in toks.items():
            if a.fog == "player" and tid not in seen:
                continue
            sz = t.get("size", 1)
            x0, y0 = px([t["x"], t["y"]])
            col = (40, 110, 255) if t.get("kind") == "pc" else (220, 40, 40)
            d.ellipse([x0 + 5, y0 + 5, x0 + sz * cs - 5, y0 + sz * cs - 5], outline=col, width=4)
            if a.fog == "gm" and tid not in seen:
                d.line([x0 + 8, y0 + 8, x0 + sz * cs - 8, y0 + sz * cs - 8], fill=col, width=2)
            d.text((x0 + 6, y0 + sz * cs - 16), tid, fill=col, font=font)

    out = a.out or os.path.join(a.map_dir, m["image"]["file"] if a.blank else "overlay.png")
    img.save(out)
    print(f"wrote {out} ({len(segs)} segments)")


if __name__ == "__main__":
    main(sys.argv[1:])
