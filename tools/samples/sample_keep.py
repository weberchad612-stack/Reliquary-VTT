"""Generate the Sample Keep: an original 48 x 48 test map that exercises every map feature.

    python3 tools/samples/sample_keep.py

Writes examples/sample-pack/maps/sample-keep/{map.json, walls.json, terrain.json, lighting.json,
sample-keep.webp} and examples/demo/keep-setup.json. Everything here is original (no book content), so
the map and its demo may be committed and published.

The layout (cells, x right, y down):
- A keep (6,6)-(42,30). North row: library, chapel, armoury. A corridor (y 13-15). South row: kitchen
  over a cellar, the great hall (pillars, a collapsed corner open to the sky), the tower.
- Outside: a gate path south, a pond with a plank bridge and muddy shallows, undergrowth with trees,
  a rocky bluff on the east edge.
"""
import json
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "examples", "sample-pack", "maps", "sample-keep")
SETUP = os.path.join(ROOT, "examples", "demo", "keep-setup.json")
N = 48          # cells per side
CS = 40         # pixels per cell in the image
random.seed(7)

# ---------------------------------------------------------------- walls
segs = []
_n = {"w": 0}


def seg(a, b, t="solid", **kw):
    _n["w"] += 1
    s = {"id": kw.pop("id", f"w{_n['w']:03d}"), "a": [a[0], a[1]], "b": [b[0], b[1]], "t": t}
    s.update(kw)
    segs.append(s)
    return s


def line(fixed, lo, hi, openings=(), vertical=False):
    """A straight wall with openings: [(from, to, type, props)] along it."""
    pt = (lambda v: (fixed, v)) if vertical else (lambda v: (v, fixed))
    cur = lo
    for a, b, t, props in sorted(openings, key=lambda o: o[0]):
        if a > cur:
            seg(pt(cur), pt(a))
        seg(pt(a), pt(b), t, **props)
        cur = b
    if cur < hi:
        seg(pt(cur), pt(hi))


def door(did, label, **kw):
    return {"id": f"door-{did}", "door": {"id": did, "label": label, "initial": kw.pop("initial", "closed"), **kw}}


def leaves(a, b, did, label, **kw):
    """A double door from a to b along a wall: two paired leaves hinged at the outer ends."""
    m = (a + b) / 2
    swing = kw.pop("swing", "left")
    return [(a, m, "door", door(did + "a", f"{label}, first leaf", pair=did + "b", hinge="a", swing=swing, **kw)),
            (m, b, "door", door(did + "b", f"{label}, second leaf", pair=did + "a", hinge="b", swing=swing, **kw))]


SLIT = {"prox": {"sight": 5, "light": 5}}
# outer walls
line(6, 6, 42, [(18, 20, "window", {"id": "win-chapel-1", "sight": 20, "note": "Stained glass: light passes, sight does not"}),
                (24, 26, "window", {"id": "win-chapel-2", "sight": 20, "note": "Stained glass: light passes, sight does not"}),
                (32, 32.375, "slit", {"id": "slit-armoury-1", **SLIT}),
                (38, 38.375, "slit", {"id": "slit-armoury-2", **SLIT})])
line(6, 6, 30, [(18, 20, "window", {"id": "win-kitchen", "note": "Clear glass window"})], vertical=True)
line(42, 6, 30, [(19, 19.375, "slit", {"id": "slit-tower-1", **SLIT}),
                 (25, 25.375, "slit", {"id": "slit-tower-2", **SLIT})], vertical=True)
line(30, 6, 42, [(9, 10, "door", door("postern", "Postern door", initial="locked", dc=20, hinge="a", swing="left")),
                 (23, 25, "grate", {"id": "gate", "note": "Portcullis: see and shoot through, cannot pass"})])
# corridor walls
line(13, 6, 42, [(10, 11, "door", door("library", "Library door", hinge="a", swing="left"))]
     + leaves(21, 23, "chapel", "Chapel double door", swing="left")
     + [(35, 36, "door", door("armoury", "Armoury door", initial="locked", dc=18, hinge="b", swing="left"))])
line(15, 6, 42, [(9, 10, "door", door("kitchen", "Kitchen door", hinge="a", swing="right"))]
     + leaves(23, 25, "hall", "Great hall double door", swing="right", stuck_dc=12)
     + [(37, 38, "door", door("tower", "Tower door", hinge="b", swing="right"))])
