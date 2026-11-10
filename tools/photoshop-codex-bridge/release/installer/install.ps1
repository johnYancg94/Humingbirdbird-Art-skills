[CmdletBinding()]
param(
  [string]$PayloadRoot = "",
  [string]$InstallBase = "",
  [string]$CodexConfigPath = "",
  [string]$CepExtensionsRoot = "",
  [switch]$SkipPhotoshopLaunch,
  [switch]$SkipRegistryWrites,
  [switch]$NoShortcuts
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -ge 7) {
  $PSNativeCommandUseErrorActionPreference = $true
}

$ProductName = "Photoshop Codex Bridge"
$ExtensionId = "com.humingbirdbird.photoshop-codex-bridge"
$McpHeader = "[mcp_servers.photoshop_codex_bridge]"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Get-NormalizedPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path)
}

function Get-Sha256([string]$Path) {
  $Stream = [System.IO.File]::OpenRead($Path)
  try {
    $Hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($Hasher.ComputeHash($Stream))).Replace("-", "")
    } finally {
      $Hasher.Dispose()
    }
  } finally {
    $Stream.Dispose()
  }
}

function Convert-ToTomlString([string]$Path) {
  return ($Path -replace "\\", "/") -replace '"', '\"'
}

function Get-TomlSection([string]$Content, [string]$Header) {
  $Escaped = [regex]::Escape($Header)
  $Match = [regex]::Match($Content, "(?ms)^$Escaped\s*\r?\n.*?(?=^\[|\z)")
  if ($Match.Success) {
    return $Match.Value.TrimEnd()
  }
  return ""
}

function Remove-TomlSection([string]$Content, [string]$Header) {
  $Escaped = [regex]::Escape($Header)
  return ([regex]::Replace(
    $Content,
    "(?ms)^$Escaped\s*\r?\n.*?(?=^\[|\z)",
    ""
  )).TrimEnd()
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $Encoding = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($Path, $Content, $Encoding)
}

function Test-PayloadChecksums([string]$Root) {
  $ChecksumPath = Join-Path $Root "checksums.sha256"
  if (-not (Test-Path -LiteralPath $ChecksumPath)) {
    throw "Release checksum file is missing: $ChecksumPath"
  }
  foreach ($Line in Get-Content -LiteralPath $ChecksumPath) {
    if (-not $Line.Trim()) { continue }
    if ($Line -notmatch "^([A-Fa-f0-9]{64}) \*(.+)$") {
      throw "Invalid checksum line: $Line"
    }
    $Expected = $Matches[1].ToUpperInvariant()
    $Relative = $Matches[2]
    $Target = Get-NormalizedPath (Join-Path $Root $Relative)
    $RootPrefix = (Get-NormalizedPath $Root).TrimEnd("\") + "\"
    if (-not $Target.StartsWith($RootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Checksum target escapes the release payload: $Relative"
    }
    if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) {
      throw "Release payload file is missing: $Relative"
    }
    if ((Get-Sha256 -Path $Target) -ne $Expected) {
      throw "Checksum mismatch: $Relative"
    }
  }
}

function Find-PhotoshopExecutable {
  $Candidates = Get-ChildItem -LiteralPath "C:\Program Files\Adobe" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "Adobe Photoshop *" } |
    Sort-Object Name -Descending
  foreach ($Candidate in $Candidates) {
    $Executable = Join-Path $Candidate.FullName "Photoshop.exe"
    $CepEngine = Join-Path $Candidate.FullName "Required\CEP\CEPHtmlEngine\CEPHtmlEngine.exe"
    if ((Test-Path -LiteralPath $Executable) -and (Test-Path -LiteralPath $CepEngine)) {
      return $Executable
    }
  }
  return ""
}

if (-not $PayloadRoot) {
  $PayloadRoot = Split-Path -Parent $PSScriptRoot
}
$PayloadRoot = Get-NormalizedPath $PayloadRoot

