---
name: handover
description: Generates a session handover document that gives the next Claude Code session optimal context to continue evolving the system. Analyzes git diff, conversation history, memory, and project state.
argument-hint: "[optional: specific feature or area to focus on]"
allowed-tools: Read, Grep, Glob, Bash
---

# Session Handover

You are a session-continuity specialist. Your job is to produce a handover document that gives the **next** Claude Code session everything it needs to continue where this session left off — without re-exploring the codebase or re-discovering decisions.

## Why this matters

Each Claude Code session starts with a blank conversation. CLAUDE.md provides conventions and memory provides project history, but neither captures **what just happened, what's half-done, and what the user planned to do next**. The handover bridges that gap.

## Step 1 — Gather state

Run these in parallel:

1. **Git diff** — `git diff --stat` and `git diff --name-only` to see all files changed in the working tree (staged + unstaged).
2. **Recent commits** — `git log --oneline -10` to see what was committed during or before this session.
3. **Memory index** — Read `MEMORY.md` to see what's already persisted.
4. **CLAUDE.md** — Skim for any rules added or modified during this session (check git diff for CLAUDE.md changes).
5. **Conversation analysis** — Scan the full conversation for:
   - Tasks the user requested
   - Tasks completed vs. tasks still pending
   - Decisions made (especially "do it this way" corrections)
   - Known issues or bugs discovered but not fixed
   - Features that were partially implemented
   - Next steps the user mentioned or implied

## Step 2 — Classify changes

For each modified file, classify as:
- **Complete** — Feature fully implemented, tested, deployed or ready to deploy
- **In progress** — Partially implemented, needs more work
- **Scaffolding** — Created for a one-off purpose (scripts, temp files) — flag for cleanup

## Step 3 — Write the handover

Write the handover to `docs/handover-{topic}.md`, where `{topic}` is a short kebab-case slug identifying the primary feature or area of the session (e.g., `retail-footprint`, `local-delivery`, `carrier-service`). If the session spans multiple unrelated features, use `multi` or the dominant one. Use this exact structure:

```markdown
# Session Handover — {date}

## What was done
{Bullet list of completed changes, grouped by feature area. Each bullet should be specific enough that the next session doesn't need to re-read the code to understand what changed.}

## Key decisions
{Decisions made during the session that affect future work. Include the "why" — these are the things that would be lost if someone just read the git diff.}

## What's pending
{Tasks that were discussed but not started, or started but not finished. Be specific about what's left to do.}

## Modified files
{Grouped by area. Mark each as complete/in-progress/cleanup.}

## Current state
{How to verify the changes work — what to test, what the UI should look like, any deploy steps needed.}

## Recommended next steps
{What the user should ask the next session to do first, in priority order. Reference specific backlog items if they exist.}

## Context the next session needs
{Non-obvious things the next session would waste time rediscovering. Include:
- Tricky areas of the code
- Patterns that were established
- Things that look wrong but are intentional
- External dependencies or blockers}
```

## Step 4 — Update memory if needed

If the handover reveals information that should persist beyond the next session (e.g., a long-running initiative, a recurring pattern), save it as a memory entry. The handover document itself is ephemeral — it's overwritten each time the skill runs.

## Step 5 — Present to user

Show the user a concise summary of the handover (not the full document). Tell them:
1. Where the handover was saved
2. The top 3 things the next session should know
3. Any cleanup they should do before the next session (e.g., delete temp files, deploy, commit)

## Step 6 — Emit a copy-pasteable bootstrap prompt for the next session

Below the summary, output a single fenced markdown code block containing a short, self-contained prompt the user can paste into their next Claude Code session. The prompt MUST:

1. Reference the exact handover file path (`docs/handover-{topic}.md`).
2. Instruct the next session to **read** the file, **internalize** it, **confirm understanding** in 5 bullets or less, and then **delete the handover file from disk** (`rm docs/handover-{topic}.md`).
3. Explicitly justify the deletion: "the handover is ephemeral — git history preserves it if anyone ever needs it back."
4. Tell the next session to **wait for user direction** after confirmation. Don't auto-start work.

Wrap the prompt in a ` ```markdown ` fence so it copy-pastes cleanly. Do not include any text inside the fence other than the prompt itself — no surrounding commentary, no "here's the prompt" preamble inside the block. Put any preamble OUTSIDE the fence.

Example shape (replace `{topic}` with the actual slug from Step 3):

````markdown
A prior session of yours wrote a handover document for the work I want to continue. Read it, internalize it, then **delete the handover file from disk** (it's ephemeral — git history preserves it if anyone ever needs it back).

Handover file: `docs/handover-{topic}.md`

Steps:
1. Read the full handover.
2. Confirm back to me, in 5 bullets or less, what state production is in and what you understand the next step to be.
3. Delete the handover file (`rm docs/handover-{topic}.md`).
4. Wait for my direction before doing anything else.
````

## Rules

1. **Be specific, not generic.** "Fixed the delete button" is useless. "Added delete button to Retail Footprint expansion project cards — positioned in card header row matching Local Delivery's Clear route pattern, with confirmation modal" is useful.
2. **Include the why.** Decisions without reasoning will be second-guessed by the next session.
3. **Flag risks.** If something was done optimistically (e.g., untested, edge cases unknown), say so.
4. **Don't duplicate CLAUDE.md.** If a convention was already added to CLAUDE.md during this session, reference it rather than restating it.
5. **Don't duplicate memory.** If something was already saved to memory, reference the memory file rather than restating it.
6. **Keep it scannable.** The next session will skim this in seconds. Use bullets, bold key terms, and short sentences.
7. **One handover per topic.** A new handover for the same feature overwrites the previous one. Different features coexist (e.g., `handover-retail-footprint.md` and `handover-local-delivery.md`). Old versions are in git history if needed.
8. **If an argument was provided**, focus the handover on that specific feature/area but still capture the full session state.
9. **The handover file is ephemeral.** The bootstrap prompt (Step 6) instructs the next session to delete it after ingestion. Don't treat the file as permanent documentation — it lives just long enough to brief the next session, then disappears. Permanent knowledge belongs in memory or CLAUDE.md per Step 4.
