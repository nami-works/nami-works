"""Verify Hexagon orders post-fix: methodType correctness in last 48h.

Read-only. Distinguishes:
- Strong Hexagon signal: sourceName == 'hexagon' OR raw app id '316281618433' OR app.name contains 'hexagon'
- Weak signal: shipping_additional_* / payment_additional_* custom attrs (present on ALL Hi Platform / regular web orders)

Reports per-order methodType from fulfillmentOrders[0].deliveryMethod.methodType.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

ENV_PATH = os.path.join(os.path.dirname(__file__), "..", ".env")
TOKEN = None
with open(ENV_PATH, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line.startswith("SHOPIFY_ADMIN_ACCESS_TOKEN="):
            TOKEN = line.split("=", 1)[1].strip()
            break
assert TOKEN

URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"


def graphql(query, variables=None):
    body = json.dumps({"query": query, **({"variables": variables} if variables else {})}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN,
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


QUERY = """
query Orders($q: String!, $cursor: String) {
  orders(first: 100, query: $q, after: $cursor, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      createdAt
      sourceName
      sourceIdentifier
      tags
      customer { displayName email }
      shippingAddress { city province }
      app { name id }
      customAttributes { key value }
      shippingLines(first: 5) { nodes { title code } }
      fulfillmentOrders(first: 5) {
        nodes {
          status
          deliveryMethod { methodType }
          assignedLocation { name }
        }
      }
    }
  }
}
"""


def fetch_window(hours):
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
    q = f"created_at:>={cutoff}"
    nodes = []
    cursor = None
    while True:
        resp = graphql(QUERY, {"q": q, "cursor": cursor})
        if "errors" in resp:
            print("GraphQL errors:", json.dumps(resp["errors"], indent=2))
            sys.exit(1)
        data = resp["data"]["orders"]
        nodes.extend(data["nodes"])
        if not data["pageInfo"]["hasNextPage"]:
            break
        cursor = data["pageInfo"]["endCursor"]
    return nodes, cutoff


def strong_hexagon(o):
    sn = (o.get("sourceName") or "").lower()
    app_name = ((o.get("app") or {}).get("name") or "").lower()
    if sn == "hexagon" or sn == "316281618433":
        return True, f"sourceName={o['sourceName']}"
    if "hexagon" in app_name or "hexagon" in sn:
        return True, f"app/source contains hexagon"
    return False, None


def has_hexagon_attrs(o):
    for ca in o.get("customAttributes") or []:
        k = (ca.get("key") or "").lower()
        if k.startswith("shipping_additional_") or k.startswith("payment_additional_"):
            return True
    return False


def intent_from_attrs(o):
    for ca in o.get("customAttributes") or []:
        if (ca.get("key") or "").lower() == "shipping_additional_delivery_method_type":
            return ca.get("value")
    return None


def order_method(o):
    fos = o.get("fulfillmentOrders", {}).get("nodes", [])
    if not fos:
        return None
    dm = fos[0].get("deliveryMethod")
    return dm.get("methodType") if dm else None


def shipping_titles(o):
    return [sl.get("title") for sl in (o.get("shippingLines") or {}).get("nodes", [])]


def report(orders, hours, cutoff):
    print(f"\n========= WINDOW: last {hours}h (since {cutoff}) =========")
    print(f"Total orders in window: {len(orders)}")

    # Distinct sourceName / app pairs (rough discovery)
    pairs = {}
    for o in orders:
        key = (o.get("sourceName"), ((o.get("app") or {}).get("name")))
        pairs[key] = pairs.get(key, 0) + 1
    print("\nDistinct (sourceName, app.name) pairs:")
    for k, v in sorted(pairs.items(), key=lambda kv: -kv[1]):
        print(f"  {v:>4}  sourceName={k[0]!r}  app={k[1]!r}")

    strong = [o for o in orders if strong_hexagon(o)[0]]
    weak_attrs = [o for o in orders if has_hexagon_attrs(o)]

    print(f"\nStrong Hexagon signal (sourceName/app): {len(strong)}")
    print(f"Has shipping_additional_*/payment_additional_* attrs: {len(weak_attrs)}")

    if not strong:
        print("\nNo orders matched the strong Hexagon signal in this window.")
        return False

    print("\n=== Strong-signal Hexagon orders ===")
    buckets = {}
    anomalies = []
    rows = []
    for o in strong:
        mt = order_method(o)
        intent = intent_from_attrs(o)
        ship = shipping_titles(o)
        addr = o.get("shippingAddress") or {}
        cust = (o.get("customer") or {}).get("displayName")
        attr_keys = sorted({ca["key"] for ca in (o.get("customAttributes") or [])})
        sig = strong_hexagon(o)[1]
        rows.append({
            "name": o["name"], "createdAt": o["createdAt"],
            "sourceName": o.get("sourceName"), "app": (o.get("app") or {}).get("name"),
            "signal": sig, "customer": cust,
            "city": f"{addr.get('city')}/{addr.get('province')}",
            "intent": intent, "methodType": mt, "shippingLines": ship,
            "tags": o.get("tags"), "has_hex_attrs": has_hexagon_attrs(o),
            "attr_keys_sample": attr_keys[:8],
        })
        buckets.setdefault(mt, []).append(o["name"])
        if intent:
            expected = {
                "PICKUP": "PICK_UP", "PICK_UP": "PICK_UP", "PICK-UP": "PICK_UP",
                "LOCAL": "LOCAL", "LOCAL_DELIVERY": "LOCAL",
                "SHIPPING": "SHIPPING", "SHIP": "SHIPPING",
            }.get(intent.upper())
            if expected and expected != mt:
                anomalies.append((o["name"], cust, intent, mt))

    rows.sort(key=lambda r: r["createdAt"])
    for r in rows:
        print(json.dumps(r, ensure_ascii=False, indent=2))
        print("---")

    print("\n=== Bucket summary (methodType -> order names) ===")
    for k, v in buckets.items():
        print(f"  {k}: {len(v)}  {v}")
    print("\n=== Anomalies (intent != methodType) ===")
    for a in anomalies:
        print(f"  {a}")
    return True


def main():
    for hours in (48, 72, 96):
        orders, cutoff = fetch_window(hours)
        found = report(orders, hours, cutoff)
        if found:
            return
        print(f"\n--> expanding window beyond {hours}h")
    print("\nNo strong-signal Hexagon orders even within 96h.")


if __name__ == "__main__":
    main()
