"""Look up Emilia Bretan and dump her Shopify store-credit account history.

Read-only. Resolves the .env from this script's location, not cwd.
"""
import json, sys, urllib.request
from pathlib import Path
from dotenv import load_dotenv
import os

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
SHOP = os.environ.get("SHOPIFY_SHOP_DOMAIN", "ge-beauty-cosmeticos.myshopify.com")
VER = os.environ.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{SHOP}/admin/api/{VER}/graphql.json"


def gql(query, variables=None):
    body = json.dumps({"query": query, **({"variables": variables} if variables else {})}).encode()
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN,
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


SEARCH = """
query FindCustomer($q: String!) {
  customers(first: 10, query: $q) {
    edges { node {
      id
      displayName
      email
      createdAt
      numberOfOrders
      amountSpent { amount currencyCode }
    } }
  }
}
"""

CREDIT = """
query CreditHistory($id: ID!) {
  customer(id: $id) {
    id
    displayName
    email
    storeCreditAccounts(first: 10) {
      edges { node {
        id
        balance { amount currencyCode }
        transactions(first: 100, reverse: true) {
          edges { node {
            __typename
            ... on StoreCreditAccountCreditTransaction {
              amount { amount currencyCode }
              balanceAfterTransaction { amount currencyCode }
              createdAt
              expiresAt
            }
            ... on StoreCreditAccountDebitTransaction {
              amount { amount currencyCode }
              balanceAfterTransaction { amount currencyCode }
              createdAt
            }
            ... on StoreCreditAccountDebitRevertTransaction {
              amount { amount currencyCode }
              balanceAfterTransaction { amount currencyCode }
              createdAt
            }
            ... on StoreCreditAccountExpirationTransaction {
              amount { amount currencyCode }
              balanceAfterTransaction { amount currencyCode }
              createdAt
            }
          } }
        }
      } }
    }
  }
}
"""

q = sys.argv[1] if len(sys.argv) > 1 else "Emilia Bretan"
print(f"=== Searching customers for: {q!r} ===")
r = gql(SEARCH, {"q": q})
if r.get("errors"):
    print("SEARCH ERROR:", json.dumps(r["errors"], indent=2, ensure_ascii=False))
    sys.exit(1)

edges = r["data"]["customers"]["edges"]
if not edges:
    print("No customers matched. Try a different query (email, first name only).")
    sys.exit(0)

for e in edges:
    n = e["node"]
    print(f"  {n['displayName']}  | {n.get('email')}  | {n['id'].rsplit('/',1)[-1]}  "
          f"| orders={n['numberOfOrders']}  spent={n['amountSpent']['amount']} {n['amountSpent']['currencyCode']}")

# Pull credit history for each match (usually just one)
for e in edges:
    cid = e["node"]["id"]
    cr = gql(CREDIT, {"id": cid})
    if cr.get("errors"):
        print("\nCREDIT ERROR for", cid, ":", json.dumps(cr["errors"], indent=2, ensure_ascii=False))
        continue
    c = cr["data"]["customer"]
    accts = c["storeCreditAccounts"]["edges"]
    print(f"\n=== {c['displayName']} ({c.get('email')}) — {len(accts)} store-credit account(s) ===")
    if not accts:
        print("  (no store-credit account — never been issued credit)")
        continue
    for a in accts:
        acc = a["node"]
        print(f"\n  Account {acc['id'].rsplit('/',1)[-1]}  | CURRENT BALANCE: {acc['balance']['amount']} {acc['balance']['currencyCode']}")
        txs = acc["transactions"]["edges"]
        print(f"  {len(txs)} transaction(s) (newest first):")
        for t in txs:
            tx = t["node"]
            typ = tx["__typename"].replace("StoreCreditAccount", "").replace("Transaction", "")
            amt = f"{tx['amount']['amount']} {tx['amount']['currencyCode']}"
            bal = f"{tx['balanceAfterTransaction']['amount']} {tx['balanceAfterTransaction']['currencyCode']}"
            created = tx.get("createdAt", "?")
            exp = tx.get("expiresAt")
            line = f"    [{typ:>12}] {amt:>14}  -> balance {bal:>14}  @ {created}"
            if exp:
                line += f"  (expires {exp})"
            print(line)
