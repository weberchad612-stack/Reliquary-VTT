#!/usr/bin/env python3
"""The review sheet (#21): one image per map for Claude to check the walls against the book, room by room.

Usage:
    python3 tools/advimport/reviewsheet.py <pack-dir> --book <book.pdf> --crops <roomcrops.json>
        --levels A=level-a,B=level-b [--maps level-a] [--out <dir>] [--px 36]

Each room in the map's rooms.json gets a pair of tiles: on the left the book's own crop of that room (the map art the
book prints beside the room's text, without its pawns), on the right our map over the same squares with:
  walls coloured by type (solid white, door orange, secret yellow, veil violet, window cyan, terrain brown,
  others grey), thick walls drawn at their width; the room's squares tinted blue; walls the importer suggests
  checking (import-report.json line_proposals: near misses and gaps) dashed magenta; and what changed since the
  last build (.cache/walls-prev.json): new or moved walls green, removed ones red.
A room with no single-room crop gets our tile only. Writes <out>/<map>.png (default <pack>/review/), private with the
pack; the user sees it only on request (the user's choice, 2026-11-13).
"""
import argparse
import json
import math
import os

import pymupdf
from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None
COL = {"solid": (235, 230, 220), "door": (229, 140, 60), "secret": (227, 179, 48), "veil": (150, 110, 255),
       "window": (70, 198, 224), "terrain": (170, 120, 70)}


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def crop_footprint(rec, level):
    (a, b, tx), (c, d, ty) = rec["transform"]
    w, h = rec["crop"]["px"]
    g = level["grid"]
    pts = [(a * x + b * y + tx, c * x + d * y + ty) for x, y in ((0, 0), (w, 0), (0, h), (w, h))]
    pts = [((x - g["origin_px"][0]) / g["cell_px"], (y - g["origin_px"][1]) / g["cell_px"]) for x, y in pts]
    return [min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)]


def book_image(doc, xref):
    pm = pymupdf.Pixmap(doc, xref)
    if pm.colorspace and pm.colorspace.n > 3:
        pm = pymupdf.Pixmap(pymupdf.csRGB, pm)
    if pm.alpha:
        pm = pymupdf.Pixmap(pm, 0)
    return Image.frombytes("RGB" if pm.n >= 3 else "L", (pm.w, pm.h), pm.samples).convert("RGB")


def seg_key(s):
    return (s["t"], tuple(round(v, 2) for v in s["a"]), tuple(round(v, 2) for v in s["b"]))


