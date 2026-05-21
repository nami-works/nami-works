# Handover — Hexagon integration: orders are missing the right `deliveryMethod.methodType`

**For:** Hexagon integration team
**From:** CPG Labs (Lucas / GE Beauty)
**Date:** 2026-05-18
**Severity:** High — orders meant for in-store pickup AND for local-delivery are both arriving in Shopify with `methodType=SHIPPING`, which is the value reserved for courier shipping. This breaks downstream routing.

> **Scope note (2026-05-18 update):** the diagnosis below originally covered only pickup orders (`#80669`). We've since confirmed the SAME bug affects local-delivery orders too (`#80841`). The fix shape is the same for both — only the target `methodType` value differs. See the "Local-delivery orders" appendix at the bottom of this doc for the local-delivery-specific reference.

---

## TL;DR

When Hexagon posts an order to Shopify that the customer chose to pick up in-store, the order arrives in Shopify configured as a **shipping** order, not a **pickup** order. From Shopify's data model perspective it's indistinguishable from a courier-delivery order, so our downstream systems (local-delivery auto-assign, Lalamove dispatcher) pick it up and create real courier requests for items that were meant to be collected at the counter.

The fix is a small set of changes in the order-creation payload Hexagon sends to Shopify. **Three fields need to change** + one needs to be removed.

---

## Concrete example — order #80669

This order was posted by Hexagon on 2026-05-16. The customer (Eliana da Nobrega) selected pickup at **Loja GE Beauty no Shops Jardins** during the WhatsApp checkout flow. Hexagon's custom-attribute payload reflects her intent:

```
shipping_additional_delivery_method_type = "PICKUP"
shipping_additional_location_id          = "97784398144"
shipping_additional_location_name        = "Shops Jardins"
```

…BUT the actual Shopify order ended up looking like this:

```jsonc
{
  "shippingAddress": {
    "address1": "Alameda Sarutaiá, 73",
    "address2": "Apto 86, Jardim Paulista",
    "city": "São Paulo",
    "zip": "01403-010"
  },
  "shippingLines": [{
    "title": "Retirada na loja - Shops Jardins",
    "code":  "pickup-shops-jardins",
    "source": "shopify",
    "price": "0.00"
  }],
  "fulfillmentOrders": [{
    "assignedLocation": { "name": "Shops Jardins" },
    "destination": {
      "address1": "Alameda Sarutaiá, 73",
      "city": "São Paulo",
      "zip": "01403-010"
    },
    "deliveryMethod": {
      "methodType": "SHIPPING"             // ← THE CORE BUG
    }
  }]
}
```

Shopify reads `deliveryMethod.methodType = "SHIPPING"` and treats this as a courier-delivery order regardless of what the shipping-line title or custom attributes say. The customer's home address sits on the fulfillment order's `destination`, which is the field every delivery integration (ours, Shopify Shipping, third parties) reads to know "where do we deliver this?"

## Reference — what a native pickup order looks like

Compare against **#80702**, which was placed natively via Shopify's web checkout the next day with the customer selecting Shopping Recife pickup:

```jsonc
{
  "shippingAddress": null,                  // ← order-level address is NULL
  "shippingLines": [{
    "title": "Shopping Recife",             // ← just the location name
    "code":  "Shopping Recife",
    "source": "shopify",
    "price": "0.00"
  }],
  "fulfillmentOrders": [{
    "assignedLocation": { "name": "Shopping Recife" },
    "destination": {                        // ← every field is null
      "firstName": null, "lastName": null, "phone": null,
      "address1": null, "city": null, "zip": null
    },
    "deliveryMethod": {
      "methodType": "PICK_UP"               // ← the correct enum value
    }
  }]
}
```

