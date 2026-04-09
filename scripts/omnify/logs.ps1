<#
.SYNOPSIS
  Fetch CloudWatch logs for a specific module and timeframe.

.DESCRIPTION
  Wraps AWS CloudWatch with module-aware filtering, flexible time ranges,
  log-level filtering, and colorized output.

  Time can be specified as:
    - Relative lookback: -Since 30m, -Since 2h, -Since 1d  (default: 30m)
    - Absolute window:   -From "yesterday 12:00" -To "yesterday 20:00"
    - Mixed:             -From "today 08:00"  (no -To = up to now)

  Absolute values accept anything PowerShell can parse as a datetime, plus
  the shortcuts "yesterday" and "today" (midnight of that day).

.EXAMPLE
  # Last 30 minutes of local-delivery logs
  .\scripts\logs.ps1 local-delivery

  # Last 2 hours of lalamove errors only
  .\scripts\logs.ps1 lalamove -Since 2h -Level error

  # Yesterday between noon and 20h
  .\scripts\logs.ps1 local-delivery -From "yesterday 12:00" -To "yesterday 20:00"

  # Today from 8am to now
  .\scripts\logs.ps1 retail-footprint -From "today 08:00"

  # Specific date range
  .\scripts\logs.ps1 lalamove -From "2026-03-28 14:00" -To "2026-03-28 18:30"

  # Free-text filter (any CloudWatch filter pattern)
  .\scripts\logs.ps1 -Filter "shop=gebeauty" -Since 1h

  # Follow mode (live tail, only with -Since)
  .\scripts\logs.ps1 local-delivery -Follow

  # List known modules
  .\scripts\logs.ps1 -ListModules
#>

param(
  # Module name (prefix used in [module-name] log lines). Partial match supported.
  [Parameter(Position = 0)]
  [string]$Module,

  # Relative lookback: e.g. 15m, 1h, 6h, 1d. Default: 30m. Ignored when -From is set.
  [string]$Since = "30m",

  # Absolute start time: "yesterday 12:00", "2026-03-28 14:00", "today 08:00", etc.
  [string]$From,

  # Absolute end time (optional, defaults to now): "yesterday 20:00", "2026-03-28 18:30", etc.
  [string]$To,

  # Filter by log level: info, warn, error, or all. Default: all.
  [ValidateSet("all", "info", "warn", "error")]
  [string]$Level = "all",

  # Additional free-text CloudWatch filter pattern (combined with module filter).
  [string]$Filter,

  # Follow logs in real time (live tail). Only works with -Since (relative mode).
  [switch]$Follow,

  # List all known module prefixes and exit.
  [switch]$ListModules,

  # Max number of lines to show (ignored in follow mode).
  [int]$Limit = 500,

  # Log group name.
  [string]$LogGroup = "/ecs/omnify-gebeauty",

  # AWS region.
  [string]$Region = "us-east-1"
)

$ErrorActionPreference = "Continue"

# Force UTF-8 output so emojis in log messages don't crash Python's charmap codec
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- Known modules ----------

$KnownModules = @(
  @{ Name = "local-delivery";           Desc = "Route planning, order tags, map interactions" }
  @{ Name = "lalamove";                 Desc = "Lalamove API calls (quotation, order, cancel)" }
  @{ Name = "lalamove-credentials";     Desc = "Credential save/probe for Lalamove" }
  @{ Name = "lalamove-sync";            Desc = "Lalamove order sync & status polling" }
  @{ Name = "escalation";              Desc = "Auto-retry & escalation logic" }
  @{ Name = "google-routes";            Desc = "Route optimization (all strategies)" }
  @{ Name = "retail-footprint";         Desc = "Retail analytics, heatmaps, aggregates" }
  @{ Name = "price-tags";               Desc = "Metaobject-based discount labels" }
  @{ Name = "compliance";               Desc = "GDPR webhooks (data request, redact)" }
  @{ Name = "carrier";                  Desc = "Carrier registration & sample rates" }
  @{ Name = "auto-routing";             Desc = "Auto-routing service" }
  @{ Name = "storytelling";             Desc = "AI blog content generation" }
  @{ Name = "merchandising";            Desc = "Merchandising features" }
  @{ Name = "webhooks";                 Desc = "Webhook handlers (orders, products, app)" }
  @{ Name = "cron";                     Desc = "Cron jobs (analytics, watchdog)" }
)

