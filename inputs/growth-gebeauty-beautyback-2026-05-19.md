# Beautyback issuance plan — 2026-05-19

**Status:** plan only, no live mutations executed. Awaiting Lucas approval + answers to open questions.
**Requesting session:** loyalty-sandbox (parallel work on GE Beauty `ge-beauty-cosmeticos.myshopify.com`).
**Target shop:** `ge-beauty-cosmeticos.myshopify.com` (API `2026-01`).
**Today:** 2026-05-19. **60-day cutoff:** 2026-03-20.

---

## 1. Beautyback research findings

### Source 1 — canonical sandbox playbook (nami-works)

The reference Beautyback specification lives at
`gebeauty/actions-unlocked/issue-beautyback-cashback.md`
(action card, status `sandbox-experimental`, owner `lucas@nami.works`) with the
implementation at `gebeauty/scripts/cashback_generate.py` and
helpers at `gebeauty/scripts/_cashback_lib.py`.

**Mental model (verbatim from the playbook):**
> Every paying customer of GE Beauty earns a personalized winback code worth
> 20% of their most recent paid order. The code can offset up to 25% of the
> customer's next order — which fixes the minimum-purchase amount at
> `4 × cashback`. Codes are unique per customer, single-use globally, and
> combine freely with order, product, and shipping discounts.

**Coupon mechanic — locked-in shape:**

| Property | Value |
|---|---|
| Discount object | `DiscountCodeBasic` (one node per customer) |
| Code format | `BEAUTYBACK-AAAA-BBBB-CCCC` — 3 random groups of 4 chars from unambiguous alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (drops 0/O/1/I/L) |
| Title pattern | `Beauty Back \| <email>` — per-customer admin attribution |
| Value (default) | `cashback = round(0.20 × last_paid_order_subtotal, 2)` |
| Minimum cart | `min_purchase = 4 × cashback` (= `cashback / 0.25`) |
| Discount-type cutover | `min_purchase ≤ R$200` → **fixed R$ off** with min enforced. `min_purchase > R$200` → **flat 25% off**, communication-only min (Shopify min set to R$0.01, the historical Shopify-UI convention) |
| Customer scope | `customerSelection { all: true }` — code is generic but distributed 1:1 |
| Usage caps | `appliesOncePerCustomer = true` AND `usageLimit = 1` (belt-and-braces single-use globally) |
| Combinability | `orderDiscounts: true, productDiscounts: true, shippingDiscounts: true` (confirmed 2026-03-29 bulk update of 11,698 historical codes, see `field-notes.md:60`) |
| Validity window | configurable per campaign via `--expiry-days`, default **10 days** (the playbook notes "5-7 days" in `CLAUDE.md:84` as the historical norm; the v0 script defaults to 10) |
| Filtering rules | skip if no `lastOrder`, skip if `displayFinancialStatus != PAID`, skip if no email, skip if `cashback < R$10.00` floor |
| Phone normalization | strip non-digits → 10/11 digits prepend `+55`; 12/13 digits starting `55` prepend `+`; else empty |

**Distribution:** an xlsx is written per run-date to
`G:\Drives compartilhados\GEB_Marketing\Beauty Back\beauty-back_<YYMMDD>.xlsx`
with sheet `final` and columns `First Name | Email | Telefone oficial |
Cashback | Compra mínima | Cupom | Link`. The marketing team imports this into
their own outreach tool (not Klaviyo through the script). This is the canonical
**delivery channel** — Beautyback is NOT sent through Shopify's native
"notify customer" flow.

**State + idempotency:** a per-customer `state.json` at
`gebeauty/state.json` (atomic write, gitignored). Customer
is processed iff their `lastOrder.id` differs from the stored value;
previously-issued codes are best-effort `discountCodeDeactivate`'d before the
new code is created.

### Source 2 — sandbox CLAUDE.md (`gebeauty/CLAUDE.md:74-86`)

> Personalized winback codes sent to past customers. Format:
> `BEAUTYBACK-{batchId}-{code1}-{code2}`
> - Value: fixed R$ amount (≈25% of customer's previous order) OR flat 25%
> - Minimum requirement: set to the customer's previous order subtotal (for
>   fixed amounts) or R$0.01 (for percentage)
> - Usage limit: 1
> - Combines with: order ✓, product ✓, shipping ✓
> - Expiry: set per batch (typically 5-7 days)

(Slight drift from the v0 script: CLAUDE.md says "≈25%" / "min = previous
subtotal" but the implemented script uses 20% cashback / min = 4× cashback. The
script is the source of truth as of 2026-04-27 per the playbook supersedes
note.)

