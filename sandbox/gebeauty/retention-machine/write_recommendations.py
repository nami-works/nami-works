"""Compute per-customer product recommendations (lift + hair-type guard) and write them
to the `custom.recommended_products` customer metafield (list.product_reference).

The email template store-credit__still-active.liquid renders this metafield (top 3), with the
new-mists block as fallback when it's empty.

Modes:
  (default)      dry-run: print a sample of customers -> recommended GIDs. NO writes.
  --sample N     how many customers to print in dry-run (default 10).
  --cohort FILE  restrict to customer GIDs listed one-per-line in FILE (else: all owners).
  --write        actually write metafields (batched, idempotent via state file). GATED.

Reads creds from sandbox/gebeauty/.env. Reads catalog + orders from _cache/.
"""
import json, sys, time, argparse, urllib.request, urllib.error
from pathlib import Path
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
ENV = {}
for line in (HERE.parent / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); ENV[k.strip()] = v.strip()
DOMAIN = ENV["SHOPIFY_SHOP_DOMAIN"]; TOKEN = ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]
APIV = ENV.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{DOMAIN}/admin/api/{APIV}/graphql.json"

def graphql(query, variables=None):
    body = json.dumps({"query": query, **({"variables": variables} if variables else {})}).encode()
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode("utf-8"))

# ---- catalog + targets ----
cat_raw = json.loads((HERE / "_cache/catalog.json").read_text(encoding="utf-8"))
cat = {k.rsplit("/", 1)[-1]: v for k, v in cat_raw.items()}
CFG = json.loads((HERE / "config.json").read_text(encoding="utf-8"))
bad_w = [w.lower() for w in CFG["products"]["exclude_title_contains"]]
targets = {p for p, i in cat.items() if i["status"] == "ACTIVE" and i["type"] == "product"
           and not any(w in i["title"].lower() for w in bad_w)}
def T(p): return cat[p]["title"]
def gid(p): return f"gid://shopify/Product/{p}"
def htype(p):
    t = T(p).lower()
    if "primer cachos" in t or "booster defini" in t: return "curl"
    if "primer liso" in t: return "straight"
    return "universal"
CURL = {p for p in targets if htype(p) == "curl"}
STRAIGHT = {p for p in targets if htype(p) == "straight"}
MIST = {p for p in targets if "mist" in T(p).lower()}
MIST_CAP = 1  # at most 1 fragrance mist among the 3 slots; rest = routine complements (Lucas 2026-07-07)

# ---- owned sets from cached orders ----
orders = {}; li = defaultdict(list)
for line in (HERE / "_cache/orders_sub.jsonl").open(encoding="utf-8"):
    o = json.loads(line); oid = o.get("id", "")
    if "/Order/" in oid:
        orders[oid] = {"cust": (o.get("customer") or {}).get("id"),
                       "bad": bool(o.get("cancelledAt")) or o.get("displayFinancialStatus") in ("REFUNDED", "VOIDED")}
    elif "quantity" in o and "__parentId" in o:
        pid = (o.get("product") or {}).get("id")
        if pid: li[o["__parentId"]].append(pid.rsplit("/", 1)[-1])
owned = defaultdict(set)
for oid, pids in li.items():
    od = orders.get(oid)
    if not od or not od["cust"] or od["bad"]: continue
    for p in set(pids):
        if p in targets: owned[od["cust"]].add(p)

# ---- lift model ----
N = len(owned)
own = defaultdict(int); co = defaultdict(int)
for s in owned.values():
    for x in s: own[x] += 1
    sl = list(s)
    for i in range(len(sl)):
        for j in range(len(sl)):
            if i != j: co[(sl[i], sl[j])] += 1
def lift(x, y):
    if not own.get(x) or not own.get(y): return 0
    return (co[(x, y)] / own[x]) / (own[y] / N)
def recs(oset, k=3):
    guard = set()
    if (oset & STRAIGHT) and not (oset & CURL): guard |= CURL
    if (oset & CURL) and not (oset & STRAIGHT): guard |= STRAIGHT
    sc = {}
    for y in targets:
        if y in oset or y in guard or own.get(y, 0) < 20: continue
        sc[y] = sum(lift(x, y) for x in oset)
    ranked = sorted(sc, key=lambda y: -sc[y])
    out, mc = [], 0
    for y in ranked:                      # greedy, capping mists at MIST_CAP
        if y in MIST:
            if mc >= MIST_CAP: continue
            mc += 1
        out.append(y)
        if len(out) == k: break
    if len(out) < k:                      # backfill with skipped mists to keep 3 cells
        for y in ranked:
            if y not in out:
                out.append(y)
                if len(out) == k: break
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--sample", type=int, default=10)
    ap.add_argument("--limit", type=int, default=0, help="cap number of writes (0 = no cap)")
    ap.add_argument("--cohort")
    args = ap.parse_args()

    pool = set(owned)
    if args.cohort:
        want = {l.strip() for l in Path(args.cohort).read_text(encoding="utf-8").splitlines() if l.strip()}
        pool = {c for c in owned if c in want or c.rsplit("/", 1)[-1] in want}
        print(f"cohort: {len(pool)}/{len(want)} matched to owners")

    plan = {c: recs(owned[c]) for c in pool}
    plan = {c: r for c, r in plan.items() if r}
    print(f"{len(plan)} customers with >=1 rec (of {len(pool)} in pool)\n")

    if not args.write:
        print("=== DRY-RUN sample (customer -> recommended products) ===")
        for c in list(plan)[:args.sample]:
            print(f"  {c}")
            print(f"    owns: {', '.join(T(p) for p in owned[c])}")
            for p in plan[c]:
                print(f"    -> {gid(p)}  {T(p)}")
        print(f"\n(no writes. re-run with --write to apply {len(plan)} metafields.)")
        return

    # ---- WRITE ----
    state_f = HERE / "write-recommendations-state.json"
    done = set(json.loads(state_f.read_text()) if state_f.exists() else [])
    todo = [c for c in plan if c not in done]
    if args.limit: todo = todo[:args.limit]
    print(f"WRITE: {len(todo)} to write, {len(done)} already done")
    M = """mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){
      metafields{id} userErrors{field message}}}"""
    B = 25
    for i in range(0, len(todo), B):
        chunk = todo[i:i + B]
        mfs = [{"ownerId": c, "namespace": "custom", "key": "recommended_products",
                "type": "list.product_reference",
                "value": json.dumps([gid(p) for p in plan[c]])} for c in chunk]
        for attempt in range(4):
            try:
                res = graphql(M, {"m": mfs})
                errs = res.get("data", {}).get("metafieldsSet", {}).get("userErrors") or res.get("errors")
                if errs: print(f"  [batch {i//B}] userErrors: {errs}")
                done.update(chunk); break
            except urllib.error.HTTPError as e:
                print(f"  [batch {i//B}] HTTP {e.code}, retry {attempt}"); time.sleep(2 * (attempt + 1))
            except Exception as e:
                print(f"  [batch {i//B}] {e!r}, retry {attempt}"); time.sleep(2 * (attempt + 1))
        state_f.write_text(json.dumps(sorted(done)))
        if (i // B) % 10 == 0: print(f"  ...{len(done)} written"); time.sleep(0.3)
    print(f"done: {len(done)} metafields written")

if __name__ == "__main__":
    main()
