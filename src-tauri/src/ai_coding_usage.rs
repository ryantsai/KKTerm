use crate::storage;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{
    ffi::{OsStr, OsString},
    io::{BufRead, BufReader, Write},
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
    refresh_claude(cli_paths)
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

fn claude_version_token(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .find(|token| {
            token.contains('.')
                && token
                    .chars()
                    .all(|character| character.is_ascii_digit() || character == '.')
        })
        .map(str::to_string)
}

fn fetch_claude_oauth_usage(cli_paths: &ProviderCliPaths) -> Result<Value, String> {
    let token = read_claude_oauth_token()?;
    let client = crate::net::proxy::apply_blocking(reqwest::blocking::Client::builder())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("failed to build HTTP client: {error}"))?;
    let response = client
        .get(CLAUDE_OAUTH_USAGE_URL)
        .bearer_auth(&token)
        .header("anthropic-beta", CLAUDE_OAUTH_BETA_HEADER)
        .header(
            reqwest::header::USER_AGENT,
            claude_usage_user_agent(cli_paths),
        )
        .send()
        .map_err(|error| format!("Claude usage request failed: {error}"))?;
    let status = response.status();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(
            "Claude Code OAuth token rejected. Please sign in again with `claude auth login`."
                .to_string(),
        );
    }
    if !status.is_success() {
        return Err(claude_usage_http_error(status, retry_after.as_deref()));
    }
    response
        .json::<Value>()
        .map_err(|error| format!("failed to parse Claude usage response: {error}"))
}

fn claude_usage_http_error(status: reqwest::StatusCode, retry_after: Option<&str>) -> String {
    let Some(retry_after) = retry_after.map(str::trim).filter(|value| !value.is_empty()) else {
        return format!("Claude usage endpoint returned HTTP {status}.");
    };
    // Retry-After can be delta-seconds or an HTTP date, not always seconds.
    let suffix = if retry_after.bytes().all(|byte| byte.is_ascii_digit()) { "s" } else { "" };
    format!("Claude usage endpoint returned HTTP {status}; retry after {retry_after}{suffix}.")
}

fn read_claude_oauth_token() -> Result<String, String> {
    let path = claude_credentials_path()
        .ok_or_else(|| "Claude credentials file is not available on this platform.".to_string())?;
    let content = std::fs::read_to_string(&path).map_err(|error| {
        format!(
            "failed to read Claude credentials at {}: {error}",
            path.display()
        )
    })?;
    let value: serde_json::Value = serde_json::from_str(&content)
        .map_err(|error| format!("failed to parse Claude credentials: {error}"))?;
    value
        .pointer("/claudeAiOauth/accessToken")
        .and_then(Value::as_str)
        .filter(|token| !token.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            "Claude credentials do not contain an OAuth access token. Sign in with `claude auth login`."
                .to_string()
        })
}

fn claude_credentials_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var_os("HOME");
    claude_credentials_path_for(std::env::var_os("CLAUDE_CONFIG_DIR"), home)
}

fn claude_credentials_path_for(config_dir: Option<OsString>, home: Option<OsString>) -> Option<PathBuf> {
    // Also supports the CLI's file fallback on macOS. Do not probe a different
    // profile or copy credentials out of Keychain when this file is absent.
    let root = config_dir.filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| home.filter(|value| !value.is_empty()).map(|home| PathBuf::from(home).join(".claude")))?;
    Some(root.join(".credentials.json"))
}

fn normalize_claude_oauth_usage(value: &Value) -> ProviderSnapshot {
    let five_hour = value
        .pointer("/five_hour")
        .and_then(oauth_usage_window_from_value)
        .unwrap_or_else(AiCodingUsageQuotaWindow::unknown);
    let weekly = value
        .pointer("/seven_day")
        .and_then(oauth_usage_window_from_value)
        .unwrap_or_else(AiCodingUsageQuotaWindow::unknown);
    ProviderSnapshot { five_hour, weekly }
}

fn oauth_usage_window_from_value(value: &Value) -> Option<AiCodingUsageQuotaWindow> {
    let object = value.as_object()?;
    let used_percent = object
        .get("utilization")
        .and_then(Value::as_f64)
        .map(clamp_percent);
    let resets_at = object
        .get("resets_at")
        .and_then(Value::as_str)
        .map(str::to_string);
    Some(AiCodingUsageQuotaWindow {
        used_percent,
        resets_at,
    })
}

