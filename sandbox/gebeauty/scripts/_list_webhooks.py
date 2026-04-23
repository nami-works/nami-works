"""List installed webhook subscriptions to identify the Omie sync app."""
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
env = {}
for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()

SHOP = env["SHOPIFY_SHOP_DOMAIN"]
TOKEN = env["SHOPIFY_ADMIN_ACCESS_TOKEN"]
API = env.get("SHOPIFY_API_VERSION", "2026-01")

url = f"https://{SHOP}/admin/api/{API}/webhooks.json?limit=250"
req = urllib.request.Request(url, headers={"X-Shopify-Access-Token": TOKEN})
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode("utf-8"))

for w in data.get("webhooks", []):
    print(f"  topic={w.get('topic'):35s}  address={w.get('address')}")
