param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('full', 'omnify', 'both')]
  [string]$App,

  # Override the auto-generated tag. Mostly useful for -SkipBuild redeploys.
  # Format: <yyyymmdd>-<short-sha>, e.g. "20260511-e419924".
  [string]$Tag = "",

  # Skip docker build + push, assume the image is already in ECR with the
  # given -Tag. Useful for re-running a deploy after a transient SSH/Caddy
  # failure without spending 3 min rebuilding the same code.
  [switch]$SkipBuild,

  # Skip the health-check polling at the end. Useful in scripted pipelines
  # where the caller does its own verification.
  [switch]$SkipHealthCheck,

  # Print every command before running. Use when debugging a failed deploy.
  [switch]$VerboseMode
)

# -----------------------------------------------------------------------------
# deploy.ps1 -- canonical deploy script for the Lightsail-hosted prod stack.
#
# Production runs on Lightsail (54.221.23.142) as of the 2026-05-11 cutover.
# This script:
#   1. Asserts a clean working tree (Dockerfile uses COPY .)
#   2. Builds ONE image tagged twice (full + omnify share the same image;
#      they differ only in APP_IDENTITY env var at runtime)
#   3. Pushes both tags to ECR
#   4. SSHs to Lightsail, refreshes ECR auth on the box, pulls new images
#   5. Updates /srv/cpg-labs/docker-compose.yml to the new tag(s)
#   6. Restarts the specified service(s) via `docker compose up -d`
#   7. Polls the public /health endpoint until 200 (or 10 attempts)
#
# Usage:
#   ./scripts/deploy.ps1 -App full     # rebuild + restart cpg-labs-full only
#   ./scripts/deploy.ps1 -App omnify   # same, omnify container only
#   ./scripts/deploy.ps1 -App both     # build once, restart both containers
#   ./scripts/deploy.ps1 -App full -SkipBuild -Tag 20260511-e419924
#                                      # re-deploy an existing image
#
# Rollback to ECS (only before 2026-05-18): use scripts/deploy-ecs-legacy.ps1
# after scaling ECS back up + flipping DNS at GoDaddy. See
# memory/project_lightsail_migration_completed.md for the full procedure.
# -----------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
if ($VerboseMode) { Set-PSDebug -Trace 1 }

Import-Module (Join-Path $PSScriptRoot "_deploy-common.psm1") -Force

# -- Constants ----------------------------------------------------------------

$LightsailIp     = "54.221.23.142"
$LightsailUser   = "ubuntu"
$LightsailHost   = "$LightsailUser@$LightsailIp"
$LightsailKey    = Join-Path $HOME ".ssh/cpg-labs-lightsail.pem"
$EcrRegistry     = "477780048372.dkr.ecr.us-east-1.amazonaws.com"
$EcrRepo         = "$EcrRegistry/omnify-app"
$Region          = "us-east-1"
$ComposePath     = "/srv/cpg-labs/docker-compose.yml"

# App spec -- single source of truth.
# `compose_service` matches the service name in /srv/cpg-labs/docker-compose.yml.
# `container_name` is the docker container name (for log inspection).
# `tag_prefix` is the prefix on ECR image tags ('full-' or 'omnify-').
# `health_url` is the public URL hit after deploy to verify Caddy + container.
$Apps = @{
  'full'   = @{
    container_name  = 'cpg-labs-full'
    compose_service = 'full'
    tag_prefix      = 'full'
    health_url      = 'https://app.cpg-labs.io/health'
  }
  'omnify' = @{
    container_name  = 'cpg-labs-omnify'
    compose_service = 'omnify'
    tag_prefix      = 'omnify'
    health_url      = 'https://omnify.cpg-labs.io/health'
  }
}

# -- Helpers ------------------------------------------------------------------

function Invoke-LightsailSsh {
  param([Parameter(Mandatory=$true)][string]$Command)
  & ssh -i $LightsailKey -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL $LightsailHost $Command
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
    } catch {
      # 5xx during boot is expected; only the final attempt matters
    }
    if ($i -lt 10) {
      Start-Sleep -Seconds 5
    }
  }
  Write-Host "  [health] $Url -> FAILED after 10 attempts" -ForegroundColor Red
  return $false
}

# -- Pre-flight ---------------------------------------------------------------

Write-Host ""
Write-Host "=== deploy.ps1 (Lightsail) -- App=$App ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $LightsailKey)) {
  throw "Lightsail SSH key not found at $LightsailKey. Provision via 'aws lightsail download-default-key-pair' or restore from password manager."
}

# Assert-CleanWorkingTree filters out .dockerignored paths, so unrelated
# dirty docs/inputs don't gate the deploy. Only paths that would actually
# leak into COPY . trigger the throw.
Assert-CleanWorkingTree

# Compute tag if not provided. -SkipBuild requires an explicit -Tag.
if (-not $Tag) {
  if ($SkipBuild) {
    throw "-SkipBuild requires an explicit -Tag (which image to deploy?)."
  }
  $Sha = (git rev-parse --short HEAD).Trim()
  $Date = Get-Date -Format "yyyyMMdd"
  $Tag = "$Date-$Sha"
}
Write-Host "  Tag: $Tag" -ForegroundColor Cyan

# Resolve which apps we're deploying.
$AppKeys = if ($App -eq 'both') { @('full', 'omnify') } else { @($App) }

