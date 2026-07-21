// Per-provider detection of whether a tool is currently installed on the
// host and, if so, what version. Results are NEVER persisted — they are
// always re-derived (ADR 0007 §"Persistence"). The Module's in-memory
// session cache holds them until the user clicks Refresh.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::json;

use super::latest_version::installer_latest_is_newer;
use super::managed_app::{is_managed_app, managed_app_install_dir, managed_app_marker_path};
use super::proc::{no_window, npm_program};
use super::schema::{Catalog, Detection, GithubReleaseLayout, Provider, Recipe};

pub(super) const OFFICIAL_SCRIPT_INSTALL_SOURCE: &str = "officialScript";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedState {
    pub installed: bool,
    pub installed_version: Option<String>,
    /// Only populated for bundles where some-but-not-all children are
    /// installed. Renders as "Partially installed (N/M)".
    pub partial_count: Option<(u32, u32)>,
    /// Best-effort install directory for installed tools, surfaced in the
    /// installed-tool info dialog. Populated for install types KKTerm owns
    /// under %LOCALAPPDATA%, such as github-release tools and managed apps.
    pub install_location: Option<String>,
    #[serde(default)]
    pub install_scope: Option<InstallScope>,
    /// Extra runtime version for manager-backed bundles. For Node/Python
    /// bundles, `installed_version` remains the manager version used for
    /// update comparisons, while this carries the managed runtime version.
    #[serde(default)]
    pub runtime_version: Option<String>,
    /// Best-effort provider that detected and will manage this installed tool.
    #[serde(default)]
    pub install_provider: Option<String>,
    /// Detection provenance that is not a management provider. Keeping this
    /// separate prevents an official-script install from being routed through
    /// the catalog's WinGet update/uninstall path.
    #[serde(default)]
    pub install_source: Option<String>,
    /// Unix timestamp from the most recent detection pass. Cached registry
    /// results carry this so the UI can show how stale the snapshot is.
    pub last_checked_at: Option<i64>,
}

