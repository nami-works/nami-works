---
id: gebeauty-storefront-rules-watchdog
name: GE Beauty storefront-vs-rules watchdog (discounts + badges)
owner: cto
status: in-progress
priority: normal
created: 2026-07-08
target: null
current_phase: 3-storefront-render-parity
next_blocker: ad-hoc audit shipped + green; S1 render-parity + alert routing (phases 3-5) not built yet
next_owner: /observability-engineer
stakeholders:
  - GE Beauty (tenant #1)
  - Lucas (receives the alerts)
working_agreement: ~/.claude/projects/c--Users-Lucas-Guimar-es-Desktop-nami-works/memory/feedback_cto_contract.md
---

## Why
Today's audit (2026-07-08) found the live store silently drifting from its own pricing/merchandising rules: a bundle missing a component, three kits with `de` decoupled from component value, ~14 kits whose off-badge either didn't exist or was DRAFT (linked but never rendered), and an orphaned duplicate badge. Every one was invisible until manually hunted. These are exactly the failures a watchdog should catch in minutes, not on a customer complaint. The end state is a scheduled check that alerts Lucas whenever the storefront violates a codified rule; ad-hoc (manual run) is acceptable until the invariant set stabilizes.

## Invariants the watchdog enforces
Derived from today's audit. Each is a read-only check against the Shopify Admin API (and, for parity checks, rendered storefront HTML).

**Bundles (kits/duplas, productType `kit`)**
- B1 — No `bundleComponents` node with `componentVariantsCount.count == 0` (component defined but points to a deleted variant → silently drops at checkout). *Fix is app-side (Bundles app owns components); see [[reference_gebeauty_bundles_app_owned]].*
- B2 — No active kit whose `price` exceeds its resolved component sum (a "penalty bundle" that costs more than buying the items loose).
- B3 — When a kit has a `compareAtPrice`, it equals `sum(component.price * qty)` (no phantom/inflated or understated `de`), and `price <= compareAtPrice`.

**Badges (`custom.etiquetas`)**
- G1 — Every product with a `compareAtPrice` carries exactly one off-badge, matching the rule (`de < 100 → N% off` ; `de >= 100 → R$N off`) with the correct value. See [[reference_gebeauty_etiqueta_applier]].
- G2 — No off-badge on a full-price product (stray/stale discount label).
- G3 — Every `etiqueta` metaobject referenced by a live product is publishable status ACTIVE (DRAFT links but never renders — the bug that hid ~14 kit badges today).
- G4 — (hygiene, low sev) No orphaned or duplicate off/social-proof badges in the library (e.g. the deleted `mais vendido`; the duplicate R$20/15% entries).

**Storefront parity (beyond Admin API)**
- S1 — A representative discounted PDP and a collection card actually render the expected badge in raw HTML (catches DRAFT, CDN/theme cache lag, and `snippets/custom-etiquetas.liquid` regressions that Admin-API checks can't see).

**Links (navigation integrity)**
- L1 — Every internal link stored as free text resolves to a live URL (HTTP 200, no 404 or redirect loop). Highest-risk source: the metaobject-controlled `icones.<handle>.link` fields, which became free text in the 2026-07-08 single-URL migration — a reference picker used to guarantee a valid target; free text does not, so a renamed/deleted collection or a typo now 404s silently. Extend to other free-text link fields as they appear. See [[reference_gebeauty_storefront_metaobjects]].
- L2 — (parity, S1-style) Crawl the rendered anchors on the homepage and the discount collections in raw HTML and flag any `href` that returns 404 (catches theme-hardcoded links and CDN-stale bindings the Admin-API check can't see).

**Discounts (combinesWith config drift)**
- D1 — Every active discount that is NOT itself a free-shipping type has `combinesWith.shippingDiscounts = true`, so it stacks with the R$299 free-shipping Function (`DiscountAutomaticApp` 1637817647424, which already permits `orderDiscounts`). Root cause: CRM Bonus creates cashback coupons (`gift_*`, `DiscountCodeBasic` fixed-amount order discounts) with all combine flags `false`, silently blocking free shipping for cashback redeemers. Read-only detection already exists in `sandbox/gebeauty/scripts/audit_discount_shipping_combine.py` (paginates `discountNodes`, extracts combinesWith per subtype) — fold its logic into `audit_storefront_rules.py`. *Remediation is the discount analog of `apply_off_badges.py`: `sandbox/gebeauty/scripts/fix_discount_shipping_combine.py` (targets `--gift` / `--channel20` / `--affiliate10` / `--all`, flips `shippingDiscounts=true` preserving order/product flags). Watchdog detects + alerts; the fix tool remediates.* Severity: normal. No new phase — D1 rides the existing audit script (phase 2) + alert routing (phase 4).

## Phases
- [x] 1. Codify invariants + prove each check manually — 2026-07-08 (memories [[reference_gebeauty_bundles_app_owned]] + [[reference_gebeauty_etiqueta_applier]] written; `apply_off_badges.py` committed carrying the badge rule; bundle + verify logic proven in-session)
- [x] 2. Consolidate into one committed read-only audit `sandbox/gebeauty/scripts/audit_storefront_rules.py` — runs B1-B3, G1-G4, grouped report, exit=violation count — 2026-07-08
- [ ] 3. Add S1 storefront-render parity check (raw HTML fetch of one PDP + one card)
- [ ] 4. Alert routing — wire violations to a channel (Gmail-label alert pipeline or chosen), with severity (B1/S1 = high, G1-G3 = normal, G4 = low) and dedupe
- [ ] 5. Cron deploy + escalation policy (cadence, quiet hours, ECS-restart survival per existing cron patterns)

## Notes
- 2026-07-08 (handover) — Took ownership of the combine work from the other session; retired the standalone `gebeauty-freeship-combine-guardrail.md` (uncommitted, content folded here). Fresh D1 audit baseline (post `gift_` backfill): **5545 active discounts, 5370 combine with shipping, 174 do NOT** — and **0 of the 174 are `gift_`** (backfill held). The 174 break down as **162 Loox "Friend Discount" referral codes** (born non-combining by the Loox app — same recurring-vendor pattern as CRM Bonus, a *new* population the gift-only backfill never touched), **12 misc** (ANIVERARIO50, 25OFFQUIZZ, Quizz_Capilar, NIVERJUL, WPRVFBLB…), **4 `DiscountAutomaticApp`**. Per the blanket D1 policy these should flip to `shippingDiscounts=true` via `fix_discount_shipping_combine.py --all` (or add a `--loox` target). NOT yet done — bulk write on a new population + the 4 app-automatic entries may be app-locked; **pending Lucas confirm** (policy: should Loox friend-referral codes stack with free shipping?). Baseline JSON: `sandbox/gebeauty/inputs/discount_shipping_audit.json`. **Remediated same day (Lucas approved):** `fix_discount_shipping_combine.py --all --no-app --apply` flipped 170 code discounts (162 Loox + 8 misc) to `shippingDiscounts=true`, 0 errors. Added `--no-app` to the fix tool + refined D1 in `audit_storefront_rules.py`: the R$299 free-ship Function is itself a `DiscountAutomaticApp` with `shipping=false` (correct — a shipping discount shouldn't stack with shipping), so it's excluded from D1 by title; the other 3 app-automatic non-combining (Escudero-Brinde, Primeira compra afiliadas, afiliadas_teste) are app-owned (can't flip from our token) and now report as LOW `D1-app` manual-review. Post-remediation audit: 0 code-discount D1 violations, 0 HIGH/NORMAL anywhere.
- 2026-07-08 (later) — Added invariant group **Discounts (D1)**, folded in from a separate session that started building a standalone "free-ship combine guardrail" (now retired; its plan lives here). Trigger: GE changed the storefront free-shipping logic; the R$299 free-ship Function is a *shipping discount*, and CRM Bonus's `gift_*` cashback coupons were born with `combinesWith` all `false`, so cashback couldn't stack with free shipping. **Immediate backfill already shipped**: 218 active `gift_*` codes flipped to `shippingDiscounts=true` (`fix_discount_shipping_combine.py --gift --apply`, 0 errors); verified the free-ship Function already carries `orderDiscounts=true`, so both combine-sides now agree. The recurring root cause (new coupons keep arriving non-combining) is what D1 + alert + the fix tool close. **Decision: dropped the originally-proposed connector webhook + separate SES weekly-email — it duplicated this initiative's cron+alert machinery and added a connector deploy for only seconds-vs-cron-interval latency, which doesn't matter for cashback redeemed over days.** `--gift` target was added to `fix_discount_shipping_combine.py` this session (still uncommitted in the working tree).
- 2026-07-08 (later) — Added invariant group **Links (navigation integrity)** (L1/L2). Trigger: today's single-URL icon migration replaced the 3 typed reference pickers on the `icones` metaobject with one free-text `link` field (cleaner editor, allows external URLs, but no referential guarantee — the nav/CRO trade-off accepted at migration time). L1 closes that gap by asserting every free-text internal link still resolves; L2 extends the S1-style raw-HTML parity crawl to anchors. Fold into `audit_storefront_rules.py` (read the metaobject `link` values, then GET/HEAD each; strictly read-only, report-only). Severity: L1 normal, L2 normal.
- 2026-07-08 (later) — Phase 2 shipped: `audit_storefront_rules.py` committed + run against live store. Result GREEN on all functional invariants (B1-B3, G1-G3) — confirms today's fixes held. Only remaining hits are 3 LOW G4 dupes: duplicate ACTIVE off-badges "10% off" (2 metaobjects), "15% off" (3), "R$20 off" (2). Housekeeping — the applier picks the first gid deterministically, so no functional impact; dedupe when convenient. Run ad-hoc: `python sandbox/gebeauty/scripts/audit_storefront_rules.py` (exit code = violation count).
- 2026-07-08 — Initiative derived from the discount+badge audit. Ad-hoc tooling that already exists to fold into Phase 2's single script: `apply_off_badges.py` (badge rule + library load), plus in-session logic for bundle `componentVariantsCount` scan (B1), component-sum-vs-price/de (B2/B3), and off-badge correctness/stray/publish (G1-G3). All checks must stay strictly read-only — the watchdog reports, it does not auto-fix (fixes route to `apply_off_badges.py` for badges, and to the Bundles app UI for components since they're app-locked).
- Gotcha to bake into the checks: bundle components are app-owned, so B1 can detect but never remediate from our token. G3 must read `capabilities.publishable.status`, not just reference existence. Watch bash `\$`→`$` mangling in inline regex (broke a verify pass today) — the committed script sidesteps it by living in a file.

## Done means
- One command (`python sandbox/gebeauty/scripts/audit_storefront_rules.py`) reports every B/G invariant violation across the store, with zero false positives against a known-good state.
- Phase 4+: a scheduled run alerts Lucas (with severity) within one cron interval of a violation appearing, and self-heals across ECS restart.
