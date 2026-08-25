// Per-provider "what's the latest available version of this tool" queries.
// Manual or opt-in-daily; never auto-installs.

use std::process::Command;

use serde::Deserialize;
use serde_json::json;

use super::detect::{
    detect_chocolatey_package, detect_npm_provider, detect_one, github_release_marker_path,
};
use super::proc::{decode_console_output, no_window};
use super::schema::{Catalog, Provider, Recipe};

pub type LatestVersionResult = Result<Option<String>, String>;

pub fn latest_version(recipe: &Recipe) -> LatestVersionResult {
    crate::logging::installer_helper_debug(
        "latest.one.start",
        &json!({ "toolId": recipe.id, "provider": provider_kind(&recipe.provider) }),
    );
    let provider = latest_provider_for_recipe(recipe);
    let provider_latest = || match provider {
        Provider::Winget { id } => winget_latest(id),
        Provider::Chocolatey { id } => chocolatey_latest(id),
        Provider::Npm { pkg } => npm_latest_for_recipe(pkg, recipe.release_notes_url.as_deref()),
        Provider::UvPip { package } => pypi_latest(package),
        Provider::DownloadInstaller { .. } => Ok(None),
        Provider::GithubRelease { repo, .. } => github_latest(repo),
        Provider::WindowsFeature { .. } => Ok(None),
        Provider::WslDistro { .. } => Ok(None),
        Provider::Bundle { .. } => Ok(None),
    };
    let result = if let Some(url) = official_cli_latest_url(&recipe.id, provider) {
        official_cli_latest(&recipe.id, url).or_else(|official_error| {
            provider_latest().map_err(|provider_error| {
                format!("{official_error}; provider fallback also failed: {provider_error}")
            })
        })
    } else {
        provider_latest()
    };
    match &result {
        Ok(latest) => crate::logging::installer_helper_debug(
            "latest.one.ok",
            &json!({ "toolId": recipe.id, "provider": provider_kind(&recipe.provider), "latestVersion": latest }),
        ),
        Err(error) => crate::logging::installer_helper_debug(
            "latest.one.error",
            &json!({ "toolId": recipe.id, "provider": provider_kind(&recipe.provider), "error": error }),
        ),
    }
    result
}

pub fn latest_version_in_catalog(recipe: &Recipe, catalog: &Catalog) -> LatestVersionResult {
    crate::logging::installer_helper_debug(
        "latest.catalog.start",
        &json!({ "toolId": recipe.id, "provider": provider_kind(&recipe.provider) }),
    );
    if let Provider::Bundle { steps } = &recipe.provider {
        if steps.len() == 1 {
            let child = catalog
                .recipes
                .iter()
                .find(|r| r.id == steps[0])
                .ok_or_else(|| format!("bundle step `{}` not found", steps[0]))?;
            if child.id == "uv" && detect_one(child).is_official_script_install() {
                // `uv self update` follows Astral's release channel, so use the
                // same upstream project for availability instead of WinGet's
                // independently published package metadata.
                return github_latest("astral-sh/uv");
            }
            return latest_version(child);
        }
        return Ok(None);
    }
    if recipe.id == "uv" && detect_one(recipe).is_official_script_install() {
        return github_latest("astral-sh/uv");
    }
    latest_version(recipe)
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

fn latest_provider_for_recipe(recipe: &Recipe) -> &Provider {
    if let Some(provider @ Provider::Chocolatey { id }) = recipe.chocolatey_provider.as_ref() {
        if detect_chocolatey_package(id).installed {
            return provider;
        }
    }
    if let Some(provider @ Provider::Npm { .. }) = recipe.npm_provider.as_ref() {
        if detect_npm_provider(recipe).is_some() {
            return provider;
        }
    }
    if let Some(provider @ Provider::GithubRelease { .. }) = recipe.download_provider.as_ref() {
        if github_release_marker_path(&recipe.id).exists() {
            return provider;
        }
    }
    if official_cli_latest_pointer_url(&recipe.id).is_some()
        && let Some(provider @ Provider::DownloadInstaller { .. }) =
            recipe.download_provider.as_ref()
        && detect_one(recipe).install_provider.as_deref() == Some("downloadInstaller")
    {
        return provider;
    }
    &recipe.provider
}

fn official_cli_latest_url(tool_id: &str, provider: &Provider) -> Option<&'static str> {
    if !matches!(provider, Provider::DownloadInstaller { .. }) {
        return None;
    }
    official_cli_latest_pointer_url(tool_id)
}