impl DetectedState {
    pub fn not_installed() -> Self {
        Self {
            installed: false,
            installed_version: None,
            partial_count: None,
            install_location: None,
            install_scope: None,
            runtime_version: None,
            install_provider: None,
            install_source: None,
            last_checked_at: None,
        }
    }
    pub fn installed(version: Option<String>) -> Self {
        Self {
            installed: true,
            installed_version: version,
            partial_count: None,
            install_location: None,
            install_scope: None,
            runtime_version: None,
            install_provider: None,
            install_source: None,
            last_checked_at: None,
        }
    }
    pub fn with_install_location(mut self, location: Option<String>) -> Self {
        self.install_location = location;
        self
    }
    pub fn with_install_scope(mut self, scope: Option<InstallScope>) -> Self {
        self.install_scope = scope;
        self
    }
    pub fn with_install_provider(mut self, provider: Option<&str>) -> Self {
        if self.installed {
            self.install_provider = provider.map(String::from);
        }
        self
    }
    pub fn with_install_source(mut self, source: Option<&str>) -> Self {
        self.install_source = source.map(String::from);
        self
    }
    pub fn is_official_script_install(&self) -> bool {
        self.install_source.as_deref() == Some(OFFICIAL_SCRIPT_INSTALL_SOURCE)
    }
    pub fn with_last_checked_at(mut self, checked_at: Option<i64>) -> Self {
        self.last_checked_at = checked_at;
        self
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InstallScope {
    User,
    Machine,
}

/// Detect every recipe in the catalog. The frontend only runs this on first
/// Module entry per session; subsequent visits use the in-memory cache.
/// Recipes share one local Add/Remove Programs plus current-user AppX package
/// snapshot instead of spawning per-tool detection commands.
pub fn detect_all(catalog: &Catalog) -> HashMap<String, DetectedState> {
    crate::logging::installer_helper_debug(
        "detect.all.start",
        &json!({ "recipeCount": catalog.recipes.len() }),
    );
    let mut out: HashMap<String, DetectedState> = HashMap::new();
    // Detect leaves first so bundles can compose their result.
    let mut bundles: Vec<&Recipe> = Vec::new();
    refresh_installed_software_snapshot();
    for recipe in &catalog.recipes {
        if let Provider::Bundle { .. } = recipe.provider {
            bundles.push(recipe);
            continue;
        }
        out.insert(recipe.id.clone(), detect_one(recipe));
    }
    // Bundles consult already-detected leaves.
    for bundle in bundles {
        if let Provider::Bundle { steps } = &bundle.provider {
            let child_states: Vec<&DetectedState> = steps
                .iter()
                .filter_map(|step| out.get(step.as_str()))
                .collect();
            let state = bundle_detected_state(&bundle.id, &child_states, steps.len() as u32);
            out.insert(bundle.id.clone(), state);
        }
    }
    crate::logging::installer_helper_debug("detect.all.ok", &json!({ "resultCount": out.len() }));
    out
}

pub fn detect_one_in_catalog(recipe: &Recipe, catalog: &Catalog) -> DetectedState {
    crate::logging::installer_helper_debug(
        "detect.one_in_catalog.start",
        &json!({ "toolId": recipe.id, "provider": provider_kind(&recipe.provider) }),
    );
    if let Provider::Bundle { steps } = &recipe.provider {
        let recipes_by_id: HashMap<&str, &Recipe> =
            catalog.recipes.iter().map(|r| (r.id.as_str(), r)).collect();
        let child_states: Vec<DetectedState> = steps
            .iter()
            .filter_map(|step| recipes_by_id.get(step.as_str()).map(|r| detect_one(r)))
            .collect();
        let child_refs: Vec<&DetectedState> = child_states.iter().collect();
        let state = bundle_detected_state(&recipe.id, &child_refs, steps.len() as u32);
        crate::logging::installer_helper_debug(
            "detect.one_in_catalog.ok",
            &json!({ "toolId": recipe.id, "state": state }),
        );
        return state;
    }
    let state = detect_one(recipe);
    crate::logging::installer_helper_debug(
        "detect.one_in_catalog.ok",
        &json!({ "toolId": recipe.id, "state": state }),
    );
    state
}

pub fn detect_bundle_from_states(
    recipe: &Recipe,
    detected: &HashMap<String, DetectedState>,
) -> Option<DetectedState> {
    if let Provider::Bundle { steps } = &recipe.provider {
        let child_states: Vec<&DetectedState> = steps
            .iter()
            .filter_map(|step| detected.get(step.as_str()))
            .collect();
        return Some(bundle_detected_state(
            &recipe.id,
            &child_states,
            steps.len() as u32,
        ));
    }
    None
}

pub fn detect_one(recipe: &Recipe) -> DetectedState {
    crate::logging::installer_helper_debug(
        "detect.one.start",
        &json!({ "toolId": recipe.id, "provider": provider_kind(&recipe.provider) }),
    );
    let state = if is_managed_app(&recipe.id) {
        detect_managed_app_marker(&recipe.id)
    } else {
        if let Some(Provider::Chocolatey { id }) = &recipe.chocolatey_provider {
            let chocolatey_state = detect_chocolatey_package(id);
            if chocolatey_state.installed {
                crate::logging::installer_helper_debug(
                    "detect.one.chocolatey_provider",
                    &json!({ "toolId": recipe.id, "packageId": id, "state": chocolatey_state }),
                );
                return chocolatey_state.with_install_provider(Some("chocolatey"));
            }
        }
        match &recipe.provider {
            Provider::Winget { .. } => {
                let state = detect_winget(recipe).with_install_provider(Some("winget"));
                if !state.installed && recipe.id == "chocolatey" {
                    detect_chocolatey_cli().with_install_provider(Some("chocolatey"))
                } else if !state.installed
                    && let Some(npm_state) = detect_npm_provider(recipe)
                {
                    npm_state.with_install_provider(Some("npm"))
                } else if !state.installed
                    && let Some(cli_state) = detect_official_cli_installer(&recipe.id)
                {
                    cli_state.with_install_provider(Some("downloadInstaller"))
                } else if !state.installed
                    && recipe.id == "uv"
                    && let Some(cli_state) = detect_astral_standalone_uv()
                {
                    cli_state.with_install_source(Some(OFFICIAL_SCRIPT_INSTALL_SOURCE))
                } else if !state.installed
                    && let Some(cli_state) = detect_winget_cli_fallback(&recipe.id)
                {
                    cli_state.with_install_provider(Some("winget"))
                } else if !state.installed
                    && matches!(
                        &recipe.download_provider,
                        Some(Provider::GithubRelease { .. })
                    )
                {
                    detect_github_release_marker(&recipe.id)
                        .with_install_provider(Some("githubRelease"))
                } else {
                    state
                }
            }
            Provider::Chocolatey { id } => {
                detect_chocolatey_package(id).with_install_provider(Some("chocolatey"))
            }
            Provider::Npm { pkg } => detect_npm(pkg).with_install_provider(Some("npm")),
            Provider::UvPip { .. } => DetectedState::not_installed(),
            Provider::DownloadInstaller { .. } if recipe.id == "winget" => {
                detect_winget_cli().with_install_provider(Some("downloadInstaller"))
            }
            Provider::DownloadInstaller { .. } if recipe.id == "antigravity-cli" => {
                detect_antigravity_cli().with_install_provider(Some("downloadInstaller"))
            }
            Provider::DownloadInstaller { .. } if recipe.id == "cursor-cli" => {
                detect_cursor_cli().with_install_provider(Some("downloadInstaller"))
            }
            Provider::DownloadInstaller { .. } => detect_installed_software_aliases(recipe)
                .with_install_provider(Some("downloadInstaller")),
            Provider::GithubRelease { .. } => detect_github_release_marker(&recipe.id)
                .with_install_provider(Some("githubRelease")),
            Provider::WindowsFeature { feature, .. } => {
                detect_windows_feature(feature).with_install_provider(Some("windowsFeature"))
            }
            Provider::WslDistro { distro } => {
                detect_wsl_distro(distro).with_install_provider(Some("wslDistro"))
            }
            Provider::Bundle { .. } => DetectedState::not_installed(),
        }
    };
    crate::logging::installer_helper_debug(
        "detect.one.ok",
        &json!({ "toolId": recipe.id, "provider": provider_kind(&recipe.provider), "state": state }),
    );
    state
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

fn detect_managed_app_marker(tool_id: &str) -> DetectedState {
    let marker = managed_app_marker_path(tool_id);
    let Ok(text) = std::fs::read_to_string(&marker) else {
        return DetectedState::not_installed();
    };
    let version = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|value| {
            value
                .get("version")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        });
    DetectedState::installed(version).with_install_location(Some(
        managed_app_install_dir(tool_id)
            .to_string_lossy()
            .into_owned(),
    ))
}

fn bundle_detected_state(
    bundle_id: &str,
    child_states: &[&DetectedState],
    total: u32,
) -> DetectedState {
    match bundle_id {
        "node-bundle" => {
            return runtime_bundle_detected_state(child_states, |_| detect_node_version());
        }
        "python-bundle" => {
            return runtime_bundle_detected_state(child_states, detect_uv_python_313_version);
        }
        _ => {}
    }
    default_bundle_detected_state(child_states, total)
}

fn default_bundle_detected_state(child_states: &[&DetectedState], total: u32) -> DetectedState {
    let installed_count = child_states.iter().filter(|state| state.installed).count() as u32;
    if installed_count == 0 {
        DetectedState::not_installed()
    } else if installed_count == total {
        let version = if total == 1 {
            child_states
                .first()
                .and_then(|state| state.installed_version.clone())
        } else {
            None
        };
        DetectedState::installed(version)
    } else {
        DetectedState {
            installed: false,
            installed_version: None,
            partial_count: Some((installed_count, total)),
            install_location: None,
            install_scope: None,
            runtime_version: None,
            install_provider: None,
            install_source: None,
            last_checked_at: None,
        }
    }
}

fn runtime_bundle_detected_state(
    child_states: &[&DetectedState],
    detect_runtime_version: fn(Option<&Path>) -> Option<String>,
) -> DetectedState {
    let manager_installed = child_states.iter().all(|state| state.installed);
    if !manager_installed {
        return default_bundle_detected_state(child_states, child_states.len() as u32);
    }
    let manager_provider = child_states
        .first()
        .and_then(|state| state.install_provider.clone());
    let manager_source = child_states
        .first()
        .and_then(|state| state.install_source.clone());
    let manager_location = child_states
        .first()
        .and_then(|state| state.install_location.clone());
    match detect_runtime_version(manager_location.as_deref().map(Path::new)) {
        Some(version) => {
            let manager_version = child_states
                .first()
                .and_then(|state| state.installed_version.clone());
            let mut state = DetectedState::installed(manager_version);
            state.runtime_version = Some(version);
            state.install_location = manager_location;
            state.install_provider = manager_provider;
            state.install_source = manager_source;
            state
        }
        None => DetectedState {
            installed: false,
            installed_version: None,
            partial_count: Some((child_states.len() as u32, child_states.len() as u32 + 1)),
            install_location: manager_location,
            install_scope: None,
            runtime_version: None,
            install_provider: manager_provider,
            install_source: manager_source,
            last_checked_at: None,
        },
    }
}

fn detect_node_version() -> Option<String> {
    command_version("node", &["--version"])
}

fn detect_uv_python_313_version(manager_location: Option<&Path>) -> Option<String> {
    // A standalone uv install may have been found by its receipt even when
    // KKTerm's process PATH is stale. Prefer that exact binary so the bundle
    // does not regress from "uv detected" to "Python partially installed".
    let manager_program = manager_location
        .and_then(standalone_uv_executable)
        .map(|path| path.to_string_lossy().into_owned());
    let output = command_output_with_refreshed_path(
        manager_program.as_deref().unwrap_or("uv"),
        &["python", "find", "3.13"],
    )?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        return None;
    }
    command_version(&path, &["--version"])
}

fn detect_antigravity_cli() -> DetectedState {
    let local_data = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let exe_path = antigravity_cli_exe_path_from_local_data(&local_data);
    if !exe_path.exists() {
        return DetectedState::not_installed();
    }
    let program = exe_path.to_string_lossy().into_owned();
    DetectedState::installed(command_version(&program, &["--version"])).with_install_location(Some(
        exe_path
            .parent()
            .unwrap_or(&local_data)
            .to_string_lossy()
            .into_owned(),
    ))
}

fn antigravity_cli_exe_path_from_local_data(local_data: &std::path::Path) -> PathBuf {
    local_data.join("agy").join("bin").join("agy.exe")
}

fn detect_winget_cli() -> DetectedState {
    match command_version("winget", &["--version"]) {
        Some(version) => DetectedState::installed(Some(version)),
        None => DetectedState::not_installed(),
    }
}

fn detect_chocolatey_cli() -> DetectedState {
    match command_version("choco", &["--version"]) {
        Some(version) => DetectedState::installed(Some(version)),
        None => DetectedState::not_installed(),
    }
}

pub fn detect_chocolatey_package(package_id: &str) -> DetectedState {
    let output = match command_output_with_refreshed_path(
        "choco",
        &[
            "list",
            "--local-only",
            "--exact",
            package_id,
            "--limit-output",
        ],
    ) {
        Some(output) => output,
        None => return DetectedState::not_installed(),
    };
    if !output.status.success() {
        return DetectedState::not_installed();
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    chocolatey_package_from_limit_output(&stdout, package_id)
        .map(|version| DetectedState::installed(Some(version)))
        .unwrap_or_else(DetectedState::not_installed)
}

fn chocolatey_package_from_limit_output(output: &str, package_id: &str) -> Option<String> {
    for line in output.lines() {
        let Some((id, version)) = line.trim().split_once('|') else {
            continue;
        };
        if id.eq_ignore_ascii_case(package_id) && !version.trim().is_empty() {
            return Some(version.trim().to_string());
        }
    }
    None
}

pub(super) fn detect_official_cli_installer(tool_id: &str) -> Option<DetectedState> {
    let (_command, relative_path) = official_cli_install_spec(tool_id)?;
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from)?;
    let executable = home.join(relative_path);
    if !executable.is_file() {
        return None;
    }
    let program = executable.to_string_lossy().into_owned();
    let version = command_version(&program, &["--version"])
        .and_then(|line| version_token_from_line(&line).or(Some(line)));
    Some(
        DetectedState::installed(version).with_install_location(
            executable
                .parent()
                .map(|path| path.to_string_lossy().into_owned()),
        ),
    )
}

fn detect_cursor_cli() -> DetectedState {
    let Some(local_app_data) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) else {
        return DetectedState::not_installed();
    };
    let Some(executable) = cursor_cli_command_candidates(&local_app_data)
        .into_iter()
        .find(|path| path.is_file())
    else {
        return DetectedState::not_installed();
    };
    let program = executable.to_string_lossy().into_owned();
    let version = command_version(&program, &["--version"])
        .and_then(|line| version_token_from_line(&line).or(Some(line)));
    DetectedState::installed(version).with_install_location(
        executable
            .parent()
            .map(|path| path.to_string_lossy().into_owned()),
    )
}

fn cursor_cli_command_candidates(local_app_data: &Path) -> Vec<PathBuf> {
    let install_dir = local_app_data.join("cursor-agent");
    ["agent.cmd", "cursor-agent.cmd"]
        .into_iter()
        .map(|name| install_dir.join(name))
        .collect()
}

fn official_cli_install_spec(tool_id: &str) -> Option<(&'static str, &'static str)> {
    match tool_id {
        "kimi-code-cli" => Some(("kimi", ".kimi-code\\bin\\kimi.exe")),
        "grok-build" => Some(("grok", ".grok\\bin\\grok.exe")),
        _ => None,
    }
}

fn version_token_from_line(line: &str) -> Option<String> {
    line.split_whitespace()
        .map(|token| token.trim_matches(|ch: char| !ch.is_ascii_alphanumeric() && ch != '.'))
        .map(|token| token.trim_start_matches('v'))
        .find(|token| {
            token.contains('.') && token.chars().next().is_some_and(|ch| ch.is_ascii_digit())
        })
        .map(String::from)
}

fn detect_winget_cli_fallback(tool_id: &str) -> Option<DetectedState> {
    let (program, args) = winget_cli_fallback_command(tool_id)?;
    command_version(program, args).map(|version| DetectedState::installed(Some(version)))
}

