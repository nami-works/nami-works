---
id: gebeauty-uaubox-box-deal
name: UAU Box multi-SKU box deal (Jul/2026 counter-proposal)
owner: shared
status: in-progress
priority: normal
created: 2026-07-31
target: null
current_phase: 3-counterproposal-sent
next_blocker: Awaiting UAU Box (Eduarda) response to Versão A / Versão B counter-proposals
next_owner: lucas
stakeholders:
  - GE Beauty
  - UAU Box (UAUBOX S.A. — subscription box operator; contact Eduarda)
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why

First multi-SKU box deal with UAU Box at scale (5 SKUs × 21.500 un = 107.500 units).
Prior UAU deals were single-SKU booster runs; this is a materially larger, multi-round
negotiation with a wide bid-ask gap (their offer R$1.578.375 vs our original R$3.899.000).
Getting to a signed order at a defensible net margin (post-CET) matters both for the revenue
and as the template for pricing future multi-SKU box quotes.

Related but tracked separately: [[gebeauty-subscription-boxes]] (B4A + Magenta box deals).
Different operator, different tooling, active negotiation of its own.

## Tooling

- `gebeauty/scripts/deals/_analyze_contraproposta.py` — reads live costs from Drive
  (`Orçamentos Box.xlsx`, col H = landed cost faturando ES), cross-refs UAU's offer, emits a
  2-page branded HTML analysis (3 net-margin scenarios + Versão B, full CET detail).
- `gebeauty/scripts/_b2b_proposta.py` — official proposal HTML generator. Extended this cycle
  with `--rows-json`, `--subtitle`, and `--mode chrome` (Playwright PDF).
- `gebeauty/scripts/deals/history.json` — deal history log (needs the counter-proposal entry).

## The deal — current state

Costs (col H, ES, ~2026-07-16): total R$1.902.105 for 107.500 un.
CET (antecipação de duplicatas): 2,20%/mês; weighted-avg factor **9,72%** of revenue across
9 installments (3 lots × 30/60/90d). Pricing solved to a **net** margin target after CET.

**Versão A — @10% net (R$2.369.300, retail × 0,1979):**
GEB024 R$25,50 · GEB001 R$18,80 · GEB002 R$18,80 · GEB121 R$27,50 · GEB003 R$19,60.
Net profit R$236.886 after R$230.296 CET cost. +31,9% vs UAU's offer.

**Versão B — same R$2.369.300 total, honours Eduarda's ~R$22 cap on the two >R$22 items:**
GEB024 R$22,90 · GEB001 R$21,50 · GEB002 R$21,50 · GEB121 R$22,90 · GEB003 R$21,40.
Two high SKUs capped at R$22,90; shortfall redistributed as equal absolute delta across the
other three. Same net margin as A.

Commercial terms (both): pagamento 30/45/60d · frete CIF São Paulo · disponibilidade sob
consulta · validade 7 dias · data 16/07/2026.

## Relationship history (context)

5 prior completed/contracted UAU deals, all single-SKU booster/formula runs (Nov 2025 → Nov
2026 box). GEB021 contracted at R$21,83 for the Nov 2026 box (Clicksign, entrega até 15/10/2026).

## Phases

- [x] 1. Initial proposal sent (02/07/2026) — 5 SKUs × 20k un, R$3.899.000
- [x] 2. UAU counter received (08/07/2026) — 5 SKUs × 21.5k un at 15% of retail, R$1.578.375; Eduarda flags R$22/un internal cap
- [x] 3. GE counter-proposals prepared + sent (31/07/2026) — Versão A @10% net, Versão B with R$22,90 cap — owner: lucas (printing HTML -> PDF, sending to Eduarda)
- [ ] 4. Log counter-proposal in `history.json` (`uaubox_contraproposta_2026-07-31`) — owner: cto
- [ ] 5. UAU Box responds — owner: UAU Box (Eduarda)
- [ ] 6. On response: accept -> contract/NF flow, or counter -> re-run `_analyze_contraproposta.py` and adjust scenario — owner: shared
- [ ] 7. Close or archive deal — owner: lucas

## Notes

- 2026-07-31 — Initiative created from handoff `docs/handoff-uaubox-contraproposta.md`. All
  detail sourced from that handoff (now removed; git history preserves it).
- 2026-07-31 — Key decisions (do not relitigate): net margin target (not gross); uniform
  retail × gamma pricing (mirrors UAU's own flat 15%-of-retail); Versão B cap = R$22,90 (not
  R$21,90/R$22 — GEB021 was contracted at R$21,83); Versão B shortfall split as equal absolute
  delta, not proportional to retail (Lucas's correction); PDF generation is Lucas's job (print
  from HTML); CET rate 2,20%/mês (avg of two ref factoring ops 2,22% + 2,19%).
- 2026-07-31 — If UAU insists on the R$22 cap across ALL items, Versão B math shows it's
  unsustainable (GEB003 lands at R$21,40, below the blended-portfolio cost floor). Use the
  analysis table to demonstrate why.

## Done means

- UAU Box accepts a version (or the deal is formally declined)
- `history.json` reflects the final status (accepted + version, or passed)
- If accepted: contract/NF flow initiated
