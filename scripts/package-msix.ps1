#requires -Version 5.1
<#
.SYNOPSIS
    Builds a Windows MSIX package for KKTerm, intended for Microsoft Store
    submission and/or sideloading.

.DESCRIPTION
    Tauri v2 has no native MSIX bundle target, so this script assembles the
    package from the standard `tauri build --no-bundle` output:

      1. Builds kkterm.exe + the kkterm-cli sidecar (or reuses an existing
         build with -SkipBuild).
      2. Stages the package layout: executable, sidecar, manual, assistant
         skills, tile assets, the AppxManifest.xml, and - by default - an
         embedded WebView2 Fixed Version runtime.
      3. Packs the layout into an MSIX with MakeAppx.exe from the Windows SDK.
      4. Optionally signs with SignTool for sideload testing and can install
         the package on the local machine with -InstallPackage.

    Why the WebView2 runtime is embedded: the Microsoft Store requires apps to
    be self-contained, so the package cannot download/install the Evergreen
    runtime at install time. The script therefore embeds the official Fixed
    Version runtime under a `WebView2Runtime` folder and
    src-tauri/src/main.rs points WEBVIEW2_BROWSER_EXECUTABLE_FOLDER at it when
    the folder exists (wry creates the WebView2 environment with a null browser
    folder, so the WebView2 loader honors that environment variable). See
    https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution.

    Fixed Version binaries are over 250 MB; the MSIX will be that much larger
    than the NSIS installer. The runtime is cached under
    %LOCALAPPDATA%\KKTerm\msix-webview2-cache between runs.

    Microsoft Store notes:
      - The Identity Name and Publisher must be the values Partner Center gives
        you after reserving the app name (pass -PackageName / -Publisher).
      - The Store re-signs packages at publication, so a Store submission does
        not need a local certificate. Signing with -CertificatePath is only
        needed for sideload testing on machines that trust the certificate.
      - The MSIX version must be four parts (e.g. 3000.0.1.0); the fourth part
        is derived as 0 from package.json's three-part version.

.PARAMETER Arch
    Architecture to package: x64 (default) or arm64.

.PARAMETER OutputDir
    Directory (relative to the repo root) the MSIX + checksum are copied to.

.PARAMETER PackageName
    Manifest Identity Name. Must match the name reserved in Partner Center for
    Store submissions. Default: RyanTsai.KKTerm.

.PARAMETER Publisher
    Manifest Identity Publisher (CN=...). Must match the Partner Center value
    for Store submissions, or the signing certificate subject for sideloading.
    Default: CN=KKTerm.

.PARAMETER PublisherDisplayName
    Human-readable publisher shown in the package. Default: Ryan Tsai.

.PARAMETER DisplayName
    Display name shown in the Store/Start. Default: KKTerm.

.PARAMETER MsixVersion
    Four-part package version (Major.Minor.Build.Revision). Defaults to
    <package.json version>.0, e.g. 3000.0.1.0.

.PARAMETER MinWindowsVersion
    TargetDeviceFamily MinVersion. Default: 10.0.17763.0 (Tauri v2 minimum).

.PARAMETER WebView2CabUrl
    URL of the official Microsoft.WebView2.FixedVersionRuntime.<version>.<arch>.cab
    to embed. Get the link from the "Fixed Version" section of
    https://developer.microsoft.com/microsoft-edge/webview2/ ("Get the Link").
    The runtime is downloaded once and cached.

.PARAMETER WebView2RuntimePath
    Path to an already-extracted Fixed Version runtime folder (must contain
    msedgewebview2.exe). Skips the download; used directly without caching.

.PARAMETER SkipWebView2
    Do not embed the WebView2 runtime. The package then depends on the machine's
    Evergreen runtime, which is fine for local sideload testing but may fail
    Microsoft Store certification.

.PARAMETER CertificatePath
    Optional .pfx used to sign the MSIX (sideload testing). The certificate
    subject CN must match -Publisher. Not needed for Store submissions.

.PARAMETER CertificatePassword
    Password for -CertificatePath.

.PARAMETER InstallPackage
    Install the built MSIX on this machine with Add-AppxPackage after signing.
    Requires -CertificatePath and a certificate trusted on this machine.

