"""
B2B Orders Audit — cross-checks history.json against:
  1. Shopify draft orders (by operator name in tags / customer name)
  2. Shopify completed orders (same matching)
  3. Proposal JSON files in deals/ that are not yet in history.json

Run:
  C:/Python314/python.exe sandbox/gebeauty/scripts/_b2b_orders_audit.py
"""
import json, urllib.request, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT  = Path(__file__).resolve().parent
ENV   = ROOT.parent / ".env"

def load_env():
    out = {}
    for line in ENV.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out

cfg   = load_env()
TOKEN = cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]
SHOP  = cfg.get("SHOPIFY_SHOP_DOMAIN", "ge-beauty-cosmeticos.myshopify.com")
VER   = cfg.get("SHOPIFY_API_VERSION", "2026-01")
URL   = f"https://{SHOP}/admin/api/{VER}/graphql.json"

# Known B2B box operators — match by any token in customer/note/tags
OPERATORS = ["UAU Box", "UAUBox", "B4A", "Magenta"]
OP_KEYS   = [o.lower().replace(" ","") for o in OPERATORS]

def graphql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req  = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN,
    })
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))

DRAFT_Q = """
query($cursor: String) {
  draftOrders(first: 50, after: $cursor, sortKey: UPDATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name status
      createdAt updatedAt completedAt
      totalPriceSet { shopMoney { amount } }
      customer { firstName lastName email }
      tags
      lineItems(first: 20) {
        nodes {
          title sku quantity
          originalUnitPriceSet { shopMoney { amount } }
        }
      }
    }
  }
}
"""

ORDERS_Q = """
query($cursor: String, $query: String) {
  orders(first: 50, after: $cursor, sortKey: CREATED_AT, reverse: true, query: $query) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name
      createdAt
      displayFulfillmentStatus
      totalPriceSet { shopMoney { amount } }
      note
      customer { firstName lastName email }
      tags
      lineItems(first: 20) {
        nodes { title sku quantity discountedUnitPriceSet { shopMoney { amount } } }
      }
    }
  }
}
"""

def _haystack(node):
    cust = node.get("customer") or {}
    parts = [
        node.get("name", ""),
        cust.get("firstName", ""),
        cust.get("lastName", ""),
        cust.get("email", ""),
        node.get("note", ""),
        " ".join(node.get("tags") or []),
    ]
    return " ".join(parts).lower().replace(" ", "")

def _matches_operator(node):
    hay = _haystack(node)
    for k in OP_KEYS:
        if k in hay:
            return next(op for op in OPERATORS if op.lower().replace(" ","") == k)
    return None

def fetch_paginated(query, variables, key):
    results, cursor = [], None
    while True:
        v = dict(variables); v["cursor"] = cursor
        data = graphql(query, v)
        if "errors" in data:
            print(f"  [GraphQL error] {data['errors']}")
            break
        conn = data.get("data", {}).get(key, {})
        if not conn:
            print(f"  [No '{key}' in response] {json.dumps(data)[:200]}")
            break
        results.extend(conn.get("nodes", []))
        if not conn.get("pageInfo", {}).get("hasNextPage"):
            break
        cursor = conn["pageInfo"]["endCursor"]
    return results

def load_history():
    p = ROOT / "deals" / "history.json"
    if not p.exists(): return []
    return json.loads(p.read_text(encoding="utf-8-sig")).get("deals", [])

def brl(v):
    try: return f"R${float(v):>10,.2f}".replace(",","X").replace(".",",").replace("X",".")
    except: return str(v)

def fmt_date(iso): return (iso or "")[:10] or "---"

