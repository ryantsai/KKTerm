use super::*;

#[test]
fn codex_selects_the_base_bucket_not_another_models_quota() {
    let snapshot = normalize_codex_rate_limits(&json!({
        "result": {
            "rateLimits": { "limitId": "codex_other", "primary": { "usedPercent": 98 } },
            "rateLimitsByLimitId": {
                "aaa_other": { "primary": { "usedPercent": 99, "windowDurationMins": 300 } },
                "codex": {
                    "limitId": "codex",
                    "primary": { "usedPercent": 12, "windowDurationMins": 300 },
                    "secondary": { "usedPercent": 34, "windowDurationMins": 10080 }
                }
            }
        }
    }));
    assert_eq!(snapshot.five_hour.used_percent, Some(12.0));
    assert_eq!(snapshot.weekly.used_percent, Some(34.0));
}

#[test]
fn codex_does_not_fill_missing_windows_from_other_buckets() {
    for value in [
        json!({ "rateLimitsByLimitId": { "codex_other": { "primary": { "usedPercent": 99 } } } }),
        json!({ "rateLimitsByLimitId": { "codex": null }, "rateLimits": { "primary": { "usedPercent": 99 } } }),
        json!({ "rateLimits": { "limitId": "codex_other", "primary": { "usedPercent": 99 } } }),
        json!({ "rate_limit": { "primary_window": null }, "code_review_rate_limit": { "secondary_window": { "used_percent": 99, "limit_window_seconds": 604800 } } }),
        json!({ "credits": { "usedPercent": 99 }, "additional_rate_limits": [{ "primary": { "usedPercent": 99 } }] }),
    ] {
        let snapshot = normalize_codex_rate_limits(&value);
        assert_eq!(snapshot.five_hour.used_percent, None);
        assert_eq!(snapshot.weekly.used_percent, None);
    }
}

#[test]
fn codex_explicit_durations_override_primary_and_secondary_names() {
    let snapshot = normalize_codex_rate_limits(&json!({
        "rateLimits": {
            "primary": { "usedPercent": 10, "windowDurationMins": 15 },
            "secondary": { "usedPercent": 20, "windowDurationMins": 60 }
        }
    }));
    assert_eq!(snapshot.five_hour.used_percent, None);
    assert_eq!(snapshot.weekly.used_percent, None);

    let swapped = normalize_codex_rate_limits(&json!({
        "rateLimits": {
            "primary": { "usedPercent": 10, "windowDurationMins": 10080 },
            "secondary": { "usedPercent": 20, "windowDurationMins": 300 }
        }
    }));
    assert_eq!(swapped.five_hour.used_percent, Some(20.0));
    assert_eq!(swapped.weekly.used_percent, Some(10.0));
}

#[test]
fn codex_accepts_legacy_missing_duration_but_rejects_malformed_duration() {
    let legacy = normalize_codex_rate_limits(&json!({
        "rateLimits": { "primary": { "usedPercent": 0 }, "secondary": null }
    }));
    assert_eq!(legacy.five_hour.used_percent, Some(0.0));
    assert_eq!(legacy.weekly.used_percent, None);
    for duration in [json!("300"), json!(-300), json!(0)] {
        let invalid = normalize_codex_rate_limits(&json!({
            "rateLimits": { "primary": { "usedPercent": 99, "windowDurationMins": duration } }
        }));
        assert_eq!(invalid.five_hour.used_percent, None);
    }
}

#[test]
fn codex_supports_snake_case_windows_and_epoch_reset() {
    let snapshot = normalize_codex_rate_limits(&json!({
        "limit_id": "codex",
        "primary": { "used_percent": 42, "window_minutes": 300, "resets_at": 1783000000 },
        "secondary": { "used_percent": 7, "window_minutes": 10080 }
    }));
    assert_eq!(snapshot.five_hour.used_percent, Some(42.0));
    assert_eq!(snapshot.weekly.used_percent, Some(7.0));
    assert!(snapshot.five_hour.resets_at.is_some());
}