.PARAMETER SkipBuild
    Reuse the existing `tauri build --no-bundle` output instead of rebuilding.

.EXAMPLE
    # Local sideload test build (no WebView2 embedding, unsigned)
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-msix.ps1 -SkipWebView2

.EXAMPLE
    # Microsoft Store submission build with embedded WebView2
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-msix.ps1 `
        -PackageName <PartnerCenterReservedName> -Publisher <CN=PartnerCenterValue> `
        -WebView2CabUrl "https://.../Microsoft.WebView2.FixedVersionRuntime.<version>.x64.cab"
#>
param(
    [ValidateSet("x64", "arm64")]
    [string]$Arch = "x64",
    [string]$OutputDir = "artifacts",
    [string]$PackageName = "RyanTsai.KKTerm",
    [string]$Publisher = "CN=KKTerm",
    [string]$PublisherDisplayName = "Ryan Tsai",
    [string]$DisplayName = "KKTerm",
    [string]$Description = "Local-first administration workspace.",
    [string]$MsixVersion = "",
    [string]$MinWindowsVersion = "10.0.17763.0",
    [string]$MaxWindowsVersionTested = "10.0.26100.0",
    [string]$WebView2CabUrl = "",
    [string]$WebView2RuntimePath = "",
    [switch]$SkipWebView2,
    [string]$CertificatePath = "",
    [string]$CertificatePassword = "",
    [switch]$InstallPackage,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir ".."))
$Package = Get-Content -Raw (Join-Path $RepoRoot "package.json") | ConvertFrom-Json
$Version = $Package.version
$ResolvedOutputDir = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $OutputDir))

# Version of the WebView2Loader statically linked into kkterm.exe
# (webview2-com-sys 0.38.2). The embedded Fixed Version runtime must be at
# least this new, or the loader refuses to create the environment. Bump when
# webview2-com-sys upgrades.
$LinkedWebView2LoaderVersion = [version]"1.0.3650.58"

# The Store accepts Major.Minor.Build.Revision where Revision must be 0 for a
# first submission of a given Major.Minor.Build.
if ($MsixVersion) {
    $PackageVersion = $MsixVersion
}
else {
    $PackageVersion = "$Version.0"
}

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Expected package.json version to be <major>.<minor>.<build>, found '$Version'."
}
if ($PackageVersion -notmatch '^\d+\.\d+\.\d+\.\d+$') {
    throw "Expected MSIX version to be <major>.<minor>.<build>.<revision>, found '$PackageVersion'."
}

$PackageNamePattern = '^[A-Za-z0-9][A-Za-z0-9.\-]*$'
if ($PackageName -notmatch $PackageNamePattern) {
    throw "Invalid package name '$PackageName' (allowed: letters, digits, '.', '-'; must start alphanumeric)."
}

if ($Arch -eq "arm64") {
    $CargoTarget = "aarch64-pc-windows-msvc"
    $SidecarTarget = $CargoTarget
    $ReleaseDir = Join-Path $RepoRoot "src-tauri\target\$CargoTarget\release"
    $ManifestArch = "arm64"
}
else {
    $CargoTarget = ""
    $SidecarTarget = "x86_64-pc-windows-msvc"
    $ReleaseDir = Join-Path $RepoRoot "src-tauri\target\release"
    $ManifestArch = "x64"
}

$OutputName = "kkterm-$Version-windows-$Arch.msix"
$OutputPath = Join-Path $ResolvedOutputDir $OutputName
$ChecksumPath = "$OutputPath.sha256"
$StageRoot = Join-Path ([System.IO.Path]::GetTempPath()) "kkterm-msix-package-$([guid]::NewGuid().ToString('N'))"
$LayoutDir = Join-Path $StageRoot "layout"

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

function Invoke-AppBuild {
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
            throw "Building the $Arch executable failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        $env:TAURI_CONFIG = $PreviousTauriConfig
    }
}

