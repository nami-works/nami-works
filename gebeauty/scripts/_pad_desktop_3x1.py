"""Pad the Canva 1.91:1 'campanha encerrada' desktop banner to the LP's 3:1 slot (2016x672)
by extending the studio background only (edge-column stretch). Product/text untouched."""
from PIL import Image
from pathlib import Path
SD = Path(r"C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--claude/630c36fd-0cfc-45b1-9b35-be664f12d11d/scratchpad")

img = Image.open(SD / "ban_desktop_canva.png").convert("RGB")  # 1200x628
H = 672
neww = round(img.width * H / img.height)  # ~1284
img = img.resize((neww, H))
W = 2016
x = (W - neww) // 2  # center
canvas = Image.new("RGB", (W, H), img.getpixel((3, 3)))
canvas.paste(img, (x, 0))
# extend background by stretching the 2px edge columns into the pads (matches any gradient)
canvas.paste(img.crop((0, 0, 2, H)).resize((x, H)), (0, 0))
canvas.paste(img.crop((neww - 2, 0, neww, H)).resize((W - x - neww, H)), (x + neww, 0))
out = SD / "ban_encerrada_desktop_final.png"
canvas.save(out)
print("saved", out, canvas.size)