fn official_cli_latest_pointer_url(tool_id: &str) -> Option<&'static str> {
    match tool_id {
        "kimi-code-cli" => Some("https://code.kimi.com/kimi-code/latest"),
        "grok-build" => Some("https://x.ai/cli/stable"),
        _ => None,
    }
}

fn official_cli_latest(tool_id: &str, url: &str) -> LatestVersionResult {
    let client = crate::net::proxy::apply_blocking(reqwest::blocking::Client::builder())
        .user_agent("KKTerm-Installer/1")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| format!("latest-version client build failed: {error}"))?;
    let body = client
        .get(url)
        .send()
        .and_then(|response| response.error_for_status())
        .and_then(|response| response.text())
        .map_err(|error| {
            format!("official latest-version lookup for `{tool_id}` failed: {error}")
        })?;
    official_cli_version_pointer(&body)
        .map(Some)
        .ok_or_else(|| {
            format!("official latest-version lookup for `{tool_id}` returned an invalid version")
        })
}

fn official_cli_version_pointer(body: &str) -> Option<String> {
    let version = body.lines().next()?.trim().trim_start_matches('v');
    if version.is_empty()
        || !version.contains('.')
        || !version.chars().next().is_some_and(|ch| ch.is_ascii_digit())
        || !version
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '+'))
    {
        return None;
    }
    Some(version.to_string())
}

fn winget_latest(id: &str) -> LatestVersionResult {
    prefer_winget_source_latest(winget_source_latest(id), || winget_manifest_latest(id))
}

fn winget_source_latest(id: &str) -> LatestVersionResult {
    let output = no_window(&mut Command::new("winget"))
        .args(winget_show_args(id))
        .output()
        .map_err(|error| format!("failed to run winget show for `{id}`: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "winget show `{id}` failed: {}",
            command_error_text(&output.stderr, &output.stdout)
        ));
    }
    let stdout = decode_console_output(&output.stdout);
    if let Some(version) = winget_show_version_from_output(&stdout) {
        return Ok(Some(version));
    }
    Err(format!("winget show `{id}` did not report a Version line"))
}

fn prefer_winget_source_latest(
    source_latest: LatestVersionResult,
    manifest_lookup: impl FnOnce() -> LatestVersionResult,
) -> LatestVersionResult {
    let source_error = match source_latest {
        Ok(Some(version)) => return Ok(Some(version)),
        Ok(None) => None,
        Err(error) => Some(error),
    };

    match manifest_lookup() {
        Ok(version) => Ok(version),
        Err(manifest_error) => match source_error {
            Some(source_error) => Err(format!(
                "{source_error}; winget-pkgs fallback failed: {manifest_error}"
            )),
            None => Err(manifest_error),
        },
    }
}

#[derive(Deserialize)]
struct GithubContentEntry {
    name: String,
    #[serde(rename = "type")]
    kind: String,
}

fn winget_manifest_latest(id: &str) -> LatestVersionResult {
    let client = crate::net::proxy::apply_blocking(reqwest::blocking::Client::builder())
        .user_agent("KKTerm-Installer/1")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| format!("failed to create winget-pkgs client: {error}"))?;
    let entries: Vec<GithubContentEntry> = client
        .get(winget_manifest_versions_url(id)?)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(|error| format!("GitHub manifest lookup failed: {error}"))?;
    Ok(latest_winget_manifest_version_from_entries(&entries))
}