if ($ListModules) {
  Write-Host ""
  Write-Host "Known log modules:" -ForegroundColor Cyan
  Write-Host ("-" * 60)
  foreach ($m in $KnownModules) {
    Write-Host ("  [{0,-24}]  {1}" -f $m.Name, $m.Desc)
  }
  Write-Host ""
  Write-Host "Tip: You can also use partial names (e.g. 'lala' matches lalamove*)." -ForegroundColor DarkGray
  exit 0
}

# ---------- Validation ----------

if (-not (Get-Command "aws" -ErrorAction SilentlyContinue)) {
  Write-Host "ERROR: AWS CLI not found. Install it first." -ForegroundColor Red
  exit 1
}

# ---------- Interactive mode ----------
# When called with no arguments, prompt the user step by step.

$isInteractive = (-not $Module -and -not $Filter -and -not $From -and $Since -eq "30m" -and $Level -eq "all")

if ($isInteractive) {
  Write-Host ""
  Write-Host "CloudWatch Log Viewer" -ForegroundColor Cyan
  Write-Host ("=" * 50)

  # --- Step 1: Module ---
  Write-Host ""
  Write-Host "Which module?" -ForegroundColor White
  Write-Host ""
  for ($i = 0; $i -lt $KnownModules.Count; $i++) {
    $m = $KnownModules[$i]
    Write-Host ("  {0,2})  {1,-24} {2}" -f ($i + 1), $m.Name, $m.Desc) -ForegroundColor Gray
  }
  Write-Host ""
  Write-Host ("  {0,2})  {1}" -f 0, "All modules (no module filter)") -ForegroundColor Gray
  Write-Host ("   c)  Custom text filter") -ForegroundColor Gray
  Write-Host ""

  $moduleInput = Read-Host "  Pick a number, type a module name, or 'c' for custom"
  $moduleInput = $moduleInput.Trim()

  if ($moduleInput -eq "c" -or $moduleInput -eq "C") {
    $Filter = Read-Host "  Enter custom filter text"
    $Filter = $Filter.Trim()
    if (-not $Filter) {
      Write-Host "  No filter entered, showing all logs." -ForegroundColor DarkGray
    }
  } elseif ($moduleInput -eq "0") {
    # No module filter — show all
  } elseif ($moduleInput -match '^\d+$') {
    $idx = [int]$moduleInput - 1
    if ($idx -ge 0 -and $idx -lt $KnownModules.Count) {
      $Module = $KnownModules[$idx].Name
    } else {
      Write-Host "  Invalid number. Exiting." -ForegroundColor Red
      exit 1
    }
  } else {
    # Treat as module name directly
    $Module = $moduleInput
  }

  # --- Step 2: Time range ---
  Write-Host ""
  Write-Host "Time range?" -ForegroundColor White
  Write-Host ""
  Write-Host "  1)  Last 15 minutes" -ForegroundColor Gray
  Write-Host "  2)  Last 30 minutes" -ForegroundColor Gray
  Write-Host "  3)  Last 1 hour" -ForegroundColor Gray
  Write-Host "  4)  Last 2 hours" -ForegroundColor Gray
  Write-Host "  5)  Last 6 hours" -ForegroundColor Gray
  Write-Host "  6)  Last 24 hours" -ForegroundColor Gray
  Write-Host "  7)  Custom range (From / To)" -ForegroundColor Gray
  Write-Host ""

  $timeInput = Read-Host "  Pick a number [default: 2]"
  $timeInput = $timeInput.Trim()
  if (-not $timeInput) { $timeInput = "2" }

  switch ($timeInput) {
    "1" { $Since = "15m" }
    "2" { $Since = "30m" }
    "3" { $Since = "1h" }
    "4" { $Since = "2h" }
    "5" { $Since = "6h" }
    "6" { $Since = "1d" }
    "7" {
      Write-Host ""
      Write-Host "  Enter dates using natural language:" -ForegroundColor DarkGray
      Write-Host "    'yesterday 12:00', 'today 08:00', '2026-03-28 14:00'" -ForegroundColor DarkGray
      Write-Host ""
      $From = Read-Host "  From"
      $From = $From.Trim()
      if (-not $From) {
        Write-Host "  No start time entered. Defaulting to last 30 minutes." -ForegroundColor DarkGray
        $From = $null
        $Since = "30m"
      } else {
        $toInput = Read-Host "  To   [default: now]"
        $toInput = $toInput.Trim()
        if ($toInput) { $To = $toInput }
      }
    }
    default {
      Write-Host "  Invalid choice. Defaulting to last 30 minutes." -ForegroundColor DarkGray
      $Since = "30m"
    }
  }

  # --- Step 3: Level ---
  Write-Host ""
  Write-Host "Log level?" -ForegroundColor White
  Write-Host ""
  Write-Host "  1)  All levels" -ForegroundColor Gray
  Write-Host "  2)  Errors only" -ForegroundColor Gray
  Write-Host "  3)  Warnings + errors" -ForegroundColor Gray
  Write-Host "  4)  Info (START/OK)" -ForegroundColor Gray
  Write-Host ""

  $levelInput = Read-Host "  Pick a number [default: 1]"
  $levelInput = $levelInput.Trim()
  if (-not $levelInput) { $levelInput = "1" }

  switch ($levelInput) {
    "1" { $Level = "all" }
    "2" { $Level = "error" }
    "3" { $Level = "warn" }
    "4" { $Level = "info" }
    default { $Level = "all" }
  }

  Write-Host ""
  Write-Host ("=" * 50)
}

