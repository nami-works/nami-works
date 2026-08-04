"""Wire live 'campanha encerrada' text into the LP hero slideshow via per-page metafields
(keeps the shared boosters LP untouched, whose metafields stay empty), swap image to the
clean plate. Backs up the template first for instant revert."""
import json, urllib.request
from pathlib import Path

SD = Path(r"C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--claude/630c36fd-0cfc-45b1-9b35-be664f12d11d/scratchpad")
THEME = "181379236160"
TPL = "templates/page.guia-boosters.json"
PAGE = "gid://shopify/Page/164513415488"
DESK_IMG = "gid://shopify/MediaImage/44029106553152"
MOB_IMG = "gid://shopify/MediaImage/44029106782528"

def load_env():
    env = {}
    for line in (Path(__file__).resolve().parents[1] / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1); env[k.strip()] = v.strip()
    return env
ENV = load_env(); SHOP, TOKEN = ENV["SHOPIFY_SHOP_DOMAIN"], ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]
VER = ENV.get("SHOPIFY_API_VERSION", "2026-01")
BASE = f"https://{SHOP}/admin/api/{VER}"

def req(method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(r).read().decode())

def gql(q, v=None):
    return req("POST", "/graphql.json", {"query": q, "variables": v or {}})

# 1) fetch + backup template
asset = req("GET", f"/themes/{THEME}/assets.json?asset%5Bkey%5D={TPL.replace('/','%2F')}")
tpl_str = asset["asset"]["value"]
(SD / "guia-boosters.backup.json").write_text(tpl_str, encoding="utf-8")
tpl = json.loads(tpl_str)
s = tpl["sections"]["hero"]["blocks"]["s1"]["settings"]
print("before:", {k: s[k] for k in ["heading", "subheading", "box_align", "show_text_box"]})

# 2) bind heading/subheading to per-page metafields; keep image bindings; place text
s["heading"] = "{{ page.metafields.custom.hero_heading.value }}"
s["subheading"] = "{{ page.metafields.custom.hero_subheading.value }}"
s["box_align"] = "top-center"
s["text_alignment"] = "center"
s["text_alignment_mobile"] = "center"
s["show_text_box"] = False
s["image_overlay_opacity"] = 0

# 3) write template back
out = req("PUT", f"/themes/{THEME}/assets.json",
          {"asset": {"key": TPL, "value": json.dumps(tpl, ensure_ascii=False)}})
print("template write:", "ok" if out.get("asset") else out)

# 4) set the cortesia page's hero text metafields + repoint image to clean plate
MS = """mutation m($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key} userErrors{message}}}"""
res = gql(MS, {"m": [
    {"ownerId": PAGE, "namespace": "custom", "key": "hero_heading", "type": "single_line_text_field", "value": "campanha encerrada"},
    {"ownerId": PAGE, "namespace": "custom", "key": "hero_subheading", "type": "single_line_text_field", "value": "a cortesia do travel size chegou ao fim. a linha continua aqui, no seu tempo, do seu jeito."},
    {"ownerId": PAGE, "namespace": "custom", "key": "banner_desktop", "type": "file_reference", "value": DESK_IMG},
    {"ownerId": PAGE, "namespace": "custom", "key": "banner_mobile", "type": "file_reference", "value": MOB_IMG},
]})
print("metafields:", json.dumps(res.get("data", {}).get("metafieldsSet", {}).get("userErrors", [])), "OK" if not res.get("data",{}).get("metafieldsSet",{}).get("userErrors") else "")
print("done. backup at scratchpad/guia-boosters.backup.json")
