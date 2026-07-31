"""
Backfill tag: 'core-target' on customers who have never received BOTH fidelity-driver
products (Shampoo Sem Sulfato + Mascara Condicionadora), standalone or via a kit/bundle.

Bundle attribution needs no special-casing: when a kit is bought, Shopify records the
COMPONENT line items (each pointing at the component's own product.id), grouped under
lineItemGroup -- the kit itself never appears as a top-level line item. So a customer who
bought a kit containing both products already has both product ids show up as line items.
We just read line-item product ids as-is; no bundle-definition lookup needed.

Excludes cancelled orders and refunded units (currentQuantity == 0), matching the
exclude_cancelled/exclude_refunded convention in config.json. Excludes the [rappi]
duplicate products (separate channel, not e-commerce catalog) per the price/catalog rule
in gebeauty/CLAUDE.md.

ADD-ONLY. Removal (once a customer completes the duo) is a separate flow Lucas is
building -- this script never removes the tag.

Idempotent + resumable: skips anyone already in tag-core-target-state.json. DRY-RUN by
default; only --apply mutates.

  python tag_core_target.py            # dry run: pulls fresh data, counts, sample
  python tag_core_target.py --apply --limit 50   # staged pilot batch
  python tag_core_target.py --apply              # full backfill (gated)
"""
import json, sys, time, argparse, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEN = HERE.parent.parent  # gebeauty/growth/retention-machine -> gebeauty (where .env lives)
CACHE = HERE / "_cache" / "core_target_pull.jsonl"
STATE = HERE / "tag-core-target-state.json"
CUTOFF = "2023-06-01"  # matches pull_history.py's full-history cutoff

# Retail (non-[rappi]) product ids, confirmed live 2026-07-31
SHAMPOO_ID = "gid://shopify/Product/8803151282496"     # Shampoo Sem Sulfato (GEB 001)
MASCARA_ID = "gid://shopify/Product/8803151184192"     # Mascara Condicionadora (GEB 002)
DUO = {SHAMPOO_ID, MASCARA_ID}

TAG = "core-target"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def log(*a): print(*a); sys.stdout.flush()

env = {}
for line in (TEN / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); env[k.strip()] = v.strip()
URL = f"https://{env['SHOPIFY_SHOP_DOMAIN']}/admin/api/{env.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
TOKEN = env["SHOPIFY_ADMIN_ACCESS_TOKEN"]


def gql(q, v=None):
    body = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN, "User-Agent": UA})
    return json.loads(urllib.request.urlopen(req).read().decode())


def pull_fresh():
    """Bulk-pull every order + line item since CUTOFF. Same pattern as pull_history.py."""
    BULK = '''mutation { bulkOperationRunQuery(query: """
    { orders(query: "created_at:>=%s") { edges { node {
        id cancelledAt displayFinancialStatus
        customer { id }
        lineItems { edges { node { currentQuantity product { id } } } }
    } } } }
    """) { bulkOperation { id status } userErrors { field message } } }''' % CUTOFF

    r = gql(BULK)
    ue = r["data"]["bulkOperationRunQuery"]["userErrors"]
    if ue: raise SystemExit(f"userErrors: {ue}")
    log("bulk started:", r["data"]["bulkOperationRunQuery"]["bulkOperation"])
    while True:
        time.sleep(8)
        c = gql('{ currentBulkOperation { status objectCount url errorCode } }')["data"]["currentBulkOperation"]
        log("  ", c["status"], c.get("objectCount"))
        if c["status"] in ("COMPLETED", "FAILED", "CANCELED"): break
    if c["status"] != "COMPLETED":
        raise SystemExit(f"bulk {c['status']}: {c.get('errorCode')}")
    CACHE.parent.mkdir(exist_ok=True)
    if c["url"]:
        urllib.request.urlretrieve(c["url"], CACHE)
        log(f"downloaded -> {CACHE} ({CACHE.stat().st_size} bytes)")
    else:
        CACHE.write_text("", encoding="utf-8"); log("empty result")


def purchased_products_by_customer():
    """gid -> set of product ids ever received (net of refund, non-cancelled orders)."""
    orders = {}   # order_id -> {"gid": customer gid or None, "bad": bool}
    purchased = {}
    for raw in CACHE.open(encoding="utf-8"):
        o = json.loads(raw)
        oid = o.get("id", "")
        if "/Order/" in oid:
            cu = o.get("customer") or {}
            bad = bool(o.get("cancelledAt")) or o.get("displayFinancialStatus") in ("REFUNDED", "VOIDED")
            orders[oid] = {"gid": cu.get("id"), "bad": bad}
            continue
        # line item row
        parent = o.get("__parentId")
        parent_meta = orders.get(parent)
        if not parent_meta or parent_meta["bad"] or not parent_meta["gid"]:
            continue
        if o.get("currentQuantity", 0) <= 0:
            continue
        prod = o.get("product") or {}
        pid = prod.get("id")
        if not pid:
            continue
        purchased.setdefault(parent_meta["gid"], set()).add(pid)
    return purchased


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--skip-pull", action="store_true", help="reuse existing _cache/core_target_pull.jsonl")
    args = ap.parse_args()

    if not args.skip_pull:
        pull_fresh()
    elif not CACHE.exists():
        raise SystemExit(f"{CACHE} missing -- run without --skip-pull first")

    purchased = purchased_products_by_customer()
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}

    missing_duo = [gid for gid, prods in purchased.items() if not DUO.issubset(prods)]
    has_duo = len(purchased) - len(missing_duo)
    pending = [gid for gid in missing_duo if gid not in state]

    log("=== CORE-TARGET TAGGING (backfill, add-only) ===")
    log(f"  customers with >=1 valid order : {len(purchased)}")
    log(f"  already have both (Shampoo+Mascara): {has_duo}")
    log(f"  missing the duo -> core-target : {len(missing_duo)}")
    log(f"  already tagged (state)          : {len(missing_duo) - len(pending)}")
    log(f"  to tag now                      : {len(pending)}")

    if not args.apply:
        log("\n[dry run] nothing tagged. Re-run with --apply (optionally --limit N).")
        return

    M = "mutation($id:ID!,$tags:[String!]!){tagsAdd(id:$id,tags:$tags){userErrors{field message}}}"
    todo = pending if args.limit == 0 else pending[:args.limit]
    log(f"\n[apply] tagging {len(todo)} customers with '{TAG}'…")
    ok = err = 0
    for i, gid in enumerate(todo, 1):
        try:
            res = gql(M, {"id": gid, "tags": [TAG]})
            ue = res.get("data", {}).get("tagsAdd", {}).get("userErrors") or res.get("errors")
            if ue: err += 1; log(f"  [err] {gid}: {ue}"); continue
            ok += 1; state[gid] = True
        except Exception as e:
            err += 1; log(f"  [err] {gid}: {repr(e)[:120]}")
        if i % 250 == 0:
            STATE.write_text(json.dumps(state))
            log(f"  progress: {i}/{len(todo)}  ok={ok} err={err}"); time.sleep(0.5)
    STATE.write_text(json.dumps(state))
    log(f"\n[done] tagged={ok} err={err}. State -> {STATE.name}")


if __name__ == "__main__":
    main()
