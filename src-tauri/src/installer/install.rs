// Per-provider install executors. Each `install_*` function:
//
//   * Spawns the provider's native CLI / downloads + extracts an asset.
//   * Streams stdout/stderr lines to the frontend as ProgressEvent::Stdout
//     / Stderr via the supplied event sink.
//   * Respects a shared cancellation flag and kills the child on cancel.
//   * Returns the installed version on success, an error message on failure.
//
// The flow is intentionally not transactional — partial installs are owned
// by the underlying installer (ADR 0007 §"Execution constraints").

use std::collections::BTreeMap;
use std::io::{BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;
use std::time::{Instant, SystemTime};

use serde_json::json;

/// How often to emit a "still running" heartbeat to the frontend while a
/// child process is alive but silent. Set conservatively — winget can be
/// genuinely quiet for 30–90s during MSIX staging.
const HEARTBEAT_INTERVAL_SECS: u64 = 10;

use super::detect::{github_release_install_dir, github_release_marker_path, GithubReleaseMarker};
use super::events::ProgressEvent;
use super::managed_app::{
    managed_app_binary_dir, managed_app_data_dir, managed_app_install_dir, managed_app_marker_path,
    ManagedAppMarker,
};
use super::options::InstallOptions;
use super::proc::{no_window, npm_program};
use super::schema::{GithubReleaseLayout, Provider, Recipe, RecipeOption};

pub type EventSink = Box<dyn Fn(ProgressEvent) + Send + Sync>;

pub fn install_recipe(
    recipe: &Recipe,
    options: &InstallOptions,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    crate::logging::installer_helper_debug(
        "install.recipe.start",
        &json!({
            "toolId": recipe.id,
            "provider": provider_kind(&recipe.provider),
            "options": options,
        }),
    );
    let result = if recipe.id == "n8n" || recipe.id == "flowise" || recipe.id == "openclaw" {
        if let Provider::Npm { pkg } = &recipe.provider {
            install_managed_npm_app(&recipe.id, pkg, options, cancel, emit)
        } else {
            install_recipe_by_provider(recipe, options, cancel, emit)
        }
    } else if recipe.id == "excalidraw" {
        if let Provider::Npm { pkg } = &recipe.provider {
            install_managed_excalidraw(&recipe.id, pkg, options, cancel, emit)
        } else {
            install_recipe_by_provider(recipe, options, cancel, emit)
        }
    } else if recipe.id == "open-webui" || recipe.id == "langflow" || recipe.id == "hermes-agent" {
        if let Provider::UvPip { package } = &recipe.provider {
            install_managed_uv_pip_app(&recipe.id, package, options, cancel, emit)
        } else {
            install_recipe_by_provider(recipe, options, cancel, emit)
        }
    } else if recipe.id == "ollama" {
        if let Provider::Winget { id } = &recipe.provider {
            install_managed_ollama(&recipe.id, id, options, cancel, emit)
        } else {
            install_recipe_by_provider(recipe, options, cancel, emit)
        }
    } else {
        install_recipe_by_provider(recipe, options, cancel, emit)
    };
    match &result {
        Ok(version) => crate::logging::installer_helper_debug(
            "install.recipe.ok",
            &json!({ "toolId": recipe.id, "installedVersion": version }),
        ),
        Err(error) => crate::logging::installer_helper_debug(
            "install.recipe.error",
            &json!({ "toolId": recipe.id, "error": error }),
        ),
    }
    result
}

fn install_recipe_by_provider(
    recipe: &Recipe,
    options: &InstallOptions,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    let options = effective_install_options(recipe, options);
    let provider = selected_install_provider(recipe, &options);
    match provider {
        Provider::Winget { id } => install_winget(&recipe.id, id, &options, cancel, emit),
        Provider::Npm { pkg } => install_npm(&recipe.id, pkg, &options, cancel, emit),
        Provider::UvPip { package } => install_uv_pip(&recipe.id, package, &options, cancel, emit),
        Provider::DownloadInstaller { url, file_name } => {
            install_download_installer(&recipe.id, url, file_name, cancel, emit)
        }
        Provider::GithubRelease {
            repo,
            asset_pattern,
            layout,
        } => install_github_release(
            &recipe.id,
            repo,
            asset_pattern,
            *layout,
            &options,
            cancel,
            emit,
        ),
        Provider::WindowsFeature { feature, .. } => {
            install_windows_feature(&recipe.id, feature, cancel, emit)
        }
        Provider::WslDistro { distro } => install_wsl_distro(&recipe.id, distro, cancel, emit),
        Provider::Bundle { .. } => Err(
            "bundles must be expanded into step recipes before install_recipe; see commands.rs"
                .into(),
        ),
    }
}

fn selected_install_provider<'a>(recipe: &'a Recipe, options: &InstallOptions) -> &'a Provider {
    if options.provider.as_deref() == Some("download") {
        if let Some(provider @ Provider::DownloadInstaller { .. }) =
            recipe.download_provider.as_ref()
        {
            return provider;
        }
    }
    &recipe.provider
}

fn provider_kind(provider: &Provider) -> &'static str {
    match provider {
        Provider::Winget { .. } => "winget",
        Provider::Npm { .. } => "npm",
        Provider::UvPip { .. } => "uvPip",
        Provider::DownloadInstaller { .. } => "downloadInstaller",
        Provider::GithubRelease { .. } => "githubRelease",
        Provider::WindowsFeature { .. } => "windowsFeature",
        Provider::WslDistro { .. } => "wslDistro",
        Provider::Bundle { .. } => "bundle",
    }
}

fn install_managed_npm_app(
    tool_id: &str,
    pkg: &str,
    options: &InstallOptions,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    let install_dir = managed_app_install_dir(tool_id);
    let data_dir = managed_app_data_dir(tool_id);
    std::fs::create_dir_all(&install_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let package_json = install_dir.join("package.json");
    if !package_json.exists() {
        std::fs::write(
            &package_json,
            "{\n  \"private\": true,\n  \"dependencies\": {}\n}\n",
        )
        .map_err(|e| e.to_string())?;
    }
    let args = managed_npm_install_args(tool_id, &[managed_npm_spec(pkg, options)]);
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("npm install --prefix {}", install_dir.display()),
    });
    run_streamed_with_refreshed_path_public(npm_program(), &args, tool_id, cancel, emit)?;
    let version = detect_managed_npm_version(pkg, &install_dir);
    write_managed_app_marker(tool_id, version.clone())?;
    Ok(version)
}

