# GE Beauty — Growth KPI Analysis (Module A sweep, 2026-07-21)

My own sweep of the available data: Shopify order history (13 months, 44,023 paid
orders, 35,142 customers) + Meta Ads (account 606199920079315, live) + the confirmed
unit-economics model. Built to answer the mandate's CAC / ROAS / LTV / floor questions
from real data rather than founder estimates.

Sources: `contribution.py` (per-order margin), `kpi_sweep.py` (retention/LTV),
meta-ads MCP (spend/ROAS). Reads saved to `read-30d.json`, `kpis.json`.

## 1. Unit economics (confirmed with Lucas)

% of total revenue (= product net + 5% freight revenue):

| | Rate | New order (R$214 total rev) |
|---|---|---|
| Contribution margin | 42.05% | ~R$90 |
| 10% net floor | 10% | R$21 |
| **Max allowable CAC** | | **~R$68 / new customer** |

## 2. Acquisition efficiency (Meta, last 30d)

| KPI | Value | Read |
|---|---|---|
| Meta spend | R$81.9k | ramping (+38% vs the R$59k 30d a month ago) |
| Blended ROAS | 4.46 | down from 5.29 a month ago — diminishing returns, live |
| 90d ROAS | 4.89 | |
| Prospecting spend/ROAS | R$78.7k (96%) @ 4.33 | nearly all spend is acquisition |
| Retargeting (engaged) spend/ROAS | R$3.1k (4%) @ 7.60 | tiny, very efficient, underfunded |
| **Blended CAC** (spend ÷ all new) | **R$28** | over-credits Meta (counts organic/Google/retail new too) |
| **Paid CAC** (Meta-attributed) | **~R$49** | truer; = prospecting spend ÷ ~1,593 attributed new orders |
| Est. MER (total online ÷ spend) | ~7 | compressing from the ~8.3 measured a month ago |

**Floor verdict:** paid CAC ~R$49 < ceiling R$68 → acquisition **clears the 10% floor**,
margin-after-media ≈ 19% on a new order. **Payback is immediate** (first-order
contribution R$90 > CAC R$49), so LTV is pure upside — the mandate's core worry (H2)
is resolved: first orders are profitable. BUT the cushion is only ~R$19/order and
**shrinking as ROAS compresses** with the spend ramp. Marginal CAC is the governor.

## 3. Where spend works vs leaks (30d campaigns)

- Workhorse `[REGULAR][CONVERSAO][ABO][MISTO]`: R$39.1k @ 4.70 (48% of spend).
- Creative testing `Novos Vídeos`: R$15.5k @ 5.60 (19%) — healthy test bench.
- **Winners starved:** Novos Vídeos *Validados* 7.71 @ R$1.5k; review creatives 6.67 /
  4.26 @ ~R$1k. Under 2% of spend each.
- **The creative-testing tax:** ~R$25k (30% of spend) in Primer Cachos/Liso tests at
  1.18–4.26 ROAS; several (Liso Coloquial 1.18, Liso Institucional 1.74, Cachos
  Coloquial 2.13) are **below the ~2.9 breakeven** — real loss, not just testing cost.
- Travel-size giveaway `[GANHE MINI][NOVOS]`: R$1.2k @ 7.59 — the tripwire, efficient.

## 4. Retention & LTV (13 months, all channels)

| KPI | Value | Read |
|---|---|---|
| Customers / orders | 35,142 / 44,023 | 1.25 orders per customer |
| **Repeat rate** | **15.8%** | 84% one-and-done — the single biggest latent lever |
| Time-to-2nd purchase | median **63d** (p25 19, p75 125) | defines replenishment-flow timing (Module E) |
| Returning revenue share | 22.2% | |
| Mature 12-mo LTV | R$383 product / **R$169 contribution** | 2 cohorts with 365d maturity (Jun–Jul 2025) |
| **LTV : CAC** | **6.0** (blended CAC) / **3.4** (paid CAC) | both healthy (>3); room exists if we ever fund payback from repeat |

**Cohort LTV curve (contribution R$/customer):**

| Cohort | new | d30 | d90 | d180 | d365 |
|---|--:|--:|--:|--:|--:|
| 2025-06 | 997 | 101 | 113 | 143 | **173** |
| 2025-07 | 2316 | 102 | 113 | 138 | **165** |
| 2025-11 | 4871 | 96 | 103 | 110 | — |
| 2026-01 | 4237 | 86 | 90 | 94 | — |
| 2026-06 | 1816 | 74 | — | — | — |

**Flag — early LTV is drifting down** (d30: R$101 in 2025-06 → R$74 in 2026-06). Partly
a mix artifact (this sweep does NOT exclude the travel-size giveaway cohort, which
entered in 2026 with near-R$0 first orders and dilutes recent cohorts). Needs a
giveaway-excluded cohort re-run to separate real quality drift from mix. Registered as
the top follow-up.

## 5. The three findings that should drive the next moves

1. **Acquisition is profitable but the cushion is thin and eroding.** Paid CAC ~R$49
   vs R$68 ceiling, and ROAS fell 5.29→4.46 in a month as spend ramped. The scale
   question is entirely about the *marginal* CAC curve — which needs the incrementality
   test (mandate Phase 5) before a big ramp, not after.
2. **Retention is the biggest untapped lever.** 84% one-and-done, median 63-day
   time-to-2nd. A replenishment-timed flow at ~day 45–60 (Module E) is the highest-ROI,
   zero-discount move available and is exactly what the review-repurchase engine is
   built for.
3. **Reallocation beats new budget right now.** ~R$25k/30d sits in below-breakeven
   creative tests while 7+ ROAS winners are starved at <R$2k. Graduating validated
   winners and cutting the sub-breakeven tests lifts blended efficiency before spending
   a marginal dollar (the free-efficiency harvest the paid-media initiative already flagged).

## Caveats (so the numbers are read honestly)

- Retention/LTV/repeat customer base is **all-channel** (online + retail POS + Rappi +
  marketplace), so repeat rate and LTV blend DTC with retail walk-ins; DTC-only would
  differ. Acquisition CAC/ROAS is Meta/online.
- **Paid CAC ~R$49 is Meta-attributed** (prospecting spend ÷ implied purchases), not a
  clean per-customer channel join. The Module A v1 media layer (UTM/channel attribution)
  will replace the estimate with a measured number.
- Cohort LTV includes giveaway acquisitions (2026) — see the §4 flag.
- ROAS is Meta platform attribution; likely overstates true incremental effect
  (triangulate with the incrementality test).