# inner walls
line(16, 6, 13, [(9, 10, "secret", {"id": "secret-chapel", "door": {"id": "secret", "label": "Pivoting bookcase", "initial": "closed", "dc": 18, "hinge": "a", "swing": "right"},
                                    "note": "A bookcase on a pivot; Seek DC 18 to notice the draught"})], vertical=True)
line(28, 6, 13, [(9, 10, "door", door("vestry", "Vestry door", hinge="a", swing="left"))], vertical=True)
line(14, 15, 30, [(18, 19, "door", door("servery", "Servery door", hinge="a", swing="right"))], vertical=True)
line(22, 6, 14, [(11, 12, "door", door("cellar", "Swollen cellar door", stuck_dc=15, hinge="a", swing="right"))])
line(34, 15, 30, [(26, 27, "door", door("hall-tower", "Hall-tower door", hinge="b", swing="left"))], vertical=True)
seg((34, 22), (42, 22), "terrain", id="curtain", note="Heavy curtain: see past one, not two")
seg((13, 6), (13, 10), "solid", id="illusion", dir=1, note="Illusory wall: blocks only from the west")
seg((10, 24), (10, 30), "ethereal", id="barrier", note="Shimmering force barrier: walk through, cannot see through")
# pillars in the great hall
PILLARS = [(17, 19), (21, 19), (25, 19), (17, 25), (21, 25), (25, 25), (29, 25)]
for i, (x, y) in enumerate(PILLARS, 1):
    for k, (a, b) in enumerate((((x, y), (x + 1, y)), ((x + 1, y), (x + 1, y + 1)), ((x + 1, y + 1), (x, y + 1)), ((x, y + 1), (x, y)))):
        seg(a, b, id=f"pillar{i}-{k}")

# ---------------------------------------------------------------- terrain
POND = (31, 35, 10, 10)            # deep water
SHALLOWS = (30, 34, 12, 12)
BRIDGE_X = 36
UNDERGROWTH = (1, 33, 12, 13)
BLUFF = (44, 7, 4, 17)
HALL_RUBBLE = [(x, y) for y in range(15, 20) for x in range(28, 34)
               if (x - 28) + (19 - y) * 0.9 < 7.5 and (x, y) not in PILLARS]
HEARTH = [(6, 15), (7, 15)]
GLASS = [(x, 6) for x in range(17, 27)]
CELLAR_FLOOD = (6, 22, 4, 4)


def rect_cells(r):
    x, y, w, h = r
    return {(x + i, y + j) for j in range(h) for i in range(w)}


def rects(cells):
    rows = {}
    for x, y in cells:
        rows.setdefault(y, set()).add(x)
    runs = []
    for y in sorted(rows):
        xs = sorted(rows[y]); i = 0
        while i < len(xs):
            j = i
            while j + 1 < len(xs) and xs[j + 1] == xs[j] + 1:
                j += 1
            runs.append((xs[i], y, xs[j] - xs[i] + 1)); i = j + 1
    open_, out = {}, []
    for x, y, w in runs:
        r = open_.get((x, w))
        if r and r[1] + r[3] == y:
            r[3] += 1
        else:
            r = [x, y, w, 1]; out.append(r); open_[(x, w)] = r
    return out


