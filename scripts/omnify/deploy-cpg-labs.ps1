param(
  [string]$Region = "us-east-1",
  [string]$Repository = "477780048372.dkr.ecr.us-east-1.amazonaws.com/omnify-app",
  [string]$Tag = "",
  [string]$BasePath = "/full",
  [string]$ShopifyAppUrl = "https://omnify.cpg-labs.io/full",
  [string]$Cluster = "cpg-labs",
  [string]$Service = "omnify-gebeauty-service",
  [string]$TaskFamily = "omnify-gebeauty-task",
  # BASE_PATH is baked into the client bundle by `npm run build` inside the
  # Dockerfile. Docker layer caching can silently reuse a build from a prior
  # invocation with a different BASE_PATH, producing a <Router basename="..."/>
  # that doesn't match the ALB path -> ALB 404s the health check -> ECS
  # crash-loops the task. Default to --no-cache on gebeauty builds to
  # eliminate this class of failure.
  [bool]$NoCache = $true,
  # External URL hit after deploy to verify the ALB sees a 200 from the app.
  # Must resolve to the same target as $Service.
  [string]$HealthCheckUrl = "https://omnify.cpg-labs.io/full/health"
)

$ErrorActionPreference = "Stop"

# ── Pre-flight guards (mini Phase 3a, 2026-04-22) ──────────────────────
# Imported from scripts/_deploy-common.psm1. Read-only, cheap. Guards
# against the two known failure modes we hit this week:
#   - Assert-CleanWorkingTree : prevents Docker `COPY .` from silently
#     shipping uncommitted files (hit in v16 with Phase 3 affiliates,
#     again in v18 with the Local Delivery mobile route).
#   - Assert-NoSplitBrain     : refuses to deploy while any non-canonical
#     cluster has running tasks (guards against accidental re-scaling of
#     the drained omnify-cluster during the remediation observation
#     window).
# Graceful fallback: if the guards module is missing (older branch /
# rebase), warn and continue rather than block.
$guardModule = Join-Path $PSScriptRoot "_deploy-common.psm1"
if (Test-Path $guardModule) {
  try {
    Import-Module $guardModule -Force -ErrorAction Stop
    Assert-CleanWorkingTree
    Assert-NoSplitBrain -Region $Region
    Write-Host "Pre-flight guards: OK"
  } catch {
    throw "Pre-flight guard failed: $($_.Exception.Message)"
  }
} else {
  Write-Warning "scripts/_deploy-common.psm1 not found, skipping pre-flight guards."
}

function Cleanup-StaleTargets {
  param(
    [string]$ClusterName,
    [string]$ServiceName,
    [string]$RegionName
  )
  Write-Host "`nAuditing ALB target group for stale targets..."

  $tgArn = aws ecs describe-services --cluster $ClusterName --services $ServiceName --region $RegionName --query "services[0].loadBalancers[0].targetGroupArn" --output text
  if (-not $tgArn -or $tgArn -eq "None") {
    Write-Host "  No target group found for $ServiceName -skipping."
    return
  }

  $taskArnsJson = aws ecs list-tasks --cluster $ClusterName --service-name $ServiceName --region $RegionName --query "taskArns" --output json
  $taskArns = ($taskArnsJson | ConvertFrom-Json)
  if ($taskArns.Count -eq 0) {
    Write-Host "  No running tasks -skipping."
    return
  }

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
    $tIp = $t.Target.Id
    $tPort = $t.Target.Port
    if ($tIp -notin $validIps) {
      Write-Host ("  Deregistering stale target: {0}:{1} (state: {2})" -f $tIp, $tPort, $t.TargetHealth.State)
      aws elbv2 deregister-targets --target-group-arn $tgArn --targets "Id=$tIp,Port=$tPort" --region $RegionName | Out-Null
      $staleCount++
    }
  }

  if ($staleCount -eq 0) {
    Write-Host "  Target group clean -no stale targets."
  } else {
    Write-Host ("  Removed {0} stale target(s)." -f $staleCount)
  }
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
  if (-not $dockerProcess) {
    Start-Process $dockerDesktop | Out-Null
  }

  $timeout = [DateTime]::UtcNow.AddSeconds(90)
  while ([DateTime]::UtcNow -lt $timeout) {
    docker info 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Docker is running."
      return
    }
    Write-Host "  Waiting for Docker to start..."
    Start-Sleep -Seconds 5
  }
  throw "Docker did not start in time. Please start Docker manually."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot
