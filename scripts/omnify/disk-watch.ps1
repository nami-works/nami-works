<#
.SYNOPSIS
  Disk space monitor + Docker VHDX cleanup helper.

.DESCRIPTION
  Direct response to the 2026-05-08 incident where Docker Desktop's
  WSL2 VHDX (`%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx`) grew to
  228 GB and tipped C: into 100% full, which manifested as a SIGBUS
  crash inside Docker Desktop during a Vite SSR build. Spec lives at
  inputs/backlog/local-delivery.md → "Disk monitor + Docker VHDX
  reclaim script (proposed)".

  Three modes (one switch per run, default is -Check):

    -Check    : report C: free + docker_data.vhdx size + docker
                system df. Exit 0 if above threshold, 2 if below.
                No mutations. Suitable for Task Scheduler.
    -Cleanup  : ladder of progressively-destructive reclamations,
                each gated on free-space measurement:
                  1) docker system prune -af --volumes
                     (removes unused images, containers, networks,
                      volumes -- non-destructive for live workloads)
                  2) Optimize-VHD -Mode Full on docker_data.vhdx
                     (compact in place; preserves cached images;
                      requires Hyper-V module + restarting Docker)
                  3) Nuke docker_data.vhdx (only with -Force AND
                     free < CriticalGB; loses all Docker images,
                     forces re-pull on next build)
    -Schedule : register a Windows Task Scheduler entry running
                -Check weekly Mondays 09:00 BRT.

.PARAMETER ThresholdGB
  Free-space threshold (default 30 GB). Below this, -Check exits 2
  and -Cleanup proceeds with reclamation.

.PARAMETER CriticalGB
  Critical free-space threshold (default 5 GB). VHDX nuke (step 3 of
  -Cleanup) only fires when free is BELOW this AND -Force is set.

.PARAMETER Force
  Required to enable step 3 of -Cleanup (VHDX nuke). Without -Force,
  -Cleanup exits at step 2 with a "manual intervention required"
  message if it can't reclaim enough space.

.EXAMPLE
  scripts\disk-watch.ps1 -Check

  Default mode. Reports status, exits 0 (above threshold) or 2 (below).

.EXAMPLE
  scripts\disk-watch.ps1 -Cleanup

  Runs prune + Optimize-VHD compaction. Stops short of the destructive
  VHDX nuke unless -Force is also passed.

.EXAMPLE
  scripts\disk-watch.ps1 -Cleanup -Force

  Allows the VHDX-nuke step when free space is critical (< 5 GB).

.EXAMPLE
  scripts\disk-watch.ps1 -Schedule

  Registers the weekly Task Scheduler check. Idempotent -- re-running
  replaces the existing task with -Force.

.NOTES
  Steps 2 and 3 of -Cleanup will stop Docker Desktop and shut down
  WSL. Any running containers / dev sessions in WSL will die. The
  script attempts to relaunch Docker Desktop afterwards.
#>

[CmdletBinding(DefaultParameterSetName = 'Check')]
param(
  [Parameter(ParameterSetName = 'Check')]    [switch]$Check,
  [Parameter(ParameterSetName = 'Cleanup')]  [switch]$Cleanup,
  [Parameter(ParameterSetName = 'Schedule')] [switch]$Schedule,
  [int]$ThresholdGB = 30,
  [int]$CriticalGB = 5,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$VhdxPath = Join-Path $env:LOCALAPPDATA 'Docker\wsl\disk\docker_data.vhdx'
$DockerExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'

function Get-FreeGB {
  [math]::Round((Get-PSDrive C).Free / 1GB, 2)
}

function Get-VhdxGB {
  if (Test-Path $VhdxPath) {
    [math]::Round((Get-Item $VhdxPath).Length / 1GB, 2)
  }
  else {
    0
  }
}

function Test-DockerRunning {
  try {
    $null = docker info --format '{{.ServerVersion}}' 2>$null
    return ($LASTEXITCODE -eq 0)
  }
  catch {
    return $false
  }
}

function Show-Status {
  $free = Get-FreeGB
  $vhdx = Get-VhdxGB
  Write-Host ''
  Write-Host '=== Disk status ==='
  Write-Host ('  C: free          : {0,8:N2} GB' -f $free)
  Write-Host ('  docker_data.vhdx : {0,8:N2} GB' -f $vhdx)
  Write-Host ('  threshold (free) : {0,8:N0} GB' -f $ThresholdGB)
  Write-Host ('  critical (free)  : {0,8:N0} GB' -f $CriticalGB)

  if (Test-DockerRunning) {
    Write-Host ''
    Write-Host '=== docker system df ==='
    docker system df 2>&1 | Out-String | Write-Host
  }
  else {
    Write-Host '  Docker engine: not reachable'
  }

  return [pscustomobject]@{ FreeGB = $free; VhdxGB = $vhdx }
}

function Stop-DockerAndWsl {
  Write-Host 'Stopping Docker processes...'
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'Docker|com\.docker|vpnkit' } |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Write-Host 'Shutting down WSL...'
  wsl --shutdown 2>&1 | Out-Host
  Start-Sleep -Seconds 2
}

function Start-DockerDesktopAndWait {
  if (-not (Test-Path $DockerExe)) {
    Write-Warning "Docker Desktop executable not found at $DockerExe -- start it manually."
    return $false
  }
  Write-Host 'Starting Docker Desktop...'
  Start-Process $DockerExe
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    if (Test-DockerRunning) {
      $ver = docker info --format '{{.ServerVersion}}' 2>$null
      Write-Host "Docker Desktop is ready (server $ver)."
      return $true
    }
    Start-Sleep -Seconds 5
  }
  Write-Warning "Docker Desktop launched but engine didn't respond within 90s. Continue manually."
  return $false
}

