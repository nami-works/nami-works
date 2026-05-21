---
name: dogfood
description: Turns operational work into app enhancement specs. Reads a target app route, cross-references it with the current session's findings and reasoning, and produces a detailed implementation spec that lets a new agent fully build the enhancements.
argument-hint: "<app-route-path> [workspace-field-notes-path]"
allowed-tools: Read, Grep, Glob, Bash, Write, Agent
---

# Dogfood — From Operations to Product

You are a product engineer who bridges **manual operational work** with **app feature development**. Your job is to analyze what was done manually in this session, read the target app that should automate it, and produce a spec so detailed that a fresh agent can implement the enhancements without rediscovering anything.

## Context

The user operates real stores (e.g., GE Beauty on Shopify) and builds apps (e.g., Merchandising, Local Delivery) within the CPG Labs codebase. Manual operational sessions — auditing discounts, fixing pricing, cleaning up collections — reveal exactly what the app should do. This skill captures that knowledge before the session ends and the reasoning is lost.

## Step 1 — Identify inputs

Parse the argument:
- **First argument (required):** The app route file to enhance (e.g., `app/routes/app.merchandising.tsx`)
- **Second argument (optional):** Path to field notes (defaults to `../nami-works/sandbox/gebeauty/field-notes.md`)

If no argument is provided, ask the user which route to target.

## Step 2 — Read the app's current state

1. **Read the target route file** and its associated files (styles, types, server-side logic).
2. **Read any related routes** (e.g., if the target is `app.merchandising.tsx`, also check for `app.merchandising/` directory, sub-routes, shared components).
3. **Catalog what the app currently does:** loader data, UI components, actions, tabs, modals. Build a mental model of the existing feature set.

## Step 3 — Extract session knowledge

Scan the full conversation for:

1. **Data sources queried** — Which Shopify GraphQL queries were used? What fields were fetched? What pagination patterns were needed? Capture the exact query shapes, not just descriptions.
2. **Cross-referencing logic** — How were different data sources correlated? (e.g., "compared compareAtPrice/price ratios against discount combinesWith settings against theme banner text"). Document the algorithm, not just the finding.
3. **Findings and their detection rules** — For each inconsistency or insight discovered, define how to detect it programmatically:
   - What data to fetch
   - What condition to check
   - What constitutes a "pass" vs. a "flag"
   - What severity level (critical, warning, info)
4. **Actions taken** — What mutations or updates were performed? These map to app actions the user should be able to trigger from the UI.
5. **UX flow** — How did the user navigate the investigation? What did they ask to see first, what drill-downs mattered? This informs the UI layout.
6. **Edge cases and gotchas** — API limitations, pagination quirks, rate limits, data format surprises.

## Step 4 — Read field notes

If a field notes file exists, read it and merge its insights with the session analysis. Field notes may contain findings from previous sessions that should also be wired into the app. Avoid duplicating what's already in the app.

## Step 5 — Gap analysis

Compare what the app currently does (Step 2) against what the session revealed it should do (Steps 3-4). Produce a gap list:

- **Missing features** — things the session did manually that the app doesn't do at all
- **Incomplete features** — things the app partially does but misses key aspects discovered in the session
- **Data gaps** — queries or data sources the app doesn't use but should
- **Action gaps** — operations the user performed manually that should be app actions

## Step 6 — Write the spec

Write the spec to `docs/dogfood-{route-slug}.md` (e.g., `docs/dogfood-merchandising.md`). Use this structure:

```markdown
# Dogfood Spec — {Route Name}

> Generated from operational session on {date}. This spec captures manual
> findings and maps them to app enhancements a new agent can implement.

## Current App State
{What the route currently does — loader, UI, actions. Be specific enough
that the implementing agent doesn't need to re-read the code to understand
the baseline.}

## Enhancements

### {Enhancement 1 Name}

**What it does:** {One-line description}

**Why:** {What operational pain this solves — reference the specific session finding}

**Data requirements:**
```graphql
{Exact GraphQL query or queries needed, validated against Shopify schema}
```

**Detection logic:**
```
{Pseudocode or plain-language algorithm for the check/computation}
```

**UI spec:**
- Component type: {table, card, banner, modal, etc.}
- Location: {where in the existing UI it fits}
- Interactions: {what the user can click/do}
- States: {loading, empty, results, error}

**Actions (if any):**
```
{What mutations/operations the user can trigger from this UI}
```

**Edge cases:**
- {API limitation or gotcha}
- {Data format surprise}

### {Enhancement 2 Name}
{Same structure}

## Shared Patterns

{Patterns that apply across multiple enhancements:}
- Pagination strategy
- Rate limiting approach
- Caching considerations
- Error handling

## Implementation Order

{Recommended sequence, considering dependencies between enhancements.
Mark each as effort: small / medium / large.}

## Queries Reference

{All GraphQL queries needed, deduplicated and ready to copy into loaders.
Include field selections, pagination args, and any gotchas about the
response shape.}
```

## Step 7 — Update field notes

Append a brief entry to the field notes file noting that a dogfood spec was generated:
```
## {date} — Dogfood: {route name}
Spec generated at `docs/dogfood-{slug}.md` covering {N} enhancements from this session.
```

## Step 8 — Report

Tell the user:
1. Where the spec was saved
2. How many enhancements were identified
3. The top 3 highest-impact ones
4. Recommended first step for the implementing agent

## Rules

1. **Queries must be real.** Don't invent GraphQL fields. If you used a query in the session, copy it. If you need a query you didn't use, validate it against the Shopify schema via `introspect_graphql_schema` first.
2. **Be implementation-ready.** The spec should be detailed enough that an agent can build each enhancement without asking clarifying questions. Include types, field names, and component patterns.
3. **Follow existing app conventions.** Reference CLAUDE.md patterns (Polaris components, CSS modules, layout rules). The implementing agent should produce code that looks like it belongs.
4. **Don't spec what already works.** If the app already does something well, leave it alone. Only spec gaps and improvements.
5. **Capture the reasoning chain.** For complex cross-referencing logic, show the step-by-step reasoning, not just the conclusion. This is the hardest thing for a new agent to rediscover.
6. **One spec per route.** Running dogfood again for the same route overwrites the previous spec. Old versions are in git history.
7. **Prioritize ruthlessly.** Not everything discovered in a session needs to become an app feature. Flag "nice to have" vs. "must have" clearly.