def print_order(label, node, price_field="totalPriceSet"):
    total = node.get(price_field,{}).get("shopMoney",{}).get("amount","?")
    print(f"    {label}  {node.get('name','?'):<8}  {fmt_date(node.get('createdAt'))}  {brl(total)}")
    for li in (node.get("lineItems") or {}).get("nodes", []):
        pset = li.get("originalUnitPriceSet") or li.get("discountedUnitPriceSet") or {}
        prc  = pset.get("shopMoney",{}).get("amount","?")
        sku  = li.get("sku") or "?"
        print(f"      - {sku:<12} {li.get('title','')[:30]:<30}  {li.get('quantity',0):>5} un  @ R${float(prc):.2f}")

def main():
    print("\n-- B2B Orders Audit --------------------------------------------------")

    # 1. history.json summary
    history = load_history()
    hist_ops = set(d.get("operator","") for d in history)
    print(f"\n  history.json — {len(history)} deals registered:")
    for d in history:
        nf = f"NF {d['nf']}" if d.get("nf") else "NF pendente"
        lines = d.get("lines", [])
        vol = sum(l.get("volume",0) for l in lines)
        rev = sum(l.get("volume",0)*l.get("price",0) for l in lines)
        print(f"    · {d.get('id','?'):<25}  {d.get('operator','?'):<12}  {d.get('date','?')}  "
              f"{nf:<15}  {vol:>7,} un  {brl(rev)}  [{d.get('status','?')}]")

    # 2. Shopify draft orders
    print(f"\n  Fetching Shopify draft orders...")
    drafts = fetch_paginated(DRAFT_Q, {}, "draftOrders")
    print(f"  {len(drafts)} draft orders fetched.")
    matched_drafts = [(m, o) for o in drafts if (m := _matches_operator(o))]
    if matched_drafts:
        print(f"\n  Draft orders matching B2B operators ({len(matched_drafts)}):")
        for op, o in matched_drafts:
            print_order(f"[{o['status']:<10}]  {op:<10}", o)
    else:
        print("  No draft orders matched any known B2B operator.")

    # 3. Shopify completed orders — search last 200 by date (most recent)
    print(f"\n  Fetching recent Shopify orders (last 200 by date)...")
    orders = fetch_paginated(ORDERS_Q, {"query": "created_at:>2025-01-01"}, "orders")
    print(f"  {len(orders)} orders fetched.")
    matched_orders = [(m, o) for o in orders if (m := _matches_operator(o))]
    if matched_orders:
        print(f"\n  Orders matching B2B operators ({len(matched_orders)}):")
        for op, o in matched_orders:
            status = o.get("displayFulfillmentStatus", "?")
            print_order(f"[{status:<14}]  {op:<10}", o, "totalPriceSet")
    else:
        print("  No orders matched any known B2B operator by customer/note/tags.")
        print("  (B2B deals made via NF outside Shopify will not appear here.)")

    # 4. Proposal files vs history.json
    print(f"\n  Proposal files in deals/ vs history.json:")
    PROPOSAL_FILES = ["b4a_ago_out_2026.json", "magenta_proposta.json", "uaubox_proposta.json"]
    hist_names_joined = " ".join(
        d.get("id","") + " " + d.get("operator","") for d in history
    ).lower()
    for fname in PROPOSAL_FILES:
        pf = ROOT / "deals" / fname
        if not pf.exists(): continue
        try: spec = json.loads(pf.read_text(encoding="utf-8-sig"))
        except: continue
        name  = spec.get("name", fname)
        lines = spec.get("lines", [])
        vol   = sum(l.get("volume",0) for l in lines)
        rev   = sum(l.get("volume",0)*l.get("price",0) for l in lines)
        # simple keyword match: any word from the file name in history
        keywords = [w.lower() for w in fname.replace("_"," ").replace(".json","").split() if len(w) > 2]
        in_hist = any(k in hist_names_joined for k in keywords)
        tag = "OK - in history" if in_hist else "MISSING from history.json"
        print(f"    {fname:<35}  {vol:>7,} un  {brl(rev)}  [{tag}]")
        if not in_hist:
            print(f"      ^ '{name}' — not registered. Add to history.json if this deal closed.")

    print()

if __name__ == "__main__":
    main()
