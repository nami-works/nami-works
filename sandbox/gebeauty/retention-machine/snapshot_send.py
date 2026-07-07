"""
Learning-log snapshot — freezes the per-customer signal at send time.

Writes ONE line per customer (SEND + HOLD both) to learning/sends.jsonl for the
>=60-day reactivation wave. Append-only, idempotent per (wave, customer). Run this
at campaign start (same day as issuance). Outcomes are filled later by
measure_reactivation.py — this file only captures the frozen pre-send state.

  python snapshot_send.py            # writes/append the snapshot (idempotent)
"""
import json, sys, urllib.request, openpyxl
from pathlib import Path
from collections import defaultdict
from datetime import date

HERE = Path(__file__).resolve().parent
TEN = HERE.parent
LEARN = HERE / "learning"; LEARN.mkdir(exist_ok=True)
SENDS = LEARN / "sends.jsonl"
COHORT = HERE / "out" / "store-credit-push-2026-07-06" / "cohort.xlsx"
CACHE = HERE / "_cache" / "orders_sub.jsonl"
CATALOG = HERE / "_cache" / "catalog.json"

CAMPAIGN = "store-credit-reactivation"
WAVE = "2026-07-06-ge60d"
SENT_AT = date.today().isoformat()
EXPIRES_AT = "2026-07-13"; EXPIRY_DAYS = 7; PCT = 0.20; CEIL = 120.0
RECENCY_MIN = 60
TODAY = date.today()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

def log(*a): print(*a); sys.stdout.flush()

env = {}
for line in (TEN / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); env[k.strip()] = v.strip()
URL = f"https://{env['SHOPIFY_SHOP_DOMAIN']}/admin/api/{env.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
def gql(q, v=None):
    body = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json",
        "X-Shopify-Access-Token": env["SHOPIFY_ADMIN_ACCESS_TOKEN"], "User-Agent": UA})
    return json.loads(urllib.request.urlopen(req).read().decode())

def band(d):
    if d <= 90: return "60-90"
    if d <= 120: return "91-120"
    if d <= 180: return "121-180"
    if d <= 270: return "181-270"
    if d <= 365: return "271-365"
    return "366+"

def category(title):
    t = (title or "").lower()
    if "booster" in t: return "booster"
    if "primer" in t: return "primer"
    if "shampoo" in t and "seco" in t: return "shampoo-seco"
    if "shampoo" in t: return "shampoo"
    if "leave" in t: return "leave-in"
    if "máscara" in t or "mascara" in t: return "mascara"
    if "mist" in t: return "mist"
    return "outro"

def compute_features():
    cat = {k.rsplit("/", 1)[-1]: v for k, v in json.loads(CATALOG.read_text(encoding="utf-8")).items()}
    targets = {p for p, i in cat.items() if i["status"] == "ACTIVE" and i["type"] == "product"}
    orders = {}; li = defaultdict(list)
    for line in CACHE.open(encoding="utf-8"):
        o = json.loads(line); oid = o.get("id", "")
        if "/Order/" in oid:
            cu = o.get("customer") or {}
            sub = ((o.get("subtotalPriceSet") or {}).get("shopMoney") or {}).get("amount")
            orders[oid] = {"cust": cu.get("id"), "date": o["createdAt"][:10], "sub": float(sub) if sub else 0.0,
                           "bad": bool(o.get("cancelledAt")) or o.get("displayFinancialStatus") in ("REFUNDED", "VOIDED")}
        elif "quantity" in o and "__parentId" in o:
            pid = (o.get("product") or {}).get("id")
            if pid: li[o["__parentId"]].append(pid.rsplit("/", 1)[-1])
    f = defaultdict(lambda: {"orders": [], "prod": defaultdict(int)})
    for oid, pids in li.items():
        od = orders.get(oid)
        if not od or not od["cust"] or od["bad"]: continue
        f[od["cust"]]["orders"].append((od["date"], od["sub"]))
        for p in set(pids):
            if p in targets: f[od["cust"]]["prod"][p] += 1
    out = {}
    for gid, d in f.items():
        ods = sorted(d["orders"])
        dates = [x[0] for x in ods]
        spend = round(sum(x[1] for x in ods), 2)
        n = len(ods)
        prod_titles = [cat[p]["title"] for p in d["prod"]]
        out[gid] = {
            "order_count": n,
            "first_order_date": dates[0], "last_order_date": dates[-1],
            "recency_days": (TODAY - date.fromisoformat(dates[-1])).days,
            "tenure_days": (TODAY - date.fromisoformat(dates[0])).days,
            "lifetime_spend": spend, "avg_order_value": round(spend / n, 2),
            "last_order_subtotal": round(ods[-1][1], 2),
            "is_repeat": n >= 2, "has_repeat_product": any(v >= 2 for v in d["prod"].values()),
            "distinct_products": len(d["prod"]), "products_owned": prod_titles,
        }
    return out

