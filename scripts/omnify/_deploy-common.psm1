# _deploy-common.psm1
#
# Shared deploy-time guards and helpers for scripts/deploy.ps1 and siblings.
#
# Part of the AWS split-brain remediation -- see plan Phase 3a. Every function
# here exists to prevent a specific failure mode we hit this week:
#   - Assert-NoSplitBrain         -- catches dual-cluster traffic (the root
#                                   cause of the /full/full, 401, stale-secret
#                                   flakiness).
#   - Assert-CleanWorkingTree     -- catches `COPY .` silently shipping
#                                   uncommitted files (hit twice: Phase 3
#                                   affiliates sync, mobile route).
#   - New-AppImageTag             -- enforces the `<app>-<yyyymmdd>-<sha>`
#                                   image-tag discipline (replaces the vN /
#                                   full-vN / claude-control-vN chaos).
#   - Assert-SingleTaskDefInTargetGroup
#                                 -- post-deploy assertion to catch silent
#                                   split-brain the moment it reappears.
#
# Usage (from scripts/deploy.ps1):
#   Import-Module (Join-Path $PSScriptRoot "_cluster.psm1")      -Force
#   Import-Module (Join-Path $PSScriptRoot "_deploy-common.psm1") -Force
#   Assert-CleanWorkingTree
#   Assert-NoSplitBrain
#   $tag = New-AppImageTag -AppName 'omnify'
#   ...build + push + update service...
#   Assert-SingleTaskDefInTargetGroup -TargetGroupArn $tgArn

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Sibling cluster module is expected to be imported into the caller session
# BEFORE this module. We deliberately do NOT `Import-Module _cluster.psm1`
# here because a nested import only makes the symbols visible inside this
# module, not in the caller's session -- callers would then lose access to
# `Assert-CanonicalCluster` and `$CanonicalCluster` (we hit this during the
# Phase 3a sanity check on 2026-04-22).
#
# The canonical usage is:
#   Import-Module (Join-Path $PSScriptRoot "_cluster.psm1")      -Force
#   Import-Module (Join-Path $PSScriptRoot "_deploy-common.psm1") -Force
#
# We mirror the canonical cluster name here so this module is usable in
# isolation too (e.g. a one-off ad-hoc `Assert-NoSplitBrain` at the repl).
# Keep these two literals in sync; there is no authoritative runtime
# dependency between the modules.
$script:CanonicalCluster = "cpg-labs"

# Image-tag pattern enforced by New-AppImageTag. Legacy patterns (vN, full-vN,
# claude-control-vN) are intentionally rejected -- see plan Phase 3b.
$script:ImageTagPattern = '^[a-z][a-z0-9-]*-[0-9]{8}-[0-9a-f]{7,40}$'

