---
id: gebeauty-amazon-account
name: GE Beauty Amazon 1P account growth program
owner: shared
status: in-progress
priority: high
created: 2026-07-02
target: null
current_phase: 4-aplus-content
next_blocker: "A+ copy approval (Lucas) → then A+ module images (cto) → publish. Catalog corrections blocked on Eloá's `Correções Catálogo GE Beauty.xlsx` (Lucas to forward). Restock/reactivation POs in Amazon's cycle (Eloá)."
next_owner: lucas
stakeholders:
  - GE Beauty
  - Eloá Paradela (Amazon Sr. Account Manager, eloa@amazon.com)
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why
Amazon 1P (Vendor Central, code FF98U) was underperforming: red Net PPM from old-cost stock selling through, plus thin/broken listings. Cost and catalog are now fixed. This initiative is the standing home for the **account growth program** Eloá laid out in the "Amazon: Programas" thread (Brand Registry → Brand Store → A+ Content → Amazon Ads) **and** a recurring monitor loop so margin and stock never silently rot again. It answers, every session, "what's live, what's next, who owns the next move" — without Lucas carrying it in his head.

Scope boundary: the reusable **catalog mechanics** (copy/images/registry/keywords/category/margin) live in [[marketplace-catalog-optimization]] and memory `project_gebeauty_amazon_1p`. This file owns the **account-level programs + the continuous loop**. Amazon 1P is also one channel under `gebeauty-b2b-channels`.

## Priority logic
`restock + Brand Registry` are the unblockers (P0). Then the highest-return, no-cost work is A+ Content + catalog corrections (P1). Only then pour paid traffic (Ads) onto pages that now convert (P2), with the Brand Store as the branded backdrop. EDI last (P3) — it hardens the process that caused the original mess.

## Phases
- [x] 1. Cost/PPM review + reorder unlocked — 10 active SKUs recompra at new cost, Net PPM recovering +17–24% — 2026-06/07
- [x] 2. Catalog quality overhaul — NOVOS (5 new) submitted + UPDATE (16 existing) enhanced with data/heroes/INCI — 2026-07-02 (see [[marketplace-catalog-optimization]])
- [x] 3. Brand Registry active — unlocks A+, Brand Store, Sponsored Brands/Display, brand protection — confirmed 2026-07-02
- [~] 4. **A+ Content** — 6-module reusable system + flagship copy drafted (001/121/003/102/101/024). NEXT: Lucas approves copy → cto generates module images → publish in A+ Content Manager → roll to remaining SKUs
- [ ] 5. Catalog corrections — apply Eloá's `Correções Catálogo GE Beauty.xlsx` — BLOCKED on file (Lucas to forward)
- [ ] 6. Restock + reactivate Primer Cachos (ASIN B0G2CSBCLH) + intro new SKUs on same PO cycle — Amazon-side (Eloá)
- [ ] 7. Sponsored Products live (then Sponsored Brands/Display once pages convert) — cto drafts campaign, Lucas funds
- [ ] 8. Brand Store published — cto drafts structure + copy, Lucas publishes
- [ ] 9. EDI / API cost-inventory feed — automate cost/inventory updates (Eloá sent step-by-step) — integrations
- [ ] 10. Brand protection — use Brand Registry infringement tools as needed

## Continuous loop (the process)
Run each review cycle (target: weekly, or whenever a fresh Amazon report lands). This is the "improvement engine" — every session that touches Amazon does this scan first, then advances a phase.

**1. Pull the numbers** (Vendor Central → Análise de Varejo, Manufacturing view):
- **PPM Líquido** — Net PPM % per ASIN
- **Vendas** — Shipped Units / Revenue / COGS → realized ASP = Revenue ÷ Units
- **Inventário** — Sellable On-Hand, Net Received

**2. Alert triggers** (any true = action):
- Net PPM < ~10% on an ASIN
- Realized ASP < ~90% of registered retail
- Sellable stock < 10 units with **no open PO** (imminent OOS)

**3. Diagnose + act:**
- Red PPM → is it the **old-cost cohort** (FIFO) or real? If old cohort, the fix is **reorder at new cost** (breaks the deadlock), not a price change. See PPM mechanics in `project_gebeauty_amazon_1p`.
- OOS risk → flag SKU to Eloá for a PO this cycle.
- New SKU post-launch → confirm ASP holds ≥ 90% of retail (the trap that hid the negative PPM for months).

**4. Iterate the storefront:** once A+/Ads are live, watch detail-page conversion + ad ROAS; refine copy, keywords, bids.

**5. Log + advance:** append findings to `## Notes`, check off / update phases, reset `next_blocker` + `next_owner`.

## Reference files
- A+ content (copy + module specs): `gebeauty/amazon/aplus-content.md`
- Uploadable catalog files: `G:\Drives compartilhados\GEB_Comercial\Marketplaces\Amazon\` — `Perfumes_Fragrancias_NOVOS_PREENCHIDO_FIXED.xlsm` (5 new, submitted), `Perfumes_e_Fragrancias_2026-07-01_UPDATE_PREENCHIDAS_FIXED.xlsm` (16 existing, uploading)
- Reports: `net-ppm/`, `sales/`, `inventory/` under the Amazon Drive folder
- Eloá thread: Gmail subject "Amazon: Programas" (label Label_20)

## Notes
- 2026-07-02 — Initiative created. Brand Registry confirmed **active** (re-submitted 06/20 via the law office with procuração). Eloá's "Amazon: Programas" email laid out the 4 programs + 3 next steps (cost review ✅, new-SKU cadastro ✅, catalog corrections ⏳) + EDI automation. A+ build kit drafted this session (6-module system: 3 shared — brand banner, "monte sua rotina" comparison chart, brand story; 3 per-product — hero+highlights, 3 benefits, modo de uso). Copy saved to `gebeauty/amazon/aplus-content.md`.
- 2026-07-02 — Manufacturer rule confirmed by Lucas: **GEB 0xx = Naturelle, GEB 1xx/2xx = Yuzi Cosméticos** (yuzi.ind.br); dry shampoo GEB 008 is the exception (ALIANZA COSMETICOS). Applied to the UPDATE file.
- 2026-07-02 — Live-image swap found on Booster Fortificante (MAIN was a text graphic from the old image-zip; the correct packshot sat in PT01). Files carry the correct hero; uploading UPDATE fixes MAIN. If the imaging-manager copy wins over the feed, fix MAIN directly in imaging/manage.
- 2026-07-02 — Primer Cachos ASIN B0G2CSBCLH given to Eloá for reactivation (was inactive in catalog).

## Done means
- All programs live: Brand Registry active ✅, A+ on the full line, Brand Store published, Sponsored Products running with positive ROAS.
- The continuous loop is operating each cycle (no silent PPM/stock rot).
- Account health: line-wide Net PPM positive, no flagship out of stock, realized ASP ≥ 90% of registered retail.
