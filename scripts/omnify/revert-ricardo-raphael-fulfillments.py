"""
Cancel every manual fulfillment created by Ricardo Symphronio or
Raphael Martins in the last ~60 minutes (24 fulfillments total).

After fulfillmentCancel, the fulfillment goes to status=CANCELLED,
the order's displayFulfillmentStatus returns to UNFULFILLED (or
PARTIALLY_FULFILLED if the order has other still-active fulfillments),
and the associated FulfillmentOrder re-opens.

Side effect: any "delivered" event Ricardo/Raphael fired on these
orders stays in the event log (we're not unsending those customer
emails — that's not something Shopify exposes anyway). The fulfillment
itself disappears though, so the order surfaces in the LD UI again.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

ENV_PATH = Path(r"C:\Users\Lucas Guimarães\Desktop\nami-works\sandbox\gebeauty\.env")

# (order_name, fulfillment_gid, staff)
TARGETS = [
    # Ricardo Symphronio — 13 orders
    ("80855", "gid://shopify/Fulfillment/6439455883584", "Ricardo"),
    ("80861", "gid://shopify/Fulfillment/6439455490368", "Ricardo"),
    ("80867", "gid://shopify/Fulfillment/6439455097152", "Ricardo"),
    ("80869", "gid://shopify/Fulfillment/6439454769472", "Ricardo"),
    ("80892", "gid://shopify/Fulfillment/6439454474560", "Ricardo"),
    ("80898", "gid://shopify/Fulfillment/6439452606784", "Ricardo"),
    ("80899", "gid://shopify/Fulfillment/6439452246336", "Ricardo"),
    ("80900", "gid://shopify/Fulfillment/6439451787584", "Ricardo"),
    ("80903", "gid://shopify/Fulfillment/6439447593280", "Ricardo"),
    ("80907", "gid://shopify/Fulfillment/6439445332288", "Ricardo"),
    ("80909", "gid://shopify/Fulfillment/6439445102912", "Ricardo"),
    ("80910", "gid://shopify/Fulfillment/6439444840768", "Ricardo"),
    ("80945", "gid://shopify/Fulfillment/6439459389760", "Ricardo"),
    # Raphael Martins — 11 orders
    ("80920", "gid://shopify/Fulfillment/6439440253248", "Raphael"),
    ("80922", "gid://shopify/Fulfillment/6439439892800", "Raphael"),
    ("80923", "gid://shopify/Fulfillment/6439439761728", "Raphael"),
    ("80932", "gid://shopify/Fulfillment/6439439040832", "Raphael"),
    ("80936", "gid://shopify/Fulfillment/6439430619456", "Raphael"),
    ("80937", "gid://shopify/Fulfillment/6439430029632", "Raphael"),
    ("80938", "gid://shopify/Fulfillment/6439429275968", "Raphael"),
    ("80939", "gid://shopify/Fulfillment/6439427965248", "Raphael"),
    ("80941", "gid://shopify/Fulfillment/6439423541568", "Raphael"),
    ("80942", "gid://shopify/Fulfillment/6439426949440", "Raphael"),
    ("80943", "gid://shopify/Fulfillment/6439422099776", "Raphael"),
]


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

mutation = """
mutation Cancel($id: ID!) {
  fulfillmentCancel(id: $id) {
    fulfillment { id status }
    userErrors { field message }
  }
}
"""

print(f"Cancelling {len(TARGETS)} fulfillments...")
print()

ok = 0
errs = 0
failed = []

t0 = time.time()
for i, (name, fid, staff) in enumerate(TARGETS, start=1):
    try:
        resp = shopify_graphql(domain, version, token, mutation, {"id": fid})
        if "errors" in resp:
            errs += 1
            failed.append({"order": name, "fid": fid, "staff": staff, "error": resp["errors"]})
            print(f"  [{i:>2}/{len(TARGETS)}] ✗ #{name} ({staff}) — graphql_errors")
            continue
        result = resp.get("data", {}).get("fulfillmentCancel") or {}
        user_errors = result.get("userErrors") or []
        ful = result.get("fulfillment") or {}
        if user_errors:
            errs += 1
            failed.append({"order": name, "fid": fid, "staff": staff, "error": user_errors})
            print(f"  [{i:>2}/{len(TARGETS)}] ✗ #{name} ({staff}) — userErrors={user_errors}")
            continue
        if ful.get("status") == "CANCELLED":
            ok += 1
            print(f"  [{i:>2}/{len(TARGETS)}] ✓ #{name} ({staff}) — fulfillment={ful.get('id','?').split('/')[-1]} status=CANCELLED")
        else:
            errs += 1
            failed.append({"order": name, "fid": fid, "staff": staff, "error": f"unexpected status: {ful.get('status')}"})
            print(f"  [{i:>2}/{len(TARGETS)}] ⚠ #{name} ({staff}) — unexpected status: {ful.get('status')}")
    except Exception as e:
        errs += 1
        failed.append({"order": name, "fid": fid, "staff": staff, "error": str(e)})
        print(f"  [{i:>2}/{len(TARGETS)}] ✗ #{name} ({staff}) — exception={e}")
    time.sleep(0.2)

elapsed = time.time() - t0
print()
print(f"=== Done ===")
print(f"  Cancelled successfully: {ok}")
print(f"  Errors:                 {errs}")
print(f"  Elapsed:                {elapsed:.0f}s")

if failed:
    out = Path(__file__).parent / "_revert_failures.json"
    out.write_text(json.dumps(failed, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  Failure detail -> {out}")
