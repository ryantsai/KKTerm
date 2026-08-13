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

use std::collections::{BTreeMap, VecDeque};
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, mpsc};
use std::thread::JoinHandle;
use std::time::{Instant, SystemTime};

use serde_json::json;

/// How often to emit a "still running" heartbeat to the frontend while a
/// child process is alive but silent. Set conservatively — winget can be
/// genuinely quiet for 30–90s during MSIX staging.
const HEARTBEAT_INTERVAL_SECS: u64 = 10;
const RECENT_PROCESS_OUTPUT_LINES: usize = 40;
const FAILURE_OUTPUT_DETAIL_MAX_CHARS: usize = 500;
const WINGET_NO_APPLICABLE_UPGRADE_EXIT_CODE: i32 = 0x8A15_002B_u32 as i32;
const WINGET_NO_INSTALLED_PACKAGE_EXIT_CODE: i32 = 0x8A15_0014_u32 as i32;

use super::detect::{
    GithubReleaseMarker, InstallScope, detect_chocolatey_package, detect_one, detect_winget,
    github_release_install_dir, github_release_marker_path, standalone_uv_executable,
};
use super::events::ProgressEvent;
use super::managed_app::{
    ManagedAppMarker, managed_app_binary_dir, managed_app_data_dir, managed_app_install_dir,
    managed_app_marker_path,
};
use super::options::InstallOptions;
use super::proc::{decode_console_output, no_window, npm_program};
use super::schema::{GithubReleaseLayout, PlanStep, Provider, Recipe, RecipeOption};

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
    let use_selected_provider_directly = matches!(
        selected_install_provider(recipe, &effective_install_options(recipe, options)),
        Provider::Chocolatey { .. }
    );
    let result = if recipe.id == "uv" {
        let detected = detect_one(recipe);
        if detected.is_official_script_install() {
            // The catalog provider is WinGet, but the receipt-backed binary
            // belongs to Astral. Dispatch through that exact executable so UI,
            // Update all, and direct command callers cannot update a different
            // `uv` that happens to appear earlier on PATH.
            update_astral_standalone_uv(&detected, cancel, emit)
        } else {
            install_recipe_by_provider(recipe, options, cancel, emit)
        }
    } else if use_selected_provider_directly {
        install_recipe_by_provider(recipe, options, cancel, emit)
    } else if recipe.id == "n8n" || recipe.id == "flowise" || recipe.id == "openclaw" {
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
    } else if recipe.id == "bentopdf" {
        if let Provider::Npm { pkg } = &recipe.provider {
            install_managed_bentopdf(&recipe.id, pkg, cancel, emit)
        } else {
            install_recipe_by_provider(recipe, options, cancel, emit)
        }
    } else if recipe.id == "openflowkit" {
        if let Provider::Npm { pkg } = &recipe.provider {
            install_managed_openflowkit(&recipe.id, pkg, cancel, emit)
        } else {
            install_recipe_by_provider(recipe, options, cancel, emit)
        }
    } else if recipe.id == "open-webui" || recipe.id == "langflow" {
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

fn update_astral_standalone_uv(
    detected: &super::detect::DetectedState,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    ensure_uv_is_not_running()?;
    let executable = astral_standalone_uv_executable(detected)?;
    emit(ProgressEvent::Step {
        tool_id: "uv".into(),
        message: "uv self update".into(),
    });
    run_streamed(
        &executable.to_string_lossy(),
        &["self".into(), "update".into()],
        "uv",
        cancel,
        emit,
    )?;
    // Detection reads the replaced binary immediately after the terminal
    // event, so returning None avoids trusting human-oriented command output
    // as the installed version.
    Ok(None)
}

fn astral_standalone_uv_executable(
    detected: &super::detect::DetectedState,
) -> Result<PathBuf, String> {
    astral_standalone_uv_executable_with_validator(detected, standalone_uv_executable)
}

fn astral_standalone_uv_executable_with_validator(
    detected: &super::detect::DetectedState,
    validate: impl FnOnce(&Path) -> Option<PathBuf>,
) -> Result<PathBuf, String> {
    if !detected.is_official_script_install() {
        return Err("uv is not installed through Astral's standalone installer".into());
    }
    let bin_dir = detected
        .install_location
        .as_deref()
        .map(PathBuf::from)
        .ok_or("Astral uv install location is unavailable; refresh detection and try again")?;
    // Revalidate executable and receipt at execution time. The detected state
    // may have come from the registry cache, and a stale path must never fall
    // back to a package-manager executable during an in-place self-update.
    validate(&bin_dir).ok_or_else(|| {
        "Astral uv executable or receipt is missing; refresh detection and try again".into()
    })
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
        Provider::Winget { id } => install_winget(recipe, id, &options, cancel, emit),
        Provider::Chocolatey { id } => install_chocolatey(&recipe.id, id, &options, cancel, emit),
        Provider::Npm { pkg } => install_npm(&recipe.id, pkg, &options, cancel, emit),
        Provider::UvPip { package } => install_uv_pip(&recipe.id, package, &options, cancel, emit),
        provider @ Provider::DownloadInstaller { .. } => {
            let (url, file_name) = provider
                .download_target(super::schema::prefer_native_arm64())
                .expect("DownloadInstaller provider resolves a download target");
            install_download_installer(&recipe.id, url, file_name, cancel, emit)
        }
        Provider::GithubRelease {
            repo,
            asset_pattern,
            layout,
            path_subdir,
        } => install_github_release(
            &recipe.id,
            repo,
            asset_pattern,
            *layout,
            path_subdir.as_deref(),
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
        match recipe.download_provider.as_ref() {
            Some(provider @ Provider::DownloadInstaller { .. })
            | Some(provider @ Provider::GithubRelease { .. }) => return provider,
            _ => {}
        }
    }
    if options.provider.as_deref() == Some("chocolatey") {
        match recipe.chocolatey_provider.as_ref() {
            Some(provider @ Provider::Chocolatey { .. }) => return provider,
            _ => {}
        }
    }
    if options.provider.as_deref() == Some("npm") {
        match recipe.npm_provider.as_ref() {
            Some(provider @ Provider::Npm { .. }) => return provider,
            _ => {}
        }
    }
    if let Some(provider @ Provider::Chocolatey { id }) = recipe.chocolatey_provider.as_ref() {
        if detect_chocolatey_package(id).installed {
            return provider;
        }
    }
    if let Some(provider @ Provider::Npm { pkg }) = recipe.npm_provider.as_ref() {
        if super::detect::detect_npm(pkg).installed {
            return provider;
        }
    }
    if let Some(provider @ Provider::GithubRelease { .. }) = recipe.download_provider.as_ref() {
        if github_release_marker_path(&recipe.id).exists() {
            return provider;
        }
    }
    if let Some(provider @ Provider::DownloadInstaller { .. }) = recipe.download_provider.as_ref() {
        if super::detect::detect_official_cli_installer(&recipe.id).is_some() {
            return provider;
        }
    }
    &recipe.provider
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

fn install_managed_npm_app(
    tool_id: &str,
    pkg: &str,
    options: &InstallOptions,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    emit(ProgressEvent::Plan {
        tool_id: tool_id.into(),
        steps: vec![
            PlanStep {
                id: "resolve-dependency-plan".into(),
                label_key: "installer.steps.resolveDependencyPlan".into(),
            },
            PlanStep {
                id: "ensure-node-lts".into(),
                label_key: "installer.steps.ensureNodeLts".into(),
            },
            PlanStep {
                id: "install-managed-npm-app".into(),
                label_key: "installer.steps.installNamed".into(),
            },
        ],
    });

    let install_dir = managed_app_install_dir(tool_id);
    let data_dir = managed_app_data_dir(tool_id);
    run_install_step(tool_id, "resolve-dependency-plan", emit, || {
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
        Ok(())
    })?;

    run_install_step(tool_id, "ensure-node-lts", emit, || {
        ensure_node_lts_for_managed_npm(tool_id, cancel.clone(), emit)
    })?;

    let args = managed_npm_install_args(tool_id, &[managed_npm_spec(pkg, options)]);
    run_install_step(tool_id, "install-managed-npm-app", emit, || {
        emit(ProgressEvent::Step {
            tool_id: tool_id.into(),
            message: format!("npm install --prefix {}", install_dir.display()),
        });
        run_streamed_with_refreshed_path_public(npm_program(), &args, tool_id, cancel, emit)?;
        let version = detect_managed_npm_version(pkg, &install_dir);
        write_managed_app_marker(tool_id, version.clone())?;
        Ok(version)
    })
}

fn run_install_step<T>(
    tool_id: &str,
    step_id: &str,
    emit: &EventSink,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    emit(ProgressEvent::StepStarted {
        tool_id: tool_id.into(),
        step_id: step_id.into(),
    });
    match action() {
        Ok(value) => {
            emit(ProgressEvent::StepFinished {
                tool_id: tool_id.into(),
                step_id: step_id.into(),
                ok: true,
                error: None,
            });
            Ok(value)
        }
        Err(error) => {
            emit(ProgressEvent::StepFinished {
                tool_id: tool_id.into(),
                step_id: step_id.into(),
                ok: false,
                error: Some(error.clone()),
            });
            Err(error)
        }
    }
}

fn ensure_node_lts_for_managed_npm(
    tool_id: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        for args in [["install", "lts"], ["use", "lts"]] {
            run_streamed_with_refreshed_path_public(
                "nvm",
                &args.into_iter().map(str::to_string).collect::<Vec<_>>(),
                tool_id,
                cancel.clone(),
                emit,
            )?;
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        run_streamed_with_refreshed_path_public(
            "node",
            &["--version".into()],
            tool_id,
            cancel,
            emit,
        )
    }
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

fn install_managed_bentopdf(
    tool_id: &str,
    pkg: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    install_managed_source_web_app(
        tool_id,
        pkg,
        "alam00000/bentopdf",
        "bentopdf-main.zip",
        &["run", "build:docker"],
        3022,
        "BentoPDF",
        cancel,
        emit,
    )
}

fn install_managed_openflowkit(
    tool_id: &str,
    pkg: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    install_managed_source_web_app(
        tool_id,
        pkg,
        "Vrun-design/openflowkit",
        "openflowkit-main.zip",
        &["run", "build"],
        3023,
        "OpenFlowKit",
        cancel,
        emit,
    )
}

fn install_managed_source_web_app(
    tool_id: &str,
    pkg: &str,
    default_repo: &str,
    archive_file_name: &str,
    build_args: &[&str],
    preferred_port: u16,
    display_name: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    let install_dir = managed_app_install_dir(tool_id);
    let source_dir = install_dir.join("source");
    let download_path = std::env::temp_dir()
        .join("kkterm-installer-downloads")
        .join(archive_file_name);
    std::fs::create_dir_all(download_path.parent().ok_or("invalid temp path")?)
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&install_dir).map_err(|error| error.to_string())?;
    if source_dir.exists() {
        std::fs::remove_dir_all(&source_dir).map_err(|error| error.to_string())?;
    }
    std::fs::create_dir_all(&source_dir).map_err(|error| error.to_string())?;

    let repo = pkg.strip_prefix("github:").unwrap_or(default_repo);
    let archive_url = format!("https://github.com/{repo}/archive/refs/heads/main.zip");
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("Downloading {archive_url}"),
    });
    let client = crate::net::proxy::apply_blocking(reqwest::blocking::Client::builder())
        .user_agent("KKTerm Install Helper")
        .build()
        .map_err(|error| error.to_string())?;
    download_with_progress(
        &client,
        &archive_url,
        &download_path,
        tool_id,
        &cancel,
        emit,
    )?;
    extract_zip(&download_path, &source_dir)?;
    std::fs::remove_file(&download_path).ok();

    let project_dir = single_child_dir(&source_dir).unwrap_or(source_dir.clone());
    write_static_web_app_server_file(&install_dir, &project_dir, preferred_port, display_name)?;

    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("npm install --prefix {}", project_dir.display()),
    });
    run_streamed_with_refreshed_path_public(
        npm_program(),
        &[
            "install".into(),
            "--prefix".into(),
            project_dir.to_string_lossy().into_owned(),
        ],
        tool_id,
        cancel.clone(),
        emit,
    )?;

    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!(
            "npm {} --prefix {}",
            build_args.join(" "),
            project_dir.display()
        ),
    });
    let mut args = build_args
        .iter()
        .map(|arg| (*arg).into())
        .collect::<Vec<_>>();
    args.push("--prefix".into());
    args.push(project_dir.to_string_lossy().into_owned());
    run_streamed_with_refreshed_path_public(npm_program(), &args, tool_id, cancel, emit)?;

    let version = read_package_json_version(&project_dir.join("package.json"));
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

