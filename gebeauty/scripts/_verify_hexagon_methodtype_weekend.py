"""Verify Hexagon orders post-fix: methodType correctness since 2026-05-21 22:25 UTC.

Read-only. Window matches prior verification cutoff so we can see what landed over the weekend.
"""
import json
import os
import sys
import urllib.request

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

# Window cutoff (UTC) - matches prior 48h verification end
CUTOFF = "2026-05-21T22:25:00Z"


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


def fetch_window():
    q = f"created_at:>={CUTOFF}"
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
    return nodes


def strong_hexagon(o):
    sn = (o.get("sourceName") or "").lower()
    app_name = ((o.get("app") or {}).get("name") or "").lower()
    if sn == "hexagon" or sn == "316281618433":
        return True, f"sourceName={o['sourceName']}"
    if "hexagon" in app_name or "hexagon" in sn:
        return True, "app/source contains hexagon"
    tags = [t.lower() for t in (o.get("tags") or [])]
    for t in tags:
        if t == "hexagon-whatsapp" or t.startswith("hex-"):
            return True, f"tag={t}"
    return False, None


def intent_from_attrs(o):
    for ca in o.get("customAttributes") or []:
        if (ca.get("key") or "").lower() == "shipping_additional_delivery_method_type":
            return ca.get("value")
    return None


def location_id_from_attrs(o):
    for ca in o.get("customAttributes") or []:
        if (ca.get("key") or "").lower() == "shipping_additional_location_id":
            return ca.get("value")
    return None


def order_method(o):
    fos = (o.get("fulfillmentOrders") or {}).get("nodes", [])
    if not fos:
        return None
    dm = fos[0].get("deliveryMethod")
    return dm.get("methodType") if dm else None


def assigned_location(o):
    fos = (o.get("fulfillmentOrders") or {}).get("nodes", [])
    if not fos:
        return None
    loc = fos[0].get("assignedLocation")
    return loc.get("name") if loc else None


def shipping_titles(o):
    return [sl.get("title") for sl in (o.get("shippingLines") or {}).get("nodes", [])]


EXPECTED = {
    "PICKUP": "PICK_UP",
    "PICK_UP": "PICK_UP",
    "PICK-UP": "PICK_UP",
    "LOCAL": "LOCAL",
    "LOCAL_DELIVERY": "LOCAL",
    "SHIPPING": "SHIPPING",
    "SHIP": "SHIPPING",
}


def title_signal(titles):
    """Return 'pickup', 'local', 'shipping' or None based on shipping line titles."""
    joined = " | ".join(t for t in titles if t).lower()
    if not joined:
        return None
    if "retirada" in joined or "pickup" in joined or "pick-up" in joined or "pick up" in joined:
        return "pickup"
    if "local delivery" in joined or "entrega local" in joined or "entrega rapida" in joined:
        return "local"
    # Known store names that could indicate pickup
    pickup_locs = ["shops jardins", "shopping recife", "vila olimpia", "fashion mall"]
    for p in pickup_locs:
        if p in joined:
            return "pickup"
    if "sedex" in joined or "total express" in joined or "correios" in joined or "transportadora" in joined:
        return "shipping"
    return None


