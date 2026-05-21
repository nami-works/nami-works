# Handover prompt

Paste the block below into a fresh Claude Code session opened against the **cpg-labs repo** (not this one). It hands off the full plan in one shot — the new session reads the blueprint, gathers the reference artifacts, and starts on day-zero defect #1.

The blueprint lives at `letterbox/optimizer-iteration-blueprint.md` in the nami-works repo. Copy it into the cpg-labs repo (suggest `docs/optimizer-iteration-blueprint.md`) before pasting, OR reference it via absolute path in the prompt — both work.

---

## The prompt

```
We are starting a structured iteration loop to improve the Local Delivery
optimizer in this repo (cpg-labs). The full plan lives in
docs/optimizer-iteration-blueprint.md — read it end-to-end before doing
anything else. It is not aspirational; every section is operational and
should be followed unless we explicitly decide to deviate.

Strategic frame in one paragraph: cpg-labs is a deployed multi-tenant
Shopify app whose optimizer has known operational gaps (the operator
catches them daily and tweaks by hand). We are fixing those gaps in cpg-labs
directly — not in any sandbox or fork — by running a defect-driven loop:
each operational failure becomes a tracked GitHub Issue with structured log
evidence, becomes a flag-gated PR, soaks on one tenant, and promotes to
default. Section 13 of the blueprint contains 8 pre-identified day-zero
defects ready to file as Issues. Section 12 defines the autonomy gate that
governs how much the auto-delivery cron is trusted per tenant — every
defect closed moves the operator-tweak-rate metric and earns the cron more
autonomy. The end state is fully autonomous dispatch.

What I need you to do, in order:

1. Read the blueprint front to back. Confirm you understand sections 0
   (strategy), 2 (iteration cycle), 12 (autonomy gate), and 13 (day-zero
   defects).

2. Surface the §10 reference artifacts you need from me before you can
   make progress. Specifically: CloudWatch log group name + AWS region +
   profile name with read access; current logger library and formatter
   conventions; existing feature-flag system if any; scripts/tools
   directory convention this repo uses; Anthropic SDK auth pattern (env
   var or SSM path) for the defect-classifier prompt. Ask me precisely
   what you cannot find by reading the codebase.

3. Once unblocked on §10 artifacts, start with the day-zero filing order
   from §13. The order is:
       1) §13.8 mark-delivered-treats-failed-stops-as-delivered  (highest
          severity — customer-facing fulfillment correctness)
       2) §13.1 optimize-cost-aware-everywhere
       3) §13.2 auto-delivery-cron-violates-7-stop-cap
       4) §13.3 state-endpoint-stale-dispatch-metadata
       5) §13.4 + §13.5 stack on §13.1
       6) §13.7 multi-tenant readiness
       7) §13.6 cleanup epic
   File the first 3 as GitHub Issues using the §4.4 template (Summary,
   Defect class, Evidence, Proposed fix direction, Acceptance criteria).
   Use the gh CLI; I'm authenticated. Show me each issue body before you
   create it — I want to read and confirm before we file.

4. After the first 3 issues are filed, propose week-1 deliverable PR #1:
   the telemetry audit from §3.3. Open a branch, do the audit, draft the
   PR body, show me before pushing.

Hard rules:

- Do not invent code paths or file structures. When the blueprint says
  "verify the existing logger" or "check existing scripts directory
  convention," actually verify by reading the codebase before assuming.
- Do not skip the feature-flag pattern. Every behavior change is gated.
  If the repo lacks a flag system, that's the first PR (per §5.2).
- Do not write feedback UI into the embedded Shopify admin app. The
  feedback CLI lives in scripts/feedback/ (or whatever the repo's
  convention is) and is operator-only — never deployed to merchants.
- Do not run nami_control.py or anything in the nami-works repo. That
  repo is demoted to read-only viewer; all work happens here in cpg-labs.
- Do not start coding the day-zero fixes (§13.1, §13.2, etc.) until the
  telemetry PR has landed and we can verify the loop with real CloudWatch
  evidence. The blueprint's filing order is for Issues; the fix order
  follows the soak cadence in §5.

Operator context that matters:

- gebeauty is the only active tenant today. All flag rollouts soak there
  before defaulting on for everyone.
- Memory items relevant to defects 13.8 and the per-stop POD work:
  project_beatriz_77793_pending.md, feedback_fulfill_notify_default.md,
  the Yasmin #78301 incident referenced throughout §13.8.
- The day-to-day operator loop is documented in §6 — feedback happens
  end-of-day in 5 minutes. The CLI does the heavy lifting, I do the
  natural-language complaints.

Start by reading the blueprint. Once you've read it, your first message
back to me should be: (a) any clarifying questions on the strategic
frame, (b) the precise list of §10 artifacts you need from me to
proceed.
```

---

## How to use it

1. Copy `optimizer-iteration-blueprint.md` from this folder into the cpg-labs repo at `docs/optimizer-iteration-blueprint.md` (or wherever the repo's docs live).
2. Open a fresh Claude Code session pointed at the cpg-labs repo.
3. Paste the prompt block above.
4. The first response should be a list of clarifying questions and the §10 artifacts ask. Answer those, and the loop is operational.

If the new session asks for the blueprint at a different path (because you placed it elsewhere), just point it there and continue.