fn write_static_web_app_server_file(
    install_dir: &Path,
    project_dir: &Path,
    preferred_port: u16,
    display_name: &str,
) -> Result<(), String> {
    let dist_dir = project_dir
        .join("dist")
        .to_string_lossy()
        .replace('\\', "\\\\");
    let port_file = install_dir
        .join(".kkterm-web-ui-port")
        .to_string_lossy()
        .replace('\\', "\\\\");
    std::fs::write(
        install_dir.join("kkterm-web-ui-server.mjs"),
        format!(
            r#"import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const preferredPortIndex = args.indexOf("--preferred-port");
const preferredPort = preferredPortIndex >= 0 ? Number(args[preferredPortIndex + 1]) : {preferred_port};
const distDir = "{dist_dir}";
const portFile = "{port_file}";

function contentType(filePath) {{
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".wasm") return "application/wasm";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}}

const server = http.createServer((request, response) => {{
  const parsed = new URL(request.url ?? "/", "http://localhost");
  const decodedPath = decodeURIComponent(parsed.pathname);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const candidate = path.normalize(path.join(distDir, relativePath));
  const safeRoot = path.resolve(distDir);
  const safeCandidate = path.resolve(candidate);
  const filePath = safeCandidate.startsWith(safeRoot) && fs.existsSync(safeCandidate)
    ? safeCandidate
    : path.join(distDir, "index.html");
  fs.readFile(filePath, (error, data) => {{
    if (error) {{
      response.writeHead(404);
      response.end("Not found");
      return;
    }}
    response.writeHead(200, {{ "Content-Type": contentType(filePath) }});
    response.end(data);
  }});
}});

function listen(port) {{
  server.listen(port, "127.0.0.1", () => {{
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    fs.writeFileSync(portFile, String(actualPort));
    console.log(`{display_name} is available at http://localhost:${{actualPort}}`);
  }});
}}

server.on("error", (error) => {{
  if (error.code === "EADDRINUSE" && server.__triedPreferred !== true) {{
    server.__triedPreferred = true;
    listen(0);
    return;
  }}
  throw error;
}});

listen(Number.isFinite(preferredPort) ? preferredPort : {preferred_port});
"#
        ),
    )
    .map_err(|error| error.to_string())
}

fn single_child_dir(parent: &Path) -> Option<PathBuf> {
    let mut dirs = std::fs::read_dir(parent)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.is_dir() { Some(path) } else { None }
        })
        .collect::<Vec<_>>();
    if dirs.len() == 1 { dirs.pop() } else { None }
}

