"""
Wire custom.produto (list.product_reference) onto the 137 VISIBLE GE Beauty blog
posts, per the content-director full audit plan (Phase 1: product matching).

- 130 posts: set custom.produto = ordered list of product GIDs from the plan.
- 7 editorial posts: clear custom.produto if a stray value exists.

Idempotent: reads existing custom.produto and skips posts already correct.
Dry-run by default; mutates only with --confirm.

Plan source: scratchpad/audit_plan.json (each entry: {gid (article), handle, title,
products:[{handle,gid}]}).

Run (dry):     C:/Python314/python.exe gebeauty/scripts/wire_blog_related_products.py
Run (commit):  C:/Python314/python.exe gebeauty/scripts/wire_blog_related_products.py --confirm
"""

import json
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
PLAN_PATH = Path(
    r"C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--Users-Lucas-Guimar-es-Desktop-nami-works"
    r"/0de7f476-47ed-49a6-a5ea-6f213d8fa03c/scratchpad/audit_plan.json"
)
CONFIRM = "--confirm" in sys.argv


def load_env(path):
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip()
    return env


ENV = load_env(ENV_PATH)
SHOP = ENV["SHOPIFY_SHOP_DOMAIN"]
TOKEN = ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]
API_VERSION = ENV.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"


def graphql(query, variables=None):
    body = json.dumps({"query": query, **({"variables": variables} if variables else {})}).encode("utf-8")
    req = urllib.request.Request(
        URL, data=body,
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN},
    )
    while True:
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2)
                continue
            raise
    if "errors" in data:
        raise RuntimeError(f"GraphQL errors: {json.dumps(data['errors'])}")
    return data


def respect_throttle(data):
    ts = data.get("extensions", {}).get("cost", {}).get("throttleStatus", {})
    avail = ts.get("currentlyAvailable")
    restore = ts.get("restoreRate", 200)
    if avail is not None and avail < 200:
        time.sleep(max(0.0, (400 - avail) / max(restore, 1)))


NODES_QUERY = """
query Nodes($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Article { id metafield(namespace: "custom", key: "produto") { value } }
  }
}
"""
METAFIELDS_SET = """
mutation Set($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) { userErrors { field message } }
}
"""
METAFIELDS_DELETE = """
mutation Del($metafields: [MetafieldIdentifierInput!]!) {
  metafieldsDelete(metafields: $metafields) { deletedMetafields { key } userErrors { field message } }
}
"""


def parse_list(value):
    if not value:
        return []
    try:
        return list(json.loads(value))
    except Exception:
        return []


def main():
    plan = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
    desired = {e["gid"]: [p["gid"] for p in e["products"]] for e in plan}
    title = {e["gid"]: e["title"] for e in plan}
    ids = list(desired.keys())

    # fetch existing custom.produto for all articles
    existing = {}
    for i in range(0, len(ids), 50):
        data = graphql(NODES_QUERY, {"ids": ids[i:i + 50]})
        respect_throttle(data)
        for n in data["data"]["nodes"]:
            if n:
                existing[n["id"]] = parse_list((n.get("metafield") or {}).get("value"))

    to_set, to_clear, ok = [], [], 0
    for aid in ids:
        want = desired[aid]
        have = existing.get(aid, [])
        if want:
            if have == want:
                ok += 1
            else:
                to_set.append(aid)
        else:  # editorial -> should be empty
            if have:
                to_clear.append(aid)
            else:
                ok += 1

    print(f"Store: {SHOP}  API: {API_VERSION}  | mode: {'COMMIT' if CONFIRM else 'DRY-RUN'}")
    print(f"posts: {len(ids)} | already correct: {ok} | to set: {len(to_set)} | to clear: {len(to_clear)}")
    print("\n-- sample of writes --")
    for aid in to_set[:6]:
        print(f"  SET  {title[aid][:48]:48} <- {[g.split('/')[-1] for g in desired[aid]]}")
    for aid in to_clear[:4]:
        print(f"  CLR  {title[aid][:48]}")

    if not CONFIRM:
        print("\nDRY-RUN only. Re-run with --confirm to write.")
        return

    # SET in batches: <=25 metafields/call, 1 metafield each -> 25 articles/call
    wired, errors = 0, []
    for i in range(0, len(to_set), 25):
        batch = to_set[i:i + 25]
        mfs = [{"ownerId": aid, "namespace": "custom", "key": "produto",
                "type": "list.product_reference", "value": json.dumps(desired[aid])} for aid in batch]
        data = graphql(METAFIELDS_SET, {"metafields": mfs})
        respect_throttle(data)
        errs = data["data"]["metafieldsSet"]["userErrors"]
        if errs:
            errors.extend(errs)
        else:
            wired += len(batch)
        print(f"  set {wired}/{len(to_set)}")

    cleared = 0
    for i in range(0, len(to_clear), 25):
        batch = to_clear[i:i + 25]
        ids_in = [{"ownerId": aid, "namespace": "custom", "key": "produto"} for aid in batch]
        data = graphql(METAFIELDS_DELETE, {"metafields": ids_in})
        respect_throttle(data)
        errs = data["data"]["metafieldsDelete"]["userErrors"]
        if errs:
            errors.extend(errs)
        else:
            cleared += len(batch)

    print(f"\n=== SUMMARY === set: {wired} | cleared: {cleared} | userErrors: {len(errors)}")
    for e in errors:
        print(f"  - {e}")


if __name__ == "__main__":
    main()
