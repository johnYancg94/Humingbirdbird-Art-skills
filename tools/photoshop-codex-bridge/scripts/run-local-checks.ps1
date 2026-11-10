$ErrorActionPreference='Stop'
& node (Join-Path $PSScriptRoot 'run-tests.mjs')
if ($LASTEXITCODE -ne 0) { throw "Regression failed with exit code $LASTEXITCODE" }