#[test]
fn codex_direct_usage_never_uses_api_keys_or_stale_oauth_under_api_key_auth() {
    for value in [
        json!({ "OPENAI_API_KEY": "test-api-key" }),
        json!({ "auth_mode": "apikey", "tokens": { "access_token": "old-oauth-token" } }),
        json!({ "tokens": { "access_token": " " } }),
        json!({}),
    ] {
        assert!(codex_wham_credentials_from_value(&value).is_err());
    }
    let credentials = codex_wham_credentials_from_value(&json!({
        "auth_mode": "chatgpt",
        "tokens": { "access_token": "test-oauth-token", "account_id": "test-account" }
    })).unwrap();
    assert_eq!(credentials.access_token, "test-oauth-token");
    assert_eq!(credentials.account_id.as_deref(), Some("test-account"));
}

#[test]
fn claude_auth_status_fails_closed_on_unrecognized_output() {
    for output in ["not json", "{}", "null", r#"{"loggedIn":false}"#, r#"{"loggedIn":"true"}"#] {
        assert!(parse_claude_auth_status(output).is_err());
    }
    assert!(parse_claude_auth_status(r#"{"loggedIn":true,"authMethod":"claude.ai"}"#).is_ok());
}

#[test]
fn claude_custom_config_directory_does_not_fall_back_to_a_different_profile() {
    let custom = PathBuf::from("profiles").join("work");
    let home = PathBuf::from("home");
    assert_eq!(
        claude_credentials_path_for(Some(custom.clone().into_os_string()), Some(home.clone().into_os_string())),
        Some(custom.join(".credentials.json"))
    );
    assert_eq!(
        claude_credentials_path_for(Some(OsString::new()), Some(home.clone().into_os_string())),
        Some(home.join(".claude").join(".credentials.json"))
    );
    assert_eq!(claude_credentials_path_for(None, None), None);
    assert!(claude_credentials_path_for(Some(OsString::from("custom")), None).is_some());
}

#[test]
fn claude_retry_after_http_date_is_not_suffixed_with_seconds() {
    assert_eq!(
        claude_usage_http_error(reqwest::StatusCode::TOO_MANY_REQUESTS, Some("Fri, 18 Sep 2026 01:00:00 GMT")),
        "Claude usage endpoint returned HTTP 429 Too Many Requests; retry after Fri, 18 Sep 2026 01:00:00 GMT."
    );
}

#[test]
fn usage_error_truncation_does_not_split_utf8() {
    let scrubbed = scrub_provider_error(&"界".repeat(600));
    assert_eq!(scrubbed.chars().count(), 500);
    assert_eq!(scrub_provider_error("first\r\nsecond"), "first  second");
}

fn usage_database() -> Connection {
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("
        CREATE TABLE ai_coding_usage_accounts (
            provider TEXT PRIMARY KEY, account_label TEXT, account_email TEXT,
            subscription_plan TEXT, auth_state TEXT NOT NULL, last_refresh_at TEXT,
            last_error TEXT, created_at TEXT, updated_at TEXT
        );
        CREATE TABLE ai_coding_usage_snapshots (
            provider TEXT PRIMARY KEY, five_hour_used_percent REAL, five_hour_resets_at TEXT,
            weekly_used_percent REAL, weekly_resets_at TEXT, raw_provider_json TEXT,
            captured_at TEXT NOT NULL
        );
    ").unwrap();
    connection
}

fn quota_update(email: &str) -> ProviderUpdate {
    ProviderUpdate {
        account_label: Some(email.to_string()),
        account_email: Some(email.to_string()),
        subscription_plan: Some("pro".to_string()),
        auth_state: "connected",
        snapshot: Some(ProviderSnapshot {
            five_hour: AiCodingUsageQuotaWindow { used_percent: Some(12.0), resets_at: None },
            weekly: AiCodingUsageQuotaWindow { used_percent: Some(34.0), resets_at: None },
        }),
        raw_provider_json: Some(json!({
            "rateLimits": { "primary": { "usedPercent": 12 }, "secondary": { "usedPercent": 34 } }
        })),
        captured_at: Some("2000-01-01T00:00:00Z".to_string()),
        last_error: None,
    }
}

#[test]
fn failed_refresh_preserves_snapshot_capture_time_not_attempt_time() {
    let connection = usage_database();
    save_provider_update(&connection, AiCodingUsageProvider::Codex, quota_update("a@example.com")).unwrap();
    save_provider_error(&connection, AiCodingUsageProvider::Codex, "offline").unwrap();
    let state = load_provider_state(&connection, AiCodingUsageProvider::Codex).unwrap();
    assert_eq!(state.five_hour.used_percent, Some(12.0));
    assert_eq!(state.last_refresh_at.as_deref(), Some("2000-01-01T00:00:00Z"));
    assert_ne!(state.last_attempt_at, state.last_refresh_at);
    assert_eq!(state.last_error.as_deref(), Some("offline"));
}

#[test]
fn auth_without_quota_cannot_relabel_the_previous_accounts_snapshot() {
    let connection = usage_database();
    save_provider_update(&connection, AiCodingUsageProvider::ClaudeCode, quota_update("a@example.com")).unwrap();
    let mut next = claude_update_from_status_value(json!({
        "loggedIn": true, "email": "b@example.com", "authMethod": "claude.ai"
    }));
    next.last_error = Some("usage unavailable".to_string());
    save_provider_update(&connection, AiCodingUsageProvider::ClaudeCode, next).unwrap();
    let state = load_provider_state(&connection, AiCodingUsageProvider::ClaudeCode).unwrap();
    assert_eq!(state.account_email.as_deref(), Some("b@example.com"));
    assert_eq!(state.five_hour.used_percent, None);
    assert_eq!(state.last_refresh_at, None);
    assert!(state.last_attempt_at.is_some());
}

#[test]
fn old_unbound_rollout_cache_is_not_displayed_after_upgrade() {
    let connection = usage_database();
    let mut update = quota_update("a@example.com");
    update.raw_provider_json = Some(json!({
        "source": "codex_local_sessions", "rate_limits": { "primary": { "used_percent": 99 } }
    }));
    save_provider_update(&connection, AiCodingUsageProvider::Codex, update).unwrap();
    let state = load_provider_state(&connection, AiCodingUsageProvider::Codex).unwrap();
    assert_eq!(state.five_hour.used_percent, None);
    assert_eq!(state.last_refresh_at, None);
}

#[test]
fn old_codex_cache_is_reparsed_using_the_correct_bucket_and_duration() {
    let connection = usage_database();
    let mut update = quota_update("a@example.com");
    update.raw_provider_json = Some(json!({
        "rateLimits": { "primary": { "usedPercent": 99, "windowDurationMins": 15 } }
    }));
    save_provider_update(&connection, AiCodingUsageProvider::Codex, update).unwrap();
    let state = load_provider_state(&connection, AiCodingUsageProvider::Codex).unwrap();
    assert_eq!(state.five_hour.used_percent, None);
    assert_eq!(state.weekly.used_percent, None);
}

#[test]
fn expired_cached_windows_are_unknown_even_before_a_network_refresh() {
    let connection = usage_database();
    let mut update = quota_update("a@example.com");
    update.snapshot.as_mut().unwrap().five_hour.resets_at = Some("2000-01-01T00:00:00Z".to_string());
    save_provider_update(&connection, AiCodingUsageProvider::ClaudeCode, update).unwrap();
    let state = load_provider_state(&connection, AiCodingUsageProvider::ClaudeCode).unwrap();
    assert_eq!(state.five_hour.used_percent, None);
    assert_eq!(state.weekly.used_percent, Some(34.0));
}
