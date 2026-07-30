# Session Handoff — 2026-07-30 — GE Beauty catalog-management process

This handoff captures the **repeatable catalog-management process** we run on the GE Beauty
Shopify store (create/enrich/launch products), the rules that govern it, the reusable tooling,
and the current worked example (the dupla bundle). The next session should be able to run the
same loop on any product without re-deriving it.

## The process — the loop we run for every product
All work is **direct Shopify Admin API** using `gebeauty/.env` (API `2026-01`), which is more
reliable than the flapping MCP. Scripts live in `gebeauty/scripts/_*.py`, `.env` resolved from
`Path(__file__).resolve().parent.parent / ".env"`. Python: `C:/Python314/python.exe`.

1. **PROBE (read-only)** — dump the target product's full registry: status, productType, tags,
   variants (incl. `productVariantComponents` for bundles), all metafields, media, publications,
   collections. Pattern: `_<thing>_state.py`.
2. **HARVEST (read-only)** — two sources:
   - **Sibling(s)** of the same product class → mirror the registry *shape* (productType, tag set,
     which metafields exist, metaobject structure). Never guess the shape; copy a live ACTIVE one.
   - **Components / related products** → pull *approved* copy + actives. Copy is **sourced from
     existing approved content, never invented** — this is the compliance-safe path that avoids the
     consistency-sweep debt (false actives on PDPs). For bundles also harvest the `descricao_longa`
     metaobject DEFINITION (tab schema) + each component's populated metaobject for tab content.
3. **COMPOSE + PLAN** — build the full proposed registry (copy, tags, metafields, SEO, media,
   pricing) and **present to Lucas for approval before any write** (hard rule). Use AskUserQuestion
   for real decisions (scope, pricing mechanism), not inline lists.
4. **APPLY (gated, DRAFT-first)** — idempotent scripts, one per concern: create metaobjects (must be
   **ACTIVE**), `productUpdate` (type/tags/descriptionHtml/seo), variant fields, `metafieldsSet`,
   hero media via staged upload. Re-runnable (look up metaobject by handle before creating).
5. **ACTIVATE + PUBLISH** — DRAFT→ACTIVE, then publish to sales channels (mirror a sibling's channel
   set).
6. **VERIFY LIVE** — load the storefront PDP, confirm hero/price/copy/tabs render and media is READY.

## Registry field taxonomy — what a complete GE product carries
- **Core**: title (stored **lowercase**; theme title-cases), handle, `productType`
  (`product` / `acessorio` / `kit` / `booster` / `rappi` / `brinde`), tags, `descriptionHtml`,
  SEO (`global.title_tag` / `global.description_tag`, or ProductInput `seo{title,description}`).
- **Metafields**: `custom.finalidade`, `custom.caracteristicas` (rich_text bullets),
  `custom.descricao_longa_com_abas` → `descricao_longa` metaobject (tabs:
  `o_que_e` / `passo_a_passo` / `layering` / `beneficios` / `resultado` / `itens_do_kit` (product list)
  / `ingredientes`), `custom.etiquetas` (badge metaobject, e.g. shared `r10-off`), `custom.faq`,
  `custom.ingredients` + `custom.ingredientes_com_foto`, `custom.beneficio_em_destaque_1..3` (+ images),
  `custom.antes_e_depois`, `custom.dosagem`, `custom.ai_readiness`, `custom.video_stories`,
  `fullcomm.ncm`, `mm-google-shopping`/`mc-facebook` `google_product_category`,
  `shopify.*` standard metafields (often **locked** — metafieldsSet may fail; skip if not essential).
- **Media**: hero (frente) + optional secondary squares/verso.
- **Bundles**: native `productVariantComponents` on the variant; the `itens_do_kit` metaobject field
  is the customer-facing kit list.

## Rules that govern the process (hard)
- **PRICING — never set price/compareAt differently from what Lucas agreed.** Rule-based discounts are
  applied by the **`kit-ate-*` per-tag rule computed off `compareAtPrice`** — don't cut the price field
  or invent a compareAt. If a price is needed and unspecified, it's Lucas's number, escalate. DRAFT
  status does not lower the bar. Memory: `feedback_never_override_agreed_price` (NEW, HARD).
- **Price source**: read prices only from `productType` `product`/`acessorio` (never kit/rappi/brinde).
- **Copy**: ingredient-as-proof (name an active only bound to its benefit), no em-dashes, idiomatic
  Brazilian PT (no English calques), real products/actives only. Voice:
  `.claude/skills/content-director/references/voice.md`. The `/content-director` skill (pdp mode) is
  the tool for authoring PDP copy from scratch.
- **Confirm before every store write**; DRAFT-first; verify on the live storefront, never ask Lucas to
  check manually.
- **New metaobjects MUST be created ACTIVE** or they won't render.

## Current worked example — dupla bundle (live)
- `dupla shampoo + booster fortificante` (product GID `10217099297088`, handle
  `dupla-shampoo-booster-fortificante`), components **GEB 001** shampoo ×1 + **GEB 019** booster ×1.
  Went from empty DRAFT → fully enriched, **ACTIVE**, live PDP.
