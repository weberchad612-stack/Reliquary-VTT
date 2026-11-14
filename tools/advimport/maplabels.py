#!/usr/bin/env python3
"""Area keys printed on a book map, read from the page's text layer, as points in the map's squares: the seeds for
the room table (tools/advimport/roomtable.py; docs/best-practices/adventure-importer.md section 12).

Usage:
    python3 tools/advimport/maplabels.py <pack-dir> <map-id> [--keys REGEX] [--out spec.json]

The map's import.json says where its image comes from (source: pdf, page, image, crop_px, scale, rotate) and its
map.json gives the grid. Each word on that page matching --keys (default: a book key such as B4 or E12a) and lying
on the map image is taken through the same steps as the image (the image's placement on the page, then crop_px,
scale and rotate) into squares. A word that lands outside the map (a key of another map on the same sheet) is
dropped. Prints the spec for roomtable.py: {"<map-id>": {"<key>": {"at": [x, y], "source": "label on p N"}}}.
A key printed twice keeps the first; one that sits on a street or in a lot is still a point: roomtable.py decides
the shape.
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from mapimport import extract  # noqa: E402

KEY = r"^[A-Z]{1,2}\d{1,2}[a-z]?$"


def to_image_px(pt, rect, matrix, w, h):
    """A page point to the image's own pixels. PyMuPDF's transform maps the image's unit square onto the page
    (y down in both), so its inverse brings a page point back into [0, 1] x [0, 1]."""
    import pymupdf
    inv = ~matrix
    p = pymupdf.Point(pt) * inv
    return p.x * w, p.y * h


def through_source(px, py, src, size):
    """The image's pixel through crop_px, scale and rotate (clockwise), as extract.crop_scale does to the image.
    size: the image's size before those steps."""
    w, h = size
    if src.get("crop_px"):
        x0, y0, x1, y1 = src["crop_px"]
        px, py, w, h = px - x0, py - y0, x1 - x0, y1 - y0
    if src.get("scale"):
        k = src["scale"]
        px, py, w, h = px * k, py * k, w * k, h * k
    r = (src.get("rotate") or 0) % 360
    if r == 90:
        px, py = h - py, px
    elif r == 180:
        px, py = w - px, h - py
    elif r == 270:
        px, py = py, w - px
    return px, py


def labels(pack, map_id, keys=KEY):
    import pymupdf
    d = os.path.join(pack, "maps", map_id)
    imp = json.load(open(os.path.join(d, "import.json")))
    m = json.load(open(os.path.join(d, "map.json")))
    src, g = imp["source"], m["grid"]
    pdf = src["pdf"] if os.path.isabs(src["pdf"]) else os.path.join(os.path.dirname(os.path.dirname(HERE)), src["pdf"])
    rows = [r for r in extract.list_images(pdf, src["page"]) if r["type"] == "image"]
    if src.get("image") is not None:
        chosen = next(r for r in rows if r["num"] == src["image"])
    else:
        everywhere = extract.list_images(pdf)
        pages_of = {}
        for r in everywhere:
            pages_of.setdefault(r["obj"], set()).add(r["page"])
        own = [r for r in rows if len(pages_of.get(r["obj"], ())) == 1] or rows
        chosen = max(own, key=lambda r: (r["width"] * r["height"], r["num"]))
    doc = pymupdf.open(pdf)
    page = doc[src["page"] - 1]
    placed = page.get_image_rects(chosen["obj"], transform=True)
    if not placed:
        raise SystemExit(f"{map_id}: the map image (object {chosen['obj']}) is not placed on page {src['page']}")
    rect, matrix = placed[0]
    out, pat = {}, re.compile(keys)
    for x0, y0, x1, y1, word, *_ in page.get_text("words"):
        word = word.strip(".,:;()")
        if not pat.match(word) or word in out:
            continue
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if not rect.contains((cx, cy)):
            continue
        px, py = to_image_px((cx, cy), rect, matrix, chosen["width"], chosen["height"])
        px, py = through_source(px, py, src, (chosen["width"], chosen["height"]))
        x, y = (px - g["origin_px"][0]) / g["cell_px"], (py - g["origin_px"][1]) / g["cell_px"]
        if 0 <= x < g["cols"] and 0 <= y < g["rows"]:
            out[word] = {"at": [round(x, 2), round(y, 2)], "source": f"label on p {src['page']}"}
    return {map_id: out}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pack")
    ap.add_argument("map_id")
    ap.add_argument("--keys", default=KEY)
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    spec = labels(a.pack, a.map_id, a.keys)
    text = json.dumps(spec, indent=1)
    if a.out:
        open(a.out, "w").write(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
