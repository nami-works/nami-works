# GE Beauty Workspace — Operational Playbook

This workspace handles ad-hoc operational tasks for GE Beauty's Shopify store. Every session should be able to pick up and execute tasks immediately using this context.

## Persistent references

- **Canonical product catalog:** `gebeauty/products.json` — 29 SKUs (as of 2026-07-16; 27 registrable with EAN), source of truth for all B2B registrations. Assinatura variants excluded (e-commerce only).
- **Pending fixes:** `gebeauty/pending-fixes.md` — non-urgent issues to fix when convenient. Add new findings here instead of leaving them as inline comments.
- **Hi Platform CS archive (pre-Gorgias migration):** `gebeauty/research/cs-knowledge-base/` — the complete customer-service history mined out of Hi Platform before the contract lapses. `cs_archive.sqlite` (~206 MB, 28,080 tickets + 53,694 messages, 15,745 real-customer) is the lossless master; `deliverables/export/*.jsonl` are the Gorgias-handover exports (full + reduced-PII). Local-only, gitignored (holds PII). Check state: `python cs_kb_fetch.py status`; analyze/export: `python analyze.py {index,digest,export}`. Full detail in Claude memory `project_gebeauty_hiplatform_kb.md`.

## Store Access

- **Store:** `ge-beauty-cosmeticos.myshopify.com`
- **API version:** `2026-01`
- **Credentials:** `.env` in this directory (SHOPIFY_ADMIN_ACCESS_TOKEN)
- **Python:** `C:/Python314/python.exe`
- **Shopify MCP:** Available for schema introspection (`learn_shopify_api`, `introspect_graphql_schema`)

> **HARD RULE — price source:** When fetching prices from Shopify, only read variants whose product `productType` is **`product`** or **`acessorio`**. NEVER take prices from `rappi`, `brinde`, kit/bundle, or any other product type — they carry channel-specific or non-retail prices (e.g. `[rappi] shampoo a seco` = R$99 vs the real `product` retail R$69). Filter on `productType`, not on title prefix.

### Available Scopes
`read_customers`, `read_orders`, `read_all_orders`, `read_products`, `write_products`, `read_content`, `write_content`, `read_files`, `write_files`, `read_metaobjects`, `write_metaobjects`, `read_metaobject_definitions`, `write_metaobject_definitions`, `read_discounts`, `write_discounts`, `read_themes`, `write_themes`, `read_locations`, `read_fulfillments`, `read_inventory`, `read_shipping`, `read_markets`, `read_translations`, `read_publications`, `read_online_store_pages`, `read_online_store_navigation`

### API Pattern
Use `urllib.request` (no dependencies) or `curl` for Shopify API calls. Always read the token from `.env`, never hardcode it in scripts meant to be committed.

```python
import json, urllib.request
TOKEN = "..."  # from .env
URL = f"https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"

def graphql(query, variables=None):
    body = json.dumps({"query": query, **({"variables": variables} if variables else {})}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN,
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))
```

---

## Product Catalog

### Active Product Line (quick reference — not exhaustive; see `products.json` for the full 29-SKU set)
| Product | SKU | Type | Price (current) |
|---------|-----|------|-----------------|
| Shampoo Sem Sulfato | GEB 001 | formula/full-size | R$80.75 |
| Máscara Condicionadora | GEB 002 | formula/full-size | R$80.75 |
| Leave-in com Proteção Térmica | GEB 003 | formula/full-size | R$84.15 |
| Shampoo a Seco | GEB 008 | formula/full-size | R$58.65 |
| Booster Fortificante | GEB 019 | booster/full-size | R$63.75 |
| Booster Hidratante | GEB 020 | booster/full-size | R$58.65 |
| Booster Definição | GEB 021 | booster/full-size | R$58.65 |
| Booster Antifrizz | GEB 022 | booster/full-size | R$67.15 |
| Booster Antioxidante | GEB 023 | booster/full-size | R$63.75 |
| Primer Liso Intacto | GEB 102 | formula/full-size | R$118.15 |
| Primer Cachos Definidos | GEB 101 | formula/full-size | R$126.65 |
| Leave-in Pluma | GEB 120 | formula/full-size | R$126.65 |
| Máscara Mayday | GEB 121 | formula/full-size | R$139.00 |
| Melon Mood Body & Hair Mist | GEB 024 | formula/full-size | R$129.00 |

