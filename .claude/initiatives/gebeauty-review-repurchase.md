---
id: gebeauty-review-repurchase
name: GE Beauty review-for-reward + repurchase campaign
owner: shared
status: in-progress
priority: high
created: 2026-07-06
target: null
current_phase: 3-pilot-build
next_blocker: Loox Merchant API now WIRED (Convert plan; key + publicStoreId in gebeauty/.env; corpus pulled, exclusion refreshed by customerId). Two items still gate launch — (1) one-line check that link-submitted photo reviews fire the Loox reward (copy decider; fallback = attach a Shopify code); (2) approve the WhatsApp copy (4 variants). Base is pilot-ready (links + 10% holdout).
next_owner: lucas
stakeholders:
  - GE Beauty
  - Loox (reviews + reward engine)
  - Zoko (WhatsApp channel)
working_agreement: ~/.claude/projects/c--Users-Lucas-Guimar-es-Desktop-nami-works/memory/feedback_cto_contract.md
---

## Why

Two goals, one motion: grow the Loox review corpus where it's thin (social proof drives
PDP conversion) and pull repeat revenue from proven-happy buyers. Loox already handles
review asks for fresh orders, but its retroactive reach dies at 90 days — so the real
untapped asset is the backlog of tens of thousands of happy historical buyers who never
reviewed and are due to repurchase. We reach them via Zoko WhatsApp with a per-product
Loox review link; the Loox photo-review reward code becomes the repurchase discount, so a
single message does both jobs (review -> reward -> restock).

## Winner strategy (locked 2026-07-06)

One unified customer-level engine. Per targeted customer: ONE WhatsApp, ONE product, a
photo-review ask via that product's Loox `?ref=review` link, where the reward code is the
repurchase incentive. Loox = review hosting + reward. Zoko = channel + the intelligence
Loox lacks (thin-corpus allocation, lifetime reach, targeting). Leave Loox's native
auto-emails ON as the free baseline for new orders.

- **Eligibility (positive-feedback by construction):** bought + not returned + past usage
  window; advocate (repeat) = strongest signal.
- **Empirical refill windows** (median 1st->2nd gap): derived per product, not guessed.
- **Goal-aware review allocation for multi-product buyers:** advocates -> their thinnest-
  corpus product (marginal win = the review); one-time due-to-refill -> the product they're
  due to refill (marginal win = repurchase; reward converts it); thin-corpus as tiebreaker.
  Review target policy = level-up-to-a-floor (~150 reviews/product), skewing asks to thin
  corpora (Antifrizz 42, Shampoo a Seco 41, Pluma 36, Antioxidante 32, Mayday 19).