### Source 3 — live Shopify audit (read-only, 2026-05-19)

- Title-search `title:Beauty Back*` returns the historical `BEAUTYBACK-46M1`
  cohort shape: `DiscountCodeBasic`, percentage 25%, min R$0.01, combines
  true/true/true, `appliesOncePerCustomer: true`. Reference node
  `gid://shopify/DiscountCodeNode/1641129312576`. Shape matches the
  `_cashback_lib.build_discount_input()` output.
- A **fresh `CASHBACK15` code was created today 2026-05-19 18:34 UTC** — flat
  15% off, no min, combines true/true/true, `endsAt` 2026-05-28. Surfaced
  as an open question because it may conflict / overlap with the Beautyback
  campaign window.
- `state.json` exists at `gebeauty/state.json` but is
  **empty** — no Beautyback run has ever been issued through the v0 script.
  The 11,698-code historical cohort updated on 2026-03-29 predates the script.

### Source 4 — copy / brand voice

No prior outreach email body was discovered in the repos. Brand voice rules
that apply (per CLAUDE.md feedback memory):

- **Benefit-only language** — no technical ingredient names
  (`feedback_no_em_dash.md`, `project_gebeauty_overview.md`)
- **No em dashes** in customer-facing copy — use commas/periods
- **Bilingual-friendly** — copy reads cleanly in both pt-BR and en

The distribution xlsx column headers are in pt-BR (`Cashback`,
`Compra mínima`, `Cupom`), confirming this is a pt-BR campaign by default.

### What we don't know (gaps in research)

- **Past redemption rates** — not captured in state.json (it tracks issued, not
  redeemed). The 2026-03-29 bulk-combine update operated on 11,698 codes but
  no aggregate redemption stats are stored anywhere I could find.
- **Email/marketing copy** for the outreach itself — not in repo; lives in
  the marketing team's distribution tool.
- **Customer satisfaction / repeat-purchase lift** from past Beautyback — no
  data captured.

---

## 2. Target customer counts + sample lists

Both segments computed by paginating
`customers(query:..., first:250)` against the `2026-01` Admin API at
2026-05-19 ~14:00 BRT. Probe script:
`C:\Users\Lucas Guimarães\AppData\Local\Temp\beautyback-segment-probe-v2.mjs`.
Full results: `C:\Users\Lucas Guimarães\AppData\Local\Temp\beautyback-segment-results.json`.

> **Search-field correction:** Shopify's customer search uses `order_date:...`
> as the field name for last-order date, **not** `last_order_date` (which is
> silently ignored). The v1 probe returned bogus 10k-AT_LEAST counts because of
> this. The v2 numbers below are correct.

### Segment A — lapsed repeat buyers

Query: `order_date:<2026-03-20 AND orders_count:>=2`

| Metric | Value |
|---|---|
| Total customers | **9,790** |
| With email | 9,685 (98.9%) |
| With a PAID last order | 9,729 (99.4%) |
| Aggregate historical LTV | **R$ 6,837,670.43** |
| Avg last PAID subtotal | R$ 227.74 |
| Median last PAID subtotal | R$ 202.89 |
| p90 last PAID subtotal | R$ 393.41 |

Sample (first 10 from the paged set, sorted by `UPDATED_AT desc`):

| Name | Email | Orders | LTV (R$) | Last order | Subtotal (R$) |
|---|---|---|---|---|---|
| roberta catao | rojuliao@gmail.com | 2 | 591.74 | 2025-09-26 | 307.00 |
| Carolina Morizot | carolina.morizot@gmail.com | 10 | 2,974.33 | 2025-12-30 | 438.41 |
| Carolina Zomparelli | carolinazomparelli@yahoo.com.br | 2 | 278.61 | 2026-03-17 | 126.08 |
| Ana Carolina Valle dos Santos | anacarolinavs1@gmail.com | 2 | 1,012.83 | 2025-02-22 | 453.05 |
| Carolina Lavinas | crlavinas@gmail.com | 3 | 836.40 | 2025-09-29 | 339.00 |
| Julia Jannuzzi | juliajannuzzi@hotmail.com | 2 | 342.23 | 2025-11-02 | 103.20 |
| Daniela Santos | dani.sausalito@hotmail.com | 2 | 415.91 | 2025-12-20 | 129.00 |
| Caroline Cruz | carolinecruz1439@gmail.com | 2 | 307.47 | 2026-04-27 | 129.00 |
| Livia de Lemos Maciel | livia.maciel@live.com | 3 | 272.21 | 2026-05-19 | 63.20 |
| Angelica Vasconcelos | angelicavasconcelos6@gmail.com | 7 | 2,558.90 | 2026-05-19 | 289.00 |

