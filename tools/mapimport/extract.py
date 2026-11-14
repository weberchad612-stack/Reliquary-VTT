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


def crop_scale(img, crop_px=None, scale=None, rotate=None):
    """Cut one map out of a page image holding several (crop_px: [x0, y0, x1, y1] in source pixels), then
    resize (scale: a factor, such as 1/3 for a 300 ppi print map). Cropping happens first, so crop_px is always
    in the PDF image's own pixels."""
    if crop_px:
        x0, y0, x1, y1 = [int(round(v)) for v in crop_px]
        img = img.crop((x0, y0, x1, y1))
    if rotate:   # clockwise quarter turns, after cropping: a map printed sideways comes out with north up
        turns = {90: Image.ROTATE_270, 180: Image.ROTATE_180, 270: Image.ROTATE_90}
        if rotate not in turns:
            raise ValueError(f"source.rotate must be 90, 180 or 270 (clockwise), not {rotate}")
        img = img.transpose(turns[rotate])
    if scale and scale != 1:
        w, h = img.size
        img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    return img


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
            # Composite onto white with PIL (integer maths): a float copy of a 300 ppi print map runs to gigabytes.
            a = Image.open(path(smask["num"])).convert("L")
            if a.size != img.size:
                a = a.resize(img.size, Image.LANCZOS)
            img = Image.composite(img, Image.new("RGB", img.size, (255, 255, 255)), a)
        img.load()
        return img, chosen