if (-not $InstallBase) {
  $InstallBase = Join-Path $env:LOCALAPPDATA "Humingbirdbird\PhotoshopCodexBridge"
}
$InstallBase = Get-NormalizedPath $InstallBase

if (-not $CodexConfigPath) {
  $CodexConfigPath = Join-Path $env:USERPROFILE ".codex\config.toml"
}
$CodexConfigPath = Get-NormalizedPath $CodexConfigPath

if (-not $CepExtensionsRoot) {
  $CepExtensionsRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions"
}
$CepExtensionsRoot = Get-NormalizedPath $CepExtensionsRoot
$CepExtensionPath = Join-Path $CepExtensionsRoot $ExtensionId

$ReleaseInfoPath = Join-Path $PayloadRoot "release-info.json"
if (-not (Test-Path -LiteralPath $ReleaseInfoPath)) {
  throw "Release metadata is missing: $ReleaseInfoPath"
}
$ReleaseInfo = Get-Content -LiteralPath $ReleaseInfoPath -Raw | ConvertFrom-Json
$Version = [string]$ReleaseInfo.version
if ($Version -notmatch "^\d+\.\d+\.\d+$") {
  throw "Invalid release version: $Version"
}

$BridgeSource = Join-Path $PayloadRoot "bridge"
$RuntimeSource = Join-Path $PayloadRoot "runtime"
$PhotoshopSource = Join-Path $PayloadRoot "photoshop-cep"
foreach ($Required in @(
  (Join-Path $BridgeSource "mcp-server\server.mjs"),
  (Join-Path $RuntimeSource "node.exe"),
  (Join-Path $PhotoshopSource "CSXS\manifest.xml"),
  (Join-Path $PhotoshopSource "js\main.js"),
  (Join-Path $PhotoshopSource "jsx\bridge.jsx")
)) {
  if (-not (Test-Path -LiteralPath $Required -PathType Leaf)) {
    throw "Required release file is missing: $Required"
  }
}

Write-Step "Verifying release payload"
Test-PayloadChecksums -Root $PayloadRoot

$VersionRoot = Get-NormalizedPath (Join-Path $InstallBase $Version)
$PreviousVersionBackup = ""
$PreviousCepBackup = ""
$ConfigWritten = $false
$PreviousSection = ""
$ConfigBackupPath = ""
$RegistryState = @()

