param(
  [string]$Region = "us-east-1",
  [string]$Cluster = "cpg-labs",
  [string]$Service = "omnify-gebeauty-service",
  [string]$ShopifyApiKey = "",
  [string]$ShopifyApiSecret = "",
  [string]$DatabaseUrl = "",
  [string]$GoogleMapsApiKey = "",
  [string]$GoogleMapsMapId = "",
  [string]$AppEncryptionKey = "",
  [string]$AnthropicApiKey = ""
)

$ErrorActionPreference = "Stop"

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

Ensure-DockerRunning

function Set-SsmParameter([string]$Name, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return }
  Write-Host "Updating SSM: $Name"
  aws ssm put-parameter --name $Name --value $Value --type SecureString --overwrite --region $Region | Out-Null
}

Set-SsmParameter "/omnify/GEBEAUTY_SHOPIFY_API_KEY" $ShopifyApiKey
Set-SsmParameter "/omnify/GEBEAUTY_SHOPIFY_API_SECRET" $ShopifyApiSecret
Set-SsmParameter "/omnify/DATABASE_URL" $DatabaseUrl
Set-SsmParameter "/omnify/GOOGLE_MAPS_API_KEY" $GoogleMapsApiKey
Set-SsmParameter "/omnify/GOOGLE_MAPS_MAP_ID" $GoogleMapsMapId
Set-SsmParameter "/omnify/APP_ENCRYPTION_KEY" $AppEncryptionKey
Set-SsmParameter "/omnify/ANTHROPIC_API_KEY" $AnthropicApiKey

Write-Host "Forcing new deployment to pick up updated secrets..."
aws ecs update-service --cluster $Cluster --service $Service --force-new-deployment --region $Region | Out-Null
aws ecs wait services-stable --cluster $Cluster --services $Service --region $Region
$readyStatus = aws ecs describe-services --cluster $Cluster --services $Service --region $Region --query "services[0].{rollout:deployments[0].rolloutState, running:runningCount, taskDef:taskDefinition}" --output table
Write-Host "Deployment readiness:"
Write-Host $readyStatus
