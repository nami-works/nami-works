"""
Identify customers whose orders fall in the Fri 2026-05-15 18:00-23:59 BRT
window (out of email scope) and were incorrectly tagged. Remove the tag
from those customers IF none of their other Extrema orders fall in the
correct scope.
"""
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parents[2] / "gebeauty" / ".env"
TAG = "fiscal-hold-extrema-2026-05"
BRT = timezone(timedelta(hours=-3))


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

breakdown = json.loads((Path(__file__).parent / "_extrema_daily_breakdown.json").read_text(encoding="utf-8"))
snapshot = json.loads((Path(__file__).parent / "_extrema_customers_snapshot.json").read_text(encoding="utf-8"))

# Compute IN-SCOPE order names: all orders <= 2026-05-15 18:00 BRT.
in_scope_names = set()
for day, buckets in breakdown["by_day"].items():
    if day < "2026-05-15":
        for o in buckets.get("stuck", []) + buckets.get("flipped", []):
            in_scope_names.add(o["name"])
    elif day == "2026-05-15":
        for o in buckets.get("stuck", []) + buckets.get("flipped", []):
            ts = datetime.strptime(o["createdAt_brt"], "%Y-%m-%d %H:%M").replace(tzinfo=BRT)
            if ts.hour < 18:
                in_scope_names.add(o["name"])
print(f"Truly in-scope order names: {len(in_scope_names)}")

# Out-of-scope Friday orders.
fri_oos_names = set()
for o in breakdown["by_day"].get("2026-05-15", {}).get("stuck", []) + breakdown["by_day"].get("2026-05-15", {}).get("flipped", []):
    if o["name"] not in in_scope_names:
        fri_oos_names.add(o["name"])
print(f"Friday out-of-scope (>=18:00) names: {len(fri_oos_names)}")
print(f"  {sorted(fri_oos_names)}")

# For each customer in the snapshot, decide if they have ANY in-scope order
# (keep the tag) or ONLY out-of-scope Friday orders (remove the tag).
to_remove = []
to_keep = []
for c in snapshot["customers"]:
    has_in_scope = any(n in in_scope_names for n in c["order_names"])
    has_oos_friday = any(n in fri_oos_names for n in c["order_names"])
    if has_oos_friday and not has_in_scope:
        to_remove.append(c)
    elif has_in_scope:
        to_keep.append(c)

print(f"\nCustomers to KEEP tagged (have in-scope order): {len(to_keep)}")
print(f"Customers to UNTAG (only Friday after 18:00):    {len(to_remove)}")
for c in to_remove:
    print(f"  {c['customer_id']}  orders={c['order_names']}")

# Execute removals.
mutation = """
mutation RemoveTag($id: ID!, $tags: [String!]!) {
  tagsRemove(id: $id, tags: $tags) {
    node { ... on Customer { id tags } }
    userErrors { field message }
  }
}
"""
print()
if not to_remove:
    print("Nothing to untag. Done.")
    sys.exit(0)

ok = 0
errs = 0
for c in to_remove:
    resp = shopify_graphql(domain, version, token, mutation, {"id": c["customer_id"], "tags": [TAG]})
    user_errors = (resp.get("data", {}).get("tagsRemove") or {}).get("userErrors") or []
    if "errors" in resp or user_errors:
        errs += 1
        print(f"  ✗ {c['customer_id']}  errors={resp.get('errors') or user_errors}")
    else:
        ok += 1
        print(f"  ✓ {c['customer_id']}  untagged")
    time.sleep(0.2)

print()
print(f"Removed: {ok}  Errors: {errs}")
