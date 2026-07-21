param(
    [string]$OutputDir = "artifacts",
    [string]$Remote = "origin",
    [string]$Branch = "main",
    [switch]$Draft,
    [switch]$Prerelease,
    [switch]$DryRun,
    [switch]$SkipBuild,
    [switch]$SkipSmoke,
    [switch]$SkipAiReleaseNotes,
    [switch]$AllowDirty,
    [switch]$IncludeArm64,
    [switch]$NoVersionIncrement
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$PackageJsonPath = Join-Path $RepoRoot "package.json"
$PackageLockPath = Join-Path $RepoRoot "package-lock.json"
$TauriConfigPath = Join-Path $RepoRoot "src-tauri\tauri.conf.json"
$CargoTomlPath = Join-Path $RepoRoot "src-tauri\Cargo.toml"
$ChangelogPath = Join-Path $RepoRoot "CHANGELOG.md"
$ResolvedOutputDir = Join-Path $RepoRoot $OutputDir

function Invoke-Checked {
    param(
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$Action
    )

    Write-Host "==> $Action"
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "$Action failed with exit code $LASTEXITCODE."
    }
}

function Invoke-NativeCapture {
    param(
        [string]$FilePath,
        [string[]]$ArgumentList
    )

    $PreviousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $Output = & $FilePath @ArgumentList 2>&1
        return [pscustomobject]@{
            Output = $Output
            ExitCode = $LASTEXITCODE
        }
    }
    finally {
        $ErrorActionPreference = $PreviousErrorActionPreference
    }
}

function Assert-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found on PATH: $Name"
    }
}

function Assert-Version {
    param([string]$Version)

    if ($Version -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
        throw "Expected version to be <major>.<minor>.<build>, found '$Version'."
    }
}

function Import-LocalEnvFiles {
    param([string]$RootPath)

    foreach ($EnvFileName in @(".env.local", ".env")) {
        $EnvFile = Join-Path $RootPath $EnvFileName
        if (-not (Test-Path $EnvFile)) {
            continue
        }

        foreach ($Line in Get-Content -Path $EnvFile) {
            $Trimmed = $Line.Trim()
            if (-not $Trimmed -or $Trimmed.StartsWith("#")) {
                continue
            }

            $Match = [regex]::Match($Trimmed, '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$')
            if (-not $Match.Success) {
                continue
            }

            $Name = $Match.Groups[1].Value
            if (Test-Path "Env:$Name") {
                continue
            }

            $Value = $Match.Groups[2].Value.Trim()
            if (
                ($Value.StartsWith('"') -and $Value.EndsWith('"')) -or
                ($Value.StartsWith("'") -and $Value.EndsWith("'"))
            ) {
                $Value = $Value.Substring(1, $Value.Length - 2)
            }

            Set-Item -Path "Env:$Name" -Value $Value
        }
    }
}

function Set-TextFileUtf8NoBom {
    param(
        [string]$Path,
        [string]$Value
    )

    $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Value, $Utf8NoBom)
}

function Test-GitHubReleaseExists {
    param([string]$TagName)

    $PreviousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        gh release view $TagName *> $null
        return $LASTEXITCODE -eq 0
    }
    finally {
        $ErrorActionPreference = $PreviousErrorActionPreference
    }
}