struct CodexRpcSession {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
    rx: mpsc::Receiver<String>,
}

impl CodexRpcSession {
    fn start(cli_paths: &ProviderCliPaths) -> Result<Self, String> {
        let command = resolve_provider_command(
            cli_paths.codex.as_deref(),
            "codex",
            AiCodingUsageProvider::Codex,
        );
        let mut child = new_provider_process(&command)
            .args(["app-server", "--listen", "stdio://"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // An unread stderr pipe can fill and stall otherwise valid RPCs.
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| {
                format!(
                    "failed to start Codex app-server with {}: {error}",
                    command.display()
                )
            })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "failed to open Codex app-server stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "failed to open Codex app-server stdout".to_string())?;
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let _ = tx.send(line);
            }
        });
        Ok(Self { child, stdin, rx })
    }

    fn initialize(&mut self) -> Result<(), String> {
        self.write_json(json!({
            "method": "initialize",
            "id": 1,
            "params": {
                "clientInfo": {
                    "name": "kkterm",
                    "title": "KKTerm",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }
        }))?;
        self.wait_for_id(1, Duration::from_secs(20))?;
        self.write_json(json!({ "method": "initialized", "params": {} }))?;
        Ok(())
    }

    fn request(&mut self, message: Value) -> Result<Value, String> {
        let id = message
            .get("id")
            .and_then(Value::as_i64)
            .ok_or_else(|| "Codex request missing id".to_string())?;
        self.write_json(message)?;
        self.wait_for_id(id, Duration::from_secs(60))
    }

    fn wait_for_id(&mut self, id: i64, timeout: Duration) -> Result<Value, String> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let Ok(line) = self
                .rx
                .recv_timeout(remaining.min(Duration::from_millis(250)))
            else {
                continue;
            };
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                if value.get("id").and_then(Value::as_i64) == Some(id) {
                    if let Some(error) = value.get("error") {
                        return Err(format!("Codex app-server error: {error}"));
                    }
                    return Ok(value);
                }
            }
        }
        Err("Timed out waiting for Codex app-server.".to_string())
    }

    fn wait_for_notification(&mut self, method: &str, timeout: Duration) -> Result<(), String> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let Ok(line) = self
                .rx
                .recv_timeout(remaining.min(Duration::from_millis(250)))
            else {
                continue;
            };
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if value.get("method").and_then(Value::as_str) == Some(method) {
                let success = value
                    .pointer("/params/success")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if success {
                    return Ok(());
                }
                let error = value
                    .pointer("/params/error")
                    .and_then(Value::as_str)
                    .unwrap_or("login failed");
                return Err(format!("Codex login failed: {error}"));
            }
        }
        Err("Timed out waiting for Codex login.".to_string())
    }

    fn write_json(&mut self, value: Value) -> Result<(), String> {
        let line = serde_json::to_string(&value)
            .map_err(|error| format!("failed to serialize Codex RPC: {error}"))?;
        writeln!(self.stdin, "{line}")
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("failed to write Codex RPC: {error}"))
    }
}

impl Drop for CodexRpcSession {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Clone, Debug)]
struct ProviderCommand {
    program: OsString,
    display: String,
}

impl ProviderCommand {
    fn as_os_str(&self) -> &OsStr {
        self.program.as_os_str()
    }

    fn display(&self) -> &str {
        &self.display
    }
}

fn new_provider_process(command: &ProviderCommand) -> Command {
    let mut process = Command::new(command.as_os_str());
    hide_provider_process_window(&mut process);
    process
}

