# _cluster.psm1
#
# Single source of truth for the canonical ECS cluster name.
#
# Part of the AWS split-brain remediation -- see plan Phase 3a. All deploy
# scripts must reference $CanonicalCluster from this module rather than
# hard-coding a cluster string. A future change of canonical cluster becomes
# a one-line edit here.
#
# Usage:
#   Import-Module (Join-Path $PSScriptRoot "_cluster.psm1") -Force
#   Assert-CanonicalCluster -Name $Cluster

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Module-scoped constant. Exporting as a read-only-by-convention variable --
# consumers should treat this as immutable. Do NOT redefine in downstream
# scripts; import and reference instead.
$script:CanonicalCluster = "cpg-labs"
$CanonicalCluster = $script:CanonicalCluster

function Assert-CanonicalCluster {
  <#
    .SYNOPSIS
      Fail if the supplied ECS cluster name is not the canonical cluster.
    .DESCRIPTION
      Guards deploy / AWS-mutation scripts from targeting a stale cluster
      (e.g. the legacy `omnify-cluster` left over from the migration that
      caused this week's split-brain). See plan Phase 3a and
      scripts/archive/migrate-cluster.README.md.
    .PARAMETER Name
      Cluster name the caller intends to act on.
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  if ([string]::IsNullOrWhiteSpace($Name)) {
    throw "Assert-CanonicalCluster: cluster name is empty. Expected '$script:CanonicalCluster'. See plan Phase 3a."
  }

  if ($Name -ne $script:CanonicalCluster) {
    $msg = "Assert-CanonicalCluster: cluster '{0}' is not canonical. Canonical cluster is '{1}'. Refusing to proceed -- see plan Phase 0-2 and scripts/archive/migrate-cluster.README.md." -f $Name, $script:CanonicalCluster
    throw $msg
  }
}

Export-ModuleMember -Function Assert-CanonicalCluster -Variable CanonicalCluster