def fetch_emails(gids):
    emails = {}
    Q = 'query($ids:[ID!]!){ nodes(ids:$ids){ ... on Customer{ id email } } }'
    for i in range(0, len(gids), 200):
        for n in gql(Q, {"ids": gids[i:i+200]}).get("data", {}).get("nodes", []) or []:
            if n: emails[n["id"]] = n.get("email") or ""
    return emails

def main():
    feat = compute_features()
    ws = openpyxl.load_workbook(COHORT).active
    H = [c.value for c in ws[1]]; ix = {k: H.index(k) for k in H}

    # already-logged (wave, gid) for idempotency
    logged = set()
    if SENDS.exists():
        for line in SENDS.open(encoding="utf-8"):
            try:
                r = json.loads(line)
                if r.get("wave") == WAVE: logged.add(r["customer_gid"])
            except Exception: pass

    recs = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        gid = "gid://shopify/Customer/" + str(r[ix["Customer GID"]])
        ft = feat.get(gid)
        if not ft or ft["recency_days"] < RECENCY_MIN: continue     # >=60-day wave only
        if gid in logged: continue
        arm = "SEND" if r[ix["Holdout"]] == "SEND" else "HOLD"
        credit = round(float(r[ix["Credit (R$)"]]), 2)
        anchor = r[ix["Anchor Product"]]
        recs.append({
            "campaign": CAMPAIGN, "wave": WAVE, "sent_at": SENT_AT,
            "customer_gid": gid, "email": "", "first_name": r[ix["First Name"]], "phone": str(r[ix["Phone"]]),
            "arm": arm, "channel": "email", "touch": 1,
            # --- predictive features frozen at send ---
            "recency_days": ft["recency_days"], "recency_band": band(ft["recency_days"]),
            "last_order_date": ft["last_order_date"], "first_order_date": ft["first_order_date"],
            "tenure_days": ft["tenure_days"], "order_count": ft["order_count"],
            "is_repeat": ft["is_repeat"], "has_repeat_product": ft["has_repeat_product"],
            "lifetime_spend": ft["lifetime_spend"], "avg_order_value": ft["avg_order_value"],
            "last_order_subtotal": ft["last_order_subtotal"],
            "distinct_products": ft["distinct_products"], "products_owned": ft["products_owned"],
            "anchor_product": anchor, "primary_category": category(anchor),
            # --- offer ---
            "credit_amount": credit if arm == "SEND" else 0.0, "credit_pct": PCT,
            "capped_at_ceiling": credit >= CEIL if arm == "SEND" else False,
            "expires_at": EXPIRES_AT if arm == "SEND" else None, "expiry_days": EXPIRY_DAYS if arm == "SEND" else None,
            # --- outcomes (filled later by measure_reactivation.py) ---
            "reactivated": None, "redeemed": None, "days_to_order": None, "order_value": None,
        })

    if not recs:
        log("nothing new to snapshot (already logged for this wave?)"); return
    # backfill emails
    log(f"fetching emails for {len(recs)} customers…")
    em = fetch_emails([r["customer_gid"] for r in recs])
    for r in recs: r["email"] = em.get(r["customer_gid"], "")

    with SENDS.open("a", encoding="utf-8") as fh:
        for r in recs: fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    from collections import Counter
    by = Counter((r["arm"], r["recency_band"]) for r in recs)
    log(f"\nappended {len(recs)} records -> {SENDS}")
    log("  arm x band:")
    for (arm, b), n in sorted(by.items()):
        log(f"    {arm:4} {b:8} : {n}")

if __name__ == "__main__":
    main()