function Assert-NoSplitBrain {
  <#
    .SYNOPSIS
      Throw if any non-canonical ECS cluster has running tasks.
    .DESCRIPTION
      Enumerates every ECS cluster in the account (via `aws ecs list-clusters`)
      and, for each cluster whose name is NOT the canonical cluster, sums the
      runningCount across its services. If the total is > 0, throws with the
      offending cluster name and task count.

      This is the programmatic version of the manual audit that uncovered the
      split-brain on 2026-04-22. See plan Phase 0-2 and Phase 3a.
    .PARAMETER Region
      AWS region to target. Defaults to us-east-1.
  #>
  [CmdletBinding()]
  param(
    [string]$Region = "us-east-1"
  )

  Write-Host "[guards] Assert-NoSplitBrain: enumerating ECS clusters in $Region..."

  $clustersJson = aws ecs list-clusters --region $Region --output json
  if (-not $?) {
    throw "Assert-NoSplitBrain: 'aws ecs list-clusters' failed. Check AWS credentials / region."
  }

  $clusterArns = ($clustersJson | ConvertFrom-Json).clusterArns
  if (-not $clusterArns) { $clusterArns = @() }

  $offenders = @()
  foreach ($arn in $clusterArns) {
    # Cluster name is the final segment of the ARN.
    $name = ($arn -split "/")[-1]
    if ($name -eq $script:CanonicalCluster) { continue }

    # Sum runningCount across all services in this non-canonical cluster.
    $runningJson = aws ecs describe-clusters --clusters $name --region $Region --output json
    if (-not $?) {
      throw ("Assert-NoSplitBrain: 'aws ecs describe-clusters --clusters {0}' failed." -f $name)
    }
    $parsed = $runningJson | ConvertFrom-Json
    # PS 5.1 unwraps single-element arrays from ConvertFrom-Json, so a single-
    # cluster response has no .Count property on $parsed.clusters. @() coerces
    # null / single-object / array uniformly into an array with .Count.
    $clusters = @($parsed.clusters)
    $clusterObj = $null
    if ($clusters.Count -gt 0) {
      $clusterObj = $clusters[0]
    }
    $running = 0
    if ($clusterObj -and ($clusterObj.PSObject.Properties.Name -contains 'runningTasksCount')) {
      $running = [int]$clusterObj.runningTasksCount
    }

    if ($running -gt 0) {
      $offenders += [pscustomobject]@{ Cluster = $name; Running = $running }
    } else {
      Write-Host ("  [ok] non-canonical cluster '{0}' has 0 running tasks." -f $name)
    }
  }

  if ($offenders.Count -gt 0) {
    $detail = ($offenders | ForEach-Object { "{0} (running={1})" -f $_.Cluster, $_.Running }) -join ", "
    $msg = "Split-brain detected: non-canonical cluster(s) still have running tasks: {0}. Canonical cluster is '{1}'. Refusing to deploy. See plan Phase 0-2 and scripts/archive/migrate-cluster.README.md." -f $detail, $script:CanonicalCluster
    throw $msg
  }

  Write-Host "[guards] Assert-NoSplitBrain: OK -- only '$($script:CanonicalCluster)' has running tasks."
}

function Test-DockerIgnored {
  <#
    .SYNOPSIS
      Returns $true if the given path matches a .dockerignore pattern.
    .DESCRIPTION
      The deploy guard's job is to prevent local files from leaking into
      `COPY .` in the Dockerfile. Files already excluded by .dockerignore
      cannot leak — so they shouldn't gate the deploy. This helper reads
      the repo's .dockerignore once and tests paths against the patterns.

      Coverage is the common subset of dockerignore syntax used in this
      repo today (see .dockerignore at repo root):
        - bare dir/file name        -> matches anywhere in path
        - dir name with slash       -> root-anchored
        - extension wildcard *.ext  -> matches any file with extension
        - prefix wildcard prefix*   -> matches name starting with prefix
        - blank lines / # comments  -> skipped
      Negation (!) is not handled — we do not use it in this repo.
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][AllowEmptyString()][string]$Path,
    [Parameter(Mandatory=$true)][AllowEmptyCollection()][AllowEmptyString()][AllowNull()][string[]]$Patterns
  )
  if (-not $Path) { return $false }
  if ($null -eq $Patterns -or $Patterns.Count -eq 0) { return $false }
  $normalized = $Path -replace '\\', '/'
  $normalized = $normalized.TrimStart('/')
  foreach ($raw in $Patterns) {
    if ($null -eq $raw) { continue }
    $p = $raw.Trim()
    if (-not $p -or $p.StartsWith('#') -or $p.StartsWith('!')) { continue }

    if ($p.Contains('/')) {
      # Path-style (root-anchored) pattern.
      $regex = "^" + ([regex]::Escape($p) -replace '\\\*', '[^/]*') + "(/.*)?$"
    } elseif ($p.Contains('*')) {
      # Glob (e.g. *.md, tmp-*). Matches name segments only.
      $regex = "(^|/)" + ([regex]::Escape($p) -replace '\\\*', '[^/]*') + "(/|$)"
    } else {
      # Bare name — matches anywhere in path as a segment.
      $regex = "(^|/)" + [regex]::Escape($p) + "(/|$)"
    }
    if ($normalized -match $regex) { return $true }
  }
  return $false
}

