param(
  [Parameter(Mandatory = $true)]
  [string]$App,
  [string]$Region     = "us-east-1",
  [string]$Repository = "477780048372.dkr.ecr.us-east-1.amazonaws.com/omnify-app",
  [string]$Tag        = "",
  [bool]$NoCache      = $true
)

# ──────────────────────────────────────────────────────────────────────────────
# deploy.ps1 — single entry point for building + shipping any Shopify app that
# lives in this repo. Replaces the five legacy `deploy-*.ps1` scripts.
#
# Usage:
#   ./scripts/deploy.ps1 -App full
#   ./scripts/deploy.ps1 -App omnify
#   ./scripts/deploy.ps1 -App storytelling -Tag cpg-labs-storytelling-20260422-abc1234
#
# App config comes from `scripts/apps.psd1` — service, task family, health URL,
# tag prefix. Adding a new app is a one-line edit there, zero lines here.
#
# Up-front guards (from `_deploy-common.psm1`, ships with the `guards` subagent):
#   - canonical cluster check
#   - no split-brain (no tasks running on a non-canonical cluster)
#   - clean working tree (no uncommitted changes get silently baked into COPY .)
# Post-deploy guard: exactly one task-def revision healthy in the TG.
#
# BASE_PATH is intentionally NOT passed to the docker build — Phase 6a retires
# BASE_PATH in favor of dedicated hostnames per app. If a legacy deployment
# still needs a basename, set it via task-def env vars on the Terraform side.
# ──────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

$CanonicalCluster = "cpg-labs"

# ── helpers ───────────────────────────────────────────────────────────────────

function Invoke-Aws {
  aws @args
  if ($LASTEXITCODE -ne 0) { throw "AWS CLI failed (exit $LASTEXITCODE): aws $args" }
}

function Ensure-DockerRunning {
  docker info 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { return }
  Write-Host "Docker does not appear to be running. Starting Docker Desktop..."

  $dockerDesktop = Join-Path $Env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  if (-not (Test-Path $dockerDesktop)) {
    $dockerDesktop = Join-Path ${Env:ProgramFiles(x86)} "Docker\Docker\Docker Desktop.exe"
  }
  if (-not (Test-Path $dockerDesktop)) {
    throw "Docker Desktop not found. Please start Docker manually."
  }

  $dockerProcess = Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue
  if (-not $dockerProcess) { Start-Process $dockerDesktop | Out-Null }

  $timeout = [DateTime]::UtcNow.AddSeconds(90)
  while ([DateTime]::UtcNow -lt $timeout) {
    docker info 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "Docker is running."; return }
    Write-Host "  Waiting for Docker to start..."
    Start-Sleep -Seconds 5
  }
  throw "Docker did not start in time. Please start Docker manually."
}

function Cleanup-StaleTargets {
  param([string]$ClusterName, [string]$ServiceName, [string]$RegionName)
  Write-Host "`nAuditing ALB target group for stale targets..."

  $tgArn = aws ecs describe-services --cluster $ClusterName --services $ServiceName --region $RegionName --query "services[0].loadBalancers[0].targetGroupArn" --output text
  if (-not $tgArn -or $tgArn -eq "None") { Write-Host "  No target group found -skipping."; return }

  $taskArnsJson = aws ecs list-tasks --cluster $ClusterName --service-name $ServiceName --region $RegionName --query "taskArns" --output json
  $taskArns = ($taskArnsJson | ConvertFrom-Json)
  if ($taskArns.Count -eq 0) { Write-Host "  No running tasks -skipping."; return }

  $validIps = @()
  foreach ($arn in $taskArns) {
    $shortId = ($arn -split "/")[-1]
    $ip = aws ecs describe-tasks --cluster $ClusterName --tasks $shortId --region $RegionName --query "tasks[0].containers[0].networkInterfaces[0].privateIpv4Address" --output text
    if ($ip -and $ip -ne "None") { $validIps += $ip }
  }
  Write-Host ("  Valid task IPs: {0}" -f ($validIps -join ", "))

  $healthJson = aws elbv2 describe-target-health --target-group-arn $tgArn --region $RegionName --output json
  $targets = ($healthJson | ConvertFrom-Json).TargetHealthDescriptions

  $staleCount = 0
  foreach ($t in $targets) {
    if ($t.Target.Id -notin $validIps) {
      Write-Host ("  Deregistering stale target: {0}:{1} (state: {2})" -f $t.Target.Id, $t.Target.Port, $t.TargetHealth.State)
      aws elbv2 deregister-targets --target-group-arn $tgArn --targets ("Id={0},Port={1}" -f $t.Target.Id, $t.Target.Port) --region $RegionName | Out-Null
      $staleCount++
    }
  }
  if ($staleCount -eq 0) { Write-Host "  Target group clean -no stale targets." }
  else { Write-Host ("  Removed {0} stale target(s)." -f $staleCount) }
}

