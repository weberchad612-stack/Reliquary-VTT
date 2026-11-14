#!/usr/bin/env python3
"""Generate a battle map from a short spec (future/adventure-events.md: "a fight with no battle map"; the user's
decision, 2026-11-13: Claude makes one from the book's description). Original art, painted here from simple shapes,
and our map data (walls, terrain, light, the party's start) written from the same spec, so the two always agree.

Usage:  python3 tools/genmap/genmap.py <spec.json> <out-map-dir> [--seed N]

The spec (Claude writes it from the book's description, in its own words; docs/best-practices/events.md, Generated
battle maps):
  {"id": "churchyard-fight", "name": "Churchyard at night", "cols": 24, "rows": 18, "feet_per_cell": 5,
   "ground": "grass" | "dirt" | "stone" | "sand" | "snow" | "cave" | "wood" | "mud",
   "outdoor": true,                      (lit by the sky; else "base_light": "dark" | "dim" | "bright")
   "start": [x, y, w, h],                (the party's starting squares)
   "features": [
     {"type": "building", "rect": [x, y, w, h], "label": "Chapel", "floor": "stone",
      "doors": [{"side": "s", "at": 3, "label": "Chapel door", "initial": "closed"|"locked"}],
      "windows": [{"side": "e", "at": 2}]},
     {"type": "wall", "from": [x, y], "to": [x, y], "label": "..."},             (a solid wall along grid lines)
     {"type": "low-wall", "from": [x, y], "to": [x, y]},                         (difficult terrain: climb over)
     {"type": "rock" | "pillar", "rects": [[x, y, w, h]]},                       (solid: walls around it)
     {"type": "trees", "at": [[x, y], ...]} or {"type": "trees", "area": [x, y, w, h], "count": n},
     {"type": "undergrowth" | "rubble" | "mud", "rects": [...]},                 (difficult terrain)
     {"type": "water", "rects": [...], "deep": true},                            (deep: Swim; shallow: difficult)
     {"type": "graves", "area": [x, y, w, h], "count": n},                       (headstones: art only, cover by ruling)
     {"type": "path", "points": [[x, y], ...], "width": 2},
     {"type": "fire" | "light", "at": [x, y], "bright": 20, "dim": 20, "label": "Bonfire"},
     {"type": "hazard", "rects": [...], "label": "Embers"}]}                     (hazardous terrain)
Coordinates are in squares from the top-left. Writes map.json, <id>.webp, walls.json, terrain.json and, when there
are lights, lighting.json, and keeps the spec as genmap.json beside them so the map can be made again.
"""
import json
import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

CS = 70  # pixels per square: sharp on the board at the usual zooms

GROUND = {  # base colour, variation
    "grass": ((86, 110, 62), 12), "dirt": ((122, 98, 70), 12), "stone": ((128, 126, 120), 9), "sand": ((196, 176, 128), 10),
    "snow": ((222, 228, 234), 6), "cave": ((70, 64, 58), 10), "wood": ((128, 92, 58), 8), "mud": ((92, 76, 56), 10),
}


