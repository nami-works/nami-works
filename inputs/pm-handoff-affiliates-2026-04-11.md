# PM Handoff — Affiliates — gap-analysis — 2026-04-11

## Context
- Target route: [app/routes/app.affiliates.tsx](app/routes/app.affiliates.tsx)
- Server layer: [app/affiliates/analytics-queries.server.ts](app/affiliates/analytics-queries.server.ts), [app/affiliates/sync.server.ts](app/affiliates/sync.server.ts), [app/affiliates/storage.server.ts](app/affiliates/storage.server.ts)
- Audience: **owner / strategist** (Lucas, GE Beauty COO). Cadence: monthly review, quarterly portfolio decisions. Not a daily ops surface.
- Current state: 9-card dashboard (revenue, margin, CAC / LTV, repeat, AOV / leaderboard, product mix, ROAS) with period + comparison + affiliate filter, backed by normalized `AffiliateOrder` + `AffiliateMonthly` + `AffiliateOrganicAgg` tables. Profiles tab is a read-only list. Empty state has a 2-step CSV→sync onboarding.

## Stated needs
- **User quote (PT-BR):** *"Conseguimos ver os clientes de cada uma e o que cada um compra? De uma forma compilada kkkk"* — "Can we see each affiliate's customers and what each of them buys, compiled?"
- Lucas's framing: *"decide who to keep or cut, replicate what top affiliates do"*.
- Pivot dimensions that matter: **product mix concentration**, **repeat / loyalty**, **AOV / basket depth** — all **per affiliate**, not at cohort level.
- Keep/cut decision is **portfolio-relative** (bottom quartile), not threshold-based. No auto "at-risk" flag required — but the ranking must make bottoms visually distinct from tops.

