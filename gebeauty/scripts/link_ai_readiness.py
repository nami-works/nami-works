"""
Link AI Readiness metaobject entries to their products via custom.ai_readiness metafield.

SAFETY: This script ONLY sets the custom.ai_readiness metafield on products.
No other product data is modified.

Usage:
  python scripts/link_ai_readiness.py --dry-run    # Preview links
  python scripts/link_ai_readiness.py               # Execute linking
"""

import json
import os
import sys
from pathlib import Path
import requests
from dotenv import load_dotenv

# Resolve .env relative to this script so the cwd at invocation doesn't matter.
# Convention: sandbox/<tenant>/.env. See root CLAUDE.md § Per-tenant secrets.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

SHOP_DOMAIN = os.getenv("SHOPIFY_SHOP_DOMAIN")
ACCESS_TOKEN = os.getenv("SHOPIFY_ADMIN_ACCESS_TOKEN")
API_VERSION = os.getenv("SHOPIFY_API_VERSION", "2026-01")

GRAPHQL_URL = f"https://{SHOP_DOMAIN}/admin/api/{API_VERSION}/graphql.json"
HEADERS = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": ACCESS_TOKEN,
}


def graphql(query, variables=None):
    payload = {"query": query}
    if variables:
        payload["variables"] = variables
    resp = requests.post(GRAPHQL_URL, headers=HEADERS, json=payload, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if "errors" in data and data["errors"]:
        raise Exception(f"GraphQL errors: {json.dumps(data['errors'], indent=2)}")
    return data


# Mapping: product handle -> metaobject handle
PRODUCT_TO_METAOBJECT = {
    "shampoo-sem-sulfato": "ai-readiness-shampoo-sem-sulfato",
    "shampoo-a-seco": "ai-readiness-shampoo-a-seco",
    "mascara-condicionadora": "ai-readiness-mascara-condicionadora",
    "mascara-mayday": "ai-readiness-mascara-mayday",
    "leave-in-pluma": "ai-readiness-leave-in-pluma",
    "leave-in-com-protecao-termica": "ai-readiness-leave-in-com-protecao-termica",
    "primer-liso-intacto": "ai-readiness-primer-liso-intacto",
    "primer-cachos-definidos": "ai-readiness-primer-cachos-definidos",
    "booster-antifrizz": "ai-readiness-booster-antifrizz",
    "booster-hidratante": "ai-readiness-booster-hidratante",
    "booster-definicao": "ai-readiness-booster-definicao",
    "booster-fortificante": "ai-readiness-booster-fortificante",
    "booster-antioxidante": "ai-readiness-booster-antioxidante",
    "melon-mood-body-hair-splash": "ai-readiness-melon-mood-body-e-hair-splash",
    # Body & Hair Mist line (2026-07 mist-recommendation quiz)
    "melon-mood-body-hair-mist": "ai-readiness-melon-mood-body-e-hair-mist",
    "santal-skin-body-hair-mist": "ai-readiness-santal-skin-body-e-hair-mist",
    "rose-ritual-body-hair-mist": "ai-readiness-rose-ritual-body-e-hair-mist",
    "pear-fresh-body-hair-mist": "ai-readiness-pear-fresh-body-e-hair-mist",
}


def get_products():
    query = """
    { products(first: 50, query: "product_type:product") {
        edges { node { id title handle } }
    } }
    """
    data = graphql(query)
    return {edge["node"]["handle"]: edge["node"] for edge in data["data"]["products"]["edges"]}


def get_metaobjects():
    query = """
    { metaobjects(type: "ai_readiness", first: 50) {
        edges { node { id handle } }
    } }
    """
    data = graphql(query)
    return {edge["node"]["handle"]: edge["node"]["id"] for edge in data["data"]["metaobjects"]["edges"]}


def link_product(product_id, metaobject_id):
    mutation = """
    mutation productUpdate($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id title }
        userErrors { field message }
      }
    }
    """
    variables = {
        "input": {
            "id": product_id,
            "metafields": [
                {
                    "namespace": "custom",
                    "key": "ai_readiness",
                    "value": metaobject_id,
                    "type": "metaobject_reference",
                }
            ],
        }
    }
    data = graphql(mutation, variables)
    result = data["data"]["productUpdate"]
    if result["userErrors"]:
        return None, result["userErrors"]
    return result["product"], None


def main():
    dry_run = "--dry-run" in sys.argv

    print(f"Store: {SHOP_DOMAIN}")
    print(f"Mode: {'DRY RUN' if dry_run else 'LIVE LINKING'}")
    print()

    products = get_products()
    metaobjects = get_metaobjects()

    print(f"Products found: {len(products)}")
    print(f"Metaobjects found: {len(metaobjects)}")
    print()

    results = {"linked": [], "skipped": [], "errors": []}

    for product_handle, metaobject_handle in PRODUCT_TO_METAOBJECT.items():
        product = products.get(product_handle)
        metaobject_id = metaobjects.get(metaobject_handle)

        if not product:
            print(f"SKIP: Product '{product_handle}' not found in store")
            results["skipped"].append(product_handle)
            continue

        if not metaobject_id:
            print(f"SKIP: Metaobject '{metaobject_handle}' not found")
            results["skipped"].append(product_handle)
            continue

        title = product["title"]
        product_id = product["id"]

        if dry_run:
            print(f"[DRY RUN] {title} ({product_handle})")
            print(f"  -> Link to {metaobject_handle} ({metaobject_id})")
            results["linked"].append(title)
        else:
            try:
                result, errors = link_product(product_id, metaobject_id)
                if errors:
                    print(f"ERROR: {title} — {errors}")
                    results["errors"].append({"title": title, "errors": errors})
                else:
                    print(f"Linked: {title} -> {metaobject_handle}")
                    results["linked"].append(title)
            except Exception as e:
                print(f"EXCEPTION: {title} — {e}")
                results["errors"].append({"title": title, "errors": str(e)})

    print()
    print("=" * 60)
    print(f"SUMMARY {'(DRY RUN)' if dry_run else ''}")
    print(f"  Linked: {len(results['linked'])}")
    print(f"  Skipped: {len(results['skipped'])}")
    print(f"  Errors: {len(results['errors'])}")
    if results["errors"]:
        for err in results["errors"]:
            print(f"    - {err['title']}: {err['errors']}")
    print("=" * 60)


if __name__ == "__main__":
    main()
