#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Wash-routine hero -> per-ratio expanded plates (empty copy zones, no copy).

Deterministic PIL recanvas per the /creative-producer + image-extension rule:
the corrected 4-pack hero (products grouped LEFT, labels fixed) is pasted whole and
NEVER touched; only the empty studio background/floor is extended to reach each ratio.

House layout rule:
  horizontal (1.91:1) -> products LEFT, copy zone RIGHT  (extend right)
  vertical  (4:5, 9:16) -> products BOTTOM, copy zone TOP (extend up)
  square    (1:1)       -> source as-is (copy zone is the existing empty right/top)

Extension = stretch a thin strip of the hero's already-empty edge across the new area.
That edge is smooth studio gradient + reflective floor, so the stretch is seamless and
adds zero new detail (no product, no re-render).

Run:  C:/Python314/python.exe expand_frames.py            # expects hero_4pack.png here
      C:/Python314/python.exe expand_frames.py --src <path-to-hero.png>
"""
import argparse, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "expanded")

# name, ratio (w, h), export size (long-ish, 2x Meta for headroom), edge-strip fraction
# name, ratio (w,h), export size, copy_fraction (verticals only: reserve this share of
# height at TOP for copy by scaling products down; None = product fills the fixed side)
FORMATS = [
    ("1x1",    1, 1,   (1080, 1080), None),
    ("1.91x1", 191, 100, (1200, 628), None),
    ("4x5",    4, 5,   (1080, 1350), 0.35),
    ("9x16",   9, 16,  (1080, 1920), None),
]
STRIP = 0.03  # fraction of the source edge sampled and stretched to fill the new area


def expand(hero, rw, rh):
    W, H = hero.size
    target = rw / rh
    src = W / H
    if abs(target - src) < 1e-3:                       # square / same ratio -> as-is
        return hero.copy()
    if target > src:                                   # wider -> extend RIGHT
        cw = round(H * target); ch = H
        canvas = Image.new("RGB", (cw, ch))
        canvas.paste(hero, (0, 0))                     # products stay left
        k = max(2, int(W * STRIP))
        strip = hero.crop((W - k, 0, W, H))            # empty right edge (bg + floor)
        canvas.paste(strip.resize((cw - W, H), Image.LANCZOS), (W, 0))
        return canvas
    else:                                              # taller -> extend UP
        cw = W; ch = round(W / target)
        canvas = Image.new("RGB", (cw, ch))
        canvas.paste(hero, (0, ch - H))                # products anchored bottom
        k = max(2, int(H * STRIP))
        strip = hero.crop((0, 0, W, k))                # empty top edge (gradient)
        canvas.paste(strip.resize((W, ch - H), Image.LANCZOS), (0, 0))
        return canvas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(HERE, "hero_4pack.png"))
    args = ap.parse_args()
    if not os.path.exists(args.src):
        raise SystemExit(
            f"Source hero not found: {args.src}\n"
            "Export the corrected 4-pack PNG from Magnific and drop it here as "
            "hero_4pack.png (or pass --src <path>).")
    hero = Image.open(args.src).convert("RGB")
    os.makedirs(OUT, exist_ok=True)
    print(f"Source: {args.src}  {hero.size}")
    for name, rw, rh, size in FORMATS:
        plate = expand(hero, rw, rh).resize(size, Image.LANCZOS)
        p = os.path.join(OUT, f"{name}_wash-routine.png")
        plate.save(p)
        copy_side = "right" if rw / rh > 1 else ("top" if rw / rh < 1 else "right/top")
        print(f"  {name:7} {size[0]}x{size[1]}  copy zone: {copy_side:9}  -> {p}")
    print(f"\nDone. Plates in {OUT}")


if __name__ == "__main__":
    main()
