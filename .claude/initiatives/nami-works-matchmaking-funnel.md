---
slug: nami-works-matchmaking-funnel
status: in-progress
owner: lucas
updated: 2026-09-30
---

# NAMI Works: matchmaking funnel

## What this is

nami.works pivoted (2026-09-30) from "AI consulting for non-digital SMBs"
(the multi-page site in the now-closed PR #138) to a **matchmaking funnel**:
connect a stuck entrepreneur with someone who already solved the same
problem, via a paid 45-minute call in one of three tiers (Colega/Sênior/
Expert, R$200/350/500). Source of truth for copy, quiz, diagnostic, tiers
and acceptance criteria: `nami-works/matchmaking/{handoff.md,
funnel-spec.md}`. Full plan: see the approved plan this initiative was
bootstrapped from (phases below mirror it).

## v1 scope (decided with Lucas 2026-09-30)

- Deterministic diagnostic only (6 pain blocks x 4 phases). The real
  AI-reasoned diagnostic and actual professional matching are a later
  phase, behind a swappable interface.
- The whole site is the funnel + `/privacidade` + `/termos`. No `/sobre`,
  no AI-consulting product pages (all removed, redirects added for
  externally-linkable old paths).
- No professional roster exists or is being built for v1. Every confirmed
  submission is a demand signal Lucas follows up with manually.
- Storage: a new Prisma schema/route inside the existing `apps/connector`
  Fastify app (same Lightsail box, not a new AWS resource), not DynamoDB.
- Hero CTA copy: "entenda seu problema" (decided, no longer a placeholder).

## Phases (stop-and-show after each)

- [x] **Phase 0** — repo housekeeping: closed PR #138, cut worktree
      `C:\claude-wt-matchmaking` / branch `feat/nami-matchmaking-funnel`,
      removed `agenda/contato/diagnostico/implantacao/metodo/operacao/
      obrigado/noticias/sobre`, added redirects in `astro.config.mjs`,
      trimmed `Nav.astro` (logo + theme toggle only, no links) and
      `Footer.astro` (privacidade/termos only).
- [x] **Phase 1** — setup: hero rebuilt on `index.astro` with the spec's
      verbatim copy, verified mobile + desktop in the preview
      (`matchmaking Dev`, port 4328, launch.json).
- [x] **Phase 2** — quiz: 4 steps (Q1/Q2/Q4 single-select, Q3 multi-select
      with up to 2 dynamically-generated follow-up screens), state object
      persisted to `sessionStorage` on every change (survives a refresh
      even mid-step, before advancing). Also rebuilt `Nav.astro` for the
      no-menu header (bigger lockup, taller bar). Verified end-to-end:
      full run-through, click-order-aware follow-ups, back-nav, mobile.
- [ ] **Phase 3** — diagnostic: pure `computeDiagnostic(answers)` function,
      "crescer o negócio" (the one pain with no block) routed through the
      out-of-network/waitlist path. Blocked on: stage-line copy pass (2 of
      4 lines are ambiguous between the old and reworded phase options —
      flagged to Lucas, not yet resolved).
- [ ] **Phase 4** — tiers + confirmation: 3 cards, recommendation tag
      (Pro→Expert, Básico→Colega mapping), "nada é cobrado agora", contact
      capture.
- [ ] **Phase 5** — capture + email: new connector route/schema writes the
      submission record, existing SES identity sends the confirmation
      email (copy needs reframing since there's no real match yet —
      flagged to Lucas, not yet resolved).
- [ ] **Phase 6** — QA: spec's acceptance checklist on a real phone preview.

## Next blocker

None for Phase 2 — proceeding. Phase 3 is blocked on the stage-line copy
pass; Phase 5 is blocked on match-email copy reframing. Both flagged to
Lucas, to be resolved when those phases are reached.

## Open, non-blocking for v1

Professional revenue share per tier, where/how to recruit professionals,
which model/provider eventually runs the AI-reasoned diagnostic + real
matching. Lucas's calls, later.