fn winget_cli_fallback_command(tool_id: &str) -> Option<(&'static str, &'static [&'static str])> {
    match tool_id {
        "oh-my-posh" => Some(("oh-my-posh", &["version"])),
        "powershell-7" => Some(("pwsh", &["--version"])),
        _ => None,
    }
}

fn detect_astral_standalone_uv() -> Option<DetectedState> {
    let refreshed_path = super::install::refreshed_path_public();
    let receipt_bin_dir = astral_uv_receipt_bin_dir();
    let mut candidates = Vec::new();
    // The receipt's install prefix is authoritative, so check it first and
    // let the genuine standalone binary win over any other copy on PATH.
    if let Some(dir) = receipt_bin_dir.clone() {
        push_unique_path(&mut candidates, dir);
    }
    for dir in standalone_uv_bin_path_candidates(
        std::env::var_os("PATH").as_deref(),
        refreshed_path.as_deref(),
        std::env::var_os("UV_INSTALL_DIR").as_deref(),
        std::env::var_os("USERPROFILE").as_deref(),
        std::env::var_os("HOME").as_deref(),
    ) {
        push_unique_path(&mut candidates, dir);
    }
    let (bin_dir, executable) = candidates.into_iter().find_map(|dir| {
        standalone_uv_executable_with_receipt_bin_dir(&dir, receipt_bin_dir.as_deref())
            .map(|executable| (dir, executable))
    })?;
    let program = executable.to_string_lossy().into_owned();
    let version = command_version(&program, &["--version"])?;
    Some(
        DetectedState::installed(Some(version))
            .with_install_location(Some(bin_dir.to_string_lossy().into_owned())),
    )
}

fn standalone_uv_bin_path_candidates(
    current_path: Option<&std::ffi::OsStr>,
    refreshed_path: Option<&str>,
    uv_install_dir: Option<&std::ffi::OsStr>,
    user_profile: Option<&std::ffi::OsStr>,
    home: Option<&std::ffi::OsStr>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = uv_install_dir {
        push_unique_path(&mut candidates, PathBuf::from(path));
    }
    for root in [user_profile, home].into_iter().flatten() {
        let root = PathBuf::from(root);
        // `.local\bin` is the current default. `.cargo\bin` recognizes
        // standalone installs created before uv 0.5 without broad directory
        // scanning or confusing a package-manager binary for Astral's script.
        push_unique_path(&mut candidates, root.join(".local").join("bin"));
        push_unique_path(&mut candidates, root.join(".cargo").join("bin"));
    }
    for path in current_path
        .into_iter()
        .flat_map(std::env::split_paths)
        .chain(
            refreshed_path
                .into_iter()
                .flat_map(|path| std::env::split_paths(std::ffi::OsStr::new(path))),
        )
    {
        push_unique_path(&mut candidates, path);
    }
    candidates
}

fn push_unique_path(paths: &mut Vec<PathBuf>, candidate: PathBuf) {
    let candidate_text = candidate.to_string_lossy();
    if !paths
        .iter()
        .any(|path| path.to_string_lossy().eq_ignore_ascii_case(&candidate_text))
    {
        paths.push(candidate);
    }
}

pub(super) fn standalone_uv_executable(bin_dir: &Path) -> Option<PathBuf> {
    standalone_uv_executable_with_receipt_bin_dir(bin_dir, astral_uv_receipt_bin_dir().as_deref())
}

fn standalone_uv_executable_with_receipt_bin_dir(
    bin_dir: &Path,
    receipt_bin_dir: Option<&Path>,
) -> Option<PathBuf> {
    let executable = bin_dir.join(format!("uv{}", std::env::consts::EXE_SUFFIX));
    if !executable.is_file() {
        return None;
    }
    // Astral's installer writes uv-receipt.json to its config directory —
    // %XDG_CONFIG_HOME%\uv or %LOCALAPPDATA%\uv — not next to uv.exe, and
    // records the install prefix inside it. Accepting the directory only when
    // it carries an adjacent receipt (custom setups) or matches the config
    // receipt's install prefix keeps a pipx, Scoop, Cargo, or unrelated PATH
    // copy from being mislabeled as standalone.
    (bin_dir.join("uv-receipt.json").is_file()
        || receipt_bin_dir.is_some_and(|receipt_dir| paths_equal_ignore_case(bin_dir, receipt_dir)))
    .then_some(executable)
}

fn astral_uv_receipt_bin_dir() -> Option<PathBuf> {
    astral_uv_receipt_paths(
        std::env::var_os("XDG_CONFIG_HOME").as_deref(),
        std::env::var_os("LOCALAPPDATA").as_deref(),
    )
    .into_iter()
    .find_map(|path| {
        let text = std::fs::read_to_string(path).ok()?;
        astral_uv_receipt_bin_dir_from_json(&text)
    })
}

fn astral_uv_receipt_paths(
    xdg_config_home: Option<&std::ffi::OsStr>,
    local_app_data: Option<&std::ffi::OsStr>,
) -> Vec<PathBuf> {
    // install.ps1 prefers %XDG_CONFIG_HOME%\uv when set, else %LOCALAPPDATA%\uv.
    [xdg_config_home, local_app_data]
        .into_iter()
        .flatten()
        .map(|root| PathBuf::from(root).join("uv").join("uv-receipt.json"))
        .collect()
}

fn astral_uv_receipt_bin_dir_from_json(text: &str) -> Option<PathBuf> {
    let value = serde_json::from_str::<serde_json::Value>(text).ok()?;
    let prefix = PathBuf::from(value.get("install_prefix")?.as_str()?);
    // The default Windows install uses the `flat` layout with uv.exe directly
    // in install_prefix; hierarchical and cargo-home layouts add `bin`.
    match value
        .get("install_layout")
        .and_then(|layout| layout.as_str())
    {
        Some("hierarchical") | Some("cargo-home") => Some(prefix.join("bin")),
        _ => Some(prefix),
    }
}

fn paths_equal_ignore_case(left: &Path, right: &Path) -> bool {
    // The receipt's install prefix can mix separators (`Join-Path $HOME
    // ".local/bin"`), so compare on a normalized form.
    let normalize = |path: &Path| {
        path.to_string_lossy()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_ascii_lowercase()
    };
    normalize(left) == normalize(right)
}

fn command_version(program: &str, args: &[&str]) -> Option<String> {
    let output = command_output_with_refreshed_path(program, args)?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_version_line(&stdout).or_else(|| parse_version_line(&stderr))
}

fn parse_version_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| {
            let trimmed = line.trim_start_matches("Python ").trim_start_matches('v');
            // Prefer the first version-shaped token so lines like
            // `uv 0.11.29 (hash date)` and `PowerShell 7.5.0` compare cleanly
            // against winget/latest-version strings.
            extract_first_version_token(trimmed).unwrap_or_else(|| trimmed.to_string())
        })
}

fn extract_first_version_token(text: &str) -> Option<String> {
    text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '.' || c == '-'))
        .find(|part| part.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .map(|part| part.to_string())
}

fn command_output_with_refreshed_path(program: &str, args: &[&str]) -> Option<Output> {
    command_output_with_path_fallback(program, args, super::install::refreshed_path_public)
}

fn command_output_with_path_fallback(
    program: &str,
    args: &[&str],
    refreshed_path: impl FnOnce() -> Option<String>,
) -> Option<Output> {
    command_output_with_path(program, args, None).or_else(|| {
        refreshed_path()
            .filter(|path| !path.trim().is_empty())
            .and_then(|path| command_output_with_path(program, args, Some(path)))
    })
}

fn command_output_with_path(program: &str, args: &[&str], path: Option<String>) -> Option<Output> {
    let mut command = Command::new(program);
    command.args(args);
    if let Some(path) = path {
        command.env("PATH", path);
    }
    no_window(&mut command).output().ok()
}

// ---- Windows installed software / winget -------------------------------
//
// Detection is intentionally local-first and cheap: scan Windows Add/Remove
// Programs registry entries and current-user AppX packages once per sweep,
// then match recipes against catalog detection aliases. `winget` remains the
// default package-manager provider, but detection does not shell out to it.

#[derive(Default)]
struct InstalledSoftwareSnapshot {
    entries: Vec<InstalledSoftwareEntry>,
}

#[derive(Debug, Clone)]
struct InstalledSoftwareEntry {
    registry_key: String,
    display_name: Option<String>,
    display_version: Option<String>,
    install_location: Option<String>,
}

static INSTALLED_SOFTWARE_SNAPSHOT: OnceLock<std::sync::Mutex<Option<InstalledSoftwareSnapshot>>> =
    OnceLock::new();

fn installed_software_snapshot_cell() -> &'static std::sync::Mutex<Option<InstalledSoftwareSnapshot>>
{
    INSTALLED_SOFTWARE_SNAPSHOT.get_or_init(|| std::sync::Mutex::new(None))
}

/// Take one installed-software snapshot and cache it for the current sweep.
/// Called by `detect_all` before iterating recipes. Later callers reuse the
/// cached snapshot unless they explicitly clear it.
pub fn refresh_installed_software_snapshot() {
    crate::logging::installer_helper_debug(
        "detect.installed_software_snapshot.refresh.start",
        &json!({}),
    );
    let parsed = load_installed_software_snapshot();
    let entry_count = parsed.entries.len();
    *installed_software_snapshot_cell().lock().unwrap() = Some(parsed);
    crate::logging::installer_helper_debug(
        "detect.installed_software_snapshot.refresh.ok",
        &json!({ "entryCount": entry_count }),
    );
}

#[cfg(target_os = "windows")]
fn load_installed_software_snapshot() -> InstalledSoftwareSnapshot {
    windows_installed_software::load()
}

