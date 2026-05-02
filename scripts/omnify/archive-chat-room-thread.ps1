param(
  [Parameter(Mandatory = $true)]
  [int]$StartLine,
  [Parameter(Mandatory = $true)]
  [int]$EndLine,
  [Parameter(Mandatory = $true)]
  [string]$DecisionDocSlug,
  [string]$ChatRoom = "chat-room.md"
)

# ----------------------------------------------------------------------------
# archive-chat-room-thread.ps1 -- atomic move of a converged thread out of
# chat-room.md and into docs/decisions/<yyyy-mm-dd>-<slug>.md.
#
# Why this exists: when session-C tried to do this manually on 2026-05-02 by
# (a) writing the transcript to docs/decisions/, (b) overwriting chat-room.md
# with a fresh template, the second step bypassed Edit's modified-since-read
# check and dropped 3 messages that had been posted while session-C was
# archiving.  This script does both moves atomically with a single commit
# AND replaces the archived block in-place with a 1-line pointer (NOT a
# truncate), so any concurrent appends below the archived block are
# preserved.
#
# Usage:
#   ./scripts/archive-chat-room-thread.ps1 \
#     -StartLine 14 -EndLine 291 \
#     -DecisionDocSlug "worktree-isolation"
#
#   This will:
#     1. Refuse if working tree is dirty.
#     2. Pull origin/main fresh.
#     3. Re-validate that lines $StartLine..$EndLine still exist in the
#        latest chat-room.md (refuse if file changed in a way that shifts
#        the range).
#     4. Copy lines $StartLine..$EndLine into docs/decisions/<date>-<slug>.md
#        with a YAML-style header.
#     5. Replace those lines in chat-room.md with:
#          > Thread archived to docs/decisions/<date>-<slug>.md (lines $StartLine..$EndLine).
#     6. Commit (single commit, both files), push.
#
# Anything BELOW $EndLine in chat-room.md (concurrent appends from sibling
# sessions during your work) is preserved verbatim.  This is the key safety
# property that the manual-overwrite approach lacked.
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

if ($DecisionDocSlug -notmatch "^[a-z0-9][a-z0-9-]*$") {
  throw "Invalid -DecisionDocSlug '$DecisionDocSlug'. Lowercase letters, digits, and dashes only."
}
if ($StartLine -lt 1 -or $EndLine -le $StartLine) {
  throw "Invalid line range: -StartLine must be >= 1 and -EndLine must be > -StartLine."
}

$repoRoot   = Resolve-RepoRoot
$chatPath   = Join-Path $repoRoot $ChatRoom
$today      = (Get-Date -Format "yyyy-MM-dd")
$decDir     = Join-Path $repoRoot "docs/decisions"
$decFile    = Join-Path $decDir "$today-$DecisionDocSlug.md"

# Per session-A's PR #9 review: this script commits to `main` (chat-room.md
# update + new docs/decisions/ entry), so it must be invoked from a worktree
# currently on `main`. Running from a feature-branch worktree would push our
# archive commit (plus any feature commits ahead) to origin/main.
$currentBranch = git -C $repoRoot rev-parse --abbrev-ref HEAD
if ($LASTEXITCODE -ne 0) { throw "git rev-parse failed (exit $LASTEXITCODE)" }
if ($currentBranch -ne "main") {
  throw "Run this from a `main` worktree (current: $currentBranch). Archiving lands chat-room.md + docs/decisions/ on `main` directly."
}

Write-Host "== archive-chat-room-thread ======================================="
Write-Host "Repo root:    $repoRoot"
Write-Host "Chat-room:    $chatPath"
Write-Host "Range:        lines $StartLine..$EndLine"
Write-Host "Decision doc: $decFile"
Write-Host ""

# ---- 1. refuse on dirty tree -----------------------------------------------
$status = git -C $repoRoot status --porcelain
if ($LASTEXITCODE -ne 0) { throw "git status failed (exit $LASTEXITCODE)" }
if ($status -and $status.Trim() -ne "") {
  Write-Host $status
  throw "Working tree is dirty. Commit or stash before archiving."
}

# ---- 2. pull main fresh ----------------------------------------------------
Write-Host "[1/5] Pulling origin/main..."
git -C $repoRoot pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw "git pull failed (exit $LASTEXITCODE)" }

# ---- 3. read current chat-room and validate range --------------------------
Write-Host "[2/5] Validating range against latest chat-room.md..."
$lines = Get-Content -LiteralPath $chatPath
$totalLines = $lines.Count
if ($EndLine -gt $totalLines) {
  throw "Range out of bounds. chat-room.md is $totalLines lines; -EndLine $EndLine requested."
}

# Defensive: refuse to archive if start or end line is blank (suggests range drifted).
if ([string]::IsNullOrWhiteSpace($lines[$StartLine - 1])) {
  Write-Warning "Line $StartLine is blank. Range may have drifted since you computed it. Re-check and retry."
  throw "Aborting: ambiguous range start."
}

# ---- 4. write decision doc -------------------------------------------------
Write-Host "[3/5] Writing $decFile..."
if (-not (Test-Path $decDir)) { New-Item -ItemType Directory -Path $decDir | Out-Null }

$archived = $lines[($StartLine - 1)..($EndLine - 1)] -join "`n"
$header = @"
# $today -- $DecisionDocSlug

Archived from chat-room.md (lines $StartLine..$EndLine on $today). Append-only, do not edit retrospectively.

---

"@
[System.IO.File]::WriteAllText($decFile, $header + $archived + "`n", [System.Text.UTF8Encoding]::new($false))

# ---- 5. replace archived range with a pointer ------------------------------
Write-Host "[4/5] Replacing archived range with pointer in chat-room.md..."
$pointer = "> Thread archived to ``docs/decisions/$today-$DecisionDocSlug.md`` on $today (was lines $StartLine..$EndLine)."

$head = if ($StartLine -gt 1) { $lines[0..($StartLine - 2)] } else { @() }
$tail = if ($EndLine -lt $totalLines) { $lines[$EndLine..($totalLines - 1)] } else { @() }
$newContent = (@($head) + @($pointer) + @($tail)) -join "`n"
[System.IO.File]::WriteAllText($chatPath, $newContent + "`n", [System.Text.UTF8Encoding]::new($false))

# ---- 6. commit + push ------------------------------------------------------
Write-Host "[5/5] Committing + pushing..."
git -C $repoRoot add -- $ChatRoom "docs/decisions/$today-$DecisionDocSlug.md"
if ($LASTEXITCODE -ne 0) { throw "git add failed (exit $LASTEXITCODE)" }
git -C $repoRoot commit -m "chore(chat-room): archive '$DecisionDocSlug' thread to docs/decisions/"
if ($LASTEXITCODE -ne 0) { throw "git commit failed (exit $LASTEXITCODE)" }
git -C $repoRoot push origin HEAD:main
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Push failed -- another session likely pushed to chat-room.md between our pull and push. Pull again and retry. Exit $LASTEXITCODE."
  exit 1
}

Write-Host ""
Write-Host "== archive OK ====================================================="
Write-Host "Decision doc: $decFile"
Write-Host "chat-room.md now $((Get-Content -LiteralPath $chatPath).Count) lines."
