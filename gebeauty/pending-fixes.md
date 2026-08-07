# GE Beauty — Pending Fixes

Low-urgency issues discovered during operations. Fix when convenient; not blocking anything active.

---

## Shopify

### GEB 121 assinatura — duplicate EAN
- **What:** Variant "Máscara Mayday (assinatura)" has barcode `0042882635451`, same as GEB 024 (Melon Mood Body & Hair Splash).
- **Impact:** No B2B impact (assinatura is excluded from all external catalogs). Physical scanning of the assinatura variant would resolve to the wrong product.
- **Fix:** Assign a correct unique EAN to the assinatura variant in Shopify admin.
- **Found:** 2026-06-12

---

## Growth / tracking

### primeira-rotina R$95 cohort — measurement wiring (backlogged by Lucas 2026-07-25)
- **What:** Clean cohort tagging + per-hook downstream-margin join aren't wired. Needed: (a) tag the customer at order creation `cohort:primeira-rotina-r95` + order tags `pr-bundle-a`/`pr-bundle-b`; (b) persist `utm_content` (hook slug) into an order note attribute at checkout (session UTMs don't reach the order); (c) align the LP acq-arm UTM to `utm_campaign=primeira-rotina-r95`.
- **Impact:** NOT a launch blocker (Lucas's call). Cohort payback is still computable via the two bundle product GIDs (`10212940448064`/`10212940120384`) → customer → subsequent orders, and the hook test ranks on Meta leading indicators (CTR/CPC/cost-per-ATC) which don't need this. What's deferred: joining per-hook spend to DOWNSTREAM margin in Module A (precision upgrade).
- **Fix:** /integrations-engineer — order/customer tagging automation + cart-attribute capture of `utm_content`. Spec context: `gebeauty/growth/campaigns/primeira-rotina-r95/manifest.md` + the acquisition-rescue initiative.
- **Found:** 2026-07-25

---

## Retention / recs personalization

### `core-target` tag removal via Flow not working yet
- **What:** `core-target` marks customers who haven't received BOTH fidelity-driver products (Shampoo Sem Sulfato + Máscara Condicionadora), for recs targeting. Backfilled 2026-07-31 via `growth/retention-machine/tag_core_target.py` (42,995 of 51,166 customers tagged; bundle purchases correctly attributed via component line items, no bundle-definition lookup needed). Removal — untagging once a customer buys both — was meant to run as a Shopify Flow, but Lucas confirmed it isn't working yet.
- **Impact:** the tag will drift stale (customers who complete the duo after the backfill stay tagged) until the Flow is fixed. Not urgent — no downstream automation reads this tag yet.
- **Fix:** debug/rebuild the Flow (trigger: order paid containing both product ids across the order's cumulative history, not just the single order — a customer often buys the two products in separate orders). Until then, a periodic re-run of the equivalent logic as a removal script is the fallback.
- **Found:** 2026-07-31

### Move store-credit issuance to real-time (purchase-triggered); demote the wave to a reminder/nudge
- **What:** Today's store-credit issuance runs as a batch/wave well after the fact — a
  "post-mortem" issuance built from a cohort snapshot pulled that morning, not triggered
  at the moment each qualifying purchase/lapse event actually happens (this session's
  August wave issued to 14,545 customers this way). Proposal: build a process so credit
  lands on the account immediately after the triggering purchase (real-time, not batch),
  and repurpose the existing wave/batch mechanism from *issuing* credit into a secondary
  *reminder/nudge* — e.g. "you still have R$X, don't forget to use it" — rather than the
  issuance event itself.
- **Impact:** Not blocking anything active — flagged by Lucas right after the August
  wave shipped, explicitly deferred to backlog. Needs scoping before it's buildable: the
  reactivation program's whole premise is *lapsed* customers who haven't purchased
  recently, so "issue immediately after purchase" doesn't map cleanly onto that mechanic
  as-is — whoever picks this up needs to clarify with Lucas which purchase event should
  trigger real-time issuance (a *repurchase* that ends the lapse? a *different*,
  non-reactivation credit mechanic entirely?) before design/build starts.
- **Fix:** Real-time trigger (order-paid webhook or a tight poll) + credit issuance
  reusing the existing `storeCreditAccountCredit` mutation pattern already proven in
  `gebeauty/growth/retention-machine/dual_arm_issue.py` / `issue_reactivation.py`. The
  wave/cohort builder (`store_credit_push.py`) would shift role from primary issuance to
  a reminder-only send referencing already-issued, unredeemed credit.
- **Found:** 2026-08-07

### Snapshot segment tags at issuance time, not reconstruct them after the fact
- **What:** `core-target`/`missing-mascara`/`missing-shampoo` tags are removed by a
  Shopify Flow once a customer's underlying condition resolves (they buy the missing
  product) — so a live tag query can never reconstruct which segment a customer was
  actually in AT SEND TIME for a wave that already fired. The August wave
  (`2026-08-07-ge60d`) didn't capture this at issuance; patched same-day with a one-off
  bulk-tag export filtered to the 16,143 wave members
  (`learning/segment-tags-snapshot-2026-08-07-ge60d.jsonl`), which is only a same-day
  proxy (taken hours after send — any customer who already converted and had their tag
  flipped in that window is invisible to it too).
- **Impact:** Every future wave has the same blind spot unless fixed at the source.
  Doesn't block the August wave's readout (day-0 numbers don't depend on segment
  breakdown yet), but segment-cut lift analysis on THIS wave rests on an imperfect
  proxy, and every subsequent wave will repeat the gap unless the issuance script itself
  changes.
- **Fix:** Inside `dual_arm_issue.py` / `issue_reactivation.py` (or their successors),
  read and stamp each customer's seg/ctx-relevant tags into the per-row record written to
  `sends.jsonl` at the moment of issuance — no separate snapshot step, no reconstruction
  needed later.
- **Found:** 2026-08-07

### Store-credit email intro text needs to adapt to the new recs layout (Lucas, 2026-08-04)
- **What:** the general intro line above the recs block ("Reabasteça seu essencial ou dê o próximo passo na jornada do cabelo saudável.") was written for the old 3-mist block and now sits directly above the recs section's own punchline ("Dê o próximo passo na jornada do cabelo saudável ou se reabasteça!") — near-duplicate messaging back to back.
- **Impact:** redundant copy once the missing-mascara/missing-shampoo/core-target recs redesign ships; not blocking mockup iteration.
- **Fix:** rework the intro line once the recs-block copy is finalized across all three segments, so the two lines complement rather than repeat each other.
- **Found:** 2026-08-04

---

## B2B registrations

### GEB 121 (Máscara Mayday) — missing physical specs
- **What:** Comprimento, Largura, Altura, Peso Bruto, Peso Líquido still blank in the Rappi NOVOS PRODUTOS file. Not found in any source file including Unilog.
- **Impact:** Rappi registration incomplete for GEB 121 until specs are provided.
- **Fix:** Once Raphael responds (email sent 2026-06-12), fill in the Rappi file and products.json.
- **Found:** 2026-06-12
- **Note:** GEB 029 specs were resolved via Unilog file (2026-06-12) — dimensions 40×45×140mm, gross 100g.

### GEB 029 (Melon Mood Mini) — units_per_carton conflict
- **What:** Lucas stated 49 units/box; Unilog file says 36. products.json and Rappi file currently have 36 (Unilog value).
- **Fix:** Confirm canonical value with ops/logistics, then align both files.
- **Found:** 2026-06-12

---

---

## Paid media / audiences

### r95 audience change — narrow to engaged non-converters (DEFERRED to a CheckCommerce ticket)
- **What:** repoint `[GE] primeira-rotina-r95` (63%-off first-purchase offer) from broad prospecting to engaged-but-never-purchased. Spec measured + written: `growth/campaigns/lp-educacional-2026-08/LP-STRUCTURE-REVIEW.md` › Part 2.
  - floor **45 days** since first interaction (measured: 81.6% of deliberators already converted by then; a 14-day floor leaves half still converting at full price)
  - ceiling 180 days last activity (Meta website-audience cap; use engagement audiences for 365)
  - variant A `2+` touchpoints / variant B `3+` — **decide on the Ads Manager audience estimate**, not preference. If B is thin, keep 45 days and fall back to 2+, never the reverse.
  - exclude all-time purchasers + anyone in an active full-price prospecting cell
- **Why deferred:** Lucas (2026-07-31) — do it as ONE thorough CheckCommerce ticket AFTER the ads + LP strategy rebuild lands, not piecemeal now.
- **Also carry into that ticket:** the campaign is a deliberate loss-leader (first order nets 2.3%, below the 10% floor by design; payback needs only a 7.7% repeat rate vs 15.8% baseline — `r95_cohort_isolation.py`). It MUST be tagged at creation, excluded from blended Module A, and read on 2nd-purchase rate, never first-order ROAS. Narrowing to a warmer audience will flatter CPA; the two versions are separate cohorts and not comparable to each other.
- **Found:** 2026-07-31

### Campaign names contain `|` — breaks Nemu attribution
- **What:** 13 of 17 campaigns in ad account 606199920079315 have a pipe in the name. `growth/references/utm-conventions.md` golden rule 3: Nemu encodes `{{campaign.name}}|{{campaign.id}}`, so a pipe inside the name breaks the `name|id` split.
- **Fix:** rename to the bracket convention already used by `[CS] [REGULAR] [CONVERSAO] [ABO] [MISTO]`. Free, and it protects every number the LP test will be judged on. Fold into the same CheckCommerce ticket.
- **Found:** 2026-07-31

### `economics.cac_ceiling` R$68 is marked SUPERSEDED in knowledge.md but still live in brand-context.md
- **What:** `growth/knowledge.md` › Confirmed findings strikes through "Max CAC ~R$68/new order" as **SUPERSEDED 2026-07-22 — recompute via `module-a/kpi_sweep.py` on the rebuilt cost model**. `brand-context.md` still publishes it as `economics.cac_ceiling: 68, as_of 2026-07`.
- **Impact:** every margin verdict in `ACCOUNT-AUDIT.md` and the LP offer model steers by R$68. Directionally fine, but not a blessed number.
- **Fix:** re-derive via `kpi_sweep.py`, then reconcile the manifest to the engine output (Lucas's call — money assumption).
- **Found:** 2026-07-31

### `multicolumn-ingredients` never renders on a PAGE — ingredient copy invisible on both live LPs
- **What:** `/pages/primer-cachos-definidos` and `/pages/primer-liso-intacto` have their ingredient copy written, set, and correctly bound (`ingredientes_titulo`, `ingrediente_{1,2,3}_titulo/_texto` all populated) yet the section renders nothing. Diagnosed 2026-07-31 against the live main theme.
- **Root cause:** three nested gates in `sections/multicolumn-ingredients.liquid` all fail in a page context. (1) line ~30 wraps the WHOLE section in `{% if product.metafields.custom.descricao_longa_com_abas.value.ingredientes != blank or product.metafields.custom.ingredientes_com_foto != blank %}` — the global `product` object does not exist on a page, so it is always false. (2) line ~81 gates the card body on `block.settings.image != blank`; the template sets no image. (3) line ~107 nests title and text inside `block.settings.button_text != blank`; the template sets `button_text: ""`.
- **Verdict:** not a patch. It is a PDP component (image + expand-button accordion driven by the product's ingredient metaobject) being used for page-driven text columns. Reworking it for both contexts risks the PDPs.
- **Fix:** bind the existing `ingrediente_*` page metafields to stock `sections/multicolumn.liquid` instead (renders title+text with no image/button requirement). Zero new Liquid, zero PDP risk, and it makes the existing Cachos/Liso copy visible.
- **Impact:** live customer-facing content that nobody is seeing on two published LPs.
- **Found:** 2026-07-31
- **RESOLVED 2026-07-31.** Lucas's steer was right: pull the PDP path. The section was replaced with a `custom-liquid` section (same position, 6/11) that renders `snippets/multicolumn-ingredients.liquid` — the snippet the PDP already uses, which reads the product's own `ingredientes_com_foto` + `descricao_longa_com_abas.ingredientes`. The product is resolved from `page.metafields.custom.produto_em_destaque_1` and **passed as a render parameter**, because `{% render %}` is scope-isolated and an `assign` would not reach inside the snippet. Verified live: both pages render **4 photo ingredient cards**, 0 Liquid errors (Cachos "chia", Liso "trehalose"/"girassol"). Note the rendered copy now comes from the PRODUCT, so the manually-written page-level `ingrediente_*` values are superseded and could be retired. Script + byte-exact backup + `--restore`: `growth/campaigns/lp-educacional-2026-08/fix_lp_ingredients.py`.
- **Theme churn observed mid-session:** `page.landing-page.json` -> `page.lp-single-product.json` and `page.multi-product.json` -> `page.lp-multi-product.json` were renamed by another hand at 18:24 on 2026-07-31 while this work was in flight. Section orders identical, all four live LPs repointed correctly (HTTP 200, 0 Liquid errors). Lesson for scripts: resolve the template key at runtime, never hardcode or cache it.
