---
slug: nami-works-matchmaking-funnel
status: in-progress
owner: lucas
updated: 2026-10-02
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
  removed; no redirects -- there was no traffic to preserve).
- No professional roster exists or is being built for v1. Every confirmed
  submission is a demand signal Lucas follows up with manually.
- Storage (re-decided 2026-10-02): an **isolated** stack in
  `nami/site/infra/terraform/matchmaking.tf` -- one DynamoDB table
  (`nami-works-site-matchmaking`, on-demand, PITR, prevent_destroy) + one
  Lambda behind a public Function URL (CORS enforced at the URL) + SES. It
  first shipped as Prisma + Fastify routes inside `apps/connector`; that was
  dropped because connector is GE Beauty's live MCP gateway
  (`mcp.gebeauty.com.br`) and an eager Prisma client with a missing env var
  would crash the whole gateway. Nothing in `apps/connector` touches
  nami.works now.
- Hero CTA copy: "explique seu problema" (was "entenda seu problema").
  Trust-bridge section between hero and quiz on every persona page
  (wireframe: `nami-works/site/inputs/mockups/landing-bridge-v2.html`).
  Stage lines: validated 2026-10-01 via 4 parallel review passes.

## Phases -- all built and dev-verified; production cutover still open

- [x] **Phase 0** — repo housekeeping: closed PR #138, cut worktree
      `C:\claude-wt-matchmaking` / branch `feat/nami-matchmaking-funnel`,
      removed `agenda/contato/diagnostico/implantacao/metodo/operacao/
      obrigado/noticias/sobre`, trimmed `Nav.astro`/
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
- [x] **Phase 5** — capture + email: Lambda `matchmaking-api` (POST
      `/submissions` on reaching the diagnostic -- captures drop-off as real
      data; one-shot PATCH `/submissions/{id}` on confirm/waitlist), SES
      confirmation to the visitor + a lead alert to Lucas (best-effort,
      never fails the request). Frontend retries a failed create at confirm
      time and shows an error instead of a fake "obrigado" when the submit
      fails. Rewritten 2026-10-02 after dropping the connector-hosted
      version; the earlier end-to-end verification was against that
      version, so the Lambda path is verified by local handler tests only
      until deployed.
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
- [ ] **The confirmation e-mail arrives** -- code is written and wired
      (best-effort, non-blocking), but real SES delivery and the DynamoDB
      write are UNVERIFIED until the Lambda is deployed. Needs a real
      end-to-end submission after `terraform apply`.
- [x] Swapping the diagnostic for an AI-backed one needs no UI change --
      `computeDiagnostico(dor, fase)` is the entire integration surface.

## Next blocker: go-live (needs Lucas)

Done 2026-10-02: `terraform apply` (targeted, 6 resources; lead_intake left
alone) -- DynamoDB `nami-works-site-matchmaking`, Lambda
`nami-works-site-matchmaking-api`, Function URL
`https://qfxw2l4wokb2qzfb4pfv4funde0ikmqb.lambda-url.us-east-1.on.aws/`.
Live smoke test passed on real DynamoDB: create 201, finalize 200, second
finalize 409, unknown id 404, CORS allows only https://nami.works. The test
row was deleted. The second public-invoke permission was added by hand with
the AWS CLI (see matchmaking.tf).

LIVE on nami.works since 2026-10-02 (site deployed from this branch; live
bundle calls the new Lambda, `/agenda` and `/sobre` now 404). A real
submission through the live site landed in DynamoDB with persona + UTM and
the test row was deleted.

Still open:
1. **SES production access requested 2026-10-02, status PENDING.** Until it
   is granted (`aws sesv2 get-account` -> ProductionAccessEnabled), the
   alert to lucas@nami.works works but confirmation emails to real visitors
   are rejected (logged; the submission is still stored), while the
   confirmation screen promises that email.
2. **Merge nami-works/nami-works#139.** The live site was deployed from the
   branch; main still has the old site, so redeploying from main before the
   merge would revert the funnel.

Known follow-ups, not launch-blocking: progression state (screen +
submission id) isn't persisted across a refresh after the diagnostic; the
follow-up radios aren't `required`; a stale follow-up answer can be
re-saved after unticking its path.

## Open, non-blocking for v1

Professional revenue share per tier, where/how to recruit professionals,
which model/provider eventually runs the AI-reasoned diagnostic + real
matching. Lucas's calls, later.