function Get-WindowsKitTool {
    # Finds the newest installed Windows SDK version and returns the x64 tool
    # (makeappx.exe / signtool.exe). MakeAppx and SignTool are x86/x64 host
    # tools; the x64 copy runs on x64 and ARM64 build hosts alike.
    param([string]$ToolName)

    $KitRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
    if (-not (Test-Path -LiteralPath $KitRoot)) {
        throw "Windows SDK not found under '$KitRoot'. Install the Windows 10/11 SDK build tools."
    }

    $VersionDirs = Get-ChildItem -LiteralPath $KitRoot -Directory |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' }
    if (-not $VersionDirs) {
        throw "No versioned Windows SDK folders found under '$KitRoot'."
    }

    $SortedDirs = @($VersionDirs | Sort-Object { [System.Version]$_.Name } -Descending)
    foreach ($VersionDir in $SortedDirs) {
        $ToolPath = Join-Path (Join-Path $VersionDir.FullName "x64") $ToolName
        if (Test-Path -LiteralPath $ToolPath) {
            return $ToolPath
        }
    }
    throw "Windows SDK found, but $ToolName was not located under '$KitRoot'. Install the 'Windows SDK Signing Tools for Desktop Apps' component."
}

function Find-WebView2RuntimeRoot {
    param([string]$ExtractedRoot)

    if (Test-Path -LiteralPath (Join-Path $ExtractedRoot "msedgewebview2.exe") -PathType Leaf) {
        return $ExtractedRoot
    }

    # Current Fixed Version CABs contain one top-level directory named after
    # the archive instead of placing the runtime files at the extraction root.
    $NestedRuntimeRoots = @(
        Get-ChildItem -LiteralPath $ExtractedRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object {
                Test-Path -LiteralPath (Join-Path $_.FullName "msedgewebview2.exe") -PathType Leaf
            }
    )
    if ($NestedRuntimeRoots.Count -eq 1) {
        return $NestedRuntimeRoots[0].FullName
    }

    return $null
}

