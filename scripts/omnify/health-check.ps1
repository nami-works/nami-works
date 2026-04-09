param(
  [string]$Region = "us-east-1",
  [string]$Cluster = "omnify-cluster",
  [string]$Service = "omnify-gebeauty-service",
  [string]$BasePath = "/full",
  [string]$HealthUrl = "https://omnify.cpg-labs.io/full/health",
  [string]$LogGroup = "/ecs/omnify-gebeauty",
  [int]$LogLines = 200
)

$ErrorActionPreference = "Stop"

function Write-Section([string]$Title) {
  Write-Host ""
  Write-Host "== $Title =="
}

function Check-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

Check-Command "aws"

Write-Section "Service Status"
$serviceInfo = aws ecs describe-services --cluster $Cluster --services $Service --region $Region --query "services[0].{status:status, rollout:deployments[0].rolloutState, running:runningCount, taskDef:taskDefinition}" --output table
Write-Host $serviceInfo

Write-Section "Current Task Definition"
$taskDefArn = aws ecs describe-services --cluster $Cluster --services $Service --region $Region --query "services[0].taskDefinition" --output text
$taskDefInfo = aws ecs describe-task-definition --task-definition $taskDefArn --region $Region --query "taskDefinition.{registeredAt:registeredAt, image:containerDefinitions[0].image, env:containerDefinitions[0].environment}" --output json
Write-Host $taskDefInfo

Write-Section "Base Path / Health URL"
Write-Host ("BasePath: {0}" -f $BasePath)
Write-Host ("HealthUrl: {0}" -f $HealthUrl)
try {
  $resp = Invoke-WebRequest -Uri $HealthUrl -Method GET -TimeoutSec 10
  Write-Host ("Health response: {0} {1}" -f $resp.StatusCode, $resp.StatusDescription)
} catch {
  Write-Host ("Health check failed: {0}" -f $_.Exception.Message)
}

Write-Section "CloudWatch Logs (latest stream)"
$logText = ""
try {
  $stream = aws logs describe-log-streams --log-group-name $LogGroup --order-by LastEventTime --descending --max-items 1 --query "logStreams[0].logStreamName" --output text
  $stream = ($stream | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($stream) -or $stream -eq "None") {
    Write-Host "No log streams found."
  } else {
    Write-Host ("Log stream: {0}" -f $stream)
    $startTime = [DateTimeOffset]::UtcNow.AddMinutes(-30).ToUnixTimeMilliseconds()
    try {
      $eventsJson = aws logs get-log-events --log-group-name $LogGroup --log-stream-name $stream --start-time $startTime --limit $LogLines --output json
      $eventsObj = $eventsJson | ConvertFrom-Json
      if ($eventsObj.events.Count -gt 0) {
        $messages = $eventsObj.events | ForEach-Object { $_.message }
        $logText = ($messages -join "`n")
        Write-Host $logText
      } else {
        Write-Host "No log events found in the last 30 minutes."
      }
    } catch {
      Write-Host ("Failed to read log events: {0}" -f $_.Exception.Message)
    }
  }
} catch {
  Write-Host ("Failed to read logs: {0}" -f $_.Exception.Message)
}

Write-Section "Known Failure Signatures"
Write-Host "Look for:"
Write-Host "- 'ReferenceError: React is not defined' -> missing React import or React namespace usage"
Write-Host "- 'GraphqlQueryError' / 'LocationConnection' -> wrong connection fields (use nodes/edges)"
Write-Host "- 'Request timed out' from ALB -> long loader or backend timeout"
Write-Host "- 404 on /full/health -> BASE_PATH or ALB path rules mismatch"

Write-Section "Auto-Detected Issues"
$findings = @()
if ($logText -match "ReferenceError:\s*React is not defined") {
  $findings += "React is not defined -> import React or use named imports (useRef/CSSProperties) instead of React.*"
}
if ($logText -match "GraphqlQueryError" -and $logText -match "LocationConnection") {
  $findings += "LocationConnection field error -> use locations { nodes { id } } (or edges) in GraphQL"
}
if ($logText -match "Request timed out") {
  $findings += "Timeouts -> check long loaders (retail expansion backfill) or ALB health check timeouts"
}
if ($logText -match "GET\s+/full/health\s+404") {
  $findings += "Health 404 -> BASE_PATH or ALB listener rules mismatch (/full)"
}
if ($findings.Count -eq 0) {
  Write-Host "No known signatures found in the latest logs."
} else {
  $findings | ForEach-Object { Write-Host "- $_" }
}
