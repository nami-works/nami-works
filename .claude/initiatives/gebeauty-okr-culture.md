---
id: gebeauty-okr-culture
name: OKR + Check-in Culture Rollout
owner: shared
status: in-progress
priority: normal
created: 2026-07-30
target: null
current_phase: 4-leadership-alignment-session
next_blocker: Lucas needs to run the leadership alignment session (real-world action, not a dev task) — surfaces the conscious "margem" exclusion decision and confirms O2-KR3 co-ownership with marketing
next_owner: lucas
stakeholders:
  - lucas
  - leadership team
  - marketing
  - operações
  - financeiro
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why

GE Beauty is rolling out OKRs + a check-in cadence (quarterly + weekly) as its first structured goal-setting culture. The three teams (marketing, operações, financeiro) each proposed KR candidates; this initiative tracks consolidating those into a final, presentable OKR set and the rollout mechanics (deck, survey, alignment session) that get the team actually using it.

## Phases

- [x] 1. Consolidate the three teams' KR proposals (Marketing `.pptx`, Operações `.docx`, Financeiro `.docx`) into a company draft with full traceability — done 2026-07-30
- [x] 2. Lock final OKR set to 3 KRs per objective (from a 5-candidate consolidation) — done 2026-07-30
- [x] 3. Build and polish the rollout deck as a published claude.ai Artifact (KRs on cards, timeline progress states, growth-tone O1 title) — done 2026-07-30
- [ ] 4. Run the leadership alignment session — IN PROGRESS, owner: lucas
- [ ] 5. Send the anonymous listening survey (`pesquisa-escuta-time.md`)
- [ ] 6. Populate the deck's placeholder numbers (`x%`/`y%`/days of inventory) with real baselines + targets, republish
- [ ] 7. Consciously decide whether "margem" (recuperar margem) stays excluded — surface at the alignment session, not an accident

## Notes

- **2026-07-30 — Final OKR set locked (3 KRs/objective):**
  - **O1 · "Acelerar o nosso crescimento com ganhos de eficiência financeira."** 1. Receita (YoY, not sequential — GE has strong seasonality). 2. Despesa financeira (combines old "dinheiro caro"/conta garantida + despesa financeira; conta-garantida reduction is the driver, not its own KR). 3. Tempo médio de estoque (also the O1↔O2 bridge, counted once, lives in O1).
  - **O2 · "Ganhar eficiência: fazer mais e melhor, com menos atrito."** 1. IA no dia a dia (cada área rodando ≥1 fluxo real e eficiente). 2. Atrito pós-venda (devoluções + SAC complaint tickets merged into ONE metric — one denominator, dedupes overlap; measured via Shopify + Gorgias). 3. Custo operacional (% da receita, co-owned operação + marketing, includes marketing-driven logistics costs so marketing is accountable for the ops cost its campaigns create).
  - Cadence: quarterly + weekly check-ins, annual umbrella, Aug–Sep is a 2-month beta warm-up.
- **O1 title evolution:** "Conquistar a nossa independência financeira" → flagged by the team as sounding like a deficit for a 6-year-old company → "Acelerar o nosso crescimento com o nosso próprio caixa" → final: "Acelerar o nosso crescimento com ganhos de eficiência financeira." Growth tone, no deficit framing.
- **5 team proposals left out completely** (full list + rationale in `gebeauty/okr-culture/okr-empresa-rascunho.md`): (1) recuperar margem — the strategically notable omission, Giulia called it "a única saída permanente"; needs a *conscious* decision, not a silent drop; (2) cortar custo fixo; (3) produção própria/insourcing (shampoo a seco); (4) aporte de sócio (excluded by design); (5) ciclo de caixa / % antecipado (parked for a future cycle).
- Numbers on the deck (`x%`, `y%`, days) are intentionally placeholders — co-built live with the team, never invented by Claude.
- Both O1 and O2 titles currently contain "eficiência" (O1 "eficiência financeira", O2 "Ganhar eficiência") — left as-is by design choice this session; optional future call to differentiate O2's verb (e.g. "Operar com mais eficiência…") if it reads as overlapping once the team sees it live.
- Deck is the shared Artifact (authoritative, update via Artifact tool, favicon 🎯 kept stable) + committed source at `gebeauty/okr-culture/rollout-playbook.html` on `origin/main`. Card layout is custom CSS (`.okr-card`, `.okr-card-list` counter-based numbering; `.step.done`/`.step.next` for timeline states) — KR text edits go in the `<li>` under the right `<ol class="okr-card-list">`.
- Deck is deliberately minimal (objective + numbered KR statements only, no owners/sources/footers) — full provenance and the "left out" list live only in `okr-empresa-rascunho.md`, don't re-add to the deck.

## Done means

- Leadership alignment session run, with the "margem" exclusion surfaced as a conscious choice.
- Anonymous listening survey sent.
- Deck's `x%`/`y%`/days placeholders replaced with real, team-agreed baselines and targets, and republished.
- O2-KR3 (custo operacional) co-ownership with marketing explicitly confirmed.
