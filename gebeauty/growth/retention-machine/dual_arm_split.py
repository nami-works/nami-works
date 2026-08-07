"""
August dual-test cohort split — date-arm (8/5 vs 8/8) x timing-arm (PAW vs control-1pm),
layered on TODAY's store-credit-push cohort (out/store-credit-push-2026-08-05/cohort.xlsx).

H-CALENDAR-02 (successor to H-CALENDAR-01 / dead H-SALEDAY-PUSH-01): does the wave itself
convert better landing on a double-date (8/8) vs an ordinary day (8/5)?
H-TIMING-01 (SCOPE FLIPPED 2026-08-05, Lucas): timing now applies to the CREDIT ISSUANCE
ITSELF (notify=true), not a separate WhatsApp nudge — the WhatsApp nudge is killed for this
test. PAW = each customer's modal 30-min purchase slot (from order history), in 9h-21h BRT.
Out-of-window / <2 orders customers always go to control (fixed 1PM BRT issuance).

Two independent GID-hashes (different salts) so date-arm and timing-arm are uncorrelated by
construction — each hypothesis can be read without contaminating the other.

DRY RUN ONLY. No credit issuance happens in this script.
"""
import json, hashlib, sys
from pathlib import Path
from datetime import datetime, timedelta, date
import openpyxl

HERE = Path(__file__).resolve().parent
TODAY = date.today()
COHORT_DIR = HERE / "out" / f"store-credit-push-{TODAY.isoformat()}"
CACHE = HERE / "_cache" / "orders_sub.jsonl"
RECENCY_MIN = 60
BRT_OFFSET = timedelta(hours=-3)

def log(*a): print(*a); sys.stdout.flush()

def to_brt(iso_str):
    # createdAt is UTC ISO8601 e.g. 2026-07-01T14:32:10Z
    dt = datetime.strptime(iso_str[:19], "%Y-%m-%dT%H:%M:%S")
    return dt + BRT_OFFSET

def slot_of(dt):
    """30-min bucket index 0..47 for a BRT datetime."""
    return dt.hour * 2 + (1 if dt.minute >= 30 else 0)

def slot_to_hhmm(slot):
    h, half = divmod(slot, 2)
    return f"{h:02d}:{'30' if half else '00'}"

def date_arm(gid):
    return "A_8-5" if int(hashlib.md5((gid + "|date-arm-2026-08").encode()).hexdigest(), 16) % 2 == 0 else "B_8-8"

def timing_arm(gid):
    return "PAW" if int(hashlib.md5((gid + "|timing-arm-2026-08").encode()).hexdigest(), 16) % 2 == 0 else "control"

def main():
    # 1. per-customer order timestamps (BRT) + last-order-days
    log("[1/4] scanning orders_sub.jsonl for per-customer timestamps...")
    cust_times = {}
    last_order = {}
    n = 0
    for line in CACHE.open(encoding="utf-8"):
        o = json.loads(line)
        if "/Order/" not in o.get("id", ""): continue
        n += 1
        cu = o.get("customer") or {}
        gid = cu.get("id")
        if not gid: continue
        bad = bool(o.get("cancelledAt")) or o.get("displayFinancialStatus") in ("REFUNDED", "VOIDED")
        if bad: continue
        d = o["createdAt"][:10]
        if gid not in last_order or d > last_order[gid]: last_order[gid] = d
        cust_times.setdefault(gid, []).append(o["createdAt"])
    log(f"    scanned {n} order records, {len(cust_times)} customers with >=1 valid order")

    # 2. PAW per customer
    log("[2/4] computing PAW (modal 30-min slot, BRT) per customer...")
    MIN_ORDERS_FOR_PAW = 3  # matches the 3+ bar used in the 2026-07-06 observational check
    # (hypotheses.md: even at 3+, personal modal hour-block only beat random 65% vs 63% --
    # weak but at least the same signal already trusted elsewhere. n=2 is not that signal.)
    paw = {}
    ties = 0
    for gid, times in cust_times.items():
        if len(times) < MIN_ORDERS_FOR_PAW:
            paw[gid] = None  # not enough signal -> control
            continue
        slots = [slot_of(to_brt(t)) for t in times]
        counts = {}
        for s in slots: counts[s] = counts.get(s, 0) + 1
        top = max(counts.values())
        winners = [s for s, c in counts.items() if c == top]
        if len(winners) > 1:
            ties += 1
            paw[gid] = None  # genuine tie at 3+ orders -> no clear mode, treat as control
            continue
        paw[gid] = winners[0]
    log(f"    {ties} customers had a tie at {MIN_ORDERS_FOR_PAW}+ orders (no clear mode -> control)")

    # 3. load today's cohort, filter to SEND + >=60d recency (the standing reactivation pop)
    log("[3/4] loading cohort.xlsx, filtering to SEND + >=60d recency...")
    ws = openpyxl.load_workbook(COHORT_DIR / "cohort.xlsx").active
    H = [c.value for c in ws[1]]; ix = {k: H.index(k) for k in H}
    rows = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[ix["Holdout"]] != "SEND": continue
        gid_num = r[ix["Customer GID"]]
        gid = f"gid://shopify/Customer/{gid_num}"
        lo = last_order.get(gid)
        if not lo: continue
        days_since = (TODAY - date.fromisoformat(lo)).days
        if days_since < RECENCY_MIN: continue
        p = paw.get(gid)
        in_window = p is not None and 18 <= p <= 41  # 9:00 (slot18) .. 20:59 (slot41)
        rows.append({
            "gid": gid, "name": r[ix["First Name"]], "phone": r[ix["Phone"]],
            "credit": round(float(r[ix["Credit (R$)"]]), 2), "days_since": days_since,
            "paw_slot": slot_to_hhmm(p) if in_window else None,
            "in_window": in_window,
            "date_arm": date_arm(gid),
            "timing_arm": (timing_arm(gid) if in_window else "control"),
        })

    # 4. summarize
    log(f"[4/4] eligible (SEND, >=60d, this month): {len(rows)}")
    from collections import Counter
    cell = Counter((r["date_arm"], r["timing_arm"]) for r in rows)
    log("  cells (date_arm, timing_arm) -> n:")
    for k in sorted(cell): log(f"    {k}: {cell[k]}")
    in_win = sum(1 for r in rows if r["in_window"])
    log(f"  in-window (computable PAW, 9-21h): {in_win} ({100*in_win/max(1,len(rows)):.0f}%)")
    liability = sum(r["credit"] for r in rows)
    log(f"  total credit liability (both date-arms): R$ {liability:,.2f}")

    slot_counts = Counter(r["paw_slot"] for r in rows if r["paw_slot"])
    log(f"  distinct PAW slots needed: {len(slot_counts)}")
    for s in sorted(slot_counts): log(f"    {s}: {slot_counts[s]}")

    out = COHORT_DIR / "dual-arm-cohort.jsonl"
    with out.open("w", encoding="utf-8") as f:
        for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    log(f"\n-> {out}")

if __name__ == "__main__":
    main()
