# Operator-Grounded Optimizer Iteration Blueprint

## 0. Strategic frame

The core problem: the optimizer is the product surface that determines merchant trust, but it's been improved through ad-hoc inspection rather than a structured loop. The result is a system that's "good enough most of the time" but fails predictably under conditions the operator can name (corridor crossings, mall surcharges, time-of-day pricing, capacity overflow) that the optimizer can't.

The fix is not to rewrite the optimizer in one pass. The fix is to install a feedback loop that converts each operational failure into a tracked defect, ships a flag-gated fix, validates against real dispatches, and promotes to default. Over weeks, the optimizer encodes the operator's expertise. Over months, it surpasses it. Over quarters, it ships to other merchants who never had to learn what the operator learned the hard way.

Every component below exists to support that loop and nothing else.

---

## 1. End state

A Shopify app whose **auto-delivery cron** runs end-to-end without operator intervention: pulls eligible orders, clusters them with full cost-aware optimization, dispatches via Lalamove, monitors driver progress, archives tags on completion, fulfills orders in Shopify, surfaces only true exceptions for human review. Per-store configuration handles the operationally meaningful constraints (per-route fees, time-of-day pricing, forbidden corridors, vehicle capacity, special requests). New merchants onboarding inherit the encoded expertise — they enable auto-delivery in their store config and dispatches happen without them learning the operational nuances the founding operator learned the hard way.

The cron is the **destination**, not a thing to remove. Today it's premature because the optimizer doesn't yet encode enough operator judgment to be trusted unattended. The iteration loop's job is to ship one defect fix at a time until the operator's tweak rate on auto-cron output approaches zero. At that point the cron is the product.

The defect backlog (GitHub Issues) is the canonical record of every gap between the optimizer's behavior and operational reality. Closed issues are the changelog of operational knowledge becoming product behavior — and equivalently, the changelog of human-in-the-loop steps becoming machine-trusted.

---

## 2. The iteration cycle

```
   real-world dispatch   ──► outcome
            │                  │
            │           good ──┴── bad
            │                       │
            │                       ▼
            │             end-of-day feedback
            │             (operator + Claude)
            │                       │
            │                       ▼
            │             defect filed (GH Issue)
            │             with structured log evidence
            │                       │
            │                       ▼
            │             prioritize by frequency × severity × ease
            │                       │
            │                       ▼
            │             branch + flag-gated fix
            │                       │
            │                       ▼
            │             replay against historical batches
            │             (last N days at the operator's location)
            │                       │
            │                       ▼
            │             flag-on for one tenant in production
            │                       │
            │                       ▼
            │             3-7 day soak
            │                       │
            │                       ▼
            │             flag-on by default for all tenants
            │                       │
            └───────────────────────┴──► loop
```

No defect bypasses the loop. No fix lands without a flag. No flag promotes without soak. Discipline is the entire moat.

---

## 3. Telemetry layer

The substrate. Without structured, queryable logs, the feedback step requires the operator to answer questions whose answers should already be in CloudWatch. This is the first thing to build.

### 3.1 Events that must be structured JSON

Every load-bearing event in the optimize → dispatch → fulfillment chain must emit a single-line JSON record with a stable schema. Use `pino` (or whatever logger is already in place) with `info` level for normal events, `warn` for degraded paths, `error` for failures.

| Event | Where it lives | Required fields |
|---|---|---|
| `optimize.started` | `handleOptimize` entry | `tenant`, `locationId`, `requestId`, `maxPerRoute`, `flagAddressIssues` |
| `optimize.eligible_orders` | After fetch | `tenant`, `locationId`, `requestId`, `orderCount`, `orderIds`, `excludedReasons` (object: `noLocal`, `noCoords`, `addressReview`, `alreadyRouted` counts) |
| `optimize.candidate_evaluated` | Inside cluster trial loop | `tenant`, `locationId`, `requestId`, `routeCount`, `partitionKey` (hash), `totalCostSubunits`, `currency`, `vehicleType` |
| `optimize.result` | After best partition picked | `tenant`, `locationId`, `requestId`, `routes` (array of `{slot, orderIds, costSubunits}`), `totalCostSubunits`, `flaggedOrderIds`, `elapsedMs` |
| `tweak.tag_changed` | Wherever `ld_rota-NN` is added/removed | `tenant`, `orderId`, `orderName`, `tagsAdded`, `tagsRemoved`, `actor` (`user` \| `auto-routing` \| `optimize` \| `archive`), `requestId` |
| `dispatch.created` | After Lalamove order created | `tenant`, `locationId`, `requestId`, `slot`, `orderIds`, `lalamoveOrderId`, `costSubunits`, `currency`, `serviceType` |
| `dispatch.error` | On Lalamove failure | `tenant`, `locationId`, `requestId`, `slot`, `errorCode`, `errorMessage`, `payload` (sanitized) |
| `dispatch.status_changed` | Webhook handler | `tenant`, `lalamoveOrderId`, `previousStatus`, `newStatus`, `at` |
| `pod.recorded` | Per-stop POD ingest | `tenant`, `lalamoveOrderId`, `stopIndex`, `orderId`, `outcome` (`DELIVERED` \| `FAILED` \| `PENDING`), `failureReason`, `proofUrl` |
| `archive.tags_renamed` | After COMPLETED webhook | `tenant`, `orderIds`, `oldTags`, `newTags` |
| `fulfillment.created` | After `fulfillmentCreateV2` | `tenant`, `orderId`, `fulfillmentId`, `notifyCustomer`, `cause` (`auto` \| `manual`) |

