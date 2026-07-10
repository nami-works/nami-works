"""
Build the store-credit table for the loyalty-sandbox work order.

Per customer (aggregated):
  - Sum 50% of currentSubtotalPriceSet.shopMoney.amount across their
    in-scope stuck orders.
  - Delay (days) = today - oldest in-scope order createdAt date.
  - Reason: 'Atraso de envio CD Extrema 2026-05' + order numbers.

In-scope = orders fulfilled at CD Extrema, placed <= 2026-05-15 18:00 BRT,
which is the set we already tagged with fiscal-hold-extrema-2026-05.

Writes a markdown table that pastes directly into the work-order's
## Request section.
"""
import json
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from collections import defaultdict

ENV_PATH = Path(__file__).resolve().parents[2] / "gebeauty" / ".env"
TODAY_UTC = datetime(2026, 5, 19, tzinfo=timezone.utc)
BRT = timezone(timedelta(hours=-3))


def load_env(path):
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def shopify_graphql(domain, version, token, query, variables):
    url = f"https://{domain}/admin/api/{version}/graphql.json"
    body = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


env = load_env(ENV_PATH)
domain = env["SHOPIFY_SHOP_DOMAIN"]
version = env.get("SHOPIFY_API_VERSION", "2025-01")
token = env["SHOPIFY_ADMIN_ACCESS_TOKEN"]

# Step 1: load in-scope order names from the daily breakdown JSON.
breakdown = json.loads((Path(__file__).parent / "_extrema_daily_breakdown.json").read_text(encoding="utf-8"))
in_scope_names = set()
for day, buckets in breakdown["by_day"].items():
    items = buckets.get("stuck", []) + buckets.get("flipped", [])
    if day < "2026-05-15":
        for o in items:
            in_scope_names.add(o["name"])
    elif day == "2026-05-15":
        for o in items:
            ts = datetime.strptime(o["createdAt_brt"], "%Y-%m-%d %H:%M").replace(tzinfo=BRT)
            if ts.hour < 18:
                in_scope_names.add(o["name"])
print(f"In-scope order names: {len(in_scope_names)}")

# Step 2: fetch each order's subtotal + customer info.
# Use orders query by name list (one page = up to 50 orders via name OR clause).
def chunk(seq, n):
    seq = list(seq)
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


