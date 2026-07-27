"""Process A - library extraction/reuse: pull an existing ICONS FINAIS.ai icon
as a clean production family SVG (drop label via viewBox crop, canonicalize red)."""
import re, json
from pathlib import Path
import fitz
import iconkit as K

SP = Path(r"C:\Users\LUCASG~1\AppData\Local\Temp\claude\c--claude\0ea5d4d6-934b-426d-bcf7-bcf4e17f8192\scratchpad")
OUT = SP / "out_A"; OUT.mkdir(exist_ok=True)
doc = fitz.open(str(SP / "icons-finais.ai"))
calib = json.loads((SP / "calib.json").read_text())

def ring_bbox(pg):
    ds = pg.get_drawings(); best = None; pa = pg.rect.width*pg.rect.height
    for d in ds:
        r = fitz.Rect(d["rect"]); w,h = r.width, r.height
        if w<=0 or h<=0: continue
        if 0.8 <= w/h <= 1.25 and w*h > pa*0.05:
            if best is None or w*h > best[0]: best = (w*h, r)
    return best[1] if best else pg.rect

HEXRE = re.compile(r'#[0-9a-fA-F]{6}')
def canon_red(svg):
    # every ink color -> canonical GE red; keep 'none'
    return HEXRE.sub("#DF3630", svg)

# concept -> library page index (0-based)
PICKS = {"sem-sulfatos":14, "vegano":12, "protecao-uv-sol":10, "frizz":1}
rows = []
for name, i in PICKS.items():
    pg = doc[i]
    svg = pg.get_svg_image()
    bb = ring_bbox(pg)
    pad = max(bb.width, bb.height)*0.06
    vb = f"{bb.x0-pad:.2f} {bb.y0-pad:.2f} {bb.width+2*pad:.2f} {bb.height+2*pad:.2f}"
    svg = re.sub(r'(<svg[^>]*?)viewBox="[^"]*"', r'\1viewBox="%s"' % vb, svg, count=1)
    svg = re.sub(r'(<svg[^>]*?)width="[^"]*"', r'\1width="51"', svg, count=1)
    svg = re.sub(r'(<svg[^>]*?)height="[^"]*"', r'\1height="51"', svg, count=1)
    svg = canon_red(svg)
    p = OUT / f"A_{name}.svg"; p.write_text(svg, encoding="utf-8")
    r = K.score(p, calib)
    rows.append((name, r["score"], r["pass"]))
    print(f"A_{name:20s} {r['score']:5.1f} {'PASS' if r['pass'] else 'fail'}  {r['metrics']}")
(SP/"scores_A.json").write_text(json.dumps(rows), encoding="utf-8")
