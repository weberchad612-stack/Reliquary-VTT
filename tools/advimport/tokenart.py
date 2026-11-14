#!/usr/bin/env python3
"""Make each creature's token image and full portrait from chosen source art.

Usage:
    python3 tools/advimport/tokenart.py <pack>/art/art.json [--sheet check.png]

art.json: {"<key>": {"src": "<file relative to art.json>", "crop": "top" | "center" | [x, y, size],
                     "source": "...", "note": "..."}, ...}
For each key writes, next to art.json:
  <key>.webp        the whole picture, opaque (never transparent), at most 1600 px on its long side: the Quick-View
  <key>-token.webp  a square crop (512 px) for the round token: "top" takes a square from the top of the figure
                    (a standing humanoid's head and shoulders), "center" a square around the figure's middle (a
                    beast seen side on), [x, y, size] an exact square in source pixels
and records w, h and the crop actually used. --sheet draws every token as the board's circle beside its portrait,
for Claude to look at before loading. The figure is found as the area that differs from the corner colour.
"""
import argparse
import json
import os

import numpy as np
from PIL import Image, ImageDraw

TOKEN_PX = 512
FULL_MAX = 1600


def figure_box(img):
    a = np.asarray(img.convert("RGB")).astype(int)
    corner = np.median(np.concatenate([a[:8, :8].reshape(-1, 3), a[:8, -8:].reshape(-1, 3), a[-8:, :8].reshape(-1, 3), a[-8:, -8:].reshape(-1, 3)]), axis=0)
    diff = np.abs(a - corner).sum(axis=2) > 40
    ys, xs = np.nonzero(diff)
    if not len(xs):
        return 0, 0, img.width, img.height
    return int(np.percentile(xs, 1)), int(np.percentile(ys, 1)), int(np.percentile(xs, 99)), int(np.percentile(ys, 99))


def square(img, crop):
    x0, y0, x1, y1 = figure_box(img)
    w, h = x1 - x0, y1 - y0
    if isinstance(crop, list):
        return crop
    if crop == "top":
        s = int(min(w, h) * (0.62 if h > w * 1.2 else 0.9))
        cx = (x0 + x1) // 2
        return [cx - s // 2, max(0, y0 - s // 20), s]
    s = int(max(min(w, h), max(w, h) * 0.75))
    return [(x0 + x1) // 2 - s // 2, (y0 + y1) // 2 - s // 2, s]


def cut(img, sq, bg):
    x, y, s = sq
    out = Image.new("RGB", (s, s), bg)
    out.paste(img.crop((max(0, x), max(0, y), min(img.width, x + s), min(img.height, y + s))), (max(0, -x), max(0, -y)))
    return out.resize((TOKEN_PX, TOKEN_PX), Image.LANCZOS)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("manifest")
    ap.add_argument("--sheet")
    a = ap.parse_args(argv)
    base = os.path.dirname(os.path.abspath(a.manifest))
    art = json.load(open(a.manifest))
    tiles = []
    for key, spec in art.items():
        img = Image.open(os.path.join(base, spec["src"])).convert("RGB")
        bg = tuple(int(v) for v in np.median(np.asarray(img)[:6, :6].reshape(-1, 3), axis=0))
        sq = square(img, spec.get("crop", "top"))
        tok = cut(img, sq, bg)
        tok.save(os.path.join(base, f"{key}-token.webp"), "WEBP", quality=90)
        full = img.copy()
        full.thumbnail((FULL_MAX, FULL_MAX), Image.LANCZOS)
        full.save(os.path.join(base, f"{key}.webp"), "WEBP", quality=88)
        spec.update(full=f"{key}.webp", token=f"{key}-token.webp", w=full.width, h=full.height, crop_used=sq)
        tiles.append((key, tok, full))
    json.dump(art, open(a.manifest, "w"), indent=1)
    if a.sheet:
        T = 140
        sheet = Image.new("RGB", (len(tiles) * (T * 2 + 10), T + 20), (40, 42, 48))
        d = ImageDraw.Draw(sheet)
        for i, (key, tok, full) in enumerate(tiles):
            X = i * (T * 2 + 10)
            t = tok.resize((T, T))
            m = Image.new("L", (T, T), 0)
            ImageDraw.Draw(m).ellipse((2, 2, T - 3, T - 3), fill=255)
            sheet.paste(t, (X, 0), m)
            f = full.copy(); f.thumbnail((T, T)); sheet.paste(f, (X + T + 4, 0))
            d.text((X + 2, T + 4), key[:26], fill=(255, 255, 255))
        sheet.save(a.sheet)
    print(f"{len(tiles)} creatures")


if __name__ == "__main__":
    main()