fn winget_manifest_versions_url(id: &str) -> Result<String, String> {
    let first = id
        .chars()
        .next()
        .ok_or_else(|| "winget id is empty".to_string())?
        .to_ascii_lowercase();
    let path = id
        .split('.')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("/");
    if path.is_empty() {
        return Err("winget id has no path segments".into());
    }
    Ok(format!(
        "https://api.github.com/repos/microsoft/winget-pkgs/contents/manifests/{first}/{path}?ref=master"
    ))
}

fn latest_winget_manifest_version_from_entries(entries: &[GithubContentEntry]) -> Option<String> {
    entries
        .iter()
        .filter(|entry| entry.kind == "dir")
        .map(|entry| entry.name.trim())
        .filter(|name| looks_like_winget_version_value(name))
        .max_by(|a, b| compare_winget_versions(a, b))
        .map(|version| version.to_string())
}

fn winget_show_version_from_output(stdout: &str) -> Option<String> {
    for line in stdout.lines() {
        let trimmed = line.trim();
        let Some((label, value)) = trimmed.split_once(':') else {
            continue;
        };
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        if (label.trim().eq_ignore_ascii_case("version") || looks_like_winget_version_value(value))
            && looks_like_winget_version_value(value)
        {
            return Some(value.to_string());
        }
    }
    None
}

fn looks_like_winget_version_value(value: &str) -> bool {
    value
        .chars()
        .next()
        .is_some_and(|first| first.is_ascii_digit())
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+'))
}

fn compare_winget_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let mut a_parts = a.split(['.', '-', '_', '+']);
    let mut b_parts = b.split(['.', '-', '_', '+']);
    loop {
        match (a_parts.next(), b_parts.next()) {
            (Some(a_part), Some(b_part)) => {
                let ordering = compare_winget_version_part(a_part, b_part);
                if !ordering.is_eq() {
                    return ordering;
                }
            }
            (Some(a_part), None) => {
                return if is_zero_version_remainder(a_part, a_parts) {
                    std::cmp::Ordering::Equal
                } else {
                    std::cmp::Ordering::Greater
                };
            }
            (None, Some(b_part)) => {
                return if is_zero_version_remainder(b_part, b_parts) {
                    std::cmp::Ordering::Equal
                } else {
                    std::cmp::Ordering::Less
                };
            }
            (None, None) => return std::cmp::Ordering::Equal,
        }
    }
}

pub(crate) fn installer_latest_is_newer(latest: &str, installed: &str) -> bool {
    compare_winget_versions(latest, installed).is_gt()
}

fn compare_winget_version_part(a: &str, b: &str) -> std::cmp::Ordering {
    match (a.parse::<u64>(), b.parse::<u64>()) {
        (Ok(a), Ok(b)) => a.cmp(&b),
        _ => a.to_ascii_lowercase().cmp(&b.to_ascii_lowercase()),
    }
}

fn is_zero_version_remainder<'a>(first: &str, mut rest: impl Iterator<Item = &'a str>) -> bool {
    first == "0" && rest.all(|part| part == "0")
}

fn winget_show_args(id: &str) -> Vec<&str> {
    vec![
        "show",
        "--id",
        id,
        "--exact",
        "--source",
        "winget",
        "--locale",
        "en-US",
        "--accept-source-agreements",
        "--disable-interactivity",
    ]
}