#[cfg(not(target_os = "windows"))]
fn load_installed_software_snapshot() -> InstalledSoftwareSnapshot {
    InstalledSoftwareSnapshot::default()
}

pub(super) fn detect_winget(recipe: &Recipe) -> DetectedState {
    let cell = installed_software_snapshot_cell();
    let mut guard = cell.lock().unwrap();
    if guard.is_none() {
        drop(guard);
        let parsed = load_installed_software_snapshot();
        *cell.lock().unwrap() = Some(parsed);
        guard = cell.lock().unwrap();
    }
    let snapshot = guard.as_ref().unwrap();
    detect_installed_software(recipe, snapshot)
}

fn detect_installed_software_aliases(recipe: &Recipe) -> DetectedState {
    let cell = installed_software_snapshot_cell();
    let mut guard = cell.lock().unwrap();
    if guard.is_none() {
        drop(guard);
        let parsed = load_installed_software_snapshot();
        *cell.lock().unwrap() = Some(parsed);
        guard = cell.lock().unwrap();
    }
    let snapshot = guard.as_ref().unwrap();
    detect_installed_software_by_aliases(recipe, snapshot)
}

fn detect_installed_software(
    recipe: &Recipe,
    snapshot: &InstalledSoftwareSnapshot,
) -> DetectedState {
    let Provider::Winget { id } = &recipe.provider else {
        return DetectedState::not_installed();
    };
    detect_installed_software_match(id, &recipe.detection, snapshot)
}

fn detect_installed_software_by_aliases(
    recipe: &Recipe,
    snapshot: &InstalledSoftwareSnapshot,
) -> DetectedState {
    detect_installed_software_match(&recipe.id, &recipe.detection, snapshot)
}

fn detect_installed_software_match(
    provider_id: &str,
    detection: &Detection,
    snapshot: &InstalledSoftwareSnapshot,
) -> DetectedState {
    let mut best_match = None;
    for entry in &snapshot.entries {
        if !installed_entry_matches(provider_id, detection, entry) {
            continue;
        }
        let state = DetectedState::installed(entry.display_version.clone())
            .with_install_location(entry.install_location.clone())
            .with_install_scope(installed_entry_scope(entry));
        if best_match
            .as_ref()
            .is_none_or(|current| installed_state_is_better(&state, current))
        {
            best_match = Some(state);
        }
    }
    best_match.unwrap_or_else(DetectedState::not_installed)
}

fn installed_state_is_better(candidate: &DetectedState, current: &DetectedState) -> bool {
    match (
        candidate.installed_version.as_deref(),
        current.installed_version.as_deref(),
    ) {
        (Some(candidate_version), Some(current_version)) => {
            if installer_latest_is_newer(candidate_version, current_version) {
                return true;
            }
            if installer_latest_is_newer(current_version, candidate_version) {
                return false;
            }
        }
        (Some(_), None) => return true,
        (None, Some(_)) => return false,
        (None, None) => {}
    }
    candidate.install_scope == Some(InstallScope::User)
        && current.install_scope != Some(InstallScope::User)
}

fn installed_entry_matches(
    winget_id: &str,
    detection: &Detection,
    entry: &InstalledSoftwareEntry,
) -> bool {
    let registry_key = normalize_detection_value(&entry.registry_key);
    if registry_key == normalize_detection_value(winget_id) {
        return true;
    }
    // Winget tracks portable / archive packages (ripgrep, jq, fzf, …) under an
    // Add/Remove Programs subkey named
    // `<PackageIdentifier>_Microsoft.Winget.Source_8wekyb3d8bbwe`. Those entries
    // carry a DisplayName that may embed a version or otherwise not equal the
    // catalog alias, so match the winget-source key straight off the package id
    // rather than relying on the display name (the cause of ripgrep reporting
    // "not installed" after a successful winget install).
    if registry_key_matches_winget_source(&registry_key, winget_id) {
        return true;
    }
    if detection
        .registry_keys
        .iter()
        .any(|key| registry_key == normalize_detection_value(key))
    {
        return true;
    }
    if registry_key.starts_with("appx\\user\\")
        && registry_key.rsplit('\\').next().is_some_and(|family| {
            detection.appx_package_family_names.iter().any(|expected| {
                normalize_detection_value(expected) == normalize_detection_value(family)
            })
        })
    {
        return true;
    }
    let Some(display_name) = entry.display_name.as_deref() else {
        return false;
    };
    let display_name = normalize_detection_value(display_name);
    detection
        .display_names
        .iter()
        .any(|name| display_name_matches_alias(&display_name, name))
        || detection
            .display_name_prefixes
            .iter()
            .any(|prefix| display_name.starts_with(&normalize_detection_value(prefix)))
}

/// True when `registry_key` (already normalized) is the Add/Remove Programs
/// subkey that winget creates for a portable/archive package it installed,
/// i.e. `<winget_id>_Microsoft.Winget.Source_8wekyb3d8bbwe`. Both the bare
/// child key and the `arp\<scope>\<view>\<child>` alias form are accepted; the
/// match anchors on the final path segment so unrelated ids that merely share a
/// prefix (e.g. `git` vs `digit_…`) cannot collide.
fn registry_key_matches_winget_source(registry_key: &str, winget_id: &str) -> bool {
    let id = normalize_detection_value(winget_id);
    if id.is_empty() {
        return false;
    }
    let child = registry_key.rsplit('\\').next().unwrap_or(registry_key);
    child.starts_with(&format!("{id}_")) && child.contains("microsoft.winget.source")
}

fn display_name_matches_alias(display_name: &str, alias: &str) -> bool {
    let alias = normalize_detection_value(alias);
    display_name == alias || display_name == format!("{alias} (user)")
}

fn installed_entry_scope(entry: &InstalledSoftwareEntry) -> Option<InstallScope> {
    let registry_key = normalize_detection_value(&entry.registry_key);
    if registry_key.starts_with("arp\\user\\") {
        Some(InstallScope::User)
    } else if registry_key.starts_with("appx\\user\\") {
        Some(InstallScope::User)
    } else if registry_key.starts_with("arp\\machine\\") {
        Some(InstallScope::Machine)
    } else {
        None
    }
}

