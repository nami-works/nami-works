param(
  [string]$Region      = "us-east-1",
  [string]$OldCluster  = "omnify-cluster",
  [string]$NewCluster  = "cpg-labs"
)

$ErrorActionPreference = "Stop"

# ── helpers ────────────────────────────────────────────────────────────────────

function Invoke-Aws {
  aws @args
  if ($LASTEXITCODE -ne 0) { throw "AWS CLI failed (exit $LASTEXITCODE): aws $args" }
}

function Get-ServiceNames([string]$Cluster) {
  $raw  = Invoke-Aws ecs list-services --cluster $Cluster --region $Region --output json
  $arns = ($raw | ConvertFrom-Json).serviceArns
  if (-not $arns) { return @() }
  return @($arns | ForEach-Object { $_.Split("/")[-1] })
}

function Describe-Service([string]$Cluster, [string]$ServiceName) {
  $raw = Invoke-Aws ecs describe-services --cluster $Cluster --services $ServiceName --region $Region --output json
  return ($raw | ConvertFrom-Json).services[0]
}

# ── 1. create new cluster ──────────────────────────────────────────────────────

Write-Host "`n==> Step 1: Creating cluster '$NewCluster'..." -ForegroundColor Cyan
$existingClusters = (Invoke-Aws ecs list-clusters --region $Region --output json | ConvertFrom-Json).clusterArns
$alreadyExists    = $existingClusters | Where-Object { $_ -like "*/$NewCluster" }
if ($alreadyExists) {
  Write-Host "    Cluster '$NewCluster' already exists - skipping creation."
} else {
  Invoke-Aws ecs create-cluster --cluster-name $NewCluster --region $Region | Out-Null
  Write-Host "    Created cluster '$NewCluster'."
}

# ── 2. enumerate services on old cluster ──────────────────────────────────────

Write-Host "`n==> Step 2: Reading services from '$OldCluster'..." -ForegroundColor Cyan
$serviceNames = Get-ServiceNames $OldCluster
if ($serviceNames.Count -eq 0) {
  Write-Host "    No services found on '$OldCluster'. Nothing to migrate."
  exit 0
}
Write-Host "    Found: $($serviceNames -join ', ')"

# ── 3. re-create each service on the new cluster ──────────────────────────────

Write-Host "`n==> Step 3: Re-creating services on '$NewCluster'..." -ForegroundColor Cyan

foreach ($svcName in $serviceNames) {
  Write-Host "    Migrating '$svcName'..."
  $svc = Describe-Service $OldCluster $svcName

  # Skip if already active on new cluster
  $existingRaw = Invoke-Aws ecs describe-services --cluster $NewCluster --services $svcName --region $Region --output json
  $existing    = $existingRaw | ConvertFrom-Json
  if (@($existing.services).Count -gt 0 -and $existing.services[0].status -ne "INACTIVE") {
    Write-Host "    '$svcName' already exists on '$NewCluster' - skipping."
    continue
  }

  # Guard: networkConfiguration must be present for Fargate
  if (-not $svc.networkConfiguration -or -not $svc.networkConfiguration.awsvpcConfiguration) {
    throw "Service '$svcName' has no awsvpcConfiguration - cannot migrate automatically."
  }

  # Build create-service args from old service config
  $createArgs = @(
    "ecs", "create-service",
    "--cluster", $NewCluster,
    "--service-name", $svcName,
    "--task-definition", $svc.taskDefinition,
    "--desired-count", "$($svc.desiredCount)",
    "--launch-type", "FARGATE",
    "--region", $Region
  )

  # Network config
  $nc       = $svc.networkConfiguration.awsvpcConfiguration
  $subnets  = $nc.subnets -join ","
  $sgs      = $nc.securityGroups -join ","
  $assignIp = $nc.assignPublicIp
  $createArgs += @(
    "--network-configuration",
    "awsvpcConfiguration={subnets=`[$subnets`],securityGroups=`[$sgs`],assignPublicIp=$assignIp}"
  )

  # Load balancer (if any)
  if (@($svc.loadBalancers).Count -gt 0) {
    $lb     = $svc.loadBalancers[0]
    $lbSpec = "targetGroupArn=$($lb.targetGroupArn),containerName=$($lb.containerName),containerPort=$($lb.containerPort)"
    $createArgs += @("--load-balancers", $lbSpec)
    # Use -ne $null so that 0 is preserved (valid grace period)
    if ($null -ne $svc.healthCheckGracePeriodSeconds) {
      $createArgs += @("--health-check-grace-period-seconds", "$($svc.healthCheckGracePeriodSeconds)")
    }
  }

  # Deployment config
  $dc = $svc.deploymentConfiguration
  if ($dc -and $null -ne $dc.maximumPercent -and $null -ne $dc.minimumHealthyPercent) {
    $createArgs += @(
      "--deployment-configuration",
      "maximumPercent=$($dc.maximumPercent),minimumHealthyPercent=$($dc.minimumHealthyPercent)"
    )
  }

  Invoke-Aws @createArgs | Out-Null
  Write-Host "    Created '$svcName' on '$NewCluster'."
}

# ── 4. wait for all new services to be stable ─────────────────────────────────

Write-Host "`n==> Step 4: Waiting for new services to be stable..." -ForegroundColor Cyan
foreach ($svcName in $serviceNames) {
  Write-Host "    Waiting for '$svcName'..."
  try {
    Invoke-Aws ecs wait services-stable --cluster $NewCluster --services $svcName --region $Region
  } catch {
    throw "Service '$svcName' did not stabilize on '$NewCluster'. Check ECS console for task errors."
  }
  $svc = Describe-Service $NewCluster $svcName
  Write-Host "    '$svcName' running: $($svc.runningCount) task(s)."
}
Write-Host "    All services stable on '$NewCluster'."

# ── 5. confirm before destructive steps ───────────────────────────────────────

Write-Host "`n==> All services are running on '$NewCluster'." -ForegroundColor Green
Write-Host "    Please verify your apps are responding correctly before continuing."
$confirm = Read-Host "    Delete old services and cluster '$OldCluster'? (yes/no)"
if ($confirm -ne "yes") {
  Write-Host "Aborted. Old cluster left intact. Re-run and confirm 'yes' when ready." -ForegroundColor Yellow
  exit 0
}

# ── 6. scale down and delete old services ─────────────────────────────────────

Write-Host "`n==> Step 5: Draining '$OldCluster' services..." -ForegroundColor Cyan
foreach ($svcName in $serviceNames) {
  Write-Host "    Scaling down '$svcName'..."
  Invoke-Aws ecs update-service --cluster $OldCluster --service $svcName --desired-count 0 --region $Region | Out-Null
}
Write-Host "    Waiting for tasks to stop..."
foreach ($svcName in $serviceNames) {
  Invoke-Aws ecs wait services-stable --cluster $OldCluster --services $svcName --region $Region
  Write-Host "    Deleting '$svcName'..."
  Invoke-Aws ecs delete-service --cluster $OldCluster --service $svcName --force --region $Region | Out-Null
}

# ── 7. delete old cluster ─────────────────────────────────────────────────────

Write-Host "`n==> Step 6: Deleting cluster '$OldCluster'..." -ForegroundColor Cyan
Invoke-Aws ecs delete-cluster --cluster $OldCluster --region $Region | Out-Null
Write-Host "    Cluster '$OldCluster' deleted." -ForegroundColor Green

Write-Host "`nMigration complete. All services now running on '$NewCluster'." -ForegroundColor Green