Three structural differences:
1. **`fulfillmentOrders[0].deliveryMethod.methodType`** is `"PICK_UP"` (with underscore), not `"SHIPPING"`.
2. **`fulfillmentOrders[0].destination`** is an object of all-null fields, not the customer's home address.
3. **Order-level `shippingAddress`** is `null` — the order itself isn't being shipped anywhere.

---

## Side-by-side reference table

| Field | Wrong (Hexagon #80669) | Correct (native #80702) | Notes |
|---|---|---|---|
| `fulfillmentOrders[0].deliveryMethod.methodType` | `"SHIPPING"` | `"PICK_UP"` | **Primary fix.** This is what Shopify and downstream systems read. |
| `fulfillmentOrders[0].destination.address1` | `"Alameda Sarutaiá, 73"` | `null` | All destination subfields must be `null` for pickup. |
| `fulfillmentOrders[0].destination.city` | `"São Paulo"` | `null` | |
| `fulfillmentOrders[0].destination.zip` | `"01403-010"` | `null` | |
| Order-level `shippingAddress` | customer's home | `null` | |
| `shippingLines[0].title` | `"Retirada na loja - Shops Jardins"` | `"Shops Jardins"` | Cosmetic — but matches native convention if changed. |
| `shippingLines[0].code` | `"pickup-shops-jardins"` | `"Shops Jardins"` | Same — Shopify's native pickup uses location name verbatim. |
| `tags` (only the bit relevant here) | `"PICKUP"` | `"PICK_UP"` | Underscore vs no-underscore. Doesn't affect routing but downstream filters may mismatch. |
| `customer.email`, `customer.phone` | populated | populated | unchanged — pickup orders still need a customer for the notification email. |

---

## The fix — what to change in your order-creation payload

If you're using **Shopify's REST Admin API** (`POST /admin/api/{version}/orders.json`):

```jsonc
// BEFORE (current Hexagon payload, simplified)
{
  "order": {
    "customer": { ... },
    "line_items": [ ... ],
    "shipping_address": {
      "address1": "Alameda Sarutaiá, 73",
      "city": "São Paulo",
      ...
    },
    "shipping_lines": [{
      "title": "Retirada na loja - Shops Jardins",
      "code": "pickup-shops-jardins",
      "price": "0.00"
    }]
  }
}
```

```jsonc
// AFTER (corrected)
{
  "order": {
    "customer": { ... },
    "line_items": [ ... ],
    "shipping_address": null,
    "fulfillments": [{
      "location_id": 97784398144,                  // Shops Jardins
      "delivery_method": { "method_type": "pick_up" }
    }],
    "shipping_lines": [{
      "title": "Shops Jardins",
      "code":  "Shops Jardins",
      "price": "0.00",
      "source": "shopify"
    }]
  }
}
```

If you're using the **GraphQL Admin API** (`orderCreate` mutation):

```graphql
mutation CreateNativePickup($order: OrderCreateOrderInput!) {
  orderCreate(order: $order) {
    order {
      id
      fulfillmentOrders(first: 1) {
        nodes {
          deliveryMethod { methodType }
          destination { address1 }
        }
      }
    }
    userErrors { field message }
  }
}
```

Variables:
```jsonc
{
  "order": {
    "lineItems": [{ "variantId": "gid://shopify/ProductVariant/…", "quantity": 1 }],
    "customer": { "toAssociate": { "id": "gid://shopify/Customer/…" } },
    "shippingAddress": null,
    "fulfillment": {
      "locationId": "gid://shopify/Location/97784398144",
      "deliveryMethod": { "methodType": "PICK_UP" }
    },
    "shippingLines": [{
      "title": "Shops Jardins",
      "code": "Shops Jardins",
      "priceSet": { "shopMoney": { "amount": "0.00", "currencyCode": "BRL" } },
      "source": "shopify"
    }]
  }
}
```

Note for the **GraphQL** variant: `methodType` is an enum, value is `PICK_UP` (uppercase with underscore). For the **REST** variant, the equivalent JSON value is the string `"pick_up"` (lowercase).

---

## Location IDs at GE Beauty (for the `location_id` / `locationId` field)

| Location | Numeric ID (REST) | GID (GraphQL) |
|---|---|---|
| Loja GE Beauty no Shops Jardins | `97784398144` | `gid://shopify/Location/97784398144` |
| Quiosque GE Beauty no Shopping RioSul | `101298569536` | `gid://shopify/Location/101298569536` |
| Quiosque GE Beauty no Shopping Recife | `97397014848` | `gid://shopify/Location/97397014848` |

(Hexagon already has the right numeric ID in `shipping_additional_location_id` — just needs to use it on the `fulfillment.location_id` field instead of attaching it as a custom attribute.)

---

## Verification — how to confirm a corrected order

After Hexagon posts a test pickup order, the team can verify by either:

**Option A — GraphQL spot-check** (run as a query in Shopify Admin > Apps > GraphiQL or via API):

```graphql
query {
  order(id: "gid://shopify/Order/<NEW_ORDER_ID>") {
    name
    shippingAddress { address1 }   # should be null
    fulfillmentOrders(first: 1) {
      nodes {
        deliveryMethod { methodType }    # should be PICK_UP
        destination { address1 }         # should be null
        assignedLocation { name }        # should match the pickup location
      }
    }
  }
}
```

Expected output:
- `shippingAddress` → `null`
- `fulfillmentOrders.nodes[0].deliveryMethod.methodType` → `"PICK_UP"`
- `fulfillmentOrders.nodes[0].destination.address1` → `null`
- `fulfillmentOrders.nodes[0].assignedLocation.name` → the pickup store

**Option B — Admin UI check:**
- Open the order in Shopify Admin
- The order's "Fulfillment" section should read **"Pickup at <location name>"**, not "Shipping to <address>"
- The customer-facing email Shopify sends should be the "Your order is ready for pickup" template, not the "Your order has shipped" template

---

## Open questions / next steps for both teams

1. **How many historical Hexagon orders are affected?** As of the audit window we checked (last 60 days), 17 orders at Shops Jardins came from Hexagon's source ID and have `methodType=SHIPPING`. Some of them may have been genuine deliveries the customer wanted couriered to their home (those should stay `SHIPPING`). Others were intended-as-pickup and got mis-classified. To distinguish, look at the order's `customAttributes.shipping_additional_delivery_method_type`:
   - `= "PICKUP"` → customer chose pickup; Shopify-side should be `PICK_UP` but isn't = bug
   - `= "DELIVERY"` (or similar) → customer chose delivery; current behavior is correct

2. **Backfill question for Lucas**: do we want to retro-fix the in-flight Hexagon-pickup orders (rewrite their `shippingAddress` to null and re-create the fulfillment as `PICK_UP`), or just accept that historical orders stay as-is and only new ones are correct? Some are already fulfilled at Shops Jardins as pickups (the store knew it was pickup despite Shopify's data) and rewriting could confuse downstream reports.

3. **Tag normalization** (low priority): Hexagon currently writes `"PICKUP"` and `"DELIVERY"` as tags; native uses `"PICK_UP"`. Aligning to underscore form means our auto-assign skip-list and other tag-based filters work uniformly. Not blocking, but worth a one-line change on Hexagon's side.

---

## Contacts

- CPG Labs: Lucas Guimarães (`lucas@nami.works`)
- This document lives in the cpg-labs repo at `docs/handover-hexagon-pickup-fix.md` — update it in place if anything changes during the fix rollout.

---

## Appendix — local-delivery orders (added 2026-05-18)

Same bug shape applies to local-delivery orders. We compared `#80841` (Hexagon, intended local-delivery) against `#80835` (native online-store local-delivery, same Shops Jardins location, same day).

### What's wrong on the Hexagon local-delivery order

```jsonc
{
  "shippingLines": [{
    "title": "Entrega local - Shops Jardins",
    "code":  "local-shops-jardins",
    "source": "shopify"
  }],
  "fulfillmentOrders": [{
    "assignedLocation": { "name": "Shops Jardins" },
    "destination": {
      "address1": "Rua Nelson Gama de Oliveira, 143",
      "address2": "301, Vila Andrade",
      "city": "São Paulo"
    },
    "deliveryMethod": {
      "methodType": "SHIPPING",           // ← WRONG — should be "LOCAL"
      "additionalInformation": { "phone": null }   // ← also wrong — should carry driver-contact phone
    }
  }]
}
```

### What a native local-delivery looks like

```jsonc
{
  "shippingLines": [{
    "title": "Local Delivery",            // ← native uses generic title
    "code":  "Local Delivery",
    "source": "shopify"
  }],
  "fulfillmentOrders": [{
    "assignedLocation": { "name": "Shops Jardins" },
    "destination": {                      // ← destination IS populated (correct for local-delivery)
      "address1": "Rua Tabajaras, 100",
      "phone": "11975445904"
    },
    "deliveryMethod": {
      "methodType": "LOCAL",              // ← correct enum value
      "additionalInformation": {
        "phone": "11975445904"            // ← driver-contact phone populated
      }
    }
  }]
}
```

### Local-delivery diff table

| Field | Wrong (Hexagon #80841) | Correct (native #80835) | Notes |
|---|---|---|---|
| `fulfillmentOrders[0].deliveryMethod.methodType` | `"SHIPPING"` | `"LOCAL"` | **Primary fix.** Same shape as the pickup bug, different correct value. |
| `fulfillmentOrders[0].deliveryMethod.additionalInformation.phone` | `null` | `"11975445904"` (recipient phone) | Native populates the recipient phone here so the driver can call ahead. |
| `fulfillmentOrders[0].destination` | populated with customer address ✓ | populated with customer address ✓ | Correct for local-delivery — driver needs the destination address. UNLIKE pickup (where this must be null). |
| Order-level `shippingAddress` | populated ✓ | populated ✓ | Same — correct for local-delivery. |
| `shippingLines[0].title` | `"Entrega local - Shops Jardins"` | `"Local Delivery"` | Cosmetic. Native uses the generic title. |
| `shippingLines[0].code` | `"local-shops-jardins"` | `"Local Delivery"` | Cosmetic. |

### Three fulfillment modes summary (so Hexagon can map correctly)

| Customer intent | `deliveryMethod.methodType` (GraphQL enum) | `delivery_method.method_type` (REST string) | Order-level `shippingAddress` | `fulfillmentOrder.destination` |
|---|---|---|---|---|
| **Shipping / courier** (out-of-city, full delivery) | `SHIPPING` | `"shipping"` | populated (customer address) | populated |
| **Local delivery** (same-city, our Lalamove flow) | `LOCAL` | `"local"` | populated | populated |
| **In-store pickup** | `PICK_UP` | `"pick_up"` | `null` | all fields `null` |

The `customAttributes.shipping_additional_delivery_method_type` field Hexagon already populates correctly captures the customer's intent (`"PICKUP"`, `"DELIVERY"`, `"SHIPPING"`-ish, etc.). The fix is purely to map that intent onto the right Shopify field at order-create time — currently every Hexagon order ends up at `methodType=SHIPPING` regardless of intent.

### Verification for local-delivery

After Hexagon ships the fix, verify a corrected local-delivery order:

```graphql
query {
  order(id: "gid://shopify/Order/<NEW_ORDER_ID>") {
    name
    shippingAddress { address1 }                       # should be populated
    fulfillmentOrders(first: 1) {
      nodes {
        deliveryMethod {
          methodType                                    # should be LOCAL
          additionalInformation { phone }              # should be the recipient phone
        }
        destination { address1 phone }                  # should be the customer's delivery address + phone
      }
    }
  }
}
```