fn hide_provider_process_window(_command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        _command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn resolve_provider_command(
    configured: Option<&str>,
    fallback_name: &str,
    provider: AiCodingUsageProvider,
) -> ProviderCommand {
    if let Some(path) = configured.filter(|path| !path.trim().is_empty()) {
        return ProviderCommand {
            program: OsString::from(path),
            display: path.to_string(),
        };
    }

    if let Some(path) = common_provider_command_path(provider) {
        return ProviderCommand {
            display: path.display().to_string(),
            program: path.into_os_string(),
        };
    }

    ProviderCommand {
        program: OsString::from(fallback_name),
        display: fallback_name.to_string(),
    }
}

fn common_provider_command_path(provider: AiCodingUsageProvider) -> Option<PathBuf> {
    let names: &[&str] = match provider {
        AiCodingUsageProvider::Codex => &["codex.exe", "codex.cmd"],
        AiCodingUsageProvider::ClaudeCode => &["claude.exe", "claude.cmd"],
    };
    common_user_bin_candidates(names)
        .into_iter()
        .chain(match provider {
            AiCodingUsageProvider::Codex => codex_vscode_extension_candidates(),
            AiCodingUsageProvider::ClaudeCode => Vec::new(),
        })
        .find(|path| path.is_file())
}

fn common_user_bin_candidates(names: &[&str]) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        roots.push(PathBuf::from(&profile).join(".local").join("bin"));
    }
    if let Some(nvm_symlink) = std::env::var_os("NVM_SYMLINK") {
        roots.push(PathBuf::from(nvm_symlink));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        roots.push(PathBuf::from(appdata).join("npm"));
    }

    roots
        .into_iter()
        .flat_map(|root| names.iter().map(move |name| root.join(name)))
        .collect()
}

fn codex_vscode_extension_candidates() -> Vec<PathBuf> {
    let Some(profile) = std::env::var_os("USERPROFILE") else {
        return Vec::new();
    };
    let extensions = PathBuf::from(profile).join(".vscode").join("extensions");
    let Ok(entries) = std::fs::read_dir(extensions) else {
        return Vec::new();
    };
    let mut extension_dirs = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(OsStr::to_str)
                .is_some_and(|name| name.starts_with("openai.chatgpt-"))
        })
        .collect::<Vec<_>>();
    // Newest extension version first.
    extension_dirs.sort();
    extension_dirs.reverse();
    // The VS Code Codex extension ships a per-architecture binary. Probe the
    // native-arch folder first so a Windows on Arm host finds windows-arm64,
    // then fall back to the x64 build (which runs under emulation).
    extension_dirs
        .into_iter()
        .flat_map(|path| {
            codex_extension_arch_dirs()
                .iter()
                .map(move |arch| path.join("bin").join(arch).join("codex.exe"))
        })
        .collect()
}

/// Architecture subfolders under the Codex VS Code extension's `bin/`, ordered
/// by preference for the running build's native architecture.
fn codex_extension_arch_dirs() -> &'static [&'static str] {
    #[cfg(target_arch = "aarch64")]
    {
        &["windows-arm64", "windows-x86_64"]
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        &["windows-x86_64", "windows-arm64"]
    }
}

fn run_command(
    command: &ProviderCommand,
    args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    let mut child = new_provider_process(command)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start {}: {error}", command.display()))?;
    let start = Instant::now();
    loop {
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("{} timed out", command.display()));
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("failed to wait for {}: {error}", command.display()))?
        {
            let output = child
                .wait_with_output()
                .map_err(|error| format!("failed to read {} output: {error}", command.display()))?;
            if status.success() {
                return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
            }
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                format!("{} exited with {status}", command.display())
            } else {
                stderr
            });
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn normalize_codex_rate_limits(value: &Value) -> ProviderSnapshot {
    let unknown = || ProviderSnapshot {
        five_hour: AiCodingUsageQuotaWindow::unknown(),
        weekly: AiCodingUsageQuotaWindow::unknown(),
    };
    let Some(bucket) = codex_quota_bucket(value) else { return unknown(); };
    let candidates: Vec<(&str, &Value)> = if let Some(windows) = bucket.as_array() {
        windows.iter().map(|window| ("", window)).collect()
    } else {
        ["primary", "primary_window", "secondary", "secondary_window"]
            .into_iter()
            .filter_map(|name| bucket.get(name).map(|window| (name, window)))
            .collect()
    };
    let window_for = |minutes, legacy_names: [&str; 2]| {
        candidates.iter()
            .find(|(_, window)| quota_window_minutes(window) == Ok(Some(minutes)))
            .or_else(|| candidates.iter().find(|(name, window)| {
                legacy_names.contains(name) && quota_window_minutes(window) == Ok(None)
            }))
            .and_then(|(_, window)| window.as_object())
            .map(|window| AiCodingUsageQuotaWindow {
                used_percent: numeric_key(window, &["usedPercent", "used_percent", "used_percentage", "usage_percent", "percentUsed"])
                    .map(clamp_percent),
                resets_at: ["resetsAt", "resets_at", "reset_at"].iter()
                    .find_map(|key| window.get(*key).and_then(timestamp_to_rfc3339)),
            })
            .unwrap_or_else(AiCodingUsageQuotaWindow::unknown)
    };
    // These are fixed-label UI slots, not arbitrary primary/secondary meters.
    // Explicit durations must agree; absence is never a zero-percent allowance.
    ProviderSnapshot {
        five_hour: window_for(300.0, ["primary", "primary_window"]),
        weekly: window_for(10080.0, ["secondary", "secondary_window"]),
    }
}

