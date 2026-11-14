#!/usr/bin/env python3
"""The private review page for an imported adventure: one self-contained HTML file for the user to check the import.

Usage:
    python3 tools/advimport/review.py <pack-dir> [--save <save-dir>] [--out <pack-dir>/review.html]

Shows, per map: the map with its walls, doors, room keys, the cast's start squares and the objects drawn over it;
the room table; the cast (art, name, stat block, start, hidden, the book's differences); the objects (contents, DCs);
then the token art sheet, the illustrations index, the ledger entries, the GM notes, every import decision and the
validator's warnings. Images are embedded (the page works offline). It holds the publisher's art and maps: deliver
it as a file, never publish it.
"""
import argparse
import base64
import html
import io
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
esc = lambda s: html.escape(str(s if s is not None else ""))


def data_url(img, fmt="WEBP", q=80):
    b = io.BytesIO()
    img.save(b, fmt, quality=q)
    return f"data:image/{fmt.lower()};base64," + base64.b64encode(b.getvalue()).decode()


def map_figure(pack, mid, adv, rooms, ppc=36):
    d = os.path.join(pack, "maps", mid)
    m = json.load(open(os.path.join(d, "map.json")))
    g = m["grid"]
    img = Image.open(os.path.join(d, m["image"]["file"])).convert("RGB")
    k = ppc / g["cell_px"]
    img = img.resize((int(img.width * k), int(img.height * k)), Image.LANCZOS)
    ox, oy = g["origin_px"][0] * k, g["origin_px"][1] * k
    P = lambda x, y: (ox + x * ppc, oy + y * ppc)
    dr = ImageDraw.Draw(img, "RGBA")
    col = {"solid": (0, 0, 0, 255), "door": (220, 60, 50, 255), "secret": (230, 180, 40, 255), "window": (80, 200, 230, 255),
           "ethereal": (160, 110, 230, 255), "terrain": (240, 140, 40, 255)}
    for s in json.load(open(os.path.join(d, m["walls"])))["segs"]:
        dr.line([P(*s["a"]), P(*s["b"])], fill=col.get(s["t"], (0, 0, 0, 255)), width=3 if s["t"] != "solid" else 2)
    for key, r in (rooms or {}).items():
        x, y = P(*r["at"])
        dr.rounded_rectangle([x - 16, y - 10, x + 16, y + 10], 6, fill=(250, 245, 230, 230), outline=(80, 50, 20, 255))
        dr.text((x - 13, y - 6), key[:5], fill=(80, 30, 10, 255))
    for e in adv.get("encounters", []):
        if e["map"] != mid:
            continue
        for c in e["creatures"]:
            x, y = P(c["at"][0] // 1 + 0.5, c["at"][1] // 1 + 0.5)
            dr.ellipse([x - 10, y - 10, x + 10, y + 10], fill=(230, 80, 70, 200) if not e.get("friendly") else (220, 180, 60, 200), outline=(0, 0, 0, 255))
    for o in adv.get("objects", []):
        if o["map"] != mid:
            continue
        x, y = P(o["at"][0] // 1 + 0.5, o["at"][1] // 1 + 0.5)
        dr.rounded_rectangle([x - 8, y - 8, x + 8, y + 8], 3, fill=(160, 128, 96, 220), outline=(0, 0, 0, 255))
    return m, data_url(img)


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pack")
    ap.add_argument("--save")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    pack = a.pack
    adv = json.load(open(os.path.join(pack, "adventure.json")))
    art = json.load(open(os.path.join(pack, "art", "art.json"))) if os.path.exists(os.path.join(pack, "art", "art.json")) else {}
    ill_f = os.path.join(pack, "art", "illustrations.json")
    ills = json.load(open(ill_f))["illustrations"] if os.path.exists(ill_f) else []
    thumb = {}
    for key, s in art.items():
        im = Image.open(os.path.join(pack, "art", s["token"])).convert("RGB").resize((72, 72), Image.LANCZOS)
        thumb[key] = data_url(im)
    out = [f"<!DOCTYPE html><html lang=en><head><meta charset=utf-8><title>Import review: {esc(adv.get('title'))}</title><style>"
           "body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#16181c;color:#e8e6e1}main{max-width:1200px;margin:auto;padding:24px}"
           "h1,h2,h3{font-family:Georgia,serif;color:#f0c674}h2{border-bottom:1px solid #333;padding-bottom:4px;margin-top:40px}"
           "table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border-bottom:1px solid #2c2f36;padding:5px 8px;text-align:left;vertical-align:top}"
           "th{color:#aab}img.map{max-width:100%;border-radius:6px}img.tok{width:48px;height:48px;border-radius:50%;object-fit:cover}"
           ".warn{color:#e3a443}.muted{color:#9aa0aa}.pill{display:inline-block;padding:0 6px;border-radius:9px;background:#333;font-size:12px}"
           "pre{white-space:pre-wrap;background:#1d2026;padding:12px;border-radius:6px}details{margin:6px 0}summary{cursor:pointer;color:#f0c674}"
           ".grid{display:flex;flex-wrap:wrap;gap:10px}.card{background:#1d2026;border-radius:8px;padding:8px;width:200px}.card img{max-width:100%;max-height:220px;display:block;margin:auto}</style></head><body><main>"]
    out.append(f"<h1>Import review: {esc(adv.get('title'))}</h1><p class=muted>{esc(adv.get('book'))}, pp {esc(adv.get('pages'))}. "
               f"Private: this page holds the publisher's maps and art. Red discs: creatures' start squares; brown squares: objects; labels: room keys; "
               f"walls black, doors red, secret doors and veils gold, see-through edges cyan, crawl-under walls violet, low walls orange.</p>")
    n_cre = sum(len(e["creatures"]) for e in adv.get("encounters", []))
    out.append(f"<p><b>{len(adv.get('maps', []))}</b> maps · <b>{len(adv.get('encounters', []))}</b> encounters · <b>{n_cre}</b> creatures · "
               f"<b>{len(adv.get('objects', []))}</b> objects · <b>{len(art)}</b> creature art · <b>{len(ills)}</b> illustrations · "
               f"<b>{len(adv.get('ambient', []))}</b> ambient sounds · <b>{len(adv.get('ledger', []))}</b> ledger entries</p>")
    for mid in adv.get("maps", []):
        rf = os.path.join(pack, "maps", mid, "rooms.json")
        rooms = json.load(open(rf))["rooms"] if os.path.exists(rf) else {}
        md = os.path.join(pack, "maps", mid)
        mj = json.load(open(os.path.join(md, "map.json")))
        if "grid" not in mj:   # a landing page or an area map: the picture and its places, no walls or cast
            im = Image.open(os.path.join(md, mj["image"]["file"])).convert("RGB")
            im.thumbnail((900, 900))
            out.append(f"<h2>{esc(mj['name'])} <small>({esc(mj.get('kind'))})</small></h2><img class=map src='{data_url(im)}' alt='{esc(mj['name'])}'>")
            if mj.get("places"):
                out.append("<h3>Places</h3><table><tr><th>No.</th><th>Name</th><th>Public</th><th>Note</th></tr>")
                for p_ in mj["places"]:
                    out.append(f"<tr><td>{esc(p_.get('number'))}</td><td>{esc(p_['name'])}</td><td>{'yes' if p_.get('public', True) else 'GM only'}</td><td>{esc(p_.get('note'))}</td></tr>")
                out.append("</table>")
            continue
        m, url = map_figure(pack, mid, adv, rooms)
        imp = next((json.load(open(os.path.join(md, f))) for f in ("import.json", "genmap.json") if os.path.exists(os.path.join(md, f))), {})
        out.append(f"<h2>{esc(m['name'])}</h2><img class=map src='{url}' alt='{esc(m['name'])}'>")
        out.append("<h3>Rooms</h3><table><tr><th>Key</th><th>Title</th><th>Pages</th><th>Squares</th></tr>")
        for k, r in rooms.items():
            out.append(f"<tr><td>{esc(k)}</td><td>{esc(r.get('title'))}</td><td>{esc(r.get('pages'))}</td><td>{sum(x[2] * x[3] for x in r['rects'])}</td></tr>")
        out.append("</table><h3>Cast</h3><table><tr><th></th><th>Name</th><th>Encounter</th><th>Stat block</th><th>Start</th><th>Notes</th></tr>")
        for e in adv.get("encounters", []):
            if e["map"] != mid:
                continue
            for c in e["creatures"]:
                pic = f"<img class=tok src='{thumb[c['art']]}' alt=''>" if c.get("art") in thumb else "<span class=warn>no art</span>"
                diff = " ".join(p for p in [("rules: " + ", ".join(r.get("label", r["key"]) for r in c["rules"])) if c.get("rules") else "", ("stats: " + json.dumps(c["stats"])) if c.get("stats") else ""] if p)
                out.append(f"<tr><td>{pic}</td><td>{esc(c['name'])}{(' <span class=pill>alias ' + esc(c['alias']) + '</span>') if c.get('alias') else ''}</td>"
                           f"<td>{esc(e['room'])} · {esc(e['id'])}{' <span class=pill>hidden</span>' if e.get('hidden') else ''}{' <span class=pill>friendly</span>' if e.get('friendly') else ''}<br><span class=muted>{esc(e.get('trigger'))}</span></td>"
                           f"<td>{esc(c.get('ref') or '— (no stat block)')}</td><td>{esc(c['at'])}</td><td>{esc(c.get('note'))} {esc(diff)} {esc(c.get('stats_note'))}</td></tr>")
        out.append("</table><h3>Objects</h3><table><tr><th>Object</th><th>Room</th><th>Inside</th><th>GM</th></tr>")
        for o in adv.get("objects", []):
            if o["map"] != mid:
                continue
            items = ", ".join(esc((i.get("name") or i.get("ref", "")) + (f" ×{i['qty']}" if i.get("qty") else "")) for i in o.get("items", []))
            if o.get("coins"):
                items += (", " if items else "") + esc(" ".join(f"{v} {k}" for k, v in o["coins"].items()))
            tags = " ".join(f"<span class=pill>{esc(t)}</span>" for t in [o["kind"], "hidden" if o.get("hidden") else "", f"find DC {o['find_dc']}" if o.get("find_dc") else "", "locked" if o.get("locked") else ""] if t)
            out.append(f"<tr><td>{esc(o['name'])} {tags}</td><td>{esc(o['room'])}</td><td>{items or '<span class=muted>—</span>'}</td><td>{esc(o.get('note'))} {esc(o.get('locked'))}</td></tr>")
        out.append("</table>")
        if imp.get("decisions"):
            out.append("<h3>Decisions</h3><ul>" + "".join(f"<li>{esc(x)}</li>" for x in imp["decisions"]) + "</ul>")
        notes = [x for x in imp.get("add", []) + imp.get("erase", []) + imp.get("doors", []) if x.get("note") and "hand-placed" not in x["note"] and "Room interior" not in x["note"] and x["note"] not in ("map frame", "roof edge", "see above", "see the west leaf", "see the north leaf")]
        out.append(f"<details><summary>Corrections with their reasons ({len(notes)})</summary><ul>" + "".join(f"<li>{esc(x['note'])}</li>" for x in notes) + "</ul></details>")
    out.append("<h2>Creature art</h2><p class=muted>From the adventure PDF unless noted. Left: the token; the Quick-View shows the whole picture.</p><div class=grid>")
    for key, s in art.items():
        full = Image.open(os.path.join(pack, "art", s["full"])).convert("RGB")
        full.thumbnail((380, 380))
        out.append(f"<div class=card><img class=tok src='{thumb[key]}' alt='' style='width:72px;height:72px'><img src='{data_url(full)}' alt='{esc(key)}'><div>{esc(key)}</div><div class=muted>{esc(s.get('source'))}</div></div>")
    out.append("</div><p>Web art used: <b>none</b>.</p>")
    if ills:
        out.append("<h2>Illustrations to show at the table</h2><div class=grid>")
        for i in ills:
            im = Image.open(os.path.join(pack, "art", i["file"])).convert("RGB")
            im.thumbnail((380, 300))
            out.append(f"<div class=card><img src='{data_url(im)}' alt=''><div><b>{esc(i['area'])}</b> p {esc(i['page'])} {'<span class=pill>spoiler</span>' if i.get('spoiler') else ''}</div><div>{esc(i['shows'])}</div><div class=muted>{esc(i.get('when'))}</div></div>")
        out.append("</div>")
    if adv.get("ambient"):
        out.append("<h2>Sound</h2><p>Music out of combat: " + esc(", ".join(f"{k}: {v}" for k, v in (adv.get("music") or {}).get("themes", {}).items())) + "</p><table><tr><th>Map</th><th>Loop</th><th>Where</th><th>Radius</th><th>What</th></tr>")
        for s in adv["ambient"]:
            out.append(f"<tr><td>{esc(s['map'])}</td><td>{esc(s['sound'])}</td><td>{esc(s['at'])}</td><td>{esc(s['radius'])} ft</td><td>{esc(s.get('label'))}</td></tr>")
        out.append("</table>")
    fills_path = os.path.join(pack, "dc-fills.json")
    fills = json.load(open(fills_path)).get("fills", []) if os.path.exists(fills_path) else []
    if fills:
        # DCs the book does not give (dcfill.mjs): the level-based DC for the party's level there
        out.append("<h2>DCs the book does not give</h2><p class=muted>Each takes the level-based DC for the party's level at that point (adventure-importer.md section 11).</p><table><tr><th>File</th><th>Where</th><th>Check</th><th>DC</th><th>Party level</th></tr>")
        for f in fills:
            out.append(f"<tr><td>{esc(f.get('file'))}</td><td>{esc(f.get('where'))}</td><td>{esc(f.get('what'))}</td><td>{esc(f.get('dc'))}</td><td>{esc(f.get('level') if f.get('level') is not None else '')}</td></tr>")
        out.append("</table>")
    if adv.get("ledger"):
        out.append("<h2>Ledger (the GM's memory)</h2><table><tr><th>Kind</th><th>Title</th><th>Text</th></tr>")
        for e in adv["ledger"]:
            out.append(f"<tr><td>{esc(e['kind'])}</td><td>{esc(e.get('title'))}</td><td>{esc(e['text'])}</td></tr>")
        out.append("</table>")
    for nf in adv.get("notes", []):
        p = os.path.join(pack, nf)
        if os.path.exists(p):
            out.append(f"<h2>GM notes: {esc(nf)}</h2><details><summary>Open the notes</summary><pre>{esc(open(p).read())}</pre></details>")
    if a.save:
        r = subprocess.run(["node", "tools/validate.mjs", pack, "--save", a.save], capture_output=True, text=True)
        lines = [l for l in r.stdout.splitlines() if l.startswith(("WARNING", "ERROR", "OK", "FAILED"))]
        out.append("<h2>Validator</h2><pre>" + esc("\n".join(lines)) + "</pre>")
    out.append("</main></body></html>")
    dest = a.out or os.path.join(pack, "review.html")
    open(dest, "w").write("".join(out))
    print(f"wrote {dest} ({os.path.getsize(dest) // 1024} KiB)")


if __name__ == "__main__":
    main(sys.argv[1:])
