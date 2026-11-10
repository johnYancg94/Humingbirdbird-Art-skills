[CmdletBinding()]
param(
  [string]$Version = "1.2.0",
  [string]$NodeArchive = "",
  [string]$NodeExecutable = "",
  [string]$NodeLicense = ""
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -ge 7) {
  $PSNativeCommandUseErrorActionPreference = $true
}

function Get-NormalizedPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path)
}

function Assert-ChildPath([string]$Child, [string]$Parent) {
  $ResolvedChild = Get-NormalizedPath $Child
  $ResolvedParent = (Get-NormalizedPath $Parent).TrimEnd("\") + "\"
  if (-not $ResolvedChild.StartsWith($ResolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path escapes release workspace: $ResolvedChild"
  }
}

function Reset-Directory([string]$Path, [string]$AllowedParent) {
  Assert-ChildPath -Child $Path -Parent $AllowedParent
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $Encoding = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($Path, $Content, $Encoding)
}

function Get-RelativePath([string]$BasePath, [string]$TargetPath) {
  $BaseFull = (Get-NormalizedPath $BasePath).TrimEnd("\") + "\"
  $TargetFull = Get-NormalizedPath $TargetPath
  $BaseUri = [System.Uri]::new($BaseFull)
  $TargetUri = [System.Uri]::new($TargetFull)
  return [System.Uri]::UnescapeDataString($BaseUri.MakeRelativeUri($TargetUri).ToString()) -replace "/", "\"
}

if ($Version -notmatch "^\d+\.\d+\.\d+$") {
  throw "Version must use release semver, for example 1.0.0."
}

$BridgeRoot = Split-Path -Parent $PSScriptRoot
$ReleaseRoot = Join-Path $BridgeRoot "release"
$BuildRoot = Join-Path $ReleaseRoot ".build"
$DistRoot = Join-Path $ReleaseRoot "dist"
$ProductSlug = "Photoshop-Codex-Bridge-v$Version-win-x64"
$ProductDist = Join-Path $DistRoot $ProductSlug
$PayloadRoot = Join-Path $ProductDist "payload"

$PluginManifest = Get-Content -LiteralPath (Join-Path $BridgeRoot ".codex-plugin\plugin.json") -Raw | ConvertFrom-Json
if ([string]$PluginManifest.version -ne $Version) {
  throw "Codex plugin version $($PluginManifest.version) does not match release version $Version."
}
$CepManifestPath = Join-Path $BridgeRoot "photoshop-cep\CSXS\manifest.xml"
[xml]$CepManifest = Get-Content -LiteralPath $CepManifestPath -Raw
if ([string]$CepManifest.ExtensionManifest.ExtensionBundleVersion -ne $Version) {
  throw "CEP extension version $($CepManifest.ExtensionManifest.ExtensionBundleVersion) does not match release version $Version."
}
if ([string]$CepManifest.ExtensionManifest.ExtensionBundleId -ne "com.humingbirdbird.photoshop-codex-bridge") {
  throw "CEP extension ID is not the production ID."
}

Reset-Directory -Path $BuildRoot -AllowedParent $ReleaseRoot
Reset-Directory -Path $DistRoot -AllowedParent $ReleaseRoot
New-Item -ItemType Directory -Path $PayloadRoot -Force | Out-Null

$BridgeStage = Join-Path $PayloadRoot "bridge"
New-Item -ItemType Directory -Path $BridgeStage -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $BridgeRoot ".codex-plugin") -Destination (Join-Path $BridgeStage ".codex-plugin") -Recurse
Copy-Item -LiteralPath (Join-Path $BridgeRoot "mcp-server") -Destination (Join-Path $BridgeStage "mcp-server") -Recurse
Copy-Item -LiteralPath (Join-Path $BridgeRoot ".mcp.json") -Destination (Join-Path $BridgeStage ".mcp.json")
Copy-Item -LiteralPath (Join-Path $BridgeRoot "README.md") -Destination (Join-Path $BridgeStage "README.md")

$RuntimeStage = Join-Path $PayloadRoot "runtime"
New-Item -ItemType Directory -Path $RuntimeStage -Force | Out-Null
if ($NodeArchive) {
  $NodeArchive = Get-NormalizedPath $NodeArchive
  if (-not (Test-Path -LiteralPath $NodeArchive -PathType Leaf)) {
    throw "Node archive was not found: $NodeArchive"
  }
  $NodeExtract = Join-Path $BuildRoot "node"
  New-Item -ItemType Directory -Path $NodeExtract -Force | Out-Null
  Expand-Archive -LiteralPath $NodeArchive -DestinationPath $NodeExtract -Force
  $NodeFile = Get-ChildItem -LiteralPath $NodeExtract -Recurse -Filter "node.exe" | Select-Object -First 1
  $LicenseFile = Get-ChildItem -LiteralPath $NodeExtract -Recurse -File |
    Where-Object { $_.Name -eq "LICENSE" } |
    Select-Object -First 1
  if (-not $NodeFile -or -not $LicenseFile) {
    throw "Node archive must contain node.exe and LICENSE."
  }
  Copy-Item -LiteralPath $NodeFile.FullName -Destination (Join-Path $RuntimeStage "node.exe")
  Copy-Item -LiteralPath $LicenseFile.FullName -Destination (Join-Path $RuntimeStage "NODE-LICENSE.txt")
} else {
  if (-not $NodeExecutable) {
    $NodeExecutable = (Get-Command node -ErrorAction Stop).Source
  }
  if (-not $NodeLicense) {
    throw "NodeLicense is required when building from a standalone NodeExecutable."
  }
  Copy-Item -LiteralPath (Get-NormalizedPath $NodeExecutable) -Destination (Join-Path $RuntimeStage "node.exe")
  Copy-Item -LiteralPath (Get-NormalizedPath $NodeLicense) -Destination (Join-Path $RuntimeStage "NODE-LICENSE.txt")
}

$NodeVersion = & (Join-Path $RuntimeStage "node.exe") --version
if ($LASTEXITCODE -ne 0) {
  throw "Bundled Node runtime did not start."
}

Copy-Item -LiteralPath (Join-Path $BridgeRoot "photoshop-cep") -Destination (Join-Path $PayloadRoot "photoshop-cep") -Recurse

$InstallerStage = Join-Path $PayloadRoot "installer"
$ToolsStage = Join-Path $PayloadRoot "tools"
New-Item -ItemType Directory -Path $InstallerStage, $ToolsStage -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $ReleaseRoot "installer\install.ps1") -Destination (Join-Path $InstallerStage "install.ps1")
Copy-Item -LiteralPath (Join-Path $ReleaseRoot "installer\uninstall.ps1") -Destination (Join-Path $InstallerStage "uninstall.ps1")
Copy-Item -LiteralPath (Join-Path $ReleaseRoot "installer\diagnose-installed.ps1") -Destination (Join-Path $ToolsStage "diagnose-installed.ps1")

$ReleaseInfo = [ordered]@{
  product = "Photoshop Codex Bridge"
  version = $Version
  architecture = "win-x64"
  photoshopInstallMode = "cep-user-extension"
  requiresUxpDeveloperTools = $false
  requiresUpia = $false
  nodeVersion = $NodeVersion.Trim()
  builtAt = (Get-Date).ToUniversalTime().ToString("o")
}
Write-Utf8NoBom -Path (Join-Path $PayloadRoot "release-info.json") -Content ($ReleaseInfo | ConvertTo-Json)

$ChecksumLines = foreach ($File in Get-ChildItem -LiteralPath $PayloadRoot -Recurse -File | Sort-Object FullName) {
  if ($File.Name -eq "checksums.sha256") {
    continue
  }
  $Relative = (Get-RelativePath -BasePath $PayloadRoot -TargetPath $File.FullName) -replace "\\", "/"
  $Hash = (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash
  "$Hash *$Relative"
}
Write-Utf8NoBom -Path (Join-Path $PayloadRoot "checksums.sha256") -Content (($ChecksumLines -join "`r`n") + "`r`n")

Copy-Item -LiteralPath (Join-Path $ReleaseRoot "Install.bat") -Destination (Join-Path $ProductDist "Install.bat")
Copy-Item -LiteralPath (Join-Path $ReleaseRoot "Uninstall.bat") -Destination (Join-Path $ProductDist "Uninstall.bat")
Copy-Item -LiteralPath (Join-Path $ReleaseRoot "Manual-Install.txt") -Destination (Join-Path $ProductDist "Manual-Install.txt")

$TopLevelChecksums = foreach ($File in Get-ChildItem -LiteralPath $ProductDist -Recurse -File | Sort-Object FullName) {
  if ($File.Name -eq "SHA256SUMS.txt") {
    continue
  }
  $Relative = (Get-RelativePath -BasePath $ProductDist -TargetPath $File.FullName) -replace "\\", "/"
  $Hash = (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash
  "$Hash *$Relative"
}
Write-Utf8NoBom -Path (Join-Path $ProductDist "SHA256SUMS.txt") -Content (($TopLevelChecksums -join "`r`n") + "`r`n")

Add-Type -AssemblyName System.IO.Compression.FileSystem
$ReleaseZip = Join-Path $DistRoot "$ProductSlug.zip"
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $ProductDist,
  $ReleaseZip,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $true
)

Write-Host "release built"
Write-Host "folder: $ProductDist"
Write-Host "archive: $ReleaseZip"
Write-Host "node: $($ReleaseInfo.nodeVersion)"
