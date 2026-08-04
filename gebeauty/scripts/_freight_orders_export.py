"""Bulk-export last-12mo orders for the free-shipping-threshold study.

Flat per-order JSONL (no nested connections) with the fields the freight model
needs: destination CEP+UF, net merch subtotal (nf value), real weight, shipping
actually charged, channel/source, and cancel/test flags for filtering.

Writes freight_orders_raw.jsonl next to this script. Read-only on the store.
"""
import json, os, time, urllib.request
from pathlib import Path
from datetime import date, timedelta
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
SHOP = os.environ.get("SHOPIFY_SHOP_DOMAIN", "ge-beauty-cosmeticos.myshopify.com")
VER = os.environ.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{SHOP}/admin/api/{VER}/graphql.json"
OUT = Path(__file__).resolve().parent / "freight_orders_raw.jsonl"

end = date.today()
start = end - timedelta(days=365)
QUERY_FILTER = f"created_at:>={start.isoformat()} created_at:<={end.isoformat()}"

BULK = """
mutation {
  bulkOperationRunQuery(
    query: \"\"\"
    {
      orders(query: "%s") {
        edges { node {
          id name createdAt test cancelledAt
          displayFinancialStatus displayFulfillmentStatus
          sourceName
          app { name }
          channelInformation { channelDefinition { handle channelName } }
          currentSubtotalPriceSet { shopMoney { amount } }
          currentTotalPriceSet { shopMoney { amount } }
          currentShippingPriceSet { shopMoney { amount } }
          totalWeight
          shippingAddress { zip provinceCode city country }
        } }
      }
    }
    \"\"\"
  ) {
    bulkOperation { id status }
    userErrors { field message }
  }
}
""" % QUERY_FILTER


def gql(q):
    b = json.dumps({"query": q}).encode()
    r = urllib.request.Request(URL, data=b, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(r, timeout=90).read())


def main():
    print(f"Window: {start} .. {end}")
    r = gql(BULK)
    ue = r["data"]["bulkOperationRunQuery"]["userErrors"]
    if ue:
        print("userErrors:", ue); return
    print("started:", r["data"]["bulkOperationRunQuery"]["bulkOperation"])

    POLL = '{ currentBulkOperation { id status objectCount url errorCode } }'
    url = None
    while True:
        time.sleep(5)
        c = gql(POLL)["data"]["currentBulkOperation"]
        print("  status:", c["status"], "objects:", c["objectCount"])
        if c["status"] in ("COMPLETED", "FAILED", "CANCELED"):
            url = c.get("url"); print("  final:", c); break

    if not url:
        print("no url (empty result or failed)"); return
    urllib.request.urlretrieve(url, OUT)
    n = sum(1 for _ in open(OUT, encoding="utf-8"))
    print(f"wrote {OUT}  ({n} lines)")


if __name__ == "__main__":
    main()