try {
  Ensure-DockerRunning
  $currentTaskDef = aws ecs describe-services --cluster $Cluster --services $Service --region $Region --query "services[0].taskDefinition" --output text
  $currentImage = aws ecs describe-task-definition --task-definition $currentTaskDef --region $Region --query "taskDefinition.containerDefinitions[0].image" --output text
  Write-Host "Currently running image: $currentImage"
  $currentTaskRegisteredAt = aws ecs describe-task-definition --task-definition $currentTaskDef --region $Region --query "taskDefinition.registeredAt" --output text
  Write-Host ("Current task definition registered at (UTC): {0}" -f $currentTaskRegisteredAt)
  $currentTag = ""
  if ($currentImage -like "*:*") {
    $currentTag = $currentImage.Split(":")[-1]
  }
  $suggestedTag = "full-v1"
  if ($currentTag -match '^(.*-v)(\d+)$') {
    $prefix = $Matches[1]
    $number = [int]$Matches[2]
    $suggestedTag = "{0}{1}" -f $prefix, ($number + 1)
  } elseif ($currentTag -match '^full-v(\d+)$') {
    $suggestedTag = "full-v{0}" -f ([int]$Matches[1] + 1)
  }
  Write-Host "Suggested next tag: $suggestedTag"
  if ([string]::IsNullOrWhiteSpace($Tag)) {
    $Tag = Read-Host ("Enter new image tag to deploy (default: {0})" -f $suggestedTag)
    if ([string]::IsNullOrWhiteSpace($Tag)) {
      $Tag = $suggestedTag
    }
  }

  Write-Host "Logging into ECR..."
  $registry = ($Repository -split "/")[0]
  aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin $registry
  if ($LASTEXITCODE -ne 0) {
    Write-Host "ECR login failed. Retrying after docker logout..."
    docker logout $registry | Out-Null
    aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin $registry
  }
  if ($LASTEXITCODE -ne 0) { throw "ECR login failed. Aborting deploy." }

  $cacheFlag = if ($NoCache) { "--no-cache" } else { "" }
  Write-Host "Building image with BASE_PATH=$BasePath NoCache=$NoCache..."
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    if ($attempt -gt 1) {
      Write-Host "Retrying docker build (attempt $attempt)..."
    }
    if ($NoCache) {
      docker build --no-cache --build-arg BASE_PATH=$BasePath -t "${Repository}:${Tag}" .
    } else {
      docker build --build-arg BASE_PATH=$BasePath -t "${Repository}:${Tag}" .
    }
    if ($LASTEXITCODE -eq 0) { break }
    Write-Host "Docker build failed. Attempting to pull base image and retry..."
    docker pull node:20-alpine | Out-Null
  }
  if ($LASTEXITCODE -ne 0) { throw "Docker build failed. Aborting deploy." }

  Write-Host "Pushing image..."
  docker push "${Repository}:${Tag}"
  if ($LASTEXITCODE -ne 0) { throw "Docker push failed. Aborting deploy." }

  Write-Host "Updating ECS task definition..."
  $env:OMNIFY_IMAGE = "${Repository}:${Tag}"
  $env:OMNIFY_BASE_PATH = $BasePath
  $env:OMNIFY_SHOPIFY_APP_URL = $ShopifyAppUrl
  $env:OMNIFY_TASK_FAMILY = $TaskFamily
  $env:OMNIFY_TMP_JSON = (Join-Path $repoRoot ("tmp-{0}-task.json" -f $Service))
  $env:OMNIFY_REGION = $Region

  # Write the task-definition update script to a temp file to avoid PowerShell
  # misinterpreting Python syntax (brackets, braces) as PS tokens.
  $pyScript = Join-Path $repoRoot "tmp-update-task.py"
  $pyCode = @'
import json, os, subprocess
data = json.loads(subprocess.check_output(
    ['aws', 'ecs', 'describe-task-definition',
     '--task-definition', os.environ['OMNIFY_TASK_FAMILY'],
     '--region', os.environ['OMNIFY_REGION']], text=True))
td = data['taskDefinition']
for k in ['taskDefinitionArn', 'revision', 'status', 'requiresAttributes',
          'compatibilities', 'registeredAt', 'registeredBy']:
    td.pop(k, None)
cd = td['containerDefinitions'][0]
cd['image'] = os.environ['OMNIFY_IMAGE']
env = {e['name']: e for e in cd.get('environment', [])}
bp = os.environ.get('OMNIFY_BASE_PATH', '')
if bp and bp != '/':
    env['BASE_PATH'] = {'name': 'BASE_PATH', 'value': bp}
else:
    env.pop('BASE_PATH', None)
