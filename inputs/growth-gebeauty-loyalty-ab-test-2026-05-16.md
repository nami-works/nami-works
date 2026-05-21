# GE Beauty — Loyalty Mechanic A/B Test

**Brief owner:** /growth-hacker + /integrations-engineer sessions, 2026-05-16
**Next owners:** /design-engineer (UI mockup) · /storefront-agent (copy + Klaviyo flows + WhatsApp templates) · /product-developer (later)
**Brand:** GE Beauty (Shopify Advanced plan, `ge-beauty-cosmeticos.myshopify.com`)
**Mechanism lives in:** Flywheel app (cpg-labs repo, APP_IDENTITY=flywheel, shipped via `shopify.app.flywheel.toml`), against GE Beauty store. Nav: "Loyalty" inside Flywheel alongside Affiliates. Scope pivot 2026-05-19 — was previously Omnify; moved to Flywheel because loyalty is a discount/credit primitive that fits Flywheel's "retention + attribution" umbrella, not Omnify's "delivery + footprint" umbrella.
**Status:** Design + integrations plan locked. Awaiting Phase 1 build (mockup-first). Pilot with 3 real customers before broad rollout.

---

## TL;DR

GE Beauty currently runs a narrow post-purchase incentive via the **CRM Bonus** Shopify app (~2.6% of orders generate a 20% fixed-R$ gift coupon, 45-day window, 25% cart cap). 90-day returning-customer rate is 26%.

We're testing whether **broad enrollment** combined with **tapered urgency mechanics** can lift that rate, and which of three program designs wins. CRM Bonus is disabled at test launch; we replicate its mechanic inside our infrastructure as the control arm so all three arms run on the same plumbing.

Three-arm test, **45/45/10 split**, customer-level sticky assignment. Primary metric: incremental gross profit per enrolled customer over 90 days, net of incentive cost. ~R$59k spend over 90 days, ~3 weeks to fill 1,500 enrollments per arm, ~90-100 days total runtime.

**Pilot first:** 3 hand-picked real customers (one per arm) ride the full mechanism for ~30-45 days. Operator UI must show their state correctly. Only after pilot validation does the enrollment trigger flip on for the whole store.

The mechanic — tapering store credit (decaying value, not cliff expiration) — is **globally novel**. No competitor surveyed (Brazilian DTC beauty or global retailer benchmark) combines money-in-account with proportional decay. Genuine product differentiation territory.

---

## Final test design

| Element | Spec |
|---|---|
| **Population** | Every GE Beauty purchase auto-enrolls the customer (~135 orders/day, ~12,000 per 90-day window) |
| **Assignment** | Customer-level **sticky**: 45% Arm A · 45% Arm B · 10% Arm C. Deterministic hash of customer ID, salted, 0-44 / 45-89 / 90-99 split. Same customer always sees the same arm across multiple enrollments. |
| **Re-enrollment** | An active enrollment blocks new enrollment for that customer until window expires |
| **Arm A — Tapering store credit** | 20% of original order issued as Shopify store credit at purchase, tranched into 5% + 5% + 10% with day-30 / day-60 / day-90 expiries. FIFO depletion by expiry. Customer sees a single account balance that tapers as tranches expire. No minimum, no cap. |
| **Arm B — Tapering discount code** | Unique discount code per customer. 20% off days 1-30 → cron flips to 15% on day 30 → cron flips to 10% on day 60 → expires day 90. No minimum, no cap. |
| **Arm C — CRM Bonus replica (control)** | Replicates CRM Bonus exactly inside our infrastructure: flat 20% discount code, 45-day validity, **capped at 25% of new order total**, no taper. Tests new mechanics vs. the preserved current mechanic at controlled scope. |
| **CRM Bonus app** | **Disabled at test launch.** Outstanding gift_X_XX codes already in customers' hands honored naturally until their 1-year `endsAt` expires. |
| **Touchpoints (all 3 arms)** | Enrollment confirmation message via Klaviyo (email) + Zoko (WhatsApp). Plus reminders per schedule below. |

### Reminder schedule per arm

| Arm | Enrollment (T+0) | Reminder 1 | Reminder 2 | Reminder 3 |
|---|---|---|---|---|
| **A** (tapering credit) | "You have R$X store credit, valid 90 days, value tapers over time" | T+25: "R$X expires in 5 days, use now for full value" | T+55: "R$Y expires in 5 days" | T+85: "Last R$Z expires in 5 days" |
| **B** (tapering discount) | "20% off your next order, value decreases over time" | T+25: "Your 20% drops to 15% in 5 days" | T+55: "Your 15% drops to 10% in 5 days" | T+85: "Code expires in 5 days" |
| **C** (flat 20% / 45d) | "20% off your next order, valid 45 days" | T+40: "5 days left, last chance" | — | — |

