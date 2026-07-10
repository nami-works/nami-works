"""
Update all BEAUTYBACK-46M1 discount codes to combine with order, product, and shipping discounts.
Uses Shopify Admin GraphQL API with cursor-based pagination.
"""

import json
import time
import sys
import urllib.request

SHOP = "ge-beauty-cosmeticos.myshopify.com"
TOKEN = "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"
API_VERSION = "2026-01"
URL = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"

SEARCH_QUERY = "BEAUTYBACK-46M1"
BATCH_SIZE = 50  # max per GraphQL page


def graphql(query, variables=None):
    """Execute a GraphQL request and return parsed JSON."""
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
    # Throttle: respect cost
    ext = result.get("extensions", {}).get("cost", {})
    available = ext.get("throttleStatus", {}).get("currentlyAvailable", 4000)
    if available < 200:
        print(f"  [throttle] available={available}, sleeping 2s...")
        time.sleep(2)
    return result


def fetch_all_ids():
    """Paginate through all BEAUTYBACK-46M1 discount codes and return list of (id, title)."""
    all_codes = []
    cursor = None
    page = 0

    while True:
        page += 1
        after_clause = f', after: "{cursor}"' if cursor else ""
        query = f"""{{
            codeDiscountNodes(first: {BATCH_SIZE}, sortKey: CREATED_AT, reverse: true, query: "{SEARCH_QUERY}"{after_clause}) {{
                edges {{
                    node {{
                        id
                        codeDiscount {{
                            ... on DiscountCodeBasic {{
                                title
                                combinesWith {{
                                    orderDiscounts
                                    productDiscounts
                                    shippingDiscounts
                                }}
                            }}
                        }}
                    }}
                }}
                pageInfo {{
                    hasNextPage
                    endCursor
                }}
            }}
        }}"""

        result = graphql(query)
        edges = result["data"]["codeDiscountNodes"]["edges"]
        page_info = result["data"]["codeDiscountNodes"]["pageInfo"]

        for edge in edges:
            node = edge["node"]
            discount = node["codeDiscount"]
            combines = discount.get("combinesWith", {})
            all_codes.append({
                "id": node["id"],
                "title": discount.get("title", ""),
                "already_set": (
                    combines.get("orderDiscounts") is True
                    and combines.get("productDiscounts") is True
                    and combines.get("shippingDiscounts") is True
                ),
            })

        print(f"  page {page}: fetched {len(edges)} codes (total: {len(all_codes)})")

        if not page_info["hasNextPage"]:
            break
        cursor = page_info["endCursor"]

    return all_codes


def update_combines(discount_id):
    """Update a single discount to combine with all discount types."""
    mutation = """
    mutation discountCodeBasicUpdate($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
            codeDiscountNode {
                id
                codeDiscount {
                    ... on DiscountCodeBasic {
                        title
                        combinesWith {
                            orderDiscounts
                            productDiscounts
                            shippingDiscounts
                        }
                    }
                }
            }
            userErrors {
                field
                message
            }
        }
    }
    """
    variables = {
        "id": discount_id,
        "basicCodeDiscount": {
            "combinesWith": {
                "orderDiscounts": True,
                "productDiscounts": True,
                "shippingDiscounts": True,
            }
        },
    }
    return graphql(mutation, variables)


def main():
    dry_run = "--dry-run" in sys.argv

    print(f"=== BEAUTYBACK-46M1 combinesWith updater ===")
    print(f"Mode: {'DRY RUN' if dry_run else 'LIVE'}")
    print()

    # Phase 1: Fetch all discount IDs
    print("[1/2] Fetching all BEAUTYBACK-46M1 discount codes...")
    all_codes = fetch_all_ids()
    print(f"  Total found: {len(all_codes)}")

    needs_update = [c for c in all_codes if not c["already_set"]]
    already_ok = len(all_codes) - len(needs_update)
    print(f"  Already set correctly: {already_ok}")
    print(f"  Need update: {len(needs_update)}")
    print()

    if not needs_update:
        print("Nothing to update. All codes already combine with all discount types.")
        sys.exit(2)  # distinct exit code so loop script knows to stop

    if dry_run:
        print("[DRY RUN] Would update these codes:")
        for c in needs_update[:10]:
            print(f"  {c['title']} ({c['id']})")
        if len(needs_update) > 10:
            print(f"  ... and {len(needs_update) - 10} more")
        return

    # Phase 2: Update each discount
    print(f"[2/2] Updating {len(needs_update)} codes...")
    success = 0
    errors = 0
    start_time = time.time()

    for i, code in enumerate(needs_update):
        try:
            result = update_combines(code["id"])
            user_errors = result.get("data", {}).get("discountCodeBasicUpdate", {}).get("userErrors", [])
            if user_errors:
                print(f"  ERROR {code['title']}: {user_errors}")
                errors += 1
            else:
                success += 1
        except Exception as e:
            print(f"  EXCEPTION {code['title']}: {e}")
            errors += 1
            time.sleep(1)

        # Progress every 100
        if (i + 1) % 100 == 0:
            elapsed = time.time() - start_time
            rate = (i + 1) / elapsed
            remaining = (len(needs_update) - i - 1) / rate
            print(f"  progress: {i + 1}/{len(needs_update)} | ok={success} err={errors} | {rate:.1f}/s | ~{remaining:.0f}s remaining")

    elapsed = time.time() - start_time
    print()
    print(f"=== Done ===")
    print(f"  Updated: {success}")
    print(f"  Errors: {errors}")
    print(f"  Elapsed: {elapsed:.1f}s")


if __name__ == "__main__":
    main()
