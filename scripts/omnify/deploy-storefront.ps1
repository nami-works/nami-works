param(
  [string]$Region = "us-east-1",
  [string]$Repository = "477780048372.dkr.ecr.us-east-1.amazonaws.com/omnify-app",
  [string]$Tag = "",
  [string]$ShopifyAppUrl = "https://storefront.cpg-labs.io",
  [string]$Cluster = "cpg-labs",
  [string]$Service = "storefront-service",
  [string]$TaskFamily = "storefront-task"
)

$ErrorActionPreference = "Stop"

function Cleanup-StaleTargets {
  param(
    [string]$ClusterName,
    [string]$ServiceName,
    [string]$RegionName
  )
  Write-Host "`nAuditing ALB target group for stale targets..."

  $tgArn = aws ecs describe-services --cluster $ClusterName --services $ServiceName --region $RegionName --query "services[0].loadBalancers[0].targetGroupArn" --output text
  if (-not $tgArn -or $tgArn -eq "None") {
    Write-Host "  No target group found for $ServiceName — skipping."
    return
  }

  $taskArnsJson = aws ecs list-tasks --cluster $ClusterName --service-name $ServiceName --region $RegionName --query "taskArns" --output json
  $taskArns = ($taskArnsJson | ConvertFrom-Json)
  if ($taskArns.Count -eq 0) {
    Write-Host "  No running tasks — skipping."
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
    Write-Host "  Target group clean — no stale targets."
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
  aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin $registry
  if ($LASTEXITCODE -ne 0) {
    Write-Host "ECR login failed. Retrying after docker logout..."
    docker logout $registry | Out-Null
    aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin $registry
  }
  if ($LASTEXITCODE -ne 0) { throw "ECR login failed. Aborting deploy." }

  for ($attempt = 1; $attempt -le 2; $attempt++) {
    if ($attempt -gt 1) {
      Write-Host "Retrying docker build (attempt $attempt)..."
    }
    Write-Host "Building image for root path..."
    docker build -t "${Repository}:${Tag}" .
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
  $env:OMNIFY_SHOPIFY_APP_URL = $ShopifyAppUrl
  $env:OMNIFY_TASK_FAMILY = $TaskFamily
  $env:OMNIFY_TMP_JSON = (Join-Path $repoRoot ("tmp-{0}-task.json" -f $Service))
  $env:OMNIFY_REGION = $Region

  python -c "import json, os, subprocess; data=json.loads(subprocess.check_output(['aws','ecs','describe-task-definition','--task-definition',os.environ['OMNIFY_TASK_FAMILY'],'--region',os.environ['OMNIFY_REGION']], text=True)); td=data['taskDefinition']; \
[(td.pop(k,None)) for k in ['taskDefinitionArn','revision','status','requiresAttributes','compatibilities','registeredAt','registeredBy']]; \
cd=td['containerDefinitions'][0]; cd['image']=os.environ['OMNIFY_IMAGE']; \
env={e['name']: e for e in cd.get('environment', [])}; \
env.pop('BASE_PATH', None); \
url=os.environ.get('OMNIFY_SHOPIFY_APP_URL',''); \
(env.update({'SHOPIFY_APP_URL':{'name':'SHOPIFY_APP_URL','value':url}}) if url else None); \
env.update({'APP_IDENTITY':{'name':'APP_IDENTITY','value':'storefront'}}); \
cd['environment']=list(env.values()); \
open(os.environ['OMNIFY_TMP_JSON'],'w',encoding='utf-8').write(json.dumps(td))"

  $rev = aws ecs register-task-definition --cli-input-json ("file://{0}" -f $env:OMNIFY_TMP_JSON) --region $Region --query "taskDefinition.revision" --output text
  Write-Host "Deploying task definition revision $rev..."
  aws ecs update-service --cluster $Cluster --service $Service --task-definition ("{0}:{1}" -f $TaskFamily, $rev) --region $Region
  aws ecs wait services-stable --cluster $Cluster --services $Service --region $Region
  $readyStatus = aws ecs describe-services --cluster $Cluster --services $Service --region $Region --query "services[0].{rollout:deployments[0].rolloutState, running:runningCount, taskDef:taskDefinition}" --output table
  Write-Host "Deployment readiness:"
  Write-Host $readyStatus

  Cleanup-StaleTargets -ClusterName $Cluster -ServiceName $Service -RegionName $Region
} finally {
  Pop-Location
}
