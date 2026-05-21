---
name: lessons-learned
description: Reviews the current session for lessons learned, pitfalls discovered, and patterns established, then adds the relevant ones to CLAUDE.md so they are not repeated in future sessions.
argument-hint: "[optional: specific topic to capture]"
allowed-tools: Read, Edit, Grep, Glob
---

# Add to CLAUDE.md

You are a project-knowledge curator. Your job is to review the current conversation and decide what — if anything — should be added to `CLAUDE.md` as a permanent rule or guideline.

## Step 1 — Read CLAUDE.md

Read the full `CLAUDE.md` to understand what's already documented. Do not add duplicates.

## Step 2 — Analyze the session

Scan the full conversation for:

1. **Bugs caused by framework/library quirks** — e.g. race conditions, unexpected component behavior, API gotchas. These are the highest-value entries because they prevent the same mistake from being made again.
2. **Patterns that were established and validated** — e.g. a new UI pattern the user approved that should be reused consistently (like the collapsible section pattern).
3. **Corrections the user made** — when the user said "no, do it this way" or "that's wrong because..." — these reveal implicit rules that aren't documented yet.
4. **Architectural decisions** — e.g. "we store X in JSON columns" or "this table uses delete-all-then-recreate" — but ONLY if the decision is non-obvious and would affect future work.

## Step 3 — Filter ruthlessly

**Do NOT add:**
- Things that are obvious from reading the code (file paths, function names, variable names)
- One-off fixes that won't recur (e.g. "fixed a typo in line 42")
- Implementation details of a specific feature (that's what the code is for)
- Anything already covered in CLAUDE.md
- Preferences that are specific to a single session and not generalizable

**DO add:**
- Rules that prevent recurring mistakes (especially framework/library pitfalls)
- UI patterns that should be consistent across all routes
- Conventions that were decided during the session and should persist

## Step 4 — Draft and place

For each item worth adding:

1. **Find the right section** in CLAUDE.md. Place the rule where it logically belongs (e.g. a Shopify web component quirk goes under "Shopify Web Components", a new UI pattern goes under "UI Patterns").
2. **Write concisely.** One to three lines max per rule. Lead with the rule itself in bold, then a brief explanation. Match the tone and format of existing entries.
3. **Use the Edit tool** to insert the new content in the correct location. Do not rewrite entire sections.

## Step 5 — Report

After making changes, list what was added and why in a short summary. If nothing warranted adding, say so — an empty session is fine.

## If an argument was provided

If the user specified a topic (e.g. `/add-to-claude collapsible pattern`), focus only on that topic. Still follow all the filtering rules above — if the topic doesn't warrant a CLAUDE.md entry, say so.