function Assert-CleanWorkingTree {
  <#
    .SYNOPSIS
      Throw if the git working tree has uncommitted changes that would
      actually ship into the Docker image.
    .DESCRIPTION
      The Dockerfile uses `COPY . /app`, so dirty/untracked files can leak
      into the image. We hit this twice: Phase 3 affiliates auto-sync and
      the mobile route were "deployed" before commit, then later sessions
      committing unrelated work changed behavior unreproducibly.

      The guard checks `git status --porcelain`, then filters out paths
      that are already excluded by .dockerignore — those cannot leak, so
      they shouldn't block the deploy. The remaining paths (truly
      shippable dirty files) trigger the throw.

      This implements the durable "future-proof" version asked for after
      the 2026-05-02 chinese-wall WIP block: docs/, inputs/, *.md, etc.
      are all dockerignored, so leaving them dirty across sessions doesn't
      gate every deploy. Anything in public/, app/, prisma/, etc. that
      isn't dockerignored still gates correctly.
    .PARAMETER RepoRoot
      Optional repo root. Defaults to two levels up from this module
      (scripts/omnify/ -> scripts/ -> repo root). The monorepo absorb
      moved this module from scripts/ to scripts/omnify/, so the default
      now climbs one more level than before.
  #>
  [CmdletBinding()]
  param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\.."))
  )

  Push-Location $RepoRoot
  try {
    $porcelain = git status --porcelain
    if (-not $?) {
      throw "Assert-CleanWorkingTree: 'git status --porcelain' failed in $RepoRoot."
    }

    if (-not $porcelain) {
      Write-Host "[guards] Assert-CleanWorkingTree: OK -- working tree is clean."
      return
    }

    # Load .dockerignore patterns once.
    $dockerignorePath = Join-Path $RepoRoot ".dockerignore"
    $patterns = @()
    if (Test-Path $dockerignorePath) {
      # @() ensures array even when the file has 0 or 1 lines.
      $patterns = @(Get-Content $dockerignorePath)
    }

    # PS 5.1 quirk: single-line porcelain output isn't an array, hence @().
    $lines = @(($porcelain -split "`n") | Where-Object { $_ -ne "" })

    # Each porcelain line is `XY <path>` where XY is the status code (2 chars
    # + space). Renames look like `R  old -> new` — we take the new path.
    $shippablePaths = @()
    $ignoredCount = 0
    foreach ($line in $lines) {
      $rest = $line.Substring(3)
      if ($rest -match ' -> ') { $rest = ($rest -split ' -> ')[1] }
      $path = $rest.Trim('"')
      # Cast to [string[]] so PowerShell doesn't try to bind an Object[] of
      # mixed-type elements positionally and trip the "empty string" error.
      $matched = Test-DockerIgnored -Path $path -Patterns ([string[]]$patterns)
      if ($matched) {
        $ignoredCount += 1
      } else {
        $shippablePaths += $line
      }
    }

    if ($ignoredCount -gt 0) {
      Write-Host "[guards] Assert-CleanWorkingTree: $ignoredCount dirty path(s) skipped (.dockerignore)."
    }

    if ($shippablePaths.Count -eq 0) {
      Write-Host "[guards] Assert-CleanWorkingTree: OK -- no shippable dirty paths."
      return
    }

    $preview = ($shippablePaths | Select-Object -First 10) -join "`n  "
    $extra = ""
    if ($shippablePaths.Count -gt 10) {
      $extra = "`n  ... and {0} more" -f ($shippablePaths.Count - 10)
    }
    throw (@"
Assert-CleanWorkingTree: working tree has shippable dirty paths. Dockerfile
COPY . would ship uncommitted changes that don't exist on main, re-creating
the Phase-3-affiliates and mobile-route footgun. Commit or stash before
deploying. Paths covered by .dockerignore have been filtered out and are
not blocking.

Offending paths (not in .dockerignore):
  $preview$extra

See plan Phase 3a and CLAUDE.md "Production and main must stay in sync".
"@)
  }
  finally {
    Pop-Location
  }
}

