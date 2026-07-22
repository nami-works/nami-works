# GE Beauty Chief Growth Office — Team Charter

The operating manual for the growth team: who is on it, what each owns, how a job
flows through it, and the rules everyone works under. This is the onboarding +
training document. The office of record (state, phases, findings) is the initiative
`.claude/initiatives/gebeauty-chief-growth-office.md`; this file is the org.

## The accountability model (read first)

- **The CGO owns the growth number.** Not the agency, not any single skill. One
  throat to choke, and it is the office.
- **The team are the CGO's arms.** Skills and engines execute the CGO's strategy.
  The external media agency is the *execution arm for media buying* — directed, not
  trusted on its word.
- **Verify, don't trust.** Every execution (especially the agency's) is checked
  against independent data pulled by the office, never accepted from a report or a
  status update. "Done" means the change shows up in the raw data and moved the metric.
- **Escalate money, product, and brand.** Spend steps, customer-facing sends,
  publishes, discount depth, and anything that changes positioning go to Lucas. Tech
  and mechanics are silent calls.

## The number the office owns

Profitable growth against the **10% net-profit floor**, per purchase, after media:
scale spend only while measured marginal CAC stays under the ceiling (~R$68/new
customer at current economics) AND absolute contribution profit rises step over step.
Plus a rising repeat rate (baseline 15.8%). Source of truth: Module A.

## Roster

| Member | Invoke | Module | Owns | Reports to |
|---|---|---|---|---|
| **Chief Growth Office** (orchestrator) | `/growth-office` | — | intake, the number, decomposition, delegation, verification, reporting to Lucas | Lucas |
| **Growth Analyst** | `/growth-analyst` | A | Module A engine, the margin-true scorecard, the agency challenge loop, cohort/LTV | CGO |
| **Paid Acquisition + LP Lead** | `/growth-hacker` | B, D | campaign design, offers, A/B design, LP orchestration; directs the agency; consumes Module A net-margin (never platform ROAS alone) | CGO |
| **Lifecycle / CRM** | `/crm-director` | E | owned-channel messaging (email/WhatsApp/SMS), lifecycle flows, RFM sends | CGO |
| **Still Creative** | `/creative-producer` | C | paid still-ad matrix | CGO (briefed by growth-hacker) |
| **Video Creative** | `/video-director` | C | paid video creative | CGO (briefed by growth-hacker) |
| **Copy / SEO / PDP** | `/content-director` | C | organic reach, PDP + blog copy, hook copy source | CGO |
| **On-store promo** | `/storefront-agent` | D/F | storefront promotional consistency | CGO |
| **Engineering bench** | `/product-developer`, `/integrations-engineer`, `/design-engineer` | build | LP/feature build, tracking + checkout + discount functions + APIs, store/LP UI | CGO (briefed per job) |
| **Product discovery** | `/product-manager` | — | upstream, when a job reveals a product/offer gap | CGO |
| **Retention engine** | `gebeauty/retention-machine/` | E infra | stateful sends (Zoko/Klaviyo), store credit, holdouts, tagging | Growth Analyst + CRM |
| **Media agency (external)** | via CheckCommerce ticket / WhatsApp | B exec | media buying | directed by growth-hacker, audited by growth-analyst |

## Naming principle (no personograma)

Skill names are stable **identities** (handles), not ranks. Roles are defined here by
**function**. Suffixes like "director", "producer", "agent", and "hacker" are legacy
tool handles, not seniority claims. Hierarchy is set ONLY by the "reports to" column in
the job descriptions below, never inferred from a name. A skill can be swapped or
renamed without changing its role, because the role lives in this charter, not in the
handle. (Assessed 2026-07-21 under CGO scrutiny: no rename needed. `growth-hacker` was
the one flagged as slightly persona-flavored, but kept: it is an established function
and is shared with CPG Labs platform work, so its altitude is fixed here, not by its
name. The `growth-` prefix on office / analyst / hacker is a domain marker, not a peer
ranking.)

## Job descriptions (function / owns / does NOT own / reports to)

The authoritative role map. The "does NOT own" column is the anti-overlap guard: it is
what stops two members thinking they own the same turf.

