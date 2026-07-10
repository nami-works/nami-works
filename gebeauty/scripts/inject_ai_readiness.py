"""
Inject AI Readiness metaobject entries into Shopify.

SAFETY: This script ONLY creates new metaobject entries.
It does NOT modify products, metafields, or any existing data.

Usage:
  python scripts/inject_ai_readiness.py --dry-run    # Preview what will be created
  python scripts/inject_ai_readiness.py               # Execute injection
"""

import json
import os
import sys
import unicodedata
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

CONTENT_FILE = os.path.join(os.path.dirname(__file__), "..", "quiz", "ai-readiness-content.json")


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


def check_existing():
    """Check if any AI Readiness metaobjects already exist."""
    query = """
    {
      metaobjects(type: "ai_readiness", first: 50) {
        edges {
          node {
            id
            handle
            fields {
              key
              value
            }
          }
        }
      }
    }
    """
    data = graphql(query)
    return [edge["node"] for edge in data["data"]["metaobjects"]["edges"]]


def create_metaobject(product_title, complete_description, combinations):
    """Create a single AI Readiness metaobject entry."""
    # Strip accents and build clean handle
    normalized = unicodedata.normalize("NFKD", product_title.lower())
    ascii_title = normalized.encode("ascii", "ignore").decode("ascii")
    handle = f"ai-readiness-{ascii_title.replace(' ', '-').replace('|', '').replace('&', 'e')}"
    handle = handle.replace("--", "-").strip("-")

    mutation = """
    mutation metaobjectCreate($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject {
          id
          handle
        }
        userErrors {
          field
          message
        }
      }
    }
    """
    variables = {
        "metaobject": {
            "type": "ai_readiness",
            "handle": handle,
            "fields": [
                {"key": "complete_description", "value": complete_description},
                {"key": "combinations", "value": combinations},
            ],
        }
    }

    data = graphql(mutation, variables)
    result = data["data"]["metaobjectCreate"]

    if result["userErrors"]:
        return None, result["userErrors"]
    return result["metaobject"], None


def main():
    dry_run = "--dry-run" in sys.argv

    # Validate env
    if not SHOP_DOMAIN or not ACCESS_TOKEN:
        print("ERROR: Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN in .env")
        sys.exit(1)

    print(f"Store: {SHOP_DOMAIN}")
    print(f"API version: {API_VERSION}")
    print(f"Mode: {'DRY RUN' if dry_run else 'LIVE INJECTION'}")
    print()

    # Load content
    with open(CONTENT_FILE, "r", encoding="utf-8") as f:
        products = json.load(f)

    print(f"Products to process: {len(products)}")
    print()

    # Check existing
    existing = check_existing()
    if existing:
        print(f"WARNING: {len(existing)} AI Readiness entries already exist:")
        for obj in existing:
            print(f"  - {obj['handle']} ({obj['id']})")
        print()
        if not dry_run:
            response = input("Continue and create new entries? (y/N): ")
            if response.lower() != "y":
                print("Aborted.")
                sys.exit(0)

    # Process each product
    results = {"created": [], "errors": []}

    for product in products:
        title = product["product_title"]
        print(f"{'[DRY RUN] ' if dry_run else ''}Processing: {title}")

        if dry_run:
            normalized = unicodedata.normalize("NFKD", title.lower())
            ascii_title = normalized.encode("ascii", "ignore").decode("ascii")
            handle = f"ai-readiness-{ascii_title.replace(' ', '-').replace('|', '').replace('&', 'e')}"
            handle = handle.replace("--", "-").strip("-")
            print(f"  Handle: {handle}")
            print(f"  Description: {product['complete_description'][:80]}...")
            print(f"  Combinations: {product['combinations'][:80]}...")
            print()
            results["created"].append(title)
        else:
            try:
                obj, errors = create_metaobject(
                    title,
                    product["complete_description"],
                    product["combinations"],
                )
                if errors:
                    print(f"  ERROR: {errors}")
                    results["errors"].append({"title": title, "errors": errors})
                else:
                    print(f"  Created: {obj['id']} ({obj['handle']})")
                    results["created"].append(title)
            except Exception as e:
                print(f"  EXCEPTION: {e}")
                results["errors"].append({"title": title, "errors": str(e)})

        print()

    # Summary
    print("=" * 60)
    print(f"SUMMARY {'(DRY RUN)' if dry_run else ''}")
    print(f"  Created: {len(results['created'])}")
    print(f"  Errors: {len(results['errors'])}")
    if results["errors"]:
        for err in results["errors"]:
            print(f"    - {err['title']}: {err['errors']}")
    print("=" * 60)


if __name__ == "__main__":
    main()
