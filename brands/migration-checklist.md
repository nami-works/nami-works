# Skill migration checklist — one pass per skill, on demand

Convert a skill to the brand-agnostic pattern **when it is next needed for real work**, not preemptively. This is the repeatable recipe the pilot (`growth-office`, `design-engineer`) proved. Run it top to bottom; it should take one focused pass.

Read first: `brands/SCHEMA.md` (the contract), `brands/skill-confrontation.md` (native-skill verdicts), and the target's current SKILL.md.

## Step 0 — Confront the Anthropic native set (gate)

Before refactoring, decide whether a native skill already does the job better. Look up this skill in `brands/skill-confrontation.md`. If it's not there (a new skill), do the confrontation now: search the native plugins (marketing, design, data, operations, legal, finance, productivity, figma, canva, adobe) for an equivalent.

Outcome, per the standing policy (**keep + delegate**):
- **No equivalent** → keep, proceed to Step 1.
- **Generic limb overlaps** → keep the director; record the native skill(s) in the brand manifest's `native_delegates` and have the SKILL.md delegate that sub-task instead of reimplementing it.
- **Native is the better engine** (e.g. Canva) → keep orchestration, move execution onto the native MCP-backed skill.
- **Native fully supersedes** → retire the custom skill; don't migrate it. (None so far.)

## Step 1 — Separate the three layers

Read the SKILL.md and tag every brand-specific thing as either:
- **Method** (reusable, brand-neutral) → stays in SKILL.md.
- **Brand fact** (tagline, persona, floor, ceiling, palette, segment count, voice grammar) → moves to `<brand>/brand-context.md`.
- **Infra binding** (`.env` paths, engine scripts, route tables, account names, templates) → moves to the manifest (`economics.engine`, `design_system.references`, `channels`, `workspace`).

Grep for hardcoded literals: currency amounts, percentages, `gebeauty/`, `app/routes/`, tagline strings, persona names, `viewBox`, aspect ratios, segment counts. Each hit is a manifest field, not a SKILL.md literal.

## Step 2 — Add Step 0 brand resolution to the SKILL.md

Insert a resolution block at the top: explicit `--brand <slug>` → connected-folder `brand-context.md` → **ask**. Never default to GE Beauty. Then read the manifest and `brands/shared-defaults.md`.

## Step 3 — Replace literals with contract fields

Swap every literal for its manifest field (`{{economics.profit_floor}}`, `{{design_system.profile}}`, `{{brand.tagline}}`, ...). Where a field can be `null`, branch on it: name the gap and use the brand-appropriate substitute. **Never invent a value or borrow another brand's.**

## Step 4 — Make the roster / references per-brand

Any fixed roster, route table, or reference list reads from the manifest (`roster`, `design_system.references`, `native_delegates`). A role/reference the brand lacks is surfaced, not forced.

## Step 5 — Preserve the IP verbatim

Do NOT touch the transferable, brand-neutral IP while refactoring (e.g. design-engineer's Phase 3.5 state matrix + hide-don't-disable; growth-office's intake loop + verify-don't-trust). These are the point.

## Step 6 — Update the two manifests

Add any new fields this skill needs to `gebeauty/brand-context.md` (real values, extracted not guessed — escalate money assumptions to Lucas) and `nami/brand-context.md` (declare absent capabilities as `null`). Keep `brands/SCHEMA.md` in sync if the contract grew.

## Step 7 — Save + sync

- Cowork: `mcp__cowork__save_skill` with `overwrite: true` (the repo `.claude/skills` cache is read-only here). Watch the two validators: **description ≤ 1024 chars** and **no angle-bracket tags in the description** (the full text lives in the body regardless).
- The repo source `SKILL.md` under `.claude/skills/<name>/` can only be edited in a **Claude Code** session (protected in Cowork). Sync it there so the source of truth and the account skill match.

## Step 8 — Acceptance test (definition of done)

Run the skill three ways:
- **`--brand gebeauty`** → behavior and numbers **identical to before** the refactor (pure regression; if GE output changes, the refactor is wrong).
- **`--brand nami`** → runs to completion **inventing no GE fact**, and explicitly names any capability NAMI lacks.
- **No brand specified** → **asks**; never silently defaults.

Only when all three pass is the skill migrated.
