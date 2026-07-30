# MIST Test — Campaign Rebuild Spec (in-house, PAUSED build)

Owner: CGO (`/growth-office`) · Executor: in-house API build · Date: 2026-07-27
Account: 606199920079315 (BRL) · Prefix `MIST-LAUNCH |` · `utm_campaign=mist-launch-2026-07`

Status: **design locked, build gated on Lucas.** Bleeder already PAUSED (campaign
`120250777492750228`, approved 2026-07-27). Nothing new spends until explicit activation approval.

## Decisions (Lucas, 2026-07-27)
- **Offer/destination:** creatives are the bait; **drive to the existing scent PDPs**, which
  already carry in-page AOV offers + checkout upsells. No bundle LP, no new store mechanic.
  "Fish for the AOV in-site."
- **Executor:** in-house API build (Meta Marketing API), per the original brief's per-placement
  `asset_customization_rules` pairing.
- **Kill/scale metric (CGO guardrail):** judge on **paid-cohort contribution per order** via
  per-order/per-hook UTM → Module A. NOT solo-order economics (proven to fail: CAC ceiling
  R$33–48 < ~R$49 CAC), NOT blended-store AOV (overstates — includes warm/returning). The
  campaign clears the floor only if cold-acquired orders basket up in-site enough; measure it.

## Why (root cause of the bleed)
Failed adset `120250777493270228` broke four winner-DNA rules at once: optimized ATC as the
end goal, unseeded broad (no interests/LAL/CA, no buyer exclusion), Advantage+ OFF, and
R$2,500/day on ONE adset. Result 554 ATC → 6 purchases (1.1% vs account 14–19%), ROAS 0.28,
CPA R$947. Fix = two-layer test→scale + winner-DNA audiences + right budget scale.

## Architecture (split by FUNCTION, not scent; scents ride as ads)

### LAYER A — `MIST | TESTE` (ABO)
- ABO (even budgets; CBO would starve laggard hooks and defeat the read).
- Optimization: `OFFSITE_CONVERSIONS → ADD_TO_CART` (cheap mid-funnel signal for hook validation).
  Confirm Pixel/CAPI ATC fires on all 3 mist PDPs before spend.
