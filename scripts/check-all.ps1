$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

pnpm run check:all
exit $LASTEXITCODE
