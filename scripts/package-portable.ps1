#requires -Version 5.1
param(
    [ValidateSet("x64", "arm64")]
    [string]$Arch = "x64",
    [string]$OutputDir = "artifacts",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir ".."))
$Package = Get-Content -Raw (Join-Path $RepoRoot "package.json") | ConvertFrom-Json
$Version = $Package.version
$ResolvedOutputDir = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $OutputDir))

if ($Arch -eq "arm64") {
    $CargoTarget = "aarch64-pc-windows-msvc"
    $SidecarTarget = $CargoTarget
    $ReleaseDir = Join-Path $RepoRoot "src-tauri\target\$CargoTarget\release"
} else {
    $CargoTarget = ""
    $SidecarTarget = "x86_64-pc-windows-msvc"
    $ReleaseDir = Join-Path $RepoRoot "src-tauri\target\release"
}

$OutputName = "kkterm-$Version-windows-$Arch-portable.zip"
$OutputPath = Join-Path $ResolvedOutputDir $OutputName
$ChecksumPath = "$OutputPath.sha256"
$StageRoot = Join-Path ([System.IO.Path]::GetTempPath()) "kkterm-portable-package-$([guid]::NewGuid().ToString('N'))"

function Assert-ChildPath {
    param([string]$Parent, [string]$Child)

    $ResolvedParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    $ResolvedChild = [System.IO.Path]::GetFullPath($Child)
    if (-not $ResolvedChild.StartsWith($ResolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify path outside $ResolvedParent`: $ResolvedChild"
    }
}

function Initialize-Arm64BuildEnvironment {
    $VsWhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path -LiteralPath $VsWhere)) {
        throw "Visual Studio vswhere.exe was not found; install the ARM64 MSVC and C++ Clang build components."
    }
    $VsPath = (& $VsWhere -products * -latest `
        -requires Microsoft.VisualStudio.Component.VC.Tools.ARM64 `
        -property installationPath 2>$null | Select-Object -First 1)
    if (-not $VsPath) {
        throw "Visual Studio ARM64 C++ build tools were not found."
    }
    $DevCmd = Join-Path $VsPath "Common7\Tools\VsDevCmd.bat"
    $ClangDir = Join-Path $VsPath "VC\Tools\Llvm\bin"
    if (-not (Test-Path -LiteralPath (Join-Path $ClangDir "clang-cl.exe"))) {
        throw "Visual Studio C++ Clang Compiler for Windows was not found."
    }

    $EnvironmentLines = & cmd.exe /s /c "`"$DevCmd`" -arch=arm64 -host_arch=x64 -no_logo && set"
    if ($LASTEXITCODE -ne 0) {
        throw "Loading the Visual Studio ARM64 developer environment failed."
    }
    foreach ($Line in $EnvironmentLines) {
        $Index = $Line.IndexOf("=")
        if ($Index -gt 0) {
            Set-Item -Path "Env:$($Line.Substring(0, $Index))" -Value $Line.Substring($Index + 1)
        }
    }
    if (($env:Path -split ';') -notcontains $ClangDir) {
        $env:Path = "$ClangDir;$env:Path"
    }
    $env:CC_aarch64_pc_windows_msvc = "clang-cl"
    $env:CXX_aarch64_pc_windows_msvc = "clang-cl"
}

Push-Location $RepoRoot
try {
    if (-not $SkipBuild) {
        if ($CargoTarget) {
            Initialize-Arm64BuildEnvironment
        }
        $SidecarArgs = @(
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
            "scripts/prepare-tauri-sidecars.ps1", "-TargetTriple", $SidecarTarget
        )
        if ($CargoTarget) {
            $SidecarArgs += @("-CargoTarget", $CargoTarget)
        }
        & powershell @SidecarArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Preparing the $Arch CLI sidecar failed with exit code $LASTEXITCODE."
        }

        $PreviousTauriConfig = $env:TAURI_CONFIG
        $env:TAURI_CONFIG = '{"bundle":{"externalBin":["binaries/kkterm-cli"]}}'
        try {
            $TauriArgs = @("exec", "tauri", "--", "build", "--no-bundle")
            if ($CargoTarget) {
                $TauriArgs += @("--target", $CargoTarget)
            }
            & npm @TauriArgs
            if ($LASTEXITCODE -ne 0) {
                throw "Building the $Arch portable executable failed with exit code $LASTEXITCODE."
            }
        }
        finally {
            $env:TAURI_CONFIG = $PreviousTauriConfig
        }
    }

    $RequiredPaths = @(
        (Join-Path $ReleaseDir "kkterm.exe"),
        (Join-Path $ReleaseDir "kkterm-cli.exe"),
        (Join-Path $ReleaseDir "manual"),
        (Join-Path $ReleaseDir "assistant-skills")
    )
    foreach ($RequiredPath in $RequiredPaths) {
        if (-not (Test-Path -LiteralPath $RequiredPath)) {
            throw "Portable package input not found: $RequiredPath"
        }
    }

    $PortableExecutablePath = Join-Path $ReleaseDir "kkterm.exe"
    $PortableExecutableVersion = (Get-Item -LiteralPath $PortableExecutablePath).VersionInfo.ProductVersion
    if ($PortableExecutableVersion -ne $Version) {
        throw "Portable package input KKTerm.exe is version '$PortableExecutableVersion', but package.json is '$Version'. Rebuild the release executable before packaging."
    }

    New-Item -ItemType Directory -Path $StageRoot | Out-Null
    Copy-Item -LiteralPath (Join-Path $ReleaseDir "kkterm.exe") -Destination (Join-Path $StageRoot "KKTerm.exe")
    Copy-Item -LiteralPath (Join-Path $ReleaseDir "kkterm-cli.exe") -Destination $StageRoot
    Copy-Item -LiteralPath (Join-Path $ReleaseDir "manual") -Destination $StageRoot -Recurse
    Copy-Item -LiteralPath (Join-Path $ReleaseDir "assistant-skills") -Destination $StageRoot -Recurse
    New-Item -ItemType File -Path (Join-Path $StageRoot "kkterm-portable.marker") | Out-Null

    if (Test-Path -LiteralPath (Join-Path $StageRoot "data")) {
        throw "Portable archives must not ship with a data directory."
    }

    New-Item -ItemType Directory -Force -Path $ResolvedOutputDir | Out-Null
    Assert-ChildPath -Parent $ResolvedOutputDir -Child $OutputPath
    foreach ($ExistingPath in @($OutputPath, $ChecksumPath)) {
        if (Test-Path -LiteralPath $ExistingPath) {
            Remove-Item -LiteralPath $ExistingPath -Force
        }
    }

    Compress-Archive -Path (Join-Path $StageRoot "*") -DestinationPath $OutputPath -CompressionLevel Optimal
    $HashBytes = [System.Security.Cryptography.SHA256]::Create().ComputeHash(
        [System.IO.File]::ReadAllBytes($OutputPath)
    )
    $Hash = -join ($HashBytes | ForEach-Object { $_.ToString("x2") })
    "$Hash  $OutputName" | Set-Content -Path $ChecksumPath -Encoding ASCII

    [pscustomobject]@{
        PortableZip = $OutputPath
        Sha256 = $ChecksumPath
        Architecture = $Arch
    }
}
finally {
    Pop-Location
    $ResolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $ResolvedStage = [System.IO.Path]::GetFullPath($StageRoot)
    if ($ResolvedStage.StartsWith($ResolvedTemp, [System.StringComparison]::OrdinalIgnoreCase) -and
        (Test-Path -LiteralPath $ResolvedStage)) {
        Remove-Item -LiteralPath $ResolvedStage -Recurse -Force
    }
}
