"""
Export REPEAT buyers (customers with >=2 orders) from Shopify as a Meta-ready
EMAIL,PHONE CSV, to seed a lookalike audience for the travel-size campaign's
ad set B (initiative: gebeauty-paid-media-scale). Read-only. Scratchpad only (PII).
"""

import csv
import json
import time
import urllib.request
from pathlib import Path

OUT = Path(r"C:\Users\LUCASG~1\AppData\Local\Temp\claude\c--claude\630c36fd-0cfc-45b1-9b35-be664f12d11d\scratchpad\ge_repeat_buyers_seed.csv")


def load_env():
    env_path = Path(__file__).resolve().parents[1] / ".env"
    env = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


ENV = load_env()
SHOP = ENV["SHOPIFY_SHOP_DOMAIN"]
TOKEN = ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]
API_VERSION = ENV.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"

QUERY = """
query Repeat($first: Int!, $after: String) {
  customers(first: $first, after: $after, query: "orders_count:>=2") {
    pageInfo { hasNextPage endCursor }
    nodes { email phone numberOfOrders amountSpent { amount } }
  }
}
"""


def graphql(after):
    body = json.dumps({"query": QUERY, "variables": {"first": 250, "after": after}}).encode("utf-8")
    req = urllib.request.Request(
        URL, data=body,
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN},
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    if "errors" in result:
        print("GraphQL errors:", json.dumps(result["errors"])[:500])
    cost = result.get("extensions", {}).get("cost", {}).get("throttleStatus", {})
    if cost.get("currentlyAvailable", 4000) < 400:
        time.sleep(2)
    return result["data"]["customers"]


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    after = None
    rows = 0
    page = 0
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["EMAIL", "PHONE"])
        while True:
            page += 1
            data = graphql(after)
            for n in data["nodes"]:
                email = (n.get("email") or "").strip()
                phone = (n.get("phone") or "").strip()
                if email or phone:
                    w.writerow([email, phone])
                    rows += 1
            if page % 10 == 0:
                print(f"  page={page} repeat_buyers={rows}")
            if not data["pageInfo"]["hasNextPage"]:
                break
            after = data["pageInfo"]["endCursor"]
    print(f"DONE. {rows} repeat buyers (>=2 orders) written to {OUT}")


if __name__ == "__main__":
    main()