> **Race condition note:** Livia, Angelica (and Simone, Lyllie in SEG B sample)
> show `last=2026-05-19` because they purchased again *during* the pagination
> pass. The segment query was correct at fetch-start; the sample row reflects
> post-fetch state. Cross-segment dedup before issuance is required (Open
> Question #4).

### Segment B — active / recent

Query: `order_date:>=2026-03-20 AND orders_count:>=1`

| Metric | Value |
|---|---|
| Total customers | **6,342** |
| With email | 6,214 (98.0%) |
| With a PAID last order | 6,319 (99.6%) |
| Aggregate historical LTV | **R$ 2,236,964.10** |
| Avg last PAID subtotal | R$ 179.56 |
| Median last PAID subtotal | R$ 146.26 |
| p90 last PAID subtotal | R$ 341.60 |

Sample (first 10):

| Name | Email | Orders | LTV (R$) | Last order | Subtotal (R$) |
|---|---|---|---|---|---|
| Livia de Lemos Maciel | livia.maciel@live.com | 3 | 272.21 | 2026-05-19 | 63.20 |
| (no first name) | jannuzzi.carol@gmail.com | 1 | 218.00 | 2026-05-19 | 218.00 |
| Caroline Cruz | carolinecruz1439@gmail.com | 2 | 307.47 | 2026-04-27 | 129.00 |
| Renata Aquino | renata_aquino28@yahoo.com.br | 1 | 151.00 | 2026-05-19 | 141.10 |
| Thais Lessio Nicolau | thaislessio@gmail.com | 1 | 189.50 | 2026-05-13 | 175.00 |
| Vanesssa Zanon | van_raqui@hotmail.com | 1 | 233.69 | 2026-05-14 | 216.60 |
| Ellen Caroline ropoli funchal | Ellencrop1@gmail.com | 1 | 511.74 | 2026-05-13 | 491.00 |
| Angelica Vasconcelos | angelicavasconcelos6@gmail.com | 7 | 2,558.90 | 2026-05-19 | 289.00 |
| Simone Barem | sbarem@gmail.com | 2 | 564.65 | 2026-05-19 | 89.10 |
| Lyllie Cardoso | lymameri@hotmail.com | 2 | 331.12 | 2026-05-19 | 79.00 |

### Combined gross outreach pool

- **A ∪ B**: ≤16,132 customers gross (some overlap because of in-flight orders
  during pagination; expect <50 actual duplicates).
- **With email AND PAID last order**: ≈ A:9,615 + B:6,191 ≈ **15,806** addressable.

---

## 3. Proposed coupon spec

The spec preserves the canonical Beautyback mechanic from
`actions-unlocked/issue-beautyback-cashback.md` so the marketing team's
existing xlsx-import distribution flow keeps working. **Two campaigns, one
script run each, different `--campaign-id` + `--expiry-days` per segment to
match outreach urgency.**

### Segment A — campaign `2026-05-A-beautyback-lapsed`

| Parameter | Value | Rationale |
|---|---|---|
| Code prefix | `BEAUTYBACK` | matches historical and existing script |
| Code body | `AAAA-BBBB-CCCC` random per customer | per-customer unique, single-use |
| Discount title | `Beauty Back \| <email>` | admin attribution per recipient |
| Value | 20% of last PAID subtotal (fixed R$) OR flat 25% if min > R$200 | canonical rule; preserves existing cutover |
| Min cart | `4 × cashback` (fixed branch) or R$0.01 communication-only (percentage branch) | canonical |
| Cashback floor | R$ 10.00 (skip below) | canonical, drops ~marginal customers |
| Expiry | **14 days** (recommend lengthening from default 10) | lapsed cohort needs longer to re-engage; 14d ≈ 2 weekends |
| Customer scope | `all: true` | code-based, 1:1 distribution via xlsx |
| `usageLimit` | 1 | belt-and-braces single-use |
| `appliesOncePerCustomer` | true | redundant w/ usageLimit but matches historical shape |
| Combines | order ✓, product ✓, shipping ✓ | matches 2026-03-29 bulk update |
| Idempotency tag | `beautyback-2026-05-A` on each issued customer | enables cross-segment dedup and future re-run guard |
| Notification | **xlsx only** — marketing distributes via outreach tool | canonical; NOT Shopify-native `notify:true` (which only fires on store-credit) |
| State | flush per-create to `state.json`, `--campaign-id 2026-05-A-beautyback-lapsed` |

**Estimated issuance:**
- ~9,729 customers with PAID last order
- After ≥R$10 cashback floor (i.e. last subtotal ≥ R$50): expect ~9,500
- Fixed-R$ branch (last subtotal ≤ R$1,000, i.e. cashback ≤ R$200): ~95% → ~9,025
- Percentage branch (25% off, min R$0.01): ~5% → ~475

### Segment B — campaign `2026-05-B-beautyback-active`

| Parameter | Value | Rationale |
|---|---|---|
| Same mechanic as A | (all rows above) | preserves brand consistency |
| Expiry | **7 days** (recommend shortening from default 10) | active cohort doesn't need a long ramp; tight window drives urgency on a customer who just bought |
| Idempotency tag | `beautyback-2026-05-B` | distinct from A so dedup is observable |
| Value posture | Same 20%/25% rule | OPEN QUESTION #1 — see below; possible argument for a smaller offer to active customers since they're not at-risk |

**Estimated issuance:**
- ~6,319 customers with PAID last order
- After ≥R$10 cashback floor: expect ~5,900
- Fixed-R$ branch: ~96% → ~5,664
- Percentage branch: ~4% → ~236

### Idempotency + cross-segment dedup

1. **In-segment idempotency**: the existing `state.json` lookup keyed on
   `customer_gid` + `last_order_id` already prevents double-issuance within a
   run.
2. **Cross-segment idempotency**: add a Shopify customer tag
   `beautyback-2026-05-<A|B>` on each successful issue (mirrors the
   fiscal-hold pattern `ld_fiscal-hold-credited-2026-05` from
   `extrema-phase4-issue.mjs:9`). Before issuing in segment B, **skip any
   customer already tagged `beautyback-2026-05-A`**. This dodges the
   pagination-race overlap (~tens of customers).
3. **Re-run safety**: re-running either script after the initial pass
   short-circuits via state.json (no new code created if `last_order_id`
   hasn't moved).

### Script outline (do not execute)

Reuse the existing `cashback_generate.py` with two invocations:

```bash
cd c:\claude\gebeauty

# Dry-run both first
python scripts/cashback_generate.py \
  --campaign-id 2026-05-A-beautyback-lapsed \
  --expiry-days 14 \
  --dry-run --limit 5

python scripts/cashback_generate.py \
  --campaign-id 2026-05-B-beautyback-active \
  --expiry-days 7 \
  --dry-run --limit 5

# Live runs (after approval)
python scripts/cashback_generate.py \
  --campaign-id 2026-05-A-beautyback-lapsed --expiry-days 14
python scripts/cashback_generate.py \
  --campaign-id 2026-05-B-beautyback-active --expiry-days 7
```

**Gap to close before live:** the existing script does NOT add a customer tag,
and does NOT filter by `order_date` / `orders_count`. Two patches needed
before either live run:

1. **Add segment-filter flags** `--last-order-before YYYY-MM-DD`,
   `--last-order-on-or-after YYYY-MM-DD`, `--min-orders-count N`. Apply the
   filter in the existing `fetch_eligible_customers()` pagination by passing
   `query` to the GraphQL `customers(...)`.
2. **Add idempotency tag** `--idempotency-tag beautyback-2026-05-A` —
   `tagsAdd` mutation after successful `discountCodeBasicCreate`; on next-run
   skip if tag already present (cheap check at top of loop).

These patches keep the canonical Beautyback shape intact and are additive
(default behavior unchanged for prior runs).

---

## 4. Aggregate cost projection

**Assumptions:**
- Cashback grant rate: 20% of last PAID subtotal (script default).
- Redemption rate: 12% (industry-standard winback for lapsed; 18% for active —
  conservative midpoint).
- Customers who DO redeem buy at avg last PAID subtotal as the next-order
  proxy (rough — typically lower because of the 4× min on fixed-R$ branch,
  but offset by upsell on percentage branch).
- All issued cashback that gets redeemed represents discount cost; unredeemed
  has zero cost (single-use code, deactivated at expiry).

### Segment A — lapsed (9,500 estimated issuance)

| Line | Value |
|---|---|
| Avg cashback per customer | R$ 227.74 × 0.20 = **R$ 45.55** |
| Total cashback granted | 9,500 × R$ 45.55 ≈ **R$ 432,725** |
| Estimated redemption @ 12% | 1,140 customers |
| Estimated discount cost | 1,140 × R$ 45.55 ≈ **R$ 51,927** |
| Estimated redeemed gross revenue | 1,140 × R$ 227.74 ≈ **R$ 259,624** |
| Effective discount % on redeemed orders | 20.0% |
| Net revenue (after discount) | ≈ **R$ 207,697** |

### Segment B — active (5,900 estimated issuance)

| Line | Value |
|---|---|
| Avg cashback per customer | R$ 179.56 × 0.20 = **R$ 35.91** |
| Total cashback granted | 5,900 × R$ 35.91 ≈ **R$ 211,869** |
| Estimated redemption @ 18% | 1,062 customers |
| Estimated discount cost | 1,062 × R$ 35.91 ≈ **R$ 38,137** |
| Estimated redeemed gross revenue | 1,062 × R$ 179.56 ≈ **R$ 190,693** |
| Effective discount % on redeemed orders | 20.0% |
| Net revenue (after discount) | ≈ **R$ 152,556** |

### Combined campaign

| Line | A | B | Total |
|---|---|---|---|
| Customers issued | 9,500 | 5,900 | **15,400** |
| Total cashback granted (notional) | R$ 432,725 | R$ 211,869 | **R$ 644,594** |
| Expected redemption | 1,140 | 1,062 | **2,202 redemptions** |
| Expected discount cost | R$ 51,927 | R$ 38,137 | **R$ 90,064** |
| Expected gross revenue | R$ 259,624 | R$ 190,693 | **R$ 450,317** |
| Expected net revenue | R$ 207,697 | R$ 152,556 | **R$ 360,253** |

**Sensitivity:** if A redemption is half (6%) and B is half (9%), expected
discount cost ≈ R$ 45K and net revenue ≈ R$ 180K. If redemption is double,
discount cost ≈ R$ 180K and net revenue ≈ R$ 720K. The win-back economics
are dominated by **lift over the no-discount baseline**, not raw revenue —
the right post-campaign analysis is matched-cohort vs. control.

---

## 5. Open questions for Lucas

These are the gating decisions before issuance:

### Q1. Differentiate value between A and B, or hold them identical?

The canonical script applies the same 20% / 25% rule to everyone. For this
campaign we have two reasons to consider differentiating:

- **A is the lapsed cohort** — bigger psychological gap to bridge, conventional
  win-back wisdom says bigger lever.
- **B is the active cohort** — discount-eating risk; they were going to buy
  anyway, so the discount is closer to pure margin erosion.

Three options:

- **Identical 20%/25%** (canonical) — simplest, matches existing brand
  pattern, easiest to A/B-compare in future runs.
- **A:25%/30%, B:15%/20%** — bias the lapsed cohort up, the active cohort
  down. Best for margin defense.
- **A:20%/25%, B:10% flat percentage no min** — keep A canonical, treat B
  as a soft thank-you rather than a winback.

### Q2. Expiry windows — confirm 14d / 7d split?

The canonical default is 10d. Recommendation above is **14d for A** (lapsed
need ramp) and **7d for B** (active reads urgency). Alternative: stick with
canonical 10d for both for simplicity and easier comparison to prior runs.

### Q3. Conflict with active `CASHBACK15` discount?

A code `CASHBACK15` was created today 2026-05-19 18:34 UTC — 15% off, no min,
no customer scope (anyone can use), end 2026-05-28. If a customer holds both
a Beautyback code AND knows `CASHBACK15`, they'll pick whichever is bigger.
For Segment B with R$10-50 cashback, `CASHBACK15` likely wins on small carts.
Do we (a) postpone Beautyback until CASHBACK15 expires (2026-05-28), (b) ship
both and accept overlap, or (c) deactivate CASHBACK15 first?

### Q4. Confirm dedup direction across A and B?

Some customers are technically in BOTH segments because of the in-flight
ordering race during pagination (Angelica, Livia, Simone, Lyllie surfaced in
both samples). Recommendation: **issue A first, tag with
`beautyback-2026-05-A`, then in B skip anyone already tagged**. This is the
natural fit because A's "lapsed" segment was defined at one moment in time —
if a customer bought during the pass, they semantically belong to B going
forward, but A already has them assigned. Alternative: issue B first
(active gets priority).

---

## 6. Recommended next action

Patch `cashback_generate.py` with `--last-order-before/--last-order-on-or-after`,
`--min-orders-count`, and `--idempotency-tag`, then dry-run both campaigns
with `--limit 10` and review the smoke checkpoint before approving the live
double-pass (A first, then B with cross-tag dedup).