function Resolve-WebView2Runtime {
    # Returns the extracted Fixed Version runtime folder to embed.
    if ($WebView2RuntimePath) {
        $RuntimeRoot = [System.IO.Path]::GetFullPath($WebView2RuntimePath)
        $ResolvedRuntimeRoot = Find-WebView2RuntimeRoot $RuntimeRoot
        if (-not $ResolvedRuntimeRoot) {
            throw "The -WebView2RuntimePath folder does not contain msedgewebview2.exe: $RuntimeRoot"
        }
        Write-Host "==> Using pre-extracted WebView2 runtime: $ResolvedRuntimeRoot"
        return $ResolvedRuntimeRoot
    }

    if (-not $WebView2CabUrl) {
        throw @"
The Microsoft Store requires a self-contained package, so the MSIX build embeds
the WebView2 Fixed Version runtime, but no runtime was provided. Either:

  - pass -WebView2CabUrl with the "Get the Link" URL for the Fixed Version
    <arch> package from https://developer.microsoft.com/microsoft-edge/webview2/
    (URL ends in Microsoft.WebView2.FixedVersionRuntime.<version>.$Arch.cab), or
  - pass -WebView2RuntimePath pointing at an already-extracted runtime folder, or
  - pass -SkipWebView2 to build a package that relies on the machine's Evergreen
    runtime (sideload testing only; likely to fail Store certification).
"@
    }

    $UrlMatch = [regex]::Match($WebView2CabUrl, 'Microsoft\.WebView2\.FixedVersionRuntime\.([0-9.]+)\.(x86|x64|arm64)\.cab')
    if (-not $UrlMatch.Success) {
        throw "Could not parse a Fixed Version runtime name from -WebView2CabUrl: $WebView2CabUrl"
    }
    $RuntimeVersion = [System.Version]$UrlMatch.Groups[1].Value
    $CabArch = $UrlMatch.Groups[2].Value

    if ($CabArch -ne $ManifestArch) {
        throw "The -WebView2CabUrl runtime is $CabArch but this package is $ManifestArch. Use the $ManifestArch cab."
    }
    if ($RuntimeVersion -lt $LinkedWebView2LoaderVersion) {
        Write-Warning "The Fixed Version runtime ($RuntimeVersion) is older than the WebView2Loader linked into kkterm.exe ($LinkedWebView2LoaderVersion); the app may fail to create its WebView2 environment."
    }

    $CacheRoot = Join-Path $env:LOCALAPPDATA "KKTerm\msix-webview2-cache\$CabArch\$RuntimeVersion"
    $CachedRuntimeRoot = Find-WebView2RuntimeRoot $CacheRoot
    if ($CachedRuntimeRoot) {
        Write-Host "==> Using cached WebView2 runtime $($RuntimeVersion): $CachedRuntimeRoot"
        return $CachedRuntimeRoot
    }

    Write-Host "==> Downloading WebView2 Fixed Version runtime $RuntimeVersion ($CabArch)..."
    $DownloadDir = Join-Path $StageRoot "webview2-download"
    New-Item -ItemType Directory -Path $DownloadDir -Force | Out-Null
    $CabPath = Join-Path $DownloadDir "Microsoft.WebView2.FixedVersionRuntime.$RuntimeVersion.$CabArch.cab"
    Invoke-WebRequest -Uri $WebView2CabUrl -OutFile $CabPath -UseBasicParsing

    New-Item -ItemType Directory -Path $CacheRoot -Force | Out-Null
    Write-Host "==> Extracting WebView2 runtime with expand.exe..."
    $ExpandResult = & "$env:WINDIR\System32\expand.exe" -F:* $CabPath $CacheRoot 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "expand.exe failed for $($CabPath):`n$($ExpandResult -join "`n")"
    }
    $ExtractedRuntimeRoot = Find-WebView2RuntimeRoot $CacheRoot
    if (-not $ExtractedRuntimeRoot) {
        throw "The extracted WebView2 runtime under $CacheRoot does not contain msedgewebview2.exe."
    }

    Write-Host "==> WebView2 runtime cached at $ExtractedRuntimeRoot"
    return $ExtractedRuntimeRoot
}

function ConvertTo-XmlEscaped {
    param([string]$Value)
    return $Value.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace('"', "&quot;")
}

function Write-AppxManifest {
    $EscapedDisplayName = ConvertTo-XmlEscaped $DisplayName
    $EscapedPublisherDisplayName = ConvertTo-XmlEscaped $PublisherDisplayName
    $EscapedDescription = ConvertTo-XmlEscaped $Description
    $EscapedPublisher = ConvertTo-XmlEscaped $Publisher
    $EscapedPackageName = ConvertTo-XmlEscaped $PackageName

    $Manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">
  <Identity Name="$EscapedPackageName" Version="$PackageVersion" Publisher="$EscapedPublisher" ProcessorArchitecture="$ManifestArch" />
  <Properties>
    <DisplayName>$EscapedDisplayName</DisplayName>
    <PublisherDisplayName>$EscapedPublisherDisplayName</PublisherDisplayName>
    <Description>$EscapedDescription</Description>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="$MinWindowsVersion" MaxVersionTested="$MaxWindowsVersionTested" />
  </Dependencies>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
  <Applications>
    <Application Id="KKTerm" Executable="kkterm.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="$EscapedDisplayName" Description="$EscapedDescription"
        BackgroundColor="transparent"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png" />
    </Application>
  </Applications>
</Package>
"@

    $ManifestPath = Join-Path $LayoutDir "AppxManifest.xml"
    $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($ManifestPath, $Manifest, $Utf8NoBom)
    return $ManifestPath
}

function Get-CertificateSubjectCn {
    param([string]$PfxPath, [string]$PfxPassword)

    try {
        $Cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($PfxPath, $PfxPassword)
        $Cn = [regex]::Match($Cert.Subject, '(?:^|,)CN=([^,]+)').Groups[1].Value
        return $Cn
    }
    catch {
        throw "Unable to read the signing certificate '$PfxPath'. Verify the file and -CertificatePassword."
    }
}

Push-Location $RepoRoot
try {
    if (-not $SkipBuild) {
        Invoke-AppBuild
    }

    $RequiredPaths = @(
        (Join-Path $ReleaseDir "kkterm.exe"),
        (Join-Path $ReleaseDir "kkterm-cli.exe"),
        (Join-Path $ReleaseDir "manual"),
        (Join-Path $ReleaseDir "assistant-skills")
    )
    foreach ($RequiredPath in $RequiredPaths) {
        if (-not (Test-Path -LiteralPath $RequiredPath)) {
            throw "MSIX package input not found: $RequiredPath (run without -SkipBuild first)."
        }
    }

    $WebView2Runtime = $null
    if (-not $SkipWebView2) {
        $WebView2Runtime = Resolve-WebView2Runtime
    }
    else {
        Write-Warning "Building without an embedded WebView2 runtime. This package needs an Evergreen WebView2 runtime on the target machine and may fail Store certification."
    }

    Write-Host "==> Staging MSIX layout: $LayoutDir"
    New-Item -ItemType Directory -Path $LayoutDir -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $ReleaseDir "kkterm.exe") -Destination $LayoutDir
    Copy-Item -LiteralPath (Join-Path $ReleaseDir "kkterm-cli.exe") -Destination $LayoutDir
    Copy-Item -LiteralPath (Join-Path $ReleaseDir "manual") -Destination $LayoutDir -Recurse
    Copy-Item -LiteralPath (Join-Path $ReleaseDir "assistant-skills") -Destination $LayoutDir -Recurse

    $AssetsDir = Join-Path $LayoutDir "Assets"
    New-Item -ItemType Directory -Path $AssetsDir | Out-Null
    foreach ($IconName in @("StoreLogo.png", "Square44x44Logo.png", "Square150x150Logo.png")) {
        $IconSource = Join-Path $RepoRoot "src-tauri\icons\$IconName"
        if (-not (Test-Path -LiteralPath $IconSource)) {
            throw "MSIX tile asset not found: $IconSource"
        }
        Copy-Item -LiteralPath $IconSource -Destination $AssetsDir
    }

    if ($WebView2Runtime) {
        Write-Host "==> Embedding WebView2 runtime (this may take a while)"
        Copy-Item -LiteralPath $WebView2Runtime -Destination (Join-Path $LayoutDir "WebView2Runtime") -Recurse
    }

    $ManifestPath = Write-AppxManifest

    $MakeAppx = Get-WindowsKitTool "makeappx.exe"
    Write-Host "==> Packing MSIX with $MakeAppx"
    & $MakeAppx pack /d $LayoutDir /p $OutputPath /o
    if ($LASTEXITCODE -ne 0) {
        throw "makeappx.exe failed with exit code $LASTEXITCODE."
    }

    if ($CertificatePath) {
        $CertificateCn = Get-CertificateSubjectCn -PfxPath $CertificatePath -PfxPassword $CertificatePassword
        $PublisherCn = [regex]::Match($Publisher, '(?:^|,)CN=([^,]+)').Groups[1].Value
        if (-not $PublisherCn -or $CertificateCn -ne $PublisherCn) {
            throw "The certificate subject CN '$CertificateCn' does not match the manifest Publisher '$Publisher'. The Identity Publisher must equal the signing certificate subject for sideloading, or the Partner Center value for Store submissions."
        }

        $SignTool = Get-WindowsKitTool "signtool.exe"
        Write-Host "==> Signing MSIX with $SignTool"
        & $SignTool sign /fd SHA256 /f $CertificatePath /p $CertificatePassword $OutputPath
        if ($LASTEXITCODE -ne 0) {
            throw "signtool.exe failed with exit code $LASTEXITCODE."
        }
    }
    else {
        Write-Warning "No -CertificatePath given; the MSIX is unsigned. This is fine for Microsoft Store submission (the Store re-signs), but sideload installs require signing."
    }

    $HashBytes = [System.Security.Cryptography.SHA256]::Create().ComputeHash(
        [System.IO.File]::ReadAllBytes($OutputPath)
    )
    $Hash = -join ($HashBytes | ForEach-Object { $_.ToString("x2") })
    "$Hash  $([System.IO.Path]::GetFileName($OutputPath))" |
        Set-Content -Path $ChecksumPath -Encoding ASCII

    if ($InstallPackage) {
        if (-not $CertificatePath) {
            throw "-InstallPackage requires -CertificatePath: an unsigned MSIX cannot be installed."
        }
        Write-Host "==> Installing MSIX on this machine"
        Add-AppxPackage -Path $OutputPath
    }

    [PSCustomObject]@{
        Msix = $OutputPath
        Sha256 = $ChecksumPath
        Architecture = $ManifestArch
        Version = $PackageVersion
        WebView2Runtime = if ($WebView2Runtime) { $WebView2Runtime } else { $null }
        Signed = [bool]$CertificatePath
        Manifest = $ManifestPath
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