### 3.2 CloudWatch configuration

- **Log group**: one per environment (`/cpg-labs/prod`, `/cpg-labs/staging`). All app instances write here.
- **Retention**: 90 days minimum. Defects often surface days after the dispatch.
- **Streams**: per-instance. Filter by `tenant` field at query time.
- **Region**: same as the rest of the infrastructure (likely `us-east-1`).
- **IAM**: a read-only role (`cpg-labs-feedback-reader`) with `logs:FilterLogEvents` and `logs:GetLogEvents` on the prod log group. The feedback CLI assumes this role.

### 3.3 Audit checklist (first day's work)

1. Read every log statement in `app/services/carrier-quotation-optimizer.server.ts`, `app/services/lalamove.server.ts`, `app/services/lalamove-sync.server.ts`, `app/routes/api.control.$intent.tsx`, `app/routes/webhooks.lalamove.tsx`. Mark each as either:
   - **structured** (JSON object passed to `logger.info`)
   - **stringy** (template literal with interpolations)
2. Convert every stringy log on the critical path to structured JSON matching §3.1.
3. Add missing events from §3.1 that don't exist yet.
4. Add a `requestId` thread-local (or pass through explicitly) so all events from one optimize→dispatch can be joined in queries.
5. Land as one PR titled `chore(telemetry): structured logging for optimizer pipeline`. No behavior changes.

---

## 4. Feedback CLI

Lives in the repo. Never deployed. Operator-only tool that runs locally.

### 4.1 File layout

```
scripts/feedback/
├── package.json           # if scripts dir doesn't already have one; share with parent otherwise
├── cli.ts                 # entrypoint, parseArgs, subcommand dispatch
├── cloudwatch.ts          # AWS SDK wrapper, FilterLogEvents queries
├── correlate.ts           # given (date, locationId, freeText): assemble timeline
├── draft.ts               # markdown issue body builder, seeded with log evidence
├── file.ts                # gh CLI wrapper for issue creation
├── prompts/
│   └── classify-defect.ts # Anthropic SDK call to classify the defect into a label set
├── README.md              # how to run + auth setup
└── templates/
    └── issue.md           # markdown template for new issues
```

If the existing repo has a `scripts/` convention, slot in there. If not, create it as a sibling to `app/`. Critically: the CLI must NOT be imported by any code in `app/`. Bundlers and CI must treat it as out-of-tree.

### 4.2 Commands

```bash
# Interactive defect filing — the daily driver
nami feedback

# Direct log query
nami logs --since "24h" --tenant gebeauty --filter "optimize|dispatch" --tail

# Build a full timeline for one batch and print as markdown
nami timeline --tenant gebeauty --location 97784398144 --date 2026-05-01

# Draft an issue from a free-text complaint without filing
nami draft --tenant gebeauty --since "today" --about "route 2 crossed the river"

# File a previously-drafted issue (after operator review)
nami file --draft .feedback/draft-2026-05-01.md
```

### 4.3 Interaction pattern (the daily 5-minute loop)

```
   Operator: "Today's RioSul route went over the bridge to Niterói and back.
              Should have split into 2 routes."

   Claude:   [runs `nami timeline --tenant gebeauty --location 101298569536 --date today`]
             [parses optimize.result + dispatch.created events]
             [identifies the route in question by orderIds + costSubunits]
             [computes the polyline path between stops]
             [confirms bridge crossing via geometry check]

             "Found it: 2026-05-01 RioSul ld_rota-02, 5 stops, 2 in Niterói.
              Optimizer scored a single 5-stop route at R$58 (winning the
              cost objective) vs hypothetical 3+2 split at R$36+R$42=R$78.
              Cost-only objective picked cheaper option that's operationally
              worse because of the bridge.

              Defect class: 'cost objective ignores corridor crossings'.
              Backlog already has 3 similar tagged water-barrier.

              Draft attached. File as cpg-labs#?"

             [shows draft markdown — see §4.4]

   Operator: y

   Claude:   [runs `nami file --draft ...`]
             "filed cpg-labs#247. backlog now has 4 water-barrier defects —
              top theme by frequency."
```

The structure forces evidence in the issue body. The operator confirms before filing. The classification (the label) is set by Claude based on the timeline and the operator's free text.

### 4.4 Issue template (`templates/issue.md`)

````markdown
## Summary
{{operator_complaint_one_liner}}

## Defect class
{{label}}  ({{rank_in_backlog}} occurrence)

## Evidence
**When**: {{date}}, {{tenant}}, {{location_name}}
**Route**: {{route_tag}} ({{stop_count}} stops)
**Optimizer cost**: R$ {{optimizer_cost}}
**Hypothetical alternative**: {{alternative_summary}} → R$ {{alternative_cost}}

### Stops
| # | Order | City | Coordinates |
|---|---|---|---|
{{stops_table}}

### Optimizer log lines
```
{{raw_log_excerpt}}
```

### Operator notes
{{operator_freeform}}

## Proposed fix direction
{{claude_fix_sketch}}

## Acceptance criteria
- [ ] {{specific_check_1}}
- [ ] {{specific_check_2}}
- [ ] No regression on {{related_test_set}}

---
filed by `nami feedback` from CloudWatch evidence
````

### 4.5 Defect labels (controlled vocabulary)

