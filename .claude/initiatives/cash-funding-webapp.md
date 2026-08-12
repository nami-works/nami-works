---
id: cash-funding-webapp
name: Invoice-discounting simulator + allocation engine for GE Beauty
owner: cto
status: in-progress
priority: normal
created: 2026-08-05
target: null
current_phase: 2-deploy-to-lightsail
next_blocker: none — merged to main; next move is standing up the Lightsail deploy (new Docker Compose service + Caddy vhost on cpg-labs-lean)
next_owner: cto
stakeholders:
  - Lucas (GE Beauty cash & funding)
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why
Replaces the Excel model (`Simulador_Antecipacao_GE.xlsx`) that outgrew the spreadsheet for GE Beauty's antecipação de recebíveis. The one thing the spreadsheet does worst — deciding which installments to discount, when, with which funder, under tenor/cap/ceiling constraints — becomes a real allocation engine instead of manual formula-chasing.

## Phases
- [x] 1a. Domain model + Prisma schema (`prisma/cash-funding/schema.prisma`) — 2026-08-05
- [x] 1b. Due-date engine (Corrido + Terça 3-25 chained snapping) + cost formula + greedy allocation engine — verified against handoff acceptance criteria — 2026-08-05
- [x] 1c. Fastify app scaffold, simplified Google-OAuth login (invited-email gate), API routes (funders/deliveries/installments/allocation/operations) — 2026-08-05
- [x] 1d. Minimal UI (vanilla HTML/JS, `apps/cash-funding/public/`) — 2026-08-05
- [x] 1e. Seed data from handoff (2 funders, 8 deliveries, 1 historical operation) — 2026-08-05
- [x] 1f. End-to-end verify (migrate + seed + run + click through) — 2026-08-06, local Postgres in Docker, full click-through incl. allocation engine
- [x] 1g. Receivables timeline view (client x PO x month, green/yellow/grey feasibility, 4 grand-total rows) — 2026-08-06, per Lucas's spec; mockup approved
- [x] 1h. PT-BR terminology sweep (funder/tenor/cap -> financiador/prazo/limite) across app + engine reason strings — 2026-08-06
- [x] 1i. Merged to `main` as PR #86 (squash) — 2026-08-07
- [ ] 2. Deploy to the Lightsail box (`cpg-labs-lean`, same box as `apps/connector`) — sibling Docker Compose service + Caddy vhost under `gebeauty.com.br`
- [ ] 3. (Phase 2, deferred by Lucas's call) Omie/Shopify auto-pull ingestion

## Notes
- 2026-08-05 — Built per `docs/handoff-cash-funding-webapp.md`. Location/infra/auth decisions made with Lucas: new folder in this monorepo (`apps/cash-funding`), same Lightsail box + domain as the MCP connector, same auth *method* (Google OAuth) but scoped to this app's own small invited-user list rather than the connector's full multi-tenant/bearer/role machinery (that's built for external API clients, not a handful of humans in a browser).
- 2026-08-05 — Verified against handoff acceptance criteria: UAUBox Booster Definição (Corrido, 5x115.699 from 2026-10-15) → dues 14/11, 14/12, 13/01, 12/02, 14/03 ✓ exact match. B4A Terça-3-25 chaining with offset=30/interval=30 reproduces the expected monthly stream (Set/Out 52.5k, Nov 97.5k, Dez 150k, Jan/Fev 157.5k, Mar 112.5k, Abr 60k) ✓. Net-cost formula lands within a few % of the real booked op 1359525753 — handoff itself flags that gap as expected (real op's tarifa/IOF differ from the idealized per-installment model).
- 2026-08-05 — Reference file `Simulador_Antecipacao_GE.xlsx` moved to `docs/` (was dropped at repo root). `claude/invoice-discounting-register.md` never materialized on disk — not a blocker, the handoff's inlined domain model is explicitly "the whole spec."
- 2026-08-05 — Docker Desktop would not start in this sandbox initially; resolved 2026-08-06 after Lucas ran a factory reset (root cause: a corrupted runtime socket file under `AppData\Local\Docker\run\`, unrelated to this app — the accented/spaced Windows username tripped up Docker's newer "Inference manager" feature).
- 2026-08-06 — Full local verify: worktree at `.claude/worktrees/cash-funding` (avoids colliding with other sessions' work on the shared `main` checkout), local Postgres container `cash-funding-pg` on :5434, migration `20260806131951_init` applied + committed, seed run, dev server clicked through end-to-end incl. the allocation engine (confirmed it correctly respects live-edited funder params — Itaú's tenor got changed to 120d during testing, correctly pushing longer-tenor installments to infeasible on both funders, not a bug). Added `/auth/dev-login` (non-prod only) so this doesn't require a real Google OAuth client to test locally.
- 2026-08-06 — Built the receivables timeline view per Lucas's spec: client-grouped rows, PO sub-rows, month columns, green/yellow/grey per-cell feasibility, 4 grand-total rows. One shared `allocate()` run drives both the cell verdicts and the "smartest allocation" net total (row 2) so they can never disagree. Mockup approved as-is; PT-BR terminology swept across the whole app afterward (funder/tenor/cap -> financiador/prazo/limite).
- 2026-08-07 — PR #86 squash-merged to `main`, remote branch deleted. Next move: Lightsail deploy (new Compose service + Caddy vhost on `cpg-labs-lean`, same box as `apps/connector`) — not started yet.

## Done means
- `npm run dev:cash-funding` serves the app locally; Google login works for an invited user; the 8 seeded deliveries show their generated installments with correct due dates; "Sugerir alocação" produces a suggestion that respects Ghia's R$250k per-sacado cap and both funders' tenor/teto limits; "Aplicar" persists it.
- Deployed and reachable on the Lightsail box under `gebeauty.com.br`, smoke-tested (`/health` → `{"ok":true}`).
