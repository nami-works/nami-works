"""
Tag customers whose orders fall within the email-notification cutoff
(<= 2026-05-15 18:00 BRT) with `fiscal-hold-extrema-2026-05`.

Reads:
  - scripts/_extrema_daily_breakdown.json (order names within cutoff)
  - scripts/_extrema_customers_snapshot.json (customer_id <- order_name map)

Writes to Shopify via the tagsAdd GraphQL mutation. Idempotent — re-running
adds the tag only if missing.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parents[2] / "gebeauty" / ".env"
TAG = "fiscal-hold-extrema-2026-05"
# Email scope cutoff in BRT date (inclusive). The breakdown JSON keys are
# YYYY-MM-DD in BRT. Everything <= 2026-05-15 is in scope.
SCOPE_DAYS = {"2026-03-09", "2026-05-12", "2026-05-13", "2026-05-14", "2026-05-15"}


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


# Load env + snapshots.
env = load_env(ENV_PATH)
domain = env["SHOPIFY_SHOP_DOMAIN"]
version = env.get("SHOPIFY_API_VERSION", "2025-01")
token = env["SHOPIFY_ADMIN_ACCESS_TOKEN"]

breakdown_path = Path(__file__).parent / "_extrema_daily_breakdown.json"
snapshot_path = Path(__file__).parent / "_extrema_customers_snapshot.json"

breakdown = json.loads(breakdown_path.read_text(encoding="utf-8"))
snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))

# Collect order names in scope (BRT day in SCOPE_DAYS, stuck bucket since
# flipped-in-scope = 0 per the breakdown). For safety we include both
# buckets in case scope shifts later.
in_scope_order_names = set()
for day, buckets in breakdown["by_day"].items():
    if day not in SCOPE_DAYS:
        continue
    for o in buckets.get("stuck", []):
        in_scope_order_names.add(o["name"])
    for o in buckets.get("flipped", []):
        in_scope_order_names.add(o["name"])
print(f"Order names in scope (<= 2026-05-15 18:00 BRT): {len(in_scope_order_names)}")

# Build customer_id set by intersecting the snapshot.
customer_to_orders = {}
for c in snapshot["customers"]:
    matching = [n for n in c["order_names"] if n in in_scope_order_names]
    if matching:
        customer_to_orders[c["customer_id"]] = matching

unique_customers = sorted(customer_to_orders.keys())
print(f"Unique customers to tag: {len(unique_customers)}")
total_orders_covered = sum(len(v) for v in customer_to_orders.values())
print(f"Orders covered by these customers: {total_orders_covered}")
print()

# Confirm before write.
print(f"Tag to apply: {TAG}")
print(f"Mutation: tagsAdd(id: $customerId, tags: [\"{TAG}\"])")
print(f"Mode: idempotent (skips if already tagged)")
print()

mutation = """
mutation AddTag($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) {
    node {
      ... on Customer { id tags }
    }
    userErrors { field message }
  }
}
"""

ok = 0
errs = 0
already_tagged = 0
failed = []

t0 = time.time()
for i, cid in enumerate(unique_customers, start=1):
    try:
        resp = shopify_graphql(domain, version, token, mutation, {"id": cid, "tags": [TAG]})
        if "errors" in resp:
            errs += 1
            failed.append({"customer_id": cid, "error": resp["errors"]})
            print(f"  [{i:>3}/{len(unique_customers)}] ✗ {cid}  graphql_errors={resp['errors']}")
            continue
        result = resp.get("data", {}).get("tagsAdd") or {}
        user_errors = result.get("userErrors") or []
        if user_errors:
            errs += 1
            failed.append({"customer_id": cid, "error": user_errors})
            print(f"  [{i:>3}/{len(unique_customers)}] ✗ {cid}  userErrors={user_errors}")
            continue
        # Success path — tagsAdd returns node with full tag list.
        tags_on_node = (result.get("node") or {}).get("tags") or []
        if TAG in tags_on_node:
            ok += 1
            if i % 20 == 0 or i == len(unique_customers):
                elapsed = time.time() - t0
                print(f"  [{i:>3}/{len(unique_customers)}] ok={ok} errs={errs}  elapsed={elapsed:.0f}s")
        else:
            already_tagged += 1
            print(f"  [{i:>3}/{len(unique_customers)}] ⚠ {cid}  tag missing from returned node — unexpected")
    except Exception as e:
        errs += 1
        failed.append({"customer_id": cid, "error": str(e)})
        print(f"  [{i:>3}/{len(unique_customers)}] ✗ {cid}  exception={e}")
    # ~5 req/sec to stay well under Shopify's leaky bucket
    time.sleep(0.2)

elapsed = time.time() - t0
print()
print(f"=== Done ===")
print(f"  customers tagged: {ok}")
print(f"  errors:           {errs}")
print(f"  elapsed:          {elapsed:.0f}s")

if failed:
    out = Path(__file__).parent / "_extrema_tag_failures.json"
    out.write_text(json.dumps(failed, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  failures detail written to {out}")
