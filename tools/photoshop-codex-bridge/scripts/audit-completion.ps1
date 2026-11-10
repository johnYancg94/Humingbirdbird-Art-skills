param(
  [string]$RuntimeReport = "",
  [switch]$RequireRename,
  [switch]$RequireGrouping,
  [switch]$RequireDescriptors,
  [switch]$RequireRealtime,
  [switch]$LocalOnly
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

Push-Location $WorkspaceRoot
try {
  Invoke-Native -FilePath powershell -Arguments @(
    "-ExecutionPolicy", "Bypass",
    "-File", ".\photoshop-codex-bridge\scripts\run-local-checks.ps1"
  )

  if ($LocalOnly) {
    Write-Host "local-only audit passed"
    Write-Host "Full goal is not complete until a Photoshop 2026 runtime report is validated."
    return
  }

  if (-not $RuntimeReport) {
    throw "RuntimeReport is required for completion audit. Use -LocalOnly only when intentionally skipping Photoshop runtime evidence."
  }

  $ValidateArgs = @(
    ".\photoshop-codex-bridge\scripts\validate-runtime-report.mjs",
    "--report", $RuntimeReport
  )

  if ($RequireRename) {
    $ValidateArgs += "--require-rename"
  }

  if ($RequireGrouping) {
    $ValidateArgs += "--require-grouping"
  }

  if ($RequireDescriptors) {
    $ValidateArgs += "--require-descriptors"
  }

  if ($RequireRealtime) {
    $ValidateArgs += "--require-realtime"
  }

  Invoke-Native -FilePath node -Arguments $ValidateArgs
  Write-Host "completion audit passed"
} finally {
  Pop-Location
}
