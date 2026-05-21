param(
  [string]$Region        = "us-east-1",
  [string]$Bucket        = "cpg-labs-site",
  [string]$DistributionId = "",
  [switch]$SkipBuild,
  [switch]$DryRun
)

# ----------------------------------------------------------------------------
# deploy-site.ps1 -- deploy the public site at cpg-labs.io.
#
# Distinct from deploy.ps1 (which ships ECS Shopify apps): the public site is
# a static Astro build hosted on S3 + CloudFront, with no Docker, no ECS, no
# task definition. Lives entirely in `site/`.
#
# Pipeline:
#   1. cd site && npm run build          (Astro static output -> site/dist/)
#   2. aws s3 sync site/dist s3://...    (with --delete to prune removed files)
#   3. aws cloudfront create-invalidation /*   (force edge refresh)
#
# Pre-deploy guards:
#   - site/ exists
#   - site/dist must exist after build (sanity check)
#   - distribution ID resolvable from terraform output (fallback param)
#
# Post-deploy:
#   - prints the CloudFront domain so the deployer can smoke test before/after
#     DNS flip
#
# Usage:
#   ./scripts/deploy-site.ps1                       # build + push + invalidate
#   ./scripts/deploy-site.ps1 -SkipBuild            # if you already ran npm run build
#   ./scripts/deploy-site.ps1 -DryRun               # show what would change without uploading
#   ./scripts/deploy-site.ps1 -DistributionId E123  # override CF lookup
#
# ASCII-only on purpose: PowerShell 5.1 reads .ps1 files as Windows-1252 by
# default. Unicode characters (em-dashes, box-drawing) without a UTF-8 BOM
# become unparseable bytes and break the script.
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
$siteDir  = Join-Path $repoRoot "site"
$distDir  = Join-Path $siteDir "dist"

if (-not (Test-Path $siteDir)) {
  throw "site/ directory not found at $siteDir. Are you on the right branch?"
}

Write-Host "== deploy-site =================================================="
Write-Host "Repo root:      $repoRoot"
Write-Host "Site directory: $siteDir"
Write-Host "S3 bucket:      $Bucket"
Write-Host "Region:         $Region"
Write-Host "DryRun:         $DryRun"
Write-Host ""

# --- 1. Build (unless -SkipBuild) ---------------------------------------------
if (-not $SkipBuild) {
  Write-Host "[1/3] Building site (npm run build)..."
  Push-Location $siteDir
  try {
    if (-not (Test-Path "node_modules")) {
      Write-Host "  node_modules missing -- running npm install first..."
      npm install
      if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }
    }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
} else {
  Write-Host "[1/3] Skipping build (-SkipBuild)..."
}

if (-not (Test-Path $distDir)) {
  throw "site/dist not found after build at $distDir."
}

$distFiles = Get-ChildItem -Path $distDir -Recurse -File
$totalMB = [math]::Round(($distFiles | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host "  Built $($distFiles.Count) files; total $totalMB MB."
Write-Host ""

# --- 2. Sync to S3 ------------------------------------------------------------
Write-Host "[2/3] Syncing site/dist -> s3://$Bucket/ ..."
$syncArgs = @(
  "s3", "sync",
  $distDir,
  "s3://$Bucket/",
  "--region", $Region,
  "--delete"
)
if ($DryRun) { $syncArgs += "--dryrun" }

aws @syncArgs
if ($LASTEXITCODE -ne 0) { throw "aws s3 sync failed (exit $LASTEXITCODE)" }
Write-Host ""

if ($DryRun) {
  Write-Host "DryRun complete. No files uploaded, no invalidation issued."
  exit 0
}

# --- 3. Resolve CloudFront distribution + invalidate --------------------------
if (-not $DistributionId) {
  Write-Host "[3/3] Resolving CloudFront distribution ID from terraform output..."
  Push-Location (Join-Path $repoRoot "infra/terraform")
  try {
    $DistributionId = (terraform output -raw site_cloudfront_distribution_id 2>$null).Trim()
  } finally {
    Pop-Location
  }
}

if (-not $DistributionId) {
  Write-Warning "No CloudFront distribution ID resolved (terraform output empty, no -DistributionId param). Skipping invalidation."
  Write-Warning "Pass -DistributionId E123ABCDEF to invalidate manually."
} else {
  Write-Host "[3/3] Invalidating CloudFront distribution $DistributionId (paths: /*)..."
  $invalidationId = aws cloudfront create-invalidation `
    --distribution-id $DistributionId `
    --paths "/*" `
    --region $Region `
    --query "Invalidation.Id" `
    --output text
  if ($LASTEXITCODE -ne 0) { throw "CloudFront invalidation failed (exit $LASTEXITCODE)" }
  Write-Host "  Invalidation $invalidationId created. Edge propagation typically 1-5 minutes."
}

Write-Host ""
Write-Host "== deploy-site OK ================================================"

# Print CloudFront domain so the deployer can smoke test directly without DNS.
if ((Test-Path (Join-Path $repoRoot "infra/terraform"))) {
  Push-Location (Join-Path $repoRoot "infra/terraform")
  try {
    $cfDomain = (terraform output -raw site_cloudfront_domain_name 2>$null).Trim()
    if ($cfDomain) {
      Write-Host "CloudFront domain: https://$cfDomain"
      Write-Host ""
      Write-Host "Smoke test (before DNS flip):"
      Write-Host "  curl -I https://$cfDomain/"
      Write-Host "  curl -I https://$cfDomain/about.html"
      Write-Host ""
      Write-Host "Smoke test (after DNS flip):"
      Write-Host "  curl -I https://www.cpg-labs.io/"
      Write-Host "  curl -I https://cpg-labs.io/"
    }
  } finally {
    Pop-Location
  }
}
