# Route Optimization

**Status:** Phase 0 artifacts shipped + Phase 1 scaffolding in flight. The type contract and eval-runner skeleton live here; the five component implementations land in subsequent PRs.

Plan reference: [docs/okrs/local-delivery.html](../../../docs/okrs/local-delivery.html) for the operator-facing roadmap. This directory contains the data + the type-and-test scaffolding the five Phase 1 components plug into.

## What's here

```
route-optimization/
├── eval/
│   ├── seed.json                    # 12 verified cases from past operator decisions
│   └── runner.ts                    # eval test runner skeleton (Phase 1.1)
├── geofences/
│   └── brazil.json                  # barriers, outlier thresholds, corridor pairs
├── prompts/
│   └── v1-spatial-reasoner.md       # the LLM contract
├── __tests__/
│   └── seed-shape.test.ts           # validates seed.json against the type contract
├── types.ts                         # shared interfaces for all 5 Phase 1 components (Phase 1.1)
└── README.md                        # this file
```

## Type contract

[`types.ts`](./types.ts) defines the artifact each Phase 1 stage produces. Reading it top-to-bottom traces the full pipeline:

| Stage | Producer | Type |
|---|---|---|
| 1 | `candidate-generator.server.ts` (pending) | `Candidate[]` — K=3-5 cluster variants |
| 2 | `rule-engine.server.ts` (pending) | `RuleResult[]` — one per candidate, evaluates `geofences/brazil.json` |
| 3 | `quote-engine.server.ts` (pending) | `QuoteResult[]` — parallel Lalamove quotes |
| 4 | `spatial-reasoner.server.ts` (pending) | `SpatialReasonerOutput` — advisory LLM scoring + post-mortem flags |
| 5 | `decision-arbiter.server.ts` (pending) | `ArbiterDecision` — the winner, autonomously committed |

The system is fully autonomous at decision time. `ArbiterDecision.winningCandidateId` is never null; soft-rule violations and ambiguity surface via `postMortemFlags[]` for the operator's post-mortem panel (Phase 3), not via a real-time review queue.

## How to use these artifacts (before any code lands)

### Eval set (`eval/seed.json`)

This is the **regression baseline** for everything we build. Every prompt change, every rule addition, every operator-feedback-turned-rule must be measured against this set.

- Each case has an `expectedDecision` — the operator-validated correct answer
- Each case lists `rulesExercised` so we can compute per-rule coverage
- The `passRatePolicy` at the bottom defines what counts as a pass

Manual use today (before Phase 1 ships): operator can review each case as a checklist. For each new dispatch session, mentally cross-reference against the rule(s) the cases exercise.

### Geofence registry (`geofences/brazil.json`)

This is the **deterministic source of truth** for barriers, outlier thresholds, and corridor pairs. The rule engine reads this; the LLM is shown an excerpt as context.

- `barriers[]`: physical or operational constraints (water, highway chokepoints, slow corridors)
- `outlierThresholds`: per-metro distance thresholds
- `absorptionThresholds`: when the ≤N-order ≥Xkm-spread variant should fire
- `sparseVolumeLocations`: solo-order postponement candidates
- `corridorPairs`: pickup→cluster pairs where intermediate orders should be absorbed

The registry is data, not code. Engineers wire it in; operators (via the rule-promotion-gate in Phase 4) update it.

### Spatial-reasoner prompt (`prompts/v1-spatial-reasoner.md`)

The exact system prompt + user-message template for the LLM call. Tagged `v1` because every change forks a new version (immutable once promoted).

- System prompt: role, decision heuristics, output schema, confidence policy
- User message template: how the orchestrator wraps PNG + candidates + rule findings
- Few-shot examples: 2 anchoring outputs (clean baseline + barrier-crossing trade-off)

## What's intentionally NOT here yet

Each gets its own PR. The type contract in `types.ts` already pins their interfaces; subsequent PRs implement them one at a time and run each against `eval/runner.ts` before merge.

- `candidate-generator.server.ts` — multi-candidate clustering (Phase 1.2)
- `rule-engine.server.ts` — evaluates geofence/threshold rules (Phase 1.3)
- `quote-engine.server.ts` — parallel Lalamove quotes for each candidate (Phase 1.4)
- `spatial-reasoner.server.ts` — wraps the LLM call (Phase 1.5)
- `decision-arbiter.server.ts` — combines cost + rules + LLM scores (Phase 1.6)
- `auto-dispatch-orchestrator.server.ts` (Phase 2)
- `post-mortem-analyzer.server.ts` (Phase 3)
- `feedback-classifier.server.ts` / `rule-synthesizer.server.ts` (Phase 4)

## Running the eval

```
npx tsx --test app/services/route-optimization/__tests__/seed-shape.test.ts
```

In Phase 1.1 the only test is the seed-shape gate; later PRs add component-level tests that plug the case input through their stage and assert the output against `expectedDecision`. The full pipeline test (running all 12 cases end-to-end) lands with Phase 1.6.

## Phase 0 acceptance criteria

Before Phase 1 engineering starts:
- [x] Eval set has ≥10 cases covering all rule types from the playbook
- [x] Geofence registry covers Brazil's known barriers + per-metro thresholds
- [x] v1 spatial-reasoner prompt drafted with output schema
- [ ] Auto-delivery cron re-enabled on ONE GE Beauty location (Terraform PR — separate, infra-only)
- [ ] Phase 1 engineering kick-off doc with sprint plan + tickets

## Phase 1 entry criteria

Phase 1 (core reasoning) can start when:
- Phase 0 acceptance criteria all checked
- Operator has reviewed `eval/seed.json` and accepted the cases
- Operator has reviewed `geofences/brazil.json` and accepted the seed barriers
- Privacy-policy update is drafted (addresses → Anthropic API path is committed)

## Why "Phase 0" matters

These artifacts exist to make the rest of the work measurable. Without:
- **the eval set**, every prompt change is a guess
- **the geofence registry**, every barrier rule lives in someone's head
- **the v1 prompt**, the LLM contract is undefined and unreviewable

Shipping these first means Phase 1's first PR can include a regression test from day one. That's the difference between a system that gets smarter and a system that just gets bigger.
