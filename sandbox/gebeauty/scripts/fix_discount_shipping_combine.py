"""
Flip `combinesWith.shippingDiscounts = true` on selected groups of discount codes.

Targets (pick via CLI flags):
  --affiliate10   All `<NAME>10` pattern codes (e.g. ALICIA10, BRUNA10)
  --channel20     Channel-scoped 20%-off codes
                  (VOLTEI20, CHECK20, FAV20, SELIA20, TIKTOK20, RAPPI20, MKT20,
                   SMART20, SHOPS20, RIOSUL20, SR20, RIOMAR20, IGUATZ20,
                   SATO20, BE20)
  --all           Every active discount currently NOT combining with shipping
                  (dispatches per __typename: Basic, Bxgy code/automatic, App
                  automatic)

Default is --dry-run. Pass --apply to actually hit the mutation.

Reads targets from inputs/discount_shipping_audit.json produced by
`audit_discount_shipping_combine.py`. Re-run the audit first if the data is
stale.
"""

import argparse
import json
import re
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
SHOP = ENV["SHOPIFY_SHOP_DOMAIN"]
TOKEN = ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]
API_VERSION = ENV.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"


CHANNEL_20_CODES = {
    "VOLTEI20", "CHECK20", "FAV20", "SELIA20", "TIKTOK20", "RAPPI20",
    "MKT20", "SMART20", "SHOPS20", "RIOSUL20", "SR20", "RIOMAR20",
    "IGUATZ20", "SATO20", "BE20",
}


def is_affiliate10(title: str) -> bool:
    # Strict `<NAME>10` — uppercase letters then literal `10`, nothing else.
    return bool(re.fullmatch(r"[A-Z]+10", title.strip()))


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
        print("[fix-shipping-combine] GraphQL errors:", json.dumps(result["errors"], indent=2))
    ext = result.get("extensions", {}).get("cost", {})
    available = ext.get("throttleStatus", {}).get("currentlyAvailable", 4000)
    if available < 300:
        print(f"  [throttle] available={available}, sleeping 2s...")
        time.sleep(2)
    return result


MUTATIONS = {
    "DiscountCodeBasic": (
        "discountCodeBasicUpdate",
        "basicCodeDiscount",
        "DiscountCodeBasicInput",
    ),
    "DiscountCodeBxgy": (
        "discountCodeBxgyUpdate",
        "bxgyCodeDiscount",
        "DiscountCodeBxgyInput",
    ),
    "DiscountAutomaticBxgy": (
        "discountAutomaticBxgyUpdate",
        "automaticBxgyDiscount",
        "DiscountAutomaticBxgyInput",
    ),
    "DiscountAutomaticApp": (
        "discountAutomaticAppUpdate",
        "automaticAppDiscount",
        "DiscountAutomaticAppInput",
    ),
}


def build_update(type_name):
    """Build a mutation string for a given discount __typename."""
    mut_name, input_key, input_type = MUTATIONS[type_name]
    return f"""
mutation UpdateCombines($id: ID!, ${input_key}: {input_type}!) {{
    {mut_name}(id: $id, {input_key}: ${input_key}) {{
        userErrors {{ field message }}
    }}
}}
"""


def flip_shipping(record):
    """Keep existing orderDiscounts/productDiscounts as-is and set shippingDiscounts=true."""
    type_name = record["type"]
    if type_name not in MUTATIONS:
        return {"errors": [{"message": f"unsupported type {type_name}"}]}
    _, input_key, _ = MUTATIONS[type_name]
    query = build_update(type_name)
    variables = {
        "id": record["id"],
        input_key: {
            "combinesWith": {
                "orderDiscounts": bool(record["combinesOrder"]),
                "productDiscounts": bool(record["combinesProduct"]),
                "shippingDiscounts": True,
            }
        },
    }
    return graphql(query, variables)