fn install_managed_excalidraw(
    tool_id: &str,
    pkg: &str,
    options: &InstallOptions,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    let install_dir = managed_app_install_dir(tool_id);
    std::fs::create_dir_all(install_dir.join("src")).map_err(|e| e.to_string())?;
    write_excalidraw_host_files(&install_dir)?;
    let specs = vec![
        "react@latest".to_string(),
        "react-dom@latest".to_string(),
        managed_npm_spec(pkg, options),
        "vite@latest".to_string(),
    ];
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("npm install --prefix {}", install_dir.display()),
    });
    run_streamed_with_refreshed_path_public(
        npm_program(),
        &managed_npm_install_args(tool_id, &specs),
        tool_id,
        cancel,
        emit,
    )?;
    let version = detect_managed_npm_version(pkg, &install_dir);
    write_managed_app_marker(tool_id, version.clone())?;
    Ok(version)
}

fn install_managed_ollama(
    tool_id: &str,
    winget_id: &str,
    options: &InstallOptions,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    std::fs::create_dir_all(managed_app_binary_dir(tool_id)).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(managed_app_data_dir(tool_id).join("models"))
        .map_err(|e| e.to_string())?;
    let args = managed_ollama_winget_args_for(winget_id, options);
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("winget install --id {winget_id} --location"),
    });
    run_streamed("winget", &args, tool_id, cancel, emit)?;
    let version = detect_program_version("ollama", &["--version"]);
    write_managed_app_marker(tool_id, version.clone())?;
    Ok(version)
}

fn managed_npm_spec(pkg: &str, options: &InstallOptions) -> String {
    if let Some(v) = options.version.as_deref().filter(|s| !s.is_empty()) {
        format!("{pkg}@{v}")
    } else {
        format!("{pkg}@latest")
    }
}

fn managed_npm_install_args(tool_id: &str, specs: &[String]) -> Vec<String> {
    let mut args = vec![
        "install".into(),
        "--prefix".into(),
        managed_app_install_dir(tool_id)
            .to_string_lossy()
            .into_owned(),
    ];
    args.extend(specs.iter().cloned());
    args
}

fn write_excalidraw_host_files(install_dir: &PathBuf) -> Result<(), String> {
    let package_json = install_dir.join("package.json");
    if !package_json.exists() {
        std::fs::write(
            &package_json,
            "{\n  \"private\": true,\n  \"type\": \"module\",\n  \"scripts\": {\n    \"start\": \"vite --host 127.0.0.1 --port 3021\"\n  },\n  \"dependencies\": {}\n}\n",
        )
        .map_err(|e| e.to_string())?;
    }
    std::fs::write(
        install_dir.join("index.html"),
        "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n    <title>Excalidraw</title>\n    <script>window.EXCALIDRAW_ASSET_PATH = \"/\";</script>\n  </head>\n  <body>\n    <div id=\"root\"></div>\n    <script type=\"module\" src=\"/src/main.jsx\"></script>\n  </body>\n</html>\n",
    )
    .map_err(|e| e.to_string())?;
    std::fs::write(
        install_dir.join("src").join("main.jsx"),
        "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { Excalidraw } from '@excalidraw/excalidraw';\nimport '@excalidraw/excalidraw/index.css';\n\ncreateRoot(document.getElementById('root')).render(\n  <React.StrictMode>\n    <div style={{ height: '100vh', width: '100vw' }}>\n      <Excalidraw />\n    </div>\n  </React.StrictMode>,\n);\n",
    )
    .map_err(|e| e.to_string())
}

fn managed_uv_pip_python(tool_id: &str) -> PathBuf {
    let venv = managed_app_install_dir(tool_id).join(".venv");
    if cfg!(target_os = "windows") {
        venv.join("Scripts").join("python.exe")
    } else {
        venv.join("bin").join("python")
    }
}

fn install_managed_uv_pip_app(
    tool_id: &str,
    package: &str,
    options: &InstallOptions,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    std::fs::create_dir_all(managed_app_install_dir(tool_id)).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(managed_app_data_dir(tool_id)).map_err(|e| e.to_string())?;
    let venv_dir = managed_app_install_dir(tool_id).join(".venv");
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("uv venv {}", venv_dir.display()),
    });
    run_streamed_with_refreshed_path_public(
        "uv",
        &["venv".into(), venv_dir.to_string_lossy().into_owned()],
        tool_id,
        cancel.clone(),
        emit,
    )?;
    let version = install_uv_pip_into_python(
        tool_id,
        package,
        &managed_uv_pip_python(tool_id).to_string_lossy(),
        options,
        cancel,
        emit,
    )?;
    write_managed_app_marker(tool_id, version.clone())?;
    Ok(version)
}

fn install_uv_pip(
    tool_id: &str,
    package: &str,
    options: &InstallOptions,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    install_uv_pip_into_python(tool_id, package, "python", options, cancel, emit)
}

fn install_uv_pip_into_python(
    tool_id: &str,
    package: &str,
    python: &str,
    options: &InstallOptions,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    let spec = if let Some(v) = options.version.as_deref().filter(|s| !s.is_empty()) {
        format!("{package}=={v}")
    } else {
        package.to_string()
    };
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("uv pip install {spec}"),
    });
    run_streamed_with_refreshed_path_public(
        "uv",
        &[
            "pip".into(),
            "install".into(),
            "--python".into(),
            python.into(),
            spec,
        ],
        tool_id,
        cancel,
        emit,
    )?;
    Ok(detect_uv_pip_version(package, python))
}

fn install_download_installer(
    tool_id: &str,
    url: &str,
    file_name: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    let download_dir = std::env::temp_dir().join("kkterm-installer-downloads");
    std::fs::create_dir_all(&download_dir).map_err(|e| e.to_string())?;
    let download_path = download_dir.join(sanitize_download_file_name(file_name));

    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("Downloading {url}"),
    });
    let client = reqwest::blocking::Client::builder()
        .user_agent("KKTerm-Installer/1")
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    download_with_progress(&client, url, &download_path, tool_id, &cancel, emit)?;
    if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".into());
    }

    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("Launching {}", download_path.display()),
    });
    run_downloaded_installer(&download_path, tool_id, cancel, emit)?;
    Ok(None)
}

fn sanitize_download_file_name(file_name: &str) -> String {
    let sanitized: String = file_name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "installer.exe".into()
    } else {
        sanitized
    }
}

#[cfg(target_os = "windows")]
fn run_downloaded_installer(
    download_path: &PathBuf,
    tool_id: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    run_streamed_public(
        "powershell",
        &[
            "-NoProfile".into(),
            "-ExecutionPolicy".into(),
            "Bypass".into(),
            "-Command".into(),
            downloaded_installer_powershell_script(download_path, tool_id),
        ],
        tool_id,
        cancel,
        emit,
    )
}

fn downloaded_installer_powershell_script(download_path: &PathBuf, tool_id: &str) -> String {
    if tool_id == "winget" && is_appx_package_path(download_path) {
        return winget_app_installer_powershell_script(download_path);
    }

    if is_appx_package_path(download_path) {
        return format!(
            "$ErrorActionPreference = 'Stop'; Add-AppxPackage -Path {}; exit 0",
            powershell_single_quote(&download_path.to_string_lossy())
        );
    }

    format!(
        "$p = Start-Process -FilePath {} -Wait -PassThru; exit $p.ExitCode",
        powershell_single_quote(&download_path.to_string_lossy())
    )
}

