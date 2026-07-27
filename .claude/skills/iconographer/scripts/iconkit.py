"""
iconkit — deterministic family shell + motif normalizer + conformance scorer.

The 95%-accuracy idea: a SOURCE only needs to produce a monochrome line MOTIF.
Everything family-specific (canvas, ring, weight, color, centering) is applied
deterministically here, and an auto-scorer gates conformance.
"""
import re, math, io, json
from pathlib import Path
import numpy as np
import fitz  # PyMuPDF, renders SVG

CANVAS = 51.0
C = 25.5            # center
RING_R = 24.0
SW = 1.4           # family line weight at the 51 grid
INNER_R = 15.5     # motifs live within this radius; leaves a gap to the ring
RED = "#DF3630"

# ---------------------------------------------------------------- shell + kit
def ring(color="{C}"):
    return f'<circle cx="{C}" cy="{C}" r="{RING_R}" fill="none" stroke="{color}" stroke-width="{SW}"/>'

def wrap(inner, color="{C}"):
    return (f'<svg width="51" height="51" viewBox="0 0 51 51" fill="none" '
            f'xmlns="http://www.w3.org/2000/svg">\n{ring(color)}\n{inner}\n</svg>\n')

def emit_pair(name, inner, outdir):
    """Write the family SVG pair (baked #DF3630 + currentColor master)."""
    outdir = Path(outdir)
    body = wrap(inner, "{C}")
    (outdir / f"{name}.svg").write_text(body.replace("{C}", RED), encoding="utf-8")
    (outdir / f"{name}.currentcolor.svg").write_text(body.replace("{C}", "currentColor"), encoding="utf-8")
    return outdir / f"{name}.svg"

# primitive kit (all stroked, round joins — the anti-"squary" discipline)
def _p(d, extra=""):
    return f'<path d="{d}" fill="none" stroke="{{C}}" stroke-width="{SW}" stroke-linecap="round" stroke-linejoin="round"{extra}/>'
def k_circle(cx, cy, r):
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{{C}}" stroke-width="{SW}"/>'
def k_rrect(x, y, w, h, rx):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="none" stroke="{{C}}" stroke-width="{SW}"/>'
def k_line(x1, y1, x2, y2):
    return _p(f"M{x1} {y1} L{x2} {y2}")
def k_poly(pts, closed=False):
    d = "M%.2f %.2f " % pts[0] + " ".join("L%.2f %.2f" % p for p in pts[1:]) + (" Z" if closed else "")
    return _p(d)
def k_spiral(turns=2.6, r0=2.2, r1=11.5, cx=C, cy=C, phase=-math.pi/2, steps=140):
    pts = []
    for i in range(steps + 1):
        t = (i/steps)*turns*2*math.pi
        r = r0 + (r1-r0)*(i/steps)
        pts.append((cx + r*math.cos(t+phase), cy + r*math.sin(t+phase)))
    return k_poly(pts)

# ------------------------------------------------------------- normalizer
_num = re.compile(r"-?\d+\.?\d*(?:e-?\d+)?")
def _paths_bbox(paths):
    xs, ys = [], []
    for d in paths:
        nums = [float(n) for n in _num.findall(d)]
        xs += nums[0::2]; ys += nums[1::2]
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)

def normalize_traced_svg(svg_text, inner_r=INNER_R):
    """Fit an arbitrary traced/vector motif SVG into the family shell.
    Strips its colors, scales its bbox into the inner circle, wraps in the ring."""
    paths = re.findall(r'<path[^>]*\sd="([^"]+)"', svg_text)
    if not paths:
        return None, "no <path> found"
    full = _paths_bbox(paths)
    if not full:
        return None, "no coords"
    fw = max(full[2]-full[0], 1e-3); fh = max(full[3]-full[1], 1e-3)
    # drop background/frame paths (a traced white bg covers ~the whole canvas)
    keep = []
    for d in paths:
        bb1 = _paths_bbox([d])
        if not bb1:
            continue
        w1, h1 = bb1[2]-bb1[0], bb1[3]-bb1[1]
        if w1 >= 0.92*fw and h1 >= 0.92*fh:
            continue  # background frame
        keep.append(d)
    paths = keep or paths
    bb = _paths_bbox(paths)
    x0, y0, x1, y1 = bb
    bw, bh = max(x1-x0, 1e-3), max(y1-y0, 1e-3)
    target = 2*inner_r
    s = target / max(bw, bh)
    # center the scaled bbox at canvas center
    tx = C - s*(x0 + bw/2)
    ty = C - s*(y0 + bh/2)
    # re-emit paths with colors stripped; group carries the family fill
    clean = []
    for d in paths:
        clean.append(f'<path d="{d}"/>')
    g = (f'<g transform="translate({tx:.3f} {ty:.3f}) scale({s:.4f})" '
         f'fill="{{C}}" stroke="none">{"".join(clean)}</g>')
    return g, "ok"

