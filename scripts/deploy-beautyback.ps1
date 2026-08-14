param(
  # Override the auto-generated tag. Format: <yyyymmdd>-<short-sha>.
  [string]$Tag = "",

  [switch]$SkipBuild,
  [switch]$SkipHealthCheck,
  [switch]$VerboseMode
)

# -----------------------------------------------------------------------------
# deploy-beautyback.ps1 -- deploy the BeautyBack app (apps/sales-whatsapp)
# to the shared Lightsail box, path-routed at apps.gebeauty.com.br/beautyback.
#
# Same Lightsail pattern as deploy-omnify-admin.ps1, simplified to one app /
# one image (no multi-identity fan-out). Reuses the "nami-works" ECR repo
# (same repo the connector deploys into) with a "beautyback-" tag prefix,
# rather than provisioning a new repo per app.
#
# Prerequisites this script does NOT do for you (one-time, do first):
#   1. DNS: apps.gebeauty.com.br A record -> 54.221.23.142 (registro.br).
#   2. /etc/cpg-labs/beautyback.env on the box (SHOPIFY_API_KEY,
#      SHOPIFY_API_SECRET, DATABASE_URL — a new `beautyback` database on the
#      shared cpg-labs-postgres container, matching the other apps' pattern).
#   3. Caddyfile: add the /beautyback path route under apps.gebeauty.com.br
#      (see docs/handoff-ge-sales-whatsapp-app.md for the exact block —
#      must NOT strip the /beautyback prefix, since BASE_PATH is baked into
#      the build to match it).
#   4. docker-compose.yml: add the `beautyback` service (host 3100 -> 3000).
#
# Usage:
#   ./scripts/deploy-beautyback.ps1
#   ./scripts/deploy-beautyback.ps1 -SkipBuild -Tag 20260814-ba8eee4
# -----------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
if ($VerboseMode) { Set-PSDebug -Trace 1 }

Import-Module (Join-Path $PSScriptRoot "omnify/_deploy-common.psm1") -Force

$LightsailIp   = "54.221.23.142"
$LightsailUser = "ubuntu"
$LightsailHost = "$LightsailUser@$LightsailIp"
$LightsailKey  = Join-Path $HOME ".ssh/cpg-labs-lightsail.pem"
$EcrRegistry   = "477780048372.dkr.ecr.us-east-1.amazonaws.com"
$EcrRepo       = "$EcrRegistry/nami-works"
$Region        = "us-east-1"
$ComposePath   = "/srv/cpg-labs/docker-compose.yml"
$ComposeService = "beautyback"
$HealthUrl     = "https://apps.gebeauty.com.br/beautyback/health"

function Invoke-LightsailSsh {
  param([Parameter(Mandatory=$true)][string]$Command)
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & ssh -i $LightsailKey -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o BatchMode=yes -o ConnectTimeout=10 $LightsailHost $Command 2>&1 | Out-Host
  } finally {
    $ErrorActionPreference = $prevEap
  }
  if ($LASTEXITCODE -ne 0) {
    throw "SSH to $LightsailHost failed (exit $LASTEXITCODE): $Command"
  }
}

function Test-PublicHealth {
  param([Parameter(Mandatory=$true)][string]$Url)
  for ($i = 1; $i -le 10; $i++) {
    try {
      $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($resp.StatusCode -eq 200) {
        Write-Host "  [health] $Url -> HTTP 200 (attempt $i)" -ForegroundColor Green
        return $true
      }
    } catch {}
    if ($i -lt 10) { Start-Sleep -Seconds 5 }
  }
  Write-Host "  [health] $Url -> FAILED after 10 attempts" -ForegroundColor Red
  return $false
}

Write-Host ""
Write-Host "=== deploy-beautyback.ps1 ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $LightsailKey)) {
  throw "Lightsail SSH key not found at $LightsailKey."
}

Assert-CleanWorkingTree -ShippablePathPrefixes @(
  'apps/sales-whatsapp/',
  'prisma/sales-whatsapp/',
  'tsconfig.base.json',
  'package.json',
  'package-lock.json'
)