- Ads: all 27 kept hooks (9 Pear / 9 Santal / 9 Rose), per-hook `utm_content=<scent>_<cat>_cNN`.
- Adsets (prospecting only — retargeting isn't a fair hook-validation surface):
  - **T1 TOPO Seeded** — 3% LAL Purchase-180D + interest stack (Beleza, Cuidados com o cabelo,
    Perfumaria, Shampoo, Keratin, Engaged Shoppers, gifting). Advantage+ ON. Exclude Purchase-30D.
    **R$150/day.**
  - **T2 TOPO Broad-controlled** — Advantage+ broad, no interests, Advantage+ ON, Exclude
    Purchase-30D. **R$150/day.**
- **Test total R$300/day** (8x below the bleeder; matches account per-adset winner scale R$150–340).

### LAYER B — `MIST | ESCALA` (CBO)
- CBO, **winner hooks only** (promoted from Layer A). Empty until winners exist.
- Optimization: `OFFSITE_CONVERSIONS → PURCHASE`, → `VALUE/ROAS` once an adset clears ~50 purch/wk.
  Warm up 2–3 days in volume before flipping the ROAS floor. Floor start 3.5–4.0 reported,
  recalibrated end of week 1 to the platform ROAS that yields 10% real net on GE data (Module A).
- Adsets:
  - **S1 TOPO Seeded** — 3% LAL Purchase-180D + interest stack. Advantage+ ON. Exclude Purchase-30D.
  - **S2 FUNDO Retargeting** — ATC-30D + mist PDP/collection visitors + IG/FB engagers-30D.
    Advantage+ ON. Exclude Purchase-7D.
- **R$300–400/day** start, ramps only under the ROAS floor / Module A margin.

## Destination + message-match
- Each scent ad → its **matching scent PDP** (Pear→Pear, Santal→Santal, Rose→Rose). The winning
  hook's claim = above-the-fold headline of its PDP. In-page offers + checkout upsells do the AOV lift.
- No new build; PDPs are already equipped. (Confirm the AOV modules + free-ship progress render on
  all 3 scent PDPs before spend — a pre-flight check, not a build.)

## Promote/kill (wave = all 27 hooks; leading indicators make a wide wave affordable)
- **Day 3–4 leading-indicator gate:** kill bottom hooks (below account-median thumbstop / link-CTR
  ≥ ~1% / cost-per-ATC ≤ median). Log every drop (no silent truncation).
- **Day 7 (or ≥R$80–100 / ≥~50 ATC per surviving hook) purchase gate:** promote hooks whose
  **paid-cohort order contribution ≥ CAC + 10% net** (Module A, per-hook UTM). Survivors → Layer B;
  rest killed + logged. Winners also brief `/video-director` + UGC (flywheel output).

## BUILT 2026-07-27 (in-house, verified in-account, all PAUSED)
- Old bleeder `120250777492750228` = PAUSED. ✅
- `MIST | TESTE` = `120250838391560228` (ABO, no campaign budget) — PAUSED ✅
  - **T1 TOPO Seeded** = `120250838398060228` (ATC, R$150/day) — **the GE-buyer cell.** 3% LAL Purchase-180D `120207932517680228`, **no interests** (pure lookalike read). Advantage+ ON. Excl **Purchase 45D** `120250839003050228`.
  - **T2 TOPO Broad** = `120250838398660228` (ATC, R$150/day) — **the fragrance cell.** Fragrance interest stack (Victoria's Secret, Bath & Body Works, L'Occitane, Sephora, Granado) — **applied by agency via GB-1002** (Meta UI resolves interest IDs; our MCP has no interest-search). Advantage+ ON. Excl **Purchase 45D** `120250839003050228`.
  - 54 ads (27 hooks × 2 adsets), all configured status PAUSED. Reused existing creative_ids (per-placement pairing + baked utm_content carried over). New ads show PENDING_REVIEW = Meta's normal ad review, NOT delivery.
- `MIST | ESCALA` = `120250838393170228` (CBO, R$300/day) — PAUSED, empty shell. S1/S2 built at promotion time from winners.

### Audience-design change (2026-07-27, Lucas)
- Exclusion window pulled **30D → 45D**; created "Purchase 45D" WCA `120250839003050228` (pixel purchase, 45d) and swapped it into both test adsets.
- T1/T2 reworked into a **LAL-vs-fragrance read**: T1 = GE buyer-lookalike (no interests); T2 = premium fragrance interests (no lookalike). Day-7 tells us which audience the mist converts cold. Mass-tier BR brands (Natura/Boticário/Avon) rejected — GE is tier A/masstige.

## LAUNCH LOG
- **T2 fragrance interests: done IN-HOUSE (not via agency).** GB-1002 was created then cancelled (MCP misfire — no cancel tool; emailed CheckCommerce/Erico to kill it). Interests applied by Lucas + Claude in Ads Manager UI: Victoria's Secret, Bath & Body Works, L'Occitane en Provence, Sephora. **Granado dropped** (no Meta interest — resolves to Granada, Spain). Mass-tier BR brands (Natura/Boticário/Avon) rejected — GE is tier A/masstige.
- **Location deprecation (#1870194) fixed** on both cells: `location_types` `home` → `home,recent` (re-selected Brasil país in UI).
- **Nemu tracking applied to all 54 ads** (url_tags = `utm_source=facebook&utm_medium=cpc&...&nemu_*` with name|id macros). Destinations are clean scent PDPs → single clean tag, no double-tag.
- **Pre-flight PASS:** PDP AOV mechanic confirmed live (Santal + Pear): tiered 10/15/20% volume discount on *attached full-size* products (not the mist) + R$299 free-ship. ATC pixel fires (958727274605304).
- **2026-07-28 — FULL TEST LIVE.** Campaign `MIST · TESTE` ACTIVE. **T1 TOPO Seeded ACTIVE** (~R$150/day, 27 ads) then **T2 TOPO Broad ACTIVE** (~R$150/day, 27 ads) after a clean T1 delivery check (T1 delivering, 0 ad rejections). Total R$300/day. Launched **as-built on ATC** (ATC→IC deferred). **MIST · ESCALA stays PAUSED** (CBO shell, winners only). Old bleeder stays PAUSED.

## Watch plan
- **First hours:** confirm T1 delivering + Nemu tag lands (utm_source=facebook on first clicks/orders in Nemu/Shopify) → then activate T2.
- **Day 3–4:** leading-indicator gate — kill bottom hooks vs wave median. Log drops.
- **Day 7:** paid-cohort contribution gate (Module A). Use **discounted-basket** contribution (PDP gives 10–20% off attached full-size), NOT list price. Promote winners → ESCALA; else fold hooks into agency campaign / retire. Never scale on ATC alone.

## Open items
- **Attach-discount margin nuance:** the PDP volume discount trims contribution on the attached heroes that make the basket clear the floor — Module A day-7 read must use discounted-basket contribution.
- **Pear PDP copy:** flavor line says "destino: Indonésia" while ads say "Bali" — cosmetic message-match fix.
- **ATC → Initiate Checkout:** recommended, deferred; revisit if the ATC read is noisy.
