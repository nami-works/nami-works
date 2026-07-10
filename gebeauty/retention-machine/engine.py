"""
GE Beauty Review-Collection + Repurchase Machine — engine.

Self-contained + stateful. Each run:
  1. Pull live Shopify order history + Loox review corpus (cached <12h for fast reruns).
  2. Compute eligibility, empirical refill windows, per-customer review allocation.
  3. Advance per-customer state, applying cooldown + holdout.
  4. Emit Zoko-ready send lists per stream to out/<date>/ and persist state.json.

Rules live in config.json. Creds in ../.env. No session context required.

Streams: A initial ask | B interacted reminder (needs Zoko) | C earned-unused reorder | D win-back.
This build wires A, C, D fully; B is emitted only when Zoko engagement is available.
"""
import json, urllib.request, urllib.error, time, sys, hashlib, statistics, re
from pathlib import Path
from collections import defaultdict
from datetime import date, datetime, timezone

HERE = Path(__file__).resolve().parent
TEN = HERE.parent                      # gebeauty
CACHE = HERE / "_cache"; CACHE.mkdir(exist_ok=True)
CFG = json.loads((HERE / "config.json").read_text(encoding="utf-8"))
sys.path.insert(0, str(TEN / "scripts"))
import openpyxl
from build_zoko_list import curate_name, build_firstname_freq, SENTINEL  # reuse validated curation

TODAY = date.today()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

def log(*a): print(*a); sys.stdout.flush()

# ---------- env ----------
env = {}
for line in (TEN / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); env[k.strip()] = v.strip()
SHOP = env["SHOPIFY_SHOP_DOMAIN"]; STOKEN = env["SHOPIFY_ADMIN_ACCESS_TOKEN"]
SVER = env.get("SHOPIFY_API_VERSION", "2026-01")
SURL = f"https://{SHOP}/admin/api/{SVER}/graphql.json"
LOOX_KEY = env.get("LOOX_API_KEY"); LOOX_SID = env.get("LOOX_PUBLIC_STORE_ID")

