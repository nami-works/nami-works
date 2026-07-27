"""
Module A - abandoned checkouts on the acquisition funnel (deliverable 6).

Pulls recent abandoned checkouts, tallies count + whether the cart contained a hero
(001/002/003 any size) or the free-travel-size acquisition offer, to inform whether a
checkout upsell should be lighter-touch. Read-only.

Usage: python abandoned_checkouts.py --days 60
"""
import argparse, datetime as dt, json, sys, time, urllib.request, urllib.error
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV = HERE.parent.parent / ".env"
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

creds = {}
for line in ENV.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); creds[k.strip()] = v.strip()
SHOP = creds.get("SHOPIFY_SHOP_DOMAIN", "ge-beauty-cosmeticos.myshopify.com")
TOKEN = creds["SHOPIFY_ADMIN_ACCESS_TOKEN"]
API = creds.get("SHOPIFY_API_VERSION", "2026-01")
GQL = f"https://{SHOP}/admin/api/{API}/graphql.json"

HERO_FULL = {"GEB 001", "GEB 002", "GEB 003"}
HERO_TRAVEL = {"GEB 010", "GEB 011", "GEB 013"}
HERO_ANY = HERO_FULL | HERO_TRAVEL
PRIMERS = {"GEB 101", "GEB 102"}
TRAVEL = {"GEB 010", "GEB 011", "GEB 013", "GEB 029"}


def gql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}}).encode()
    req = urllib.request.Request(GQL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    for a in range(6):
        try:
            with urllib.request.urlopen(req) as r:
                out = json.loads(r.read().decode())
            if out.get("errors"): raise RuntimeError(out["errors"])
            ts = out.get("extensions", {}).get("cost", {}).get("throttleStatus", {})
            if ts.get("currentlyAvailable", 9999) < 500: time.sleep(1.0)
            return out["data"]
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503): time.sleep(2 ** a); continue
            raise
    raise RuntimeError("retries exhausted")

Q = """
query($cursor:String, $q:String!){
 abandonedCheckouts(first:100, after:$cursor, query:$q, sortKey:CREATED_AT){
  pageInfo{hasNextPage endCursor}
  nodes{
   createdAt completedAt
   totalPriceSet{shopMoney{amount}}
   lineItems(first:30){nodes{ quantity sku title }}
  }
 }
}
"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=60)
    args = ap.parse_args()
    today = dt.date.today()
    since = (today - dt.timedelta(days=args.days)).isoformat()
    q = f"created_at:>={since}"

    cursor = None
    n = 0
    with_hero = with_giveaway = with_primer = empty_sku = 0
    price_sum = 0.0
    priced = 0
    sku_counter = Counter()
    completed = 0
    while True:
        d = gql(Q, {"cursor": cursor, "q": q})["abandonedCheckouts"]
        for c in d["nodes"]:
            n += 1
            if c.get("completedAt"):
                completed += 1
            try:
                price_sum += float(c["totalPriceSet"]["shopMoney"]["amount"]); priced += 1
            except (TypeError, KeyError): pass
            skus = set()
            has_free_travel = False
            for li in c["lineItems"]["nodes"]:
                sku = (li.get("sku") or "").strip()
                if sku:
                    skus.add(sku); sku_counter[sku] += 1
                else:
                    empty_sku += 1
            if skus & HERO_ANY: with_hero += 1
            if skus & PRIMERS: with_primer += 1
            if skus & TRAVEL: with_giveaway += 1
        if not d["pageInfo"]["hasNextPage"]: break
        cursor = d["pageInfo"]["endCursor"]

    res = {
        "window_since": since, "days": args.days,
        "abandoned_checkouts": n,
        "completed_later": completed,
        "avg_cart_value_brl": round(price_sum / priced, 2) if priced else None,
        "carts_with_hero_any_size": with_hero,
        "carts_with_primer": with_primer,
        "carts_with_travel_size_sku": with_giveaway,
        "lines_missing_sku": empty_sku,
        "top_skus": sku_counter.most_common(20),
    }
    (HERE / "abandoned.out.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