fn chocolatey_latest(id: &str) -> LatestVersionResult {
    let mut command = Command::new("choco");
    command.args(["search", id, "--exact", "--limit-output", "--no-progress"]);
    if let Some(path) = super::install::refreshed_path_public() {
        if !path.trim().is_empty() {
            command.env("PATH", path);
        }
    }
    let output = no_window(&mut command)
        .output()
        .map_err(|error| format!("failed to run choco search for `{id}`: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "choco search `{id}` failed: {}",
            command_error_text(&output.stderr, &output.stdout)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(chocolatey_version_from_limit_output(&stdout, id))
}

fn chocolatey_version_from_limit_output(output: &str, package_id: &str) -> Option<String> {
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

fn npm_latest(pkg: &str) -> LatestVersionResult {
    let client = crate::net::proxy::apply_blocking(reqwest::blocking::Client::builder())
        .user_agent("KKTerm-Installer/1")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| format!("failed to create npm registry client: {error}"))?;
    let body = client
        .get(npm_registry_url(pkg))
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.text())
        .map_err(|error| format!("npm registry lookup for `{pkg}` failed: {error}"))?;
    npm_latest_from_registry_document(&body)
        .ok_or_else(|| {
            format!("npm registry response for `{pkg}` did not include dist-tags.latest")
        })
        .map(Some)
}

fn npm_latest_for_recipe(pkg: &str, release_notes_url: Option<&str>) -> LatestVersionResult {
    if pkg.starts_with("github:") {
        return release_notes_url
            .and_then(github_releases_repo_from_url)
            .map(|repo| github_latest(&repo))
            .unwrap_or(Ok(None));
    }
    npm_latest(pkg)
}

fn npm_latest_from_registry_document(json: &str) -> Option<String> {
    let json: serde_json::Value = serde_json::from_str(json).ok()?;
    json.get("dist-tags")
        .and_then(|tags| tags.get("latest"))
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
        .map(|s| s.to_string())
}

fn npm_registry_url(pkg: &str) -> String {
    format!(
        "https://registry.npmjs.org/{}",
        encode_npm_package_name(pkg)
    )
}

fn github_releases_repo_from_url(url: &str) -> Option<String> {
    let path = url.strip_prefix("https://github.com/")?;
    let mut parts = path.split('/');
    let owner = parts.next()?.trim();
    let repo = parts.next()?.trim();
    let releases = parts.next()?.trim();
    if owner.is_empty() || repo.is_empty() || releases != "releases" {
        return None;
    }
    Some(format!("{owner}/{repo}"))
}

fn pypi_latest(package: &str) -> LatestVersionResult {
    let client = crate::net::proxy::apply_blocking(reqwest::blocking::Client::builder())
        .user_agent("KKTerm-Installer/1")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| format!("failed to create PyPI client: {error}"))?;
    let url = format!("https://pypi.org/pypi/{package}/json");
    let json: serde_json::Value = client
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(|error| format!("PyPI lookup for `{package}` failed: {error}"))?;
    json.get("info")
        .and_then(|info| info.get("version"))
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("PyPI response for `{package}` did not include info.version"))
        .map(Some)
}

fn encode_npm_package_name(pkg: &str) -> String {
    let mut encoded = String::with_capacity(pkg.len());
    for byte in pkg.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'@' => {
                encoded.push(byte as char)
            }
            _ => {
                encoded.push('%');
                encoded.push_str(&format!("{byte:02X}"));
            }
        }
    }
    encoded
}

fn github_latest(repo: &str) -> LatestVersionResult {
    let client = crate::net::proxy::apply_blocking(reqwest::blocking::Client::builder())
        .user_agent("KKTerm-Installer/1")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| format!("failed to create GitHub client: {error}"))?;
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let json: serde_json::Value = client
        .get(&url)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(|error| format!("GitHub release lookup for `{repo}` failed: {error}"))?;
    json.get("tag_name")
        .and_then(|v| v.as_str())
        .map(normalize_github_release_tag)
        .ok_or_else(|| format!("GitHub response for `{repo}` did not include tag_name"))
        .map(Some)
}

