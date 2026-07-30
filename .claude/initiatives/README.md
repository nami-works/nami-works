# Initiatives — Multi-Session Goal State

This folder is the **company Kanban above the PR layer**. One file per active, multi-session goal — bigger than a single PR, smaller than a full roadmap (typical span: days to weeks).

Sessions read every active initiative at start. They write back when they advance a phase or shift the blocker. This is how the through-line on long-running work survives session boundaries without Lucas having to carry it in his head.

---

## When to create an initiative

Create one when:
- The work spans more than a single session (typically > 1 day of total effort)
- Multiple specialists or sessions will contribute (e.g. `/integrations-engineer` builds, `/observability-engineer` adds alerts, `/tenant-onboarding-engineer` audits)
- There's a meaningful end state worth tracking ("App Store approved", "tenant #2 live", "LP campaign generating 10 leads/week")
- Forgetting where it stands between sessions would cost time or quality

Do NOT create one for:
- A single PR you're about to ship (just open the PR)
- An idea you might pursue someday (that's a backlog item, not an initiative)
- A one-shot operational task (issue credits, fulfill one order, send one email)

3-5 active initiatives at a time is healthy. More than that is a sign the system is trying to do too much.

---

## File schema

One markdown file per initiative at `.claude/initiatives/<slug>.md`. Slug is kebab-case, stable, and matches the customer-facing name when possible.

```yaml
---
id: <slug>                          # matches filename
name: <human-readable name>         # 5-10 words
owner: <cto | lucas | shared>       # who's accountable for next move
status: <backlog | in-progress | blocked | shipped | abandoned>
priority: <high | normal | low>
created: YYYY-MM-DD
target: YYYY-MM-DD | null           # soft target, not a contract
current_phase: <integer>-<slug>     # e.g. "3-credentials"
next_blocker: <one line>            # what's stopping the next move
next_owner: <skill-or-person>       # who should pick up — /integrations-engineer, /observability-engineer, lucas, customer, vendor
stakeholders:
  - <person or tenant>              # only when relevant
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why
<2-4 sentences: what changes when this ships, and why it matters now>

## Phases
- [x] 1. <phase> — done DATE
- [x] 2. <phase> — done DATE
- [ ] 3. <phase> — IN PROGRESS, owner: <X>
- [ ] 4. <phase>
- [ ] 5. <phase>

## Notes
<append-only log of decisions, gotchas, context that doesn't fit elsewhere — newest at top>

## Done means
<explicit acceptance criteria — the test the initiative passes to move to status: shipped>
```

---

## Session protocol

**At session start:**
1. List `.claude/initiatives/*.md`
2. Read each one's frontmatter (cheap)
3. Surface to Lucas in the opening message: *"3 active initiatives: A (blocked on X), B (next: /integrations-engineer), C (in progress, you own next move). Want to advance one or work on something else?"*
4. Don't auto-start work on an initiative without Lucas's say-so — the surface is informational.

**While working on an initiative:**
- Note what you're advancing in the relevant `## Notes` section as you go
- Don't update the frontmatter mid-flight; wait until the phase actually advances

**At session end (if you advanced an initiative):**
1. Update `current_phase`, `next_blocker`, `next_owner` in the frontmatter
2. Check off the phase in `## Phases` with today's date
3. Append a `## Notes` entry summarizing what shipped + why the next phase is owned by who it's owned by
4. If the initiative is now `shipped`: update status, leave the file in place for ~14 days, then archive to `.claude/initiatives/archived/` (don't delete — initiative history is useful)

**If an initiative is blocked on something only Lucas can resolve** (a contract decision, an account credential, a strategic call), set `next_owner: lucas` and surface it in the session-end summary. That's the signal that escalation is happening.

---

## Relationship to other coordination surfaces

| Surface | Scope | When to use |
|---|---|---|
| **Initiatives** (this folder) | Multi-session goals (days–weeks) | When the through-line matters |
| **Work orders** (`~/.claude/work-orders/`) | Single asks between sessions | "Session X, please do Y for me" |
| **PRs** | Single code change under review | The standard atomic unit |
| **Memory** (`~/.claude/projects/.../memory/`) | Durable facts and rules | Things true across all initiatives |

Initiatives reference the other surfaces by file path or PR number — don't duplicate state.

---

## Hard rules

1. **One file per initiative, frontmatter-first.** Sessions skim the frontmatter cheaply; the body is for context, not state.
2. **Update the file the same session you advance it.** Don't promise to update it later — by next session your context is gone.
3. **`next_owner` is always set.** If you don't know who picks up next, the initiative is unclear and probably shouldn't be active yet.
4. **Frontmatter dates are absolute** (YYYY-MM-DD). Never "next Tuesday" — that rots.
5. **No PII or secrets in initiative files.** They're checked into git. Reference SSM paths, 1Password items, or `sandbox/<tenant>/.env` files instead.
6. **Archive, don't delete.** Shipped/abandoned initiatives go to `archived/` after ~14 days for historical reference.

---

## Example: hypothetical tenant-onboarding initiative

See the schema above. A concrete instance might look like:

```yaml
---
id: tenant-acme-onboarding
name: Onboard ACME Skincare as tenant #2
owner: cto
status: blocked
priority: high
created: 2026-05-22
target: 2026-06-15
current_phase: 3-credentials
next_blocker: ACME hasn't sent their Shopify Partner credentials (asked 2026-05-20 via email)
next_owner: lucas
stakeholders:
  - ACME Skincare (customer)
  - Lucas (signed the contract)
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why
ACME is tenant #2 on Omnify (focused identity). Validates the multi-tenant ops story for the first time — proves we can onboard without it eating a week. Drives toward profitability target of 3 paying tenants by Q3.

## Phases
- [x] 1. Profile gathered — 2026-05-19
- [x] 2. Identity selected: `omnify` (focused) — 2026-05-19
- [ ] 3. Credentials bootstrap — BLOCKED on customer-provided keys
- [ ] 4. Install + scope grant
- [ ] 5. Project seed (locations, retail config)
- [ ] 6. Smoke test
- [ ] 7. Handover + memory write

## Notes
- 2026-05-22 — Lucas chased ACME for credentials; reply expected this week
- 2026-05-19 — ACME prefers `omnify` over `cpg-labs` (no delivery contracted, no Affiliates/Loyalty)

## Done means
- ACME's Shopify admin shows the embedded app loading clean (no blank install)
- Compliance webhooks return 200 to test pings
- Sandbox dev store smoke-test passes all Phase 6 checks
- `project_acme_tenant.md` exists in memory and MEMORY.md links to it
```

---

## Tooling (future)

Today the initiative system is purely file-based. Future additions when warranted:

- **SessionStart hook** that pretty-prints the active initiative board automatically
- **`/conductor` skill** that reads all initiatives and recommends which specialist to invoke for the next move
- **`/schedule` daily run** of `/conductor` to surface stale initiatives

These are not built yet — we road-test the file convention first, then layer automation only where it pays back.
