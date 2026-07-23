# GE Beauty — Reviews as a Conversion Driver (strategy + measurement)

Single source of truth for the initiative: turn the Loox review corpus into a
measurable conversion lever. Companion data files in this folder:
- `top-reviews-per-product.md` — conversion-ranked top 10 per product (human)
- `top-reviews-per-product.json` — same, machine-readable (for featuring automation)
- scripts: `../../scripts/_rank_top_reviews.py`, `../../scripts/_inspect_loox_theme.py`

---

## 1. What we have (data truths)

- Reviews are pulled LIVE from the **Loox API** (`gebeauty/scripts/loox_reviews.py`; creds in
  `gebeauty/.env`). ~2,368 published reviews store-wide, all ratings 1–5★. The old
  `gebeauty/data/reviews.csv` export was 4–5★ only (it hid every negative review) and was
  deleted 2026-07-23 — never resurrect it. This featuring tool self-filters to 4–5★ on purpose
  (you pin positive social proof); concern mining uses the full corpus. ~5% have photos.
  `verified` is a soft signal, not a filter (migrated handles lost the flag).
- Reviews are **fragmented across duplicate handles** (full-size / travel-size / rappi /
  migrated). ~30% of reviews are stranded off the canonical PDP. Pooling by product family
  is required before any per-product view is meaningful.
- "Top 10" is the right number: **Loox lets you feature (pin) up to 10 reviews per product.**
  Our ranked list maps 1:1 to Loox's curation slot.

### Killer-review inventory (5★ + substance; photo or 2+ benefit themes)

| Product | Killer | Photos | Gap to 10 killer |
|---|---:|---:|---:|
| Leave-in com Proteção Térmica | 85 | 5 | 0 |
| Máscara Condicionadora | 53 | 6 | 0 |
| Melon Mood | 37 | 28 | 0 |
| Shampoo sem Sulfato | 35 | 9 | 0 |
| Booster Definição | 28 | 9 | 0 |
| Primer Cachos Definidos | 22 | 17 | 0 |
| Booster Hidratante | 21 | 2 | 0 |
| Leave-in Pluma | 12 | 4 | 0 |
| Booster Fortificante | 12 | 0 | 0 |
| Primer Liso Intacto | 10 | 5 | 0 |
| **Shampoo a Seco** | **3** | 0 | **7** |
| **Booster Antifrizz** | **5** | 4 | **5** |
| **Booster Antioxidante** | **6** | 3 | **4** |
| **Máscara Mayday** | **6** | 5 | **4** |

10 of 14 heroes are ready to feature now. 4 need an incentive top-up (§4).

---

## 2. Current Loox state — audit

### Theme side (verified from published theme `[Check] - Produção`)
| Element | Block | State |
|---|---|---|
| Loox script loader | `loox-inject` (app embed) | ON |
| Main reviews widget (PDP) | `loox-dynamic-section` | ON |
| Snippet stars near title (PDP) | `loox-snippets-widget` | ON |
| Testimonial carousel (PDP) | `loox-testimonial-carousel-section` | ON |
| Star-rating badge (PDP) | `loox-rating` | **OFF** |
| Homepage | `loox-video-slider` | ON (but corpus is photo-heavy → likely sparse) |

### Loox-admin side (NOT visible from theme — Lucas must confirm in Loox admin)
These three settings are what actually make the top-10 strategy work:
1. **Widget sort order** → must be **"Featured"** or **"Smart review sorting"**, or pinned
   reviews don't surface first. (Loox: Reviews widget → sorting.)
2. **Product Grouping** → groups duplicate handles to share one review pool, un-stranding the
   ~30%. **Requires Loox "Convert" plan or higher.** (Loox: Settings → Product groups.)
3. **Current featured pins** per product (how many of the 10 slots are used today).

Also admin-only: AI Review Sorting toggle, rich-snippets (Google stars) toggle, plan tier.

---

## 3. The plan — put them front and center

1. **Grouping first** (highest leverage). Group each family's duplicate handles so the
   canonical PDP shows the full pooled review set + count. Requires Convert plan — confirm tier.
