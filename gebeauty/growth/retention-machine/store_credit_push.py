"""
Store-credit reactivation push — cohort builder (revenue-first, 2-week window).

Targets due-to-refill buyers, computes 20%-of-last-order store credit (R$120 ceiling,
R$10 floor), excludes existing credit-holders, applies a 10% holdout, emits a Zoko list
+ a smoke-test subset. NO issuance happens here — this only builds the list.

Reuses config.json windows + catalog. Pulls live Shopify orders (with subtotals).
"""
import json, urllib.request, time, sys, hashlib, statistics, re
from pathlib import Path
from collections import defaultdict
from datetime import date

HERE = Path(__file__).resolve().parent
TEN = HERE.parent
CACHE = HERE / "_cache"; CACHE.mkdir(exist_ok=True)
CFG = json.loads((HERE / "config.json").read_text(encoding="utf-8"))
# retention-machine moved gebeauty/retention-machine -> gebeauty/growth/retention-machine;
# scripts/ lives at the repo-tenant root (gebeauty/), which is TEN.parent now, not TEN.
sys.path.insert(0, str(TEN / "scripts"))
sys.path.insert(0, str(TEN.parent / "scripts"))
import openpyxl
from build_zoko_list import curate_name, build_firstname_freq, SENTINEL

TODAY = date.today()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CEIL = 120.0; FLOOR = 10.0; PCT = 0.20
def log(*a): print(*a); sys.stdout.flush()

