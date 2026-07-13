"""Build the Beleza na Web catalog image tree from Shopify (canonical source).

Reads _map.json (SKU->Shopify images) and _labels.json (per-image curation labels),
writes an organized per-SKU folder tree to the GEB shared Drive, with EAN-named files
in two format folders (620 delivered, 3000 staged as native+pending marker).

Usage:  python _blz_build.py "GEB 001"           # one SKU
        python _blz_build.py --all               # every labelled SKU
"""
import json
import sys
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image

BASE = Path(__file__).resolve().parent.parent / "imagery" / "blz-catalog"
MAP = json.load(open(BASE / "_map.json", encoding="utf-8"))
LABELS = json.load(open(BASE / "_labels.json", encoding="utf-8"))
DRIVE_ROOT = Path(
    r"G:\Drives compartilhados\GEB_Comercial\Marketplaces"
    r"\Beleza na Web\Cadastro GE Beauty BLZ\Imagens"
)
# spec asset types + the extra-to-spec infografico bucket (preserved, flagged)
PHOTO_TYPES = ["still", "ambientada", "textura", "infografico"]
FORMATS = {"620": 620, "3000": 3000}
BG = (255, 255, 255)


def slugify(s: str) -> str:
    import re
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:40]


def square_pad(im: Image.Image) -> Image.Image:
    """Flatten transparency onto white, pad to a centered square."""
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, BG + (255,))
        im = Image.alpha_composite(bg, im).convert("RGB")
    else:
        im = im.convert("RGB")
    w, h = im.size
    if w == h:
        return im
    side = max(w, h)
    canvas = Image.new("RGB", (side, side), BG)
    canvas.paste(im, ((side - w) // 2, (side - h) // 2))
    return canvas


def fetch(url: str) -> Image.Image:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return Image.open(BytesIO(urllib.request.urlopen(req).read()))


def build_sku(sku_rec: dict) -> dict:
    sku = sku_rec["sku"]
    ean = sku_rec["ean"].strip()
    labels = LABELS.get(sku)
    if not labels:
        return {"sku": sku, "status": "no-labels"}
    folder = DRIVE_ROOT / f"{ean}_{slugify(sku_rec['name'])}"
    counts = {t: 0 for t in PHOTO_TYPES}
    # group image indices by label, preserving order
    by_type = {t: [] for t in PHOTO_TYPES}
    for entry in labels:
        by_type.setdefault(entry["label"], []).append(entry["index"])

    for t in PHOTO_TYPES:
        idxs = by_type.get(t, [])
        for fmt in FORMATS:
            (folder / t / fmt).mkdir(parents=True, exist_ok=True)
        if not idxs:
            # nothing of this type -> pending marker in both format dirs
            (folder / t / "620" / "_PENDENTE.txt").write_text(
                f"Sem foto '{t}' na fonte Shopify para {sku} ({ean}).\n",
                encoding="utf-8",
            )
            continue
        for n, idx in enumerate(idxs, 1):
            src = sku_rec["imgs"][idx]
            im = square_pad(fetch(src["url"]))
            side = min(im.size)
            base = f"{ean}_{t}_{n:02d}"
            # 620 delivered
            im.resize((620, 620), Image.LANCZOS).save(
                folder / t / "620" / f"{base}.jpg", quality=90
            )
            # 3000 staged: native (best available) + pending marker
            im.save(folder / t / "3000" / f"{base}_NATIVE_{side}x{side}.jpg", quality=92)
            counts[t] += 1
        (folder / t / "3000" / "_PENDENTE_upscale_3000.txt").write_text(
            f"Fonte Shopify no maximo {side}px. Falta upscale para 3000x3000.\n",
            encoding="utf-8",
        )
    # video: none on Shopify
    (folder / "video").mkdir(parents=True, exist_ok=True)
    (folder / "video" / "_PENDENTE.txt").write_text(
        f"Sem video na fonte Shopify para {sku} ({ean}).\n", encoding="utf-8"
    )
    return {"sku": sku, "ean": ean, "folder": str(folder), "counts": counts}


def main():
    args = sys.argv[1:]
    if args == ["--all"]:
        targets = MAP["mapped"]
    else:
        want = " ".join(args)
        targets = [x for x in MAP["mapped"] if x["sku"] == want]
    for rec in targets:
        print(json.dumps(build_sku(rec), ensure_ascii=False))


if __name__ == "__main__":
    main()
