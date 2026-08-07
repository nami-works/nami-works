# Marketplace/Perfumaria registry field mapping — for Lucas's validation

Read-only research pass (2026-08-04) across every registry spreadsheet found under
`G:\Drives compartilhados\GEB_Comercial\{Marketplaces,Perfumarias}`, to scope the connector
tool that auto-fills these registries from GE Beauty's existing systems of record. Nothing
was written anywhere — this is the mapping to validate before we build.

## The seeding chain (how `products.json` itself gets its data)

- **Shopify** is canonical for store-facing fields: title, EAN, price, status, productType,
  NCM, tagline. Pulled live via `gebeauty/scripts/_catalog_shopify_dump.py`.
- **Omie** is system of record for `cest` (tax).
- **Unilog** (logistics platform) is system of record for `dimensions_mm`, `units_per_carton`,
  `shelf_life_days`, `shelf_life_expedicao_days`, `net_weight_g`, `gross_weight_g`.
- `gebeauty/scripts/_catalog_rebuild.py` merges a fresh Shopify dump with the Omie/Unilog
  fields **preserved** from the current `products.json` (never overwritten by the Shopify
  dump), writes a preview file, and a human promotes it manually. Not live-synced — a
  deliberate human checkpoint.

## Existing precedent: the Sephora mapper

`gebeauty/b2b/sephora/sephora_mapper.py` already does exactly this job for one client: reads
`products.json` + a Shopify enrichment cache (images, first-sentence descriptions), fills
Sephora's exact template columns, and leaves genuinely-external fields as `[PENDENTE]` with a
named human owner (Raphael/regulatory, Lucas/pricing, contador/fiscal, comprador/buyer-assigned).
Every mapping below follows this same categorization.

**Drift found:** the live 2026 Sephora template (`CADASTROS NOVOS - SEPHORA - 2026.xlsx`) has
added a **"VOLUME TOTAL"** column and appears to have **dropped the two Anvisa columns** the
mapper script still outputs. Templates drift — the connector needs a "does the template still
match?" check, not a one-time hardcoded column list.

**Mata Lab**: no registry spreadsheet exists (consignment deal, contract-only) — nothing to map.

---

## Cross-cutting patterns (same shape in every client)

1. **Fully automatable core** — SKU, EAN, title, NCM, CEST, net/gross weight, dimensions,
   units_per_carton, shelf_life, product images (Shopify CDN) — sourced from
   products.json/Shopify/Omie/Unilog, no human in the loop needed.
2. **Marketing copy is never a raw field pull.** Bullets, SEO search terms, "descrição por
   extenso," "claim da linha" — every client wants this reformatted/reframed for its own
   audience, not a straight copy of Shopify's PDP HTML. Route through content-director,
   seeded from Shopify's `custom.finalidade` / `custom.descricao_longa_com_abas`.
3. **Pricing always routes through Lucas**, even when mechanically computable. Confirmed
   pattern: Rappi's price fields (both Turbo and E-commerce) already match the `[rappi]`-tagged
   Shopify duplicate's price — that variant is a valid mechanical source, but the write is
   still gated on your approval, same as Sephora's B2B sell-in table and BLZ's contractually
   margin-floor-gated retail price.
4. **The single biggest structural gap, recurring everywhere: no INCI ingredient list, "livre
   de" claims, or Anvisa registration are stored anywhere structured.** Sephora, BLZ, and
   Amazon all want this; today it only lives ad hoc in marketing copy or a person's memory
   (Raphael). Worth a real decision: extend `products.json`, or a companion regulatory file.
5. **Every marketplace has its own closed-list taxonomy** (Amazon browse nodes, BLZ's 5-value
   Categoria enum, Rappi's category1-3) with **no crosswalk table today**. Each needs a
   one-time SKU→marketplace-category mapping, owned by you/growth, built once and maintained.
6. **Marketplace-assigned fields are read-only, never written**: Amazon ASIN, BLZ's internal
   SAP-style codes, Rappi's "Curva" (ambiguous — may be Rappi-assigned or GE-internal, needs
   your clarification before automating either way).
7. **Vendor/company onboarding forms are out of scope** — Rappi's `Cadastro CNPJ.xlsx`, BLZ's
   `Ficha cadastral.zip` — these are one-time CNPJ/bank/legal paperwork, not per-SKU data.
