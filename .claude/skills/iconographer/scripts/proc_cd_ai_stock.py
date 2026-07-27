"""Process C (AI raster->trace->normalize) and D (stock vector->normalize)."""
import json, urllib.request
from pathlib import Path
import iconkit as K

SP = Path(r"C:\Users\LUCASG~1\AppData\Local\Temp\claude\c--claude\0ea5d4d6-934b-426d-bcf7-bcf4e17f8192\scratchpad")
OUT = SP / "out_CD"; OUT.mkdir(exist_ok=True)
calib = json.loads((SP / "calib.json").read_text())

SRC = {
 # Process C: traced AI rasters
 "C_frete-truck":   "https://pikaso.cdnpk.net/private/production/4987676471/3353168053.svg?token=exp=1785369600~hmac=61b0c91d343ef59ab5cd28261a1df1c74d60d0b11614530977291733e2544b85",
 "C_serum-dropper": "https://pikaso.cdnpk.net/private/production/4987676677/3353168187.svg?token=exp=1785369600~hmac=2f980255a07efc7eb6572b37ab184e4828d5fb249c3cf50110506f6b554fdd29",
 # Process D: stock vector (flaticon)
 "D_frete-truck":   "https://cdn-icons.flaticon.com/svg/18797/18797303.svg?token=exp=1785022519~hmac=d3e9565952a5c52e3072820205b54bd1&filename=truck-side-view_18797303.svg&fd=1",
}
rows = []
for name, url in SRC.items():
    try:
        raw = urllib.request.urlopen(url, timeout=30).read().decode("utf-8", "replace")
    except Exception as e:
        print(name, "DOWNLOAD ERR", e); continue
    (OUT / f"{name}.src.svg").write_text(raw, encoding="utf-8")
    inner, msg = K.normalize_traced_svg(raw)
    if inner is None:
        print(f"{name:20s} normalize FAIL: {msg}"); continue
    p = K.emit_pair(name, inner, OUT)
    r = K.score(p, calib)
    rows.append({"name": name, "process": name[0], "score": r["score"], "pass": r["pass"], "subs": r["subs"]})
    print(f"{name:20s} {r['score']:5.1f} {'PASS' if r['pass'] else 'fail'}  {r['subs']}")
(SP / "scores_CD.json").write_text(json.dumps(rows), encoding="utf-8")