def mutation_name(type_name):
    return MUTATIONS.get(type_name, ("?", "?", "?"))[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--affiliate10", action="store_true",
                        help="Include all <NAME>10 affiliate codes")
    parser.add_argument("--channel20", action="store_true",
                        help="Include the 15 channel-scoped 20%% codes")
    parser.add_argument("--gift", action="store_true",
                        help="Include all `gift_*` CRM Bonus cashback codes")
    parser.add_argument("--all", dest="all_flag", action="store_true",
                        help="Include EVERY record currently not combining with shipping")
    parser.add_argument("--apply", action="store_true",
                        help="Actually run the mutations (default: dry-run)")
    parser.add_argument("--limit", type=int, default=None,
                        help="Cap number of updates (safety, testing)")
    args = parser.parse_args()

    if not (args.affiliate10 or args.channel20 or args.gift or args.all_flag):
        parser.error("Pick at least one target: --affiliate10, --channel20, --gift, or --all")

    audit_path = REPO_ROOT / "inputs" / "discount_shipping_audit.json"
    if not audit_path.exists():
        sys.exit(f"Missing {audit_path}. Run audit_discount_shipping_combine.py first.")

    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    pool = audit["not_combining_shipping"]
    print(f"[fix-shipping-combine] loaded {len(pool)} NOT-combining records from audit")

    targets = []
    for d in pool:
        title = (d.get("title") or "").strip()
        type_name = d["type"]
        if args.all_flag:
            if type_name in MUTATIONS:
                targets.append(("all", d))
            else:
                print(f"  [skip] unsupported type {type_name}: {title}")
            continue
        if type_name != "DiscountCodeBasic":
            continue
        if args.affiliate10 and is_affiliate10(title):
            targets.append(("affiliate10", d))
        elif args.channel20 and title in CHANNEL_20_CODES:
            targets.append(("channel20", d))
        elif args.gift and title.startswith("gift_"):
            targets.append(("gift", d))

    # De-dup on id in case the same record matched twice somehow
    seen = set()
    unique = []
    for grp, d in targets:
        if d["id"] in seen:
            continue
        seen.add(d["id"])
        unique.append((grp, d))
    targets = unique

    print(f"[fix-shipping-combine] matched targets: {len(targets)}")
    grp_counts = {}
    for grp, _ in targets:
        grp_counts[grp] = grp_counts.get(grp, 0) + 1
    for grp, n in grp_counts.items():
        print(f"  {grp}: {n}")

    # Breakdown by discount type (helpful when --all)
    type_counts = {}
    for _, d in targets:
        t = d["type"]
        type_counts[t] = type_counts.get(t, 0) + 1
    if len(type_counts) > 1:
        print("  by type:")
        for t, n in sorted(type_counts.items()):
            print(f"    {t} via {mutation_name(t)}: {n}")

    if args.limit:
        targets = targets[:args.limit]
        print(f"[fix-shipping-combine] limit applied -> {len(targets)}")

    if not targets:
        print("[fix-shipping-combine] nothing to do")
        return

    print()
    print("Preview (first 20):")
    for grp, d in targets[:20]:
        print(f"  [{grp}] {d['title']}  "
              f"order={d['combinesOrder']} product={d['combinesProduct']} shipping={d['combinesShipping']} -> True")
    if len(targets) > 20:
        print(f"  ... and {len(targets) - 20} more")

    if not args.apply:
        print()
        print("[DRY RUN] add --apply to execute. Nothing changed.")
        return

    print()
    print(f"[fix-shipping-combine] applying {len(targets)} updates LIVE")
    success, errors = 0, 0
    start = time.time()
    for i, (grp, d) in enumerate(targets, 1):
        try:
            result = flip_shipping(d)
            user_errors = (
                result.get("data", {})
                .get("discountCodeBasicUpdate", {})
                .get("userErrors", [])
            )
            if user_errors:
                print(f"  ERROR [{grp}] {d['title']}: {user_errors}")
                errors += 1
            else:
                success += 1
        except Exception as exc:
            print(f"  EXCEPTION [{grp}] {d['title']}: {exc}")
            errors += 1
            time.sleep(1)

        if i % 100 == 0:
            elapsed = time.time() - start
            rate = i / elapsed if elapsed else 0
            remaining = (len(targets) - i) / rate if rate else 0
            print(f"  progress {i}/{len(targets)} ok={success} err={errors} {rate:.1f}/s ~{remaining:.0f}s left")

    elapsed = time.time() - start
    print()
    print("=== done ===")
    print(f"  updated: {success}")
    print(f"  errors:  {errors}")
    print(f"  elapsed: {elapsed:.1f}s")


if __name__ == "__main__":
    main()
