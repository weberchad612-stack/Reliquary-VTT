"""Step 7 of the map importer: lighting (regions open to the sky or with a fixed light level, and static
light sources) from the settings' "lighting" block, the walls and the terrain. See docs/design/lighting.md.

    "lighting": {
      "outdoor": false,               the whole map is lit by the sky (then regions mark what is not)
      "base": "dark",                 an indoor map's level away from regions and lights
      "regions": [{"id", "level": "sky"|"bright"|"dim"|"dark", "label"?, "room"?, "note",
                   "select": [selector, ...], "minus": [selector, ...]}],
      "lights": [{"id", "at": [x, y], "preset"? | "bright"?, "dim"?, "walls"?, "angle"?, "rotation"?,
                  "on"?, "label"?, "room"?, "note"}]
    }

Selectors are the terrain step's (cells, rects, poly, room_at; see terrain.py) plus:
    {"terrain": "rubble"}             the squares of every terrain area whose id is, or starts with, "rubble-"
    {"outside": {"from": [x, y], "seal": [[[x0, y0], [x1, y1]], ...]}}
        everything reachable from that point without crossing a wall or a closed door, with no size limit
        (the outdoors); "seal" lines close openings that join the outdoors to rooms (a breach) for this fill
Squares in hidden areas never get regions.
"""
from mapimport import terrain as T

REGION_FIELDS = ("level", "label", "room", "note")


def area_cells(a):
    """Squares of a terrain area ({cells?, rects?})."""
    out = {tuple(c) for c in a.get("cells", [])}
    for x, y, w, h in a.get("rects", []):
        out |= {(x + i, y + j) for j in range(h) for i in range(w)}
    return out
LIGHT_FIELDS = ("at", "preset", "rank", "bright", "dim", "walls", "angle", "rotation", "on", "label", "room", "note")


def build_lighting(block, g, segs, terrain_areas, report, keyed_rooms=None, hidden=()):
    """(map fields, lighting.json content or None) from the settings' lighting block."""
    if not block:
        return {}, None
    grid = {"cols": int(g["cols"]), "rows": int(g["rows"])}
    rooms = T.room_finder(segs, grid)
    in_hidden = lambda c: any(r[0] <= c[0] + 0.5 <= r[2] and r[1] <= c[1] + 0.5 <= r[3] for r in hidden)

    def cells_of(sel):
        if "terrain" in sel:
            p = sel["terrain"]
            return {c for a in terrain_areas if a["id"] == p or a["id"].startswith(p + "-")
                    for c in area_cells(a)}
        if "outside" in sel:
            o = sel["outside"]
            seals = [{"t": "solid", "a": a, "b": b} for a, b in o.get("seal", [])]
            fill = T.room_finder(segs + seals, grid, max_cells=grid["cols"] * grid["rows"])
            return fill(o["from"])
        return T._cells_of(sel, grid, rooms)

    regions = []
    for i, r in enumerate(block.get("regions", []), 1):
        cells = set()
        for s in r.get("select", []):
            cells |= cells_of(s)
        for s in r.get("minus", []):
            cells -= cells_of(s)
        cells = {c for c in cells if 0 <= c[0] < grid["cols"] and 0 <= c[1] < grid["rows"] and not in_hidden(c)}
        reg = {"id": r.get("id") or f"r{i:02d}"}
        for k in REGION_FIELDS:
            if k in r:
                reg[k] = r[k]
        if not cells:
            report.setdefault("warnings", []).append(f"lighting region {reg['id']}: no squares selected")
            continue
        reg["rects"] = T.cells_to_rects(sorted(cells))
        regions.append(reg)
        report["applied"].append({"lighting_region": reg["id"], "level": r["level"], "squares": len(cells), "note": r.get("note", "")})
    lights = []
    for i, l in enumerate(block.get("lights", []), 1):
        light = {"id": l.get("id") or f"l{i:02d}"}
        for k in LIGHT_FIELDS:
            if k in l:
                light[k] = l[k]
        if "preset" not in light and light.get("bright", 0) > 0 and not light.get("dim"):
            # allowed (the engine adds a thin dim fringe), but a static light should give both radii
            report.setdefault("warnings", []).append(
                f"light {light['id']}: bright light but no dim radius; give the dim radius from the text "
                "(the board fades it over a fringe of a tenth of the bright radius otherwise)")
        lights.append(light)
        report["applied"].append({"light": light["id"], "note": l.get("note", "")})
    fields = {}
    if block.get("outdoor"):
        fields["outdoor"] = True
    elif "base" in block:
        fields["base_light"] = block["base"]
    content = {"v": 1}
    if regions:
        content["regions"] = regions
    if lights:
        content["lights"] = lights
    return fields, content if (regions or lights) else None