fn normalize_detection_value(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

/// Discard the cached snapshot so the next `detect_winget`/`detect_all`
/// call re-scans installed software. Used by post-install/uninstall redetect
/// paths in commands.rs so an install that just landed is visible.
pub fn invalidate_installed_software_snapshot() {
    *installed_software_snapshot_cell().lock().unwrap() = None;
    crate::logging::installer_helper_debug(
        "detect.installed_software_snapshot.invalidated",
        &json!({}),
    );
}

#[cfg(target_os = "windows")]
mod windows_installed_software {
    use std::ffi::{OsStr, OsString};
    use std::os::windows::ffi::{OsStrExt, OsStringExt};

    use windows::Management::Deployment::PackageManager;
    use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize};
    use windows::core::HSTRING;
    use windows_sys::Win32::Foundation::{ERROR_NO_MORE_ITEMS, ERROR_SUCCESS};
    use windows_sys::Win32::System::Registry::{
        HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY,
        REG_EXPAND_SZ, REG_SZ, RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW,
    };

    use super::{InstalledSoftwareEntry, InstalledSoftwareSnapshot};

    const UNINSTALL_SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";

    struct RegistryKey(HKEY);

    impl Drop for RegistryKey {
        fn drop(&mut self) {
            unsafe {
                let _ = RegCloseKey(self.0);
            }
        }
    }

    pub fn load() -> InstalledSoftwareSnapshot {
        let mut entries = Vec::new();
        scan_uninstall_key(
            HKEY_LOCAL_MACHINE,
            UNINSTALL_SUBKEY,
            "ARP\\Machine\\X64",
            KEY_WOW64_64KEY,
            &mut entries,
        );
        scan_uninstall_key(
            HKEY_LOCAL_MACHINE,
            UNINSTALL_SUBKEY,
            "ARP\\Machine\\X86",
            KEY_WOW64_32KEY,
            &mut entries,
        );
        scan_uninstall_key(
            HKEY_CURRENT_USER,
            UNINSTALL_SUBKEY,
            "ARP\\User\\X64",
            KEY_WOW64_64KEY,
            &mut entries,
        );
        scan_uninstall_key(
            HKEY_CURRENT_USER,
            UNINSTALL_SUBKEY,
            "ARP\\User\\X86",
            KEY_WOW64_32KEY,
            &mut entries,
        );
        scan_appx_packages(&mut entries);
        InstalledSoftwareSnapshot { entries }
    }

    fn scan_appx_packages(entries: &mut Vec<InstalledSoftwareEntry>) {
        struct WinRtGuard(bool);
        impl Drop for WinRtGuard {
            fn drop(&mut self) {
                if self.0 {
                    unsafe { RoUninitialize() };
                }
            }
        }
        let _winrt = WinRtGuard(unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.is_ok());
        let Ok(manager) = PackageManager::new() else {
            return;
        };
        let Ok(packages) = manager.FindPackagesByUserSecurityId(&HSTRING::new()) else {
            return;
        };
        let Ok(iterator) = packages.First() else {
            return;
        };
        while iterator.HasCurrent().unwrap_or(false) {
            if let Ok(package) = iterator.Current()
                && let Ok(id) = package.Id()
                && let Ok(family) = id.FamilyName()
            {
                let version = id.Version().ok().map(|version| {
                    format!(
                        "{}.{}.{}.{}",
                        version.Major, version.Minor, version.Build, version.Revision
                    )
                });
                let family = family.to_string();
                entries.push(InstalledSoftwareEntry {
                    registry_key: format!("AppX\\User\\{family}"),
                    display_name: None,
                    display_version: version,
                    install_location: None,
                });
            }
            if iterator.MoveNext().is_err() {
                break;
            }
        }
    }

    fn scan_uninstall_key(
        root: HKEY,
        subkey: &str,
        arp_prefix: &str,
        view_flag: u32,
        entries: &mut Vec<InstalledSoftwareEntry>,
    ) {
        let Ok(key) = open_key(root, subkey, view_flag) else {
            return;
        };
        let mut index = 0;
        loop {
            let mut name_buf = vec![0u16; 512];
            let mut name_len = name_buf.len() as u32;
            let status = unsafe {
                RegEnumKeyExW(
                    key.0,
                    index,
                    name_buf.as_mut_ptr(),
                    &mut name_len,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                )
            };
            if status == ERROR_NO_MORE_ITEMS {
                break;
            }
            index += 1;
            if status != ERROR_SUCCESS {
                continue;
            }
            let child = OsString::from_wide(&name_buf[..name_len as usize])
                .to_string_lossy()
                .into_owned();
            let child_path = format!("{subkey}\\{child}");
            let Ok(child_key) = open_key(root, &child_path, view_flag) else {
                continue;
            };
            let display_name = read_string_value(&child_key, "DisplayName");
            if display_name.as_deref().unwrap_or("").trim().is_empty() {
                continue;
            }
            let display_version = read_string_value(&child_key, "DisplayVersion");
            let install_location = read_string_value(&child_key, "InstallLocation")
                .filter(|value| !value.trim().is_empty());
            entries.push(InstalledSoftwareEntry {
                registry_key: child.clone(),
                display_name: display_name.clone(),
                display_version: display_version.clone(),
                install_location: install_location.clone(),
            });
            entries.push(InstalledSoftwareEntry {
                registry_key: format!("{arp_prefix}\\{child}"),
                display_name,
                display_version,
                install_location,
            });
        }
    }

    fn open_key(root: HKEY, subkey: &str, view_flag: u32) -> Result<RegistryKey, String> {
        let subkey = wide_null(subkey);
        let mut key: HKEY = std::ptr::null_mut();
        let status =
            unsafe { RegOpenKeyExW(root, subkey.as_ptr(), 0, KEY_READ | view_flag, &mut key) };
        if status != ERROR_SUCCESS {
            return Err(format!(
                "failed to open registry key: Windows error {status}"
            ));
        }
        Ok(RegistryKey(key))
    }

    fn read_string_value(key: &RegistryKey, name: &str) -> Option<String> {
        let value_name = wide_null(name);
        let mut value_type = 0;
        let mut byte_len = 0u32;
        let status = unsafe {
            RegQueryValueExW(
                key.0,
                value_name.as_ptr(),
                std::ptr::null_mut(),
                &mut value_type,
                std::ptr::null_mut(),
                &mut byte_len,
            )
        };
        if status != ERROR_SUCCESS || byte_len == 0 {
            return None;
        }
        if value_type != REG_SZ && value_type != REG_EXPAND_SZ {
            return None;
        }
        let mut data = vec![0u16; (byte_len as usize + 1) / 2];
        let status = unsafe {
            RegQueryValueExW(
                key.0,
                value_name.as_ptr(),
                std::ptr::null_mut(),
                &mut value_type,
                data.as_mut_ptr().cast::<u8>(),
                &mut byte_len,
            )
        };
        if status != ERROR_SUCCESS {
            return None;
        }
        let len = data.iter().position(|ch| *ch == 0).unwrap_or(data.len());
        Some(
            OsString::from_wide(&data[..len])
                .to_string_lossy()
                .into_owned(),
        )
    }

    fn wide_null(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain(Some(0)).collect()
    }
}

// ---- npm ---------------------------------------------------------------

pub(super) fn detect_npm(pkg: &str) -> DetectedState {
    let output = match command_output_with_refreshed_path(
        npm_program(),
        &["ls", "-g", "--json", "--depth=0"],
    ) {
        Some(o) => o,
        None => return DetectedState::not_installed(),
    };
    // npm ls returns non-zero on extraneous packages; trust stdout JSON.
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = match serde_json::from_str(&stdout) {
        Ok(v) => v,
        Err(_) => return DetectedState::not_installed(),
    };
    if let Some(deps) = parsed.get("dependencies").and_then(|v| v.as_object()) {
        if let Some(entry) = deps.get(pkg) {
            let version = entry
                .get("version")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            return DetectedState::installed(version);
        }
    }
    DetectedState::not_installed()
}

pub(super) fn detect_npm_provider(recipe: &Recipe) -> Option<DetectedState> {
    let Some(Provider::Npm { pkg }) = recipe.npm_provider.as_ref() else {
        return None;
    };
    let state = detect_npm(pkg);
    state.installed.then_some(state)
}

// ---- github-release ----------------------------------------------------

/// Github-release tools are installed by us into `%LOCALAPPDATA%\KKTerm\
/// installer\bin\<tool_id>\` with a `.kkterm-installer.json` marker
/// containing the installed version. Detection reads the marker. We do not
/// scan PATH for github-release tools — only installs we made ourselves
/// count as "managed". (The user can install separately and we'll just show
/// the tool as Available — they're free to keep both.)
fn detect_github_release_marker(tool_id: &str) -> DetectedState {
    let marker = github_release_marker_path(tool_id);
    let Ok(text) = std::fs::read_to_string(&marker) else {
        return DetectedState::not_installed();
    };
    let parsed: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => {
            return DetectedState::installed(None).with_install_location(Some(
                github_release_install_dir(tool_id)
                    .to_string_lossy()
                    .into_owned(),
            ));
        }
    };
    let version = parsed
        .get("version")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    DetectedState::installed(version).with_install_location(Some(
        github_release_install_dir(tool_id)
            .to_string_lossy()
            .into_owned(),
    ))
}

pub fn github_release_install_dir(tool_id: &str) -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("KKTerm")
        .join("installer")
        .join("bin")
        .join(tool_id)
}

pub fn github_release_marker_path(tool_id: &str) -> PathBuf {
    github_release_install_dir(tool_id).join(".kkterm-installer.json")
}

// ---- windows-feature ---------------------------------------------------

fn detect_windows_feature(feature: &str) -> DetectedState {
    if is_wsl_feature_name(feature) {
        return detect_wsl_base_feature(feature);
    }
    detect_windows_feature_with_dism(feature)
}

fn detect_windows_feature_with_dism(feature: &str) -> DetectedState {
    let output = match no_window(&mut Command::new("dism"))
        .args([
            "/online",
            "/get-featureinfo",
            &format!("/featurename:{feature}"),
            "/english",
        ])
        .output()
    {
        Ok(o) => o,
        Err(_) => return DetectedState::not_installed(),
    };
    if !output.status.success() {
        return DetectedState::not_installed();
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    windows_feature_state_from_dism_stdout(&stdout)
}

fn windows_feature_state_from_dism_stdout(stdout: &str) -> DetectedState {
    for line in stdout.lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("State :") {
            let state = value.trim().to_ascii_lowercase();
            return if state.contains("enabled") {
                DetectedState::installed(None)
            } else {
                DetectedState::not_installed()
            };
        }
    }
    DetectedState::not_installed()
}

fn detect_wsl_base_feature(feature: &str) -> DetectedState {
    let dism_state = detect_windows_feature_with_dism(feature);
    if dism_state.installed {
        return dism_state;
    }
    if wsl_command_reports_available(&["--status"])
        || wsl_command_reports_available(&["--list", "--quiet"])
    {
        DetectedState::installed(None)
    } else {
        DetectedState::not_installed()
    }
}

fn is_wsl_feature_name(feature: &str) -> bool {
    feature.eq_ignore_ascii_case("Microsoft-Windows-Subsystem-Linux")
}

fn wsl_command_reports_available(args: &[&str]) -> bool {
    let output = match no_window(&mut Command::new("wsl")).args(args).output() {
        Ok(output) => output,
        Err(_) => return false,
    };
    output.status.success() && (!output.stdout.is_empty() || !output.stderr.is_empty())
}

