"""Render the closing card for the primer-liso reel — v2.

Layout (1080x1920, 9:16):
- White background
- GE Beauty logo centered, ~18% from top
- "primer / liso intacto" in Italian Plate No2 Expanded, color #DF3630, width 75%
- "seu liso" in Italian Plate No2 Mono, color #000000
- "perfeito por até 24h" in Italian Plate No2 Mono, color #DF3630, UNDERLINED
  - The tagline block (both lines) sized to 80% of frame width
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(r"C:\Users\Lucas Guimarães\Desktop\nami-works")
FONTS = ROOT / "sandbox/gebeauty/.brand-assets/fonts/fonts"
LOGO = ROOT / "sandbox/gebeauty/.brand-assets/Logo/ge_beauty_logo-01.png"
OUT = ROOT / "sandbox/gebeauty/video-director/state/primer-liso-intacto-v1/_validation/closing-card.png"

W, H = 1080, 1920
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
CORAL = (0xDF, 0x36, 0x30)  # #DF3630

img = Image.new("RGB", (W, H), WHITE)
draw = ImageDraw.Draw(img)

# --- LOGO ---
logo = Image.open(LOGO).convert("RGBA")
logo_w = int(W * 0.45)  # +50% from previous 0.30
logo_h = int(logo.height * (logo_w / logo.width))
logo = logo.resize((logo_w, logo_h), Image.LANCZOS)
logo_x = (W - logo_w) // 2
logo_y = int(H * 0.18)
img.paste(logo, (logo_x, logo_y), logo)
logo_bottom = logo_y + logo_h

# --- PRODUCT NAME: Italian Plate No2 Expanded, coral, width 75% ---
target_product_w = int(W * 0.75)  # 810px
font_path_product = FONTS / "Italian Plate No2 Expanded Bold.ttf"

# Size so "liso intacto" (wider line) hits target width
size_guess = 100
font_probe = ImageFont.truetype(str(font_path_product), size_guess)
bbox_probe = draw.textbbox((0, 0), "liso intacto", font=font_probe)
text_w = bbox_probe[2] - bbox_probe[0]
size_product = int(size_guess * (target_product_w / text_w))
font_product = ImageFont.truetype(str(font_path_product), size_product)

ascent_p, descent_p = font_product.getmetrics()
line_h_product = ascent_p + descent_p

product_y = logo_bottom + int(H * 0.08)

# Line 1: "primer"
line1 = "primer"
bbox1 = draw.textbbox((0, 0), line1, font=font_product)
w1 = bbox1[2] - bbox1[0]
draw.text(((W - w1) // 2, product_y), line1, fill=CORAL, font=font_product)

# Line 2: "liso intacto"
line2 = "liso intacto"
bbox2 = draw.textbbox((0, 0), line2, font=font_product)
w2 = bbox2[2] - bbox2[0]
y2 = product_y + int(line_h_product * 1.0)
draw.text(((W - w2) // 2, y2), line2, fill=CORAL, font=font_product)
product_bottom = y2 + line_h_product

# --- TAGLINE: Italian Plate No2 Mono ---
# "perfeito por até 24h" (wider line) → 80% of frame
target_tag_w = int(W * 0.80)  # 864px
font_path_tag = FONTS / "Italian Plate No2 Mono Bold.ttf"

size_guess_t = 50
font_probe_t = ImageFont.truetype(str(font_path_tag), size_guess_t)
bbox_probe_t = draw.textbbox((0, 0), "perfeito por até 24h", font=font_probe_t)
text_w_t = bbox_probe_t[2] - bbox_probe_t[0]
size_tag = int(size_guess_t * (target_tag_w / text_w_t))
font_tag = ImageFont.truetype(str(font_path_tag), size_tag)

ascent_t, descent_t = font_tag.getmetrics()
line_h_tag = ascent_t + descent_t

tag_y = product_bottom + int(H * 0.05)

# Line 1: "seu liso" — BLACK
tag1 = "seu liso"
bbox_tag1 = draw.textbbox((0, 0), tag1, font=font_tag)
wt1 = bbox_tag1[2] - bbox_tag1[0]
draw.text(((W - wt1) // 2, tag_y), tag1, fill=BLACK, font=font_tag)

# Line 2: "perfeito por até 24h" — CORAL, UNDERLINED
tag2 = "perfeito por até 24h"
bbox_tag2 = draw.textbbox((0, 0), tag2, font=font_tag)
wt2 = bbox_tag2[2] - bbox_tag2[0]
yt2 = tag_y + int(line_h_tag * 1.15)
xt2 = (W - wt2) // 2
draw.text((xt2, yt2), tag2, fill=CORAL, font=font_tag)

# Underline for the coral tagline line
# Draw a horizontal line just below the text baseline
underline_thickness = max(2, int(size_tag * 0.06))  # ~6% of font size
underline_y = yt2 + ascent_t + int(descent_t * 0.4)
draw.rectangle(
    [(xt2, underline_y), (xt2 + wt2, underline_y + underline_thickness)],
    fill=CORAL,
)

img.save(OUT)
print(f"Saved: {OUT}")
print(f"Logo: {logo_w}x{logo_h} at ({logo_x}, {logo_y})")
print(f"Product (Expanded, coral): size {size_product}px, primer={w1}px, liso intacto={w2}px")
print(f"Tagline (Mono): size {size_tag}px, seu liso={wt1}px (black), perfeito={wt2}px (coral, underlined, thickness={underline_thickness}px)")