Start with these. Add only when a new pattern recurs ≥3 times.

- `water-barrier` — corridor/river/highway crossings the optimizer should avoid
- `capacity-overflow` — routes exceed operator's per-driver cap
- `time-of-day` — pricing window not respected
- `per-route-fee` — fixed fees per dispatch not in cost calculation
- `address-issue` — geocoder accepted a clearly bad address
- `service-type` — wrong vehicle picked (LALAGO vs CAR vs MOTOTAXI)
- `clustering-incoherent` — neighboring stops put in different routes
- `directional-isolation` — far outlier sharing a route with a tight cluster
- `archive-stuck` — Lalamove COMPLETED but Shopify tags not archived
- `pod-mismatch` — route-level COMPLETED hides per-stop FAILED

### 4.6 AWS auth

Operator runs `aws sso login` once with a profile that can assume `cpg-labs-feedback-reader`. The CLI reads from `AWS_PROFILE` env var. No credentials in code, no credentials in repo.

### 4.7 GitHub auth

Operator already has `gh` authenticated to the repo. The CLI shells out to `gh issue create` with the body from §4.4. No PAT in code.

---

## 5. Defect-fix workflow

### 5.1 Prioritization

Pick the next defect to fix using:

```
score = frequency × severity × ease

frequency: count of issues with the same label in the last 30 days
severity:  1 (cosmetic) → 5 (mis-charges merchant or customer)
ease:      5 (single-file change) → 1 (architectural)
```

Highest score wins. Tie-break by oldest issue.

### 5.2 Branch + flag

Branch name: `fix/optimizer-{label}-{issue-number}` (e.g., `fix/optimizer-water-barrier-247`).

Every behavior change goes behind a feature flag. The flag system already in the repo is the source of truth. If there isn't one yet, the first PR adds one — minimal: a Prisma `FeatureFlag` model `{tenantId, name, enabled}`, an `isFeatureEnabled(tenantId, name)` helper, and a `app.flags` admin route to flip per-tenant.

Flag naming: `optimizer.{label}.{descriptor}` e.g. `optimizer.water-barrier.crossing-penalty`.

### 5.3 Replay against historical

Every fix PR includes a unit test that loads ≥3 historical batches that triggered the defect (orderIds frozen as fixtures from CloudWatch evidence) and asserts the new optimizer produces the operator-preferred clustering on each.

The fixtures live at `tests/fixtures/optimizer/{label}/{batch-id}.json` containing the orders, coordinates, location config. Generated by a one-shot script `scripts/feedback/freeze-fixture.ts --batch-id ... --label ...`.

### 5.4 Soak

Flag-on for one tenant (gebeauty initially) in production for 3-7 days. During soak:

- The feedback CLI tags any new issues against `optimizer.{label}.*` flag with the flag name in the issue body.
- A daily job (`scripts/feedback/soak-report.ts`) prints: number of dispatches under the flag, defect issues filed during soak referencing the flag, comparison cost vs prior 7-day baseline.
- If new defects surface during soak: the flag stays on (don't promote, don't roll back) until the new defect is fixed and flag-gated. Two flags can soak simultaneously if they don't interact.

### 5.5 Promotion

After clean soak:

- Flip the default in `isFeatureEnabled` for that flag from `false` → `true`.
- Keep the flag for 30 days as an emergency rollback knob.
- Close the issue with a one-line summary and the soak report linked.

---

## 6. Day-to-day operator rhythm

```
   Morning           Mid-day               Late afternoon
   ───────           ───────               ──────────────
   optimize          monitor active        close routes
   tweak (if any)    dispatches            mark fulfilled
   dispatch          reorder if stuck      pod_summary
                                           fulfill_digest
                                                │
                                                ▼
                                           5-minute feedback
                                           (1-3 free-text
                                            complaints to Claude)
                                                │
                                                ▼
                                           N issues filed
```

Weekly cadence (any day works, prefer Friday):

```
   Pick top defect ─► branch ─► fix ─► replay-test ─► soak-flag-on
                                                          │
                                                          ▼
                                                     monitor for 3-7 days
                                                          │
                                                          ▼
                                                     promote to default
                                                          │
                                                          ▼
                                                     close issue
```

---

## 7. The first defect (validation cycle)

