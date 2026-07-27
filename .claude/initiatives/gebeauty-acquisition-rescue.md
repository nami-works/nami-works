---
id: gebeauty-acquisition-rescue
name: GE Beauty Acquisition + Rescue campaigns (wash-routine value-add offers)
owner: cto
status: in-progress
priority: high
created: 2026-07-22
target: null
current_phase: CAMPAIGN LIVE (launched 2026-07-25, Lucas approved)
next_blocker: LP LIVE (published, unlisted slug `lp-n4ga7384b3y3`) on its OWN forked template `lp-acquisition` (isolated from the shared `guia-boosters`). LP customizations LIVE (JS UNTESTED in a real browser): cart-aware trade-in buttons (one ritual/order — in-cart card→"no carrinho ✓", other→"trocar por este ritual" swap [stays R$95] + "adicionar por R$237/259" full-price add), PDP-style volume tags from `custom.dosagem` (250/200/150/50mL) in the itens-do-kit CLEAN-LIST pills, benefits from each component's `custom.finalidade`. Bundles A `10212940448064` / B `10212940120384` at FULL price (237/259); R$95 netted by a cart-level Function discount + free-ship Function. **DECISIONS (Lucas 2026-07-25):** (i) freight lever = **RUN AS-IS** (keep free shipping, offer locked) despite the analyst flag that the Unilog freight cutover (~Aug) deepens the loss to A −R$7.19 / B −R$12.19; (ii) measurement wiring = **BACKLOGGED** (in pending-fixes.md — cohort still measurable via the bundle GIDs → customer → downstream; only per-hook DOWNSTREAM-margin precision is deferred). CAMPAIGN UPLOAD-READY: CGO manifest at `gebeauty/growth/campaigns/primeira-rotina-r95/` (manifest.md + ad-copy.md + ad-build-table.csv) — test→scale hook-validation: ABO test optimized to ATC ranked on leading indicators (CTR/CPC/cost-per-ATC, NOT ROAS), 10 hooks at fair exposure (1 ad set each), 1 ad × 4 ratios via placement asset customization, R$340/day × 7d ≈ R$2,380; CBO/Purchase SCALE built only after the cohort-payback gate. MARGIN-TRUE (analyst): A −R$0.43 / B −R$5.43 pre-media, ZERO CAC room, fully-loaded deficit ~R$49-54; needs **~50% 2nd-purchase vs 15.8% house (~3×)**; SUCCESS ≥35% reorder by day-75, KILL ≤25% by day-75. REMAINING: (1) Lucas: LP browser test + 1 live R$95 checkout (confirm R$95 charged + R$0 shipping + the ONE-per-order discount cap — the "adicionar por R$full" label depends on the cart discount being one-per-order); (2) Lucas SPEND go on the R$2,380 test wave → then upload to Meta; (3) at launch: pull measurement wiring off backlog + arm the day-75 go/no-go; (4) delete the 2 orphan draft bundles `10212923310400`/`10212923343168` (DONE — already gone); monitor the Unilog freight cutover deepening the deficit. **CAMPAIGN BUILT PAUSED (2026-07-25):** Meta account `606199920079315`, campaign `120250791335430228` (`primeira-rotina-r95 | TESTE | ABO`, OUTCOME_SALES), 10 ad sets + 10 ads (one per hook), all PAUSED/zero-spend. Each: R$30/day, OFFSITE_CONVERSIONS→ADD_TO_CART (pixel `958727274605304`), BR+Advantage+ broad, `marketing_goal NEW_CUSTOMER_ACQUISITION` (excludes existing customers), FB-feed 4:5, coupon-baked URL + per-hook UTMs, first-purchase copy. R$300/day → ~R$2,100/7-day wave. IDs in `gebeauty/growth/campaigns/primeira-rotina-r95/BUILD-STATUS.md`. Genuine API limits: `ads_creative_upload_image` + `ads_get_ig_accounts` not rolled out for this account → images passed via Shopify CDN URL (worked). IG ADDED 2026-07-25 (validated — GE page 106114707866572 delivers on IG; all 10 ad sets now FB Feed + IG Feed). COPY FINAL (v3, Lucas-approved 2026-07-25): pay-only-for-shampoo framing (máscara + 3rd item + frete por nossa conta), "válido apenas para quem nunca comprou na marca", zero "lavagem" (→ "cuidado"). v3 ad IDs + final copy in BUILD-STATUS.md / ad-copy.md. Also LIVE on the LP: hi-res banners, first-purchase note on every card, `oquesao` "como funciona" pills, coupon auto-apply for direct visitors. LESSON (2026-07-25): the office relayed a subagent's asserted MCP constraint as a blocker without checking the schemas — violated verify-don't-trust; the campaign was fully buildable. LAUNCH GATE: Lucas flips ACTIVE after pre-launch QA (previews, ATC pixel/CAPI, IG decision, wave confirm); scale phase gated on the day-75 cohort-payback read.
next_owner: cto
stakeholders:
  - GE Beauty (new-customer acquisition + one-time-buyer rescue)
  - Lucas (owns offer/discount decisions, the send/spend go, brand positioning)
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why

