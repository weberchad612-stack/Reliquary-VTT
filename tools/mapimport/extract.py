"""Step 1 of the map importer: pull a map image out of a PDF page.

Uses poppler's `pdfimages`. A page often carries several images (backgrounds, insets, masks); the
map is chosen by its number in `pdfimages -list` or, by default, as the largest image on the page
that is not reused on other pages (a page background is one PDF object shared by every page).
A soft mask (transparency) that belongs to the chosen image is composited onto white.
"""
import os
import re
import subprocess
import tempfile

import numpy as np
from PIL import Image


def list_images(pdf, page=None):
    """Images on one page (or every page): [{page, num, width, height, type, obj}] in pdfimages order."""
    args = ["pdfimages", "-list"] + (["-f", str(page), "-l", str(page)] if page else []) + [pdf]
    out = subprocess.run(args, capture_output=True, text=True, check=True).stdout
    rows = []
    for line in out.splitlines()[2:]:
        f = line.split()
        if len(f) < 11 or not f[0].isdigit():
            continue
        rows.append({"page": int(f[0]), "num": int(f[1]), "type": f[2], "width": int(f[3]),
                     "height": int(f[4]), "obj": int(f[10])})
    return rows


def extract_map(pdf, page, image=None):
    """Return the map image (RGB PIL image) from a PDF page.

    image: the image's number from `pdfimages -list`, or None for the largest image on the page.
    """
    rows = list_images(pdf, page)
    imgs = [r for r in rows if r["type"] == "image"]
    if not imgs:
        raise ValueError(f"no images on page {page} of {pdf}")
    if image is None:
        pages_of = {}
        for r in list_images(pdf):
            pages_of.setdefault(r["obj"], set()).add(r["page"])
        own = [r for r in imgs if len(pages_of.get(r["obj"], ())) == 1] or imgs
        chosen = max(own, key=lambda r: (r["width"] * r["height"], r["num"]))
    else:
        chosen = next((r for r in imgs if r["num"] == image), None)
    if chosen is None:
        raise ValueError(f"page {page} has no image number {image}")
    smask = next((r for r in rows if r["num"] == chosen["num"] + 1 and r["type"] == "smask"), None)
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(["pdfimages", "-png", "-f", str(page), "-l", str(page), pdf, os.path.join(d, "i")],
                       check=True, capture_output=True)
        # pdfimages numbers its files in the same order as -list: i-000.png is the page's first entry
        first = rows[0]["num"]
        path = lambda n: os.path.join(d, f"i-{n - first:03d}.png")
        img = Image.open(path(chosen["num"])).convert("RGB")
        if smask:
            a = np.asarray(Image.open(path(smask["num"])).convert("L"), dtype=float)[..., None] / 255.0
            rgb = np.asarray(img, dtype=float)
            img = Image.fromarray((rgb * a + 255.0 * (1 - a)).round().astype(np.uint8))
        img.load()
        return img, chosen