function New-AppImageTag {
  <#
    .SYNOPSIS
      Build an ECR image tag of the form '<app>-<yyyymmdd>-<short-sha>'.
    .DESCRIPTION
      Enforces the image-tag discipline defined in plan Phase 3b. Refuses to
      produce a tag when the working tree is dirty (the short SHA would lie
      about what's in the image) -- calls Assert-CleanWorkingTree first.

      Rejects any computed tag that doesn't match the canonical pattern
      '^[a-z][a-z0-9-]*-[0-9]{8}-[0-9a-f]{7,40}$', defensively catching a
      bad AppName input.
    .PARAMETER AppName
      Short app slug (e.g. 'cpg-labs', 'omnify', 'storytelling'). Must be
      lowercase, start with a letter, and contain only [a-z0-9-].
    .OUTPUTS
      System.String -- the computed tag.
  #>
  [CmdletBinding()]
  [OutputType([string])]
  param(
    [Parameter(Mandatory = $true)]
    [string]$AppName
  )

  # Use -cnotmatch (case-sensitive). Plain -notmatch is case-insensitive in
  # PowerShell, which would accept 'CpgLabs' as a valid slug.
  if ($AppName -cnotmatch '^[a-z][a-z0-9-]*$') {
    throw ("New-AppImageTag: AppName '{0}' is invalid. Must be lowercase, start with a letter, and contain only [a-z0-9-]. See plan Phase 3b." -f $AppName)
  }

  # Refuse to tag a dirty tree. The SHA would misrepresent image contents.
  Assert-CleanWorkingTree

  $sha = (git rev-parse --short HEAD).Trim()
  if (-not $? -or [string]::IsNullOrWhiteSpace($sha)) {
    throw "New-AppImageTag: 'git rev-parse --short HEAD' failed or returned empty."
  }

  $date = Get-Date -Format "yyyyMMdd"
  $tag = "{0}-{1}-{2}" -f $AppName, $date, $sha

  if ($tag -cnotmatch $script:ImageTagPattern) {
    throw ("New-AppImageTag: computed tag '{0}' does not match canonical pattern '{1}'. Legacy schemes (vN, full-vN, claude-control-vN) are rejected. See plan Phase 3b." -f $tag, $script:ImageTagPattern)
  }

  Write-Host ("[guards] New-AppImageTag: {0}" -f $tag)
  return $tag
}

function Assert-SingleTaskDefInTargetGroup {
  <#
    .SYNOPSIS
      Throw if more than one distinct task-definition revision is attached to
      healthy targets in the given target group.
    .DESCRIPTION
      Post-deploy assertion. Maps each healthy target IP in the TG back to its
      ECS task (via task ENI), then to its taskDefinitionArn. If more than one
      distinct ARN is live, the TG is serving traffic from multiple revisions
      simultaneously -- the exact split-brain signature we're hardening against.

      See plan Phase 3a ("Post-deploy: query TG, assert exactly one distinct
      task-def revision is healthy.").
    .PARAMETER TargetGroupArn
      Full ARN of the target group to inspect.
    .PARAMETER Cluster
      ECS cluster name. Defaults to the canonical cluster.
    .PARAMETER Region
      AWS region. Defaults to us-east-1.
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$TargetGroupArn,
    [string]$Cluster = $script:CanonicalCluster,
    [string]$Region = "us-east-1"
  )

  # Prefer Assert-CanonicalCluster from _cluster.psm1 when loaded; fall back
  # to a local equality check so this function also works in isolation.
  if (Get-Command Assert-CanonicalCluster -ErrorAction SilentlyContinue) {
    Assert-CanonicalCluster -Name $Cluster
  } elseif ($Cluster -ne $script:CanonicalCluster) {
    throw ("Assert-SingleTaskDefInTargetGroup: cluster '{0}' is not canonical (expected '{1}'). See plan Phase 3a." -f $Cluster, $script:CanonicalCluster)
  }

  Write-Host ("[guards] Assert-SingleTaskDefInTargetGroup: inspecting {0}" -f $TargetGroupArn)

  $healthJson = aws elbv2 describe-target-health --target-group-arn $TargetGroupArn --region $Region --output json
  if (-not $?) {
    throw "Assert-SingleTaskDefInTargetGroup: 'aws elbv2 describe-target-health' failed."
  }

  $descriptions = ($healthJson | ConvertFrom-Json).TargetHealthDescriptions
  if (-not $descriptions) { $descriptions = @() }

  # Collect IPs of targets that are currently `healthy`. Unhealthy / draining
  # targets are ignored -- they're not serving traffic and may simply be in
  # the process of being removed.
  $healthyIps = @()
  foreach ($d in $descriptions) {
    $state = $null
    if ($d.TargetHealth -and ($d.TargetHealth.PSObject.Properties.Name -contains 'State')) {
      $state = $d.TargetHealth.State
    }
    if ($state -eq 'healthy' -and $d.Target -and $d.Target.Id) {
      $healthyIps += $d.Target.Id
    }
  }

  if ($healthyIps.Count -eq 0) {
    throw ("Assert-SingleTaskDefInTargetGroup: target group {0} has 0 healthy targets. Cannot verify revision uniqueness -- deploy likely failed to register. See plan Phase 3a." -f $TargetGroupArn)
  }

  Write-Host ("  healthy IPs: {0}" -f ($healthyIps -join ", "))

  # Map IPs -> task -> taskDefinitionArn. We enumerate all running tasks in
  # the cluster once, then match by private IPv4 address.
  $taskArnsJson = aws ecs list-tasks --cluster $Cluster --desired-status RUNNING --region $Region --output json
  if (-not $?) {
    throw "Assert-SingleTaskDefInTargetGroup: 'aws ecs list-tasks' failed."
  }
  $taskArns = ($taskArnsJson | ConvertFrom-Json).taskArns
  if (-not $taskArns -or $taskArns.Count -eq 0) {
    throw ("Assert-SingleTaskDefInTargetGroup: no running tasks in cluster '{0}' but TG has healthy targets. Inconsistent state." -f $Cluster)
  }

  # describe-tasks accepts up to 100 task IDs per call. Chunk defensively.
  $tasks = @()
  $batchSize = 100
  for ($i = 0; $i -lt $taskArns.Count; $i += $batchSize) {
    $end = [Math]::Min($i + $batchSize - 1, $taskArns.Count - 1)
    $batch = $taskArns[$i..$end]
    $descJson = aws ecs describe-tasks --cluster $Cluster --tasks $batch --region $Region --output json
    if (-not $?) {
      throw "Assert-SingleTaskDefInTargetGroup: 'aws ecs describe-tasks' failed."
    }
    $parsed = $descJson | ConvertFrom-Json
    if ($parsed.tasks) { $tasks += $parsed.tasks }
  }

  $revisionsByIp = @{}
  foreach ($t in $tasks) {
    $ip = $null
    if ($t.containers -and $t.containers.Count -gt 0) {
      $c0 = $t.containers[0]
      if ($c0.networkInterfaces -and $c0.networkInterfaces.Count -gt 0) {
        $ip = $c0.networkInterfaces[0].privateIpv4Address
      }
    }
    if ($ip -and ($healthyIps -contains $ip)) {
      $revisionsByIp[$ip] = $t.taskDefinitionArn
    }
  }

  $distinctRevisions = $revisionsByIp.Values | Sort-Object -Unique
  $distinctCount = @($distinctRevisions).Count

  if ($distinctCount -eq 0) {
    throw ("Assert-SingleTaskDefInTargetGroup: could not resolve any healthy TG target back to an ECS task in cluster '{0}'. Check cross-cluster drift. See plan Phase 3a." -f $Cluster)
  }

  if ($distinctCount -gt 1) {
    $detail = ($revisionsByIp.GetEnumerator() | ForEach-Object { "{0} -> {1}" -f $_.Key, $_.Value }) -join "; "
    throw (@"
Split-brain detected: target group $TargetGroupArn has $distinctCount distinct task-definition revisions serving traffic.

IP -> revision map:
  $detail

Only one revision should be live at steady state. See plan Phase 3a and
scripts/archive/migrate-cluster.README.md.
"@)
  }

  Write-Host ("[guards] Assert-SingleTaskDefInTargetGroup: OK -- 1 revision live ({0})." -f $distinctRevisions[0])
}

Export-ModuleMember -Function `
  Assert-NoSplitBrain, `
  Assert-CleanWorkingTree, `
  Test-DockerIgnored, `
  New-AppImageTag, `
  Assert-SingleTaskDefInTargetGroup