- **Discipline:** 10% holdout for attribution; waves not a blast; cross-wave fatigue
  suppression (don't re-message within N days); WhatsApp-only (91-93% phone coverage).

## Loox findings (2026-07-06 research)

- Native asks: one email per order for ALL products in it (bundled by fulfillment) +
  reminders. No prioritization, no cross-order intelligence.
- Retroactive: "bonus" emails only 90 days back, once at install (window spent for GE).
- Per-product review link exists: `www.gebeauty.com.br/products/<handle>?ref=review`
  (generic, any order age; NOT attributed -> no "verified" badge). This is our lever.
- API read-only (can't create requests); Merchant API gives corpus w/ emails+order IDs;
  webhooks fire on review-created. Both Convert/Unlimited-plan only.
- Reward = blanket photo/video discount (unique one-time codes). Confirm it fires for
  link-submitted reviews; fallback = attach a Shopify discount to the WhatsApp.

## Scorecard (pooled buyers; delivered, non-refunded)

| Product | Buyers | Repeat% | Refill gap | Reviews |
|---|--:|--:|--:|--:|
| Leave-in Proteção Térmica | 17,051 | 14% | 169d | 306 |
| Booster Definição | 16,431 | 8% | 184d | 195 |
| Shampoo Sem Sulfato | 13,019 | 20% | 125d | 207 |
| Máscara Condicionadora | 12,461 | 20% | 131d | 190 |
| Body & Hair Mist (all scents) | 11,008 | 6% | 63d | 116 |
| Booster Hidratante | 10,375 | 8% | 174d | 71 |
| Booster Antifrizz | 7,287 | 6% | 95d | 42 |
| Shampoo a Seco | 6,158 | 9% | 201d | 41 |
| Booster Fortificante | 5,757 | 9% | 171d | 75 |
| Leave-in Pluma | 5,325 | 4% | 104d | 36 |
| Booster Antioxidante | 2,602 | 6% | 188d | 32 |
| Máscara Mayday | 2,644 | 2% | 58d | 19 |

Primers (Cachos 9,960 / Liso 6,991) = pilot cohort.

## Pilot (primer base — ready)

`gebeauty/primer-campaign-base.xlsx` — 5,341 unique WhatsApp contacts, deduped by
customer then phone, Loox reviewers excluded, curated first name + E.164 phone + per-product
review link + deterministic 10% holdout.

| Segment | Contacts |
|---|--:|
| cachos_advocates | 354 |
| cachos_refill | 3,006 |
| liso_advocates | 267 |
| liso_refill | 1,714 |
| **SEND / HOLDOUT** | **4,798 / 543 (10.2%)** |

## Rollout waves (post-pilot)

1. Pilot: primers (ready).
2. Wave 1 — routine staples (Shampoo Sem Sulfato + Máscara Condicionadora @ 20% repeat +
   Leave-in Térmica). Best repurchase ROI.
3. Wave 2 — booster line (max reach + biggest review upside).
4. Wave 3 — Mist (tight 63d window), Shampoo a Seco, Pluma. Hold Mayday (too new).

## Phases

- [x] 1. Discovery & sizing — buyer base, empirical windows, segments — done 2026-07-04
- [x] 2. Strategy locked — unified engine + Loox research + allocation rule — done 2026-07-06
- [ ] 3. Pilot build — base + holdout DONE; copy + personalized-offer + unified template DONE (2026-07-07); remaining: wire template/subject in Shopify + R$1 self-test — IN PROGRESS, owner: shared
- [ ] 4. Pilot launch & measure — Zoko send vs holdout; Loox webhook lift + repurchase rate
- [ ] 5. Scale — Wave 1/2/3 + generalize builder into a parameterized engine + fatigue suppression

## Core learning question (drives the whole learning phase)

**When is reactivating a customer with store credit most effective?** i.e. at what
*recency* (days since last order) does a store-credit nudge produce the highest incremental
repurchase, net of credit cost. Answered by per-band SEND-vs-HOLD lift in
`retention-machine/measure_reactivation.py` → `learning/readout-<date>.md`. Historical
hypothesis (natural-return curve, not causal): sweet spot ~90-270d, centered ~120-180d; avoid
<60d (cannibalization), taper >270d. The campaign's stratified holdout gives the causal answer,
which becomes the targeting rule for the future automatic campaign.

## Notes

- 2026-07-07 (PM): **Refill wave fired + measurement instrumented + 7/7 sale-day test live.**
  - **Refill wave issued:** 176 SEND (45-59d), R$7,898, expiry = max(order+60d, today+3d) [3-day grace,
    40 floored to 07-10]; 19 HOLD control. Frozen to `learning/sends.jsonl` (wave `2026-07-07-ge45-59d-refill`).
    Script `issue_refill.py` (smoke-pause-at-3, resumable).
  - **Early reactivation read (day ~1):** SEND 0.51% bought (71/13,935, R$15.7k, 63 redemptions) vs HOLD
    0.00% (0/1,621). Buy-rate by band peaks at **90-120d = 1.16%**, then 60-90d 0.71%; deep tail weaker.
    Directional only (tiny cells).
  - **Measurement layer:** every cohort tagged (both arms) with **dated** (`retention-reactivation_26-07-06`,
    `retention-refill_26-07-07`, `..._control_...`) + **stable** (`retention-reactivation[_control]`,
    `retention-refill[_control]`) tags via `retag_arms.py` (15,751 customers). Dated = per-wave lift; stable =
    long-term revenue/suppression, survives pruning. Native Shopify segments + UTM report recipes documented.
  - **Holdout hardened:** switched `store_credit_push.py` from `md5(phone)` to `md5(customer_id)` — immune to
    phone reformatting. **SEAM:** waves <= 07-07 used phone-hash; GID-hash from next cohort build (one-time reshuffle).
  - **WhatsApp templates (Zoko buttonTemplate):** `retention_below60d_v2` (refill, 5 args, product = name-up-to-two
    "X, Y e outros itens" + mists as scent-only, weekday validade for this-week expiries) and
    `retention_above60d_v2` (reactivation, **4 args, no product var**). Both need `type:"buttonTemplate"`; the
    5th/last arg is the **full button URL** (bake UTM there).
  - **7/7 sale-day test LIVE (H-SALEDAY-PUSH-01):** reactivation 60-120d non-redeemers, random 50/50 by GID hash.
    **Arm T = 1,142 fired today** (rides the 7/7 double-date), `above60d_v2`, validade "13/07", UTM `push_today`.
    **Arm C = 1,185 held for 07-11** (ordinary day), UTM `push_scheduled`. Metric: 48h-post-push redemption T vs C.
    Log: `learning/whatsapp-saleday.jsonl`. Confound logged as **H-CALENDAR-01** (7/7 may inflate; holdout nets
    general uplift, residual = credit x sale-day interaction).
  - **Connection-drop recovery:** mid-broadcast the network cut (811 `getaddrinfo` errors); `whatsapp_saleday.py`
    logs only successes, so re-running `--arm T --apply` resumed and backfilled to **1,142/1,142, zero duplicates.**
    Pattern: send scripts must be resumable-by-success-log.
  - **Next:** (1) Arm C send **07-11** (`whatsapp_saleday.py --arm C --apply`, confirm first); (2) refill reminders
    2-days-before-expiry to non-redeemers (grace group 08-07) via `below60d_v2`; (3) wire `measure_reactivation.py`
    for both waves (redemption + net revenue + per-band); (4) enrich refill snapshot to match reactivation schema.

- 2026-07-07: **Personalized offerings + unified template shipped (build).** Two-axis personalization
  now lives in ONE permanently-wired "Store credit issued" notification
  (`retention-machine/emails/store-credit__notification.liquid`) — no more swapping templates
  between waves.
  - **Offer axis:** per-customer product recs in `custom.recommended_products` (list.product_reference,
    top 3), written by `retention-machine/write_recommendations.py`. Engine = item-item **lift**
    (popularity-adjusted) + **hair-type guard** (never cross curl↔straight) + **1-mist cap** (2 routine
    complements + ≤1 fragrance mist, matching the copy's "rotina + novos favoritos"). Fallback to the
    3 launch mists when empty. **46,318 metafields written** (whole owner base) 2026-07-07.
  - **Situation axis:** subject + body + `utm_campaign` all branch on `custom.credit_context`
    (`reactivation` / `refill`, **default `refill`**). Policy lives in the issuance pipeline (stamp the
    flag before a reactivation wave); **refill waves need no stamp** (default). Preheader carries the
    personalized amount + urgency (subject is Shopify-controlled but accepts Liquid; branched subject
    line drafted).
  - **Prereq unblocked:** token gained `write_customers` (Lucas, 2026-07-07); metafield definition
    `custom.recommended_products` created (`gid://…/MetafieldDefinition/223106695488`).
  - **Pending verify:** wire template+subject into Shopify → R$1 self-test on Lucas (only real way to
    confirm notification resolves product-reference metafields + subject metafield; "send test" uses a
    dummy customer). Safety-net `credit_headline` metafield NOT built — add only if branched subject
    renders blank.
  - **Future improvement registered:** `H-CROSS-TEXTURE-01` in `learning/hypotheses.md` — loyalty-gated
    "redescubra sua textura natural" cross-sell (offer Booster Definição to *loyal* straight-hair
    customers, overriding the guard; watch sentiment).
- 2026-07-06: **Zoko send gotcha (resolved).** `POST chat.zoko.io/v2/message` looks templates up by
  (templateId + templateLanguage + **type**). The `type` field MUST equal the template's
  `templateType` — our templates are **`buttonTemplate`**, so send with `type:"buttonTemplate"`
  (NOT the generic `"template"`, which returns a misleading "template not found for id+language"
  404 even for approved templates). Header: `apikey`. Confirmed working: cashback_expiration_reminder
  + retention_60d both delivered (200/202) to +5511972776427. The future daily WhatsApp push job
  must use `type:"buttonTemplate"`.
- 2026-07-06: **Hypotheses backlog registered** at `retention-machine/learning/hypotheses.md`.
  Headline (Lucas): **H-TIMING-01** — send ~15 min before each customer's own purchase time,
  bucketed into 30-min chunks ("if they buy at 1PM they're on their phone then; a good offer
  cuts through the noise") vs a fixed 13-14h send. Test = 50/50 within the 9h-21h window,
  metric redemption + Zoko read rate.
  Observational per-person timing was weak (weekday 47% vs 43% random; hour-block 65% vs 63%),
  but this is an *attention-timing* causal test, not a habit claim, so it stays on the backlog.
  Also registered: weekday-snap (deprioritized), expiry-duration (cross-wave), credit-vs-review
  2nd-purchase, recency-window (live).
- 2026-07-06: **Second-purchase conversion test designed** (the higher-leverage half). Insight:
  only 20% of customers ever repeat (80% one-and-done), and ~6% repurchase within 60d naturally,
  so crediting recent buyers is LOW cannibalization (corrects an earlier assumption). The 1st→2nd
  purchase is the top LTV lever. Test targets **<60-day ONE-TIMERS** (3,279; 2,975 w/ phone) as
  3 arms — Holdout 15% / Store credit (notify-off + WhatsApp gift framing, 21d expiry) / Review-ask
  (Loox link) — across timing bands 0-30d vs 31-59d, via WhatsApp (unblocked from the reactivation
  email template). Metric: 2nd-purchase conversion vs holdout, net of cost. Spec:
  `inputs/growth-gebeauty-second-purchase-test-2026-07-06.md`. Deps: `ZOKO_API_KEY` + copy.
- 2026-07-06: **Reactivation store-credit send EXECUTED.** Folder renamed
  `review-repurchase-machine` → `retention-machine`. Template saved in Shopify (notify email).
  Snapshot froze **15,556** learning records (SEND 13,935 + HOLD 1,621) across recency bands to
  `learning/sends.jsonl`. Pilot 25 issued clean, then full bulk issuance running: >=60-day wave,
  20%-of-last-order credit (R$120 cap / R$10 floor), **7-day expiry (exp 2026-07-13)**,
  `notify: true` → reactivation email fires (endowment card + 3 new mists + UTM'd CTA). Max
  exposure ~R$633k (redemption-gated). Idempotent/resumable via `issue-reactivation-state.json`.
  Cadence: email Day 0 → WhatsApp reinforce non-redeemers Day 3 → final warning Day 5-6.
  NEXT: run `measure_reactivation.py` at +3d/+7d for the per-band lift readout; wire the WhatsApp
  reinforcement (needs `ZOKO_API_KEY`); build the <60-day still-active variant.
- 2026-07-06: **Store-credit reactivation push = the revenue-first opener** (Lucas: need cash in ~2
  weeks + max reach + per-customer R$120/no total cap + login accepted). Feasibility gate CLEARED:
  Shopify Plus, `storeCreditAccountCredit`(+expiresAt)/`storeCreditAccountDebit` verified, 60-day
  expiry already in production, 131 customers issued+redeemed credit today. Cohort built:
  `retention-machine/store_credit_push.py` → 16,359 due-to-refill (SEND 14,666 / HOLD 1,693),
  max exposure R$668k (redemption-gated), avg R$45.55. Spec:
  `inputs/growth-gebeauty-store-credit-push-2026-07-06.md`. NEXT: confirm-gated smoke test (3 issues)
  before bulk; WhatsApp copy approval; conscious call on uncapped R$668k exposure. This is revenue-first
  with a 10% holdout — the clean 3-arm (code-vs-credit, free-vs-earn) tests are the next wave.
- 2026-07-06: **Engine v1 built + validated** at `gebeauty/retention-machine/`
  (`README.md` spec, `config.json` rules, `engine.py`). Session-independent: live-pulls Shopify
  (bulk) + Loox each run (12h cache), config-driven, 10% holdout. Rules live: repeat-of-same-
  product beats thin-corpus; C-before-D priority; store-credit win-back. Validated run: Stream A
  35,164 (4,686 advocate / 30,478 thin-corpus), C 444, D 3,775. Caught + fixed an ID-format bug
  (Loox bare-numeric vs Shopify GID) that had silently zeroed corpus/reviewer/C matching.
  REMAINING: (1) persist a send-log/`state.json` for reminder cadence + cooldown (Stream B
  timing depends on it); (2) Stream B needs `ZOKO_API_KEY` (Zoko engagement); (3) Stream C
  code pre-apply needs a per-customer Loox reward-code source (Loox reviews API doesn't expose
  the issued code — need a Loox export or Shopify discount-code map); targeting already works;
  (4) waves = scope products in config (pilot = primer IDs).
- 2026-07-06: **Loox Merchant API live.** Convert plan; creds in `gebeauty/.env`
  (`LOOX_API_KEY`, `LOOX_PUBLIC_STORE_ID` = `M3tBbH2WGj.<hash>`). Endpoint
  `api.loox.io/api/v1/store/<id>/product-reviews` (page-based, header `X-Api-Secret-Key`,
  browser UA required or Cloudflare 1010). Pulled full corpus = **2,327 reviews** (CSV had
  1,882 — stale). Saved `store-reviews-corpus.json` + `loox-reviewers-by-product.json`.
  Refreshed primer Review-Eligible by customerId (authoritative): cachos 84 / liso 50
  reviewers in-base, 30 rows newly excluded. **Corrected review counts supersede the
  CSV-based scorecard above** — notably Antifrizz 89 (not 42, drop as thin target),
  Hidratante 89, Pluma 58, Definição 154. Thinnest heroes now: Mayday 26, Antioxidante 33,
  Pluma 58, Shampoo a Seco 59, Liso 70. Retune wave thin-corpus allocation to these.
- 2026-07-06: Base made pilot-ready — added per-product `?ref=review` links + deterministic
  (md5-by-phone) 10% holdout. Exclusion currently from `data/reviews.csv`; swap to Merchant
  API once key provided for exact corpus + live suppression.
- 2026-07-06: Strategy + Loox capability research complete. Twist vs primers-first instinct:
  staples repurchase 5x better (20% vs 4%) — repurchase ROI concentrated there, but primers
  are the low-risk pilot to validate the Zoko->Loox-link->reward->repurchase loop end to end.
- Builder: `scratchpad/build_primer_base.py` (generalize to any product ID for waves).

## Done means

Validated loop (pilot beats holdout on review creation + repurchase rate), then the staple
and booster waves shipped through a repeatable, fatigue-safe engine, measurably lifting the
thin-corpus review counts and repeat-purchase revenue.
