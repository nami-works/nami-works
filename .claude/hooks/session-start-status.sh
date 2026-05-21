#!/usr/bin/env bash
#
# session-start-status.sh — SessionStart hook that prints lint-backlog status.
#
# Runs every time a Claude Code session opens on this repo. Output appears as
# initial context for the session so Claude knows the state of the cleanup
# queue. Designed to be FAST (~1–2s) so it never blocks session start.
#
# What it shows:
#   - Count of open `chore/lint-cleanup-*` PRs awaiting human review
#   - Reminder that the weekly remote routine runs Mondays 9am BRT
#   - How to trigger a one-shot cleanup locally (/clean-one)
#
# Failure mode: if `gh` isn't authed or the network is down, prints a graceful
# fallback line. Never exits non-zero — must not block session start.

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