fn read_package_json_version(path: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    let json = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    json.get("version")
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
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
    let client = crate::net::proxy::apply_blocking(reqwest::blocking::Client::builder())
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
    let script = downloaded_installer_powershell_script(download_path, tool_id);
    let mut args = vec![
        "-NoProfile".into(),
        "-ExecutionPolicy".into(),
        "Bypass".into(),
        "-Command".into(),
    ];
    if tool_id == "chocolatey" {
        // Chocolatey's official bootstrap must run from an administrative
        // PowerShell process because it installs machine-wide under
        // C:\ProgramData\Chocolatey. The elevated runner writes a batch
        // wrapper, so keep the complete PowerShell command in one quoted arg.
        args.push(format!("\"{script}\""));
        run_streamed_elevated("powershell", &args, tool_id, cancel, emit)
    } else {
        args.push(script);
        run_streamed_public("powershell", &args, tool_id, cancel, emit)
    }
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

    if download_path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("ps1"))
    {
        let tls_setup = if tool_id == "chocolatey" {
            "[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; "
        } else {
            ""
        };
        return format!(
            "$ErrorActionPreference = 'Stop'; {tls_setup}& {}; if ($LASTEXITCODE) {{ exit $LASTEXITCODE }}; exit 0",
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
    const SCRIPT_TEMPLATE: &str = r#"
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Join-Path ([System.IO.Path]::GetTempPath()) 'kkterm-winget-dependencies'
New-Item -ItemType Directory -Force -Path $root | Out-Null
$arch = if ([Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString() -eq 'Arm64') { 'arm64' } else { 'x64' }
$vclibsUrl = if ($arch -eq 'arm64') { 'https://aka.ms/Microsoft.VCLibs.arm64.14.00.Desktop.appx' } else { 'https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx' }
$vclibsPath = Join-Path $root ("Microsoft.VCLibs.{0}.14.00.Desktop.appx" -f $arch)
Write-Host ("Installing WinGet dependency: Microsoft.VCLibs ({0})" -f $arch)
Invoke-WebRequest -Uri $vclibsUrl -OutFile $vclibsPath -UseBasicParsing
Add-AppxPackage -Path $vclibsPath
$nugetUrl = 'https://www.nuget.org/api/v2/package/Microsoft.UI.Xaml/2.8.6'
$nupkgPath = Join-Path $root 'Microsoft.UI.Xaml.2.8.6.nupkg'
$zipPath = Join-Path $root 'Microsoft.UI.Xaml.2.8.6.zip'
$xamlRoot = Join-Path $root 'Microsoft.UI.Xaml.2.8.6'
Write-Host 'Installing WinGet dependency: Microsoft.UI.Xaml 2.8'
Invoke-WebRequest -Uri $nugetUrl -OutFile $nupkgPath -UseBasicParsing
Copy-Item -Path $nupkgPath -Destination $zipPath -Force
Remove-Item -Path $xamlRoot -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -Path $zipPath -DestinationPath $xamlRoot -Force
$xamlPath = Join-Path $xamlRoot ("tools\AppX\{0}\Release\Microsoft.UI.Xaml.2.8.appx" -f $arch)
if (!(Test-Path $xamlPath)) { throw "Microsoft.UI.Xaml 2.8 package did not contain $xamlPath" }
Add-AppxPackage -Path $xamlPath
$family = 'Microsoft.DesktopAppInstaller_8wekyb3d8bbwe'
try { Add-AppxPackage -RegisterByFamilyName -MainPackage $family -ErrorAction Stop } catch { }
Write-Host 'Installing Microsoft Desktop App Installer / WinGet'
Add-AppxPackage -Path __PACKAGE_PATH__
try { Add-AppxPackage -RegisterByFamilyName -MainPackage $family -ErrorAction Stop } catch { }
exit 0
"#;
    SCRIPT_TEMPLATE.replace("__PACKAGE_PATH__", &package_path)
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

pub(super) fn powershell_single_quote(value: &str) -> String {
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
        "--verbose-logs".into(),
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
    if matches!(recipe.provider, Provider::Winget { .. }) {
        if recipe.options.contains(&RecipeOption::Scope) {
            if next.scope.as_deref().unwrap_or_default().trim().is_empty() {
                next.scope = default_winget_scope_for_recipe(recipe);
            }
        } else {
            next.scope = None;
        }
    }
    next
}

fn default_winget_scope_for_recipe(recipe: &Recipe) -> Option<String> {
    Some(winget_scope_option_for_detected_scope(
        detect_one(recipe).install_scope,
    ))
}

fn winget_scope_option_for_detected_scope(scope: Option<InstallScope>) -> String {
    match scope {
        Some(InstallScope::User) => "user".into(),
        Some(InstallScope::Machine) => "machine".into(),
        None => "user".into(),
    }
}

// ---- winget ------------------------------------------------------------

fn install_winget(
    recipe: &Recipe,
    winget_id: &str,
    options: &InstallOptions,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    let tool_id = &recipe.id;
    if tool_id == "uv" {
        ensure_uv_is_not_running()?;
    }
    let already_installed = detect_winget(recipe).installed;
    let verb = if already_installed {
        "upgrade"
    } else {
        "install"
    };
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("winget {verb} --id {winget_id}"),
    });
    let args = winget_command_args(verb, winget_id, options);
    let run_elevated = winget_should_run_elevated(winget_id, options);
    let result = run_winget_command(&args, run_elevated, tool_id, cancel.clone(), emit);
    if already_installed && is_winget_no_installed_package_error(result.as_ref().err()) {
        emit(ProgressEvent::Step {
            tool_id: tool_id.into(),
            message: format!(
                "winget upgrade could not match the installed package; retrying winget install --id {winget_id}"
            ),
        });
        let install_args = winget_command_args("install", winget_id, options);
        run_winget_command(&install_args, run_elevated, tool_id, cancel, emit)?;
    } else {
        result?;
    }
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

fn run_winget_command(
    args: &[String],
    run_elevated: bool,
    tool_id: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    if run_elevated {
        run_streamed_elevated("winget", args, tool_id, cancel, emit)
    } else {
        run_streamed("winget", args, tool_id, cancel, emit)
    }
}

fn is_winget_no_installed_package_error(error: Option<&String>) -> bool {
    error.is_some_and(|error| {
        error.contains(&WINGET_NO_INSTALLED_PACKAGE_EXIT_CODE.to_string())
            || error.contains("No installed package found matching input criteria")
    })
}

fn winget_should_run_elevated(winget_id: &str, options: &InstallOptions) -> bool {
    options.scope.as_deref() == Some("machine")
        || is_known_machine_only_winget_id(winget_id)
        || is_known_self_elevating_winget_id(winget_id)
}

fn is_known_machine_only_winget_id(winget_id: &str) -> bool {
    let id = winget_id.to_ascii_lowercase();
    [
        "7zip.7zip",
        "blenderfoundation.blender",
        "bruno.bruno",
        "chocolatey.chocolatey",
        "ditto.ditto",
        "docker.dockerdesktop",
        "github.cli",
        "jgraph.draw",
        "kde.krita",
        "microsoft.coreutils",
        "microsoft.powershell",
        "notepad++.notepad++",
        "tailscale.tailscale",
        "voidtools.everything",
        "inkscape.inkscape",
        "marha.vcxsrv",
    ]
    .iter()
    .any(|needle| id.contains(needle))
}

fn is_known_self_elevating_winget_id(winget_id: &str) -> bool {
    let id = winget_id.to_ascii_lowercase();
    [
        "coreybutler.nvmforwindows",
        "docker.dockerdesktop",
        "git.git",
        "microsoft.coreutils",
        "oracle.virtualbox",
        "vmware.workstationpro",
    ]
    .iter()
    .any(|needle| id.contains(needle))
}

#[cfg(test)]
fn winget_install_args(winget_id: &str, options: &InstallOptions) -> Vec<String> {
    winget_command_args("install", winget_id, options)
}

fn winget_command_args(verb: &str, winget_id: &str, options: &InstallOptions) -> Vec<String> {
    let mut args: Vec<String> = vec![
        verb.into(),
        "--id".into(),
        winget_id.into(),
        "--exact".into(),
        "--silent".into(),
        "--accept-package-agreements".into(),
        "--accept-source-agreements".into(),
        "--disable-interactivity".into(),
        // Verbose logging makes winget write a detailed diagnostic log; we
        // surface its directory on failure so an obscure exit code can be
        // traced to a concrete cause.
        "--verbose-logs".into(),
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
    args
}

fn ensure_uv_is_not_running() -> Result<(), String> {
    let running = running_process_ids_by_image("uv.exe");
    if running.is_empty() {
        return Ok(());
    }
    Err(format!(
        "uv is currently running (PID {}). Close uv-based tools and try the update again.",
        running.join(", ")
    ))
}

#[cfg(target_os = "windows")]
fn running_process_ids_by_image(image_name: &str) -> Vec<String> {
    let filter = format!("IMAGENAME eq {image_name}");
    let output =
        no_window(Command::new("tasklist").args(["/FI", &filter, "/FO", "CSV", "/NH"])).output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_tasklist_csv_process_ids(&stdout, image_name)
}

#[cfg(not(target_os = "windows"))]
fn running_process_ids_by_image(_image_name: &str) -> Vec<String> {
    Vec::new()
}

fn parse_tasklist_csv_process_ids(output: &str, image_name: &str) -> Vec<String> {
    let mut ids = Vec::new();
    for line in output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if line.starts_with("INFO:") {
            continue;
        }
        let fields = parse_simple_csv_line(line);
        if fields.len() < 2 {
            continue;
        }
        if fields[0].eq_ignore_ascii_case(image_name) {
            ids.push(fields[1].clone());
        }
    }
    ids
}

fn parse_simple_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut chars = line.chars().peekable();
    let mut in_quotes = false;
    while let Some(ch) = chars.next() {
        match ch {
            '"' if in_quotes && chars.peek() == Some(&'"') => {
                current.push('"');
                let _ = chars.next();
            }
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                fields.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    fields.push(current.trim().to_string());
    fields
}

fn winget_tool_should_add_links_to_path(tool_id: &str) -> bool {
    matches!(
        tool_id,
        "claude-code-cli" | "nssm" | "ripgrep" | "jq" | "fzf" | "uv" | "ffmpeg" | "scrcpy"
    )
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

// ---- Chocolatey ---------------------------------------------------------

fn install_chocolatey(
    tool_id: &str,
    package_id: &str,
    options: &InstallOptions,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    let already_installed = detect_chocolatey_package(package_id).installed;
    let verb = if already_installed {
        "upgrade"
    } else {
        "install"
    };
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("choco {verb} {package_id}"),
    });
    let args = chocolatey_install_args(package_id, options, verb);
    // Chocolatey writes to C:\ProgramData\chocolatey and always requires
    // Administrator. Run elevated so a UAC prompt is raised explicitly rather
    // than letting the op silently fail under a non-elevated KKTerm.
    run_streamed_elevated("choco", &args, tool_id, cancel, emit)?;
    Ok(None)
}

fn chocolatey_install_args(package_id: &str, options: &InstallOptions, verb: &str) -> Vec<String> {
    let mut args: Vec<String> = vec![
        verb.into(),
        package_id.into(),
        "-y".into(),
        "--no-progress".into(),
        "--limit-output".into(),
    ];
    if let Some(version) = options.version.as_deref() {
        if !version.is_empty() {
            args.push("--version".into());
            args.push(version.into());
        }
    }
    args
}

/// Directory where winget writes its per-run diagnostic logs. Surfaced on a
/// non-zero exit so the user can open the detailed `--verbose-logs` output
/// when the decoded exit code is too generic to explain the failure.
fn winget_log_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(winget_log_dir_from_local_app_data)
}

fn winget_log_dir_from_local_app_data(local_app_data: PathBuf) -> PathBuf {
    local_app_data
        .join("Packages")
        .join("Microsoft.DesktopAppInstaller_8wekyb3d8bbwe")
        .join("LocalState")
        .join("DiagOutputDir")
}

/// Build the human-readable suffix appended to a non-zero exit message.
/// Only winget exit codes are decoded — its failures are reported as raw
/// `HRESULT` values (e.g. `-1978335150`) that mean nothing without the hex
/// form and the documented `APPINSTALLER_CLI_ERROR_*` description.
fn exit_status_detail(program: &str, code: i32) -> String {
    if !program.eq_ignore_ascii_case("winget") {
        return String::new();
    }
    let hex = format!("0x{:08X}", code as u32);
    match winget_error_text(code as u32) {
        Some(text) => format!(" ({hex}: {text})"),
        None => format!(" ({hex})"),
    }
}

/// Documented winget (`AppInstaller`) return codes mapped to their official
/// descriptions. Source: microsoft/winget-cli `doc/.../winget/returnCodes.md`.
/// Keyed by the unsigned `HRESULT` so a caller can pass `code as u32`.
fn winget_error_text(code: u32) -> Option<&'static str> {
    let text = match code {
        0x8A150001 => "Internal error",
        0x8A150002 => "Invalid command line arguments",
        0x8A150003 => "Executing command failed",
        0x8A150004 => "Opening manifest failed",
        0x8A150005 => "Cancellation signal received",
        0x8A150006 => "Running ShellExecute failed",
        0x8A150007 => {
            "Cannot process manifest. The manifest version is higher than supported. Please update the client."
        }
        0x8A150008 => "Downloading installer failed",
        0x8A150009 => "Cannot write to index; it is a higher schema version",
        0x8A15000A => "The index is corrupt",
        0x8A15000B => "The configured source information is corrupt",
        0x8A15000C => "The source name is already configured",
        0x8A15000D => "The source type is invalid",
        0x8A15000E => "The MSIX file is a bundle, not a package",
        0x8A15000F => "Data required by the source is missing",
        0x8A150010 => "None of the installers are applicable for the current system",
        0x8A150011 => "The installer file's hash does not match the manifest",
        0x8A150012 => "The source name does not exist",
        0x8A150013 => "The source location is already configured under another name",
        0x8A150014 => "No packages found",
        0x8A150015 => "No sources are configured",
        0x8A150016 => "Multiple packages found matching the criteria",
        0x8A150017 => "No manifest found matching the criteria",
        0x8A150018 => "Failed to get Public folder from source package",
        0x8A150019 => "Command requires administrator privileges to run",
        0x8A15001A => "The source location is not secure",
        0x8A15001B => "The Microsoft Store client is blocked by policy",
        0x8A15001C => "The Microsoft Store app is blocked by policy",
        0x8A15001D => {
            "The feature is currently under development. It can be enabled using winget settings."
        }
        0x8A15001E => "Failed to install the Microsoft Store app",
        0x8A15001F => "Failed to perform auto complete",
        0x8A150020 => "Failed to initialize YAML parser",
        0x8A150021 => "Encountered an invalid YAML key",
        0x8A150022 => "Encountered a duplicate YAML key",
        0x8A150023 => "Invalid YAML operation",
        0x8A150024 => "Failed to build YAML doc",
        0x8A150025 => "Invalid YAML emitter state",
        0x8A150026 => "Invalid YAML data",
        0x8A150027 => "LibYAML error",
        0x8A150028 => "Manifest validation succeeded with warning",
        0x8A150029 => "Manifest validation failed",
        0x8A15002A => "Manifest is invalid",
        0x8A15002B => "No applicable update found",
        0x8A15002C => "winget upgrade --all completed with failures",
        0x8A15002D => "Installer failed security check",
        0x8A15002E => "Download size does not match expected content length",
        0x8A15002F => "Uninstall command not found",
        0x8A150030 => "Running uninstall command failed",
        0x8A150031 => "ICU break iterator error",
        0x8A150032 => "ICU casemap error",
        0x8A150033 => "ICU regex error",
        0x8A150034 => "Failed to install one or more imported packages",
        0x8A150035 => "Could not find one or more requested packages",
        0x8A150036 => "Json file is invalid",
        0x8A150037 => "The source location is not remote",
        0x8A150038 => "The configured rest source is not supported",
        0x8A150039 => "Invalid data returned by rest source",
        0x8A15003A => "Operation is blocked by Group Policy",
        0x8A15003B => "Rest API internal error",
        0x8A15003C => "Invalid rest source url",
        0x8A15003D => "Unsupported MIME type returned by rest API",
        0x8A15003E => "Invalid rest source contract version",
        0x8A15003F => "The source data is corrupted or tampered",
        0x8A150040 => "Error reading from the stream",
        0x8A150041 => "Package agreements were not agreed to",
        0x8A150042 => "Error reading input in prompt",
        0x8A150043 => "The search request is not supported by one or more sources",
        0x8A150044 => "The rest API endpoint is not found",
        0x8A150045 => "Failed to open the source",
        0x8A150046 => "Source agreements were not agreed to",
        0x8A150047 => {
            "Header size exceeds the allowable limit of 1024 characters. Please reduce the size and try again."
        }
        0x8A150048 => "Missing resource file",
        0x8A150049 => "Running MSI install failed",
        0x8A15004A => "Arguments for msiexec are invalid",
        0x8A15004B => "Failed to open one or more sources",
        0x8A15004C => "Failed to validate dependencies",
        0x8A15004D => "One or more package is missing",
        0x8A15004E => "Invalid table column",
        0x8A15004F => "The upgrade version is not newer than the installed version",
        0x8A150050 => "Upgrade version is unknown and override is not specified",
        0x8A150051 => "ICU conversion error",
        0x8A150052 => "Failed to install portable package",
        0x8A150053 => "Volume does not support reparse points",
        0x8A150054 => "Portable package from a different source already exists",
        0x8A150055 => "Unable to create symlink, path points to a directory",
        0x8A150056 => "The installer cannot be run from an administrator context",
        0x8A150057 => "Failed to uninstall portable package",
        0x8A150058 => "Failed to validate DisplayVersion values against index",
        0x8A150059 => "One or more arguments are not supported",
        0x8A15005A => "Embedded null characters are disallowed for SQLite",
        0x8A15005B => "Failed to find the nested installer in the archive",
        0x8A15005C => "Failed to extract archive",
        0x8A15005D => "Invalid relative file path to nested installer provided",
        0x8A15005E => "The server certificate did not match any of the expected values",
        0x8A15005F => "Install location must be provided",
        0x8A150060 => "Archive malware scan failed",
        0x8A150061 => "Found at least one version of the package installed",
        0x8A150062 => "A pin already exists for the package",
        0x8A150063 => "There is no pin for the package",
        0x8A150064 => "Unable to open the pin database",
        0x8A150065 => "One or more applications failed to install",
        0x8A150066 => "One or more applications failed to uninstall",
        0x8A150067 => "One or more queries did not return exactly one match",
        0x8A150068 => "The package has a pin that prevents upgrade",
        0x8A150069 => "The package currently installed is the stub package",
        0x8A15006A => "Application shutdown signal received",
        0x8A15006B => "Failed to download package dependencies",
        0x8A15006C => {
            "Failed to download package. Download for offline installation is prohibited."
        }
        0x8A15006D => "A required service is busy or unavailable. Try again later.",
        0x8A15006E => "The guid provided does not correspond to a valid resume state",
        0x8A15006F => {
            "The current client version did not match the client version of the saved state"
        }
        0x8A150070 => "The resume state data is invalid",
        0x8A150071 => "Unable to open the checkpoint database",
        0x8A150072 => "Exceeded max resume limit",
        0x8A150073 => "Invalid authentication info",
        0x8A150074 => "Authentication method not supported",
        0x8A150075 => "Authentication failed",
        0x8A150076 => "Authentication failed. Interactive authentication required.",
        0x8A150077 => "Authentication failed. User cancelled.",
        0x8A150078 => "Authentication failed. Authenticated account is not the desired account.",
        0x8A150079 => "Repair command not found",
        0x8A15007A => "Repair operation is not applicable",
        0x8A15007B => "Repair operation failed",
        0x8A15007C => "The installer technology in use doesn't support repair",
        0x8A15007D => {
            "Repair operations involving administrator privileges are not permitted on packages installed within the user scope"
        }
        0x8A15007E => "The SQLite connection was terminated to prevent corruption",
        0x8A15007F => "Failed to get Microsoft Store package catalog",
        0x8A150080 => {
            "No applicable Microsoft Store package found from Microsoft Store package catalog"
        }
        0x8A150081 => "Failed to get Microsoft Store package download information",
        0x8A150082 => "No applicable Microsoft Store package download information found",
        0x8A150083 => "Failed to retrieve Microsoft Store package license",
        0x8A150084 => "The Microsoft Store package does not support download",
        0x8A150085 => {
            "Failed to retrieve Microsoft Store package license. The Microsoft Entra Id account does not have the required privilege."
        }
        0x8A150086 => {
            "Downloaded zero byte installer; ensure that your network connection is working properly"
        }
        0x8A150087 => "Failed installing one or more fonts",
        0x8A150088 => "Font file is not supported and cannot be installed",
        0x8A150089 => "Font package is already installed",
        0x8A15008A => "Font file not found",
        0x8A15008B => {
            "Font uninstall failed. The font may not be in a good state. Try uninstalling after a restart."
        }
        0x8A15008C => "Font validation failed",
        0x8A15008D => {
            "Font rollback failed. The font may not be in a good state. Try uninstalling after a restart."
        }
        0x8A15008E => {
            "An upgrade is available but uses a different install technology than the current installation"
        }
        0x8A150101 => "Application is currently running. Exit the application then try again.",
        0x8A150102 => "Another installation is already in progress. Try again later.",
        0x8A150103 => "One or more file is being used. Exit the application then try again.",
        0x8A150104 => "This package has a dependency missing from your system",
        0x8A150105 => "There's no more space on your PC. Make space, then try again.",
        0x8A150106 => {
            "There's not enough memory available to install. Close other applications then try again."
        }
        0x8A150107 => {
            "This application requires internet connectivity. Connect to a network then try again."
        }
        0x8A150108 => "This application encountered an error during installation. Contact support.",
        0x8A150109 => "Restart your PC to finish installation",
        0x8A15010A => "Installation failed. Restart your PC then try again.",
        0x8A15010B => "Your PC will restart to finish installation",
        0x8A15010C => "You cancelled the installation",
        0x8A15010D => "Another version of this application is already installed",
        0x8A15010E => "A higher version of this application is already installed",
        0x8A15010F => "Organization policies are preventing installation. Contact your admin.",
        0x8A150110 => "Failed to install package dependencies",
        0x8A150111 => "Application is currently in use by another application",
        0x8A150112 => "Invalid parameter",
        0x8A150113 => "Package not supported by the system",
        0x8A150114 => "The installer does not support upgrading an existing package",
        0x8A150115 => "Installation failed with a custom installer error",
        _ => return None,
    };
    Some(text)
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
    path_subdir: Option<&str>,
    options: &InstallOptions,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: format!("Querying GitHub releases for {repo}"),
    });
    let api_url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let client = crate::net::proxy::apply_blocking(reqwest::blocking::Client::builder())
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
                let path_dir =
                    github_release_path_dir(&install_dir, path_subdir, tag_name.as_deref());
                add_to_user_path(&path_dir, tool_id, emit);
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

