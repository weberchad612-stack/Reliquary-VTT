#!/usr/bin/env python3
"""Area maps (kind "area": a town, a region) from a clean map image in the book and the place labels printed over it
on the page's text layer (docs/best-practices/adventure-importer.md section 13).

Usage: python3 tools/advimport/areamap.py <pack-dir> <spec.json>

spec.json:
  {"pdf": "pdfsource/<book>.pdf", "page": 2, "xref": 1063,         the page and the image (its PDF object number)
   "maps": [{"id": "town", "name": "Town", "note": "...",
             "box": [x0, y0, x1, y1],                                the part of the image this map is (image pixels)
             "labels": "^W\\\\d+$",                                    which printed words are this map's places
             "size": 70,                                             a place's marker size in image pixels
             "places": {"W1": {"name": "...", "type": "...", "note": "...", "public": false}},
             "repeat": {"P": {"id": "p", "name": "Peachwood grove", "note": "...", "public": false, "size": 60}}}]}

Each label inside a map's box becomes a place at its point (relative to the box): its number, and the name, type, note
and public flag from `places` (paraphrased from the book). A number printed twice gets "-b" on its second id. A label
listed under `repeat` is printed many times with no number of its own (the groves "P"): p1, p2, ... A label with no
entry in `places`, or a place no label marks, is reported and the map is not written.
"""
import json
import os
import re
import sys


def natural(label):
    m = re.match(r"([A-Za-z]*)(\d*)(.*)", label)
    return (m.group(1), int(m.group(2)) if m.group(2) else -1, m.group(3))


def read_labels(page, rect, w, h, pattern):
    """[(text, x, y)] in image pixels, a label printed twice at one spot kept once."""
    out = []
    for x0, y0, x1, y1, word, *_ in page.get_text("words"):
        t = word.strip(".,:;()")
        if not re.match(pattern, t):
            continue
        x = ((x0 + x1) / 2 - rect.x0) / rect.width * w
        y = ((y0 + y1) / 2 - rect.y0) / rect.height * h
        if not any(l[0] == t and abs(l[1] - x) < 5 and abs(l[2] - y) < 5 for l in out):
            out.append((t, x, y))
    return out


def places_for(m, labels):
    """(places, problems) for one map spec from the labels inside its box."""
    x0, y0, x1, y1 = m["box"]
    inside = [l for l in labels if re.match(m.get("labels", ".*"), l[0]) and x0 <= l[1] < x1 and y0 <= l[2] < y1]
    repeat, known = m.get("repeat", {}), m.get("places", {})
    out, probs, counts = [], [], {}
    for t, x, y in sorted(inside, key=lambda l: natural(l[0])):
        at = [round(x - x0), round(y - y0)]
        if t in repeat:
            r = repeat[t]
            counts[t] = counts.get(t, 0) + 1
            pl = {"id": f"{r.get('id', t.lower())}{counts[t]}", "name": r["name"], "number": t}
            if r.get("public") is False:
                pl["public"] = False
            pl.update({"note": r.get("note"), "at": at, "size": r.get("size", m.get("size", 70))})
            out.append({k: v for k, v in pl.items() if v is not None})
            continue
        p = known.get(t)
        if not p:
            probs.append(f"{m['id']}: label {t} at {at} has no entry in places")
            continue
        pid = t.lower() + ("-b" if any(o["id"] == t.lower() for o in out) else "")
        pl = {"id": pid, "name": p["name"], **({"type": p["type"]} if p.get("type") else {}), "number": t}
        if p.get("public") is False:
            pl["public"] = False
        pl.update({"note": p.get("note"), "at": at, "size": p.get("size", m.get("size", 70))})
        out.append({k: v for k, v in pl.items() if v is not None})
    marked = {o["number"] for o in out}
    probs += [f"{m['id']}: place {k} has no label on the map" for k in known if k not in marked]
    return out, probs


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    import pymupdf
    from PIL import Image
    import io
    pack, spec = argv[0], json.load(open(argv[1]))
    doc = pymupdf.open(spec["pdf"])
    page = doc[spec["page"] - 1]
    pm = pymupdf.Pixmap(doc, spec["xref"])
    full = Image.open(io.BytesIO(pm.tobytes("png"))).convert("RGB")
    rect = page.get_image_rects(spec["xref"])[0]
    labels = read_labels(page, rect, full.width, full.height, spec.get("labels", r"^[A-Z]{1,2}\d*[a-z]?$"))
    bad = 0
    for m in spec["maps"]:
        places, probs = places_for(m, labels)
        for p in probs:
            print("PROBLEM ", p)
        bad += len(probs)
        if probs:
            continue
        d = os.path.join(pack, "maps", m["id"])
        os.makedirs(d, exist_ok=True)
        img = full.crop(tuple(m["box"]))
        img.save(os.path.join(d, f"{m['id']}.webp"), quality=88)
        rec = {"$schema": "../../../../schemas/map.schema.json", "id": m["id"], "name": m["name"], "kind": "area",
               "image": {"file": f"{m['id']}.webp", "w": img.width, "h": img.height}, "note": m.get("note", ""), "places": places}
        with open(os.path.join(d, "map.json"), "w") as f:
            json.dump(rec, f, indent=1)
        print(m["id"], img.size, len(places), "places")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