fn detect_wsl_distro(distro: &str) -> DetectedState {
    let output = match no_window(&mut Command::new("wsl"))
        .args(["--list", "--quiet"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return DetectedState::not_installed(),
    };
    if !output.status.success() {
        return DetectedState::not_installed();
    }
    if parse_wsl_distro_list(&output.stdout)
        .iter()
        .any(|name| name.eq_ignore_ascii_case(distro))
    {
        DetectedState::installed(None)
    } else {
        DetectedState::not_installed()
    }
}

fn parse_wsl_distro_list(bytes: &[u8]) -> Vec<String> {
    super::wsl::decode_wsl_output(bytes)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

// Marker file shape used by install.rs.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubReleaseMarker {
    pub tool_id: String,
    pub version: Option<String>,
    pub installed_at: i64,
    pub layout: GithubReleaseLayout,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn winget_recipe_with_detection(
        winget_id: &str,
        registry_keys: &[&str],
        display_names: &[&str],
        display_name_prefixes: &[&str],
    ) -> Recipe {
        Recipe {
            id: "test".into(),
            name: "Test".into(),
            section: super::super::schema::RecipeSection::Internal,
            description_en: String::new(),
            description_locales: HashMap::new(),
            needs: vec![],
            icon: None,
            category: None,
            provider: Provider::Winget {
                id: winget_id.into(),
            },
            download_provider: None,
            chocolatey_provider: None,
            npm_provider: None,
            options: vec![],
            homepage: None,
            release_notes_url: None,
            detection: Detection {
                registry_keys: registry_keys.iter().map(|value| (*value).into()).collect(),
                display_names: display_names.iter().map(|value| (*value).into()).collect(),
                display_name_prefixes: display_name_prefixes
                    .iter()
                    .map(|value| (*value).into())
                    .collect(),
                appx_package_family_names: vec![],
            },
        }
    }

    #[test]
    fn bundle_state_reports_partial_counts() {
        let installed = DetectedState::installed(Some("1.0.0".into()));
        let missing = DetectedState::not_installed();
        let state = bundle_detected_state("test-bundle", &[&installed, &missing], 3);

        assert!(!state.installed);
        assert_eq!(state.partial_count, Some((1, 3)));
    }

    #[test]
    fn appx_family_alias_matches_store_package_without_arp_entry() {
        let detection = Detection {
            appx_package_family_names: vec!["OpenAI.Codex_2p2nqsd0c76g0".into()],
            ..Detection::default()
        };
        let entry = InstalledSoftwareEntry {
            registry_key: "AppX\\User\\OpenAI.Codex_2p2nqsd0c76g0".into(),
            display_name: Some("ChatGPT".into()),
            display_version: Some("26.707.9981.0".into()),
            install_location: None,
        };

        assert!(installed_entry_matches("codex-desktop", &detection, &entry));
    }

    #[test]
    fn bundle_state_reports_installed_when_all_steps_are_installed() {
        let first = DetectedState::installed(Some("1.0.0".into()));
        let second = DetectedState::installed(Some("2.0.0".into()));
        let state = bundle_detected_state("test-bundle", &[&first, &second], 2);

        assert!(state.installed);
        assert_eq!(state.installed_version, None);
        assert_eq!(state.partial_count, None);
    }

    #[test]
    fn bundle_state_inherits_single_step_version() {
        let child = DetectedState::installed(Some("1.0.0".into()));
        let state = bundle_detected_state("test-bundle", &[&child], 1);

        assert!(state.installed);
        assert_eq!(state.installed_version.as_deref(), Some("1.0.0"));
    }

    #[test]
    fn runtime_bundle_reports_partial_when_manager_exists_without_runtime() {
        let manager = DetectedState::installed(Some("1.0.0".into()));
        let state = runtime_bundle_detected_state(&[&manager], |_| None);

        assert!(!state.installed);
        assert_eq!(state.partial_count, Some((1, 2)));
    }

    #[test]
    fn runtime_bundle_reports_runtime_version() {
        let manager = DetectedState::installed(Some("1.0.0".into()));
        let state = runtime_bundle_detected_state(&[&manager], |_| Some("3.13.5".into()));

        assert!(state.installed);
        assert_eq!(state.installed_version.as_deref(), Some("1.0.0"));
        assert_eq!(state.runtime_version.as_deref(), Some("3.13.5"));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn managed_app_marker_reports_app_local_install_location() {
        let location = managed_app_install_dir("n8n");

        assert!(location.ends_with(r"installer\apps\n8n"));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn antigravity_cli_install_path_matches_google_installer_location() {
        let base = PathBuf::from(r"C:\Users\Ryan\AppData\Local");
        let path = antigravity_cli_exe_path_from_local_data(&base);

        assert!(path.ends_with(r"agy\bin\agy.exe"));
    }

    #[test]
    fn parse_version_line_trims_node_prefix() {
        assert_eq!(parse_version_line("v24.11.1\n").as_deref(), Some("24.11.1"));
        assert_eq!(
            parse_version_line("Python 3.13.5\n").as_deref(),
            Some("3.13.5")
        );
    }

    #[test]
    fn parse_version_line_extracts_uv_cli_version() {
        assert_eq!(
            parse_version_line("uv 0.11.29 (be17d132a 2026-03-18)\n").as_deref(),
            Some("0.11.29")
        );
        assert_eq!(
            parse_version_line("PowerShell 7.5.0\n").as_deref(),
            Some("7.5.0")
        );
    }

    #[test]
    fn oh_my_posh_has_cli_detection_fallback() {
        assert_eq!(
            winget_cli_fallback_command("oh-my-posh"),
            Some(("oh-my-posh", &["version"][..]))
        );
        assert_eq!(winget_cli_fallback_command("git"), None);
    }

    #[test]
    fn powershell_7_has_cli_detection_fallback() {
        assert_eq!(
            winget_cli_fallback_command("powershell-7"),
            Some(("pwsh", &["--version"][..]))
        );
    }

    #[test]
    fn standalone_uv_detection_requires_astral_receipt() {
        let temp = tempfile::tempdir().expect("temp dir");
        let bin = temp.path().join("bin");
        std::fs::create_dir(&bin).unwrap();
        let executable = bin.join(format!("uv{}", std::env::consts::EXE_SUFFIX));
        std::fs::write(&executable, b"test").unwrap();

        assert_eq!(
            standalone_uv_executable_with_receipt_bin_dir(&bin, None),
            None
        );

        std::fs::write(bin.join("uv-receipt.json"), b"{}").unwrap();
        assert_eq!(
            standalone_uv_executable_with_receipt_bin_dir(&bin, None),
            Some(executable)
        );
    }

    #[test]
    fn standalone_uv_detection_accepts_config_receipt_install_prefix() {
        let temp = tempfile::tempdir().expect("temp dir");
        let bin = temp.path().join("bin");
        std::fs::create_dir(&bin).unwrap();
        let executable = bin.join(format!("uv{}", std::env::consts::EXE_SUFFIX));
        std::fs::write(&executable, b"test").unwrap();

        // install.ps1 writes the receipt under %LOCALAPPDATA%\uv, not next to
        // uv.exe; the prefix match must tolerate mixed separators and casing.
        let receipt_dir = PathBuf::from(
            bin.to_string_lossy()
                .replace('\\', "/")
                .to_ascii_uppercase(),
        );
        assert_eq!(
            standalone_uv_executable_with_receipt_bin_dir(&bin, Some(&receipt_dir)),
            Some(executable)
        );

        let unrelated = temp.path().join("unrelated");
        assert_eq!(
            standalone_uv_executable_with_receipt_bin_dir(&bin, Some(&unrelated)),
            None
        );
    }

    #[test]
    fn astral_uv_receipt_paths_prefer_xdg_config_home() {
        let paths = astral_uv_receipt_paths(
            Some(std::ffi::OsStr::new("xdg-config")),
            Some(std::ffi::OsStr::new("local-app-data")),
        );

        assert_eq!(
            paths,
            vec![
                PathBuf::from("xdg-config")
                    .join("uv")
                    .join("uv-receipt.json"),
                PathBuf::from("local-app-data")
                    .join("uv")
                    .join("uv-receipt.json"),
            ]
        );
    }

    #[test]
    fn astral_uv_receipt_bin_dir_honors_install_layout() {
        let flat = r#"{"install_prefix":"C:\\Users\\User\\.local/bin","install_layout":"flat"}"#;
        assert_eq!(
            astral_uv_receipt_bin_dir_from_json(flat),
            Some(PathBuf::from(r"C:\Users\User\.local/bin"))
        );

        let cargo_home =
            r#"{"install_prefix":"C:\\Users\\User\\.cargo","install_layout":"cargo-home"}"#;
        assert_eq!(
            astral_uv_receipt_bin_dir_from_json(cargo_home),
            Some(PathBuf::from(r"C:\Users\User\.cargo").join("bin"))
        );

        assert_eq!(astral_uv_receipt_bin_dir_from_json("{}"), None);
        assert_eq!(astral_uv_receipt_bin_dir_from_json("not json"), None);
    }

    #[test]
    fn standalone_uv_candidates_cover_custom_default_legacy_and_path_locations() {
        let separator = if cfg!(target_os = "windows") {
            ";"
        } else {
            ":"
        };
        let current_path = format!("path-one{separator}path-two");
        let refreshed_path = format!("path-two{separator}persisted-path");
        let candidates = standalone_uv_bin_path_candidates(
            Some(std::ffi::OsStr::new(&current_path)),
            Some(&refreshed_path),
            Some(std::ffi::OsStr::new("custom-uv")),
            Some(std::ffi::OsStr::new("user-profile")),
            None,
        );

        assert_eq!(candidates[0], PathBuf::from("custom-uv"));
        assert!(candidates.contains(&PathBuf::from("user-profile/.local/bin")));
        assert!(candidates.contains(&PathBuf::from("user-profile/.cargo/bin")));
        assert!(candidates.contains(&PathBuf::from("path-one")));
        assert!(candidates.contains(&PathBuf::from("persisted-path")));
        assert_eq!(
            candidates
                .iter()
                .filter(|path| **path == PathBuf::from("path-two"))
                .count(),
            1
        );
    }

    #[test]
    fn runtime_bundle_propagates_manager_install_source() {
        let manager = DetectedState::installed(Some("0.11.29".into()))
            .with_install_source(Some("officialScript"));
        let state = runtime_bundle_detected_state(&[&manager], |_| Some("3.13.5".into()));

        assert!(state.installed);
        assert_eq!(state.install_source.as_deref(), Some("officialScript"));
        assert_eq!(state.runtime_version.as_deref(), Some("3.13.5"));
    }

    #[test]
    fn dism_feature_state_parses_enabled_state() {
        let state = windows_feature_state_from_dism_stdout(
            "Feature Name : Microsoft-Windows-Subsystem-Linux\r\nState : Enabled\r\n",
        );

        assert!(state.installed);
    }

    #[test]
    fn dism_feature_state_without_enabled_state_is_not_installed() {
        let state = windows_feature_state_from_dism_stdout(
            "Feature Name : Microsoft-Windows-Subsystem-Linux\r\nState : Disabled\r\n",
        );

        assert!(!state.installed);
    }

    #[test]
    fn wsl_distro_list_parser_decodes_utf16_output() {
        let bytes = [
            0x55, 0x00, 0x62, 0x00, 0x75, 0x00, 0x6e, 0x00, 0x74, 0x00, 0x75, 0x00, 0x0d, 0x00,
            0x0a, 0x00,
        ];

        assert_eq!(parse_wsl_distro_list(&bytes), vec!["Ubuntu"]);
    }

    #[test]
    fn command_output_falls_back_to_refreshed_path() {
        let unique = format!("kkterm-detect-path-fallback-{}", std::process::id());
        let temp_dir = std::env::temp_dir().join(&unique);
        std::fs::create_dir_all(&temp_dir).unwrap();

        #[cfg(target_os = "windows")]
        let (program, script_path, script) = (
            format!("{unique}.cmd"),
            temp_dir.join(format!("{unique}.cmd")),
            "@echo off\r\necho v24.11.1\r\n".to_string(),
        );
        #[cfg(not(target_os = "windows"))]
        let (program, script_path, script) = (
            unique.clone(),
            temp_dir.join(&unique),
            "#!/bin/sh\necho v24.11.1\n".to_string(),
        );

        std::fs::write(&script_path, script).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(&script_path).unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&script_path, permissions).unwrap();
        }

        let output = command_output_with_path_fallback(&program, &[], || {
            Some(temp_dir.to_string_lossy().into_owned())
        })
        .expect("fallback PATH should resolve the test command");

        let _ = std::fs::remove_file(&script_path);
        let _ = std::fs::remove_dir(&temp_dir);

        assert!(output.status.success());
        assert_eq!(
            parse_version_line(&String::from_utf8_lossy(&output.stdout)).as_deref(),
            Some("24.11.1")
        );
    }

    #[test]
    fn official_cli_install_specs_cover_kimi_code_and_grok_build() {
        assert_eq!(
            official_cli_install_spec("kimi-code-cli"),
            Some(("kimi", ".kimi-code\\bin\\kimi.exe"))
        );
        assert_eq!(
            official_cli_install_spec("grok-build"),
            Some(("grok", ".grok\\bin\\grok.exe"))
        );
        assert_eq!(official_cli_install_spec("unknown"), None);
    }

    #[test]
    fn cursor_cli_detection_checks_only_official_command_shims() {
        let local_app_data = Path::new("local-app-data");
        assert_eq!(
            cursor_cli_command_candidates(local_app_data),
            ["agent.cmd", "cursor-agent.cmd"]
                .into_iter()
                .map(|name| local_app_data.join("cursor-agent").join(name))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn official_cli_version_parser_extracts_version_tokens() {
        assert_eq!(
            version_token_from_line("kimi-code 0.27.0").as_deref(),
            Some("0.27.0")
        );
        assert_eq!(
            version_token_from_line("grok v0.2.103").as_deref(),
            Some("0.2.103")
        );
        assert_eq!(version_token_from_line("unknown"), None);
    }

    #[test]
    fn installed_software_match_uses_registry_key_alias() {
        let recipe = winget_recipe_with_detection("Git.Git", &["Git_is1"], &[], &[]);
        let snapshot = InstalledSoftwareSnapshot {
            entries: vec![InstalledSoftwareEntry {
                registry_key: "Git_is1".into(),
                display_name: Some("Git".into()),
                display_version: Some("2.53.0.2".into()),
                install_location: None,
            }],
        };

        let state = detect_installed_software(&recipe, &snapshot);

        assert!(state.installed);
        assert_eq!(state.installed_version.as_deref(), Some("2.53.0.2"));
    }

    #[test]
    fn installed_software_match_accepts_full_arp_registry_alias() {
        let recipe =
            winget_recipe_with_detection("Git.Git", &["ARP\\Machine\\X64\\Git_is1"], &[], &[]);
        let snapshot = InstalledSoftwareSnapshot {
            entries: vec![InstalledSoftwareEntry {
                registry_key: "ARP\\Machine\\X64\\Git_is1".into(),
                display_name: Some("Git".into()),
                display_version: Some("2.53.0.2".into()),
                install_location: None,
            }],
        };

        let state = detect_installed_software(&recipe, &snapshot);

        assert!(state.installed);
        assert_eq!(state.installed_version.as_deref(), Some("2.53.0.2"));
    }

    #[test]
    fn installed_software_match_uses_exact_display_name_alias() {
        let recipe = winget_recipe_with_detection(
            "Microsoft.VisualStudioCode",
            &[],
            &["Microsoft Visual Studio Code"],
            &[],
        );
        let snapshot = InstalledSoftwareSnapshot {
            entries: vec![InstalledSoftwareEntry {
                registry_key: "{ignored}".into(),
                display_name: Some("Microsoft Visual Studio Code".into()),
                display_version: Some("1.122.1".into()),
                install_location: Some(
                    "C:\\Users\\ryan\\AppData\\Local\\Programs\\Microsoft VS Code".into(),
                ),
            }],
        };

        let state = detect_installed_software(&recipe, &snapshot);

        assert!(state.installed);
        assert_eq!(state.installed_version.as_deref(), Some("1.122.1"));
        assert_eq!(
            state.install_location.as_deref(),
            Some("C:\\Users\\ryan\\AppData\\Local\\Programs\\Microsoft VS Code")
        );
    }

    #[test]
    fn installed_software_match_accepts_vscode_user_display_name() {
        let recipe = winget_recipe_with_detection(
            "Microsoft.VisualStudioCode",
            &["{EA457B21-F73E-494C-ACAB-524FDE069978}_is1"],
            &["Microsoft Visual Studio Code"],
            &[],
        );
        let snapshot = InstalledSoftwareSnapshot {
            entries: vec![InstalledSoftwareEntry {
                registry_key: "ARP\\User\\X64\\{EA457B21-F73E-494C-ACAB-524FDE069978}_is1".into(),
                display_name: Some("Microsoft Visual Studio Code (User)".into()),
                display_version: Some("1.122.1".into()),
                install_location: Some(
                    "C:\\Users\\ryan\\AppData\\Local\\Programs\\Microsoft VS Code".into(),
                ),
            }],
        };

        let state = detect_installed_software(&recipe, &snapshot);

        assert!(state.installed);
        assert_eq!(state.installed_version.as_deref(), Some("1.122.1"));
        assert_eq!(
            state.install_location.as_deref(),
            Some("C:\\Users\\ryan\\AppData\\Local\\Programs\\Microsoft VS Code")
        );
    }

    #[test]
    fn installed_software_match_accepts_user_display_name_suffix_for_any_exact_alias() {
        let recipe = winget_recipe_with_detection("Anysphere.Cursor", &[], &["Cursor"], &[]);
        let snapshot = InstalledSoftwareSnapshot {
            entries: vec![InstalledSoftwareEntry {
                registry_key: "ARP\\User\\X64\\Cursor_is1".into(),
                display_name: Some("Cursor (User)".into()),
                display_version: Some("3.6.21".into()),
                install_location: Some("C:\\Users\\ryan\\AppData\\Local\\Programs\\Cursor".into()),
            }],
        };

        let state = detect_installed_software(&recipe, &snapshot);

        assert!(state.installed);
        assert_eq!(state.installed_version.as_deref(), Some("3.6.21"));
        assert_eq!(
            state.install_location.as_deref(),
            Some("C:\\Users\\ryan\\AppData\\Local\\Programs\\Cursor")
        );
        assert_eq!(state.install_scope, Some(InstallScope::User));
    }

    #[test]
    fn installed_software_match_prefers_user_install_over_global_install() {
        let recipe = winget_recipe_with_detection("Anysphere.Cursor", &[], &["Cursor"], &[]);
        let snapshot = InstalledSoftwareSnapshot {
            entries: vec![
                InstalledSoftwareEntry {
                    registry_key: "ARP\\Machine\\X64\\Cursor_is1".into(),
                    display_name: Some("Cursor".into()),
                    display_version: Some("3.6.21".into()),
                    install_location: Some("C:\\Program Files\\Cursor".into()),
                },
                InstalledSoftwareEntry {
                    registry_key: "ARP\\User\\X64\\Cursor_is1".into(),
                    display_name: Some("Cursor (User)".into()),
                    display_version: Some("3.6.21".into()),
                    install_location: Some(
                        "C:\\Users\\ryan\\AppData\\Local\\Programs\\Cursor".into(),
                    ),
                },
            ],
        };

        let state = detect_installed_software(&recipe, &snapshot);

        assert!(state.installed);
        assert_eq!(state.installed_version.as_deref(), Some("3.6.21"));
        assert_eq!(
            state.install_location.as_deref(),
            Some("C:\\Users\\ryan\\AppData\\Local\\Programs\\Cursor")
        );
    }

    #[test]
    fn installed_software_match_prefers_newer_global_install_over_stale_user_install() {
        let recipe = winget_recipe_with_detection(
            "Notepad++.Notepad++",
            &[],
            &["Notepad++", "Notepad++ (64-bit x64)"],
            &[],
        );
        let snapshot = InstalledSoftwareSnapshot {
            entries: vec![
                InstalledSoftwareEntry {
                    registry_key: "ARP\\User\\X64\\Notepad++.Notepad++_Microsoft.Winget.Source_8wekyb3d8bbwe"
                        .into(),
                    display_name: Some("Notepad++".into()),
                    display_version: Some("8.9.6.4".into()),
                    install_location: Some(
                        "C:\\Users\\ryan\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Notepad++.Notepad++_Microsoft.Winget.Source_8wekyb3d8bbwe"
                            .into(),
                    ),
                },
                InstalledSoftwareEntry {
                    registry_key: "ARP\\Machine\\X64\\Notepad++".into(),
                    display_name: Some("Notepad++ (64-bit x64)".into()),
                    display_version: Some("8.9.7".into()),
                    install_location: Some("C:\\Program Files\\Notepad++".into()),
                },
            ],
        };

        let state = detect_installed_software(&recipe, &snapshot);

        assert!(state.installed);
        assert_eq!(state.installed_version.as_deref(), Some("8.9.7"));
        assert_eq!(state.install_scope, Some(InstallScope::Machine));
        assert_eq!(
            state.install_location.as_deref(),
            Some("C:\\Program Files\\Notepad++")
        );
    }

    #[test]
    fn installed_software_match_uses_display_name_prefix_alias() {
        let recipe = winget_recipe_with_detection(
            "CoreyButler.NVMforWindows",
            &[],
            &[],
            &["NVM for Windows"],
        );
        let snapshot = InstalledSoftwareSnapshot {
            entries: vec![InstalledSoftwareEntry {
                registry_key: "nvm".into(),
                display_name: Some("NVM for Windows 1.2.2".into()),
                display_version: Some("1.2.2".into()),
                install_location: None,
            }],
        };

        let state = detect_installed_software(&recipe, &snapshot);

        assert!(state.installed);
        assert_eq!(state.installed_version.as_deref(), Some("1.2.2"));
    }

    #[test]
    fn krita_detection_accepts_versioned_machine_display_name() {
        let catalog = crate::installer::catalog::load_bundled_catalog().unwrap();
        let recipe = catalog
            .recipes
            .iter()
            .find(|recipe| recipe.id == "krita")
            .expect("catalog should include Krita");
        let snapshot = InstalledSoftwareSnapshot {
            entries: vec![InstalledSoftwareEntry {
                registry_key: "ARP\\Machine\\X64\\Krita_x64".into(),
                display_name: Some("Krita (x64) 5.3.2.1 (git 0619060)".into()),
                display_version: Some("5.3.2.1".into()),
                install_location: Some("C:\\Program Files\\Krita (x64)".into()),
            }],
        };

        let state = detect_installed_software(recipe, &snapshot);

        assert!(state.installed);
        assert_eq!(state.installed_version.as_deref(), Some("5.3.2.1"));
        assert_eq!(state.install_scope, Some(InstallScope::Machine));
        assert_eq!(
            state.install_location.as_deref(),
            Some("C:\\Program Files\\Krita (x64)")
        );
    }

    #[test]
    fn powershell_7_detection_accepts_versioned_display_name_prefix() {
        let catalog = crate::installer::catalog::load_bundled_catalog().unwrap();
        let recipe = catalog
            .recipes
            .iter()
            .find(|recipe| recipe.id == "powershell-7")
            .expect("catalog should include PowerShell 7");
        let snapshot = InstalledSoftwareSnapshot {
            entries: vec![InstalledSoftwareEntry {
                registry_key: "ARP\\Machine\\X64\\{7B031DCF-BDCE-47D6-89B9-4C558D76E773}".into(),
                display_name: Some("PowerShell 7.6.3.0-x64".into()),
                display_version: Some("7.6.3.0".into()),
                install_location: Some("C:\\Program Files\\PowerShell\\7".into()),
            }],
        };

        let state = detect_installed_software(recipe, &snapshot);

        assert!(state.installed);
        assert_eq!(state.installed_version.as_deref(), Some("7.6.3.0"));
        assert_eq!(
            state.install_location.as_deref(),
            Some("C:\\Program Files\\PowerShell\\7")
        );
    }

    #[test]
    fn opencode_cli_detection_ignores_desktop_app_registry_entry() {
        let catalog = crate::installer::catalog::load_bundled_catalog().unwrap();
        let recipe = catalog
            .recipes
            .iter()
            .find(|recipe| recipe.id == "opencode")
            .expect("catalog should include OpenCode CLI");
        let snapshot = InstalledSoftwareSnapshot {
            entries: vec![
                InstalledSoftwareEntry {
                    registry_key: "ARP\\User\\X64\\d074f30d-5f88-5885-b075-be1348cc7676".into(),
                    display_name: Some("OpenCode 1.15.12".into()),
                    display_version: Some("1.15.12".into()),
                    install_location: None,
                },
                InstalledSoftwareEntry {
                    registry_key:
                        "ARP\\User\\X64\\SST.opencode_Microsoft.Winget.Source_8wekyb3d8bbwe"
                            .into(),
                    display_name: Some("opencode".into()),
                    display_version: Some("1.15.13".into()),
                    install_location: Some(
                        "C:\\Users\\ryan\\AppData\\Local\\Microsoft\\WinGet\\Packages\\SST.opencode_Microsoft.Winget.Source_8wekyb3d8bbwe"
                            .into(),
                    ),
                },
            ],
        };

        let state = detect_installed_software(recipe, &snapshot);

        assert!(state.installed);
        assert_eq!(state.installed_version.as_deref(), Some("1.15.13"));
        assert_eq!(
            state.install_location.as_deref(),
            Some(
                "C:\\Users\\ryan\\AppData\\Local\\Microsoft\\WinGet\\Packages\\SST.opencode_Microsoft.Winget.Source_8wekyb3d8bbwe"
            )
        );
        assert_eq!(state.install_scope, Some(InstallScope::User));
    }

    #[test]
    fn winget_portable_detected_by_source_key_despite_versioned_display_name() {
        // ripgrep's `.MSVC` package is portable: winget tracks it under a
        // `<id>_Microsoft.Winget.Source_…` ARP key whose DisplayName does not
        // exactly equal the catalog alias "ripgrep". Detection must still flag
        // it installed off the winget-source key.
        let recipe =
            winget_recipe_with_detection("BurntSushi.ripgrep.MSVC", &[], &["ripgrep"], &[]);
        let snapshot = InstalledSoftwareSnapshot {
            entries: vec![
                InstalledSoftwareEntry {
                    registry_key: "BurntSushi.ripgrep.MSVC_Microsoft.Winget.Source_8wekyb3d8bbwe"
                        .into(),
                    display_name: Some("ripgrep 14.1.1".into()),
                    display_version: Some("14.1.1".into()),
                    install_location: None,
                },
                InstalledSoftwareEntry {
                    registry_key:
                        "ARP\\User\\X64\\BurntSushi.ripgrep.MSVC_Microsoft.Winget.Source_8wekyb3d8bbwe"
                            .into(),
                    display_name: Some("ripgrep 14.1.1".into()),
                    display_version: Some("14.1.1".into()),
                    install_location: None,
                },
            ],
        };

        let state = detect_installed_software(&recipe, &snapshot);

        assert!(state.installed);
        assert_eq!(state.installed_version.as_deref(), Some("14.1.1"));
        assert_eq!(state.install_scope, Some(InstallScope::User));
    }

    #[test]
    fn winget_source_key_match_anchors_on_final_path_segment() {
        // A package id must not match another whose ARP child merely contains
        // it as a substring (`git` vs `digit_…`).
        assert!(registry_key_matches_winget_source(
            "git.git_microsoft.winget.source_8wekyb3d8bbwe",
            "Git.Git",
        ));
        assert!(!registry_key_matches_winget_source(
            "arp\\machine\\x64\\digit.tool_microsoft.winget.source_8wekyb3d8bbwe",
            "git",
        ));
        // A non-winget ARP key (a regular MSI) must not match by id alone.
        assert!(!registry_key_matches_winget_source("git_is1", "Git"));
    }

    #[test]
    fn installed_software_match_reports_machine_scope() {
        let recipe =
            winget_recipe_with_detection("Git.Git", &["ARP\\Machine\\X64\\Git_is1"], &[], &[]);
        let snapshot = InstalledSoftwareSnapshot {
            entries: vec![InstalledSoftwareEntry {
                registry_key: "ARP\\Machine\\X64\\Git_is1".into(),
                display_name: Some("Git".into()),
                display_version: Some("2.53.0.2".into()),
                install_location: None,
            }],
        };

        let state = detect_installed_software(&recipe, &snapshot);

        assert!(state.installed);
        assert_eq!(state.install_scope, Some(InstallScope::Machine));
    }
}
