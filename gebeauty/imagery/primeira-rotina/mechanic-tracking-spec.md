# Wash-Routine Offer — Mechanic + Tracking Implementation Spec

**Author:** Integrations Engineer (CGO-briefed) · **Date:** 2026-07-23
**Initiative:** [[gebeauty-acquisition-rescue]] · **Guardrail:** CGO #6 (cohort isolation)
**Status:** BUILD-READY spec. Lucas has GIVEN THE GO on the R$95 offer (negative first-order
payback accepted as a strategic LTV bet). **NO store writes are executed by this doc.** Every
mutation below is gated — presented, confirmed with Lucas, then run one at a time.

---

## Offer recap (locked)

Bundle for **R$95 total + free shipping**: Shampoo sem sulfato (001) + Máscara Condicionadora
(002), both full size, **plus a customer-chosen third**: Leave-in travel (011) OR Shampoo a seco
full (008). `compareAtPrice` = full retail sum, struck ("de"). Same offer for acquisition
(LP + checkout upsell) and the rescue email. Isolated aggressive-acquisition cohort.

## Live data pulled (read-only, `gebeauty/.env`, 2026-07-23)

Prices read **only from `productType: product`** variants (HARD price-source rule). The `[rappi]`
duplicates were ignored — note 008 rappi = R$99 vs the real `product` retail R$69, exactly the trap
the rule guards against.

| SKU | Title | productType | Product GID | Variant GID | Retail price | inventoryPolicy |
|---|---|---|---|---|---|---|
| GEB 001 | shampoo sem sulfato | product | 8803151282496 | 47048042086720 | R$95,00 | DENY |
| GEB 002 | máscara condicionadora | product | 8803151184192 | 47048041955648 | R$95,00 | DENY |
| GEB 008 | shampoo a seco (full) | product | 8803145089344 | 47048029897024 | R$69,00 | DENY |
| GEB 011 | leave-in travel size | product | 9613035766080 | 49787120386368 | R$47,00 | DENY |

**Derived compareAtPrice ("de"):**
- Bundle **+ leave-in travel (011)**: 95 + 95 + 47 = **R$237,00** → sells R$95 = **60% off**
- Bundle **+ shampoo a seco (008)**: 95 + 95 + 69 = **R$259,00** → sells R$95 = **63% off**

Confirms the deep-tripwire framing. Definitive per-order economics/CAC ceiling: run
`gebeauty/growth/module-a/offer_breakeven.py` (freight fully borne — free-ship promised).

---

# DELIVERABLE 1 — The offer mechanic

## Options evaluated

| Mechanic | Fixed R$95 total | `compareAtPrice` strike | Gift choice capture | Free shipping | Verdict |
|---|---|---|---|---|---|
| **Fixed-price native bundle product(s)** (`productType: kit`, `productVariantComponents`) | Native — variant `price=95` | Native — variant `compareAtPrice=237/259`, struck on PDP/cart/checkout | Clean — one product per gift (or one product/two variants) | Via Function predicate | **RECOMMENDED** |
| BxGy / custom discount Function | Fragile — Function must compute `(sum − 95)` dynamically; edge cases on qty/variant | No — shows as a discount **line**, not a struck "de" | Function can't express "pick one of two" cleanly | Function can add shipping line | Rejected — brittle + no strike |
| Discount-code family | No — basic codes do fixed-amount/% off, can't pin a variable cart to exactly R$95 | No — discount line, not "de" | No | Combines w/ shipping | Rejected — can't hit fixed total or show strike; also fights single-code rule |
| Fixed-price bundle **product** = the recommended row | — | — | — | — | (same as row 1) |

**The store already proves the winning pattern.** Every existing Kit is a `productType: kit`
product, single `Default Title` variant, `productVariantComponents` = the SKUs, with
`compareAtPrice` set for the "de" strike (e.g. "kit todo dia" 001+002+003, price 273 / cap 289).
This is the Shopify-native bundle path (first-party Bundles app owns the cartTransform;
per memory `bundles-app-owned`, structure is app-managed, **price/compareAtPrice are API-editable**).
We replicate it exactly — zero new mechanism risk.

## Recommendation: TWO fixed-price native bundle products (gift = which product)

Two `kit`-type bundle products, each a fixed bundle, each priced R$95:

```
Kit Rotina de Lavagem + Leave-in travel     Kit Rotina de Lavagem + Shampoo a seco
  price 95,00   compareAt 237,00              price 95,00   compareAt 259,00
  components: 001 x1, 002 x1, 011 x1          components: 001 x1, 002 x1, 008 x1
  productType: kit                            productType: kit
```

