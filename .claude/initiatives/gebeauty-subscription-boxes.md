---
id: gebeauty-subscription-boxes
name: GE Beauty subscription box deals (B4A + Magenta)
owner: shared
status: in-progress
priority: normal
created: 2026-06-24
target: null
current_phase: 2-magenta-cogs-gaps
next_blocker: COGS missing for GEB023/GEB024/GEB102 — need factory costs from Raphael to complete Magenta simulation and counter-proposal
next_owner: lucas
stakeholders:
  - GE Beauty
  - B4A (subscription box operator)
  - Magenta (subscription box operator)
working_agreement: ~/.claude/projects/c--Users-Lucas-Guimar-es-Desktop-nami-works/memory/feedback_cto_contract.md
---

## Why

Subscription boxes are a volume-driven, low-touch B2B channel: GE Beauty proposes a discount,
the box operator handles curation, logistics, and consumer discovery. No sellout support needed.
The job is to find a price that clears the minimum GM threshold while being competitive enough
for the operator to say yes. These deals are episodic (one purchase order per box edition) and
negotiated fresh each cycle.

Distinct from regular B2B (Sephora, specialty retail) which requires co-marketing, training,
and ongoing sellout support. Different economics, different rhythm, tracked separately.

## Channels

| Channel | Status | Notes |
|---------|--------|-------|
| B4A | Active — contract signed | Quarterly cadence; 3 SKUs per wave typical |
| Magenta | Proposal stage | Proposal received Jun/2026; 5 SKUs, 2 simulatable |

## Tooling

`gebeauty/scripts/box_deal_simulator.py` — CLI margin simulator
- No args: COGS coverage table
- Positional args: single-SKU spot check (`GEB022 2000 22.70`)
- `--deal path/to/deal.json`: multi-SKU deal with payment-term discount

Deal JSON files live in `gebeauty/scripts/deals/`.

## B4A — deals done

| Deal file | SKUs | Revenue | GM | Net today |
|-----------|------|---------|-----|-----------|
| `b4a_ago_out_2026.json` | GEB003/008/022 — 15k/15k/20k un | R$630k | 21.9% | 20.0% (53-day, 1.3%/mo) |

Payment terms: 53 days. Discount model: desconto simples (PV = FV × (1 − r × n)).

## Magenta — proposal received Jun/2026

Magenta sent prices (what they want to pay GE):

| SKU | Volume | Magenta price | GE COGS (ES) | GM | Status |
|-----|--------|--------------|--------------|-----|--------|
| GEB022 | 2,000 | R$22.70 | R$9.24 | 59.3% | Simulatable |
| GEB029 | 4,000 | R$23.45 | R$16.70 | 28.8% | Simulatable |
| GEB023 | 2,000 | R$24.65 | — | — | BLOCKED — COGS missing |
| GEB024 | 5,000 | R$28.50 | — | — | BLOCKED — COGS missing |
| GEB102 | 4,000 | R$31.00 | — | — | BLOCKED — COGS missing |

Deal file: `gebeauty/scripts/deals/magenta_proposta.json`
(blocked lines stored in `_lines_blocked_no_cogs` key so they aren't silently dropped)

Total simulatable: R$139,200 revenue; R$53,920 GM (38.7%).
Full deal revenue if all 5 SKUs close: ~R$414k.

Payment terms: not yet defined (null in JSON). When received, plug into `--payment-days`.

## COGS table status

Known (ES+IPI): GEB001, GEB002, GEB003, GEB008, GEB010, GEB013, GEB022, GEB029, GEB101, GEB121
Missing: GEB019, GEB020, GEB021, **GEB023, GEB024, GEB102**, GEB120

GEB023/024/102 are the immediate blockers for Magenta. Source to check: Estudo Magenta e B4A.xlsx
(Drive `17MsktMVOxS--PDhbnsHjVKRASvbNpJ1e`, Cenario 3 / col AF = ES+IPI large volume).

## Phases

- [x] 1. Build box_deal_simulator.py — done 2026-06-23
- [x] 2a. Simulate B4A Aug/Sep/Oct 2026 deal — done 2026-06-23
- [ ] 2b. Magenta COGS gaps — BLOCKED: GEB023/024/102 need factory costs from Raphael
- [ ] 3. Complete Magenta simulation + counter-proposal (accept / negotiate / pass) — owner: cto (once COGS in)
- [ ] 4. Define Magenta payment terms — owner: lucas
- [ ] 5. Close or archive Magenta deal — owner: lucas
- [ ] 6. B4A next wave (Nov/Dec 2026+) — plan SKU rotation — owner: shared

## Notes

- 2026-06-24: Split from gebeauty-b2b-channels initiative. Box deals are discount-first,
  no sellout support required — different economics from retail B2B.
- 2026-06-23: GEB022 at 59.3% GM on Magenta price is excellent. GEB029 at 28.8% is thin
  but acceptable if payment terms are short. The 3 blocked SKUs drive most of the volume
  (GEB024 = 5k units alone).
- 2026-06-23: B4A COGS corrections applied: GEB010 ES 4.79→5.11, GEB013 ES 6.07→6.49
  (source: Estudo B4A col AF Cenario 3 large volume ES+IPI).

## Done means

- Magenta simulation complete (all 5 SKUs)
- Counter-proposal sent or deal formally declined
- B4A next-wave SKU plan documented
- box_deal_simulator.py COGS table has no gaps for active deal SKUs
