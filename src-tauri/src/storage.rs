use crate::window_state::{MainWindowSettings, validate_main_window_settings};
use rusqlite::{Connection as SqliteConnection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    fs::{File, OpenOptions},
    io::{Read, Write, copy},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime},
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

const SCHEMA_USER_VERSION: i32 = 33;

const DEFAULT_TERMINAL_OPACITY: u8 = 50;

/// Stable id of the seeded, permanent Default Workspace. Every Connection and
/// ConnectionFolder belongs to exactly one Workspace; rows created before the
/// Workspace model existed are backfilled to this id.
pub const DEFAULT_WORKSPACE_ID: &str = "default";

const CURRENT_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT,
    icon_color TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS connection_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon_data_url TEXT,
    parent_folder_id TEXT REFERENCES connection_folders(id) ON DELETE CASCADE,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    folder_id TEXT REFERENCES connection_folders(id) ON DELETE CASCADE,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    tab_title TEXT,
    host TEXT NOT NULL,
    username TEXT NOT NULL,
    port INTEGER,
    key_path TEXT,
    proxy_jump TEXT,
    ssh_socks_proxy TEXT,
    ssh_socks_proxy_username TEXT,
    ssh_socks_proxy_inherit_defaults INTEGER NOT NULL DEFAULT 1,
    ssh_compression TEXT,
    auth_method TEXT NOT NULL DEFAULT 'keyFile',
    local_shell TEXT,
    local_startup_directory TEXT,
    local_startup_script TEXT,
    url TEXT,
    data_partition TEXT,
    url_proxy TEXT,
    url_proxy_inherit_defaults INTEGER NOT NULL DEFAULT 1,
    use_tmux_sessions INTEGER NOT NULL DEFAULT 1,
    use_psmux_sessions INTEGER NOT NULL DEFAULT 0,
    tmux_connection_id TEXT,
    serial_line TEXT,
    serial_speed INTEGER,
    rdp_options TEXT,
    vnc_options TEXT,
    ftp_options TEXT,
    password_credential_id TEXT REFERENCES connection_password_credentials(id) ON DELETE SET NULL,
    icon_data_url TEXT,
    icon_background_color TEXT,
    terminal_opacity INTEGER,
    terminal_background_json TEXT,
    file_browser_view_options_json TEXT,
    ssh_port_forwardings_json TEXT,
    file_view_open_external INTEGER NOT NULL DEFAULT 0,
    connection_type TEXT NOT NULL CHECK (connection_type IN ('local', 'ssh', 'telnet', 'serial', 'url', 'rdp', 'vnc', 'ftp', 'localFiles', 'fileView')),
    status TEXT NOT NULL CHECK (status IN ('connected', 'idle', 'offline')),
    sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS connection_tags (
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    PRIMARY KEY (connection_id, tag)
);

CREATE TABLE IF NOT EXISTS url_credentials (
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    page_key TEXT NOT NULL DEFAULT '__legacy__',
    secret_owner_id TEXT NOT NULL,
    username TEXT NOT NULL,
    page_url TEXT,
    username_selector TEXT,
    password_selector TEXT,
    field_values TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (connection_id, page_key)
);

