param(
    [string]$OutputDir = "artifacts",
    [string]$InstallerPath,
    [string]$InstallDir,
    [switch]$SkipChecksum,
    [switch]$KeepInstall,
    [switch]$AllowExistingInstall
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$PackageJsonPath = Join-Path $RepoRoot "package.json"
$Package = Get-Content -Raw $PackageJsonPath | ConvertFrom-Json
$Version = $Package.version
$TargetTriple = "windows-x64"
$ResolvedOutputDir = Join-Path $RepoRoot $OutputDir

if (-not $InstallerPath) {
    $InstallerPath = Join-Path $ResolvedOutputDir "kkterm-$Version-$TargetTriple-setup.exe"
}

$ResolvedInstallerPath = Resolve-Path $InstallerPath
$ChecksumPath = "$ResolvedInstallerPath.sha256"
$OwnsInstallDir = -not $PSBoundParameters.ContainsKey("InstallDir")

if ($OwnsInstallDir) {
    $InstallDir = Join-Path ([System.IO.Path]::GetTempPath()) "kkterm-installer-smoke-$([System.Guid]::NewGuid().ToString("N"))"
}

$ResolvedInstallDir = [System.IO.Path]::GetFullPath($InstallDir)
$InstalledExe = Join-Path $ResolvedInstallDir "kkterm.exe"
$InstalledCliExe = Join-Path $ResolvedInstallDir "kkterm-cli.exe"
$Uninstaller = Join-Path $ResolvedInstallDir "uninstall.exe"
$SmokeRegistryKey = "Registry::HKEY_CURRENT_USER\Software\Ryan Tsai\KKTerm"
$OpenWithProgId = "KKTerm.Document"
$AssociationSamples = @(".md", ".jpg")
# Apps & Features registration written by the installer. This key is keyed by
# product name, not install directory, so it identifies a real install
# regardless of where the smoke build would be unpacked.
$ProductUninstallKey = "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\KKTerm"

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

function Invoke-CheckedProcess {
    param(
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$Action
    )

    $Process = Start-Process `
        -FilePath $FilePath `
        -ArgumentList $ArgumentList `
        -Wait `
        -PassThru `
        -WindowStyle Hidden

    if ($Process.ExitCode -ne 0) {
        throw "$Action failed with exit code $($Process.ExitCode)."
    }
}

function Remove-SmokeRegistryKey {
    if (Test-Path $SmokeRegistryKey) {
        Remove-Item -LiteralPath $SmokeRegistryKey -Recurse -Force
    }
}

function Get-DefaultAssociation {
    param([string]$Extension)

    $Key = "Registry::HKEY_CURRENT_USER\Software\Classes\$Extension"
    if (-not (Test-Path $Key)) {
        return $null
    }
    return (Get-Item -LiteralPath $Key).GetValue("", $null)
}

function Assert-DefaultAssociationUnchanged {
    param([hashtable]$Before)

    foreach ($Extension in $AssociationSamples) {
        $After = Get-DefaultAssociation -Extension $Extension
        if (-not [object]::Equals($Before[$Extension], $After)) {
            throw "Installer changed the default association for $Extension from '$($Before[$Extension])' to '$After'."
        }
    }
}

function Assert-OpenWithRegistration {
    param([bool]$ExpectedPresent)

    foreach ($Extension in $AssociationSamples) {
        $Key = "Registry::HKEY_CURRENT_USER\Software\Classes\$Extension\OpenWithProgids"
        $Present = (Test-Path $Key) -and (
            (Get-Item -LiteralPath $Key).GetValueNames() -contains $OpenWithProgId
        )
        if ($Present -ne $ExpectedPresent) {
            throw "Expected the KKTerm Open with registration for $Extension to be present=$ExpectedPresent."
        }
    }

    $ProgIdKey = "Registry::HKEY_CURRENT_USER\Software\Classes\$OpenWithProgId"
    if ($ExpectedPresent) {
        if (-not (Test-Path $ProgIdKey)) {
            throw "Installer did not create the $OpenWithProgId ProgID."
        }
        if (-not ((Get-Item -LiteralPath $ProgIdKey).GetValueNames() -contains "AllowSilentDefaultTakeOver")) {
            throw "Installer did not mark $OpenWithProgId as ineligible for silent default takeover."
        }
        $ApplicationKey = Join-Path $ProgIdKey "Application"
        $ApplicationName = (Get-Item -LiteralPath $ApplicationKey).GetValue("ApplicationName")
        if ($ApplicationName -ne "KKTerm") {
            throw "Unexpected Open with application name. Expected 'KKTerm' but found '$ApplicationName'."
        }
        $CommandKey = Join-Path $ProgIdKey "shell\open\command"
        $ActualCommand = (Get-Item -LiteralPath $CommandKey).GetValue("")
        $ExpectedCommand = "`"$InstalledExe`" `"%1`""
        if ($ActualCommand -ne $ExpectedCommand) {
            throw "Unexpected KKTerm Open with command. Expected '$ExpectedCommand' but found '$ActualCommand'."
        }
    }
    elseif (Test-Path $ProgIdKey) {
        throw "Uninstaller left the $OpenWithProgId ProgID behind."
    }
}

