"""
Update AI Readiness metaobject entries:
1. Rename handles to {product-name}-ai-ready (display name auto-generated)
2. Set status to ACTIVE

SAFETY: Only modifies AI Readiness metaobjects. No product data touched.
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


# Old handle -> new handle
HANDLE_RENAMES = {
    "ai-readiness-shampoo-sem-sulfato": "shampoo-sem-sulfato-ai-ready",
    "ai-readiness-shampoo-a-seco": "shampoo-a-seco-ai-ready",
    "ai-readiness-mascara-condicionadora": "mascara-condicionadora-ai-ready",
    "ai-readiness-mascara-mayday": "mascara-mayday-ai-ready",
    "ai-readiness-leave-in-pluma": "leave-in-pluma-ai-ready",
    "ai-readiness-leave-in-com-protecao-termica": "leave-in-com-protecao-termica-ai-ready",
    "ai-readiness-primer-liso-intacto": "primer-liso-intacto-ai-ready",
    "ai-readiness-primer-cachos-definidos": "primer-cachos-definidos-ai-ready",
    "ai-readiness-booster-antifrizz": "booster-antifrizz-ai-ready",
    "ai-readiness-booster-hidratante": "booster-hidratante-ai-ready",
    "ai-readiness-booster-definicao": "booster-definicao-ai-ready",
    "ai-readiness-booster-fortificante": "booster-fortificante-ai-ready",
    "ai-readiness-booster-antioxidante": "booster-antioxidante-ai-ready",
    "ai-readiness-melon-mood-body-e-hair-splash": "melon-mood-body-hair-splash-ai-ready",
}


def get_metaobjects():
    query = """
    { metaobjects(type: "ai_readiness", first: 20) {
        edges { node { id handle displayName } }
    } }
    """
    data = graphql(query)
    return [edge["node"] for edge in data["data"]["metaobjects"]["edges"]]


def update_metaobject(obj_id, new_handle):
    mutation = """
    mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject { id handle displayName }
        userErrors { field message }
      }
    }
    """
    variables = {
        "id": obj_id,
        "metaobject": {
            "handle": new_handle,
            "capabilities": {
                "publishable": {
                    "status": "ACTIVE"
                }
            }
        }
    }
    data = graphql(mutation, variables)
    result = data["data"]["metaobjectUpdate"]
    if result["userErrors"]:
        return None, result["userErrors"]
    return result["metaobject"], None


def main():
    dry_run = "--dry-run" in sys.argv

    print(f"Store: {SHOP_DOMAIN}")
    print(f"Mode: {'DRY RUN' if dry_run else 'LIVE UPDATE'}")
    print()

    metaobjects = get_metaobjects()
    print(f"Metaobjects found: {len(metaobjects)}")
    print()

    results = {"updated": [], "skipped": [], "errors": []}

    for obj in metaobjects:
        handle = obj["handle"]
        obj_id = obj["id"]
        current_name = obj["displayName"]

        # Already renamed (from test run)
        if handle.endswith("-ai-ready"):
            new_handle = handle
        else:
            new_handle = HANDLE_RENAMES.get(handle)

        if not new_handle:
            print(f"SKIP: {handle} ({current_name}) -- not in mapping")
            results["skipped"].append(handle)
            continue

        if dry_run:
            print(f"[DRY RUN] {current_name}")
            print(f"  Handle: {handle} -> {new_handle}")
            print(f"  Status: -> ACTIVE")
            results["updated"].append(handle)
        else:
            try:
                result, errors = update_metaobject(obj_id, new_handle)
                if errors:
                    print(f"ERROR: {handle} -- {errors}")
                    results["errors"].append({"handle": handle, "errors": errors})
                else:
                    print(f"Updated: {result['displayName']} (ACTIVE)")
                    results["updated"].append(handle)
            except Exception as e:
                print(f"EXCEPTION: {handle} -- {e}")
                results["errors"].append({"handle": handle, "errors": str(e)})

    print()
    print("=" * 60)
    print(f"SUMMARY {'(DRY RUN)' if dry_run else ''}")
    print(f"  Updated: {len(results['updated'])}")
    print(f"  Skipped: {len(results['skipped'])}")
    print(f"  Errors: {len(results['errors'])}")
    print("=" * 60)


if __name__ == "__main__":
    main()