# ---------- Build filter pattern ----------

$filterParts = @()

if ($Module) {
  # CloudWatch treats patterns starting with "[" as space-delimited JSON filters,
  # so we filter by the module name only. The bracket prefix in log lines
  # (e.g. [local-delivery]) still matches because the name is unique enough.
  $filterParts += "`"$Module`""
}

if ($Level -ne "all") {
  switch ($Level) {
    "error" { $filterParts += '"console.error\|ERROR\|FAILED"' }
    "warn"  { $filterParts += '"WARN\|SKIP\|FAILED"' }
    "info"  { $filterParts += '"INFO\|OK\|START"' }
  }
}

if ($Filter) {
  $filterParts += "`"$Filter`""
}

$filterPattern = ($filterParts -join " ")

# ---------- Resolve time mode ----------

# Parses a user-friendly datetime string into a UTC [DateTimeOffset].
# Accepts: "yesterday", "today", "yesterday 14:00", "2026-03-28 18:30", or
# anything [datetime]::Parse can handle.
function Resolve-DateTimeArg([string]$val, [string]$paramName) {
  $lower = $val.Trim().ToLower()

  # Handle "yesterday" / "today" with optional time suffix
  if ($lower -match '^(yesterday|today)\s*(.*)$') {
    $dayWord = $Matches[1]
    $timePart = $Matches[2]

    $baseDate = if ($dayWord -eq "yesterday") { [DateTime]::Today.AddDays(-1) } else { [DateTime]::Today }

    if ($timePart -and $timePart -ne "") {
      $parsedTime = [TimeSpan]::Zero
      if (-not [TimeSpan]::TryParse($timePart, [ref]$parsedTime)) {
        Write-Host "ERROR: Cannot parse time portion '$timePart' in -${paramName} '$val'." -ForegroundColor Red
        Write-Host "  Use HH:mm format, e.g.: yesterday 14:00" -ForegroundColor DarkGray
        exit 1
      }
      $baseDate = $baseDate.Add($parsedTime)
    }

    return [DateTimeOffset]::new($baseDate, [DateTimeOffset]::Now.Offset)
  }

  # Fallback: let PowerShell parse it
  try {
    $parsed = [DateTime]::Parse($val)
    return [DateTimeOffset]::new($parsed, [DateTimeOffset]::Now.Offset)
  } catch {
    Write-Host "ERROR: Cannot parse -${paramName} '$val'." -ForegroundColor Red
    Write-Host "  Examples: 'yesterday 12:00', 'today 08:00', '2026-03-28 14:00'" -ForegroundColor DarkGray
    exit 1
  }
}

