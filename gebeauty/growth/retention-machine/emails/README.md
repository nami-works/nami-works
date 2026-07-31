# Campaign email variants

Liquid templates for the repurchase-funnel campaigns. These are **Shopify notification
templates** (Settings → Notifications) or Shopify Email bodies, one file per variant.

Naming: `<notification-type>__<variant>.liquid`

## Built — the wired template
| File | Type | Notes |
|---|---|---|
| **`store-credit__notification.liquid`** | "Store credit issued" notification body | **THE canonical template — wire this once and never swap.** Branches framing on native customer **tags** into three contexts (`goodwill` / `reactivation` / `refill`, default `refill`). Renders a fixed 3-mist recs block. Two-axis personalization: situation (goodwill vs reactivation vs refill) + offer. |
| **`store-credit__notification.subject.liquid`** | "Store credit issued" notification subject | Paste into the **Email subject** field (separate from the body in Shopify's editor). Same 3-way tag branch as the body, same priority order (goodwill → reactivation → refill). |

Superseded source variants (kept for reference/diff, NOT wired):
`store-credit__reactivation.liquid`, `store-credit__still-active.liquid` — merged into the unified file above.

`store-credit__still-active_preview.html`, `store-credit__reactivation_preview.html`,
`store-credit__goodwill_preview.html` — rendered previews of each context (see "Verify locally"
below); eyeball-only, not wired. All three are generated from the live template by
`render_previews.py` — regenerate after any template edit, don't hand-edit them.

## How the branch works (no more template swapping)
Policy lives in the **issuance pipeline**, not the template. **Branching keys off native customer
`tags`, NOT metafields** — `customer.metafields` is unavailable in notification Liquid (confirmed
2026-07-07: a metafield-based branch silently fell to defaults). Before issuing a wave, stamp the
customer tag; the template renders the matching context. Three contexts, checked in this priority
order (an apology outranks a winback outranks a refill):

- **Goodwill (apology — delivery delay, ops screw-up, etc.):** tag `credit-goodwill` (the generic
  convention — stamp this going forward) **or** `atraso_extrema-jul-27` (the live CD Extrema batch-1
  wave, already on-customer). Renders apology opener ("seu último pedido demorou mais do que
  deveria…"), "nosso pedido de desculpas" card, plain validity, tagline close. `utm_campaign =
  store-credit-goodwill`. Issued by `scripts/_issue_cd_extrema_goodwill_credits.py` with `notify=true`,
  90-day expiry.
- **Reactivation wave (≥60d lapsed):** stamp `credit-reactivation` → winback copy, "FOI REATIVADO
  POR 7 DIAS" card, "recomeçar sua rotina". Issue `expiresAt = +7d`.
  `utm_campaign = store-credit-reactivation`.
- **Refill wave (<60d still-active):** **no tag needed** — the template defaults to `refill`
  ("É bom se cuidar…", plain validity card, "continuar a construir sua rotina").
  `utm_campaign = store-credit-stillactive`.

**Pipeline dependency for goodwill:** the extrema branch fires today off the pre-existing
`atraso_extrema-jul-27` tag, so the live batch-1 wave is covered with no code change. But
`_issue_cd_extrema_goodwill_credits.py` stamps **no** tag itself — for any *future* goodwill wave the
issuance step must add tag `credit-goodwill` to the customer before/at issuance, or those credits will
fall through to the refill (regular) framing.

## Offer block (recs)
- The 3-mist block in the notification is **hardcoded** (Rose / Pear / Santal). Notification Liquid
  can't read `customer.metafields`, so per-customer recs from `custom.recommended_products`
  (written by `write_recommendations.py`) can't render here — they live on the **WhatsApp** touch
  instead. Update these 3 by hand in the template if launches change.
- The recs title adapts per context ("o que chegou desde a sua última vez" / "separamos algumas
  sugestões" / neutral for goodwill) but the products themselves are the same three.

## Operating notes
- Copy shows the **real** `issued_store_credit.expires_at`, so it's only honest if issuance uses
  the matching expiry (reactivation = 7d, goodwill = 90d, refill per policy).
- Verify on a real issuance (the test button uses a dummy customer with no tags → always renders the
  refill default): confirm `money` renders "R$ 45,60" (no BRL) and the date renders pt-BR.

## Verify locally
The template is plain Liquid apart from Shopify's `money` / `date` / `shopify_asset_url` filters, so
you can dry-render every context offline with `python-liquid`: stub those three filters, then render
with `customer.tags` set to `[]` (refill), `['credit-reactivation']`, and `['atraso_extrema-jul-27']`
(or `['credit-goodwill']`) and eyeball each. Run `render_previews.py` in this directory to regenerate
all three `*_preview.html` files at once — this is also how the goodwill-beats-reactivation
precedence was originally confirmed.

`render_previews.py` stubs `shop.email` as `sac@gebeauty.com.br` — confirmed via a live GraphQL
`shop { email }` query (2026-07-31) as the store's real contact address, matching what
`klaviyo-winback_block2.html` already hardcodes. Keep it in sync if the shop's contact email ever
changes.

## UTM convention (cross-channel attribution)
Keep `utm_campaign` **the same across channels** so email + WhatsApp roll up to one campaign in
GA4/Shopify, and vary `utm_source` so we can compare channel contribution.

| Touch | utm_source | utm_medium | utm_campaign | utm_content |
|---|---|---|---|---|
| Email CTA (refill) | `email` | `notification` | `store-credit-stillactive` | `cta_button` |
| Email CTA (reactivation) | `email` | `notification` | `store-credit-reactivation` | `cta_button` |
| Email CTA (goodwill) | `email` | `notification` | `store-credit-goodwill` | `cta_button` |
| WhatsApp reinforcement (non-redeemers) | `whatsapp` | `zoko` | `store-credit-reactivation` | `reminder` |

Opens are NOT tracked for the transactional notification (and are unreliable anyway — Apple MPP).
The engagement signal we act on is **clicks** (via these UTMs) and, above all, **redemption**
(store-credit debit) measured against the holdout. Reinforce via WhatsApp only **non-redeemers**.
