"""Mobile cortesia hero (768x960): swap top text band to 'campanha encerrada'."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

SD = Path(r"C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--claude/630c36fd-0cfc-45b1-9b35-be664f12d11d/scratchpad")
FONTS = Path("gebeauty/.brand-assets/fonts/fonts")
RED = (223, 54, 48)
GRAY = (74, 72, 70)

def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)

img = Image.open(SD / "banner_travel_mobile.png").convert("RGB")
W, H = img.size  # 768 x 960
d = ImageDraw.Draw(img)

# cover the top text band (old text sits ~y20-195; product starts ~y215) with flat bg
bg = img.getpixel((12, 12))
d.rectangle((0, 0, W, 205), fill=bg)

# headline centered
hl = font("Italian Plate No1 Bold.ttf", 66)
d.text((W/2, 20), "campanha", font=hl, fill=RED, anchor="ma")
d.text((W/2, 90), "encerrada", font=hl, fill=RED, anchor="ma")

# subline centered (one concise line for mobile)
try:
    sub = font("Italian Plate No1 Medium.ttf", 22)
except OSError:
    sub = font("Italian Plate No1 Regular.ttf", 22)
d.text((W/2, 168), "a cortesia acabou, a linha continua aqui.", font=sub, fill=GRAY, anchor="ma")

out = SD / "banner_encerrada_mobile.png"
img.save(out)
print("saved", out)
