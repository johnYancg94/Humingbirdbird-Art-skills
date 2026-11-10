[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ConfigPath,[string]$Api="http://127.0.0.1:47777",[int]$TimeoutSec=600)
$ErrorActionPreference='Stop'
# Keep the old entry point but route all work through the guarded organizer.
& node (Join-Path $PSScriptRoot 'organize-island-fast.mjs') --config $ConfigPath --api $Api --timeout-ms ($TimeoutSec * 1000)
if ($LASTEXITCODE -ne 0) { throw "Organizer failed with exit code $LASTEXITCODE; inspect the run report before recovery" }
