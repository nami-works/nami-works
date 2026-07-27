"""
Module A - master order-history pull (line-item level).

One read-only Shopify pull of all PAID orders over a wide window, saved to
orders_raw.jsonl. Powers the acquisition/rescue-campaign deliverables offline:
  - rescue cohort (rescue_cohort.py): one-time primer buyers, no hero
  - hero=repeat premise (hero_repeat_premise.py)
  - strict vs inclusive "no hero" mechanics
  - market-basket / co-purchase affinity (market_basket.py)

Captures per order: id, createdAt, email, customer id + lifetime numberOfOrders,
discountCodes, product subtotal, and every line's sku/qty/discountedTotal/productType.
Stable CREATED_AT sortKey pagination, cost-based throttle.

Usage:
  python order_history_fetch.py --since 2025-06-01
  python order_history_fetch.py --days 400
"""
import argparse
import datetime as dt
import json
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
GROWTH = HERE.parent
ENV = GROWTH.parent / ".env"

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def load_env():
    creds = {}
    with open(ENV, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                creds[k.strip()] = v.strip()
    return creds


CREDS = load_env()
SHOP = CREDS.get("SHOPIFY_SHOP_DOMAIN", "ge-beauty-cosmeticos.myshopify.com")
TOKEN = CREDS["SHOPIFY_ADMIN_ACCESS_TOKEN"]
API_VERSION = CREDS.get("SHOPIFY_API_VERSION", "2026-01")
GQL = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"


def graphql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(
        GQL, data=body,
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN},
    )
    for attempt in range(7):
        try:
            with urllib.request.urlopen(req) as resp:
                out = json.loads(resp.read().decode("utf-8"))
            if "errors" in out and out["errors"]:
                raise RuntimeError(out["errors"])
            ts = out.get("extensions", {}).get("cost", {}).get("throttleStatus", {})
            if ts.get("currentlyAvailable", 9999) < 500:
                time.sleep(1.2)
            return out["data"]
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503):
                time.sleep(2 ** attempt)
                continue
            raise
    raise RuntimeError("graphql retries exhausted")


ORDERS_Q = """
query($cursor: String, $q: String!) {
  orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      createdAt
      email
      discountCodes
      customer { id numberOfOrders }
      currentSubtotalPriceSet { shopMoney { amount } }
      lineItems(first: 50) {
        nodes {
          quantity
          sku
          discountedTotalSet { shopMoney { amount } }
          product { productType }
        }
      }
    }
  }
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since")
    ap.add_argument("--days", type=int, default=400)
    ap.add_argument("--out", default="orders_raw.jsonl")
    args = ap.parse_args()

    today = dt.date.today()
    since = args.since or (today - dt.timedelta(days=args.days)).isoformat()
    until = (today + dt.timedelta(days=1)).isoformat()
    q = f"created_at:>={since} created_at:<{until} financial_status:paid"
    print(f"[fetch] {since} .. {until}  shop={SHOP}", file=sys.stderr)

    out_path = HERE / args.out
    cursor = None
    n = 0
    with open(out_path, "w", encoding="utf-8") as fh:
        while True:
            data = graphql(ORDERS_Q, {"cursor": cursor, "q": q})
            conn = data["orders"]
            for o in conn["nodes"]:
                cust = o.get("customer") or {}
                rec = {
                    "id": o["id"].rsplit("/", 1)[-1],
                    "created_at": o["createdAt"],
                    "email": o.get("email"),
                    "customer_id": (cust.get("id") or "").rsplit("/", 1)[-1] or None,
                    "num_orders": cust.get("numberOfOrders"),
                    "discount_codes": o.get("discountCodes") or [],
                    "subtotal": o["currentSubtotalPriceSet"]["shopMoney"]["amount"]
                        if o.get("currentSubtotalPriceSet") else None,
                    "lines": [
                        {
                            "sku": (li.get("sku") or "").strip(),
                            "qty": li.get("quantity", 0),
                            "rev": (li.get("discountedTotalSet") or {}).get("shopMoney", {}).get("amount"),
                            "ptype": (li.get("product") or {}).get("productType"),
                        }
                        for li in o["lineItems"]["nodes"]
                    ],
                }
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                n += 1
            if n % 2000 == 0:
                print(f"  ...{n} orders", file=sys.stderr)
            if not conn["pageInfo"]["hasNextPage"]:
                break
            cursor = conn["pageInfo"]["endCursor"]

    print(f"[fetch] wrote {n} orders -> {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