**Note:** Máscara Mayday and Melon Mood are launch products (`lancto` tag) — excluded from campaign discounts.

### Product Structure Conventions
- **Tags** drive collection membership (automated collections use tag-based rules)
- **Key tags:** `avulso` (sold individually), `full-size`, `travel-size`, `booster`, `formula`, `kits`, `bundle`, `dupla`, `lancto` (new launch), `stockable`, `upsell-option`, `best-seller`, `ex-promo`
- **Metafields:** `custom.finalidade` (product purpose), `custom.descricao_longa_com_abas` (long description metaobject ref), `custom.etiqueta` (badge label metaobject ref)
- **Metaobject types:** `descricao_longa` (product description tabs), `etiqueta` (product badges), `como_usar_slide` (how-to-use slides), `item_faq`, `antes_e_depois` (before/after), `custom.ai_readiness` (quiz AI context)
- **Rappi products:** Duplicated with `[rappi]` prefix, sold at full price (no compareAtPrice), separate from e-commerce catalog
- **Brinde products:** Duplicated with `[brinde]` prefix, priced at R$0.01, ARCHIVED status, used for gift-with-purchase flows

### Pricing Convention
- `compareAtPrice` = full retail price ("de")
- `price` = current selling price ("por")
- During campaigns, price is set to `compareAtPrice × (1 - discount%)` directly on the product
- Kits have their own compareAtPrice representing the bundle value (sum of individual items or a bundle reference price)

---

## Discounts

### BEAUTYBACK Cashback Codes
Personalized winback codes sent to past customers. Format: `BEAUTYBACK-{batchId}-{code1}-{code2}`