bridge = {(BRIDGE_X, y) for y in range(34, 46)}
deep = rect_cells(POND) - bridge
shallow = rect_cells(SHALLOWS) - rect_cells(POND) - bridge
terrain = [
    {"id": "hall-rubble", "kind": "difficult", "cause": "rubble", "label": "Fallen roof", "room": "Great hall",
     "note": "The north-east corner of the roof has come down.", "rects": rects(HALL_RUBBLE)},
    {"id": "hearth", "kind": "hazardous", "cause": "embers", "damage": "1d6 fire when entering or ending a turn there", "label": "Hearth embers",
     "room": "Kitchen", "note": "A banked fire still glows.", "rects": rects(HEARTH)},
    {"id": "chapel-glass", "kind": "uneven", "cause": "glass", "dc": 12, "label": "Fallen stained glass", "room": "Chapel",
     "note": "Shards along the north wall; Balance or fall prone.", "rects": rects(GLASS)},
    {"id": "cellar-flood", "kind": "greater_difficult", "cause": "water", "label": "Flooded cellar", "room": "Cellar", "active": False,
     "note": "If the cistern is broken, water floods this corner. Switch on in the save.", "rects": [list(CELLAR_FLOOD)]},
    {"id": "pond", "kind": "swim", "cause": "water", "dc": 10, "label": "Deep pond", "note": "Calm water, 8 ft deep.", "rects": rects(deep)},
    {"id": "shallows", "kind": "greater_difficult", "cause": "mud", "label": "Muddy shallows", "note": "Knee-deep water over sucking mud.", "rects": rects(shallow)},
    {"id": "bridge", "kind": "narrow", "cause": "planks", "dc": 10, "label": "Plank bridge", "note": "A single plank across the pond.", "rects": rects(bridge)},
    {"id": "undergrowth", "kind": "difficult", "cause": "undergrowth", "label": "Undergrowth", "note": "Brambles and saplings.", "rects": [list(UNDERGROWTH)]},
    {"id": "bluff", "kind": "climb", "cause": "rock", "dc": 15, "label": "Rocky bluff", "note": "A steep rock face along the east edge.", "rects": [list(BLUFF)]},
]

# ---------------------------------------------------------------- lighting
keep = {(x, y) for y in range(6, 30) for x in range(6, 42)}
outside = {(x, y) for y in range(N) for x in range(N)} - keep
lighting = {
    "v": 1,
    "regions": [
        {"id": "outdoors", "level": "sky", "label": "Outdoors", "note": "Everything outside the keep.", "rects": rects(outside)},
        {"id": "hall-sky", "level": "sky", "label": "Collapsed roof", "room": "Great hall", "note": "Open to the sky where the roof fell.", "rects": rects(HALL_RUBBLE)},
        {"id": "fungus", "level": "dim", "label": "Glowing fungus", "room": "Cellar", "colour": "#7fe39a", "intensity": 60, "note": "Pale fungus on the cellar walls.", "rects": [[6, 26, 4, 4]]},
        {"id": "altar", "level": "dim", "label": "Altar glow", "room": "Chapel", "colour": "#c9d6ff", "intensity": 70, "note": "A faint glow around the old altar.", "rects": [[20, 7, 4, 3]]},
    ],
    "lights": [
        {"id": "brazier-w", "at": [15.6, 28.4], "bright": 10, "dim": 10, "colour": "#ff8a33", "animation": {"type": "torch", "speed": 3, "intensity": 4}, "label": "Brazier", "room": "Great hall"},
        {"id": "brazier-e", "at": [32.4, 28.4], "bright": 10, "dim": 10, "colour": "#ff8a33", "animation": {"type": "torch", "speed": 3, "intensity": 4}, "label": "Brazier", "room": "Great hall"},
        {"id": "hearth-fire", "at": [7.0, 15.6], "bright": 10, "dim": 10, "colour": "#ff8a33", "animation": {"type": "torch", "speed": 3, "intensity": 4}, "label": "Hearth fire", "room": "Kitchen"},
        {"id": "tower-lantern", "at": [41.4, 15.6], "preset": "hooded-lantern", "angle": 90, "rotation": 135, "label": "Lantern on a hook", "room": "Tower",
         "note": "Aimed across the tower toward the hall door."},
        {"id": "gate-torch-w", "at": [22.4, 30.6], "preset": "torch", "on": False, "label": "Gate torch", "note": "Unlit sconce outside the gate."},
        {"id": "gate-torch-e", "at": [25.6, 30.6], "preset": "torch", "on": False, "label": "Gate torch", "note": "Unlit sconce outside the gate."},
        {"id": "test-red", "at": [32.0, 8.5], "bright": 10, "dim": 10, "colour": "#ff2020", "label": "Test light (red)", "room": "Armoury", "note": "Colour test: overlaps the green and blue lights."},
        {"id": "test-green", "at": [38.0, 8.5], "bright": 10, "dim": 10, "colour": "#20ff40", "label": "Test light (green)", "room": "Armoury", "note": "Colour test: overlaps the red and blue lights."},
        {"id": "test-blue", "at": [35.0, 11.0], "bright": 10, "dim": 10, "colour": "#2050ff", "label": "Test light (blue)", "room": "Armoury", "note": "Colour test: overlaps the red and green lights."},
    ],
}

