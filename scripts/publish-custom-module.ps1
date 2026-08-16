param(
    [string]$Package,
    [Parameter(Mandatory = $true)]
    [string]$Bucket,
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl,
    [Parameter(Mandatory = $true)]
    [string]$SigningKeyPath,
    [string]$CatalogPath = "catalog/v2/catalog.json",
    [ValidateRange(1, 45)]
    [int]$ExpiresDays = 30,
    [string]$KkmodToolPath,
    [string]$WriteBaseline,
    [switch]$DryRun,
    [switch]$RenewOnly,
    [string]$RemoveId,
    [switch]$SkipPackageUpload,
    [switch]$UnencryptedSigningKey
)

$ErrorActionPreference = "Stop"
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$ResolvedKkmodToolPath = if ($KkmodToolPath) {
    $KkmodToolPath
}
else {
    Join-Path $RepositoryRoot ".agents\skills\develop-kkmod-modules\scripts\kkmod_tool.py"
}
$ResolvedSigningKey = (Resolve-Path -LiteralPath $SigningKeyPath).Path
$OperationCount = @($RenewOnly.IsPresent, [bool]$RemoveId, [bool]$Package).Where({ $_ }).Count
if ($OperationCount -ne 1) {
    throw "Choose exactly one of -Package, -RenewOnly, or -RemoveId."
}
if (-not $RenewOnly -and -not $RemoveId) {
    if (-not $Package) {
        throw "-Package is required unless -RenewOnly is used."
    }
    $ResolvedPackage = (Resolve-Path -LiteralPath $Package).Path
    $ResolvedKkmodTool = (Resolve-Path -LiteralPath $ResolvedKkmodToolPath).Path
    & python $ResolvedKkmodTool check $ResolvedPackage
    if ($LASTEXITCODE -ne 0) {
        throw "KKMod validation failed. Publication was not started."
    }
}

if (-not (Test-Path Env:KKTERM_CUSTOM_MODULE_SIGNING_KEY_PASSPHRASE)) {
    foreach ($EnvFileName in @(".env.local", ".env")) {
        $EnvFile = Join-Path $RepositoryRoot $EnvFileName
        if (-not (Test-Path $EnvFile)) {
            continue
        }
        foreach ($Line in Get-Content -Path $EnvFile) {
            $Trimmed = $Line.Trim()
            if (-not $Trimmed -or $Trimmed.StartsWith("#")) {
                continue
            }
            $Match = [regex]::Match($Trimmed, "^KKTERM_CUSTOM_MODULE_SIGNING_KEY_PASSPHRASE=(.*)$")
            if (-not $Match.Success) {
                continue
            }
            $Value = $Match.Groups[1].Value.Trim()
            if (($Value.StartsWith('"') -and $Value.EndsWith('"')) -or ($Value.StartsWith("'") -and $Value.EndsWith("'"))) {
                $Value = $Value.Substring(1, $Value.Length - 2)
            }
            if ($Value.Length -gt 0) {
                $env:KKTERM_CUSTOM_MODULE_SIGNING_KEY_PASSPHRASE = $Value
            }
            break
        }
        if (Test-Path Env:KKTERM_CUSTOM_MODULE_SIGNING_KEY_PASSPHRASE) {
            break
        }
    }
}
$PassphraseWasSet = Test-Path Env:KKTERM_CUSTOM_MODULE_SIGNING_KEY_PASSPHRASE
if (-not $UnencryptedSigningKey -and -not $PassphraseWasSet) {
    $SecurePassphrase = Read-Host "Ed25519 signing-key passphrase" -AsSecureString
    $PassphrasePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassphrase)
    try {
        $env:KKTERM_CUSTOM_MODULE_SIGNING_KEY_PASSPHRASE = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($PassphrasePointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($PassphrasePointer)
    }
}

$Arguments = @(
    (Join-Path $PSScriptRoot "publish-custom-module.mjs"),
    "--bucket", $Bucket,
    "--base-url", $BaseUrl,
    "--private-key", $ResolvedSigningKey,
    "--catalog-path", $CatalogPath,
    "--expires-days", $ExpiresDays
)
if ($RenewOnly) {
    $Arguments += "--renew-only"
}
elseif ($RemoveId) {
    $Arguments += @("--remove-id", $RemoveId)
}
else {
    $Arguments += @("--package", $ResolvedPackage)
}
if ($DryRun) {
    $Arguments += "--dry-run"
}
if ($SkipPackageUpload) {
    if ($RenewOnly -or $RemoveId) {
        throw "-SkipPackageUpload applies only when publishing a package."
    }
    $Arguments += "--skip-package-upload"
}
if ($WriteBaseline) {
    $Arguments += @("--write-baseline", $WriteBaseline)
}

try {
    & node @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Custom Module publication failed."
    }
}
finally {
    if (-not $PassphraseWasSet) {
        Remove-Item Env:KKTERM_CUSTOM_MODULE_SIGNING_KEY_PASSPHRASE -ErrorAction SilentlyContinue
    }
}
