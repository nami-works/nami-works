# scripts/deploy-fulfillment.ps1 — build, push, roll the Rota Local fulfillment
# service (apps/fulfillment, the 3PL operator gateway).
#
# STUB: ECR + ECS infra for fulfillment is not provisioned yet. This script is
# a placeholder mirroring scripts/deploy-connector.ps1; it will throw on first
# `terraform output` call until infra/fulfillment exists.
#
# Expects (once infra lands):
#   - docker CLI on PATH, authenticated.
#   - AWS CLI on PATH, logged in to the same account where Terraform applied.
#   - Terraform outputs resolvable from infra/fulfillment (`terraform output`).
#
# Usage:
#   .\scripts\deploy-fulfillment.ps1              # tags with git sha
#   .\scripts\deploy-fulfillment.ps1 -Tag v1.0.0  # custom tag
#   .\scripts\deploy-fulfillment.ps1 -SkipWait    # don't wait for rollout

[CmdletBinding()]
param(
  [string]$Tag = (git rev-parse --short HEAD),
  [switch]$SkipWait
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$tfDir    = Join-Path $repoRoot 'infra/fulfillment'
$region   = 'us-east-1'
$account  = '477780048372'

function Step($label) { Write-Host "`n==> $label" -ForegroundColor Cyan }

if (-not (Test-Path $tfDir)) {
  throw "infra/fulfillment does not exist yet. Provision ECR + ECS for Rota Local before running this script."
}

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
cmd /c "aws ecr get-login-password --region $region | docker login --username AWS --password-stdin $ecrHost"
if ($LASTEXITCODE -ne 0) { throw "docker login failed" }

Step "Building image ${ecrUrl}:${Tag}"
Push-Location $repoRoot
try {
  docker buildx build --platform linux/amd64 -f apps/fulfillment/Dockerfile -t "${ecrUrl}:${Tag}" -t "${ecrUrl}:latest" --push .
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

$taskDef = $currentTaskDefJson | ConvertFrom-Json

$fieldsToDrop = @(
  'taskDefinitionArn', 'revision', 'status',
  'requiresAttributes', 'compatibilities', 'registeredAt', 'registeredBy'
)
foreach ($field in $fieldsToDrop) {
  if ($taskDef.PSObject.Properties.Name -contains $field) {
    $taskDef.PSObject.Properties.Remove($field)
  }
}

$taskDef.containerDefinitions[0].image = "${ecrUrl}:${Tag}"

$newTaskDefJson = $taskDef | ConvertTo-Json -Depth 20
$tmpFile = [System.IO.Path]::GetTempFileName() + '.json'
[System.IO.File]::WriteAllText($tmpFile, $newTaskDefJson)

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
  exit 1
}

Step "Done"
Write-Host "Deployed ${ecrUrl}:${Tag}" -ForegroundColor Green
Write-Host "Smoke test: curl -s https://<rota-local-host>/health  (expect {""ok"":true})"
