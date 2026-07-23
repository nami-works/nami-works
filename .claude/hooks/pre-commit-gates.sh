#!/usr/bin/env bash
#
# pre-commit-gates.sh — PreToolUse hook for Bash that gates `git commit`.
#
# What it does:
#   1. Reads the tool-call JSON from stdin.
#   2. If the command isn't a `git commit`, exits 0 (passes through silently).
#   3. Lints ONLY the files that will actually be committed (staged set, plus
#      modified-but-unstaged tracked files when `-a`/`--all` is in the command).
#   4. Runs `npm run typecheck` on the whole project — TypeScript can't usefully
#      typecheck single files in isolation, and typecheck is currently green.
#   5. Blocks the commit (exit 2) on any failure, with stderr shown to Claude.
#
# Why a Claude Code hook (not a git pre-commit hook):
#   git's own pre-commit hook can be bypassed with `--no-verify`, which an
#   author-agent might reach for under pressure. A Claude Code PreToolUse hook
#   runs in the harness — there is no flag to skip it from the agent side.
#
# Why diff-scoped lint (not whole-file):
#   The repo carries a ~588-issue lint backlog (mostly `any` types in pre-existing
#   route megafiles). Gating on whole-file lint would block every commit that
#   touches those files until the backlog is cleared, even when the commit's
#   own lines are clean. Instead we lint the FILE but report only errors on
#   lines that were added in this commit's diff. NEW code is gated; the
#   pre-existing debt gets cleaned up deliberately, not as a side effect of
#   every commit. See .claude/hooks/lint-changed-lines.mjs.
#
# Activation: registered in .claude/settings.json under hooks.PreToolUse.

set -euo pipefail

input="$(cat)"

command="$(node -e '
  let raw = "";
  process.stdin.on("data", c => raw += c);
  process.stdin.on("end", () => {
    try {
      const data = JSON.parse(raw);
      process.stdout.write(data?.tool_input?.command ?? "");
    } catch {
      process.stdout.write("");
    }
  });
' <<< "$input")"

case "$command" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

echo "[pre-commit-gates] gating git commit..." >&2