def main():
    print(f"Window cutoff (UTC): created_at:>={CUTOFF}")
    orders = fetch_window()
    print(f"Total orders in window: {len(orders)}")

    pairs = {}
    for o in orders:
        key = (o.get("sourceName"), ((o.get("app") or {}).get("name")))
        pairs[key] = pairs.get(key, 0) + 1
    print("\nDistinct (sourceName, app.name) pairs:")
    for k, v in sorted(pairs.items(), key=lambda kv: -kv[1]):
        print(f"  {v:>4}  sourceName={k[0]!r}  app={k[1]!r}")

    strong = []
    for o in orders:
        ok, sig = strong_hexagon(o)
        if ok:
            strong.append((o, sig))
    print(f"\nStrong Hexagon orders: {len(strong)}")
    if not strong:
        print("No Hexagon orders matched.")
        return

    # Build the consistency matrix
    # Intent buckets:
    intent_buckets = {}   # intent -> list of (order, mt, titles)
    rows = []
    method_counts = {}

    for o, sig in strong:
        intent = intent_from_attrs(o)
        mt = order_method(o)
        titles = shipping_titles(o)
        loc_attr = location_id_from_attrs(o)
        assigned = assigned_location(o)
        tsignal = title_signal(titles)
        norm_intent = (intent or "").upper() or "(none)"
        intent_buckets.setdefault(norm_intent, []).append(o)
        method_counts[mt] = method_counts.get(mt, 0) + 1
        rows.append({
            "name": o["name"],
            "createdAt": o["createdAt"],
            "sourceName": o.get("sourceName"),
            "app": (o.get("app") or {}).get("name"),
            "signal": sig,
            "intent": intent,
            "methodType": mt,
            "expected": EXPECTED.get(norm_intent),
            "match": EXPECTED.get(norm_intent) == mt if intent else None,
            "shippingLines": titles,
            "title_signal": tsignal,
            "loc_attr": loc_attr,
            "assigned_location": assigned,
            "tags": o.get("tags"),
        })

    rows.sort(key=lambda r: r["createdAt"])

    print("\n=== Per-intent consistency matrix ===")
    print(f"{'Intent':<20} {'Total':>6} {'mt=null':>8} {'matches':>8} {'mismatch':>9}  mismatch order#s")
    matrix_rows = []
    for intent_key, os_ in intent_buckets.items():
        total = len(os_)
        nulls = 0
        matches = 0
        mismatches = []
        expected = EXPECTED.get(intent_key)
        for o in os_:
            mt = order_method(o)
            if mt is None:
                nulls += 1
                if expected is not None:
                    mismatches.append(o["name"])
                continue
            if expected is None:
                # No expected mapping (e.g., intent=(none))
                continue
            if mt == expected:
                matches += 1
            else:
                mismatches.append(o["name"])
        matrix_rows.append((intent_key, total, nulls, matches, mismatches))
        print(f"{intent_key:<20} {total:>6} {nulls:>8} {matches:>8} {len(mismatches):>9}  {mismatches[:8]}")

    # Distinct methodType counts overall
    print("\n=== methodType distribution (overall) ===")
    for k, v in sorted(method_counts.items(), key=lambda kv: -kv[1]):
        print(f"  {k}: {v}")

    # Green-light: orders where methodType is PICK_UP or LOCAL
    print("\n=== GREEN-LIGHT (methodType in {PICK_UP, LOCAL}) ===")
    greens = [r for r in rows if r["methodType"] in ("PICK_UP", "LOCAL")]
    print(f"Count: {len(greens)}")
    for r in greens:
        print(f"  {r['name']}  intent={r['intent']}  methodType={r['methodType']}  "
              f"titles={r['shippingLines']}  loc={r['assigned_location']}  loc_attr={r['loc_attr']}")

    # Red flags: intent vs methodType mismatch (excluding null intent or no expected mapping)
    print("\n=== RED-FLAGS (intent has expected but methodType differs or is null) ===")
    reds = [r for r in rows if r["intent"] and r["expected"] is not None and r["methodType"] != r["expected"]]
    print(f"Count: {len(reds)}")
    for r in reds:
        print(f"  {r['name']}  intent={r['intent']}  expected={r['expected']}  "
              f"methodType={r['methodType']}  titles={r['shippingLines']}")

    # Title vs intent cross-check
    print("\n=== Title-signal vs intent disagreement ===")
    for r in rows:
        ts = r["title_signal"]
        intent = (r["intent"] or "").upper()
        if ts is None:
            continue
        # Map title signal to canonical intent
        ts_canon = {"pickup": "PICKUP", "local": "LOCAL_DELIVERY", "shipping": "SHIPPING"}[ts]
        # Acceptable intent aliases
        intent_canon = {
            "PICKUP": "PICKUP", "PICK_UP": "PICKUP", "PICK-UP": "PICKUP",
            "LOCAL": "LOCAL_DELIVERY", "LOCAL_DELIVERY": "LOCAL_DELIVERY",
            "SHIPPING": "SHIPPING", "SHIP": "SHIPPING", "": "(none)",
        }.get(intent, intent or "(none)")
        if intent_canon != ts_canon:
            print(f"  {r['name']}  title_signal={ts}  intent={r['intent']}  "
                  f"methodType={r['methodType']}  titles={r['shippingLines']}")

    # Dump full rows JSON for archival
    out_path = os.path.join(os.path.dirname(__file__), "_verify_hexagon_methodtype_weekend.out.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"cutoff": CUTOFF, "total": len(orders), "strong": len(strong), "rows": rows}, f, ensure_ascii=False, indent=2)
    print(f"\nFull rows JSON written to {out_path}")


if __name__ == "__main__":
    main()