fn winget_app_installer_powershell_script(download_path: &PathBuf) -> String {
    let package_path = powershell_single_quote(&download_path.to_string_lossy());
    format!(
        concat!(
            "$ErrorActionPreference = 'Stop'; ",
            "$family = 'Microsoft.DesktopAppInstaller_8wekyb3d8bbwe'; ",
            "try {{ Add-AppxPackage -RegisterByFamilyName -MainPackage $family -ErrorAction Stop }} catch {{ }}; ",
            "Add-AppxPackage -Path {package_path}; ",
            "try {{ Add-AppxPackage -RegisterByFamilyName -MainPackage $family -ErrorAction Stop }} catch {{ }}; ",
            "exit 0"
        )
    )
}

fn is_appx_package_path(download_path: &PathBuf) -> bool {
    let Some(extension) = download_path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    matches!(
        extension.to_ascii_lowercase().as_str(),
        "appx" | "appxbundle" | "msix" | "msixbundle"
    )
}

#[cfg(not(target_os = "windows"))]
fn run_downloaded_installer(
    download_path: &PathBuf,
    tool_id: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    run_streamed_public(
        download_path
            .to_str()
            .ok_or("invalid downloaded installer path")?,
        &[],
        tool_id,
        cancel,
        emit,
    )
}

fn powershell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(test)]
fn managed_ollama_winget_args(options: &InstallOptions) -> Vec<String> {
    managed_ollama_winget_args_for("Ollama.Ollama", options)
}

fn managed_ollama_winget_args_for(winget_id: &str, options: &InstallOptions) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "install".into(),
        "--id".into(),
        winget_id.into(),
        "--exact".into(),
        "--silent".into(),
        "--accept-package-agreements".into(),
        "--accept-source-agreements".into(),
        "--disable-interactivity".into(),
        "--source".into(),
        "winget".into(),
        "--scope".into(),
        "user".into(),
        "--location".into(),
        managed_app_binary_dir("ollama")
            .to_string_lossy()
            .into_owned(),
    ];
    if let Some(version) = options.version.as_deref() {
        if !version.is_empty() {
            args.push("--version".into());
            args.push(version.into());
        }
    }
    args
}

fn write_managed_app_marker(tool_id: &str, version: Option<String>) -> Result<(), String> {
    let marker = ManagedAppMarker {
        tool_id: tool_id.into(),
        version,
        installed_at: SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
    };
    if let Some(parent) = managed_app_marker_path(tool_id).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_vec_pretty(&marker).map_err(|e| e.to_string())?;
    std::fs::write(managed_app_marker_path(tool_id), json).map_err(|e| e.to_string())
}

fn detect_managed_npm_version(pkg: &str, install_dir: &PathBuf) -> Option<String> {
    let output = command_output_with_refreshed_path(
        npm_program(),
        &[
            "ls",
            "--prefix",
            install_dir.to_string_lossy().as_ref(),
            "--json",
            "--depth=0",
        ],
    )?;
    let parsed: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    parsed
        .get("dependencies")
        .and_then(|deps| deps.get(pkg))
        .and_then(|entry| entry.get("version"))
        .and_then(|version| version.as_str())
        .map(|value| value.to_string())
}

fn detect_uv_pip_version(package: &str, python: &str) -> Option<String> {
    let output =
        command_output_with_refreshed_path("uv", &["pip", "show", "--python", python, package])?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some(version) = line.trim().strip_prefix("Version:") {
            return Some(version.trim().to_string());
        }
    }
    None
}

fn detect_program_version(program: &str, args: &[&str]) -> Option<String> {
    let output = command_output_with_refreshed_path(program, args)?;
    let text = String::from_utf8_lossy(&output.stdout);
    parse_first_semver(&text)
}

fn command_output_with_refreshed_path(
    program: &str,
    args: &[&str],
) -> Option<std::process::Output> {
    let mut command = Command::new(program);
    command.args(args);
    if let Some(path) = refreshed_path().filter(|path| !path.trim().is_empty()) {
        command.env("PATH", path);
    }
    no_window(&mut command).output().ok()
}

fn parse_first_semver(text: &str) -> Option<String> {
    text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '.' || c == '-'))
        .find(|part| part.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .map(|part| part.to_string())
}

fn effective_install_options(recipe: &Recipe, options: &InstallOptions) -> InstallOptions {
    let mut next = options.clone();
    if matches!(recipe.provider, Provider::Winget { .. })
        && recipe.options.contains(&RecipeOption::Scope)
        && next.scope.as_deref().unwrap_or_default().trim().is_empty()
    {
        next.scope = Some("user".into());
    }
    next
}

// ---- winget ------------------------------------------------------------

fn install_winget(
    tool_id: &str,
    winget_id: &str,
    options: &InstallOptions,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("winget install --id {winget_id}"),
    });
    let mut args: Vec<String> = vec![
        "install".into(),
        "--id".into(),
        winget_id.into(),
        "--exact".into(),
        "--silent".into(),
        "--accept-package-agreements".into(),
        "--accept-source-agreements".into(),
        "--disable-interactivity".into(),
        "--source".into(),
        "winget".into(),
    ];
    if let Some(scope) = options.scope.as_deref() {
        if scope == "user" || scope == "machine" {
            args.push("--scope".into());
            args.push(scope.into());
        }
    }
    if let Some(version) = options.version.as_deref() {
        if !version.is_empty() {
            args.push("--version".into());
            args.push(version.into());
        }
    }
    if let Some(location) = options.location.as_deref() {
        if !location.is_empty() {
            args.push("--location".into());
            args.push(location.into());
        }
    }
    run_streamed("winget", &args, tool_id, cancel, emit)?;
    if winget_tool_should_add_links_to_path(tool_id) {
        if let Some(dir) = winget_links_dir() {
            add_to_user_path(&dir, tool_id, emit);
        }
    }
    // We don't try to parse winget's silent stdout for the installed version;
    // a subsequent detect_one() reads the local installed-software inventory.
    // Returning None lets the caller decide whether to re-detect.
    Ok(None)
}

fn winget_tool_should_add_links_to_path(tool_id: &str) -> bool {
    matches!(tool_id, "nssm" | "ripgrep" | "jq" | "fzf" | "uv" | "ffmpeg")
}

fn winget_links_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(winget_links_dir_from_local_app_data)
}

fn winget_links_dir_from_local_app_data(local_app_data: PathBuf) -> PathBuf {
    local_app_data
        .join("Microsoft")
        .join("WinGet")
        .join("Links")
}

// ---- npm ---------------------------------------------------------------