fn normalize_github_release_tag(tag: &str) -> String {
    tag.strip_prefix(['v', 'V'])
        .filter(|rest| rest.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .unwrap_or(tag)
        .to_string()
}

fn command_error_text(stderr: &[u8], stdout: &[u8]) -> String {
    let stderr = decode_console_output(stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }
    let stdout = decode_console_output(stdout).trim().to_string();
    if !stdout.is_empty() {
        return stdout;
    }
    "no output".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn official_cli_version_pointers_accept_current_release_shapes() {
        assert_eq!(
            official_cli_version_pointer("0.27.0\n"),
            Some("0.27.0".into())
        );
        assert_eq!(
            official_cli_version_pointer("v0.2.103\r\n"),
            Some("0.2.103".into())
        );
        assert_eq!(official_cli_version_pointer("not-a-version\n"), None);
        assert_eq!(official_cli_version_pointer("0.2.103<script>\n"), None);
    }

    #[test]
    fn grok_latest_channel_matches_the_selected_install_provider() {
        let winget = Provider::Winget {
            id: "xAI.GrokBuild".into(),
        };
        let official_script = Provider::DownloadInstaller {
            url: "https://x.ai/cli/install.ps1".into(),
            file_name: "grok-build-install.ps1".into(),
            arm64_url: None,
            arm64_file_name: None,
        };

        assert_eq!(official_cli_latest_url("grok-build", &winget), None);
        assert_eq!(
            official_cli_latest_url("grok-build", &official_script),
            Some("https://x.ai/cli/stable")
        );
    }

    #[test]
    fn npm_registry_document_returns_dist_tag_latest() {
        let json = r#"{
            "name": "@openai/codex",
            "dist-tags": {
                "latest": "0.42.0",
                "beta": "0.43.0-beta.1"
            }
        }"#;

        assert_eq!(
            npm_latest_from_registry_document(json),
            Some("0.42.0".to_string())
        );
    }

    #[test]
    fn npm_registry_document_without_latest_is_unknown() {
        let json = r#"{
            "name": "example",
            "dist-tags": {
                "beta": "1.0.0-beta.1"
            }
        }"#;

        assert_eq!(npm_latest_from_registry_document(json), None);
    }

    #[test]
    fn npm_registry_url_percent_encodes_scoped_package_slash() {
        assert_eq!(
            npm_registry_url("@anthropic-ai/claude-code"),
            "https://registry.npmjs.org/@anthropic-ai%2Fclaude-code"
        );
    }

    #[test]
    fn github_releases_repo_from_url_extracts_release_metadata_repo() {
        assert_eq!(
            github_releases_repo_from_url("https://github.com/alam00000/bentopdf/releases"),
            Some("alam00000/bentopdf".to_string())
        );
        assert_eq!(
            github_releases_repo_from_url(
                "https://github.com/alam00000/bentopdf/releases/tag/v2.8.5"
            ),
            Some("alam00000/bentopdf".to_string())
        );
        assert_eq!(
            github_releases_repo_from_url("https://github.com/goodtab/bentopdf"),
            None
        );
    }

    #[test]
    fn github_release_tag_normalizes_common_v_prefix() {
        assert_eq!(normalize_github_release_tag("v2.8.5"), "2.8.5");
        assert_eq!(normalize_github_release_tag("V2.8.5"), "2.8.5");
        assert_eq!(
            normalize_github_release_tag("release-2.8.5"),
            "release-2.8.5"
        );
    }

    #[test]
    fn winget_latest_accepts_source_agreements_for_first_run() {
        assert!(
            winget_show_args("Git.Git").contains(&"--accept-source-agreements"),
            "fresh Windows installs can fail noninteractive winget show until source agreements are accepted"
        );
    }

    #[test]
    fn winget_latest_requests_english_output_for_version_parsing() {
        assert!(
            winget_show_args("Git.Git")
                .windows(2)
                .any(|args| args == ["--locale", "en-US"]),
            "English output keeps winget parsing stable when the host honors it"
        );
    }

    #[test]
    fn winget_manifest_versions_url_maps_id_to_repository_path() {
        assert_eq!(
            winget_manifest_versions_url("Notepad++.Notepad++").unwrap(),
            "https://api.github.com/repos/microsoft/winget-pkgs/contents/manifests/n/Notepad++/Notepad++?ref=master"
        );
        assert_eq!(
            winget_manifest_versions_url("7zip.7zip").unwrap(),
            "https://api.github.com/repos/microsoft/winget-pkgs/contents/manifests/7/7zip/7zip?ref=master"
        );
    }

    #[test]
    fn configured_winget_source_wins_over_newer_manifest_repo() {
        let manifest_lookup_called = std::cell::Cell::new(false);
        let latest = prefer_winget_source_latest(Ok(Some("8.9.6.4".into())), || {
            manifest_lookup_called.set(true);
            Ok(Some("8.9.7".into()))
        });

        assert_eq!(latest.unwrap().as_deref(), Some("8.9.6.4"));
        assert!(!manifest_lookup_called.get());
    }

    #[test]
    fn winget_manifest_repo_is_fallback_when_configured_source_fails() {
        let latest = prefer_winget_source_latest(Err("winget source unavailable".into()), || {
            Ok(Some("8.9.7".into()))
        });

        assert_eq!(latest.unwrap().as_deref(), Some("8.9.7"));
    }

    #[test]
    fn latest_winget_manifest_version_uses_numeric_ordering() {
        let entries = vec![
            GithubContentEntry {
                name: ".validation".into(),
                kind: "dir".into(),
            },
            GithubContentEntry {
                name: "1.9.0".into(),
                kind: "dir".into(),
            },
            GithubContentEntry {
                name: "1.10.0".into(),
                kind: "dir".into(),
            },
            GithubContentEntry {
                name: "2.0.0".into(),
                kind: "file".into(),
            },
        ];

        assert_eq!(
            latest_winget_manifest_version_from_entries(&entries),
            Some("1.10.0".into())
        );
    }

    #[test]
    fn latest_winget_manifest_version_ignores_channel_directories() {
        let entries = vec![
            GithubContentEntry {
                name: "2.54.0".into(),
                kind: "dir".into(),
            },
            GithubContentEntry {
                name: "PreRelease".into(),
                kind: "dir".into(),
            },
            GithubContentEntry {
                name: "Insiders".into(),
                kind: "dir".into(),
            },
            GithubContentEntry {
                name: "Lite".into(),
                kind: "dir".into(),
            },
            GithubContentEntry {
                name: "Portable".into(),
                kind: "dir".into(),
            },
        ];

        assert_eq!(
            latest_winget_manifest_version_from_entries(&entries),
            Some("2.54.0".into())
        );
    }

    #[test]
    fn winget_show_version_parses_english_output() {
        let stdout = r#"Found uv [astral-sh.uv]
Version: 0.11.17
Publisher: Astral Software Inc.
"#;

        assert_eq!(
            winget_show_version_from_output(stdout),
            Some("0.11.17".to_string())
        );
    }

    #[test]
    fn winget_show_version_parses_traditional_chinese_output() {
        let stdout = r#"`msstore` 來源要求您必須先檢視下列合約，再使用。
Terms of Transaction: https://aka.ms/microsoft-store-terms-of-transaction
是否同意所有來源合約條款？
[Y] 是  [N] 否： y
找到 uv [astral-sh.uv]
版本: 0.11.17
發行者: Astral Software Inc.
"#;

        assert_eq!(
            winget_show_version_from_output(stdout),
            Some("0.11.17".to_string())
        );
    }

    #[test]
    fn winget_show_version_skips_non_version_urls() {
        let stdout = r#"Terms of Transaction: https://aka.ms/microsoft-store-terms-of-transaction
Publisher Url: https://github.com/astral-sh/uv/issues
Homepage: https://github.com/astral-sh/uv
"#;

        assert_eq!(winget_show_version_from_output(stdout), None);
    }

    #[test]
    fn winget_show_version_ignores_unknown_store_version() {
        let stdout = r#"Found Codex [9PLM9XGG6VKS]
Version: Unknown
Publisher: OpenAI
Installer:
  Installer Type: msstore
"#;

        assert_eq!(winget_show_version_from_output(stdout), None);
    }
}