class Gen:
    def __init__(self, spec, seed=None):
        self.s = spec
        self.cols, self.rows = int(spec["cols"]), int(spec["rows"])
        self.rng = random.Random(seed if seed is not None else spec.get("seed", spec["id"]))
        self.W, self.H = self.cols * CS, self.rows * CS
        self.img = Image.new("RGB", (self.W, self.H))
        self.d = ImageDraw.Draw(self.img)
        self.segs, self.terrain, self.lights = [], [], []
        self.n = 0
        self.undrawn = set()       # wall segments the art already shows (a rock's own outline)
        self.busy = set()          # squares taken by a path or a structure: scattered things stay off them
        for f in spec.get("features", []):
            if f["type"] == "path":
                self.busy |= self.path_cells(f)
            if f["type"] in ("building", "rock", "pillar"):
                for r in ([f["rect"]] if "rect" in f else f.get("rects", [])):
                    self.busy |= set(self.cells([r]))

    # ---- helpers
    def C(self, v):
        return v * CS

    def noise(self, box, base, var, grain=6):
        """Fill a box with a base colour broken up by soft noise (blocks of `grain` px, then blurred)."""
        x0, y0, x1, y1 = [int(round(v)) for v in box]
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(self.W, x1), min(self.H, y1)
        if x1 <= x0 or y1 <= y0:
            return
        w, h = x1 - x0, y1 - y0
        small = Image.new("RGB", (max(1, w // grain + 1), max(1, h // grain + 1)))
        sp = small.load()
        for y in range(small.size[1]):
            for x in range(small.size[0]):
                n = self.rng.randint(-var, var)
                sp[x, y] = tuple(max(0, min(255, c + n)) for c in base)
        tile = small.resize((w, h), Image.BILINEAR).filter(ImageFilter.GaussianBlur(1.2))
        self.img.paste(tile, (x0, y0))

    def seg(self, a, b, t="solid", **kw):
        self.n += 1
        s = {"id": kw.pop("id", f"g{self.n:03d}"), "a": [a[0], a[1]], "b": [b[0], b[1]], "t": t}
        s.update(kw)
        self.segs.append(s)

    def area(self, kind, rects, label, cause=None, note=None):
        clipped = []
        for r in rects:
            x, y, w, h = map(int, r)
            x0, y0, x1, y1 = max(0, x), max(0, y), min(self.cols, x + w), min(self.rows, y + h)
            if x1 > x0 and y1 > y0:
                clipped.append([x0, y0, x1 - x0, y1 - y0])
        if not clipped:
            return
        a = {"id": f"{kind.replace('_', '-')}-{len(self.terrain) + 1}", "kind": kind, "label": label, "rects": clipped}
        if cause:
            a["cause"] = cause
        if note:
            a["note"] = note
        self.terrain.append(a)

    def path_cells(self, f):
        pts, half = f["points"], f.get("width", 2) / 2 + 0.25
        out = set()
        for y in range(self.rows):
            for x in range(self.cols):
                cx, cy = x + 0.5, y + 0.5
                for (ax, ay), (bx, by) in zip(pts, pts[1:]):
                    dx, dy = bx - ax, by - ay
                    t = max(0, min(1, ((cx - ax) * dx + (cy - ay) * dy) / ((dx * dx + dy * dy) or 1)))
                    if math.hypot(cx - (ax + t * dx), cy - (ay + t * dy)) <= half:
                        out.add((x, y)); break
        return out

    def cells(self, rects):
        for x, y, w, h in rects:
            for yy in range(int(y), int(y + h)):
                for xx in range(int(x), int(x + w)):
                    yield xx, yy

    # ---- features
    def building(self, f):
        x, y, w, h = f["rect"]
        floor = GROUND.get(f.get("floor", "wood"), GROUND["wood"])
        self.noise((self.C(x), self.C(y), self.C(x + w), self.C(y + h)), floor[0], floor[1])
        seam = tuple(max(0, c - 24) for c in floor[0])
        for k in range(int(y), int(y + h) + 1):
            self.d.line((self.C(x), self.C(k), self.C(x + w), self.C(k)), fill=seam, width=1)
        sides = {"n": ((x, y), (x + w, y), False), "s": ((x, y + h), (x + w, y + h), False), "w": ((x, y), (x, y + h), True), "e": ((x + w, y), (x + w, y + h), True)}
        openings = {k: [] for k in sides}
        for dn, dd in enumerate(f.get("doors", [])):
            did = dd.get("id", f"{f.get('id', 'bldg')}-door{dn + 1}")
            openings[dd["side"]].append((dd["at"], dd["at"] + dd.get("width", 1), "door", {"door": {"id": did, "label": dd.get("label", f"{f.get('label', 'Building')} door"), "initial": dd.get("initial", "closed")}}))
        for wd in f.get("windows", []):
            openings[wd["side"]].append((wd["at"], wd["at"] + wd.get("width", 1), "window", {}))
        for side, (a, b, vertical) in sides.items():
            lo, hi = (a[1], b[1]) if vertical else (a[0], b[0])
            fixed = a[0] if vertical else a[1]
            pt = (lambda v, fx=fixed: (fx, v)) if vertical else (lambda v, fx=fixed: (v, fx))
            cur = lo
            for o0, o1, t, props in sorted(((lo + o0, lo + o1, t, p) for o0, o1, t, p in openings[side]), key=lambda o: o[0]):
                if o0 > cur:
                    self.seg(pt(cur), pt(o0))
                self.seg(pt(o0), pt(o1), t, **props)
                cur = o1
            if cur < hi:
                self.seg(pt(cur), pt(hi))

    def solid_rects(self, rects, colour=(108, 104, 98), outline=(54, 50, 46), round_=True):
        for x, y, w, h in rects:
            box = (self.C(x) + 2, self.C(y) + 2, self.C(x + w) - 2, self.C(y + h) - 2)
            (self.d.rounded_rectangle if round_ else self.d.rectangle)(box, **({"radius": CS // 4} if round_ else {}), fill=colour, outline=outline, width=4)
            for k in range(int(w * h * 3)):
                cx, cy = self.rng.uniform(box[0] + 6, box[2] - 6), self.rng.uniform(box[1] + 6, box[3] - 6)
                self.d.line((cx, cy, cx + self.rng.uniform(-10, 10), cy + self.rng.uniform(-10, 10)), fill=outline, width=1)
            for a, b in (((x, y), (x + w, y)), ((x + w, y), (x + w, y + h)), ((x + w, y + h), (x, y + h)), ((x, y + h), (x, y))):
                self.seg(a, b)
                self.undrawn.add(self.segs[-1]["id"])

    def trees(self, f):
        pts = [tuple(p) for p in f.get("at", [])]
        if "area" in f:
            x, y, w, h = f["area"]
            pts += [(self.rng.uniform(x + 0.5, x + w - 0.5), self.rng.uniform(y + 0.5, y + h - 0.5)) for _ in range(int(f.get("count", max(1, w * h // 6))))]
        canopy = []
        for (x, y) in pts:
            r = self.rng.uniform(0.9, 1.4) * CS
            cx, cy = self.C(x), self.C(y)
            self.d.ellipse((cx - 8, cy - 8, cx + 8, cy + 8), fill=(70, 50, 32))
            canopy.append((cx, cy, r))
        layer = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        for cx, cy, r in canopy:
            ld.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(40, 72, 38, 215), outline=(22, 44, 22, 255), width=3)
            for _ in range(6):
                a, rr = self.rng.uniform(0, 2 * math.pi), self.rng.uniform(0.2, 0.6) * r
                ld.ellipse((cx + math.cos(a) * rr - r * 0.3, cy + math.sin(a) * rr - r * 0.3, cx + math.cos(a) * rr + r * 0.3, cy + math.sin(a) * rr + r * 0.3), fill=(54, 92, 48, 200))
        self.img = Image.alpha_composite(self.img.convert("RGBA"), layer).convert("RGB")
        self.d = ImageDraw.Draw(self.img)
        # the trunks' squares are difficult terrain (roots and low branches)
        sq = sorted({(int(x), int(y)) for x, y in pts if 0 <= x < self.cols and 0 <= y < self.rows})
        if sq:
            self.area("difficult", [[x, y, 1, 1] for x, y in sq], f.get("label", "Trees"), cause="trees")

    def scatter(self, rects, colour, outline, count_per_cell, rmin, rmax):
        for (x, y) in self.cells(rects):
            for _ in range(count_per_cell):
                cx, cy, r = self.C(x) + self.rng.uniform(6, CS - 6), self.C(y) + self.rng.uniform(6, CS - 6), self.rng.uniform(rmin, rmax)
                self.d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=colour, outline=outline)

    def graves(self, f):
        x, y, w, h = f["area"]
        n = int(f.get("count", max(1, w * h // 4)))
        spots = [(xx, yy) for yy in range(int(y), int(y + h), 2) for xx in range(int(x), int(x + w), 2) if (xx, yy) not in self.busy]
        self.rng.shuffle(spots)
        for (gx, gy) in spots[:n]:
            cx, cy = self.C(gx) + CS / 2, self.C(gy) + CS / 2
            self.d.rectangle((cx - 16, cy + 2, cx + 16, cy + 30), fill=(96, 80, 60))                            # the mound
            self.d.rounded_rectangle((cx - 13, cy - 22, cx + 13, cy + 2), radius=10, fill=(150, 148, 142), outline=(70, 68, 64), width=3)

    def path(self, f):
        pts = [(self.C(px), self.C(py)) for px, py in f["points"]]
        width = int(f.get("width", 2) * CS)
        col = GROUND.get(f.get("ground", "dirt"), GROUND["dirt"])[0]
        self.d.line(pts, fill=col, width=width, joint="curve")
        for p in pts:
            self.d.ellipse((p[0] - width / 2, p[1] - width / 2, p[0] + width / 2, p[1] + width / 2), fill=col)

    def light(self, f):
        x, y = f["at"]
        if f["type"] == "fire":
            cx, cy = self.C(x), self.C(y)
            for r, c in ((26, (120, 60, 30)), (18, (220, 110, 40)), (9, (255, 210, 110))):
                self.d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=c)
        self.lights.append({"id": f.get("id", f"light-{len(self.lights) + 1}"), "at": [x, y], "bright": f.get("bright", 20), "dim": f.get("dim", 20),
                            "colour": f.get("colour", "#ff9a40" if f["type"] == "fire" else "#ffe2a8"), "label": f.get("label", "Fire" if f["type"] == "fire" else "Light"),
                            **({"animation": {"type": "torch", "speed": 3, "intensity": 4}} if f["type"] == "fire" else {})})

    # ---- the whole map
    def run(self):
        s = self.s
        g = GROUND.get(s.get("ground", "grass"), GROUND["grass"])
        self.noise((0, 0, self.W, self.H), g[0], g[1])
        order = {"path": 0, "water": 1, "mud": 1, "undergrowth": 2, "graves": 3, "building": 4, "wall": 5, "low-wall": 5, "rock": 6, "pillar": 6, "rubble": 7, "hazard": 7, "trees": 8, "fire": 9, "light": 9}
        for f in sorted(s.get("features", []), key=lambda f: order.get(f["type"], 5)):
            t = f["type"]
            if t == "path":
                self.path(f)
            elif t == "water":
                deep = f.get("deep", False)
                for (x, y) in self.cells(f["rects"]):
                    self.noise((self.C(x), self.C(y), self.C(x + 1), self.C(y + 1)), (44, 86, 110) if deep else (88, 116, 104), 6)
                self.area("swim" if deep else "difficult", f["rects"], f.get("label", "Deep water" if deep else "Shallow water"), cause="water")
            elif t in ("mud", "undergrowth"):
                col = (84, 70, 50) if t == "mud" else (58, 86, 44)
                for (x, y) in self.cells(f["rects"]):
                    self.noise((self.C(x), self.C(y), self.C(x + 1), self.C(y + 1)), col, 14)
                self.area("difficult", f["rects"], f.get("label", t.capitalize()), cause=t)
            elif t == "graves":
                self.graves(f)
            elif t == "building":
                self.building(f)
            elif t == "wall":
                a, b = f["from"], f["to"]
                self.d.line((self.C(a[0]), self.C(a[1]), self.C(b[0]), self.C(b[1])), fill=(60, 54, 48), width=int(CS * 0.26))
                self.seg(a, b)
            elif t == "low-wall":
                # pieces between its gaps (where a path goes through); the squares on both sides of each piece are
                # difficult terrain (climbing over); it may give cover (the GM's ruling)
                a, b = f["from"], f["to"]
                horiz = a[1] == b[1]
                lo, hi = sorted([a[0], b[0]] if horiz else [a[1], b[1]])
                pieces, cur = [], lo
                for g0, g1 in sorted(f.get("gaps", [])):
                    if g0 > cur:
                        pieces.append((cur, g0))
                    cur = max(cur, g1)
                if cur < hi:
                    pieces.append((cur, hi))
                rects = []
                for p0, p1 in pieces:
                    pa, pb = ((p0, a[1]), (p1, a[1])) if horiz else ((a[0], p0), (a[0], p1))
                    self.d.line((self.C(pa[0]), self.C(pa[1]), self.C(pb[0]), self.C(pb[1])), fill=(124, 118, 108), width=int(CS * 0.22))
                    self.d.line((self.C(pa[0]), self.C(pa[1]), self.C(pb[0]), self.C(pb[1])), fill=(150, 146, 136), width=int(CS * 0.1))
                    rects.append([p0, a[1] - 1, p1 - p0, 2] if horiz else [a[0] - 1, p0, 2, p1 - p0])
                self.area("difficult", rects, f.get("label", "Low wall"), cause="low-wall", note="Climbing over a low wall; it may give cover")
            elif t in ("rock", "pillar"):
                self.solid_rects(f["rects"], round_=(t == "rock"))
            elif t == "rubble":
                self.scatter(f["rects"], (112, 100, 84), (54, 46, 38), 8, 4, 11)
                self.area("difficult", f["rects"], f.get("label", "Rubble"), cause="rubble")
            elif t == "hazard":
                for (x, y) in self.cells(f["rects"]):
                    self.noise((self.C(x) + 4, self.C(y) + 4, self.C(x + 1) - 4, self.C(y + 1) - 4), (190, 90, 40), 40)
                self.area("hazardous", f["rects"], f.get("label", "Hazard"), cause=f.get("cause", "hazard"), note=f.get("note"))
            elif t == "trees":
                self.trees(f)
            elif t in ("fire", "light"):
                self.light(f)
            else:
                raise SystemExit(f"unknown feature type {t!r}")
        # the grid, faint
        layer = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))
        gd = ImageDraw.Draw(layer)
        for k in range(self.cols + 1):
            gd.line((self.C(k), 0, self.C(k), self.H), fill=(0, 0, 0, 40), width=1)
        for k in range(self.rows + 1):
            gd.line((0, self.C(k), self.W, self.C(k)), fill=(0, 0, 0, 40), width=1)
        self.img = Image.alpha_composite(self.img.convert("RGBA"), layer).convert("RGB")
        # walls drawn over the floor (doors are the board's)
        d = ImageDraw.Draw(self.img)
        for sg in self.segs:
            if sg["id"] in self.undrawn:
                continue
            if sg["t"] == "solid":
                d.line((self.C(sg["a"][0]), self.C(sg["a"][1]), self.C(sg["b"][0]), self.C(sg["b"][1])), fill=(48, 40, 34), width=int(CS * 0.26))
            elif sg["t"] == "window":
                d.line((self.C(sg["a"][0]), self.C(sg["a"][1]), self.C(sg["b"][0]), self.C(sg["b"][1])), fill=(48, 40, 34), width=int(CS * 0.26))
                d.line((self.C(sg["a"][0]), self.C(sg["a"][1]), self.C(sg["b"][0]), self.C(sg["b"][1])), fill=(180, 214, 230), width=int(CS * 0.1))
        return self


def start_squares(spec):
    x, y, w, h = spec.get("start", [0, 0, 2, 2])
    return [[xx, yy] for yy in range(int(y), int(y + h)) for xx in range(int(x), int(x + w))]


def write(spec, out, seed=None):
    g = Gen(spec, seed).run()
    os.makedirs(out, exist_ok=True)
    mid = spec["id"]
    img_name = f"{mid}.webp"
    g.img.save(os.path.join(out, img_name), "WEBP", quality=84, method=6)

    def dump(name, obj, schema):
        with open(os.path.join(out, name), "w") as f:
            json.dump({"$schema": f"../../../../schemas/{schema}", **obj}, f, indent=1)
            f.write("\n")

    m = {"id": mid, "name": spec.get("name", mid), "kind": "battle", "image": {"file": img_name, "w": g.W, "h": g.H},
         "grid": {"cell_px": CS, "origin_px": [0, 0], "cols": g.cols, "rows": g.rows, "feet_per_cell": spec.get("feet_per_cell", 5)},
         "start": start_squares(spec), "walls": "walls.json", "terrain": "terrain.json",
         "note": spec.get("note", "Generated by tools/genmap/genmap.py from Claude's spec (genmap.json): original art for a fight the book gives no map for.")}
    if spec.get("outdoor", True) and "base_light" not in spec:
        m["outdoor"] = True
    else:
        m["base_light"] = spec.get("base_light", "dark")
    if g.lights:
        m["lighting"] = "lighting.json"
        dump("lighting.json", {"v": 1, "regions": [], "lights": g.lights}, "lighting.schema.json")
    dump("map.json", m, "map.schema.json")
    dump("walls.json", {"v": 1, "unit": "cell", "snap": 0.125, "segs": g.segs}, "walls.schema.json")
    dump("terrain.json", {"v": 1, "areas": g.terrain}, "terrain.schema.json")
    with open(os.path.join(out, "genmap.json"), "w") as f:
        json.dump(spec, f, indent=1)
        f.write("\n")
    return {"map": m, "walls": len(g.segs), "terrain": len(g.terrain), "lights": len(g.lights)}


def main(argv):
    args = list(argv[1:])
    seed = None
    if "--seed" in args:
        i = args.index("--seed"); seed = int(args[i + 1]); del args[i:i + 2]
    if len(args) != 2:
        print(__doc__.split("\n\n")[1]); return 2
    spec = json.load(open(args[0]))
    for k in ("id", "cols", "rows"):
        if k not in spec:
            print(f"the spec needs {k!r}"); return 2
    r = write(spec, args[1], seed)
    print(f"{args[1]}: {r['map']['grid']['cols']} x {r['map']['grid']['rows']} squares, {r['walls']} wall segments, {r['terrain']} terrain areas, {r['lights']} lights")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