fn github_release_path_dir(
    install_dir: &PathBuf,
    path_subdir: Option<&str>,
    tag_name: Option<&str>,
) -> PathBuf {
    let Some(path_subdir) = path_subdir else {
        return install_dir.clone();
    };
    let resolved = match tag_name {
        Some(tag) => path_subdir.replace("{tag}", tag),
        None => path_subdir.replace("{tag}", ""),
    };
    if resolved.trim().is_empty() {
        install_dir.clone()
    } else {
        install_dir.join(resolved)
    }
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

pub fn refreshed_nvm_home_public() -> Option<String> {
    let environment = refreshed_environment();
    environment
        .vars
        .get("NVM_HOME")
        .cloned()
        .or_else(|| std::env::var("NVM_HOME").ok())
}

/// Run an admin-only command (Chocolatey) **elevated**, raising one UAC prompt
/// via `Start-Process -Verb RunAs`. An elevated child launched from this
/// non-elevated process cannot share stdout/stderr pipes across the UAC
/// boundary, so the elevated command redirects its output to a temp log that we
/// tail into the stepper. The app itself stays non-elevated.
pub fn run_streamed_elevated(
    program: &str,
    args: &[String],
    tool_id: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    run_streamed_elevated_impl(program, args, tool_id, cancel, emit)
}

/// Batch wrapper run by the elevated process. Because `Start-Process -Verb
/// RunAs` rejects `-RedirectStandardOutput`, the elevated command must
/// self-redirect; a `.cmd` file sidesteps PowerShell→ShellExecute quoting and
/// returns the wrapped program's exit code as its own errorlevel.
fn elevated_batch_contents(program: &str, args: &[String], log_path: &Path) -> String {
    format!(
        "@echo off\r\n\"{}\" {} > \"{}\" 2>&1\r\n",
        program,
        args.join(" "),
        log_path.display()
    )
}

/// Non-elevated launcher script: elevate the batch file, wait, and propagate
/// its exit code. A declined UAC prompt throws, which we map to `1223`
/// (`ERROR_CANCELLED`).
fn elevated_powershell_script(batch_path: &Path) -> String {
    format!(
        "$ErrorActionPreference='Stop'; try {{ $p = Start-Process -FilePath {} -Verb RunAs -PassThru -Wait -WindowStyle Hidden; exit $p.ExitCode }} catch {{ exit 1223 }}",
        powershell_single_quote(&batch_path.to_string_lossy())
    )
}

/// Read complete log lines appended since the last drain. Holds back a trailing
/// partial line until `finished` so a line being written isn't emitted twice.
fn drain_elevated_log(path: &Path, emitted: &mut usize, finished: bool) -> Vec<String> {
    let bytes = std::fs::read(path).unwrap_or_default();
    let content = decode_console_output(&bytes);
    let all: Vec<&str> = content.lines().collect();
    let mut end = all.len();
    if !finished && end > 0 && !content.ends_with('\n') {
        end -= 1;
    }
    if end <= *emitted {
        return Vec::new();
    }
    let out = all[*emitted..end]
        .iter()
        .map(|line| line.trim_end_matches('\r').to_string())
        .collect();
    *emitted = end;
    out
}

#[cfg(windows)]
fn run_streamed_elevated_impl(
    program: &str,
    args: &[String],
    tool_id: &str,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<(), String> {
    let started_at_log = Instant::now();
    emit(ProgressEvent::Stdout {
        tool_id: tool_id.into(),
        step_id: None,
        line: format!("$ {program} {} (elevated — UAC required)", args.join(" ")),
    });

    let dir = std::env::temp_dir().join("kkterm-installer-elevated");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create elevated temp dir: {e}"))?;
    let stamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let safe_tool: String = tool_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let log_path = dir.join(format!("{safe_tool}-{stamp}.log"));
    let batch_path = dir.join(format!("{safe_tool}-{stamp}.cmd"));

    std::fs::write(
        &batch_path,
        elevated_batch_contents(program, args, &log_path),
    )
    .map_err(|e| format!("failed to write elevated batch: {e}"))?;
    std::fs::write(&log_path, b"").ok();

    let script = elevated_powershell_script(&batch_path);
    let mut command = Command::new("powershell");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null());
    let mut child = no_window(&mut command).spawn().map_err(|e| {
        let _ = std::fs::remove_file(&batch_path);
        let _ = std::fs::remove_file(&log_path);
        format!("failed to spawn elevated launcher: {e}")
    })?;

    let mut emitted = 0usize;
    let mut recent_output = RecentProcessOutput::default();
    let started_at = Instant::now();
    let mut last_output_at = Instant::now();
    let mut next_heartbeat_at =
        started_at + std::time::Duration::from_secs(HEARTBEAT_INTERVAL_SECS);

    let result = loop {
        for line in drain_elevated_log(&log_path, &mut emitted, false) {
            recent_output.remember(&line);
            emit(ProgressEvent::Stdout {
                tool_id: tool_id.into(),
                step_id: None,
                line,
            });
            last_output_at = Instant::now();
        }
        if cancel.load(Ordering::Relaxed) {
            // The elevated child runs in a separate security context and cannot
            // be killed from here; we stop tailing and let it finish on its own.
            let _ = child.kill();
            let _ = child.wait();
            break Err("cancelled".to_string());
        }
        if Instant::now() >= next_heartbeat_at {
            let elapsed = started_at.elapsed().as_secs();
            let silent = last_output_at.elapsed().as_secs();
            emit(ProgressEvent::Stderr {
                tool_id: tool_id.into(),
                step_id: None,
                line: format!(
                    "[installer] still running (elevated): {elapsed}s elapsed, {silent}s since last output"
                ),
            });
            next_heartbeat_at =
                Instant::now() + std::time::Duration::from_secs(HEARTBEAT_INTERVAL_SECS);
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                for line in drain_elevated_log(&log_path, &mut emitted, true) {
                    recent_output.remember(&line);
                    emit(ProgressEvent::Stdout {
                        tool_id: tool_id.into(),
                        step_id: None,
                        line,
                    });
                }
                let code = status.code().unwrap_or(-1);
                let elapsed = started_at.elapsed().as_secs();
                if code == 0 {
                    emit(ProgressEvent::Stdout {
                        tool_id: tool_id.into(),
                        step_id: None,
                        line: format!("[installer] `{program}` exited 0 after {elapsed}s"),
                    });
                    break Ok(());
                }
                if is_nonfatal_winget_upgrade_exit(program, args, code) {
                    emit(ProgressEvent::Stdout {
                        tool_id: tool_id.into(),
                        step_id: None,
                        line: format!(
                            "[installer] `{program}` reported no applicable upgrade after {elapsed}s; no changes made"
                        ),
                    });
                    break Ok(());
                }
                let hint = if code == 1223 {
                    " (Administrator elevation was declined)"
                } else {
                    ""
                };
                emit(ProgressEvent::Stderr {
                    tool_id: tool_id.into(),
                    step_id: None,
                    line: format!("[installer] `{program}` exited {code}{hint} after {elapsed}s"),
                });
                break Err(process_failure_message(
                    "elevated ",
                    program,
                    code,
                    hint,
                    recent_output.lines(),
                ));
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(150)),
            Err(e) => break Err(format!("wait on elevated launcher failed: {e}")),
        }
    };

    let _ = std::fs::remove_file(&batch_path);
    let _ = std::fs::remove_file(&log_path);
    crate::logging::installer_helper_debug(
        "process.elevated.exit",
        &json!({
            "toolId": tool_id,
            "program": program,
            "elapsedMs": started_at_log.elapsed().as_millis(),
            "ok": result.is_ok(),
        }),
    );
    result
}