def sgql(q, v=None):
    body = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    req = urllib.request.Request(SURL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": STOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode())

def fresh(p, hours=12):
    return p.exists() and (time.time() - p.stat().st_mtime) < hours * 3600

# ---------- Shopify orders (bulk, cached) ----------
def pull_orders():
    cache = CACHE / "orders.jsonl"
    if fresh(cache):
        log(f"[orders] cache hit ({cache.stat().st_size} bytes)"); return cache
    log("[orders] bulk export…")
    BULK = '''mutation { bulkOperationRunQuery(query: """
    { orders { edges { node {
        id createdAt cancelledAt displayFinancialStatus
        customer { id email firstName phone defaultAddress { phone } }
        lineItems { edges { node { quantity product { id } } } }
    } } } } """) { bulkOperation { id status } userErrors { field message } } }'''
    r = sgql(BULK)
    ue = r["data"]["bulkOperationRunQuery"]["userErrors"]
    if ue: raise RuntimeError(f"bulk userErrors: {ue}")
    while True:
        time.sleep(8)
        c = sgql('{ currentBulkOperation { status objectCount url errorCode } }')["data"]["currentBulkOperation"]
        log(f"  status={c['status']} objects={c.get('objectCount')}")
        if c["status"] in ("COMPLETED", "FAILED", "CANCELED"): break
    if c["status"] != "COMPLETED": raise RuntimeError(f"bulk {c}")
    urllib.request.urlretrieve(c["url"], cache)
    return cache

# ---------- Loox corpus (cached) ----------
def pull_loox():
    cache = CACHE / "loox.json"
    if fresh(cache):
        log("[loox] cache hit"); return json.loads(cache.read_text(encoding="utf-8"))
    log("[loox] pulling corpus…")
    base = f"https://api.loox.io/api/v1/store/{LOOX_SID}/product-reviews"
    out = []; page = 1
    while True:
        req = urllib.request.Request(f"{base}?limit=100&page={page}",
            headers={"X-Api-Secret-Key": LOOX_KEY, "Accept": "application/json", "User-Agent": UA})
        d = json.loads(urllib.request.urlopen(req, timeout=40).read().decode())
        out += d.get("reviews", [])
        if not d.get("pagination", {}).get("hasMore") or page > 60: break
        page += 1; time.sleep(0.3)
    cache.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out

# ---------- catalog (cached) ----------
def pull_catalog():
    cache = CACHE / "catalog.json"
    if fresh(cache, 72): return json.loads(cache.read_text(encoding="utf-8"))
    cat = {}; cur = None
    Q = '''query($c:String){ products(first:250, after:$c){ pageInfo{hasNextPage endCursor}
      nodes{ id title handle productType status } } }'''
    while True:
        d = sgql(Q, {"c": cur})["data"]["products"]
        for n in d["nodes"]:
            cat[n["id"]] = {"title": n["title"], "handle": n["handle"], "type": n["productType"], "status": n["status"]}
        if not d["pageInfo"]["hasNextPage"]: break
        cur = d["pageInfo"]["endCursor"]
    cache.write_text(json.dumps(cat, ensure_ascii=False), encoding="utf-8")
    return cat

# ---------- helpers ----------
NON = re.compile(r"\D")
def e164(raw):
    if not raw: return ""
    d = NON.sub("", raw)
    if d.startswith("55") and len(d) in (12, 13): return "+" + d
    if len(d) in (10, 11): return "+55" + d
    return ""

def days_since(dstr): return (TODAY - date.fromisoformat(dstr[:10])).days
def pnum(x): return str(x).rsplit("/", 1)[-1]   # GID or bare -> bare numeric (Loox uses bare, Shopify uses GID)

def target_products(cat):
    pc = CFG["products"]
    bad_types = set(pc["exclude_types"]); bad_words = [w.lower() for w in pc["exclude_title_contains"]]
    ids = {}
    for pid, info in cat.items():
        if info["status"] != "ACTIVE" or info["type"] != "product": continue
        t = info["title"].lower()
        if any(w in t for w in bad_words): continue
        if pc["mode"] == "explicit" and pid not in set(pc["include_ids"]): continue
        ids[pid] = info
    return ids

# ---------- main ----------
def main():
    cat = pull_catalog()
    cat = {pnum(k): v for k, v in cat.items()}     # re-key by bare numeric to match Loox
    targets = target_products(cat)
    log(f"[catalog] {len(targets)} target retail products")
    orders_path = pull_orders()
    loox = pull_loox()

    # loox: reviewers by product (customerId) + review date, corpus counts
    reviewers = defaultdict(set)          # pid -> {customerId or email}  (only 863/2327 have cid)
    review_when = {}                       # (key, pid) -> date  (key = cid and/or email)
    corpus = defaultdict(int)              # pid -> published count
    for rv in loox:
        p = rv.get("product") or {}; pid = str(p.get("id") or "")
        corpus[pid] += 1
        r = rv.get("reviewer") or {}
        cid = str(r.get("customerId") or ""); em = (r.get("email") or "").lower()
        d = rv.get("createdAt", "")[:10]
        for key in (cid, em):
            if key:
                reviewers[pid].add(key); review_when[(key, pid)] = d

    # orders -> per customer per product dates; customer contact
    orders = {}; li = defaultdict(list)
    for line in orders_path.open(encoding="utf-8"):
        o = json.loads(line); oid = o.get("id", "")
        if "/Order/" in oid:
            cu = o.get("customer") or {}
            phone = cu.get("phone") or ((cu.get("defaultAddress") or {}) or {}).get("phone") or ""
            orders[oid] = {"cust": cu.get("id"), "email": (cu.get("email") or "").lower(),
                           "first": cu.get("firstName") or "", "phone": phone,
                           "date": o["createdAt"][:10],
                           "bad": bool(o.get("cancelledAt")) or o.get("displayFinancialStatus") in ("REFUNDED", "VOIDED")}
        elif "quantity" in o and "__parentId" in o:
            pid = (o.get("product") or {}).get("id")
            if pid: li[o["__parentId"]].append(pnum(pid))

    cust = defaultdict(lambda: {"prods": defaultdict(list), "first": "", "phone": "", "email": "", "last_any": ""})
    for oid, pids in li.items():
        od = orders.get(oid)
        if not od or not od["cust"] or od["bad"]: continue
        c = cust[od["cust"]]
        c["first"] = c["first"] or od["first"]; c["phone"] = c["phone"] or od["phone"]
        c["email"] = c["email"] or od["email"]
        if od["date"] > c["last_any"]: c["last_any"] = od["date"]
        for pid in set(pids):
            if pid in targets: c["prods"][pid].append(od["date"])

    # empirical refill window per product
    rc = CFG["refill_window"]; win = {}
    for pid in targets:
        gaps = []
        for c in cust.values():
            ds = sorted(set(c["prods"].get(pid, [])))
            if len(ds) >= 2:
                gaps.append((date.fromisoformat(ds[1]) - date.fromisoformat(ds[0])).days)
        if len(gaps) >= rc["min_repeat_sample"]:
            m = statistics.median(gaps)
            win[pid] = (int(m * rc["lower_multiplier"]), int(m * rc["upper_multiplier"]), int(m))
        else:
            win[pid] = (rc["fallback_days"][0], rc["fallback_days"][1], None)

    # allocation + stage assignment
    floor = CFG["review_allocation"]["review_floor"]
    elig_min = CFG["eligibility"]["min_days_since_purchase"]
    lap_mult = CFG["state_machine"]["lapsed_multiplier_of_window"]

    def numeric(gid): return str(gid).rsplit("/", 1)[-1]

    streams = {"A": [], "C": [], "D": []}
    hold = {"A": 0, "C": 0, "D": 0}
    freq = build_firstname_freq([{"name": c["first"]} for c in cust.values()])
    overrides = {}
    ovp = TEN / "beautyback-name-overrides.json"
    if ovp.exists(): overrides = json.loads(ovp.read_text(encoding="utf-8"))

    def held(phone): return int(hashlib.md5(phone.encode()).hexdigest(), 16) % 100 < CFG["holdout"]["pct"]
    def link(pid): return f'{CFG["storefront_base"]}/products/{cat[pid]["handle"]}{CFG["review_link_suffix"]}'
    def nm(raw):
        cu, fl = curate_name(raw, freq)
        if fl == "review" and raw in overrides: cu = overrides[raw]
        return "" if cu == SENTINEL else cu

    def has_reviewed(cid, email, pid):
        s = reviewers.get(pid, set())
        return cid in s or (email and email in s)
    def rev_date(cid, email, pid):
        return review_when.get((cid, pid)) or review_when.get((email, pid)) or ""

    for gid, c in cust.items():
        phone = e164(c["phone"])
        if not phone or not c["prods"]: continue
        cid = numeric(gid); email = c["email"]

        # ---- C: reviewed but not repurchased since (earned code unused) — warmest, runs first ----
        c_hit = None
        for pid in c["prods"]:
            if has_reviewed(cid, email, pid):
                wdate = rev_date(cid, email, pid)
                if wdate and c["last_any"] <= wdate:   # no order after the review -> reward likely unused
                    c_hit = pid; break
        if c_hit:
            row = [nm(c["first"]), phone, cat[c_hit]["title"], "reorder (earned code unused)",
                   link(c_hit), "PENDING_CODE", "HOLD" if held(phone) else "SEND", "reviewed, no repurchase since"]
            streams["C"].append(row); hold["C"] += held(phone); continue

        # ---- D: win-back (lapsed, non-reviewer) ----
        lapsed = all(days_since(max(ds)) > win[pid][1] * lap_mult for pid, ds in c["prods"].items())
        if lapsed:
            row = [nm(c["first"]), phone, "", "win-back", "", "", "HOLD" if held(phone) else "SEND",
                   "lapsed>2x refill window"]
            streams["D"].append(row); hold["D"] += held(phone); continue

        # ---- A: initial review ask (allocation) ----
        elig = []
        for pid, ds in c["prods"].items():
            ds = sorted(set(ds))
            if days_since(ds[-1]) < elig_min: continue
            if has_reviewed(cid, email, pid): continue
            elig.append((pid, ds))
        if not elig: continue
        repeats = [(pid, ds) for pid, ds in elig if len(ds) >= 2]
        if repeats:                                   # RULE 1: repeat-of-same-product wins
            pid, ds = max(repeats, key=lambda x: (len(x[1]), x[1][-1])); seg = "advocate (repeat)"
        else:                                         # RULE 2: thinnest corpus, tie -> most recent
            lowest = min(corpus.get(p, 0) for p, _ in elig)
            cands = [(p, d) for p, d in elig if corpus.get(p, 0) == lowest]
            pid, ds = max(cands, key=lambda x: x[1][-1]); seg = "single-buyer (thin corpus)"
        row = [nm(c["first"]), phone, cat[pid]["title"], seg, link(pid), "", "HOLD" if held(phone) else "SEND",
               f"corpus={corpus.get(pid,0)}"]
        streams["A"].append(row); hold["A"] += held(phone)

    # ---- emit ----
    outdir = HERE / CFG["output"]["dir"] / TODAY.isoformat(); outdir.mkdir(parents=True, exist_ok=True)
    cols = CFG["output"]["columns"]
    for s, rows in streams.items():
        wb = openpyxl.Workbook(); ws = wb.active; ws.title = f"stream_{s}"; ws.append(cols)
        for r in rows: ws.append(r)
        wb.save(outdir / f"stream-{s}.xlsx")
    summary = [f"# Run {TODAY.isoformat()}", ""]
    for s in ("A", "C", "D"):
        send = len(streams[s]) - hold[s]
        summary.append(f"- Stream {s}: {len(streams[s])} rows  (SEND {send} / HOLD {hold[s]})")
    summary.append("- Stream B (interacted reminder): pending ZOKO_API_KEY")
    (outdir / "summary.md").write_text("\n".join(summary), encoding="utf-8")
    log("\n".join(summary)); log(f"-> {outdir}")

if __name__ == "__main__":
    main()
