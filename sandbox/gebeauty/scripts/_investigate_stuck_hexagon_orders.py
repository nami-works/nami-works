"""Investigate stuck Hexagon orders flagged in 2026-05-21 CSV.

Read-only. Per-order diagnostic dump for 13 orders across two buckets.
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
assert TOKEN, "missing token"

URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"

# (bucket, name, legacyId)
ORDERS = [
    ("unfulfilled", "#80204", "7217951113536"),
    ("unfulfilled", "#80219", "7218243469632"),
    ("unfulfilled", "#80247", "7218714771776"),
    ("unfulfilled", "#80250", "7218746458432"),
    ("unfulfilled", "#80288", "7220950434112"),
    ("unfulfilled", "#80296", "7221070954816"),
    ("unfulfilled", "#80316", "7222733734208"),
    ("unfulfilled", "#80323", "7222803071296"),
    ("unfulfilled", "#80336", "7223131046208"),
    ("unfulfilled", "#80351", "7223361995072"),
    ("fake-tracking-cancelled", "#80273", "7218945229120"),
    ("fake-tracking-cancelled", "#80943", "7275890540864"),
    ("fake-tracking-cancelled", "#80945", "7275952963904"),
]


def graphql(query, variables=None):
    body = json.dumps({"query": query, **({"variables": variables} if variables else {})}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN,
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


QUERY = """
query Order($id: ID!) {
  order(id: $id) {
    id
    name
    createdAt
    cancelledAt
    closed
    closedAt
    displayFinancialStatus
    displayFulfillmentStatus
    tags
    note
    sourceName
    app { name }
    customer {
      displayName
      defaultPhoneNumber { phoneNumber }
    }
    shippingAddress {
      address1 city province zip country phone
    }
    billingAddress {
      address1 city province zip country phone
    }
    customAttributes { key value }
    shippingLines(first: 5) {
      nodes { title code source }
    }
    fulfillmentOrders(first: 10) {
      nodes {
        id
        status
        requestStatus
        assignedLocation { name location { id } }
        deliveryMethod { methodType brandedPromise { handle name } }
      }
    }
    fulfillments(first: 10) {
      id
      status
      createdAt
      trackingInfo { number company url }
    }
  }
}
"""


def fetch(legacy_id):
    gid = f"gid://shopify/Order/{legacy_id}"
    return graphql(QUERY, {"id": gid})


def attr(o, key):
    for ca in o.get("customAttributes") or []:
        if (ca.get("key") or "").lower() == key.lower():
            return ca.get("value")
    return None


def short_addr(a):
    if not a:
        return None
    return f"{a.get('city')}/{a.get('province')} (phone={a.get('phone')})"


def phone_area(p):
    if not p:
        return None
    # extract DDD from +55 XX ... or 55XX...
    digits = "".join(c for c in p if c.isdigit())
    if digits.startswith("55") and len(digits) >= 4:
        return digits[2:4]
    return digits[:2] if len(digits) >= 2 else None


def main():
    results = []
    for bucket, name, legacy_id in ORDERS:
        resp = fetch(legacy_id)
        if "errors" in resp or not resp.get("data", {}).get("order"):
            print(f"!! {name} ({legacy_id}): {json.dumps(resp)[:300]}")
            continue
        o = resp["data"]["order"]
        fos = o.get("fulfillmentOrders", {}).get("nodes", [])
        fo0 = fos[0] if fos else {}
        dm = (fo0.get("deliveryMethod") or {})
        ship = o.get("shippingAddress") or {}
        bill = o.get("billingAddress") or {}
        cust = o.get("customer") or {}
        cust_phone = (cust.get("defaultPhoneNumber") or {}).get("phoneNumber")
        intent = attr(o, "shipping_additional_delivery_method_type")
        intent_loc_id = attr(o, "shipping_additional_location_id")
        intent_loc_name = attr(o, "shipping_additional_location_name")

        fulfillments = o.get("fulfillments") or []
        fulfill_summary = []
        for f in fulfillments:
            tis = f.get("trackingInfo") or []
            fulfill_summary.append({
                "id": f.get("id"),
                "status": f.get("status"),
                "createdAt": f.get("createdAt"),
                "tracking": [(t.get("number"), t.get("company"), t.get("url")) for t in tis],
            })

        record = {
            "bucket": bucket,
            "name": name,
            "createdAt": o.get("createdAt"),
            "cancelledAt": o.get("cancelledAt"),
            "closed": o.get("closed"),
            "displayFinancialStatus": o.get("displayFinancialStatus"),
            "displayFulfillmentStatus": o.get("displayFulfillmentStatus"),
            "tags": o.get("tags"),
            "sourceName": o.get("sourceName"),
            "app": (o.get("app") or {}).get("name"),
            "customer": cust.get("displayName"),
            "customerPhone": cust_phone,
            "customerPhoneArea": phone_area(cust_phone),
            "ship_address": short_addr(ship),
            "bill_address": short_addr(bill),
            "intent": intent,
            "intent_loc_id": intent_loc_id,
            "intent_loc_name": intent_loc_name,
            "methodType": dm.get("methodType"),
            "brandedPromise": (dm.get("brandedPromise") or {}).get("handle"),
            "assignedLocation": (fo0.get("assignedLocation") or {}).get("name"),
            "assignedLocationId": ((fo0.get("assignedLocation") or {}).get("location") or {}).get("id"),
            "foStatus": fo0.get("status"),
            "foRequestStatus": fo0.get("requestStatus"),
            "fulfillments": fulfill_summary,
            "shippingLines": [n.get("title") for n in (o.get("shippingLines") or {}).get("nodes", [])],
            "allCustomAttrs": {ca["key"]: ca["value"] for ca in (o.get("customAttributes") or [])},
        }
        results.append(record)
        print(json.dumps(record, ensure_ascii=False, indent=2))
        print("---")

    # Write JSON dump for follow-up
    out_path = os.path.join(os.path.dirname(__file__), "_investigate_stuck_hexagon_orders.out.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()