gql = """
query GetOrders($q: String!, $first: Int!, $after: String) {
  orders(query: $q, first: $first, after: $after) {
    edges {
      cursor
      node {
        id
        name
        createdAt
        email
        customer { id email displayName }
        currentSubtotalPriceSet { shopMoney { amount currencyCode } }
        currentTotalPriceSet { shopMoney { amount currencyCode } }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""

orders_by_name = {}
for batch in chunk(sorted(in_scope_names), 25):
    q = " OR ".join(f"name:{n}" for n in batch)
    cursor = None
    while True:
        resp = shopify_graphql(domain, version, token, gql, {"q": q, "first": 50, "after": cursor})
        if "errors" in resp:
            print("Shopify error:", resp["errors"], file=sys.stderr); sys.exit(1)
        for e in resp["data"]["orders"]["edges"]:
            n = e["node"]
            if n["name"] in in_scope_names:
                orders_by_name[n["name"]] = n
        info = resp["data"]["orders"]["pageInfo"]
        if not info.get("hasNextPage"):
            break
        cursor = info.get("endCursor")
    print(f"  batch fetched -> total resolved {len(orders_by_name)}/{len(in_scope_names)}")

print(f"Resolved orders: {len(orders_by_name)}")

# Step 3: aggregate by customer.
by_customer = defaultdict(lambda: {
    "customer_id": None, "email": None, "displayName": None,
    "orders": [], "credit_amount": 0.0, "subtotal_total": 0.0,
    "oldest_createdAt": None, "currency": "BRL",
})
for name, o in orders_by_name.items():
    customer = o.get("customer") or {}
    cid = customer.get("id")
    email = customer.get("email") or o.get("email")
    if not cid:
        print(f"  WARNING: order {name} has no customer.id (guest)")
        continue
    sub = float(o["currentSubtotalPriceSet"]["shopMoney"]["amount"])
    currency = o["currentSubtotalPriceSet"]["shopMoney"]["currencyCode"]
    rec = by_customer[cid]
    rec["customer_id"] = cid
    rec["email"] = email
    rec["displayName"] = customer.get("displayName")
    rec["currency"] = currency
    rec["orders"].append({"name": name, "subtotal": sub, "createdAt": o["createdAt"]})
    rec["subtotal_total"] += sub
    rec["credit_amount"] += sub * 0.5
    dt = datetime.fromisoformat(o["createdAt"].replace("Z", "+00:00"))
    if rec["oldest_createdAt"] is None or dt < rec["oldest_createdAt"]:
        rec["oldest_createdAt"] = dt

print(f"Unique customers: {len(by_customer)}")

# Step 4: render markdown table for the work-order Request section.
rows = []
for cid, rec in by_customer.items():
    days = (TODAY_UTC - rec["oldest_createdAt"].astimezone(timezone.utc)).days
    order_list = ",".join(f"#{o['name']}" for o in sorted(rec["orders"], key=lambda x: x["name"]))
    rows.append({
        "customer_id": cid,
        "email": rec["email"] or "",
        "name": rec["displayName"] or "",
        "orders": order_list,
        "subtotal_total": rec["subtotal_total"],
        "credit_amount": rec["credit_amount"],
        "delay_days": days,
        "currency": rec["currency"],
    })

# Sort: oldest delay first.
rows.sort(key=lambda r: (-r["delay_days"], r["email"]))

total_credit = sum(r["credit_amount"] for r in rows)
total_subtotal = sum(r["subtotal_total"] for r in rows)

# Write the markdown table to a file.
out = Path(__file__).parent / "_extrema_credit_table.md"
lines = []
lines.append(f"| Customer (id) | Email | Order(s) | Subtotal | Credit (50%) | Delay (days) |")
lines.append(f"|---|---|---|---|---|---|")
for r in rows:
    short_cid = r["customer_id"].replace("gid://shopify/Customer/", "")
    lines.append(f"| {short_cid} | {r['email']} | {r['orders']} | R$ {r['subtotal_total']:.2f} | R$ {r['credit_amount']:.2f} | {r['delay_days']} |")
lines.append(f"| **TOTAL** | | {sum(len(r['orders'].split(',')) for r in rows)} orders | R$ {total_subtotal:.2f} | R$ {total_credit:.2f} | |")
out.write_text("\n".join(lines), encoding="utf-8")

# Also write JSON (loyalty-sandbox may prefer programmatic input).
out_json = Path(__file__).parent / "_extrema_credit_payload.json"
out_json.write_text(json.dumps({
    "policy": "50% of currentSubtotalPriceSet, aggregated per customer",
    "currency": "BRL",
    "memo": "Crédito por atraso de envio. Pedimos desculpas pelo transtorno.",
    "tag_segment": "fiscal-hold-extrema-2026-05",
    "totals": {
        "customers": len(rows),
        "orders": sum(len(r["orders"].split(",")) for r in rows),
        "subtotal_total_brl": round(total_subtotal, 2),
        "credit_total_brl": round(total_credit, 2),
    },
    "credits": [
        {
            "customer_id": r["customer_id"],
            "email": r["email"],
            "displayName": r["name"],
            "order_names": r["orders"].split(","),
            "subtotal_brl": round(r["subtotal_total"], 2),
            "credit_brl": round(r["credit_amount"], 2),
            "delay_days": r["delay_days"],
        }
        for r in rows
    ],
}, indent=2, ensure_ascii=False), encoding="utf-8")

print()
print(f"Customers: {len(rows)}")
print(f"Orders covered: {sum(len(r['orders'].split(',')) for r in rows)}")
print(f"Sum of subtotals: R$ {total_subtotal:.2f}")
print(f"Sum of credits (50%): R$ {total_credit:.2f}")
print()
print(f"Markdown table -> {out}")
print(f"JSON payload   -> {out_json}")