# ---------------------------------------------------------------- image
W = H = N * CS
img = Image.new("RGB", (W, H))
px = img.load()


def noise_fill(box, base, var, grain=1):
    x0, y0, x1, y1 = [int(v) for v in box]
    for y in range(max(0, y0), min(H, y1)):
        for x in range(max(0, x0), min(W, x1)):
            n = random.randint(-var, var)
            px[x, y] = tuple(max(0, min(255, c + n)) for c in base)


d = ImageDraw.Draw(img)
noise_fill((0, 0, W, H), (88, 112, 64), 10)                                     # grass
C = lambda v: v * CS
for (x, y) in rect_cells(UNDERGROWTH):                                           # undergrowth
    noise_fill((C(x), C(y), C(x + 1), C(y + 1)), (62, 90, 48), 14)
d.rectangle((C(22), C(30), C(26), H), fill=(150, 128, 92))                       # path
noise_fill((C(22), C(30), C(26), H), (150, 128, 92), 12)
for (x, y) in shallow:
    noise_fill((C(x), C(y), C(x + 1), C(y + 1)), (96, 120, 96), 8)
for (x, y) in deep:
    noise_fill((C(x), C(y), C(x + 1), C(y + 1)), (48, 92, 112), 6)
for (x, y) in rect_cells(BLUFF):                                                 # bluff
    noise_fill((C(x), C(y), C(x + 1), C(y + 1)), (120, 116, 108), 18)
for _ in range(90):
    x, y = random.uniform(C(44), W), random.uniform(C(7), C(24))
    r = random.uniform(5, 14); d.ellipse((x - r, y - r, x + r, y + r), fill=(96, 92, 86), outline=(60, 58, 54))
ROOMS = {  # floor colours
    (6, 6, 16, 13): (122, 92, 64), (16, 6, 28, 13): (176, 170, 160), (28, 6, 42, 13): (128, 128, 124),
    (6, 13, 42, 15): (138, 134, 126), (6, 15, 14, 22): (150, 128, 104), (6, 22, 14, 30): (92, 92, 88),
    (14, 15, 34, 30): (146, 142, 132), (34, 15, 42, 30): (124, 124, 120),
}
for (x0, y0, x1, y1), col in ROOMS.items():
    noise_fill((C(x0), C(y0), C(x1), C(y1)), col, 7)
    for y in range(y0, y1):                                                      # flagstone seams
        d.line((C(x0), C(y), C(x1), C(y)), fill=tuple(c - 22 for c in col), width=1)
    for x in range(x0, x1):
        d.line((C(x), C(y0), C(x), C(y1)), fill=tuple(c - 22 for c in col), width=1)
for (x, y) in HALL_RUBBLE:                                                       # rubble
    for _ in range(9):
        cx, cy, r = C(x) + random.uniform(4, CS - 4), C(y) + random.uniform(4, CS - 4), random.uniform(4, 10)
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(112, 96, 78), outline=(52, 44, 36))
for (x, y) in HEARTH:                                                            # embers
    noise_fill((C(x) + 3, C(y) + 3, C(x + 1) - 3, C(y + 1) - 3), (196, 92, 40), 40)
for (x, y) in GLASS:                                                             # glass shards
    for _ in range(14):
        cx, cy = C(x) + random.uniform(2, CS - 2), C(y) + random.uniform(2, CS - 2)
        d.polygon([(cx, cy), (cx + random.uniform(2, 6), cy + random.uniform(-3, 3)), (cx + random.uniform(-2, 2), cy + random.uniform(3, 6))],
                  fill=random.choice([(200, 70, 70), (70, 120, 200), (220, 200, 90), (120, 190, 120)]))
for _ in range(60):                                                              # fungus
    cx, cy, r = random.uniform(C(6), C(10)), random.uniform(C(26), C(30)), random.uniform(2, 5)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(150, 210, 190))
d.rectangle((C(21), C(7.4), C(23), C(8.2)), fill=(214, 206, 188), outline=(90, 84, 74), width=2)   # altar
for x in range(7, 16, 2):                                                        # bookshelves
    if x != 13:
        d.rectangle((C(x), C(6.2), C(x + 1.6), C(6.7)), fill=(92, 60, 36), outline=(52, 34, 20))
