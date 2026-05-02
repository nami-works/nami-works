param(
  [Parameter(Mandatory = $true)]
  [string]$BranchSlug,
  [string]$Prefix = "feat",
  [switch]$SkipInstall
)

# ----------------------------------------------------------------------------
# session-bootstrap.ps1 -- create a worktree for a parallel Claude Code session.
#
# Usage:
#   ./scripts/session-bootstrap.ps1 -BranchSlug retail-sales-tweaks
#     -> creates ../cpg-labs-retail-sales-tweaks/ on branch feat/retail-sales-tweaks
#        cut from origin/main, hard-links .env from main, runs npm install.
#
#   ./scripts/session-bootstrap.ps1 -BranchSlug fix-x -Prefix fix
#     -> branch name is fix/fix-x.
#
#   ./scripts/session-bootstrap.ps1 -BranchSlug audit -SkipInstall
#     -> creates the worktree + .env link, but skips `npm install`.
#
# Why this exists:
#   When more than one Claude session runs against this repo, sharing a single
#   `cwd` causes HEAD / index / working-tree stomps across sessions. See the
#   "Worktree-per-session" Hard Rule in CLAUDE.md and the post-mortem at
#   docs/decisions/2026-05-02-worktree-isolation.md for the rationale.
#
# What it does:
#   1. Resolves repo root + main worktree path.
#   2. `git worktree add` at ../cpg-labs-<slug> with branch <prefix>/<slug>
#      cut from origin/main.
#   3. Hard-links .env from main into the new worktree (NOT a symlink --
#      symlinks need Developer Mode on Windows 11; hard-links don't).
#   4. `npm install` in the new worktree (skip with -SkipInstall).
#   5. Prints a `cd` reminder.
#
# All steps fail loud. No silent fallback.
# ASCII-only on purpose -- PowerShell 5.1 reads .ps1 as Windows-1252 by
# default; unicode chars in the file would break the parser.
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

# Validate slug -- letters, digits, dashes only. No paths, no spaces.
if ($BranchSlug -notmatch "^[a-z0-9][a-z0-9-]*$") {
  throw "Invalid -BranchSlug '$BranchSlug'. Lowercase letters, digits, and dashes only; must start with a letter or digit."
}

if ($Prefix -notmatch "^(feat|fix|chore|docs)$") {
  throw "Invalid -Prefix '$Prefix'. Allowed: feat, fix, chore, docs."
}

$repoRoot     = Resolve-RepoRoot
$repoParent   = Split-Path $repoRoot -Parent
$worktreeDir  = Join-Path $repoParent "cpg-labs-$BranchSlug"
$branchName   = "$Prefix/$BranchSlug"
$mainEnv      = Join-Path $repoRoot ".env"

Write-Host "== session-bootstrap =============================================="
Write-Host "Repo root:    $repoRoot"
Write-Host "New worktree: $worktreeDir"
Write-Host "Branch:       $branchName  (cut from origin/main)"
Write-Host ""

if (Test-Path $worktreeDir) {
  throw "Target worktree directory already exists: $worktreeDir. Pick a different slug or remove the old worktree with `git worktree remove $worktreeDir`."
}

# ---- 1. fetch latest origin/main so the cut is current ---------------------
Write-Host "[1/4] Fetching origin/main..."
git -C $repoRoot fetch origin main
if ($LASTEXITCODE -ne 0) { throw "git fetch origin main failed (exit $LASTEXITCODE)" }

# ---- 2. create worktree on new branch from origin/main ---------------------
Write-Host "[2/4] git worktree add $worktreeDir -b $branchName origin/main ..."
git -C $repoRoot worktree add $worktreeDir -b $branchName origin/main
if ($LASTEXITCODE -ne 0) { throw "git worktree add failed (exit $LASTEXITCODE)" }

# ---- 3. hard-link .env from main into the new worktree ---------------------
if (Test-Path $mainEnv) {
  $newEnv = Join-Path $worktreeDir ".env"
  Write-Host "[3/4] Hard-linking .env from main worktree..."
  try {
    New-Item -ItemType HardLink -Path $newEnv -Target $mainEnv -ErrorAction Stop | Out-Null
    Write-Host "  Linked: $newEnv -> $mainEnv"
  } catch {
    throw "Failed to hard-link .env from $mainEnv to $newEnv. Hard-links don't need Developer Mode but DO require both paths on the same NTFS volume. Error: $_"
  }
} else {
  Write-Warning "[3/4] No .env found at $mainEnv -- skipping link. Set up .env in the new worktree manually before running the dev server."
}

# ---- 4. npm install --------------------------------------------------------
if (-not $SkipInstall) {
  Write-Host "[4/4] Running npm install in $worktreeDir ..."
  Push-Location $worktreeDir
  try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
} else {
  Write-Host "[4/4] Skipping npm install (-SkipInstall)..."
}

Write-Host ""
Write-Host "== bootstrap OK ==================================================="
Write-Host "Switch into the new worktree before editing:"
Write-Host "  cd $worktreeDir"
Write-Host ""
Write-Host "When the branch is merged or abandoned, prune with:"
Write-Host "  ./scripts/session-prune.ps1"
