# Module A — Attribution & Unit-Economics Engine

The measurement spine of the GE Beauty Chief Growth Office. Everything else in the
growth mandate re-baselines off this. Built FIRST because the 10% net-profit floor is
meaningless until we can compute true net contribution per order per channel.

See the office of record: [`.claude/initiatives/gebeauty-chief-growth-office.md`](../../../.claude/initiatives/gebeauty-chief-growth-office.md).

## What it computes (confirmed structure, % of TOTAL revenue)

Model is on TOTAL revenue = product net sales + freight revenue. Structure confirmed
with Lucas 2026-07-21.

```
product net sales (Shopify lineItem discountedTotal, excl. freight/tax)
  + freight revenue     (5% of product net; blended sub/non-sub)
  = TOTAL revenue
  - COGS                (22% of total; per-SKU cost-basis.json x calibration 1.48)
  - taxes               (12% of total)
  - payment fees        (3.95% = 3.5% acquiring + 0.45% Shopify)
  - freight cost        (17% of total)
  - fulfillment         (3% of total)
  = contribution before media   (~42% of total revenue)
  - allocated media     (per-channel spend / channel orders)   [TODO: v1 media join]
  = net profit  -> checked against the 10% floor (a POST-media gate)
```

COGS is bottom-up per-SKU (so the engine can rank products) but scaled by
`cogs_calibration_factor` so the aggregate matches Lucas's real 22% — the raw B2B
"preco minimo" study understates true COGS (~16%) because it excludes inbound
freight / duty / breakage. Replace the calibration with real per-SKU costs when
available. The 10% floor is a POST-media gate, so it only goes live with the v1
media-allocation layer.

## Files

| File | Role |
|---|---|
| `../cost-basis.json` | Per-SKU landed unit cost (from the B2B break-even study) + retail. The real COGS. |
| `../params.json` | Fees / tax / shipping / floor. **UNCONFIRMED money assumptions** — flagged. |
| `contribution.py` | The engine. Read-only Shopify pull → per-order economics → aggregates. |
| `read-*.json` | Saved reads per window. |

## Run

```
python contribution.py --days 30                 # last 30 days
python contribution.py --since 2026-06-01 --until 2026-07-01 --out read-jun.json
python contribution.py --days 7 --max-orders 40  # quick smoke
```

## First read (2026-06-21 → 2026-07-21, 3,773 paid orders, giveaway-excluded)

The free travel-size acquisition campaign ("pague só o frete") is **excluded by
default** — 699 near-R$0 orders (15.6% of paid orders) that distort AOV. They are a
deliberate tripwire whose payback is the 2nd purchase, so they must be measured as
their own cohort. Detection: a travel-size SKU line billed at ~R$0 (code-independent)
or the gift code. Add `--include-giveaway` to see them.

| Metric | Blended | New customer |
|---|---|---|
| Product AOV | R$209 | R$203 |
| Total revenue / order (+5% freight) | R$219 | R$214 |
| COGS (calibrated to 22%) | 22.0% | 22.0% |
| **Contribution before media** | **42.1% (R$92/order)** | **41.8% (R$90/order)** |

**The 10% floor as a CAC ceiling (the real governor):** to hold 10% net on a new
order, **max allowable CAC ≈ R$68** (contribution R$90 − floor R$21). At the stated
~R$50 blended CAC, net ≈ 18% — headroom exists but is modest (~R$18/order cushion),
and marginal CAC rises as spend scales. The v1 media-allocation layer replaces the
stated R$50 with measured per-channel CAC and makes the floor a live gate.

This reconciles with the BP's 20-25% net-after-media: 42% contribution − ~23% media
≈ 19-22% net. The mandate's H2 (first orders near breakeven) is false on variable
economics; the real constraint is marginal CAC + fixed-cost absorption.

## Roadmap (v1+)

1. **Media-allocation layer** — join Meta (meta-ads MCP, live) + Google Ads (needs
   access) spend by channel/window; allocate CAC per order; make the 10% floor a real
   post-media gate. This is what turns Module A from a margin model into an
   attribution model.
2. **Branded vs non-branded Google split** (mandate H1, the biggest budget-allocation
   question) — needs Google Ads access.
3. **Cohort LTV curves** by acquisition channel + first product (3/6/12/24-mo).
4. **Kit/bundle COGS expansion** — kits are native bundles; expand to component costs
   (closes the ~5.5% uncosted gap). See [[reference_gebeauty_bundle_lineitem_attribution]].
5. **Shipping cost per order** — real freight cost (Intelipost/carrier), not just
   shipping charged, to make the net line honest on free-ship (≥R$299) orders.

## Blockers

- Google Ads + Klaviyo have no local tooling yet (data access).
- `params.json` tax/fee/shipping are unconfirmed (money calls for Lucas).
- claude.ai MCP GE Beauty / Magnific / Slack / foreplay need auth in an interactive session.
