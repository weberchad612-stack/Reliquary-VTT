"""Strip the location numbers printed on an area map's image (a town map from an adventure).

    python3 tools/mapimport/strip_numbers.py <map-folder> [--only 3,14] [--out FILE] [--sheet FILE]
        [--light 200] [--min-height 15] [--radius 34] [--grow 5] [--fill 6] [--scale 1.0]

Reads the map's map.json (an area map: `image.file` and `places` with `at` in image pixels). For each place
with a printed `number` (or only those given with --only, by id or number), it finds the printed marker near the pin,
masks it with its outline, and fills the mask from the surrounding pixels (OpenCV inpainting, Telea).

Writes, next to the image unless told otherwise:
  <image>-stripped.<ext>   the image with those numbers removed (the original is never changed)
  <image>-mask.png         the mask (white = filled); hand it to a generative fill tool for better results
  <image>-strip-check.png  one row per place: original | mask (red) | result, enlarged, for checking

How the marker is found (docs/best-practices/map-importer.md, section 5b):
  - Light pixels (every channel >= --light) within --radius pixels of the pin.
  - Connected shapes at least --min-height pixels tall are kept: digits, or the disc behind them. Street
    names and other small lettering are shorter and are left alone. Holes inside a kept shape (the dark
    digit inside a light disc) are filled.
  - The mask grows by --grow pixels to cover the black outline and the anti-aliasing.
--scale multiplies the pins' coordinates, for an image larger or smaller than the one the pins were placed on.

Results are good on flat or evenly textured ground (grass, roofs, water) and leave a soft smudge over busy
detail (a building's corner, market stalls). Look at the check sheet; prefer an unlabelled player map
where one exists. Book images stay in the private pack: never commit them or their outputs.
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np


def find_markers(img, pins, light=200, min_height=15, radius=34, grow=5):
    """The mask of the printed markers near each pin: {id: mask pixels}, mask (uint8, 255 = marker)."""
    h, w = img.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    found = {}
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow + 1, 2 * grow + 1))
    for pid, (cx, cy) in pins.items():
        x0, y0, x1, y1 = max(0, cx - radius), max(0, cy - radius), min(w, cx + radius), min(h, cy + radius)
        win = img[y0:y1, x0:x1]
        bright = cv2.inRange(win, (light, light, light), (255, 255, 255))
        n, lab, stats, _ = cv2.connectedComponentsWithStats(bright, 8)
        keep = np.zeros_like(bright)
        for i in range(1, n):
            if stats[i][3] >= min_height:
                keep[lab == i] = 255
        if keep.any():
            # fill holes: the dark digit inside a light disc belongs to the marker too
            flood = keep.copy()
            ff = np.zeros((flood.shape[0] + 2, flood.shape[1] + 2), np.uint8)
            cv2.floodFill(flood, ff, (0, 0), 255)
            keep = keep | cv2.bitwise_not(flood)
            keep = cv2.dilate(keep, kernel)
        mask[y0:y1, x0:x1] |= keep
        found[pid] = int((keep > 0).sum())
    return found, mask


def check_sheet(before, mask, after, pins, size=70, tile=240):
    """One row per pin: original | mask over the original (red) | result."""
    over = before.copy()
    sel = mask > 0
    over[sel] = (0.4 * over[sel] + 0.6 * np.array([60, 60, 230])).astype(np.uint8)
    h, w = before.shape[:2]
    rows = []
    for pid, (cx, cy) in pins.items():
        x0, y0 = max(0, cx - size), max(0, cy - size)
        x1, y1 = min(w, cx + size), min(h, cy + size)
        crop = lambda im: cv2.resize(im[y0:y1, x0:x1], (tile, tile), interpolation=cv2.INTER_CUBIC)
        row = np.hstack([crop(before), crop(over), crop(after)])
        cv2.putText(row, str(pid), (8, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 3)
        cv2.putText(row, str(pid), (8, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (20, 20, 20), 1)
        rows.append(row)
    return np.vstack(rows) if rows else None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("map_dir")
    ap.add_argument("--only", help="place ids or printed numbers, comma-separated (default: every place with a number)")
    ap.add_argument("--out"); ap.add_argument("--mask"); ap.add_argument("--sheet")
    ap.add_argument("--light", type=int, default=200)
    ap.add_argument("--min-height", type=int, default=15)
    ap.add_argument("--radius", type=int, default=34)
    ap.add_argument("--grow", type=int, default=5)
    ap.add_argument("--fill", type=int, default=6, help="inpainting radius in pixels")
    ap.add_argument("--scale", type=float, default=1.0)
    a = ap.parse_args(argv)

    with open(os.path.join(a.map_dir, "map.json")) as f:
        m = json.load(f)
    if m.get("kind") != "area":
        sys.exit("not an area map: only area maps have printed place numbers to strip")
    only = set(a.only.split(",")) if a.only else None
    pins = {}
    for p in m["places"]:
        key = p.get("number") or p["id"]
        if only and p["id"] not in only and p.get("number") not in only:
            continue
        if not only and not p.get("number"):
            continue   # nothing printed to strip
        pins[key] = (int(round(p["at"][0] * a.scale)), int(round(p["at"][1] * a.scale)))
    if not pins:
        sys.exit("no places matched")

    src = os.path.join(a.map_dir, m["image"]["file"])
    stem, ext = os.path.splitext(src)
    img = cv2.imread(src)
    if img is None:
        sys.exit(f"cannot read {src}")
    found, mask = find_markers(img, pins, a.light, a.min_height, a.radius, a.grow)
    out = cv2.inpaint(img, mask, a.fill, cv2.INPAINT_TELEA)
    paths = {"out": a.out or f"{stem}-stripped{ext}", "mask": a.mask or f"{stem}-mask.png", "sheet": a.sheet or f"{stem}-strip-check.png"}
    e = os.path.splitext(paths["out"])[1].lower()
    quality = [cv2.IMWRITE_JPEG_QUALITY, 92] if e in (".jpg", ".jpeg") else [cv2.IMWRITE_WEBP_QUALITY, 90] if e == ".webp" else []
    cv2.imwrite(paths["out"], out, quality)
    cv2.imwrite(paths["mask"], mask)
    sheet = check_sheet(img, mask, out, pins)
    if sheet is not None:
        cv2.imwrite(paths["sheet"], sheet)
    missed = [k for k, v in found.items() if not v]
    print(json.dumps({"stripped": {k: v for k, v in found.items() if v}, "not_found": missed, **paths}))
    if missed:
        print(f"no marker found near: {', '.join(missed)} (check the pin positions, or adjust --light, --min-height, --radius)", file=sys.stderr)
    return 1 if missed else 0


if __name__ == "__main__":
    sys.exit(main())
