"""Scan recent Online Store (source_name=web) orders and inspect which fields
carry the CPF/CNPJ. Shows how many have `company` vs `additional_tax_id` populated.
"""
import json
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"


def load_env():
    env = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


ENV = load_env()
TOKEN = ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]
SHOP = ENV["SHOPIFY_SHOP_DOMAIN"]
API_VERSION = ENV.get("SHOPIFY_API_VERSION", "2026-01")


def rest_get(path, params=None):
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""
    url = f"https://{SHOP}/admin/api/{API_VERSION}{path}{qs}"
    req = urllib.request.Request(url, headers={
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def summarize(o):
    ba = o.get("billing_address") or {}
    sa = o.get("shipping_address") or {}
    return {
        "name": o.get("name"),
        "source": o.get("source_name"),
        "b_company": ba.get("company"),
        "b_tax": ba.get("additional_tax_id"),
        "s_company": sa.get("company"),
        "s_tax": sa.get("additional_tax_id"),
    }


def main(pages=3, limit=100):
    out_dir = Path(__file__).parent
    web_rows = []

    since_id = None
    for _ in range(pages):
        params = {"status": "any", "limit": limit}
        if since_id:
            params["since_id"] = since_id
        payload = rest_get("/orders.json", params)
        orders = payload.get("orders", [])
        if not orders:
            break
        for o in orders:
            if o.get("source_name") == "web":
                web_rows.append((summarize(o), o))
        since_id = orders[-1].get("id")

    print(f"Web orders scanned: {len(web_rows)}")
    with_company_b = [r for r, _ in web_rows if r["b_company"]]
    with_company_s = [r for r, _ in web_rows if r["s_company"]]
    with_tax_b = [r for r, _ in web_rows if r["b_tax"]]
    with_tax_s = [r for r, _ in web_rows if r["s_tax"]]
    print(f"  billing.company populated : {len(with_company_b)}")
    print(f"  shipping.company populated: {len(with_company_s)}")
    print(f"  billing.additional_tax_id : {len(with_tax_b)}")
    print(f"  shipping.additional_tax_id: {len(with_tax_s)}")
    print()
    print("Sample of first 10 web orders (any filled field):")
    shown = 0
    for row, o in web_rows:
        if not any([row["b_company"], row["s_company"], row["b_tax"], row["s_tax"]]):
            continue
        print(f"  {row['name']:>6} | b.co={str(row['b_company'])[:15]:<15} b.tax={str(row['b_tax'])[:15]:<15} s.co={str(row['s_company'])[:15]:<15} s.tax={str(row['s_tax'])[:15]:<15}")
        shown += 1
        if shown >= 10:
            break

    # Pick a web order with BOTH company + tax somewhere
    best = None
    for row, o in web_rows:
        b_both = row["b_company"] and row["b_tax"]
        s_both = row["s_company"] and row["s_tax"]
        if b_both or s_both:
            best = (row, o)
            break
    if best:
        row, o = best
        out = out_dir / f"_order_{row['name']}.json"
        out.write_text(json.dumps(o, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\nReference (both fields filled on an address): {row['name']} -> {out.relative_to(ROOT)}")
        return

    # Fall back: any web order with at least company populated (BR workaround)
    fallback = None
    for row, o in web_rows:
        if row["b_company"] or row["s_company"]:
            fallback = (row, o)
            break
    if fallback:
        row, o = fallback
        out = out_dir / f"_order_{row['name']}_webref.json"
        out.write_text(json.dumps(o, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\nFallback ref (company populated, tax empty): {row['name']} -> {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main(pages=3, limit=100)
