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

Still open: nothing blocking. SES production access was GRANTED (checked
2026-10-02), so confirmation e-mails now reach real visitors; a live
end-to-end submission produced no Lambda errors. Two `quiz_done` rows from
14:48 UTC with the old option labels (created 1.4s apart, a double-click on
the previous live version) were left in the table; the double-click is fixed
(`finishing` guard in `finishQuiz`).

(PR #139 merged 2026-10-02, squash a71706c.)

Known follow-ups, not launch-blocking: progression state (screen +
submission id) isn't persisted across a refresh after the diagnostic; the
follow-up radios aren't `required`; a stale follow-up answer can be
re-saved after unticking its path.

## Quiz + diagnostic copy pass (2026-10-02, `feat/quiz-copy-pass`)

- Quiz: fase = ainda é uma ideia / começo promissor / já roda, quero escalar
  / crescendo, pede estrutura. Pains (Q2), in order: mercado e clientes,
  vendas e marketing, caixa e finanças, priorização e execução, time e
  gestão, produto, escalar o negócio, plus "não sei por onde começar" (only
  for "ainda é uma ideia"). Q3 "já tentou algum destes caminhos?" has no
  "ainda não tentei" option: a link-style button beside "continuar" clears
  the ticks and skips the follow-ups. Q4 "o que ajudaria mais agora?" plus
  free-text "outra coisa...".
- Diagnostic: eyebrow "sua principal trava", headline = the pain, "o que dá
  pra fazer hoje" = the steps for that fase (`passoPorFase` in `PAIN_BLOCKS`,
  a list per fase: 23 of the 29 combinations have 2-3 separate steps, printed
  as one numbered list) plus a fixed last step "converse com alguém que pode
  ajudar". Lucas edited D05, D09, D10 and D12 in the flow canvas; that copy is
  what ships. Every pain is now
  in-network, so the out-of-network/waitlist screen is unreachable (code kept
  as part of the swappable engine).
- Register agreed with Lucas: professional but plain, no slang. Steps for
  time e gestão and escalar o negócio draw on The Great CEO Within, Ramping
  Your Brand and Blitzscaling (principles paraphrased, nothing quoted).
- Persona pages: `/para/equipe-e-contratacao` prefills "time e gestão". There
  are no landing pages yet for "priorização e execução" or "escalar o
  negócio". sessionStorage key is now `nami-quiz-state-v2`.

## Thank-you page: "organize com a sua IA" (2026-10-02, `feat/thank-you-ai-prompt`)

- A new section after the confirmation screen gives the visitor a prompt to
  take to their own AI (ChatGPT, Claude, etc.), built in the browser from
  their answers: fase, pain, paths tried with outcomes, what would help most
  and, for non-caixa pains, the diagnostic reading + today's step. Nothing is
  sent to nami.works; the prompt is not stored.
- **caixa e finanças** has a specific prompt (v3.3): the visitor attaches or
  pastes ~30 days of statements and gets a one-page read (where the money
  went, 3 spends to review, result before/after the owner's withdrawal, days
  of cash, one action for the week, one number for Mondays, assumptions).
  Every other pain gets a generic prompt: 3 priorities for 14 days, what not
  to do now, an action for the week, assumptions.
- Both end with a plain-text "resumo para guardar". The visitor carries it
  to the next month and pastes it back, so continuity needs no storage here.
- Approach agreed with Lucas: a minimal prompt that only carries what a
  generic AI would not already do (the visitor's context, our point of view,
  one specific actionable output). Validated by independent dry runs against
  an invented messy statement (numbers reconciled; a sparse input now gets a
  complete answer with declared assumptions plus up to 3 questions instead of
  a refusal to answer).
- Not built yet, by decision: the downloadable planilha / 14-day plan documents, per-pain specific prompts
  beyond caixa e finanças, and the MCP. Design direction for the MCP: keep the
  content (steps, plans, prompts) as data with stable ids so a future NAMI
  Works MCP can serve it; the visitor-carried summary is the interim memory.

## Quiz restructure: two pains, split paths (2026-10-02, `feat/quiz-pains-and-paths`, not yet merged)

