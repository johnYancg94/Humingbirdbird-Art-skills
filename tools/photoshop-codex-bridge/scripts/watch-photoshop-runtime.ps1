param(
  [int]$Port = 47777,
  [int]$IntervalSeconds = 2,
  [int]$TimeoutSeconds = 300,
  [switch]$RunRuntimeCheck,
  [switch]$AutoApplyAlreadyEnabled,
  [switch]$RequireDescriptors,
  [switch]$RequireRealtime,
  [switch]$ExpectTimeout
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -ge 7) {
  $PSNativeCommandUseErrorActionPreference = $true
}

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string[]]$Arguments = @()
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE"
  }
}

function Get-Json($Path) {
  Invoke-RestMethod -Uri "http://127.0.0.1:$Port$Path" -Method Get -TimeoutSec 2
}

function Test-Ready($Health) {
  $Status = $Health.photoshop.latestClientStatus
  if (-not $Health.photoshop.hasSnapshot) { return $false }
  if ($Health.photoshop.snapshotAgeMs -eq $null -or $Health.photoshop.snapshotAgeMs -gt 10000) { return $false }
  if (-not $Status.polling) { return $false }
  if (-not $Status.hasDocument) { return $false }
  if ($Status.photoshopVersion -eq "smoke") { return $false }
  if ($Status.documentTitle -eq "smoke-test.psd") { return $false }
  if (($Status.layerCount -as [int]) -lt 1) { return $false }
  return $true
}

$Root = Split-Path -Parent $PSScriptRoot
$WorkspaceRoot = Split-Path -Parent $Root
$Deadline = (Get-Date).AddSeconds($TimeoutSeconds)

Push-Location $WorkspaceRoot
try {
  Write-Host "Watching Photoshop runtime on http://127.0.0.1:$Port"
  Write-Host "Install the CEP release, restart Photoshop, open a duplicate PSD, then open Window > Extensions (Legacy) > Photoshop Codex Bridge."

  while ((Get-Date) -lt $Deadline) {
    try {
      $Health = Get-Json "/health"
      $Summary = Get-Json "/codex/layer-state-summary"
      $Status = $Health.photoshop.latestClientStatus
      $Line = "snapshot=$($Health.photoshop.hasSnapshot) ageMs=$($Health.photoshop.snapshotAgeMs) polling=$($Status.polling) doc=$($Status.documentTitle) layers=$($Summary.layerState.totalLayers) descriptors=$($Summary.layerState.descriptor.ok)/$($Summary.layerState.descriptor.failed)/$($Summary.layerState.descriptor.missing)"
      Write-Host $Line

      if (Test-Ready $Health) {
        Write-Host "Photoshop runtime appears ready."
        if ($RunRuntimeCheck) {
          $Args = @(
            "-ExecutionPolicy", "Bypass",
            "-File", ".\photoshop-codex-bridge\scripts\run-photoshop-runtime-check.ps1",
            "-RenameFirstLayer",
            "-GroupFirstLayers", "2"
          )
          if ($AutoApplyAlreadyEnabled) { $Args += "-AutoApplyAlreadyEnabled" }
          if ($RequireDescriptors) { $Args += "-RequireDescriptors" }
          if ($RequireRealtime) { $Args += "-RequireRealtime" }
          Invoke-Native -FilePath powershell -Arguments $Args
        }
        return
      }
    } catch {
      Write-Host "Waiting for broker/runtime: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds $IntervalSeconds
  }

  $Message = "Photoshop runtime was not ready within $TimeoutSeconds seconds."
  if ($ExpectTimeout) {
    Write-Host $Message
    return
  }
  throw $Message
} finally {
  Pop-Location
}
