#!/usr/bin/env python3
"""Make an adventure's landing page: a map of kind "landing" that shows one picture (the book's cover), where the
party waits while players join (docs/best-practices/adventure-importer.md, docs/design/maps.md section 3b).

Usage:
    python3 tools/advimport/landing.py <pack-dir> --image <file> [--id landing] [--name "..."] [--max-px 2400]
    python3 tools/advimport/landing.py <pack-dir> --pdf <pdf> --page N [--xref X | --clip x0,y0,x1,y1] [...]

The picture comes from a file (a cover the user supplies), or from a PDF page: the whole page rendered, one
image on it (--xref, as pdfart.py lists them), or a rectangle of the page in points (--clip). It is written as
<pack>/maps/<id>/cover.webp, never transparent (a soft mask is flattened onto the page colour, white), at most
--max-px on its longer side. Writes <pack>/maps/<id>/map.json and puts the map first in pack.json's maps.
The campaign starts on it when adventure.json names it (`"landing": "<id>"`).
"""
import argparse
import io
import json
import os

from PIL import Image


def from_pdf(pdf, page_no, xref=None, clip=None, dpi=200):
    import pymupdf
    doc = pymupdf.open(pdf)
    page = doc[page_no - 1]
    if xref:
        smask = {i[0]: i[1] for i in page.get_images()}.get(xref) or 0
        pm = pymupdf.Pixmap(doc, xref)
        if pm.colorspace and pm.colorspace.n > 3:
            pm = pymupdf.Pixmap(pymupdf.csRGB, pm)
        img = Image.frombytes("RGB" if pm.n == 3 else "L", (pm.w, pm.h), pm.samples).convert("RGB")
        if smask:
            m = pymupdf.Pixmap(doc, smask)
            mask = Image.frombytes("L", (m.w, m.h), m.samples).resize(img.size)
            img = Image.composite(img, Image.new("RGB", img.size, "white"), mask)
        return img
    rect = pymupdf.Rect(*clip) if clip else None
    pm = page.get_pixmap(dpi=dpi, clip=rect, alpha=False)
    return Image.open(io.BytesIO(pm.tobytes("png"))).convert("RGB")


def opaque(img):
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, "white")
        bg.paste(img, mask=img.split()[-1])
        return bg
    return img.convert("RGB")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pack")
    ap.add_argument("--image")
    ap.add_argument("--pdf")
    ap.add_argument("--page", type=int)
    ap.add_argument("--xref", type=int)
    ap.add_argument("--clip")
    ap.add_argument("--id", default="landing")
    ap.add_argument("--name")
    ap.add_argument("--max-px", type=int, default=2400)
    a = ap.parse_args(argv)
    if bool(a.image) == bool(a.pdf):
        ap.error("give --image or --pdf (with --page)")
    if a.pdf and not a.page:
        ap.error("--pdf needs --page")
    img = opaque(Image.open(a.image)) if a.image else from_pdf(
        a.pdf, a.page, a.xref, [float(v) for v in a.clip.split(",")] if a.clip else None)
    k = min(1.0, a.max_px / max(img.size))
    if k < 1:
        img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
    pack_file = os.path.join(a.pack, "pack.json")
    pack = json.load(open(pack_file))
    out = os.path.join(a.pack, "maps", a.id)
    os.makedirs(out, exist_ok=True)
    img.save(os.path.join(out, "cover.webp"), quality=90)
    name = a.name or (pack.get("title", a.id).replace(" (private)", ""))
    m = {"$schema": "../../../../schemas/map.schema.json", "id": a.id, "name": name, "kind": "landing",
         "image": {"file": "cover.webp", "w": img.width, "h": img.height}}
    json.dump(m, open(os.path.join(out, "map.json"), "w"), indent=2)
    maps = [x for x in pack.get("maps", []) if x != a.id]
    pack["maps"] = [a.id] + maps
    json.dump(pack, open(pack_file, "w"), indent=2)
    print(f"wrote {out}/map.json and cover.webp ({img.width}x{img.height}); {a.id} is first in pack.json")


if __name__ == "__main__":
    main()
