#!/usr/bin/env python3
"""Pull candidate art out of an adventure's PDFs, each image with the words printed nearest to it.

Usage:
    python3 tools/advimport/pdfart.py <pdf> --out <folder> [--pages 64-89] [--min-px 200] [--labels below|any]
        [--background "#24272d"] [--skip-repeated]

For every image at least --min-px on its shorter side, writes <folder>/<pdf-stem>-p<page>-x<xref>.png and one line
in <folder>/index.json: {file, page, xref, px: [w, h], bbox, label}. A soft mask (transparency) is composited
onto --background, never left transparent: the board shows token art and portraits on an opaque ground.
label: the text line closest below the image (token sheets print the creature's name under each pawn), or with
--labels any, the nearest heading-like line in any direction (an illustration on a stat block page).
Images used on several pages (page furniture) are skipped with --skip-repeated. The tool only proposes: Claude
looks at every candidate before it becomes a creature's art.
"""
import argparse
import json
import os
import re
from collections import Counter

import pymupdf
from PIL import Image


def parse_pages(s, n):
    if not s:
        return list(range(1, n + 1))
    out = []
    for part in s.split(","):
        a, _, b = part.partition("-")
        out += list(range(int(a), int(b or a) + 1))
    return out


def image_rgba(doc, xref, smask):
    pm = pymupdf.Pixmap(doc, xref)
    if pm.colorspace and pm.colorspace.n > 3:
        pm = pymupdf.Pixmap(pymupdf.csRGB, pm)
    img = Image.frombytes("RGBA" if pm.alpha else ("RGB" if pm.n == 3 else "L"), (pm.w, pm.h), pm.samples).convert("RGBA")
    if smask:
        m = pymupdf.Pixmap(doc, smask)
        a = Image.frombytes("L", (m.w, m.h), m.samples)
        if a.size != img.size:
            a = a.resize(img.size, Image.LANCZOS)
        img.putalpha(a)
    return img


def lines_of(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = " ".join(s["text"] for s in l["spans"]).strip()
            if t and not t.startswith("©"):
                out.append((t, l["bbox"]))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("--out", required=True)
    ap.add_argument("--pages")
    ap.add_argument("--min-px", type=int, default=200)
    ap.add_argument("--labels", choices=("below", "any"), default="below")
    ap.add_argument("--background", default="#24272d")
    ap.add_argument("--skip-repeated", action="store_true")
    a = ap.parse_args(argv)
    doc = pymupdf.open(a.pdf)
    stem = re.sub(r"[^a-z0-9]+", "-", os.path.splitext(os.path.basename(a.pdf))[0].lower()).strip("-")
    os.makedirs(a.out, exist_ok=True)
    seen = Counter()
    if a.skip_repeated:
        for p in doc:
            for x in {i[0] for i in p.get_images()}:
                seen[x] += 1
    bg = tuple(int(a.background[i:i + 2], 16) for i in (1, 3, 5))
    index = []
    done = set()
    for pno in parse_pages(a.pages, len(doc)):
        page = doc[pno - 1]
        smasks = {i[0]: i[1] for i in page.get_images()}
        lines = lines_of(page)
        for info in page.get_image_info(xrefs=True):
            x = info["xref"]
            if not x or x in done or min(info["width"], info["height"]) < a.min_px or (a.skip_repeated and seen[x] > 1):
                continue
            done.add(x)
            bb = info["bbox"]
            cx = (bb[0] + bb[2]) / 2
            if a.labels == "below":
                # the name printed across the bottom of the image or just below it, joined if it wraps
                near = sorted({(round(b[1]), t) for t, b in lines
                               if bb[3] - 70 <= b[1] <= bb[3] + 40 and b[0] - 25 <= cx <= b[2] + 25
                               and not re.fullmatch(r"\[.*\]|BB|[0-9]+", t)})
                label = " ".join(t for _, t in near) or None
            else:
                cands = [(abs((b[1] + b[3]) / 2 - (bb[1] + bb[3]) / 2) + abs((b[0] + b[2]) / 2 - cx) / 3, t)
                         for t, b in lines if t.isupper() and len(t) > 3]
                label = min(cands)[1] if cands else None
            img = image_rgba(doc, x, smasks.get(x) or 0)
            flat = Image.new("RGB", img.size, bg)
            flat.paste(img, mask=img.split()[3])
            f = f"{stem}-p{pno}-x{x}.png"
            flat.save(os.path.join(a.out, f))
            index.append({"file": f, "page": pno, "xref": x, "px": list(img.size), "bbox": [round(v, 1) for v in bb], "label": label})
    path = os.path.join(a.out, "index.json")
    old = json.load(open(path)) if os.path.exists(path) else []
    keep = [r for r in old if r["file"] not in {i["file"] for i in index}]
    json.dump(keep + index, open(path, "w"), indent=1)
    print(f"{len(index)} images")


if __name__ == "__main__":
    main()
