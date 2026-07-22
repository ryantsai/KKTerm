$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

npm run check:all
exit $LASTEXITCODE
