"""
Swap the cortesia hero banner copy to "campanha encerrada" directly on the raster
(Canva source lost). Covers the old red headline + gray subline with the clean
right-side background, re-renders in Italian Plate No1. Desktop 2016x672.
Output to scratchpad for QA before any upload.
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

SD = Path(r"C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--claude/630c36fd-0cfc-45b1-9b35-be664f12d11d/scratchpad")
FONTS = Path("gebeauty/.brand-assets/fonts/fonts")

def font(name, size):
    p = FONTS / name
    if not p.exists():
        raise SystemExit(f"missing font {p}")
    return ImageFont.truetype(str(p), size)

RED = (223, 54, 48)
GRAY = (74, 72, 70)

img = Image.open(SD / "banner_travel_desktop.png").convert("RGB")
W, H = img.size  # 2016 x 672
draw = ImageDraw.Draw(img)

# 1) cover old text: stretch a clean bg strip (gap between product and text) over the text zone
TEXT_X0 = 900
strip = img.crop((770, 0, 895, H)).resize((W - TEXT_X0, H))
img.paste(strip, (TEXT_X0, 0))
draw = ImageDraw.Draw(img)

# 2) headline "campanha" / "encerrada"  (bold red, left-aligned like the original)
hl = font("Italian Plate No1 Bold.ttf", 150)
x = 955
lines = ["a linha", "continua aqui"]
lh = 158
y = 150
for ln in lines:
    draw.text((x, y), ln, font=hl, fill=RED)
    y += lh

# 3) subline (gray, medium, lightly tracked), two lines
try:
    sub = font("Italian Plate No1 Medium.ttf", 33)
except SystemExit:
    sub = font("Italian Plate No1 Regular.ttf", 33)

def tracked(draw, xy, text, fnt, fill, track=2):
    cx, cy = xy
    for ch in text:
        draw.text((cx, cy), ch, font=fnt, fill=fill)
        cx += draw.textlength(ch, font=fnt) + track

sub_lines = [
    "a cortesia do travel size chegou ao fim.",
]
sy = y + 22
for sl in sub_lines:
    tracked(draw, (958, sy), sl, sub, GRAY, track=2)
    sy += 44

out = SD / "banner_encerrada_desktop.png"
img.save(out)
print("saved", out)