fn codex_quota_bucket(value: &Value) -> Option<&Value> {
    let root = value.get("result").unwrap_or(value);
    let bucket = if let Some(buckets) = root.get("rateLimitsByLimitId").and_then(Value::as_object) {
        buckets.get("codex")?
    } else if let Some(bucket) = root.get("rateLimits") {
        bucket
    } else if let Some(bucket) = root.get("rate_limit") {
        bucket
    } else if let Some(windows) = root.get("limits").filter(|value| value.is_array()) {
        return Some(windows);
    } else if root.get("primary").is_some() || root.get("secondary").is_some() {
        root
    } else {
        return None;
    };
    let object = bucket.as_object()?;
    // Never substitute code-review or model-specific quotas for base Codex.
    for key in ["limitId", "limit_id"] {
        if let Some(id) = object.get(key).filter(|value| !value.is_null()) {
            if id.as_str() != Some("codex") { return None; }
        }
    }
    Some(bucket)
}

fn quota_window_minutes(value: &Value) -> Result<Option<f64>, ()> {
    let object = value.as_object().ok_or(())?;
    for (key, divisor) in [
        ("windowDurationMins", 1.0), ("window_minutes", 1.0),
        ("durationMinutes", 1.0), ("limit_window_seconds", 60.0),
    ] {
        if let Some(value) = object.get(key).filter(|value| !value.is_null()) {
            let minutes = value.as_f64().ok_or(())? / divisor;
            return if minutes.is_finite() && minutes > 0.0 { Ok(Some(minutes)) } else { Err(()) };
        }
    }
    Ok(None)
}

fn numeric_key(map: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<f64> {
    keys.iter()
        .find_map(|key| map.get(*key).and_then(Value::as_f64))
}

fn timestamp_to_rfc3339(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    let seconds = value.as_i64()?;
    OffsetDateTime::from_unix_timestamp(seconds)
        .ok()?
        .format(&Rfc3339)
        .ok()
}

fn find_string_key(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(text) = map.get(*key).and_then(Value::as_str) {
                    return Some(text.to_string());
                }
            }
            map.values()
                .find_map(|nested| find_string_key(nested, keys))
        }
        Value::Array(items) => items
            .iter()
            .find_map(|nested| find_string_key(nested, keys)),
        _ => None,
    }
}

fn clamp_percent(value: f64) -> f64 {
    value.clamp(0.0, 100.0)
}

fn now_rfc3339() -> Result<String, String> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|error| format!("failed to format timestamp: {error}"))
}

fn scrub_provider_error(error: &str) -> String {
    error.chars().take(500).map(|character| {
        if character == '\n' || character == '\r' { ' ' } else { character }
    }).collect()
}

fn scrub_sensitive_provider_json(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, nested)| {
                    let value = if provider_json_key_is_sensitive(key) {
                        Value::String("[REDACTED]".to_string())
                    } else {
                        scrub_sensitive_provider_json(nested)
                    };
                    (key.clone(), value)
                })
                .collect(),
        ),
        Value::Array(items) => {
            Value::Array(items.iter().map(scrub_sensitive_provider_json).collect())
        }
        other => other.clone(),
    }
}