try {
  Write-Step "Installing bridge and standalone Photoshop extension"
  New-Item -ItemType Directory -Path $InstallBase -Force | Out-Null
  if (Test-Path -LiteralPath $VersionRoot) {
    $PreviousVersionBackup = "$VersionRoot.backup-$([guid]::NewGuid().ToString('N'))"
    Move-Item -LiteralPath $VersionRoot -Destination $PreviousVersionBackup
  }
  New-Item -ItemType Directory -Path $VersionRoot -Force | Out-Null
  Copy-Item -LiteralPath $BridgeSource -Destination (Join-Path $VersionRoot "bridge") -Recurse
  Copy-Item -LiteralPath $RuntimeSource -Destination (Join-Path $VersionRoot "runtime") -Recurse
  Copy-Item -LiteralPath $PhotoshopSource -Destination (Join-Path $VersionRoot "photoshop-cep") -Recurse
  Copy-Item -LiteralPath (Join-Path $PayloadRoot "tools") -Destination (Join-Path $VersionRoot "tools") -Recurse

  New-Item -ItemType Directory -Path $CepExtensionsRoot -Force | Out-Null
  if (Test-Path -LiteralPath $CepExtensionPath) {
    $PreviousCepBackup = "$CepExtensionPath.backup-$([guid]::NewGuid().ToString('N'))"
    Move-Item -LiteralPath $CepExtensionPath -Destination $PreviousCepBackup
  }
  Copy-Item -LiteralPath $PhotoshopSource -Destination $CepExtensionPath -Recurse

  if (-not $SkipRegistryWrites) {
    Write-Step "Enabling the standalone CEP extension for this Windows user"
    foreach ($CsxsVersion in 7..20) {
      $RegistryPath = "HKCU:\Software\Adobe\CSXS.$CsxsVersion"
      $HadValue = $false
      $PreviousValue = $null
      if (Test-Path -LiteralPath $RegistryPath) {
        $Property = Get-ItemProperty -LiteralPath $RegistryPath -Name "PlayerDebugMode" -ErrorAction SilentlyContinue
        if ($null -ne $Property) {
          $HadValue = $true
          $PreviousValue = [string]$Property.PlayerDebugMode
        }
      } else {
        New-Item -Path $RegistryPath -Force | Out-Null
      }
      $RegistryState += [ordered]@{
        path = $RegistryPath
        hadValue = $HadValue
        previousValue = $PreviousValue
      }
      New-ItemProperty -LiteralPath $RegistryPath -Name "PlayerDebugMode" -Value "1" -PropertyType String -Force | Out-Null
    }
  }

  Write-Step "Registering Codex MCP server"
  $ConfigDirectory = Split-Path -Parent $CodexConfigPath
  New-Item -ItemType Directory -Path $ConfigDirectory -Force | Out-Null
  $ExistingConfig = ""
  if (Test-Path -LiteralPath $CodexConfigPath) {
    $ExistingConfig = Get-Content -LiteralPath $CodexConfigPath -Raw
    $BackupDirectory = Join-Path $ConfigDirectory "backups"
    New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
    $ConfigBackupPath = Join-Path $BackupDirectory "config.toml.$(Get-Date -Format 'yyyyMMdd-HHmmss').bak"
    Copy-Item -LiteralPath $CodexConfigPath -Destination $ConfigBackupPath
  }

  $ExistingStatePath = Join-Path $InstallBase "install-state.json"
  if (Test-Path -LiteralPath $ExistingStatePath) {
    $ExistingState = Get-Content -LiteralPath $ExistingStatePath -Raw | ConvertFrom-Json
    $PreviousSection = [string]$ExistingState.previousMcpSection
  } else {
    $PreviousSection = Get-TomlSection -Content $ExistingConfig -Header $McpHeader
  }

  $NodePath = Convert-ToTomlString (Join-Path $VersionRoot "runtime\node.exe")
  $ServerPath = Convert-ToTomlString (Join-Path $VersionRoot "bridge\mcp-server\server.mjs")
  $BridgeRoot = Convert-ToTomlString (Join-Path $VersionRoot "bridge")
  $McpSection = @"
$McpHeader
command = "$NodePath"
args = ["$ServerPath"]
cwd = "$BridgeRoot"
startup_timeout_sec = 10
tool_timeout_sec = 60
default_tools_approval_mode = "prompt"
"@
  $ConfigWithoutBridge = Remove-TomlSection -Content $ExistingConfig -Header $McpHeader
  $NewConfig = if ($ConfigWithoutBridge) {
    "$ConfigWithoutBridge`r`n`r`n$McpSection`r`n"
  } else {
    "$McpSection`r`n"
  }
  Write-Utf8NoBom -Path $CodexConfigPath -Content $NewConfig
  $ConfigWritten = $true

  $InstalledUninstaller = Join-Path $InstallBase "uninstall.ps1"
  Copy-Item -LiteralPath (Join-Path $PayloadRoot "installer\uninstall.ps1") -Destination $InstalledUninstaller
  $UninstallCmd = Join-Path $InstallBase "Uninstall-Photoshop-Codex-Bridge.cmd"
  Write-Utf8NoBom -Path $UninstallCmd -Content "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0uninstall.ps1`"`r`nif errorlevel 1 pause`r`n"

  $State = [ordered]@{
    product = $ProductName
    version = $Version
    installBase = $InstallBase
    versionRoot = $VersionRoot
    photoshopInstallMode = "cep-user-extension"
    cepExtensionPath = $CepExtensionPath
    registryState = $RegistryState
    registryWritesSkipped = [bool]$SkipRegistryWrites
    codexConfigPath = $CodexConfigPath
    configBackupPath = $ConfigBackupPath
    previousMcpSection = $PreviousSection
    installedAt = (Get-Date).ToString("o")
  }
  Write-Utf8NoBom -Path $ExistingStatePath -Content ($State | ConvertTo-Json -Depth 8)

  if (-not $NoShortcuts) {
    Write-Step "Creating Start menu shortcuts"
    $StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Humingbirdbird\Photoshop Codex Bridge"
    New-Item -ItemType Directory -Path $StartMenu -Force | Out-Null
    $Shell = New-Object -ComObject WScript.Shell

    $DiagnosticShortcut = $Shell.CreateShortcut((Join-Path $StartMenu "Diagnose Photoshop Codex Bridge.lnk"))
    $DiagnosticShortcut.TargetPath = "powershell.exe"
    $DiagnosticShortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $VersionRoot 'tools\diagnose-installed.ps1')`""
    $DiagnosticShortcut.WorkingDirectory = $VersionRoot
    $DiagnosticShortcut.Save()

    $UninstallShortcut = $Shell.CreateShortcut((Join-Path $StartMenu "Uninstall Photoshop Codex Bridge.lnk"))
    $UninstallShortcut.TargetPath = $UninstallCmd
    $UninstallShortcut.WorkingDirectory = $InstallBase
    $UninstallShortcut.Save()
  }

  $PhotoshopExecutable = Find-PhotoshopExecutable
  if (-not $SkipPhotoshopLaunch -and $PhotoshopExecutable) {
    Write-Step "Starting Photoshop"
    Start-Process -FilePath $PhotoshopExecutable
  }

  if ($PreviousVersionBackup -and (Test-Path -LiteralPath $PreviousVersionBackup)) {
    Remove-Item -LiteralPath $PreviousVersionBackup -Recurse -Force
  }
  if ($PreviousCepBackup -and (Test-Path -LiteralPath $PreviousCepBackup)) {
    Remove-Item -LiteralPath $PreviousCepBackup -Recurse -Force
  }

  Write-Host ""
  Write-Host "$ProductName $Version installed successfully." -ForegroundColor Green
  Write-Host "No UXP Developer Tools or Adobe UPIA installation step is required."
  Write-Host "In Photoshop, open Window > Extensions (Legacy) > Photoshop Codex Bridge."
  Write-Host "Restart Codex and open a new task so the MCP configuration is reloaded."
} catch {
  $Failure = $_
  Write-Warning "Installation failed. Rolling back changes."
  if ($ConfigWritten) {
    if ($ConfigBackupPath -and (Test-Path -LiteralPath $ConfigBackupPath)) {
      Copy-Item -LiteralPath $ConfigBackupPath -Destination $CodexConfigPath -Force
    } elseif (Test-Path -LiteralPath $CodexConfigPath) {
      Remove-Item -LiteralPath $CodexConfigPath -Force
    }
  }
  foreach ($Entry in $RegistryState) {
    if ($Entry.hadValue) {
      New-ItemProperty -LiteralPath $Entry.path -Name "PlayerDebugMode" -Value ([string]$Entry.previousValue) -PropertyType String -Force | Out-Null
    } else {
      Remove-ItemProperty -LiteralPath $Entry.path -Name "PlayerDebugMode" -ErrorAction SilentlyContinue
    }
  }
  if (Test-Path -LiteralPath $CepExtensionPath) {
    Remove-Item -LiteralPath $CepExtensionPath -Recurse -Force
  }
  if ($PreviousCepBackup -and (Test-Path -LiteralPath $PreviousCepBackup)) {
    Move-Item -LiteralPath $PreviousCepBackup -Destination $CepExtensionPath
  }
  if (Test-Path -LiteralPath $VersionRoot) {
    Remove-Item -LiteralPath $VersionRoot -Recurse -Force
  }
  if ($PreviousVersionBackup -and (Test-Path -LiteralPath $PreviousVersionBackup)) {
    Move-Item -LiteralPath $PreviousVersionBackup -Destination $VersionRoot
  }
  throw $Failure
}
