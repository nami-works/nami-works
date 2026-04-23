"""Patch order #77327 billing_address.company to match shipping_address.company.

Replicates the GE Beauty Online Store convention (CPF mirrored across
billing.company and shipping.company). Shipping already has '41311124420';
billing was null.

Re-reads the order before and after, diffs the billing_address, and prints a
clean summary.
"""
import json
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"
ORDER_ID = 7171455156544
ORDER_NAME = "77327"
TARGET_COMPANY = "41311124420"


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


def rest(method, path, body=None):
    url = f"https://{SHOP}/admin/api/{API_VERSION}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_order():
    return rest("GET", f"/orders/{ORDER_ID}.json")["order"]


def show_addresses(label, order):
    ba = order.get("billing_address") or {}
    sa = order.get("shipping_address") or {}
    print(f"  [{label}] billing.company  = {ba.get('company')!r}")
    print(f"  [{label}] billing.add_tax  = {ba.get('additional_tax_id')!r}")
    print(f"  [{label}] shipping.company = {sa.get('company')!r}")
    print(f"  [{label}] shipping.add_tax = {sa.get('additional_tax_id')!r}")


def main():
    print(f"[pre] fetching order #{ORDER_NAME} (id={ORDER_ID}) ...")
    before = fetch_order()
    show_addresses("before", before)

    ba = dict(before.get("billing_address") or {})
    if ba.get("company") == TARGET_COMPANY:
        print("[skip] billing.company already set to target; no write needed.")
        return

    # Preserve every existing billing_address field, then overwrite company.
    ba["company"] = TARGET_COMPANY
    payload = {
        "order": {
            "id": ORDER_ID,
            "billing_address": ba,
        }
    }
    print(f"[write] PUT /orders/{ORDER_ID}.json  billing_address.company = {TARGET_COMPANY!r}")
    resp = rest("PUT", f"/orders/{ORDER_ID}.json", payload)
    updated = resp.get("order") or {}
    show_addresses("resp ", updated)

    print(f"[post] re-fetching order to confirm ...")
    after = fetch_order()
    show_addresses("after", after)

    # Save both snapshots for audit
    out_dir = Path(__file__).parent
    (out_dir / f"_order_{ORDER_NAME}_before.json").write_text(
        json.dumps(before, indent=2, ensure_ascii=False), encoding="utf-8")
    (out_dir / f"_order_{ORDER_NAME}_after.json").write_text(
        json.dumps(after, indent=2, ensure_ascii=False), encoding="utf-8")
    print("[done] wrote _order_77327_before.json and _order_77327_after.json")


if __name__ == "__main__":
    main()