Two linked campaigns to drive profitable growth by getting more customers to try the
products that actually create loyalty. Ran through the CGO intake loop; defended to
committee; offers locked 2026-07-22. Part of the Chief Growth Office
([[gebeauty-chief-growth-office]]).

## Premise (validated, not assumed — Module A, 2026-07-22)

- **Hero-first buyers repeat 19.2% vs 11.9% for non-hero (1.61x).** Trying a hero is
  what turns a one-time buyer into a repeat customer.
- **The heroes are the wash core, by data:** GEB 001 (Shampoo), GEB 002 (Máscara),
  GEB 008 (Shampoo a seco), each +3.2 to +4.2pp repeat above price expectation.
  Leave-in 003 is a neutral retainer (+0.6pp), NOT a hero.
- **Primer Cachos (101) is the anti-hero:** −2.6pp below its price expectation, the
  biggest acquisition source and one of the worst retainers.
- **A routine beats a product:** first order of 001+002+008 repeats at 25% (+7.2pp).
- Method: price-band residual control (repeat vs what first-order value alone predicts),
  mature full-history universe n=24,567, base repeat 14.4% (universe) / 15.8% (all-cust).

## Locked decision (2026-07-22) — the two offers

Both offers share the wash-duo base (buy Shampoo 001 + Máscara 002, full price) plus a
free third item. Used for BOTH acquisition and rescue.

| Offer | Paid pair (full) | Free gift | Free COGS | Contribution before media |
|---|---|---|---|---|
| A | 001 + 002 (R$190) | Leave-in travel (011) | R$6.21 | R$90.5 / 45.4% |
| B | 001 + 002 (R$190) | Shampoo a seco full (008) | R$11.21 | R$85.5 / 42.9% |

Economics params (this analysis): tax 12%, payment 3.95%, freight 15% (provisional,
this-analysis-only — NOT persisted to params.json), fulfillment 3%, freight rev +5%,
real per-SKU COGS from cost-basis.json. Calc: scratchpad `offer_economics.py`.
**SUPERSEDED 2026-07-22:** Module A cost model was rebuilt (absolute R$/order vs
ad-valorem %, COGS bottom-up ~14.9%, Boniteca its own line). The figures above are
OLD-MODEL and provisional. Run the DEFINITIVE offer economics through
`gebeauty/growth/module-a/offer_breakeven.py` once Lucas locks the bundle price.

- **Deployment (locked 2026-07-22): customer choice.** Both offers shown; the customer
  picks their free gift (travel leave-in or full shampoo a seco). Maximizes conversion.
  Trade-off: no randomized A/B read on which gift wins — track chosen-gift mix and
  downstream retention by chosen gift as an observational signal instead.
- **Acquisition implication:** using a full-price buy-2-get-1 (not a 50%-off tripwire)
  makes the acquisition order floor-clearing: ~R$85–90 contribution absorbs ~R$49 CAC →
  ~18–21% net after media. Risk shifts from margin to CONVERSION at a R$190 entry.
- **Traffic source (Lucas, 2026-07-22): a DEDICATED ad set whose hooks STATE THE ACTUAL
  OFFER** — NOT the free-mini ("pague só o frete") ads. So the LP presents the offer
  directly (no expectation-gap bridge); message match is ad-states-offer → LP-delivers.
  Resolves the "matched creative" question in favor of a dedicated matched ad set.
- **Rescue (locked 2026-07-22): keep the yes/no opener; the YES branch serves the same
  customer-choice offer as acquisition.** Opener reads whether the first product worked;
  the click segments and captures feedback. NO branch = 40%-off next-order win-back
  (ASSUMED unchanged — confirm with Lucas). Value-add over discount holds the brand rule
  (Module F) and, in our data, converts far better than deep %-off (GWP 200–800 vs 0–8
  for 50%-off-2nd-unit).

## Rescue cohort (Module A)

- **19,206** one-time buyers who never bought a hero (001/002/008 any size);
  **18,781 emailable**; ~17,130 after excluding <30-day recency.
