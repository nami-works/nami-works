# GE Beauty — Field Notes

Insights from operational work that inform future app development. Each entry captures what we did, what was hard, and what a merchant would need as a product feature.

---

## 2026-03-29 — Discount & Merchandising Audit

### What we did
Full audit of the store's discount landscape: products, pricing, automatic discounts, code discounts, theme promotional content, metaobject badges, and collections. Cross-referenced what the customer sees (theme banners, PDP bars, compare-at prices) against what's actually configured (Shopify discounts, product prices, collection rules).

### Theme scraping for promotional consistency
Read the live theme's `header-group.json`, `config/settings_data.json`, and snippets (`promo-bar.liquid`, `shipping-bar.liquid`) via the Themes REST API. This revealed:
- **Announcement bar** rotating "até 15% off na promoção progressiva" — but no progressive discount existed, just flat 15% baked into prices
- **PDP banner** saying "compre 4 ou + produtos full-size e ganhe 15% off!" — implying a quantity gate that didn't exist
- **Gift progress bar** was disabled (`show_promo_bar_progress: False`) while the BxGy discount was active
- **Free shipping threshold** in theme settings (R$199) matched the automatic discount — but the promo bar milestones (R$250, R$299) were for a different incentive (gift-with-purchase)

**App insight:** A merchandising app should cross-reference theme promotional text against actual Shopify discount configurations and flag mismatches. This is something no existing tool does — merchants set banners manually and forget to update them when campaigns change.

### Inconsistencies found
1. **"Progressive" promotion was flat** — every product had 15% off regardless of quantity, contradicting the "buy 4+" claim
2. **Kit Verão double-discount** — 23.5% off baked into price + 10% automatic discount stacking = 31% total. Unintentional.
3. **GEBEAUTY10 code combined with everything** — only affiliate code with full combinability, allowing unintended stacking
4. **10,000+ stale discount codes** — return credits, seasonal promos from 2024, one-off codes never expired
5. **20 badge labels defined, 0 assigned** — etiqueta metaobjects ready but unused
6. **2 empty collections** — automated rules targeting tags no product had
7. **Rappi products at full price** — parallel catalog without compareAtPrice, potentially confusing if leaked to main storefront

### What was painful
- **No `read_discounts` scope initially** — couldn't see the actual discount objects, had to infer from prices alone
- **Shopify pagination without sortKey is unreliable** — returned different subsets on each run, causing the bulk update to miss ~6,000 codes. Fixed by adding `sortKey: CREATED_AT`
- **No way to filter discounts by combinability** — had to fetch all 11,698 codes and check each one
- **No way to query "show me all products where compareAtPrice discount % ≠ campaign target"** — had to compute manually
- **Theme content is split across multiple files** — announcement bar in `header-group.json`, PDP banner in `settings_data.json`, snippets in `snippets/`. No single view of "all promotional messaging"

### What a merchant would need (app features)
1. **Discount stacking detector** — show which discounts can combine and what the worst-case effective discount is
2. **Promotional consistency checker** — compare theme text (banners, bars, PDP) against active discounts and flag mismatches
3. **Stale discount cleanup** — surface codes with no end date older than X days, one-click expire
4. **Price-vs-campaign alignment** — verify all products in a campaign collection have the correct discount % applied
5. **Badge assignment dashboard** — show which etiqueta labels exist and which products have/lack them
6. **Dead collection finder** — collections with 0 products due to tag mismatches
7. **Bulk discount editor** — update combinability, expiry, or values across thousands of codes (what took us 40 min should be one click)

### API patterns that worked
- **Bulk update with idempotent loop:** Fetch all IDs, skip already-done, update remaining, repeat until 0 remaining. Script: `scripts/update_beautyback_combines.py`
- **Theme settings read/write:** `GET /themes/{id}/assets.json?asset[key]=config/settings_data.json` → parse JSON → modify → `PUT` back
- **Cross-referencing:** Query products (prices, tags, metafields), discounts (rules, combinability), theme (banners, settings), and collections (rules, product counts) in parallel, then correlate

### What Shopify can't do natively
- Filter discounts by combinability settings
- Show effective stacked discount for a product in a cart
- Compare theme promotional text against discount rules
- Bulk-edit discount combinability
- Detect compareAtPrice drift from campaign target percentage

---

## 2026-03-29 — BEAUTYBACK Bulk Combinability Update

### What we did
Updated 11,698 personalized cashback discount codes from `combinesWith: false/false/false` to `true/true/true` via the Admin GraphQL API.

### What was painful
- **Shopify caps `discountNodesCount` at 10,000** — couldn't get exact total upfront
- **Pagination instability** — without `sortKey`, each paginated run returned different subsets. First 3 runs only covered ~7,000 of 11,698. Fixed with `sortKey: CREATED_AT, reverse: true`
- **Rate limiting** — sustained ~2.5 mutations/sec. 11,698 codes took multiple passes over ~40 minutes total
- **Python output buffering** — `nohup` runs produced empty logs. Fixed with `PYTHONUNBUFFERED=1` and `-u` flag

### App insight
A discount management tool needs a "bulk edit" feature that can apply a single change (combinability, expiry, value) across thousands of codes reliably. The key requirements:
- Stable pagination (always use sortKey)
- Idempotent operations (skip already-done items)
- Progress tracking with ETA
- Auto-retry on throttle
- Loop-until-done pattern for large sets that exceed single-pass pagination limits

---

## 2026-03-29 — Dogfood: Merchandising
Spec generated at `docs/dogfood-merchandising.md` covering 6 enhancements from this session.
