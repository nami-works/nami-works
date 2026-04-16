"""
Generate additional `VIP100-XXXXXX` redeem codes under the existing VIP100
discount rule.

The underlying rule (R$100 off any order, combines with all, single-use,
once per customer, no expiry) was bootstrapped via create_vip100.py. This
script just appends more codes to it.

Usage:
  python scripts/vip100.py                  # generate 1 code
  python scripts/vip100.py --count 10       # generate 10 codes
  python scripts/vip100.py --dry-run        # print codes without hitting API

The rule is pinned by ID so a title rename won't break this script.
"""

import argparse
import json
import secrets
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Pinned rule ID (bootstrapped 2026-04-14 via create_vip100.py).
# If the rule is ever deleted and recreated, update this value.
RULE_ID = "gid://shopify/DiscountCodeNode/1637549310272"

CODE_PREFIX = "VIP100-"
TAIL_LENGTH = 6
# Unambiguous alphabet: drops 0/O, 1/I/L to avoid misreads.
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def load_env():
    env = {}
    for line in (REPO / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.strip().split("=", 1)
            env[k] = v
    return env


ENV = load_env()
URL = f"https://{ENV['SHOPIFY_SHOP_DOMAIN']}/admin/api/{ENV['SHOPIFY_API_VERSION']}/graphql.json"
TOKEN = ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]


def random_code():
    tail = "".join(secrets.choice(ALPHABET) for _ in range(TAIL_LENGTH))
    return f"{CODE_PREFIX}{tail}"


def graphql(query, variables=None):
    body = {"query": query}
    if variables:
        body["variables"] = variables
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        URL, data=data,
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


BULK_ADD = """
mutation BulkAdd($discountId: ID!, $codes: [DiscountRedeemCodeInput!]!) {
    discountRedeemCodeBulkAdd(discountId: $discountId, codes: $codes) {
        bulkCreation { id done }
        userErrors { field message code }
    }
}
"""

POLL_BULK = """
query PollBulk($id: ID!) {
    node(id: $id) {
        ... on DiscountRedeemCodeBulkCreation {
            id
            done
            codesCount { count }
            failedCount
        }
    }
}
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=1,
                        help="Number of new codes to generate (default: 1)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print generated codes without calling Shopify")
    parser.add_argument("--poll", action="store_true",
                        help="Poll until Shopify marks the bulk job done (usually takes 1-3 min, "
                             "but the codes are materially usable within seconds)")
    args = parser.parse_args()

    if args.count < 1 or args.count > 500:
        parser.error("--count must be between 1 and 500")

    codes = [random_code() for _ in range(args.count)]
    # Collision guard within the batch (astronomically unlikely but cheap)
    if len(set(codes)) != len(codes):
        codes = list(dict.fromkeys(codes))  # dedupe, preserve order
        while len(codes) < args.count:
            new = random_code()
            if new not in codes:
                codes.append(new)

    print(f"Generated {len(codes)} code(s):")
    for c in codes:
        print(f"  {c}")

    if args.dry_run:
        print("\n[DRY RUN] not sent to Shopify.")
        return

    variables = {
        "discountId": RULE_ID,
        "codes": [{"code": c} for c in codes],
    }
    result = graphql(BULK_ADD, variables)
    if "errors" in result:
        print(f"\nGRAPHQL ERRORS: {json.dumps(result['errors'], indent=2, ensure_ascii=False)}")
        return
    payload = result.get("data", {}).get("discountRedeemCodeBulkAdd") or {}
    user_errors = payload.get("userErrors", [])
    if user_errors:
        print(f"\nUSER ERRORS: {user_errors}")
        return
    if not payload:
        print(f"\nUNEXPECTED RESPONSE: {json.dumps(result, indent=2, ensure_ascii=False)}")
        return

    bulk = payload.get("bulkCreation") or {}
    bulk_id = bulk.get("id")
    print(f"\nbulk job: {bulk_id} done={bulk.get('done')}")

    if not args.poll or not bulk_id:
        print("Codes submitted. Shopify finishes the bulk job asynchronously "
              "(usually a few minutes); codes are usable well before that.")
        return

    # Poll until done
    deadline = time.time() + 300
    while time.time() < deadline:
        r = graphql(POLL_BULK, {"id": bulk_id})
        node = r.get("data", {}).get("node") or {}
        if node.get("done"):
            created = (node.get("codesCount") or {}).get("count")
            failed = node.get("failedCount")
            print(f"  done. created={created} failed={failed}")
            return
        print("  not done yet, waiting...")
        time.sleep(1.5)
    print("  TIMEOUT waiting for bulk completion (job still running — check admin)")


if __name__ == "__main__":
    main()