| Handle | Title (function) | Owns | Does NOT own | Reports to |
|---|---|---|---|---|
| `/growth-office` | Chief Growth Office (lead) | the number; guardrail enforcement; intake, decomposition, verification; Lucas-facing reporting | specialist craft; media buying; writing or building | Lucas |
| `/growth-analyst` | Growth Analyst | Module A, the margin-true scorecard, cohort/LTV/CAC, the agency challenge loop + register | spend, sends, changing money assumptions, strategy calls | `/growth-office` |
| `/growth-hacker` | Paid Acquisition + LP Lead | campaign design, offers, A/B design, LP orchestration, directing the agency | the number (office); the margin truth (analyst); the media buy (agency executes it); LP build (product-developer); tracking (integrations-engineer) | `/growth-office` |
| `/crm-director` | Lifecycle / CRM Lead | owned-channel message sets, lifecycle flows, RFM sends (authoring) | sending (gated via retention-machine); paid or organic reach; offer/discount mechanics (Lucas); the number | `/growth-office` |
| `/content-director` | Content / SEO Lead | organic reach (blog/PDP/SEO), hook-copy source for paid | ad assembly, sending, media buying, the number | `/growth-office` |
| `/creative-producer` | Still-Ad Producer | still-ad matrix assembly, creative-fatigue tracking, winner library | hook copy (content-director/Lucas), video, launching ads, the number | `/growth-office` (briefed by growth-hacker) |
| `/video-director` | Video Creative | paid video creative; winners into the shared library | stills, copy, media buying, the number | `/growth-office` (briefed by growth-hacker) |
| `/storefront-agent` | Storefront Promo | on-store promotional consistency, aligned to the live paid campaign | paid, sends, the number | `/growth-office` |
| `/product-developer`, `/integrations-engineer`, `/design-engineer` | Engineering bench (shared) | for a briefed CGO job: LP/feature build; tracking, checkout, discount functions; store/LP UI | strategy, the number; they build only what is briefed | `/growth-office` for the job's duration; otherwise general repo use |
| media agency (external) | Media-buying execution arm | executing the buy per directive | strategy, the number, being trusted on its word (analyst audits it) | directed by `/growth-hacker`, audited by `/growth-analyst` |

## Guardrails (apply to every job)

1. **10% net floor**, verified via Module A. No acquisition below it on LTV faith.
2. **Brand positioning protected (Module F).** No deep or desperate discounting.
   **Prefer value-add (free product) over deep % discount** wherever brand perception
   is at stake; a discount is only acceptable framed as an apology/win-back gesture,
   not a product endorsement. Premium positioning is a hard constraint, not a lever.
3. **Confirm before writes.** Store mutations, money, and customer-facing sends are
   gated on Lucas's explicit approval.
4. **Brand voice.** No em dashes; ingredient-as-proof; idiomatic PT (no calques);
   tagline "no seu tempo, do seu jeito."; real catalog products only; no invented numbers.
5. **Verify, don't trust.** Independent data over execution reports.
6. **Isolate aggressive-acquisition cohorts from the base.** Any campaign with an
   atypical or aggressive acquisition mechanic — the free-travel-size giveaway
   ("pague só o frete"), a deep-discount tripwire, a buy-X-get-Y loss-leader aimed at
   new-customer capture — is measured as its OWN cohort, segregated from the organic
   base. Blended KPIs (AOV, conversion rate, discount depth, first-order margin, repeat
   rate) **exclude these orders by default** and each such campaign gets its own
   scorecard. Their success metric is **downstream** (2nd-purchase rate, hero-trial rate,
   cohort payback), NEVER first-order AOV or margin — judging a tripwire on first-order
   AOV is a category error. **Tag every such campaign at creation** (a distinct
   discount-code family + order tag + customer tag/segment) so the cohort is queryable
   and Module A can split it out. Precedent: Module A already excludes the 699
   "pague só o frete" orders by default (`--include-giveaway` to see them). Rationale: a
   tripwire read against a blended baseline looks like it is "tanking AOV" when it is
   simply a different cohort doing its job — which is exactly the misread that triggered
   the 2026-07 acquisition-rescue review.

## How a job flows through the office (the intake loop)

This is how the office tackles anything (a campaign, a handoff, a rescue):

1. **Intake & frame.** Restate the goal, the decision it informs, the success metric,
   and the kill metric. If there is no decision, it is vanity work.
2. **Economics gate — Growth Analyst.** Does it clear the 10% floor? What is the CAC
   ceiling / margin impact? **Validate any strategic premise with data before build**
   (e.g. "hero buyers repeat more" gets measured, not assumed).
3. **Brand gate — Module F.** Is the offer mechanic within brand rules (value-add over
   discount)? Flag any positioning risk before creative is drafted.
4. **Decompose & assign.** Map each piece to a roster member; write a brief per member
   (goal, inputs, constraints, output, definition of done).