## Hidden needs (surfaced in discovery + code read)
1. **The "compiled customer view" is really a drill-down pivot on the leaderboard, not a new tab.** Clicking an affiliate row should open their customer list + per-product basket summary inline. The user thinks of it as a report; the right home is a drill-down.
2. **Per-affiliate repeat rate, AOV, product mix don't exist.** Today all three are cohort-level (affiliate vs organic). The leaderboard has `revenue / orders / commission / customers` only. That is insufficient for either the "replicate top" or "prune bottom" job.
3. **Commission %% is ingested wrong.** [storage.server.ts:191-304](app/affiliates/storage.server.ts#L191-L304) imports BixGrow CSV but never reads a `commissionPct` column — every affiliate defaults to 10%. The `rebuildAffiliateMonthly` SQL uses `MAX(ap."commissionPct")` with a 10% fallback ([analytics-queries.server.ts:67](app/affiliates/analytics-queries.server.ts#L67)), so **margin, CAC, ROAS, and commission totals are all fictional downstream** until the importer is fixed or a manual edit flow is added. This is a data-integrity bug masquerading as a UX gap — it breaks 4 of 9 KPI cards.
4. **First-order attribution is global.** [analytics-queries.server.ts:11-33](app/affiliates/analytics-queries.server.ts#L11-L33) marks the earliest `AffiliateOrder` per customer as first. A customer who first bought organically, then later used an affiliate code, is counted as a *repeat* for the affiliate — understating affiliate-driven acquisition and overstating affiliate-driven loyalty. The "replicate top" job is exactly the wrong place for this to be wrong.
5. **No pay workflow, no export.** If keep/cut decisions get made on this page, the downstream act of paying commissions happens elsewhere (spreadsheet). A CSV/XLSX export of the leaderboard filtered by period is a natural extension once per-affiliate numbers are trustworthy.
6. **`affiliateSegment = "top10" | "recent"` is dead code.** The filter dropdown captures those values into state but [fetchStats](app/routes/app.affiliates.tsx#L471-L494) only forwards `selectedAffiliate`. Selecting "Top 10" or "Most recent" visually reflects in the dropdown and does nothing — a textbook broken interaction.

## JTBD matrix

| Trigger | Business context | Desired outcome | System state change | Failure mode |
|---|---|---|---|---|
| Open Affiliates page | Monthly program review | See portfolio health at a glance + immediate sense of who's up/down vs last period | Loader returns sync meta; client auto-fetches stats for last 30d with comparison to prev period (currently no comparison by default) | Sync stale → banner "last sync 12d ago, refresh?" with inline Sync button (today: shows last-sync badge but no staleness warning) |
| Click affiliate row in leaderboard | "Who is this person's audience?" — the explicit user question | Inline drill-down: customer list with per-customer order count, total spend, first-order date, products bought; per-product basket breakdown for this affiliate only | New action intent `fetch-affiliate-detail` returns `{ customers, productMix, kpis }` for one code; drill expands inside leaderboard drill-down | Affiliate has zero orders → show empty state with code metadata + "first sync this affiliate" link; query fail → retry banner inside drill, not page-level |
| Sort leaderboard by repeat rate / AOV / product-depth | Identify who attracts the best customers, not just the most revenue | Table re-sorts client-side; quartile bands (top/bottom 25%) recolor | Leaderboard query returns sortable extended columns; table header click changes sort state | Fewer than 8 affiliates with data → hide quartile bands, show "need ≥8 affiliates for ranking" |
| Change affiliate filter to `Top 10` or `Most recent` | Quickly focus the whole dashboard on a subset without typing a specific name | Every KPI card + trend + drill-down recomputes using that subset | Filter forwards `affiliateSegment` to `fetch-dashboard-stats`; server filters `AffiliateMonthly` rows accordingly | Subset is empty → KPI cards show `--`, leaderboard shows empty state with "expand the filter" hint |
| Click customer in per-affiliate drill-down | Verify the purchase story, audit for sharing/fraud | Modal or expanded row showing their full order history (dates, products, which affiliate codes used, affiliate vs organic) | Action `fetch-customer-history` for `(shop, customerId)` | Customer has no Shopify link in admin → no deep-link, but all data is visible inline |
| Open Profiles tab, click a profile | Update commission %, deactivate, fix a handle typo | Opens edit panel with commission / tier / status / social handles; save persists + triggers monthly rebuild | Action `upsert-affiliate-profile` exists in storage (`upsertAffiliateProfile`) but no UI; save → `rebuildAffiliateMonthly(shop)` afterwards | Active sync running → disable save with tooltip "wait for sync to finish"; stale delta from user → optimistic update with rollback on conflict |
| Export leaderboard | Hand a payout sheet to finance | Downloads CSV: code / name / period / orders / revenue / commission / customers / repeat % / top product | Client-side serialization from current stats state; no new action | Stats not loaded → button disabled with "load stats first" tooltip |
| Re-import BixGrow CSV | Onboard new codes or update status / commission % | Drop CSV → import → automatically retriggers order sync OR prompts user to re-sync | Already exists for CSV upload; missing: automatic follow-up sync prompt | Importer currently drops `commissionPct` from BixGrow CSV → see blindspot `critical-1` |

## Interaction audit

Walking every interactive element in [app.affiliates.tsx](app/routes/app.affiliates.tsx):

| Element | Purpose | States covered | Outcome delivered? | Feedback loop | Verdict |
|---|---|---|---|---|---|
| `Sync Orders` primary button ([:934-940](app/routes/app.affiliates.tsx#L934-L940)) | Kick off fire-and-forget Shopify order sync | idle / running (disabled + "Syncing…") | ✅ Backfills `AffiliateOrder` + rebuilds monthly | Polls `syncStatus` every 5s; banner on `failed`; cosmetic progress bar (see below) | **Wired, but feedback is weak** — fix: make progress bar show `progressCount / totalOrdersEstimate` and last phase time |
| Sync progress bar ([:996-1015](app/routes/app.affiliates.tsx#L996-L1015)) | Show sync progress | Fixed `width: 100%` with animated gradient | ❌ Always visually "full" regardless of actual progress; merely decorative | Phase label updates; no ETA | **Broken** — fix: compute width from `progressCount` vs a rolling estimate (known totals from last sync kept in `AffiliateSyncMeta`) |
| Actions overflow (⋯) → `Update database` ([:972-992](app/routes/app.affiliates.tsx#L972-L992)) | Re-open CSV drop zone after initial onboarding | default, popover toggle | ✅ Opens file picker | No confirmation that re-import happened (relies on `importResult` state which only displays errors) | **Needs feedback** — fix: show success toast or inline badge "imported N, skipped M" |
| Tabs: Overview / Profiles ([:953-970](app/routes/app.affiliates.tsx#L953-L970)) | Switch top-level view | active / inactive | ✅ In-place state switch | — | **Wired** |
| Period `<s-select>` ([:1038-1053](app/routes/app.affiliates.tsx#L1038-L1053)) | Pick last 7d / 30d / month / 3 months / custom | default, loading (indirect via card overlay) | ✅ Triggers refetch via dependency effect | KPI cards dim while loading | **Wired** — but there's no "last 12 months" or YTD preset, which is the natural cadence for a portfolio review |
| Comparison `<s-select>` ([:1061-1080](app/routes/app.affiliates.tsx#L1061-L1080)) | Enable prev period / prev year delta | default | ✅ Drives `delta` field on all KPIs | Arrow badges on cards | **Wired** — but default is `none`; deltas are the whole point of a monthly review, so default to `prev_period` |
| Affiliate filter `<s-select>` ([:1084-1110](app/routes/app.affiliates.tsx#L1084-L1110)) | Focus dashboard on All / Top 10 / Most recent / single affiliate | captures state | ⚠️ **`top10` and `recent` never reach the server** — see `fetchStats` which only sends `selectedAffiliate` when it's a specific code | Dropdown reflects selection but nothing happens | **BROKEN** — fix: either implement the segment server-side (sort leaderboard by revenue DESC LIMIT 10 → intersect into filter) or delete the options. Also: this dropdown lists every affiliate in one flat list — with 100+ affiliates it's unscannable. Replace with a searchable picker or combo box. |
| Custom date pickers ([:1120-1142](app/routes/app.affiliates.tsx#L1120-L1142)) | Set custom start/end | default | ✅ Triggers refetch on change via dependency effect | — | **Wired** |
| 9 KPI cards with drill toggle ([:1158-1626](app/routes/app.affiliates.tsx#L1158-L1626)) | Show headline + expand one drill at a time (mutex) | default, hover, active, loading overlay | ✅ Mutex drill works; click target is the whole card | Spinner overlay while stats load | **Wired** |
| Leaderboard table rows ([:644-672](app/routes/app.affiliates.tsx#L644-L672)) | List top 20 affiliates with revenue / orders / commission / customers | hover only | ❌ **Not clickable** — no per-affiliate drill-down exists anywhere | — | **Missing interaction** — this is the primary gap for the user's stated request. Fix: click row → expand inline section showing customers + per-affiliate product mix + per-affiliate repeat/AOV |
| Instagram handle link in leaderboard ([:655-664](app/routes/app.affiliates.tsx#L655-L664)) | Open affiliate's IG | default, hover | ✅ Works | — | **Wired** |
| Row 3 KPI cards "Top affiliates" / "Top products" ([:1503-1517, :1525-1539](app/routes/app.affiliates.tsx#L1503-L1539)) | Host the leaderboard / product mix drill-downs | default | ⚠️ Primary text is a *label* ("Top affiliates") not a metric number, and the secondary text shows only the #1 name. These cards exist to host a drill, not to convey a number. | — | **Smell** — they don't follow the KPI card contract. Either (a) compute a real headline metric like `concentration index` (e.g. top 3 share of total affiliate revenue) and `SKU diversity` (number of distinct products sold via affiliates), or (b) drop them from the grid and render the drill-downs as their own sections below. Option (a) is better — it gives "replicate top" a headline. |
| Leaderboard in CAC drill ([:1235-1267](app/routes/app.affiliates.tsx#L1235-L1267)) | Show per-affiliate CAC computed client-side from commission / customers | default | ✅ Renders | — | **Wired, but values are fictional** — commission = 10% fallback × revenue, and "customers" is unique customers (not new), so per-affiliate CAC is `revenue × 0.1 / customers` = 10% of AOV. This is numerically meaningless until commission % is ingested correctly. |
| Profiles tab rows ([:1843-1877](app/routes/app.affiliates.tsx#L1843-L1877)) | List all imported affiliates with name / code / commission / tier / status | hover only | ❌ **Not clickable** — no edit, no deactivate, no commission change | — | **Missing interaction** — [`upsertAffiliateProfile`](app/affiliates/storage.server.ts#L125-L179) and [`deleteAffiliateProfile`](app/affiliates/storage.server.ts#L181-L189) exist in storage but no UI wires them. Classic orphaned backend. |
| CSV drop zone + Step 1 onboarding ([:1655-1779](app/routes/app.affiliates.tsx#L1655-L1779)) | Drag/drop or click to import BixGrow CSV | idle / drag / file-selected / importing / done / error | ✅ Full state machine, genuinely good | Inline badge + error banner | **Wired** — best UI on the page |
| Step 2 onboarding Sync button ([:1805-1823](app/routes/app.affiliates.tsx#L1805-L1823)) | Kick sync from the onboarding flow | disabled (no profiles) / active | ✅ | Same sync polling as primary button | **Wired** |
| `Re-import CSV` button on Step 1 after done state ([:1692-1697](app/routes/app.affiliates.tsx#L1692-L1697)) | Re-open picker for re-imports | default | ✅ | — | **Wired** — but this lives inside the onboarding card that only renders when `hasData === false`, so once the user has data it's only reachable via the overflow menu. Confusing. |

**Priority-ordered fix list** (blast × frequency × effort):

1. **CRITICAL** — Wire per-affiliate drill-down from leaderboard row click (customers + product mix + per-affiliate repeat/AOV). Answers the explicit user question AND enables the keep/cut job. **High blast, high frequency, medium effort.**
2. **CRITICAL** — Fix BixGrow CSV import to read commission %% (or add a manual edit flow in the Profiles tab that also triggers `rebuildAffiliateMonthly`). Without this, margin/CAC/ROAS are all lies. **High blast, every view, low effort.**
3. **CRITICAL** — Kill or implement `affiliateSegment = top10 / recent`. Today they're dead code users can select. **Medium blast, high frequency (hunting for subset), low effort (delete) or medium (implement).**
4. **IMPORTANT** — Make leaderboard sortable with quartile visual bands, add columns: repeat %, AOV, top product. Enables the "relative to portfolio" cut decision the user explicitly asked for. **High blast, high frequency, medium effort.**
5. **IMPORTANT** — Wire Profiles tab row → edit panel (commission, tier, status, deactivate). Unlocks the partial fix for #2 without waiting for CSV importer changes, and removes an orphaned backend. **Medium blast, medium frequency, low effort.**
6. **IMPORTANT** — Fix first-order attribution to be scoped per affiliate (first order *via this affiliate*, not first order globally). Otherwise "repeat rate per affiliate" from fix #4 will still lie. **High blast on the metric it enables, medium effort.**
7. **IMPORTANT** — Replace the cosmetic sync progress bar with real progress (`progressCount` / rolling estimate from last sync). Sync can take minutes on GE Beauty; users distrust an animation that never moves. **Low blast, low frequency (only during sync), low effort.**
8. **IMPORTANT** — Default comparison to `prev_period` instead of `none`. Deltas are the whole point of a monthly review; making users click to see them every time is friction. **Low effort, obvious win.**
9. **IMPORTANT** — Leaderboard "top affiliates" / "top products" cards: replace label-only primary text with a real concentration metric (e.g. *top-3 share of affiliate revenue*, *number of distinct SKUs sold via affiliates*). **Medium effort.**
10. **NICE-TO-HAVE** — Export leaderboard to CSV (filtered by current period + segment). **Low effort.**
11. **NICE-TO-HAVE** — Searchable affiliate picker instead of flat `<s-select>`. Matters when the program grows past ~30 codes. **Low effort.**
12. **NICE-TO-HAVE** — Add "last 12 months" / YTD period presets for portfolio reviews.

## Metric rubric

| Metric (card) | Decision enabled | Action triggered | Drill-down path | Comparison | Verdict | Fix |
|---|---|---|---|---|---|---|
| **Affiliate revenue** ([:1158-1174](app/routes/app.affiliates.tsx#L1158-L1174)) | "Is the program growing vs organic?" | Invest more / cut losses | Vertical bars by affiliate + monthly trend | vs prev period (✅) | **Actionable** | Default comparison on; no change to headline |
| **Affiliate margin %%** ([:1190-1206](app/routes/app.affiliates.tsx#L1190-L1206)) | "Is affiliate revenue profitable after discounts + commission?" | Tighten commission %% or cap codes | Dual waterfall (affiliate vs organic) — excellent | vs prev period | **Contaminated** | Depends on commissionPct — fix import, otherwise this is shown confidently wrong |
| **CAC** ([:1213-1229](app/routes/app.affiliates.tsx#L1213-L1229)) | "How much are we paying to acquire an affiliate-driven customer?" | Compare to LTV for economics check | CAC by affiliate (exists ✅) | vs prev period | **Contaminated + misscoped** | (a) fix commission. (b) "new customers" is computed from `isFirstOrder` globally → overstates CAC denominator for affiliates who intercept organic customers. Scope to first order *per affiliate*. |
| **Affiliate LTV** ([:1276-1292](app/routes/app.affiliates.tsx#L1276-L1292)) | "Are affiliate-acquired customers worth more/less than organic?" | Reinforce if higher; cut if lower | Bar comparison vs organic | vs prev period | **Marginal** — it's actually "average revenue per customer in the selected period", not true lifetime. Also cohort-level only, not per-affiliate. | Rename "Avg revenue / customer" OR compute true LTV using all-time data per customer (regardless of period). Add per-affiliate LTV column in leaderboard for the keep/cut job. |
| **Repeat rate %%** ([:1357-1373](app/routes/app.affiliates.tsx#L1357-L1373)) | "Are affiliate customers loyal?" | Replicate high-repeat affiliates; cut low-repeat | Only cohort-level bars exist today | vs prev period | **Under-scoped** — cohort only; user's explicit dimension. | Add per-affiliate repeat rate column + drill-down → list of customers who came back (answers "what does each buy"). Fix first-order attribution first. |
| **AOV** ([:1416-1432](app/routes/app.affiliates.tsx#L1416-L1432)) | "Are affiliate customers buying bigger baskets?" | Match premium affiliates with premium SKUs | Only cohort-level bars exist today | vs prev period | **Under-scoped** | Add per-affiliate AOV column + basket depth (items per order) |
| **Leaderboard (host card)** ([:1503-1518](app/routes/app.affiliates.tsx#L1503-L1518)) | — (primary text is "Top affiliates" label) | — | Top-20 table | — | **Vanity (host card)** | Replace with real metric: *Top-3 share of affiliate revenue* → shows concentration risk. Action: if concentration > 60%, diversify. |
| **Product mix (host card)** ([:1525-1540](app/routes/app.affiliates.tsx#L1525-L1540)) | — (primary text is "Top products" label) | — | Top-20 products | — | **Vanity (host card)** | Replace with real metric: *SKU diversity* (# of distinct SKUs driven by affiliates) or *top-3 product share*. |
| **ROAS** ([:1547-1562](app/routes/app.affiliates.tsx#L1547-L1562)) | "Per R$ of commission + discount, how many R$ of revenue?" | Expand or contract the program | Waterfall revenue vs cost | vs prev period | **Contaminated** | Same as margin/CAC — fix commission ingestion |

Four of nine cards are contaminated by the 10% commission fallback. That's the single highest-leverage fix on the page.

## Blindspot sweep

### `critical`
1. **Commission %% is never ingested from BixGrow CSV.** Defaults to 10% for every affiliate → margin, CAC, ROAS, and commission totals are all derived numbers the merchant trusts but shouldn't. [storage.server.ts:191-304](app/affiliates/storage.server.ts#L191-L304).
2. **No per-affiliate customer drill-down exists anywhere.** The explicit user question has no answer in the current UI, even though all the data (`customerId` per `AffiliateOrder`, `lineItemsJson` per order) is already stored.
3. **No per-affiliate repeat rate / AOV / product mix.** Cohort-level only. The keep/cut decision the user asked for is portfolio-relative on exactly these dimensions, and they don't exist at the right grain.
4. **First-order attribution is global, not per-affiliate.** [analytics-queries.server.ts:20-30](app/affiliates/analytics-queries.server.ts#L20-L30). Any customer who ever bought organically then later used an affiliate code is "repeat" for that affiliate → inflates affiliate repeat rate, shrinks affiliate new-customer count, lies about CAC.
5. **`top10` and `recent` filter options are dead code.** See interaction audit.

### `important`
6. **Profiles tab is a read-only dead-end.** No edit, no deactivate, no manual add, no commission adjustment — even though `upsertAffiliateProfile` and `deleteAffiliateProfile` already exist in the storage layer. Unblocks a manual workaround for the commission bug.
7. **Leaderboard has no sort and no quartile bands.** For a portfolio-relative cut decision, the visual distinction between top and bottom is the whole point.
8. **Leaderboard is a hard-capped top-20 list.** No pagination, no "show all". For GE Beauty's program size this is fine today, but the ceiling is a timebomb.
9. **Sync progress bar is cosmetic.** Users distrust an animation that never moves on a multi-minute operation.
10. **No stale-sync warning.** If the last sync was 3 weeks ago, the dashboard still shows last-sync badge but not a "data is stale" banner. For a monthly review cadence, stale data during the review is a silent failure.
11. **No export.** If finance needs a payout sheet, users leave the app and do it in a spreadsheet anyway — then the dashboard is advisory only.
12. **Default comparison = none.** Delta arrows are the whole point; hiding them by default is a usability tax.
13. **Affiliate filter is an ungrouped flat dropdown.** Unscannable past ~30 affiliates. GE Beauty's BixGrow export is already into the hundreds.

### `nice-to-have`
14. **Geography / city clustering** — user explicitly deselected this. Park for Phase 2.
15. **Tier-level aggregation** — the `tier` field exists on profiles but nothing aggregates by tier.
16. **Affiliate tenure on leaderboard** — would help distinguish "new but fast" from "old but flat".
17. **Cross-affiliate customer overlap** — detecting customers using multiple codes would serve the fraud job the user said isn't the priority, but it's almost free given the data and would build trust in the per-affiliate drill-down.
18. **Last 12 months / YTD presets** for strategic reviews.
19. **Reuse pattern candidate:** the retail-footprint quartile visualization (if it exists on the retail page) — check and adapt rather than invent.

## Open questions for engineering
1. **How is commission %% actually tracked in the BixGrow export?** If it's in the CSV at all, the importer needs a column map update. If BixGrow doesn't expose it, the Profiles edit flow becomes a hard dependency for fixing the downstream numbers. *(This blocks fix #2.)*
2. **Is "first order via affiliate" a useful refinement, or should we instead track "first order after affiliate code first appeared on customer"?** These differ subtly for customers who used two codes.
3. **Does Lucas want the per-affiliate drill-down to show customer names/emails, or just counts + spend summaries?** (PII considerations + UX density.)
4. **For the portfolio-relative ranking, what's the minimum N of affiliates below which quartile bands hide?** 8? 12? Below that, quartiles are noise.
5. **Should the "compiled customer view" show customers who bought via this affiliate *in the selected period*, or all-time customers ever acquired by this affiliate?** These are very different answers and the user's quote is ambiguous — I suspect all-time is what he actually wants.

## Recommended next step

Two critical gaps are implementation-ready and can be fixed without a full redesign:

- [ ] **Fix #1 (data integrity):** Wire BixGrow CSV `commissionPct` ingestion + add Profiles edit flow. This alone makes 4 of 9 cards trustworthy. Can be tackled in a normal session — does not need `/product-developer`.
- [ ] **Fix #2 (UX):** Per-affiliate drill-down from leaderboard row click + sortable leaderboard with repeat / AOV / top product columns. This is a focused feature. Invoke:
  ```
  /product-developer app/routes/app.affiliates.tsx inputs/pm-handoff-affiliates-2026-04-11.md
  ```
  …with the scope narrowed to gaps 1, 4, and the per-affiliate drill-down (blindspots 2, 3, 6, 7 above). The rest (export, searchable filter, concentration metrics) are Phase 2.

Gaps 5 (`top10`/`recent` dead code), 7 (progress bar), 8 (default comparison) are one-line fixes that don't need a design pass — flag them for the next implementation session.

---

# Addendum v2 — Per-affiliate customer classification (2026-04-11)

## Why this addendum exists

Blindspot #4 in the original brief ("First-order attribution is global") was correctly identified but **the fix proposed in the v1 implementation plan was still wrong**. It scoped `isFirstOrder` per `(customerId, affiliateCode)` pair — which meant a customer whose real first order was organic, then later used an affiliate code, got re-classified as *new for that affiliate*.

Lucas caught it: **those aren't acquisitions, they're margin-leakage events.** The affiliate didn't bring a new human to the brand; they gave an existing customer a discount the customer wouldn't have needed to buy. That's negative value in most cases — the merchant pays commission AND absorbs a discount on a sale that was already going to happen.

**BUT** — and this is the nuance that saves the framing — such a customer is not *automatically* a leak. If the affiliate's discount code coaxes meaningful *subsequent* repeat behaviour out of them (beyond what the organic cohort achieves), the affiliate did add value: they reactivated a customer or unlocked latent loyalty. The only way to know which is to compare their post-affiliate repeat rate to the organic cohort's repeat rate.

This addendum replaces the "fix the global attribution" framing with a richer classification layer, with the display/flag/action decisions pinned via discovery.

## Stated needs (v2)

- **Lucas, verbatim:** *"The correct would be to flag such customers as an alert, since they were already customers, but now are using the coupon codes and hurting our margin. For them, the KPI that could indicate if the affiliate strategy helps is if their repeat rate is higher then that of their cohort's organic counterpart."*
- Decision cadence is unchanged: monthly portfolio review + quarterly keep/cut decisions.
- Target surface is the **Profiles detail view**, which was built in the v1 plan with a 3×1 KpiCard grid (Revenue / Customers / Products).

## Discovery locked in this session

1. **Action model = display + alert only.** No in-app transactional workflow (no per-affiliate "exclude leakage from commission" toggle, no auto-push Shopify discount rule change). Lucas will renegotiate / cut / change the code mechanics externally. Scope stays tight.
2. **Flag logic = intersection of two metrics.** Flag fires only when *leakage % is high* **AND** *loyalty-lift is low*. Leakage alone is not damning; it's exonerated by loyalty-lift when the pre-existing cohort actually buys more after the affiliate touch than organic baseline. An affiliate with 50% leakage but +2× loyalty-lift is fine (reactivation working). An affiliate with 40% leakage and flat loyalty-lift is the leak.
3. **Display placement = extend the existing Customers card.** Grid stays 3×1. Customers card primary text becomes a split ("62 new · 36 pre"), secondary line shows loyalty-lift with delta arrow. Alert ribbon appears at top of detail view when flagged. Classification visible as badges in the compiled customer drill table. No 4th card.

## Classification model

**Two hard categories**, with a soft sub-judgment applied to Category 2:

| Category | Definition | Source of truth |
|---|---|---|
| **Truly-acquired (new)** | Customer's globally-first order with the shop IS this affiliate order (or later affiliate order from the same affiliate, if their first-ever was organic/other-affiliate AND this affiliate didn't exist at that time — see open Q1 below). | Shopify customer's `firstOrder.id` compared to order id at sync time |
| **Pre-existing (leakage candidate)** | Customer had at least one prior order (organic or via a different affiliate) before their first order via *this* affiliate. | Same: Shopify `firstOrder.createdAt < currentOrder.createdAt` |

**Sub-judgment on Category 2 — the loyalty-lift test:**
- For each Category-2 customer, compute their **post-affiliate repeat rate** = (number of orders placed after their first order via this affiliate) / (number of Category-2 customers of this affiliate)
- Compare to the **organic cohort repeat rate** = `sum(repeatCustomers) / sum(uniqueCustomers)` from `AffiliateOrganicAgg` over the same period
- **loyalty-lift = post-affiliate repeat rate − organic cohort repeat rate**, expressed in percentage points
- When loyalty-lift > ~5pp (suggested default, tunable later), Category 2 is treated as "reactivation working"
- When loyalty-lift ≤ ~5pp, Category 2 is treated as "leakage"

**Why the threshold and not a hard test:** a tiny positive lift with a tiny sample is noise. A 5pp floor forces the lift to be materially above cohort before we call it a real signal. Sub-threshold: hide the flag when affiliate has fewer than 10 Category-2 customers (signal noise floor).

## Flag logic (precise)

An affiliate in the Profiles detail view is flagged when **all three** hold:

1. `totalCustomersTouched >= 10` (noise floor)
2. `leakagePct >= 30%` (customers touched who were pre-existing)
3. `loyaltyLiftPp < 5` (post-affiliate repeat rate of pre-existing customers is less than 5 percentage points above organic cohort)

Defaults are tunable. Expose as constants at the top of the classification module, not magic numbers in the query.

## Proposed narrative

1. **Context →** "This affiliate drove R$42k across 98 customers this month. But of those 98, 36 were already customers before they used the code."
2. **Insight →** "Those 36 pre-existing customers are buying +1pp more often than the organic baseline — which is not materially better than them just buying organically. That's R$12k of discounted revenue that probably would have happened without the commission."
3. **Action →** "Consider renegotiating @this-affiliate's commission to be new-customer-only, or restricting the code in Shopify to first-order buyers."

The narrative is the three layers of progressive disclosure: card headline → alert banner → drill table.

## JTBD matrix (new rows)

| Trigger | Business context | Desired outcome | System state change | Failure mode |
|---|---|---|---|---|
| Open Profiles detail for an affiliate | Monthly review — is this affiliate a net win? | Customers card primary shows `N new · M pre`; secondary shows loyalty-lift with delta; if flagged, alert ribbon appears at top with one-line diagnosis | `fetch-affiliate-detail` action returns `{ classification: { newCount, preCount, leakagePct, loyaltyLiftPp, cohortRepeatPct, isFlagged } }` alongside existing kpis | Enrichment data (`customer.firstOrder`) not yet populated → gracefully show "classification pending next sync" instead of fake numbers |
| Click Customers card | Understand who these people are | Drill expands: (a) stacked bar chart `new / reactivated / leak` using same `.vbarChart` pattern the Overview margin waterfall already uses, (b) compiled customer table with a new "Acquisition" column rendering a badge per row | Same `AffiliateDetailStats.customers[]` array, each row gains `acquisitionState: "new" \| "leak" \| "lift"` | Customer has no `firstOrder` data → show "unknown" state with muted styling, don't guess |
| See alert ribbon on flagged affiliate | Quickly judge whether this is a real problem | Ribbon text is diagnostic, not sensational: *"40% of touched customers were pre-existing; their post-affiliate repeat rate is +1pp vs organic — not materially above baseline."* Optional secondary link: "Show me what to renegotiate" (scrolls to the compiled customer table) | Pure UI computation from classification fields | Flag flickers on period change → debounce: only compute flag when the detail payload arrives fully loaded |
| Hover "loyalty-lift" in Customers card secondary | Understand what the number means | Tooltip: *"Pre-existing customers' post-affiliate repeat rate (X%) minus organic cohort repeat rate (Y%) for the same period. Negative or near-zero means the affiliate isn't unlocking extra loyalty."* | No state change; tooltip only | Tooltip too dense → keep under 30 words, defer full explanation to a docs link or "?" icon |
| Change period | Loyalty-lift and flag are period-scoped | Everything recomputes; flag may switch on/off with period | Existing `fetch-affiliate-detail` refetch, with classification included | Period too short for meaningful lift → hide the flag when `totalCustomersTouched < 10` in the selected window |

## Metric rubric (new metrics)

| Metric | Decision enabled | Action triggered | Drill-down | Comparison | Verdict | Fix |
|---|---|---|---|---|---|---|
| **Acquisition split** (Customers card primary: `N new · M pre`) | "At a glance, is this affiliate acquiring or recycling?" | If M >> N: inspect loyalty-lift and the compiled table | Stacked bar in Customers drill + per-row badges | Implicit vs portfolio average in the Profiles list (not in the detail view) | **Actionable** | Show counts, not %, as primary — counts survive small-N better than percentages |
| **Leakage %** (context metric, not headline) | "How much of this affiliate's activity is pre-existing customers?" | Pairs with loyalty-lift to trigger flag | Visible in drill stacked bar + alert banner text | Implicit vs portfolio median (future: quartile band on Profiles list) | **Contextual** | Never displayed alone — always paired with loyalty-lift. Without the pair it invites false positives. |
| **Loyalty-lift (pp)** (Customers card secondary) | "When this affiliate touches a pre-existing customer, do they buy more afterward than the organic cohort?" | Flat/negative → renegotiate; strongly positive → promote | Compiled customer table with per-row repeat count | vs organic cohort repeat rate (same period) | **Actionable — this is the verdict metric** | Label honestly: "vs organic baseline". Show tooltip with both raw numbers. |
| **Alert flag** (binary, intersection logic) | "Is this affiliate a leak right now, or just noisy?" | Click-through to drill → decide externally whether to renegotiate / cut / change code | Alert banner text IS the drill — it states both numbers | N/A (intersection of two thresholds) | **Actionable** | Noise floor (`totalCustomersTouched >= 10`) is non-negotiable |
| **Organic cohort repeat rate** (baseline, hidden metric) | "What's the floor loyalty-lift must clear?" | None directly — it's the baseline every affiliate is compared against | Displayed inside the loyalty-lift tooltip | N/A (it IS the comparison) | **Wired — must be computed even though it's hidden** | Compute from `sum(AffiliateOrganicAgg.repeatCustomers) / sum(AffiliateOrganicAgg.uniqueCustomers)` for the same period |

## Blindspots

### `critical`
1. **We cannot classify customers without enriching the sync.** `AffiliateOrder` doesn't know whether the customer was pre-existing, and `AffiliateOrganicAgg` is a monthly aggregate with no `customerId`. The minimum-viable enrichment is to add `customer { firstOrder { id createdAt } numberOfOrders }` to the existing `AffOrders` GraphQL query in [sync.server.ts:228-288](app/affiliates/sync.server.ts#L228-L288) — same pass that v1 added `displayName email` to. Then at insert time, compute `wasPreExistingCustomer = firstOrder.id !== order.id`. **Without this sync change, the entire classification layer cannot be built.** Also: existing rows in `AffiliateOrder` will need a backfill resync to populate the new field, otherwise historical orders will show "classification pending".

2. **The v1 first-order fix must be partially reverted.** The per-(customerId, affiliateCode) `isFirstOrder` scoping I landed is the *wrong* signal for this layer. Instead, we need a new column `wasPreExistingCustomer BOOLEAN` on `AffiliateOrder` populated at sync time from the Shopify enrichment. `isFirstOrder` can either go back to its original global meaning or be removed entirely — it no longer drives any metric if `wasPreExistingCustomer` is the source of truth for the classification. Recommend: remove `isFirstOrder` and its usage in `rebuildAffiliateMonthly` entirely, replace its downstream consumers (`newCustomers`, `repeatCustomers` columns on `AffiliateMonthly`) with counts derived from `wasPreExistingCustomer`.

3. **Loyalty-lift numerator is a lower bound, not a true rate.** We can only see orders the customer placed via affiliate codes (they're in `AffiliateOrder`). We cannot see subsequent organic orders unless we also persist organic orders per-customer. Short-term honest fix: label the metric "post-affiliate repeat via any code" or "trackable repeat after first touch" and accept it as a lower bound. Medium-term: if this metric becomes load-bearing, revisit the sync to persist organic customer IDs.

4. **Organic cohort baseline is coarse.** `sum(repeatCustomers) / sum(uniqueCustomers)` across all organic orders in the period is a single portfolio-wide number, not cohort-aware. A customer who first bought 3 years ago is pooled with a customer who first bought last month. Good enough for a v1 loyalty-lift, but the brief should note that this is an approximation and tag the metric in the UI with "vs portfolio baseline" so the comparison is honest.

### `important`
5. **"Pre-existing via *another affiliate code*" is ambiguous.** A customer who first used @ana, then used @lu, is pre-existing from @lu's perspective. Treat this as leakage for @lu? Or cross-affiliate shuffle with its own name? Recommendation: treat as leakage for the second affiliate (simplest, honest about the fact that @lu didn't acquire them), but badge them differently in the drill ("prior affiliate: @ana") so Lucas can see the pattern. This also helps spot code-sharing fraud (same customer hitting many codes in a short window) even though fraud detection isn't in scope.

6. **Badge design needs three states, not two.** Customer table rows need `"new"`, `"leak"`, `"lift"` visual distinction. Proposal: small colored pill using existing `s-badge` tones — `success` (new), `critical` (leak), `attention` (lift). Adds 8 characters of code per row plus i18n keys.

7. **Alert banner copy needs to be diagnostic, not sensational.** Avoid *"⚠ Margin leakage detected"* (invites false confidence). Prefer *"40% of this affiliate's customers were pre-existing; their post-affiliate repeat rate is +1pp vs organic — not materially above baseline. Consider renegotiating."* Costs more text but the copy is the product here.

8. **Threshold defaults should be constants, not magic numbers.** Export `FLAG_LEAKAGE_PCT`, `FLAG_LOYALTY_LIFT_PP`, `FLAG_MIN_CUSTOMERS`, `LOYALTY_LIFT_NOISE_FLOOR_PP` from a single module — e.g., `app/affiliates/classification-thresholds.ts` — so Lucas can tune them in a one-line edit if a weekly review shows false positives.

### `nice-to-have`
9. **Dormancy nuance** (was customer last seen 18 months ago vs 2 weeks ago) — deferred. The loyalty-lift metric already captures forward-looking judgment, so a dormant-reactivation customer shows up as "lift" if they repeat. A one-time reactivation shows up as "leak" — which is actually correct because a one-time reactivation that doesn't stick isn't a win.
10. **Cross-affiliate shuffle analytics** — how many customers are bouncing between codes as a leakage pattern across the portfolio.
11. **Portfolio-wide leakage histogram** — "average leakage % across all active affiliates is X" as a context card on the Overview tab.
12. **Quartile band on Profiles list for acquisition quality.** Currently the v1 plan quartiles by Revenue / Repeat / AOV. Adding a quartile on "truly-new ratio" would let the bottom quartile show leakage-heavy affiliates visually at list grain, not just drill grain.
13. **Histogram of loyalty-lift across the portfolio** — helps Lucas calibrate the 5pp threshold against his actual data.

## Open questions for engineering

1. **"First-order" definition for affiliates that didn't exist at customer first-order time.** If @lu.laranjeira joined the program in 2026 and a customer first bought in 2023, using @lu's code in 2026 is unambiguously pre-existing. But what if the customer's 2023 purchase was in a pre-program era with no affiliates at all? The answer doesn't change the classification (still pre-existing), but the framing should acknowledge "pre-existing" doesn't imply a lost opportunity for the affiliate — only that it's not an acquisition. The alert banner copy should reflect this.

2. **Sync enrichment cost.** Adding `customer { firstOrder { id createdAt } numberOfOrders }` adds one Shopify GraphQL sub-selection per order page. Shopify's field limit (`$first: 250` pages) likely stays within quota, but the sync will be slightly slower and cost more credits. Measure on first resync.

3. **Backfill strategy.** Existing `AffiliateOrder` rows won't have `wasPreExistingCustomer`. Two options:
    - **Nuke & resync**: drop the entire `AffiliateOrder` table and re-run `backfillAffiliateOrders` with the new sync query. ~Shopify quota × total orders. Simple.
    - **Lazy backfill**: add the column nullable, populate on next sync, and in analytics queries treat NULL as "unknown" (exclude from classification counts with a "N unknown" rollup). More complex query logic.

    Recommend: lazy backfill. Supports parallel agent work without a cross-session resync dependency.

4. **Threshold defaults.** Plan proposes `leakagePct >= 30%`, `loyaltyLiftPp < 5`, `totalCustomers >= 10`. These are educated guesses. The brief should ship with these numbers + a 2-week watchlist for Lucas to validate they're catching the right affiliates and not the wrong ones.

5. **How should the Profiles *list* (non-detail) reflect this?** The v1 plan already quartiled the list on Revenue / Repeat / AOV / Customers. Should the enhanced list *also* surface an "acquisition quality" quartile (truly-new ratio) or a dedicated "flagged" column? Recommendation: **add a flagged indicator column in the list** (small badge on rows where the affiliate is currently flagged). Skip adding a full quartile on acquisition — the alert badge carries the information without dedicating a sortable column.

## Revised next step

The addendum is narrow and builds on v1 work that's already on disk (but not yet committed/deployed — working tree is dirty pending coordination with parallel agents). Recommended sequencing:

1. **Before anything else, re-engage with the v1 working tree**: the per-`(customer, affiliateCode)` `isFirstOrder` scoping I landed is obsolete under this addendum. Either revert it (restore the original global scoping as a placeholder) or replace it directly with `wasPreExistingCustomer`. Don't ship the v1 classification and the v2 classification as two separate changes — they should land as one consistent story.

2. **Track A — sync enrichment (foundation):** Add `customer { firstOrder { id createdAt } numberOfOrders }` to `backfillAffiliateOrders`, add `wasPreExistingCustomer BOOLEAN` to `AffiliateOrder` schema, populate at insert time. Remove `isFirstOrder` and derive `newCustomers` / `repeatCustomers` on `AffiliateMonthly` from `wasPreExistingCustomer` instead. This is the **unblock** for everything else. Low-risk, incremental. Can be done in a normal implementation session — does not need `/product-developer`.

3. **Track B — classification in analytics + UI (the feature):** Extend `getAffiliateDetailStats` with the `classification` field. Extend `AffiliateDetailStats.customers[]` with `acquisitionState`. Update the Profiles detail view: Customers card primary, loyalty-lift secondary, alert ribbon, drill badges, stacked bar. Invoke `/product-developer` with this addendum as input:
    ```
    /product-developer app/routes/app.affiliates.tsx inputs/pm-handoff-affiliates-2026-04-11.md
    ```
    …with the scope narrowed to "Addendum v2 only" in the design prompt. The v1 detail view is already built — this is an additive layer on top.

4. **Track C — portfolio-wide surface:** Add the flagged-affiliate badge column to the Profiles list, add the histogram to the Overview tab (nice-to-have #11 and #13). Phase 2.

**Do not ship this alongside any of the v1 blindspot #4 work as two separate commits.** They touch the same concept and should land atomically to keep the repo coherent and avoid another Lucas catching another wrong intermediate state.