- **Pains (Q2):** up to two ("escolha até duas"), tracked in click order; the
  first is the main one. It drives the diagnostic and the caixa-specific AI
  prompt; the second shows as "você também marcou: X" and goes into the
  prompt and the lead. "não sei por onde começar" (only for "ainda é uma
  ideia") combines with another pain like any other option. Stored in the existing `dor` field joined as "A + B" (no backend change).
- **Paths (Q3):** implementar com IA / agência ou freelancer / contratar
  equipe / fornecedor/parceiro / consultoria. Follow-ups read per path ("como
  foi ao implementar IA", "com a agência ou freelancer", "ao contratar
  equipe", "com o fornecedor/parceiro", "com a consultoria"); outcomes are now
  não resolveu / resolveu em parte / funcionou, mas não se sustentou.
- **New "retorno" question, one per tried path**, right after that path's
  outcome question: "pensando no que você investiu nesse caminho (tempo e
  dinheiro), valeu a pena?" (valeu o investimento / valeu em parte / custou
  mais do que valia). It replaces "custou mais do que valia" as a per-path
  outcome.
- **New "pares" question** (always): "já conversou com outros empreendedores
  sobre isso?" (sim, e ajudou / ... em parte / sim, mas não ajudou / ainda
  não). It happens independently of the paths, so it is asked on its own,
  after the paid paths and before "o que ajudaria mais agora".
- Both new answers are stored in the existing `seguimentos` map (keys
  "retorno do investimento: <path>" and "conversei com outros empreendedores") and
  are included in the AI prompt context.
- **Peer answer steers the tier:** "sim, mas não ajudou" never recommends
  Colega (same format as what failed) and leans to Sênior; "sim, e ajudou"
  recommends Colega as the step up ("alguém que já resolveu exatamente o que
  trava o seu negócio"); "ajudou em parte" leans to Sênior; "ainda não" adds
  Colega as a natural first conversation. A one-line reason shows above the
  tier cards in the first three cases (copy drafted, pending Lucas's edit).
- **Q4 / tiers:** "validar decisão" removed; "traçar um caminho prático" ->
  Expert, "aprender com quem já viveu" -> Colega (peer), "apoio e
  acompanhamento" -> Sênior (advisor). Having tried "consultoria" still adds
  Expert; no paths tried still adds Colega.
- sessionStorage key bumped to `nami-quiz-state-v3` (answer shape changed).

## Lead-first step + system colour scheme (2026-10-03, `feat/nami-works-lead-first`)

Designed in the flow canvas first (rows 3 and 4, mobile 390), then coded.

- **Flow:** quiz -> diagnostic -> "receber meu plano" (e-mail required,
  WhatsApp optional, no prices) -> thank-you (plan sent, the AI prompt, then
  the offer of a conversation) -> one tap on "pedir esta conversa".
  The tiers screen and the name/phone/e-mail confirmation form are gone.
  The recommended tier is shown preselected, the other two sit behind "ver
  outras opções". The visitor's name is no longer asked anywhere.
- **API (`matchmaking-api`):** a submission now moves `quiz_done` -> `lead` ->
  `confirmed` (or `quiz_done` -> `waitlist`). A PATCH that does not fit the
  current status is 409. `confirmed` still accepts a row in `quiz_done` with
  an e-mail in the body, so pages cached before the deploy keep working. The
  lead step mails the visitor their plan (reading, numbered steps, the AI
  prompt) and mails Lucas an alert; the confirmed step mails both again.
  Anything the browser sends that ends up in an e-mail (fase, dor,
  diagnosticoTexto, promptIA) is refused if it contains a link, and promptIA
  must start with "contexto do meu negócio:". Needs `terraform apply` in
  `nami/site/infra/terraform` to ship the Lambda change.
- **Stored differently:** `diagnosticoTexto` is now the reading plus the
  numbered steps (multi-line); `leadAt` is set on the lead step, `finalizedAt`
  only on confirmed/waitlist; WhatsApp is stored in `telefone`.
- **Colour scheme:** the dark/light toggle is removed. Tokens switch on
  `prefers-color-scheme`; the nav lockup, favicon, persona avatar and the legal
  pages follow the same setting. Every `.ctaRow` button is right-aligned.
- **Copy:** post-quiz copy revised to the pre-quiz register (professional,
  close, no slang); "o que dá pra fazer hoje" is now "o que você pode fazer
  hoje".

## Open, non-blocking for v1

Professional revenue share per tier, where/how to recruit professionals,
which model/provider eventually runs the AI-reasoned diagnostic + real
matching. Lucas's calls, later.