# Detect commit target directory from the command string. Worktree-based
# commits use `cd "path" && git commit ...` or `git -C "path" commit ...`.
# Without this, `git rev-parse` runs from the harness's cwd (typically the
# repo root main checkout on `main`), which produces a false-positive
# branch block for legitimate commits to a chore/feat/fix branch in a
# separate worktree. We extract the target and cd into it so every
# downstream check (branch, staged files, lint config, typecheck) runs
# from the ACTUAL commit target.
target_dir=""
if [[ "$command" =~ cd[[:space:]]+\"([^\"]+)\" ]]; then
  target_dir="${BASH_REMATCH[1]}"
elif [[ "$command" =~ cd[[:space:]]+\'([^\']+)\' ]]; then
  target_dir="${BASH_REMATCH[1]}"
elif [[ "$command" =~ git[[:space:]]+-C[[:space:]]+\"([^\"]+)\" ]]; then
  target_dir="${BASH_REMATCH[1]}"
elif [[ "$command" =~ git[[:space:]]+-C[[:space:]]+\'([^\']+)\' ]]; then
  target_dir="${BASH_REMATCH[1]}"
fi

if [ -n "$target_dir" ] && [ -d "$target_dir" ]; then
  cd "$target_dir" || {
    echo "[pre-commit-gates] warning: could not cd to $target_dir — falling back to current dir" >&2
    target_dir=""
  }
fi

# Inherited-branch gate. CLAUDE.md § "Session start" mandates: if the working
# checkout was already on a feature branch when the session started, do NOT
# silently keep committing to it — reconcile first. This hook enforces that
# mechanically.
#
# Logic:
#   - target == main                                    → OK (loose-ops direct-to-main is allowed)
#   - target != session_start_branch                    → OK (branch was created/switched this session,
#                                                              i.e. intentional per the CTO contract)
#   - target == session_start_branch && target != main  → BLOCK (inherited feature branch — the trap)
#
# The session-start branch is recorded per-worktree by session-start-status.sh
# into `$(git rev-parse --git-dir)/session-start-branch`. If that file is
# missing (older session, hook not yet in effect), we warn but allow.
#
# Bypass: set ALLOW_INHERITED_BRANCH_COMMIT=1 when the inherited branch IS
# genuinely the right target (rare — e.g. resuming another session's work
# with explicit hand-off).
current_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
gitdir="$(git rev-parse --git-dir 2>/dev/null || echo '')"
session_branch_file="$gitdir/session-start-branch"

if [ "$current_branch" != "main" ] && [ "${ALLOW_INHERITED_BRANCH_COMMIT:-}" != "1" ]; then
  if [ -f "$session_branch_file" ]; then
    session_start_branch="$(cat "$session_branch_file" 2>/dev/null || echo '')"
    if [ "$current_branch" = "$session_start_branch" ]; then
      cat >&2 <<EOF

✗ Refusing to commit to inherited feature branch: $current_branch

This session opened on \`$current_branch\` — you did NOT create or switch to
it this session. Per CLAUDE.md § "Session start", inherited feature branches
are a trap: another session likely owns the branch and its in-flight PR, and
adding your commits will sweep your work into their PR.

Pick one:
  a) Commit to main (loose-ops zones: gebeauty/**, sandbox/**, root state) —
       git checkout main
       git commit ...
  b) Cut a fresh branch off main for your own work —
       git checkout main
       git checkout -b feat/<slug>
       git commit ...
  c) If this branch IS genuinely the right target (resuming a handed-off
     session), set ALLOW_INHERITED_BRANCH_COMMIT=1 and re-run the commit.

Preserving other sessions' unstaged WIP: DO NOT \`git reset --hard\`. Use
\`git stash push -u\` or route around with explicit \`git add <path>\` staging.
EOF
      exit 2
    fi
  else
    echo "[pre-commit-gates] warning: no session-start-branch marker at $session_branch_file" >&2
    echo "[pre-commit-gates] cannot verify branch is not inherited. Allowing commit — but ensure session-start-status.sh ran this session." >&2
  fi
fi

# Gather files that will be in the commit.
staged_list="$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)"
include_unstaged=""
if printf '%s\n' "$command" | grep -qE -- '[[:space:]]-[a-zA-Z]*a([[:space:]]|$)|[[:space:]]--all([[:space:]]|$)'; then
  include_unstaged="$(git diff --name-only --diff-filter=ACMR 2>/dev/null || true)"
fi

# Filter to TS/JS, dedupe, drop empties.
lintable_files=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) lintable_files+=("$f") ;;
  esac
done < <(printf '%s\n%s\n' "$staged_list" "$include_unstaged" | sort -u)

if [ ${#lintable_files[@]} -gt 0 ]; then
  echo "[pre-commit-gates] linting changed lines in ${#lintable_files[@]} file(s)..." >&2
  hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if ! node "$hook_dir/lint-changed-lines.mjs" "${lintable_files[@]}"; then
    cat >&2 <<'EOF'

✗ Lint failed on lines you added in this commit. Fix the issues above before committing.
  Pre-existing backlog on unchanged lines is not gated — only your new code
  is blocking. If you intentionally need to ship a line that lints (rare),
  add a targeted // eslint-disable-next-line <rule> with a one-line reason.
EOF
    exit 2
  fi
else
  echo "[pre-commit-gates] no TS/JS files in this commit — skipping lint" >&2
fi

echo "[pre-commit-gates] running typecheck (whole project)..." >&2
if ! npm run --silent typecheck >&2; then
  cat >&2 <<'EOF'

✗ Typecheck failed. Fix the type errors above before committing.
  Common cause after route renames: stale .react-router/types/.
  Fix: npx react-router typegen
EOF
  exit 2
fi

echo "[pre-commit-gates] ✓ gate passed — commit allowed" >&2
exit 0