$useAbsoluteMode = $false
$startTimeMs = 0
$endTimeMs = 0
$displayFrom = ""
$displayTo = ""

if ($From) {
  $useAbsoluteMode = $true
  $fromDt = Resolve-DateTimeArg $From "From"
  $startTimeMs = $fromDt.ToUnixTimeMilliseconds()
  $displayFrom = $fromDt.LocalDateTime.ToString("yyyy-MM-dd HH:mm")

  if ($To) {
    $toDt = Resolve-DateTimeArg $To "To"
    $endTimeMs = $toDt.ToUnixTimeMilliseconds()
    $displayTo = $toDt.LocalDateTime.ToString("yyyy-MM-dd HH:mm")
  } else {
    $endTimeMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $displayTo = "now"
  }

  if ($startTimeMs -ge $endTimeMs) {
    Write-Host "ERROR: -From ($displayFrom) must be before -To ($displayTo)." -ForegroundColor Red
    exit 1
  }

  if ($Follow) {
    Write-Host "WARNING: -Follow is ignored when using -From/-To (absolute time range)." -ForegroundColor Yellow
    $Follow = $false
  }
} else {
  # Relative mode: validate -Since format
  if ($Since -notmatch '^\d+[smhd]$') {
    Write-Host "ERROR: Invalid -Since value '$Since'. Use format like: 15m, 2h, 1d" -ForegroundColor Red
    exit 1
  }
}

# ---------- Header ----------

Write-Host ""
Write-Host "CloudWatch Logs" -ForegroundColor Cyan
Write-Host ("-" * 60)
if ($Module)  { Write-Host ("  Module:   [{0}]" -f $Module) -ForegroundColor White }
if ($Filter)  { Write-Host ("  Filter:   {0}" -f $Filter) -ForegroundColor White }
if ($useAbsoluteMode) {
  Write-Host ("  From:     {0}" -f $displayFrom) -ForegroundColor White
  Write-Host ("  To:       {0}" -f $displayTo) -ForegroundColor White
} else {
  Write-Host ("  Since:    {0}" -f $Since) -ForegroundColor White
}
Write-Host ("  Level:    {0}" -f $Level) -ForegroundColor White
Write-Host ("  LogGroup: {0}" -f $LogGroup) -ForegroundColor DarkGray
if ($Follow) { Write-Host "  Mode:     FOLLOW (Ctrl+C to stop)" -ForegroundColor Yellow }
Write-Host ("-" * 60)
Write-Host ""

# ---------- Colorizer ----------

function Write-ColorizedLog([string]$line) {
  if ($line -match '(FAILED|ERROR|console\.error)') {
    Write-Host $line -ForegroundColor Red
  }
  elseif ($line -match '(WARN|SKIP)') {
    Write-Host $line -ForegroundColor Yellow
  }
  elseif ($line -match '\bOK\b') {
    Write-Host $line -ForegroundColor Green
  }
  elseif ($line -match '\bSTART\b') {
    Write-Host $line -ForegroundColor Cyan
  }
  else {
    Write-Host $line
  }
}