fn install_npm(
    tool_id: &str,
    pkg: &str,
    options: &InstallOptions,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    let spec = if let Some(v) = options.version.as_deref().filter(|s| !s.is_empty()) {
        format!("{pkg}@{v}")
    } else {
        format!("{pkg}@latest")
    };
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("npm install -g {spec}"),
    });
    run_streamed_with_refreshed_path_public(
        npm_program(),
        &["install".into(), "-g".into(), spec.clone()],
        tool_id,
        cancel,
        emit,
    )?;
    Ok(None)
}

// ---- github-release ----------------------------------------------------

fn install_github_release(
    tool_id: &str,
    repo: &str,
    asset_pattern: &str,
    layout: GithubReleaseLayout,
    options: &InstallOptions,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("Querying GitHub releases for {repo}"),
    });
    let api_url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let client = reqwest::blocking::Client::builder()
        .user_agent("KKTerm-Installer/1")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let release_json: serde_json::Value = client
        .get(&api_url)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(|e| format!("GitHub releases fetch failed: {e}"))?;

    let tag_name = release_json
        .get("tag_name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let pattern = asset_pattern.to_string();
    let asset = release_json
        .get("assets")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            arr.iter().find(|a| {
                a.get("name")
                    .and_then(|n| n.as_str())
                    .map(|name| glob_match(&pattern, name))
                    .unwrap_or(false)
            })
        })
        .ok_or_else(|| format!("no release asset matched pattern `{asset_pattern}` in {repo}"))?;

    let asset_name = asset
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or("asset has no name field")?;
    let download_url = asset
        .get("browser_download_url")
        .and_then(|v| v.as_str())
        .ok_or("asset has no browser_download_url field")?
        .to_string();

    let install_dir = options
        .location
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| github_release_install_dir(tool_id));
    std::fs::create_dir_all(&install_dir).map_err(|e| e.to_string())?;

    // Stage 1: download.
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("Downloading {asset_name}"),
    });
    let download_path = install_dir.join(asset_name);
    download_with_progress(
        &client,
        &download_url,
        &download_path,
        tool_id,
        &cancel,
        emit,
    )?;

    if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".into());
    }

    // Stage 2: layout-specific install.
    match layout {
        GithubReleaseLayout::Zip => {
            emit(ProgressEvent::Step {
                tool_id: tool_id.into(),
                message: "Extracting archive".into(),
            });
            extract_zip(&download_path, &install_dir)?;
            std::fs::remove_file(&download_path).ok();
            if options.add_to_path.unwrap_or(false) {
                add_to_user_path(&install_dir, tool_id, emit);
            }
        }
        GithubReleaseLayout::ExeInstaller => {
            emit(ProgressEvent::Step {
                tool_id: tool_id.into(),
                message: format!("Running {asset_name} /S"),
            });
            run_streamed(
                download_path.to_str().ok_or("invalid download path")?,
                &["/S".into()],
                tool_id,
                cancel.clone(),
                emit,
            )?;
        }
        GithubReleaseLayout::Msi => {
            emit(ProgressEvent::Step {
                tool_id: tool_id.into(),
                message: format!("msiexec /i {asset_name} /qn"),
            });
            run_streamed(
                "msiexec",
                &[
                    "/i".into(),
                    download_path.to_string_lossy().to_string(),
                    "/qn".into(),
                ],
                tool_id,
                cancel.clone(),
                emit,
            )?;
        }
    }

    // Stage 3: marker write so detect_github_release_marker recognizes it.
    let marker = GithubReleaseMarker {
        tool_id: tool_id.into(),
        version: tag_name.clone(),
        installed_at: SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
        layout,
    };
    if let Ok(json) = serde_json::to_vec_pretty(&marker) {
        let _ = std::fs::write(github_release_marker_path(tool_id), json);
    }

    Ok(tag_name)
}

fn download_with_progress(
    client: &reqwest::blocking::Client,
    url: &str,
    dest: &PathBuf,
    tool_id: &str,
    cancel: &Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    crate::logging::installer_helper_debug(
        "download.start",
        &json!({ "toolId": tool_id, "url": url, "dest": dest }),
    );
    let mut resp = client
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    let total = resp.content_length();
    let mut file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut buf = [0u8; 64 * 1024];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        let n = resp.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        downloaded = downloaded.saturating_add(n as u64);
        if let Some(t) = total {
            if t > 0 {
                let ratio = (downloaded as f32 / t as f32).clamp(0.0, 1.0);
                emit(ProgressEvent::Progress {
                    tool_id: tool_id.into(),
                    step_id: None,
                    ratio,
                });
            }
        }
    }
    crate::logging::installer_helper_debug(
        "download.ok",
        &json!({ "toolId": tool_id, "dest": dest, "bytes": downloaded, "totalBytes": total }),
    );
    Ok(())
}

fn extract_zip(zip_path: &PathBuf, dest: &PathBuf) -> Result<(), String> {
    crate::logging::installer_helper_debug(
        "archive.extract.start",
        &json!({ "zipPath": zip_path, "dest": dest }),
    );
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let entry_count = archive.len();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = entry.enclosed_name() else {
            continue;
        };
        let target = dest.join(rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = std::fs::File::create(&target).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        }
    }
    crate::logging::installer_helper_debug(
        "archive.extract.ok",
        &json!({ "zipPath": zip_path, "dest": dest, "entryCount": entry_count }),
    );
    Ok(())
}

#[cfg(target_os = "windows")]
fn add_to_user_path(dir: &PathBuf, tool_id: &str, emit: &EventSink) {
    // setx PATH appends to the persisted user PATH but truncates at 1024 chars.
    // We delegate to PowerShell to read+rewrite the Environment user PATH
    // safely. Failure here is non-fatal — the tool is still installed.
    let dir_str = dir.to_string_lossy().to_string();
    let script = format!(
        r#"$cur = [Environment]::GetEnvironmentVariable('Path','User'); if ($cur -notlike '*{0}*') {{ [Environment]::SetEnvironmentVariable('Path', ($cur + ';{0}').Trim(';'), 'User') }}"#,
        dir_str.replace('\'', "''")
    );
    let result = no_window(Command::new("powershell").args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        &script,
    ]))
    .output();
    match result {
        Ok(o) if o.status.success() => emit(ProgressEvent::Stdout {
            tool_id: tool_id.into(),
            step_id: None,
            line: format!("Added {dir_str} to user PATH (open a new shell to pick up)"),
        }),
        Ok(o) => emit(ProgressEvent::Stderr {
            tool_id: tool_id.into(),
            step_id: None,
            line: format!(
                "Could not add to PATH: {}",
                String::from_utf8_lossy(&o.stderr).trim()
            ),
        }),
        Err(e) => emit(ProgressEvent::Stderr {
            tool_id: tool_id.into(),
            step_id: None,
            line: format!("Could not add to PATH: {e}"),
        }),
    }
}

#[cfg(not(target_os = "windows"))]
fn add_to_user_path(_dir: &PathBuf, _tool_id: &str, _emit: &EventSink) {}

