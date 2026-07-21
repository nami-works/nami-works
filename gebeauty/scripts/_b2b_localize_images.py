"""Localize the B2B deck's product images: read the CURRENT featuredImage URLs from
_b2b_portfolio_fetch.out.json (live registry), download + optimize into
inputs/mockups/assets/products/<slug>.webp. Self-contained + share-safe.
Also prints current price per deck SKU so prices can be reconciled."""
import json, urllib.request
from io import BytesIO
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve()
DATA = json.loads((HERE.parent / "_b2b_portfolio_fetch.out.json").read_text(encoding="utf-8"))
BY_SKU = {r["sku"]: r for r in DATA}

DECK_SKUS = ["GEB 001","GEB 002","GEB 003","GEB 008","GEB 019","GEB 020","GEB 021",
             "GEB 022","GEB 023","GEB 101","GEB 102","GEB 120","GEB 024","GEB 031",
             "GEB 032","GEB 033","GEB 121","GEB 013","GEB 010","GEB 011","GEB 029"]

OUT = HERE.parents[1].parent / "inputs" / "mockups" / "assets" / "products"
OUT.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0"}

ok = 0
print("=== prices (reconcile vs deck) ===")
for sku in DECK_SKUS:
    r = BY_SKU.get(sku)
    if r:
        print(f"  {sku}: R$ {r.get('price')}")
print("\n=== downloads ===")
for sku in DECK_SKUS:
    r = BY_SKU.get(sku)
    slug = sku.lower().replace(" ", "")
    if not r or not r.get("image"):
        print(f"  !! {sku}: no image in registry")
        continue
    try:
        raw = urllib.request.urlopen(urllib.request.Request(r["image"], headers=UA), timeout=40).read()
        im = Image.open(BytesIO(raw))
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
            im = Image.alpha_composite(bg, im).convert("RGB")
        else:
            im = im.convert("RGB")
        w = 600
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        im.save(OUT / f"{slug}.webp", "WEBP", quality=85, method=6)
        ok += 1
        print(f"  {sku} -> {slug}.webp")
    except Exception as e:
        print(f"  !! {sku} FAILED: {e}")

print(f"\n{ok}/{len(DECK_SKUS)} localized to {OUT}")