fn provider_json_key_is_sensitive(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase().replace(['-', ' '], "_");
    normalized == "token"
        || normalized.ends_with("_token")
        || normalized.contains("access_token")
        || normalized.contains("accesstoken")
        || normalized.contains("refresh_token")
        || normalized.contains("refreshtoken")
        || normalized.contains("api_key")
        || normalized.contains("apikey")
        || normalized.contains("secret")
        || normalized.contains("password")
        || normalized.contains("authorization")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_claude_oauth_usage() {
        let value = serde_json::json!({
            "five_hour": { "utilization": 23.0, "resets_at": "2026-05-19T18:30:00+00:00" },
            "seven_day": { "utilization": 18.0, "resets_at": "2026-05-25T14:00:00+00:00" },
            "seven_day_opus": null,
            "extra_usage": { "is_enabled": false }
        });

        let snapshot = normalize_claude_oauth_usage(&value);

        assert_eq!(snapshot.five_hour.used_percent, Some(23.0));
        assert_eq!(snapshot.weekly.used_percent, Some(18.0));
        assert_eq!(
            snapshot.five_hour.resets_at.as_deref(),
            Some("2026-05-19T18:30:00+00:00")
        );
        assert_eq!(
            snapshot.weekly.resets_at.as_deref(),
            Some("2026-05-25T14:00:00+00:00")
        );
    }

    #[test]
    fn missing_oauth_usage_window_falls_back_to_unknown() {
        let snapshot = normalize_claude_oauth_usage(&serde_json::json!({}));
        assert!(snapshot.five_hour.used_percent.is_none());
        assert!(snapshot.weekly.used_percent.is_none());
    }

    #[test]
    fn claude_usage_http_error_includes_retry_after() {
        let message = claude_usage_http_error(reqwest::StatusCode::TOO_MANY_REQUESTS, Some("120"));

        assert_eq!(
            message,
            "Claude usage endpoint returned HTTP 429 Too Many Requests; retry after 120s."
        );
    }

    #[test]
    fn claude_auth_status_populates_account_without_snapshot() {
        let value = serde_json::json!({
            "loggedIn": true,
            "authMethod": "claude.ai",
            "email": "ryan@example.com",
            "orgName": "Ryan's Org",
            "subscriptionType": "pro"
        });

        let update = claude_update_from_status_value(value);

        assert_eq!(update.auth_state, "connected");
        assert_eq!(update.account_email.as_deref(), Some("ryan@example.com"));
        assert_eq!(update.account_label.as_deref(), Some("ryan@example.com"));
        assert_eq!(update.subscription_plan.as_deref(), Some("pro"));
        assert_eq!(update.last_error, None);
        assert!(update.snapshot.is_none());
    }

    #[test]
    fn scrub_sensitive_provider_json_redacts_nested_secrets() {
        let value = serde_json::json!({
            "usage": { "used_percent": 42.0 },
            "access_token": "tok-1",
            "nested": {
                "refreshToken": "tok-2",
                "api_key": "key-1",
                "items": [
                    { "clientSecret": "secret-1" },
                    { "label": "safe" }
                ]
            }
        });

        let scrubbed = scrub_sensitive_provider_json(&value);

        assert_eq!(scrubbed["usage"]["used_percent"], 42.0);
        assert_eq!(scrubbed["access_token"], "[REDACTED]");
        assert_eq!(scrubbed["nested"]["refreshToken"], "[REDACTED]");
        assert_eq!(scrubbed["nested"]["api_key"], "[REDACTED]");
        assert_eq!(scrubbed["nested"]["items"][0]["clientSecret"], "[REDACTED]");
        assert_eq!(scrubbed["nested"]["items"][1]["label"], "safe");
    }

    #[test]
    fn normalizes_codex_rate_limits_from_duration_windows() {
        let value = serde_json::json!({
            "result": {
                "limits": [
                    { "usedPercent": 31.0, "windowDurationMins": 300, "resetsAt": 1770000000 },
                    { "usedPercent": 74.0, "windowDurationMins": 10080, "resetsAt": 1770400000 }
                ]
            }
        });

        let snapshot = normalize_codex_rate_limits(&value);

        assert_eq!(snapshot.five_hour.used_percent, Some(31.0));
        assert_eq!(snapshot.weekly.used_percent, Some(74.0));
    }

    #[test]
    fn normalizes_codex_wham_usage_rate_limit_windows() {
        let value = serde_json::json!({
            "plan_type": "pro",
            "rate_limit": {
                "primary_window": {
                    "used_percent": 44.0,
                    "limit_window_seconds": 18000,
                    "reset_at": 1779633820
                },
                "secondary_window": {
                    "used_percent": 7.0,
                    "limit_window_seconds": 604800,
                    "reset_at": 1780220620
                }
            },
            "code_review_rate_limit": {
                "used_percent": 12.0,
                "limit_window_seconds": 604800,
                "reset_at": 1780220620
            },
            "credits": {
                "has_credits": true,
                "balance": "4.20"
            }
        });

        let snapshot = normalize_codex_rate_limits(&value);

        assert_eq!(snapshot.five_hour.used_percent, Some(44.0));
        assert_eq!(snapshot.weekly.used_percent, Some(7.0));
        assert!(snapshot.five_hour.resets_at.is_some());
        assert!(snapshot.weekly.resets_at.is_some());
    }

    #[test]
    fn parses_codex_chatgpt_base_url_from_config() {
        let config = r#"
            model = "gpt-5"
            chatgpt_base_url = "https://chatgpt.com/"
        "#;

        let parsed = parse_codex_chatgpt_base_url(config);

        assert_eq!(parsed.as_deref(), Some("https://chatgpt.com/"));
    }

    #[test]
    fn normalizes_codex_chatgpt_base_url_to_backend_api() {
        assert_eq!(
            normalize_codex_chatgpt_base_url("https://chatgpt.com/"),
            "https://chatgpt.com/backend-api"
        );
        assert_eq!(
            normalize_codex_chatgpt_base_url("https://example.com/backend-api/"),
            "https://example.com/backend-api"
        );
    }

    #[test]
    fn clamps_invalid_usage_percentages() {
        assert_eq!(clamp_percent(-5.0), 0.0);
        assert_eq!(clamp_percent(55.0), 55.0);
        assert_eq!(clamp_percent(150.0), 100.0);
    }

    #[test]
    fn provider_labels_are_stable() {
        assert_eq!(AiCodingUsageProvider::Codex.label(), "Codex");
        assert_eq!(AiCodingUsageProvider::ClaudeCode.label(), "Claude Code");
    }

    #[test]
    fn codex_extension_arch_dirs_cover_both_targets_native_first() {
        let dirs = codex_extension_arch_dirs();
        assert!(dirs.contains(&"windows-x86_64"));
        assert!(dirs.contains(&"windows-arm64"));
        #[cfg(target_arch = "aarch64")]
        assert_eq!(dirs.first(), Some(&"windows-arm64"));
        #[cfg(not(target_arch = "aarch64"))]
        assert_eq!(dirs.first(), Some(&"windows-x86_64"));
    }

    #[test]
    fn reauth_detection_catches_claude_oauth_failures() {
        assert!(provider_error_needs_reauth(
            "Claude Code OAuth token rejected. Please sign in again with `claude auth login`."
        ));
        assert!(provider_error_needs_reauth(
            "API Error: 401 {\"error\":{\"type\":\"authentication_error\"}}"
        ));
        assert!(!provider_error_needs_reauth(
            "Claude usage endpoint returned HTTP 429; retry after 60s."
        ));
    }

    #[test]
    fn expires_quota_windows_whose_reset_passed() {
        let now = OffsetDateTime::parse("2026-07-09T12:00:00Z", &Rfc3339).unwrap();
        let mut snapshot = ProviderSnapshot {
            five_hour: AiCodingUsageQuotaWindow {
                used_percent: Some(80.0),
                resets_at: Some("2026-07-09T11:00:00Z".to_string()),
            },
            weekly: AiCodingUsageQuotaWindow {
                used_percent: Some(30.0),
                resets_at: Some("2026-07-12T00:00:00Z".to_string()),
            },
        };

        expire_reset_quota_windows(&mut snapshot, now);

        assert_eq!(snapshot.five_hour.used_percent, None);
        assert_eq!(snapshot.five_hour.resets_at, None);
        assert_eq!(snapshot.weekly.used_percent, Some(30.0));
    }

    #[test]
    fn claude_version_token_parses_cli_output() {
        assert_eq!(
            claude_version_token("2.1.7 (Claude Code)").as_deref(),
            Some("2.1.7")
        );
        assert_eq!(claude_version_token("Claude Code").as_deref(), None);
    }

    #[test]
    fn configured_cli_path_wins_over_discovery() {
        let command = resolve_provider_command(
            Some("C:\\Tools\\codex.exe"),
            "codex",
            AiCodingUsageProvider::Codex,
        );

        assert_eq!(command.display(), "C:\\Tools\\codex.exe");
        assert_eq!(command.as_os_str(), OsStr::new("C:\\Tools\\codex.exe"));
    }
}

#[cfg(test)]
#[path = "ai_coding_usage_tests.rs"]
mod compatibility_tests;