/// Minimal glob matcher for `*` only — sufficient for asset filename
/// patterns like `nssm-*-win.zip`. Returns true iff `pattern` matches the
/// full `name`. No `?`, no `[abc]`, no escapes.
fn glob_match(pattern: &str, name: &str) -> bool {
    let segments: Vec<&str> = pattern.split('*').collect();
    if segments.is_empty() {
        return pattern == name;
    }
    if !name.starts_with(segments[0]) {
        return false;
    }
    let mut pos = segments[0].len();
    for (i, seg) in segments.iter().enumerate().skip(1) {
        if seg.is_empty() {
            // Trailing '*' matches the rest.
            if i == segments.len() - 1 {
                return true;
            }
            continue;
        }
        if i == segments.len() - 1 {
            return name[pos..].ends_with(seg);
        }
        match name[pos..].find(seg) {
            Some(idx) => pos = pos + idx + seg.len(),
            None => return false,
        }
    }
    true
}

// ---- windows-feature ---------------------------------------------------

fn install_windows_feature(
    tool_id: &str,
    feature: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    if is_wsl_feature(feature) {
        let args = wsl_base_install_args();
        emit(ProgressEvent::Step {
            tool_id: tool_id.into(),
            message: format!("wsl {}", args.join(" ")),
        });
        run_streamed("wsl", &args, tool_id, cancel, emit)?;
        return Ok(None);
    }

    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("dism /online /enable-feature /featurename:{feature}"),
    });
    run_streamed(
        "dism",
        &[
            "/online".into(),
            "/enable-feature".into(),
            format!("/featurename:{feature}"),
            "/norestart".into(),
            "/english".into(),
        ],
        tool_id,
        cancel,
        emit,
    )?;
    Ok(None)
}

fn install_wsl_distro(
    tool_id: &str,
    distro: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    let args = wsl_distro_install_args(distro);
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("wsl {}", args.join(" ")),
    });
    run_streamed("wsl", &args, tool_id, cancel, emit)?;
    Ok(None)
}

fn wsl_base_install_args() -> Vec<String> {
    vec!["--install".into(), "--no-distribution".into()]
}

fn wsl_distro_install_args(distro: &str) -> Vec<String> {
    vec![
        "--install".into(),
        "--distribution".into(),
        distro.into(),
        "--no-launch".into(),
    ]
}

fn is_wsl_feature(feature: &str) -> bool {
    feature.eq_ignore_ascii_case("Microsoft-Windows-Subsystem-Linux")
}

// ---- streaming child-process runner ------------------------------------

/// Public alias used by uninstall.rs.
pub fn run_streamed_public(
    program: &str,
    args: &[String],
    tool_id: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    run_streamed(program, args, tool_id, cancel, emit)
}

/// Run a command after refreshing PATH from persisted Windows environment
/// variables. Winget installers often update user or machine PATH, but the
/// already-running Tauri process does not inherit that change.
pub fn run_streamed_with_refreshed_path_public(
    program: &str,
    args: &[String],
    tool_id: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    run_streamed_with_environment(
        program,
        args,
        tool_id,
        cancel,
        emit,
        refreshed_environment(),
    )
}

pub fn refreshed_path_public() -> Option<String> {
    refreshed_path()
}

fn run_streamed(
    program: &str,
    args: &[String],
    tool_id: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    run_streamed_with_environment(
        program,
        args,
        tool_id,
        cancel,
        emit,
        RefreshedEnvironment::default(),
    )
}

fn run_streamed_with_environment(
    program: &str,
    args: &[String],
    tool_id: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
    environment: RefreshedEnvironment,
) -> Result<(), String> {
    let started_at_log = Instant::now();
    crate::logging::installer_helper_debug(
        "process.spawn.start",
        &json!({
            "toolId": tool_id,
            "program": program,
            "args": args,
            "pathOverride": environment.path.as_ref().map(|path| !path.trim().is_empty()).unwrap_or(false),
            "envOverrideKeys": environment.vars.keys().collect::<Vec<_>>(),
        }),
    );
    // Surface the exact command we're about to run. Stalls show up as a
    // long stretch with no further lines after this one — the heartbeat
    // below makes the silence visible instead of looking frozen.
    emit(ProgressEvent::Stdout {
        tool_id: tool_id.into(),
        step_id: None,
        line: format!("$ {program} {}", args.join(" ")),
    });

    let mut command = Command::new(program);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    for (name, value) in environment.vars {
        command.env(name, value);
    }
    if let Some(path) = environment.path.filter(|path| !path.trim().is_empty()) {
        command.env("PATH", path);
    }

    let mut child = no_window(&mut command).spawn().map_err(|e| {
        crate::logging::installer_helper_debug(
            "process.spawn.error",
            &json!({ "toolId": tool_id, "program": program, "error": e.to_string() }),
        );
        format!("failed to spawn `{program}`: {e}")
    })?;
    let (tx, rx) = mpsc::channel::<StreamLine>();
    let stdout_thread = forward_stream(child.stdout.take(), tx.clone(), true);
    let stderr_thread = forward_stream(child.stderr.take(), tx, false);

    let started_at = Instant::now();
    let mut last_output_at = Instant::now();
    let mut next_heartbeat_at =
        started_at + std::time::Duration::from_secs(HEARTBEAT_INTERVAL_SECS);

    loop {
        let mut got_line = false;
        while let Ok(line) = rx.try_recv() {
            emit_stream_line(tool_id, emit, line);
            got_line = true;
        }
        if got_line {
            last_output_at = Instant::now();
        }
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            join_stream(stdout_thread);
            join_stream(stderr_thread);
            while let Ok(line) = rx.try_recv() {
                emit_stream_line(tool_id, emit, line);
            }
            crate::logging::installer_helper_debug(
                "process.cancelled",
                &json!({
                    "toolId": tool_id,
                    "program": program,
                    "elapsedMs": started_at_log.elapsed().as_millis(),
                }),
            );
            return Err("cancelled".into());
        }
        // Heartbeat: if the child is still alive and we've been silent for
        // a while, emit a synthetic stderr line so the UI shows progress.
        // Winget renders its progress bar with carriage returns rather than
        // newlines, so BufReader::read_line stays blocked for tens of
        // seconds at a time; without this the UI sat on "Installing..."
        // with no log activity and looked stuck.
        if Instant::now() >= next_heartbeat_at {
            let elapsed = started_at.elapsed().as_secs();
            let silent = last_output_at.elapsed().as_secs();
            emit(ProgressEvent::Stderr {
                tool_id: tool_id.into(),
                step_id: None,
                line: format!(
                    "[installer] still running: {elapsed}s elapsed, {silent}s since last output"
                ),
            });
            next_heartbeat_at =
                Instant::now() + std::time::Duration::from_secs(HEARTBEAT_INTERVAL_SECS);
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                join_stream(stdout_thread);
                join_stream(stderr_thread);
                while let Ok(line) = rx.try_recv() {
                    emit_stream_line(tool_id, emit, line);
                }
                let elapsed = started_at.elapsed().as_secs();
                if status.success() {
                    emit(ProgressEvent::Stdout {
                        tool_id: tool_id.into(),
                        step_id: None,
                        line: format!("[installer] `{program}` exited 0 after {elapsed}s"),
                    });
                    crate::logging::installer_helper_debug(
                        "process.exit.ok",
                        &json!({
                            "toolId": tool_id,
                            "program": program,
                            "elapsedMs": started_at_log.elapsed().as_millis(),
                            "code": status.code(),
                        }),
                    );
                    return Ok(());
                }
                let code = status.code().unwrap_or(-1);
                emit(ProgressEvent::Stderr {
                    tool_id: tool_id.into(),
                    step_id: None,
                    line: format!("[installer] `{program}` exited {code} after {elapsed}s"),
                });
                crate::logging::installer_helper_debug(
                    "process.exit.error",
                    &json!({
                        "toolId": tool_id,
                        "program": program,
                        "elapsedMs": started_at_log.elapsed().as_millis(),
                        "code": code,
                    }),
                );
                return Err(format!("`{program}` exited with status {code}"));
            }
            Ok(None) => match rx.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok(line) => {
                    emit_stream_line(tool_id, emit, line);
                    last_output_at = Instant::now();
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {}
            },
            Err(e) => {
                crate::logging::installer_helper_debug(
                    "process.wait.error",
                    &json!({ "toolId": tool_id, "program": program, "error": e.to_string() }),
                );
                return Err(format!("wait on `{program}` failed: {e}"));
            }
        }
    }
}

