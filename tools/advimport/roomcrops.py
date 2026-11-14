#!/usr/bin/env python3
"""Find where an adventure's per-room map crops sit on the full level maps.

Many adventures print, beside each keyed area, a crop of the level map with the room's label disc and
pawn markers laid on top as separate images. Registering each crop to the full level map (ORB features +
RANSAC similarity) turns those overlays into grid cells: where each room label is, and where the book
places each creature at the start of the encounter. The marker images themselves are the creatures'
portraits, a first source of token art.

Usage:
    python3 tools/advimport/roomcrops.py <book.pdf> --level ID=<maps.pdf>:<page>[:x0,y0,x1,y1] ...
        [--pages 4-35] [--out extracted/<book>/roomcrops.json] [--images extracted/<book>/markers]

Writes one record per page that has a map crop:
  {page, crop: {xref, bbox}, level, inliers, err_px, transform, label: {text, cell}|null,
   markers: [{xref, cell, bbox}]}
Cells are in the level map's grid (auto-calibrated). The tool only proposes: check every page's
registration (inliers, err_px) and look at the check images before trusting a position.
"""
import argparse
import json
import os
import re
import sys
from collections import Counter

import cv2
import numpy as np
import pymupdf
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from mapimport import extract, grid as gridmod  # noqa: E402

WORK_SCALE = 1 / 3  # register against a smaller copy: enough detail, a fraction of the memory


def parse_pages(s, n):
    if not s:
        return list(range(1, n + 1))
    out = []
    for part in s.split(","):
        a, _, b = part.partition("-")
        out += list(range(int(a), int(b or a) + 1))
    return out


def load_level(spec):
    lid, _, rest = spec.partition("=")
    parts = rest.split(":")
    pdf, page = parts[0], int(parts[1])
    crop = [float(v) for v in parts[2].split(",")] if len(parts) > 2 else None
    img, _ = extract.extract_map(pdf, page)
    if crop:
        img = extract.crop_scale(img, crop)
    small = extract.crop_scale(img, None, WORK_SCALE)
    del img
    g = gridmod.calibrate(small)
    # calibrate() may start the grid a cell outside the image; cell 0 must be the first full cell, as in map.json
    for k in (0, 1):
        while g["origin_px"][k] < -g["cell_px"] / 2:
            g["origin_px"][k] += g["cell_px"]
            g["cols" if k == 0 else "rows"] -= 1
    gray = cv2.cvtColor(np.asarray(small), cv2.COLOR_RGB2GRAY)
    return {"id": lid, "gray": gray, "grid": g, "crop": crop}


def pix_of(doc, xref):
    pm = pymupdf.Pixmap(doc, xref)
    if pm.alpha or pm.n > 3:
        pm = pymupdf.Pixmap(pymupdf.csRGB, pm) if pm.n - pm.alpha > 3 else pm
    if pm.alpha:
        pm = pymupdf.Pixmap(pm, 0)
    img = np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.h, pm.w, pm.n)
    if pm.n == 1:
        img = np.repeat(img, 3, axis=2)
    return img[..., :3].copy()


def register(crop_gray, level, orb, bf):
    k1, d1 = orb.detectAndCompute(crop_gray, None)
    k2, d2 = level.get("_kp") or (None, None)
    if k2 is None:
        k2, d2 = orb.detectAndCompute(level["gray"], None)
        level["_kp"] = (k2, d2)
    if d1 is None or len(k1) < 10:
        return None
    matches = bf.knnMatch(d1, d2, k=2)
    good = [m for m, n in (p for p in matches if len(p) == 2) if m.distance < 0.75 * n.distance]
    if len(good) < 8:
        return None
    src = np.float32([k1[m.queryIdx].pt for m in good])
    dst = np.float32([k2[m.trainIdx].pt for m in good])
    M, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=3.0, maxIters=5000)
    if M is None:
        return None
    inl = inl.ravel().astype(bool)
    proj = (np.c_[src[inl], np.ones(inl.sum())] @ M.T)
    err = float(np.median(np.linalg.norm(proj - dst[inl], axis=1))) if inl.any() else 99.0
    return {"M": M, "inliers": int(inl.sum()), "err_px": round(err, 2)}


