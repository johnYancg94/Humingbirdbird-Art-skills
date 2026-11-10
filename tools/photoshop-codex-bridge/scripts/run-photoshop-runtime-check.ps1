param(
  [int]$TimeoutMs = 120000,
  [Nullable[int]]$RenameLayerId = $null,
  [string]$RenameTo = "",
  [switch]$RenameFirstLayer,
  [string]$RenamePrefix = "Codex_Runtime_Rename_Test",
  [string]$GroupPrefixDelimiter = "",
  [int]$GroupMinSize = 2,
  [string]$GroupNamePrefix = "",
  [Nullable[int]]$GroupFirstLayers = $null,
  [string]$GroupName = "Codex_Runtime_Group_Test",
  [switch]$AutoApplyAlreadyEnabled,
  [switch]$RequireDescriptors,
  [switch]$RequireRealtime,
  [int]$RealtimeWindowMs = 15000,
  [switch]$SkipReportValidation,
  [string]$Out = ""
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

$Root = Split-Path -Parent $PSScriptRoot
$WorkspaceRoot = Split-Path -Parent $Root

if (-not $Out) {
  $Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $Out = Join-Path $WorkspaceRoot ".codex-tmp\photoshop-runtime-$Stamp.json"
}

Write-Host "Photoshop runtime verification"
Write-Host "1. Install the CEP release and restart Photoshop."
Write-Host "2. Open a duplicate PSD in Photoshop 2026."
Write-Host "3. Open Window > Extensions (Legacy) > Photoshop Codex Bridge."
if (($RenameLayerId -ne $null -and $RenameTo) -or $RenameFirstLayer -or $GroupPrefixDelimiter -or ($GroupFirstLayers -ne $null)) {
  Write-Host "4. Agent commands execute automatically after snapshot, document, and preview guards pass."

}

$Args = @(
  ".\photoshop-codex-bridge\scripts\wait-for-photoshop-runtime.mjs",
  "--timeout-ms", "$TimeoutMs",
  "--out", $Out
)

if ($RequireRealtime) {
  $Args += @("--require-realtime", "--realtime-window-ms", "$RealtimeWindowMs")
}

if ($RenameLayerId -ne $null -and $RenameTo) {
  $Args += @("--rename-layer-id", "$RenameLayerId", "--rename-to", $RenameTo)
}

if ($RenameFirstLayer) {
  $Args += @("--rename-first-layer", "--rename-prefix", $RenamePrefix)
}

if ($GroupPrefixDelimiter) {
  $Args += @(
    "--group-prefix-delimiter", $GroupPrefixDelimiter,
    "--group-min-size", "$GroupMinSize"
  )
  if ($GroupNamePrefix) {
    $Args += @("--group-name-prefix", $GroupNamePrefix)
  }
}

if ($GroupFirstLayers -ne $null) {
  $Args += @("--group-first-layers", "$GroupFirstLayers", "--group-name", $GroupName)
}

Push-Location $WorkspaceRoot
try {
  Invoke-Native -FilePath node -Arguments $Args
  if (-not $SkipReportValidation) {
    $ValidateArgs = @(
      ".\photoshop-codex-bridge\scripts\validate-runtime-report.mjs",
      "--report", $Out
    )
    if (($RenameLayerId -ne $null -and $RenameTo) -or $RenameFirstLayer) {
      $ValidateArgs += "--require-rename"
    }
    if ($GroupPrefixDelimiter -or ($GroupFirstLayers -ne $null)) {
      $ValidateArgs += "--require-grouping"
    }
    if ($RequireDescriptors) {
      $ValidateArgs += "--require-descriptors"
    }
    if ($RequireRealtime) {
      $ValidateArgs += "--require-realtime"
    }
    Invoke-Native -FilePath node -Arguments $ValidateArgs
  }
  Write-Host "runtime report: $Out"
} finally {
  Pop-Location
}