- Applied: `productType=kit`; 13 tags (incl. `dupla`, `dupla_shampoo+booster`, `kit-ate-300`,
  `kit-com-booster`, `kit-full-size`, `contem-shampoo`, `antiqueda`, `forca-e-nutricao`,
  `couro-cabeludo`, `queda-quebra`); descriptionHtml + SEO; `custom.finalidade`,
  `custom.caracteristicas`, `custom.etiquetas`=r10-off badge (`gid://…/177092624704`),
  `custom.descricao_longa_com_abas` → new ACTIVE metaobject `gid://…/368455024960`, google category
  `543615`; hero `DUPLA_FORTIFICANTE.png` (1000×1000, READY) from Drive folder
  `1rY9vPMQt4h8E2n7pjEEZBU4Z3ebg1Iw0`.
- **Pricing**: R$170, **no compareAt** — Lucas reverted my earlier 160/170 change; the `kit-ate-*`
  rule handles the discount. Do not touch.
- **Published to Online Store only** (via legacy REST `published=true`).

## Reusable tools (committed to origin/main `902af69`)
- `gebeauty/scripts/_dupla_fort_apply_registry.py` — APPLY step (metaobject + productUpdate + variant +
  metafieldsSet). Template for any bundle; swap GIDs/copy.
- `gebeauty/scripts/_dupla_fort_apply_hero.py` — staged-upload + `productCreateMedia` hero pattern.
- `gebeauty/scripts/_dupla_fort_activate_publish.py` — DRAFT→ACTIVE + `publishablePublish` mirroring a
  sibling's channels.
- Probe/harvest scripts are per-product one-offs (untracked): `_bundle10217_state.py`,
  `_dupla_template_harvest.py`, `_dupla_parity_harvest.py` — safe to delete.

## What's pending
1. **Publish the dupla to the other 7 sales channels** (Google & YouTube, Pinterest, TikTok,
   Facebook & Instagram, IGLU POS, Point of Sale, Microsoft Copilot). **Blocked on `write_publications`
   scope** (token has only `read_publications`); Online Store was reachable via the REST `published`
   flag. Either add the scope + run `_dupla_fort_activate_publish.py`, or toggle channels by hand.
   Channel visibility = product decision → **confirm with Lucas**.
2. **Pricing confirmation (Lucas-owned)**: verify the `kit-ate-*` rule yields the intended discount off
   R$170 and the r10-off badge matches. No price writes without his number.
3. Broader catalog backlog (from the earlier, now-consumed `catalog-ops` handoff — check git history
   if needed): FAQ catalog rollout, the consistency-sweep worklist
   `gebeauty/catalog-consistency-sweep-2026-07-13.md` (compliance fixes: 003 "proteína da seda", 019
   anti-queda, 021 trehalose→xilitol), Mayday line go-live (Kit 125 price, activation, 126 Omie
   backfill). Not worked this session.

## Current state / how to verify
- Live PDP: `https://www.gebeauty.com.br/products/dupla-shampoo-booster-fortificante`.
- Admin: `https://admin.shopify.com/store/ge-beauty-cosmeticos/products/10217099297088`.
- Any product's state: `cd /c/claude/gebeauty && C:/Python314/python.exe scripts/_bundle10217_state.py`
  (adapt the GID/SKU).

## Context the next session needs
- **CONCURRENT-SESSION HAZARD (critical):** a **Cowork session operates in this same `C:\claude`
  checkout**. This session hit a live collision — HEAD switched mid-operation, the shared index briefly
  co-mingled staged files across sessions. **Do not commit into the shared index while Cowork is active.**
  Land commits via an **isolated worktree**: `git worktree add -b <branch> C:/claude-wt/<name> main`,
  copy your files in, commit there, then `git push origin HEAD:main` (rebase onto `origin/main` if the
  push is rejected — it will be, Cowork pushes often). Never `git add .`; stage explicit paths only;
  never `git reset --hard` another session's tree.
- **API gotchas (2026-01):** `productUpdate` takes `ProductUpdateInput!` (not `ProductInput!`);
  `publishablePublish` needs `write_publications` (absent) but legacy REST `PUT /products/{id}.json`
  `{"published":true}` publishes to Online Store under `write_products`.
- **Rich-text metaobject fields** are Shopify `{type:root,children:[…]}` JSON — build with a helper, not
  plain text. **Inline python `-c` with GraphQL breaks in bash** (quote mangling) → write a script file.
- **Drive images** are link-shared: `Invoke-WebRequest 'https://drive.google.com/uc?export=download&id=<FILE_ID>'`
  fetches bytes directly, no auth.
- Memory refs: `feedback_never_override_agreed_price` (NEW, HARD), `project_gebeauty_shopify_conventions`,
  `reference_gebeauty_bundles_app_owned`, `reference_gebeauty_etiqueta_applier`,
  `reference_gebeauty_composicao_pages`, `feedback_confirm_store_writes`, `feedback_pt_no_english_calques`.

## Should this be permanent?
This is a durable, repeatable process, not throwaway session state. Consider promoting the process +
taxonomy + rules into a permanent playbook (`docs/gebeauty-catalog-management.md`) and a memory pointer,
rather than losing it when this handoff is deleted. Flagged for Lucas.