2. **Set sort to Featured (or Smart/AI)** so pins surface first.
3. **Pin the top 10** per hero PDP from `top-reviews-per-product.json`.
   - Recommended mode: hybrid — turn AI/Smart sorting on catalog-wide as the baseline, then
     manually pin the curated 10 on the hero PDPs where narrative control matters (Primers,
     Leave-in Térmico, Melon Mood, Máscara Condicionadora).
4. **Re-enable the star badge near the title** (or confirm the snippet widget renders stars
   above the fold). Above-the-fold social proof is the highest-impact placement.
5. **Swap the homepage video slider** for (or add) a photo "Happy Customers" carousel led by
   Melon Mood + Primer Cachos (the photo-rich products).
6. **Turn on rich snippets** so star ratings show in Google results (organic CTR lift).

---

## 4. Review-incentive campaign (fill the killer gap)

**Objective:** get every hero product to ≥10 killer reviews (photo-preferred). Primary
targets: Shampoo a Seco (+7), Booster Antifrizz (+5), Booster Antioxidante (+4),
Máscara Mayday (+4). Secondary: enrich photo coverage on Booster Hidratante (2) and
Booster Fortificante (0) so their pinned 10 include photos.

**Mechanic:** Loox automated review requests (post-delivery) with a photo-review incentive
(discount code or loyalty points for an approved review, larger reward for a photo review).
Target past buyers of the specific SKUs that are short — segment by product purchased.

**Constraints / flags:**
- **Máscara Mayday is `lancto`** (launch-exclusion from promo discounts). A review-incentive
  discount technically grants a discount on a launch product. Decide: exclude Mayday from the
  discount-based incentive and use loyalty points only, or accept a small review-only coupon.
- Benefit-only language, no em dashes, bilingual rules apply to all request copy.
- Idempotency: don't re-request from customers who already reviewed the SKU.

Full brief to be drafted on approval (channel: Loox native vs Klaviyo flow, reward size,
expiry, copy).

---

## 5. Pre/post measurement — "is there a formula?"

Goal: prove (or disprove) that featuring reviews lifts conversion, **per product**, with a
design that controls for seasonality and promos.

### Design: staggered rollout = built-in control (difference-in-differences)
- **Wave 1** (now): the 10 heroes already at ≥10 killer reviews → group + pin + badge.
- **Wave 2** (after campaign): the 4 gap products, once topped up.
- At each wave, **products not yet tweaked are the control cohort.** Compare tweaked-cohort
  CVR change against control-cohort change over the same window → isolates the review effect
  from store-wide seasonality/promos.

### Metrics (per product)
- Primary: **PDP conversion rate** = purchases / product page views.
- Secondary: add-to-cart rate, revenue per PDP view, AOV, units/week.
- Assist: Loox's own review-influence analytics (included on Convert plan) as a cross-check.

### Windows
- 4 weeks pre-tweak baseline / 4 weeks post, equal length, avoid overlapping a major promo
  (Consumer Month, BEAUTYBACK pushes). Snapshot weekly.

### Decision rule
"Formula confirmed" if tweaked products' CVR lift exceeds control drift by a meaningful
margin (set threshold, e.g. ≥ relative +X%) across a majority of products, consistently.

### Data-source decision (BLOCKER — needs Lucas)
True CVR needs PDP-view data, which the current Shopify token scopes do NOT expose
(no `read_reports`/analytics scope). Options:
- **(a) Add `read_reports` scope** → pull product funnel via ShopifyQL (Plus). Cleanest.
- **(b) Use GA4** item-level funnel (view_item → add_to_cart → purchase) if GA4 is wired.
- **(c) Sales-only proxy** (units/revenue per product per week from `read_orders`) — available
  now, but no view denominator, so it measures sales not conversion; weaker but zero-setup.
Recommendation: (a) if we can add the scope; otherwise (b); (c) as an interim baseline.

---

## Open decisions
1. Loox plan tier — does it support Product Grouping (Convert+)? Gates §3.1.
2. Curation mode — hybrid (recommended) vs fully manual vs fully automatic.
3. Campaign reward + channel (Loox native vs Klaviyo) + Mayday `lancto` handling.
4. Measurement data source — (a) add `read_reports`, (b) GA4, or (c) sales proxy.
