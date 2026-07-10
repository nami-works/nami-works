"""Deterministic canvas extension: add clean underwater background below a square
source to reach a target ratio. No generative model, so no second waterline and the
product/label stay pixel-identical. Fills the new strip by dissolving the source's
bottom edge into the image's background water tone.
"""
import sys, numpy as np
from PIL import Image

src_path, out_path, ratio_w, ratio_h, side = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]

img = Image.open(src_path).convert("RGB")
a = np.asarray(img).astype(np.float64)
H, W, _ = a.shape

def hblur(vec2d, k=81):
    pad = k // 2
    ker = np.ones(k) / k
    out = np.empty_like(vec2d)
    for c in range(vec2d.shape[1]):
        vp = np.pad(vec2d[:, c], (pad, pad), mode="reflect")
        out[:, c] = np.convolve(vp, ker, mode="valid")[: vec2d.shape[0]]
    return out

# background water tone = median of the near-white pixels
lum = a @ np.array([0.299, 0.587, 0.114])
mask = lum > 228
bg = np.median(a[mask], axis=0) if mask.sum() > 2000 else a.reshape(-1, 3)[np.argsort(lum.ravel())[-int(0.05 * H * W):]].mean(0)

if side == "bottom":
    newH = int(round(W * ratio_h / ratio_w)); pad = newH - H
    edge = hblur(a[H - 10:H].mean(0))      # (W,3) blurred across the width
    panel = np.empty((pad, W, 3))
    F = max(pad // 22, 10)                  # short feather only; rest is clean bg
    for i in range(pad):
        blend = min(i / F, 1.0)
        row = edge * (1 - blend) + bg * blend
        row *= (1 - 0.015 * (i / max(pad - 1, 1)))   # barely-there deepening
        panel[i] = row
    out = np.vstack([a, panel])
elif side == "left":
    newW = int(round(H * ratio_w / ratio_h)); pad = newW - W
    edge = hblur(a[:, 0:10].mean(1))       # (H,3)
    panel = np.empty((H, pad, 3))
    F = max(pad // 22, 10)
    for j in range(pad):
        dist_from_image = (pad - 1) - j    # 0 at the column touching the image
        blend = min(dist_from_image / F, 1.0)
        row = edge * (1 - blend) + bg * blend
        panel[:, j] = row
    out = np.hstack([panel, a])

Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(out_path, quality=95)
print(f"{out_path}  {out.shape[1]}x{out.shape[0]}  bg={bg.round().astype(int).tolist()}")
