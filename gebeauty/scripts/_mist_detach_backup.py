"""Download the non-hero mist images (to be disassociated) from the CDN to a
local backup folder, so the file assets are preserved before detaching them from
the products. Reads the manifest written by _mist_media_audit.py. Run from c:\\claude\\gebeauty."""
import json, sys, urllib.request
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
man = json.loads(Path("mist-new-media-manifest.json").read_text(encoding="utf-8"))
dest = Path("imagery/body-hair-mist/detached-2026-07")
dest.mkdir(parents=True, exist_ok=True)
n = 0
for sku, d in man.items():
    for m in d["media"]:
        if m["pos"] == 0:
            continue  # hero stays on product
        url = m["url"]
        fname = url.split("?")[0].split("/")[-1]
        out = dest / fname
        urllib.request.urlretrieve(url, out)
        n += 1
        print(f"{sku}: saved {fname} ({out.stat().st_size} bytes)")
print(f"\n{n} files backed up -> gebeauty/{dest}")
