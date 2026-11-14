"""Step 6 of the map importer: terrain (difficult terrain, water, slopes) from the settings, the art
and the walls.

Terrain is written by Claude from the adventure text and the map, square by square or with help from
the art. Each area in the settings' "terrain" block:

    {"id"?, "kind", "cause"?, "label"?, "room"?, "dc"?, "damage"?, "magical"?, "active"?, "note",
     "select": [selector, ...],     squares to consider (union); the whole map when missing
     "art": {"class": name, "min_cover": 0.45},   keep squares whose art is at least this much of the class
     "plus": [selector, ...],       squares to add after the art test (art drawn over the terrain: a
                                    compass rose on water)
     "minus": [selector, ...],      squares to leave out
     "keep_walls": false,           squares that are mostly wall are dropped unless this is true
     "split": false,                one area per keyed room (ids <id>-<room>, or <id>-outside), so a
                                    room's rubble can be cleared on its own
     "room_overrides": [{"room", "select": [selector, ...]}]}   with split: groups touching these squares
                                    belong to that room (rubble spilled out of a collapsed room)

Squares in the map's hidden areas (insets of other maps) never get terrain.

Keyed rooms: the settings' "rooms" block maps each room label to a point inside it, in cells (from the
book's labelled map, registered to the image). Split areas take their room from it: each connected group
of squares goes to the nearest room label whose flood fill (walls and closed doors stop it, within
ROOM_REACH squares of the label) reaches the group.

Selectors, all in cells:
    {"cells": [[x, y], ...]}            these squares
    {"rects": [[x, y, w, h], ...]}      rectangles of squares
    {"poly": [[x, y], ...]}             squares whose centre is inside the polygon
    {"room_at": [x, y], "clip"?: [x0, y0, x1, y1]}
        the room containing that point: squares reachable without crossing a wall or a closed door
        (every door counts as closed), optionally kept inside a rectangle. A room that leaks (through a
        breach or a drawn opening) is an error unless clipped.

Art classes ("classes" in the block) are colour ranges sampled from the map, like the wall mask:
    "rubble": {"hsv": [[h0, h1], [s0, s1], [v0, v1]]}   (OpenCV HSV: hue 0-180)
Cover is the share of a square's pixels in the class, walls excluded. Colour is only reliable where
the class stands out from its surroundings (rubble on a stone floor, water against land): restrict it
with "select" (a room, a region) wherever the surroundings share the colour (rubble on brown grass).
"""
import math

import cv2
import numpy as np

BLOCKS_MOVE = {"solid", "terrain", "grate", "window", "slit", "door", "secret", "veil"}
ROOM_MAX_CELLS = 600
ROOM_REACH = 12


def _cells_of(sel, grid, rooms):
    out = set()
    for x, y in sel.get("cells", []):
        out.add((int(x), int(y)))
    for x, y, w, h in sel.get("rects", []):
        for j in range(int(h)):
            for i in range(int(w)):
                out.add((int(x) + i, int(y) + j))
    if "poly" in sel:
        poly = np.array(sel["poly"], np.float64)
        for y in range(grid["rows"]):
            for x in range(grid["cols"]):
                if cv2.pointPolygonTest(poly.astype(np.float32), (x + 0.5, y + 0.5), False) >= 0:
                    out.add((x, y))
    if "room_at" in sel:
        cells = rooms(sel["room_at"], sel.get("clip"))
        out |= cells
    return out


def _crosses(p1, p2, a, b):
    d = lambda ax, ay, bx, by: ax * by - ay * bx
    r = (p2[0] - p1[0], p2[1] - p1[1]); q = (b[0] - a[0], b[1] - a[1])
    den = d(r[0], r[1], q[0], q[1])
    if abs(den) < 1e-12:
        return False
    w = (a[0] - p1[0], a[1] - p1[1])
    t = d(w[0], w[1], q[0], q[1]) / den
    u = d(w[0], w[1], r[0], r[1]) / den
    return 0 <= t <= 1 and 0 <= u <= 1


