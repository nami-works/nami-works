---
description: Pick one file from the ESLint backlog and clear all its issues on a chore branch
---

Pick one file (or batch the trivial tail) from the lint backlog and clear all its issues. Repo conventions (branch-per-task, pre-commit gate, etc.) are in `CLAUDE.md` — follow them.

## Modes

- **`single`** (default) — clean one file with 5-25 issues. Tight PR, easy review.
- **`trivial-sweep`** — bundle every file with ≤3 issues into one PR. Drains the long tail fast. Triggered by user saying "sweep trivial", "/clean-one --sweep", or when the picker reports >15 trivial candidates and the user agrees.

## Workflow — `single` mode

1. **Verify clean working tree.** Run `git status --short`. If anything is uncommitted, ask the user before proceeding — never sweep someone else's work into a cleanup branch.

2. **Find the target file.**
   ```bash
   npm run lint > /tmp/lint.log 2>&1 || true
   npx tsx scripts/lint-pick.ts /tmp/lint.log
   ```
   The picker emits the next target's path, issue count, rule breakdown, and the suggested branch name. It already applies the skip rules (megafiles, `react-hooks/exhaustive-deps` dominant, `inputs/`, `site/dist/`, files covered by an open `chore/lint-cleanup-*` PR via `gh pr list`).

   Capture the **starting total** from `/tmp/lint.log`'s last line (`✖ N problems`) — needed for the final chart.

3. **Cut a branch** from latest `main`. The picker prints the slug; use it verbatim: `chore/lint-cleanup-<slug>`.

4. **Fix the issues — auto-fix pass first, then manual.**
   ```bash
   npx eslint --fix <file>
   git diff <file>            # inspect what auto-fix did before continuing
   ```
   `eslint --fix` deterministically handles `import/no-duplicates`, `no-useless-escape`, `react/no-unescaped-entities`, `prefer-const`, `no-extra-semi`, and other safe mechanical rules. Read the diff — if anything looks semantically risky (rare), revert that hunk and fix it manually instead.

   For remaining issues, NEVER use `// eslint-disable`. Patterns by rule:
   - **`no-explicit-any`** → use the real type from existing interfaces, generated types (Prisma, Shopify Admin API, React Router `Route.LoaderArgs`/`ActionArgs`), or `unknown` + narrowing. If you can't determine the type confidently, ABORT (step 6).
   - **`no-unused-vars`** → delete dead code. If it's a required signature param, prefix with `_` (note: project config doesn't currently allow `_`-prefix to suppress, so prefer removing the param + updating callers).
   - **`jsx-a11y/no-static-element-interactions` + `click-events-have-key-events`** → use a real `<button>` if possible; otherwise add `role="button"`, `tabIndex={0}`, and an `onKeyDown` handler for Enter/Space.
   - **`import/no-unresolved`** → fix root cause (often `npx react-router typegen` for stale generated types, or a tsconfig path issue).
   - **`react-hooks/exhaustive-deps`** → SKIP. Call out in PR body for human review.

5. **Verify (run in parallel — they're independent).**
   ```bash
   npx eslint <file>      # must report 0 issues
   npm run typecheck      # must still be green
   ```

6. **Abort conditions** (be conservative). If fixing a `no-explicit-any` would require:
   - Changing a shared type/interface imported elsewhere,
   - Modifying a function signature used in 3+ call sites,
   - Touching files outside the chosen target,

   ...ABORT. `git reset --hard main && git branch -D <branch>` and re-run the picker (it'll skip what's already in flight). Keep PRs scoped to one file.

7. **Commit.** Stage only the file(s) you changed.
   ```bash
   git commit -m "chore(lint): clean up <file> — <N> issues cleared"
   ```

8. **Open the PR** (do NOT auto-merge):
   ```bash
   git push -u origin chore/lint-cleanup-<slug>
   gh pr create --base main --title "Tech-debt sweep: <file> — <N> issues cleared" --body "..."
   ```
   Body must include: rules fixed with counts, anything skipped (especially `exhaustive-deps` for human review), and "0 behavioral changes intended."

9. **Update the lint-history ledger and render the daily chart.**
   - Re-run `npm run lint > /tmp/lint-after.log 2>&1 || true` to capture the **post-cleanup total**.
   - Append a new row to `.claude/lint-history.md` with: today's date (YYYY-MM-DD), Start, End, Cleared (= Start − End), PR number(s), and the file(s) touched.
   - **Render an inline ASCII chart** showing the last ~14 days of totals. Anchor scale floor ~10 below min observed so day-to-day movement is visible. Format:
     ```
     2026-05-04 │████████████████████████████████████████ 574  baseline
     2026-05-05 │█████████████████                        552  ← (-22, PRs #14+#17+#18 merged)
     ```

10. **Report.** Print the PR URL and the chart, in that order. Stop after one file — do not chain to a second.

## Workflow — `trivial-sweep` mode

When the user wants to drain the long tail in one shot. Same safety bar as `single` mode (lint=0 + typecheck green per file before commit) — just batched.

1. **Verify clean working tree** (same as single).

2. **List candidates.**
   ```bash
   npm run lint > /tmp/lint.log 2>&1 || true
   npx tsx scripts/lint-pick.ts /tmp/lint.log --mode=trivial
   ```
   Picker emits all eligible files with ≤3 issues, sorted ascending. **Show the user the list and confirm before proceeding** — large sweeps mean a wider diff to review.

3. **Cut a sweep branch.** `chore/lint-cleanup-trivial-sweep-YYYY-MM-DD` from latest `main`.

4. **Per-file inner loop** (NEVER use `// eslint-disable` anywhere):
   For each candidate file:
   ```bash
   cp <file> /tmp/snapshot           # snapshot in case we revert
   npx eslint --fix <file>
   npx eslint <file>                 # 0 issues?
   ```
   - If `--fix` cleared the file (0 issues): keep, log to a running tally `[FIXED-AUTO] <file>`.
   - If issues remain: try the manual patterns from step 4 of `single` mode. If still not 0 after one manual pass, revert (`cp /tmp/snapshot <file>`) and log `[SKIP] <file>: <reason>`.
   - If a fix would touch a different file (cross-file types, signature changes with external callers): revert and log `[SKIP-CROSS-FILE]`.

5. **Verify the whole batch.**
   ```bash
   npm run typecheck
   npm run lint > /tmp/lint-after.log 2>&1 || true
   ```
   Typecheck MUST be green. Lint count must be **strictly less** than the starting total. If typecheck breaks, find the bad file via `git diff --name-only main`, revert it, re-run.

6. **Commit.** One commit, manifest in the body.
   ```bash
   git add <only files we changed>
   git commit -m "chore(lint): trivial sweep — N files, M issues cleared"
   ```

7. **Open the PR.** Body must include:
   - Per-file table: file, issues cleared, rules fixed, fix type (`auto-fix` / `manual` / `mixed`).
   - Skipped files with reasons.
   - "0 behavioral changes intended."

8. **Update ledger + chart** as in step 9 of `single` mode. Use one row with all PR-level totals.

9. **Report.** Print the PR URL, manifest summary (`X auto-fixed, Y manual, Z skipped`), and the chart.

## Special cases

- **Backlog already clear:** if `npm run lint` reports 0 issues, just say so and exit. No PR needed.
- **Stuck after 3 fix attempts on a single file:** in `single` mode, ABORT and pick another. In `trivial-sweep` mode, revert that file and continue.
- **Picker says no eligible files:** all qualifying files are already in flight (open PRs). Tell the user and exit — don't try to game the skip rules.
