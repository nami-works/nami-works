# GE Beauty — Customer-Tag Namespace Audit

**Date:** 2026-07-14 · **Author:** session `shopify_cleansing` · **Store:** ge-beauty-cosmeticos.myshopify.com

## Why this exists
`GROUP BY customer_tag` reports (ShopifyQL) fan every customer across *all* their tags, so cohort reports drowned in noise. ShopifyQL has no dimension-value whitelist, so the durable fix is **fewer, cleaner tags per customer**. This audit enumerated the namespace, classified each family by writer/consumer/status, and drove the cleanup below.

## TL;DR — state after this session
| | Before | After |
|---|---|---|
| Distinct customer tags | **3,605** | **1,897** |
| …of which live-app ZOKO noise | 1,795 | 1,796 |
| **Meaningful (non-ZOKO) tags** | ~110 | **101** |
| Avg tags / customer | ~2.2 | **1.81** |

**Done:** removed all `CPF:` (1,716 custs) and all `rfm_*` (144,657 custs) tags; migrated RFM to Klaviyo-native + Shopify-native. **Held:** `Migration1` (→ VNDA backfill initiative). **Flagged:** ZOKO is a live writer (do not hand-delete).

---

## Census (2026-07-14, 144,851 customers)
- 3,605 distinct tags originally; **3,271 were held by exactly one customer** — 97% of the namespace was two junk families: `CPF:` (1,697) and `ZOKO_CONFLICT_WITH_*` (1,795).
- Only ~30 tags are referenced by any Shopify customer Segment (135 segments pulled); the rest feed Klaviyo, apps, or nothing.

## Actions taken this session

### 1. `CPF:` family — REMOVED ✅
- 1,697 unique `CPF: <taxid>` tags across 1,716 customers (1,719 removals). Verified 0 remain.
- **Origin:** physical-retail POS artifact. CPF-tagged customers' orders were ~71% Point-of-Sale (Shopify POS + IGLU POS). Writer is **dead** — recent POS buyers are not tagged (≤11% carry it, all legacy). Safe permanent removal.
- **Also a PII win:** tax IDs no longer sit in the free-text tag field / exports / Klaviyo `Shopify Tags`.

### 2. `rfm_*` family — REMOVED ✅ (superseded by native RFM)
- 12 tags (`rfm_00_prospect … rfm_10_dormant`, `rfm_very-recent`), 144,657 customers, 148,777 removals, 0 errors.
- **Why safe:** Shopify now computes `rfm_group` natively (the Shopify `rfm_*` segments already query it, matching the tags 1:1 but self-updating — the tags were a stale, drifting mirror). Klaviyo consumed the tags via the `Shopify Tags` profile property; those audiences were rebuilt on **Klaviyo-native** conditions first.
- **Klaviyo replacement segments** (built + validated): `Compradores engajados` (0–180d, 19,236) / `Winback` (181–365d, 13,348) / `Quase perdidos` (366–540d, 7,219). Klaviyo predictive analytics is live and sees POS orders (verified 40/40 match), so native RFM is strictly better than the tag bridge.
- **Guardrail noted for the reengagement flow:** it targets the *email-engagement* axis, not purchase recency — use purchase signal there only as a suppression guardrail, not a trigger.

### 3. `Migration1` — HELD (not removed)
- 49,368 customers. Reframed as the **historical-import cohort marker**: these are pre-Shopify VNDA customers with no Shopify order history, which is why they misclassify as "prospects."
- Feeds the initiative **`.claude/initiatives/gebeauty-vnda-order-backfill.md`** (VNDA export located: 48.5k confirmed orders 2020–2024; 95.7% email-match; ~29.6k enrichable). `Migration1` is removed in that initiative's phase 6, after real history lands.
- **Dependency to respect:** Shopify native segments `rfm_10_dormant` / `rfm_00_prospect` and the `*_Next Day_Rio` delivery segments use `Migration1` to split dormant vs prospect — don't remove it until those are migrated/decommissioned.

---

## ZOKO_CONFLICT family — LEAVE (live app writer) ⚠️
- 1,796 distinct `ZOKO_CONFLICT_WITH_*` + `ZOKO_CUSTOMER_CONFLICT` tags on ~2,100+ customers — now the largest single family (95% of the remaining namespace).
- **Zoko (WhatsApp app) writes these in real time** — most-recent tagged customers updated *today*, one created today with the tag. Hand-deletion is futile (re-added) and risky (app-owned).
- **No Shopify segment and no Klaviyo segment consumes them.** They are pure noise in reports + Klaviyo `Shopify Tags`, but the fix is at the app/data-quality layer.
- **Root issue:** they signal duplicate customer records (phone/email conflicts between WhatsApp and web). **Recommend a separate track:** dedupe customers and/or configure Zoko to stop emitting conflict tags. Do not bulk-remove while Zoko is live.

---

## The 101 meaningful tags — classification