#[derive(Default)]
struct RefreshedEnvironment {
    path: Option<String>,
    vars: BTreeMap<String, String>,
}

fn refreshed_environment() -> RefreshedEnvironment {
    #[cfg(target_os = "windows")]
    {
        refreshed_windows_environment()
    }
    #[cfg(not(target_os = "windows"))]
    {
        RefreshedEnvironment::default()
    }
}

#[cfg(target_os = "windows")]
fn refreshed_windows_environment() -> RefreshedEnvironment {
    let script = r#"$names = @('Path','NVM_HOME','NVM_SYMLINK'); foreach ($name in $names) { $machine = [Environment]::GetEnvironmentVariable($name,'Machine'); $user = [Environment]::GetEnvironmentVariable($name,'User'); if ($machine) { "Machine`t$name`t$machine" }; if ($user) { "User`t$name`t$user" } }"#;
    let output = no_window(
        Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .stdin(Stdio::null()),
    )
    .output()
    .ok();
    let Some(output) = output else {
        return RefreshedEnvironment::default();
    };
    if !output.status.success() {
        return RefreshedEnvironment::default();
    }
    let (persisted_path, vars) =
        parse_persisted_environment(&String::from_utf8_lossy(&output.stdout));
    let path_extras = refreshed_path_extras(&vars);
    let path = merge_path_values(
        std::env::var("PATH").ok().as_deref(),
        Some(&persisted_path),
        path_extras.iter().map(|path| Some(path.as_str())),
    );
    RefreshedEnvironment {
        path: Some(path),
        vars,
    }
}

fn refreshed_path() -> Option<String> {
    refreshed_environment().path
}

fn parse_persisted_environment(output: &str) -> (String, BTreeMap<String, String>) {
    let mut machine_path: Option<String> = None;
    let mut user_path: Option<String> = None;
    let mut vars = BTreeMap::new();
    for line in output.lines() {
        let mut parts = line.splitn(3, '\t');
        let Some(scope) = parts.next() else { continue };
        let Some(name) = parts.next() else { continue };
        let Some(value) = parts.next() else { continue };
        if value.trim().is_empty() {
            continue;
        }
        if name.eq_ignore_ascii_case("Path") {
            if scope.eq_ignore_ascii_case("Machine") {
                machine_path = Some(value.to_string());
            } else if scope.eq_ignore_ascii_case("User") {
                user_path = Some(value.to_string());
            }
            continue;
        }
        // User-scoped values intentionally win over machine-scoped values,
        // matching Windows' effective environment merge for the same name.
        vars.insert(name.to_ascii_uppercase(), value.to_string());
    }
    let path = ([machine_path, user_path]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>())
    .join(";");
    (path, vars)
}

fn refreshed_path_extras(vars: &BTreeMap<String, String>) -> Vec<String> {
    let mut extras = Vec::new();
    for name in ["NVM_HOME", "NVM_SYMLINK"] {
        if let Some(value) = vars.get(name).filter(|value| !value.trim().is_empty()) {
            extras.push(value.clone());
        }
    }
    if let Some(dir) = winget_links_dir().filter(|dir| dir.is_dir()) {
        extras.push(dir.to_string_lossy().to_string());
    }
    for dir in git_cmd_path_candidates()
        .into_iter()
        .filter(|dir| dir.is_dir())
    {
        extras.push(dir.to_string_lossy().to_string());
    }
    extras
}

fn git_cmd_path_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(program_files) = std::env::var_os("ProgramFiles").map(PathBuf::from) {
        candidates.push(program_files.join("Git").join("cmd"));
    }
    if let Some(program_files_x86) = std::env::var_os("ProgramFiles(x86)").map(PathBuf::from) {
        candidates.push(program_files_x86.join("Git").join("cmd"));
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        candidates.push(local_app_data.join("Programs").join("Git").join("cmd"));
    }
    candidates
}

fn merge_path_values<'a>(
    current: Option<&'a str>,
    persisted: Option<&'a str>,
    extras: impl IntoIterator<Item = Option<&'a str>>,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    for value in [current, persisted]
        .into_iter()
        .chain(extras.into_iter())
        .flatten()
    {
        for part in value.split(';') {
            let trimmed = part.trim();
            if trimmed.is_empty() {
                continue;
            }
            if !parts
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(trimmed))
            {
                parts.push(trimmed.to_string());
            }
        }
    }
    parts.join(";")
}

struct StreamLine {
    is_stdout: bool,
    line: String,
    is_transient: bool,
}

fn forward_stream<R: Read + Send + 'static>(
    stream: Option<R>,
    tx: mpsc::Sender<StreamLine>,
    is_stdout: bool,
) -> Option<JoinHandle<()>> {
    let Some(stream) = stream else { return None };
    Some(std::thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        let mut buf = Vec::new();
        let mut byte = [0_u8; 1];
        loop {
            match reader.read(&mut byte) {
                Ok(0) => {
                    let _ = send_stream_chunk(&tx, is_stdout, &mut buf, false);
                    break;
                }
                Ok(_) => match byte[0] {
                    b'\r' => {
                        if !send_stream_chunk(&tx, is_stdout, &mut buf, true) {
                            break;
                        }
                    }
                    b'\n' => {
                        if !send_stream_chunk(&tx, is_stdout, &mut buf, false) {
                            break;
                        }
                    }
                    b => buf.push(b),
                },
                Err(_) => break,
            }
        }
    }))
}

