[CmdletBinding()]
param(
  [string]$InstallBase = "",
  [string]$CodexConfigPath = "",
  [string]$CepExtensionsRoot = "",
  [switch]$SkipRegistryWrites,
  [switch]$NoShortcuts,
  [switch]$KeepFiles
)

$ErrorActionPreference = "Stop"
$McpHeader = "[mcp_servers.photoshop_codex_bridge]"

function Get-NormalizedPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path)
}

function Remove-TomlSection([string]$Content, [string]$Header) {
  $Escaped = [regex]::Escape($Header)
  return ([regex]::Replace($Content, "(?ms)^$Escaped\s*\r?\n.*?(?=^\[|\z)", "")).TrimEnd()
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

if (-not $InstallBase) {
  $InstallBase = Join-Path $env:LOCALAPPDATA "Humingbirdbird\PhotoshopCodexBridge"
}
$InstallBase = Get-NormalizedPath $InstallBase
$StatePath = Join-Path $InstallBase "install-state.json"
if (-not (Test-Path -LiteralPath $StatePath)) {
  throw "Installation state was not found: $StatePath"
}
$State = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json

if (-not $CodexConfigPath) {
  $CodexConfigPath = [string]$State.codexConfigPath
}
if ($CodexConfigPath -and (Test-Path -LiteralPath $CodexConfigPath)) {
  $CurrentConfig = Get-Content -LiteralPath $CodexConfigPath -Raw
  $WithoutBridge = Remove-TomlSection -Content $CurrentConfig -Header $McpHeader
  $PreviousSection = [string]$State.previousMcpSection
  $Restored = if ($PreviousSection) {
    if ($WithoutBridge) { "$WithoutBridge`r`n`r`n$PreviousSection`r`n" } else { "$PreviousSection`r`n" }
  } elseif ($WithoutBridge) {
    "$WithoutBridge`r`n"
  } else {
    ""
  }
  Write-Utf8NoBom -Path $CodexConfigPath -Content $Restored
}

$CepExtensionPath = if ($CepExtensionsRoot) {
  Join-Path (Get-NormalizedPath $CepExtensionsRoot) "com.humingbirdbird.photoshop-codex-bridge"
} else {
  [string]$State.cepExtensionPath
}
if ($CepExtensionPath -and (Test-Path -LiteralPath $CepExtensionPath)) {
  Remove-Item -LiteralPath $CepExtensionPath -Recurse -Force
}

if (-not $SkipRegistryWrites -and -not [bool]$State.registryWritesSkipped) {
  foreach ($Entry in @($State.registryState)) {
    if ([bool]$Entry.hadValue) {
      New-Item -Path ([string]$Entry.path) -Force | Out-Null
      New-ItemProperty -LiteralPath ([string]$Entry.path) -Name "PlayerDebugMode" -Value ([string]$Entry.previousValue) -PropertyType String -Force | Out-Null
    } else {
      Remove-ItemProperty -LiteralPath ([string]$Entry.path) -Name "PlayerDebugMode" -ErrorAction SilentlyContinue
    }
  }
}

if (-not $NoShortcuts) {
  $StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Humingbirdbird\Photoshop Codex Bridge"
  if (Test-Path -LiteralPath $StartMenu) {
    Remove-Item -LiteralPath $StartMenu -Recurse -Force
  }
}

if (-not $KeepFiles) {
  $CleanupScript = Join-Path $env:TEMP "remove-photoshop-codex-bridge-$([guid]::NewGuid().ToString('N')).ps1"
  $EscapedInstallBase = $InstallBase.Replace("'", "''")
  $CleanupContent = @"
Start-Sleep -Milliseconds 800
if (Test-Path -LiteralPath '$EscapedInstallBase') {
  Remove-Item -LiteralPath '$EscapedInstallBase' -Recurse -Force
}
Remove-Item -LiteralPath `$PSCommandPath -Force
"@
  Write-Utf8NoBom -Path $CleanupScript -Content $CleanupContent
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$CleanupScript`""
  )
}

Write-Host "Photoshop Codex Bridge was uninstalled."
Write-Host "Restart Photoshop and Codex."
