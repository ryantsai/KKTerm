param(
    [string]$OutputDir = "artifacts"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$PackageJsonPath = Join-Path $RepoRoot "package.json"
$Package = Get-Content -Raw $PackageJsonPath | ConvertFrom-Json
$Version = $Package.version
$TargetTriple = "windows-x64"
$OutputName = "kkterm-$Version-$TargetTriple-setup.exe"
$ResolvedOutputDir = Join-Path $RepoRoot $OutputDir
$InstallerOutputPath = Join-Path $ResolvedOutputDir $OutputName
$ChecksumPath = "$InstallerOutputPath.sha256"
# TODO(updates): Re-enable updater signature artifact output when the update
# mechanism is turned back on.
# $SignaturePath = "$InstallerOutputPath.sig"
$BundleDir = Join-Path $RepoRoot "src-tauri\target\release\bundle\nsis"

function Assert-ChildPath {
    param(
        [string]$Parent,
        [string]$Child
    )

    $ResolvedParent = [System.IO.Path]::GetFullPath($Parent)
    $ResolvedChild = [System.IO.Path]::GetFullPath($Child)
    if (-not $ResolvedChild.StartsWith($ResolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify path outside $ResolvedParent`: $ResolvedChild"
    }
}

Push-Location $RepoRoot
try {
    # TODO(updates): Re-enable this signing-key requirement when Tauri updater
    # artifacts are restored.
    # if (-not $env:TAURI_SIGNING_PRIVATE_KEY -and -not $env:TAURI_SIGNING_PRIVATE_KEY_PATH) {
    #     throw "TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH is required to build updater artifacts."
    # }

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/prepare-tauri-sidecars.ps1
    $PreviousTauriConfig = $env:TAURI_CONFIG
    $env:TAURI_CONFIG = '{"bundle":{"externalBin":["binaries/kkterm-cli"]}}'
    try {
        pnpm exec tauri build --bundles=nsis
    }
    finally {
        $env:TAURI_CONFIG = $PreviousTauriConfig
    }
}
finally {
    Pop-Location
}

if (-not (Test-Path $BundleDir)) {
    throw "NSIS bundle directory not found at $BundleDir."
}

$BuiltInstaller = Get-ChildItem -Path $BundleDir -Filter "*.exe" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $BuiltInstaller) {
    throw "No NSIS installer executable found in $BundleDir."
}

New-Item -ItemType Directory -Force -Path $ResolvedOutputDir | Out-Null

Assert-ChildPath -Parent $ResolvedOutputDir -Child $InstallerOutputPath
if (Test-Path $InstallerOutputPath) {
    Remove-Item -LiteralPath $InstallerOutputPath -Force
}
if (Test-Path $ChecksumPath) {
    Remove-Item -LiteralPath $ChecksumPath -Force
}
# TODO(updates): Restore signature cleanup when updater artifacts are restored.
# if (Test-Path $SignaturePath) {
#     Remove-Item -LiteralPath $SignaturePath -Force
# }

Copy-Item -LiteralPath $BuiltInstaller.FullName -Destination $InstallerOutputPath

# TODO(updates): Restore signature copying when updater artifacts are restored.
# $BuiltSignature = "$($BuiltInstaller.FullName).sig"
# if (-not (Test-Path $BuiltSignature)) {
#     throw "No updater signature found for $($BuiltInstaller.FullName)."
# }
# Copy-Item -LiteralPath $BuiltSignature -Destination $SignaturePath

$HashBytes = [System.Security.Cryptography.SHA256]::Create().ComputeHash(
    [System.IO.File]::ReadAllBytes($InstallerOutputPath)
)
$Hash = -join ($HashBytes | ForEach-Object { $_.ToString("x2") })
"$Hash  $([System.IO.Path]::GetFileName($InstallerOutputPath))" |
    Set-Content -Path $ChecksumPath -Encoding ASCII

[PSCustomObject]@{
    Installer = $InstallerOutputPath
    Sha256 = $ChecksumPath
    Signature = $null
    SourceInstaller = $BuiltInstaller.FullName
}