**Why two products, not one product / two variants:** every Kit on the store is single-variant
with fixed components. Per-variant *differing* component sets are not demonstrated by the store's
current Bundles tooling, so relying on it would add build risk for no gain. Two products is the
proven, robust shape. Gift choice is captured by **which product** the customer buys — a clean,
queryable signal (product handle → gift) with no line-item-property parsing.

**Gift-choice capture (LP → cart):** the LP gift chooser (already mocked, `lp-offer-mockup.html`)
toggles between the two products. "adicionar à sacola" calls `/cart/add.js` with the chosen
product's variant GID, then routes to checkout. One line item = the bundle; Shopify expands the
three components under the parent at checkout (native bundle display), price R$95, `compareAtPrice`
struck. Line-item attribution to the real SKUs flows through `lineItemGroup` (per memory
`bundle-lineitem-attr`) so Module A still sees 001/002/008/011 sell-through.

### Free shipping vs the existing R$299 Function — DO NOT break the sitewide rule

Free shipping today is a **Function Studio automatic-discount Function** at ≥ R$299
(`apps/function-studio/app/functions/discounts/automatic/1637817647424`), not a native discount and
not a code. A R$95 bundle is sub-threshold, so it would NOT get free shipping by default.

**Recommended: extend that one Function with a bundle-product predicate (single source of truth).**
Add an OR clause to its cart-eligibility logic:

```
grant free shipping IF
    cart subtotal >= R$299            (existing sitewide rule, UNCHANGED)
 OR any cart line's product ∈ { KitRotina+Leavein GID, KitRotina+Aseco GID }   (new)
```

This keeps ONE Function owning all free-shipping logic — no second shipping Function competing, no
risk of the sitewide threshold drifting. The bundle products' GIDs are the only new input.

- **Rejected alt (a):** a *second* free-shipping Function scoped to the bundles — two shipping
  Functions overlap and muddy which one fired; avoid.
- **Rejected alt (b):** an auto-applied free-shipping *code* — trips the single-code default rule
  and needs cart-side application logic; the Function is cleaner and invisible to the shopper.

*(The `function-studio` app source is not in this checkout — it lives in the deploy admin per
CLAUDE.md. The edit is a behavior change: one added predicate + redeploy. This is the ONE step
that requires a Function code change + deploy, not just an Admin API call — flag to whoever owns
the Function deploy.)*

### Price-source rule compliance