# Compute the full tagged image refs.
$FullImage   = "${EcrRepo}:full-${Tag}"
$OmnifyImage = "${EcrRepo}:omnify-${Tag}"

# -- Build + push -------------------------------------------------------------

if (-not $SkipBuild) {
  Write-Host ""
  Write-Host "  [build] docker build (tagged for both apps)..." -ForegroundColor Cyan
  & docker build -t $FullImage -t $OmnifyImage .
  if ($LASTEXITCODE -ne 0) { throw "docker build failed" }

  Write-Host ""
  Write-Host "  [ecr-login] aws ecr get-login-password -> docker login..." -ForegroundColor Cyan
  # PS 5.1 + UTF-8 pipeline quirk: piping `aws ecr get-login-password | docker login
  # --password-stdin` garbles the token via Windows codepage encoding, producing
  # 400 Bad Request from ECR. Capture to a variable, trim, and pass via --password.
  # docker's "using --password is insecure" warning is emitted to stderr; under
  # $EAP=Stop PowerShell wraps it as NativeCommandError and aborts. Downgrade EAP
  # to Continue for that one call. Same workaround as deploy-ecs-legacy.ps1:192.
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
  Write-Host "  [push] $FullImage" -ForegroundColor Cyan
  & docker push $FullImage
  if ($LASTEXITCODE -ne 0) { throw "docker push (full) failed" }

  Write-Host "  [push] $OmnifyImage" -ForegroundColor Cyan
  & docker push $OmnifyImage
  if ($LASTEXITCODE -ne 0) { throw "docker push (omnify) failed" }
} else {
  Write-Host ""
  Write-Host "  [skip-build] using existing image $FullImage / $OmnifyImage" -ForegroundColor Yellow
}

# -- Refresh ECR auth on Lightsail --------------------------------------------

Write-Host ""
Write-Host "  [lightsail] refreshing ECR auth on $LightsailIp..." -ForegroundColor Cyan
$ecrToken = & aws ecr get-login-password --region $Region
if ($LASTEXITCODE -ne 0) { throw "aws ecr get-login-password failed" }
$ecrToken | & ssh -i $LightsailKey -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL $LightsailHost "sudo docker login --username AWS --password-stdin $EcrRegistry" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "SSH docker login on Lightsail failed (exit $LASTEXITCODE). Common causes: SSH key wrong, ECR token expired, or instance unreachable."
}

# -- Update docker-compose.yml on Lightsail -----------------------------------

# We use sed in place. The pattern matches any existing tag (full-* or
# omnify-*) for the relevant app(s) and replaces with the new tag.
$sedCommands = @()
foreach ($appKey in $AppKeys) {
  $newImageTag = "$($Apps[$appKey].tag_prefix)-$Tag"
  $sedCommands += "s|omnify-app:$($Apps[$appKey].tag_prefix)-[A-Za-z0-9-]\+|omnify-app:$newImageTag|g"
}
$sedExpr = ($sedCommands | ForEach-Object { "-e '$_'" }) -join " "
Write-Host "  [lightsail] updating compose tag(s): $sedExpr" -ForegroundColor Cyan
Invoke-LightsailSsh "sudo sed -i $sedExpr $ComposePath && grep image: $ComposePath"

# -- Pull + restart -----------------------------------------------------------

# `docker compose up -d <service>` recreates only the named services.
# `docker compose up -d` (no args) recreates all services in the compose file.
$composeServices = if ($App -eq 'both') { "" } else { $Apps[$App].compose_service }

Write-Host ""
Write-Host "  [lightsail] docker compose pull + up -d $composeServices..." -ForegroundColor Cyan
Invoke-LightsailSsh "cd /srv/cpg-labs && sudo docker compose pull $composeServices && sudo docker compose up -d $composeServices"

# -- Health check -------------------------------------------------------------

if (-not $SkipHealthCheck) {
  Write-Host ""
  Write-Host "  [health] waiting 25s for boot, then polling..." -ForegroundColor Cyan
  Start-Sleep -Seconds 25

  $allOk = $true
  foreach ($appKey in $AppKeys) {
    $ok = Test-PublicHealth -Url $Apps[$appKey].health_url
    if (-not $ok) { $allOk = $false }
  }

  if (-not $allOk) {
    throw "One or more apps failed health check. Investigate via: ssh -i $LightsailKey $LightsailHost 'sudo docker compose logs --tail 100'"
  }
} else {
  Write-Host ""
  Write-Host "  [skip-health-check] skipping post-deploy health verification" -ForegroundColor Yellow
}

# -- Done ---------------------------------------------------------------------

Write-Host ""
Write-Host "=== deploy.ps1 COMPLETE -- App=$App Tag=$Tag ===" -ForegroundColor Green
Write-Host ""
Write-Host "  Apps deployed: $($AppKeys -join ', ')" -ForegroundColor Green
foreach ($appKey in $AppKeys) {
  $taggedImage = "${EcrRepo}:$($Apps[$appKey].tag_prefix)-$Tag"
  Write-Host "    $($Apps[$appKey].container_name) -> $taggedImage" -ForegroundColor Green
}
Write-Host ""
Write-Host "  Add a Deployed entry to .claude/deploy-queue.md if this was a real deploy." -ForegroundColor Yellow
