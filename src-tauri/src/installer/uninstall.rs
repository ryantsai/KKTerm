// Per-provider uninstall. Mirrors install.rs.
//
// Reverse-DAG safety (refusing to uninstall a tool that has installed
// dependents) is enforced at the command layer, not here.

use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use serde_json::json;

use super::detect::{
    detect_chocolatey_package, detect_npm_provider, detect_one, github_release_install_dir,
};
use super::events::ProgressEvent;
use super::install::EventSink;
use super::managed_app::{is_managed_app, managed_app_install_dir};
use super::proc::npm_program;
use super::schema::{Provider, Recipe};

pub fn uninstall_recipe(
    recipe: &Recipe,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    crate::logging::installer_helper_debug(
        "uninstall.recipe.start",
        &json!({ "toolId": recipe.id, "provider": provider_kind(&recipe.provider) }),
    );
    let result = if recipe.id == "n8n" {
        uninstall_managed_app(&recipe.id, emit)
    } else if recipe.id == "cursor-cli" {
        uninstall_cursor_cli(cancel, emit)
    } else if recipe.id == "hermes-agent" {
        uninstall_hermes_agent(cancel, emit)
    } else if recipe.id == "oh-my-pi" {
        uninstall_oh_my_pi(cancel, emit)
    } else if recipe.id == "uv" && detect_one(recipe).is_official_script_install() {
        // A standalone receipt proves Astral owns this binary; it does not
        // authorize `winget uninstall`, which could target a separate copy.
        Err("this uv installation is managed by Astral's standalone installer; remove it using Astral's documented standalone uninstall steps".into())
    } else if let Some(Provider::Chocolatey { id }) = recipe.chocolatey_provider.as_ref()
        && detect_chocolatey_package(id).installed
    {
        uninstall_chocolatey(&recipe.id, id, cancel, emit)
    } else if let Some(Provider::Npm { pkg }) = recipe.npm_provider.as_ref()
        && detect_npm_provider(recipe).is_some()
    {
        uninstall_npm(&recipe.id, pkg, cancel, emit)
    } else if matches!(
        recipe.download_provider.as_ref(),
        Some(Provider::DownloadInstaller { .. })
    ) && detect_one(recipe).install_provider.as_deref() == Some("downloadInstaller")
    {
        uninstall_official_cli_installer(&recipe.id, cancel, emit)
    } else if recipe.id == "ollama" {
        if let Provider::Winget { id } = &recipe.provider {
            uninstall_winget(&recipe.id, id, cancel, emit)
                .and_then(|_| uninstall_managed_app(&recipe.id, emit))
        } else {
            uninstall_recipe_by_provider(recipe, cancel, emit)
        }
    } else if is_managed_app(&recipe.id) {
        uninstall_managed_app(&recipe.id, emit)
    } else {
        uninstall_recipe_by_provider(recipe, cancel, emit)
    };
    match &result {
        Ok(()) => crate::logging::installer_helper_debug(
            "uninstall.recipe.ok",
            &json!({ "toolId": recipe.id }),
        ),
        Err(error) => crate::logging::installer_helper_debug(
            "uninstall.recipe.error",
            &json!({ "toolId": recipe.id, "error": error }),
        ),
    }
    result
}

fn official_cli_uninstall_spec(tool_id: &str) -> Option<(&'static str, &'static [&'static str])> {
    match tool_id {
        "kimi-code-cli" => Some((".kimi-code\\bin", &["kimi.exe"])),
        "grok-build" => Some((".grok\\bin", &["grok.exe", "agent.exe"])),
        _ => None,
    }
}

fn uninstall_official_cli_installer(
    tool_id: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    let (relative_bin_dir, executable_names) = official_cli_uninstall_spec(tool_id)
        .ok_or_else(|| format!("no native CLI uninstall contract is defined for `{tool_id}`"))?;
    let home = std::env::var_os("USERPROFILE")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "USERPROFILE is unavailable".to_string())?;
    let bin_dir = home.join(relative_bin_dir);
    let script = official_cli_uninstall_script(&bin_dir, executable_names);

    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("Removing native CLI binaries from {}", bin_dir.display()),
    });
    super::install::run_streamed_with_refreshed_path_public(
        "powershell",
        &[
            "-NoProfile".into(),
            "-ExecutionPolicy".into(),
            "Bypass".into(),
            "-Command".into(),
            script,
        ],
        tool_id,
        cancel,
        emit,
    )
}

