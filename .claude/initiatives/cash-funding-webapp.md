---
id: cash-funding-webapp
name: Invoice-discounting simulator + allocation engine for GE Beauty
owner: cto
status: in-progress
priority: normal
created: 2026-08-05
target: null
current_phase: 1-app-built-needs-e2e-verify
next_blocker: no local Postgres available in this sandbox to run migrate+seed+click-through; Docker Desktop won't start here
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
- [ ] 1f. End-to-end verify (migrate + seed + run + click through) — BLOCKED, needs a reachable Postgres
- [ ] 2. Deploy to the Lightsail box (`cpg-labs-lean`, same box as `apps/connector`) — sibling Docker Compose service + Caddy vhost under `gebeauty.com.br`
- [ ] 3. (Phase 2, deferred by Lucas's call) Omie/Shopify auto-pull ingestion

## Notes
- 2026-08-05 — Built per `docs/handoff-cash-funding-webapp.md`. Location/infra/auth decisions made with Lucas: new folder in this monorepo (`apps/cash-funding`), same Lightsail box + domain as the MCP connector, same auth *method* (Google OAuth) but scoped to this app's own small invited-user list rather than the connector's full multi-tenant/bearer/role machinery (that's built for external API clients, not a handful of humans in a browser).
- 2026-08-05 — Verified against handoff acceptance criteria: UAUBox Booster Definição (Corrido, 5x115.699 from 2026-10-15) → dues 14/11, 14/12, 13/01, 12/02, 14/03 ✓ exact match. B4A Terça-3-25 chaining with offset=30/interval=30 reproduces the expected monthly stream (Set/Out 52.5k, Nov 97.5k, Dez 150k, Jan/Fev 157.5k, Mar 112.5k, Abr 60k) ✓. Net-cost formula lands within a few % of the real booked op 1359525753 — handoff itself flags that gap as expected (real op's tarifa/IOF differ from the idealized per-installment model).
- 2026-08-05 — Reference file `Simulador_Antecipacao_GE.xlsx` moved to `docs/` (was dropped at repo root). `claude/invoice-discounting-register.md` never materialized on disk — not a blocker, the handoff's inlined domain model is explicitly "the whole spec."
- 2026-08-05 — Docker Desktop would not start in this sandbox (process didn't come up after `Start-Process`), so migrate+seed+click-through couldn't run this session. Everything short of that is verified: schema validity (Prisma client generated clean), full `tsc --noEmit` across server/routes/seed with zero errors, and the domain-logic acceptance tests above run standalone via `tsx`.
- Next session or Lucas: get a Postgres reachable (local Docker once it's working, or `psql`/cloud instance) and run `npm run prisma:migrate:cash-funding && npm run seed:cash-funding && npm run dev:cash-funding`, then click through http://localhost:3010 (needs `GOOGLE_CLIENT_ID`/`SECRET`/`SESSION_SIGNING_KEY` in `apps/cash-funding/.env` — copy `.env.example`).

## Done means
- `npm run dev:cash-funding` serves the app locally; Google login works for an invited user; the 8 seeded deliveries show their generated installments with correct due dates; "Sugerir alocação" produces a suggestion that respects Ghia's R$250k per-sacado cap and both funders' tenor/teto limits; "Aplicar" persists it.
- Deployed and reachable on the Lightsail box under `gebeauty.com.br`, smoke-tested (`/health` → `{"ok":true}`).
