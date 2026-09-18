use crate::storage;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{
    ffi::{OsStr, OsString},
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{OnceLock, mpsc},
    time::{Duration, Instant},
};
use tauri_plugin_opener::OpenerExt;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

const PROVIDERS: [AiCodingUsageProvider; 2] = [
    AiCodingUsageProvider::Codex,
    AiCodingUsageProvider::ClaudeCode,
];
const PROVIDER_TIMEOUT: Duration = Duration::from_secs(180);
const CODEX_CHATGPT_DEFAULT_BASE_URL: &str = "https://chatgpt.com/backend-api";
const CODEX_CHATGPT_USAGE_PATH: &str = "/wham/usage";
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AiCodingUsageProvider {
    Codex,
    ClaudeCode,
}

impl AiCodingUsageProvider {
    fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::ClaudeCode => "claudeCode",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Codex => "Codex",
            Self::ClaudeCode => "Claude Code",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCodingUsageQuotaWindow {
    used_percent: Option<f64>,
    resets_at: Option<String>,
}

impl AiCodingUsageQuotaWindow {
    fn unknown() -> Self {
        Self {
            used_percent: None,
            resets_at: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCodingUsageProviderState {
    provider: AiCodingUsageProvider,
    auth_state: String,
    account_label: Option<String>,
    account_email: Option<String>,
    subscription_plan: Option<String>,
    five_hour: AiCodingUsageQuotaWindow,
    weekly: AiCodingUsageQuotaWindow,
    /// Capture time of the last successful quota snapshot.
    last_refresh_at: Option<String>,
    /// Last attempt, including failures; used for polling and rate-limit backoff.
    last_attempt_at: Option<String>,
    last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCodingUsageState {
    providers: Vec<AiCodingUsageProviderState>,
}

#[tauri::command]
pub async fn ai_coding_usage_load(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<AiCodingUsageState, String> {
    crate::storage::run_blocking_db(|| storage.with_connection(load_state))
}

#[tauri::command]
pub async fn ai_coding_usage_connect(
    app: tauri::AppHandle,
    storage: tauri::State<'_, storage::Storage>,
    provider: AiCodingUsageProvider,
) -> Result<AiCodingUsageProviderState, String> {
    let cli_paths = provider_cli_paths(&storage)?;
    let result = run_provider_connect(app, provider, cli_paths).await;
    crate::storage::run_blocking_db(|| {
        storage.with_connection_mut(|connection| {
            match result {
                Ok(update) => {
                    save_provider_update(connection, provider, update)?;
                }
                Err(error) => {
                    save_provider_error(connection, provider, &error)?;
                }
            }
            load_provider_state(connection, provider)
        })
    })
}

#[tauri::command]
pub async fn ai_coding_usage_refresh(
    storage: tauri::State<'_, storage::Storage>,
    provider: Option<AiCodingUsageProvider>,
) -> Result<AiCodingUsageState, String> {
    let providers = provider.map_or_else(|| PROVIDERS.to_vec(), |provider| vec![provider]);
    let cli_paths = provider_cli_paths(&storage)?;
    let mut updates = Vec::new();
    for provider in providers {
        updates.push((
            provider,
            run_provider_refresh(provider, cli_paths.clone()).await,
        ));
    }

    crate::storage::run_blocking_db(|| {
        storage.with_connection_mut(|connection| {
            for (provider, result) in updates {
                match result {
                    Ok(update) => save_provider_update(connection, provider, update)?,
                    Err(error) => save_provider_error(connection, provider, &error)?,
                }
            }
            load_state(connection)
        })
    })
}

#[tauri::command]
pub async fn ai_coding_usage_reconnect(
    app: tauri::AppHandle,
    storage: tauri::State<'_, storage::Storage>,
    provider: AiCodingUsageProvider,
) -> Result<AiCodingUsageProviderState, String> {
    let cli_paths = provider_cli_paths(&storage)?;
    let result = run_provider_reconnect(app, provider, cli_paths).await;
    crate::storage::run_blocking_db(|| {
        storage.with_connection_mut(|connection| {
            match result {
                Ok(update) => {
                    save_provider_update(connection, provider, update)?;
                }
                Err(error) => {
                    save_provider_error(connection, provider, &error)?;
                }
            }
            load_provider_state(connection, provider)
        })
    })
}

#[tauri::command]
pub async fn ai_coding_usage_disconnect(
    storage: tauri::State<'_, storage::Storage>,
    provider: AiCodingUsageProvider,
) -> Result<AiCodingUsageProviderState, String> {
    crate::storage::run_blocking_db(|| {
        storage.with_connection_mut(|connection| {
            connection
                .execute(
                    "DELETE FROM ai_coding_usage_accounts WHERE provider = ?1",
                    params![provider.as_str()],
                )
                .map_err(|error| format!("failed to remove usage account: {error}"))?;
            connection
                .execute(
                    "DELETE FROM ai_coding_usage_snapshots WHERE provider = ?1",
                    params![provider.as_str()],
                )
                .map_err(|error| format!("failed to remove usage snapshot: {error}"))?;
            Ok(disconnected_state(provider))
        })
    })
}

#[derive(Clone, Debug)]
struct ProviderUpdate {
    account_label: Option<String>,
    account_email: Option<String>,
    subscription_plan: Option<String>,
    auth_state: &'static str,
    snapshot: Option<ProviderSnapshot>,
    raw_provider_json: Option<Value>,
    /// Capture time, distinct from the attempt timestamp. None means "now".
    captured_at: Option<String>,
    last_error: Option<String>,
}

#[derive(Clone, Debug)]
struct ProviderSnapshot {
    five_hour: AiCodingUsageQuotaWindow,
    weekly: AiCodingUsageQuotaWindow,
}

#[derive(Clone, Debug, Default)]
struct ProviderCliPaths {
    claude: Option<String>,
    codex: Option<String>,
}

fn provider_cli_paths(storage: &storage::Storage) -> Result<ProviderCliPaths, String> {
    let settings = storage.ai_provider_settings()?;
    Ok(ProviderCliPaths {
        claude: settings.claude_cli_path().map(str::to_string),
        codex: settings.codex_cli_path().map(str::to_string),
    })
}

async fn run_provider_connect(
    app: tauri::AppHandle,
    provider: AiCodingUsageProvider,
    cli_paths: ProviderCliPaths,
) -> Result<ProviderUpdate, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_provider_connect_blocking(app, provider, &cli_paths)
    })
    .await
    .map_err(|error| format!("provider connect task failed: {error}"))?
}

async fn run_provider_refresh(
    provider: AiCodingUsageProvider,
    cli_paths: ProviderCliPaths,
) -> Result<ProviderUpdate, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_provider_refresh_blocking(provider, &cli_paths)
    })
    .await
    .map_err(|error| format!("provider refresh task failed: {error}"))?
}