# ── guards-module import (graceful fallback) ──────────────────────────────────
#
# `_deploy-common.psm1` and `_cluster.psm1` are written by the `guards`
# subagent. If that agent hasn't landed yet, we log a warning and skip the
# pre-deploy assertions rather than blocking the deploy entirely — the old
# per-service scripts had no guards either, so a deploy without them isn't
# a regression.
$guardsModulePath  = Join-Path $PSScriptRoot "_deploy-common.psm1"
$clusterModulePath = Join-Path $PSScriptRoot "_cluster.psm1"
$guardsLoaded = $false
if ((Test-Path $guardsModulePath) -and (Test-Path $clusterModulePath)) {
  try {
    Import-Module $clusterModulePath -Force -DisableNameChecking
    Import-Module $guardsModulePath  -Force -DisableNameChecking
    $guardsLoaded = $true
  } catch {
    Write-Warning ("Guards module import failed: {0}. Continuing without pre-deploy assertions." -f $_.Exception.Message)
  }
} else {
  Write-Warning "Guards modules (_deploy-common.psm1, _cluster.psm1) not found. Continuing without pre-deploy assertions."
}

# ── manifest lookup ───────────────────────────────────────────────────────────

$manifestPath = Join-Path $PSScriptRoot "apps.psd1"
if (-not (Test-Path $manifestPath)) { throw ("Manifest not found: {0}" -f $manifestPath) }
$manifest = Import-PowerShellDataFile $manifestPath

if (-not $manifest.ContainsKey($App)) {
  $known = ($manifest.Keys | Sort-Object) -join ", "
  throw ("Unknown app '{0}'. Known apps in apps.psd1: {1}" -f $App, $known)
}
$cfg = $manifest[$App]
$service       = $cfg.service
$taskFamily    = $cfg.task_family
$healthUrl     = $cfg.health_url
$tagPrefix     = $cfg.tag_prefix

Write-Host ("`nDeploying app '{0}'" -f $App) -ForegroundColor Cyan
Write-Host ("  service     : {0}" -f $service)
Write-Host ("  task_family : {0}" -f $taskFamily)
Write-Host ("  health_url  : {0}" -f $healthUrl)
Write-Host ("  tag_prefix  : {0}" -f $tagPrefix)
Write-Host ("  cluster     : {0}" -f $CanonicalCluster)

# ── pre-deploy guards ─────────────────────────────────────────────────────────

if ($guardsLoaded) {
  Write-Host "`nRunning pre-deploy assertions..."
  try {
    Assert-CanonicalCluster $CanonicalCluster
    Assert-NoSplitBrain
    Assert-CleanWorkingTree
  } catch {
    Write-Error ("Pre-deploy guard failed: {0}" -f $_.Exception.Message)
    throw
  }
}

# ── tag generation ────────────────────────────────────────────────────────────

if ([string]::IsNullOrWhiteSpace($Tag)) {
  if ($guardsLoaded -and (Get-Command New-AppImageTag -ErrorAction SilentlyContinue)) {
    $Tag = New-AppImageTag -AppName $App
  } else {
    $gitSha = (git rev-parse --short HEAD).Trim()
    if ([string]::IsNullOrWhiteSpace($gitSha)) { throw "Could not resolve git short SHA." }
    $Tag = "{0}-{1}-{2}" -f $tagPrefix, (Get-Date -Format "yyyyMMdd"), $gitSha
  }
}
Write-Host ("  image tag   : {0}" -f $Tag)

