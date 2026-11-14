#!/usr/bin/env python3
"""What the page says about a book map before it is imported: which image, how it is turned, and its printed scale
(docs/best-practices/map-importer.md section 4g).

Usage:
    python3 tools/mapimport/mapsource.py <pdf> <page> [--image N] [--osd]   propose the source settings
    python3 tools/mapimport/mapsource.py --check <map-dir> [<map-dir> ...]  check an import.json against the page

- **Turned on the page.** The image's placement (PyMuPDF's transform) shows a map printed sideways: the turn to set as
  source.rotate (clockwise) to stand it upright.
- **Turned inside the art.** A map drawn sideways inside an upright image is not seen by the transform. --osd asks
  Tesseract's orientation detection; it reads the art's own lettering, and is only proposed when it is confident (2 or
  more). Otherwise check the compass and the lettering by eye.
- **Printed scale.** "1 SQUARE = 10 FEET" (or ONE SQUARE) on the page. A map printed at 10 ft a square is imported on
  5-ft board squares: feet_per_cell 5, cell_px halved, the importer's square sizes doubled (section 4d).

--check flags a map whose source.rotate differs from the page's turn, or whose feet_per_cell differs from the printed
scale, unless its import.json records the decision: "print": {"feet": 10, "rotate": 270, "why": "..."}.
"""
import argparse
import json
import math
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.dirname(HERE))
from mapimport import extract  # noqa: E402

SCALE = re.compile(r"(?:\b1|\bONE)\s+SQUARE\s*=\s*(\d+)\s*(?:FEET|FT)", re.I)


def chosen_image(pdf, page, image=None):
    rows = [r for r in extract.list_images(pdf, page) if r["type"] == "image"]
    if image is not None:
        return next(r for r in rows if r["num"] == image)
    pages_of = {}
    for r in extract.list_images(pdf):
        pages_of.setdefault(r["obj"], set()).add(r["page"])
    own = [r for r in rows if len(pages_of.get(r["obj"], ())) == 1] or rows
    return max(own, key=lambda r: (r["width"] * r["height"], r["num"]))


def placement_turn(matrix):
    """The clockwise turn (0, 90, 180, 270) that stands a placed image upright, from its transform."""
    return int(round(math.degrees(math.atan2(matrix.b, matrix.a)) / 90.0)) * 90 % 360


def printed_feet(text):
    """The printed scales on the page ("1 SQUARE = 10 FEET"), most common first: [10] or [] or [5, 10]."""
    found = [int(x) for x in SCALE.findall(text)]
    return sorted(set(found), key=lambda f: -found.count(f))


def osd_turn(img):
    """Tesseract's orientation for the art: (clockwise turn, confidence) or None."""
    if not shutil_which("tesseract"):
        return None
    im = img.copy()
    im.thumbnail((2400, 2400))
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "m.png")
        im.save(p)
        r = subprocess.run(["tesseract", p, "-", "--psm", "0"], capture_output=True, text=True)
    out = r.stdout + r.stderr
    rot = re.search(r"Rotate:\s*(\d+)", out)
    conf = re.search(r"Orientation confidence:\s*([\d.]+)", out)
    if not rot or not conf:
        return None
    # Tesseract's Rotate is counter-clockwise; source.rotate is clockwise
    return (360 - int(rot.group(1))) % 360, float(conf.group(1))


def shutil_which(cmd):
    from shutil import which
    return which(cmd)


def info(pdf, page, image=None, osd=False):
    import pymupdf
    ch = chosen_image(pdf, page, image)
    doc = pymupdf.open(pdf)
    pg = doc[page - 1]
    placed = pg.get_image_rects(ch["obj"], transform=True)
    turn = placement_turn(placed[0][1]) if placed else None
    out = {"image": ch["num"], "size": [ch["width"], ch["height"]], "page_turn": turn,
           "printed_feet": printed_feet(pg.get_text())}
    if osd:
        img, _ = extract.extract_map(pdf, page, ch["num"])
        o = osd_turn(img)
        if o:
            out["osd"] = {"turn": o[0], "confidence": o[1]}
    return out


def check(map_dir):
    """Problems with one map's import.json against its page: [str]."""
    imp = json.load(open(os.path.join(map_dir, "import.json")))
    src = imp.get("source") or {}
    if not src.get("pdf") or not src.get("page"):
        return []
    pdf = src["pdf"] if os.path.isabs(src["pdf"]) else os.path.join(REPO, src["pdf"])
    i = info(pdf, src["page"], src.get("image"))
    pr = imp.get("print") or {}
    out = []
    have = (src.get("rotate") or 0) % 360
    if i["page_turn"] is not None and i["page_turn"] != have and pr.get("rotate") != have:
        out.append(f"the page turns the map {i['page_turn']} degrees but source.rotate is {have}: set it, or record "
                   f"print.rotate {have} with why")
    fpc = (imp.get("map") or {}).get("feet_per_cell", 5)
    if len(i["printed_feet"]) == 1 and i["printed_feet"][0] != fpc and pr.get("feet") != i["printed_feet"][0]:
        f = i["printed_feet"][0]
        out.append(f"printed at {f} ft a square but feet_per_cell is {fpc}: on {fpc}-ft board squares halve cell_px "
                   f"and double the importer's square sizes (map-importer.md 4d), then record print.feet {f}")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("args", nargs="+")
    ap.add_argument("--image", type=int)
    ap.add_argument("--osd", action="store_true")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    if a.check:
        bad = 0
        for d in a.args:
            probs = check(d)
            bad += len(probs)
            print(f"{os.path.basename(os.path.normpath(d))}: " + ("ok" if not probs else "; ".join(probs)))
        return 1 if bad else 0
    pdf, page = a.args[0], int(a.args[1])
    i = info(pdf, page, a.image, a.osd)
    print(json.dumps(i))
    src = {"pdf": pdf, "page": page, "image": i["image"]}
    if i["page_turn"]:
        src["rotate"] = i["page_turn"]
    elif i.get("osd") and i["osd"]["turn"] and i["osd"]["confidence"] >= 2:
        src["rotate"] = i["osd"]["turn"]
        print(f"the art reads turned {i['osd']['turn']} degrees (Tesseract, confidence {i['osd']['confidence']}): check the compass")
    print("source:", json.dumps(src))
    if len(i["printed_feet"]) == 1:
        f = i["printed_feet"][0]
        print(f"printed at {f} ft a square" + ("" if f == 5 else f": on 5-ft board squares set feet_per_cell 5, halve cell_px, double the square sizes, and record \"print\": {{\"feet\": {f}}}"))
    elif len(i["printed_feet"]) > 1:
        print(f"several scales on the page {i['printed_feet']}: check which is this map's")
    else:
        print("no printed scale on the page: read it from the map or the text")
    return 0


if __name__ == "__main__":
    sys.exit(main())