def to_cell(pt_page, bbox, crop_wh, reg, g):
    """Page point (pt) -> crop pixel -> level pixel -> grid cell."""
    x0, y0, x1, y1 = bbox
    cw, ch = crop_wh
    px = (pt_page[0] - x0) / (x1 - x0) * cw
    py = (pt_page[1] - y0) / (y1 - y0) * ch
    lx, ly = reg["M"] @ np.array([px, py, 1.0])
    return [round((lx - g["origin_px"][0]) / g["cell_px"], 2), round((ly - g["origin_px"][1]) / g["cell_px"], 2)]


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("book")
    ap.add_argument("--level", action="append", required=True)
    ap.add_argument("--pages")
    ap.add_argument("--out", required=True)
    ap.add_argument("--images", help="folder to save each distinct marker image (token art candidates)")
    ap.add_argument("--min-crop", type=int, default=500, help="smallest crop image width, in pixels")
    a = ap.parse_args(argv)

    levels = [load_level(s) for s in a.level]
    doc = pymupdf.open(a.book)
    pages = parse_pages(a.pages, len(doc))
    # Images used on many pages are page furniture (borders, tabs, label discs), not crops or markers.
    seen = Counter()
    for i in range(len(doc)):
        for x in {info["xref"] for info in doc[i].get_image_info(xrefs=True) if info["xref"]}:
            seen[x] += 1
    furniture = {x for x, c in seen.items() if c >= 4}
    orb = cv2.ORB_create(nfeatures=6000)
    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    if a.images:
        os.makedirs(a.images, exist_ok=True)
    out = []
    for pno in pages:
        page = doc[pno - 1]
        infos = page.get_image_info(xrefs=True)
        crops = [i for i in infos if i["xref"] and i["xref"] not in furniture and i["width"] >= a.min_crop]
        if not crops:
            continue
        words = page.get_text("words")
        for crop in crops:
            img = pix_of(doc, crop["xref"])
            gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
            best = None
            for lv in levels:
                # the crop's scale is unknown: try it as printed and resized near the level copy's density
                for s in (1.0, 0.75, 0.5, 1.5):
                    gs = cv2.resize(gray, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s != 1 else gray
                    r = register(gs, lv, orb, bf)
                    if r and (best is None or r["inliers"] > best[1]["inliers"]):
                        S = np.diag([s, s, 1.0])
                        r["M"] = r["M"] @ S
                        best = (lv, r)
            rec = {"page": pno, "crop": {"xref": crop["xref"], "bbox": [round(v, 1) for v in crop["bbox"]],
                                         "px": [img.shape[1], img.shape[0]]}}
            if not best or best[1]["inliers"] < 12:
                rec["level"] = None
                out.append(rec)
                continue
            lv, reg = best
            g = lv["grid"]
            bb = crop["bbox"]
            inside = lambda b: b[0] >= bb[0] - 2 and b[2] <= bb[2] + 2 and b[1] >= bb[1] - 2 and b[3] <= bb[3] + 2
            rec.update(level=lv["id"], inliers=reg["inliers"], err_px=reg["err_px"],
                       transform=[[round(v, 5) for v in row] for row in reg["M"].tolist()])
            # label: a short key like A1 / B2c printed over the crop
            lab = [w for w in words if re.fullmatch(r"[A-Z]\d{1,2}[a-z]?", w[4]) and inside(w[:4])]
            rec["label"] = [{"text": w[4], "cell": to_cell(((w[0] + w[2]) / 2, (w[1] + w[3]) / 2), bb, rec["crop"]["px"], reg, g)}
                            for w in lab]
            # markers: small square images over the crop, one per pawn (stacked ring/shadow layers share a centre)
            marks = {}
            for i in infos:
                b = i["bbox"]
                if not i["xref"] or i["xref"] in furniture or i is crop or not inside(b):
                    continue
                if not (10 <= b[2] - b[0] <= 60 and abs((b[2] - b[0]) - (b[3] - b[1])) < 4):
                    continue
                c = ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
                key = (round(c[0]), round(c[1]))
                # rings and shadows are page furniture (on many pages) or masks (xref 0); what is left is the portrait
                marks.setdefault(key, i)
            rec["markers"] = []
            for key, i in sorted(marks.items(), key=lambda kv: (kv[0][1], kv[0][0])):
                c = ((i["bbox"][0] + i["bbox"][2]) / 2, (i["bbox"][1] + i["bbox"][3]) / 2)
                m = {"xref": i["xref"], "cell": to_cell(c, bb, rec["crop"]["px"], reg, g),
                     "bbox": [round(v, 1) for v in i["bbox"]]}
                rec["markers"].append(m)
                if a.images:
                    p = os.path.join(a.images, f"marker-{i['xref']}.png")
                    if not os.path.exists(p):
                        Image.fromarray(pix_of(doc, i["xref"])).save(p)
            out.append(rec)
            print(f"p{pno}: {lv['id']} inliers {reg['inliers']} err {reg['err_px']} labels "
                  f"{[l['text'] for l in rec['label']]} markers {len(rec['markers'])}", file=sys.stderr)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"levels": [{"id": lv["id"], "grid": lv["grid"], "crop": lv["crop"], "work_scale": WORK_SCALE}
                              for lv in levels], "pages": out}, f, indent=1, default=float)
        f.write("\n")


if __name__ == "__main__":
    main(sys.argv[1:])
