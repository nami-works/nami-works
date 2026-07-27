# Shopify location-flip — instructions

Move an order's open fulfillment from one Shopify location to another (e.g. warehouse → local store, or local store → warehouse). Self-contained — works against any Shopify Admin GraphQL endpoint (Claude.ai Shopify connector, custom-app admin token, or Shopify CLI).

## When to use

- An order is currently assigned to location A but you want it fulfilled from location B.
- Common cases:
  - **Warehouse → local store**: e.g. CD Extrema can't emit NF-e, so flip the order to a Lalamove-served local store.
  - **Local store → warehouse**: e.g. you flipped an order by mistake and want it back at the warehouse.
  - Reroute between two warehouses (CD A → CD B).

Method type stays as-is — Shopify does NOT change `deliveryMethod.methodType` when you move a FulfillmentOrder. A `SHIPPING` order stays `SHIPPING` after the move.

## Prerequisites

1. **Shopify admin access** with one of these scopes:
   - `write_assigned_fulfillment_orders` (for app-managed fulfillment services), OR
   - `write_merchant_managed_fulfillment_orders` (for manual / Shopify-managed locations).
2. The **target location's GID** (`gid://shopify/Location/<numeric-id>`).
3. The order number (`name`, e.g. `80850`) or its order ID.

The Claude.ai Shopify connector (`mcp__claude_ai_Shopify__graphql_query` + `graphql_mutation`) has the scopes built in. Direct admin tokens may NOT have these scopes by default — verify before relying on them.

## Procedure

### Step 1 — Resolve the FulfillmentOrder GID

Look up the open FulfillmentOrder for the order. Each order can have multiple FOs (one per line-item group / origin location); you only move the OPEN one(s) at the source location.

```graphql
query LookupFO($q: String!) {
  orders(query: $q, first: 5) {
    edges {
      node {
        id
        name
        fulfillmentOrders(first: 20) {
          nodes {
            id
            status
            assignedLocation { location { id name } }
            deliveryMethod { methodType }
          }
        }
      }
    }
  }
}
```

Variables: `{ "q": "name:80850" }`.

