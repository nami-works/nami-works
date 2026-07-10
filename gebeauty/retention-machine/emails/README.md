# Campaign email variants

Liquid templates for the repurchase-funnel campaigns. These are **Shopify notification
templates** (Settings → Notifications) or Shopify Email bodies, one file per variant.

Naming: `<notification-type>__<variant>.liquid`

## Built — the wired template
| File | Type | Notes |
|---|---|---|
| **`store-credit__notification.liquid`** | "Store credit issued" notification | **THE canonical template — wire this once and never swap.** Branches framing on `customer.metafields.custom.credit_context` (`reactivation` / `refill`, default `refill`). Renders personalized recs from `custom.recommended_products` with a mists fallback. Two-axis personalization: situation (reactivation vs refill) + offer (per-customer products). |

Superseded source variants (kept for reference/diff, NOT wired):
`store-credit__reactivation.liquid`, `store-credit__still-active.liquid` — merged into the unified file above.

## How the branch works (no more template swapping)
Policy lives in the **issuance pipeline**, not the template. Before issuing a wave, stamp each
customer's `custom.credit_context`; the template just renders it.
- **Reactivation wave (≥60d lapsed):** stamp `credit_context = "reactivation"` → winback copy,
  "FOI REATIVADO POR 7 DIAS" card, "recomeçar sua rotina". Issue `expiresAt = +7d`.
- **Refill wave (<60d still-active):** **no stamp needed** — the template defaults to `refill`
  ("É bom se cuidar…", plain validity card, "continuar a construir sua rotina").
- `utm_campaign` auto-switches (`store-credit-reactivation` vs `store-credit-stillactive`) off the
  same flag, so attribution stays clean without hand-editing links.

## Personalized offer block
- Recs come from the `custom.recommended_products` customer metafield (list.product_reference,
  top 3), written by `write_recommendations.py` (lift + hair-type guard + 1-mist cap).
- If the metafield is empty, the template falls back to the 3 launch mists (Rose / Pear / Santal),
  so no one gets a blank slot.
- Product image/title/`custom.finalidade` resolve natively from the reference — no hardcoding.

## Operating notes
- Copy shows the **real** `issued_store_credit.expires_at`, so it's only honest if issuance uses
  the matching expiry (reactivation = 7 days).
- Verify on a real issuance (test button uses dummy customer, won't populate metafields):
  `money` renders "R$ 45,60" (no BRL), date renders pt-BR, and the personalized recs appear.

## UTM convention (cross-channel attribution)
Keep `utm_campaign` **the same across channels** so email + WhatsApp roll up to one campaign in
GA4/Shopify, and vary `utm_source` so we can compare channel contribution.

| Touch | utm_source | utm_medium | utm_campaign | utm_content |
|---|---|---|---|---|
| Email CTA (reactivation) | `email` | `notification` | `store-credit-reactivation` | `cta_button` |
| WhatsApp reinforcement (non-redeemers) | `whatsapp` | `zoko` | `store-credit-reactivation` | `reminder` |

Opens are NOT tracked for the transactional notification (and are unreliable anyway — Apple MPP).
The engagement signal we act on is **clicks** (via these UTMs) and, above all, **redemption**
(store-credit debit) measured against the holdout. Reinforce via WhatsApp only **non-redeemers**.
