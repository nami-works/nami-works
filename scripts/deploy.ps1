# scripts/deploy.ps1 — build, push, roll the NAMI Works gateway.
#
# Expects:
#   - docker CLI on PATH, authenticated (or we run ecr get-login-password below).
#   - AWS CLI on PATH, logged in to the same account where Terraform applied
#     (us-east-1, account 477780048372).
#   - Terraform outputs resolvable from infra/terraform (we call `terraform output`).
#
# Usage:
#   .\scripts\deploy.ps1              # tags with git sha
#   .\scripts\deploy.ps1 -Tag v1.0.0  # custom tag
#   .\scripts\deploy.ps1 -SkipWait    # don't wait for rollout to stabilize

[CmdletBinding()]
param(
  [string]$Tag = (git rev-parse --short HEAD),
  [switch]$SkipWait
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$tfDir    = Join-Path $repoRoot 'infra/terraform'
$region   = 'us-east-1'
$account  = '477780048372'

function Step($label) { Write-Host "`n==> $label" -ForegroundColor Cyan }

Step "Reading Terraform outputs from $tfDir"
Push-Location $tfDir
try {
  $ecrUrl       = (terraform output -raw ecr_repository_url).Trim()
  $clusterName  = (terraform output -raw ecs_cluster_name).Trim()
  $serviceName  = (terraform output -raw ecs_service_name).Trim()
  $taskFamily   = (terraform output -raw task_definition_family).Trim()
} finally {
  Pop-Location
}
Write-Host "    ECR:     $ecrUrl"
Write-Host "    Cluster: $clusterName"
Write-Host "    Service: $serviceName"
Write-Host "    Family:  $taskFamily"
Write-Host "    Tag:     $Tag"

Step "Logging into ECR"
$ecrHost = "$account.dkr.ecr.$region.amazonaws.com"
# PowerShell 5.1's pipeline rewrites stdin encoding when piping `aws ecr
# get-login-password` into `docker login --password-stdin`, causing a
# 400 Bad Request. Route through cmd.exe, which pipes raw bytes.
cmd /c "aws ecr get-login-password --region $region | docker login --username AWS --password-stdin $ecrHost"
if ($LASTEXITCODE -ne 0) { throw "docker login failed" }

Step "Building image ${ecrUrl}:${Tag}"
Push-Location $repoRoot
try {
  # Linux/amd64 — ECS Fargate task definition is X86_64.
  docker buildx build --platform linux/amd64 -t "${ecrUrl}:${Tag}" -t "${ecrUrl}:latest" --push .
  if ($LASTEXITCODE -ne 0) { throw "docker build/push failed" }
} finally {
  Pop-Location
}

Step "Fetching current task definition"
$currentTaskDefJson = aws ecs describe-task-definition `
  --task-definition $taskFamily `
  --region $region `
  --query 'taskDefinition' `
  --output json
if ($LASTEXITCODE -ne 0) { throw "describe-task-definition failed" }

$taskDef = $currentTaskDefJson | ConvertFrom-Json -Depth 20

# Strip fields that register-task-definition rejects (they're output-only).
$fieldsToDrop = @(
  'taskDefinitionArn', 'revision', 'status',
  'requiresAttributes', 'compatibilities', 'registeredAt', 'registeredBy'
)
foreach ($field in $fieldsToDrop) {
  if ($taskDef.PSObject.Properties.Name -contains $field) {
    $taskDef.PSObject.Properties.Remove($field)
  }
}

# Swap the image on the single container.
$taskDef.containerDefinitions[0].image = "${ecrUrl}:${Tag}"

$newTaskDefJson = $taskDef | ConvertTo-Json -Depth 20
$tmpFile = [System.IO.Path]::GetTempFileName() + '.json'
$newTaskDefJson | Set-Content -Path $tmpFile -Encoding utf8

Step "Registering new task definition revision"
$newRevisionArn = aws ecs register-task-definition `
  --cli-input-json "file://$tmpFile" `
  --region $region `
  --query 'taskDefinition.taskDefinitionArn' `
  --output text
if ($LASTEXITCODE -ne 0) { throw "register-task-definition failed" }
Remove-Item $tmpFile -Force
Write-Host "    $newRevisionArn"

Step "Updating service $serviceName to use new revision"
aws ecs update-service `
  --cluster $clusterName `
  --service $serviceName `
  --task-definition $newRevisionArn `
  --force-new-deployment `
  --region $region `
  --query 'service.deployments[0].id' `
  --output text | Out-Null
if ($LASTEXITCODE -ne 0) { throw "update-service failed" }

if ($SkipWait) {
  Write-Host "`nDeploy queued. Skipping rollout wait (-SkipWait)." -ForegroundColor Yellow
  exit 0
}

Step "Waiting for service to stabilize (up to ~10 minutes)"
aws ecs wait services-stable `
  --cluster $clusterName `
  --services $serviceName `
  --region $region
if ($LASTEXITCODE -ne 0) {
  Write-Host "`nservices-stable timed out. Inspect:" -ForegroundColor Red
  Write-Host "  aws ecs describe-services --cluster $clusterName --services $serviceName --region $region --query 'services[0].events[:5]' --output text"
  Write-Host "  aws logs tail /ecs/nami-works-gateway --since 10m --region $region"
  exit 1
}

Step "Done"
Write-Host "Deployed ${ecrUrl}:${Tag}" -ForegroundColor Green
Write-Host "Smoke test: curl -s https://mcp.nami.works/health  (expect {""ok"":true})"