The two bundle products are `productType: kit` → automatically **outside** the `product`/`acessorio`
price-source filter, so they will never poison future price reads (same as all existing kits). Keep
them **out of automated markdown/etiqueta sweeps** and **out of public collections** — targeted,
LP-and-upsell-only, exactly like the "ganhe uma necessaire" GWP ("targeted, not publicly
announced"). Publish to the Online Store channel (so `/cart/add.js` works) but assign **no
collection membership** and no `best-seller`/menu tags.

### Checkout upsell (lighter-touch, gift pre-defaulted)

Post-purchase / checkout upsell surface offers the SAME bundle at R$95 as a one-tap add, **gift
pre-defaulted to the leave-in-travel bundle** (lower free-COGS, R$6.21 vs R$11.21; cleaner finisher
default). Lighter touch = no chooser, single "add" button; the customer can still swap on the LP if
they came that way. Because both surfaces resolve to the SAME two products, tracking is identical
regardless of entry point.

- **Surface dependency (FLAG):** GE needs a post-purchase upsell surface (existing upsell app, or a
  Shopify post-purchase / checkout-UI extension). Not confirmed installed — verify at build. If none
  exists, ship LP-only first; the upsell is additive, not blocking.

### LP ↔ checkout de-dup

Single rule, because both surfaces point at the same products:

> **The checkout upsell suppresses itself if the cart/order already contains EITHER bundle product
> (any of the two GIDs).**

So an LP buyer who already added the bundle is never re-offered it; a normal-PDP buyer who didn't
take it still sees the upsell once. The cohort **order tag is applied by an order rule keyed on
"order contains a bundle product," NOT on entry surface** — so LP and upsell orders land in one
queryable cohort automatically, no double-tagging, no surface-specific logic.

## Gated store-write steps (execute later, one confirmation per step)

1. **Create bundle product A — "Kit Rotina de Lavagem · Leave-in travel"** (`productType: kit`,
   status ACTIVE, tags `bundle,kits,cohort-wash-rotina` — no collection tags). Add components
   001 x1 + 002 x1 + 011 x1 via the same Bundles app path the existing Kits use. Set
   `price = 95.00`, `compareAtPrice = 237.00` via Admin API (`productVariantsBulkUpdate`).
2. **Create bundle product B — "Kit Rotina de Lavagem · Shampoo a seco"** (same settings).
   Components 001 x1 + 002 x1 + 008 x1. `price = 95.00`, `compareAtPrice = 259.00`.
3. **Verify component links** on both: `productVariantComponents` count must be 3, not 0
   (memory: `componentVariantsCount==0` = broken link). Confirm inventory decrements the real SKUs
   in a test add-to-cart.
4. **Publish** both to the Online Store channel; confirm **no collection membership** and that they
   do not appear in search/menus.
5. **Extend the free-shipping Function** (`.../automatic/1637817647424`): add the OR predicate for
   the two bundle GIDs, keep the ≥R$299 rule intact; deploy. Verify: sub-R$299 cart containing a
   bundle gets free shipping via `draftOrderCalculate`; a plain sub-R$299 cart still pays carrier.
6. **Wire the LP** (`lp-offer-mockup.html` → production) add-to-cart to the two variant GIDs;
   append the cart attribute `offer=wash-rotina` (see tracking) and pass UTMs through to checkout.
7. **Configure the checkout upsell** (if a surface exists): bundle at R$95, gift pre-defaulted to
   product A, self-suppress when either bundle GID is already in cart/order.
8. **Stand up the order-tag automation** (Shopify Flow or the existing orders webhook) — see
   Deliverable 2.
9. **(Rescue arm)** generate the personalized single-use attribution codes — see Deliverable 2.

---

# DELIVERABLE 2 — Tracking / cohort isolation (guardrail 6)

The bundle **product** delivers the R$95 price natively, so a discount code is **not** the price
lever. The cohort's primary key is therefore the **order tag** (auto-applied), backed by a
**cart/order attribute**, with the **discount-code family reserved for the rescue arm's per-customer
single-use attribution**. All four signals below let Module A split the cohort out of the blended
baseline.

## Discount-code family naming — collision analysis

`discounts.out.json` (61,137 codes; 5,925 ACTIVE) was scanned. **Namespaces to AVOID (live
collisions):** `NAME10` affiliate pattern (107+ active — never end a code in `10`), `GIFT*`
(1,858 Loox), `LOOX*` (3,749), `WHEELIO*` (12), `BEAUTYBACK*` (winback), bare `GE*` (3 active short),
`GANHE`/`INDIQUE&GANHE`. **Verified fully clean (0 occurrences, active or expired):** `ROTINA*`,
`RESGATE*`, `WASH*`, `LAVAGEM*`, and the exact strings `ROTINA95`, `RESGATE95`, `ROTINA-RSG`.

**Reserved family:**
- **Rescue (personalized, single-use):** `RESGATE95-<token>` — one code per rescued customer,
  BEAUTYBACK-style, `usageLimit = 1`, `appliesOncePerCustomer = true`. Purpose is attribution +
  once-per-customer enforcement, not price (bundle already R$95). Grant it a harmless real benefit
  that the mechanic can honor (e.g. free shipping — redundant with the Function but keeps the code
  valid) OR treat it as an eligibility token surfaced only to the rescue list. Its redemption is the
  rescue-attribution event.
- **Acquisition (optional shared entry code):** `ROTINA95` if Lucas wants a typeable code path
  (`appliesOncePerCustomer = true`). Not required — acquisition is tagged by order rule + UTM, so
  a code here is secondary.

## Order tag (primary cohort key)

- `cohort-wash-rotina` on every bundle order, plus an arm suffix: `cohort-wash-rotina-acq`
  (acquisition) / `cohort-wash-rotina-rsg` (rescue), plus a launch marker `wash-rotina-2607`.
- **Applied by an order rule keyed on "order contains bundle product A or B"** — via **Shopify Flow**
  (zero-code, no deploy; preferred for loose-ops) or the existing `webhooks.orders.tsx` handler.
- Arm split: acquisition = default; rescue = order also carries the `RESGATE95-*` code redemption
  OR `utm_campaign=wash-rotina-rsg` in the cart attribute.
- **Tag hygiene:** add tags with `tagsAdd` only; never `orderUpdate(input:{tags:[...]})` (memory
  `tag-persistence` — that overwrites and drops `ld_*`/other persistent tags).
- **Belt-and-suspenders:** LP writes cart attribute `offer=wash-rotina` (+ `offer_arm`), which
  carries to the order note attributes, so the cohort is recoverable even if tag automation lags.

## Customer tag / segment

- Tag the buyer `wash-rotina-acq` (net-new via this offer) or `wash-rotina-rsg` (rescued one-time
  buyer) via `tagsAdd` / `shopify_tag_customer`.
- Build two **customer segments** off those tags so CRM can (a) suppress them from unrelated sends,
  (b) suppress re-targeting them with the same tripwire, and (c) feed Module A's cohort split.
- Rescue audience source is the 19,206 one-time-buyers-never-bought-a-hero list
  (`broadened_rescue.py`); tag on send so the segment is populated before orders arrive.

## UTM scheme

| Param | Acquisition | Rescue |
|---|---|---|
| `utm_source` | `meta` / `google` | `klaviyo` |
| `utm_medium` | `paid-social` / `paid-search` | `email` |
| `utm_campaign` | `wash-rotina-acq` | `wash-rotina-rsg` |
| `utm_content` | `<angle>-<format>` (e.g. `rotina-4x5`) | `<yes-branch>` / `<no-branch>` |
| `utm_term` | audience/angle | segment |

LP persists `utm_campaign` into the cart attribute so the arm survives to the order even without a
code. `utm_campaign` is the single field that both drives the order-tag arm split and lets Module A
join platform spend to store orders.

## Single-use per customer

- Rescue `RESGATE95-*`: `usageLimit = 1` + `appliesOncePerCustomer = true`.
- Acquisition: enforced via the (unlisted) bundle products being LP/upsell-link-only + the customer
  tag suppressing re-targeting; if strict once-per-customer is required, gate with `ROTINA95`
  (`appliesOncePerCustomer = true`). Some organic leakage is accepted; the cohort tag captures
  whoever buys regardless.

## Module A tie-in

Add a detection predicate to `gebeauty/growth/module-a/README.md` mirroring the existing
`--include-giveaway` handling: **orders tagged `cohort-wash-rotina*` are EXCLUDED from blended KPIs
by default**, surfaced only with a `--include-wash-tripwire` flag, and reported on their own
scorecard. Success metric is **downstream** (hero-trial rate, 2nd-purchase rate, cohort payback at
day 30/60/90 vs a holdout) — **never first-order AOV/margin** (that read is the category error
guardrail 6 exists to prevent). The order tag `cohort-wash-rotina` is the split key;
`-acq`/`-rsg` gives the arm; `utm_campaign` joins the spend.

---

## Build-time verifications / flags

1. **Per-variant components** — confirmed NOT needed (two-product design sidesteps it).
2. **Bundle app path** — replicate the exact creation path used for existing Kits (first-party
   Bundles app owns the cartTransform; price/compareAtPrice via Admin API). Verify component count
   = 3 post-create.
3. **Free-ship Function** — source not in this checkout; the edit is a one-predicate behavior change
   + redeploy. Route to whoever owns the Function Studio deploy.
4. **Checkout upsell surface** — verify an upsell app / post-purchase extension exists; LP-only ships
   without it.
5. **Definitive economics** — `offer_breakeven.py` after price lock (freight fully borne).

## ASCII — order flow + cohort capture

```
  Ad (states offer) / Rescue email        LP (chooser)              Shopify
  --------------------------------        ------------              -------
  utm_campaign=wash-rotina-acq|rsg  --->  pick gift  --------->  /cart/add.js(variant A|B)
  (rescue: RESGATE95-<token>)             cart attr:                 |
                                          offer=wash-rotina          +-- 1 line = bundle (R$95)
                                          + utm_campaign             +-- components 001/002/(011|008)
                                                                     +-- compareAt 237|259 struck
                                                                     +-- Function: free ship
                                                                          (bundle-GID predicate)
                                                                     |
                                        [checkout upsell: same bundle, gift pre-defaulted;
                                         self-suppress if bundle already in cart]
                                                                     |
                                  Order created --> Flow/webhook: contains bundle product?
                                                     +-- tagsAdd: cohort-wash-rotina(-acq|-rsg)
                                                     +-- tagsAdd customer: wash-rotina-(acq|rsg)
                                                                     |
                                  Module A: exclude cohort-wash-rotina* from blended KPIs
                                            (--include-wash-tripwire to see); own scorecard
```
