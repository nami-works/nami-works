#!/usr/bin/env bash
#
# session-start-status.sh — SessionStart hook that prints branch/tree state
# and lint-backlog status.
#
# Runs every time a Claude Code session opens on this repo. Output appears as
# initial context for the session so Claude knows the state of the cleanup
# queue AND the state of the working checkout (which branch, dirty or not).
# Designed to be FAST (~1–2s) so it never blocks session start.
#
# What it shows:
#   - HEAD = <branch>, with a flag when HEAD ≠ main (the inheritance-trap signal)
#   - Count of inherited M/?? files in the working tree (also inheritance signal)
#   - Count of open `chore/lint-cleanup-*` PRs awaiting human review
#
# Side effect: records the session-start branch to `$(git rev-parse --git-dir)/
# session-start-branch` so pre-commit-gates.sh can detect commits to inherited
# feature branches. The marker is per-worktree (worktree-specific gitdir) and
# gets overwritten each session start.
#
# Failure mode: if any git/gh call fails, prints a graceful fallback line.
# Never exits non-zero — must not block session start.

# --- Branch / tree state (record + surface) ---

current_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
gitdir="$(git rev-parse --git-dir 2>/dev/null || echo '')"

if [ -n "$current_branch" ] && [ -n "$gitdir" ]; then
  printf '%s' "$current_branch" > "$gitdir/session-start-branch" 2>/dev/null || true
fi

m_count="$(git status --short 2>/dev/null | grep -c '^ M' || true)"
untracked_count="$(git status --short 2>/dev/null | grep -c '^??' || true)"

if [ "$current_branch" = "main" ]; then
  branch_line="[session-start] HEAD = main"
else
  branch_line="[session-start] ⚠ HEAD = $current_branch (not main — check whether this checkout was inherited)"
fi

dirty_summary=""
if [ "$m_count" != "0" ] || [ "$untracked_count" != "0" ]; then
  dirty_summary=" · inherited working tree: ${m_count} M, ${untracked_count} ?? (belong to other sessions unless you know otherwise)"
fi

echo "${branch_line}${dirty_summary}"

# --- Lint-backlog PR count ---

open_prs="$(gh pr list \
  --json number,headRefName \
  --jq '[.[] | select(.headRefName | startswith("chore/lint-cleanup-"))] | length' \
  2>/dev/null || true)"

case "$open_prs" in
  "")  msg="(could not query GitHub — check gh auth)" ;;
  "0") msg="no cleanup PRs in flight" ;;
  "1") msg="1 cleanup PR pending human review" ;;
  *)   msg="$open_prs cleanup PRs pending human review" ;;
esac

cat <<EOF
[lint-backlog] $msg · weekly auto-cleanup runs Mondays 9am BRT · type /clean-one to clear one file now
EOF

# Once a week (Mondays), report stale worktrees so the desktop / WT root doesn't
# silently accumulate forgotten branches. Read-only — never auto-removes; use
# `bash scripts/prune-stale-worktrees.sh --prune` to actually clean up.
if [ "$(date +%u)" = "1" ] && [ -x scripts/prune-stale-worktrees.sh ]; then
  bash scripts/prune-stale-worktrees.sh 2>/dev/null || true
fi

exit 0
