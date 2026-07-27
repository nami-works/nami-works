import math
from pathlib import Path
SP = Path(r"C:\Users\LUCASG~1\AppData\Local\Temp\claude\c--claude\0ea5d4d6-934b-426d-bcf7-bcf4e17f8192\scratchpad")
SW = 1.4

def ring(): return '<circle cx="25.5" cy="25.5" r="24" fill="none" stroke="{C}" stroke-width="%s"/>' % SW

# 1) cachos definidos -> spiral curl
pts = []
turns, steps = 2.6, 140
for i in range(steps + 1):
    t = (i / steps) * turns * 2 * math.pi
    r = 2.2 + (11.2 - 2.2) * (i / steps)
    pts.append((25.5 + r * math.cos(t - math.pi/2), 25.5 + r * math.sin(t - math.pi/2)))
d = "M%.2f %.2f " % pts[0] + " ".join("L%.2f %.2f" % p for p in pts[1:])
curl = '<path d="%s" fill="none" stroke="{C}" stroke-width="%s" stroke-linecap="round" stroke-linejoin="round"/>' % (d, SW)

# 2) efeito duradouro -> hourglass
hour = (
 '<path d="M18 15 L33 15 L25.5 25.5 L33 36 L18 36 L25.5 25.5 Z" fill="none" '
 'stroke="{C}" stroke-width="%s" stroke-linejoin="round"/>' % SW
 + '<path d="M18 15 L33 15 M18 36 L33 36" fill="none" stroke="{C}" stroke-width="%s" stroke-linecap="round"/>' % SW
 + '<path d="M22.5 32.5 L28.5 32.5" fill="none" stroke="{C}" stroke-width="%s" stroke-linecap="round"/>' % SW
)

# 3) proteção térmica -> thermometer + heat ticks
therm = (
 '<path d="M23.4 32.2 L23.4 18 A2.1 2.1 0 0 1 27.6 18 L27.6 32.2" fill="none" '
 'stroke="{C}" stroke-width="%s" stroke-linecap="round"/>' % SW
 + '<circle cx="25.5" cy="34" r="3.9" fill="none" stroke="{C}" stroke-width="%s"/>' % SW
 + '<path d="M25.5 24 L25.5 31.5" fill="none" stroke="{C}" stroke-width="%s" stroke-linecap="round"/>' % SW
 + '<path d="M29.5 21 L32 21 M29.5 25 L32 25" fill="none" stroke="{C}" stroke-width="%s" stroke-linecap="round"/>' % SW
)

# 4) frete gratis -> box truck (facing right)
truck = (
 '<path d="M12.5 19 L27 19 L27 23 L31.5 23 L34.5 26.5 L34.5 31 L12.5 31 Z" fill="none" '
 'stroke="{C}" stroke-width="%s" stroke-linejoin="round"/>' % SW
 + '<circle cx="18" cy="33" r="2.5" fill="none" stroke="{C}" stroke-width="%s"/>' % SW
 + '<circle cx="30" cy="33" r="2.5" fill="none" stroke="{C}" stroke-width="%s"/>' % SW
 + '<path d="M27 23 L27 27.5 L34.5 27.5" fill="none" stroke="{C}" stroke-width="%s" stroke-linejoin="round"/>' % SW
)

ICONS = {
 "cachos-definidos": curl,
 "efeito-duradouro": hour,
 "protecao-termica": therm,
 "frete-gratis": truck,
}

def wrap(inner):
    return ('<svg width="51" height="51" viewBox="0 0 51 51" fill="none" '
            'xmlns="http://www.w3.org/2000/svg">\n' + ring() + "\n" + inner + "\n</svg>\n")

for name, inner in ICONS.items():
    body = wrap(inner)
    (SP / f"more_{name}.svg").write_text(body.replace("{C}", "#DF3630"), encoding="utf-8")
    (SP / f"more_{name}.currentcolor.svg").write_text(body.replace("{C}", "currentColor"), encoding="utf-8")
    print("wrote", name)
print("done")
