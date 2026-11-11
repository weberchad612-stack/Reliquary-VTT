"""Generate the Sample Village: an original area map (a small town) for tests and the test campaigns.

    python3 tools/samples/sample_village.py

Writes examples/sample-pack/maps/sample-village/{map.json, sample-village.webp}. Everything here is
original (no book content), so it may be committed and published.

An area map has no grid, walls or tokens: a picture with places (docs/design/maps.md, section 3).
The village: a river running south through the middle with a bridge, a market square, a few houses,
a chapel, a tavern, the old keep's road to the north-west and the crypt's lane to the south-west.
Places cover each case the board handles: public places and a GM-only place (the smugglers' cellar).
The board's map menu is the way to the keep and the crypt; the roads drawn at the edges are scenery.
"""
import json
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "examples", "sample-pack", "maps", "sample-village")
W, H = 1000, 760
random.seed(11)

GRASS = (128, 142, 92)
ROAD = (176, 152, 112)
WATER = (86, 128, 150)
ROOF = [(150, 74, 52), (120, 62, 46), (136, 96, 64), (104, 84, 70)]
WALL = (214, 196, 160)
INK = (38, 32, 26)

img = Image.new("RGB", (W, H), GRASS)
d = ImageDraw.Draw(img)

# Mottled grass.
for _ in range(2600):
    x, y = random.randrange(W), random.randrange(H)
    r = random.randint(3, 10)
    g = random.randint(-14, 14)
    d.ellipse((x - r, y - r, x + r, y + r), fill=(GRASS[0] + g, GRASS[1] + g, GRASS[2] + g // 2))
img = img.filter(ImageFilter.GaussianBlur(2))
d = ImageDraw.Draw(img)


def river(points, width):
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        d.line((x0, y0, x1, y1), fill=WATER, width=width)
        d.ellipse((x1 - width / 2, y1 - width / 2, x1 + width / 2, y1 + width / 2), fill=WATER)


def road(points, width=26):
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        d.line((x0, y0, x1, y1), fill=ROAD, width=width)
    for x, y in points:
        d.ellipse((x - width / 2, y - width / 2, x + width / 2, y + width / 2), fill=ROAD)


# The river, north to south, a little east of the middle.
river([(560, -20), (548, 120), (575, 260), (552, 400), (590, 540), (570, 680), (585, 790)], 46)
# Roads: north-west to the keep, the main street east-west over the bridge, south-west to the crypt, east.
road([(-20, 60), (150, 140), (300, 250), (420, 330)])
road([(160, 380), (420, 330), (700, 360), (1020, 330)])
road([(420, 330), (380, 520), (250, 640), (120, 790)])
road([(700, 360), (760, 520), (860, 640)], 20)
# The bridge.
d.rectangle((540, 318, 600, 372), fill=(118, 92, 62))
for x in range(544, 600, 8):
    d.line((x, 320, x, 370), fill=(92, 70, 46), width=2)
# The market square.
d.rectangle((330, 280, 470, 390), fill=(186, 166, 126))
for _ in range(10):
    x, y = random.randint(345, 455), random.randint(295, 375)
    d.rectangle((x - 7, y - 5, x + 7, y + 5), fill=random.choice([(170, 60, 50), (60, 90, 140), (200, 170, 70)]), outline=INK)


def house(x, y, w, h, roof=None):
    roof = roof or random.choice(ROOF)
    d.rectangle((x + 3, y + 3, x + w + 3, y + h + 3), fill=(70, 70, 50))
    d.rectangle((x, y, x + w, y + h), fill=roof, outline=INK, width=2)
    if w >= h:
        d.line((x, y + h / 2, x + w, y + h / 2), fill=INK, width=2)
    else:
        d.line((x + w / 2, y, x + w / 2, y + h), fill=INK, width=2)


# Houses along the streets.
for (x, y, w, h) in [(200, 300, 46, 34), (260, 292, 40, 30), (470, 250, 44, 36), (640, 280, 50, 36), (720, 286, 40, 34),
                     (800, 300, 46, 30), (650, 400, 40, 44), (730, 410, 44, 36), (300, 420, 46, 36), (470, 410, 40, 40),
                     (210, 470, 44, 34), (480, 470, 38, 40), (820, 380, 40, 40)]:
    house(x, y, w, h)
# Named buildings.
house(240, 200, 70, 50, (110, 60, 48))        # the tavern
house(620, 170, 60, 80, (96, 96, 110))        # the chapel
d.ellipse((636, 150, 664, 178), fill=(96, 96, 110), outline=INK, width=2)   # its bell tower
house(760, 470, 64, 46, (90, 80, 72))         # the smithy
d.ellipse((780, 450, 796, 466), fill=(70, 60, 54))   # the forge chimney
house(330, 560, 54, 40, (120, 100, 80))       # the old warehouse (the smugglers' cellar is under it)
house(880, 200, 60, 46, (128, 90, 60))        # the mill
d.rectangle((944, 196, 956, 250), fill=(96, 70, 44), outline=INK)   # its wheel, edge-on in the mill race
for yy in range(200, 250, 7):
    d.line((942, yy, 958, yy), fill=INK, width=2)
# Trees.
for _ in range(90):
    x, y = random.randrange(W), random.randrange(H)
    if 300 < x < 900 and 150 < y < 600 and random.random() < 0.8:
        continue
    r = random.randint(9, 17)
    d.ellipse((x - r + 3, y - r + 3, x + r + 3, y + r + 3), fill=(62, 78, 46))
    d.ellipse((x - r, y - r, x + r, y + r), fill=(74, 104, 58), outline=(50, 66, 38))
# Numbers by the public places.
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", 20)
small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", 16)
NUMBERS = {"1": (275, 225), "2": (400, 335), "3": (650, 210), "4": (792, 493), "5": (910, 223)}
for n, (x, y) in NUMBERS.items():
    d.ellipse((x - 14, y - 14, x + 14, y + 14), fill=(244, 236, 214), outline=INK, width=2)
    d.text((x, y), n, fill=INK, font=font, anchor="mm")
for text, (x, y) in {"To the old keep": (110, 92), "To the crypt": (150, 700), "Riverside road": (930, 300)}.items():
    d.text((x, y), text, fill=(250, 244, 226), font=small, anchor="mm", stroke_width=3, stroke_fill=INK)
d.text((W - 20, H - 18), "Sample Village", fill=(250, 244, 226), font=font, anchor="rs", stroke_width=3, stroke_fill=INK)

os.makedirs(OUT, exist_ok=True)
img.save(os.path.join(OUT, "sample-village.webp"), "WEBP", quality=86, method=6)

places = [
    {"id": "tavern", "name": "The Leaning Lantern", "type": "Tavern and inn", "address": "3 Bridge Street",
     "note": "A crooked two-storey inn; the lamp over the door has hung askew for forty years.", "at": [275, 225]},
    {"id": "market", "name": "Market Square", "type": "Market", "address": "Market Square",
     "note": "Stalls most mornings; a notice board by the well.", "at": [400, 335]},
    {"id": "chapel", "name": "Chapel of the Dawn", "type": "Chapel", "address": "1 Bell Lane",
     "note": "A slate-roofed chapel with a small bell tower.", "at": [650, 210]},
    {"id": "smithy", "name": "Harrow's Forge", "type": "Smithy", "address": "12 Riverside Road",
     "note": "Tools, horseshoes and the occasional blade.", "at": [792, 493]},
    {"id": "mill", "name": "The Old Mill", "type": "Watermill", "address": "Mill Lane",
     "note": "The wheel still turns; the miller grinds for the whole valley.", "at": [910, 223]},
    {"id": "riverside", "name": "Riverside road", "type": "Road", "note": "The road east along the river, toward the farms.",
     "at": [930, 300], "shape": "wide", "size": 150},
    {"id": "cellar", "name": "Smugglers' cellar", "type": "Hidden cellar", "address": "Under the old warehouse",
     "note": "A cellar under the warehouse floor, reached by a trapdoor behind the barrels.",
     "gm_note": "GM only until the party finds the trapdoor (Seek DC 20 in the warehouse).", "at": [357, 580], "public": False},
]
map_json = {
    "$schema": "../../../../schemas/map.schema.json",
    "id": "sample-village",
    "name": "Sample Village",
    "kind": "area",
    "image": {"file": "sample-village.webp", "w": W, "h": H},
    "places": places,
    "note": "Original area map generated by tools/samples/sample_village.py.",
}
with open(os.path.join(OUT, "map.json"), "w") as f:
    json.dump(map_json, f, indent=2, ensure_ascii=False)
    f.write("\n")
print("wrote", OUT)