fn send_stream_chunk(
    tx: &mpsc::Sender<StreamLine>,
    is_stdout: bool,
    buf: &mut Vec<u8>,
    is_transient: bool,
) -> bool {
    if buf.is_empty() {
        return true;
    }
    let line = String::from_utf8_lossy(buf).trim().to_string();
    buf.clear();
    if line.is_empty() {
        return true;
    }
    tx.send(StreamLine {
        is_stdout,
        line,
        is_transient,
    })
    .is_ok()
}

fn emit_stream_line(tool_id: &str, emit: &EventSink, line: StreamLine) {
    crate::logging::installer_helper_debug(
        if line.is_stdout {
            "process.stdout"
        } else {
            "process.stderr"
        },
        &json!({
            "toolId": tool_id,
            "line": line.line,
            "transient": line.is_transient,
        }),
    );
    if let Some(ratio) = parse_cli_progress_ratio(&line.line) {
        emit(ProgressEvent::Progress {
            tool_id: tool_id.into(),
            step_id: None,
            ratio,
        });
    }
    if line.is_transient {
        return;
    }
    if line.is_stdout {
        emit(ProgressEvent::Stdout {
            tool_id: tool_id.into(),
            step_id: None,
            line: line.line,
        });
    } else {
        emit(ProgressEvent::Stderr {
            tool_id: tool_id.into(),
            step_id: None,
            line: line.line,
        });
    }
}

fn parse_cli_progress_ratio(line: &str) -> Option<f32> {
    parse_percent_progress(line).or_else(|| parse_size_fraction_progress(line))
}

fn parse_percent_progress(line: &str) -> Option<f32> {
    let mut candidate = None;
    let chars: Vec<char> = line.chars().collect();
    for index in 0..chars.len() {
        if chars[index] != '%' {
            continue;
        }
        let mut start = index;
        while start > 0 {
            let prev = chars[start - 1];
            if prev.is_ascii_digit() || prev == '.' {
                start -= 1;
            } else {
                break;
            }
        }
        let text: String = chars[start..index].iter().collect();
        if let Ok(value) = text.parse::<f32>() {
            if (0.0..=100.0).contains(&value) {
                candidate = Some((value / 100.0).clamp(0.0, 1.0));
            }
        }
    }
    candidate
}

fn parse_size_fraction_progress(line: &str) -> Option<f32> {
    let tokens: Vec<&str> = line.split_whitespace().collect();
    for start in 0..tokens.len() {
        let Some((left, consumed_left)) = parse_size_quantity(&tokens, start) else {
            continue;
        };
        let slash = start + consumed_left;
        if tokens.get(slash).copied() != Some("/") {
            continue;
        }
        let Some((right, _)) = parse_size_quantity(&tokens, slash + 1) else {
            continue;
        };
        if right > 0.0 && left >= 0.0 {
            return Some(((left / right) as f32).clamp(0.0, 1.0));
        }
    }
    None
}

fn parse_size_quantity(tokens: &[&str], start: usize) -> Option<(f64, usize)> {
    let token = tokens.get(start)?;
    if let Some(value) = parse_number(token) {
        let unit = tokens.get(start + 1)?;
        return size_unit_multiplier(unit).map(|multiplier| (value * multiplier, 2));
    }

    let split = token
        .char_indices()
        .find(|(_, ch)| !ch.is_ascii_digit() && *ch != '.' && *ch != ',')
        .map(|(index, _)| index)?;
    let (number, unit) = token.split_at(split);
    let value = parse_number(number)?;
    size_unit_multiplier(unit).map(|multiplier| (value * multiplier, 1))
}

fn parse_number(token: &str) -> Option<f64> {
    token.replace(',', "").parse::<f64>().ok()
}

fn size_unit_multiplier(unit: &str) -> Option<f64> {
    let normalized = unit
        .trim_matches(|ch: char| !ch.is_ascii_alphanumeric())
        .to_ascii_lowercase();
    match normalized.as_str() {
        "b" | "byte" | "bytes" => Some(1.0),
        "kb" | "kib" => Some(1024.0),
        "mb" | "mib" => Some(1024.0 * 1024.0),
        "gb" | "gib" => Some(1024.0 * 1024.0 * 1024.0),
        "tb" | "tib" => Some(1024.0 * 1024.0 * 1024.0 * 1024.0),
        _ => None,
    }
}

fn join_stream(handle: Option<JoinHandle<()>>) {
    if let Some(handle) = handle {
        let _ = handle.join();
    }
}

