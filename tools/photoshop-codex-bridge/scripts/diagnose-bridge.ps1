param(
  [int]$Port = 47777,
  [string]$LatestReport = ""
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -ge 7) {
  $PSNativeCommandUseErrorActionPreference = $true
}

$Root = Split-Path -Parent $PSScriptRoot
$WorkspaceRoot = Split-Path -Parent $Root

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

function Write-Section($Name) {
  Write-Host ""
  Write-Host "== $Name =="
}

function Write-PortOwner($Port) {
  try {
    $Connections = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction Stop
    foreach ($Connection in $Connections) {
      $Process = Get-Process -Id $Connection.OwningProcess -ErrorAction SilentlyContinue
      if ($Process) {
        Write-Host "Port $Port owner: PID $($Connection.OwningProcess), process $($Process.ProcessName)"
        try {
          $CommandLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($Connection.OwningProcess)" -ErrorAction Stop).CommandLine
          if ($CommandLine) {
            Write-Host "Command line: $CommandLine"
          }
        } catch {
          Write-Host "Command line: unavailable"
        }
      } else {
        Write-Host "Port $Port owner: PID $($Connection.OwningProcess)"
      }
    }
  } catch {
    Write-Host "No listening process detected on 127.0.0.1:$Port via Get-NetTCPConnection."
  }
}

Push-Location $WorkspaceRoot
try {
  Write-Section "Config"
  Invoke-Native -FilePath node -Arguments @(".\photoshop-codex-bridge\scripts\check-bridge-config.mjs")

  Write-Section "Broker"
  Write-PortOwner -Port $Port
  try {
    $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -Method Get -TimeoutSec 2
    $Health | ConvertTo-Json -Depth 8
    if ($Health.photoshop.hasSnapshot -and $Health.photoshop.snapshotAgeMs -gt 10000) {
      Write-Warning "Latest snapshot is stale ($($Health.photoshop.snapshotAgeMs) ms old). This is not proof of a live Photoshop panel."
    }
    if ($Health.photoshop.latestClientStatus.documentTitle -eq "smoke-test.psd") {
      Write-Warning "Latest snapshot appears to come from smoke-test data, not a real Photoshop document."
    }
    if ($Health.photoshop.latestClientStatus.photoshopVersion -eq "smoke") {
      Write-Warning "Latest client status is the smoke runtime. This cannot satisfy Photoshop 2026 runtime verification."
    }
  } catch {
    Write-Host "No broker responded on 127.0.0.1:$Port"
    Write-Host "Start Codex MCP or run: node .\photoshop-codex-bridge\mcp-server\server.mjs"
  }

  Write-Section "Layer State Summary Endpoint"
  try {
    $Summary = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/codex/layer-state-summary" -Method Get -TimeoutSec 2
    $Summary | ConvertTo-Json -Depth 8
    if ($Summary.layerState.descriptor.missing -gt 0) {
      Write-Warning "Descriptor evidence is missing for $($Summary.layerState.descriptor.missing) layer(s). A -RequireDescriptors runtime audit will fail until every layer reports descriptor evidence."
    }
  } catch {
    Write-Warning "Layer state summary endpoint is unavailable. The broker on port $Port is probably an older process; restart the Codex MCP server or use a new Codex thread so the current server.mjs is loaded."
  }

  Write-Section "Runtime Report"
  if (-not $LatestReport) {
    $Report = Get-ChildItem -LiteralPath ".\.codex-tmp" -Filter "photoshop-runtime*.json" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($Report) {
      $LatestReport = $Report.FullName
    }
  }

  if ($LatestReport -and (Test-Path -LiteralPath $LatestReport)) {
    Write-Host "Latest report: $LatestReport"
    Get-Content -LiteralPath $LatestReport -Raw
  } else {
    Write-Host "No runtime report found."
  }

  Write-Section "Next Steps"
  Write-Host "If the broker is stale, smoke-only, or missing layer-state-summary:"
  Write-Host "1. Stop the old node/Codex MCP process shown in the Broker section, or start a new Codex thread so the MCP server reloads."
  Write-Host "2. Run .\photoshop-codex-bridge\scripts\run-local-checks.ps1 to confirm local readiness."
  Write-Host ""
  Write-Host "If no real Photoshop snapshot is present:"
  Write-Host "1. Run the release Install.bat and restart Photoshop."
  Write-Host "2. Open a duplicate PSD in Photoshop 2026."
  Write-Host "3. Open Window > Extensions (Legacy) > Photoshop Codex Bridge."
  Write-Host "4. Run .\photoshop-codex-bridge\scripts\watch-photoshop-runtime.ps1 -RunRuntimeCheck -RequireRealtime"
} finally {
  Pop-Location
}
