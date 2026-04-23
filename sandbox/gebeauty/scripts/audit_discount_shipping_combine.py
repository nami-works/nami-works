"""
Audit all currently active discounts on the store and list those NOT set to
combine with shipping discounts.

Read-only. Paginates through discountNodes with status:active, extracts
combinesWith flags per discount subtype, and prints a grouped report.
"""

import json
import os
import time
import urllib.request
from collections import defaultdict
from pathlib import Path


def load_env():
    env_path = Path(__file__).resolve().parent.parent / ".env"
    env = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


ENV = load_env()
SHOP = ENV["SHOPIFY_SHOP_DOMAIN"]
TOKEN = ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]
API_VERSION = ENV.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"

BATCH_SIZE = 100


def graphql(query, variables=None):
    body = {"query": query}
    if variables:
        body["variables"] = variables
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": TOKEN,
        },
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    if "errors" in result:
        print("[audit-discounts] GraphQL errors:", json.dumps(result["errors"], indent=2))
    ext = result.get("extensions", {}).get("cost", {})
    available = ext.get("throttleStatus", {}).get("currentlyAvailable", 4000)
    if available < 300:
        print(f"  [throttle] available={available}, sleeping 2s...")
        time.sleep(2)
    return result


FRAGMENTS = """
fragment combines on DiscountCombinesWith {
    orderDiscounts
    productDiscounts
    shippingDiscounts
}
"""

QUERY = (
    FRAGMENTS
    + """
query ActiveDiscounts($cursor: String) {
    discountNodes(first: %d, after: $cursor, query: "status:active", sortKey: CREATED_AT) {
        pageInfo { hasNextPage endCursor }
        edges {
            node {
                id
                discount {
                    __typename
                    ... on DiscountCodeBasic  { title combinesWith { ...combines } startsAt endsAt status }
                    ... on DiscountCodeBxgy   { title combinesWith { ...combines } startsAt endsAt status }
                    ... on DiscountCodeFreeShipping { title combinesWith { ...combines } startsAt endsAt status }
                    ... on DiscountCodeApp    { title combinesWith { ...combines } startsAt endsAt status }
                    ... on DiscountAutomaticBasic  { title combinesWith { ...combines } startsAt endsAt status }
                    ... on DiscountAutomaticBxgy   { title combinesWith { ...combines } startsAt endsAt status }
                    ... on DiscountAutomaticFreeShipping { title combinesWith { ...combines } startsAt endsAt status }
                    ... on DiscountAutomaticApp    { title combinesWith { ...combines } startsAt endsAt status }
                }
            }
        }
    }
}
""" % BATCH_SIZE
)


def fetch_all():
    out = []
    cursor = None
    page = 0
    while True:
        page += 1
        result = graphql(QUERY, {"cursor": cursor})
        data = result.get("data", {}).get("discountNodes")
        if not data:
            print("[audit-discounts] unexpected response:", json.dumps(result)[:500])
            break
        for edge in data["edges"]:
            node = edge["node"]
            disc = node.get("discount") or {}
            combines = disc.get("combinesWith") or {}
            out.append({
                "id": node["id"],
                "type": disc.get("__typename", "?"),
                "title": disc.get("title", ""),
                "status": disc.get("status", ""),
                "startsAt": disc.get("startsAt"),
                "endsAt": disc.get("endsAt"),
                "combinesOrder": combines.get("orderDiscounts"),
                "combinesProduct": combines.get("productDiscounts"),
                "combinesShipping": combines.get("shippingDiscounts"),
            })
        print(f"  page {page}: +{len(data['edges'])} (total {len(out)})")
        if not data["pageInfo"]["hasNextPage"]:
            break
        cursor = data["pageInfo"]["endCursor"]
    return out


def main():
    print(f"[audit-discounts] shop={SHOP} api={API_VERSION} filter=status:active")
    all_discounts = fetch_all()
    print(f"\n[audit-discounts] total active discounts: {len(all_discounts)}")

    # Free shipping discounts ARE shipping — combinesWith.shippingDiscounts is
    # irrelevant for those. Still report them for completeness.
    free_shipping_types = {
        "DiscountCodeFreeShipping",
        "DiscountAutomaticFreeShipping",
    }

    not_combining = [
        d for d in all_discounts
        if d["type"] not in free_shipping_types and d["combinesShipping"] is False
    ]
    combining = [
        d for d in all_discounts
        if d["type"] not in free_shipping_types and d["combinesShipping"] is True
    ]
    unknown = [
        d for d in all_discounts
        if d["type"] not in free_shipping_types and d["combinesShipping"] is None
    ]
    shipping_discounts = [d for d in all_discounts if d["type"] in free_shipping_types]

    print(f"  combinesShipping=TRUE:  {len(combining)}")
    print(f"  combinesShipping=FALSE: {len(not_combining)}")
    if unknown:
        print(f"  combinesShipping=NULL:  {len(unknown)}")
    print(f"  free-shipping discounts (N/A): {len(shipping_discounts)}")

    # Group not-combining by type
    by_type = defaultdict(list)
    for d in not_combining:
        by_type[d["type"]].append(d)

    print("\n=== Discounts NOT combining with shipping ===")
    for dtype, items in sorted(by_type.items()):
        print(f"\n[{dtype}] ({len(items)})")
        # Group by title prefix so BEAUTYBACK-46M1-* collapses
        prefix_groups = defaultdict(list)
        for d in items:
            title = d["title"] or ""
            # Heuristic: group by first 2 tokens split on "-" if title contains batch-like suffix
            parts = title.split("-")
            if len(parts) >= 3 and parts[0].isalpha():
                prefix = "-".join(parts[:2]) + "-*"
            else:
                prefix = title
            prefix_groups[prefix].append(d)

        for prefix, group in sorted(prefix_groups.items(), key=lambda x: -len(x[1])):
            if len(group) == 1:
                d = group[0]
                print(f"  - {d['title']}  (status={d['status']})")
            else:
                sample = ", ".join(sorted(g["title"] for g in group)[:3])
                print(f"  - {prefix}  x{len(group)}   e.g. {sample}")

    # Also dump raw JSON for traceability
    out_path = Path(__file__).resolve().parent.parent / "inputs" / "discount_shipping_audit.json"
    out_path.parent.mkdir(exist_ok=True)
    out_path.write_text(json.dumps({
        "total": len(all_discounts),
        "not_combining_shipping": not_combining,
        "combining_shipping": combining,
        "free_shipping_discounts": shipping_discounts,
        "unknown_combines_shipping": unknown,
    }, indent=2, default=str), encoding="utf-8")
    print(f"\n[audit-discounts] full dump -> {out_path}")


if __name__ == "__main__":
    main()