function Show-Results([array]$lines) {
  if ($lines.Count -eq 0) {
    Write-Host "No log entries found for the given filters." -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Tips:" -ForegroundColor DarkGray
    Write-Host "  - Try a wider time window: -Since 6h or -From 'yesterday 00:00'" -ForegroundColor DarkGray
    Write-Host "  - Check module name: .\scripts\logs.ps1 -ListModules" -ForegroundColor DarkGray
    Write-Host "  - Remove level filter: drop -Level to see all levels" -ForegroundColor DarkGray
    return
  }

  $start = [Math]::Max(0, $lines.Count - $Limit)
  $shown = $lines[$start..($lines.Count - 1)]

  if ($lines.Count -gt $Limit) {
    Write-Host ("... ({0} older entries hidden, showing last {1})" -f ($lines.Count - $Limit), $Limit) -ForegroundColor DarkGray
    Write-Host ""
  }

  foreach ($line in $shown) {
    Write-ColorizedLog $line.ToString()
  }

  Write-Host ""
  Write-Host ("-" * 60)
  Write-Host ("{0} entries shown (of {1} total)" -f $shown.Count, $lines.Count) -ForegroundColor DarkGray
}

# ---------- Execute ----------

if ($useAbsoluteMode) {
  # Absolute time range: use filter-log-events (supports --start-time / --end-time).
  # This API is paginated, so we loop with --next-token until done.
  $allMessages = @()
  $nextToken = $null

  do {
    $feArgs = @(
      "logs", "filter-log-events",
      "--log-group-name", $LogGroup,
      "--start-time", $startTimeMs.ToString(),
      "--end-time", $endTimeMs.ToString(),
      "--region", $Region,
      "--output", "json"
    )

    if ($filterPattern) {
      $feArgs += @("--filter-pattern", $filterPattern)
    }

    if ($nextToken) {
      $feArgs += @("--next-token", $nextToken)
    }

    # Capture stdout only; discard stderr (AWS CLI Python charmap warnings on Windows)
    $rawJson = & aws @feArgs 2>$null
    $jsonStr = ($rawJson | Out-String).Trim()

    if (-not $jsonStr -or $jsonStr -notmatch '^\{') {
      Write-Host "ERROR: AWS CLI returned no data. Check credentials and log group." -ForegroundColor Red
      if ($jsonStr) { Write-Host $jsonStr }
      exit 1
    }

    $result = $jsonStr | ConvertFrom-Json

    foreach ($evt in $result.events) {
      # Format: timestamp + message (similar to `aws logs tail --format short`)
      $ts = [DateTimeOffset]::FromUnixTimeMilliseconds($evt.timestamp).LocalDateTime.ToString("yyyy-MM-dd HH:mm:ss")
      $msg = $evt.message.TrimEnd("`r", "`n")
      $allMessages += "$ts  $msg"
    }

    $nextToken = $result.nextToken

    # Safety: stop if we've already collected more than we'll show
    if ($allMessages.Count -gt $Limit * 2 -and -not $nextToken) { break }
    # Also bail if way too many to avoid runaway pagination
    if ($allMessages.Count -gt 10000) {
      Write-Host "WARNING: Truncated at 10,000 entries. Narrow the time range." -ForegroundColor Yellow
      break
    }
  } while ($nextToken)

  Show-Results $allMessages

} else {
  # Relative mode: use `aws logs tail --since` (simpler, supports --follow).
  $awsArgs = @(
    "logs", "tail", $LogGroup,
    "--since", $Since,
    "--region", $Region,
    "--format", "short"
  )

  if ($filterPattern) {
    $awsArgs += @("--filter-pattern", $filterPattern)
  }

  if ($Follow) {
    $awsArgs += "--follow"
    & aws @awsArgs 2>$null | ForEach-Object { Write-ColorizedLog $_.ToString() }
  } else {
    # Capture stdout only; discard stderr (AWS CLI Python charmap warnings on Windows)
    $output = & aws @awsArgs 2>$null
    $lines = @($output | Where-Object { $_ -ne $null -and $_.ToString().Trim() -ne "" })
    Show-Results $lines
  }
}
