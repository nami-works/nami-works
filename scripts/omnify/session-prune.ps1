param(
  [switch]$Confirm,
  [switch]$DryRun
)

# ----------------------------------------------------------------------------
# session-prune.ps1 -- remove worktrees whose branch has merged or been deleted.
#
# Usage:
#   ./scripts/session-prune.ps1            -> dry-run by default; lists candidates
#   ./scripts/session-prune.ps1 -Confirm   -> actually remove the candidate worktrees
#   ./scripts/session-prune.ps1 -DryRun    -> explicit dry-run flag (same as default)
#
# Why this exists:
#   The "Worktree-per-session" Hard Rule in CLAUDE.md spawns a new worktree per
#   parallel Claude session. Without cleanup, ../cpg-labs-<slug>/ directories
#   pile up on disk indefinitely, each carrying its own ~600 MB node_modules.
#   This script is wired into the existing Monday auto-cleanup hook so stale
#   worktrees are flagged once a week, removable on -Confirm.
#
# Safety:
#   - The main worktree (the one with `main` checked out OR HEAD on main) is
#     NEVER pruned, regardless of state.
#   - Worktrees with uncommitted changes are NEVER pruned -- you'll see them
#     listed under "skipped (dirty)" instead. Manual review required.
#   - Worktrees whose branch is NOT merged AND NOT deleted upstream are NEVER
#     pruned -- still considered active work. Listed under "skipped (active)".
#
# A worktree is a "prune candidate" if:
#   1. Its branch name is in the form `<prefix>/<slug>` (feat/, fix/, chore/, docs/), AND
#   2. Either:
#      a. The branch is fully merged into origin/main (commits all reachable from main), OR
#      b. The branch no longer exists on origin (deleted after PR merge), AND
#   3. The worktree's own working tree is clean (no uncommitted changes).
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

$repoRoot = Resolve-RepoRoot

Write-Host "== session-prune =================================================="
Write-Host "Repo root: $repoRoot"
$mode = if ($Confirm) { "REMOVE" } else { "dry-run (use -Confirm to actually remove)" }
Write-Host "Mode:      $mode"
Write-Host ""

# Refresh remote-tracking refs so we know which branches are deleted upstream.
Write-Host "Fetching origin (with --prune)..."
git -C $repoRoot fetch origin --prune
if ($LASTEXITCODE -ne 0) { throw "git fetch failed (exit $LASTEXITCODE)" }

# Parse `git worktree list --porcelain` -- groups separated by blank lines,
# fields are `worktree <path>`, `HEAD <sha>`, `branch refs/heads/<name>`.
$worktreeOutput = git -C $repoRoot worktree list --porcelain
if ($LASTEXITCODE -ne 0) { throw "git worktree list failed (exit $LASTEXITCODE)" }

$worktrees = @()
$current   = $null
foreach ($line in ($worktreeOutput -split "`n")) {
  $line = $line.TrimEnd("`r")
  if ($line -eq "") {
    if ($current) {
      $worktrees += $current
      $current = $null
    }
    continue
  }
  if (-not $current) { $current = @{} }
  if ($line.StartsWith("worktree ")) { $current.path   = $line.Substring(9) }
  if ($line.StartsWith("HEAD "))     { $current.head   = $line.Substring(5) }
  if ($line.StartsWith("branch "))   { $current.branch = ($line.Substring(7) -replace "^refs/heads/", "") }
  if ($line -eq "detached")          { $current.detached = $true }
}
if ($current) { $worktrees += $current }

# Branches merged to origin/main:
$mergedBranches = @()
$mergedOutput = git -C $repoRoot branch --merged origin/main --format="%(refname:short)"
if ($LASTEXITCODE -eq 0) { $mergedBranches = $mergedOutput -split "`n" | ForEach-Object { $_.TrimEnd("`r") } | Where-Object { $_ } }

# Branches that exist on origin (so we can detect ones that DON'T):
$remoteBranches = @()
$remoteOutput = git -C $repoRoot for-each-ref --format="%(refname:short)" refs/remotes/origin/
if ($LASTEXITCODE -eq 0) {
  $remoteBranches = $remoteOutput -split "`n" |
    ForEach-Object { ($_.TrimEnd("`r") -replace "^origin/", "") } |
    Where-Object { $_ -and $_ -ne "HEAD" }
}

$candidates = @()
$skippedActive = @()
$skippedDirty  = @()
$skippedMain   = @()

foreach ($wt in $worktrees) {
  if (-not $wt.branch) {
    # Detached HEAD or unusual state -- never auto-prune.
    $skippedMain += "$($wt.path) (detached or no branch)"
    continue
  }
  if ($wt.branch -eq "main") {
    $skippedMain += "$($wt.path) (main worktree)"
    continue
  }
  if ($wt.branch -notmatch "^(feat|fix|chore|docs)/") {
    $skippedActive += "$($wt.path) on $($wt.branch) (non-standard prefix)"
    continue
  }

  $isMerged          = $mergedBranches -contains $wt.branch
  $deletedUpstream   = -not ($remoteBranches -contains $wt.branch)

  if (-not ($isMerged -or $deletedUpstream)) {
    $skippedActive += "$($wt.path) on $($wt.branch) (not merged, still on origin)"
    continue
  }

  # Worktree must be clean before we touch it.
  $status = git -C $wt.path status --porcelain
  if ($LASTEXITCODE -ne 0) {
    $skippedDirty += "$($wt.path) (status check failed)"
    continue
  }
  if ($status -and $status.Trim() -ne "") {
    $skippedDirty += "$($wt.path) on $($wt.branch) (uncommitted changes)"
    continue
  }

  $reason = @()
  if ($isMerged)        { $reason += "merged" }
  if ($deletedUpstream) { $reason += "deleted upstream" }
  $candidates += @{ path = $wt.path; branch = $wt.branch; reason = ($reason -join ", ") }
}

Write-Host "Skipped (main / detached): $($skippedMain.Count)"
foreach ($s in $skippedMain) { Write-Host "  - $s" }
Write-Host ""
Write-Host "Skipped (active branches): $($skippedActive.Count)"
foreach ($s in $skippedActive) { Write-Host "  - $s" }
Write-Host ""
Write-Host "Skipped (dirty trees): $($skippedDirty.Count)"
foreach ($s in $skippedDirty) { Write-Host "  - $s" }
Write-Host ""
Write-Host "Prune candidates: $($candidates.Count)"
foreach ($c in $candidates) { Write-Host "  - $($c.path) on $($c.branch)  [$($c.reason)]" }
Write-Host ""

if ($candidates.Count -eq 0) {
  Write-Host "Nothing to prune."
  exit 0
}

if (-not $Confirm -or $DryRun) {
  Write-Host "Dry-run only. Re-run with -Confirm to remove the listed worktrees."
  exit 0
}

Write-Host "Removing $($candidates.Count) worktree(s)..."
foreach ($c in $candidates) {
  Write-Host "  git worktree remove $($c.path)"
  git -C $repoRoot worktree remove $c.path
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "  removal of $($c.path) failed (exit $LASTEXITCODE) -- continuing"
  }
}

Write-Host ""
Write-Host "== prune complete ================================================="
