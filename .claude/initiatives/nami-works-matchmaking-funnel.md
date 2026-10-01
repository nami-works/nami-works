---
slug: nami-works-matchmaking-funnel
status: in-progress
owner: lucas
updated: 2026-10-01
---

# NAMI Works: matchmaking funnel

## What this is

nami.works pivoted (2026-09-30) from "AI consulting for non-digital SMBs"
(the multi-page site in the now-closed PR #138) to a **matchmaking funnel**:
connect a stuck entrepreneur with someone who already solved the same
problem, via a paid 45-minute call in one of three tiers (Colega/Sênior/
Expert, R$200/350/500). Source of truth for copy, quiz, diagnostic, tiers
and acceptance criteria: `nami-works/matchmaking/{handoff.md,
funnel-spec.md}`. PR: nami-works/nami-works#139 (open, not yet merged).

## v1 scope (decided with Lucas 2026-09-30 / 2026-10-01)

- Deterministic diagnostic only (5 pain blocks x 4 phases -- "crescer o
  negócio" has no pain block and is routed to the out-of-network path). The
  real AI-reasoned diagnostic and actual professional matching are a later
  phase, behind the swappable `computeDiagnostico(dor, fase)` interface.
- The whole site is the funnel + `/privacidade` + `/termos` + 5 Instagram
  persona landing pages. No `/sobre`, no AI-consulting product pages (all
  removed, redirects added for externally-linkable old paths).
- No professional roster exists or is being built for v1. Every confirmed
  submission is a demand signal Lucas follows up with manually.
- Storage: `nami-matchmaking` Prisma schema (separate logical DB, same
  Lightsail Postgres box as connector), new CORS-scoped route pair inside
  `apps/connector`.
- Hero CTA copy: "entenda seu problema". Stage lines: validated 2026-10-01
  via 4 parallel review passes (see below).

## Phases -- all built and dev-verified; production cutover still open

- [x] **Phase 0** — repo housekeeping: closed PR #138, cut worktree
      `C:\claude-wt-matchmaking` / branch `feat/nami-matchmaking-funnel`,
      removed `agenda/contato/diagnostico/implantacao/metodo/operacao/
      obrigado/noticias/sobre`, added redirects, trimmed `Nav.astro`/
      `Footer.astro` for the no-menu layout.
- [x] **Phase 1** — hero rebuilt on `index.astro`, verified mobile + desktop.
- [x] **Phase 2** — quiz: 4 steps, up to 2 dynamically-generated follow-up
      screens in actual click order (not DOM order -- caught and fixed a
      real bug here), sessionStorage persistence on every change (survives
      a refresh even mid-step), mutual exclusivity on "ainda nada".
- [x] **Phase 3** — diagnostic: `computeDiagnostico(dor, fase)`, 4 stage
      lines validated via 4 parallel independent review agents (one per
      phase), each checking voice-rule compliance AND cross-checking every
      candidate against all 5 pain blocks for contradiction. Winners:
      "ainda é uma ideia" → *"nessa fase, validar vale mais que
      construir."* / "começando..." → *"ser promissor não substitui
      processo por trás."* / "já roda, quero ganhar escala" → *"pra
      crescer, o que funciona hoje precisa rodar sem você em cima o tempo
      todo."* / "crescendo, preciso me estruturar" → *"nessa fase, o que
      trava é o resto da empresa não acompanhar o ritmo do negócio."*
      "crescer o negócio" has no pain block yet -- routed to the
      out-of-network/waitlist card instead of guessed copy.
- [x] **Phase 4** — tiers + confirmation: 3 cards, recommendation-tag logic
      (Pro→Expert, Básico→Colega resolved), multi-match "mention the other"
      note, "nada é cobrado agora" always visible, no payment field
      anywhere. Confirmation form (name/phone/email); waitlist form
      (email+phone, per the acceptance criteria) for the out-of-network
      path. Confirmation/waitlist copy reframed since no real roster exists
      yet -- never claims a match already happened.
- [x] **Phase 5** — capture + email: `nami-matchmaking` Prisma schema +
      migration, new CORS-scoped connector routes (POST on reaching the
      diagnostic -- captures drop-off as real data; PATCH on confirm/
      waitlist), SES confirmation email (best-effort, never blocks the
      stored submission on a failed send). **Verified end to end against a
      local Postgres + local connector instance**: both paths, correct
      status transitions, correct data on every field including UTM/
      persona attribution.
- [x] **Phase 6** — QA: full acceptance checklist run (see below). Mobile
      verified via screenshots at every major step.
- [x] **Instagram continuity (added 2026-10-01, not in the original plan)**
      — 5 persona landing pages (`/para/<slug>`, one per pain block with
      complete copy), feed-like mobile-first above-fold (post-header row +
      bold hook + single CTA, sized for an immediate read not a
      scroll-to-reveal hero), `prefilledDor` prop skips "onde você sente
      que travou" in the quiz, UTM params captured and stored. Shared
      mechanism extracted into `MatchmakingFunnel.astro` so the generic
      page and all 5 personas stay identical below the fold. Fixed a real
      cross-page bug: sessionStorage was shared under one key across every
      page, so resuming the quiz on a different persona silently inherited
      the wrong context's answers -- now namespaced per persona.

## Acceptance checklist (funnel-spec.md), verified 2026-10-01

- [x] All visitor-facing copy is PT-BR, verbatim from the spec except the
      validated stage lines and the reframed confirmation/waitlist copy
      (both explicit, approved deviations).
- [x] Quiz works one-thumb on mobile; back never loses an answer.
- [x] Every pain x phase combination produces a complete diagnostic card
      (verified by inspection: only "crescer o negócio" has empty pain-
      block text, and it's routed to the out-of-network branch instead of
      ever rendering).
- [x] Out-of-network fallback captures email AND phone (fixed -- the
      waitlist form initially only had email).
- [x] All three tiers always selectable regardless of the recommendation
      tag (no disabling logic exists).
- [x] "nada é cobrado agora" visible under tiers and (in its confirmation-
      screen phrasing) on the confirmation screen; no payment field exists
      anywhere in the DOM.
- [x] A confirmed request and a waitlist sign-up both land in storage with
      the full answers -- verified via direct DB queries both ways.
- [ ] **The confirmation e-mail arrives** -- email-sending code is written
      and wired (best-effort, non-blocking), but real delivery is
      UNVERIFIED: this sandbox has no AWS credentials to actually hit SES.
      Needs a real end-to-end send check once deployed.
- [x] Swapping the diagnostic for an AI-backed one needs no UI change --
      `computeDiagnostico(dor, fase)` is the entire integration surface.

## Next blocker: production cutover (needs Lucas, touches shared infra)

Everything above is built, committed, pushed, and dev-verified. What's left
is the actual go-live, which this session does not have credentials/
authorization to do unattended (production deploy + IAM changes):

1. Provision the `nami_matchmaking` database on the real Lightsail Postgres
   and run `prisma migrate deploy --schema=prisma/nami-matchmaking/schema.prisma`
   against it (`DATABASE_URL_NAMI_MATCHMAKING` set on the box).
2. Confirm connector's production AWS credentials include `ses:SendEmail`
   for the nami.works SES identity -- unverified from here. The existing
   lead-intake Lambda has this scope; connector's own runtime identity may
   not.
3. Redeploy `apps/connector` with this branch's code once merged.
4. Set `PUBLIC_MATCHMAKING_API_BASE` to the real production connector URL
   (currently `https://mcp.gebeauty.com.br` is the only known public
   hostname for connector -- flagging that this means a GE-Beauty-branded
   domain will carry nami.works form traffic in the background; invisible
   to end users since it's a fetch() call, never shown in the address bar,
   but worth a dedicated subdomain later if that bothers Lucas) before
   building the site for production.
5. Redeploy the static site (S3 + CloudFront, existing Terraform).
6. Merge nami-works/nami-works#139.

## Open, non-blocking for v1

Professional revenue share per tier, where/how to recruit professionals,
which model/provider eventually runs the AI-reasoned diagnostic + real
matching. Lucas's calls, later.
