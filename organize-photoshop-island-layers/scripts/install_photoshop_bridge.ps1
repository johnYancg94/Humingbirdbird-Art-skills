[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$Dependency = (Get-Content -Raw -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) "dependencies.json") | ConvertFrom-Json).dependencies[0]
$Version = [string]$Dependency.version
$ExtensionId = "com.humingbirdbird.photoshop-codex-bridge"
$ArchiveUrl = [string]$Dependency.artifactUrl
$ExpectedHash = [string]$Dependency.sha256
$InstallBase = Join-Path $env:LOCALAPPDATA "Humingbirdbird\PhotoshopCodexBridge"
$VersionRoot = Join-Path $InstallBase $Version
$CepRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions\$ExtensionId"
$CodexConfig = Join-Path $env:USERPROFILE ".codex\config.toml"

function Test-BridgeDependency {
  if (-not (Test-Path -LiteralPath (Join-Path $VersionRoot "runtime\node.exe") -PathType Leaf)) { return $false }
  if (-not (Test-Path -LiteralPath (Join-Path $VersionRoot "bridge\mcp-server\server.mjs") -PathType Leaf)) { return $false }
  $ManifestPath = Join-Path $CepRoot "CSXS\manifest.xml"
  if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { return $false }
  try {
    [xml]$Manifest = Get-Content -LiteralPath $ManifestPath -Raw
    if ([string]$Manifest.ExtensionManifest.ExtensionBundleVersion -ne $Version) { return $false }
  } catch {
    return $false
  }
  if (-not (Test-Path -LiteralPath (Join-Path $CepRoot "js\command-policy.js") -PathType Leaf)) { return $false }
  if (-not (Test-Path -LiteralPath (Join-Path $CepRoot "js\connection-policy.js") -PathType Leaf)) { return $false }
  if (-not (Test-Path -LiteralPath $CodexConfig -PathType Leaf)) { return $false }
  $Config = Get-Content -LiteralPath $CodexConfig -Raw
  if (-not $Config.Contains("[mcp_servers.photoshop_codex_bridge]")) { return $false }
  if (-not $Config.Contains("Humingbirdbird/PhotoshopCodexBridge/$Version/bridge/mcp-server/server.mjs")) { return $false }
  foreach ($Entry in $Dependency.installedFiles) {
    $Base = if ($Entry.root -eq 'cep') { $CepRoot } else { $VersionRoot }
    $File = Join-Path $Base $Entry.path
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { return $false }
    if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ne $Entry.sha256) { return $false }
  }
  return $true
}

function Write-Result([bool]$AlreadyInstalled) {
  [ordered]@{
    ok = $true
    installed = $true
    alreadyInstalled = $AlreadyInstalled
    dependency = "photoshop-codex-bridge"
    version = $Version
    photoshopRestartRequired = -not $AlreadyInstalled
    agentRestartRequired = -not $AlreadyInstalled
    requiresUxpDeveloperTools = $false
    requiresUpia = $false
  } | ConvertTo-Json
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "Photoshop Codex Bridge v$Version dependency currently supports Windows only."
}
if (-not $Force -and (Test-BridgeDependency)) {
  Write-Result -AlreadyInstalled $true
  exit 0
}

$TempRoot = Join-Path $env:TEMP ("photoshop-codex-bridge-skill-" + [guid]::NewGuid().ToString("N"))
try {
  New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
  $ArchivePath = Join-Path $TempRoot "Photoshop-Codex-Bridge-v$Version-win-x64.zip"
  Invoke-WebRequest -UseBasicParsing -Uri $ArchiveUrl -OutFile $ArchivePath
  $ActualHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash
  if ($ActualHash -ne $ExpectedHash) {
    throw "Photoshop Codex Bridge archive checksum mismatch."
  }
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $TempRoot -Force
  $ReleaseRoot = Join-Path $TempRoot "Photoshop-Codex-Bridge-v$Version-win-x64"
  $PayloadRoot = Join-Path $ReleaseRoot "payload"
  $Installer = Join-Path $PayloadRoot "installer\install.ps1"
  if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) {
    throw "Downloaded Photoshop Codex Bridge installer is missing."
  }
  & $Installer -PayloadRoot $PayloadRoot -SkipPhotoshopLaunch
  if (-not (Test-BridgeDependency)) {
    throw "Photoshop Codex Bridge installation completed without passing dependency verification."
  }
  Write-Result -AlreadyInstalled $false
} finally {
  if (Test-Path -LiteralPath $TempRoot) {
    $ResolvedTemp = [System.IO.Path]::GetFullPath($TempRoot)
    $AllowedTemp = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    if (-not $ResolvedTemp.StartsWith($AllowedTemp, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Temporary path escaped TEMP' }
    Remove-Item -LiteralPath $ResolvedTemp -Recurse -Force
  }
}