From the response, pick the FulfillmentOrder where:
- `status === "OPEN"` (CLOSED/CANCELLED FOs can't be moved).
- `assignedLocation.location.id` matches the SOURCE location you're flipping FROM.

That FO's `id` is the input to step 2.

### Step 2 — Move the FulfillmentOrder

```graphql
mutation Move($id: ID!, $loc: ID!) {
  fulfillmentOrderMove(id: $id, newLocationId: $loc) {
    movedFulfillmentOrder {
      id
      assignedLocation { location { id name } }
    }
    userErrors { field message }
  }
}
```

Variables:
- `id`: the FulfillmentOrder GID from step 1.
- `loc`: the target location GID.

### Step 3 — Verify

The response's `movedFulfillmentOrder.assignedLocation.location.id` should equal the target location GID. `userErrors` should be empty. If `userErrors` is non-empty, the move did NOT happen — read the message.

## GE Beauty location reference

| Location | GID | Numeric ID |
|---|---|---|
| CD Extrema (warehouse, MG) | `gid://shopify/Location/105538257216` | 105538257216 |
| CD Cajamar (warehouse, SP) | `gid://shopify/Location/100984553792` | 100984553792 |
| Shops Jardins (store, SP) | `gid://shopify/Location/97784398144` | 97784398144 |
| RioSul (store, RJ) | `gid://shopify/Location/101298569536` | 101298569536 |
| Shopping Recife (store, PE) | `gid://shopify/Location/97397014848` | 97397014848 |
| RioMar Recife (store, PE) | `gid://shopify/Location/97397047616` | 97397047616 |

## Bulk flip (N orders → same target)

Loop the two-step procedure once per order. Rate-limit at ~5 req/sec to stay under Shopify's leaky bucket.

Python skeleton (drop-in):

```python
import json, urllib.request, time

SHOP_DOMAIN = "ge-beauty-cosmeticos.myshopify.com"
API_VERSION = "2025-01"
ADMIN_TOKEN = "<shop-admin-token-with-write-fulfillment-orders-scope>"

def gql(query, variables):
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(
        f"https://{SHOP_DOMAIN}/admin/api/{API_VERSION}/graphql.json",
        data=body,
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": ADMIN_TOKEN},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())

LOOKUP = """
query($q: String!) {
  orders(query: $q, first: 5) {
    edges { node { name fulfillmentOrders(first: 20) {
      nodes { id status assignedLocation { location { id } } }
    } } }
  }
}
"""

MOVE = """
mutation($id: ID!, $loc: ID!) {
  fulfillmentOrderMove(id: $id, newLocationId: $loc) {
    movedFulfillmentOrder { id assignedLocation { location { id } } }
    userErrors { field message }
  }
}
"""

SOURCE = "gid://shopify/Location/105538257216"  # CD Extrema
TARGET = "gid://shopify/Location/97784398144"   # Shops Jardins
ORDERS = ["80630", "80685", "80731"]            # add more

for name in ORDERS:
    r = gql(LOOKUP, {"q": f"name:{name}"})
    nodes = r["data"]["orders"]["edges"][0]["node"]["fulfillmentOrders"]["nodes"]
    open_at_source = [n for n in nodes
                      if n["status"] == "OPEN"
                      and n["assignedLocation"]["location"]["id"] == SOURCE]
    for fo in open_at_source:
        m = gql(MOVE, {"id": fo["id"], "loc": TARGET})
        errs = m["data"]["fulfillmentOrderMove"]["userErrors"]
        ok = m["data"]["fulfillmentOrderMove"]["movedFulfillmentOrder"]["assignedLocation"]["location"]["id"] == TARGET
        print(f"  #{name} fo={fo['id'][-12:]} ok={ok} errs={errs}")
    time.sleep(0.2)
```

## Gotchas (real, from prod incidents)

- **CLOSED FOs can't be moved.** When you move an OPEN FO, Shopify CLOSES the old one and creates a new OPEN one at the target. The old CLOSED FO sticks around in `order.fulfillmentOrders` forever. Filter by `status === "OPEN"` when looking up.
- **An order can have multiple OPEN FOs.** A single order with mixed line items can have one FO per source location. The lookup query returns ALL of them — move each one you care about.
- **methodType doesn't change.** A `SHIPPING`-type order moved to a local store stays `SHIPPING`. Any downstream UI that filters on methodType (e.g. "show me LOCAL orders") will continue to exclude it unless that UI explicitly opts to include `SHIPPING` (e.g. via an "Include warehouse orders" toggle).
- **Already-fulfilled orders.** If a fulfillment has been created on the FO, the FO is closed and can't be moved. You'd need to cancel the fulfillment first (`fulfillmentCancel`) — but that's destructive and sends signals to the customer.
- **No NF-e auto-sync.** Moving the FO does NOT touch Omie, the carrier service, or any other downstream integration. If the warehouse had already issued NF-e from the source location, that NF-e stays issued — your fiscal team needs to cancel it separately in Omie.
- **Idempotent re-runs are safe.** If you re-run the move with an FO that's already at the target, Shopify returns the same shape with `assignedLocation.location.id` equal to the target — no error, no double-move.

## Reverse the flip

Same procedure with SOURCE and TARGET swapped. Use the new OPEN FO (the one Shopify created when you flipped originally), NOT the old CLOSED one.

## Reference incident: 2026-05-19 CD Extrema fiscal hold

CD Extrema lost SEFAZ NF-e emission authorization (code 781 "Emissor não habilitado"). 19 orders bound for São Paulo (11) and Rio de Janeiro (8) were flipped from CD Extrema to Shops Jardins / RioSul respectively, then dispatched via Lalamove same-day. The other ~250 stuck orders waited at Extrema for the fiscal authorization to be reinstated.