def dashed(dr, a, b, fill, width, dash=6):
    L = math.dist(a, b)
    n = max(1, int(L // dash))
    for i in range(0, n, 2):
        p = (a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n)
        q = (a[0] + (b[0] - a[0]) * min(n, i + 1) / n, a[1] + (b[1] - a[1]) * min(n, i + 1) / n)
        dr.line([p, q], fill=fill, width=width)


def our_tile(img, grid, box, segs, prev, rects, props, px):
    """Our map over the squares in box [x0, y0, x1, y1], at px per square, with the overlay."""
    x0, y0, x1, y1 = box
    cs, (ox, oy) = grid["cell_px"], grid["origin_px"]
    region = img.crop((int(ox + x0 * cs), int(oy + y0 * cs), int(ox + x1 * cs), int(oy + y1 * cs)))
    W, H = max(1, int((x1 - x0) * px)), max(1, int((y1 - y0) * px))
    t = region.resize((W, H)).convert("RGBA")
    over = Image.new("RGBA", t.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(over)
    P = lambda p: ((p[0] - x0) * px, (p[1] - y0) * px)
    for x, y, w, h in rects:
        dr.rectangle([P((x, y)), P((x + w, y + h))], fill=(60, 120, 255, 46))
    now = {seg_key(s) for s in segs}
    for s in segs:
        width = max(2, int((s.get("w") or 0.05) * px)) if s.get("w") else 2
        col = COL.get(s["t"], (150, 150, 150))
        if prev is not None and seg_key(s) not in prev:
            dr.line([P(s["a"]), P(s["b"])], fill=(60, 220, 90, 255), width=width + 4)
        dr.line([P(s["a"]), P(s["b"])], fill=col + (255,), width=width)
    for k in (prev or set()) - now:
        dr.line([P(k[1]), P(k[2])], fill=(235, 60, 60, 255), width=3)
    for p in props:
        a, b = ((p["lo"], p["c"]), (p["hi"], p["c"])) if p["axis"] == "h" else ((p["c"], p["lo"]), (p["c"], p["hi"]))
        dashed(dr, P(a), P(b), (255, 60, 220, 255), 3)
    return Image.alpha_composite(t, over).convert("RGB")


def sheet_for(pack, map_id, doc, crops, level_of, px, out_dir):
    d = os.path.join(pack, "maps", map_id)
    m, segs = load(os.path.join(d, "map.json")), load(os.path.join(d, "walls.json"))["segs"]
    rooms = load(os.path.join(d, "rooms.json")).get("rooms", {})
    rep = load(os.path.join(d, "import-report.json")) if os.path.exists(os.path.join(d, "import-report.json")) else {}
    lp = rep.get("line_proposals") or {}
    props = lp.get("near_misses", []) + lp.get("gaps", [])
    pf = os.path.join(d, ".cache", "walls-prev.json")
    prev = {seg_key(s) for s in load(pf)["segs"]} if os.path.exists(pf) else None
    img = Image.open(os.path.join(d, m["image"]["file"])).convert("RGB")
    g = m["grid"]
    by_key = {}
    for rec in crops["pages"]:
        keys = {c[0] for c in rec.get("captions") or []}
        if len(keys) == 1 and level_of.get(rec["level"]) == map_id:
            by_key.setdefault(next(iter(keys)), rec)
    lv = {l["id"]: l for l in crops["levels"]}
    font = ImageFont.load_default()
    rows = []
    for key, r in rooms.items():
        rec = by_key.get(key)
        if rec:
            box = crop_footprint(rec, lv[rec["level"]])
        else:
            xs = [x for x, y, w, h in r["rects"]] + [x + w for x, y, w, h in r["rects"]]
            ys = [y for x, y, w, h in r["rects"]] + [y + h for x, y, w, h in r["rects"]]
            box = [min(xs), min(ys), max(xs), max(ys)]
        box = [max(0, box[0] - 0.5), max(0, box[1] - 0.5), min(g["cols"], box[2] + 0.5), min(g["rows"], box[3] + 0.5)]
        inside = lambda p: box[0] - 1 <= (p["lo"] + p["hi"]) / 2 if p["axis"] == "h" else True
        near = [p for p in props if (box[1] <= p["c"] <= box[3] and p["lo"] < box[2] and p["hi"] > box[0]) if p["axis"] == "h"] + \
               [p for p in props if (box[0] <= p["c"] <= box[2] and p["lo"] < box[3] and p["hi"] > box[1]) if p["axis"] == "v"]
        ours = our_tile(img, g, box, segs, prev, r["rects"], near, px)
        book = None
        if rec:
            b = book_image(doc, rec["crop"]["xref"])
            k = ours.height / b.height
            book = b.resize((max(1, int(b.width * k)), ours.height))
        rows.append((key, r.get("title", ""), book, ours, len(near)))
    W = max((b.width if b else 0) + o.width + 30 for _, _, b, o, _ in rows) + 20
    H = sum(o.height + 26 for _, _, _, o, _ in rows) + 10
    sheet = Image.new("RGB", (W, H), (24, 26, 31))
    dr = ImageDraw.Draw(sheet)
    y = 6
    for key, title, book, ours, n in rows:
        dr.text((10, y), f"{key}  {title}" + (f"   ({n} wall(s) to check)" if n else ""), fill=(235, 230, 220), font=font)
        y += 18
        x = 10
        if book:
            sheet.paste(book, (x, y)); x += book.width + 10
        else:
            dr.text((x, y + 4), "(no single-room crop)", fill=(140, 140, 140), font=font); x += 140
        sheet.paste(ours, (x, y))
        y += ours.height + 8
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"{map_id}.png")
    sheet.save(out)
    return out, len(rows), sum(r[4] for r in rows)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pack")
    ap.add_argument("--book", required=True)
    ap.add_argument("--crops", required=True)
    ap.add_argument("--levels", required=True)
    ap.add_argument("--maps")
    ap.add_argument("--out")
    ap.add_argument("--px", type=int, default=36)
    a = ap.parse_args(argv)
    level_of = dict(p.split("=") for p in a.levels.split(","))
    maps = a.maps.split(",") if a.maps else list(dict.fromkeys(level_of.values()))
    doc, crops = pymupdf.open(a.book), load(a.crops)
    for m in maps:
        out, n, k = sheet_for(a.pack, m, doc, crops, level_of, a.px, a.out or os.path.join(a.pack, "review"))
        print(f"wrote {out}: {n} rooms, {k} wall(s) to check")


if __name__ == "__main__":
    main()
