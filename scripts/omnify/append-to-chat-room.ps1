param(
  [Parameter(Mandatory = $true)]
  [string]$MessageFile,
  [string]$ChatRoom = "chat-room.md"
)

# ----------------------------------------------------------------------------
# append-to-chat-room.ps1 -- the only sanctioned way for a Claude session to
# write to chat-room.md (or any other coordination file).
#
# Why this exists: on 2026-05-02, session-C dropped messages because they read
# chat-room.md, went off to work for ~10 min, came back and overwrote the file
# via Bash heredoc -- bypassing the Edit tool's "modified-since-read" safety
# check. New posts that landed during their work were lost.
#
# This script forces an append-only write that:
#   1. Refuses to run if the working tree has uncommitted changes (the user
#      must commit or stash first -- prevents stomping in-flight edits).
#   2. Pulls origin/main fresh before reading the local copy of chat-room.md
#      (so we always see the latest content from sibling sessions).
#   3. Appends the message file's contents at the END of chat-room.md (NEVER
#      edits existing lines).
#   4. Commits the change with a deterministic message and pushes.
#
# Usage:
#   ./scripts/append-to-chat-room.ps1 -MessageFile path/to/draft.md
#
# Where path/to/draft.md contains the new entry only -- starting with a
# `## [session-X] -- topic` heading and ending with `-- [session-X]`.
#
# ASCII-only on purpose (PowerShell 5.1 codepage parser).
# ----------------------------------------------------------------------------

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  $dir = Get-Location
  while ($dir -and -not (Test-Path (Join-Path $dir ".git"))) {
    $dir = Split-Path $dir -Parent
  }
  if (-not $dir) { throw "Could not find repo root (no .git up the tree)." }
  return $dir
}

$repoRoot   = Resolve-RepoRoot
$chatPath   = Join-Path $repoRoot $ChatRoom
$msgPath    = if ([System.IO.Path]::IsPathRooted($MessageFile)) { $MessageFile } else { Join-Path (Get-Location) $MessageFile }

if (-not (Test-Path $chatPath))   { throw "chat-room file not found: $chatPath" }
if (-not (Test-Path $msgPath))    { throw "message file not found: $msgPath" }

# Per session-A's PR #9 review: this script writes to chat-room.md on `main`,
# so it must be invoked from a worktree currently on `main`. Running from a
# feature-branch worktree would push our chat-room commit (plus any unrelated
# feature commits ahead) to origin/main -- not what anyone wants.
$currentBranch = git -C $repoRoot rev-parse --abbrev-ref HEAD
if ($LASTEXITCODE -ne 0) { throw "git rev-parse failed (exit $LASTEXITCODE)" }
if ($currentBranch -ne "main") {
  throw "Run this from a `main` worktree (current: $currentBranch). chat-room.md updates land on `main` directly per the cross-session coordination rule."
}

Write-Host "== append-to-chat-room ============================================"
Write-Host "Repo root:    $repoRoot"
Write-Host "Chat-room:    $chatPath"
Write-Host "Message file: $msgPath"
Write-Host ""

# ---- 1. refuse to run on a dirty working tree ------------------------------
$status = git -C $repoRoot status --porcelain
if ($LASTEXITCODE -ne 0) { throw "git status failed (exit $LASTEXITCODE)" }
if ($status -and $status.Trim() -ne "") {
  Write-Host "Uncommitted changes detected:"
  Write-Host $status
  throw "Working tree is dirty. Commit or stash before appending to coordination files. (We refuse to run because uncommitted changes WILL travel into the append commit and silently include unrelated work.)"
}

# ---- 2. pull main fresh so the appended commit lands on the latest base ---
Write-Host "[1/4] Pulling origin/main..."
git -C $repoRoot pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw "git pull failed (exit $LASTEXITCODE). Either there's a non-fast-forward divergence or origin is unreachable -- resolve before retrying." }

# ---- 3. append the message file to chat-room with a leading blank line ---
Write-Host "[2/4] Appending message to $ChatRoom..."
$existing = Get-Content -Raw -LiteralPath $chatPath
$append   = Get-Content -Raw -LiteralPath $msgPath

# Ensure the existing file ends with a newline; ensure we separate by a blank line.
if (-not $existing.EndsWith("`n")) { $existing += "`n" }
if (-not $existing.EndsWith("`n`n")) { $existing += "`n" }

$combined = $existing + $append.TrimEnd() + "`n"
[System.IO.File]::WriteAllText($chatPath, $combined, [System.Text.UTF8Encoding]::new($false))

# ---- 4. commit + push ------------------------------------------------------
Write-Host "[3/4] Committing append..."
$shortMsg = (Get-Content -LiteralPath $msgPath -TotalCount 1).TrimStart('#', ' ').Trim()
if (-not $shortMsg) { $shortMsg = "chat-room append" }
git -C $repoRoot add -- $ChatRoom
if ($LASTEXITCODE -ne 0) { throw "git add failed (exit $LASTEXITCODE)" }
git -C $repoRoot commit -m "chore(chat-room): $shortMsg"
if ($LASTEXITCODE -ne 0) { throw "git commit failed (exit $LASTEXITCODE)" }

Write-Host "[4/4] Pushing to origin/main..."
git -C $repoRoot push origin HEAD:main
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Push failed -- another session likely pushed to chat-room.md between our pull and push. Pull again and retry. Exit $LASTEXITCODE."
  exit 1
}

Write-Host ""
Write-Host "== append OK ======================================================"
Write-Host "chat-room.md now $((Get-Content -LiteralPath $chatPath).Count) lines."