def room_finder(segs, grid, max_cells=ROOM_MAX_CELLS):
    """Returns rooms(point, clip) -> set of cells: flood fill between square centres, stopped by any wall
    that blocks movement (doors closed). A fill larger than max_cells is an error (a leaking room)."""
    blockers = [s for s in segs if s["t"] in BLOCKS_MOVE]
    # bucket segments by the squares they pass near, for speed
    buckets = {}
    for s in blockers:
        x0, x1 = sorted((s["a"][0], s["b"][0])); y0, y1 = sorted((s["a"][1], s["b"][1]))
        for cy in range(int(math.floor(y0)) - 1, int(math.floor(y1)) + 2):
            for cx in range(int(math.floor(x0)) - 1, int(math.floor(x1)) + 2):
                buckets.setdefault((cx, cy), []).append(s)

    def open_between(c, n):
        p1 = (c[0] + 0.5, c[1] + 0.5); p2 = (n[0] + 0.5, n[1] + 0.5)
        cand = buckets.get(c, []) + buckets.get(n, [])
        return not any(_crosses(p1, p2, s["a"], s["b"]) for s in cand)

    def rooms(point, clip=None):
        start = (int(math.floor(point[0])), int(math.floor(point[1])))
        inside = (lambda c: clip[0] <= c[0] + 0.5 <= clip[2] and clip[1] <= c[1] + 0.5 <= clip[3]) if clip else (lambda c: True)
        seen, todo = {start}, [start]
        while todo:
            c = todo.pop()
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (c[0] + dx, c[1] + dy)
                if n in seen or not (0 <= n[0] < grid["cols"] and 0 <= n[1] < grid["rows"]) or not inside(n):
                    continue
                if open_between(c, n):
                    seen.add(n); todo.append(n)
            if len(seen) > max_cells:
                raise ValueError(f"room at {point} leaks (more than {max_cells} squares): give it a clip rectangle")
        return seen
    return rooms


def cover_grid(mask, g):
    """Share of each square's pixels that are set in mask, as a rows x cols array."""
    cs = g["cell_px"]; ox, oy = g["origin_px"]
    out = np.zeros((g["rows"], g["cols"]))
    h, w = mask.shape
    for y in range(g["rows"]):
        for x in range(g["cols"]):
            x0, y0 = int(round(ox + x * cs)), int(round(oy + y * cs))
            x1, y1 = int(round(ox + (x + 1) * cs)), int(round(oy + (y + 1) * cs))
            sub = mask[max(0, y0):min(h, y1), max(0, x0):min(w, x1)]
            out[y, x] = float(sub.mean()) if sub.size else 0.0
    return out


