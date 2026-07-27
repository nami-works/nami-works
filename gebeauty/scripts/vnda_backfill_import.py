"""
VNDA historical-order backfill importer  (initiative: gebeauty-vnda-order-backfill).

DRY-RUN BY DEFAULT — makes ZERO writes. Live mode (--apply) is intentionally
NOT implemented in this file yet: it is gated on three Lucas-owned approvals
(FullComm exclusion rule, write_orders scope, Klaviyo trigger_filter). See the
initiative file. Running without --apply is always safe.

Pipeline:
  A. Parse the 8 VNDA Pedidos*.xlsx -> confirmed orders (Status == 'Confirmado').
  B. Pull Shopify Migration1 customers (email, id, #orders) -> cached JSONL.
  C. Match orders to customers by email (primary) / CPF (secondary), build the
     idempotent orderCreate plan, and write a preview + sample payloads.

Idempotency: each order stamps its VNDA `Nº pedido` in note + a custom attribute
(`vnda_pedido`) and carries a `vnda-import` tag. A future live run skips any
order whose vnda_pedido already exists in Shopify.

Usage:
  python vnda_backfill_import.py                # dry run (pull customers if not cached)
  python vnda_backfill_import.py --refresh-customers   # force re-pull Migration1 cache
Outputs (PII — written to scratchpad, never committed):
  _vnda_plan.jsonl        full proposed plan, one line per matched order
  _vnda_unmatched.jsonl   orders whose email/CPF is not in Migration1
"""
import argparse
import json
import re
import sys
import time
import urllib.request
import urllib.error
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # gebeauty/
ENV_PATH = ROOT / ".env"
VNDA_BASE = Path(r"G:\Drives compartilhados\GEB_Operações\Drive Felipe\GB\FORNECEDORES\VNDA\BaseDePedidos")
FILES = [f"Pedidos{i}.xlsx" for i in range(1, 9)]
# PII outputs stay out of the repo:
OUT_DIR = Path(r"C:\Users\LUCASG~1\AppData\Local\Temp\claude\c--claude\1f42c30b-8ada-4266-bef4-6cda9e26d07a\scratchpad")
CUST_CACHE = OUT_DIR / "_vnda_migration1_customers.jsonl"
PLAN_OUT = OUT_DIR / "_vnda_plan.jsonl"
UNMATCHED_OUT = OUT_DIR / "_vnda_unmatched.jsonl"

LINE_TITLE = "Pedido histórico VNDA"
IMPORT_TAG = "vnda-import"
CUTOFF = datetime(2024, 3, 13).date()   # Shopify cutover; orders after this are already native


def log(*a): print(*a); sys.stdout.flush()


def load_env():
    env = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1); env[k.strip()] = v.strip()
    return env


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def parse_brl(s):
    """'1.234,56' -> 1234.56 ; '165,08' -> 165.08"""
    if s is None: return None
    if isinstance(s, (int, float)): return float(s)
    t = str(s).strip().replace(".", "").replace(",", ".")
    try: return round(float(t), 2)
    except ValueError: return None


def parse_date(s):
    if not s: return None
    if isinstance(s, datetime): return s.date()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try: return datetime.strptime(str(s).strip(), fmt).date()
        except ValueError: pass
    return None


def norm_email(e):
    if not isinstance(e, str): return None
    e = e.strip().lower()
    return e or None


def digits(s):
    return re.sub(r"\D", "", str(s)) if s else ""


def processed_at(d, hora):
    """Local BRT noon (or the recorded hour) so the analytics date can't drift across TZ."""
    hh, mm = 12, 0
    if isinstance(hora, str) and ":" in hora:
        try: hh, mm = int(hora.split(":")[0]), int(hora.split(":")[1]);
        except ValueError: pass
    return f"{d.isoformat()}T{hh:02d}:{mm:02d}:00-03:00"