fn official_cli_uninstall_script(bin_dir: &std::path::Path, executable_names: &[&str]) -> String {
    let quoted_bin_dir = super::install::powershell_single_quote(&bin_dir.to_string_lossy());
    let quoted_names = executable_names
        .iter()
        .map(|name| super::install::powershell_single_quote(name))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "$ErrorActionPreference = 'Stop'; $bin = {quoted_bin_dir}; @({quoted_names}) | ForEach-Object {{ $file = Join-Path $bin $_; if (Test-Path -LiteralPath $file -PathType Leaf) {{ Remove-Item -LiteralPath $file -Force }} }}; $userPath = [Environment]::GetEnvironmentVariable('Path', 'User'); if ($userPath) {{ $target = $bin.TrimEnd('\\'); $entries = @($userPath -split ';' | Where-Object {{ $_ -and $_.TrimEnd('\\') -ine $target }}); [Environment]::SetEnvironmentVariable('Path', ($entries -join ';'), 'User') }}; exit 0"
    )
}

fn uninstall_cursor_cli(cancel: Arc<AtomicBool>, emit: &EventSink) -> Result<(), String> {
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "LOCALAPPDATA is unavailable".to_string())?;
    let install_dir = local_app_data.join("cursor-agent");

    emit(ProgressEvent::Step {
        tool_id: "cursor-cli".into(),
        message: format!("Removing Cursor Agent CLI from {}", install_dir.display()),
    });
    super::install::run_streamed_with_refreshed_path_public(
        "powershell",
        &[
            "-NoProfile".into(),
            "-ExecutionPolicy".into(),
            "Bypass".into(),
            "-Command".into(),
            cursor_cli_uninstall_script(&install_dir),
        ],
        "cursor-cli",
        cancel,
        emit,
    )
}

fn uninstall_hermes_agent(cancel: Arc<AtomicBool>, emit: &EventSink) -> Result<(), String> {
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "LOCALAPPDATA is unavailable".to_string())?;
    let install_dir = local_app_data.join("hermes").join("hermes-agent");
    let legacy_dir = managed_app_install_dir("hermes-agent");

    emit(ProgressEvent::Step {
        tool_id: "hermes-agent".into(),
        message: format!("Removing Hermes Agent from {}", install_dir.display()),
    });
    super::install::run_streamed_with_refreshed_path_public(
        "powershell",
        &[
            "-NoProfile".into(),
            "-ExecutionPolicy".into(),
            "Bypass".into(),
            "-Command".into(),
            hermes_agent_uninstall_script(&install_dir, &legacy_dir),
        ],
        "hermes-agent",
        cancel,
        emit,
    )
}

fn hermes_agent_uninstall_script(
    install_dir: &std::path::Path,
    legacy_dir: &std::path::Path,
) -> String {
    let quoted_install_dir = super::install::powershell_single_quote(&install_dir.to_string_lossy());
    let quoted_legacy_dir = super::install::powershell_single_quote(&legacy_dir.to_string_lossy());
    format!(
        "$ErrorActionPreference = 'Stop'; $targets = @({quoted_install_dir}, {quoted_legacy_dir}); foreach ($target in $targets) {{ if (Test-Path -LiteralPath $target -PathType Container) {{ Remove-Item -LiteralPath $target -Recurse -Force }} }}; $userPath = [Environment]::GetEnvironmentVariable('Path', 'User'); if ($userPath) {{ $bin = Join-Path {quoted_install_dir} 'bin'; $entries = @($userPath -split ';' | Where-Object {{ $_ -and $_.TrimEnd('\\') -ine $bin.TrimEnd('\\') }}); [Environment]::SetEnvironmentVariable('Path', ($entries -join ';'), 'User') }}; exit 0"
    )
}

