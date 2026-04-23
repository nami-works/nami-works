param(
  [string]$Region = "us-east-1",
  [string]$Repository = "477780048372.dkr.ecr.us-east-1.amazonaws.com/omnify-app",
  [string]$Tag = "",
  [string]$BasePath = "/",
  [string]$ShopifyAppUrl = "https://omnify.cpg-labs.io",
  [string]$Cluster = "cpg-labs",
  [string]$Service = "omnify-service",
  [string]$TaskFamily = "omnify-task"
)

$ErrorActionPreference = "Stop"

# ── Pre-flight guards (mini Phase 3a, 2026-04-22) ──────────────────────
# Imported from scripts/_deploy-common.psm1. Read-only, cheap. Guards
# against the two known failure modes we hit this week:
#   - Assert-CleanWorkingTree : prevents Docker `COPY .` from silently
#     shipping uncommitted files.
#   - Assert-NoSplitBrain     : refuses to deploy while any non-canonical
#     cluster has running tasks (guards the remediation observation
#     window against accidental re-scaling of omnify-cluster).
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

  $timeout = [DateTime]::UtcNow.AddSeconds(30)
  while ([DateTime]::UtcNow -lt $timeout) {
    docker info 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Docker is running."
      return
    }
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
  $suggestedTag = "v1"
  if ($currentTag -match '^(v)(\d+)$') {
    $suggestedTag = "{0}{1}" -f $Matches[1], ([int]$Matches[2] + 1)
  } elseif ($currentTag -match '^(.*-v)(\d+)$') {
    $prefix = $Matches[1]
    $number = [int]$Matches[2]
    $suggestedTag = "{0}{1}" -f $prefix, ($number + 1)
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
  # Windows PowerShell 5.1 pipes mangle docker --password-stdin stdin encoding,
  # so we capture the token to a variable and pass via --password. The token is
  # a short-lived (12 h) bearer, and this script runs on a local developer
  # machine where process listings are not a meaningful attack surface.
  $ecrToken = (aws ecr get-login-password --region $Region).Trim()
  docker login --username AWS --password $ecrToken $registry 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "ECR login failed. Retrying after docker logout..."
    docker logout $registry | Out-Null
    docker login --username AWS --password $ecrToken $registry 2>$null
  }
  if ($LASTEXITCODE -ne 0) { throw "ECR login failed. Aborting deploy." }

  for ($attempt = 1; $attempt -le 2; $attempt++) {
    if ($attempt -gt 1) {
      Write-Host "Retrying docker build (attempt $attempt)..."
    }
    if ($BasePath -and $BasePath -ne "/") {
      Write-Host "Building image with BASE_PATH=$BasePath..."
      docker build --build-arg BASE_PATH=$BasePath -t "${Repository}:${Tag}" .
    } else {
      Write-Host "Building image for root path..."
      docker build -t "${Repository}:${Tag}" .
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
env['APP_IDENTITY'] = {'name': 'APP_IDENTITY', 'value': 'omnify'}
cd['environment'] = list(env.values())

# Reconcile secrets[] from /omnify/* SSM params (single source of truth).
# Prevents drift when Terraform adds a new SSM-backed secret.
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
    env_name = name[len(ssm_prefix):]
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
} finally {
  Pop-Location
}