- Concentrated in the anti-hero first-products: primer cachos 101 (5,172), booster
  definição 021 (4,791), melon mist 024 (4,383), hidratante 020 (3,044), etc.
- Send list source: `gebeauty/growth/module-a/rescue-cohort.csv` (PII, gitignored) —
  note: that CSV is the primer-only 6,497; the broadened 19,206 list = re-run
  `broadened_rescue.py` for the send. Recency + composition in `broadened-rescue.out.json`.

## Guardrails

- **Cohort isolation (guardrail 6):** both campaigns tagged at creation (discount-code
  family + order tag + customer segment) and excluded from blended KPIs; judged on
  hero-trial / 2nd-purchase, not first-order AOV/margin. See
  [[acquisition-cohort-isolation]].
- Send/spend/discount-code creation gated on Lucas's explicit approval.
- Brand voice + value-add-over-discount (Module F).

## Creative + LP decisions (2026-07-22)

- **Hero scope: offer products ONLY** (paid pair + gift options), not the whole family.
  Family shot reserved for a lower-LP brand section / prospecting. (Lucas.)
- **Hero source:** crop the offer SKUs from the hi-res portfolio
  `G:\...\GEB_Marketing\...\IMAGENS\Produtos\portfolio_26-06-22*.png` (5504×3072 /
  12568×6436). Verify 008 (Shampoo a seco) is present at usable res — if so it removes
  the missing-plate blocker (no new shoot). `white-space-left` variant conflicts with the
  house layout rule (copy goes RIGHT for horizontals); offer-only crop lets us follow it.
- **Gift default: no pre-selection** (LP lead rec) — keeps a clean observed gift-mix read;
  no meaningful conversion cost. Chooser add-to-bag disabled-with-reason until a gift is picked.
- **Ad→LP message match:** dedicated ad set states the offer; LP hero restates it verbatim,
  gift-first (never %-off). 3 example ad-hook↔hero pairings in the LP strategy.

## Decisions (validated 2026-07-22 cont.)

- **Offer price (Lucas, 2026-07-23): R$95 for the WHOLE bundle** (Shampoo 001 + Máscara 002
  + the customer-chosen third), compareAtPrice = sum of the three at retail, **PLUS free
  shipping**. This is a deep tripwire (~60%+ off + subsidized freight) — a hard loss-leader,
  NOT the value-add offer originally modeled. Consequences: (1) it overrides the
  value-add-over-discount brand guardrail — accepted by Lucas as an aggressive acquisition
  play; (2) MUST be an isolated cohort (guardrail 6), judged on 2nd-purchase payback, never
  first-order margin; (3) run the real per-order economics + CAC ceiling via
  `offer_breakeven.py` before any spend (freight is fully borne — free-ship promised).