async fn run_provider_reconnect(
    app: tauri::AppHandle,
    provider: AiCodingUsageProvider,
    cli_paths: ProviderCliPaths,
) -> Result<ProviderUpdate, String> {
    tauri::async_runtime::spawn_blocking(move || {
        match run_provider_refresh_blocking(provider, &cli_paths) {
            Ok(update) if provider_update_needs_reauth(&update) => {
                run_provider_connect_blocking(app, provider, &cli_paths)
            }
            Ok(update) => Ok(update),
            Err(error) if provider_error_needs_reauth(&error) => {
                run_provider_connect_blocking(app, provider, &cli_paths)
            }
            Err(error) => Err(error),
        }
    })
    .await
    .map_err(|error| format!("provider reconnect task failed: {error}"))?
}

fn run_provider_connect_blocking(
    app: tauri::AppHandle,
    provider: AiCodingUsageProvider,
    cli_paths: &ProviderCliPaths,
) -> Result<ProviderUpdate, String> {
    match provider {
        AiCodingUsageProvider::Codex => connect_codex(app, cli_paths),
        AiCodingUsageProvider::ClaudeCode => connect_claude(cli_paths),
    }
}

fn run_provider_refresh_blocking(
    provider: AiCodingUsageProvider,
    cli_paths: &ProviderCliPaths,
) -> Result<ProviderUpdate, String> {
    match provider {
        AiCodingUsageProvider::Codex => refresh_codex(cli_paths),
        AiCodingUsageProvider::ClaudeCode => refresh_claude(cli_paths),
    }
}