function Invoke-Check {
  $status = Show-Status
  Write-Host ''
  if ($status.FreeGB -lt $ThresholdGB) {
    Write-Warning ('Free space ({0:N2} GB) is below threshold ({1} GB).' -f $status.FreeGB, $ThresholdGB)
    Write-Host "Run 'scripts\disk-watch.ps1 -Cleanup' to reclaim."
    exit 2
  }
  Write-Host -ForegroundColor Green ('OK -- {0:N2} GB free (threshold {1} GB).' -f $status.FreeGB, $ThresholdGB)
  exit 0
}

function Invoke-Cleanup {
  Write-Host '=== disk-watch -Cleanup ==='
  $before = Show-Status
  if ($before.FreeGB -ge $ThresholdGB) {
    Write-Host ''
    Write-Host -ForegroundColor Green ('Already above threshold ({0:N2} GB free, threshold {1} GB). Nothing to do.' -f $before.FreeGB, $ThresholdGB)
    exit 0
  }

  # ---- Step 1: docker system prune ----
  Write-Host ''
  Write-Host '--- Step 1: docker system prune -af --volumes ---'
  if (Test-DockerRunning) {
    try {
      docker system prune -af --volumes 2>&1 | Out-Host
    }
    catch {
      Write-Warning "docker system prune failed: $($_.Exception.Message). Skipping to step 2."
    }
  }
  else {
    Write-Warning 'Docker engine not reachable -- skipping prune.'
  }

  $afterStep1 = Get-FreeGB
  Write-Host ('After step 1: {0:N2} GB free (was {1:N2}).' -f $afterStep1, $before.FreeGB)
  if ($afterStep1 -ge $ThresholdGB) {
    Write-Host -ForegroundColor Green 'Step 1 was enough. Done.'
    exit 0
  }

  # ---- Step 2: Optimize-VHD compaction ----
  Write-Host ''
  Write-Host '--- Step 2: Optimize-VHD compaction ---'
  if (Get-Command Optimize-VHD -ErrorAction SilentlyContinue) {
    if (-not (Test-Path $VhdxPath)) {
      Write-Warning "VHDX not found at $VhdxPath -- nothing to compact."
    }
    else {
      Stop-DockerAndWsl
      Write-Host "Compacting $VhdxPath (Mode Full -- may take several minutes)..."
      try {
        Optimize-VHD -Path $VhdxPath -Mode Full
        Write-Host 'Compaction complete.'
      }
      catch {
        Write-Warning "Optimize-VHD failed: $($_.Exception.Message)"
      }
      Start-DockerDesktopAndWait | Out-Null
    }

    $afterStep2 = Get-FreeGB
    Write-Host ('After step 2: {0:N2} GB free.' -f $afterStep2)
    if ($afterStep2 -ge $ThresholdGB) {
      Write-Host -ForegroundColor Green 'Step 2 reclaimed enough. Done.'
      exit 0
    }
  }
  else {
    Write-Warning 'Optimize-VHD unavailable (Hyper-V module not installed). Skipping step 2.'
    Write-Host '  To install: Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-Management-PowerShell'
  }

  # ---- Step 3: VHDX nuke (gated on -Force AND critical) ----
  Write-Host ''
  Write-Host '--- Step 3: VHDX nuke ---'
  $nowFree = Get-FreeGB
  if (-not $Force) {
    Write-Warning 'Free space still below threshold but -Force not passed.'
    Write-Host 'Re-run with -Force to nuke the VHDX (loses ALL Docker images, requires re-pull on next build):'
    Write-Host '  scripts\disk-watch.ps1 -Cleanup -Force'
    exit 2
  }
  if ($nowFree -gt $CriticalGB) {
    Write-Warning ('Free space ({0:N2} GB) is above the critical threshold ({1} GB). VHDX nuke not warranted.' -f $nowFree, $CriticalGB)
    Write-Host 'If you really want to wipe the cache, do it manually.'
    exit 2
  }

  Stop-DockerAndWsl
  if (Test-Path $VhdxPath) {
    Write-Host "Deleting $VhdxPath..."
    Remove-Item $VhdxPath -Force
    Write-Host 'VHDX nuked.'
  }
  Start-DockerDesktopAndWait | Out-Null

  $finalFree = Get-FreeGB
  Write-Host ''
  Write-Host -ForegroundColor Green ('Final: {0:N2} GB free (was {1:N2}).' -f $finalFree, $before.FreeGB)
  exit 0
}

function Invoke-Schedule {
  $taskName = 'CPGLabs-DiskWatch'
  $scriptPath = (Resolve-Path $PSCommandPath).Path
  Write-Host "Registering Windows Task Scheduler entry: $taskName"
  Write-Host '  Trigger : weekly Mondays 09:00 (local time)'
  Write-Host "  Action  : powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -Check"

  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -Check' -f $scriptPath)
  $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At '09:00'
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

  Write-Host -ForegroundColor Green "OK -- registered. Verify via 'Get-ScheduledTask -TaskName $taskName'."
  Write-Host ''
  Write-Host 'Notes:'
  Write-Host '  - Runs as the current user; no admin needed.'
  Write-Host '  - Exit code 2 from the script means below-threshold; configure'
  Write-Host '    Task Scheduler email-on-failure to surface it.'
  Write-Host "  - Unregister via: Unregister-ScheduledTask -TaskName $taskName -Confirm:`$false"
}

# ---- dispatch ----
if ($Cleanup) {
  Invoke-Cleanup
}
elseif ($Schedule) {
  Invoke-Schedule
}
else {
  # default: -Check (also when no switch passed at all)
  Invoke-Check
}