function Set-CargoPackageVersion {
    param(
        [string]$Path,
        [string]$Version
    )

    # Read as UTF-8 explicitly. Under Windows PowerShell 5.1 `Get-Content -Raw`
    # decodes with the system ANSI code page (Windows-1252), so a UTF-8 em-dash
    # in the manifest comments would be misread and then re-written as UTF-8,
    # roughly doubling its byte length on every release run.
    $Content = Get-Content -Raw -Encoding utf8 $Path
    $Updated = [regex]::Replace(
        $Content,
        '(?m)^version = "\d+\.\d+\.\d+"',
        "version = `"$Version`"",
        1
    )

    if ($Updated -eq $Content) {
        throw "Unable to update package version in $Path."
    }

    Set-TextFileUtf8NoBom -Path $Path -Value $Updated
}

function Set-TauriConfigVersion {
    param(
        [string]$Path,
        [string]$Version
    )

    Write-Host "==> Update Tauri version"
    $Config = Get-Content -Raw -Encoding utf8 $Path | ConvertFrom-Json
    $Config.version = $Version
    $Updated = $Config | ConvertTo-Json -Depth 10
    Set-TextFileUtf8NoBom -Path $Path -Value ($Updated + [Environment]::NewLine)
}

function Undo-ReleaseMutations {
    # Restores the working tree to its pre-release state after a failed run so a
    # retry starts clean. The release goes through three stages of mutation;
    # rollback is keyed on how far we got:
    #   - files written, not committed  -> restore tracked files, delete notes
    #   - committed + tagged locally     -> delete tag, hard reset to original HEAD
    # Once the commit/tag are pushed we no longer roll back (the caller handles
    # that case), because un-publishing a remote ref is not safe to do silently.
    param(
        [string]$OriginalHead,
        [string]$TagName,
        [bool]$Committed,
        [string[]]$TrackedVersionFiles,
        [string[]]$GeneratedFiles
    )

    Write-Warning "Release failed before publishing; rolling back local mutations so the tree is clean for a retry."

    if ($Committed) {
        git tag -d $TagName *> $null
        git reset --hard $OriginalHead *> $null
    }
    else {
        foreach ($File in $TrackedVersionFiles) {
            git checkout -- $File *> $null
        }
    }

    # Generated release notes are untracked until the release commit lands, so a
    # hard reset does not remove the artifacts copy. Delete any that linger.
    foreach ($File in $GeneratedFiles) {
        if (Test-Path $File) {
            Remove-Item -Force $File -ErrorAction SilentlyContinue
        }
    }
}

Push-Location $RepoRoot
try {
    Import-LocalEnvFiles -RootPath $RepoRoot

    Assert-Command "git"
    Assert-Command "gh"
    Assert-Command "npm"
    Assert-Command "node"
    Assert-Command "cargo"

    $CurrentVersion = (& node -p "require('./package.json').version").Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to read package.json version."
    }
    Assert-Version $CurrentVersion

    $VersionParts = $CurrentVersion.Split(".") | ForEach-Object { [int]$_ }
    if ($NoVersionIncrement) {
        # Reuse the current version instead of bumping the patch. The version
        # files stay put; the release commit then carries only the regenerated
        # release notes and changelog.
        $NextVersion = $CurrentVersion
    } else {
        $NextVersion = "$($VersionParts[0]).$($VersionParts[1]).$($VersionParts[2] + 1)"
    }
    $TagName = "v$NextVersion"
    $TargetTriple = "windows-x64"
    $InstallerExe = Join-Path $ResolvedOutputDir "kkterm-$NextVersion-$TargetTriple-setup.exe"
    $InstallerSha = "$InstallerExe.sha256"
    $PortableZip = Join-Path $ResolvedOutputDir "kkterm-$NextVersion-windows-x64-portable.zip"
    $PortableSha = "$PortableZip.sha256"
    $ReleaseNotesPath = Join-Path $ResolvedOutputDir "release-notes-$TagName.md"
    $VersionReleaseNotesPath = Join-Path $RepoRoot "docs\releases\$TagName.md"
    # TODO(updates): Restore updater signature and latest.json release assets
    # when the update mechanism is re-enabled.
    # $InstallerSig = "$InstallerExe.sig"
    # $LatestJson = Join-Path $ResolvedOutputDir "latest.json"
    $ReleaseAssets = @($InstallerExe, $InstallerSha, $PortableZip, $PortableSha)

    # Optional native Windows on Arm (ARM64) installer, published alongside x64.
    $Arm64Triple = "windows-arm64"
    $Arm64InstallerExe = Join-Path $ResolvedOutputDir "kkterm-$NextVersion-$Arm64Triple-setup.exe"
    $Arm64InstallerSha = "$Arm64InstallerExe.sha256"
    $Arm64PortableZip = Join-Path $ResolvedOutputDir "kkterm-$NextVersion-windows-arm64-portable.zip"
    $Arm64PortableSha = "$Arm64PortableZip.sha256"
    if ($IncludeArm64) {
        $ReleaseAssets += @($Arm64InstallerExe, $Arm64InstallerSha, $Arm64PortableZip, $Arm64PortableSha)
    }

    # Files the release run rewrites and commits. Used both to detect a stale
    # half-applied release up front and to roll those exact files back on failure.
    $TrackedVersionFiles = @(
        "package.json",
        "package-lock.json",
        "src-tauri/tauri.conf.json",
        "src-tauri/Cargo.toml",
        "src-tauri/Cargo.lock"
    )
    $GeneratedReleaseNotes = @($VersionReleaseNotesPath, $ReleaseNotesPath)

    Write-Host "Current version: $CurrentVersion"
    Write-Host "Next version:    $NextVersion"
    Write-Host "Release tag:     $TagName"

    if ($DryRun) {
        Write-Host "Dry run only; no files, git refs, builds, or GitHub releases will be changed."
        return
    }

    $Status = git status --porcelain
    if ($Status -and -not $AllowDirty) {
        # A prior release run that died after the version bump but before the
        # commit leaves *only* the release-managed files dirty. Detect that exact
        # signature and print the precise reset command, rather than the generic
        # "working tree dirty" error, so a stale state is obvious and quick to fix.
        $DirtyPaths = @($Status | ForEach-Object { ($_ -replace '^.{3}', '').Trim() })
        $UnexpectedDirty = @($DirtyPaths | Where-Object { $TrackedVersionFiles -notcontains $_ })
        if ($DirtyPaths.Count -gt 0 -and $UnexpectedDirty.Count -eq 0) {
            $ResetTargets = $TrackedVersionFiles -join " "
            throw @"
The working tree contains only release version files. This usually means a prior
release run failed after the version bump but before committing, leaving a
half-applied release. Reset it and rerun:

    git checkout -- $ResetTargets

Also remove any uncommitted generated notes (docs/releases/*.md,
artifacts/release-notes-*.md) that were not part of a finished release.
"@
        }
        throw "Working tree has uncommitted changes. Commit/stash them first, or rerun with -AllowDirty."
    }

    git fetch $Remote --tags
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to fetch tags from $Remote."
    }

    $ExistingTag = git tag --list $TagName
    if ($ExistingTag) {
        throw "Tag already exists locally: $TagName"
    }

    if (Test-GitHubReleaseExists -TagName $TagName) {
        throw "GitHub release already exists: $TagName"
    }

    $PreviousTag = (git tag --list "v*" --sort=-v:refname | Select-Object -First 1)
    if (-not $PreviousTag) {
        Write-Warning "No previous v* tag found; release notes will use recent commits."
    } else {
        Write-Host "Previous tag:    $PreviousTag"
    }

    # Validate the source tree BEFORE mutating anything (release notes, version
    # bump, build). These checks do not depend on the release version, so running
    # them first means a lint/type/test failure aborts on a pristine tree with
    # nothing to undo. This is the primary guardrail: tests can no longer fail
    # *after* the version files have already been rewritten.
    Invoke-Checked -FilePath "npm" -ArgumentList @("run", "check") -Action "Frontend lint, tests, and type check"
    Invoke-Checked -FilePath "cargo" -ArgumentList @("check", "--manifest-path", "src-tauri/Cargo.toml") -Action "Rust check"
    Invoke-Checked -FilePath "cargo" -ArgumentList @("test", "--manifest-path", "src-tauri/Cargo.toml") -Action "Rust tests"

    # Everything past this point mutates the tree. Capture the starting commit so
    # a failure can roll back to it, and track how far we got so the catch knows
    # what to undo.
    $OriginalHead = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to resolve current HEAD commit."
    }
    $ReleaseCommitted = $false
    $ReleasePushed = $false

    try {
        $ReleaseNotesArgs = @(
            "scripts/generate-release-notes.mjs",
            "--version",
            $TagName,
            "--target",
            "HEAD",
            "--output",
            $ReleaseNotesPath,
            "--release-file",
            $VersionReleaseNotesPath,
            "--changelog",
            $ChangelogPath,
            "--model",
            "gpt-5.4-nano"
        )
        if ($PreviousTag) {
            $ReleaseNotesArgs += @("--previous-tag", $PreviousTag)
        }
        if ($SkipAiReleaseNotes) {
            $ReleaseNotesArgs += "--skip-ai"
        }

        Invoke-Checked -FilePath "node" -ArgumentList $ReleaseNotesArgs -Action "Generate release notes"

        Invoke-Checked -FilePath "npm" -ArgumentList @("version", $NextVersion, "--no-git-tag-version", "--allow-same-version") -Action "Update npm package version"
        Set-TauriConfigVersion -Path $TauriConfigPath -Version $NextVersion
        Set-CargoPackageVersion -Path $CargoTomlPath -Version $NextVersion

        if (-not $SkipBuild) {
            Invoke-Checked -FilePath "npm" -ArgumentList @("run", "package:installer") -Action "Build installer package"
            Invoke-Checked -FilePath "powershell" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/package-portable.ps1", "-Arch", "x64", "-OutputDir", $OutputDir, "-SkipBuild") -Action "Build x64 portable package"
            if ($IncludeArm64) {
                # `--` forwards -InstallMissing to the ARM64 packaging script so the
                # cross-build toolchain (aarch64 Rust target, ARM64 MSVC tools, CMake,
                # NASM) is provisioned on the runner before building.
                Invoke-Checked -FilePath "npm" -ArgumentList @("run", "package:installer:arm64", "--", "-InstallMissing") -Action "Build ARM64 installer package"
                Invoke-Checked -FilePath "powershell" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/package-portable.ps1", "-Arch", "arm64", "-OutputDir", $OutputDir, "-SkipBuild") -Action "Build ARM64 portable package"
            }
        }

        # TODO(updates): Restore latest.json generation when the Tauri updater is
        # re-enabled.
        # if (-not (Test-Path $InstallerSig)) {
        #     throw "Updater signature not found: $InstallerSig"
        # }
        #
        # $Signature = (Get-Content -Raw $InstallerSig).Trim()
        # $DownloadUrl = "https://github.com/ryantsai/KKTerm/releases/download/$TagName/$([System.IO.Path]::GetFileName($InstallerExe))"
        # $LatestMetadata = [ordered]@{
        #     version = $NextVersion
        #     notes = "KKTerm $TagName Windows release."
        #     pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        #     platforms = [ordered]@{
        #         "windows-x86_64" = [ordered]@{
        #             signature = $Signature
        #             url = $DownloadUrl
        #         }
        #     }
        # }
        # $LatestMetadata |
        #     ConvertTo-Json -Depth 5 |
        #     Set-Content -Path $LatestJson -Encoding UTF8

        foreach ($Asset in $ReleaseAssets) {
            if (-not (Test-Path $Asset)) {
                throw "Release asset not found: $Asset"
            }
        }

        if (-not $SkipSmoke) {
            Invoke-Checked -FilePath "npm" -ArgumentList @("run", "smoke:installer") -Action "Smoke test installer"
            Invoke-Checked -FilePath "powershell" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/smoke-portable.ps1", "-Artifact", $PortableZip) -Action "Smoke test portable package"
        }

        # Optional VirusTotal scan. Runs *before* the commit/tag are pushed so a
        # malicious verdict aborts on a still-local release that the rollback trap
        # can fully undo. Gated by VT_API_KEY so local runs don't require a key.
        if ($env:VT_API_KEY) {
            Write-Host "Submitting installer to VirusTotal..." -ForegroundColor Cyan
            try {
                $vtUrl = "https://www.virustotal.com/api/v3/files"
                $form = @{ file = Get-Item -Path $InstallerExe }
                $headers = @{ "x-apikey" = $env:VT_API_KEY }
                $response = Invoke-RestMethod -Uri $vtUrl -Method Post -Headers $headers -Form $form
                $analysisId = $response.data.id
                Write-Host "VT analysis id: $analysisId"
                # Poll the analysis (up to 3 minutes)
                $analysisUrl = "https://www.virustotal.com/api/v3/analyses/$analysisId"
                $maxWait = 180
                $waited = 0
                $vtMalicious = $null
                while ($waited -lt $maxWait) {
                    Start-Sleep -Seconds 10
                    $waited += 10
                    $r = Invoke-RestMethod -Uri $analysisUrl -Headers $headers
                    if ($r.data.attributes.status -eq "completed") {
                        $stats = $r.data.attributes.stats
                        Write-Host ("VT stats: malicious={0} suspicious={1} undetected={2}" -f $stats.malicious, $stats.suspicious, $stats.undetected)
                        $vtMalicious = [int]$stats.malicious
                        break
                    }
                }
                if ($waited -ge $maxWait) {
                    Write-Warning "VirusTotal analysis did not complete in $maxWait seconds. Proceeding without gate."
                }
            } catch {
                Write-Warning "VirusTotal submission failed: $_. Proceeding without gate."
                $vtMalicious = $null
            }

            # Throw (not exit) on a malicious verdict so the rollback trap reverts
            # the build/version mutations instead of leaving a half-applied release.
            if ($null -ne $vtMalicious -and $vtMalicious -gt 2) {
                throw "VirusTotal flagged $vtMalicious malicious engines. Release aborted before publishing."
            }
        } else {
            Write-Host "VT_API_KEY not set; skipping VirusTotal pre-publish scan." -ForegroundColor DarkGray
        }

        $AddResult = Invoke-NativeCapture -FilePath "git" -ArgumentList @("add", "package.json", "package-lock.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "CHANGELOG.md", $VersionReleaseNotesPath)
        if ($AddResult.ExitCode -ne 0) {
            throw "Unable to stage version files:`n$($AddResult.Output -join "`n")"
        }

        $StagedDiff = git diff --cached --name-only
        if (-not $StagedDiff) {
            throw "No staged release changes to commit. Files may already be at $NextVersion from a prior run; reset the version files and generated release notes, then rerun."
        }

        $CommitResult = Invoke-NativeCapture -FilePath "git" -ArgumentList @("commit", "-m", "chore: release $TagName")
        if ($CommitResult.ExitCode -ne 0) {
            throw "Unable to commit release version bump (exit $($CommitResult.ExitCode)):`n$($CommitResult.Output -join "`n")"
        }

        $TagResult = Invoke-NativeCapture -FilePath "git" -ArgumentList @("tag", "-a", $TagName, "-m", "KKTerm $TagName")
        if ($TagResult.ExitCode -ne 0) {
            throw "Unable to create git tag $TagName (exit $($TagResult.ExitCode)):`n$($TagResult.Output -join "`n")"
        }
        $ReleaseCommitted = $true

        # Push the commit and tag in a single atomic operation. If either ref is
        # rejected, neither lands, so the remote never sees a tag without its
        # commit (or vice versa).
        Invoke-Checked -FilePath "git" -ArgumentList @("push", "--atomic", $Remote, "HEAD:$Branch", $TagName) -Action "Push release commit and tag"
        $ReleasePushed = $true

        $GhArgs = @(
            "release",
            "create",
            $TagName
        )
        $GhArgs += $ReleaseAssets
        $GhArgs += @(
            "--title",
            "KKTerm $TagName",
            "--notes-file",
            $ReleaseNotesPath
        )

        if ($Draft) {
            $GhArgs += "--draft"
        }
        if ($Prerelease) {
            $GhArgs += "--prerelease"
        }

        Invoke-Checked -FilePath "gh" -ArgumentList $GhArgs -Action "Create GitHub release"

        Write-Host "==> Dispatch Cloudflare release mirror"
        gh workflow run mirror-release.yml --ref $Branch -f "tag=$TagName"
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Cloudflare mirror dispatch failed. Retry with: gh workflow run mirror-release.yml --ref $Branch -f tag=$TagName"
        }

        [PSCustomObject]@{
            Version = $NextVersion
            Tag = $TagName
            Draft = [bool]$Draft
            Prerelease = [bool]$Prerelease
            Assets = $ReleaseAssets
            ReleaseNotes = $ReleaseNotesPath
        }
    }
    catch {
        if ($ReleasePushed) {
            # The commit and tag are already on the remote; the GitHub release
            # upload (the only remaining step) failed. We do not auto-undo a
            # published ref. Tell the operator exactly how to finish or abandon
            # the release.
            Write-Error @"
The release commit and tag for $TagName were pushed to $Remote, but a later step failed:
$($_.Exception.Message)

The local repository is intact. To finish the release, retry the GitHub release upload:
    gh release create $TagName <assets> --title "KKTerm $TagName" --notes-file "$ReleaseNotesPath"

To abandon this release instead, delete the pushed tag:
    git push $Remote :refs/tags/$TagName
"@
        }
        else {
            Undo-ReleaseMutations `
                -OriginalHead $OriginalHead `
                -TagName $TagName `
                -Committed $ReleaseCommitted `
                -TrackedVersionFiles $TrackedVersionFiles `
                -GeneratedFiles $GeneratedReleaseNotes
        }
        throw
    }
}
finally {
    Pop-Location
}