### KEEP (active, consumed)
| Family | Examples | Writer | Consumer | Note |
|---|---|---|---|---|
| Retention machine | `retention-reactivation`(+`_26-07-06`,`_control`), `credit-reactivation`, `wave-reactivation-send-*`, `retention-refill` | `gebeauty/retention-machine/` scripts | live store-credit email template; mid-measurement | KEEP stable arms; prune dated per-wave variants after the measurement closes (see `gebeauty-review-repurchase`) |
| POS / retail | `pdv_todos`, `pdv_shops-jardins`, `pdv_riosul`, `pdv_shopping-recife`, `pdv_riomar-recife`, `pdv_iguatemi-fortaleza`, `pontos_fisicos` | POS / retail | Shopify segment `pdv_todos` (OR of the pdv_* tags) + retail reports | KEEP |
| Affiliate / commissioned | `afiliada`, `comissionada` | manual | Shopify segments `CLUBE GE BEAUTY`, `comissionadas` | KEEP |
| Discount-hunters | `cacadores-desconto`, `cacadores-desconto-klaviyo` | manual/Klaviyo | Shopify segment `Caçadores de Desconto Klaviyo` | KEEP; consolidate the two variants into one |
| Newsletter | `newsletter` | signup | subscription targeting | KEEP |
| Klaviyo sync control | `not-klaviyo-09.09` | Klaviyo integration | Shopify segment `{dormant}not-klaviyo-09.09` | KEEP; verify still needed |
| Fiscal / LD ops | `fiscal-hold-extrema-2026-05`, `ld_fiscal-hold-credited-2026-05` | ops scripts | Shopify `Fiscal hold` segments | KEEP while open; prune when resolved |

### LEAVE (app-owned — never hand-delete)
| Family | Examples | App |
|---|---|---|
| Reviews | `Loox - Post purchase Advocate`, `Loox - Onsite Advocate`, `Loox - Post review Advocate` | Loox |
| Quiz | `Octane: quiz completed: …` | Octane AI |
| Popups | `Wheelio App`, `PRIMEIRAPOPUP` | Wheelio |
| Signup source | `shopify-forms-<id>` | Shopify Forms |
| Platform | `Shop`, `Login with Shop` | Shop app / Shopify |

### CONSOLIDATE / REMOVE (legacy one-offs — verify no consumer, then prune)
| Family | Examples | Disposition |
|---|---|---|
| BEAUTYBACK batches | `beautyback-2026-05-19-A/B` | Prune once codes redeemed/expired |
| Birthday months | `aniversariantes_outubro/agosto/julho` | **Superseded** by the `custom.birthdate` metafield + native `anniversary()` segments — remove |
| Dated campaign/import one-offs | `the-news_25-6-6`, `cg_shampooaseco_fev.25`, `envio-2602`, `bf2024`, `Compradores oct/nov 2024`, `Rio de Janeiro`, `PRIMEIRAPOPUP`, `relaxfriday` | Remove after confirming nothing reads each (most are inert) |
| Product-launch VIP lists | `pluma-vip`, `pluma-leave_in<90`, `vip_melon-mood`, `champion_sp/rj/rec/for` | Prune after the launch window |

> Note: several of these *are* referenced by a saved Shopify segment (e.g. `pluma-vip`, `envio-2602`, `the-news_25-6-6`, `aniversariantes_agosto`). Deleting the tag empties that segment — check and delete the stale segment alongside the tag.

---

## Consumption map (who reads customer tags)
- **Shopify Segments:** ~30 tags referenced (pdv_*, afiliada, comissionada, cacadores-desconto, not-klaviyo-09.09, Migration1, Loox -*, pluma-vip, fiscal-hold-*, a few dated imports).
- **Klaviyo:** all Shopify tags sync into one `Shopify Tags` list property; segments/flows can filter on it. RFM was the main consumer (now migrated off). **API cannot read flow *conditional-split* filters** — a manual UI check is required before removing any tag a flow might branch on.
- **Apps:** Loox, Octane, Wheelio, Shopify Forms, Shop, **Zoko** write their own tags.

## Recommended next actions
1. **ZOKO data-quality track** (separate): dedupe conflicting customer records; stop/curb Zoko conflict-tagging. Biggest remaining namespace item, but not a tag sweep.
2. **Birthday tags → metafield:** retire `aniversariantes_*` in favor of the existing `custom.birthdate` anniversary segments.
3. **Dated one-offs:** batch-remove expired campaign/import tags (BEAUTYBACK, `the-news`, `bf2024`, etc.) + their stale segments, after a per-tag consumer check.
4. **Consolidate** `cacadores-desconto` + `cacadores-desconto-klaviyo` into one.
5. **VNDA backfill** (initiative) → then remove `Migration1`.
6. Before any Klaviyo-consumed tag removal: manual flow-filter check (API-blind).

## Method / data
- Census via Shopify bulk operation (`customers { id tags }`); removals via `bulkOperationRunMutation` + `tagsRemove` (never `customerUpdate` — preserves other tags).
- Consumption via Admin API `segments` + Klaviyo API (segments/flows read-only). Klaviyo does not expose segment/flow *definitions* — inferred by name + `profile_count` matching.
- Working scripts/outputs are in the session scratchpad (ephemeral, re-runnable).