CREATE INDEX IF NOT EXISTS idx_connections_folder_sort
    ON connections(folder_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_connection_folders_parent_sort
    ON connection_folders(parent_folder_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_connection_tags_connection_sort
    ON connection_tags(connection_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_url_credentials_connection
    ON url_credentials(connection_id);

CREATE TABLE IF NOT EXISTS connection_password_credentials (
    id TEXT PRIMARY KEY,
    connection_type TEXT NOT NULL CHECK (connection_type IN ('ssh', 'telnet', 'rdp', 'vnc', 'ftp')),
    host TEXT NOT NULL,
    username TEXT NOT NULL,
    label TEXT NOT NULL,
    created_from_connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_connection_password_credentials_type_host
    ON connection_password_credentials(connection_type, host);

CREATE TABLE IF NOT EXISTS encrypted_secret_store_entries (
    secret_key TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    kdf TEXT NOT NULL,
    cipher TEXT NOT NULL,
    salt TEXT NOT NULL,
    nonce TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dashboard_views (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    grid_density TEXT NOT NULL DEFAULT 'default'
        CHECK (grid_density IN ('compact', 'default', 'roomy')),
    background_json TEXT,
    tab_color TEXT
);

CREATE TABLE IF NOT EXISTS dashboard_custom_widgets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'custom',
    body_json TEXT NOT NULL,
    settings_schema_json TEXT NOT NULL DEFAULT '{"fields":[]}',
    created_by TEXT NOT NULL CHECK (created_by IN ('user', 'agent', 'imported')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dashboard_widget_instances (
    id TEXT PRIMARY KEY,
    view_id TEXT NOT NULL REFERENCES dashboard_views(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('builtIn', 'script')),
    source_id TEXT NOT NULL,
    preset TEXT NOT NULL,
    accent_name TEXT NOT NULL,
    icon_name TEXT NOT NULL,
    custom_title TEXT,
    glass INTEGER NOT NULL DEFAULT 0,
    hide_title INTEGER NOT NULL DEFAULT 0,
    action_direction TEXT,
    settings_values_json TEXT NOT NULL DEFAULT '{}',
    body_opacity INTEGER,
    grid_x INTEGER NOT NULL,
    grid_y INTEGER NOT NULL,
    grid_w INTEGER NOT NULL,
    grid_h INTEGER NOT NULL,
    sort_order INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dashboard_widget_instances_view
    ON dashboard_widget_instances(view_id, sort_order);

CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    headers_json TEXT NOT NULL DEFAULT '{}',
    secret_header_name TEXT,
    secret_value_template TEXT,
    has_secret INTEGER NOT NULL DEFAULT 0,
    tools_json TEXT,
    tools_fetched_at TEXT,
    last_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (last_status IN ('ok', 'unreachable', 'auth_error', 'protocol_error', 'unknown')),
    last_error TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_sort ON mcp_servers(sort_order);

CREATE TABLE IF NOT EXISTS assistant_chat_threads (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    context_label TEXT NOT NULL,
    messages_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assistant_chat_threads_updated_at
    ON assistant_chat_threads(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_assistant_chat_threads_created_at
    ON assistant_chat_threads(created_at);

-- Durable per-scope notes the AI Assistant accumulates (the assistant_memory
-- tools). Scope is "global" or "connection:<id>"; the assistant recalls the
-- matching notes when that Connection's Session is active. Plain operator
-- knowledge only — never secrets, which live in the OS keychain.
CREATE TABLE IF NOT EXISTS assistant_memories (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assistant_memories_scope
    ON assistant_memories(scope, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_coding_usage_accounts (
    provider TEXT PRIMARY KEY CHECK (provider IN ('codex', 'claudeCode')),
    account_label TEXT,
    account_email TEXT,
    subscription_plan TEXT,
    auth_state TEXT NOT NULL DEFAULT 'disconnected'
        CHECK (auth_state IN ('disconnected', 'connected', 'expired', 'error')),
    last_refresh_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_coding_usage_snapshots (
    provider TEXT PRIMARY KEY CHECK (provider IN ('codex', 'claudeCode')),
    five_hour_used_percent REAL,
    five_hour_resets_at TEXT,
    weekly_used_percent REAL,
    weekly_resets_at TEXT,
    raw_provider_json TEXT,
    captured_at TEXT NOT NULL
);

-- Install Helper per-tool state (ADR 0007). Installed-version is NEVER
-- persisted: detection is always re-derived from the OS on demand. This
-- table only stores user preferences (pinned) and the latest-version cache
-- driven by the manual / opt-in-daily update check.
CREATE TABLE IF NOT EXISTS installer_tool_state (
    tool_id TEXT PRIMARY KEY,
    pinned INTEGER NOT NULL DEFAULT 0,
    latest_version_seen TEXT,
    last_check_at INTEGER
);

-- IT Ops Module (docs/ITOPS.md). A Host Group is a durable, named selection of
-- existing Connections used as a fleet target for Batch Runs and Automations.
-- It references Connection ids and owns no Session and no secret. Additive in
-- schema v29.
CREATE TABLE IF NOT EXISTS itops_host_groups (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    sort_order      INTEGER NOT NULL,
    -- Ordered Connection ids: JSON array of strings, e.g. ["conn-1","conn-2"].
    member_ids_json TEXT NOT NULL DEFAULT '[]',
    -- Optional dynamic filter resolved at run time: {"types":["ssh"],"folderId":"..."}.
    filter_json     TEXT,
    -- Per-host-group transport default.
    transport       TEXT NOT NULL DEFAULT 'auto'
        CHECK (transport IN ('ssh', 'winrm', 'psexec', 'auto')),
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One completed Batch Run (docs/ITOPS.md Phase 2). Append-only audit log; the
-- host_group_id is a soft reference (no FK) so a run survives its group being
-- deleted. Live run progress is in-memory only and never lands here. v30.
CREATE TABLE IF NOT EXISTS itops_run_history (
    id             TEXT PRIMARY KEY,
    -- 'manual' or 'automation:<automation_id>'.
    source         TEXT NOT NULL,
    host_group_id  TEXT,
    -- Redacted one-line task label, never a secret-bearing script body.
    task_summary   TEXT NOT NULL,
    started_at     TEXT NOT NULL,
    finished_at    TEXT,
    -- Consolidated report: per-host {connectionId,host,transport,exitCode,ok,bytesOut} rows.
    report_json    TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_itops_run_history_source
    ON itops_run_history(source, started_at);

-- A durable Automation (docs/ITOPS.md Phase 3): the persistent definition of a
-- Watchdog. Enabled rows are re-armed into the live WatchdogRegistry on launch;
-- the running Watchdog state stays in-memory only. config_json holds a
-- serialized WatchdogConfig (the existing trigger/condition/action shape). v31.
CREATE TABLE IF NOT EXISTS itops_automations (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    sort_order   INTEGER NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    config_json  TEXT NOT NULL,
    -- Ordered IT Ops action catalog run on each trigger fire (Phase 4). v32.
    actions_json TEXT NOT NULL DEFAULT '[]',
    created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"#;

pub struct Storage {
    db_path: PathBuf,
    connection: Mutex<SqliteConnection>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    auto_backup_enabled: bool,
    #[serde(default = "default_auto_update_checks_enabled")]
    auto_update_checks_enabled: bool,
    #[serde(default = "default_show_connected_connections_in_rail")]
    show_connected_connections_in_rail: bool,
    #[serde(default = "default_show_workspace_on_rail")]
    show_workspace_on_rail: bool,
    #[serde(default = "default_show_dashboard_on_rail")]
    show_dashboard_on_rail: bool,
    #[serde(default)]
    show_all_connections_in_tree: bool,
    #[serde(default)]
    hide_top_tab_buttons: bool,
    #[serde(default)]
    double_click_opens_connection: bool,
    #[serde(default = "default_submit_ai_attachments_directly")]
    submit_ai_attachments_directly: bool,
    #[serde(default)]
    separate_split_terminal_backgrounds: bool,
    #[serde(default = "default_show_installer_on_rail")]
    show_installer_on_rail: bool,
    // IT Ops Module rail visibility. Defaults off while the Module is in
    // development; users opt in via Settings → IT Ops.
    #[serde(default = "default_show_it_ops")]
    show_it_ops: bool,
    #[serde(default = "default_show_dont_sleep_on_rail")]
    show_dont_sleep_on_rail: bool,
    #[serde(default = "default_activity_rail_order")]
    activity_rail_order: Vec<String>,
    #[serde(default = "default_installer_check_interval_seconds")]
    installer_check_interval_seconds: u32,
    #[serde(default)]
    pinned_connection_ids: Vec<String>,
    #[serde(default = "default_allow_clipboard_read")]
    allow_clipboard_read: bool,
    #[serde(default)]
    auto_start_with_windows: bool,
    #[serde(default)]
    minimize_to_tray: bool,
    #[serde(default)]
    dont_sleep_enabled: bool,
    #[serde(default = "default_dont_sleep_foreground_only")]
    dont_sleep_foreground_only: bool,
    #[serde(default = "default_use_directx_screen_capture")]
    use_directx_screen_capture: bool,
    #[serde(default = "default_status_bar_enabled")]
    status_bar_enabled: bool,
    #[serde(default = "default_status_bar_monitor_enabled")]
    status_bar_monitor_enabled: bool,
    #[serde(default = "default_status_bar_monitor_interval_seconds")]
    status_bar_monitor_interval_seconds: u32,
    #[serde(default)]
    advanced_debugging_enabled: bool,
    #[serde(default)]
    rdp_webview_stability: bool,
    #[serde(default)]
    last_backup_at: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialSettings {
    #[serde(default = "default_secret_store")]
    pub secret_store: String,
}

impl CredentialSettings {
    pub(crate) fn secret_store(&self) -> &str {
        &self.secret_store
    }
}

impl GeneralSettings {
    pub(crate) fn allow_clipboard_read(&self) -> bool {
        // Clipboard read is always enabled; the stored flag is retained only for
        // settings serialization back-compat and no longer gates the permission.
        let _ = self.allow_clipboard_read;
        true
    }

    pub(crate) fn auto_start_with_windows(&self) -> bool {
        self.auto_start_with_windows
    }

    pub(crate) fn minimize_to_tray(&self) -> bool {
        self.minimize_to_tray
    }

    pub(crate) fn dont_sleep_enabled(&self) -> bool {
        self.dont_sleep_enabled
    }

    pub(crate) fn dont_sleep_foreground_only(&self) -> bool {
        self.dont_sleep_foreground_only
    }

    pub(crate) fn use_directx_screen_capture(&self) -> bool {
        self.use_directx_screen_capture
    }

    pub(crate) fn advanced_debugging_enabled(&self) -> bool {
        self.advanced_debugging_enabled
    }

    pub(crate) fn rdp_webview_stability(&self) -> bool {
        self.rdp_webview_stability
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseBackupInfo {
    path: String,
    filename: String,
    created_at: String,
}

impl DatabaseBackupInfo {
    pub(crate) fn filename(&self) -> &str {
        &self.filename
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedDatabaseSnapshot {
    general_settings: GeneralSettings,
    credential_settings: CredentialSettings,
    terminal_settings: TerminalSettings,
    appearance_settings: AppearanceSettings,
    app_launcher_settings: AppLauncherSettings,
    dashboard_settings: DashboardSettings,
    ssh_settings: SshSettings,
    sftp_settings: SftpSettings,
    url_settings: UrlSettings,
    rdp_settings: RdpSettings,
    vnc_settings: VncSettings,
    screenshot_settings: ScreenshotSettings,
    ai_provider_settings: AiProviderSettings,
    connection_tree: ConnectionTree,
    backup: DatabaseBackupInfo,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSettings {
    font_family: String,
    font_size: u16,
    line_height: f32,
    cursor_style: String,
    scrollback_lines: u32,
    #[serde(default = "default_terminal_transparency")]
    default_transparency: u8,
    #[serde(default)]
    use_random_dynamic_background: bool,
    copy_on_select: bool,
    #[serde(default = "default_allow_osc52_clipboard")]
    allow_osc52_clipboard: bool,
    confirm_multiline_paste: bool,
    default_shell: String,
    #[serde(default)]
    custom_shells: Vec<TerminalCustomShell>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCustomShell {
    id: String,
    name: String,
    command_line: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLauncherSettings {
    pub entries: Vec<AppLauncherEntry>,
    #[serde(default = "default_app_launcher_view_mode")]
    pub view_mode: String,
    #[serde(default = "default_app_launcher_list_sort")]
    pub list_sort: AppLauncherSortState,
    #[serde(default = "default_app_launcher_details_sort")]
    pub details_sort: AppLauncherSortState,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLauncherSortState {
    pub field: String,
    pub direction: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSettings {
    pub confirm_remove: bool,
    pub default_landing_view: String,
    /// Maximum number of script widgets allowed to run their iframe at the
    /// same time on a Dashboard view. Excess widgets render as a clickable
    /// placeholder until they are activated (see ADR 0006). Existing rows
    /// without this field load with [`default_max_active_script_widgets`].
    #[serde(default = "default_max_active_script_widgets")]
    pub max_active_script_widgets: u32,
    /// Global kill-switch for KK.net.* APIs in script widgets. When false,
    /// the AI cannot create widgets that perform ping/portScan/DNS/WoL/WHOIS
    /// even if `permissions.networkTools` is set on the widget body. Default
    /// true (per-widget permission flag remains the primary opt-in).
    #[serde(default = "default_allow_widget_network_tools")]
    pub allow_widget_network_tools: bool,
    /// When enabled, newly-created Dashboard views start with a random dynamic
    /// background. Existing views are unchanged.
    #[serde(default)]
    pub use_random_dynamic_background: bool,
    /// How strictly the script-widget iframe forces AI-created layout to fill
    /// its frame: `strict`, `moderate`, or `low`. Applied live at render time
    /// in the frontend `buildSrcdoc`; persisted here so the choice survives
    /// restarts. Rows without this field load with
    /// [`default_widget_layout_enforcement`].
    #[serde(default = "default_widget_layout_enforcement")]
    pub widget_layout_enforcement: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLauncherEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub arguments: Option<String>,
    pub working_directory: Option<String>,
    pub icon_data_url: Option<String>,
    pub rail_pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    app_font_family: String,
    color_scheme: String,
    #[serde(default)]
    custom_font_path: Option<String>,
    #[serde(default)]
    use_custom_title_bar: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSettings {
    default_user: String,
    default_port: u16,
    default_key_path: Option<String>,
    default_proxy_jump: Option<String>,
    #[serde(default)]
    default_ssh_socks_proxy: Option<String>,
    #[serde(default)]
    default_ssh_socks_proxy_username: Option<String>,
    #[serde(default = "default_ssh_buffer_lines")]
    buffer_lines: u32,
    #[serde(default = "default_terminal_transparency")]
    default_transparency: u8,
    #[serde(default = "default_use_tmux_sessions")]
    default_use_tmux_sessions: bool,
    #[serde(default)]
    use_random_dynamic_background: bool,
    #[serde(default = "default_hide_common_port_redirects")]
    hide_common_port_redirects: bool,
    #[serde(default = "default_allow_osc52_clipboard")]
    allow_osc52_clipboard: bool,
    #[serde(default)]
    managed_x_server_enabled: bool,
    #[serde(default)]
    x_server_path: Option<String>,
    #[serde(default = "default_x_server_display")]
    x_server_display: u16,
    #[serde(default = "default_x_server_args")]
    x_server_args: String,
}

impl SshSettings {
    pub(crate) fn managed_x_server_enabled(&self) -> bool {
        self.managed_x_server_enabled
    }

    pub(crate) fn x_server_path(&self) -> Option<&str> {
        self.x_server_path.as_deref()
    }

    pub(crate) fn x_server_display(&self) -> u16 {
        self.x_server_display
    }

    pub(crate) fn x_server_args(&self) -> &str {
        &self.x_server_args
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpSettings {
    overwrite_behavior: String,
    #[serde(default = "default_file_explorer_open_mode")]
    file_explorer_open_mode: String,
    #[serde(default = "default_file_explorer_terminal_shell")]
    file_explorer_terminal_shell: String,
    #[serde(default)]
    file_explorer_terminal_elevated: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlSettings {
    #[serde(default)]
    ignore_certificate_errors: bool,
    #[serde(default)]
    default_proxy_url: Option<String>,
    #[serde(default)]
    default_data_partition: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpSettings {
    #[serde(default = "default_rdp_color_depth")]
    color_depth: u16,
    #[serde(default = "default_remote_desktop_true")]
    redirect_clipboard: bool,
    #[serde(default)]
    redirect_drives: bool,
    #[serde(default = "default_remote_desktop_true")]
    bitmap_cache: bool,
    #[serde(default = "default_remote_desktop_performance_profile")]
    performance_profile: String,
    #[serde(default = "default_remote_desktop_resolution")]
    remote_resolution: String,
    #[serde(default = "default_remote_desktop_view_mode")]
    view_mode: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VncSettings {
    #[serde(default = "default_remote_desktop_true")]
    shared_session: bool,
    #[serde(default)]
    view_only: bool,
    #[serde(default = "default_vnc_color_level")]
    color_level: String,
    #[serde(default = "default_vnc_preferred_encoding")]
    preferred_encoding: String,
    #[serde(default = "default_remote_desktop_view_mode")]
    view_mode: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotSettings {
    folder_path: String,
}

impl ScreenshotSettings {
    pub(crate) fn folder_path(&self) -> &str {
        &self.folder_path
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistantToolSettings {
    #[serde(default = "default_ai_general_tool_enabled")]
    web_search: bool,
    #[serde(default = "default_ai_general_tool_enabled")]
    web_fetch: bool,
    #[serde(default = "default_ai_general_tool_enabled")]
    shell_command: bool,
    #[serde(default = "default_ai_general_tool_enabled")]
    app_data_file_search: bool,
    #[serde(default = "default_ai_general_tool_enabled")]
    app_data_file_read: bool,
    #[serde(default = "default_ai_current_time_tool_enabled")]
    current_time: bool,
    #[serde(default = "default_ai_performance_counters_tool_enabled")]
    performance_counters: bool,
    #[serde(default = "default_ai_dashboard_tool_enabled")]
    dashboard: bool,
    #[serde(default = "default_ai_connections_tool_enabled")]
    connections: bool,
    #[serde(default = "default_ai_sessions_tool_enabled")]
    sessions: bool,
    #[serde(default = "default_ai_tutorial_tool_enabled")]
    tutorial: bool,
    #[serde(default)]
    email: bool,
    #[serde(default = "default_ai_manual_tool_enabled")]
    manual: bool,
    #[serde(default)]
    network: bool,
    #[serde(default = "default_ai_watchdog_tool_enabled")]
    watchdog: bool,
    #[serde(default = "default_ai_memory_tool_enabled")]
    memory: bool,
}

impl AiAssistantToolSettings {
    pub(crate) fn web_search(&self) -> bool {
        self.web_search
    }
    pub(crate) fn web_fetch(&self) -> bool {
        self.web_fetch
    }
    pub(crate) fn shell_command(&self) -> bool {
        self.shell_command
    }
    pub(crate) fn app_data_file_search(&self) -> bool {
        self.app_data_file_search
    }
    pub(crate) fn app_data_file_read(&self) -> bool {
        self.app_data_file_read
    }
    pub(crate) fn current_time(&self) -> bool {
        self.current_time
    }
    pub(crate) fn performance_counters(&self) -> bool {
        self.performance_counters
    }
    pub(crate) fn dashboard(&self) -> bool {
        self.dashboard
    }
    pub(crate) fn connections(&self) -> bool {
        self.connections
    }
    pub(crate) fn sessions(&self) -> bool {
        self.sessions
    }
    pub(crate) fn tutorial(&self) -> bool {
        self.tutorial
    }
    pub(crate) fn email(&self) -> bool {
        self.email
    }
    pub(crate) fn manual(&self) -> bool {
        self.manual
    }
    pub(crate) fn network(&self) -> bool {
        self.network
    }
    pub(crate) fn watchdog(&self) -> bool {
        self.watchdog
    }
    pub(crate) fn memory(&self) -> bool {
        self.memory
    }
    pub(crate) fn any_enabled(&self) -> bool {
        self.web_search
            || self.web_fetch
            || self.shell_command
            || self.app_data_file_search
            || self.app_data_file_read
            || self.current_time
            || self.performance_counters
            || self.dashboard
            || self.connections
            || self.sessions
            || self.tutorial
            || self.email
            || self.manual
            || self.network
            || self.watchdog
            || self.memory
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderSettings {
    #[serde(default)]
    enabled: bool,
    #[serde(default = "default_ai_provider_kind")]
    provider_kind: String,
    base_url: String,
    #[serde(default = "default_ai_model")]
    model: String,
    #[serde(default = "default_ai_reasoning_effort")]
    reasoning_effort: String,
    #[serde(default)]
    output_language: String,
    #[serde(default)]
    custom_instructions: String,
    #[serde(default = "default_ai_api_mode")]
    api_mode: String,
    #[serde(default)]
    extra_headers: String,
    #[serde(default)]
    allow_insecure_tls: bool,
    #[serde(default)]
    allow_insecure_mcp_http: bool,
    #[serde(default)]
    show_all_models: bool,
    #[serde(default = "default_ai_cli_execution_policy")]
    cli_execution_policy: String,
    #[serde(default = "default_ai_tool_permission_mode")]
    tool_permission_mode: String,
    #[serde(default = "default_built_in_mcp_server_enabled")]
    built_in_mcp_server_enabled: bool,
    #[serde(default)]
    built_in_mcp_allow_all_dangerous: bool,
    #[serde(default)]
    use_codex_cli: bool,
    #[serde(default)]
    use_claude_cli: bool,
    #[serde(default)]
    claude_cli_path: Option<String>,
    #[serde(default)]
    codex_cli_path: Option<String>,
    #[serde(default)]
    disabled_skill_names: Vec<String>,
    #[serde(default = "default_custom_assistant_skills_enabled")]
    custom_skills_enabled: bool,
    #[serde(default = "default_ai_assistant_tool_settings")]
    tools: AiAssistantToolSettings,
    #[serde(default = "default_search_provider")]
    search_provider: String,
    #[serde(default)]
    searxng_url: String,
    #[serde(default = "default_email_provider")]
    email_provider: String,
    #[serde(default)]
    email_from: String,
    #[serde(default)]
    mailgun_domain: String,
    #[serde(default)]
    smtp_host: String,
    #[serde(default = "default_smtp_port")]
    smtp_port: u16,
    #[serde(default)]
    smtp_username: String,
    #[serde(default = "default_smtp_security")]
    smtp_security: String,
    #[serde(skip)]
    search_provider_api_key: Option<String>,
    #[serde(skip)]
    email_secret: Option<String>,
}

impl AiProviderSettings {
    pub(crate) fn provider_kind(&self) -> &str {
        &self.provider_kind
    }

    pub(crate) fn base_url(&self) -> &str {
        &self.base_url
    }

    pub(crate) fn model(&self) -> &str {
        &self.model
    }

    pub(crate) fn reasoning_effort(&self) -> &str {
        &self.reasoning_effort
    }

    pub(crate) fn allow_insecure_tls(&self) -> bool {
        self.allow_insecure_tls
    }

    pub(crate) fn allow_insecure_mcp_http(&self) -> bool {
        self.allow_insecure_mcp_http
    }

    pub(crate) fn custom_instructions(&self) -> &str {
        &self.custom_instructions
    }

    pub(crate) fn api_mode(&self) -> &str {
        &self.api_mode
    }

    pub(crate) fn extra_headers(&self) -> &str {
        &self.extra_headers
    }

    pub(crate) fn tools(&self) -> &AiAssistantToolSettings {
        &self.tools
    }

    pub(crate) fn tool_permission_mode(&self) -> &str {
        &self.tool_permission_mode
    }

    pub(crate) fn built_in_mcp_server_enabled(&self) -> bool {
        self.built_in_mcp_server_enabled
    }

    pub(crate) fn built_in_mcp_allow_all_dangerous(&self) -> bool {
        self.built_in_mcp_allow_all_dangerous
    }

    pub(crate) fn use_codex_cli(&self) -> bool {
        self.provider_kind == "openai" && self.use_codex_cli
    }

    pub(crate) fn use_claude_cli(&self) -> bool {
        self.provider_kind == "anthropic" && self.use_claude_cli
    }

    pub(crate) fn claude_cli_path(&self) -> Option<&str> {
        self.claude_cli_path.as_deref()
    }

    pub(crate) fn codex_cli_path(&self) -> Option<&str> {
        self.codex_cli_path.as_deref()
    }

    pub(crate) fn disabled_skill_names(&self) -> &[String] {
        &self.disabled_skill_names
    }

    pub(crate) fn custom_skills_enabled(&self) -> bool {
        self.custom_skills_enabled
    }

    pub(crate) fn set_custom_skills_enabled(&mut self, enabled: bool) {
        self.custom_skills_enabled = enabled;
    }

    pub(crate) fn set_skill_enabled(&mut self, name: String, enabled: bool) {
        if enabled {
            self.disabled_skill_names
                .retain(|existing| existing != &name);
        } else if !self.disabled_skill_names.contains(&name) {
            self.disabled_skill_names.push(name);
        }
        self.disabled_skill_names = crate::assistant_skills::normalize_skill_names(std::mem::take(
            &mut self.disabled_skill_names,
        ));
    }

    pub(crate) fn search_provider(&self) -> &str {
        &self.search_provider
    }

    pub(crate) fn searxng_url(&self) -> &str {
        &self.searxng_url
    }

    pub(crate) fn search_provider_api_key(&self) -> Option<&str> {
        self.search_provider_api_key.as_deref()
    }

    pub(crate) fn set_search_provider_api_key(&mut self, key: Option<String>) {
        self.search_provider_api_key = key;
    }

    pub(crate) fn email_provider(&self) -> &str {
        &self.email_provider
    }

    pub(crate) fn email_from(&self) -> &str {
        &self.email_from
    }

    pub(crate) fn mailgun_domain(&self) -> &str {
        &self.mailgun_domain
    }

    pub(crate) fn smtp_host(&self) -> &str {
        &self.smtp_host
    }

    pub(crate) fn smtp_port(&self) -> u16 {
        self.smtp_port
    }

    pub(crate) fn smtp_username(&self) -> &str {
        &self.smtp_username
    }

    pub(crate) fn smtp_security(&self) -> &str {
        &self.smtp_security
    }

    pub(crate) fn email_secret(&self) -> Option<&str> {
        self.email_secret.as_deref()
    }

    pub(crate) fn set_email_secret(&mut self, secret: Option<String>) {
        self.email_secret = secret;
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTree {
    connections: Vec<SavedConnection>,
    folders: Vec<ConnectionFolder>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    id: String,
    name: String,
    icon: Option<String>,
    icon_color: Option<String>,
    is_default: bool,
    sort_order: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceRequest {
    name: String,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    icon_color: Option<String>,
    #[serde(default)]
    import_connection_ids: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameWorkspaceRequest {
    id: String,
    name: String,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    icon_color: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderWorkspacesRequest {
    ordered_ids: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionFolder {
    id: String,
    name: String,
    icon_data_url: Option<String>,
    connections: Vec<SavedConnection>,
    folders: Vec<ConnectionFolder>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnection {
    id: String,
    name: String,
    tab_title: Option<String>,
    host: String,
    user: String,
    port: Option<u16>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    ssh_socks_proxy: Option<String>,
    ssh_socks_proxy_username: Option<String>,
    ssh_socks_proxy_inherit_defaults: bool,
    #[serde(default)]
    ssh_compression: Option<String>,
    auth_method: String,
    local_shell: Option<String>,
    local_startup_directory: Option<String>,
    local_startup_script: Option<String>,
    url: Option<String>,
    data_partition: Option<String>,
    url_proxy: Option<String>,
    url_proxy_inherit_defaults: bool,
    use_tmux_sessions: bool,
    use_psmux_sessions: bool,
    tmux_connection_id: Option<String>,
    serial_line: Option<String>,
    serial_speed: Option<u32>,
    url_credential_username: Option<String>,
    has_url_credential: bool,
    rdp_options: Option<RdpConnectionOptions>,
    vnc_options: Option<VncConnectionOptions>,
    #[serde(default)]
    ftp_options: Option<crate::ftp::FtpOptions>,
    password_credential_id: Option<String>,
    icon_data_url: Option<String>,
    icon_background_color: Option<String>,
    terminal_opacity: Option<u8>,
    terminal_background: Option<crate::dashboard_storage::DashboardBackground>,
    file_browser_view_options: Option<FileBrowserViewOptions>,
    ssh_port_forwardings: Option<Vec<SshPortForwarding>>,
    file_view_open_external: bool,
    #[serde(rename = "type")]
    connection_type: String,
    tags: Vec<String>,
    status: String,
}

/// Per-pane File Explorer / SFTP browser view options (item zoom + content-view
/// background). Persisted per Connection so the durable browser surfaces keep
/// their look; the ephemeral terminal-spawned SFTP popup never writes these.
#[derive(Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileBrowserViewOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    local: Option<FileBrowserPaneViewOptions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    remote: Option<FileBrowserPaneViewOptions>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileBrowserPaneViewOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    zoom: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    background: Option<crate::dashboard_storage::DashboardBackground>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SshPortForwarding {
    id: String,
    mode: String,
    enabled: bool,
    bind: String,
    listen_port: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    dest_host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    dest_port: Option<u16>,
}

impl FileBrowserViewOptions {
    fn validate(&self) -> Result<(), String> {
        for pane in [&self.local, &self.remote].into_iter().flatten() {
            if let Some(background) = &pane.background {
                background
                    .validate()
                    .map_err(|error| format!("{error:?}"))?;
            }
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConnectionRequest {
    name: String,
    #[serde(default)]
    host: String,
    #[serde(default)]
    user: String,
    #[serde(rename = "type")]
    connection_type: String,
    folder_id: Option<String>,
    #[serde(default)]
    workspace_id: Option<String>,
    port: Option<u16>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    ssh_socks_proxy: Option<String>,
    #[serde(default)]
    ssh_socks_proxy_username: Option<String>,
    ssh_socks_proxy_inherit_defaults: Option<bool>,
    #[serde(default)]
    ssh_compression: Option<String>,
    auth_method: Option<String>,
    local_shell: Option<String>,
    #[serde(default)]
    local_startup_directory: Option<String>,
    #[serde(default)]
    local_startup_script: Option<String>,
    url: Option<String>,
    data_partition: Option<String>,
    #[serde(default)]
    url_proxy: Option<String>,
    #[serde(default)]
    url_proxy_inherit_defaults: Option<bool>,
    use_tmux_sessions: Option<bool>,
    #[serde(default)]
    use_psmux_sessions: Option<bool>,
    serial_line: Option<String>,
    serial_speed: Option<u32>,
    rdp_options: Option<RdpConnectionOptions>,
    vnc_options: Option<VncConnectionOptions>,
    #[serde(default)]
    ftp_options: Option<crate::ftp::FtpOptions>,
    #[serde(default)]
    ssh_port_forwardings: Option<Vec<SshPortForwarding>>,
    #[serde(default)]
    file_view_open_external: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConnectionRequest {
    id: String,
    name: String,
    #[serde(default)]
    host: String,
    #[serde(default)]
    user: String,
    #[serde(rename = "type")]
    connection_type: String,
    folder_id: Option<String>,
    port: Option<u16>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    ssh_socks_proxy: Option<String>,
    #[serde(default)]
    ssh_socks_proxy_username: Option<String>,
    ssh_socks_proxy_inherit_defaults: Option<bool>,
    #[serde(default)]
    ssh_compression: Option<String>,
    auth_method: Option<String>,
    local_shell: Option<String>,
    #[serde(default)]
    local_startup_directory: Option<String>,
    #[serde(default)]
    local_startup_script: Option<String>,
    url: Option<String>,
    data_partition: Option<String>,
    #[serde(default)]
    url_proxy: Option<String>,
    #[serde(default)]
    url_proxy_inherit_defaults: Option<bool>,
    use_tmux_sessions: Option<bool>,
    #[serde(default)]
    use_psmux_sessions: Option<bool>,
    serial_line: Option<String>,
    serial_speed: Option<u32>,
    rdp_options: Option<RdpConnectionOptions>,
    vnc_options: Option<VncConnectionOptions>,
    #[serde(default)]
    ftp_options: Option<crate::ftp::FtpOptions>,
    #[serde(default)]
    ssh_port_forwardings: Option<Vec<SshPortForwarding>>,
    #[serde(default)]
    file_view_open_external: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpConnectionOptions {
    #[serde(default = "default_remote_desktop_true")]
    inherit_defaults: bool,
    #[serde(default)]
    color_depth: Option<u16>,
    #[serde(default)]
    redirect_clipboard: Option<bool>,
    #[serde(default)]
    redirect_drives: Option<bool>,
    #[serde(default)]
    bitmap_cache: Option<bool>,
    #[serde(default)]
    performance_profile: Option<String>,
    #[serde(default)]
    remote_resolution: Option<String>,
    #[serde(default)]
    view_mode: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VncConnectionOptions {
    #[serde(default = "default_remote_desktop_true")]
    inherit_defaults: bool,
    #[serde(default)]
    shared_session: Option<bool>,
    #[serde(default)]
    view_only: Option<bool>,
    #[serde(default)]
    color_level: Option<String>,
    #[serde(default)]
    preferred_encoding: Option<String>,
    #[serde(default)]
    view_mode: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConnectionFolderRequest {
    name: String,
    parent_folder_id: Option<String>,
    #[serde(default)]
    workspace_id: Option<String>,
    #[serde(default)]
    icon_data_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameConnectionFolderRequest {
    id: String,
    name: String,
    #[serde(default)]
    icon_data_url: Option<Option<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameConnectionRequest {
    id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateConnectionRequest {
    id: String,
    name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveConnectionFolderRequest {
    id: String,
    parent_folder_id: Option<String>,
    target_index: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveConnectionRequest {
    id: String,
    folder_id: Option<String>,
    target_index: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertUrlCredentialRequest {
    connection_id: String,
    username: String,
    #[serde(default)]
    page_url: Option<String>,
    #[serde(default)]
    username_selector: Option<String>,
    #[serde(default)]
    password_selector: Option<String>,
    #[serde(default)]
    field_values: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlCredentialSummary {
    connection_id: String,
    page_key: String,
    secret_owner_id: String,
    connection_name: String,
    url: Option<String>,
    page_url: Option<String>,
    username: String,
    username_selector: Option<String>,
    password_selector: Option<String>,
    field_values: Option<String>,
    updated_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlDataPartitionSummary {
    name: String,
    connection_count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCredentialCandidate {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) secret_kind: String,
    pub(crate) owner_id: String,
    pub(crate) label: String,
    pub(crate) detail: Option<String>,
    pub(crate) connection_type: Option<String>,
    pub(crate) host: Option<String>,
    pub(crate) username: Option<String>,
    pub(crate) updated_at: Option<String>,
    pub(crate) metadata_source: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionPasswordCredentialSummary {
    pub(crate) id: String,
    pub(crate) connection_type: String,
    pub(crate) host: String,
    pub(crate) username: String,
    pub(crate) label: String,
    pub(crate) created_from_connection_id: Option<String>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

pub(crate) const LEGACY_AI_PROVIDER_SECRET_OWNER_ID: &str = "openai-compatible-provider";
pub(crate) const EMAIL_API_SECRET_OWNER_ID: &str = "email-tool-api-key";
pub(crate) const EMAIL_SMTP_SECRET_OWNER_ID: &str = "email-tool-smtp-password";

const AI_PROVIDER_CREDENTIALS: &[(&str, &str, &str)] = &[
    ("openai", "OpenAI", "OpenAI API key"),
    ("anthropic", "Anthropic", "Anthropic API key"),
    ("openrouter", "OpenRouter", "OpenRouter API key"),
    ("deepseek", "DeepSeek", "DeepSeek API key"),
    ("gemini", "Google Gemini", "Google AI Studio API key"),
    ("grok", "xAI Grok", "xAI API key"),
    ("azure-openai", "Azure OpenAI", "Azure OpenAI API key"),
    ("litellm", "LiteLLM", "LiteLLM key"),
    ("github-copilot", "GitHub Copilot", "GitHub OAuth token"),
    ("ollama", "Ollama", "Ollama API key"),
    ("nvidia", "NVIDIA", "NVIDIA API key"),
    ("opencode", "OpenCode", "OpenCode API key"),
    ("openai-compatible", "OpenAI-compatible", "API key"),
];

pub(crate) fn ai_provider_secret_owner_id(provider_kind: &str) -> String {
    format!("ai-provider:{}", provider_kind.trim().to_lowercase())
}

#[derive(Clone)]
pub(crate) struct UrlCredentialFill {
    pub(crate) secret_owner_id: String,
    pub(crate) username: String,
    pub(crate) username_selector: Option<String>,
    pub(crate) password_selector: Option<String>,
    pub(crate) field_values: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantChatThreadRecord {
    pub id: String,
    pub title: String,
    pub context_label: String,
    pub messages_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantMemoryRecord {
    pub id: String,
    pub scope: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

mod settings;

mod connections;

impl Storage {
    pub fn open(db_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "failed to create data directory {}: {error}",
                    parent.display()
                )
            })?;
        }

        let connection = open_initialized_connection(&db_path)?;

        let storage = Self {
            db_path,
            connection: Mutex::new(connection),
        };
        storage.initialize_schema()?;
        Ok(storage)
    }

    pub fn status(&self) -> String {
        format!("SQLite: {}", self.db_path.display())
    }

    pub(crate) fn db_path(&self) -> PathBuf {
        self.db_path.clone()
    }

    pub fn database_folder(&self) -> Result<String, String> {
        let parent = self
            .db_path
            .parent()
            .ok_or_else(|| "database path must include a parent directory".to_string())?;
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create database directory {}: {error}",
                parent.display()
            )
        })?;
        Ok(parent.display().to_string())
    }

    pub fn backup_if_enabled_for_startup(&self) -> Result<Option<DatabaseBackupInfo>, String> {
        if self.general_settings()?.auto_backup_enabled {
            let backup = self.backup_database()?;
            self.delete_old_backups()?;
            Ok(Some(backup))
        } else {
            Ok(None)
        }
    }

    pub fn backup_database(&self) -> Result<DatabaseBackupInfo, String> {
        let backup_dir = self.backup_dir()?;
        fs::create_dir_all(&backup_dir).map_err(|error| {
            format!(
                "failed to create backup directory {}: {error}",
                backup_dir.display()
            )
        })?;
        let path = self.next_backup_path(&backup_dir)?;
        self.write_database_zip(&path, "backup", true)?;
        let created_at = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "unknown".to_string());
        let backup = DatabaseBackupInfo {
            filename: path
                .file_name()
                .and_then(|filename| filename.to_str())
                .ok_or_else(|| "backup filename is not valid UTF-8".to_string())?
                .to_string(),
            path: path.display().to_string(),
            created_at,
        };
        self.record_last_backup_at(&backup.created_at)?;
        Ok(backup)
    }

    pub fn export_database(&self, export_path: PathBuf) -> Result<DatabaseBackupInfo, String> {
        self.write_database_zip(&export_path, "export", false)?;
        let created_at = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "unknown".to_string());
        Ok(DatabaseBackupInfo {
            filename: export_path
                .file_name()
                .and_then(|filename| filename.to_str())
                .ok_or_else(|| "export filename is not valid UTF-8".to_string())?
                .to_string(),
            path: export_path.display().to_string(),
            created_at,
        })
    }

    fn write_database_zip(
        &self,
        export_path: &Path,
        temp_prefix: &str,
        create_new: bool,
    ) -> Result<(), String> {
        let temp_db_path = self.temp_database_path(temp_prefix);
        remove_file_if_exists(&temp_db_path)?;
        {
            let connection = self.lock()?;
            let sql_path = temp_db_path
                .to_str()
                .ok_or_else(|| "temporary export path is not valid UTF-8".to_string())?
                .replace("'", "''");
            connection
                .execute_batch(&format!("VACUUM INTO '{}';", sql_path))
                .map_err(|error| format!("failed to snapshot database for export: {error}"))?;
        }

        let export_file = if create_new {
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(export_path)
        } else {
            File::create(export_path)
        }
        .map_err(|error| {
            format!(
                "failed to create export file {}: {error}",
                export_path.display()
            )
        })?;
        let mut zip = ZipWriter::new(export_file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("kkterm.sqlite3", options)
            .map_err(|error| format!("failed to add database to export: {error}"))?;
        let mut temp_db = File::open(&temp_db_path).map_err(|error| {
            format!(
                "failed to read database snapshot {}: {error}",
                temp_db_path.display()
            )
        })?;
        copy(&mut temp_db, &mut zip)
            .map_err(|error| format!("failed to write database export: {error}"))?;
        zip.start_file("manifest.json", options)
            .map_err(|error| format!("failed to add export manifest: {error}"))?;
        let manifest = serde_json::json!({
            "product": "KKTerm",
            "format": "kkterm-settings-export",
            "version": 1,
            "createdAt": OffsetDateTime::now_utc().format(&Rfc3339).unwrap_or_else(|_| "unknown".to_string()),
        });
        zip.write_all(manifest.to_string().as_bytes())
            .map_err(|error| format!("failed to write export manifest: {error}"))?;
        zip.finish()
            .map_err(|error| format!("failed to finish database export: {error}"))?;
        remove_file_if_exists(&temp_db_path)?;
        Ok(())
    }

    pub fn import_database_zip(
        &self,
        import_path: PathBuf,
    ) -> Result<ImportedDatabaseSnapshot, String> {
        let temp_import_path = self.temp_database_path("import");
        remove_file_if_exists(&temp_import_path)?;
        extract_imported_database(&import_path, &temp_import_path)?;
        validate_import_database(&temp_import_path)?;

        let backup = self.backup_database()?;
        {
            let mut connection = self.lock()?;
            let placeholder = SqliteConnection::open_in_memory()
                .map_err(|error| format!("failed to prepare database replacement: {error}"))?;
            let old_connection = std::mem::replace(&mut *connection, placeholder);
            drop(old_connection);
            // Closing the old connection checkpoints and removes its WAL, but
            // clear any stale sidecars defensively before overwriting the main
            // file: a leftover -wal/-shm from the previous database would be
            // misapplied to the freshly imported file on reopen.
            remove_wal_sidecars(&self.db_path)?;
            fs::copy(&temp_import_path, &self.db_path).map_err(|error| {
                format!(
                    "failed to replace database {} with import {}: {error}",
                    self.db_path.display(),
                    temp_import_path.display()
                )
            })?;
            let new_connection = open_initialized_connection(&self.db_path)?;
            *connection = new_connection;
        }
        remove_file_if_exists(&temp_import_path)?;
        self.record_last_backup_at(&backup.created_at)?;
        Ok(ImportedDatabaseSnapshot {
            general_settings: self.general_settings()?,
            credential_settings: self.credential_settings()?,
            terminal_settings: self.terminal_settings()?,
            appearance_settings: self.appearance_settings()?,
            app_launcher_settings: self.app_launcher_settings()?,
            dashboard_settings: self.dashboard_settings()?,
            ssh_settings: self.ssh_settings()?,
            sftp_settings: self.sftp_settings()?,
            url_settings: self.url_settings()?,
            rdp_settings: self.rdp_settings()?,
            vnc_settings: self.vnc_settings()?,
            screenshot_settings: self.screenshot_settings()?,
            ai_provider_settings: self.ai_provider_settings()?,
            connection_tree: self.list_connection_tree()?,
            backup,
        })
    }

    /// Full root tree across every Workspace. Used by export, import
    /// validation, and the AI connection-context projection, which intentionally
    /// span all Workspaces.
    pub fn list_connection_tree(&self) -> Result<ConnectionTree, String> {
        let connection = self.lock()?;
        Ok(ConnectionTree {
            connections: list_connections_for_folder(&connection, None)?,
            folders: list_folders_for_parent(&connection, None)?,
        })
    }

    /// Root tree scoped to a single Workspace — the UI Connection Tree path.
    pub fn list_connection_tree_for_workspace(
        &self,
        workspace_id: String,
    ) -> Result<ConnectionTree, String> {
        let workspace_id = normalize_workspace_id(workspace_id);
        let connection = self.lock()?;
        Ok(ConnectionTree {
            connections: list_root_connections_for_workspace(&connection, &workspace_id)?,
            folders: list_root_folders_for_workspace(&connection, &workspace_id)?,
        })
    }
    fn initialize_schema(&self) -> Result<(), String> {
        let connection = self.lock()?;
        let stored_version: i32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(to_storage_error)?;
        // The Dashboard tables get rebuilt only when the user's stored
        // version predates the last Dashboard-schema-changing migration
        // (v16). Pure-additive schema bumps after v16 (v17 added
        // `installer_tool_state`) must NOT drop these tables — that
        // would wipe Dashboard Views and AI Created Widgets on every
        // upgrade for users already on v16+.
        if stored_version < 16 {
            connection
                .execute_batch(
                    r#"
                    DROP TABLE IF EXISTS dashboard_widget_instances;
                    DROP TABLE IF EXISTS dashboard_custom_widgets;
                    DROP TABLE IF EXISTS dashboard_views;
                "#,
                )
                .map_err(to_storage_error)?;
        }
        if stored_version < 10 && table_exists(&connection, "connections")? {
            // SQLite can't alter a CHECK constraint in place; rebuild the table
            // so the connection_type CHECK accepts the new 'ftp' kind and the
            // new ftp_options column is present.
            ensure_column(&connection, "connections", "ftp_options", "TEXT")?;
            connection
                .execute_batch(
                    r#"
                    BEGIN;
                    ALTER TABLE connections RENAME TO connections_pre_v10;
                    CREATE TABLE connections (
                        id TEXT PRIMARY KEY,
                        folder_id TEXT REFERENCES connection_folders(id) ON DELETE CASCADE,
                        name TEXT NOT NULL,
                        host TEXT NOT NULL,
                        username TEXT NOT NULL,
                        port INTEGER,
                        key_path TEXT,
                        proxy_jump TEXT,
                        auth_method TEXT NOT NULL DEFAULT 'keyFile',
                        local_shell TEXT,
                        url TEXT,
                        data_partition TEXT,
                        use_tmux_sessions INTEGER NOT NULL DEFAULT 1,
                        tmux_connection_id TEXT,
                        serial_line TEXT,
                        serial_speed INTEGER,
                        rdp_options TEXT,
                        vnc_options TEXT,
                        ftp_options TEXT,
                        connection_type TEXT NOT NULL CHECK (connection_type IN ('local', 'ssh', 'telnet', 'serial', 'url', 'rdp', 'vnc', 'ftp')),
                        status TEXT NOT NULL CHECK (status IN ('connected', 'idle', 'offline')),
                        sort_order INTEGER NOT NULL
                    );
                    INSERT INTO connections (
                        id, folder_id, name, host, username, port, key_path, proxy_jump,
                        auth_method, local_shell, url, data_partition, use_tmux_sessions,
                        tmux_connection_id, serial_line, serial_speed, rdp_options, vnc_options,
                        ftp_options, connection_type, status, sort_order
                    )
                    SELECT
                        id, folder_id, name, host, username, port, key_path, proxy_jump,
                        auth_method, local_shell, url, data_partition, use_tmux_sessions,
                        tmux_connection_id, serial_line, serial_speed, rdp_options, vnc_options,
                        ftp_options, connection_type, status, sort_order
                    FROM connections_pre_v10;
                    DROP TABLE connections_pre_v10;
                    COMMIT;
                    "#,
                )
                .map_err(to_storage_error)?;
        }
        connection
            .execute_batch(CURRENT_SCHEMA)
            .map_err(to_storage_error)?;
        // v32: IT Ops Automations gain an ordered action catalog (Phase 4).
        // Unconditional ensure_column so an existing v31 database picks up the
        // new column (CREATE TABLE IF NOT EXISTS won't add it).
        ensure_column(
            &connection,
            "itops_automations",
            "actions_json",
            "TEXT NOT NULL DEFAULT '[]'",
        )?;
        ensure_column(&connection, "connections", "rdp_options", "TEXT")?;
        ensure_column(&connection, "connections", "vnc_options", "TEXT")?;
        ensure_column(&connection, "connections", "ftp_options", "TEXT")?;
        ensure_column(&connection, "connections", "ssh_socks_proxy", "TEXT")?;
        ensure_column(
            &connection,
            "connections",
            "ssh_socks_proxy_username",
            "TEXT",
        )?;
        ensure_column(
            &connection,
            "connections",
            "ssh_socks_proxy_inherit_defaults",
            "INTEGER NOT NULL DEFAULT 1",
        )?;
        ensure_column(&connection, "connections", "icon_data_url", "TEXT")?;
        ensure_column(&connection, "connections", "icon_background_color", "TEXT")?;
        ensure_column(&connection, "connection_folders", "icon_data_url", "TEXT")?;
        ensure_column(&connection, "connections", "terminal_opacity", "INTEGER")?;
        ensure_column(
            &connection,
            "connections",
            "terminal_background_json",
            "TEXT",
        )?;
        ensure_column(
            &connection,
            "connections",
            "file_browser_view_options_json",
            "TEXT",
        )?;
        ensure_column(
            &connection,
            "connections",
            "ssh_port_forwardings_json",
            "TEXT",
        )?;
        ensure_column(
            &connection,
            "connections",
            "file_view_open_external",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        ensure_column(&connection, "connections", "tab_title", "TEXT")?;
        ensure_column(&connection, "connections", "password_credential_id", "TEXT")?;
        ensure_column(
            &connection,
            "connections",
            "local_startup_directory",
            "TEXT",
        )?;
        ensure_column(&connection, "connections", "local_startup_script", "TEXT")?;
        ensure_column(&connection, "url_credentials", "field_values", "TEXT")?;
        migrate_url_credentials_page_keys(&connection)?;
        ensure_column(
            &connection,
            "dashboard_custom_widgets",
            "settings_schema_json",
            "TEXT NOT NULL DEFAULT '{\"fields\":[]}'",
        )?;
        ensure_column(
            &connection,
            "dashboard_custom_widgets",
            "created_at",
            "TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'",
        )?;
        ensure_column(
            &connection,
            "dashboard_custom_widgets",
            "updated_at",
            "TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'",
        )?;
        ensure_column(
            &connection,
            "dashboard_widget_instances",
            "settings_values_json",
            "TEXT NOT NULL DEFAULT '{}'",
        )?;
        ensure_column(
            &connection,
            "dashboard_widget_instances",
            "hide_title",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        ensure_column(
            &connection,
            "dashboard_widget_instances",
            "body_opacity",
            "INTEGER",
        )?;
        ensure_column(&connection, "dashboard_views", "background_json", "TEXT")?;
        ensure_column(&connection, "dashboard_views", "tab_color", "TEXT")?;
        ensure_column(
            &connection,
            "ai_coding_usage_accounts",
            "subscription_plan",
            "TEXT",
        )?;
        connection
            .execute(
                "UPDATE dashboard_widget_instances
                    SET grid_y = CASE
                        WHEN grid_h >= ?1 THEN 0
                        ELSE ?1 - grid_h
                    END
                 WHERE grid_y < 0 OR grid_y + grid_h > ?1",
                params![crate::dashboard_validation::GRID_MAX_ROWS],
            )
            .map_err(to_storage_error)?;
        // v20: Workspace model. Existing connection tables predate the
        // `workspace_id` column and the `localFiles` connection kind. SQLite
        // can't alter a CHECK constraint in place, so rebuild the connections
        // table when it lacks `workspace_id` (fresh installs already get the
        // new shape from CURRENT_SCHEMA and skip this). Then seed the permanent
        // Default Workspace and backfill every pre-existing Connection/folder
        // onto it.
        if table_exists(&connection, "connections")?
            && !column_exists(&connection, "connections", "workspace_id")?
        {
            connection
                .pragma_update(None, "legacy_alter_table", "ON")
                .map_err(to_storage_error)?;
            connection
                .execute_batch(
                    r#"
                    BEGIN;
                    ALTER TABLE connections RENAME TO connections_pre_v20;
                    CREATE TABLE connections (
                        id TEXT PRIMARY KEY,
                        folder_id TEXT REFERENCES connection_folders(id) ON DELETE CASCADE,
                        workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
                        name TEXT NOT NULL,
                        tab_title TEXT,
                        host TEXT NOT NULL,
                        username TEXT NOT NULL,
                        port INTEGER,
                        key_path TEXT,
                        proxy_jump TEXT,
                        ssh_socks_proxy TEXT,
                        ssh_socks_proxy_username TEXT,
                        ssh_socks_proxy_inherit_defaults INTEGER NOT NULL DEFAULT 1,
                        auth_method TEXT NOT NULL DEFAULT 'keyFile',
                        local_shell TEXT,
                        local_startup_directory TEXT,
                        local_startup_script TEXT,
                        url TEXT,
                        data_partition TEXT,
                        use_tmux_sessions INTEGER NOT NULL DEFAULT 1,
                        tmux_connection_id TEXT,
                        serial_line TEXT,
                        serial_speed INTEGER,
                        rdp_options TEXT,
                        vnc_options TEXT,
                        ftp_options TEXT,
                        password_credential_id TEXT REFERENCES connection_password_credentials(id) ON DELETE SET NULL,
                        icon_data_url TEXT,
                        icon_background_color TEXT,
                        terminal_opacity INTEGER,
                        terminal_background_json TEXT,
                        file_browser_view_options_json TEXT,
                        connection_type TEXT NOT NULL CHECK (connection_type IN ('local', 'ssh', 'telnet', 'serial', 'url', 'rdp', 'vnc', 'ftp', 'localFiles')),
                        status TEXT NOT NULL CHECK (status IN ('connected', 'idle', 'offline')),
                        sort_order INTEGER NOT NULL
                    );
                    INSERT INTO connections (
                        id, folder_id, name, tab_title, host, username, port, key_path,
                        proxy_jump, ssh_socks_proxy, ssh_socks_proxy_username, ssh_socks_proxy_inherit_defaults,
                        auth_method, local_shell, local_startup_directory,
                        local_startup_script, url, data_partition, use_tmux_sessions,
                        tmux_connection_id, serial_line, serial_speed, rdp_options, vnc_options,
                        ftp_options, password_credential_id, icon_data_url, icon_background_color,
                        terminal_opacity, terminal_background_json, file_browser_view_options_json,
                        connection_type, status, sort_order
                    )
                    SELECT
                        id, folder_id, name, tab_title, host, username, port, key_path,
                        proxy_jump, ssh_socks_proxy, NULL, ssh_socks_proxy_inherit_defaults,
                        auth_method, local_shell, local_startup_directory,
                        local_startup_script, url, data_partition, use_tmux_sessions,
                        tmux_connection_id, serial_line, serial_speed, rdp_options, vnc_options,
                        ftp_options, password_credential_id, icon_data_url, icon_background_color,
                        terminal_opacity, terminal_background_json, file_browser_view_options_json,
                        connection_type, status, sort_order
                    FROM connections_pre_v20;
                    DROP TABLE connections_pre_v20;
                    COMMIT;
                    "#,
                )
                .map_err(to_storage_error)?;
            connection
                .pragma_update(None, "legacy_alter_table", "OFF")
                .map_err(to_storage_error)?;
        }
        repair_connections_pre_v20_references(&connection)?;
        ensure_column(&connection, "connection_folders", "workspace_id", "TEXT")?;
        ensure_column(&connection, "workspaces", "icon_color", "TEXT")?;
        connection
            .execute(
                "INSERT OR IGNORE INTO workspaces (id, name, icon, icon_color, is_default, sort_order)
                 VALUES (?1, 'Default', NULL, NULL, 1, 0)",
                params![DEFAULT_WORKSPACE_ID],
            )
            .map_err(to_storage_error)?;
        connection
            .execute(
                "UPDATE connections SET workspace_id = ?1 WHERE workspace_id IS NULL",
                params![DEFAULT_WORKSPACE_ID],
            )
            .map_err(to_storage_error)?;
        connection
            .execute(
                "UPDATE connection_folders SET workspace_id = ?1 WHERE workspace_id IS NULL",
                params![DEFAULT_WORKSPACE_ID],
            )
            .map_err(to_storage_error)?;
        // v25: Document Connection kind. The connections table predates the
        // `fileView` connection_type, and SQLite can't alter a CHECK constraint
        // in place, so rebuild the table so the connection_type CHECK accepts the
        // new kind. By this point every upgrade path has the full current column
        // set (CURRENT_SCHEMA on fresh installs, ensure_column/v20 rebuild on
        // upgrades), so a full explicit-column copy is safe.
        if stored_version < 25 && table_exists(&connection, "connections")? {
            connection
                .pragma_update(None, "legacy_alter_table", "ON")
                .map_err(to_storage_error)?;
            connection
                .execute_batch(
                    r#"
                    BEGIN;
                    ALTER TABLE connections RENAME TO connections_pre_v25;
                    CREATE TABLE connections (
                        id TEXT PRIMARY KEY,
                        folder_id TEXT REFERENCES connection_folders(id) ON DELETE CASCADE,
                        workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
                        name TEXT NOT NULL,
                        tab_title TEXT,
                        host TEXT NOT NULL,
                        username TEXT NOT NULL,
                        port INTEGER,
                        key_path TEXT,
                        proxy_jump TEXT,
                        ssh_socks_proxy TEXT,
                        ssh_socks_proxy_username TEXT,
                        ssh_socks_proxy_inherit_defaults INTEGER NOT NULL DEFAULT 1,
                        auth_method TEXT NOT NULL DEFAULT 'keyFile',
                        local_shell TEXT,
                        local_startup_directory TEXT,
                        local_startup_script TEXT,
                        url TEXT,
                        data_partition TEXT,
                        use_tmux_sessions INTEGER NOT NULL DEFAULT 1,
                        tmux_connection_id TEXT,
                        serial_line TEXT,
                        serial_speed INTEGER,
                        rdp_options TEXT,
                        vnc_options TEXT,
                        ftp_options TEXT,
                        password_credential_id TEXT REFERENCES connection_password_credentials(id) ON DELETE SET NULL,
                        icon_data_url TEXT,
                        icon_background_color TEXT,
                        terminal_opacity INTEGER,
                        terminal_background_json TEXT,
                        file_browser_view_options_json TEXT,
                        connection_type TEXT NOT NULL CHECK (connection_type IN ('local', 'ssh', 'telnet', 'serial', 'url', 'rdp', 'vnc', 'ftp', 'localFiles', 'fileView')),
                        status TEXT NOT NULL CHECK (status IN ('connected', 'idle', 'offline')),
                        sort_order INTEGER NOT NULL
                    );
                    INSERT INTO connections (
                        id, folder_id, workspace_id, name, tab_title, host, username, port, key_path,
                        proxy_jump, ssh_socks_proxy, ssh_socks_proxy_username, ssh_socks_proxy_inherit_defaults,
                        auth_method, local_shell, local_startup_directory,
                        local_startup_script, url, data_partition, use_tmux_sessions,
                        tmux_connection_id, serial_line, serial_speed, rdp_options, vnc_options,
                        ftp_options, password_credential_id, icon_data_url, icon_background_color,
                        terminal_opacity, terminal_background_json, file_browser_view_options_json,
                        connection_type, status, sort_order
                    )
                    SELECT
                        id, folder_id, workspace_id, name, tab_title, host, username, port, key_path,
                        proxy_jump, ssh_socks_proxy, ssh_socks_proxy_username, ssh_socks_proxy_inherit_defaults,
                        auth_method, local_shell, local_startup_directory,
                        local_startup_script, url, data_partition, use_tmux_sessions,
                        tmux_connection_id, serial_line, serial_speed, rdp_options, vnc_options,
                        ftp_options, password_credential_id, icon_data_url, icon_background_color,
                        terminal_opacity, terminal_background_json, file_browser_view_options_json,
                        connection_type, status, sort_order
                    FROM connections_pre_v25;
                    DROP TABLE connections_pre_v25;
                    COMMIT;
                    "#,
                )
                .map_err(to_storage_error)?;
            connection
                .pragma_update(None, "legacy_alter_table", "OFF")
                .map_err(to_storage_error)?;
        }
        repair_connections_pre_v25_references(&connection)?;
        ensure_column(
            &connection,
            "connections",
            "file_view_open_external",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        // Per-connection SSH transport compression override (`ssh -XC` parity).
        // Added after the v25 rebuild — which freezes its own column list — so
        // it must be ensured here, past every connections-table rebuild, or a
        // fresh install (still at user_version 0 when v25 runs) loses it. NULL
        // inherits the global SSH default; 'off'/'fast' force a choice.
        ensure_column(&connection, "connections", "ssh_compression", "TEXT")?;
        ensure_column(&connection, "connections", "url_proxy", "TEXT")?;
        ensure_column(
            &connection,
            "connections",
            "url_proxy_inherit_defaults",
            "INTEGER NOT NULL DEFAULT 1",
        )?;
        // v26: imported Dashboard script widgets get a durable origin marker
        // so the catalog can badge them after restart. SQLite cannot alter a
        // CHECK constraint in place, so rebuild just this table to admit the
        // new `created_by = 'imported'` value.
        if stored_version < 26 && table_exists(&connection, "dashboard_custom_widgets")? {
            connection
                .pragma_update(None, "legacy_alter_table", "ON")
                .map_err(to_storage_error)?;
            connection
                .execute_batch(
                    r#"
                    BEGIN;
                    ALTER TABLE dashboard_custom_widgets RENAME TO dashboard_custom_widgets_pre_v26;
                    CREATE TABLE dashboard_custom_widgets (
                        id TEXT PRIMARY KEY,
                        title TEXT NOT NULL,
                        summary TEXT NOT NULL DEFAULT '',
                        category TEXT NOT NULL DEFAULT 'custom',
                        body_json TEXT NOT NULL,
                        settings_schema_json TEXT NOT NULL DEFAULT '{"fields":[]}',
                        created_by TEXT NOT NULL CHECK (created_by IN ('user', 'agent', 'imported')),
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );
                    INSERT INTO dashboard_custom_widgets (
                        id, title, summary, category, body_json, settings_schema_json,
                        created_by, created_at, updated_at
                    )
                    SELECT
                        id, title, summary, category, body_json, settings_schema_json,
                        created_by, created_at, updated_at
                    FROM dashboard_custom_widgets_pre_v26;
                    DROP TABLE dashboard_custom_widgets_pre_v26;
                    COMMIT;
                    "#,
                )
                .map_err(to_storage_error)?;
            connection
                .pragma_update(None, "legacy_alter_table", "OFF")
                .map_err(to_storage_error)?;
        }
        ensure_column(
            &connection,
            "connections",
            "ssh_port_forwardings_json",
            "TEXT",
        )?;
        // psmux session management for local PowerShell Connections (defaults off).
        // Added after the table rebuilds above so older databases keep the column.
        ensure_column(
            &connection,
            "connections",
            "use_psmux_sessions",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        connection
            .execute_batch(&format!("PRAGMA user_version = {SCHEMA_USER_VERSION}"))
            .map_err(to_storage_error)?;
        crate::dashboard_storage::seed_default(&connection)
            .map_err(|err| format!("dashboard seed failed: {err:?}"))?;
        Ok(())
    }
    fn temp_database_path(&self, prefix: &str) -> PathBuf {
        let parent = self.db_path.parent().unwrap_or_else(|| Path::new("."));
        parent.join(format!(
            "kkterm-{prefix}-{}.sqlite3",
            timestamp_for_filename()
        ))
    }

    fn backup_dir(&self) -> Result<PathBuf, String> {
        let parent = self
            .db_path
            .parent()
            .ok_or_else(|| "database path must include a parent directory".to_string())?;
        Ok(parent.join("backups"))
    }

    fn next_backup_path(&self, backup_dir: &Path) -> Result<PathBuf, String> {
        let timestamp = timestamp_for_filename();
        for serial in 1..=999 {
            let filename = format!("kkterm-{timestamp}-{serial:03}.zip");
            let path = backup_dir.join(filename);
            if !path.exists() {
                return Ok(path);
            }
        }
        Err(format!(
            "failed to choose an unused backup filename in {}",
            backup_dir.display()
        ))
    }

    fn delete_old_backups(&self) -> Result<(), String> {
        let backup_dir = self.backup_dir()?;
        let cutoff = SystemTime::now()
            .checked_sub(Duration::from_secs(7 * 24 * 60 * 60))
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let entries = match fs::read_dir(&backup_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(format!(
                    "failed to read backup directory {}: {error}",
                    backup_dir.display()
                ));
            }
        };

        for entry in entries {
            let entry =
                entry.map_err(|error| format!("failed to inspect backup entry: {error}"))?;
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("zip") {
                continue;
            }
            let metadata = entry
                .metadata()
                .map_err(|error| format!("failed to inspect backup {}: {error}", path.display()))?;
            if metadata.modified().unwrap_or(SystemTime::now()) < cutoff {
                remove_file_if_exists(&path)?;
            }
        }
        Ok(())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, SqliteConnection>, String> {
        match self.connection.lock() {
            Ok(guard) => Ok(guard),
            Err(poison) => {
                // Recover rather than permanently failing every caller: the
                // inner connection is still usable after a panic. A best-effort
                // ROLLBACK clears any half-open transaction the panicked caller
                // left behind. This mirrors with_connection_infallible so all
                // DB accessors recover uniformly instead of with_connection*
                // callers seeing "lock is poisoned" forever (M-3).
                let recovered = poison.into_inner();
                let _ = recovered.execute("ROLLBACK", []);
                Ok(recovered)
            }
        }
    }

    pub(crate) fn with_connection<R>(
        &self,
        body: impl FnOnce(&SqliteConnection) -> Result<R, String>,
    ) -> Result<R, String> {
        let connection = self.lock()?;
        body(&connection)
    }

    pub(crate) fn with_connection_mut<R>(
        &self,
        body: impl FnOnce(&mut SqliteConnection) -> Result<R, String>,
    ) -> Result<R, String> {
        let mut connection = self.lock()?;
        body(&mut connection)
    }

    /// Harden 5: recover from a poisoned mutex by unwrapping the poison error.
    /// A prior thread panic poisons the std::sync::Mutex, but the inner
    /// SqliteConnection handle is still intact and usable.  Recovering here
    /// prevents a single panicking dashboard command from permanently blocking
    /// all subsequent database access (the old `.expect()` would crash the app).
    ///
    /// We also issue a best-effort `ROLLBACK` on the recovered connection so a
    /// half-open transaction from the panicked caller does not leak into the
    /// next caller (SQLite returns `cannot rollback - no transaction` when
    /// there is nothing to roll back; that error is ignored on purpose).
    pub fn with_connection_infallible<R>(&self, f: impl FnOnce(&rusqlite::Connection) -> R) -> R {
        let guard = match self.connection.lock() {
            Ok(guard) => guard,
            Err(poison) => {
                let recovered = poison.into_inner();
                let _ = recovered.execute("ROLLBACK", []);
                recovered
            }
        };
        f(&*guard)
    }
}

fn open_initialized_connection(db_path: &Path) -> Result<SqliteConnection, String> {
    let connection = SqliteConnection::open(db_path)
        .map_err(|error| format!("failed to open SQLite database: {error}"))?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("failed to enable SQLite foreign keys: {error}"))?;
    // WAL + NORMAL synchronous shortens how long each write holds SQLite's
    // internal locks (and the surrounding Rust connection mutex), which reduces
    // main-thread stalls; busy_timeout avoids spurious SQLITE_BUSY if a future
    // reader connection is added. Best-effort: a backend that rejects WAL (e.g.
    // certain network filesystems) must still open, so failures are not fatal.
    if let Err(error) = connection.pragma_update(None, "journal_mode", "WAL") {
        eprintln!("failed to enable SQLite WAL journal mode: {error}");
    }
    if let Err(error) = connection.pragma_update(None, "synchronous", "NORMAL") {
        eprintln!("failed to set SQLite synchronous=NORMAL: {error}");
    }
    if let Err(error) = connection.busy_timeout(std::time::Duration::from_secs(5)) {
        eprintln!("failed to set SQLite busy_timeout: {error}");
    }
    Ok(connection)
}

/// Run a blocking database closure from an `async` Tauri command without
/// starving the async runtime's worker pool. The connection mutex + blocking
/// rusqlite calls would otherwise park a tokio worker for the op's duration.
///
/// Uses tokio's `block_in_place` when running on the multi-threaded runtime
/// (which is how Tauri executes async commands), and falls back to calling the
/// closure directly when not on a multi-thread worker — e.g. unit tests or a
/// current-thread runtime — so it can never panic on the wrong runtime flavor.
pub(crate) fn run_blocking_db<R>(f: impl FnOnce() -> R) -> R {
    use tokio::runtime::{Handle, RuntimeFlavor};
    match Handle::try_current().map(|handle| handle.runtime_flavor()) {
        Ok(RuntimeFlavor::MultiThread) => tokio::task::block_in_place(f),
        _ => f(),
    }
}

/// Remove the WAL sidecar files (`-wal`, `-shm`) for a database path. Safe to
/// call when they do not exist. Used before reopening after a raw file replace
/// so stale sidecars from the previous connection cannot corrupt the new file.
fn remove_wal_sidecars(db_path: &Path) -> Result<(), String> {
    for suffix in ["-wal", "-shm"] {
        let mut sidecar = db_path.as_os_str().to_os_string();
        sidecar.push(suffix);
        remove_file_if_exists(Path::new(&sidecar))?;
    }
    Ok(())
}

fn table_exists(connection: &SqliteConnection, table: &str) -> Result<bool, String> {
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![table],
            |row| row.get(0),
        )
        .map_err(to_storage_error)?;
    Ok(count > 0)
}

fn column_exists(connection: &SqliteConnection, table: &str, column: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(to_storage_error)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(to_storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_storage_error)?;
    Ok(columns.iter().any(|existing| existing == column))
}

fn ensure_column(
    connection: &SqliteConnection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(to_storage_error)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(to_storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_storage_error)?;
    if columns.iter().any(|existing| existing == column) {
        return Ok(());
    }
    connection
        .execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
            [],
        )
        .map_err(to_storage_error)?;
    Ok(())
}

fn migrate_url_credentials_page_keys(connection: &SqliteConnection) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(url_credentials)")
        .map_err(to_storage_error)?;
    let columns = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, i64>(5)?,
            ))
        })
        .map_err(to_storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_storage_error)?;
    let has_page_key = columns.iter().any(|(name, _)| name == "page_key");
    let has_secret_owner_id = columns.iter().any(|(name, _)| name == "secret_owner_id");
    let connection_id_is_only_pk = columns
        .iter()
        .find(|(name, _)| name == "connection_id")
        .is_some_and(|(_, pk)| *pk == 1)
        && columns
            .iter()
            .find(|(name, _)| name == "page_key")
            .is_none_or(|(_, pk)| *pk == 0);
    if has_page_key && has_secret_owner_id && !connection_id_is_only_pk {
        return Ok(());
    }

    connection
        .execute_batch(
            r#"
            ALTER TABLE url_credentials RENAME TO url_credentials_pre_page_keys;
            CREATE TABLE url_credentials (
                connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
                page_key TEXT NOT NULL DEFAULT '__legacy__',
                secret_owner_id TEXT NOT NULL,
                username TEXT NOT NULL,
                page_url TEXT,
                username_selector TEXT,
                password_selector TEXT,
                field_values TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (connection_id, page_key)
            );
            INSERT INTO url_credentials (
                connection_id, page_key, secret_owner_id, username, page_url,
                username_selector, password_selector, field_values, updated_at
            )
            SELECT
                connection_id, '__legacy__', connection_id, username, page_url,
                username_selector, password_selector, field_values, updated_at
            FROM url_credentials_pre_page_keys
            WHERE EXISTS (
                SELECT 1 FROM connections
                WHERE connections.id = url_credentials_pre_page_keys.connection_id
            );
            DROP TABLE url_credentials_pre_page_keys;
            CREATE INDEX IF NOT EXISTS idx_url_credentials_connection
                ON url_credentials(connection_id);
            "#,
        )
        .map_err(to_storage_error)
}

fn repair_connections_pre_v20_references(connection: &SqliteConnection) -> Result<(), String> {
    repair_connections_scratch_references(connection, "connections_pre_v20", "pre_v20")
}

fn repair_connections_pre_v25_references(connection: &SqliteConnection) -> Result<(), String> {
    repair_connections_scratch_references(connection, "connections_pre_v25", "pre_v25")
}

fn repair_connections_scratch_references(
    connection: &SqliteConnection,
    scratch_table: &str,
    suffix: &str,
) -> Result<(), String> {
    let table_names = [
        "connection_tags",
        "url_credentials",
        "connection_password_credentials",
    ];
    let needs_repair = table_names.iter().try_fold(false, |needs_repair, table| {
        Ok::<bool, String>(needs_repair || table_sql_mentions(connection, table, scratch_table)?)
    })?;
    if !needs_repair {
        return Ok(());
    }

    // SQLite rewrites dependent FK clauses on ALTER TABLE RENAME unless legacy
    // rename behavior is enabled. These rebuilds intentionally keep the public
    // `connections` table name stable while replacing stale temp-table FKs.
    connection
        .pragma_update(None, "foreign_keys", "OFF")
        .map_err(to_storage_error)?;
    connection
        .pragma_update(None, "legacy_alter_table", "ON")
        .map_err(to_storage_error)?;
    let repair_sql = format!(
        r#"
        BEGIN;

        ALTER TABLE connection_tags RENAME TO connection_tags_{suffix}_fk_fix;
        CREATE TABLE connection_tags (
            connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            sort_order INTEGER NOT NULL,
            PRIMARY KEY (connection_id, tag)
        );
        INSERT INTO connection_tags (connection_id, tag, sort_order)
        SELECT connection_id, tag, sort_order
        FROM connection_tags_{suffix}_fk_fix
        WHERE EXISTS (
            SELECT 1 FROM connections WHERE connections.id = connection_tags_{suffix}_fk_fix.connection_id
        );
        DROP TABLE connection_tags_{suffix}_fk_fix;

        ALTER TABLE url_credentials RENAME TO url_credentials_{suffix}_fk_fix;
        CREATE TABLE url_credentials (
            connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
            page_key TEXT NOT NULL DEFAULT '__legacy__',
            secret_owner_id TEXT NOT NULL,
            username TEXT NOT NULL,
            page_url TEXT,
            username_selector TEXT,
            password_selector TEXT,
            field_values TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (connection_id, page_key)
        );
        INSERT INTO url_credentials (
            connection_id, page_key, secret_owner_id, username, page_url,
            username_selector, password_selector, field_values, updated_at
        )
        SELECT
            connection_id, '__legacy__', connection_id, username, page_url,
            username_selector, password_selector, field_values, updated_at
        FROM url_credentials_{suffix}_fk_fix
        WHERE EXISTS (
            SELECT 1 FROM connections WHERE connections.id = url_credentials_{suffix}_fk_fix.connection_id
        );
        DROP TABLE url_credentials_{suffix}_fk_fix;

        ALTER TABLE connection_password_credentials RENAME TO connection_password_credentials_{suffix}_fk_fix;
        CREATE TABLE connection_password_credentials (
            id TEXT PRIMARY KEY,
            connection_type TEXT NOT NULL CHECK (connection_type IN ('ssh', 'telnet', 'rdp', 'vnc', 'ftp')),
            host TEXT NOT NULL,
            username TEXT NOT NULL,
            label TEXT NOT NULL,
            created_from_connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO connection_password_credentials (
            id, connection_type, host, username, label, created_from_connection_id,
            created_at, updated_at
        )
        SELECT
            id, connection_type, host, username, label,
            CASE
                WHEN created_from_connection_id IS NULL THEN NULL
                WHEN EXISTS (
                    SELECT 1 FROM connections
                    WHERE connections.id = connection_password_credentials_{suffix}_fk_fix.created_from_connection_id
                ) THEN created_from_connection_id
                ELSE NULL
            END,
            created_at, updated_at
        FROM connection_password_credentials_{suffix}_fk_fix;
        DROP TABLE connection_password_credentials_{suffix}_fk_fix;

        CREATE INDEX IF NOT EXISTS idx_connection_tags_connection_sort
            ON connection_tags(connection_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_url_credentials_connection
            ON url_credentials(connection_id);
        CREATE INDEX IF NOT EXISTS idx_connection_password_credentials_type_host
            ON connection_password_credentials(connection_type, host);

        COMMIT;
        "#,
    );
    let repair_result = connection.execute_batch(&repair_sql);
    let reset_legacy_result = connection.pragma_update(None, "legacy_alter_table", "OFF");
    let reset_fk_result = connection.pragma_update(None, "foreign_keys", "ON");

    repair_result.map_err(to_storage_error)?;
    reset_legacy_result.map_err(to_storage_error)?;
    reset_fk_result.map_err(to_storage_error)?;
    Ok(())
}

fn table_sql_mentions(
    connection: &SqliteConnection,
    table: &str,
    needle: &str,
) -> Result<bool, String> {
    let sql: Option<String> = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![table],
            |row| row.get(0),
        )
        .optional()
        .map_err(to_storage_error)?;
    Ok(sql.is_some_and(|sql| sql.contains(needle)))
}

fn timestamp_for_filename() -> String {
    let format = time::macros::format_description!("[year][month][day]-[hour][minute][second]");
    OffsetDateTime::now_utc()
        .format(format)
        .unwrap_or_else(|_| {
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|duration| duration.as_secs().to_string())
                .unwrap_or_else(|_| "0".to_string())
        })
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to remove file {}: {error}", path.display())),
    }
}

fn extract_imported_database(import_path: &Path, temp_import_path: &Path) -> Result<(), String> {
    let import_file = File::open(import_path).map_err(|error| {
        format!(
            "failed to open import file {}: {error}",
            import_path.display()
        )
    })?;
    let mut archive = ZipArchive::new(import_file)
        .map_err(|error| format!("import file is not a valid KKTerm export zip: {error}"))?;
    let mut db_file = archive
        .by_name("kkterm.sqlite3")
        .map_err(|_| "import zip does not contain kkterm.sqlite3".to_string())?;
    let mut contents = Vec::new();
    db_file
        .read_to_end(&mut contents)
        .map_err(|error| format!("failed to read imported database: {error}"))?;
    fs::write(temp_import_path, contents).map_err(|error| {
        format!(
            "failed to write imported database snapshot {}: {error}",
            temp_import_path.display()
        )
    })
}

fn validate_import_database(path: &Path) -> Result<(), String> {
    let connection = open_initialized_connection(path)?;
    let user_version: i32 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| format!("failed to inspect imported database schema: {error}"))?;
    if user_version != SCHEMA_USER_VERSION {
        return Err(format!(
            "imported database schema version {user_version} does not match this app schema ({SCHEMA_USER_VERSION})"
        ));
    }
    drop(connection);
    let storage = Storage::open(path.to_path_buf())?;
    storage.general_settings()?;
    storage.credential_settings()?;
    storage.app_launcher_settings()?;
    storage.dashboard_settings()?;
    storage.terminal_settings()?;
    storage.appearance_settings()?;
    storage.ssh_settings()?;
    storage.sftp_settings()?;
    storage.rdp_settings()?;
    storage.vnc_settings()?;
    storage.screenshot_settings()?;
    storage.ai_provider_settings()?;
    storage.list_connection_tree()?;
    Ok(())
}

fn list_stored_credential_candidates(
    connection: &SqliteConnection,
) -> Result<Vec<StoredCredentialCandidate>, String> {
    let mut credentials = Vec::new();

    let mut connection_stmt = connection
        .prepare(
            "SELECT id, name, connection_type, host, username
             FROM connections
             WHERE connection_type IN ('ssh', 'telnet', 'rdp', 'vnc', 'ftp')
             ORDER BY lower(name)",
        )
        .map_err(to_storage_error)?;
    let connection_rows = connection_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(to_storage_error)?;
    for row in connection_rows {
        let (id, name, connection_type, host, username) = row.map_err(to_storage_error)?;
        credentials.push(StoredCredentialCandidate {
            id: format!("connection-password:{id}"),
            kind: "connectionPassword".to_string(),
            secret_kind: "connectionPassword".to_string(),
            owner_id: id,
            label: name,
            detail: Some(format!("{connection_type} - {host}")),
            connection_type: Some(connection_type),
            host: Some(host),
            username: (!username.trim().is_empty()).then_some(username),
            updated_at: None,
            metadata_source: "connections".to_string(),
        });
    }

    for credential in list_connection_password_credential_candidates(connection)? {
        credentials.push(credential);
    }

    for credential in list_url_credential_candidates(connection)? {
        credentials.push(credential);
    }
    for credential in list_widget_secret_candidates(connection)? {
        credentials.push(credential);
    }

    for (provider_kind, provider_label, key_label) in AI_PROVIDER_CREDENTIALS {
        let owner_id = ai_provider_secret_owner_id(provider_kind);
        credentials.push(StoredCredentialCandidate {
            id: format!("ai-api-key:{owner_id}"),
            kind: "aiApiKey".to_string(),
            secret_kind: "aiApiKey".to_string(),
            owner_id,
            label: (*key_label).to_string(),
            detail: Some((*provider_label).to_string()),
            connection_type: None,
            host: None,
            username: None,
            updated_at: None,
            metadata_source: "settings".to_string(),
        });
    }
    credentials.push(StoredCredentialCandidate {
        id: format!("ai-api-key:{LEGACY_AI_PROVIDER_SECRET_OWNER_ID}"),
        kind: "aiApiKey".to_string(),
        secret_kind: "aiApiKey".to_string(),
        owner_id: LEGACY_AI_PROVIDER_SECRET_OWNER_ID.to_string(),
        label: "Legacy AI Assistant API key".to_string(),
        detail: Some("Shared AI provider key".to_string()),
        connection_type: None,
        host: None,
        username: None,
        updated_at: None,
        metadata_source: "settings".to_string(),
    });
    credentials.push(StoredCredentialCandidate {
        id: format!("email-api-key:{EMAIL_API_SECRET_OWNER_ID}"),
        kind: "emailApiKey".to_string(),
        secret_kind: "emailApiKey".to_string(),
        owner_id: EMAIL_API_SECRET_OWNER_ID.to_string(),
        label: "Email provider API key".to_string(),
        detail: Some("Send Email".to_string()),
        connection_type: None,
        host: None,
        username: None,
        updated_at: None,
        metadata_source: "settings".to_string(),
    });
    credentials.push(StoredCredentialCandidate {
        id: format!("email-smtp-password:{EMAIL_SMTP_SECRET_OWNER_ID}"),
        kind: "emailSmtpPassword".to_string(),
        secret_kind: "emailSmtpPassword".to_string(),
        owner_id: EMAIL_SMTP_SECRET_OWNER_ID.to_string(),
        label: "SMTP password".to_string(),
        detail: Some("Send Email".to_string()),
        connection_type: None,
        host: None,
        username: None,
        updated_at: None,
        metadata_source: "settings".to_string(),
    });

    Ok(credentials)
}

fn list_connection_password_credential_candidates(
    connection: &SqliteConnection,
) -> Result<Vec<StoredCredentialCandidate>, String> {
    let credentials = list_connection_password_credentials(connection)?;
    Ok(credentials
        .into_iter()
        .map(|credential| StoredCredentialCandidate {
            id: format!("connection-password:{}", credential.id),
            kind: "connectionPassword".to_string(),
            secret_kind: "connectionPassword".to_string(),
            owner_id: credential.id,
            label: credential.label,
            detail: Some(format!(
                "{} - {}",
                credential.connection_type, credential.host
            )),
            connection_type: Some(credential.connection_type),
            host: Some(credential.host),
            username: (!credential.username.trim().is_empty()).then_some(credential.username),
            updated_at: Some(credential.updated_at),
            metadata_source: "connectionPasswordCredentials".to_string(),
        })
        .collect())
}

fn list_connection_password_credentials(
    connection: &SqliteConnection,
) -> Result<Vec<ConnectionPasswordCredentialSummary>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, connection_type, host, username, label, created_from_connection_id,
                    created_at, updated_at
             FROM connection_password_credentials
             ORDER BY lower(connection_type), lower(host), lower(username), created_at",
        )
        .map_err(to_storage_error)?;
    let rows = statement
        .query_map([], connection_password_credential_from_row)
        .map_err(to_storage_error)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(to_storage_error)
}

fn list_url_credential_candidates(
    connection: &SqliteConnection,
) -> Result<Vec<StoredCredentialCandidate>, String> {
    let mut statement = connection
        .prepare(
            "SELECT url_credentials.secret_owner_id, connections.name, connections.url, url_credentials.page_url,
                    url_credentials.username, url_credentials.updated_at
             FROM url_credentials
             INNER JOIN connections ON connections.id = url_credentials.connection_id
             ORDER BY lower(connections.name), lower(url_credentials.page_key), lower(url_credentials.username)",
        )
        .map_err(to_storage_error)?;
    let rows = statement
        .query_map([], |row| {
            let secret_owner_id: String = row.get(0)?;
            let connection_name: String = row.get(1)?;
            let url: Option<String> = row.get(2)?;
            let page_url: Option<String> = row.get(3)?;
            let username: String = row.get(4)?;
            let updated_at: String = row.get(5)?;
            Ok(StoredCredentialCandidate {
                id: format!("url-password:{secret_owner_id}"),
                kind: "urlPassword".to_string(),
                secret_kind: "urlPassword".to_string(),
                owner_id: secret_owner_id,
                label: connection_name,
                detail: page_url.or(url),
                connection_type: None,
                host: None,
                username: Some(username),
                updated_at: Some(updated_at),
                metadata_source: "urlCredentials".to_string(),
            })
        })
        .map_err(to_storage_error)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(to_storage_error)
}

fn list_widget_secret_candidates(
    connection: &SqliteConnection,
) -> Result<Vec<StoredCredentialCandidate>, String> {
    let mut statement = connection
        .prepare(
            "SELECT dashboard_widget_instances.id, dashboard_widget_instances.settings_values_json,
                    dashboard_custom_widgets.title, dashboard_custom_widgets.settings_schema_json,
                    dashboard_views.title
             FROM dashboard_widget_instances
             INNER JOIN dashboard_custom_widgets
                ON dashboard_custom_widgets.id = dashboard_widget_instances.source_id
             INNER JOIN dashboard_views
                ON dashboard_views.id = dashboard_widget_instances.view_id
             WHERE dashboard_widget_instances.kind = 'script'
             ORDER BY lower(dashboard_views.title), lower(dashboard_custom_widgets.title)",
        )
        .map_err(to_storage_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(to_storage_error)?;

    let mut credentials = Vec::new();
    for row in rows {
        let (instance_id, settings_values_json, widget_title, settings_schema_json, view_title) =
            row.map_err(to_storage_error)?;
        let schema: serde_json::Value = serde_json::from_str(&settings_schema_json)
            .unwrap_or_else(|_| serde_json::json!({ "fields": [] }));
        let values: serde_json::Value =
            serde_json::from_str(&settings_values_json).unwrap_or_else(|_| serde_json::json!({}));
        let fields = schema
            .get("fields")
            .and_then(serde_json::Value::as_array)
            .cloned()
            .unwrap_or_default();
        for field in fields {
            if field.get("type").and_then(serde_json::Value::as_str) != Some("secret") {
                continue;
            }
            let Some(key) = field.get("key").and_then(serde_json::Value::as_str) else {
                continue;
            };
            let value = values.get(key).and_then(serde_json::Value::as_object);
            let has_ref = value.is_some_and(|object| {
                object.get("type").and_then(serde_json::Value::as_str) == Some("secretRef")
                    && object.get("hasSecret").and_then(serde_json::Value::as_bool) == Some(true)
            });
            if !has_ref {
                continue;
            }
            let owner_id = format!("dashboard-widget-secret:{instance_id}:{key}");
            credentials.push(StoredCredentialCandidate {
                id: format!("widget-secret:{instance_id}:{key}"),
                kind: "widgetSecret".to_string(),
                secret_kind: "widgetSecret".to_string(),
                owner_id,
                label: widget_title.clone(),
                detail: Some(format!("{view_title} - {key}")),
                connection_type: None,
                host: None,
                username: None,
                updated_at: value
                    .and_then(|object| object.get("updatedAt"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
                metadata_source: "dashboardWidgetInstance".to_string(),
            });
        }
    }
    Ok(credentials)
}

/// Normalize a (possibly empty) workspace id to the permanent Default
/// Workspace when missing, so callers that predate the Workspace model still
/// resolve to a valid scope.
pub fn normalize_workspace_id(workspace_id: String) -> String {
    let trimmed = workspace_id.trim();
    if trimmed.is_empty() {
        DEFAULT_WORKSPACE_ID.to_string()
    } else {
        trimmed.to_string()
    }
}

/// Resolve the Workspace a folder belongs to, defaulting to the Default
/// Workspace if the folder is missing or unscoped.
fn folder_workspace_id(connection: &SqliteConnection, folder_id: &str) -> Result<String, String> {
    let stored: Option<Option<String>> = connection
        .query_row(
            "SELECT workspace_id FROM connection_folders WHERE id = ?1",
            params![folder_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(to_storage_error)?;
    Ok(normalize_workspace_id(stored.flatten().unwrap_or_default()))
}

fn folder_icon_data_url(
    connection: &SqliteConnection,
    folder_id: &str,
) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT icon_data_url FROM connection_folders WHERE id = ?1",
            params![folder_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .map_err(to_storage_error)
}

fn folder_name_and_icon_data_url(
    connection: &SqliteConnection,
    folder_id: &str,
) -> Result<(String, Option<String>), String> {
    connection
        .query_row(
            "SELECT name, icon_data_url FROM connection_folders WHERE id = ?1",
            params![folder_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .map_err(to_storage_error)
}

/// Resolve the Workspace a Connection belongs to, defaulting to Default.
fn connection_workspace_id(
    connection: &SqliteConnection,
    connection_id: &str,
) -> Result<String, String> {
    let stored: Option<Option<String>> = connection
        .query_row(
            "SELECT workspace_id FROM connections WHERE id = ?1",
            params![connection_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(to_storage_error)?;
    Ok(normalize_workspace_id(stored.flatten().unwrap_or_default()))
}

/// Root-level Connections (no folder) belonging to a single Workspace. Nested
/// Connections are reached through their folder, which already carries the
/// Workspace scope, so only the root query filters on `workspace_id`.
fn list_root_connections_for_workspace(
    connection: &SqliteConnection,
    workspace_id: &str,
) -> Result<Vec<SavedConnection>, String> {
    let mut statement = connection
        .prepare(
            "SELECT connections.id, name, tab_title, host, connections.username, port, key_path, proxy_jump, ssh_socks_proxy, ssh_socks_proxy_username, ssh_socks_proxy_inherit_defaults, auth_method, local_shell, local_startup_directory, local_startup_script, url, data_partition, use_tmux_sessions, tmux_connection_id, connection_type, serial_line, serial_speed, rdp_options, vnc_options, ftp_options, icon_data_url, icon_background_color, terminal_opacity, terminal_background_json, password_credential_id,
                    (SELECT username FROM url_credentials WHERE url_credentials.connection_id = connections.id ORDER BY updated_at DESC LIMIT 1), file_browser_view_options_json, file_view_open_external, ssh_port_forwardings_json, use_psmux_sessions, ssh_compression, url_proxy, url_proxy_inherit_defaults
             FROM connections
             WHERE folder_id IS NULL AND workspace_id = ?1
             ORDER BY sort_order, name",
        )
        .map_err(to_storage_error)?;
    let rows = statement
        .query_map(params![workspace_id], saved_connection_from_row)
        .map_err(to_storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_storage_error)?;
    let mut connections = Vec::new();
    for row in rows {
        let mut saved_connection = row;
        saved_connection.tags = list_tags(connection, &saved_connection.id)?;
        connections.push(saved_connection);
    }
    Ok(connections)
}

/// Root-level folders belonging to a single Workspace. Their descendants are
/// resolved through the existing folder recursion in `get_folder_by_id`.
fn list_root_folders_for_workspace(
    connection: &SqliteConnection,
    workspace_id: &str,
) -> Result<Vec<ConnectionFolder>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, icon_data_url
             FROM connection_folders
             WHERE parent_folder_id IS NULL AND workspace_id = ?1
             ORDER BY sort_order, name",
        )
        .map_err(to_storage_error)?;
    let rows = statement
        .query_map(params![workspace_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(to_storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_storage_error)?;
    rows.into_iter()
        .map(|(id, name, icon_data_url)| get_folder_by_id(connection, &id, name, icon_data_url))
        .collect()
}

fn list_connections_for_folder(
    connection: &SqliteConnection,
    folder_id: Option<&str>,
) -> Result<Vec<SavedConnection>, String> {
    let where_clause = if folder_id.is_some() {
        "folder_id = ?1"
    } else {
        "folder_id IS NULL"
    };
    let mut statement = connection
        .prepare(&format!(
            "SELECT connections.id, name, tab_title, host, connections.username, port, key_path, proxy_jump, ssh_socks_proxy, ssh_socks_proxy_username, ssh_socks_proxy_inherit_defaults, auth_method, local_shell, local_startup_directory, local_startup_script, url, data_partition, use_tmux_sessions, tmux_connection_id, connection_type, serial_line, serial_speed, rdp_options, vnc_options, ftp_options, icon_data_url, icon_background_color, terminal_opacity, terminal_background_json, password_credential_id,
                    (SELECT username FROM url_credentials WHERE url_credentials.connection_id = connections.id ORDER BY updated_at DESC LIMIT 1), file_browser_view_options_json, file_view_open_external, ssh_port_forwardings_json, use_psmux_sessions, ssh_compression, url_proxy, url_proxy_inherit_defaults
             FROM connections
             WHERE {where_clause}
             ORDER BY sort_order, name",
        ))
        .map_err(to_storage_error)?;

    let rows = if let Some(folder_id) = folder_id {
        statement
            .query_map(params![folder_id], saved_connection_from_row)
            .map_err(to_storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(to_storage_error)?
    } else {
        statement
            .query_map([], saved_connection_from_row)
            .map_err(to_storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(to_storage_error)?
    };

    let mut connections = Vec::new();
    for row in rows {
        let mut saved_connection = row;
        saved_connection.tags = list_tags(connection, &saved_connection.id)?;
        connections.push(saved_connection);
    }

    Ok(connections)
}

fn list_folders_for_parent(
    connection: &SqliteConnection,
    parent_folder_id: Option<&str>,
) -> Result<Vec<ConnectionFolder>, String> {
    let folder_ids = list_folder_ids_for_parent(connection, parent_folder_id)?;
    folder_ids
        .into_iter()
        .map(|folder_id| {
            let (name, icon_data_url) = connection
                .query_row(
                    "SELECT name, icon_data_url FROM connection_folders WHERE id = ?1",
                    params![folder_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .map_err(to_storage_error)?;
            get_folder_by_id(connection, &folder_id, name, icon_data_url)
        })
        .collect()
}

fn get_folder_by_id(
    connection: &SqliteConnection,
    id: &str,
    name: String,
    icon_data_url: Option<String>,
) -> Result<ConnectionFolder, String> {
    Ok(ConnectionFolder {
        id: id.to_string(),
        name,
        icon_data_url,
        connections: list_connections_for_folder(connection, Some(id))?,
        folders: list_folders_for_parent(connection, Some(id))?,
    })
}

fn list_folder_ids_for_parent(
    connection: &SqliteConnection,
    parent_folder_id: Option<&str>,
) -> Result<Vec<String>, String> {
    let where_clause = if parent_folder_id.is_some() {
        "parent_folder_id = ?1"
    } else {
        "parent_folder_id IS NULL"
    };
    let mut statement = connection
        .prepare(&format!(
            "SELECT id
             FROM connection_folders
             WHERE {where_clause}
             ORDER BY sort_order, name",
        ))
        .map_err(to_storage_error)?;

    if let Some(parent_folder_id) = parent_folder_id {
        statement
            .query_map(params![parent_folder_id], |row| row.get::<_, String>(0))
            .map_err(to_storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(to_storage_error)
    } else {
        statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(to_storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(to_storage_error)
    }
}

fn folder_parent_id(
    connection: &SqliteConnection,
    folder_id: &str,
) -> Result<Option<Option<String>>, String> {
    connection
        .query_row(
            "SELECT parent_folder_id FROM connection_folders WHERE id = ?1",
            params![folder_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(to_storage_error)
}

fn folder_has_descendant(
    connection: &SqliteConnection,
    folder_id: &str,
    descendant_id: &str,
) -> Result<bool, String> {
    let children = list_folder_ids_for_parent(connection, Some(folder_id))?;
    for child_id in children {
        if child_id == descendant_id || folder_has_descendant(connection, &child_id, descendant_id)?
        {
            return Ok(true);
        }
    }

    Ok(false)
}

fn next_connection_sort_order(
    connection: &SqliteConnection,
    folder_id: Option<&str>,
) -> Result<i64, String> {
    if let Some(folder_id) = folder_id {
        connection
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM connections WHERE folder_id = ?1",
                params![folder_id],
                |row| row.get(0),
            )
            .map_err(to_storage_error)
    } else {
        connection
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM connections WHERE folder_id IS NULL",
                [],
                |row| row.get(0),
            )
            .map_err(to_storage_error)
    }
}

fn next_root_connection_sort_order_for_workspace(
    connection: &SqliteConnection,
    workspace_id: &str,
) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM connections WHERE folder_id IS NULL AND workspace_id = ?1",
            params![workspace_id],
            |row| row.get(0),
        )
        .map_err(to_storage_error)
}

fn next_folder_sort_order(
    connection: &SqliteConnection,
    parent_folder_id: Option<&str>,
) -> Result<i64, String> {
    if let Some(parent_folder_id) = parent_folder_id {
        connection
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM connection_folders WHERE parent_folder_id = ?1",
                params![parent_folder_id],
                |row| row.get(0),
            )
            .map_err(to_storage_error)
    } else {
        connection
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM connection_folders WHERE parent_folder_id IS NULL",
                [],
                |row| row.get(0),
            )
            .map_err(to_storage_error)
    }
}

fn next_root_folder_sort_order_for_workspace(
    connection: &SqliteConnection,
    workspace_id: &str,
) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM connection_folders WHERE parent_folder_id IS NULL AND workspace_id = ?1",
            params![workspace_id],
            |row| row.get(0),
        )
        .map_err(to_storage_error)
}

fn reorder_folder_ids(
    connection: &SqliteConnection,
    parent_folder_id: Option<&str>,
    moved_folder: Option<(&str, usize)>,
) -> Result<(), String> {
    let mut folder_ids = list_folder_ids_for_parent(connection, parent_folder_id)?;
    if let Some((folder_id, target_index)) = moved_folder {
        folder_ids.retain(|id| id != folder_id);
        let target_index = target_index.min(folder_ids.len());
        folder_ids.insert(target_index, folder_id.to_string());
    }

    for (index, folder_id) in folder_ids.iter().enumerate() {
        connection
            .execute(
                "UPDATE connection_folders SET sort_order = ?1 WHERE id = ?2",
                params![index as i64, folder_id],
            )
            .map_err(to_storage_error)?;
    }

    Ok(())
}

fn reorder_root_folder_ids_for_workspace(
    connection: &SqliteConnection,
    workspace_id: &str,
    moved_folder: Option<(&str, usize)>,
) -> Result<(), String> {
    let mut folder_ids = list_root_folder_ids_for_workspace(connection, workspace_id)?;
    if let Some((folder_id, target_index)) = moved_folder {
        folder_ids.retain(|id| id != folder_id);
        let target_index = target_index.min(folder_ids.len());
        folder_ids.insert(target_index, folder_id.to_string());
    }

    for (index, folder_id) in folder_ids.iter().enumerate() {
        connection
            .execute(
                "UPDATE connection_folders SET sort_order = ?1 WHERE id = ?2",
                params![index as i64, folder_id],
            )
            .map_err(to_storage_error)?;
    }

    Ok(())
}

fn reorder_connection_ids(
    connection: &SqliteConnection,
    folder_id: Option<&str>,
    moved_connection: Option<(&str, usize)>,
) -> Result<(), String> {
    let mut connection_ids = list_connection_ids_for_folder(connection, folder_id)?;
    if let Some((connection_id, target_index)) = moved_connection {
        connection_ids.retain(|id| id != connection_id);
        let target_index = target_index.min(connection_ids.len());
        connection_ids.insert(target_index, connection_id.to_string());
    }

    for (index, connection_id) in connection_ids.iter().enumerate() {
        connection
            .execute(
                "UPDATE connections SET sort_order = ?1 WHERE id = ?2",
                params![index as i64, connection_id],
            )
            .map_err(to_storage_error)?;
    }

    Ok(())
}

fn reorder_root_connection_ids_for_workspace(
    connection: &SqliteConnection,
    workspace_id: &str,
    moved_connection: Option<(&str, usize)>,
) -> Result<(), String> {
    let mut connection_ids = list_root_connection_ids_for_workspace(connection, workspace_id)?;
    if let Some((connection_id, target_index)) = moved_connection {
        connection_ids.retain(|id| id != connection_id);
        let target_index = target_index.min(connection_ids.len());
        connection_ids.insert(target_index, connection_id.to_string());
    }

    for (index, connection_id) in connection_ids.iter().enumerate() {
        connection
            .execute(
                "UPDATE connections SET sort_order = ?1 WHERE id = ?2",
                params![index as i64, connection_id],
            )
            .map_err(to_storage_error)?;
    }

    Ok(())
}

fn list_connection_ids_for_folder(
    connection: &SqliteConnection,
    folder_id: Option<&str>,
) -> Result<Vec<String>, String> {
    let where_clause = if folder_id.is_some() {
        "folder_id = ?1"
    } else {
        "folder_id IS NULL"
    };
    let mut statement = connection
        .prepare(&format!(
            "SELECT id
             FROM connections
             WHERE {where_clause}
             ORDER BY sort_order, name",
        ))
        .map_err(to_storage_error)?;

    if let Some(folder_id) = folder_id {
        statement
            .query_map(params![folder_id], |row| row.get::<_, String>(0))
            .map_err(to_storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(to_storage_error)
    } else {
        statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(to_storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(to_storage_error)
    }
}

fn list_root_folder_ids_for_workspace(
    connection: &SqliteConnection,
    workspace_id: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id
             FROM connection_folders
             WHERE parent_folder_id IS NULL AND workspace_id = ?1
             ORDER BY sort_order, name",
        )
        .map_err(to_storage_error)?;
    statement
        .query_map(params![workspace_id], |row| row.get::<_, String>(0))
        .map_err(to_storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_storage_error)
}

fn list_root_connection_ids_for_workspace(
    connection: &SqliteConnection,
    workspace_id: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id
             FROM connections
             WHERE folder_id IS NULL AND workspace_id = ?1
             ORDER BY sort_order, name",
        )
        .map_err(to_storage_error)?;
    statement
        .query_map(params![workspace_id], |row| row.get::<_, String>(0))
        .map_err(to_storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_storage_error)
}

fn get_connection_by_id(
    connection: &SqliteConnection,
    connection_id: &str,
) -> Result<SavedConnection, String> {
    let saved_connection = connection
        .query_row(
            "SELECT connections.id, name, tab_title, host, connections.username, port, key_path, proxy_jump, ssh_socks_proxy, ssh_socks_proxy_username, ssh_socks_proxy_inherit_defaults, auth_method, local_shell, local_startup_directory, local_startup_script, url, data_partition, use_tmux_sessions, tmux_connection_id, connection_type, serial_line, serial_speed, rdp_options, vnc_options, ftp_options, icon_data_url, icon_background_color, terminal_opacity, terminal_background_json, password_credential_id,
                    (SELECT username FROM url_credentials WHERE url_credentials.connection_id = connections.id ORDER BY updated_at DESC LIMIT 1), file_browser_view_options_json, file_view_open_external, ssh_port_forwardings_json, use_psmux_sessions, ssh_compression, url_proxy, url_proxy_inherit_defaults
             FROM connections
             WHERE connections.id = ?1",
            params![connection_id],
            |row| {
                let password_credential_id: Option<String> = row.get(29)?;
                let url_credential_username: Option<String> = row.get(30)?;
                Ok(SavedConnection {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    tab_title: row.get(2)?,
                    host: row.get(3)?,
                    user: row.get(4)?,
                    port: optional_port(row.get::<_, Option<i64>>(5)?)?,
                    key_path: row.get(6)?,
                    proxy_jump: row.get(7)?,
                    ssh_socks_proxy: row.get(8)?,
                    ssh_socks_proxy_username: row.get(9)?,
                    ssh_socks_proxy_inherit_defaults: row.get(10)?,
                    ssh_compression: row.get(35)?,
                    auth_method: row.get(11)?,
                    local_shell: row.get(12)?,
                    local_startup_directory: row.get(13)?,
                    local_startup_script: row.get(14)?,
                    url: row.get(15)?,
                    data_partition: row.get(16)?,
                    url_proxy: row.get(36)?,
                    url_proxy_inherit_defaults: row.get(37)?,
                    use_tmux_sessions: row.get(17)?,
                    use_psmux_sessions: row.get(34)?,
                    tmux_connection_id: row.get(18)?,
                    connection_type: row.get(19)?,
                    serial_line: row.get(20)?,
                    serial_speed: optional_serial_speed(row.get::<_, Option<i64>>(21)?)?,
                    rdp_options: parse_rdp_connection_options(row.get(22)?)?,
                    vnc_options: parse_vnc_connection_options(row.get(23)?)?,
                    ftp_options: parse_ftp_connection_options(row.get(24)?)?,
                    icon_data_url: row.get(25)?,
                    icon_background_color: row.get(26)?,
                    terminal_opacity: normalize_loaded_terminal_opacity(row.get(27)?),
                    terminal_background: terminal_background_from_json(row.get(28)?),
                    file_browser_view_options: file_browser_view_options_from_json(row.get(31)?),
                    file_view_open_external: row.get(32)?,
                    ssh_port_forwardings: ssh_port_forwardings_from_json(row.get(33)?),
                    password_credential_id,
                    url_credential_username: url_credential_username.clone(),
                    has_url_credential: url_credential_username.is_some(),
                    status: "idle".to_string(),
                    tags: Vec::new(),
                })
            },
        )
        .optional()
        .map_err(to_storage_error)?
        .ok_or_else(|| "connection was not found".to_string())?;

    Ok(SavedConnection {
        tags: list_tags(connection, &saved_connection.id)?,
        ..saved_connection
    })
}

fn saved_connection_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SavedConnection> {
    let password_credential_id: Option<String> = row.get(29)?;
    let url_credential_username: Option<String> = row.get(30)?;
    Ok(SavedConnection {
        id: row.get(0)?,
        name: row.get(1)?,
        tab_title: row.get(2)?,
        host: row.get(3)?,
        user: row.get(4)?,
        port: optional_port(row.get::<_, Option<i64>>(5)?)?,
        key_path: row.get(6)?,
        proxy_jump: row.get(7)?,
        ssh_socks_proxy: row.get(8)?,
        ssh_socks_proxy_username: row.get(9)?,
        ssh_socks_proxy_inherit_defaults: row.get(10)?,
        ssh_compression: row.get(35)?,
        auth_method: row.get(11)?,
        local_shell: row.get(12)?,
        local_startup_directory: row.get(13)?,
        local_startup_script: row.get(14)?,
        url: row.get(15)?,
        data_partition: row.get(16)?,
        url_proxy: row.get(36)?,
        url_proxy_inherit_defaults: row.get(37)?,
        use_tmux_sessions: row.get(17)?,
        use_psmux_sessions: row.get(34)?,
        tmux_connection_id: row.get(18)?,
        connection_type: row.get(19)?,
        serial_line: row.get(20)?,
        serial_speed: optional_serial_speed(row.get::<_, Option<i64>>(21)?)?,
        rdp_options: parse_rdp_connection_options(row.get(22)?)?,
        vnc_options: parse_vnc_connection_options(row.get(23)?)?,
        ftp_options: parse_ftp_connection_options(row.get(24)?)?,
        password_credential_id,
        icon_data_url: row.get(25)?,
        icon_background_color: row.get(26)?,
        terminal_opacity: normalize_loaded_terminal_opacity(row.get(27)?),
        terminal_background: terminal_background_from_json(row.get(28)?),
        file_browser_view_options: file_browser_view_options_from_json(row.get(31)?),
        file_view_open_external: row.get(32)?,
        ssh_port_forwardings: ssh_port_forwardings_from_json(row.get(33)?),
        url_credential_username: url_credential_username.clone(),
        has_url_credential: url_credential_username.is_some(),
        status: "idle".to_string(),
        tags: Vec::new(),
    })
}

fn connection_password_credential_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<ConnectionPasswordCredentialSummary> {
    Ok(ConnectionPasswordCredentialSummary {
        id: row.get(0)?,
        connection_type: row.get(1)?,
        host: row.get(2)?,
        username: row.get(3)?,
        label: row.get(4)?,
        created_from_connection_id: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn get_connection_password_credential_by_id(
    connection: &SqliteConnection,
    credential_id: &str,
) -> Result<ConnectionPasswordCredentialSummary, String> {
    connection
        .query_row(
            "SELECT id, connection_type, host, username, label, created_from_connection_id,
                    created_at, updated_at
             FROM connection_password_credentials
             WHERE id = ?1",
            params![credential_id],
            connection_password_credential_from_row,
        )
        .map_err(to_storage_error)
}

fn connection_password_credential_existing_count(
    connection: &SqliteConnection,
    _connection_id: &str,
    connection_type: &str,
    host: &str,
) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM connection_password_credentials
             WHERE connection_type = ?1 AND host = ?2",
            params![connection_type, host],
            |row| row.get(0),
        )
        .map_err(to_storage_error)
}

fn connection_password_credential_label(username: &str, host: &str, ordinal: i64) -> String {
    let base = if username.trim().is_empty() {
        host.to_string()
    } else {
        format!("{} @ {}", username.trim(), host)
    };
    if ordinal <= 1 {
        base
    } else {
        format!("{base} #{ordinal}")
    }
}

fn ensure_connection_password_type(connection_type: &str) -> Result<(), String> {
    match connection_type {
        "ssh" | "telnet" | "rdp" | "vnc" | "ftp" => Ok(()),
        _ => Err("connection type does not support saved passwords".to_string()),
    }
}

fn list_tags(connection: &SqliteConnection, connection_id: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT tag
             FROM connection_tags
             WHERE connection_id = ?1
             ORDER BY sort_order, tag",
        )
        .map_err(to_storage_error)?;

    let rows = statement
        .query_map(params![connection_id], |row| row.get::<_, String>(0))
        .map_err(to_storage_error)?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(to_storage_error)
}

fn insert_folder(
    connection: &SqliteConnection,
    id: &str,
    name: &str,
    parent_folder_id: Option<&str>,
    sort_order: i64,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO connection_folders (id, name, parent_folder_id, sort_order) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, parent_folder_id, sort_order],
        )
        .map(|_| ())
        .map_err(to_storage_error)
}

fn to_storage_error(error: rusqlite::Error) -> String {
    format!("SQLite storage error: {error}")
}

fn ensure_folder_exists(
    connection: &SqliteConnection,
    id: &str,
    fallback_name: &str,
) -> Result<(), String> {
    let exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM connection_folders WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(to_storage_error)?;

    if exists > 0 {
        return Ok(());
    }

    let next_sort_order = next_folder_sort_order(connection, None)?;
    insert_folder(connection, id, fallback_name, None, next_sort_order)
}

fn normalize_connection_type(value: &str) -> Result<String, String> {
    match value.trim() {
        "localFiles" => Ok("localFiles".to_string()),
        "fileView" => Ok("fileView".to_string()),
        value => match value.to_lowercase().as_str() {
            "local" | "ssh" | "telnet" | "serial" | "url" | "rdp" | "vnc" | "ftp" => {
                Ok(value.to_lowercase())
            }
            "localfiles" => Ok("localFiles".to_string()),
            "fileview" => Ok("fileView".to_string()),
            _ => Err(
                "connection type must be local, ssh, telnet, serial, url, rdp, vnc, ftp, localFiles, or fileView"
                    .to_string(),
            ),
        },
    }
}

fn normalize_url_field(
    value: Option<String>,
    connection_type: &str,
) -> Result<Option<String>, String> {
    let trimmed = value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if connection_type != "url" {
        return Ok(None);
    }

    let raw = trimmed.ok_or_else(|| "URL is required for URL connections".to_string())?;
    let candidate = if raw.contains("://") {
        raw.clone()
    } else {
        format!("https://{raw}")
    };
    let parsed =
        url::Url::parse(&candidate).map_err(|error| format!("URL is not valid: {error}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(Some(parsed.to_string())),
        other => Err(format!("URL scheme must be http or https, got {other}")),
    }
}

fn extract_url_host(value: &str) -> Option<String> {
    url::Url::parse(value)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|host| host.to_string()))
}

const LEGACY_URL_CREDENTIAL_PAGE_KEY: &str = "__legacy__";
const FNV_OFFSET: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

pub(crate) fn normalize_url_credential_page_key(page_url: Option<&str>) -> String {
    let Some(trimmed) = page_url.map(str::trim).filter(|value| !value.is_empty()) else {
        return LEGACY_URL_CREDENTIAL_PAGE_KEY.to_string();
    };

    if let Ok(mut parsed) = url::Url::parse(trimmed) {
        if matches!(parsed.scheme(), "http" | "https") {
            let _ = parsed.set_username("");
            let _ = parsed.set_password(None);
            parsed.set_query(None);
            parsed.set_fragment(None);
            return parsed.to_string();
        }
    }

    let normalized = trimmed
        .split('#')
        .next()
        .unwrap_or(trimmed)
        .split('?')
        .next()
        .unwrap_or(trimmed)
        .trim()
        .to_string();
    if normalized.is_empty() {
        LEGACY_URL_CREDENTIAL_PAGE_KEY.to_string()
    } else {
        normalized
    }
}

pub(crate) fn url_credential_secret_owner_id(connection_id: &str, page_key: &str) -> String {
    let connection_id = connection_id.trim();
    if page_key == LEGACY_URL_CREDENTIAL_PAGE_KEY {
        return connection_id.to_string();
    }
    format!("url:{connection_id}:{:016x}", fnv1a64(page_key))
}

fn fnv1a64(value: &str) -> u64 {
    value.as_bytes().iter().fold(FNV_OFFSET, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(FNV_PRIME)
    })
}

fn normalize_connection_user(value: String, connection_type: &str) -> Result<String, String> {
    match connection_type {
        "serial" | "url" | "localFiles" | "fileView" => Ok(String::new()),
        "vnc" => Ok(value.trim().to_string()),
        _ => required_field("user", value),
    }
}

fn normalize_ssh_optional_field(value: Option<String>, connection_type: &str) -> Option<String> {
    if connection_type != "ssh" {
        return None;
    }

    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Normalize a per-connection SSH compression override. Only SSH connections
/// carry it; `None` (or any non-SSH type) means "inherit the global default".
/// The only meaningful explicit values are `off` and `fast` (russh's zlib level
/// is fixed at `fast`), so anything else is rejected.
fn normalize_ssh_compression(
    value: Option<String>,
    connection_type: &str,
) -> Result<Option<String>, String> {
    if connection_type != "ssh" {
        return Ok(None);
    }
    match value.map(|value| value.trim().to_string()) {
        None => Ok(None),
        Some(value) if value.is_empty() => Ok(None),
        Some(value) if value == "off" || value == "fast" => Ok(Some(value)),
        Some(other) => Err(format!(
            "invalid SSH compression value '{other}': expected 'off' or 'fast'"
        )),
    }
}

fn normalize_connection_port(value: Option<u16>, connection_type: &str) -> Option<u16> {
    if connection_type == "serial" {
        return None;
    }

    value
}

fn normalize_data_partition(
    value: Option<String>,
    connection_type: &str,
) -> Result<Option<String>, String> {
    if connection_type != "url" {
        return Ok(None);
    }

    let trimmed = value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if let Some(partition) = trimmed.as_deref() {
        if partition == "shared" {
            return Ok(Some("shared".to_string()));
        }
        if !partition
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        {
            return Err("data partition may only contain letters, digits, '-' or '_'".to_string());
        }
        if partition.len() > 64 {
            return Err("data partition must be 64 characters or fewer".to_string());
        }
    }

    Ok(trimmed)
}

fn normalize_use_tmux_sessions(value: Option<bool>, connection_type: &str) -> bool {
    connection_type == "ssh" && value.unwrap_or(true)
}

/// psmux session management is a local-only feature (the native Windows tmux).
/// Unlike SSH tmux it defaults **off** and is opted into per Connection.
fn normalize_use_psmux_sessions(value: Option<bool>, connection_type: &str) -> bool {
    connection_type == "local" && value.unwrap_or(false)
}

fn normalize_file_view_open_external(value: bool, connection_type: &str) -> bool {
    connection_type == "fileView" && value
}

fn normalize_ssh_port_forwardings(
    forwardings: Option<Vec<SshPortForwarding>>,
    connection_type: &str,
) -> Result<Option<Vec<SshPortForwarding>>, String> {
    if connection_type != "ssh" {
        return Ok(None);
    }
    let mut normalized = Vec::new();
    for mut forwarding in forwardings.unwrap_or_default() {
        forwarding.id = required_field("forwarding id", forwarding.id)?;
        forwarding.mode = required_field("forwarding mode", forwarding.mode)?.to_uppercase();
        if !matches!(forwarding.mode.as_str(), "L" | "R" | "D") {
            return Err("forwarding mode must be L, R, or D".to_string());
        }
        forwarding.bind = required_field("forwarding bind address", forwarding.bind)?;
        if forwarding.listen_port == 0 {
            return Err("forwarding listen port must be between 1 and 65535".to_string());
        }
        if forwarding.mode == "D" {
            forwarding.dest_host = None;
            forwarding.dest_port = None;
        } else {
            forwarding.dest_host = Some(required_field(
                "forwarding destination host",
                forwarding.dest_host.unwrap_or_default(),
            )?);
            if forwarding.dest_port.unwrap_or(0) == 0 {
                return Err("forwarding destination port must be between 1 and 65535".to_string());
            }
        }
        normalized.push(forwarding);
    }
    if normalized.is_empty() {
        Ok(None)
    } else {
        Ok(Some(normalized))
    }
}

fn normalize_serial_line(
    value: Option<String>,
    connection_type: &str,
) -> Result<Option<String>, String> {
    if connection_type != "serial" {
        return Ok(None);
    }

    let line = value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "COM1".to_string());
    if line.chars().any(char::is_control) {
        return Err("serial line cannot contain control characters".to_string());
    }
    Ok(Some(line))
}

fn normalize_serial_speed(
    value: Option<u32>,
    connection_type: &str,
) -> Result<Option<u32>, String> {
    if connection_type != "serial" {
        return Ok(None);
    }

    match value.unwrap_or(9600) {
        0 => Err("serial speed must be greater than 0".to_string()),
        speed => Ok(Some(speed)),
    }
}

fn normalize_local_shell(
    value: Option<String>,
    connection_type: &str,
) -> Result<Option<String>, String> {
    if connection_type != "local" {
        return Ok(None);
    }

    let Some(shell) = value
        .map(|shell| shell.trim().to_string())
        .filter(|shell| !shell.is_empty())
    else {
        return Ok(None);
    };

    if shell.chars().any(char::is_control) {
        return Err("local shell cannot contain control characters".to_string());
    }
    if shell.chars().count() > 1000 {
        return Err("local shell must be 1000 characters or fewer".to_string());
    }

    Ok(Some(shell))
}

fn normalize_local_startup_directory(
    value: Option<String>,
    connection_type: &str,
) -> Result<Option<String>, String> {
    // For `fileView` Connections this column stores the target file path rather
    // than a starting directory; both reuse the same non-secret local path slot.
    if connection_type != "local"
        && connection_type != "localFiles"
        && connection_type != "fileView"
    {
        return Ok(None);
    }

    let trimmed = value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(directory) = trimmed.as_deref() {
        if directory.chars().any(char::is_control) {
            return Err("local startup directory cannot contain control characters".to_string());
        }
    }
    Ok(trimmed)
}

fn normalize_local_startup_script(
    value: Option<String>,
    connection_type: &str,
) -> Result<Option<String>, String> {
    // `local` shells run this as an environment/startup block; `ssh` Connections
    // reuse the same column to store a remote startup script that is typed into
    // the session after it opens. Both keep multi-line content (newlines are part
    // of the script), so we only trim the surrounding whitespace.
    if connection_type != "local" && connection_type != "ssh" {
        return Ok(None);
    }

    Ok(value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty()))
}

fn normalize_auth_method(
    value: Option<String>,
    connection_type: &str,
    key_path: &Option<String>,
) -> Result<String, String> {
    if connection_type == "telnet" {
        return Ok("password".to_string());
    }

    if connection_type != "ssh" {
        return Ok("keyFile".to_string());
    }

    match value
        .as_deref()
        .map(str::trim)
        .filter(|method| !method.is_empty())
    {
        Some("keyFile") | Some("key-file") | Some("key") => Ok("keyFile".to_string()),
        Some("password") => Ok("password".to_string()),
        Some("agent") | Some("sshAgent") | Some("ssh-agent") => Ok("agent".to_string()),
        Some(_) => Err("SSH auth method must be keyFile, password, or agent".to_string()),
        None if key_path.is_some() => Ok("keyFile".to_string()),
        None => Ok("agent".to_string()),
    }
}

fn folder_name_for(folder_id: &str) -> &str {
    match folder_id {
        "local" => "Local workspace",
        "manual" => "Manual",
        other => other,
    }
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_optional_id(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_rdp_connection_options(
    options: Option<RdpConnectionOptions>,
    connection_type: &str,
) -> Result<Option<RdpConnectionOptions>, String> {
    if connection_type != "rdp" {
        return Ok(None);
    }
    let Some(mut options) = options else {
        return Ok(None);
    };
    if options.inherit_defaults {
        return Ok(Some(RdpConnectionOptions {
            inherit_defaults: true,
            color_depth: None,
            redirect_clipboard: None,
            redirect_drives: None,
            bitmap_cache: None,
            performance_profile: None,
            remote_resolution: None,
            view_mode: None,
        }));
    }
    if let Some(color_depth) = options.color_depth {
        options.color_depth = Some(validate_rdp_color_depth(color_depth)?);
    }
    if let Some(profile) = options.performance_profile {
        options.performance_profile = Some(validate_remote_desktop_performance_profile(profile)?);
    }
    if let Some(resolution) = options.remote_resolution {
        options.remote_resolution = Some(validate_remote_desktop_resolution(resolution)?);
    }
    if let Some(view_mode) = options.view_mode {
        options.view_mode = Some(validate_remote_desktop_view_mode(view_mode)?);
    }
    Ok(Some(options))
}

fn normalize_vnc_connection_options(
    options: Option<VncConnectionOptions>,
    connection_type: &str,
) -> Result<Option<VncConnectionOptions>, String> {
    if connection_type != "vnc" {
        return Ok(None);
    }
    let Some(mut options) = options else {
        return Ok(None);
    };
    if options.inherit_defaults {
        return Ok(Some(VncConnectionOptions {
            inherit_defaults: true,
            shared_session: None,
            view_only: None,
            color_level: None,
            preferred_encoding: None,
            view_mode: None,
        }));
    }
    if let Some(color_level) = options.color_level {
        options.color_level = Some(validate_vnc_color_level(color_level)?);
    }
    if let Some(encoding) = options.preferred_encoding {
        options.preferred_encoding = Some(validate_vnc_preferred_encoding(encoding)?);
    }
    if let Some(view_mode) = options.view_mode {
        options.view_mode = Some(validate_remote_desktop_view_mode(view_mode)?);
    }
    Ok(Some(options))
}

fn serialize_connection_options<T: Serialize>(
    options: &Option<T>,
    label: &str,
) -> Result<Option<String>, String> {
    options
        .as_ref()
        .map(|options| {
            serde_json::to_string(options)
                .map_err(|error| format!("failed to serialize {label} connection options: {error}"))
        })
        .transpose()
}

fn parse_rdp_connection_options(
    value: Option<String>,
) -> rusqlite::Result<Option<RdpConnectionOptions>> {
    parse_connection_options(value)
}

fn parse_vnc_connection_options(
    value: Option<String>,
) -> rusqlite::Result<Option<VncConnectionOptions>> {
    parse_connection_options(value)
}

fn parse_ftp_connection_options(
    value: Option<String>,
) -> rusqlite::Result<Option<crate::ftp::FtpOptions>> {
    parse_connection_options(value)
}

fn normalize_ftp_connection_options(
    options: Option<crate::ftp::FtpOptions>,
    connection_type: &str,
) -> Result<Option<crate::ftp::FtpOptions>, String> {
    if connection_type != "ftp" {
        return Ok(None);
    }
    Ok(Some(options.unwrap_or_default()))
}

fn parse_connection_options<T>(value: Option<String>) -> rusqlite::Result<Option<T>>
where
    T: for<'de> Deserialize<'de>,
{
    value
        .map(|value| {
            serde_json::from_str(&value).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })
        })
        .transpose()
}

fn normalize_connection_icon_data_url(value: Option<String>) -> Result<Option<String>, String> {
    let value = trim_optional(value);
    if let Some(value) = value.as_deref() {
        if value.len() > 512 * 1024 {
            return Err("connection icon data URL is too large".to_string());
        }
        // Accept an inline image data URL or one of the app's icon-catalog refs
        // ("lucide:Name" / "material:id" / "os:id" / "brand:id"), which the icon picker offers
        // and the ConnectionIcon renderer resolves. Catalog refs are short
        // identifiers; "os:id" is the bundled OS/distro logo set used by SSH
        // remote-OS auto-detection.
        let is_image_data_url = value.starts_with("data:image/");
        let is_icon_ref = value.starts_with("lucide:")
            || value.starts_with("material:")
            || value.starts_with("os:")
            || value.starts_with("brand:");
        if !is_image_data_url && !is_icon_ref {
            return Err("connection icon must be an image data URL".to_string());
        }
    }
    Ok(value)
}

fn normalize_connection_icon_background_color(
    value: Option<String>,
) -> Result<Option<String>, String> {
    let value = trim_optional(value);
    if let Some(value) = value.as_deref() {
        let color = value.strip_prefix('#').unwrap_or(value);
        let valid_length = color.len() == 3 || color.len() == 6;
        if !valid_length || !color.chars().all(|character| character.is_ascii_hexdigit()) {
            return Err("connection icon background color must be a hex color".to_string());
        }
        return Ok(Some(format!("#{color}").to_lowercase()));
    }
    Ok(None)
}

fn normalize_terminal_opacity(value: Option<u8>) -> Result<u8, String> {
    let opacity = value.unwrap_or(DEFAULT_TERMINAL_OPACITY);
    if opacity > 100 {
        return Err("terminal opacity must be between 0 and 100".to_string());
    }
    Ok(opacity)
}

fn normalize_loaded_terminal_opacity(value: Option<i64>) -> Option<u8> {
    let opacity = value.unwrap_or(i64::from(DEFAULT_TERMINAL_OPACITY));
    if (0..=100).contains(&opacity) {
        Some(opacity as u8)
    } else {
        Some(DEFAULT_TERMINAL_OPACITY)
    }
}

fn terminal_background_from_json(
    value: Option<String>,
) -> Option<crate::dashboard_storage::DashboardBackground> {
    value.and_then(|json| {
        serde_json::from_str::<crate::dashboard_storage::DashboardBackground>(&json).ok()
    })
}

fn terminal_background_to_json(
    background: &Option<crate::dashboard_storage::DashboardBackground>,
) -> Result<Option<String>, String> {
    match background {
        None => Ok(None),
        Some(background) => {
            background
                .validate()
                .map_err(|error| format!("{error:?}"))?;
            serde_json::to_string(background)
                .map(Some)
                .map_err(|_| "terminal background is invalid".to_string())
        }
    }
}

fn file_browser_view_options_from_json(value: Option<String>) -> Option<FileBrowserViewOptions> {
    value.and_then(|json| serde_json::from_str::<FileBrowserViewOptions>(&json).ok())
}

fn file_browser_view_options_to_json(
    options: &Option<FileBrowserViewOptions>,
) -> Result<Option<String>, String> {
    match options {
        None => Ok(None),
        Some(options) => {
            options.validate()?;
            serde_json::to_string(options)
                .map(Some)
                .map_err(|_| "file browser view options are invalid".to_string())
        }
    }
}

fn ssh_port_forwardings_from_json(value: Option<String>) -> Option<Vec<SshPortForwarding>> {
    value.and_then(|json| serde_json::from_str::<Vec<SshPortForwarding>>(&json).ok())
}

fn ssh_port_forwardings_to_json(
    forwardings: &Option<Vec<SshPortForwarding>>,
) -> Result<Option<String>, String> {
    match forwardings {
        None => Ok(None),
        Some(forwardings) => serde_json::to_string(forwardings)
            .map(Some)
            .map_err(|_| "SSH port forwardings are invalid".to_string()),
    }
}

fn required_field(field: &str, value: String) -> Result<String, String> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        Err(format!("{field} is required"))
    } else {
        Ok(trimmed)
    }
}

fn default_general_settings() -> GeneralSettings {
    GeneralSettings {
        auto_backup_enabled: true,
        auto_update_checks_enabled: default_auto_update_checks_enabled(),
        show_connected_connections_in_rail: true,
        show_workspace_on_rail: default_show_workspace_on_rail(),
        show_dashboard_on_rail: default_show_dashboard_on_rail(),
        show_all_connections_in_tree: false,
        hide_top_tab_buttons: false,
        double_click_opens_connection: false,
        submit_ai_attachments_directly: default_submit_ai_attachments_directly(),
        separate_split_terminal_backgrounds: false,
        show_installer_on_rail: default_show_installer_on_rail(),
        show_it_ops: default_show_it_ops(),
        show_dont_sleep_on_rail: default_show_dont_sleep_on_rail(),
        activity_rail_order: default_activity_rail_order(),
        installer_check_interval_seconds: default_installer_check_interval_seconds(),
        pinned_connection_ids: Vec::new(),
        allow_clipboard_read: default_allow_clipboard_read(),
        auto_start_with_windows: false,
        minimize_to_tray: false,
        dont_sleep_enabled: false,
        dont_sleep_foreground_only: default_dont_sleep_foreground_only(),
        use_directx_screen_capture: default_use_directx_screen_capture(),
        status_bar_enabled: default_status_bar_enabled(),
        status_bar_monitor_enabled: default_status_bar_monitor_enabled(),
        status_bar_monitor_interval_seconds: default_status_bar_monitor_interval_seconds(),
        advanced_debugging_enabled: false,
        rdp_webview_stability: false,
        last_backup_at: None,
    }
}

pub(crate) fn default_secret_store() -> String {
    if cfg!(target_os = "linux") {
        "file".to_string()
    } else {
        "os".to_string()
    }
}

pub(crate) fn secret_store_options() -> Vec<&'static str> {
    if cfg!(target_os = "linux") {
        vec!["file"]
    } else {
        vec!["os", "file"]
    }
}

fn default_credential_settings() -> CredentialSettings {
    CredentialSettings {
        secret_store: default_secret_store(),
    }
}

fn default_use_directx_screen_capture() -> bool {
    true
}

fn default_dont_sleep_foreground_only() -> bool {
    true
}

fn default_submit_ai_attachments_directly() -> bool {
    true
}

fn default_show_installer_on_rail() -> bool {
    true
}

fn default_show_workspace_on_rail() -> bool {
    true
}

fn default_show_dashboard_on_rail() -> bool {
    true
}

fn default_show_it_ops() -> bool {
    false
}

fn default_show_dont_sleep_on_rail() -> bool {
    true
}

fn default_activity_rail_order() -> Vec<String> {
    ["workspace", "dashboard", "installer", "itops", "dontSleep"]
        .into_iter()
        .map(str::to_string)
        .collect()
}

fn default_installer_check_interval_seconds() -> u32 {
    86_400
}

fn default_app_launcher_settings() -> AppLauncherSettings {
    AppLauncherSettings {
        entries: Vec::new(),
        view_mode: default_app_launcher_view_mode(),
        list_sort: default_app_launcher_list_sort(),
        details_sort: default_app_launcher_details_sort(),
    }
}

fn default_app_launcher_view_mode() -> String {
    "icons".to_string()
}

fn default_app_launcher_list_sort() -> AppLauncherSortState {
    AppLauncherSortState {
        field: "name".to_string(),
        direction: "asc".to_string(),
    }
}

fn default_app_launcher_details_sort() -> AppLauncherSortState {
    AppLauncherSortState {
        field: "name".to_string(),
        direction: "asc".to_string(),
    }
}

fn default_dashboard_settings() -> DashboardSettings {
    DashboardSettings {
        confirm_remove: true,
        default_landing_view: "lastActive".to_string(),
        max_active_script_widgets: default_max_active_script_widgets(),
        allow_widget_network_tools: default_allow_widget_network_tools(),
        use_random_dynamic_background: false,
        widget_layout_enforcement: default_widget_layout_enforcement(),
    }
}

/// Default script-widget layout enforcement level. `strict` makes generated
/// widgets fill their frame by construction, which is the most consistent
/// default; users can relax to `moderate` (historical) or `low` in Settings.
fn default_widget_layout_enforcement() -> String {
    "strict".to_string()
}

/// Default ceiling for simultaneously active script widgets on a Dashboard.
/// Picked above the 3 used during the post-mortem (which was too tight for
/// dashboards with several lightweight script widgets) but well below the
/// 100 upper bound so heavy widgets do not silently regress the freeze.
fn default_max_active_script_widgets() -> u32 {
    8
}

/// Default for the per-install network-tools kill-switch. true means widgets
/// that explicitly opt in via `permissions.networkTools: true` can use KK.net.*;
/// users can flip this off globally to disable network tools across all widgets
/// without editing each one.
fn default_allow_widget_network_tools() -> bool {
    true
}

/// Hard upper bound applied at the storage boundary. The Settings UI
/// surfaces the same value to keep the slider/number-input clamp consistent.
pub const MAX_ACTIVE_SCRIPT_WIDGETS_LIMIT: u32 = 100;

fn default_show_connected_connections_in_rail() -> bool {
    true
}

fn default_auto_update_checks_enabled() -> bool {
    true
}

fn default_allow_clipboard_read() -> bool {
    true
}

fn default_status_bar_enabled() -> bool {
    true
}

fn default_status_bar_monitor_enabled() -> bool {
    true
}

fn default_status_bar_monitor_interval_seconds() -> u32 {
    5
}

fn default_terminal_settings() -> TerminalSettings {
    TerminalSettings {
        // Resolves per platform via CSS fallback: Cascadia Mono (Windows),
        // SF Mono (macOS), then the bundled JetBrains Mono (Linux / anywhere the
        // others are absent). Keep in sync with the frontend app-defaults.ts.
        font_family: "\"Cascadia Mono\", \"SF Mono\", \"JetBrains Mono\", Consolas, monospace"
            .to_string(),
        font_size: 12,
        line_height: 1.25,
        cursor_style: "block".to_string(),
        scrollback_lines: 5_000,
        default_transparency: default_terminal_transparency(),
        use_random_dynamic_background: false,
        copy_on_select: false,
        allow_osc52_clipboard: default_allow_osc52_clipboard(),
        confirm_multiline_paste: true,
        default_shell: if cfg!(target_os = "windows") {
            "powershell.exe".to_string()
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
        },
        custom_shells: Vec::new(),
    }
}

fn default_allow_osc52_clipboard() -> bool {
    true
}

fn default_appearance_settings() -> AppearanceSettings {
    AppearanceSettings {
        app_font_family: "\"Inter\", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif".to_string(),
        color_scheme: "default".to_string(),
        custom_font_path: None,
        use_custom_title_bar: true,
    }
}

fn default_ssh_settings() -> SshSettings {
    SshSettings {
        default_user: default_ssh_user(),
        default_port: 22,
        default_key_path: default_ssh_key_path(),
        default_proxy_jump: None,
        default_ssh_socks_proxy: None,
        default_ssh_socks_proxy_username: None,
        buffer_lines: default_ssh_buffer_lines(),
        default_transparency: default_terminal_transparency(),
        default_use_tmux_sessions: default_use_tmux_sessions(),
        use_random_dynamic_background: false,
        hide_common_port_redirects: default_hide_common_port_redirects(),
        allow_osc52_clipboard: default_allow_osc52_clipboard(),
        managed_x_server_enabled: false,
        x_server_path: None,
        x_server_display: default_x_server_display(),
        x_server_args: default_x_server_args(),
    }
}

fn default_ssh_buffer_lines() -> u32 {
    5_000
}

fn default_terminal_transparency() -> u8 {
    50
}

fn default_use_tmux_sessions() -> bool {
    true
}

fn default_hide_common_port_redirects() -> bool {
    true
}

fn default_x_server_display() -> u16 {
    0
}

fn default_x_server_args() -> String {
    "-multiwindow -clipboard -wgl".to_string()
}

fn default_sftp_settings() -> SftpSettings {
    SftpSettings {
        overwrite_behavior: "fail".to_string(),
        file_explorer_open_mode: default_file_explorer_open_mode(),
        file_explorer_terminal_shell: default_file_explorer_terminal_shell(),
        file_explorer_terminal_elevated: false,
    }
}

fn default_file_explorer_open_mode() -> String {
    "external".to_string()
}

fn default_file_explorer_terminal_shell() -> String {
    if cfg!(target_os = "windows") {
        "powershell.exe".to_string()
    } else if cfg!(target_os = "macos") {
        "/bin/zsh".to_string()
    } else {
        "/bin/bash".to_string()
    }
}

fn default_url_settings() -> UrlSettings {
    UrlSettings {
        ignore_certificate_errors: false,
        default_proxy_url: None,
        default_data_partition: None,
    }
}

fn default_rdp_settings() -> RdpSettings {
    RdpSettings {
        color_depth: default_rdp_color_depth(),
        redirect_clipboard: true,
        redirect_drives: false,
        bitmap_cache: true,
        performance_profile: default_remote_desktop_performance_profile(),
        remote_resolution: default_remote_desktop_resolution(),
        view_mode: default_remote_desktop_view_mode(),
    }
}

fn default_remote_desktop_resolution() -> String {
    "automatic".to_string()
}

fn default_remote_desktop_view_mode() -> String {
    "fit".to_string()
}

fn default_rdp_color_depth() -> u16 {
    32
}

fn default_remote_desktop_true() -> bool {
    true
}

fn default_remote_desktop_performance_profile() -> String {
    "balanced".to_string()
}

fn default_vnc_settings() -> VncSettings {
    VncSettings {
        shared_session: true,
        view_only: false,
        color_level: default_vnc_color_level(),
        preferred_encoding: default_vnc_preferred_encoding(),
        view_mode: default_remote_desktop_view_mode(),
    }
}

fn default_vnc_color_level() -> String {
    "full".to_string()
}

fn default_vnc_preferred_encoding() -> String {
    "tight".to_string()
}

fn default_screenshot_settings() -> ScreenshotSettings {
    ScreenshotSettings {
        folder_path: default_screenshot_folder_path(),
    }
}

pub(crate) fn default_screenshot_folder_path() -> String {
    if let Some(path) = windows_screenshots_folder_path() {
        return path;
    }

    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(|home| {
            PathBuf::from(home)
                .join("Pictures")
                .join("Screenshots")
                .to_string_lossy()
                .to_string()
        })
        .unwrap_or_else(|_| "%USERPROFILE%\\Pictures\\Screenshots".to_string())
}

#[cfg(target_os = "windows")]
fn windows_screenshots_folder_path() -> Option<String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    use windows_sys::Win32::System::Com::CoTaskMemFree;
    use windows_sys::Win32::UI::Shell::SHGetKnownFolderPath;
    use windows_sys::core::GUID;

    const FOLDERID_SCREENSHOTS: GUID = GUID {
        data1: 0xb7bede81,
        data2: 0xdf94,
        data3: 0x4682,
        data4: [0xa7, 0xd8, 0x57, 0xa5, 0x26, 0x20, 0xb8, 0x6f],
    };

    unsafe {
        let mut raw_path = std::ptr::null_mut();
        if SHGetKnownFolderPath(
            &FOLDERID_SCREENSHOTS,
            0,
            std::ptr::null_mut(),
            &mut raw_path,
        ) < 0
            || raw_path.is_null()
        {
            return None;
        }

        let mut len = 0;
        while *raw_path.add(len) != 0 {
            len += 1;
        }
        let path = OsString::from_wide(std::slice::from_raw_parts(raw_path, len))
            .to_string_lossy()
            .to_string();
        CoTaskMemFree(raw_path.cast());

        if path.trim().is_empty() {
            None
        } else {
            Some(path)
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn windows_screenshots_folder_path() -> Option<String> {
    None
}

fn default_ai_provider_settings() -> AiProviderSettings {
    AiProviderSettings {
        enabled: false,
        provider_kind: default_ai_provider_kind(),
        base_url: "https://api.openai.com/v1".to_string(),
        model: default_ai_model(),
        reasoning_effort: default_ai_reasoning_effort(),
        output_language: String::new(),
        custom_instructions: String::new(),
        api_mode: default_ai_api_mode(),
        extra_headers: String::new(),
        allow_insecure_tls: false,
        allow_insecure_mcp_http: false,
        show_all_models: false,
        cli_execution_policy: default_ai_cli_execution_policy(),
        tool_permission_mode: default_ai_tool_permission_mode(),
        built_in_mcp_server_enabled: default_built_in_mcp_server_enabled(),
        built_in_mcp_allow_all_dangerous: false,
        use_codex_cli: false,
        use_claude_cli: false,
        claude_cli_path: None,
        codex_cli_path: None,
        disabled_skill_names: Vec::new(),
        custom_skills_enabled: default_custom_assistant_skills_enabled(),
        tools: default_ai_assistant_tool_settings(),
        search_provider: default_search_provider(),
        searxng_url: String::new(),
        email_provider: default_email_provider(),
        email_from: String::new(),
        mailgun_domain: String::new(),
        smtp_host: String::new(),
        smtp_port: default_smtp_port(),
        smtp_username: String::new(),
        smtp_security: default_smtp_security(),
        search_provider_api_key: None,
        email_secret: None,
    }
}

fn default_custom_assistant_skills_enabled() -> bool {
    true
}

fn default_ai_assistant_tool_settings() -> AiAssistantToolSettings {
    AiAssistantToolSettings {
        web_search: default_ai_general_tool_enabled(),
        web_fetch: default_ai_general_tool_enabled(),
        shell_command: default_ai_general_tool_enabled(),
        app_data_file_search: default_ai_general_tool_enabled(),
        app_data_file_read: default_ai_general_tool_enabled(),
        current_time: default_ai_current_time_tool_enabled(),
        performance_counters: default_ai_performance_counters_tool_enabled(),
        dashboard: default_ai_dashboard_tool_enabled(),
        connections: default_ai_connections_tool_enabled(),
        sessions: default_ai_sessions_tool_enabled(),
        tutorial: default_ai_tutorial_tool_enabled(),
        email: false,
        manual: default_ai_manual_tool_enabled(),
        network: true,
        watchdog: default_ai_watchdog_tool_enabled(),
        memory: default_ai_memory_tool_enabled(),
    }
}

fn default_ai_watchdog_tool_enabled() -> bool {
    true
}

fn default_ai_memory_tool_enabled() -> bool {
    true
}

fn default_ai_general_tool_enabled() -> bool {
    true
}

fn default_ai_current_time_tool_enabled() -> bool {
    true
}

fn default_ai_performance_counters_tool_enabled() -> bool {
    true
}

fn default_ai_dashboard_tool_enabled() -> bool {
    true
}

fn default_ai_connections_tool_enabled() -> bool {
    true
}

fn default_ai_sessions_tool_enabled() -> bool {
    true
}

fn default_ai_tutorial_tool_enabled() -> bool {
    true
}

fn default_ai_manual_tool_enabled() -> bool {
    true
}

fn default_search_provider() -> String {
    "scraper".to_string()
}

fn default_email_provider() -> String {
    "resend".to_string()
}

fn default_smtp_port() -> u16 {
    587
}

fn default_smtp_security() -> String {
    "starttls".to_string()
}

fn default_ai_provider_kind() -> String {
    "openai".to_string()
}

fn default_ai_model() -> String {
    "gpt-5.4-mini".to_string()
}

fn default_ai_reasoning_effort() -> String {
    "medium".to_string()
}

fn default_ai_cli_execution_policy() -> String {
    "suggestOnly".to_string()
}

fn default_ai_tool_permission_mode() -> String {
    "prompt".to_string()
}

fn default_built_in_mcp_server_enabled() -> bool {
    true
}

fn default_ai_api_mode() -> String {
    "chatCompletions".to_string()
}

fn validate_general_settings(mut settings: GeneralSettings) -> Result<GeneralSettings, String> {
    settings.pinned_connection_ids = unique_non_empty_strings(settings.pinned_connection_ids);
    settings.status_bar_monitor_interval_seconds =
        match settings.status_bar_monitor_interval_seconds {
            5 | 15 | 30 | 60 | 300 => settings.status_bar_monitor_interval_seconds,
            _ => default_status_bar_monitor_interval_seconds(),
        };
    settings.installer_check_interval_seconds = match settings.installer_check_interval_seconds {
        3_600 | 86_400 | 604_800 | 2_592_000 => settings.installer_check_interval_seconds,
        _ => default_installer_check_interval_seconds(),
    };
    Ok(settings)
}

fn validate_credential_settings(
    mut settings: CredentialSettings,
) -> Result<CredentialSettings, String> {
    let normalized = settings.secret_store.trim().to_lowercase();
    settings.secret_store = if secret_store_options().contains(&normalized.as_str()) {
        normalized
    } else {
        default_secret_store()
    };
    Ok(settings)
}

pub(crate) fn validate_credential_settings_for_command(
    settings: CredentialSettings,
) -> Result<CredentialSettings, String> {
    validate_credential_settings(settings)
}

fn validate_app_launcher_settings(
    mut settings: AppLauncherSettings,
) -> Result<AppLauncherSettings, String> {
    let mut entries = Vec::new();
    let mut seen_ids = Vec::new();
    for mut entry in settings.entries.drain(..) {
        entry.id = entry.id.trim().to_string();
        if entry.id.is_empty() || seen_ids.contains(&entry.id) {
            continue;
        }
        seen_ids.push(entry.id.clone());
        entry.path = required_field("App Launcher path", entry.path)?;
        entry.name = entry.name.trim().to_string();
        if entry.name.is_empty() {
            entry.name = app_launcher_name_from_path(&entry.path);
        }
        entry.arguments = trim_optional(entry.arguments);
        entry.working_directory = trim_optional(entry.working_directory);
        entry.icon_data_url = trim_optional(entry.icon_data_url);
        entry.created_at = required_field("App Launcher created timestamp", entry.created_at)?;
        entry.updated_at = required_field("App Launcher updated timestamp", entry.updated_at)?;
        entries.push(entry);
    }
    settings.entries = entries;
    settings.view_mode = validate_app_launcher_view_mode(settings.view_mode);
    settings.list_sort = validate_app_launcher_sort_state(settings.list_sort);
    settings.details_sort = validate_app_launcher_sort_state(settings.details_sort);
    Ok(settings)
}

fn validate_app_launcher_view_mode(value: String) -> String {
    match value.trim() {
        "list" => "list".to_string(),
        "details" => "details".to_string(),
        _ => "icons".to_string(),
    }
}

fn validate_app_launcher_sort_state(mut sort: AppLauncherSortState) -> AppLauncherSortState {
    sort.field = match sort.field.trim() {
        "path" => "path".to_string(),
        "type" => "type".to_string(),
        "size" => "size".to_string(),
        "modified" => "modified".to_string(),
        _ => "name".to_string(),
    };
    sort.direction = match sort.direction.trim() {
        "desc" => "desc".to_string(),
        _ => "asc".to_string(),
    };
    sort
}

pub(crate) fn app_launcher_name_from_path(path: &str) -> String {
    // Derive the display name from the file base name with its extension
    // stripped. Split on both separators explicitly so a Windows path (or a
    // Unix path) yields the same name regardless of the host OS — `Path` only
    // recognizes the host separator, which would mis-parse foreign paths.
    let trimmed = path.trim().trim_end_matches(['/', '\\']);
    let base = trimmed.rsplit(['/', '\\']).next().unwrap_or(trimmed);
    let stem = match base.rsplit_once('.') {
        Some((name, _ext)) if !name.is_empty() => name,
        _ => base,
    };
    let name = stem.trim();
    if name.is_empty() {
        "Application".to_string()
    } else {
        name.to_string()
    }
}

fn validate_dashboard_settings(
    mut settings: DashboardSettings,
) -> Result<DashboardSettings, String> {
    settings.default_landing_view = required_field(
        "default Dashboard landing view",
        settings.default_landing_view,
    )?;
    settings.allow_widget_network_tools = true;
    settings.widget_layout_enforcement = match settings.widget_layout_enforcement.as_str() {
        "strict" => "strict",
        "moderate" => "moderate",
        "low" => "low",
        _ => "strict",
    }
    .to_string();
    if settings.max_active_script_widgets < 1
        || settings.max_active_script_widgets > MAX_ACTIVE_SCRIPT_WIDGETS_LIMIT
    {
        return Err(format!(
            "max active script widgets must be between 1 and {MAX_ACTIVE_SCRIPT_WIDGETS_LIMIT}"
        ));
    }
    Ok(settings)
}

fn validate_terminal_settings(mut settings: TerminalSettings) -> Result<TerminalSettings, String> {
    settings.font_family = required_field("font family", settings.font_family)?;
    settings.default_shell = required_field("default shell", settings.default_shell)?;
    settings.custom_shells = validate_terminal_custom_shells(settings.custom_shells)?;

    if !(8..=32).contains(&settings.font_size) {
        return Err("terminal font size must be between 8 and 32".to_string());
    }

    if !(1.0..=2.0).contains(&settings.line_height) {
        return Err("terminal line height must be between 1.0 and 2.0".to_string());
    }

    settings.cursor_style = match settings.cursor_style.trim().to_lowercase().as_str() {
        "block" | "bar" | "underline" => settings.cursor_style.trim().to_lowercase(),
        _ => return Err("terminal cursor style must be block, bar, or underline".to_string()),
    };

    if !(100..=100_000).contains(&settings.scrollback_lines) {
        return Err("terminal scrollback must be between 100 and 100000 lines".to_string());
    }
    if settings.default_transparency > 100 {
        return Err("terminal default transparency must be between 0 and 100".to_string());
    }

    Ok(settings)
}

fn validate_terminal_custom_shells(
    custom_shells: Vec<TerminalCustomShell>,
) -> Result<Vec<TerminalCustomShell>, String> {
    let mut normalized = Vec::new();
    let mut seen_ids = Vec::new();

    for shell in custom_shells {
        let id = required_field("custom shell id", shell.id)?;
        let name = required_field("custom shell name", shell.name)?;
        let command_line = required_field("custom shell command line", shell.command_line)?;

        if seen_ids.contains(&id) {
            continue;
        }
        seen_ids.push(id.clone());

        if name.chars().count() > 80 {
            return Err("custom shell name must be 80 characters or fewer".to_string());
        }
        if command_line.chars().count() > 1000 {
            return Err("custom shell command line must be 1000 characters or fewer".to_string());
        }

        normalized.push(TerminalCustomShell {
            id,
            name,
            command_line,
        });
    }

    Ok(normalized)
}

fn validate_appearance_settings(
    mut settings: AppearanceSettings,
) -> Result<AppearanceSettings, String> {
    settings.app_font_family = required_field("app font family", settings.app_font_family)?;
    settings.color_scheme = required_field("color scheme", settings.color_scheme)?;
    settings.custom_font_path = trim_optional(settings.custom_font_path);
    settings.use_custom_title_bar = true;
    settings.color_scheme = match settings.color_scheme.to_lowercase().as_str() {
        "default" | "dark" | "light" | "match-os" | "mac" | "orange" | "purple" | "pink"
        | "green-kuai-kuai"
        | "blue-see"
        | "blue-green-white"
        | "confetti"
        | "bubble-tea"
        | "semiconductor"
        | "canarinho"
        | "la-albiceleste"
        | "les-bleus"
        | "oranje"
        | "die-mannschaft"
        | "la-roja"
        | "os-navegadores"
        | "vatreni"
        | "el-tri"
        | "three-lions"
        | "samurai-blue"
        | "stars-and-stripes" => {
            settings.color_scheme.to_lowercase()
        }
        _ => {
            return Err(
                "color scheme must be one of: default, dark, light, match-os, mac, orange, purple, pink, green-kuai-kuai, blue-see, blue-green-white, confetti, bubble-tea, semiconductor, canarinho, la-albiceleste, les-bleus, oranje, die-mannschaft, la-roja, os-navegadores, vatreni, el-tri, three-lions, samurai-blue, stars-and-stripes"
                    .to_string(),
            )
        }
    };
    Ok(settings)
}

fn validate_ssh_settings(mut settings: SshSettings) -> Result<SshSettings, String> {
    settings.default_user = required_field("default SSH user", settings.default_user)?;

    if settings.default_port == 0 {
        return Err("default SSH port must be between 1 and 65535".to_string());
    }

    settings.default_key_path = trim_optional(settings.default_key_path);
    settings.default_proxy_jump = trim_optional(settings.default_proxy_jump);
    settings.default_ssh_socks_proxy = match trim_optional(settings.default_ssh_socks_proxy) {
        Some(value) => Some(crate::socks::validate_socks_proxy(&value)?),
        None => None,
    };
    settings.default_ssh_socks_proxy_username =
        normalize_socks_proxy_username(settings.default_ssh_socks_proxy_username)?;
    if !(100..=100_000).contains(&settings.buffer_lines) {
        return Err("SSH buffer must be between 100 and 100000 lines".to_string());
    }
    if settings.default_transparency > 100 {
        return Err("SSH default transparency must be between 0 and 100".to_string());
    }
    settings.x_server_path = trim_optional(settings.x_server_path);
    settings.x_server_display = settings.x_server_display.min(99);
    settings.x_server_args = settings.x_server_args.trim().to_string();
    if settings.x_server_args.is_empty() {
        settings.x_server_args = default_x_server_args();
    }
    Ok(settings)
}

fn validate_sftp_settings(mut settings: SftpSettings) -> Result<SftpSettings, String> {
    settings.overwrite_behavior = match settings.overwrite_behavior.trim().to_lowercase().as_str() {
        "fail" | "error" | "never" => "fail".to_string(),
        "overwrite" | "replace" => "overwrite".to_string(),
        _ => return Err("SFTP overwrite behavior must be fail or overwrite".to_string()),
    };
    settings.file_explorer_open_mode = match settings
        .file_explorer_open_mode
        .trim()
        .to_lowercase()
        .as_str()
    {
        "external" => "external".to_string(),
        "inlineeditor" | "inline_editor" | "inline-editor" => "inlineEditor".to_string(),
        _ => return Err("File Explorer open mode must be external or inlineEditor".to_string()),
    };
    settings.file_explorer_terminal_shell = required_field(
        "File Explorer terminal shell",
        settings.file_explorer_terminal_shell,
    )?;
    if settings.file_explorer_terminal_shell.len() > 1000
        || settings
            .file_explorer_terminal_shell
            .chars()
            .any(|character| character.is_control())
    {
        return Err("File Explorer terminal shell must be a valid command line".to_string());
    }
    let elevated_shell = settings.file_explorer_terminal_shell.to_lowercase();
    settings.file_explorer_terminal_elevated = settings.file_explorer_terminal_elevated
        && cfg!(target_os = "windows")
        && matches!(
            elevated_shell.as_str(),
            "cmd.exe" | "powershell.exe" | "pwsh.exe"
        );
    Ok(settings)
}

fn validate_url_settings(mut settings: UrlSettings) -> Result<UrlSettings, String> {
    settings.default_proxy_url = normalize_url_proxy(settings.default_proxy_url)?;
    settings.default_data_partition = settings
        .default_data_partition
        .map(|partition| partition.trim().to_string())
        .filter(|partition| !partition.is_empty());
    Ok(settings)
}

pub(crate) fn normalize_url_proxy(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value.map(|value| value.trim().to_string()) else {
        return Ok(None);
    };
    if value.is_empty() {
        return Ok(None);
    }

    let parsed = url::Url::parse(&value).map_err(|error| format!("URL proxy is invalid: {error}"))?;
    if !matches!(parsed.scheme(), "http" | "socks5") {
        return Err("URL proxy scheme must be http or socks5".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("URL proxy credentials are not supported".to_string());
    }
    if !matches!(parsed.path(), "" | "/") || parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("URL proxy must not include a path, query, or fragment".to_string());
    }
    let host = parsed
        .host()
        .ok_or_else(|| "URL proxy host is required".to_string())?;
    let port = parsed
        .port()
        .filter(|port| *port > 0)
        .ok_or_else(|| "URL proxy requires a port between 1 and 65535".to_string())?;

    Ok(Some(format!("{}://{}:{port}", parsed.scheme(), host)))
}

fn validate_rdp_settings(mut settings: RdpSettings) -> Result<RdpSettings, String> {
    settings.color_depth = validate_rdp_color_depth(settings.color_depth)?;
    settings.performance_profile =
        validate_remote_desktop_performance_profile(settings.performance_profile)?;
    settings.remote_resolution = validate_remote_desktop_resolution(settings.remote_resolution)?;
    settings.view_mode = validate_remote_desktop_view_mode(settings.view_mode)?;
    Ok(settings)
}

fn validate_remote_desktop_resolution(value: String) -> Result<String, String> {
    let trimmed = value.trim();
    if matches!(trimmed, "automatic" | "smartSizing" | "dpiZoom") {
        return Ok(trimmed.to_string());
    }
    if let Some((w, h)) = trimmed.split_once('x') {
        let width: u32 = w
            .parse()
            .map_err(|_| format!("RDP remote resolution '{value}' is not recognized"))?;
        let height: u32 = h
            .parse()
            .map_err(|_| format!("RDP remote resolution '{value}' is not recognized"))?;
        if width >= 640 && height >= 480 && width <= 7680 && height <= 4320 {
            return Ok(format!("{width}x{height}"));
        }
    }
    Err(format!("RDP remote resolution '{value}' is not recognized"))
}

fn validate_remote_desktop_view_mode(value: String) -> Result<String, String> {
    match value.trim() {
        "fit" | "stretch" | "actualSize" | "fitWidth" | "fitHeight" => Ok(value.trim().to_string()),
        _ => Err(
            "Remote desktop view mode must be fit, stretch, actualSize, fitWidth, or fitHeight"
                .to_string(),
        ),
    }
}

fn validate_vnc_settings(mut settings: VncSettings) -> Result<VncSettings, String> {
    settings.color_level = validate_vnc_color_level(settings.color_level)?;
    settings.preferred_encoding = validate_vnc_preferred_encoding(settings.preferred_encoding)?;
    settings.view_mode = validate_remote_desktop_view_mode(settings.view_mode)?;
    Ok(settings)
}

fn validate_rdp_color_depth(value: u16) -> Result<u16, String> {
    match value {
        15 | 16 | 24 | 32 => Ok(value),
        _ => Err("RDP color depth must be 15, 16, 24, or 32".to_string()),
    }
}

fn validate_remote_desktop_performance_profile(value: String) -> Result<String, String> {
    match value.trim().to_lowercase().as_str() {
        "balanced" | "quality" | "speed" => Ok(value.trim().to_lowercase()),
        _ => Err("RDP performance profile must be balanced, quality, or speed".to_string()),
    }
}

fn validate_vnc_color_level(value: String) -> Result<String, String> {
    match value.trim().to_lowercase().as_str() {
        "full" | "256" | "64" | "8" => Ok(value.trim().to_lowercase()),
        _ => Err("VNC color level must be full, 256, 64, or 8".to_string()),
    }
}

fn validate_vnc_preferred_encoding(value: String) -> Result<String, String> {
    match value.trim().to_lowercase().as_str() {
        "tight" | "zrle" | "raw" => Ok(value.trim().to_lowercase()),
        _ => Err("VNC preferred encoding must be tight, zrle, or raw".to_string()),
    }
}

fn validate_screenshot_settings(
    mut settings: ScreenshotSettings,
) -> Result<ScreenshotSettings, String> {
    settings.folder_path = required_field("screenshots folder", settings.folder_path)?;
    let folder = expand_home_path(&settings.folder_path);
    fs::create_dir_all(&folder)
        .map_err(|error| format!("failed to create screenshots folder: {error}"))?;
    Ok(settings)
}

fn expand_home_path(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if let Some(rest) = trimmed.strip_prefix("%USERPROFILE%") {
        if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
            return PathBuf::from(home).join(rest.trim_start_matches(['\\', '/']));
        }
    }
    PathBuf::from(trimmed)
}

fn validate_ai_provider_settings(
    mut settings: AiProviderSettings,
) -> Result<AiProviderSettings, String> {
    settings.provider_kind = match settings.provider_kind.trim().to_lowercase().as_str() {
        "" | "openai" => "openai".to_string(),
        "anthropic" => "anthropic".to_string(),
        "openrouter" => "openrouter".to_string(),
        "deepseek" => "deepseek".to_string(),
        "gemini" | "google-gemini" | "google_gemini" | "google gemini" => "gemini".to_string(),
        "grok" | "xai" => "grok".to_string(),
        "azure-openai" | "azure_openai" | "azure openai" => "azure-openai".to_string(),
        "litellm" | "lite-llm" | "lite_llm" => "litellm".to_string(),
        "github-copilot" | "github_copilot" | "github copilot" => "github-copilot".to_string(),
        "ollama" => "ollama".to_string(),
        "nvidia" => "nvidia".to_string(),
        "opencode" | "open-code" | "open_code" | "open code" => "opencode".to_string(),
        "openai-compatible" | "openai_compatible" | "openai compatible" => {
            "openai-compatible".to_string()
        }
        _ => return Err("AI provider is not supported".to_string()),
    };
    settings.base_url = required_field("AI provider endpoint", settings.base_url)?;
    settings.base_url = settings.base_url.trim_end_matches('/').to_string();
    settings.model = required_field("AI model", settings.model)?;
    settings.reasoning_effort = match settings.reasoning_effort.trim().to_lowercase().as_str() {
        "" | "default" | "providerdefault" | "provider-default" | "provider_default" => {
            "default".to_string()
        }
        "low" => "low".to_string(),
        "medium" => "medium".to_string(),
        "high" => "high".to_string(),
        "max" | "maximum" | "xhigh" | "x-high" | "x_high" => "max".to_string(),
        _ => {
            return Err(
                "AI reasoning effort must be default, low, medium, high, or max".to_string(),
            );
        }
    };
    settings.cli_execution_policy = match settings.cli_execution_policy.trim() {
        "" | "suggestOnly" | "suggest-only" | "suggest_only" => "suggestOnly".to_string(),
        _ => {
            return Err(
                "CLI adapter policy must remain suggest-only for approval-based execution"
                    .to_string(),
            );
        }
    };
    settings.tool_permission_mode = match settings
        .tool_permission_mode
        .trim()
        .to_lowercase()
        .replace(['-', '_', ' '], "")
        .as_str()
    {
        "" | "prompt" => "prompt".to_string(),
        "allowall" => "allowAll".to_string(),
        _ => return Err("AI tool permission mode must be prompt or allowAll".to_string()),
    };
    settings.output_language = settings.output_language.trim().to_string();
    settings.custom_instructions = settings.custom_instructions.trim().to_string();
    settings.api_mode = match settings
        .api_mode
        .trim()
        .to_lowercase()
        .replace(['-', '_', ' '], "")
        .as_str()
    {
        "" | "chat" | "chatcompletion" | "chatcompletions" => "chatCompletions".to_string(),
        "response" | "responses" => "responses".to_string(),
        _ => return Err("AI provider API mode must be chatCompletions or responses".to_string()),
    };
    if settings.custom_instructions.chars().count() > 1000 {
        return Err(
            "AI Assistant custom instructions must be 1000 characters or fewer".to_string(),
        );
    }
    settings.extra_headers = settings.extra_headers.trim().to_string();
    settings.use_codex_cli = settings.provider_kind == "openai" && settings.use_codex_cli;
    settings.use_claude_cli = settings.provider_kind == "anthropic" && settings.use_claude_cli;
    settings.claude_cli_path = trim_optional(settings.claude_cli_path);
    settings.codex_cli_path = trim_optional(settings.codex_cli_path);
    settings.disabled_skill_names =
        crate::assistant_skills::normalize_skill_names(settings.disabled_skill_names);

    if !(settings.base_url.starts_with("https://") || settings.base_url.starts_with("http://")) {
        return Err("AI provider endpoint must start with https:// or http://".to_string());
    }

    if settings.base_url.chars().any(char::is_whitespace) {
        return Err("AI provider endpoint cannot contain whitespace".to_string());
    }

    if settings.base_url.contains('?') || settings.base_url.contains('#') {
        return Err(
            "AI provider endpoint must be a base URL without query or fragment".to_string(),
        );
    }

    if settings.model.chars().any(char::is_whitespace) {
        return Err("AI model cannot contain whitespace".to_string());
    }

    settings.search_provider = match settings
        .search_provider
        .trim()
        .to_lowercase()
        .replace(['-', '_', ' '], "")
        .as_str()
    {
        "" | "scraper" => "scraper".to_string(),
        "brave" => "brave".to_string(),
        "tavily" => "tavily".to_string(),
        "searxng" => "searxng".to_string(),
        _ => return Err("Search provider must be scraper, brave, tavily, or searxng".to_string()),
    };

    settings.searxng_url = settings.searxng_url.trim().to_string();
    if !settings.searxng_url.is_empty() {
        if !(settings.searxng_url.starts_with("https://")
            || settings.searxng_url.starts_with("http://"))
        {
            return Err("SearXNG instance URL must start with https:// or http://".to_string());
        }
        if settings.searxng_url.chars().any(char::is_whitespace) {
            return Err("SearXNG instance URL cannot contain whitespace".to_string());
        }
    }

    settings.email_provider = match settings
        .email_provider
        .trim()
        .to_lowercase()
        .replace(['-', '_', ' '], "")
        .as_str()
    {
        "" | "resend" => "resend".to_string(),
        "sendgrid" => "sendgrid".to_string(),
        "mailgun" => "mailgun".to_string(),
        "postmark" => "postmark".to_string(),
        "smtp" => "smtp".to_string(),
        _ => {
            return Err(
                "Email provider must be resend, sendgrid, mailgun, postmark, or smtp".to_string(),
            );
        }
    };
    settings.email_from = settings.email_from.trim().to_string();
    settings.mailgun_domain = settings.mailgun_domain.trim().to_string();
    settings.smtp_host = settings.smtp_host.trim().to_string();
    settings.smtp_username = settings.smtp_username.trim().to_string();
    settings.smtp_security = match settings
        .smtp_security
        .trim()
        .to_lowercase()
        .replace(['-', '_', ' '], "")
        .as_str()
    {
        "" | "starttls" => "starttls".to_string(),
        "none" | "plain" => "none".to_string(),
        _ => return Err("SMTP security must be starttls or none".to_string()),
    };

    if settings.tools.email && settings.email_from.is_empty() {
        return Err("Email sender address is required when Send Email is enabled".to_string());
    }
    if settings.tools.email
        && settings.email_provider == "mailgun"
        && settings.mailgun_domain.is_empty()
    {
        return Err("Mailgun domain is required when Send Email uses Mailgun".to_string());
    }
    if settings.tools.email && settings.email_provider == "smtp" {
        if settings.smtp_host.is_empty() {
            return Err("SMTP host is required when Send Email uses SMTP".to_string());
        }
        if settings.smtp_port == 0 {
            return Err("SMTP port must be between 1 and 65535".to_string());
        }
    }

    Ok(settings)
}

fn trim_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_socks_proxy_username(value: Option<String>) -> Result<Option<String>, String> {
    let Some(username) = trim_optional(value) else {
        return Ok(None);
    };
    if username.len() > 255 {
        return Err("SOCKS proxy username must be 255 bytes or fewer".to_string());
    }
    if username.contains(char::is_control) || username.contains(|ch| matches!(ch, ':' | '@')) {
        return Err("SOCKS proxy username contains invalid characters".to_string());
    }
    Ok(Some(username))
}

fn normalize_ssh_socks_proxy_username(
    value: Option<String>,
    connection_type: &str,
) -> Result<Option<String>, String> {
    if connection_type == "ssh" {
        normalize_socks_proxy_username(value)
    } else {
        Ok(None)
    }
}

fn unique_non_empty_strings(values: Vec<String>) -> Vec<String> {
    let mut unique_values = Vec::new();
    for value in values {
        let trimmed = value.trim().to_string();
        if !trimmed.is_empty() && !unique_values.contains(&trimmed) {
            unique_values.push(trimmed);
        }
    }
    unique_values
}

fn default_ssh_user() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "admin".to_string())
}

fn default_ssh_key_path() -> Option<String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    let path = PathBuf::from(home).join(".ssh").join("id_ed25519");
    Some(path.to_string_lossy().to_string())
}

fn make_connection_id(name: &str) -> String {
    make_unique_id("connection", name)
}

fn make_folder_id(name: &str) -> String {
    make_unique_id("folder", name)
}

fn make_workspace_id(name: &str) -> String {
    make_unique_id("workspace", name)
}

fn make_tmux_connection_id(connection_id: &str) -> String {
    make_unique_id("kkterm", connection_id)
}

/// Process-wide monotonic counter appended to generated ids. The millisecond
/// timestamp alone collides when two ids are generated within the same
/// millisecond (e.g. two inserts in a tight loop), which produced duplicate
/// primary keys; the counter makes ids unique regardless of insert speed.
fn next_id_sequence() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    COUNTER.fetch_add(1, Ordering::Relaxed)
}

fn make_connection_password_credential_id() -> String {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let sequence = next_id_sequence();
    format!("connection-password-credential-{unique}-{sequence}")
}

fn make_unique_id(fallback: &str, name: &str) -> String {
    let slug = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let sequence = next_id_sequence();
    format!(
        "{}-{unique}-{sequence}",
        if slug.is_empty() { fallback } else { &slug }
    )
}

fn optional_port(value: Option<i64>) -> rusqlite::Result<Option<u16>> {
    match value {
        Some(port) => u16::try_from(port)
            .map(Some)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error))),
        None => Ok(None),
    }
}

fn optional_serial_speed(value: Option<i64>) -> rusqlite::Result<Option<u32>> {
    match value {
        Some(speed) => u32::try_from(speed)
            .map(Some)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error))),
        None => Ok(None),
    }
}

fn assistant_chat_thread_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<AssistantChatThreadRecord> {
    Ok(AssistantChatThreadRecord {
        id: row.get(0)?,
        title: row.get(1)?,
        context_label: row.get(2)?,
        messages_json: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn assistant_memory_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AssistantMemoryRecord> {
    Ok(AssistantMemoryRecord {
        id: row.get(0)?,
        scope: row.get(1)?,
        content: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

/// Maximum stored length of one assistant memory note. Memories are meant to be
/// short operator facts, not transcripts; the assistant tool also caps input.
const ASSISTANT_MEMORY_MAX_CHARS: usize = 2_000;

fn validate_assistant_memory(
    record: AssistantMemoryRecord,
) -> Result<AssistantMemoryRecord, String> {
    let id = required_field("assistant memory id", record.id)?;
    let scope = required_field("assistant memory scope", record.scope)?;
    // Scope is an internal key: "global" or "connection:<id>". Reject anything
    // else so a memory can never be written to an unbounded namespace.
    let scope_ok = scope == "global"
        || scope
            .strip_prefix("connection:")
            .is_some_and(|id| !id.trim().is_empty());
    if !scope_ok {
        return Err("assistant memory scope must be 'global' or 'connection:<id>'".to_string());
    }
    let content = required_field("assistant memory content", record.content)?;
    if content.chars().count() > ASSISTANT_MEMORY_MAX_CHARS {
        return Err(format!(
            "assistant memory content exceeds {ASSISTANT_MEMORY_MAX_CHARS} characters"
        ));
    }
    let created_at = required_field("assistant memory created time", record.created_at)?;
    let updated_at = required_field("assistant memory updated time", record.updated_at)?;
    Ok(AssistantMemoryRecord {
        id,
        scope,
        content,
        created_at,
        updated_at,
    })
}

fn validate_assistant_chat_thread(
    request: AssistantChatThreadRecord,
) -> Result<AssistantChatThreadRecord, String> {
    let id = required_field("assistant chat thread id", request.id)?;
    let title = required_field("assistant chat title", request.title)?;
    let context_label = required_field("assistant chat context", request.context_label)?;
    let created_at = required_field("assistant chat created time", request.created_at)?;
    let updated_at = required_field("assistant chat updated time", request.updated_at)?;
    let messages_json = required_field("assistant chat messages", request.messages_json)?;
    let messages: serde_json::Value = serde_json::from_str(&messages_json)
        .map_err(|error| format!("assistant chat messages must be valid JSON: {error}"))?;
    if !messages.is_array() {
        return Err("assistant chat messages must be a JSON array".to_string());
    }

    Ok(AssistantChatThreadRecord {
        id,
        title,
        context_label,
        messages_json,
        created_at,
        updated_at,
    })
}

#[cfg(test)]
mod tests;