fn uninstall_oh_my_pi(cancel: Arc<AtomicBool>, emit: &EventSink) -> Result<(), String> {
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "LOCALAPPDATA is unavailable".to_string())?;
    let install_dir = local_app_data.join("omp");

    emit(ProgressEvent::Step {
        tool_id: "oh-my-pi".into(),
        message: format!("Removing Oh My Pi from {}", install_dir.display()),
    });
    super::install::run_streamed_with_refreshed_path_public(
        "powershell",
        &[
            "-NoProfile".into(),
            "-ExecutionPolicy".into(),
            "Bypass".into(),
            "-Command".into(),
            oh_my_pi_uninstall_script(&install_dir),
        ],
        "oh-my-pi",
        cancel,
        emit,
    )
}

fn oh_my_pi_uninstall_script(install_dir: &std::path::Path) -> String {
    let quoted_install_dir = super::install::powershell_single_quote(&install_dir.to_string_lossy());
    format!(
        "$ErrorActionPreference = 'Stop'; if (Test-Path -LiteralPath {quoted_install_dir} -PathType Container) {{ Remove-Item -LiteralPath {quoted_install_dir} -Recurse -Force }}; $userPath = [Environment]::GetEnvironmentVariable('Path', 'User'); if ($userPath) {{ $entries = @($userPath -split ';' | Where-Object {{ $_ -and $_.TrimEnd('\\') -ine {quoted_install_dir}.TrimEnd('\\') }}); [Environment]::SetEnvironmentVariable('Path', ($entries -join ';'), 'User') }}; $bunShim = Join-Path $env:USERPROFILE '.bun\\bin\\omp.exe'; $bun = Get-Command bun -ErrorAction SilentlyContinue; if ($bun -and (Test-Path -LiteralPath $bunShim -PathType Leaf)) {{ & $bun.Source remove -g '@oh-my-pi/pi-coding-agent' | Out-Host }}; exit 0"
    )
}

fn cursor_cli_uninstall_script(install_dir: &std::path::Path) -> String {
    let quoted_install_dir =
        super::install::powershell_single_quote(&install_dir.to_string_lossy());
    format!(
        "$ErrorActionPreference = 'Stop'; $target = {quoted_install_dir}; if (Test-Path -LiteralPath $target -PathType Container) {{ Remove-Item -LiteralPath $target -Recurse -Force }}; $userPath = [Environment]::GetEnvironmentVariable('Path', 'User'); if ($userPath) {{ $normalizedTarget = $target.TrimEnd('\\'); $entries = @($userPath -split ';' | Where-Object {{ $_ -and $_.TrimEnd('\\') -ine $normalizedTarget }}); [Environment]::SetEnvironmentVariable('Path', ($entries -join ';'), 'User') }}; exit 0"
    )
}

fn uninstall_recipe_by_provider(
    recipe: &Recipe,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    match &recipe.provider {
        Provider::Winget { id } => uninstall_winget(&recipe.id, id, cancel, emit),
        Provider::Chocolatey { id } => uninstall_chocolatey(&recipe.id, id, cancel, emit),
        Provider::Npm { pkg } => uninstall_npm(&recipe.id, pkg, cancel, emit),
        Provider::UvPip { package } => uninstall_uv_pip(&recipe.id, package, cancel, emit),
        Provider::DownloadInstaller { .. } => Err(
            "this tool uses its vendor desktop installer; uninstall it from Windows Settings"
                .into(),
        ),
        Provider::GithubRelease { .. } => uninstall_github_release(&recipe.id, emit),
        Provider::WindowsFeature { feature, .. } => {
            uninstall_windows_feature(&recipe.id, feature, cancel, emit)
        }
        Provider::WslDistro { distro } => uninstall_wsl_distro(&recipe.id, distro, cancel, emit),
        Provider::Bundle { .. } => Err(
            "bundles must be expanded into step recipes before uninstall_recipe; see commands.rs"
                .into(),
        ),
    }
}

fn provider_kind(provider: &Provider) -> &'static str {
    match provider {
        Provider::Winget { .. } => "winget",
        Provider::Chocolatey { .. } => "chocolatey",
        Provider::Npm { .. } => "npm",
        Provider::UvPip { .. } => "uvPip",
        Provider::DownloadInstaller { .. } => "downloadInstaller",
        Provider::GithubRelease { .. } => "githubRelease",
        Provider::WindowsFeature { .. } => "windowsFeature",
        Provider::WslDistro { .. } => "wslDistro",
        Provider::Bundle { .. } => "bundle",
    }
}