# ── build + push ──────────────────────────────────────────────────────────────

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot
try {
  Ensure-DockerRunning

  $currentTaskDef = aws ecs describe-services --cluster $CanonicalCluster --services $service --region $Region --query "services[0].taskDefinition" --output text
  if (-not $currentTaskDef -or $currentTaskDef -eq "None") {
    throw ("ECS service '{0}' not found in cluster '{1}'." -f $service, $CanonicalCluster)
  }
  $currentImage = aws ecs describe-task-definition --task-definition $currentTaskDef --region $Region --query "taskDefinition.containerDefinitions[0].image" --output text
  Write-Host ("Currently running image: {0}" -f $currentImage)

  Write-Host "Logging into ECR..."
  $registry = ($Repository -split "/")[0]
  # PS 5.1 + UTF-8: piping `aws ecr get-login-password | docker login --password-stdin`
  # garbles the token via Windows codepage encoding, producing 400 Bad Request from
  # ECR. Capture to a variable and pass via --password instead. The insecure-password
  # warning docker emits to stderr is downgraded with $ErrorActionPreference=Continue
  # because $EAP=Stop turns it into a NativeCommandError. Same fix as rev 39 deploy.
  $ecrPassword = (aws ecr get-login-password --region $Region).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($ecrPassword)) {
    throw "Failed to fetch ECR login password. Aborting deploy."
  }
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    docker login --username AWS --password $ecrPassword $registry 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "ECR login failed. Retrying after docker logout..."
      docker logout $registry 2>&1 | Out-Null
      docker login --username AWS --password $ecrPassword $registry 2>&1 | Out-Null
    }
  } finally {
    $ErrorActionPreference = $prevEap
  }
  if ($LASTEXITCODE -ne 0) { throw "ECR login failed. Aborting deploy." }

  Write-Host ("Building image (NoCache={0})..." -f $NoCache)
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    if ($attempt -gt 1) { Write-Host ("Retrying docker build (attempt {0})..." -f $attempt) }
    if ($NoCache) {
      docker build --no-cache -t ("{0}:{1}" -f $Repository, $Tag) .
    } else {
      docker build -t ("{0}:{1}" -f $Repository, $Tag) .
    }
    if ($LASTEXITCODE -eq 0) { break }
    Write-Host "Docker build failed. Attempting to pull base image and retry..."
    docker pull node:20-alpine | Out-Null
  }
  if ($LASTEXITCODE -ne 0) { throw "Docker build failed. Aborting deploy." }

  Write-Host "Pushing image..."
  docker push ("{0}:{1}" -f $Repository, $Tag)
  if ($LASTEXITCODE -ne 0) { throw "Docker push failed. Aborting deploy." }

  # ── register new task-def revision ──────────────────────────────────────────
  #
  # Copy env + secrets from the previous revision VERBATIM. Update the image
  # only. Terraform owns the `secrets` field (SSM ARNs) now, so the deploy
  # script must not re-derive it from SSM. This is the pre-bug behavior —
  # the split-brain incident was caused by a Python reconciliation block that
  # rewrote `secrets[]` based on SSM scan results; removing it is the fix.
  Write-Host "Registering new task-definition revision..."
  $tmpJson = Join-Path $repoRoot ("tmp-{0}-task.json" -f $service)
  $env:CPG_TASK_FAMILY = $taskFamily
  $env:CPG_REGION      = $Region
  $env:CPG_IMAGE       = ("{0}:{1}" -f $Repository, $Tag)
  $env:CPG_TMP_JSON    = $tmpJson

  $pyScript = Join-Path $repoRoot "tmp-update-task.py"
  $pyCode = @'
import json, os, subprocess
data = json.loads(subprocess.check_output(
    ['aws', 'ecs', 'describe-task-definition',
     '--task-definition', os.environ['CPG_TASK_FAMILY'],
     '--region', os.environ['CPG_REGION']], text=True))
td = data['taskDefinition']
# Strip fields that register-task-definition won't accept back.
for k in ['taskDefinitionArn', 'revision', 'status', 'requiresAttributes',
          'compatibilities', 'registeredAt', 'registeredBy']:
    td.pop(k, None)
# Update only the image; env + secrets come through unchanged.
td['containerDefinitions'][0]['image'] = os.environ['CPG_IMAGE']
with open(os.environ['CPG_TMP_JSON'], 'w', encoding='utf-8') as f:
    f.write(json.dumps(td))
'@
  Set-Content -Path $pyScript -Value $pyCode -Encoding UTF8
  python $pyScript
  Remove-Item $pyScript -ErrorAction SilentlyContinue

  $rev = aws ecs register-task-definition --cli-input-json ("file://{0}" -f $tmpJson) --region $Region --query "taskDefinition.revision" --output text
  Remove-Item $tmpJson -ErrorAction SilentlyContinue
  Write-Host ("Deploying task definition revision {0}..." -f $rev)

  aws ecs update-service --cluster $CanonicalCluster --service $service --task-definition ("{0}:{1}" -f $taskFamily, $rev) --region $Region | Out-Null
  aws ecs wait services-stable --cluster $CanonicalCluster --services $service --region $Region
  $readyQuery = 'services[0].{rollout:deployments[0].rolloutState, running:runningCount, taskDef:taskDefinition}'
  aws ecs describe-services --cluster $CanonicalCluster --services $service --region $Region --query $readyQuery --output table

  # ── post-deploy smoke test ──────────────────────────────────────────────────
  if ($healthUrl) {
    Write-Host ("Smoke testing {0} ..." -f $healthUrl)
    $ok = $false
    for ($i = 1; $i -le 10; $i++) {
      try {
        $resp = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 0 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { Write-Host ("  attempt {0} -> 200 OK" -f $i); $ok = $true; break }
        Write-Host ("  attempt {0} -> {1}" -f $i, $resp.StatusCode)
      } catch {
        Write-Host ("  attempt {0} -> {1}" -f $i, $_.Exception.Message)
      }
      Start-Sleep -Seconds 6
    }
    if (-not $ok) { throw ("Smoke test FAILED: {0} did not return 200 after 10 attempts." -f $healthUrl) }
    Write-Host "Smoke test passed."
  }

  # ── post-deploy guard: single revision in TG ────────────────────────────────
  if ($guardsLoaded -and (Get-Command Assert-SingleTaskDefInTargetGroup -ErrorAction SilentlyContinue)) {
    Assert-SingleTaskDefInTargetGroup -Cluster $CanonicalCluster -Service $service -Region $Region
  }

  Cleanup-StaleTargets -ClusterName $CanonicalCluster -ServiceName $service -RegionName $Region

  Write-Host ("`nDeploy OK: app={0} image={1}:{2} revision={3}" -f $App, $Repository, $Tag, $rev) -ForegroundColor Green
} finally {
  Pop-Location
}
