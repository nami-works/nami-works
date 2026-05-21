"""
Daily breakdown of CD Extrema orders placed up to last Friday 6PM BRT
(2026-05-15 18:00 BRT = 2026-05-15 21:00 UTC), split by flipped-to-LD
vs. still-at-Extrema.

Reads from Shopify directly so it stays accurate. Read-only.
"""
import json
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from collections import defaultdict

ENV_PATH = Path(r"C:\Users\Lucas Guimarães\Desktop\nami-works\sandbox\gebeauty\.env")

# Cutoff: end of yesterday BRT (2026-05-18 23:59 BRT = 2026-05-19 03:00 UTC).
# Today is Tue 2026-05-19, so this includes everything up to and including Mon.
CUTOFF_UTC = datetime(2026, 5, 19, 3, 0, 0, tzinfo=timezone.utc)
BRT = timezone(timedelta(hours=-3))

# The 19 orders we flipped to LD on 2026-05-19.
FLIPPED_TO_LD = {
    # Shops Jardins (97784398144) — 11 orders
    "80630", "80685", "80731", "80751", "80757", "80784",
    "80875", "80877", "80886", "80887", "80894",
    # RioSul (101298569536) — 8 orders
    "80633", "80703", "80719", "80802", "80809",
    "80838", "80843", "80863",
}


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


def paginate_orders(domain, version, token, q):
    """Run the orders query and return all nodes."""
    gql = """
    query Q($q: String!, $first: Int!, $after: String) {
      orders(query: $q, first: $first, after: $after, sortKey: CREATED_AT) {
        edges {
          cursor
          node {
            id name createdAt
            shippingAddress { city province }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
    """
    out = []
    cursor = None
    while True:
        resp = shopify_graphql(domain, version, token, gql, {"q": q, "first": 100, "after": cursor})
        if "errors" in resp:
            print("Shopify error:", resp["errors"], file=sys.stderr); sys.exit(1)
        for e in resp["data"]["orders"]["edges"]:
            out.append(e["node"])
        info = resp["data"]["orders"]["pageInfo"]
        if not info.get("hasNextPage"):
            break
        cursor = info.get("endCursor")
    return out


env = load_env(ENV_PATH)
domain = env["SHOPIFY_SHOP_DOMAIN"]
version = env.get("SHOPIFY_API_VERSION", "2025-01")
token = env["SHOPIFY_ADMIN_ACCESS_TOKEN"]

# (A) Orders currently UNFULFILLED at CD Extrema (these are the locked ones).
print("Pulling orders currently at CD Extrema...")
locked = paginate_orders(
    domain, version, token,
    "fulfillment_location_id:105538257216 fulfillment_status:unshipped status:open",
)
print(f"  total: {len(locked)}")

# (B) The 19 flipped orders — currently at Shops Jardins (97784398144) or RioSul (101298569536).
# We'll pull both fulfillment locations and filter to the flipped names so we get createdAt.
print("Pulling orders at Shops Jardins + RioSul (to find flipped ones)...")
sj = paginate_orders(
    domain, version, token,
    "fulfillment_location_id:97784398144 fulfillment_status:unshipped status:open",
)
rs = paginate_orders(
    domain, version, token,
    "fulfillment_location_id:101298569536 fulfillment_status:unshipped status:open",
)
all_lds = sj + rs
flipped_orders = [o for o in all_lds if o["name"] in FLIPPED_TO_LD]
print(f"  Shops Jardins: {len(sj)}  RioSul: {len(rs)}  matched-to-flipped: {len(flipped_orders)}/19")

# Compose full set: locked + flipped, tag each with status.
tagged = []
for o in locked:
    tagged.append({**o, "_state": "stuck"})
for o in flipped_orders:
    tagged.append({**o, "_state": "flipped"})

print()
print(f"Combined set: {len(tagged)} orders ({len(locked)} stuck + {len(flipped_orders)} flipped)")

# Apply cutoff: createdAt <= last Friday 6PM BRT.
before_cutoff = []
after_cutoff = []
for o in tagged:
    dt = datetime.fromisoformat(o["createdAt"].replace("Z", "+00:00"))
    if dt <= CUTOFF_UTC:
        before_cutoff.append(o)
    else:
        after_cutoff.append(o)

print(f"Cutoff: {CUTOFF_UTC.astimezone(BRT).strftime('%Y-%m-%d %H:%M %Z')} (= {CUTOFF_UTC.strftime('%Y-%m-%d %H:%M UTC')})")
print(f"  on/before cutoff: {len(before_cutoff)}")
print(f"  after cutoff:     {len(after_cutoff)}")
print()

# Group by day (BRT date), separate flipped vs stuck.
by_day = defaultdict(lambda: {"total": 0, "flipped": 0, "stuck": 0})
for o in before_cutoff:
    dt = datetime.fromisoformat(o["createdAt"].replace("Z", "+00:00")).astimezone(BRT)
    day = dt.strftime("%Y-%m-%d")
    by_day[day]["total"] += 1
    by_day[day][o["_state"]] += 1

# Print table.
print("Daily breakdown (BRT date), orders created on/before 2026-05-15 18:00 BRT:")
print()
print(f"{'Day (BRT)':<13} {'Weekday':<10} {'Total':>6} {'Flipped to LD':>14} {'Stuck at Extrema':>17}")
print(f"{'-'*13} {'-'*10} {'-'*6} {'-'*14} {'-'*17}")
total_orders = 0
total_flipped = 0
total_stuck = 0
for day in sorted(by_day.keys()):
    d = by_day[day]
    weekday = datetime.strptime(day, "%Y-%m-%d").strftime("%A")
    print(f"{day:<13} {weekday:<10} {d['total']:>6} {d['flipped']:>14} {d['stuck']:>17}")
    total_orders += d["total"]
    total_flipped += d["flipped"]
    total_stuck += d["stuck"]
print(f"{'-'*13} {'-'*10} {'-'*6} {'-'*14} {'-'*17}")
print(f"{'TOTAL':<13} {'':<10} {total_orders:>6} {total_flipped:>14} {total_stuck:>17}")
print()

# Also dump the order names per bucket per day for spot-checking.
out = Path(__file__).parent / "_extrema_daily_breakdown.json"
detail = {}
for o in before_cutoff:
    dt = datetime.fromisoformat(o["createdAt"].replace("Z", "+00:00")).astimezone(BRT)
    day = dt.strftime("%Y-%m-%d")
    detail.setdefault(day, {"flipped": [], "stuck": []})
    detail[day][o["_state"]].append({
        "name": o["name"],
        "createdAt_brt": dt.strftime("%Y-%m-%d %H:%M"),
        "city": (o.get("shippingAddress") or {}).get("city"),
    })
out.write_text(json.dumps({
    "cutoff_utc": CUTOFF_UTC.isoformat(),
    "totals": {
        "before_cutoff": len(before_cutoff),
        "after_cutoff": len(after_cutoff),
        "flipped_within_cutoff": total_flipped,
        "stuck_within_cutoff": total_stuck,
    },
    "by_day": detail,
}, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Per-day detail written to {out}")