url = os.environ.get('OMNIFY_SHOPIFY_APP_URL', '')
if url:
    env['SHOPIFY_APP_URL'] = {'name': 'SHOPIFY_APP_URL', 'value': url}
env['APP_IDENTITY'] = {'name': 'APP_IDENTITY', 'value': 'cpg-labs'}
cd['environment'] = list(env.values())

# Reconcile secrets[] from /omnify/* SSM params (single source of truth).
# Prevents drift when Terraform adds a new SSM-backed secret: the script's
# old behavior was to copy the previous revision's secrets verbatim, so new
# params never landed in subsequent deploys.
#
# Two services share the /omnify/* SSM namespace:
#   - omnify-service          -> /omnify/SHOPIFY_API_KEY / SHOPIFY_API_SECRET
#   - omnify-gebeauty-service -> /omnify/GEBEAUTY_SHOPIFY_API_KEY / _SECRET,
#     surfaced to the container as env SHOPIFY_API_KEY / SHOPIFY_API_SECRET.
#
# This script deploys gebeauty, so: skip the /omnify/SHOPIFY_* params (belong
# to the other service) and strip the GEBEAUTY_ prefix off env names.
region = os.environ['OMNIFY_REGION']
ssm_prefix = '/omnify/'
acct = json.loads(subprocess.check_output(
    ['aws', 'sts', 'get-caller-identity', '--output', 'json'], text=True))['Account']
ssm_resp = json.loads(subprocess.check_output([
    'aws', 'ssm', 'describe-parameters',
    '--parameter-filters', f'Key=Name,Option=BeginsWith,Values={ssm_prefix}',
    '--region', region, '--output', 'json',
], text=True))
secrets_by_name = {}
for p in ssm_resp.get('Parameters', []):
    name = p['Name']
    rel = name[len(ssm_prefix):]
    if rel == 'SHOPIFY_API_KEY' or rel == 'SHOPIFY_API_SECRET':
        continue
    env_name = rel[len('GEBEAUTY_'):] if rel.startswith('GEBEAUTY_') else rel
    secrets_by_name[env_name] = {
        'name': env_name,
        'valueFrom': f'arn:aws:ssm:{region}:{acct}:parameter{name}',
    }
cd['secrets'] = list(secrets_by_name.values())

with open(os.environ['OMNIFY_TMP_JSON'], 'w', encoding='utf-8') as f:
    f.write(json.dumps(td))
'@
  Set-Content -Path $pyScript -Value $pyCode -Encoding UTF8
  python $pyScript
  Remove-Item $pyScript -ErrorAction SilentlyContinue

  $rev = aws ecs register-task-definition --cli-input-json ("file://{0}" -f $env:OMNIFY_TMP_JSON) --region $Region --query "taskDefinition.revision" --output text
  Write-Host "Deploying task definition revision $rev..."
  aws ecs update-service --cluster $Cluster --service $Service --task-definition ("{0}:{1}" -f $TaskFamily, $rev) --region $Region
  aws ecs wait services-stable --cluster $Cluster --services $Service --region $Region
  $readyQuery = 'services[0].{rollout:deployments[0].rolloutState, running:runningCount, taskDef:taskDefinition}'
  $readyStatus = aws ecs describe-services --cluster $Cluster --services $Service --region $Region --query $readyQuery --output table
  Write-Host "Deployment readiness:"
  Write-Host $readyStatus

  # Post-deploy smoke test. Hits the external health check URL and fails if it
  # isn't 200, catches BASE_PATH / basename mismatches BEFORE we declare
  # success. Retries briefly to absorb ALB target registration latency.
  if ($HealthCheckUrl) {
    Write-Host "Smoke testing $HealthCheckUrl ..."
    $ok = $false
    for ($i = 1; $i -le 10; $i++) {
      try {
        $resp = Invoke-WebRequest -Uri $HealthCheckUrl -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 0 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) {
          Write-Host "  attempt $i -> 200 OK"
          $ok = $true
          break
        }
        Write-Host "  attempt $i -> $($resp.StatusCode)"
      } catch {
        Write-Host "  attempt $i -> $($_.Exception.Message)"
      }
      Start-Sleep -Seconds 6
    }
    if (-not $ok) {
      throw "Smoke test FAILED: $HealthCheckUrl did not return 200 after 10 attempts. The ALB will crash-loop this task. Roll back or investigate BASE_PATH/basename."
    }
    Write-Host "Smoke test passed."
  }

  Cleanup-StaleTargets -ClusterName $Cluster -ServiceName $Service -RegionName $Region
} finally {
  Pop-Location
}