fn provider_update_needs_reauth(update: &ProviderUpdate) -> bool {
    update
        .last_error
        .as_deref()
        .is_some_and(provider_error_needs_reauth)
}

fn provider_error_needs_reauth(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("not logged in")
        || normalized.contains("not connected")
        || normalized.contains("token rejected")
        || normalized.contains("token revoked")
        || normalized.contains("token has expired")
        || normalized.contains("authentication_error")
        || normalized.contains("invalid authentication")
        || normalized.contains("invalid credentials")
        || normalized.contains("oauth token")
}

fn load_state(connection: &Connection) -> Result<AiCodingUsageState, String> {
    let providers = PROVIDERS
        .iter()
        .copied()
        .map(|provider| load_provider_state(connection, provider))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(AiCodingUsageState { providers })
}

fn load_provider_state(
    connection: &Connection,
    provider: AiCodingUsageProvider,
) -> Result<AiCodingUsageProviderState, String> {
    let row = connection
        .query_row(
            "SELECT account_label, account_email, subscription_plan, auth_state, last_refresh_at, last_error
             FROM ai_coding_usage_accounts
             WHERE provider = ?1",
            params![provider.as_str()],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("failed to load usage account: {error}"))?;

    let Some((
        account_label,
        account_email,
        subscription_plan,
        auth_state,
        last_attempt_at,
        last_error,
    )) = row
    else {
        return Ok(disconnected_state(provider));
    };

    let snapshot = connection
        .query_row(
            "SELECT five_hour_used_percent, five_hour_resets_at,
                    weekly_used_percent, weekly_resets_at, captured_at, raw_provider_json
             FROM ai_coding_usage_snapshots
             WHERE provider = ?1",
            params![provider.as_str()],
            |row| {
                Ok((
                    ProviderSnapshot {
                        five_hour: AiCodingUsageQuotaWindow {
                            used_percent: row.get(0)?,
                            resets_at: row.get(1)?,
                        },
                        weekly: AiCodingUsageQuotaWindow {
                            used_percent: row.get(2)?,
                            resets_at: row.get(3)?,
                        },
                    },
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("failed to load usage snapshot: {error}"))?;

    let snapshot = snapshot.and_then(|(mut snapshot, captured_at, raw)| {
        if provider == AiCodingUsageProvider::Codex {
            // Re-normalize old caches too. Rollouts have no verified account
            // binding and must not be relabeled as the currently signed-in user.
            let raw: Value = serde_json::from_str(raw.as_deref()?).ok()?;
            if raw.get("source").and_then(Value::as_str) == Some("codex_local_sessions") {
                return None;
            }
            snapshot = normalize_codex_rate_limits(&raw);
        }
        expire_reset_quota_windows(&mut snapshot, OffsetDateTime::now_utc());
        Some((snapshot, captured_at))
    });

    Ok(AiCodingUsageProviderState {
        provider,
        auth_state,
        account_label,
        account_email,
        subscription_plan,
        five_hour: snapshot
            .as_ref()
            .map(|(snapshot, _)| snapshot.five_hour.clone())
            .unwrap_or_else(AiCodingUsageQuotaWindow::unknown),
        weekly: snapshot
            .as_ref()
            .map(|(snapshot, _)| snapshot.weekly.clone())
            .unwrap_or_else(AiCodingUsageQuotaWindow::unknown),
        last_refresh_at: snapshot.map(|(_, captured_at)| captured_at),
        last_attempt_at,
        last_error,
    })
}

fn disconnected_state(provider: AiCodingUsageProvider) -> AiCodingUsageProviderState {
    AiCodingUsageProviderState {
        provider,
        auth_state: "disconnected".to_string(),
        account_label: None,
        account_email: None,
        subscription_plan: None,
        five_hour: AiCodingUsageQuotaWindow::unknown(),
        weekly: AiCodingUsageQuotaWindow::unknown(),
        last_refresh_at: None,
        last_attempt_at: None,
        last_error: None,
    }
}

fn save_provider_update(
    connection: &Connection,
    provider: AiCodingUsageProvider,
    update: ProviderUpdate,
) -> Result<(), String> {
    let now = now_rfc3339()?;
    let captured_at = update.captured_at.clone().unwrap_or_else(|| now.clone());
    // A successful auth check without quota cannot prove that an old snapshot
    // belongs to this login/organization. Clear it before relabeling the account.
    // Whole-refresh failures retain the old account and snapshot together.
    if update.snapshot.is_none() {
        connection
            .execute(
                "DELETE FROM ai_coding_usage_snapshots WHERE provider = ?1",
                params![provider.as_str()],
            )
            .map_err(|error| format!("failed to invalidate usage snapshot: {error}"))?;
    }
    let last_error = update.last_error.as_deref().map(scrub_provider_error);
    connection
        .execute(
            "INSERT INTO ai_coding_usage_accounts
                (provider, account_label, account_email, subscription_plan, auth_state, last_refresh_at, last_error, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT(provider) DO UPDATE SET
                account_label = excluded.account_label,
                account_email = excluded.account_email,
                subscription_plan = excluded.subscription_plan,
                auth_state = excluded.auth_state,
                last_refresh_at = excluded.last_refresh_at,
                last_error = excluded.last_error,
                updated_at = CURRENT_TIMESTAMP",
            params![
                provider.as_str(),
                update.account_label,
                update.account_email,
                update.subscription_plan,
                update.auth_state,
                now,
                last_error,
            ],
        )
        .map_err(|error| format!("failed to save usage account: {error}"))?;

    if let Some(snapshot) = update.snapshot {
        let raw_json = update
            .raw_provider_json
            .map(|value| scrub_sensitive_provider_json(&value))
            .and_then(|value| serde_json::to_string(&value).ok());
        connection
            .execute(
                "INSERT INTO ai_coding_usage_snapshots
                    (provider, five_hour_used_percent, five_hour_resets_at,
                     weekly_used_percent, weekly_resets_at, raw_provider_json, captured_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(provider) DO UPDATE SET
                    five_hour_used_percent = excluded.five_hour_used_percent,
                    five_hour_resets_at = excluded.five_hour_resets_at,
                    weekly_used_percent = excluded.weekly_used_percent,
                    weekly_resets_at = excluded.weekly_resets_at,
                    raw_provider_json = excluded.raw_provider_json,
                    captured_at = excluded.captured_at",
                params![
                    provider.as_str(),
                    snapshot.five_hour.used_percent,
                    snapshot.five_hour.resets_at,
                    snapshot.weekly.used_percent,
                    snapshot.weekly.resets_at,
                    raw_json,
                    captured_at
                ],
            )
            .map_err(|error| format!("failed to save usage snapshot: {error}"))?;
    }

    Ok(())
}

fn save_provider_error(
    connection: &Connection,
    provider: AiCodingUsageProvider,
    error: &str,
) -> Result<(), String> {
    let now = now_rfc3339()?;
    let scrubbed = scrub_provider_error(error);
    connection
        .execute(
            "INSERT INTO ai_coding_usage_accounts
                (provider, account_label, account_email, auth_state, last_refresh_at, last_error, created_at, updated_at)
             VALUES (?1, NULL, NULL, 'error', ?2, ?3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT(provider) DO UPDATE SET
                auth_state = CASE
                    WHEN auth_state = 'connected' THEN auth_state
                    ELSE 'error'
                END,
                last_refresh_at = excluded.last_refresh_at,
                last_error = excluded.last_error,
                updated_at = CURRENT_TIMESTAMP",
            params![provider.as_str(), now, scrubbed],
        )
        .map_err(|error| format!("failed to save usage error: {error}"))?;
    Ok(())
}

fn connect_codex(
    app: tauri::AppHandle,
    cli_paths: &ProviderCliPaths,
) -> Result<ProviderUpdate, String> {
    let mut session = CodexRpcSession::start(cli_paths)?;
    session.initialize()?;
    let login = session.request(json!({
        "method": "account/login/start",
        "id": 2,
        "params": { "type": "chatgpt" }
    }))?;
    let auth_url = login
        .pointer("/result/authUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| "Codex did not return an OAuth URL.".to_string())?;
    app.opener()
        .open_url(auth_url, None::<&str>)
        .map_err(|error| format!("failed to open Codex OAuth URL: {error}"))?;
    session.wait_for_notification("account/login/completed", PROVIDER_TIMEOUT)?;
    refresh_codex(cli_paths)
}

/// The app-server binds usage to its active account and handles managed auth.
/// Session rollouts cannot prove that their quota belongs to that account.
/// On failure, the stored account/snapshot remains visible with its original
/// capture time and an error; never rebind a rollout to a new login.
fn refresh_codex(cli_paths: &ProviderCliPaths) -> Result<ProviderUpdate, String> {
    match refresh_codex_app_server(cli_paths) {
        Ok(update) => Ok(update),
        Err(error) if provider_error_needs_reauth(&error) => Err(error),
        Err(app_server_error) => match refresh_codex_wham_usage() {
            Ok(update) => Ok(update),
            Err(wham_error) => Err(format!(
                "{app_server_error}; Codex direct usage fallback failed: {wham_error}"
            )),
        },
    }
}

/// A quota window whose reset moment already passed has rolled over server
/// side; the cached percentage no longer describes the current window.
fn expire_reset_quota_windows(snapshot: &mut ProviderSnapshot, now: OffsetDateTime) {
    for window in [&mut snapshot.five_hour, &mut snapshot.weekly] {
        let expired = window
            .resets_at
            .as_deref()
            .and_then(|resets_at| OffsetDateTime::parse(resets_at, &Rfc3339).ok())
            .is_some_and(|resets_at| resets_at <= now);
        if expired {
            window.used_percent = None;
            window.resets_at = None;
        }
    }
}

fn refresh_codex_app_server(cli_paths: &ProviderCliPaths) -> Result<ProviderUpdate, String> {
    let mut session = CodexRpcSession::start(cli_paths)?;
    session.initialize()?;
    let account = session.request(json!({
        "method": "account/read",
        "id": 2,
        "params": { "refreshToken": true }
    }))?;
    let account_value = account.pointer("/result/account").unwrap_or(&Value::Null);
    if account_value.is_null() {
        return Err("Codex is not connected.".to_string());
    }
    let email = account_value
        .get("email")
        .and_then(Value::as_str)
        .map(str::to_string);
    let plan = account_value
        .get("planType")
        .and_then(Value::as_str)
        .map(str::to_string);
    // API-key and cloud-provider accounts have no ChatGPT subscription quota.
    // Return an explicit empty snapshot rather than falling back to stale OAuth.
    if account_value.get("type").and_then(Value::as_str) != Some("chatgpt") {
        return Ok(ProviderUpdate {
            account_label: Some(AiCodingUsageProvider::Codex.label().to_string()),
            account_email: email,
            subscription_plan: plan,
            auth_state: "connected",
            snapshot: Some(normalize_codex_rate_limits(&Value::Null)),
            raw_provider_json: Some(json!({ "source": "unsupported_auth" })),
            captured_at: None,
            last_error: Some("Codex subscription quota requires ChatGPT sign-in, not API-key or cloud authentication.".to_string()),
        });
    }
    let rate_limits = session.request(json!({
        "method": "account/rateLimits/read",
        "id": 3,
        "params": {}
    }))?;
    let snapshot = normalize_codex_rate_limits(&rate_limits);
    Ok(ProviderUpdate {
        account_label: email
            .clone()
            .or_else(|| plan.clone())
            .or_else(|| Some(AiCodingUsageProvider::Codex.label().to_string())),
        account_email: email,
        subscription_plan: plan,
        auth_state: "connected",
        snapshot: Some(snapshot),
        raw_provider_json: Some(rate_limits),
        captured_at: None,
        last_error: None,
    })
}

#[derive(Debug)]
struct CodexWhamCredentials {
    access_token: String,
    account_id: Option<String>,
}

fn refresh_codex_wham_usage() -> Result<ProviderUpdate, String> {
    let credentials = read_codex_wham_credentials()?;
    let url = format!(
        "{}{}",
        resolve_codex_chatgpt_base_url(),
        CODEX_CHATGPT_USAGE_PATH
    );
    let client = crate::net::proxy::apply_blocking(reqwest::blocking::Client::builder())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("failed to build Codex direct usage client: {error}"))?;
    let mut request = client
        .get(url)
        .bearer_auth(credentials.access_token)
        .header("Accept", "application/json")
        .header("User-Agent", "KKTerm");
    if let Some(account_id) = credentials.account_id.as_deref() {
        request = request.header("ChatGPT-Account-Id", account_id);
    }
    let response = request
        .send()
        .map_err(|error| format!("Codex direct usage request failed: {error}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err("Codex OAuth token rejected. Please sign in again with `codex`.".to_string());
    }
    if !status.is_success() {
        return Err(format!(
            "Codex direct usage endpoint returned HTTP {status}."
        ));
    }
    let usage = response
        .json::<Value>()
        .map_err(|error| format!("failed to parse Codex direct usage response: {error}"))?;
    let email = usage
        .get("email")
        .and_then(Value::as_str)
        .map(str::to_string);
    let plan = usage
        .get("plan_type")
        .or_else(|| usage.get("planType"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let snapshot = normalize_codex_rate_limits(&usage);
    Ok(ProviderUpdate {
        account_label: email
            .clone()
            .or_else(|| plan.clone())
            .or_else(|| Some(AiCodingUsageProvider::Codex.label().to_string())),
        account_email: email,
        subscription_plan: plan,
        auth_state: "connected",
        snapshot: Some(snapshot),
        raw_provider_json: Some(usage),
        captured_at: None,
        last_error: None,
    })
}

fn read_codex_wham_credentials() -> Result<CodexWhamCredentials, String> {
    let path = codex_auth_path();
    let content = std::fs::read_to_string(&path).map_err(|error| {
        format!(
            "failed to read Codex credentials at {}: {error}",
            path.display()
        )
    })?;
    let value: Value = serde_json::from_str(&content)
        .map_err(|error| format!("failed to parse Codex credentials: {error}"))?;
    codex_wham_credentials_from_value(&value)
}

fn codex_wham_credentials_from_value(value: &Value) -> Result<CodexWhamCredentials, String> {
    if let Some(mode) = value.get("auth_mode") {
        if !matches!(mode.as_str(), Some("chatgpt") | Some("chatgptAuthTokens")) {
            return Err("Codex subscription quota requires ChatGPT sign-in.".to_string());
        }
    }
    let tokens = value.get("tokens").unwrap_or(&Value::Null);
    let access_token = tokens
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| {
            "Codex credentials do not contain an access token. Sign in with `codex`.".to_string()
        })?
        .to_string();
    let account_id = tokens
        .get("account_id")
        .and_then(Value::as_str)
        .filter(|account_id| !account_id.trim().is_empty())
        .map(str::to_string);
    Ok(CodexWhamCredentials {
        access_token,
        account_id,
    })
}

fn codex_auth_path() -> PathBuf {
    codex_home_dir().join("auth.json")
}

fn codex_home_dir() -> PathBuf {
    if let Some(codex_home) = std::env::var_os("CODEX_HOME").filter(|value| !value.is_empty()) {
        return PathBuf::from(codex_home);
    }
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .unwrap_or_else(|| OsString::from("."));
    PathBuf::from(home).join(".codex")
}

fn resolve_codex_chatgpt_base_url() -> String {
    let config_path = if let Some(codex_home) =
        std::env::var_os("CODEX_HOME").filter(|value| !value.is_empty())
    {
        PathBuf::from(codex_home).join("config.toml")
    } else {
        let home = std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .unwrap_or_else(|| OsString::from("."));
        PathBuf::from(home).join(".codex").join("config.toml")
    };

    std::fs::read_to_string(config_path)
        .ok()
        .and_then(|content| parse_codex_chatgpt_base_url(&content))
        .map(|url| normalize_codex_chatgpt_base_url(&url))
        .filter(|url| {
            url.starts_with("https://")
                || url.starts_with("http://127.0.0.1")
                || url.starts_with("http://localhost")
        })
        .unwrap_or_else(|| CODEX_CHATGPT_DEFAULT_BASE_URL.to_string())
}

fn parse_codex_chatgpt_base_url(config: &str) -> Option<String> {
    config.lines().find_map(|line| {
        let line = line.split('#').next().unwrap_or("").trim();
        let (key, value) = line.split_once('=')?;
        if key.trim() != "chatgpt_base_url" {
            return None;
        }
        let value = value.trim();
        let unquoted = value
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'))
            .or_else(|| {
                value
                    .strip_prefix('\'')
                    .and_then(|value| value.strip_suffix('\''))
            })
            .unwrap_or(value);
        Some(unquoted.trim().to_string())
    })
}

fn normalize_codex_chatgpt_base_url(url: &str) -> String {
    let mut normalized = url.trim().trim_end_matches('/').to_string();
    if normalized.is_empty() {
        return CODEX_CHATGPT_DEFAULT_BASE_URL.to_string();
    }
    if (normalized.starts_with("https://chatgpt.com")
        || normalized.starts_with("https://chat.openai.com"))
        && !normalized.contains("/backend-api")
    {
        normalized.push_str("/backend-api");
    }
    normalized
}

fn connect_claude(cli_paths: &ProviderCliPaths) -> Result<ProviderUpdate, String> {
    let command = resolve_provider_command(
        cli_paths.claude.as_deref(),
        "claude",
        AiCodingUsageProvider::ClaudeCode,
    );
    run_command(&command, &["auth", "login"], PROVIDER_TIMEOUT)?;
    let mut update = refresh_claude(cli_paths)?;
    if let Err(error) = install_claude_statusline_adapter() {
        if update.last_error.is_none() {
            update.last_error = Some(format!("Claude status-line telemetry adapter was not installed: {error}"));
        }
    }
    Ok(update)
}

fn refresh_claude(cli_paths: &ProviderCliPaths) -> Result<ProviderUpdate, String> {
    let command = resolve_provider_command(
        cli_paths.claude.as_deref(),
        "claude",
        AiCodingUsageProvider::ClaudeCode,
    );
    let output = run_command(
        &command,
        &["auth", "status"],
        Duration::from_secs(30),
    )?;
    // JSON is the documented default for `claude auth status`.
    let status_value = parse_claude_auth_status(&output)?;
    let subscription_auth = status_value.get("authMethod").and_then(Value::as_str)
        == Some("claude.ai");
    let mut update = claude_update_from_status_value(status_value);
    if !subscription_auth {
        update.snapshot = Some(normalize_claude_oauth_usage(&Value::Null));
        update.last_error = Some("Claude subscription quota is unavailable for this authentication method.".to_string());
        return Ok(update);
    }
    // Prefer Claude Code's documented status-line telemetry. It is generated
    // locally from the active subscription session and does not consume tokens.
    if let Some((snapshot, raw, captured_at)) = read_claude_statusline_usage() {
        update.snapshot = Some(snapshot);
        update.raw_provider_json = Some(raw);
        update.captured_at = captured_at;
        return Ok(update);
    }

    // Compatibility fallback for users who have not produced status-line
    // telemetry yet. This endpoint is intentionally best-effort.
    match fetch_claude_oauth_usage(cli_paths) {
        Ok(usage) => {
            update.snapshot = Some(normalize_claude_oauth_usage(&usage));
            update.raw_provider_json = Some(usage);
        }
        Err(error) => {
            update.last_error = Some(error);
        }
    }
    Ok(update)
}

fn parse_claude_auth_status(output: &str) -> Result<Value, String> {
    let value: Value = serde_json::from_str(output)
        .map_err(|_| "Claude Code auth status returned invalid JSON.".to_string())?;
    if value.get("loggedIn").and_then(Value::as_bool) != Some(true) {
        return Err("Claude Code is not logged in.".to_string());
    }
    Ok(value)
}

fn claude_update_from_status_value(value: Value) -> ProviderUpdate {
    let email = find_string_key(&value, &["email", "accountEmail", "username"]);
    let label = email
        .clone()
        .or_else(|| find_string_key(&value, &["orgName"]))
        .or_else(|| find_string_key(&value, &["account", "login", "name"]));
    let subscription_plan = find_string_key(&value, &["subscriptionType", "subscription_type"]);
    ProviderUpdate {
        account_label: label
            .or_else(|| Some(AiCodingUsageProvider::ClaudeCode.label().to_string())),
        account_email: email,
        subscription_plan,
        auth_state: "connected",
        snapshot: None,
        raw_provider_json: Some(value),
        captured_at: None,
        last_error: None,
    }
}

const CLAUDE_OAUTH_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_BETA_HEADER: &str = "oauth-2025-04-20";
/// Used when the installed CLI version cannot be determined. The usage
/// endpoint aggressively rate-limits requests without a `claude-code/<ver>`
/// User-Agent (anonymous bucket returns persistent 429s), so always send one.
const CLAUDE_USAGE_FALLBACK_USER_AGENT: &str = "claude-code/2.0.0";
const CLAUDE_STATUSLINE_ADAPTER_ARG: &str = "--claude-statusline-adapter";
const CLAUDE_STATUSLINE_CACHE_FILE: &str = "kkterm-statusline-usage.json";
const CLAUDE_STATUSLINE_BACKUP_FILE: &str = "kkterm-statusline-adapter.json";

fn claude_usage_user_agent(cli_paths: &ProviderCliPaths) -> String {
    static USER_AGENT: OnceLock<String> = OnceLock::new();
    USER_AGENT
        .get_or_init(|| {
            let command = resolve_provider_command(
                cli_paths.claude.as_deref(),
                "claude",
                AiCodingUsageProvider::ClaudeCode,
            );
            run_command(&command, &["--version"], Duration::from_secs(30))
                .ok()
                .as_deref()
                .and_then(claude_version_token)
                .map(|version| format!("claude-code/{version}"))
                .unwrap_or_else(|| CLAUDE_USAGE_FALLBACK_USER_AGENT.to_string())
        })
        .clone()
}


fn claude_config_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var_os("HOME");
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            home.filter(|value| !value.is_empty())
                .map(|home| PathBuf::from(home).join(".claude"))
        })
}

fn claude_statusline_cache_path() -> Option<PathBuf> {
    Some(claude_config_dir()?.join(CLAUDE_STATUSLINE_CACHE_FILE))
}

fn claude_statusline_backup_path() -> Option<PathBuf> {
    Some(claude_config_dir()?.join(CLAUDE_STATUSLINE_BACKUP_FILE))
}

fn statusline_window(value: Option<&Value>) -> AiCodingUsageQuotaWindow {
    let Some(value) = value else {
        return AiCodingUsageQuotaWindow::unknown();
    };
    let used_percent = value
        .get("used_percentage")
        .and_then(Value::as_f64)
        .map(clamp_percent);
    let resets_at = value.get("resets_at").and_then(timestamp_to_rfc3339);
    AiCodingUsageQuotaWindow {
        used_percent,
        resets_at,
    }
}

fn read_claude_statusline_usage() -> Option<(ProviderSnapshot, Value, Option<String>)> {
    let path = claude_statusline_cache_path()?;
    let content = std::fs::read_to_string(&path).ok()?;
    let value: Value = serde_json::from_str(&content).ok()?;
    let limits = value.get("rate_limits")?;
    let mut snapshot = ProviderSnapshot {
        five_hour: statusline_window(limits.get("five_hour")),
        weekly: statusline_window(limits.get("seven_day")),
    };
    expire_reset_quota_windows(&mut snapshot, OffsetDateTime::now_utc());
    if snapshot.five_hour.used_percent.is_none() && snapshot.weekly.used_percent.is_none() {
        return None;
    }
    let captured_at = std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .map(OffsetDateTime::from)
        .and_then(|timestamp| timestamp.format(&Rfc3339).ok());
    Some((
        snapshot,
        json!({
            "source": "claude_statusline",
            "rate_limits": limits
        }),
        captured_at,
    ))
}

fn claude_statusline_adapter_command() -> Result<String, String> {
    let exe = std::env::current_exe()
        .map_err(|error| format!("failed to locate KKTerm executable: {error}"))?;
    let path = exe.to_string_lossy().replace('\\', "/").replace('"', "\\\"");
    Ok(format!("\"{path}\" {CLAUDE_STATUSLINE_ADAPTER_ARG}"))
}

