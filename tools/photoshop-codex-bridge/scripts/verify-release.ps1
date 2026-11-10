[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ReleaseFolder,
  [Parameter(Mandatory = $true)]
  [string]$ReleaseZip
)

$ErrorActionPreference = "Stop"

function Get-NormalizedPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path)
}

function Test-ChecksumFile([string]$Root, [string]$ChecksumPath) {
  foreach ($Line in Get-Content -LiteralPath $ChecksumPath) {
    if (-not $Line.Trim()) {
      continue
    }
    if ($Line -notmatch "^([A-Fa-f0-9]{64}) \*(.+)$") {
      throw "Invalid checksum line in $ChecksumPath`: $Line"
    }
    $Expected = $Matches[1].ToUpperInvariant()
    $Relative = $Matches[2] -replace "/", "\"
    $Target = Get-NormalizedPath (Join-Path $Root $Relative)
    $RootPrefix = (Get-NormalizedPath $Root).TrimEnd("\") + "\"
    if (-not $Target.StartsWith($RootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Checksum target escapes release root: $Relative"
    }
    if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) {
      throw "Checksummed release file is missing: $Relative"
    }
    $Actual = (Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash
    if ($Actual -ne $Expected) {
      throw "Checksum mismatch: $Relative"
    }
  }
}

$ReleaseFolder = Get-NormalizedPath $ReleaseFolder
$ReleaseZip = Get-NormalizedPath $ReleaseZip
if (-not (Test-Path -LiteralPath $ReleaseFolder -PathType Container)) {
  throw "Release folder was not found: $ReleaseFolder"
}
if (-not (Test-Path -LiteralPath $ReleaseZip -PathType Leaf)) {
  throw "Release archive was not found: $ReleaseZip"
}

foreach ($Required in @(
  "Install.bat",
  "Uninstall.bat",
  "Manual-Install.txt",
  "SHA256SUMS.txt",
  "payload\checksums.sha256",
  "payload\release-info.json",
  "payload\bridge\.codex-plugin\plugin.json",
  "payload\bridge\mcp-server\server.mjs",
  "payload\runtime\node.exe",
  "payload\runtime\NODE-LICENSE.txt",
  "payload\photoshop-cep\CSXS\manifest.xml",
  "payload\photoshop-cep\index.html",
  "payload\photoshop-cep\js\main.js",
  "payload\photoshop-cep\js\poll-policy.js",
  "payload\photoshop-cep\js\command-policy.js",
  "payload\photoshop-cep\js\connection-policy.js",
  "payload\photoshop-cep\jsx\bridge.jsx",
  "payload\installer\install.ps1",
  "payload\installer\uninstall.ps1"
)) {
  if (-not (Test-Path -LiteralPath (Join-Path $ReleaseFolder $Required) -PathType Leaf)) {
    throw "Required release entry is missing: $Required"
  }
}

Test-ChecksumFile -Root $ReleaseFolder -ChecksumPath (Join-Path $ReleaseFolder "SHA256SUMS.txt")
$PayloadRoot = Join-Path $ReleaseFolder "payload"
Test-ChecksumFile -Root $PayloadRoot -ChecksumPath (Join-Path $PayloadRoot "checksums.sha256")

$ReleaseInfo = Get-Content -LiteralPath (Join-Path $PayloadRoot "release-info.json") -Raw | ConvertFrom-Json
$PluginManifest = Get-Content -LiteralPath (Join-Path $PayloadRoot "bridge\.codex-plugin\plugin.json") -Raw | ConvertFrom-Json
[xml]$CepManifest = Get-Content -LiteralPath (Join-Path $PayloadRoot "photoshop-cep\CSXS\manifest.xml") -Raw
if ([string]$ReleaseInfo.version -ne [string]$PluginManifest.version) {
  throw "Release and Codex plugin versions differ."
}
if ([string]$ReleaseInfo.version -ne [string]$CepManifest.ExtensionManifest.ExtensionBundleVersion) {
  throw "Release and CEP extension versions differ."
}
if ([string]$ReleaseInfo.photoshopInstallMode -ne "cep-user-extension") {
  throw "Release does not declare the expected standalone CEP install mode."
}
if ([bool]$ReleaseInfo.requiresUxpDeveloperTools -or [bool]$ReleaseInfo.requiresUpia) {
  throw "Release metadata still declares an Adobe installer dependency."
}

$NodePath = Join-Path $PayloadRoot "runtime\node.exe"
$NodeVersion = & $NodePath --version
if ($LASTEXITCODE -ne 0 -or $NodeVersion.Trim() -ne [string]$ReleaseInfo.nodeVersion) {
  throw "Bundled Node version does not match release metadata."
}
& $NodePath --check (Join-Path $PayloadRoot "bridge\mcp-server\server.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "Bundled bridge server syntax check failed."
}
& $NodePath --check (Join-Path $PayloadRoot "photoshop-cep\js\main.js")
if ($LASTEXITCODE -ne 0) {
  throw "CEP panel JavaScript syntax check failed."
}

$ForbiddenReleaseText = Get-ChildItem -LiteralPath $ReleaseFolder -Recurse -File |
  Where-Object { $_.Extension -in @(".txt", ".md", ".ps1", ".bat", ".json", ".xml", ".js", ".jsx") } |
  Select-String -Pattern @("uxp-development", "photoshop-uxp") -SimpleMatch
if ($ForbiddenReleaseText) {
  throw "Release still contains UXP Developer Tools installation references: $($ForbiddenReleaseText[0].Path)"
}

foreach ($Script in @(
  (Join-Path $PayloadRoot "installer\install.ps1"),
  (Join-Path $PayloadRoot "installer\uninstall.ps1"),
  (Join-Path $PayloadRoot "tools\diagnose-installed.ps1")
)) {
  $null = [scriptblock]::Create((Get-Content -LiteralPath $Script -Raw))
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$Archive = [System.IO.Compression.ZipFile]::OpenRead($ReleaseZip)
try {
  $Entries = @($Archive.Entries | ForEach-Object { $_.FullName -replace "\\", "/" })
  foreach ($Suffix in @(
    "/Install.bat",
    "/Manual-Install.txt",
    "/payload/bridge/.codex-plugin/plugin.json",
    "/payload/photoshop-cep/CSXS/manifest.xml",
    "/payload/runtime/node.exe"
  )) {
    if (-not ($Entries | Where-Object { $_.EndsWith($Suffix, [System.StringComparison]::OrdinalIgnoreCase) })) {
      throw "Release ZIP is missing entry ending with: $Suffix"
    }
  }
} finally {
  $Archive.Dispose()
}

Write-Host "release verification passed"
Write-Host "version: $($ReleaseInfo.version)"
Write-Host "node: $($ReleaseInfo.nodeVersion)"
Write-Host "zip sha256: $((Get-FileHash -LiteralPath $ReleaseZip -Algorithm SHA256).Hash)"
