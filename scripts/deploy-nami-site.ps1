param(
  [string]$Region        = "us-east-1",
  [string]$Bucket        = "",
  [string]$DistributionId = "",
  [switch]$SkipBuild,
  [switch]$DryRun
)

# ----------------------------------------------------------------------------
# deploy-nami-site.ps1 -- deploy the public site at nami.works.
#
# Requires infra/nami-site/terraform to have been applied at least once (S3
# bucket + CloudFront distribution + Route53 alias records). If -Bucket /
# -DistributionId are not passed explicitly, this script resolves them from
# that module's terraform outputs. Running this before the first `terraform
# apply` will fail cleanly at the resolve step below with a clear message.
#
# Distinct from deploy-omnify-site.ps1 (which ships cpg-labs.io): this one
# targets apps/nami-site, a separate static Astro app with no Docker, no ECS,
# no task definition, and its own (separate) Terraform state.
#
# Pipeline:
#   1. cd apps/nami-site && npm run build   (Astro static output -> dist/)
#   2. aws s3 sync apps/nami-site/dist s3://...   (with --delete to prune)
#   3. aws cloudfront create-invalidation /*      (force edge refresh)
#
# Usage:
#   ./scripts/deploy-nami-site.ps1                       # build + push + invalidate
#   ./scripts/deploy-nami-site.ps1 -SkipBuild            # if you already ran npm run build
#   ./scripts/deploy-nami-site.ps1 -DryRun               # show what would change without uploading
#   ./scripts/deploy-nami-site.ps1 -Bucket b -DistributionId E123  # override terraform lookup
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

$repoRoot     = Resolve-RepoRoot
$appDir       = Join-Path $repoRoot "apps/nami-site"
$distDir      = Join-Path $appDir "dist"
$terraformDir = Join-Path $repoRoot "infra/nami-site/terraform"

if (-not (Test-Path $appDir)) {
  throw "apps/nami-site not found at $appDir. Are you on the right branch?"
}

# --- 0. Resolve bucket / distribution ID from terraform outputs, if not passed --
if (-not $Bucket -or -not $DistributionId) {
  if (-not (Test-Path $terraformDir)) {
    throw "infra/nami-site/terraform not found at $terraformDir -- cannot resolve bucket/distribution."
  }
  Write-Host "[0/3] Resolving bucket + distribution ID from terraform outputs..."
  Push-Location $terraformDir
  try {
    if (-not $Bucket) {
      $Bucket = (terraform output -raw site_bucket_name 2>$null).Trim()
    }
    if (-not $DistributionId) {
      $DistributionId = (terraform output -raw site_cloudfront_distribution_id 2>$null).Trim()
    }
  } finally {
    Pop-Location
  }
  if (-not $Bucket) {
    throw "Could not resolve S3 bucket name from terraform outputs. Has 'terraform apply' been run in $terraformDir yet? Pass -Bucket explicitly to override."
  }
  if (-not $DistributionId) {
    Write-Warning "Could not resolve CloudFront distribution ID from terraform outputs. Invalidation will be skipped unless -DistributionId is passed."
  }
}

Write-Host "== deploy-nami-site =============================================="
Write-Host "Repo root:       $repoRoot"
Write-Host "App dir:         $appDir"
Write-Host "S3 bucket:       $Bucket"
Write-Host "Distribution ID: $(if ($DistributionId) { $DistributionId } else { '(none -- invalidation will be skipped)' })"
Write-Host "Region:          $Region"
Write-Host "DryRun:          $DryRun"
Write-Host ""

# --- 1. Build (unless -SkipBuild) ---------------------------------------------
if (-not $SkipBuild) {
  Write-Host "[1/3] Building site (npm run build)..."
  Push-Location $appDir
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
  throw "apps/nami-site/dist not found after build at $distDir."
}

$distFiles = Get-ChildItem -Path $distDir -Recurse -File
$totalMB = [math]::Round(($distFiles | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host "  Built $($distFiles.Count) files; total $totalMB MB."
Write-Host ""

# --- 2. Sync to S3 ------------------------------------------------------------
Write-Host "[2/3] Syncing apps/nami-site/dist -> s3://$Bucket/ ..."
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

# --- 3. Invalidate CloudFront distribution ------------------------------------
if (-not $DistributionId) {
  Write-Warning "No CloudFront distribution ID resolved or provided. Skipping invalidation."
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
Write-Host "== deploy-nami-site OK ============================================"
Write-Host "Smoke test: curl -I https://nami.works/"
