# Response to Hexagon questionnaire — Shopify native delivery method

**From:** Lucas / CPG Labs
**To:** Hexagon integration team
**Date:** 2026-05-18
**Re:** `lucas-shopify-native-delivery-method-questionnaire.md`
**Supersedes:** the original `docs/handover-hexagon-pickup-fix.md`, which had the wrong mechanism. See §0.

---

## §0 — Correction to the earlier handover (read this first)

Our earlier handover proposed sending `deliveryMethod.methodType = "PICK_UP"` (or `"LOCAL"`) on the `orderCreate` payload. **That was wrong.** Your team's schema research is correct: neither `OrderCreateOrderInput` nor `OrderCreateFulfillmentInput` exposes `deliveryMethod`/`methodType` at order creation time, and no fulfillment-order or fulfillment-service mutation lets you change the method type post-creation. We re-verified by introspecting the Shopify Admin GraphQL schema directly:

```
OrderCreateFulfillmentInput fields:
  locationId, originAddress, notifyCustomer,
  shipmentStatus, trackingNumber, trackingCompany
  — no `deliveryMethod`, no `methodType`
```

The native `methodType` value (`PICK_UP` / `LOCAL` / `SHIPPING` / `RETAIL` / `PICKUP_POINT` / `NONE`) is set *internally* by Shopify when an order is created through a delivery-method-aware path (web checkout, Cart API, Draft Order completion). One-off `orderCreate` always lands at `SHIPPING` — that's the bug shape we've been seeing on Hexagon orders.

**The viable Admin-API path is `draftOrderCreate` + `draftOrderComplete` with the right `shippingRateHandle`.** Full details in §1–§3 below.

---

## §1 — Working Admin API path

**Path: Draft Order flow with a delivery option handle.**

Four-step sequence:

```
A) Build the cart  →  draftOrderAvailableDeliveryOptions query
                       (returns pickup options + local-delivery rates + shipping rates,
                        each with a `handle`)

B) Pick the handle that matches the customer's chosen delivery method

C) draftOrderCreate mutation with:
     shippingLine.shippingRateHandle = <handle from B>

D) draftOrderComplete mutation
     → Shopify creates the real Order with the correct
       deliveryMethod.methodType derived from the handle
```

Why this works: `PickupInStoreLocation.handle` and `DraftOrderShippingRate.handle` are first-class "delivery option" identifiers in Shopify's data model. When you pass one through `ShippingLineInput.shippingRateHandle` and complete the draft, Shopify resolves the handle into the appropriate fulfillment-order delivery method internally — same machinery that the web checkout uses.

**Have we verified end-to-end on a real GE order?** No. We've verified each piece via schema introspection and Shopify documentation, but we have NOT created a test order through this flow on the GE Beauty production store. We're recommending Hexagon do that verification in your own staging environment as part of the implementation — see §10.

Relevant Shopify documentation:
- `draftOrderAvailableDeliveryOptions` query — https://shopify.dev/docs/api/admin-graphql/latest/queries/draftOrderAvailableDeliveryOptions
- `PickupInStoreLocation` object — https://shopify.dev/docs/api/admin-graphql/latest/objects/PickupInStoreLocation
- `DraftOrderShippingRate` object — https://shopify.dev/docs/api/admin-graphql/latest/objects/DraftOrderShippingRate
- `ShippingLineInput` (note on `shippingRateHandle`) — https://shopify.dev/docs/api/admin-graphql/latest/input-objects/ShippingLineInput
- `draftOrderCreate` mutation — https://shopify.dev/docs/api/admin-graphql/latest/mutations/draftOrderCreate
- `draftOrderComplete` mutation — https://shopify.dev/docs/api/admin-graphql/latest/mutations/draftOrderComplete

---

## §2 — REST payload validation

The REST shape we suggested in the earlier handover (`fulfillments` → `delivery_method.method_type` inside `orders.json`) is **not accepted** by Shopify. The REST `POST /admin/api/{version}/orders.json` `fulfillments` array does not include a `delivery_method` field, and even if you submit it Shopify ignores it. There's no equivalent REST verb for setting the method-type that GraphQL Admin lacks.

Recommendation: skip REST entirely for this flow. Use the GraphQL Draft Order path (§1). The required scope is `write_draft_orders` + `read_draft_orders`.

---

## §3 — GraphQL payload validation

