"""
Canonical append-only ledger of every store-credit event the retention machine (or a human
operator) has performed: wave issues, expiry extensions, keeper-rule corrections, manual credits.

Why it exists: the money movements were scattered across four idempotency state files
(issue-reactivation / issue-refill / extend-expiry / correct-keeper) and manual credits were
recorded nowhere. Measurement is only as good as the record of what was credited — this file is
that record. One JSON row per event, PII, gitignored (learning/*.jsonl).

  python credit_ledger.py               # summary: counts + totals per source/event, live credit
  python credit_ledger.py --backfill    # idempotent: import the four state files + known manual credits

Convention for future scripts/sessions: any code path that credits or debits a customer's
store-credit account MUST append one row here:

  from credit_ledger import append_event
  append_event(event="issue", source="wave-<slug>", customer_gid=gid, amount=45.60,
               expires_at="2026-08-15T23:59:59Z", notes="...")

Row schema (nulls allowed where unknown):
  ts           ISO date/datetime the event happened in Shopify
  event        issue | debit | extend | correction
  source       wave-reactivation | wave-refill | extend-expiry | correct-keeper | manual
  campaign     campaign slug (waves only)
  wave         wave id (waves only)
  customer_gid gid://shopify/Customer/...
  amount       BRL, positive for credits, negative for debits, null when not recorded at run time
  currency     BRL
  expires_at   expiry set by the event, if any
  notes        free text
"""
import json, sys, argparse, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEDGER = HERE / "learning" / "credit-ledger.jsonl"

FIELDS = ["ts", "event", "source", "campaign", "wave", "customer_gid",
          "amount", "currency", "expires_at", "notes"]


def append_event(**kw):
    """Append one credit event. Required: ts, event, source, customer_gid."""
    for req in ("ts", "event", "source", "customer_gid"):
        if not kw.get(req):
            raise ValueError(f"append_event: missing required field '{req}'")
    row = {f: kw.get(f) for f in FIELDS}
    row.setdefault("currency", "BRL")
    if row["currency"] is None:
        row["currency"] = "BRL"
    with LEDGER.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return row


def _key(row):
    return (row.get("event"), row.get("customer_gid"), str(row.get("ts")),
            str(row.get("amount")), row.get("source"))


def _load_existing():
    if not LEDGER.exists():
        return set()
    return {_key(json.loads(l)) for l in LEDGER.open(encoding="utf-8") if l.strip()}


# Manual credits issued outside the wave scripts, verified against Shopify transaction history.
# (Ana Beatriz: R$138.64 credit 16/07, then a R$129 debit + re-credit pair ~3h later that
#  re-pinned expiry to 04/09T03:00Z — amounts straight from StoreCreditAccount/5776998720.)
MANUAL_EVENTS = [
    dict(ts="2026-07-16T17:30:33Z", event="issue", source="manual",
         customer_gid="gid://shopify/Customer/7760871948608", amount=138.64,
         expires_at="2026-09-05T02:59:59Z",
         notes="Ana Beatriz Boiteux — 20% of order #85571 subtotal (R$693.20 paid); notify=false"),
    dict(ts="2026-07-16T20:18:41Z", event="debit", source="manual",
         customer_gid="gid://shopify/Customer/7760871948608", amount=-129.0,
         notes="Ana Beatriz — debit half of expiry-fix pair (per Shopify tx history)"),
    dict(ts="2026-07-16T20:20:25Z", event="issue", source="manual",
         customer_gid="gid://shopify/Customer/7760871948608", amount=129.0,
         expires_at="2026-09-04T03:00:00Z",
         notes="Ana Beatriz — re-credit half of expiry-fix pair (per Shopify tx history)"),
]


def backfill():
    existing = _load_existing()
    added = {"wave-reactivation": 0, "wave-refill": 0, "extend-expiry": 0,
             "correct-keeper": 0, "manual": 0}

    def put(row):
        if _key(row) in existing:
            return
        existing.add(_key(row))
        append_event(**row)
        added[row["source"]] += 1

    issue_waves = [
        ("issue-reactivation-state.json", "wave-reactivation",
         "store-credit-reactivation", "2026-07-06-ge60d"),
        ("issue-refill-state.json", "wave-refill",
         "store-credit-stillactive", "2026-07-07-ge45-59d-refill"),
    ]
    for fname, source, campaign, wave in issue_waves:
        state = json.load((HERE / fname).open(encoding="utf-8"))
        for gid, v in state.items():
            put(dict(ts=v["issued_at"], event="issue", source=source, campaign=campaign,
                     wave=wave, customer_gid=gid, amount=v["credit"], expires_at=v["expires"]))

    for gid in json.load((HERE / "extend-expiry-state.json").open(encoding="utf-8")):
        put(dict(ts="2026-07-13", event="extend", source="extend-expiry", customer_gid=gid,
                 expires_at="2026-07-17T23:59:59Z",
                 notes="debit+re-credit of live balance to 17/07; per-holder amount not recorded at run time"))

    for gid in json.load((HERE / "correct-keeper-state.json").open(encoding="utf-8")):
        put(dict(ts="2026-07-13", event="correction", source="correct-keeper", customer_gid=gid,
                 notes="keeper-rule set correction (largest emailed credit wins); amounts not recorded"))

    for row in MANUAL_EVENTS:
        put(dict(row))

    total = sum(added.values())
    print(f"backfill: {total} rows appended" + ("" if total else " (ledger already up to date)"))
    for src, n in added.items():
        if n:
            print(f"  {src}: {n}")


def summary():
    if not LEDGER.exists():
        print(f"no ledger yet — run: python {Path(__file__).name} --backfill")
        return
    rows = [json.loads(l) for l in LEDGER.open(encoding="utf-8") if l.strip()]
    agg = {}
    for r in rows:
        k = (r["source"], r["event"])
        n, amt, unk = agg.get(k, (0, 0.0, 0))
        a = r.get("amount")
        agg[k] = (n + 1, amt + (a or 0.0), unk + (a is None))
    print(f"credit-ledger: {len(rows)} rows\n")
    print(f"{'source':<20} {'event':<12} {'n':>6} {'total BRL':>14}  amount-unknown")
    for (src, ev), (n, amt, unk) in sorted(agg.items()):
        print(f"{src:<20} {ev:<12} {n:>6} {amt:>14,.2f}  {unk or ''}")
    today = datetime.date.today().isoformat()
    live = [r for r in rows if r["event"] == "issue" and (r.get("expires_at") or "")[:10] >= today]
    print(f"\nissues not yet expired as of {today}: {len(live)} rows, "
          f"R${sum(r.get('amount') or 0 for r in live):,.2f} "
          f"(issuance-side only — redemptions/expiry burn not tracked here; balance lives in Shopify)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--backfill", action="store_true")
    args = ap.parse_args()
    backfill() if args.backfill else summary()