def class_mask(rgb, spec, wall):
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV).astype(int)
    (h0, h1), (s0, s1), (v0, v1) = spec["hsv"]
    m = (hsv[..., 0] >= h0) & (hsv[..., 0] <= h1) & (hsv[..., 1] >= s0) & (hsv[..., 1] <= s1) & (hsv[..., 2] >= v0) & (hsv[..., 2] <= v1)
    near_wall = cv2.dilate(wall.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    return m & ~near_wall


def cells_to_rects(cells):
    """Same as engine/terrain/terrain.js cellsToRects: row runs stacked into rectangles."""
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
    open_, rects = {}, []
    for x, y, w in runs:
        r = open_.get((x, w))
        if r and r[1] + r[3] == y:
            r[3] += 1
        else:
            r = [x, y, w, 1]; rects.append(r); open_[(x, w)] = r
    return rects


AREA_FIELDS = ("kind", "cause", "magical", "active", "dc", "damage", "label", "note", "room")


def groups_of(cells):
    """Connected groups (4-neighbour) of a set of squares, largest first."""
    left, out = set(cells), []
    while left:
        start = left.pop(); group, todo = {start}, [start]
        while todo:
            x, y = todo.pop()
            for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if n in left:
                    left.remove(n); group.add(n); todo.append(n)
        out.append(group)
    return sorted(out, key=lambda g: (-len(g), min(g)))


def room_labeller(keyed, rooms):
    """Returns label(group) -> keyed room name or None, from the settings' rooms block."""
    floods = {}
    for name, (x, y) in (keyed or {}).items():
        clip = [x - ROOM_REACH, y - ROOM_REACH, x + ROOM_REACH, y + ROOM_REACH]
        try:
            floods[name] = rooms([x, y], clip)
        except ValueError:
            floods[name] = set()

    def label(group):
        # Of the rooms whose flood fill reaches the group, the one whose label is nearest. Labels of open
        # areas (a courtyard, a breached room) flood far, so reaching alone is not enough.
        cx = sum(c[0] + 0.5 for c in group) / len(group)
        cy = sum(c[1] + 0.5 for c in group) / len(group)
        best, bd = None, float("inf")
        for name, cells in floods.items():
            if not group & cells:
                continue
            x, y = keyed[name]
            d = math.hypot(x - cx, y - cy)
            if d < bd:
                best, bd = name, d
        return best
    return label


def build_terrain(block, rgb, g, wall, segs, report, keyed_rooms=None, hidden=()):
    """Terrain areas for terrain.json from the settings' terrain block. `hidden`: [x0, y0, x1, y1] cell
    rectangles of the map's hidden areas; squares whose centre lies in one get no terrain."""
    if not block:
        return []
    grid = {"cols": int(g["cols"]), "rows": int(g["rows"])}
    rooms = room_finder(segs, grid)
    room_of = room_labeller(keyed_rooms, rooms)
    in_hidden = lambda c: any(r[0] <= c[0] + 0.5 <= r[2] and r[1] <= c[1] + 0.5 <= r[3] for r in hidden)
    wall_cover = cover_grid(wall, g)
    covers = {name: cover_grid(class_mask(rgb, spec, wall), g) for name, spec in block.get("classes", {}).items()}
    everything = {(x, y) for y in range(grid["rows"]) for x in range(grid["cols"])}
    areas = []
    for i, a in enumerate(block.get("areas", []), 1):
        sel = set()
        for s in a.get("select", []):
            sel |= _cells_of(s, grid, rooms)
        if not a.get("select"):
            sel = set(everything)
        if "art" in a:
            cov, need = covers[a["art"]["class"]], a["art"].get("min_cover", 0.45)
            sel = {c for c in sel if cov[c[1], c[0]] >= need}
        for s in a.get("plus", []):
            sel |= _cells_of(s, grid, rooms)
        for s in a.get("minus", []):
            sel -= _cells_of(s, grid, rooms)
        if not a.get("keep_walls"):
            sel = {c for c in sel if wall_cover[c[1], c[0]] < 0.5}
        sel = {c for c in sel if 0 <= c[0] < grid["cols"] and 0 <= c[1] < grid["rows"] and not in_hidden(c)}
        base = {"id": a.get("id") or f"t{i:02d}"}
        for k in AREA_FIELDS:
            if k in a:
                base[k] = a[k]
        if not sel:
            report.setdefault("warnings", []).append(f"terrain {base['id']} ({a.get('label', a['kind'])}): no squares selected")
            continue
        parts = [(base, sel)]
        if a.get("split"):
            by_room = {}
            forced = [(o["room"], set().union(*[_cells_of(s, grid, rooms) for s in o["select"]]))
                      for o in a.get("room_overrides", [])]
            for group in groups_of(sel):
                room = next((r for r, cells in forced if group & cells), None) or room_of(group)
                by_room.setdefault(room, set()).update(group)
            order = sorted(by_room, key=lambda r: (r is None, int(r[1:]) if r and r[1:].isdigit() else 0, r or ""))
            parts = []
            for room in order:
                part = dict(base, id=f"{base['id']}-{room or 'outside'}")
                if room:
                    part["room"] = room
                if "label" in base:
                    part["label"] = f"{base['label']} ({room})" if room else f"{base['label']} (outside)"
                parts.append((part, by_room[room]))
        for area, cells in parts:
            area["rects"] = cells_to_rects(sorted(cells))
            areas.append(area)
            report["applied"].append({"terrain": area["id"], "kind": a["kind"], "squares": len(cells), "note": a.get("note", "")})
    ids = [x["id"] for x in areas]
    dup = {x for x in ids if ids.count(x) > 1}
    if dup:
        raise ValueError(f"terrain area ids used twice: {sorted(dup)}")
    return areas
