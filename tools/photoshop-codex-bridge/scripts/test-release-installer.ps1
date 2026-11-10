[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadRoot
)

$ErrorActionPreference = "Stop"

function Get-NormalizedPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path)
}

function Assert-ChildPath([string]$Child, [string]$Parent) {
  $ResolvedChild = Get-NormalizedPath $Child
  $ResolvedParent = (Get-NormalizedPath $Parent).TrimEnd("\") + "\"
  if (-not $ResolvedChild.StartsWith($ResolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Test path escapes the isolated workspace: $ResolvedChild"
  }
}

$BridgeRoot = Split-Path -Parent $PSScriptRoot
$WorkspaceRoot = Split-Path -Parent $BridgeRoot
$TestRoot = Join-Path $WorkspaceRoot ".codex-tmp\release-installer-test"
Assert-ChildPath -Child $TestRoot -Parent (Join-Path $WorkspaceRoot ".codex-tmp")

if (Test-Path -LiteralPath $TestRoot) {
  Remove-Item -LiteralPath $TestRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $TestRoot -Force | Out-Null

try {
  $InstallBase = Join-Path $TestRoot "installed"
  $CodexConfigPath = Join-Path $TestRoot "user\.codex\config.toml"
  $CepExtensionsRoot = Join-Path $TestRoot "user\AppData\Roaming\Adobe\CEP\extensions"
  New-Item -ItemType Directory -Path (Split-Path -Parent $CodexConfigPath) -Force | Out-Null
  $OriginalConfig = @"
[features]
example = true

[mcp_servers.photoshop_codex_bridge]
command = "old-node"
args = ["old-server.mjs"]

[mcp_servers.other]
command = "other"
"@
  [System.IO.File]::WriteAllText($CodexConfigPath, $OriginalConfig, [System.Text.UTF8Encoding]::new($false))

  & (Join-Path $PayloadRoot "installer\install.ps1") `
    -PayloadRoot $PayloadRoot `
    -InstallBase $InstallBase `
    -CodexConfigPath $CodexConfigPath `
    -CepExtensionsRoot $CepExtensionsRoot `
    -SkipPhotoshopLaunch `
    -SkipRegistryWrites `
    -NoShortcuts

  $StatePath = Join-Path $InstallBase "install-state.json"
  if (-not (Test-Path -LiteralPath $StatePath)) {
    throw "Installer did not write install-state.json."
  }
  $State = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
  $InstalledNode = Join-Path ([string]$State.versionRoot) "runtime\node.exe"
  $InstalledServer = Join-Path ([string]$State.versionRoot) "bridge\mcp-server\server.mjs"
  $InstalledManifest = Join-Path ([string]$State.versionRoot) "photoshop-cep\CSXS\manifest.xml"
  $LiveCepManifest = Join-Path $CepExtensionsRoot "com.humingbirdbird.photoshop-codex-bridge\CSXS\manifest.xml"
  foreach ($Required in @($InstalledNode, $InstalledServer, $InstalledManifest, $LiveCepManifest)) {
    if (-not (Test-Path -LiteralPath $Required)) {
      throw "Installer did not copy required file: $Required"
    }
  }

  $InstalledConfig = Get-Content -LiteralPath $CodexConfigPath -Raw
  if (-not $InstalledConfig.Contains(($InstalledNode -replace "\\", "/"))) {
    throw "Codex config does not reference the installed Node runtime."
  }
  if (-not $InstalledConfig.Contains(($InstalledServer -replace "\\", "/"))) {
    throw "Codex config does not reference the installed bridge server."
  }

  & (Join-Path $InstallBase "uninstall.ps1") `
    -InstallBase $InstallBase `
    -CodexConfigPath $CodexConfigPath `
    -CepExtensionsRoot $CepExtensionsRoot `
    -SkipRegistryWrites `
    -NoShortcuts `
    -KeepFiles

  $RestoredConfig = Get-Content -LiteralPath $CodexConfigPath -Raw
  if (-not $RestoredConfig.Contains('command = "old-node"')) {
    throw "Uninstaller did not restore the previous MCP section."
  }
  if ($RestoredConfig.Contains(($InstalledNode -replace "\\", "/"))) {
    throw "Uninstaller left the release MCP path in Codex config."
  }
  if (Test-Path -LiteralPath $LiveCepManifest) {
    throw "Uninstaller left the CEP extension installed."
  }

  & $InstalledNode --check $InstalledServer
  if ($LASTEXITCODE -ne 0) {
    throw "Installed bridge failed its syntax check."
  }

  Write-Host "release installer test passed"
} finally {
  if (Test-Path -LiteralPath $TestRoot) {
    Remove-Item -LiteralPath $TestRoot -Recurse -Force
  }
}