function Get-ExistingRealInstall {
    # Returns the install path of a real (non-smoke) per-user KKTerm install if one
    # is registered, otherwise $null.
    #
    # The installer keys its product state at fixed registry paths, so running the
    # smoke build's silent install would trip Tauri's "uninstall previous version"
    # upgrade path against a real install -- removing its files, Start Menu folder,
    # and registration -- no matter which temp /D= directory we target. Detect a
    # real install up front so the caller can skip the destructive smoke instead.
    $Candidates = @()

    if (Test-Path $ProductUninstallKey) {
        $Location = (Get-ItemProperty -LiteralPath $ProductUninstallKey -ErrorAction SilentlyContinue).InstallLocation
        if ($Location) { $Candidates += ([string]$Location).Trim('"') }
    }

    if (Test-Path $SmokeRegistryKey) {
        $Default = (Get-ItemProperty -LiteralPath $SmokeRegistryKey -ErrorAction SilentlyContinue).'(default)'
        if ($Default) { $Candidates += ([string]$Default).Trim('"') }
    }

    foreach ($Path in $Candidates) {
        if (-not $Path) { continue }
        # Ignore stale registration left behind by a prior interrupted smoke run;
        # only a real install (outside the temp smoke directory) should block.
        $LeafName = [System.IO.Path]::GetFileName($Path.TrimEnd('\'))
        if ($LeafName -like "kkterm-installer-smoke-*") { continue }
        return $Path
    }

    return $null
}

if (-not (Test-Path $ResolvedInstallerPath)) {
    throw "Installer not found at $ResolvedInstallerPath. Run npm run package:installer first."
}

if (-not $SkipChecksum) {
    if (-not (Test-Path $ChecksumPath)) {
        throw "Installer checksum not found at $ChecksumPath."
    }

    $ExpectedHash = ((Get-Content -Raw $ChecksumPath).Trim() -split "\s+")[0].ToLowerInvariant()
    $HashBytes = [System.Security.Cryptography.SHA256]::Create().ComputeHash(
        [System.IO.File]::ReadAllBytes($ResolvedInstallerPath)
    )
    $ActualHash = (-join ($HashBytes | ForEach-Object { $_.ToString("x2") })).ToLowerInvariant()
    if ($ActualHash -ne $ExpectedHash) {
        throw "Installer checksum mismatch. Expected $ExpectedHash but found $ActualHash."
    }
}

# Guardrail for dev machines: the silent install/uninstall below is destructive to
# any existing per-user KKTerm install (Tauri silently uninstalls the previous
# version on upgrade, and the cleanup deletes the shared product registry key).
# If a real install is present, skip the install/uninstall portion and return the
# non-destructive checks only. The clean CI runner has no prior install, so it
# still runs the full smoke; pass -AllowExistingInstall to force it locally.
if (-not $AllowExistingInstall) {
    $ExistingInstall = Get-ExistingRealInstall
    if ($ExistingInstall) {
        Write-Host "Existing KKTerm install detected at: $ExistingInstall" -ForegroundColor Yellow
        Write-Host "Skipping the install/uninstall smoke so your local install is left intact." -ForegroundColor Yellow
        Write-Host "The full install smoke runs on the clean CI runner. Re-run with -AllowExistingInstall to force it here." -ForegroundColor DarkGray

        return [PSCustomObject]@{
            Installer = $ResolvedInstallerPath.Path
            ChecksumVerified = -not $SkipChecksum
            InstallDirectory = $null
            InstalledExecutable = $null
            InstalledCliExecutable = $null
            SilentInstall = $false
            Cleanup = "skipped (existing install present)"
        }
    }
}

if (Test-Path $ResolvedInstallDir) {
    if (-not $OwnsInstallDir) {
        throw "Install directory already exists: $ResolvedInstallDir"
    }

    Assert-ChildPath -Parent ([System.IO.Path]::GetTempPath()) -Child $ResolvedInstallDir
    if (-not ([System.IO.Path]::GetFileName($ResolvedInstallDir).StartsWith("kkterm-installer-smoke-"))) {
        throw "Refusing to clean unexpected smoke-test directory: $ResolvedInstallDir"
    }
    Remove-Item -LiteralPath $ResolvedInstallDir -Recurse -Force
}

$DefaultAssociationsBefore = @{}
foreach ($Extension in $AssociationSamples) {
    $DefaultAssociationsBefore[$Extension] = Get-DefaultAssociation -Extension $Extension
}

$InstallSucceeded = $false
try {
    Invoke-CheckedProcess `
        -FilePath $ResolvedInstallerPath `
        -ArgumentList @("/S", "/D=$ResolvedInstallDir") `
        -Action "Silent installer smoke test"

    if (-not (Test-Path $InstalledExe)) {
        throw "Silent installer completed but kkterm.exe was not found at $InstalledExe."
    }

    $InstalledItem = Get-Item -LiteralPath $InstalledExe
    if ($InstalledItem.Length -le 0) {
        throw "Installed kkterm.exe is empty."
    }

    if (-not (Test-Path $InstalledCliExe)) {
        throw "Silent installer completed but kkterm-cli.exe was not found at $InstalledCliExe."
    }

    $InstalledCliItem = Get-Item -LiteralPath $InstalledCliExe
    if ($InstalledCliItem.Length -le 0) {
        throw "Installed kkterm-cli.exe is empty."
    }

    Assert-OpenWithRegistration -ExpectedPresent $true
    Assert-DefaultAssociationUnchanged -Before $DefaultAssociationsBefore

    $InstallSucceeded = $true
}
finally {
    if ((Test-Path $Uninstaller) -and -not $KeepInstall) {
        Invoke-CheckedProcess `
            -FilePath $Uninstaller `
            -ArgumentList @("/S") `
            -Action "Silent installer cleanup"

        Assert-OpenWithRegistration -ExpectedPresent $false
        Assert-DefaultAssociationUnchanged -Before $DefaultAssociationsBefore
    }

    if ($OwnsInstallDir -and -not $KeepInstall -and (Test-Path $ResolvedInstallDir)) {
        Assert-ChildPath -Parent ([System.IO.Path]::GetTempPath()) -Child $ResolvedInstallDir
        if (-not ([System.IO.Path]::GetFileName($ResolvedInstallDir).StartsWith("kkterm-installer-smoke-"))) {
            throw "Refusing to clean unexpected smoke-test directory: $ResolvedInstallDir"
        }
        Remove-Item -LiteralPath $ResolvedInstallDir -Recurse -Force
    }

    if (-not $KeepInstall) {
        Remove-SmokeRegistryKey
    }
}

[PSCustomObject]@{
    Installer = $ResolvedInstallerPath.Path
    ChecksumVerified = -not $SkipChecksum
    InstallDirectory = $ResolvedInstallDir
    InstalledExecutable = $InstalledExe
    InstalledCliExecutable = $InstalledCliExe
    SilentInstall = $InstallSucceeded
    Cleanup = if ($KeepInstall) { "kept" } else { "removed" }
}
