#!/usr/bin/env python3
"""Keep a pack's art sources small: every PNG under <pack>/art/book/ becomes a lossless WebP (the same pixels, about
half the size), and art/art.json and pipeline.json are pointed at the new files.

Usage: python3 tools/advimport/packimages.py <pack-dir> [--check] [--jobs N]

The PNG is removed only after the WebP is read back and compared pixel for pixel. --check lists what would change and
exits 1 if anything would. Sources only: map images and the board's tokens are left as they are.
(docs/best-practices/adventure-importer.md, section 8.)
"""
import argparse
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

from PIL import Image, ImageChops


def convert(png):
    """PNG -> lossless WebP beside it; returns (png, webp, before, after) or raises when the pixels differ."""
    webp = png[:-4] + ".webp"
    im = Image.open(png)
    im.load()
    mode = "RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB"
    im = im.convert(mode)
    im.save(webp, lossless=True, method=4, exact=True)
    back = Image.open(webp).convert(mode)
    if back.size != im.size or ImageChops.difference(back, im).getbbox() is not None:
        os.remove(webp)
        raise ValueError(f"{png}: the WebP does not match the PNG; kept the PNG")
    before, after = os.path.getsize(png), os.path.getsize(webp)
    os.remove(png)
    return png, webp, before, after


def repoint(pack, renames):
    """art/art.json `src` and pipeline.json globs follow the new names."""
    art = os.path.join(pack, "art", "art.json")
    if os.path.exists(art):
        doc = json.load(open(art))
        changed = False
        for spec in doc.values():
            if isinstance(spec, dict) and isinstance(spec.get("src"), str) and spec["src"] in renames:
                spec["src"] = renames[spec["src"]]
                changed = True
        if changed:
            json.dump(doc, open(art, "w"), indent=1)
    pipe = os.path.join(pack, "pipeline.json")
    if os.path.exists(pipe):
        text = open(pipe).read()
        new = text.replace("art/book/*.png", "art/book/*")
        if new != text:
            open(pipe, "w").write(new)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("pack")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 2)
    a = ap.parse_args(argv)
    book = os.path.join(a.pack, "art", "book")
    pngs = sorted(os.path.join(book, f) for f in os.listdir(book) if f.lower().endswith(".png")) if os.path.isdir(book) else []
    if a.check:
        for p in pngs:
            print("would convert", p)
        print(f"{len(pngs)} PNG source(s) to convert")
        return 1 if pngs else 0
    done, before, after = [], 0, 0
    with ProcessPoolExecutor(max_workers=max(1, a.jobs)) as ex:
        for png, webp, b, w in ex.map(convert, pngs):
            done.append((png, webp))
            before += b
            after += w
    rel = lambda p: os.path.relpath(p, os.path.join(a.pack, "art")).replace(os.sep, "/")
    repoint(a.pack, {rel(p): rel(w) for p, w in done})
    print(f"{len(done)} source(s) to lossless WebP: {before / 1048576:.1f} MB -> {after / 1048576:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