for y in range(34, 46):                                                          # bridge planks
    d.rectangle((C(BRIDGE_X) + 8, C(y) + 2, C(BRIDGE_X + 1) - 8, C(y + 1) - 2), fill=(150, 112, 70), outline=(90, 64, 38))
for (x, y) in [(3, 35), (8, 37), (5, 41), (10, 43), (2, 44), (11, 34)]:          # trees
    d.ellipse((C(x) - 26, C(y) - 26, C(x) + 26, C(y) + 26), fill=(44, 74, 40), outline=(26, 46, 24), width=3)
for s in segs:                                                                   # walls
    a, b = (C(s["a"][0]), C(s["a"][1])), (C(s["b"][0]), C(s["b"][1]))
    t = s["t"]
    if t in ("door", "secret") and t == "door":
        continue                      # doors are drawn by the board
    if t == "secret" or t == "solid":
        d.line((a, b), fill=(46, 36, 30), width=int(CS * 0.28))
    elif t == "window":
        d.line((a, b), fill=(46, 36, 30), width=int(CS * 0.28))
        d.line((a, b), fill=(170, 120, 200) if s.get("sight") == 20 else (180, 220, 235), width=int(CS * 0.12))
    elif t == "slit":
        pass                          # a gap in the wall
    elif t == "grate":
        for k in range(9):
            f = k / 8
            x, y = a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
            d.ellipse((x - 3, y - 3, x + 3, y + 3), fill=(40, 40, 44))
        d.line((a, b), fill=(60, 60, 66), width=3)
    elif t == "terrain":
        d.line((a, b), fill=(150, 40, 46), width=int(CS * 0.12))
    elif t == "ethereal":
        d.line((a, b), fill=(170, 150, 230), width=int(CS * 0.1))
for i, (x, y) in enumerate(PILLARS):                                             # pillars
    d.rectangle((C(x) + 1, C(y) + 1, C(x + 1) - 1, C(y + 1) - 1), fill=(70, 64, 58), outline=(38, 34, 30), width=3)
grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(grid)
for k in range(N + 1):
    gd.line((C(k), 0, C(k), H), fill=(0, 0, 0, 46), width=1)
    gd.line((0, C(k), W, C(k)), fill=(0, 0, 0, 46), width=1)
img = Image.alpha_composite(img.convert("RGBA"), grid).convert("RGB")

# ---------------------------------------------------------------- write
os.makedirs(OUT, exist_ok=True)
img.save(os.path.join(OUT, "sample-keep.webp"), "WEBP", quality=82, method=6)


def dump(name, obj, schema):
    with open(os.path.join(OUT, name), "w") as f:
        json.dump({"$schema": f"../../../../schemas/{schema}", **obj}, f, indent=1)
        f.write("\n")


dump("map.json", {"id": "sample-keep", "name": "Sample Keep",
                  "image": {"file": "sample-keep.webp", "w": W, "h": H},
                  "grid": {"cell_px": CS, "origin_px": [0, 0], "cols": N, "rows": N, "feet_per_cell": 5},
                  "base_light": "dark", "lighting": "lighting.json", "terrain": "terrain.json", "walls": "walls.json",
                  "note": "Original test map generated by tools/samples/sample_keep.py."}, "map.schema.json")
dump("walls.json", {"v": 1, "unit": "cell", "snap": 0.125, "segs": segs}, "walls.schema.json")
dump("terrain.json", {"v": 1, "areas": terrain}, "terrain.schema.json")
dump("lighting.json", lighting, "lighting.schema.json")