Use the first week to validate the entire loop with a known case. Recommended: the bridge-crossing scenario from RioSul (or whichever similar incident is fresh from this week's ops).

### 7.1 End-to-end test, day-by-day

**Day 1**:
- Land the telemetry PR (§3.3).
- Verify CloudWatch is receiving structured events from prod within 1 hr of deploy.

**Day 2**:
- Build the feedback CLI scaffolding (§4.1, §4.2).
- Run `nami timeline` against a fresh dispatch to confirm it can join optimize → dispatch → fulfillment events by `requestId`.

**Day 3**:
- Operator dictates the bridge-crossing complaint to Claude.
- CLI assembles the timeline, drafts the issue, operator approves, issue is filed.
- This is the first end-to-end pass. Issue number documented.

**Day 4**:
- Branch the fix: water-barrier crossing penalty, flag-gated as `optimizer.water-barrier.crossing-penalty`.
- Add fixture from the filed issue, write a regression test that fails on `main` and passes on the branch.
- PR opened, reviewed, merged.

**Day 5**:
- Flag flipped on for gebeauty in prod.
- Daily soak report scheduled.

**Day 6-12**:
- Soak. Operator runs ops as normal.
- If clean: flag flipped to default-on for all tenants. Issue closed.
- If a new defect surfaces: file it, decide whether to keep soaking or roll back.

After this cycle, the loop is proven. Subsequent defects follow the same path with shorter elapsed time.

---

## 8. Anti-goals

What this plan deliberately avoids:

1. **No new UI in the merchant-facing Shopify app for feedback.** Anything that helps the operator capture defects lives in the CLI, not in the embedded admin UI. Merchants see only the optimizer's improved output.
2. **No annotation corpus stored separately.** The defect backlog (GH Issues) is the corpus. No parallel database of operator notes. If something is worth remembering, it's worth being a tracked issue.
3. **No parallel optimizer codebase.** The optimizer in `app/services/carrier-quotation-optimizer.server.ts` is the only optimizer. Improvements happen there. No fork, no shadow implementation.
4. **No "perfect first, ship later" temptation.** Every fix that takes longer than a week to ship gets broken into smaller defects that each ship in a week.
5. **No PM/triage meeting.** The defect backlog's prioritization formula (§5.1) decides what's next. The operator and Claude follow the formula.

---

## 9. Concrete week-1 deliverables

| Day | Deliverable | Acceptance |
|---|---|---|
| Mon | PR `chore(telemetry): structured logging for optimizer pipeline` | All §3.1 events emit JSON. CloudWatch FilterLogEvents query joins one optimize→dispatch chain by `requestId`. |
| Tue | PR `tooling: feedback CLI skeleton` (`nami logs`, `nami timeline`) | `nami timeline` reproduces yesterday's dispatch as a markdown report. |
| Wed | PR `tooling: feedback CLI draft + file` (`nami feedback`, `nami draft`, `nami file`) | Operator runs `nami feedback` end-to-end, files an issue with log evidence. |
| Thu | PR `feat: feature-flag scaffolding` (if absent) | Per-tenant flag table, helper, admin flip route. |
| Fri | PR `fix(optimizer): water-barrier crossing penalty (flag)` | Regression fixture passes, flag off by default. |
| Mon (wk 2) | Flag-on for gebeauty in prod | Soak report job emits daily. |

After these six PRs and one soak, the loop is operational and self-sustaining.

---

## 10. Appendix — reference artifacts the next session needs

These should be readily accessible to the next session that picks this up:

1. **CloudWatch log group name** + **AWS region** + **profile name** for read access.
2. **Repo's existing logger** (`pino`, `winston`, etc.) with current default formatter — to extend not replace.
3. **Existing feature-flag system if any** — naming conventions, where they're defined.
4. **Existing scripts directory convention** — does the repo use `scripts/`, `tools/`, `bin/`, or something else for non-deployed tooling.
5. **Anthropic SDK auth** — for `prompts/classify-defect.ts`. The classifier is a single Claude Haiku 4.5 call with the timeline + operator text → label.
6. **The 5-10 most-recent operational complaints from the operator** — to seed the first-week defect backlog. These can be summarized in chat at the start of the next session.

---

## 11. Success criteria (revisit at week 4)

Four weeks of running this loop. Measure:

- **Time-to-fix per defect** (filed → flag-on default). Target: ≤ 1 week per defect.
- **Defects filed per week**. Will start high (operator vents months of frustration), trend down as fixes ship.
- **Operator tweak rate** (% of optimize results that needed manual tweaking before dispatch). Should drop as fixes ship. **This is the autonomy gate** — see §12.
- **Multi-tenant readiness**: every fix shipped should already work for any tenant — no tenant-specific code paths.

If all four are improving, the loop works. If any aren't, the loop needs surgery — start with telemetry quality (are the logs actually capturing what the operator sees?) and prioritization (is the formula picking the right next defect?).

---

## 12. The autonomy gate

The auto-delivery cron exists today and writes tags without operator review. That's intentional — full automation is the product vision. But the cron's *trust level* per tenant must track the operator tweak rate.

Define three trust tiers per tenant:

| Tier | Cron behavior | Activation criterion |
|---|---|---|
| **Proposal** | Cron computes clustering and stores it as `pendingDeliveryRoute` with status=`proposed`. Operator must approve before tags get written. | Default for new tenants. |
| **Supervised** | Cron writes `ld_rota-NN` tags but does NOT dispatch. Operator reviews and clicks dispatch (or the cron auto-dispatches at a delayed `autoDispatchTime`). | Operator tweak rate < 30% over the last 14 days. |
| **Autonomous** | Cron writes tags AND dispatches via Lalamove without operator action. Operator only sees exception alerts (failed POD, address-flagged, mid-flight stalls). | Operator tweak rate < 5% over the last 30 days, AND no severity-5 defects filed in the last 14 days. |

Tier transitions are automatic based on the metric, but reversible — any new severity-4-or-above defect downgrades the tenant by one tier until the defect's flag promotes to default.

This makes the iteration loop directly responsible for autonomy: every defect closed moves the operator-tweak-rate needle, every needle drop earns the cron more trust. The blueprint isn't *also* about removing the operator — it *is* about removing the operator, one defect at a time.

---

## 13. Day-zero defect backlog

These are concrete, evidence-backed defects identified by a side-by-side audit of the cpg-labs optimization stack against a parallel cost-aware reference implementation. Each is ready to file as an Issue on day one. They are intentionally ordered by impact-and-ease, with the first defect being the largest unlock per line of code.

### 13.1 `optimize-cost-aware-everywhere`  (severity 5, ease 4)

**Summary.** The cost-aware optimization functions (`optimizeByCarrierQuotation`, `optimizeByVRP`, `addToExistingRoutesByCarrierQuotation`) exist in `app/services/carrier-quotation-optimizer.server.ts` and are invoked only from the embedded admin UI (`app/routes/app.local-delivery.tsx`). All programmatic call sites use the geometric-only `clusterOrders` instead. Result: clusterings produced by the CLI, the auto-delivery cron, and the auto-routing service minimize geometric distance but never consult Lalamove pricing — they cannot select the cheapest partition, cannot compare vehicle types, cannot apply special-request pricing.

**Evidence.**
- UI uses cost-aware: `app/routes/app.local-delivery.tsx:7223` (`optimizeByVRP`), `app/routes/app.local-delivery.tsx:7387` (`addToExistingRoutesByCarrierQuotation`)
- CLI uses geometric only: `app/routes/api.control.$intent.tsx:989` (`clusterOrders`)
- Auto-delivery cron uses geometric only: `app/routes/api.cron.auto-delivery.tsx:198` (`clusterOrders`)
- Auto-routing service uses geometric only: `app/services/auto-routing.server.ts:433` (`clusterOrders`)

**Concrete impact.** When the cost-aware optimizer runs Phase A, it tries multiple route counts (k = 1, 2, 3, …), quotes each candidate via Lalamove, and picks the cheapest. Geometric-only clustering picks one fixed `routeCount = ceil(orders / TARGET_PER_ROUTE)` and stops. For a batch of 16 orders with one outlier 8km from the cluster center, geometric clustering makes a 4-stop route plus a 1-stop "loner" route. Cost-aware clustering recognizes that the loner's quote (R$ 35) plus a 3+5+4 partition costs less than the 4+1+5+6 partition with the loner accounted for. The geometric path can be ~15-30% more expensive on imbalanced batches, and the CLI/cron paths are where the bulk of optimization decisions are made.

**Proposed fix direction.** Replace each of the three `clusterOrders` call sites with `optimizeByCarrierQuotation`. The function signature accepts `(orders, lalamoveConfig, lalamoveCredentials, maxAvailableRoutes, vehicleOptions, maxOrdersPerRoute, specialRequests?)`. Wire credentials from the same source the dispatch path uses. Plumb `vehicleOptions` and `specialRequests` from `LalamoveConfig`/`CarrierServiceConfigData` (see 13.4 + 13.5 below). Behind a flag `optimizer.cost-aware.programmatic-paths` so it can soak on one tenant before defaulting on.

**Acceptance criteria.**
- [ ] All three programmatic call sites invoke `optimizeByCarrierQuotation` (or `optimizeByVRP` if a clear reason to prefer it).
- [ ] Regression fixtures (≥ 3 historical batches) prove the new path produces the operator-preferred clustering, with cost reductions logged.
- [ ] Flag-off path (legacy geometric clustering) preserved for emergency rollback during the 30-day grace window.
- [ ] CloudWatch shows `optimize.candidate_evaluated` events firing per partition trial in the new path.

---

### 13.2 `auto-delivery-cron-violates-7-stop-cap`  (severity 4, ease 5)

**Summary.** The auto-delivery cron hardcodes `maxPerRoute = 10` when calling `clusterOrders`. The operator's documented hard cap is 7 (single-driver carrying capacity). The optimizer's own constants file declares `MAX_STOPS_PER_ROUTE = 7`. The cron silently produces routes with 8-10 stops on high-volume days, which the operator then has to manually split.

**Evidence.**
- Hardcoded value: `app/routes/api.cron.auto-delivery.tsx:198` — `clusterOrders(optimizerOrders, routeCount, 10)`
- Optimizer constant: `app/services/carrier-quotation-optimizer.server.ts` — `const MAX_STOPS_PER_ROUTE = 7`
- Operator memory record: `feedback_max_orders_per_route.md` (referenced in cpg-labs source comments)

**Proposed fix direction.** Replace `10` with `config.lalamoveMaxOrdersPerRoute ?? MAX_STOPS_PER_ROUTE`. Read from per-tenant `LalamoveConfig` so each merchant can tune their driver capacity. Default to 7. No flag needed — this is a constraint correctness fix, low risk.

**Acceptance criteria.**
- [ ] No production cron run produces a route with > 7 stops.
- [ ] `LalamoveConfig` admin UI exposes `lalamoveMaxOrdersPerRoute` field (already in the schema).
- [ ] Migration backfills existing tenants to the 7 default.

---

### 13.3 `state-endpoint-stale-dispatch-metadata`  (severity 4, ease 3)

**Summary.** The `/api/control/state` endpoint returns `route.dispatch.status` and `route.dispatch.requestedAt` for each slot, even when the orders currently tagged with `ld_rota-NN` are different from the ones that were dispatched in the cached metadata. Concretely: yesterday's COMPLETED Lalamove order ID stays attached to the slot. When today's optimize re-uses the slot for a fresh order set, the state endpoint shows yesterday's `requestedAt` and `status: COMPLETED`. This caused live confusion today (2026-05-01) when fresh dispatches had to be confirmed against a state that lied about being already-dispatched.

**Evidence.**
- Reproduced in conversation: state for SP slot 0 returned `requestedAt: 2026-04-30T20:08:54.963Z`, `status: COMPLETED` after fresh optimize moved new orders into the slot.
- Same on PE slot 0 and RJ slots 0+1 — every slot reflected yesterday's metadata.

**Proposed fix direction.** Two options:
1. **Invalidate slot metadata on tag change.** When `ld_rota-NN` is added to or removed from any order, clear the cached `dispatch` object on that slot. Forces state to either return null (slot is fresh) or fetch live from Lalamove.
2. **Move dispatch metadata to a `Dispatch` table** keyed by `lalamoveOrderId` with explicit `orderIds[]` snapshot. State queries the latest `Dispatch` row whose `orderIds` exactly matches the current tag-grouped order set; if no match, slot is fresh.

Option 2 is more correct and unlocks better audit (we can show full dispatch history per slot). Option 1 is faster to ship.

**Acceptance criteria.**
- [ ] State for a slot whose order set differs from any historical dispatch returns `dispatch: null` (slot is fresh).
- [ ] State for a slot whose orders match a prior dispatch returns that dispatch's metadata.
- [ ] Refresh by `lalamoveOrderId` from Lalamove is on-demand via `--live`, not cached against the slot.

---

### 13.4 `cli-and-cron-no-vehicle-comparison`  (severity 3, ease 5, depends on 13.1)

**Summary.** Once 13.1 lands, the cost-aware optimizer can compare primary and secondary vehicle types per partition. But the programmatic call sites currently don't construct the `vehicleOptions` argument. The function would default to a single vehicle type from config. We lose the LALAGO-vs-CAR cost comparison that the UI path enjoys.

**Evidence.**
- `LalamoveConfig` already has `preferredServiceType` (primary) and `CarrierServiceConfigData` has `lalamoveSecondaryServiceType`. Both fields are populated in production.
- `optimizeByCarrierQuotation` accepts `vehicleOptions: { primary: string; secondary?: string }` and quotes both.

**Proposed fix direction.** Pass `{ primary: config.preferredServiceType, secondary: carrierConfig.lalamoveSecondaryServiceType }` from each programmatic call site. Already plumbed through the UI path — same pattern.

**Acceptance criteria.**
- [ ] When both primary and secondary are configured, optimizer logs show quotes against both vehicle types.
- [ ] Cheapest-of-both is selected per cluster.

---

### 13.5 `cli-and-cron-no-special-requests`  (severity 3, ease 5, depends on 13.1)

**Summary.** Same shape as 13.4. The cost-aware optimizer accepts an optional `specialRequests?: string[]` (e.g., `DOOR_TO_DOOR` for São Paulo deliveries). `CarrierServiceConfigData.lalamoveSpecialRequests` is a per-market record (e.g., `{ "BR_SAO": ["DOOR_TO_DOOR"] }`). The UI path passes them through; programmatic paths don't.

**Proposed fix direction.** At each programmatic call site, look up the special requests for the location's market and pass them as the seventh argument.

**Acceptance criteria.**
- [ ] When `lalamoveSpecialRequests[market]` is non-empty, the array is passed through to every Lalamove quote call.
- [ ] Quotes reflect the special-request pricing surcharge where applicable.

---

### 13.6 `optimization-paths-divergent`  (severity 3, ease 2)

**Summary.** Even after 13.1 + 13.4 + 13.5 ship, cpg-labs will still have two parallel optimization code paths: the UI's `optimizeByVRP` lineage and the programmatic `optimizeByCarrierQuotation` lineage. They share most logic but diverge at edges (e.g., VRP uses Google Routes; CQ uses Lalamove pricing only). Operators get different clusterings depending on which path runs. Long-term: collapse to one.

**Proposed fix direction.** Audit the difference between `optimizeByVRP` and `optimizeByCarrierQuotation`. Pick one. Migrate the other path's callers. Remove the loser. This is a ~2-week project, not a single PR — file as an epic with sub-issues. Don't block the day-zero work on it.

**Acceptance criteria.**
- [ ] Single optimization function across all call sites.
- [ ] No call site imports both functions.
- [ ] Removed function fully deleted from the codebase.

---

### 13.7 `hardcoded-constants-instead-of-config`  (severity 2, ease 4)

**Summary.** Multiple constants are hardcoded across the codebase that should live in per-tenant config so each merchant can tune them: `CLAUDE_OPTIMIZE_MAX_ROUTES = 20`, `CLAUDE_OPTIMIZE_TARGET_PER_ROUTE = 5`, the `10` from 13.2, the various detour/proximity thresholds in the optimizer. As long as gebeauty is the only tenant they're invisible; they become hostile defaults the moment a second tenant has different operational shape (different driver capacity, different fleet density, different city geography).

**Proposed fix direction.** Move each constant into a `OptimizerTuning` record on `LalamoveConfig` (or `CarrierServiceConfigData`). Defaults preserved as code-level constants but read from config first. Admin UI surfaces them under an "Advanced" section per location.

**Acceptance criteria.**
- [ ] Every numeric tuning parameter readable per-tenant from config.
- [ ] Defaults match today's hardcoded values to avoid behavior change for existing tenants.
- [ ] Admin UI exposes the fields with sensible inline help text.

---

### 13.8 `mark-delivered-treats-failed-stops-as-delivered`  (severity 5, ease 3)

**Summary.** `handleMarkDelivered` operates on a whole route as one indivisible unit. It marks every order in the route as DELIVERED in Shopify, regardless of per-stop POD outcome. When a 5-stop route has 4 DELIVERED + 1 FAILED, the function still creates a `fulfillmentCreateV2` + DELIVERED event for the failed customer. Customer receives a "your order has been delivered" email for an order they never got, the failure is hidden from any reporting, and the order is closed against re-dispatch. This caused the Yasmin #78301 incident and is the primary trigger for the `pod-mismatch` defect class.

The inverse case (Beatriz #77793) is also unhandled: an order physically delivered by the driver but stuck UNFULFILLED in Shopify because the route-level COMPLETED never propagated cleanly. There's no surgical "this one stop was actually delivered" endpoint for operator overrides — the only mark-delivered path is the route-level batch, which can't be invoked for already-archived dispatches.

**Evidence.**
- Route-level treatment: `app/routes/api.control.$intent.tsx` `handleMarkDelivered` lines ~1181-1430 — fulfillment is created for every `shopifyOrderId` in `lalamoveDispatchOrderMap`, no per-stop POD branching.
- Per-stop POD data exists in the state response: `state.routes[].dispatch.stops[]` includes per-stop outcome per the dispatch tracking flow.
- Yasmin #78301 incident: route reported route-level COMPLETED, one stop's POD was FAILED, customer got a DELIVERED email anyway.
- Beatriz #77793 incident: order physically delivered but stuck UNFULFILLED, keeps re-clustering into new routes daily.

**Concrete impact.** Every mixed-POD route silently mis-fulfills the failed stops. On gebeauty's volume that's roughly 1-3 incidents per week, each one requiring manual customer apology, refund processing, and re-dispatch reconciliation. At multi-tenant scale this becomes catastrophic — merchants will lose trust the first time a customer screenshots the "Delivered" email next to an empty doorstep.

**Sub-defect: DELIVERED status not reliably reaching Shopify.** Even on clean-bucket routes where the function "succeeds," the order's `fulfillment.displayStatus` often remains `FULFILLED` (or whatever the prior state was) instead of progressing to `DELIVERED`. Operators see "Fulfilled" in the order list view; customers see "Fulfilled" on the order-status page; the Shopify timeline may show a DELIVERED event entry but the headline status doesn't reflect it. Several causes coexist in the current code:

1. **The DELIVERED event call's return value is ignored at the call site.** [api.control.$intent.tsx:1417](../cpg-labs/app/routes/api.control.$intent.tsx#L1417): `await addDeliveredEvent(fulfillmentId, shopifyOrderId);` — `addDeliveredEvent` returns `false` on `userErrors`, but the caller does not check. `shopifyFulfilled` is incremented before the event call (line 1416), so the response shape says fulfillment succeeded even when the DELIVERED event failed. Same pattern at lines 1366-1369 for the existing-fulfillment branch.

2. **No post-write verification.** The function never re-queries the fulfillment after creating events. Shopify's `fulfillment.displayStatus` is derived from the latest `FulfillmentEvent` and from carrier integration signals — creating an event with `status: DELIVERED` does not always flip `displayStatus` to `DELIVERED`. Without post-write inspection, the function reports `ok: true` regardless.

3. **Shopify event-status state machine.** Shopify recognizes a chronological event sequence (`IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED`). A `DELIVERED` event with no preceding intermediate events is accepted by the API but may not always promote the displayStatus, depending on tracking-company integration and the order's existing event history.

4. **`fulfillmentFailures` accumulates DELIVERED-event errors silently.** When `addDeliveredEvent` returns `false` and pushes into `fulfillmentFailures`, those entries are returned in the response payload, but the headline `shopifyFulfilled` count overshadows them. Operators reading the response see "fulfilled 4/4" and assume completion. Combined with #1, the surfacing of partial-success failure modes is broken.

**Proposed fix direction.**

Add per-stop POD bucketing to `handleMarkDelivered`. The bucketing logic is operationally proven:

1. **Match Lalamove stops to Shopify orders.** Each `route.dispatch.stops[]` entry has a phone, name, and coordinates. Match against the route's `lalamoveDispatchOrderMap` rows by:
   - exact phone match (E.164-normalized) — strongest signal
   - fuzzy name match (lowercase, accent-stripped, last-name-priority) — secondary
   - coordinates within 50m — tertiary
   - first-stop heuristic (`stops[0]` is always pickup)
2. **Classify per-stop outcome** from POD signals (`POD_DELIVERED`, `POD_FAILED`, status `PENDING`, missing). Match the playbook taxonomy: `DELIVERED | FAILED | PENDING | MISSING`.
3. **Bucket the route**:
   - **clean** — all delivery stops DELIVERED → existing route-level fulfillment is correct
   - **mixed** — at least one FAILED → fulfill only DELIVERED orders, leave FAILED ones untouched in Shopify but tag with `ld_redelivery_pending` for operator review
   - **held** — at least one PENDING → return a HOLD response, do not fulfill yet, prompt operator to retry in 30-60 min
   - **skip** — no usable POD data → manual review, no writes
4. **Add `mark-stop-delivered` endpoint** for surgical per-order interventions. Body: `{ orderId, dispatchJobId? }`. Creates a Shopify fulfillment + DELIVERED event for that one order, no route-level state changes. Solves the Beatriz case.

The `pod_summary` and `fulfill_digest` patterns from the operator's existing tooling map directly to a service-layer port:

```ts
// app/services/pod-bucketing.server.ts (new file)
export type StopOutcome = "DELIVERED" | "FAILED" | "PENDING" | "MISSING";
export type RouteBucket = "clean" | "mixed" | "held" | "skip";

export function summarizeRoutePOD(route: StateRoute): Array<{
  stopIndex: number;
  orderId: string | null;
  orderName: string | null;
  outcome: StopOutcome;
  failureReason?: string;
}>;

export function bucketRouteForFulfillment(
  route: StateRoute,
  options?: { mixedThresholdMinutes?: number },
): {
  bucket: RouteBucket;
  ordersToFulfill: string[];
  ordersToHold: string[];
  ordersToRedeliver: string[];
};
```

Then `handleMarkDelivered` calls `bucketRouteForFulfillment` first and branches on the result.

Behind a flag `optimizer.mark-delivered.per-stop-bucketing` so it can soak on gebeauty before defaulting on. The existing route-level path stays as the flag-off behavior for emergency rollback.

**Acceptance criteria.**

- [ ] On a clean-bucket route, behavior is identical to today's intent: all orders fulfilled AND `fulfillment.displayStatus` reads `DELIVERED` post-write (verified by re-query).
- [ ] On a mixed-bucket route, only DELIVERED stops receive `fulfillmentCreateV2` + DELIVERED event; FAILED stops get `ld_redelivery_pending` tag and remain unfulfilled.
- [ ] On a held-bucket route, response is `{ ok: false, status: "held", retryAfter: <iso> }`, no Shopify writes performed.
- [ ] On a skip-bucket route, response is `{ ok: false, status: "manual-review" }` with the unmatched stop summary in the body.
- [ ] **DELIVERED status is verified post-write.** After `addDeliveredEvent`, re-query the fulfillment and confirm `displayStatus === "DELIVERED"`. If it didn't progress, retry the event sequence with explicit `IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED` chronology. If still not progressed after retry, log loudly and surface in `fulfillmentFailures`.
- [ ] **Return value of `addDeliveredEvent` is checked.** `shopifyFulfilled` only increments when the fulfillment AND the DELIVERED event both succeed. Partial-success cases produce response shape `{ shopifyFulfilled: N, deliveredEventsCreated: M }` where `M ≤ N`, with `fulfillmentFailures` containing the gap explanation.
- [ ] **Response payload exposes failure gap loudly.** When `shopifyFulfilled !== deliveredEventsCreated`, the response includes `partialDelivery: true` at the top level so operators (and any cron-trust gating) treat the dispatch as not-yet-confirmed-delivered.
- [ ] New `mark-stop-delivered` endpoint creates a single fulfillment + DELIVERED event for one order without touching any route-level state. Idempotent (re-running is a no-op if already at displayStatus DELIVERED).
- [ ] `notifyCustomer` policy honored per stop bucket: DELIVERED stops on a mixed route notify by default (operator preference per memory `feedback_fulfill_notify_default.md`); FAILED stops never notify; held bucket never sends any email.
- [ ] Regression fixture: load the Yasmin #78301 dispatch payload (4-of-5 DELIVERED + 1 FAILED), assert exactly 4 fulfillments created with `displayStatus === "DELIVERED"`, and 1 `ld_redelivery_pending` tag added, no DELIVERED email sent to the failed customer.
- [ ] Regression fixture: load the Beatriz #77793 case (route archived, one order stuck UNFULFILLED), assert `mark-stop-delivered` for that order creates the fulfillment cleanly AND `displayStatus === "DELIVERED"` is set.
- [ ] Regression fixture: load a clean route where prior runs of `addDeliveredEvent` silently failed (event userErrors logged but ignored), assert the new flow either succeeds outright or reports `partialDelivery: true` rather than declaring full success.

**Related operator memory for tuning.**

- `project_beatriz_77793_pending.md` — surgical-fulfill use case
- `feedback_fulfill_notify_default.md` — notify-customer default is ON for clean DELIVERED stops
- `feedback_route_maps_blocker.md` — visual map check is a hard blocker, applies pre-dispatch but the bucketing-then-mark-delivered flow should similarly never silently skip the per-stop check

---

### Day-zero filing order

| Order | Defect | Why first |
|---|---|---|
| 1 | 13.8 `mark-delivered-treats-failed-stops-as-delivered` | Highest severity (mis-fulfills failed stops, customer-facing reputational risk). Trumps optimizer work because dispatch outcomes are wrong even when clusterings are right. |
| 2 | 13.1 `optimize-cost-aware-everywhere` | Largest optimization unlock; everything in the optimizer track builds on it. |
| 3 | 13.2 `auto-delivery-cron-violates-7-stop-cap` | Trivial fix, immediate operator-pain reduction. |
| 4 | 13.3 `state-endpoint-stale-dispatch-metadata` | Caused real confusion today; blocks operator trust in state — and 13.8 depends on the state response being trustworthy. |
| 5 | 13.4 + 13.5 | Stack on top of 13.1 in the same PR or back-to-back. |
| 6 | 13.7 | Multi-tenant readiness; ship before second customer onboards. |
| 7 | 13.6 | Cleanup epic; runs in parallel with the main loop. |

After these are filed and the first four are flag-on for gebeauty, the iteration loop is operationally validated, the dispatch outcome surface is correct, and the optimizer is meaningfully closer to autonomous-cron-ready.

---

End of blueprint. Hand to next session in the cpg-labs repo with the §10 reference artifacts and the §7 first-defect choice locked in. The loop runs from day one.