10 unique messages × 2 channels (email + WhatsApp) × 2 languages (PT-BR + EN) = **40 templates**. /storefront-agent owns the copy. Templates must respect brand-voice rules (benefit-only, no em dashes, taper framed as "rewards for early action").

### Message classification (LGPD + WhatsApp ToS)

- **Enrollment (T+0):** transactional — sent to everyone regardless of marketing opt-in. Confirms a benefit the customer has been granted.
- **Reminders (T+25/40/55/85):** marketing — sent only to customers with `email_consent` / `whatsapp_consent` true on their Shopify customer profile.

### Primary metric

> **Incremental gross profit per enrolled customer over 90 days, net of incentive cost**

### Secondary metrics (diagnostic)

- 90-day repeat purchase rate (baseline 26.0%)
- AOV of redeemed orders
- Redemption rate per arm
- Window-of-redemption distribution (Arms A and B)
- Time-to-first-redemption (all arms)

### Stopping rule

90 days minimum AND ≥1,500 enrolled customers per arm. Reaches 1,500 per arm in ~3 weeks at current order volume, so the calendar duration is the binding constraint.

### Winner criterion

+10% incremental profit per customer vs. each loser, with confidence interval excluding zero. Note: with no "do nothing" arm, winner is the best of three program designs, not absolute incrementality vs. zero.

---

## Resource commitment

| Item | Estimate | Basis |
|---|---|---|
| Pilot phase duration | ~30-45 days | 3 enrollments observed end-to-end; can extend if signal unclear |
| Full test duration | 90-100 days | 1,500 enrollments/arm reached fast at 135 orders/day; calendar duration binds |
| Incentive cost — Arm A | ~R$31,000 over 90 days | 45% × 12,000 × 20% redemption × R$177 AOV × tranche distribution |
| Incentive cost — Arm B | ~R$27,000 over 90 days | 45% × 12,000 × 17% redemption × R$177 AOV × window distribution |
| Incentive cost — Arm C | ~R$6,800 over 90 days | 10% × 12,000 × 16% redemption × R$177 AOV × 25% cap factor |
| **Total program spend** | **~R$65,000 over 90 days** | vs. ~R$1,700 today (~38× current spend) |
| WhatsApp Zoko per-conversation costs | TBD by message volume | Negotiate at Zoko provider level — separate from incentive cost |
| Break-even revenue (60% GM assumption) | ~R$108,000 incremental revenue | Below this = test loses money; above = winning arm graduates to full base |

The R$65k is the cost of learning whether broad-enrollment + tapered mechanics outperform the preserved-CRM-Bonus mechanic. If A or B beat C decisively, the winner graduates to the entire base permanently. If C wins (current mechanic preserved), we've bought definitive proof that the current narrow program design was right — though now running broad in our infrastructure, not via CRM Bonus.

---

## Grounding data (all measured 2026-05-16 against live GE Beauty store)

| Metric | Value | Source |
|---|---|---|
| AOV (last 90 days) | **R$177.28** | ShopifyQL `FROM sales SHOW average_order_value SINCE -90d` |
| Total orders (last 90 days) | 12,192 | Same query |
| Total revenue (last 90 days) | R$2,265,139.58 | Same query |
| Unique customers (last 90 days) | 10,023 | Same query |
| **Returning customer rate** | **26.0%** | Same query — baseline for primary metric |
| Existing CRM Bonus enrollment rate | **2.6% of orders** | Spot check: 7 gift_* codes / 270 orders on 2026-02-25 |
| Existing CRM Bonus redemption rate | **16% at 78-86 days** | Sample of 50 gift_* codes created Feb 19-28, 2026 — 8 redeemed |
| Mean gift coupon value (sample) | ~R$120 | Implies ~R$600 mean ORIGINAL order in the existing program — CRM Bonus only triggers on high-AOV customers |
| Implied current program spend | ~R$1,700 / 90 days | 315 enrollments × R$120 mean code × 16% redemption × cart-cap factor |

### Competitive intelligence summary