setup = {
    "title": "Reliquary Map Engine",
    "subtitle": "Sample Keep (48 × 48) · engine test bench",
    "intro": "The party has split up round the keep: Lyra to the west, Pip to the east, Kerra far to the south on the path, her torch lit. The portcullis is down.",
    "tips": [
        "<b>Lighting on / off</b> (header) switches the whole light system: off, everything counts as bright and sight is walls only, as before lighting existed.",
        "<b>Day or night:</b> use the <b>Sky</b> selector. By day the grounds are bright and daylight comes into the keep through its windows, arrow slits, the portcullis and any open door, fading across each room; at night only lights and darkvision show anything.",
        "<b>Kerra</b> carries a torch, <b>Pip</b> has darkvision (greyscale), <b>Lyra</b> has low-light vision (dim light is clear to her). Select one to see the board through their eyes alone; click empty floor or press Escape to see the whole explored map again.",
        "<b>Get in:</b> the portcullis lets sight through but not feet. The postern door (west) is locked; the GM can open it. Walk the path, the pond's plank bridge (Balance) or the muddy shallows.",
        "<b>The great hall</b> has pillars that block sight, braziers, and a collapsed corner open to the sky (rubble: difficult terrain). The ogre waits inside.",
        "<b>GM view:</b> the map is shaded by light; click a lamp to light it or put it out (the gate torches start unlit); lamp marks are GM-only. <b>Colour:</b> firelight is warm and the cellar fungus green; the GM's <b>Lighting</b> card changes any lamp's or region's colour and intensity, and the header's <b>Colour</b> button switches coloured light off for the whole table. Torches, braziers and the hearth <b>flicker</b>; set any lamp's animation (torch, flicker, pulse, ghostly, chroma) in the Lighting card, switch it all off with <b>Animation</b>, and watch its cost in the bar under the map. Select any token to see its one, two and three Stride outlines (dashed light, medium and dark green). Select a foe the party cannot see to <b>mark it hidden</b>.",
        "<b>Walls to test:</b> stained glass in the chapel (light passes, sight does not), arrow slits in the armoury and tower, a heavy curtain in the tower, a force barrier and fungus glow in the cellar, an illusory wall in the library, a pivoting-bookcase secret door.",
        "<b>Terrain:</b> hearth embers (hazardous), fallen glass (uneven), the pond (Swim), the bluff (Climb), undergrowth. GM: click the cellar's dashed area to flood it.",
        "<b>Sizes:</b> Tiny rats share squares in the cellar, the Large ogre cannot pass 5-ft doors, the Huge giant prowls outside.",
    ],
    "tokens": {
        "kerra": {"name": "Kerra", "kind": "pc", "x": 23, "y": 46, "speed": 25, "short": "K", "light": {"preset": "torch"}, "note": "Carries a lit torch"},
        "pip": {"name": "Pip", "kind": "pc", "x": 44, "y": 27, "speed": 25, "short": "P", "small": True, "senses": ["darkvision"], "note": "Small. Darkvision"},
        "lyra": {"name": "Lyra", "kind": "pc", "x": 2, "y": 18, "speed": 30, "short": "L", "senses": ["low-light"], "note": "Low-light vision"},
        "ogre": {"name": "Ogre", "kind": "foe", "x": 22, "y": 22, "size": 2, "speed": 25, "short": "O", "note": "Large, 2 x 2"},
        "skel1": {"name": "Skeleton", "kind": "foe", "x": 31, "y": 9, "speed": 25, "short": "S"},
        "skel2": {"name": "Skeleton", "kind": "foe", "x": 37, "y": 11, "speed": 25, "short": "S"},
        "cultist": {"name": "Cultist", "kind": "foe", "x": 24, "y": 9, "speed": 25, "short": "C", "light": {"preset": "hooded-lantern"}, "note": "Carries a lantern: seen from the dark"},
        "guard": {"name": "Tower guard", "kind": "foe", "x": 38, "y": 25, "speed": 25, "short": "G"},
        "imp": {"name": "Imp", "kind": "foe", "x": 8, "y": 9, "size": 0.5, "speed": 20, "short": "i", "note": "Tiny"},
        "rat1": {"name": "Rat", "kind": "foe", "x": 12, "y": 27, "size": 0.5, "speed": 20, "short": "r"},
        "rat2": {"name": "Rat", "kind": "foe", "x": 12, "y": 27, "size": 0.5, "speed": 20, "short": "r"},
        "rat3": {"name": "Rat", "kind": "foe", "x": 13, "y": 28, "size": 0.5, "speed": 20, "short": "r"},
        "giant": {"name": "Hill giant", "kind": "foe", "x": 16, "y": 1, "size": 3, "speed": 35, "short": "H", "note": "Huge, 3 x 3"},
    },
}
with open(SETUP, "w") as f:
    json.dump(setup, f, indent=2, ensure_ascii=False)
    f.write("\n")
print(f"{len(segs)} wall segments, {len(terrain)} terrain areas, {len(lighting['regions'])} regions, {len(lighting['lights'])} lights")
