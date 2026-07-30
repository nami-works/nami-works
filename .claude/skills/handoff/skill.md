---
name: handoff
description: Generates a session handoff document that gives the next session optimal context to continue evolving the system. Asks whether the next session runs on Claude Code or Claude Cowork and tailors the handoff content, delivery, and bootstrap prompt to that surface. Analyzes git diff, conversation history, memory, and project state.
argument-hint: "[optional: specific feature or area to focus on]"
allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion
---

# Session Handoff

You are a session-continuity specialist. Your job is to produce a handoff document that gives the **next** session everything it needs to continue where this session left off — without re-exploring the codebase or re-discovering decisions.

The next session can run on one of two surfaces, and they operate differently enough that a handoff written for one is partly wrong for the other. Your first job is to find out which, then tailor the handoff, its delivery, and the bootstrap prompt accordingly.

## Why this matters

Each session starts with a blank conversation. On Claude Code, CLAUDE.md provides conventions and memory provides project history — but neither captures **what just happened, what's half-done, and what the user planned to do next**. On Claude Cowork, the session doesn't even get memory or a guaranteed CLAUDE.md load, so the handoff is the *only* bridge. Either way, the handoff fills the gap.

## The two surfaces

| | **Claude Code** | **Claude Cowork** |
|---|---|---|
| Where it runs | Local Windows machine, persistent | Isolated, ephemeral sandbox on Anthropic's servers (cloud-default); the environment is destroyed at session end |
| Filesystem | The real checkout at `c:\claude`, full access | A *connected folder* synced into the sandbox — only the folders the user connected |
| Shell | Windows PowerShell 5.1 (no `&&` / `||`) plus a POSIX `Bash` tool | POSIX/Linux shell — `&&` / `||` work normally |
| Git | Full local git: branches, PRs, worktrees, pre-commit hooks fire | Can run `git` in its shell if asked, but does **not** default to branch/PR/commit ceremony; reaches the repo through the connected folder (and `git pull` if a file was only pushed to origin) |
| Project memory (`~/.claude/projects/c--claude/memory/`) | Auto-loaded at session start | **Not reachable** — it lives outside the connected folder, so it is never auto-loaded (confirmed empirically) |
| CLAUDE.md | Auto-loaded | Present in the connected folder, but do not assume it is honored the same way — treat it as not guaranteed |
| File delivery | `Start-Process` launch command + `SendUserFile` | Its own file-presentation cards in the desktop app; cannot launch Windows GUI apps |

**The one difference that changes the handoff most:** a Claude Code target auto-loads memory and CLAUDE.md, so its handoff can *reference* them (`see memory X`, `per CLAUDE.md §Y`). A Cowork target reaches neither reliably, so its handoff must be **self-contained** — inline the essential memory/convention context instead of pointing at it.

## Step 1 — Determine the target surface

Before anything else, find out where the **next** session will run. If the user already said in their invocation (or the argument), use that. Otherwise ask with `AskUserQuestion`:

- **Claude Code** — local, full git, memory + CLAUDE.md auto-load.
- **Claude Cowork** — remote sandbox, connected folder, no memory, self-contained handoff required.

This answer drives Step 4 (self-containment), Step 6 (delivery), and Step 7 (bootstrap prompt). Hold onto it.

## Step 2 — Gather state

Run these in parallel:

1. **Git diff** — `git diff --stat` and `git diff --name-only` to see all files changed in the working tree (staged + unstaged).
2. **Recent commits** — `git log --oneline -10` to see what was committed during or before this session.
3. **Memory index** — Read `MEMORY.md` to see what's already persisted (you'll need its contents to *inline* for a Cowork target).
4. **CLAUDE.md** — Skim for any rules added or modified during this session (check git diff for CLAUDE.md changes).
5. **Conversation analysis** — Scan the full conversation for:
   - Tasks the user requested
   - Tasks completed vs. tasks still pending
   - Decisions made (especially "do it this way" corrections)
   - Known issues or bugs discovered but not fixed
   - Features that were partially implemented
   - Next steps the user mentioned or implied

## Step 3 — Classify changes

For each modified file, classify as:
- **Complete** — Feature fully implemented, tested, deployed or ready to deploy
- **In progress** — Partially implemented, needs more work
- **Scaffolding** — Created for a one-off purpose (scripts, temp files) — flag for cleanup

## Step 4 — Write the handoff

Write the handoff to `docs/handoff-{topic}.md`, where `{topic}` is a short kebab-case slug identifying the primary feature or area of the session (e.g., `retail-footprint`, `local-delivery`, `carrier-service`). If the session spans multiple unrelated features, use `multi` or the dominant one. Use this exact structure:

```markdown
# Session Handoff — {date}

**Target surface:** {Claude Code | Claude Cowork}  — written for this surface; if a different surface picks it up, re-read the surface notes below.

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

**Tailor the content to the target surface:**

- **Claude Code target** — reference memory and CLAUDE.md by name where relevant (`see memory `project_x.md``). The target auto-loads them, so restating is noise.
- **Cowork target** — the handoff is the session's *only* context. Make "Context the next session needs" **self-contained**: inline the essential facts from any memory entry or CLAUDE.md convention the work depends on, rather than pointing at a file the Cowork session cannot open. Also prefer POSIX shell idioms in any commands you include, and give paths relative to the connected folder root.

## Step 5 — Update memory if needed

If the handoff reveals information that should persist beyond the next session (e.g., a long-running initiative, a recurring pattern), save it as a memory entry. The handoff document itself is ephemeral — it's overwritten each time the skill runs. (Memory only helps a future Claude Code session; a Cowork session still relies on the self-contained handoff.)

## Step 6 — Deliver the handoff, then present to user

Both surfaces reach the repo through git, so land the handoff on `origin/main` either way — that's the common ground a Claude Code target pulls and a Cowork connected folder syncs from.

1. Stage ONLY the handoff file (`git add docs/handoff-{topic}.md`). **Never `git add .`** — the working tree may hold other sessions' WIP that must not ride your commit.
2. Commit direct to `main` (a single-file doc addition goes direct to main).
3. Push to `origin/main`.

If the pre-commit hook blocks (e.g., you're on an inherited feature branch), stop and reconcile per `CLAUDE.md § Session start` — don't work around the block.

**Surface note on reachability:**
- **Claude Code target** pulls the file with `git pull`.
- **Cowork target** sees it once the connected folder syncs; if it was only pushed to origin, the Cowork session may need `git pull` in its shell. Committing + pushing covers both.
- **If THIS session is itself running in Cowork** and can't push (no git ceremony by default), say so and either ask the user to commit/push from a Claude Code session, or save the file into the connected folder and present it via the file cards — then note in the summary that it isn't on `origin` yet.

Then show the user a concise summary of the handoff (not the full document). Tell them:
1. Where the handoff was committed (file path + short commit SHA)
2. The top 3 things the next session should know
3. Any other cleanup they should do before the next session (e.g., delete temp files, deploy pending work)

## Step 7 — Emit a copy-pasteable bootstrap prompt for the next session

Below the summary, output a single fenced markdown code block containing a short, self-contained prompt the user can paste into their next session. **Emit the template that matches the target surface from Step 1** — do not emit both. Wrap it in a ` ```markdown ` fence so it copy-pastes cleanly, with nothing inside the fence but the prompt itself. Put any preamble OUTSIDE the fence.

Replace `{topic}` with the actual slug from Step 4.

### If the target is Claude Code

````markdown
A prior session of yours wrote a handoff document for the work I want to continue. Read it, internalize it, then **delete the handoff file from disk** (it's ephemeral — git history preserves it if anyone ever needs it back).

Handoff file: `docs/handoff-{topic}.md`

Steps:
1. `git fetch; git pull` on main to make sure the handoff file is present locally.
2. Read the full handoff.
3. Confirm back to me, in 5 bullets or less, what state production is in and what you understand the next step to be.
4. Delete the handoff file (`rm docs/handoff-{topic}.md`).
5. Wait for my direction before doing anything else.
````

### If the target is Claude Cowork

````markdown
A prior session wrote a handoff document for the work I want to continue. It is written to stand alone — you will NOT have this repo's Claude memory auto-loaded, so treat the file as your complete context; don't go looking for memory files.

Handoff file: `docs/handoff-{topic}.md`, in the connected folder. If it isn't there yet, run `git pull` first (it was pushed to origin/main).

Steps:
1. Read the full handoff.
2. Confirm back to me, in 5 bullets or less, what state production is in and what you understand the next step to be.
3. Wait for my direction before doing anything else.

When we're done with it, remove the file with `git rm docs/handoff-{topic}.md` and commit the removal — it's ephemeral, git history preserves it. If you don't have git push access in this Cowork session, leave it and tell me; a Claude Code session will clean it up.
````

Note the Cowork template differences, and keep them: it does not rely on auto-loaded memory, it frames the file as living in the connected folder (with a `git pull` fallback), and it defers deletion to an explicit `git rm` + commit (a bare `rm` in an ephemeral sandbox won't clean up `origin` on its own).

## Rules

1. **Be specific, not generic.** "Fixed the delete button" is useless. "Added delete button to Retail Footprint expansion project cards — positioned in card header row matching Local Delivery's Clear route pattern, with confirmation modal" is useful.
2. **Include the why.** Decisions without reasoning will be second-guessed by the next session.
3. **Flag risks.** If something was done optimistically (e.g., untested, edge cases unknown), say so.
4. **Don't duplicate CLAUDE.md — for a Claude Code target.** Reference a convention already in CLAUDE.md rather than restating it (Claude Code auto-loads it). **For a Cowork target, inline it** — Cowork may not honor CLAUDE.md the same way.
5. **Memory: reference for Claude Code, inline for Cowork.** A Claude Code target auto-loads memory, so point at the memory file. A Cowork target cannot read memory at all — copy the essential facts directly into the handoff.
6. **Keep it scannable.** The next session will skim this in seconds. Use bullets, bold key terms, and short sentences.
7. **One handoff per topic.** A new handoff for the same feature overwrites the previous one. Different features coexist (e.g., `handoff-retail-footprint.md` and `handoff-local-delivery.md`). Old versions are in git history if needed.
8. **If an argument was provided**, focus the handoff on that specific feature/area but still capture the full session state.
9. **The handoff file is ephemeral.** The bootstrap prompt (Step 7) instructs the next session to delete it after ingestion. Don't treat the file as permanent documentation — it lives just long enough to brief the next session, then disappears. Permanent knowledge belongs in memory or CLAUDE.md per Step 5.
10. **Record the target surface at the top of the handoff** (per the Step 4 template) so a mismatch is obvious if the wrong surface picks it up.