fn uninstall_uv_pip(
    tool_id: &str,
    package: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("uv pip uninstall {package}"),
    });
    super::install::run_streamed_with_refreshed_path_public(
        "uv",
        &[
            "pip".into(),
            "uninstall".into(),
            "--system".into(),
            package.into(),
            "-y".into(),
        ],
        tool_id,
        cancel,
        emit,
    )
}

fn uninstall_managed_app(tool_id: &str, emit: &EventSink) -> Result<(), String> {
    let dir = managed_app_install_dir(tool_id);
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("Removing {}", dir.display()),
    });
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn uninstall_winget(
    tool_id: &str,
    winget_id: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("winget uninstall --id {winget_id}"),
    });
    super::install::run_streamed_public(
        "winget",
        &[
            "uninstall".into(),
            "--id".into(),
            winget_id.into(),
            "--exact".into(),
            "--silent".into(),
            "--accept-source-agreements".into(),
            "--disable-interactivity".into(),
            "--verbose-logs".into(),
        ],
        tool_id,
        cancel,
        emit,
    )
}

fn uninstall_chocolatey(
    tool_id: &str,
    package_id: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("choco uninstall {package_id}"),
    });
    // Chocolatey requires Administrator; run elevated (one UAC prompt) so the
    // uninstall actually has permission to modify C:\ProgramData\chocolatey.
    super::install::run_streamed_elevated(
        "choco",
        &[
            "uninstall".into(),
            package_id.into(),
            "-y".into(),
            "--limit-output".into(),
        ],
        tool_id,
        cancel,
        emit,
    )
}

fn uninstall_npm(
    tool_id: &str,
    pkg: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("npm uninstall -g {pkg}"),
    });
    super::install::run_streamed_with_refreshed_path_public(
        npm_program(),
        &["uninstall".into(), "-g".into(), pkg.into()],
        tool_id,
        cancel,
        emit,
    )
}

fn uninstall_github_release(tool_id: &str, emit: &EventSink) -> Result<(), String> {
    let dir = github_release_install_dir(tool_id);
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("Removing {}", dir.display()),
    });
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn uninstall_windows_feature(
    tool_id: &str,
    feature: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("dism /online /disable-feature /featurename:{feature}"),
    });
    super::install::run_streamed_public(
        "dism",
        &[
            "/online".into(),
            "/disable-feature".into(),
            format!("/featurename:{feature}"),
            "/norestart".into(),
            "/english".into(),
        ],
        tool_id,
        cancel,
        emit,
    )
}

fn uninstall_wsl_distro(
    tool_id: &str,
    distro: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("wsl --unregister {distro}"),
    });
    super::install::run_streamed_public(
        "wsl",
        &["--unregister".into(), distro.into()],
        tool_id,
        cancel,
        emit,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_cli_uninstall_specs_remove_only_binaries() {
        assert_eq!(
            official_cli_uninstall_spec("kimi-code-cli"),
            Some((".kimi-code\\bin", ["kimi.exe"].as_slice()))
        );
        assert_eq!(
            official_cli_uninstall_spec("grok-build"),
            Some((".grok\\bin", ["grok.exe", "agent.exe"].as_slice()))
        );
        assert_eq!(official_cli_uninstall_spec("unknown"), None);

        let script = official_cli_uninstall_script(
            std::path::Path::new(r"C:\Users\ryan\.grok\bin"),
            &["grok.exe", "agent.exe"],
        );
        assert!(script.contains("'grok.exe', 'agent.exe'"));
        assert!(script.contains("SetEnvironmentVariable('Path'"));
        assert!(!script.contains("Remove-Item -LiteralPath $bin"));
        assert!(!script.contains("-Recurse"));
    }

    #[test]
    fn cursor_cli_uninstall_removes_only_the_vendor_managed_directory_and_path_entry() {
        let script = cursor_cli_uninstall_script(std::path::Path::new(
            r"C:\Users\ryan\AppData\Local\cursor-agent",
        ));

        assert!(script.contains(r"$target = 'C:\Users\ryan\AppData\Local\cursor-agent'"));
        assert!(script.contains("Remove-Item -LiteralPath $target -Recurse -Force"));
        assert!(script.contains("SetEnvironmentVariable('Path'"));
        assert!(!script.contains("$env:LOCALAPPDATA"));
    }
}
