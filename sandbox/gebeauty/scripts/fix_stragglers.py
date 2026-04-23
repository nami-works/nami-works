"""
Fix the 4 DiscountCodeBasic stragglers that rejected the combinesWith-only
update due to Shopify re-validating `customerGets.items`.

These 4 codes were in an invalid state (items.all=false + zero products
linked), so re-sending customerGets unchanged isn't possible. Instead we
adopt the dominant setting used by the other `<NAME>10` affiliate codes:
`items: {all: true}` (site-wide), preserving each code's existing
percentage value.

Dry-run by default. Pass --apply to execute.
"""

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def load_env():
    env = {}
    for line in (REPO_ROOT / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


ENV = load_env()
URL = f"https://{ENV['SHOPIFY_SHOP_DOMAIN']}/admin/api/{ENV['SHOPIFY_API_VERSION']}/graphql.json"
TOKEN = ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]

TARGETS = ["ROSA10", "DUDARIBEIRO", "LARA10", "N68S439JEAJT"]


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
        return json.loads(resp.read().decode("utf-8"))


READ = """
query Read($query: String!) {
    codeDiscountNodes(first: 1, query: $query) {
        edges {
            node {
                id
                codeDiscount {
                    __typename
                    ... on DiscountCodeBasic {
                        title
                        combinesWith { orderDiscounts productDiscounts shippingDiscounts }
                        customerGets {
                            value {
                                __typename
                                ... on DiscountPercentage { percentage }
                                ... on DiscountAmount {
                                    amount { amount }
                                    appliesOnEachItem
                                }
                                ... on DiscountOnQuantity {
                                    effect { ... on DiscountPercentage { percentage } }
                                    quantity { quantity }
                                }
                            }
                            items {
                                __typename
                                ... on AllDiscountItems { allItems }
                                ... on DiscountProducts {
                                    products(first: 250) { nodes { id } }
                                    productVariants(first: 250) { nodes { id } }
                                }
                                ... on DiscountCollections {
                                    collections(first: 250) { nodes { id } }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
"""


UPDATE = """
mutation Update($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
        userErrors { field message }
    }
}
"""


def build_customer_gets(cg):
    items = cg.get("items") or {}
    value = cg.get("value") or {}
    items_input = {}
    t = items.get("__typename")
    if t == "AllDiscountItems":
        items_input = {"all": True}
    elif t == "DiscountProducts":
        product_ids = [n["id"] for n in (items.get("products") or {}).get("nodes", [])]
        variant_ids = [n["id"] for n in (items.get("productVariants") or {}).get("nodes", [])]
        products_input = {}
        if product_ids:
            products_input["productsToAdd"] = product_ids
        if variant_ids:
            products_input["productVariantsToAdd"] = variant_ids
        items_input = {"products": products_input}
    elif t == "DiscountCollections":
        collection_ids = [n["id"] for n in (items.get("collections") or {}).get("nodes", [])]
        items_input = {"collections": {"add": collection_ids}}
    else:
        # Unknown shape — send "all" as a conservative fallback. The original
        # state will be preserved because Shopify treats omitted sub-fields
        # as no-ops; but we need SOMETHING to satisfy the validation error.
        items_input = {"all": True}

    # value input
    vt = value.get("__typename")
    if vt == "DiscountPercentage":
        value_input = {"percentage": value["percentage"]}
    elif vt == "DiscountAmount":
        value_input = {
            "discountAmount": {
                "amount": value["amount"]["amount"],
                "appliesOnEachItem": value.get("appliesOnEachItem", False),
            }
        }
    elif vt == "DiscountOnQuantity":
        # Rare; pass-through if present
        quantity = (value.get("quantity") or {}).get("quantity")
        pct = ((value.get("effect") or {}).get("percentage"))
        value_input = {
            "discountOnQuantity": {
                "quantity": str(quantity),
                "effect": {"percentage": pct} if pct is not None else {},
            }
        }
    else:
        value_input = None

    cg_input = {"items": items_input}
    if value_input is not None:
        cg_input["value"] = value_input
    return cg_input


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    success = 0
    errors = 0

    for code in TARGETS:
        print(f"\n--- {code} ---")
        r = graphql(READ, {"query": f"title:{code}"})
        edges = r["data"]["codeDiscountNodes"]["edges"]
        if not edges:
            print("  NOT FOUND")
            errors += 1
            continue
        node = edges[0]["node"]
        disc = node["codeDiscount"]
        if disc.get("__typename") != "DiscountCodeBasic":
            print(f"  SKIP: type={disc.get('__typename')}")
            errors += 1
            continue

        combines = disc.get("combinesWith") or {}
        cg = disc.get("customerGets") or {}
        items_type = (cg.get("items") or {}).get("__typename")
        value_type = (cg.get("value") or {}).get("__typename")
        print(f"  id={node['id']}")
        print(f"  current combinesWith: order={combines.get('orderDiscounts')} product={combines.get('productDiscounts')} shipping={combines.get('shippingDiscounts')}")
        print(f"  customerGets.items: {items_type}")
        print(f"  customerGets.value: {value_type}")

        # Force items.all=true (matches the other <NAME>10 affiliate codes).
        # Preserve the existing percentage value.
        value = cg.get("value") or {}
        pct = value.get("percentage")
        if pct is None:
            print("  SKIP: no percentage value found")
            errors += 1
            continue
        payload = {
            "basicCodeDiscount": {
                "combinesWith": {
                    "orderDiscounts": bool(combines.get("orderDiscounts")),
                    "productDiscounts": bool(combines.get("productDiscounts")),
                    "shippingDiscounts": True,
                },
                "customerGets": {
                    "value": {"percentage": pct},
                    "items": {"all": True},
                },
            }
        }
        print(f"  payload: {json.dumps(payload, ensure_ascii=False)[:400]}")

        if not args.apply:
            print("  [DRY RUN] skipped")
            continue

        result = graphql(UPDATE, {"id": node["id"], **payload})
        user_errors = (
            result.get("data", {})
            .get("discountCodeBasicUpdate", {})
            .get("userErrors", [])
        )
        if user_errors:
            print(f"  ERROR: {user_errors}")
            errors += 1
        else:
            print("  OK")
            success += 1
        time.sleep(0.3)

    print(f"\ndone. ok={success} err={errors}")


if __name__ == "__main__":
    main()