if (-not $Tag) {
  if ($SkipBuild) { throw "-SkipBuild requires an explicit -Tag." }
  $Sha = (git rev-parse --short HEAD).Trim()
  $Date = Get-Date -Format "yyyyMMdd"
  $Tag = "$Date-$Sha"
}
$Image = "${EcrRepo}:beautyback-${Tag}"
Write-Host "  Image: $Image" -ForegroundColor Cyan

if (-not $SkipBuild) {
  Write-Host ""
  Write-Host "  [build] docker build (linux/amd64)..." -ForegroundColor Cyan
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & docker buildx build --platform linux/amd64 -f apps/sales-whatsapp/Dockerfile -t $Image . 2>&1 | Out-Host
  } finally {
    $ErrorActionPreference = $prevEap
  }
  if ($LASTEXITCODE -ne 0) { throw "docker build failed (exit $LASTEXITCODE)" }

  Write-Host ""
  Write-Host "  [ecr-login] local docker login..." -ForegroundColor Cyan
  $ecrPassword = (& aws ecr get-login-password --region $Region).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($ecrPassword)) {
    throw "aws ecr get-login-password failed or returned empty"
  }
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & docker login --username AWS --password $ecrPassword $EcrRegistry 2>&1 | Out-Null
  } finally {
    $ErrorActionPreference = $prevEap
  }
  if ($LASTEXITCODE -ne 0) { throw "docker login failed" }

  Write-Host ""
  Write-Host "  [push] $Image" -ForegroundColor Cyan
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & docker push $Image 2>&1 | Out-Host
  } finally {
    $ErrorActionPreference = $prevEap
  }
  if ($LASTEXITCODE -ne 0) { throw "docker push failed (exit $LASTEXITCODE)" }
} else {
  Write-Host ""
  Write-Host "  [skip-build] using existing image: $Image" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  [lightsail] refreshing ECR auth on $LightsailIp..." -ForegroundColor Cyan
$ecrToken = (& aws ecr get-login-password --region $Region).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($ecrToken)) {
  throw "aws ecr get-login-password failed or returned empty"
}
$tokenB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($ecrToken))
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  & ssh -i $LightsailKey -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o BatchMode=yes -o ConnectTimeout=10 $LightsailHost "echo '$tokenB64' | base64 -d | sudo docker login --username AWS --password-stdin $EcrRegistry" 2>&1 | Out-Host
} finally {
  $ErrorActionPreference = $prevEap
}
if ($LASTEXITCODE -ne 0) {
  throw "SSH docker login on Lightsail failed (exit $LASTEXITCODE)."
}

Write-Host ""
Write-Host "  [lightsail] updating compose tag..." -ForegroundColor Cyan
Invoke-LightsailSsh "sudo sed -i 's|nami-works:beautyback-[A-Za-z0-9-]\+|nami-works:beautyback-${Tag}|g' $ComposePath && grep -A1 'beautyback:' $ComposePath"

Write-Host ""
Write-Host "  [lightsail] docker compose pull + up -d $ComposeService..." -ForegroundColor Cyan
Invoke-LightsailSsh "cd /srv/cpg-labs && sudo docker compose pull $ComposeService && sudo docker compose up -d $ComposeService"

if (-not $SkipHealthCheck) {
  Write-Host ""
  Write-Host "  [health] waiting 25s for boot, then polling..." -ForegroundColor Cyan
  Start-Sleep -Seconds 25
  $ok = Test-PublicHealth -Url $HealthUrl
  if (-not $ok) {
    throw "Health check failed. Investigate via: ssh -i $LightsailKey $LightsailHost 'sudo docker compose logs beautyback --tail 100'"
  }
} else {
  Write-Host ""
  Write-Host "  [skip-health-check] skipping post-deploy health verification" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== deploy-beautyback.ps1 COMPLETE -- Tag=$Tag ===" -ForegroundColor Green
Write-Host "  Add a Deployed entry to .claude/deploy-queue.md if this was a real deploy." -ForegroundColor Yellow