# ----------------------------------------------------------------------------
# A. parse VNDA
# ----------------------------------------------------------------------------
def parse_vnda():
    import openpyxl
    orders = []
    status_ct = Counter()
    after_cutoff = 0
    for fn in FILES:
        wb = openpyxl.load_workbook(VNDA_BASE / fn, read_only=True, data_only=True)
        ws = wb[wb.sheetnames[0]]
        it = ws.iter_rows(values_only=True)
        header = next(it)
        idx = {h: i for i, h in enumerate(header)}
        for r in it:
            if idx['Tipo'] >= len(r) or str(r[idx['Tipo']]).strip().lower() != 'total':
                continue
            status = str(r[idx['Status']]).strip()
            status_ct[status] += 1
            if status != 'Confirmado':
                continue
            d = parse_date(r[idx['Data']])
            if d and d > CUTOFF:
                after_cutoff += 1
                continue
            orders.append({
                "vnda_id": str(r[idx['Nº pedido']]).strip() if r[idx['Nº pedido']] else None,
                "date": d.isoformat() if d else None,
                "hora": r[idx['Hora']],
                "email": norm_email(r[idx['E-mail']]),
                "cpf": digits(r[idx['Documento']]),
                "name": r[idx['Nome']],
                "total": parse_brl(r[idx['Preço venda']]),
            })
        wb.close()
        log(f"  parsed {fn}")
    log(f"\nVNDA: {sum(status_ct.values())} total rows | Confirmado kept: {len(orders)} "
        f"| dropped non-Confirmado: {sum(v for k,v in status_ct.items() if k!='Confirmado')} "
        f"| dropped after-cutoff: {after_cutoff}")
    return orders


# ----------------------------------------------------------------------------
# B. pull Shopify Migration1 customers (read-only)
# ----------------------------------------------------------------------------
def shopify_gql(env, query, variables=None):
    url = f"https://{env['SHOPIFY_SHOP_DOMAIN']}/admin/api/{env.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
    body = json.dumps({"query": query, **({"variables": variables} if variables else {})}).encode()
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": env["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503):
                time.sleep(2 * (attempt + 1)); continue
            raise
    raise RuntimeError("shopify throttled out")


CUST_Q = """
query($cursor: String) {
  customers(first: 250, after: $cursor, query: "tag:Migration1") {
    edges { node { id email numberOfOrders defaultEmailAddress { emailAddress }
      metafield(namespace:"custom", key:"cpf"){ value } } }
    pageInfo { hasNextPage endCursor }
  }
  # cost visibility
}"""


def pull_customers(env, refresh=False):
    if CUST_CACHE.exists() and not refresh:
        rows = [json.loads(l) for l in CUST_CACHE.open(encoding="utf-8") if l.strip()]
        log(f"Migration1 cache: {len(rows)} customers (use --refresh-customers to re-pull)")
        return rows
    log("Pulling Migration1 customers from Shopify (paced)...")
    rows, cursor, page = [], None, 0
    while True:
        page += 1
        d = shopify_gql(env, CUST_Q, {"cursor": cursor})
        if "errors" in d:
            log("Shopify error:", json.dumps(d["errors"])[:400]); break
        conn = d["data"]["customers"]
        for e in conn["edges"]:
            n = e["node"]
            em = norm_email(n.get("email") or (n.get("defaultEmailAddress") or {}).get("emailAddress"))
            rows.append({"id": n["id"], "email": em,
                         "orders": int(n.get("numberOfOrders") or 0),
                         "cpf": digits((n.get("metafield") or {}).get("value"))})
        if page % 10 == 0:
            log(f"  page {page}: {len(rows)} customers")
        if not conn["pageInfo"]["hasNextPage"]:
            break
        cursor = conn["pageInfo"]["endCursor"]
        time.sleep(0.35)
    CUST_CACHE.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    log(f"cached {len(rows)} Migration1 customers -> {CUST_CACHE.name}")
    return rows