# ------------------------------------------------------------- render + score
def render_png(svg_path, size=240):
    doc = fitz.open(str(svg_path))
    pg = doc[0]
    z = size / max(pg.rect.width, pg.rect.height)
    pix = pg.get_pixmap(matrix=fitz.Matrix(z, z), alpha=False)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    return arr[:, :, :3].astype(np.int16)

def _masks(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    white = (r > 235) & (g > 235) & (b > 235)
    ink = ~white
    # "red-ish": red clearly dominant over green & blue (covers GE red + its AA halo)
    redish = ink & (r - g > 30) & (r - b > 30)
    return ink, redish, redish  # third slot kept for call-compat

def score(svg_path, calib=None):
    """Deterministic conformance score 0..100 + subscores. Higher = more on-standard."""
    rgb = render_png(svg_path, 240)
    H, W = rgb.shape[:2]
    ink, redish, _ = _masks(rgb)
    tot = H*W
    ink_ratio = ink.sum()/tot
    red_ratio = redish.sum()/max(ink.sum(), 1)          # fraction of ink that IS red (family=high, black AI=~0)
    # ring presence: scan a band of radii (padding varies by source) and take the best circle
    cx, cy = W/2, H/2
    ang = np.linspace(0, 2*math.pi, 720, endpoint=False)
    ca, sa = np.cos(ang), np.sin(ang)
    ring_hit = 0.0
    for frac in (0.40, 0.42, 0.44, 0.455, 0.47, 0.485):
        rr = frac*W
        xs = np.clip((cx + rr*ca).astype(int), 0, W-1)
        ys = np.clip((cy + rr*sa).astype(int), 0, H-1)
        ring_hit = max(ring_hit, float(redish[ys, xs].mean()))
    # fit/centering: ink bbox
    ys_i, xs_i = np.where(ink)
    if len(xs_i):
        bx0, bx1, by0, by1 = xs_i.min(), xs_i.max(), ys_i.min(), ys_i.max()
        cxb, cyb = (bx0+bx1)/2, (by0+by1)/2
        off_center = (abs(cxb-cx)+abs(cyb-cy))/W          # 0 = centered
        fill_span = max(bx1-bx0, by1-by0)/W               # ~0.94 ideal (ring near edges)
    else:
        off_center, fill_span = 1.0, 0.0
    # motif solidity: density of ink INSIDE the ring only (exclude the ring band),
    # so a thin-line motif reads low and a solid silhouette reads high
    YY, XX = np.ogrid[:H, :W]
    rad = np.sqrt((XX-cx)**2 + (YY-cy)**2)
    inner = ink & (rad < 0.40*W)
    mys, mxs = np.where(inner)
    if len(mxs) > 50:
        mb = max((mxs.max()-mxs.min())*(mys.max()-mys.min()), 1)
        fill_density = inner.sum()/mb
    else:
        fill_density = 0.0
    # legibility at 24px: re-render small, ink must not vanish or fully clog
    small = render_png(svg_path, 24)
    si, sr, _ = _masks(small)
    ink24 = si.sum()/ (24*24)

    # ---- band targets (from calibration on the real family) ----
    cb = calib or dict(ink_lo=0.04, ink_hi=0.16, ink24_lo=0.06, ink24_hi=0.42)
    def band(v, lo, hi):
        if lo <= v <= hi: return 1.0
        span = hi-lo
        d = (lo-v) if v < lo else (v-hi)
        return max(0.0, 1 - d/(span if span else 1))

    subs = {
        "color_purity": (red_ratio - 0.5)/0.4,               # 1.0 if >=90% red ink, 0 if <=50% (black/gray AI)
        "ring_present": min(1.0, ring_hit/0.75),
        "weight_band":  band(ink_ratio, cb["ink_lo"], cb["ink_hi"]),
        "centered":     max(0.0, 1 - off_center/0.06),
        "fits":         band(fill_span, 0.80, 0.99),
        "legible_24":   band(ink24, cb["ink24_lo"], cb["ink24_hi"]),
        "line_style":   1 - max(0.0, (fill_density - 0.32)/0.23),   # solid silhouette -> ~0
    }
    subs = {k: float(round(max(0.0, min(1.0, v)), 3)) for k, v in subs.items()}
    w = {"color_purity":16, "ring_present":18, "weight_band":12, "centered":12, "fits":10, "legible_24":14, "line_style":18}
    total = float(round(sum(subs[k]*w[k] for k in w), 1))
    # hard gates: a solid silhouette / missing ring / wrong color can't pass on aggregate alone
    hard_ok = (subs["line_style"] >= 0.35 and subs["ring_present"] >= 0.5 and subs["color_purity"] >= 0.5)
    return {"score": total, "pass": bool(total >= 80 and hard_ok),
            "metrics": {"ink_ratio": float(round(ink_ratio,4)), "red_ratio": float(round(red_ratio,4)),
                        "ring_hit": float(round(ring_hit,3)), "off_center": float(round(off_center,4)),
                        "fill_span": float(round(fill_span,3)), "ink24": float(round(ink24,4)),
                        "fill_density": float(round(fill_density,3))},
            "subs": subs}

if __name__ == "__main__":
    print("iconkit self-check: fitz", fitz.VersionBind, "numpy", np.__version__)