- **Brazilian DTC beauty:** Natura/Avon (10% cashback, 45d, 25% cap) is the closest analog. Sallve, Quem Disse Berenice, Granado/Phebo, Océane all run points-to-discount programs. **None taper.** Indie-to-mid players (B.O.B, Feito Brasil, NUVE, Sou Dela) ship nothing proprietary, relying on Méliuz/Cuponomia.
- **Global benchmarks:** Glossier, ILIA, Charlotte Tilbury use points. Sephora/Ulta use cliff-expiration. Beauty Pie is paid membership. **None taper.**
- **Industry redemption benchmark:** 13-25% (Smile.io 2019, Yotpo 2024). GE Beauty's current 16% is at the low end.
- **Store credit specifically:** drives ~20% higher repeat rate vs cash refund (ReturnGO 2025). 80% of store credit redeemed in first 14 days, drops below 10% after 1 month. Supports Arm A hypothesis.
- **Tapering as urgency mechanic:** explicitly counter-trend (airlines abandoned mile expiration as customer-hostile). Risk: customer perception of "this is unfair." Mitigate via copy framing — "rewards for early action," not "punishment for waiting."

---

## Architecture overview

### System boundaries

```
  Shopify (GE Beauty store)
    ├─ orders/paid webhook  ──┐
    └─ store credit API       │
    └─ priceRule + discount   │
       code mutations         │
                              ▼
  Omnify app (cpg-labs repo)              External providers
    ├─ Enrollment trigger     │              ├─ Klaviyo (email)
    ├─ Arm assignment ────────┤              │   - LoyaltyBonusGranted event
    ├─ Tranche/code creation  │              │   - LoyaltyBonusExpiringSoon event
    ├─ Daily orchestrator cron├──MessageDispatcher─→ KlaviyoAdapter
    │   (Lightsail crontab)   │                  └─ ZokoAdapter
    │   - Arm B priceRule     │                      ├─ template send via Zoko API
    │     flips at day 30/60  │                      └─ delivery status webhook
    │   - Reminder scheduling │                          (webhooks.zoko.tsx)
    │   - Tranche expiry      │              └─ Zoko (WhatsApp Business via Meta)
    │     archival            │
    ├─ Admin UI extension     │
    │   (customer-detail block)
    └─ MessageLog audit       │
```

### Adapter pattern (messaging)

Following the carrier-adapter pattern from `app/services/carrier/`:
- `KlaviyoAdapter` (in `app/services/messaging/klaviyo-adapter.server.ts`) — POSTs events to Klaviyo Events API. Klaviyo Flows handle template rendering + delivery + consent management natively.
- `ZokoAdapter` (in `app/services/messaging/zoko-adapter.server.ts`) — POSTs template-send to Zoko API. Zoko relays to Meta WhatsApp Business. Status webhooks come back to `webhooks.zoko.tsx` and write to `LoyaltyMessageLog`.
- `MessageDispatcher` (orchestrator) — receives "send message X about enrollment Y" → checks customer consent on Shopify profile → fans out to adapters → writes audit row.

### Cron (daily loyalty orchestrator)

Single daily cron consolidates everything to avoid race conditions:

```
  daily-loyalty-orchestrator (00:30 BRT, on Lightsail crontab)
    │
    ├─ Step 1: Arm B priceRule flips
    │     find enrollments at day-30 boundary → flip 20% → 15%
    │     find enrollments at day-60 boundary → flip 15% → 10%
    │
    ├─ Step 2: Tranche expiry archival (Arm A)
    │     find tranches with expiresAt < now → mark expired in DB
    │
    └─ Step 3: Reminder scheduling
          find enrollments at T+25/T+40/T+55/T+85 → enqueue messages
          MessageDispatcher fans out to Klaviyo + Zoko per consent
```

ECS-restart survivable per CLAUDE.md: persist progress per batch, log `elapsed=Xs / total=N`, use `[loyalty:orchestrator]` log prefix.

---

## Operator UI extension

Shopify Admin UI Extension with target `admin.customer-details.block.render`. Renders inline on the customer detail page in Shopify admin. Lives at `extensions/loyalty-customer-block/`.