# ----------------------------------------------------------------------------
# C. match + build plan (no writes)
# ----------------------------------------------------------------------------
def build_plan(orders, customers):
    by_email = {c["email"]: c for c in customers if c["email"]}
    by_cpf = {c["cpf"]: c for c in customers if c["cpf"]}
    plan, unmatched = [], []
    matched_customers = set()
    match_by = Counter()
    for o in orders:
        c = None; how = None
        if o["email"] and o["email"] in by_email:
            c = by_email[o["email"]]; how = "email"
        elif o["cpf"] and o["cpf"] in by_cpf:
            c = by_cpf[o["cpf"]]; how = "cpf"
        if not c:
            unmatched.append(o); continue
        match_by[how] += 1
        matched_customers.add(c["id"])
        d = parse_date(o["date"])
        plan.append({
            "vnda_id": o["vnda_id"],
            "customer_id": c["id"],
            "customer_prior_orders": c["orders"],
            "match_by": how,
            "order_input": {
                "currency": "BRL",
                "processedAt": processed_at(d, o["hora"]) if d else None,
                "email": o["email"],
                "customer": {"toAssociate": c["id"]},
                "financialStatus": "PAID",
                "tags": [IMPORT_TAG],
                "note": f"Pedido histórico VNDA #{o['vnda_id']} (backfill RFM/Klaviyo)",
                "customAttributes": [{"key": "vnda_pedido", "value": o["vnda_id"]}],
                "lineItems": [{
                    "title": LINE_TITLE,
                    "quantity": 1,
                    "priceSet": {"shopMoney": {"amount": f"{o['total']:.2f}" if o['total'] else "0.00",
                                               "currencyCode": "BRL"}},
                    "requiresShipping": False,
                    "taxable": False,
                }],
            },
            "options": {"sendReceipt": False, "sendFulfillmentReceipt": False,
                        "inventoryBehaviour": "NOT_CLAIMED"},
        })
    return plan, unmatched, matched_customers, match_by


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh-customers", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    if args.apply:
        log("REFUSED: --apply is not implemented. Live import is gated on FullComm exclusion "
            "rule + write_orders scope + Klaviyo guard (see initiative). Dry-run only.")
        sys.exit(2)

    env = load_env()
    log("=" * 68); log("PHASE A — parse VNDA"); log("=" * 68)
    orders = parse_vnda()

    log("\n" + "=" * 68); log("PHASE B — Shopify Migration1 customers"); log("=" * 68)
    customers = pull_customers(env, refresh=args.refresh_customers)

    log("\n" + "=" * 68); log("PHASE C — match + build plan (NO WRITES)"); log("=" * 68)
    plan, unmatched, matched_customers, match_by = build_plan(orders, customers)

    pure_gap = sum(1 for p in plan if p["customer_prior_orders"] == 0)
    PLAN_OUT.write_text("".join(json.dumps(p, ensure_ascii=False) + "\n" for p in plan), encoding="utf-8")
    UNMATCHED_OUT.write_text("".join(json.dumps(u, ensure_ascii=False) + "\n" for u in unmatched), encoding="utf-8")

    log(f"\nConfirmed VNDA orders:            {len(orders)}")
    log(f"Migration1 customers (cache):     {len(customers)}")
    log(f"Orders matched -> importable:     {len(plan)}  (by email={match_by['email']}, by cpf={match_by['cpf']})")
    log(f"Distinct customers enriched:      {len(matched_customers)}")
    log(f"  of which currently 0 orders:    {pure_gap}  (pure gap-fill)")
    log(f"Orders unmatched (not Migration1):{len(unmatched)}")
    log(f"\nPlan      -> {PLAN_OUT}")
    log(f"Unmatched -> {UNMATCHED_OUT}")
    log("\n--- sample proposed orderCreate payloads (first 3) ---")
    for p in plan[:3]:
        log(json.dumps(p["order_input"], ensure_ascii=False, indent=2))
    log("\n[dry run] zero writes performed.")


if __name__ == "__main__":
    main()