Your team's introspection was correct:
- `OrderCreateFulfillmentInput` — no `deliveryMethod` ✓
- `DraftOrderInput` — no `deliveryMethod` field directly, BUT…
- `DraftOrderInput.shippingLine: ShippingLineInput` accepts `shippingRateHandle` — which IS how you indirectly select the method type
- Fulfillment-order mutations (`fulfillmentOrderMove`, `fulfillmentOrderHold`, `fulfillmentOrderOpen`, etc.) cannot change the method type

So the answer to "is there any GraphQL Admin mutation that can set native fulfillment-order delivery method type at order creation?" is:
- **`orderCreate` — no, cannot.**
- **`draftOrderCreate` + `draftOrderComplete` with a pickup/local handle — YES, indirectly via `shippingLine.shippingRateHandle`.**

---

## §4 — Native pickup contract

For Hexagon pickup orders, the resulting order — once completed via the Draft Order flow — should look like:

- ✅ Order-level `shippingAddress` is `null`
- ✅ `fulfillmentOrders[0].destination` fields are all null
- ✅ `fulfillmentOrders[0].deliveryMethod.methodType = "PICK_UP"`
- ✅ `fulfillmentOrders[0].assignedLocation.location.id` matches the selected pickup store
- ✅ `shippingLines[0].title` ≈ the location name (e.g. `"Shops Jardins"`)
- ✅ `shippingLines[0].code` ≈ the location name (Shopify derives this from the handle)
- ✅ `shippingLines[0].source = "shopify"`
- ℹ️ Tags: the `PICK_UP` / `Shops Jardins` tags are written by GE's Shopify Flow automation based on the resulting `methodType` and `assignedLocation`. **Hexagon does NOT need to write these tags** — Flow handles them. Hexagon can still add its own attribution tags (`hexagon-whatsapp`, `FullComm-…`, `hxo-…` etc.) as it does today; those won't be touched by Flow.
- ✅ Customer email/phone should still be populated for notifications.
- ✅ **Billing address: PRESENT.** GE Beauty requires the billing address for the Brazilian tax-receipt (nota fiscal) regardless of fulfillment type. Pickup orders still need a populated `billingAddress` even when `shippingAddress` is null.

---

## §5 — Native local delivery contract

For Hexagon local-delivery orders, completed via the Draft Order flow:

- ✅ Order-level `shippingAddress` is **populated with the customer's delivery address** (unlike pickup, where it must be null)
- ✅ `fulfillmentOrders[0].destination` populated with the customer's delivery address
- ✅ `fulfillmentOrders[0].deliveryMethod.methodType = "LOCAL"`
- ℹ️ `fulfillmentOrders[0].deliveryMethod.additionalInformation.phone` — populated by Shopify automatically when you use the Draft Order path. Not something you set directly; it's derived from `shippingAddress.phone`. No extra action needed.
- ✅ `fulfillmentOrders[0].assignedLocation.location.id` matches the selected local-delivery store
- ✅ `shippingLines[0].title` = `"Local Delivery"` (Shopify's native title) or whatever your local-delivery rate is named in GE Beauty's settings
- ✅ `shippingLines[0].code` = matches the title (Shopify derives from the handle)
- ✅ `shippingLines[0].source = "shopify"`
- ℹ️ Tags: `LOCAL` and the location name are written by GE's Shopify Flow automation, not by Hexagon. Hexagon's own attribution tags (`hexagon-whatsapp` etc.) continue to work as today.

**Which phone field does CPG Labs / Lalamove actually read?** Verified against the dispatcher code, this is the actual fallback chain:

1. `order.customer.defaultPhoneNumber.phoneNumber` — Shopify's customer-record default phone
2. `order.shippingAddress.phone` — the phone on the order's shipping address
3. `order.customer.phone` — fallback customer phone
4. (final fallback: the store's location phone — used only if all three above are empty)

**Practical implication for Hexagon:** as long as `shippingAddress.phone` is populated (which you already do on local-delivery orders today — see #80841), our dispatcher reaches the driver-contact number correctly. No new field to populate. The `deliveryMethod.additionalInformation.phone` discussion was a red herring on our end — we don't read that field.

---

## §6 — Location and routing requirements

**Location ID mapping (confirmed):**

| Location | Numeric ID | GID |
|---|---|---|
| Loja GE Beauty no Shops Jardins | `97784398144` | `gid://shopify/Location/97784398144` |
| Quiosque GE Beauty no Shopping RioSul | `101298569536` | `gid://shopify/Location/101298569536` |
| Quiosque GE Beauty no Shopping Recife | `97397014848` | `gid://shopify/Location/97397014848` |

**Answers to the policy questions:**

- *Are these the only locations Hexagon should ever assign for GE local/pickup?* — **Yes.** CD Extrema is reserved for courier shipping only; never eligible for local-delivery or pickup.
- *Should local delivery always use the nearest eligible store, or the location encoded in the selected delivery option?* — Use the location encoded in the option the customer selected. Once you call `draftOrderAvailableDeliveryOptions`, Shopify returns only the eligible options for the buyer's address; pick the one the customer chose in WhatsApp.
- *If Shopify returns local delivery but doesn't expose a location ID, what should Hexagon do?* — Each item in `availableLocalDeliveryRates` ties to a specific location via Shopify's Delivery Profile. The handle uniquely identifies which location's rate it is. If you need the location ID explicitly, cross-reference the rate to the store's Delivery Profile setup.
- *Inventory unavailable at the selected location:* **Mirror the web checkout's behavior.** Shopify's online-store front already filters by ZIP and only shows delivery methods for locations with the full inventory for the cart. Hexagon's WhatsApp flow should do the same: only locations that have full inventory for the cart should be offered to the customer as eligible delivery methods. If inventory at the customer's selected location becomes unavailable between option-presentation and order-create, **fail the order push** and surface the issue back into the WhatsApp flow so the customer can re-choose. Do NOT silently reassign to a different store; do NOT bypass inventory.
- *Is CD Extrema only for courier shipping?* — **Yes — confirmed.** Never use CD Extrema for local-delivery or pickup, even as a fallback when GE store inventory is short.

---

## §7 — Payment and fulfillment status requirements

- *Should the order be created as paid immediately?* — **Yes.** Hexagon's WhatsApp flow already confirms payment before pushing to Shopify, so by the time `draftOrderComplete` runs the payment has cleared. Mark the order paid at completion.
- *Should the fulfillment order remain unfulfilled/open?* — **Yes.** Do NOT auto-create a fulfillment object at order time. The fulfillment-order should remain `OPEN` / `UNFULFILLED` until the actual fulfillment event happens (pickup confirmed at the store, or local-delivery driver completes the route).
- *Should `send_receipt` be false?* — **No, keep it `true`.** The customer should receive the standard Shopify "order received" email immediately after order creation. (Hexagon's WhatsApp confirmation does NOT replace this — the Shopify email is the order's official confirmation and the customer expects it.)
- *Should `send_fulfillment_receipt` be false?* — **N/A at order creation time** (since you're not creating a fulfillment at order time per the previous bullet). When the fulfillment is later created (by store staff on pickup, or by our system on local-delivery completion), the customer should get the standard fulfillment email at that point: "Your order is ready for pickup" / "Your delivery is on its way". That's the native customer experience and it's what GE wants. Don't suppress it.
- *Which Shopify / GE Flow automation marks pickup/local orders fulfilled later?*
  - **Local-delivery orders**: our system (CPG Labs) handles the fulfillment automatically once the Lalamove dispatch completes (per the watchdog reconcile pipeline).
  - **Pickup orders**: store staff marks them fulfilled manually in the Shopify admin when the customer collects. No automation today. If/when GE decides to add automation later, it's a separate workstream and doesn't affect what Hexagon ships in this fix.

---

## §8 — Historical orders

**Don't touch historical orders.** Apply the forward fix only.

Rationale:
- The historical Hexagon orders with `methodType=SHIPPING` are already fulfilled (or in flight). The store knew operationally what each order was (pickup vs delivery) regardless of what Shopify's data said.
- Re-classifying fulfilled orders would create finance/reporting noise without operational benefit.
- Affected unfulfilled orders, if any, can be manually corrected case-by-case in the Shopify admin — but this is rare and not worth automating.

So: no CSV needed, no API-side conversion attempt, no recreate/cancel cycle. **Forward fix only.** Every Hexagon order from the day Hexagon ships the Draft Order flow onward should be native-shaped.

---

## §9 — Acceptance criteria — confirmed

The acceptance criteria you proposed are correct, restated with explicit checks:

**Pickup order created by Hexagon (after fix):**
- ✅ `deliveryMethod.methodType = "PICK_UP"`
- ✅ Order-level `shippingAddress = null`
- ✅ Fulfillment destination — all fields null
- ✅ Assigned location matches selected pickup store
- ✅ Order remains unfulfilled until GE/store action
- ✅ Our local-delivery dispatcher (CPG Labs) sees `methodType="PICK_UP"` and skips it (no Lalamove dispatch ever attempted)

**Local delivery order created by Hexagon (after fix):**
- ✅ `deliveryMethod.methodType = "LOCAL"`
- ✅ `shippingAddress` + `fulfillmentOrders[0].destination` both populated with customer address
- ✅ `shippingAddress.phone` populated (recipient phone — what our dispatcher actually reads; `additionalInformation.phone` will be auto-populated by Shopify on the Draft Order path)
- ✅ Assigned location matches the chosen GE local-delivery store
- ✅ Enters our CPG Labs auto-assign / Lalamove dispatch flow
- ✅ Does NOT enter courier shipping flow (which would route through CD Extrema)

**Courier shipping order created by Hexagon (unchanged):**
- ✅ `deliveryMethod.methodType = "SHIPPING"`
- ✅ Assigned location = CD Extrema (or whichever courier-shipping fulfillment location applies)
- ✅ Existing behavior preserved

---

## §10 — Minimal payload examples

We did NOT create test orders on the GE Beauty production store. The payload shapes below come from Shopify's documentation and our schema introspection. Hexagon should run end-to-end verification in your own staging Shopify store before shipping the fix.

### 10A — Pickup order (paid, native `PICK_UP`)

**Step 1 — Get available pickup options:**

```graphql
query GetPickupOptions {
  draftOrderAvailableDeliveryOptions(
    input: {
      lineItems: [
        { variantId: "gid://shopify/ProductVariant/<id>", quantity: 1 }
      ]
    }
    localPickupCount: 10
  ) {
    availableLocalPickupOptions {
      handle
      locationId
      title
      code
    }
  }
}
```

Response: returns an array of pickup options. Find the one whose `locationId` matches the customer's chosen store (e.g. `"gid://shopify/Location/97784398144"` for Shops Jardins) and capture its `handle`.

**Step 2 — Create the draft:**

```graphql
mutation CreatePickupDraft {
  draftOrderCreate(
    input: {
      lineItems: [
        { variantId: "gid://shopify/ProductVariant/<id>", quantity: 1 }
      ]
      customer: { toAssociate: { id: "gid://shopify/Customer/<id>" } }
      email: "customer@example.com"
      shippingAddress: null
      billingAddress: {
        firstName: "..."  lastName: "..."
        address1: "..."
        city: "..."  province: "São Paulo"
        countryCode: BR  zip: "..."
      }
      shippingLine: {
        shippingRateHandle: "<pickup-handle-from-step-1>"
      }
      # NOTE: GE's Shopify Flow writes the PICK_UP + location tags automatically
      # based on methodType + assignedLocation. Hexagon only adds its own
      # attribution tags here.
      tags: ["hexagon-whatsapp"]
      customAttributes: [
        { key: "hexagon_order_number", value: "HEX-..." }
        { key: "channel", value: "whatsapp" }
      ]
    }
  ) {
    draftOrder { id }
    userErrors { field message }
  }
}
```

**Step 3 — Complete the draft (mark as paid):**

```graphql
mutation CompletePickupDraft {
  draftOrderComplete(id: "gid://shopify/DraftOrder/<id-from-step-2>") {
    draftOrder { id order { id name } }
    userErrors { field message }
  }
}
```

**Step 4 — Verify:**

```graphql
query VerifyPickup {
  order(id: "<order-id-from-step-3>") {
    name
    shippingAddress { address1 }   # expected: null
    fulfillmentOrders(first: 1) {
      nodes {
        deliveryMethod { methodType }       # expected: PICK_UP
        destination { address1 }            # expected: null
        assignedLocation { location { id name } }  # expected: matches step 1
      }
    }
  }
}
```

### 10B — Local-delivery order (paid, native `LOCAL`)

**Step 1 — Get available local-delivery rates:**

```graphql
query GetLocalDeliveryRates {
  draftOrderAvailableDeliveryOptions(
    input: {
      lineItems: [
        { variantId: "gid://shopify/ProductVariant/<id>", quantity: 1 }
      ]
      shippingAddress: {
        firstName: "..."  lastName: "..."
        address1: "..."  city: "São Paulo"  province: "São Paulo"
        countryCode: BR  zip: "01403-010"
      }
    }
  ) {
    availableLocalDeliveryRates {
      handle
      title
      code
      price { amount currencyCode }
      source
    }
  }
}
```

Response: returns one or more local-delivery rates eligible for the buyer's address. Capture the `handle` for the location matching what the customer chose.

**Step 2 — Create the draft:**

```graphql
mutation CreateLocalDeliveryDraft {
  draftOrderCreate(
    input: {
      lineItems: [
        { variantId: "gid://shopify/ProductVariant/<id>", quantity: 1 }
      ]
      customer: { toAssociate: { id: "gid://shopify/Customer/<id>" } }
      email: "customer@example.com"
      shippingAddress: {
        firstName: "..."  lastName: "..."
        phone: "+5511990174099"
        address1: "..."
        city: "São Paulo"  province: "São Paulo"
        countryCode: BR  zip: "..."
      }
      billingAddress: { ... }                # same or different
      shippingLine: {
        shippingRateHandle: "<local-delivery-handle-from-step-1>"
      }
      # NOTE: GE's Shopify Flow writes LOCAL + location tags automatically.
      # Hexagon only adds attribution tags.
      tags: ["hexagon-whatsapp"]
    }
  ) {
    draftOrder { id }
    userErrors { field message }
  }
}
```

**Step 3 — Complete & verify** (same shape as pickup).

Expected verification output:
- `deliveryMethod.methodType` → `"LOCAL"`
- `deliveryMethod.additionalInformation.phone` → the recipient phone (Shopify auto-populates from shippingAddress.phone)
- `destination.address1` → customer's delivery address (NOT null)
- `assignedLocation.location.id` → matches the location encoded in the chosen rate

---

## Implementation notes for Hexagon

1. **Required scopes**: `write_draft_orders`, `read_draft_orders`, plus whatever your app already has for `orderCreate`. You may need to update the app's access scopes in Shopify and have GE re-authorize the app.

2. **The `draftOrderAvailableDeliveryOptions` query is the entry point.** Hexagon's WhatsApp flow likely already knows the customer's address and selected method/location. Use that to drive the query — pass the buyer's `shippingAddress` (for local-delivery) or pass just the line items (for pickup), and Shopify returns the eligible handles.

3. **Filter the options to GE-eligible locations.** When Shopify returns multiple available rates, restrict to the 3 GE locations (see §6 mapping). Anything else is courier-shipping territory and uses the existing path.

4. **Failure modes to handle:**
   - `draftOrderAvailableDeliveryOptions` returns empty `availableLocalPickupOptions` → the cart isn't eligible for pickup at any GE location (likely an inventory issue per §6). Fail back to WhatsApp.
   - `draftOrderAvailableDeliveryOptions` returns empty `availableLocalDeliveryRates` → buyer's address isn't in a GE local-delivery zone. Fail back to WhatsApp.
   - `draftOrderComplete` returns `userErrors` → bubble up. Common cause: inventory was claimed by another order between draft creation and completion.

5. **Sales-channel attribution.** Use `sourceName` on `draftOrderComplete` to tag the order as coming from Hexagon. This preserves your existing analytics.

6. **Existing custom attributes can stay.** Hexagon's `hexagon_order_number`, `channel`, etc. continue to work as `customAttributes` on the draft order — they survive into the completed order.

---

## Summary of contracted changes

| What changes | Who owns it |
|---|---|
| Switch from `orderCreate` to `draftOrderCreate` + `draftOrderComplete` with `shippingRateHandle` | Hexagon |
| Add `draftOrderAvailableDeliveryOptions` lookup step before order creation | Hexagon |
| Ensure `shippingAddress.phone` is populated on local-delivery orders (already done today; Shopify auto-derives `additionalInformation.phone` from it) | Hexagon — already correct |
| Drop `shippingAddress` on pickup orders (set to null) | Hexagon |
| Inventory-filter at delivery-option presentation in WhatsApp | Hexagon |
| Forward-only (no historical CSV / cleanup) | Both sides — agreed |
| Adjust our downstream filters if Hexagon ships native-shape orders | CPG Labs — already correct (we filter on `methodType`) |

If `methodType` becomes correctly populated on Hexagon orders, our system requires zero changes — the existing local-delivery / auto-assign filters already key off `methodType`. The fix lands entirely on Hexagon's side once the Draft Order path is in.

---

## Appendix — Full mutation spec (validated against the live Admin GraphQL schema)

Every GraphQL operation below was validated via Shopify's `validate_graphql_codeblocks` tool against API version 2025-01. Required scopes are listed per operation.

### Required scopes (app config)

Add these to the Hexagon app's access scopes if they aren't already present:

| Scope | Needed for |
|---|---|
| `read_draft_orders` | `draftOrderAvailableDeliveryOptions` query |
| `write_draft_orders` | `draftOrderCreate`, `draftOrderComplete` |
| `read_quick_sale` + `write_quick_sale` | Granted with draft-order scopes — no separate action |
| `read_orders` | Verify final order shape (post-completion) |

After updating the scopes, GE Beauty needs to re-authorize the Hexagon app once for the new scopes to take effect.

---

### Step 1 — Discover available delivery options

The customer's selected method (pickup at Shops Jardins, local-delivery to a specific address, courier shipping) determines which side of this query you call. **Always call this before `draftOrderCreate`** — the `handle` you'll pass to `shippingRateHandle` only exists in this response.

#### 1A. Pickup options

```graphql
query GetPickupOptions(
  $input: DraftOrderAvailableDeliveryOptionsInput!,
  $localPickupCount: Int
) {
  draftOrderAvailableDeliveryOptions(
    input: $input,
    localPickupCount: $localPickupCount
  ) {
    availableLocalPickupOptions {
      handle
      locationId
      title
      code
      source
      instructions
      distanceFromBuyer { value unit }
    }
  }
}
```

**Variables (TypeScript-style):**
```ts
{
  input: {
    lineItems: [
      { variantId: "gid://shopify/ProductVariant/<id>", quantity: 1 },
      // …one entry per cart item
    ]
    // shippingAddress is NOT required for pickup options
  },
  localPickupCount: 10  // returns up to 10 pickup options; default 5
}
```

**Required scopes:** `read_draft_orders`

**What to do with the response:**
- Find the option whose `locationId` matches the GE store the customer chose in WhatsApp (one of the three GIDs in §6).
- Capture that option's `handle` (an opaque string). You'll pass it to step 3 as `shippingLine.shippingRateHandle`.
- If `availableLocalPickupOptions` is empty: the cart isn't eligible for pickup at any GE location (typically because no GE store has full inventory for the cart). Per §6, fail the order push and surface back into WhatsApp.

#### 1B. Local-delivery rates

```graphql
query GetLocalDeliveryRates(
  $input: DraftOrderAvailableDeliveryOptionsInput!
) {
  draftOrderAvailableDeliveryOptions(input: $input) {
    availableLocalDeliveryRates {
      handle
      title
      code
      source
      price { amount currencyCode }
    }
    availableShippingRates {
      handle
      title
      code
      price { amount currencyCode }
    }
  }
}
```

**Variables:**
```ts
{
  input: {
    lineItems: [ /* …same as 1A */ ],
    shippingAddress: {
      firstName: "Customer",
      lastName: "Surname",
      address1: "Rua …",
      address2: "Apto …",
      city: "São Paulo",
      province: "São Paulo",
      countryCode: "BR",
      zip: "01403-010",
      phone: "+5511990174099"
    }
  }
}
```

**Required scopes:** `read_draft_orders`

**What to do with the response:**
- For local-delivery: capture the `handle` from one of the `availableLocalDeliveryRates` matching the location the customer chose.
- For courier shipping: capture the `handle` from `availableShippingRates` (note: courier rates are typically CD Extrema; the existing Hexagon flow already handles this case — no behavior change for shipping).
- If `availableLocalDeliveryRates` is empty for a customer who chose local-delivery: the buyer's address isn't in any GE local-delivery zone. Fail the order push, surface back into WhatsApp.

---

### Step 2 — Create the draft order

```graphql
mutation CreateDraftOrder($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) {
    draftOrder {
      id
      status
      totalPriceSet {
        presentmentMoney { amount currencyCode }
        shopMoney { amount currencyCode }
      }
      shippingLine { title code shippingRateHandle }
    }
    userErrors { field message }
  }
}
```

**Variables — PICKUP order example:**
```ts
{
  input: {
    lineItems: [
      { variantId: "gid://shopify/ProductVariant/<id>", quantity: 1 }
    ],
    customer: {
      toAssociate: { id: "gid://shopify/Customer/<id>" }
      // OR toUpsert: { email: "...", firstName: "...", phone: "..." }
      // if creating a new customer
    },
    email: "customer@example.com",
    // shippingAddress is NULL for pickup
    shippingAddress: null,
    // billingAddress IS populated for nota fiscal compliance
    billingAddress: {
      firstName: "Customer",
      lastName: "Surname",
      company: "<CPF or company tax id>",
      address1: "Rua …",
      city: "São Paulo",
      province: "São Paulo",
      countryCode: "BR",
      zip: "01403-010",
      phone: "+5511990174099"
    },
    shippingLine: {
      shippingRateHandle: "<pickup-handle-from-step-1A>"
    },
    customAttributes: [
      { key: "hexagon_order_number", value: "HEX-MP8SGNJU-549B" },
      { key: "channel", value: "whatsapp" }
      // …all your existing custom attributes carry through unchanged
    ],
    tags: "hexagon-whatsapp"
    // Tag is a single CSV string in DraftOrderInput, not an array.
    // GE's Shopify Flow appends the PICK_UP + location tags later — don't write those here.
  }
}
```

**Variables — LOCAL-DELIVERY order example:**
```ts
{
  input: {
    lineItems: [ /* … */ ],
    customer: { toAssociate: { id: "gid://shopify/Customer/<id>" } },
    email: "customer@example.com",
    // For local-delivery, shippingAddress IS populated with the buyer's delivery address
    shippingAddress: {
      firstName: "Customer",
      lastName: "Surname",
      address1: "Rua …",
      address2: "Apto …",
      city: "São Paulo",
      province: "São Paulo",
      countryCode: "BR",
      zip: "01403-010",
      // shippingAddress.phone is the field our Lalamove dispatcher reads for the
      // recipient. MUST be populated.
      phone: "+5511990174099"
    },
    billingAddress: { /* same shape, may be same as shipping or different */ },
    shippingLine: {
      shippingRateHandle: "<local-delivery-handle-from-step-1B>"
    },
    customAttributes: [ /* …unchanged… */ ],
    tags: "hexagon-whatsapp"
  }
}
```

**Required scopes:** `write_draft_orders`, `read_draft_orders` (plus `write_quick_sale`, `read_quick_sale` which are auto-granted)

**Response handling:**
- On success: capture `data.draftOrderCreate.draftOrder.id` for step 3.
- On `userErrors`: bubble up. Common causes:
  - `shippingLine.shippingRateHandle` doesn't match any handle from step 1 → re-run step 1 (the handle may have expired between option-presentation and create).
  - Inventory unavailable → the cart's items are out of stock at the assigned location between step 1 and now. Fail back to WhatsApp.
  - Customer doesn't exist → use `toUpsert` instead of `toAssociate` in the `customer` field.

---

### Step 3 — Complete the draft (mark as paid)

```graphql
mutation CompleteDraftOrder(
  $id: ID!,
  $paymentGatewayId: ID,
  $sourceName: String
) {
  draftOrderComplete(
    id: $id,
    paymentGatewayId: $paymentGatewayId,
    sourceName: $sourceName
  ) {
    draftOrder {
      id
      order {
        id
        name
        displayFulfillmentStatus
      }
    }
    userErrors { field message }
  }
}
```

**Variables:**
```ts
{
  id: "<draft-order-id-from-step-2>",
  // paymentGatewayId omitted → Shopify records the order as paid via "Manual" gateway.
  // Hexagon's existing custom attributes (payment_additional_method,
  // payment_additional_cc_brand, etc.) preserve the actual payment-instrument
  // detail for reconciliation.
  paymentGatewayId: null,
  // sourceName: pass Hexagon's app handle so orders show as coming from Hexagon
  // in Shopify's source filter. Matches today's behavior where source reads as
  // Hexagon's numeric app ID.
  sourceName: "hexagon"
}
```

**Required scopes:** `write_draft_orders`, `read_draft_orders`, `read_orders`

**Response handling:**
- On success: `data.draftOrderComplete.draftOrder.order.id` is the resulting real Order's GID. `displayFulfillmentStatus` should be `UNFULFILLED` (per §7).
- On `userErrors`: bubble up. Common causes:
  - Inventory was claimed by another order between draft creation and completion → cart-validation error. Decide whether to retry or fail.
  - The draft was already completed or deleted → idempotency check before retrying.

---

### Step 4 — Verify the result (recommended for the first few orders during rollout)

```graphql
query VerifyOrder($id: ID!) {
  order(id: $id) {
    id
    name
    displayFulfillmentStatus
    shippingAddress { address1 phone }
    shippingLines(first: 5) {
      nodes { title code source }
    }
    fulfillmentOrders(first: 5) {
      nodes {
        assignedLocation { name location { id } }
        destination { address1 phone }
        deliveryMethod {
          methodType
          additionalInformation { phone instructions }
        }
      }
    }
  }
}
```

**Variables:**
```ts
{ id: "<order-id-from-step-3>" }
```

**Required scopes:** `read_orders` (plus several read-only fulfillment / location scopes auto-granted)

**Expected output by order type:**

| Field | Pickup order | Local-delivery order | Shipping order |
|---|---|---|---|
| `displayFulfillmentStatus` | `UNFULFILLED` | `UNFULFILLED` | `UNFULFILLED` |
| `shippingAddress` | `null` | populated (customer address) | populated |
| `fulfillmentOrders[0].assignedLocation.location.id` | selected GE store GID | selected GE store GID | CD Extrema GID |
| `fulfillmentOrders[0].destination.address1` | `null` | customer address | customer address |
| `fulfillmentOrders[0].deliveryMethod.methodType` | **`PICK_UP`** | **`LOCAL`** | **`SHIPPING`** |
| `fulfillmentOrders[0].deliveryMethod.additionalInformation.phone` | `null` (no recipient) | recipient phone (auto-derived) | recipient phone (auto-derived) |

---

### Error-handling pattern (pseudocode)

```
async function createHexagonOrder(cart, customer, choice):
    # Step 1 — discover handles
    options = await gql.query(
        choice.method == "PICKUP" ? GetPickupOptions : GetLocalDeliveryRates,
        { input: build_input(cart, customer, choice) }
    )

    handle = pick_handle_matching_choice(options, choice)
    if !handle:
        # No eligible option for this method+location+cart
        return notify_whatsapp("Inventory unavailable at chosen store. Pick another.")

    # Step 2 — create draft
    draft = await gql.mutation(CreateDraftOrder, {
        input: build_draft_input(cart, customer, choice, handle)
    })
    if draft.userErrors:
        return notify_whatsapp("Order creation failed: " + draft.userErrors[0].message)

    # Step 3 — complete (mark paid)
    completed = await gql.mutation(CompleteDraftOrder, {
        id: draft.draftOrder.id,
        sourceName: "hexagon"
    })
    if completed.userErrors:
        # Could be inventory race; consider one retry
        return notify_whatsapp("Order finalization failed: " + completed.userErrors[0].message)

    order_gid = completed.draftOrder.order.id
    log("Hexagon order created", { gid: order_gid, name: completed.draftOrder.order.name })
    return order_gid
```

---

### Rollout checklist for Hexagon

1. ☐ Update app access scopes (add `read_draft_orders`, `write_draft_orders` if missing)
2. ☐ Have GE re-authorize the app for the new scopes
3. ☐ Implement `GetPickupOptions` / `GetLocalDeliveryRates` queries (step 1)
4. ☐ Replace existing `orderCreate` call with `draftOrderCreate` + `draftOrderComplete` (steps 2 + 3)
5. ☐ Wire the inventory-filter at delivery-option presentation in the WhatsApp flow (§6 decision)
6. ☐ Run `VerifyOrder` for the first 5–10 orders in your staging Shopify store to confirm `methodType` lands correctly
7. ☐ Production rollout — feature flag preferred so you can flip back to `orderCreate` if anything misbehaves
8. ☐ After 24h of clean production orders, GE / CPG Labs validates downstream: local-delivery orders entering CPG Labs' auto-assign correctly, pickup orders skipped by auto-assign, shipping orders unchanged

---

## Contacts

- CPG Labs: Lucas Guimarães — `lucas@nami.works`
- Document path in repo: `docs/hexagon-questionnaire-response.md`