**Parameters:**
- Value: fixed R$ amount (≈25% of customer's previous order) OR flat 25%
- Minimum requirement: set to the customer's previous order subtotal (for fixed amounts) or R$0.01 (for percentage)
- Usage limit: 1
- Combines with: order ✓, product ✓, shipping ✓
- Expiry: set per batch (typically 5-7 days)

**Generation:** From a list of orders/customers, calculate the cashback amount per customer, generate unique codes, and create via `discountCodeBasicCreate` mutation. See `scripts/update_beautyback_combines.py` for the API pattern.

### Affiliate/Influencer Codes
Pattern: `{NAME}10` — 10% off all items, no end date, unlimited uses. Most do NOT combine with other discounts (except shipping). ~30+ active codes.

### Active Automatic Discounts
- **"ganhe uma necessaire"** — BxGy gift-with-purchase, targeted (not publicly announced)

### Free shipping (R$299, nationwide)
- **Free shipping ≥ R$299, flat nationwide**, granted by a custom **Function Studio** automatic-discount Function, NOT a native Shopify discount and NOT a coupon. Admin: `apps/function-studio/app/functions/discounts/automatic/1637817647424`.
- Because it is a Function, it does **not** appear in `automaticDiscountNodes` or in delivery-profile rates — `draftOrderCalculate` on a sub-R$299 cart shows paid carrier rates (Intelipost); R$299+ carts get free shipping applied at checkout by the Function.
- Backs the announcement bar "frete grátis a partir de R$299" (`anuncio_barra_de_avisos["frete-gratis"]` metaobject).
- Dead artifacts (ignore): native automatic discount "Frete Grátis" @R$389 is **EXPIRED**; the legacy "fg semana consumidor" @R$199 was a one-off Consumer-Week campaign.

### Campaign Pricing
When running a campaign (e.g., Consumer Month), the discount is baked directly into product prices via compareAtPrice/price pairs — NOT through Shopify discount objects. The theme announcement bar and PDP promotional banner communicate the campaign.

---

## Theme

> **Customizing the theme? Read [../../docs/gebeauty-theme-customization.md](../../docs/gebeauty-theme-customization.md) first.** It's the playbook: Asset API workflow, design tokens, dynamic-source binding rules, scoped-CSS patterns, the reusable techniques + scripts we've built, and the gotchas.

- **Published theme:** `[Check] - Produção` (id: `181379236160`) — but **verify `role == main` before editing** (`GET /themes.json?fields=id,name,role`); CheckCommerce's "badge cache bust" republishes duplicates and can swap the live theme mid-session.
- **Theme settings key locations:**
  - Announcement bar: `sections/header-group.json` → announcement-bar blocks
  - PDP promotional banner: `config/settings_data.json` → `promotional_bar_pdp_text`
  - Free shipping bar: `config/settings_data.json` → `free_shipping_min_amount`, `free_shipping_text`
  - Gift progress bar: `config/settings_data.json` → `show_promo_bar_progress`, `promo_bar_min_amount`, `promo_bar_text`
- **Editing:** Read/write via Themes REST API (`GET/PUT /themes/{id}/assets.json`)

---

## Creative / ad imagery (Canva + Magnific)

> **Producing ad images or web banners? Read [../../docs/creative-ad-image-pipeline.md](../../docs/creative-ad-image-pipeline.md) first.** The playbook: the Magnific generative zoom-out recipe, ad-format clear zones, Canva MCP editing mechanics + quirks, the Magnific→Canva ingestion path, logo/asset re-tinting, per-line brand-color harmonization, the Canva template registry, and the filesystem conventions. Base plates live in `imagery/<campaign>/{source,expanded}`.

---

## Existing Scripts

| Script | Purpose | Status |
|--------|---------|--------|
| `scripts/inject_ai_readiness.py` | Create AI Readiness metaobjects | Done (2026-03-28) |
| `scripts/link_ai_readiness.py` | Link metaobjects to products | Done (2026-03-28) |
| `scripts/update_ai_readiness.py` | Update handles and ACTIVE status | Done (2026-03-28) |
| `scripts/update_beautyback_combines.py` | Bulk-update BEAUTYBACK combinesWith | Reusable |
| `scripts/run_beautyback_loop.py` | Loop runner for bulk updates | Reusable |

---

## Rules

- **Always confirm before writing to the live store.** Any Shopify API mutation (product updates, metafield changes, discount edits, theme writes) must be explicitly approved by the user before execution. Present the proposed changes, wait for confirmation, then apply.
- **Ingredient-as-proof** (updated 2026-06-29): name an active only when bound to the benefit it delivers ("biotina, que fortalece a fibra"), never a bare ingredient list. Replaces the old benefit-only-never-ingredients rule. Canonical voice: `.claude/skills/content-director/references/voice.md`.
- **Booster Purificante does NOT exist** — was in old prompts, removed from catalog.
- **Never hardcode the API token** in committed scripts — read from `.env`.
- **Pagination:** Always use `sortKey` (ID or CREATED_AT) for stable pagination. Default Shopify pagination without a sort key returns inconsistent subsets.
- **Bulk operations:** For 1000+ updates, use a loop script pattern with progress logging every 100 items, throttle awareness, and idempotent updates (skip already-done items).
- **Rate limits:** Shopify GraphQL uses a cost-based throttle (4000 points, 200/s restore). Check `extensions.cost.throttleStatus.currentlyAvailable` and sleep when below 200.

---

## Local Delivery / Dispatch

For anything touching Local Delivery — route optimization, Lalamove dispatch, driver monitoring, route closure, `ld_rota-*` tags, the `cpg_control.py` client — read [LOCAL-DELIVERY-PLAYBOOK.md](LOCAL-DELIVERY-PLAYBOOK.md) before acting. It covers the full CLI, SOPs, hard rules (max 7 orders per route, read map PNGs before dispatching, confirm before money-spending), and failure recovery.

---

## Quiz System

See `quiz/` folder. Octane AI quiz (CORE-1 engine), 7 questions, smart prompts v4. Source of truth: `quiz/geb_smart-properties_v260327.md`. Paste-ready files in `quiz/octane-paste/`. AI Readiness metaobjects deployed on Shopify (14 entries, `custom.ai_readiness` type).