**Two-tier disclosure** (locked design — operators don't grasp test mechanics; details are for test owners only):

### Default (operator) view

For an Arm A customer:
```
┌─ Loyalty bonus ─────────────────────────────────────┐
│ This customer has R$32 of store credit available.   │
│                                                     │
│ How to redeem: ask them to log in to their account  │
│ at checkout. Credit applies automatically.          │
│                                                     │
│ Expires: 2026-08-15                                 │
│                                                     │
│ ▸ More details                                      │
└─────────────────────────────────────────────────────┘
```

For an Arm B customer:
```
┌─ Loyalty bonus ─────────────────────────────────────┐
│ Active discount code: LOYAL-X8K2M4                  │
│ Currently worth: 15% off, no minimum                │
│                                                     │
│ How to redeem: customer enters the code at checkout.│
│                                                     │
│ Expires: 2026-08-15                                 │
│                                                     │
│ ▸ More details                                      │
└─────────────────────────────────────────────────────┘
```

For an Arm C customer:
```
┌─ Loyalty bonus ─────────────────────────────────────┐
│ Active discount code: BONUS-K3Q9PM                  │
│ Worth: 20% off (capped at 25% of new order total)   │
│                                                     │
│ How to redeem: customer enters the code at checkout.│
│                                                     │
│ Expires: 2026-07-01                                 │
│                                                     │
│ ▸ More details                                      │
└─────────────────────────────────────────────────────┘
```

For an unenrolled customer:
```
┌─ Loyalty bonus ─────────────────────────────────────┐
│ No active bonus.                                    │
│                                                     │
│ ▸ More details                                      │
└─────────────────────────────────────────────────────┘
```

### Expanded (analyst) view — default-collapsed, no access gating

Below the operator section. Example for Arm A:
```
│ ...operator section unchanged above...              │
│                                                     │
│ ▾ More details                                      │
│                                                     │
│ Test cohort:     Arm A — tapering cashback          │
│ Enrolled:        2026-05-20 (order #80623, R$160)   │
│ Cohort sticky:   yes (assigned 2026-05-20)          │
│ Window:          day 1-30 → 31-60 → 61-90           │
│ Current window:  1 of 3 — R$32 of R$32 available    │
│ Next decay:      2026-06-19 → R$24 (75% remains)    │
│ Then:            2026-07-19 → R$16 (50% remains)    │
│ Then expires:    2026-08-18                         │
│                                                     │
│ Redemption history:                                 │
│   (none yet)                                        │
└─────────────────────────────────────────────────────┘
```

**Operator-language rules (hard constraints):**
- Never the words "test", "arm", "cohort", "tranche", "enrollment" in the operator section
- Always concrete: "R$32 store credit" not "cashback balance"; "20% off" not "discount percentage"
- Redemption instruction is the second line — that's the operator's actual job
- Expiry date is plain calendar date, not "days remaining"
- Money in BRL with R$ prefix
- Bilingual (PT-BR default for GE Beauty support team)

**Mockup-first per CLAUDE.md:** /design-engineer produces HTML mockup in `inputs/mockups/loyalty-customer-block-v1.html` covering all 4 states (Arm A, B, C, unenrolled) × both default and expanded. /integrations-engineer scaffolds the extension + data fetch API only after mockup is approved.

---

## IssuedIncentive watchdog (cross-campaign infrastructure)

The loyalty A/B test is the first scoped use of a broader pattern: any time we issue a credit or discount tied to a triggering order, the credit's existence depends on that order surviving. If the order is cancelled or refunded, the rationale for the credit is gone too. The watchdog enforces this for **all** issuances going forward, not just loyalty-test enrollments.

### Scope

- Fiscal-hold-extrema-2026-05 apology credits (114 issued 2026-05-19 — backfilled retroactively when this table lands)
- Loyalty A/B test enrollments (Arms A, B, C — created live by the enrollment trigger)
- Future referral rewards, post-purchase coupons, win-back offers, anything tied to a `triggeringOrderId`

### Schema (additive to Phase 1.3)

```
IssuedIncentive
  ├─ id (cuid), shop, customerId (Shopify GID)
  ├─ campaignTag           "fiscal-hold-extrema-2026-05" | "loyalty-test-arm-A" | …
  ├─ originalOrderId       the triggering order (what we watch)
  ├─ originalOrderAmount   for partial-redemption math
  ├─ kind                  STORE_CREDIT | DISCOUNT_CODE
  ├─ amount, currency
  ├─ shopifyRef            credit-transaction GID OR codeDiscountNode GID
                           (JSON array for multi-tranche Arm A — 3 transaction GIDs)
  ├─ issuedAt, expiresAt
  ├─ status                ACTIVE | REVOKED_CANCELLED | REVOKED_REFUNDED | EXPIRED | REDEEMED
  ├─ statusReason
  └─ revokedAt, revokedAmount
```

Indexes: `(shop, originalOrderId, status)` for the watchdog webhook lookup; `(shop, status, expiresAt)` for the daily orchestrator's expiry sweep; `(customerId)` for the operator UI extension.

### Watchdog rules (locked 2026-05-19)

| Rule | Setting |
|---|---|
| **Watchdog window** | Whole life of the credit (until `expiresAt`). No separate shorter window. Rationale: prevents the abuse vector of "cancel order 2 days before credit expiry, then redeem" — Lucas's call. |
| **Trigger events** | `orders/cancelled` AND `orders/refunded` webhooks |
| **Partial-redemption handling** | Revoke unused portion only (computed from `remainingAmount` on Shopify side). Already-spent credit stays. Account never goes negative. |
| **Customer notification on revoke** | Yes — Shopify-native debit notification + brief PT-BR explanation: "Crédito removido porque o pedido associado foi cancelado." |
| **Idempotency** | `status != ACTIVE` rows are skipped. Multiple webhook firings safe. |

### Per-arm revocation behavior

- **Arm A** (multi-tranche store credit): Revoke = sum `remainingAmount` across all 3 tranche GIDs in `shopifyRef`, debit total via `storeCreditAccountDebit`. Status → `REVOKED_CANCELLED` or `REVOKED_REFUNDED`.
- **Arm B + C** (discount code): Revoke = `discountCodeDelete` on the codeDiscountNode. Past redemptions (`asyncUsageCount > 0`) stay — Shopify doesn't support clawback on already-applied discounts.
- **Apology credits** (single transaction): Revoke = debit `remainingAmount` of the single credit transaction GID.

### Flow

```
  Shopify webhook                          Omnify handler
  ────────────────                         ──────────────
  orders/cancelled    →   webhooks.orders.cancelled.tsx
                          • SELECT FROM IssuedIncentive
                              WHERE shop=? AND originalOrderId=? AND status='ACTIVE'
                          • for each row:
                              • compute unused (via shopifyRef lookup)
                              • storeCreditAccountDebit OR discountCodeDelete
                              • UPDATE row SET status='REVOKED_CANCELLED', revokedAt, revokedAmount
                              • if STORE_CREDIT: Shopify auto-fires debit notification
                              • if DISCOUNT_CODE: enqueue Klaviyo "code revoked" event (TBD copy)

  orders/refunded     →   webhooks.orders.refunded.tsx (same logic, REVOKED_REFUNDED)

  daily-loyalty-orchestrator (existing Phase 1.6 cron, extended)
                          • additionally: mark expired-window rows as EXPIRED
                          • (cosmetic — credit/code stays valid on Shopify side until its own expiry)
```

### Backfill of 2026-05-19 fiscal-hold credits

One-shot script `scripts/backfill-issued-incentive.mjs` to be written after Phase 1.3 lands. Reads `extrema-credit-log.json` (114 rows + transaction GIDs), inserts one `IssuedIncentive` row per customer with `campaignTag = "fiscal-hold-extrema-2026-05"`, `expiresAt = 2026-07-18T18:21:22Z`. Watchdog then automatically covers those 114 retroactively for the 60-day window.

---

## Implementation phases

### Phase 0 — Prerequisites (Lucas-owned)

| # | Task | Status |
|---|---|---|
| 0.1 | Approve this plan (done 2026-05-16) | ✅ |
| 0.2 | Provision Klaviyo API key for our app (write to Events API) | ⏳ |
| 0.3 | Provision Zoko API key for our app (send templates + receive webhooks) | ⏳ |
| 0.4 | Commit CRM Bonus shutdown date (single cutover, coincides with broad-launch date in Phase 2) | ⏳ |
| 0.5 | Pick 3 pilot customers (one per arm) — opted-in to email + WhatsApp, ideally internal team or trusted customers | ⏳ |

### Phase 1 — Build (no production traffic yet)

| # | Task | Owner | Gate |
|---|---|---|---|
| 1.1 | UI mockup (operator + analyst tiers, 4 states) | /design-engineer | Lucas approval → 1.2 |
| 1.2 | Feasibility verification on Shopify Partner dev store: `storeCreditAccountCredit` multi-tranche behavior + `priceRule` mid-window updates | /integrations-engineer | Report → Lucas approval → 1.3 |
| 1.3 | Prisma schema: 4 loyalty-test tables (`LoyaltyEnrollment`, `LoyaltyRedemption`, `LoyaltyMessageLog`) + 1 cross-campaign table (`IssuedIncentive`) | /integrations-engineer | Schema review → 1.4 |
| 1.3b | One-shot backfill script: insert 114 IssuedIncentive rows for the 2026-05-19 fiscal-hold credits (data from `extrema-credit-log.json`) | /integrations-engineer | Watchdog now covers them retroactively |
| 1.4 | Enrollment trigger: `orders/paid` webhook + active-enrollment guard + sticky arm assignment + (per arm) tranche/code creation + IssuedIncentive insert | /integrations-engineer | Code review → 1.5 |
| 1.4b | Watchdog webhooks: `webhooks.orders.cancelled.tsx` + `webhooks.orders.refunded.tsx` — look up active IssuedIncentive by originalOrderId, debit/delete unused portion, mark REVOKED | /integrations-engineer | Code review → 1.5 |
| 1.5 | KlaviyoAdapter + ZokoAdapter + MessageDispatcher + `webhooks.zoko.tsx` status receiver + LoyaltyMessageLog writes | /integrations-engineer | Code review → 1.6 |
| 1.6 | Daily loyalty orchestrator cron (Arm B value flips + tranche archival + reminder scheduling + IssuedIncentive expiry-marking) | /integrations-engineer | Code review → 1.7 |
| 1.7 | Anti-abuse: rate-limit per shipping address + customer-account-bound code use (refund/cancel handling moved to 1.4b) | /integrations-engineer | Code review → 1.8 |
| 1.8 | Admin UI extension scaffolding + data-fetch API + render of approved mockup | /integrations-engineer + /design-engineer | Functional UI on dev store → 1.9 |
| 1.8b | "All incentives" Omnify route — HTML mockup (Polaris table + filters, drilldown to customer page) | /design-engineer | Lucas approval → 1.8c |
| 1.8c | Build `app/routes/app.loyalty.incentives.tsx` — Polaris table reading IssuedIncentive, filters (campaign/arm/status/search), row-click drilldown to Shopify customer admin | /integrations-engineer | Loads with backfilled fiscal-hold credits + any loyalty-test enrollments |
| 1.9 | WhatsApp template drafts (8 templates × 2 languages) submitted to Meta via Zoko | /storefront-agent + /integrations-engineer | Meta approval (1-2 wk lead time, parallel with rest of build) |
| 1.10 | Klaviyo Flows configured in Klaviyo UI (one Flow per event) | /storefront-agent | Test fire from Klaviyo UI succeeds |
| 1.11 | End-to-end integration test on dev store + GE Beauty staging — enroll 1 test customer per arm with shortened windows (minutes not days) | /integrations-engineer | Pass → Phase 2 |

### Phase 2 — Pilot (3 real customers, ~30-45 days)

| # | Task | Owner | Gate |
|---|---|---|---|
| 2.1 | Manually enroll 3 hand-picked customers on GE Beauty live (one per arm), with full real-time windows | /integrations-engineer + Lucas | Enrollment confirmed in operator UI → 2.2 |
| 2.2 | Verify enrollment messages (email + WhatsApp) land for all 3 within 5 minutes | /integrations-engineer + Lucas eyes-on | Confirmed delivery → 2.3 |
| 2.3 | Observe T+25 reminder fire for pilot customers (Arm A + B), T+40 for Arm C | /integrations-engineer + Lucas eyes-on | Confirmed → 2.4 |
| 2.4 | Validate pilot customer can redeem at checkout (store credit auto-applies, discount code applies) | Lucas + support team | Confirmed → 2.5 |
| 2.5 | Validate Arm B priceRule flip at day 30 (cron executes, code value drops, customer sees new value) | /integrations-engineer | Confirmed → Phase 3 go/no-go |
| 2.6 | Phase 3 go/no-go decision | Lucas | Pass → Phase 3 |

### Phase 3 — Broad launch (whole store, 90-day test)

| # | Task | Owner |
|---|---|---|
| 3.1 | Disable CRM Bonus app (single cutover) | Lucas |
| 3.2 | Enable enrollment trigger for all `orders/paid` webhook traffic | /integrations-engineer |
| 3.3 | Monitor first 7 days: enrollment counts per arm, message delivery rates, no error spikes | /integrations-engineer + Lucas eyes-on |
| 3.4 | 90-day test runs to completion | — |
| 3.5 | Calibration validation: wider gift_* redemption sample (less critical post-CRM-Bonus-shutdown) | /integrations-engineer if time permits |
| 3.6 | Winner declaration after day 90, ≥1,500 enrolled per arm, primary-metric significance | /growth-hacker (re-engaged for analysis phase) |

### Phase 4 — Post-test (out of this brief's scope, flag for future)

- Decision-rule automation for declaring winners + auto-promoting winning arm to 100% → /product-developer
- ~~Admin dashboard for live test monitoring inside Omnify nav~~ → **pulled forward to Phase 1.8b/1.8c (2026-05-19)**
- Force-redeem / force-cancel actions in UI extension → /product-developer
- ~~Top-level "all enrollments" view (filter by arm, status)~~ → **pulled forward to Phase 1.8b/1.8c (2026-05-19)** — generalized to "all incentives" view covering both loyalty-test enrollments AND cross-campaign IssuedIncentive rows (e.g. fiscal-hold credits)
- Per-arm aggregate summary cards above the table (enrollment count, redemption rate, incremental revenue) — deferred for now, can add as Phase 1.8d if needed during pilot

---

## Out of scope for /integrations-engineer

Hand to other skills:

| Scope | Owner | Timing |
|---|---|---|
| HTML mockup of UI extension (operator + analyst tiers, 4 states) | /design-engineer | Phase 1.1 (FIRST deliverable) |
| Bilingual copy for 10 messages × 2 languages (40 templates total) | /storefront-agent | Phase 1.9/1.10 |
| Klaviyo Flow setup (one Flow per event in Klaviyo UI) | /storefront-agent | Phase 1.10 |
| WhatsApp template drafts (submitted to Meta via Zoko) | /storefront-agent + /integrations-engineer submits | Phase 1.9 |
| Customer-account language for visible store credit balance | /storefront-agent | Phase 1.10 |
| Admin dashboard inside Omnify for live test monitoring | /product-developer | Phase 4 |
| Winner-declaration automation | /product-developer | Phase 4 |
| Force-redeem / force-cancel buttons in UI extension | /product-developer | Phase 4 |
| Ad campaigns promoting the new loyalty mechanic | NOT IN SCOPE — retention not acquisition | Revisit if test wins |

---

## Decisions explicitly made (and rejected alternatives)

For audit + future-session context. Each decision references the session where it was locked.

### From /growth-hacker session (2026-05-16)

**Population: every purchase, all customers** (not repeat-only or VIP-only)
- Why: simplest, fastest to learn, broadest signal
- Rejected: repeat-buyers-only (slower learning), above-AOV-only (selection confound), manual VIP cohort (too small)

**Window: 90 days, both arms aligned**
- Why: isolates the taper as the strategic question; touchpoints match across arms
- Rejected: 30-day flat for both (kills the taper hypothesis), 30 vs 90 asymmetry (confounds time with mechanic)

**Cost calibration: value-ceiling equivalence** (not expected-cost equivalence)
- Why: same first-purchase value gives same max payout regardless of arm
- Rejected: tune cashback % to match Arm B's expected cost ± 15%

**Arm B cart cap: dropped** (was 25% on current program)
- Why: treat the no-cap as part of the "taper innovation package"
- Trade-off: confounds taper-effect with cap-removal effect if Arm B wins
- Rejected: keep 25% cap on Arm B's window 1 (cleaner isolation, less compelling test)

**Scope: broad enrollment** (every order, not narrow)
- Why: explicitly tests whether the program should expand from narrow-high-AOV to universal
- Rejected: mirror current ~2.6% scope (4-5 month test), R$150+ middle ground

### From /integrations-engineer session (2026-05-16, follow-up)

**Control arm redefined to Arm C — CRM Bonus replica** (replaces "status quo as-is")
- Why: with CRM Bonus disabled at test launch, "status quo" no longer exists. Replicating its mechanic inside our infrastructure preserves a controlled comparator AND tests the same plumbing across all 3 arms.
- Rejected: true holdout / no incentive (would deprive 10% of all post-purchase value, customer-experience regression vs today), 50/50 A vs B with no control (no mechanic comparator)

**CRM Bonus shutdown handling**: disabled at launch, outstanding codes honored
- Why: customers expecting their existing gift_X_XX cashback aren't deprived; ~265 unredeemed codes in the wild at any time, ~84% expire unused anyway
- Rejected: force-expire all outstanding codes (worst customer experience), partial-expire by date (middle-ground complexity not worth it)

**Pilot phase added before broad rollout**
- Why: Lucas's preference for safety — prove the mechanism end-to-end with 3 real customers before exposing 12,000
- Rejected: skip directly to broad rollout (faster but riskier; a bug discovered after day 5 with 5,000 enrolled is harder to remediate than 3)

**Messaging via existing Klaviyo + Zoko channels** (not new ESPs)
- Why: both providers already in place at GE Beauty with WhatsApp Business approval flowing through Zoko
- Rejected: new ESP / new WhatsApp provider (unnecessary commercial decision)

**Enrollment = transactional, reminders = marketing**
- Why: standard LGPD + WhatsApp ToS interpretation; bonus-granted is a confirmation, reminders are promotional
- Rejected: all transactional (LGPD risk), all marketing (lower reach if opt-in rate is low)

**UI: 2-tier disclosure, no access gating**
- Why: operators don't grasp test mechanics; details belong below the fold. No role infrastructure needed — operators won't expand it; if they do they see context they won't act on.
- Rejected: access-gated to specific users (more infra), no separation (operator confusion)

**Mockup-first via /design-engineer**
- Why: matches CLAUDE.md Design Validation rule for non-trivial UI patterns; locks visual + state matrix before scaffolding
- Rejected: integrations-engineer sketches directly (skips the mockup-first guard)

---

## Brand-voice constraints (must propagate to /storefront-agent)

- Primary language: **PT-BR**. EN secondary.
- **Benefit-only.** Never clinical, never diagnosis-adjacent. "Pele mais lisa" yes, "trata acne" no.
- **No em dashes** in customer-facing copy. Use commas or periods.
- Taper messaging frames urgency as **"rewards for early action"**, never as "punishment for waiting." Airlines abandoned time-decay because customers perceived it as hostile — copy framing is the mitigation.
- All customer-facing strings come from `app/i18n/locales/`, not hardcoded JSX.
- WhatsApp templates must comply with Meta's promotional message policies (clear opt-out, no clickbait, no false urgency).

---

## Files / locations (anticipated)

**App hosting:** Flywheel (APP_IDENTITY=flywheel). Routes live in the shared `app/routes/` tree but gated for Flywheel via `app/utils/app-identity.server.ts` (`IDENTITY_ROUTES.flywheel` includes `app.loyalty`, `api.cron.loyalty-orchestrator`, `webhooks.orders.cancelled`, `webhooks.orders.refunded`). Nav: `/app/loyalty` added to `IDENTITY_NAV.flywheel` alongside `/app/affiliates`.

- **Loyalty hub route:** new `app/routes/app.loyalty._index.tsx` (landing page — TBD content; could be the all-incentives table or a hub)
- **All-incentives table route:** new `app/routes/app.loyalty.incentives.tsx` (Phase 1.8c, mockup approved 2026-05-19)
- **Enrollment trigger:** new `app/routes/webhooks.orders.paid.tsx` OR extension of existing `webhooks.orders.tsx` (latter routes to the right handler by topic)
- **Watchdog webhooks:** new `app/routes/webhooks.orders.cancelled.tsx` + `app/routes/webhooks.orders.refunded.tsx` (Phase 1.4b)
- **Adapters:** `app/services/messaging/{klaviyo-adapter,zoko-adapter,message-dispatcher}.server.ts`
- **Zoko status webhook:** new `app/routes/webhooks.zoko.tsx`
- **Daily orchestrator:** new `app/routes/api.cron.loyalty-orchestrator.tsx` + Lightsail crontab entry
- **Database tables:** `prisma/schema.prisma` — `LoyaltyEnrollment`, `LoyaltyRedemption`, `LoyaltyMessageLog`, `IssuedIncentive` (shared Postgres; same DB as Omnify uses)
- **Credentials:** Klaviyo + Zoko API keys encrypted via existing AES-256-GCM pattern in `app/services/security/encryption.server.ts`, stored in new Prisma table or extended `ShopCredential` table
- **UI extension:** new `extensions/loyalty-customer-block/` (Shopify Admin UI Extension, registered against Flywheel app)
- **UI mockups:**
  - `inputs/mockups/loyalty-customer-block-v1.html` (operator block on Shopify customer detail page)
  - `inputs/mockups/loyalty-incentives-table-v1.html` (all-incentives table in Flywheel admin)
- **i18n keys:** `app/i18n/locales/{pt,en}/loyalty-test.json` (created by /storefront-agent); `common:nav.loyalty` added to `common.json`
- **WhatsApp templates:** registered in Zoko dashboard, not in this repo
- **Klaviyo Flows:** configured in Klaviyo UI, not in this repo
- **Shopify app config:** `shopify.app.flywheel.toml` (scopes + webhook subscriptions updated 2026-05-19 — adds `write_customers`, `write_discounts`, `read_store_credit_account_transactions`, `write_store_credit_account_transactions` + 3 webhook topics)

---

## Session-context references

Findings + decisions from the 2026-05-16 /growth-hacker AND /integrations-engineer sessions are captured here in full. Subsequent sessions can start from this file without needing the prior conversation logs.

External references:
- Brazilian DTC beauty competitive scan (in /growth-hacker session log)
- US/global beauty + loyalty platform benchmarks (in /growth-hacker session log)
- Shopify Admin GraphQL `storeCreditAccountCredit`, `codeDiscountNodes`, `priceRule` (Shopify docs)
- Klaviyo Events API: https://developers.klaviyo.com/en/reference/create_event
- Zoko API: https://docs.zoko.io/
- GE Beauty existing cupons page: https://gebeauty.com.br/pages/cupons-de-desconto