#[allow(dead_code)]
fn _silence_child_unused(_c: &Child) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::sync::Mutex;

    #[test]
    fn glob_exact() {
        assert!(glob_match("nssm.zip", "nssm.zip"));
        assert!(!glob_match("nssm.zip", "nssm-2.zip"));
    }

    #[test]
    fn glob_middle_star() {
        assert!(glob_match(
            "nssm-*-win.zip",
            "nssm-2.24-101-g897c7ad-win.zip"
        ));
        assert!(!glob_match("nssm-*-win.zip", "nssm-2.24-mac.zip"));
    }

    #[test]
    fn glob_leading_star() {
        assert!(glob_match("*.exe", "aider.exe"));
        assert!(!glob_match("*.exe", "aider.tar.gz"));
    }

    #[test]
    fn glob_trailing_star() {
        assert!(glob_match("aider-*", "aider-1.0.0"));
    }

    #[test]
    fn merge_path_values_preserves_order_and_deduplicates_case_insensitive() {
        let merged = merge_path_values(
            Some(r"C:\Windows;C:\Tools"),
            Some(r"c:\tools;C:\Users\Ryan\AppData\Local\Microsoft\WinGet\Links"),
            std::iter::empty::<Option<&str>>(),
        );

        assert_eq!(
            merged,
            r"C:\Windows;C:\Tools;C:\Users\Ryan\AppData\Local\Microsoft\WinGet\Links"
        );
    }

    #[test]
    fn merge_path_values_appends_fresh_nvm_directories() {
        let merged = merge_path_values(
            Some(r"C:\Windows"),
            Some(r"C:\Tools"),
            [
                Some(r"C:\Users\Ryan\AppData\Local\nvm"),
                Some(r"C:\nvm4w\nodejs"),
            ],
        );

        assert_eq!(
            merged,
            r"C:\Windows;C:\Tools;C:\Users\Ryan\AppData\Local\nvm;C:\nvm4w\nodejs"
        );
    }

    #[test]
    fn parse_persisted_environment_prefers_user_values() {
        let (_, vars) = parse_persisted_environment(
            "Machine\tNVM_HOME\tC:\\ProgramData\\nvm\nUser\tNVM_HOME\tC:\\Users\\Ryan\\AppData\\Local\\nvm\n",
        );

        assert_eq!(
            vars.get("NVM_HOME").map(String::as_str),
            Some(r"C:\Users\Ryan\AppData\Local\nvm")
        );
    }

    fn winget_recipe_with_options(options: Vec<super::super::schema::RecipeOption>) -> Recipe {
        Recipe {
            id: "git".into(),
            name: "Git for Windows".into(),
            description_en: "Distributed version control.".into(),
            description_locales: Default::default(),
            needs: vec![],
            icon: None,
            category: None,
            provider: Provider::Winget {
                id: "Git.Git".into(),
            },
            download_provider: None,
            options,
            homepage: None,
            release_notes_url: None,
            detection: Default::default(),
        }
    }

    #[test]
    fn appx_package_downloads_install_with_add_appxpackage() {
        let script = downloaded_installer_powershell_script(
            &PathBuf::from(r"C:\Temp\Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle"),
            "claude-desktop",
        );

        assert!(script.contains("Add-AppxPackage -Path"));
        assert!(!script.contains("Start-Process"));
    }

    #[test]
    fn winget_app_installer_download_requests_family_registration() {
        let script = downloaded_installer_powershell_script(
            &PathBuf::from(r"C:\Temp\Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle"),
            "winget",
        );

        assert!(script.contains("Add-AppxPackage -RegisterByFamilyName -MainPackage"));
        assert!(script.contains("Microsoft.DesktopAppInstaller_8wekyb3d8bbwe"));
        assert!(script.contains("Add-AppxPackage -Path"));
    }

    #[test]
    fn exe_downloads_still_launch_with_start_process() {
        let script =
            downloaded_installer_powershell_script(&PathBuf::from(r"C:\Temp\setup.exe"), "7zip");

        assert!(script.contains("Start-Process -FilePath"));
        assert!(!script.contains("Add-AppxPackage"));
    }

    #[test]
    fn scoped_winget_recipe_defaults_to_user_scope() {
        let recipe = winget_recipe_with_options(vec![super::super::schema::RecipeOption::Scope]);
        let effective = effective_install_options(&recipe, &InstallOptions::default());

        assert_eq!(effective.scope.as_deref(), Some("user"));
    }

    #[test]
    fn explicit_machine_scope_is_preserved() {
        let recipe = winget_recipe_with_options(vec![super::super::schema::RecipeOption::Scope]);
        let effective = effective_install_options(
            &recipe,
            &InstallOptions {
                scope: Some("machine".into()),
                ..InstallOptions::default()
            },
        );

        assert_eq!(effective.scope.as_deref(), Some("machine"));
    }

    #[test]
    fn winget_recipe_without_scope_option_does_not_gain_scope() {
        let recipe = winget_recipe_with_options(vec![super::super::schema::RecipeOption::Version]);
        let effective = effective_install_options(&recipe, &InstallOptions::default());

        assert_eq!(effective.scope, None);
    }

    #[test]
    fn winget_cli_utilities_request_winget_links_on_path() {
        for tool_id in ["nssm", "ripgrep", "jq", "fzf", "uv", "ffmpeg"] {
            assert!(
                winget_tool_should_add_links_to_path(tool_id),
                "{tool_id} should add the winget links directory to PATH"
            );
        }
        assert!(!winget_tool_should_add_links_to_path("bruno"));
        assert!(!winget_tool_should_add_links_to_path("vscode"));
        assert!(!winget_tool_should_add_links_to_path("git"));
    }

    #[test]
    fn winget_links_dir_uses_local_app_data() {
        let dir =
            winget_links_dir_from_local_app_data(PathBuf::from(r"C:\Users\Ryan\AppData\Local"));

        assert_eq!(
            dir,
            PathBuf::from(r"C:\Users\Ryan\AppData\Local\Microsoft\WinGet\Links")
        );
    }

    #[test]
    fn n8n_managed_install_uses_project_prefix_without_global_flag() {
        let spec = managed_npm_spec(
            "n8n",
            &InstallOptions {
                version: Some("1.2.3".into()),
                ..InstallOptions::default()
            },
        );
        let args = managed_npm_install_args("n8n", &[spec]);

        assert_eq!(args[0], "install");
        assert!(args.contains(&"--prefix".to_string()));
        assert!(args.contains(&"n8n@1.2.3".to_string()));
        assert!(!args.contains(&"-g".to_string()));
    }

    #[test]
    fn managed_ollama_install_targets_app_local_location() {
        let args = managed_ollama_winget_args(&InstallOptions::default());

        assert!(args.contains(&"--location".to_string()));
        assert!(args
            .iter()
            .any(|arg| arg.ends_with(r"installer\apps\ollama\app")));
    }

    #[test]
    fn parses_cli_percent_progress() {
        let ratio = parse_cli_progress_ratio("Downloading package 42%").unwrap();

        assert!((ratio - 0.42).abs() < f32::EPSILON);
    }

    #[test]
    fn parses_cli_size_fraction_progress() {
        let ratio = parse_cli_progress_ratio("Downloading 2.50 MB / 10.00 MB").unwrap();

        assert!((ratio - 0.25).abs() < f32::EPSILON);
    }

    #[test]
    fn forward_stream_splits_carriage_return_progress_frames() {
        let (tx, rx) = mpsc::channel();
        let handle = forward_stream(
            Some(Cursor::new(
                b"Downloading 25%\rDownloading 50%\rDone\n".to_vec(),
            )),
            tx,
            true,
        )
        .unwrap();

        handle.join().unwrap();
        let lines: Vec<StreamLine> = rx.try_iter().collect();

        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].line, "Downloading 25%");
        assert!(lines[0].is_transient);
        assert_eq!(lines[1].line, "Downloading 50%");
        assert!(lines[1].is_transient);
        assert_eq!(lines[2].line, "Done");
        assert!(!lines[2].is_transient);
    }

    #[test]
    fn transient_progress_frames_emit_ratio_without_log_spam() {
        let events = Arc::new(Mutex::new(Vec::<ProgressEvent>::new()));
        let captured = events.clone();
        let sink: EventSink = Box::new(move |event| {
            captured.lock().unwrap().push(event);
        });

        emit_stream_line(
            "ollama",
            &sink,
            StreamLine {
                is_stdout: true,
                line: "Downloading 2 MB / 4 MB".into(),
                is_transient: true,
            },
        );

        let events = events.lock().unwrap();
        assert_eq!(events.len(), 1);
        match &events[0] {
            ProgressEvent::Progress { tool_id, ratio, .. } => {
                assert_eq!(tool_id, "ollama");
                assert!((*ratio - 0.5).abs() < f32::EPSILON);
            }
            other => panic!("expected progress event, got {other:?}"),
        }
    }

    #[test]
    fn wsl_base_install_uses_modern_no_distribution_command() {
        assert_eq!(
            wsl_base_install_args(),
            vec!["--install", "--no-distribution"]
        );
    }

    #[test]
    fn wsl_distro_install_uses_no_launch_distribution_command() {
        assert_eq!(
            wsl_distro_install_args("Ubuntu"),
            vec!["--install", "--distribution", "Ubuntu", "--no-launch"]
        );
    }
}
