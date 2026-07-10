"""
Pull all Shopify orders UNFULFILLED at CD Extrema, dedupe by customer,
report counts. Read-only — no tagging.
"""
import json
import sys
import urllib.request
from pathlib import Path
from collections import defaultdict

ENV_PATH = Path(__file__).resolve().parents[2] / "gebeauty" / ".env"


def load_env(path):
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def shopify_graphql(domain, version, token, query, variables):
    url = f"https://{domain}/admin/api/{version}/graphql.json"
    body = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


env = load_env(ENV_PATH)
domain = env["SHOPIFY_SHOP_DOMAIN"]
version = env.get("SHOPIFY_API_VERSION", "2025-01")
token = env["SHOPIFY_ADMIN_ACCESS_TOKEN"]

q = """
query Extrema($q: String!, $first: Int!, $after: String) {
  orders(query: $q, first: $first, after: $after, sortKey: CREATED_AT) {
    edges {
      cursor
      node {
        id name email
        customer {
          id
          displayName
          email
          tags
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""

shop_filter = "fulfillment_location_id:105538257216 fulfillment_status:unshipped status:open"
orders = []
cursor = None
page = 0
while True:
    page += 1
    resp = shopify_graphql(domain, version, token, q, {"q": shop_filter, "first": 100, "after": cursor})
    if "errors" in resp:
        print("Shopify error:", resp["errors"], file=sys.stderr); sys.exit(1)
    edges = resp["data"]["orders"]["edges"]
    for e in edges:
        n = e["node"]
        c = n.get("customer")
        orders.append({
            "order_id": n["id"],
            "order_name": n["name"],
            "order_email": n.get("email"),
            "customer_id": c.get("id") if c else None,
            "customer_email": c.get("email") if c else None,
            "customer_name": c.get("displayName") if c else None,
            "customer_tags": c.get("tags") if c else None,
        })
    info = resp["data"]["orders"]["pageInfo"]
    if not info.get("hasNextPage"):
        break
    cursor = info.get("endCursor")

with_customer = [o for o in orders if o["customer_id"]]
without_customer = [o for o in orders if not o["customer_id"]]

# Dedupe by customer_id, also count orders per customer.
orders_per_customer = defaultdict(list)
for o in with_customer:
    orders_per_customer[o["customer_id"]].append(o["order_name"])

print(f"Total Shopify orders at CD Extrema:       {len(orders)}")
print(f"  with customer record:                   {len(with_customer)}")
print(f"  without customer record (guest):        {len(without_customer)}")
print(f"  unique customer IDs:                    {len(orders_per_customer)}")
print()

multi_order = {cid: orders for cid, orders in orders_per_customer.items() if len(orders) > 1}
print(f"Customers with >1 stuck order: {len(multi_order)}")
if multi_order:
    for cid, names in list(multi_order.items())[:10]:
        print(f"  {cid}  orders={','.join(names)}")
    print()

if without_customer:
    print(f"Sample of orders without customer record:")
    for o in without_customer[:10]:
        print(f"  #{o['order_name']}  order_email={o['order_email']}")
    print()

# Check how many customer records ALREADY carry a fiscal-hold-style tag (idempotency check).
candidate_tag = "fiscal-hold-extrema-2026-05"
already_tagged = [o for o in with_customer if o["customer_tags"] and candidate_tag in o["customer_tags"]]
print(f"Customers already carrying '{candidate_tag}': {len(already_tagged)}")

# Snapshot to disk for the tagging pass.
out = Path(__file__).parent / "_extrema_customers_snapshot.json"
out.write_text(json.dumps({
    "total_orders": len(orders),
    "with_customer": len(with_customer),
    "without_customer_count": len(without_customer),
    "unique_customer_ids": len(orders_per_customer),
    "customers": [
        {"customer_id": cid, "order_names": names}
        for cid, names in orders_per_customer.items()
    ],
    "orders_without_customer": without_customer,
}, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"\nSnapshot written to {out}")
