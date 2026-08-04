---
id: gebeauty-catalog-management
name: GE Beauty Shopify catalog management (probe→harvest→compose→apply→publish→verify)
owner: shared
status: in-progress
priority: normal
created: 2026-07-30
target: null
current_phase: 5-publish-remaining-channels
next_blocker: channel publishing (dupla → 7 remaining sales channels) needs Lucas's go; also blocked on write_publications scope (token has read_publications only)
next_owner: lucas
stakeholders:
  - Lucas (product/pricing/channel-visibility owner)
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why
Repeatable 6-step loop (PROBE → HARVEST → COMPOSE+PLAN → APPLY → ACTIVATE+PUBLISH → VERIFY) for creating/enriching/launching products directly via Shopify Admin API (`gebeauty/.env`, API 2026-01), bypassing the flapping MCP. First full run-through (dupla shampoo + booster fortificante bundle) validated the process end-to-end and produced reusable APPLY/hero/activate-publish scripts as templates for the next product. Worth tracking as an initiative because the loop, taxonomy, and hard rules need to survive session boundaries and because there's a real backlog of products/fixes behind it.

## Phases
- [x] 1. Process + registry taxonomy derived and documented — 2026-07-30
- [x] 2. Dupla bundle: PROBE/HARVEST/COMPOSE/APPLY/ACTIVATE — 2026-07-30 (ACTIVE, live PDP)
- [x] 3. Dupla published to Online Store (legacy REST `published=true`) — 2026-07-30
- [ ] 4. Pricing confirmation on dupla (kit-ate-* discount off R$170, r10-off badge) — Lucas-owned, no price writes without his number
- [ ] 5. Publish dupla to remaining 7 channels (Google & YouTube, Pinterest, TikTok, Facebook & Instagram, IGLU POS, Point of Sale, Microsoft Copilot) — BLOCKED on Lucas's go + `write_publications` scope
- [ ] 6. Promote process to permanent playbook `docs/gebeauty-catalog-management.md` + memory pointer (flagged, not yet decided)
- [ ] 7. Work broader catalog backlog: FAQ catalog rollout, consistency-sweep worklist (`gebeauty/catalog-consistency-sweep-2026-07-13.md` — 003 "proteína da seda", 019 anti-queda, 021 trehalose→xilitol), Mayday line go-live (Kit 125 price, activation, 126 Omie backfill)

## Notes
- 2026-07-30 — Ingested from `docs/handoff-catalog-management.md` (now deleted, preserved in git history). Full process detail, registry field taxonomy, hard rules, and API gotchas below.
- **Hard rule (pricing)**: never set price/compareAt differently from what Lucas agreed. Discounts run off the `kit-ate-*` per-tag rule computed on `compareAtPrice` — don't cut price or invent a compareAt. Memory: `feedback_never_override_agreed_price` (HARD).
- **Hard rule (copy)**: ingredient-as-proof, no em-dashes, idiomatic Brazilian PT (no English calques), real actives only. Voice guide: `.claude/skills/content-director/references/voice.md`. `/content-director` (pdp mode) authors PDP copy from scratch.
- **Hard rule (writes)**: confirm before every store write; DRAFT-first; new metaobjects must be created ACTIVE or they won't render; verify on live storefront directly, never ask Lucas to check manually.
- **Registry taxonomy**: core fields (title stored lowercase, handle, productType: product/acessorio/kit/booster/rappi/brinde, tags, descriptionHtml, SEO), metafields (`custom.finalidade`, `custom.caracteristicas`, `custom.descricao_longa_com_abas` → `descricao_longa` metaobject tabs, `custom.etiquetas`, `custom.faq`, `custom.ingredients`, `custom.beneficio_em_destaque_1..3`, `custom.antes_e_depois`, `custom.dosagem`, `custom.ai_readiness`, `custom.video_stories`, `fullcomm.ncm`, google/facebook category metafields, `shopify.*` standard fields — often locked), media (hero + optional secondary), bundles (native `productVariantComponents` + customer-facing `itens_do_kit` metaobject list).
- **Price source rule**: read prices only from productType `product`/`acessorio`, never kit/rappi/brinde.
- **Reusable scripts** (committed, `902af69`): `gebeauty/scripts/_dupla_fort_apply_registry.py` (APPLY template), `_dupla_fort_apply_hero.py` (staged-upload hero pattern), `_dupla_fort_activate_publish.py` (DRAFT→ACTIVE + publish mirroring a sibling's channels). Probe/harvest scripts are untracked per-product one-offs, safe to delete after use.
- **API gotchas (2026-01)**: `productUpdate` takes `ProductUpdateInput!` not `ProductInput!`; `publishablePublish` needs `write_publications` (currently absent) — legacy REST `PUT /products/{id}.json {"published":true}` publishes to Online Store under `write_products` as a workaround. Rich-text metaobject fields are Shopify `{type:root,children:[...]}` JSON, build with a helper. Inline `python -c` with GraphQL breaks in bash (quote mangling) — write a script file instead. Drive images are link-shared: `Invoke-WebRequest 'https://drive.google.com/uc?export=download&id=<FILE_ID>'` fetches bytes with no auth.
- **Concurrent-session hazard (critical)**: Cowork sessions operate in the same `C:\claude` checkout as other sessions. Do not commit into the shared index while another session may be active — land commits via an isolated worktree (`git worktree add -b <branch> C:/claude-wt/<name> main`), commit there, push, rebase onto `origin/main` if rejected. Never `git add .` / `git commit -a`; stage explicit paths only; never `git reset --hard` another session's tree.
- **Verify pattern**: any product's state via `cd gebeauty && python scripts/_bundle10217_state.py` (adapt GID/SKU per product). Dupla live PDP: `https://www.gebeauty.com.br/products/dupla-shampoo-booster-fortificante`. Admin: `https://admin.shopify.com/store/ge-beauty-cosmeticos/products/10217099297088`.
- Memory refs to check: `feedback_never_override_agreed_price`, `project_gebeauty_shopify_conventions`, `reference_gebeauty_bundles_app_owned`, `reference_gebeauty_etiqueta_applier`, `reference_gebeauty_composicao_pages`, `feedback_confirm_store_writes`, `feedback_pt_no_english_calques`.

## Done means
- Dupla bundle live and discoverable on all 8 intended sales channels, with Lucas-confirmed pricing/discount behavior.
- Process promoted to a permanent playbook (or explicitly decided to stay as initiative-only), with memory pointer.
- Consistency-sweep and Mayday backlog items either closed or spun into their own initiatives.