- **DECISION (Lucas, 2026-07-23): GO despite negative payback.** Informed acceptance after
  the analyst flag below — the offer is a strategic new-customer-acquisition + long-LTV bet,
  judged on downstream repeat/LTV, not first-order margin. Execution accountability (CGO):
  the cohort is tagged + isolated (guardrail 6) and the 60/90-day 2nd-purchase + LTV curve is
  monitored vs the analyst's bar; the "kill line" becomes a learning tripwire — if it tracks
  below the 15.9% giveaway analog, the office flags it, but continue/stop is Lucas's call.
  Note: analyst shows gift 008 is the better LTV bet (001+002+008 = GE's highest-repeat basket)
  — worth letting the customer-choice default/framing lean 008.
- **PAYBACK BAR (growth-analyst, 2026-07-23):** the R$95 + free-ship offer does NOT clear
  its payback bar as specced. Needs ~29% incremental 2nd-purchase at R$49 CAC; plausible
  ceiling 19.2% (hero-first) / 21-25% (forced wash baskets), realistic 16-21%. Gift 011
  never clears (thin downstream R$171/repeater); gift 008 clears ONLY at CAC ≤R$40 with
  <1pp margin (the 001+002+008 trio is GE's highest-repeat basket, R$188/repeater). Binding
  constraint = CAC, not the offer. Precedent risk: the value-add giveaway cohort repeated
  15.9% (deal-seekers), so the forced-basket rates are an optimistic ceiling. Kill line:
  60-day tagged 2nd-purchase <8%, or realized CAC >R$49. Full: analyst report + module-a.
- **Rescue NO-branch:** same offer as the YES branch, only different framing (NOT a 40%-off
  discount). The yes/no still segments + tailors the message; both paths lead to the offer.
- **Launch scope:** Meta-first, 12 assets (3 angles × 4 formats). Google PMAX after it proves.
- **LP social proof:** surface real Loox rating/review counts (live Loox read at build).

- **"De" anchor (Lucas, 2026-07-23):** compareAtPrice = **sum of all three at retail**
  (R$237 with leave-in 011 / R$259 with shampoo a seco 008), NOT the duo. (Overrides the
  copywriter's R$190 duo-anchor suggestion.) Copy `{{DE_PRICE}}` tokens use these.
- **Hero:** one canonical wash-routine hero across all three ad angles.
- **⚠️ BUILD CONSTRAINT (Lucas):** do NOT add `kit-ate-*` tags to these new bundle products —
  those tags are wired to existing campaigns/collections. Bundles stay unlisted (no collections),
  LP + checkout-upsell only.
- **Bundle mechanic (spec done — `mechanic-tracking-spec.md`):** two fixed-price native bundle
  products, `productType: kit`, R$95 each, compareAtPrice = R$237/R$259; gift choice = which
  bundle SKU. Free shipping via extending the existing R$299 free-ship Function with a
  bundle-GID predicate (one OR clause, sitewide rule untouched — needs Function Studio redeploy).
  Cohort tag `cohort-wash-rotina(-acq|-rsg)` on "order contains bundle product"; customer tags
  `wash-rotina-acq|rsg`; UTM `utm_campaign=wash-rotina-*`; code family `RESGATE95-*` / `ROTINA95`
  (collision-checked clean). Module A split via a new `--include-wash-tripwire` flag.
- **Free shipping:** promised as part of the offer ("R$95 com frete grátis") — GE bears freight.
- **4:5 copy zone:** open it to ~35% top (products framed into the bottom 65%).
- **Expansion tooling:** Magnific UI directional uncrop (natural bg), NOT PIL recanvas (reads
  as a flat manual stretch) and NOT MCP `images_expand` (no 1.91:1 / 4:5 ratios; auto-anchors).

## Open build decisions (confirm before build)

1. Tracking: discount-code family names (avoid the collisions in `discounts.out.json`),
   order tags, customer segments, UTMs.
2. Redemption limits (single-use per customer assumed).
3. Offer mechanic build: native Shopify BxGy / Function, and where the gift choice is
   presented (LP vs cart/checkout).

## Deliverables done

- Defense deck (committee): `gebeauty/growth/module-a/acquisition-rescue-defense.html`
  (published artifact; FROZEN during discussion).
- Q&A companion: `gebeauty/growth/module-a/acquisition-rescue-qa.html` (unpublished).
- Data + scripts: `gebeauty/growth/module-a/` (hero_discovery, broadened_rescue,
  market_basket, mechanic_repeat, aov_baseline, discount_landscape, abandoned_checkouts).
- Killed two live abuse codes (TESTE99OFF 99%, BHSFREESELIA 100%).
- **LP offer-presentation** (2026-07-22): strategy + HTML mockup at
  `gebeauty/imagery/wash-routine-offer/lp-offer-mockup.html` (price as {{TOKEN}} slots;
  bridge from the "miniatura" hook; customer-choice gift chooser; lighter checkout upsell).
- **Paid-media tweak spec** (2026-07-22): `gebeauty/imagery/wash-routine-offer/creative-tweak-spec.md`.
  Key finding: heavier than a re-copy — needs a NEW full-size hero plate (001+002, not the
  travel miniatures) and the 008 (shampoo a seco) plate does not exist yet. Template, stage,
  tokens, layout, and the 011 travel-leave-in plate all carry over.

## Phases

- [x] **Intake + economics + defense** — done 2026-07-22, offers locked.
- [x] **Hero plates** — done 2026-07-23. Corrected heroes (seed 4-pack + two 3-packs) +
      four expanded Meta plates in `imagery/wash-routine-offer/expanded/` (Nano Banana
      reference-guided zoom-out; products/labels preserved).
- [~] **Build (in progress, 2026-07-23)** — 3 tracks running: payback-bar (analyst),
      hooks+LP copy drafts (content-director), bundle+tracking spec (integrations-engineer).
      Downstream + gated on copy approval + payback go: creative matrix (creative-producer,
      copy onto plates), LP production build (product-developer/design-engineer), bundle +
      tracking store writes, rescue email (crm-director). Nothing published/sent/spent.
- [ ] **Launch** — gated on Lucas's send/spend go + payback clearance.
- [ ] **Measure** — hero-trial + 2nd-purchase rate of the tagged cohort vs holdout + the
      payback bar, day 30/60/90.
