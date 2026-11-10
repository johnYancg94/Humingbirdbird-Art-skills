[CmdletBinding()]
param(
  [int]$Port = 47777
)

$ErrorActionPreference = "Stop"
$VersionRoot = Split-Path -Parent $PSScriptRoot
$InstallBase = Split-Path -Parent $VersionRoot
$NodePath = Join-Path $VersionRoot "runtime\node.exe"
$ServerPath = Join-Path $VersionRoot "bridge\mcp-server\server.mjs"
$StatePath = Join-Path $InstallBase "install-state.json"

Write-Host "Photoshop Codex Bridge diagnostics"
Write-Host "Install: $VersionRoot"
Write-Host "Node: $NodePath"
Write-Host "Server: $ServerPath"

if (-not (Test-Path -LiteralPath $NodePath)) {
  throw "Bundled Node runtime is missing."
}
if (-not (Test-Path -LiteralPath $ServerPath)) {
  throw "Bridge server is missing."
}
if (-not (Test-Path -LiteralPath $StatePath)) {
  throw "Installation state is missing."
}
$State = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath ([string]$State.cepExtensionPath))) {
  throw "Photoshop CEP extension is missing: $($State.cepExtensionPath)"
}
Write-Host "Photoshop extension: $($State.cepExtensionPath)"

& $NodePath --check $ServerPath
if ($LASTEXITCODE -ne 0) {
  throw "Bridge server syntax check failed."
}

try {
  $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
  $Health | ConvertTo-Json -Depth 8
} catch {
  Write-Warning "No running bridge responded on port $Port. Start a new Codex task after installation."
}

Write-Host ""
Write-Host "Diagnostics complete."
Read-Host "Press Enter to close"