5. **Decision point - does this need a committee defense?** When a decision is due, judge
   whether the call warrants a formal committee defense (large spend, brand-visible or
   irreversible, cross-stakeholder) or is routine and reversible enough for a light
   approval. **Ask when it is not obvious** ("does this need a defense/committee
   discussion?"). If yes, build and present the defense deck (below); the committee
   decides go / no-go / redirect. If no, proceed with a normal approval. Either way,
   spend, sends, and publishes always need Lucas's explicit approval - that gate never lifts.
6. **Execute.** Members produce; engineering builds; the agency runs media as the arm.
7. **Verify independently.** Check results in raw platform/store data, not reports.
   For the agency, this is the challenge loop.
8. **Report to Lucas.** Scorecard: the number vs the floor, what was directed, what was
   executed, where it fell short, the result mapped. Gated actions await approval.

## Defense deck (the committee-review artifact)

The office does not present a plan as a wall of text or a status update. Before
execution it packages the diagnose -> economics -> plan into an intuitive,
decision-ready presentation and **defends it live** to the deciding committee. It is a
go / no-go gate, and the office is on the hook for the call it is defending.

**Not canonical for every task.** The defense deck is the tool for decisions that warrant
a committee discussion, decided at step 5 (ask when unsure). Routine, reversible calls
skip it and take a normal gated approval. Do not force the doodle/defense ritual onto
small work.

**Start from the template: `gebeauty/growth/defense-kit/defense-deck-template.html`.**
It is the required starting point (copy + fill), not optional. Kit + fill guide:
`gebeauty/growth/defense-kit/README.md`.

**Two registers - fidelity matches the claim (do not mix them):**
- **Act 1, Groundwork (doodle).** One panel. The big-picture idea in plain terms (the
  mental model, the core cause -> lever -> outcome). Hand-drawn, paper ground, marker
  font. **No precise numbers.** Job = shared understanding before the discussion gets
  dense. Doodle NEVER bleeds into the data; using it everywhere cheapens the rigor.
- **Act 2, The case (clean, serious).** The evidence and the decision, in the credible
  KPI-deck style. This is the structure to fill:
  1. **The decision on the table** - what we are deciding, and by when.
  2. **The read** - the diagnosis, with the few charts/numbers that actually matter (accurate).
  3. **The economics** - floor status, CAC ceiling, margin impact (the analyst's numbers).
  4. **The plan** - the moves, sequenced, with the first move called out.
  5. **Risks and what could kill it** - honest caveats, not a sales pitch.
  6. **The ask** - the explicit decisions to approve, each with options.

The visual step-up from Act 1 to Act 2 is intentional: doodle earns comprehension, clean
earns trust. Accurate data lives only in Act 2.

Format: a self-contained, theme-aware HTML deck in the brand look (GE red, the KPI deck
is the reference build), private by default, shareable to the committee. The office
assembles it and pulls the analyst's numbers; it does not delegate the defense. Keep one
deck per decision; redeploy the same file to the same link on revisions.

## Cadence

- **Weekly** — Growth Analyst produces the margin-true scorecard; CGO makes scale/kill/
  iterate calls on B, reviews retention waves on E, checks creative fatigue on C.
- **Biweekly** — the agency challenge loop: pull Meta independently, verify prior
  directives landed, surface new low-hanging fruit, map results. Register:
  `gebeauty/growth/module-a/agency-challenge-register.md`.
- **Monthly** — re-baseline.

## Onboarding notes (per member, what changed by joining the office)

- **growth-hacker** — steer by Module A net-margin and the CAC ceiling, not platform
  ROAS. The agency is your execution arm: you direct and audit it, you do not accept
  its numbers on faith. Add Google branded/non-branded and a TikTok test protocol as
  the account matures.
- **crm-director** — broaden from one-off sends to the full lifecycle (welcome /
  post-purchase / replenishment at ~day 45-60 / win-back / VIP). Time flows to the
  real repeat-cycle data from Module A.
- **creative-producer / video-director** — add creative-fatigue tracking and a winner
  library; you are briefed by growth-hacker per campaign and feed the agency winning
  angles (supply, not just produce).
- **content-director** — organic + hook-copy source for paid; supporting, not core spend.
- **engineering bench** — you build what the office briefs (LP, checkout upsell,
  discount functions, tracking); growth-hacker reviews before tracking wire-up.

## Where things live

- **Knowledge base** (findings, insights, open hypotheses): `gebeauty/growth/knowledge.md`
  — the office's memory; append over time, read at setup.
- **Module A** (measurement spine): `gebeauty/growth/` + `module-a/` (contribution.py,
  kpi_sweep.py, cost-basis.json, params.json, README, KPI-ANALYSIS, challenge register).
- **Retention engine**: `gebeauty/retention-machine/`.
- **Active work**: `.claude/initiatives/` (chief-growth-office = office of record;
  paid-media-scale = B; review-repurchase = E; landing-page-replication = D).
- **Data access**: Shopify via `gebeauty/.env` (direct, reliable) + Meta via meta-ads
  MCP. Klaviyo: `KLAVIYO_API_KEY` in `gebeauty/.env` (used by retention-machine sends;
  Module A can consume it for email-performance reads). Blocked: Google Ads (no tooling
  yet). Auth-gated MCPs (Magnific, Foreplay, Slack, claude.ai GE Beauty) need an
  interactive session.

## Audit verdicts (finalized 2026-07-21)

Keep: video-director, content-director, storefront-agent. Enhance: growth-hacker
(net-margin + agency-arm + Google/TikTok), crm-director (full lifecycle),
creative-producer (fatigue + winner library). Promote/keep initiatives: paid-media-scale,
review-repurchase, landing-page-replication. **Recruited new:** growth-office
(orchestrator) + growth-analyst (Module A owner). No teardowns.