env = {}
ENV_FILE = TEN / ".env" if (TEN / ".env").exists() else TEN.parent / ".env"
for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); env[k.strip()] = v.strip()
SHOP = env["SHOPIFY_SHOP_DOMAIN"]; STOKEN = env["SHOPIFY_ADMIN_ACCESS_TOKEN"]
SVER = env.get("SHOPIFY_API_VERSION", "2026-01")
SURL = f"https://{SHOP}/admin/api/{SVER}/graphql.json"
def sgql(q, v=None):
    body = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    req = urllib.request.Request(SURL, data=body, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": STOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode())
def fresh(p, h=12): return p.exists() and (time.time() - p.stat().st_mtime) < h * 3600
def pnum(x): return str(x).rsplit("/", 1)[-1]
def days_since(d): return (TODAY - date.fromisoformat(d[:10])).days

NON = re.compile(r"\D")
def e164(raw):
    if not raw: return ""
    d = NON.sub("", raw)
    if d.startswith("55") and len(d) in (12, 13): return "+" + d
    if len(d) in (10, 11): return "+55" + d
    return ""

def pull_orders_sub():
    cache = CACHE / "orders_sub.jsonl"
    if fresh(cache): log("[orders] cache hit"); return cache
    log("[orders] bulk export (with subtotals)…")
    BULK = '''mutation { bulkOperationRunQuery(query: """
    { orders { edges { node {
        id createdAt cancelledAt displayFinancialStatus
        subtotalPriceSet { shopMoney { amount } }
        customer { id firstName phone defaultAddress { phone } }
        lineItems { edges { node { quantity product { id } } } }
    } } } } """) { bulkOperation { id status } userErrors { field message } } }'''
    r = sgql(BULK)
    ue = r["data"]["bulkOperationRunQuery"]["userErrors"]
    if ue: raise RuntimeError(ue)
    while True:
        time.sleep(8)
        c = sgql('{ currentBulkOperation { status objectCount url } }')["data"]["currentBulkOperation"]
        log(f"  {c['status']} {c.get('objectCount')}")
        if c["status"] in ("COMPLETED", "FAILED", "CANCELED"): break
    if c["status"] != "COMPLETED": raise RuntimeError(c)
    urllib.request.urlretrieve(c["url"], cache)
    return cache

def catalog():
    cache = CACHE / "catalog.json"
    cat = json.loads(cache.read_text(encoding="utf-8"))
    return {pnum(k): v for k, v in cat.items()}

def main():
    cat = catalog()
    pc = CFG["products"]; bad_w = [w.lower() for w in pc["exclude_title_contains"]]
    targets = {pid for pid, i in cat.items() if i["status"] == "ACTIVE" and i["type"] == "product"
               and not any(w in i["title"].lower() for w in bad_w)}
    op = pull_orders_sub()

    orders = {}; li = defaultdict(list)
    for line in op.open(encoding="utf-8"):
        o = json.loads(line); oid = o.get("id", "")
        if "/Order/" in oid:
            cu = o.get("customer") or {}
            phone = cu.get("phone") or ((cu.get("defaultAddress") or {}) or {}).get("phone") or ""
            sub = ((o.get("subtotalPriceSet") or {}).get("shopMoney") or {}).get("amount")
            orders[oid] = {"cust": cu.get("id"), "first": cu.get("firstName") or "", "phone": phone,
                           "date": o["createdAt"][:10], "sub": float(sub) if sub else 0.0,
                           "bad": bool(o.get("cancelledAt")) or o.get("displayFinancialStatus") in ("REFUNDED", "VOIDED")}
        elif "quantity" in o and "__parentId" in o:
            pid = (o.get("product") or {}).get("id")
            if pid: li[o["__parentId"]].append(pnum(pid))

    cust = defaultdict(lambda: {"prods": defaultdict(list), "first": "", "phone": "", "last_sub": 0.0, "last_date": ""})
    for oid, pids in li.items():
        od = orders.get(oid)
        if not od or not od["cust"] or od["bad"]: continue
        c = cust[od["cust"]]
        c["first"] = c["first"] or od["first"]; c["phone"] = c["phone"] or od["phone"]
        if od["date"] > c["last_date"]: c["last_date"] = od["date"]; c["last_sub"] = od["sub"]
        for pid in set(pids):
            if pid in targets: c["prods"][pid].append(od["date"])

    # empirical windows
    rc = CFG["refill_window"]; win = {}
    for pid in targets:
        gaps = []
        for c in cust.values():
            ds = sorted(set(c["prods"].get(pid, [])))
            if len(ds) >= 2: gaps.append((date.fromisoformat(ds[1]) - date.fromisoformat(ds[0])).days)
        m = statistics.median(gaps) if len(gaps) >= rc["min_repeat_sample"] else None
        win[pid] = (int(m * rc["lower_multiplier"]), int(m * rc["upper_multiplier"]), m) if m else (rc["fallback_days"][0], rc["fallback_days"][1], None)

    # exclude existing store-credit holders
    holders = set()
    hf = TEN / "store-credit-holders.json"
    if hf.exists():
        holders = {h["gid"] for h in json.loads(hf.read_text(encoding="utf-8"))}
    log(f"excluding {len(holders)} existing credit-holders")

    freq = build_firstname_freq([{"name": c["first"]} for c in cust.values()])
    ov = TEN / "beautyback-name-overrides.json"
    overrides = json.loads(ov.read_text(encoding="utf-8")) if ov.exists() else {}
    def nm(raw):
        cu, fl = curate_name(raw, freq)
        if fl == "review" and raw in overrides: cu = overrides[raw]
        return "" if cu == SENTINEL else cu
    # Persistent holdout by customer ID (the GID's numeric atom) - stable across waves and immune to
    # phone reformatting (a differently-formatted phone would silently flip a customer's arm).
    # SEAM: waves <= 2026-07-07 (reactivation, refill) used md5(phone); GID-hash starts with the NEXT
    # cohort build - a deliberate one-time reshuffle of arm membership (documented in the initiative).
    def held(cid): return int(hashlib.md5(str(cid).encode()).hexdigest(), 16) % 100 < CFG["holdout"]["pct"]

    rows = []; skipped_floor = 0
    for gid, c in cust.items():
        if gid in holders: continue
        phone = e164(c["phone"])
        if not phone: continue
        # due-to-refill: any product inside its refill window (0.75x..2x median), not lapsed beyond
        due = []
        for pid, ds in c["prods"].items():
            dsi = days_since(max(ds)); lo, hi, med = win[pid]
            if lo <= dsi <= hi: due.append((pid, dsi, med or hi))
        if not due: continue
        # anchor = most "due" (largest days_since / median ratio, still in-window)
        anchor = max(due, key=lambda x: x[1] / x[2])[0]
        credit = round(min(CEIL, PCT * c["last_sub"]), 2)
        if credit < FLOOR: skipped_floor += 1; continue
        rows.append([nm(c["first"]), phone, cat[anchor]["title"], credit, round(c["last_sub"], 2),
                     days_since(max(c["prods"][anchor])), "HOLD" if held(pnum(gid)) else "SEND", pnum(gid)])

    send = [r for r in rows if r[6] == "SEND"]; hold = [r for r in rows if r[6] == "HOLD"]
    liability = sum(r[3] for r in send)
    outdir = HERE / "out" / f"store-credit-push-{TODAY.isoformat()}"; outdir.mkdir(parents=True, exist_ok=True)
    cols = ["First Name", "Phone", "Anchor Product", "Credit (R$)", "Last Order (R$)", "Days Since", "Holdout", "Customer GID"]
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "push"; ws.append(cols)
    for r in rows: ws.append(r)
    wb.save(outdir / "cohort.xlsx")
    # smoke subset
    sm = openpyxl.Workbook(); sw = sm.active; sw.title = "smoke"; sw.append(cols)
    for r in send[:3]: sw.append(r)
    sm.save(outdir / "smoke-test.xlsx")

    log("\n=== STORE-CREDIT PUSH COHORT ===")
    log(f"  cohort total     : {len(rows)}")
    log(f"    SEND           : {len(send)}   HOLD (10%): {len(hold)}")
    log(f"    skipped <R$10  : {skipped_floor}")
    log(f"  credit liability (SEND): R$ {liability:,.2f}")
    log(f"  avg credit/SEND  : R$ {liability/max(1,len(send)):.2f}")
    caps = sum(1 for r in send if r[3] >= CEIL)
    log(f"  at R$120 ceiling : {caps} ({100*caps/max(1,len(send)):.0f}%)")
    log(f"  -> {outdir}")

if __name__ == "__main__":
    main()
