---
name: backlog-fit
description: Triage the backlog against THIS session's loaded context. Picks items that are cheap to tackle now (files, feature area, or external system already in head) and defers the rest. Use when the main task is winding down and you're deciding what to pull in next — never as a first task for a cold session.
argument-hint: "[optional: backlog file path — defaults to inputs/backlog.md]"
allowed-tools: Read, Grep, Glob, Bash
---

# Backlog-Fit Triage

A session's value-per-minute drops fast when it context-switches. This skill picks backlog items that ride on context this session already paid for, and defers everything else.

**Pull, don't push.** Output a recommendation; let the user say go. Never auto-start work.

---

## Step 1 — Context snapshot

Read in parallel, then write a 5–10 line snapshot at the top of your response:

```bash
git rev-parse --abbrev-ref HEAD
git diff --name-only main...HEAD
git log --since="3 hours ago" --oneline
```

From the diff + commits + conversation, name:
- **Feature area** (Local Delivery, Storytelling, Settings, …)
- **External systems touched** (Lalamove, Shopify GraphQL, Google Maps, …)
- **Concepts loaded** (route optimization, tag persistence, drilldown chart, …)

That's the "warm context." If you can't name a clear feature area, tell the user and stop — there's nothing to match against.

---

## Step 2 — Scan the backlog

Read `inputs/backlog.md` (or `$ARGUMENTS`). For each leaf bullet, check three things:

1. **File or feature heading matches** the warm context (same H1/H2, same route, same module).
2. **External system matches** (item mentions an API this session already called).
3. **Concept matches** (same data model, mutation, or business rule just engaged).

Anything that hits **at least one** is a candidate. Everything else is cold — skip it.

---

## Step 3 — Drop the candidates that need outside input

A candidate is **not actually cheap** if it:

- Asks for a redesign, new layout, or new component → route to `/design-engineer`.
- Uses a vague verb like "understand why X" or "rethink UX" → needs the user.
- Touches infra, deploy, Terraform, or cron schedule → defer to an infra session.
- Requires new credentials, OAuth scope, or external setup → defer to integrations work.
- Risks a destructive change (schema migration, mass tag rewrite, mutating dispatched routes) → confirm with the user separately.

What survives is tackle-now.

---

## Step 4 — Output

Keep it short. One response, this shape:

```
Context: <branch> · <feature area> · <key concepts>

Tackle now:
1. <heading path> — <one-line why cheap> (S/M effort)
2. ...

Bundle (optional): items 1+3 share <file> → one commit.

Defer:
- <heading path> — cold (<reason in 3 words>)
- ...

Recommend: <one sentence — which item or bundle to start with, or "nothing fits, wrap up">.
```

Cap **Tackle now** at 5 items. Cap **Defer** at ~8 (group long tails as "…and N others in <area>").

---

## Rules

- **One feature area per tackle-now list.** If candidates span two areas, pick the dominant one and defer the other — context-switching is exactly what this skill exists to prevent.
- **Each tackle-now item ships on its own branch** (or one shared branch for a bundle). Don't smuggle backlog items into the main task's PR.
- **Don't re-read every file the backlog references.** Score on heading + filename + verb. Only open a file if a candidate is ambiguous.
- **Stop after the output.** The user picks.

---

## After shipping a picked item

When a tackle-now item is shipped (committed + merged), **remove the bullet from `inputs/backlog.md`** in the same commit that ships the fix — or as a follow-up commit on the same branch before merging. If the parent heading becomes empty, remove the heading too.

This keeps the backlog a live "what's left" list, not an audit log. Git history is the audit log.