#[cfg(not(windows))]
fn run_streamed_elevated_impl(
    program: &str,
    _args: &[String],
    _tool_id: &str,
    _cancel: Arc<AtomicBool>,
    _emit: &EventSink,
) -> Result<(), String> {
    Err(format!(
        "elevated `{program}` execution is only supported on Windows"
    ))
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
    let mut recent_output = RecentProcessOutput::default();

    loop {
        let mut got_line = false;
        while let Ok(line) = rx.try_recv() {
            recent_output.remember(&line.line);
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
                recent_output.remember(&line.line);
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
                    recent_output.remember(&line.line);
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
                if is_nonfatal_winget_upgrade_exit(program, args, code) {
                    emit(ProgressEvent::Stdout {
                        tool_id: tool_id.into(),
                        step_id: None,
                        line: format!(
                            "[installer] `{program}` reported no applicable upgrade after {elapsed}s; no changes made"
                        ),
                    });
                    crate::logging::installer_helper_debug(
                        "process.exit.noop",
                        &json!({
                            "toolId": tool_id,
                            "program": program,
                            "elapsedMs": started_at_log.elapsed().as_millis(),
                            "code": code,
                        }),
                    );
                    return Ok(());
                }
                let detail = exit_status_detail(program, code);
                emit(ProgressEvent::Stderr {
                    tool_id: tool_id.into(),
                    step_id: None,
                    line: format!("[installer] `{program}` exited {code}{detail} after {elapsed}s"),
                });
                if program.eq_ignore_ascii_case("winget") {
                    if let Some(dir) = winget_log_dir() {
                        emit(ProgressEvent::Stderr {
                            tool_id: tool_id.into(),
                            step_id: None,
                            line: format!("[installer] winget diagnostic logs: {}", dir.display()),
                        });
                    }
                }
                crate::logging::installer_helper_debug(
                    "process.exit.error",
                    &json!({
                        "toolId": tool_id,
                        "program": program,
                        "elapsedMs": started_at_log.elapsed().as_millis(),
                        "code": code,
                        "detail": detail,
                        "failureOutput": failure_output_detail(recent_output.lines()),
                    }),
                );
                return Err(process_failure_message(
                    "",
                    program,
                    code,
                    &detail,
                    recent_output.lines(),
                ));
            }
            Ok(None) => match rx.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok(line) => {
                    recent_output.remember(&line.line);
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
    // Only add directories matching Astral's config receipt. Adding every
    // default candidate unconditionally could make an unrelated `uv.exe`
    // shadow the package-manager copy that KKTerm is supposed to manage.
    for dir in standalone_uv_bin_path_candidates(
        vars,
        std::env::var_os("UV_INSTALL_DIR").as_deref(),
        std::env::var_os("USERPROFILE").as_deref(),
        std::env::var_os("HOME").as_deref(),
    )
    .into_iter()
    .filter(|dir| is_astral_standalone_uv_bin_dir(dir))
    {
        extras.push(dir.to_string_lossy().to_string());
    }
    extras
}

fn standalone_uv_bin_path_candidates(
    vars: &BTreeMap<String, String>,
    current_uv_install_dir: Option<&std::ffi::OsStr>,
    user_profile: Option<&std::ffi::OsStr>,
    home: Option<&std::ffi::OsStr>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = current_uv_install_dir {
        candidates.push(PathBuf::from(dir));
    }
    if let Some(dir) = vars
        .get("UV_INSTALL_DIR")
        .filter(|dir| !dir.trim().is_empty())
    {
        let candidate = PathBuf::from(dir);
        if !candidates.iter().any(|path: &PathBuf| {
            path.to_string_lossy()
                .eq_ignore_ascii_case(&candidate.to_string_lossy())
        }) {
            candidates.push(candidate);
        }
    }
    for root in [user_profile, home].into_iter().flatten() {
        let root = PathBuf::from(root);
        for candidate in [
            root.join(".local").join("bin"),
            root.join(".cargo").join("bin"),
        ] {
            let candidate_text = candidate.to_string_lossy();
            if !candidates
                .iter()
                .any(|path: &PathBuf| path.to_string_lossy().eq_ignore_ascii_case(&candidate_text))
            {
                candidates.push(candidate);
            }
        }
    }
    candidates
}

fn is_astral_standalone_uv_bin_dir(dir: &std::path::Path) -> bool {
    standalone_uv_executable(dir).is_some()
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

#[derive(Default)]
struct RecentProcessOutput {
    lines: VecDeque<String>,
}

impl RecentProcessOutput {
    fn remember(&mut self, line: &str) {
        let line = line.trim();
        if line.is_empty() {
            return;
        }
        if self.lines.len() >= RECENT_PROCESS_OUTPUT_LINES {
            self.lines.pop_front();
        }
        self.lines.push_back(line.to_string());
    }

    fn lines(&mut self) -> &[String] {
        self.lines.make_contiguous()
    }
}

fn process_failure_message(
    prefix: &str,
    program: &str,
    code: i32,
    detail: &str,
    output_lines: &[String],
) -> String {
    let base = format!("{prefix}`{program}` exited with status {code}{detail}");
    match failure_output_detail(output_lines) {
        Some(output) => format!("{base}: {output}"),
        None => base,
    }
}

fn is_nonfatal_winget_upgrade_exit(program: &str, args: &[String], code: i32) -> bool {
    program.eq_ignore_ascii_case("winget")
        && args
            .first()
            .is_some_and(|verb| verb.eq_ignore_ascii_case("upgrade"))
        && code == WINGET_NO_APPLICABLE_UPGRADE_EXIT_CODE
}

fn failure_output_detail(output_lines: &[String]) -> Option<String> {
    let mut fallback = None;
    for raw_line in output_lines.iter().rev() {
        let Some(line) = clean_failure_output_line(raw_line) else {
            continue;
        };
        fallback.get_or_insert_with(|| line.clone());
        if is_salient_failure_line(&line) {
            return Some(line);
        }
    }
    fallback
}

fn clean_failure_output_line(line: &str) -> Option<String> {
    let line = line
        .trim()
        .trim_start_matches(|ch: char| ch == '-' || ch == '>' || ch.is_whitespace())
        .trim();
    let line = line.strip_prefix("[NuGet]:").unwrap_or(line).trim();
    if line.is_empty() || is_low_value_failure_line(line) {
        return None;
    }
    Some(truncate_failure_output_detail(line))
}

fn is_salient_failure_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.starts_with("unable ")
        || lower.contains(" unable ")
        || lower.starts_with("error")
        || lower.contains(" error")
        || lower.contains("failed")
        || lower.contains("failure")
        || lower.contains("cannot ")
        || lower.contains("can't ")
        || lower.contains("not found")
        || lower.contains("denied")
        || lower.contains("blocked")
        || lower.contains("depends on")
        || lower.contains("requires")
}

fn is_low_value_failure_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.starts_with("$ ")
        || lower.starts_with("[installer] still running")
        || lower.starts_with("[installer] `")
        || lower.starts_with("see the log for details")
        || lower == "failures"
        || lower.starts_with("if a package ")
        || lower.starts_with("software outside of chocolatey")
        || lower.starts_with("with `-n`")
        || lower.starts_with("adding `--skip")
        || lower.starts_with("remove system-installed")
        || lower.starts_with("and not things")
        || lower.starts_with("or packages")
        || lower.starts_with("you decide")
        || lower.starts_with("$env:chocolateyinstall")
        || lower.starts_with("be removed")
        || lower.starts_with("this option only as a last resort")
}

fn truncate_failure_output_detail(line: &str) -> String {
    if line.chars().count() <= FAILURE_OUTPUT_DETAIL_MAX_CHARS {
        return line.to_string();
    }
    let mut truncated: String = line
        .chars()
        .take(FAILURE_OUTPUT_DETAIL_MAX_CHARS.saturating_sub(3))
        .collect();
    truncated.push_str("...");
    truncated
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
    let line = decode_console_output(buf).trim().to_string();
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
    fn elevated_powershell_script_requests_runas_and_propagates_exit() {
        let script = elevated_powershell_script(Path::new(r"C:\tmp\choco.cmd"));
        assert!(script.contains("-Verb RunAs"), "must elevate: {script}");
        assert!(
            script.contains("exit $p.ExitCode"),
            "must propagate exit code: {script}"
        );
        assert!(
            script.contains(r"'C:\tmp\choco.cmd'"),
            "must launch the batch wrapper: {script}"
        );
        // A declined UAC prompt throws; we map it to ERROR_CANCELLED (1223).
        assert!(
            script.contains("exit 1223"),
            "must map declined UAC: {script}"
        );
    }

    #[test]
    fn elevated_batch_redirects_choco_output_to_log() {
        let batch = elevated_batch_contents(
            "choco",
            &["upgrade".into(), "chocolatey".into(), "-y".into()],
            Path::new(r"C:\tmp\out.log"),
        );
        assert!(
            batch.contains(r#""choco" upgrade chocolatey -y > "C:\tmp\out.log" 2>&1"#),
            "batch must run choco and redirect to the log: {batch}"
        );
    }

    #[test]
    fn drain_elevated_log_holds_back_partial_trailing_line() {
        let dir = std::env::temp_dir().join(format!("kkterm-drain-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("log.txt");

        std::fs::write(&path, b"line one\npartial").unwrap();
        let mut emitted = 0usize;
        // Mid-stream: "partial" (no trailing newline) is held back.
        assert_eq!(
            drain_elevated_log(&path, &mut emitted, false),
            vec!["line one"]
        );

        std::fs::write(&path, b"line one\npartial done\n").unwrap();
        assert_eq!(
            drain_elevated_log(&path, &mut emitted, false),
            vec!["partial done"]
        );
        // No new complete lines → nothing re-emitted.
        assert!(drain_elevated_log(&path, &mut emitted, true).is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn process_failure_message_includes_salient_child_output() {
        let output = vec![
            "Chocolatey uninstalled 0/1 packages. 1 packages failed.".to_string(),
            "If a package is failing because it is a dependency of another package".to_string(),
            " - fzf - Unable to uninstall 'fzf.0.74.0' because 'opencode.1.17.15' depends on it."
                .to_string(),
            " this option only as a last resort.".to_string(),
        ];

        assert_eq!(
            process_failure_message("elevated ", "choco", 1, "", &output),
            "elevated `choco` exited with status 1: fzf - Unable to uninstall 'fzf.0.74.0' because 'opencode.1.17.15' depends on it."
        );
    }

    #[test]
    fn winget_no_applicable_upgrade_is_a_nonfatal_noop() {
        let upgrade_args = vec![
            "upgrade".to_string(),
            "--id".to_string(),
            "Notepad++.Notepad++".to_string(),
        ];
        let install_args = vec![
            "install".to_string(),
            "--id".to_string(),
            "Notepad++.Notepad++".to_string(),
        ];

        assert!(is_nonfatal_winget_upgrade_exit(
            "winget",
            &upgrade_args,
            -1_978_335_189,
        ));
        assert!(!is_nonfatal_winget_upgrade_exit(
            "winget",
            &install_args,
            -1_978_335_189,
        ));
        assert!(!is_nonfatal_winget_upgrade_exit(
            "choco",
            &upgrade_args,
            -1_978_335_189,
        ));
        assert!(!is_nonfatal_winget_upgrade_exit("winget", &upgrade_args, 1));
    }

    #[test]
    fn winget_no_installed_package_error_is_retryable() {
        let numeric = format!(
            "elevated `winget` exited with status {}: No installed package found matching input criteria.",
            WINGET_NO_INSTALLED_PACKAGE_EXIT_CODE
        );
        assert!(is_winget_no_installed_package_error(Some(&numeric)));

        let localized_status_only = format!(
            "`winget` exited with status {}",
            WINGET_NO_INSTALLED_PACKAGE_EXIT_CODE
        );
        assert!(is_winget_no_installed_package_error(Some(
            &localized_status_only
        )));

        let unrelated = "`winget` exited with status 1".to_string();
        assert!(!is_winget_no_installed_package_error(Some(&unrelated)));
        assert!(!is_winget_no_installed_package_error(None));
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
            section: super::super::schema::RecipeSection::Internal,
            description_en: "Distributed version control.".into(),
            description_locales: Default::default(),
            needs: vec![],
            icon: None,
            category: None,
            provider: Provider::Winget {
                id: "Git.Git".into(),
            },
            download_provider: None,
            chocolatey_provider: None,
            npm_provider: None,
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
    fn powershell_installer_downloads_execute_in_process() {
        let script = downloaded_installer_powershell_script(
            &PathBuf::from(r"C:\Temp\install.ps1"),
            "kimi-code-cli",
        );

        assert!(script.contains("& 'C:\\Temp\\install.ps1'"));
        assert!(script.contains("$LASTEXITCODE"));
        assert!(!script.contains("Start-Process -FilePath"));
    }

    #[test]
    fn chocolatey_bootstrap_enables_tls_12_before_running_download() {
        let script = downloaded_installer_powershell_script(
            &PathBuf::from(r"C:\Temp\chocolatey-install.ps1"),
            "chocolatey",
        );

        assert!(script.contains("SecurityProtocol -bor 3072"));
        assert!(script.contains("& 'C:\\Temp\\chocolatey-install.ps1'"));
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
    fn machine_scope_winget_runs_elevated() {
        assert!(winget_should_run_elevated(
            "Example.Tool",
            &InstallOptions {
                scope: Some("machine".into()),
                ..InstallOptions::default()
            }
        ));
    }

    #[test]
    fn known_machine_only_winget_runs_elevated() {
        assert!(winget_should_run_elevated(
            "Docker.DockerDesktop",
            &InstallOptions {
                scope: Some("user".into()),
                ..InstallOptions::default()
            }
        ));
    }

    #[test]
    fn known_self_elevating_winget_runs_elevated() {
        assert!(winget_should_run_elevated(
            "CoreyButler.NVMforWindows",
            &InstallOptions {
                scope: Some("user".into()),
                ..InstallOptions::default()
            }
        ));
    }

    #[test]
    fn ordinary_user_scope_winget_stays_non_elevated() {
        assert!(!winget_should_run_elevated(
            "BurntSushi.ripgrep.MSVC",
            &InstallOptions {
                scope: Some("user".into()),
                ..InstallOptions::default()
            }
        ));
    }

    #[test]
    fn winget_recipe_without_scope_option_does_not_gain_scope() {
        let recipe = winget_recipe_with_options(vec![super::super::schema::RecipeOption::Version]);
        let effective = effective_install_options(&recipe, &InstallOptions::default());

        assert_eq!(effective.scope, None);
    }

    #[test]
    fn winget_recipe_without_scope_option_ignores_incoming_scope() {
        let recipe = winget_recipe_with_options(vec![super::super::schema::RecipeOption::Version]);
        let effective = effective_install_options(
            &recipe,
            &InstallOptions {
                scope: Some("user".into()),
                ..InstallOptions::default()
            },
        );

        assert_eq!(effective.scope, None);
    }

    #[test]
    fn explicit_npm_provider_selects_declared_fallback() {
        let mut recipe = winget_recipe_with_options(vec![
            super::super::schema::RecipeOption::Provider,
            super::super::schema::RecipeOption::Version,
        ]);
        recipe.npm_provider = Some(Provider::Npm {
            pkg: "@anthropic-ai/claude-code".into(),
        });
        let options = InstallOptions {
            provider: Some("npm".into()),
            ..InstallOptions::default()
        };

        assert!(matches!(
            selected_install_provider(&recipe, &options),
            Provider::Npm { pkg } if pkg == "@anthropic-ai/claude-code"
        ));
    }

    #[test]
    fn github_release_path_subdir_supports_release_tag_placeholder() {
        let install_dir = PathBuf::from("installer").join("bin").join("ffmpeg");
        let dir = github_release_path_dir(
            &install_dir,
            Some("ffmpeg-{tag}-full_build/bin"),
            Some("8.1.1"),
        );

        assert_eq!(dir, install_dir.join("ffmpeg-8.1.1-full_build").join("bin"));
    }

    #[test]
    fn github_release_path_subdir_defaults_to_install_dir() {
        let install_dir = PathBuf::from(r"C:\Tools\ffmpeg");

        assert_eq!(
            github_release_path_dir(&install_dir, None, Some("8.1.1")),
            install_dir
        );
    }

    #[test]
    fn winget_cli_utilities_request_winget_links_on_path() {
        for tool_id in [
            "claude-code-cli",
            "nssm",
            "ripgrep",
            "jq",
            "fzf",
            "uv",
            "ffmpeg",
            "scrcpy",
        ] {
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
    fn standalone_uv_path_extra_requires_matching_config_receipt() {
        let temp = tempfile::tempdir().expect("temp dir");
        let custom_bin = temp.path().join("custom-uv");
        std::fs::create_dir(&custom_bin).unwrap();
        std::fs::write(
            custom_bin.join(format!("uv{}", std::env::consts::EXE_SUFFIX)),
            b"test",
        )
        .unwrap();
        let vars = BTreeMap::from([(
            "UV_INSTALL_DIR".to_string(),
            custom_bin.to_string_lossy().into_owned(),
        )]);

        let candidates = standalone_uv_bin_path_candidates(&vars, None, None, None);
        assert_eq!(candidates, vec![custom_bin.clone()]);
        assert!(!is_astral_standalone_uv_bin_dir(&custom_bin));

        assert!(
            super::super::detect::standalone_uv_executable_with_receipt_bin_dir(
                &custom_bin,
                Some(&custom_bin),
            )
            .is_some()
        );
    }

    #[test]
    fn winget_links_dir_uses_local_app_data() {
        let local_app_data = PathBuf::from("AppData").join("Local");
        let dir = winget_links_dir_from_local_app_data(local_app_data.clone());

        assert_eq!(
            dir,
            local_app_data
                .join("Microsoft")
                .join("WinGet")
                .join("Links")
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
    fn structured_install_step_brackets_success_and_failure() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = events.clone();
        let emit: EventSink = Box::new(move |event| captured.lock().unwrap().push(event));

        assert_eq!(
            run_install_step("n8n", "install-managed-npm-app", &emit, || Ok(7)),
            Ok(7)
        );
        let failure = run_install_step(
            "n8n",
            "install-managed-npm-app",
            &emit,
            || Err::<(), _>("npm failed".into()),
        );
        assert_eq!(failure, Err("npm failed".into()));

        let events = events.lock().unwrap();
        assert!(matches!(
            &events[0],
            ProgressEvent::StepStarted { tool_id, step_id }
                if tool_id == "n8n" && step_id == "install-managed-npm-app"
        ));
        assert!(matches!(
            &events[1],
            ProgressEvent::StepFinished { ok: true, error: None, .. }
        ));
        assert!(matches!(
            &events[2],
            ProgressEvent::StepStarted { tool_id, step_id }
                if tool_id == "n8n" && step_id == "install-managed-npm-app"
        ));
        assert!(matches!(
            &events[3],
            ProgressEvent::StepFinished {
                ok: false,
                error: Some(error),
                ..
            } if error == "npm failed"
        ));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn managed_ollama_install_targets_app_local_location() {
        let args = managed_ollama_winget_args(&InstallOptions::default());

        assert!(args.contains(&"--location".to_string()));
        assert!(
            args.iter()
                .any(|arg| arg.ends_with(r"installer\apps\ollama\app"))
        );
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
    fn winget_install_requests_verbose_logs() {
        let args = winget_install_args("Git.Git", &InstallOptions::default());
        assert!(args.contains(&"--verbose-logs".to_string()));
        assert!(args.contains(&"Git.Git".to_string()));
    }

    #[test]
    fn winget_install_args_append_optional_scope_version_location() {
        let args = winget_install_args(
            "Git.Git",
            &InstallOptions {
                scope: Some("machine".into()),
                version: Some("2.50.0".into()),
                location: Some(r"C:\Tools\Git".into()),
                ..InstallOptions::default()
            },
        );
        let joined = args.join(" ");
        assert!(joined.contains("--scope machine"));
        assert!(joined.contains("--version 2.50.0"));
        assert!(joined.contains(r"--location C:\Tools\Git"));
    }

    #[test]
    fn winget_upgrade_args_use_upgrade_verb() {
        let args = winget_command_args("upgrade", "astral-sh.uv", &InstallOptions::default());

        assert_eq!(args[0], "upgrade");
        assert!(args.contains(&"astral-sh.uv".to_string()));
        assert!(args.contains(&"--verbose-logs".to_string()));
    }

    #[test]
    fn standalone_uv_update_uses_the_receipt_backed_executable() {
        let temp = tempfile::tempdir().unwrap();
        let executable = temp
            .path()
            .join(format!("uv{}", std::env::consts::EXE_SUFFIX));
        std::fs::write(&executable, b"uv").unwrap();
        let detected = super::super::detect::DetectedState::installed(Some("0.1.0".into()))
            .with_install_location(Some(temp.path().to_string_lossy().into_owned()))
            .with_install_source(Some("officialScript"));

        assert_eq!(
            astral_standalone_uv_executable_with_validator(&detected, |bin_dir| {
                super::super::detect::standalone_uv_executable_with_receipt_bin_dir(
                    bin_dir,
                    Some(temp.path()),
                )
            })
            .unwrap(),
            executable
        );
    }

    #[test]
    fn standalone_uv_update_revalidates_the_receipt() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path()
                .join(format!("uv{}", std::env::consts::EXE_SUFFIX)),
            b"uv",
        )
        .unwrap();
        let detected = super::super::detect::DetectedState::installed(Some("0.1.0".into()))
            .with_install_location(Some(temp.path().to_string_lossy().into_owned()))
            .with_install_source(Some("officialScript"));

        assert!(
            astral_standalone_uv_executable_with_validator(&detected, |bin_dir| {
                super::super::detect::standalone_uv_executable_with_receipt_bin_dir(bin_dir, None)
            })
            .unwrap_err()
            .contains("receipt is missing")
        );
    }

    #[test]
    fn tasklist_csv_parser_finds_matching_image_pids() {
        let output = "\"uv.exe\",\"3824\",\"Console\",\"1\",\"10,000 K\"\r\n\"node.exe\",\"99\",\"Console\",\"1\",\"20,000 K\"\r\n\"UV.EXE\",\"35296\",\"Console\",\"1\",\"11,000 K\"\r\n";

        assert_eq!(
            parse_tasklist_csv_process_ids(output, "uv.exe"),
            vec!["3824".to_string(), "35296".to_string()]
        );
    }

    #[test]
    fn tasklist_csv_parser_ignores_no_task_info() {
        assert!(
            parse_tasklist_csv_process_ids(
                "INFO: No tasks are running which match the specified criteria.\r\n",
                "uv.exe"
            )
            .is_empty()
        );
    }

    #[test]
    fn managed_ollama_install_requests_verbose_logs() {
        let args = managed_ollama_winget_args(&InstallOptions::default());
        assert!(args.contains(&"--verbose-logs".to_string()));
    }

    #[test]
    fn decodes_documented_winget_exit_code() {
        // 0x8A150052 printed as a signed i32 is the cryptic -1978335150.
        let detail = exit_status_detail("winget", -1978335150);
        assert_eq!(detail, " (0x8A150052: Failed to install portable package)");
    }

    #[test]
    fn decodes_install_already_running_winget_exit_code() {
        let detail = exit_status_detail("winget", 0x8A150101u32 as i32);
        assert_eq!(
            detail,
            " (0x8A150101: Application is currently running. Exit the application then try again.)"
        );
    }

    #[test]
    fn unknown_winget_exit_code_still_shows_hex() {
        let detail = exit_status_detail("winget", 0x8A15FFFFu32 as i32);
        assert_eq!(detail, " (0x8A15FFFF)");
    }

    #[test]
    fn non_winget_programs_are_not_decoded() {
        assert_eq!(exit_status_detail("msiexec", 1603), "");
        assert_eq!(exit_status_detail("npm", -1978335150), "");
    }

    #[test]
    fn winget_log_dir_points_at_diag_output_dir() {
        let local_app_data = PathBuf::from("AppData").join("Local");
        let dir = winget_log_dir_from_local_app_data(local_app_data.clone());
        assert_eq!(
            dir,
            local_app_data
                .join("Packages")
                .join("Microsoft.DesktopAppInstaller_8wekyb3d8bbwe")
                .join("LocalState")
                .join("DiagOutputDir")
        );
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