8. **Fixed constants, hardcode once**: country of origin (Brasil), battery/DSA compliance
   (not applicable to cosmetics), CNPJ, warehouse origin (SP/Cajamar), "Item regular" status.

---

## Per-client detail

### Amazon (`Marketplaces/Amazon/*.xlsm`)
Official Seller Central flat-file template, ~220 columns per product category
(`PERSONAL_FRAGRANCE`, `HAIR_CARE_AGENT`, etc.), each with an explicit
OBRIGATÓRIO/CONDICIONALMENTE/RECOMENDADO/OPCIONAL flag row.
- Automatable: title base, EAN, brand constant, images (already Shopify CDN — confirmed
  aligned with `images-amazon/_manifest.csv`'s MAIN+PT01-05 slot structure), weights,
  dimensions (mm→cm), shelf life, NCM/CEST, country of origin, battery/DSA constants.
- **Needs a decision from you:**
  - Category/browse-node numeric IDs — no mapping table exists.
  - GPSR/DSA (EU compliance) fields appear on a BR-market template — confirm with
    Amazon/Raphael whether these are actually required or template noise.
  - Variation/parentage (which SKUs group as parent/child, e.g. scent or size variants) is a
    listing-architecture decision, not a data pull.
  - Volume-in-mL vs weight-in-g: products.json only has weight; Amazon wants both.

### Beleza na Web (`Marketplaces/Beleza na Web/*.xlsx`)
v8.0 (current) vs v7.0 (stale — separate per-UF sheets from when GE billed from two states;
now consolidated to Cajamar/SP only). Wholesale/consignment contract, margin-floor-gated
pricing with 60-day notice-of-change clause.
- Automatable: EAN, name, description, weights, dimensions, carton qty, NCM, CEST, shelf
  life, origem, "Grupo de Mercadoria Externo" (NCM lookup table already in the workbook).
- **Needs a decision from you:**
  - "Linha" (product line) taxonomy doesn't exist in GE's data model at all — flat by SKU.
  - CST vs CSOSN split depends on GE's tax regime (Simples Nacional or not) — confirm with
    the contador, not assumed.
  - Two "Descrição Longa/Curta" columns are marked "internal BLZ" yet duplicate content from
    the separate Características tab — unclear if GE should ever populate these.
  - "Livre de?" / "Vegano?" / full INCI list — same structural gap as above.
  - Sell-in cost and suggested retail — contractually gated, always route through you.

### Rappi Turbo (`Marketplaces/Rappi/Turbo/*.xlsx`)
Dark-store/quick-commerce template, fiscal + logistics heavy.
- Automatable: name, EAN, gramatura, NCM, CEST (Omie), shelf life, weights, dimensions,
  images (Shopify CDN), CNPJ/UF-origem constants.
- **Needs a decision from you:**
  - Categoria taxonomy depth (only "Cosméticos" seen — may need finer granularity).
  - "Entrega" (CD→loja routing) and "Armazenamento" (storage conditions) — no system of
    record identified; likely Ops-owned.
  - UNC/MOQ (minimum order) — commercial term, not a logistics fact.
  - "Custo Bruto com impostos" — needs a finance-owned landed-cost calc, not a raw Omie pull.
  - "Curva" (A/B/Lançamento ranking) — ambiguous, Rappi-assigned or GE-internal, needs your
    clarification.

### Rappi E-commerce (`Marketplaces/Rappi/E-commerce/*.xlsx`)
Leaner catalog template, no required/optional legend — inferred from what's consistently
filled in the one "preenchido" sample available.
- Automatable: SKU (needs a format-normalization pass — mixes `'GEB 001'`, `'GEBK072'`,
  bare `7671`), name, images, short description, unit-type constants (all GE SKUs sold as
  single units, not weighable/bulk), regulatory-flag defaults (all false for cosmetics).
- Confirms the same finding as Turbo: price already matches the `[rappi]`-tagged Shopify
  variant.
- **Needs a decision from you:**
  - `category1-3` never populated in the sample — unclear if genuinely optional or just a
    gap in what was filled; check Rappi's actual requirement docs.
  - `description` uses a bespoke pipe-delimited format, not raw Shopify HTML — needs a
    transform function, likely content-director's remit.

### Sephora (`Perfumarias/Sephora/*.xlsx`) — precedent already built
See `sephora_gaps.md` in the same folder as this file for the full existing gap breakdown
(Anvisa process numbers owned by Raphael, B2B pricing by you, tax % by the contador, buyer-
assigned setup fields by Sephora post-onboarding). Just needs the template-drift fix noted
above (Volume Total added, Anvisa columns possibly dropped).

---

## Recommendation for the connector tool

One generalized tool — `shopify_generate_marketplace_registry(client, mode)` — following the
Sephora mapper's pattern exactly, but config-driven per client instead of hardcoded:
1. A per-client column-mapping config (crosswalk table: registry column → products.json/
   Shopify/Omie/Unilog field, or `EXTERNAL` + owner tag).
2. Pull live data the same way `_catalog_shopify_dump.py` + Omie/Unilog integrations already do.
3. Fill what's automatable, emit `[PENDENTE]` + owner for the rest — never guess, never
   auto-submit pricing without your explicit confirm.
4. A lightweight "does this client's template still match our config?" check on each run
   (column headers diffed against the last-known schema) — the Sephora drift found above is
   exactly the failure mode this guards against.

**Before building, these need your call:**
- Extend `products.json` (or add a companion regulatory file) with INCI ingredients, "livre
  de" claims, vegan flag, Anvisa registration — the single most recurring gap across every
  client.
- ~~Decide whether/how to build the marketplace-category crosswalk tables~~ **RESOLVED.**
- ~~Confirm GE's tax regime~~ **RESOLVED.**
- ~~Clarify Rappi's "Curva" field and BLZ's dual "Descrição Longa/Curta" ambiguity.~~ **RESOLVED.**

## Decisions (2026-08-04)

1. **Category taxonomy — build a canonical GE Beauty taxonomy first, marketplace crosswalks
   second.** Instead of a separate ad hoc mapping per client, build ONE canonical category
   tree for GE's catalog (derived from what Amazon/BLZ/Rappi already show us today), then a
   thin crosswalk table per marketplace (`canonical_category → amazon_browse_node`,
   `canonical_category → blz_categoria`, `canonical_category → rappi_category`). When a new
   marketplace comes on (Mercado Livre, etc.), only a new crosswalk column is needed — the
   canonical taxonomy and the per-SKU assignment are already done. Build this as a real
   artifact (`gebeauty/products.json` extension or a companion `category-taxonomy.json`), not
   a one-off script.

2. **Tax regime confirmed: Lucro Presumido / Real** — CST applies, not CSOSN. Resolves the
   ambiguity on both BLZ and Rappi registries; no further check needed with the contador for
   this specific question.

3. **Rappi "Curva" = a classic ABC sales-volume curve, GE-computed, not Rappi-assigned.**
   Explicitly called out as **mutable** — compute on demand from live sales data at
   registry-generation time (existing `shopify_product_sales_rank` / KPI tooling is the
   natural source), never cache a stale value.

4. **BLZ's registry is already submitted — no retroactive fix needed there.** Going forward,
   the general principle for any marketplace-specific description/copy field: source from
   Shopify **on demand**, reformatted per that marketplace's own conventions — never a raw
   copy-paste of Shopify HTML. The team (and the connector's guidance) should actively check
   each marketplace's format expectations at fill-time rather than assume one canonical
   "description" field works everywhere.

5. **Regulatory data extends `products.json` directly** — new fields per SKU: `inci`
   (ingredient list), `free_of` (array — parabens/sulfates/etc.), `vegan` (bool),
   `anvisa_process`, `anvisa_expiry`. One system of record, same place everything else lives,
   flows automatically into every marketplace connector without a separate join step. Raphael
   becomes the owner of keeping this populated/current, same role as Omie/Unilog already
   play for their respective fields.

**Standing constraint, not re-litigated:** pricing stays gated on Lucas's explicit confirm
always, per the existing store-write policy — even where a mechanical source (e.g. the
`[rappi]`-tagged Shopify variant) exists.

All five open decisions from the initial mapping pass are now resolved. Ready to move to
build: the 8 approved backlog tools + the marketplace-registry connector, informed by this
mapping.
