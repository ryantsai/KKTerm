use crate::window_state::{validate_main_window_settings, MainWindowSettings};
use rusqlite::{params, Connection as SqliteConnection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    fs::{File, OpenOptions},
    io::{copy, Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime},
};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const SCHEMA_USER_VERSION: i32 = 16;

const CURRENT_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS connection_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_folder_id TEXT REFERENCES connection_folders(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS connections (
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
    icon_data_url TEXT,
    icon_background_color TEXT,
    connection_type TEXT NOT NULL CHECK (connection_type IN ('local', 'ssh', 'telnet', 'serial', 'url', 'rdp', 'vnc', 'ftp')),
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
    connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    page_url TEXT,
    username_selector TEXT,
    password_selector TEXT,
    field_values TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_connections_folder_sort
    ON connections(folder_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_connection_folders_parent_sort
    ON connection_folders(parent_folder_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_connection_tags_connection_sort
    ON connection_tags(connection_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_url_credentials_connection
    ON url_credentials(connection_id);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wiki_pages (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES wiki_pages(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    body_md TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_parent_sort
    ON wiki_pages(parent_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_slug
    ON wiki_pages(slug);

CREATE TABLE IF NOT EXISTS wiki_page_links (
    page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    target_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    PRIMARY KEY (page_id, target_page_id)
);

CREATE INDEX IF NOT EXISTS idx_wiki_page_links_target
    ON wiki_page_links(target_page_id);

CREATE TABLE IF NOT EXISTS wiki_page_connections (
    page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    PRIMARY KEY (page_id, connection_id)
);

CREATE INDEX IF NOT EXISTS idx_wiki_page_connections_connection
    ON wiki_page_connections(connection_id);

CREATE VIRTUAL TABLE IF NOT EXISTS wiki_pages_fts USING fts5(
    title,
    body_md,
    content='wiki_pages',
    content_rowid='rowid',
    tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS wiki_pages_ai AFTER INSERT ON wiki_pages BEGIN
    INSERT INTO wiki_pages_fts(rowid, title, body_md) VALUES (new.rowid, new.title, new.body_md);
END;

CREATE TRIGGER IF NOT EXISTS wiki_pages_ad AFTER DELETE ON wiki_pages BEGIN
    INSERT INTO wiki_pages_fts(wiki_pages_fts, rowid, title, body_md) VALUES('delete', old.rowid, old.title, old.body_md);
END;

CREATE TRIGGER IF NOT EXISTS wiki_pages_au AFTER UPDATE ON wiki_pages BEGIN
    INSERT INTO wiki_pages_fts(wiki_pages_fts, rowid, title, body_md) VALUES('delete', old.rowid, old.title, old.body_md);
    INSERT INTO wiki_pages_fts(rowid, title, body_md) VALUES (new.rowid, new.title, new.body_md);
END;

CREATE TABLE IF NOT EXISTS wiki_attachments (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    mime TEXT,
    bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wiki_attachments_page
    ON wiki_attachments(page_id);

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
    created_by TEXT NOT NULL CHECK (created_by IN ('user', 'agent')),
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
    #[serde(default)]
    last_backup_at: Option<String>,
}

impl GeneralSettings {
    pub(crate) fn allow_clipboard_read(&self) -> bool {
        self.allow_clipboard_read
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
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseBackupInfo {
    path: String,
    filename: String,
    created_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedDatabaseSnapshot {
    general_settings: GeneralSettings,
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
    copy_on_select: bool,
    #[serde(default = "default_allow_osc52_clipboard")]
    allow_osc52_clipboard: bool,
    confirm_multiline_paste: bool,
    default_shell: String,
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
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSettings {
    default_user: String,
    default_port: u16,
    default_key_path: Option<String>,
    default_proxy_jump: Option<String>,
    #[serde(default = "default_ssh_buffer_lines")]
    buffer_lines: u32,
    #[serde(default = "default_hide_common_port_redirects")]
    hide_common_port_redirects: bool,
    #[serde(default = "default_allow_osc52_clipboard")]
    allow_osc52_clipboard: bool,
}

impl SshSettings {
    pub(crate) fn hide_common_port_redirects(&self) -> bool {
        self.hide_common_port_redirects
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpSettings {
    overwrite_behavior: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlSettings {
    #[serde(default)]
    ignore_certificate_errors: bool,
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
    show_all_models: bool,
    #[serde(default = "default_ai_cli_execution_policy")]
    cli_execution_policy: String,
    #[serde(default = "default_ai_tool_permission_mode")]
    tool_permission_mode: String,
    #[serde(default)]
    claude_cli_path: Option<String>,
    #[serde(default)]
    codex_cli_path: Option<String>,
    #[serde(default)]
    disabled_skill_names: Vec<String>,
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

    pub(crate) fn claude_cli_path(&self) -> Option<&str> {
        self.claude_cli_path.as_deref()
    }

    pub(crate) fn codex_cli_path(&self) -> Option<&str> {
        self.codex_cli_path.as_deref()
    }

    pub(crate) fn disabled_skill_names(&self) -> &[String] {
        &self.disabled_skill_names
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
pub struct ConnectionFolder {
    id: String,
    name: String,
    connections: Vec<SavedConnection>,
    folders: Vec<ConnectionFolder>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnection {
    id: String,
    name: String,
    host: String,
    user: String,
    port: Option<u16>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    auth_method: String,
    local_shell: Option<String>,
    local_startup_directory: Option<String>,
    local_startup_script: Option<String>,
    url: Option<String>,
    data_partition: Option<String>,
    use_tmux_sessions: bool,
    tmux_connection_id: Option<String>,
    serial_line: Option<String>,
    serial_speed: Option<u32>,
    url_credential_username: Option<String>,
    has_url_credential: bool,
    rdp_options: Option<RdpConnectionOptions>,
    vnc_options: Option<VncConnectionOptions>,
    #[serde(default)]
    ftp_options: Option<crate::ftp::FtpOptions>,
    icon_data_url: Option<String>,
    icon_background_color: Option<String>,
    #[serde(rename = "type")]
    connection_type: String,
    tags: Vec<String>,
    status: String,
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
    port: Option<u16>,
    key_path: Option<String>,
    proxy_jump: Option<String>,
    auth_method: Option<String>,
    local_shell: Option<String>,
    #[serde(default)]
    local_startup_directory: Option<String>,
    #[serde(default)]
    local_startup_script: Option<String>,
    url: Option<String>,
    data_partition: Option<String>,
    use_tmux_sessions: Option<bool>,
    serial_line: Option<String>,
    serial_speed: Option<u32>,
    rdp_options: Option<RdpConnectionOptions>,
    vnc_options: Option<VncConnectionOptions>,
    #[serde(default)]
    ftp_options: Option<crate::ftp::FtpOptions>,
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
    auth_method: Option<String>,
    local_shell: Option<String>,
    #[serde(default)]
    local_startup_directory: Option<String>,
    #[serde(default)]
    local_startup_script: Option<String>,
    url: Option<String>,
    data_partition: Option<String>,
    use_tmux_sessions: Option<bool>,
    serial_line: Option<String>,
    serial_speed: Option<u32>,
    rdp_options: Option<RdpConnectionOptions>,
    vnc_options: Option<VncConnectionOptions>,
    #[serde(default)]
    ftp_options: Option<crate::ftp::FtpOptions>,
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
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConnectionFolderRequest {
    name: String,
    parent_folder_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameConnectionFolderRequest {
    id: String,
    name: String,
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
    pub(crate) username: Option<String>,
    pub(crate) updated_at: Option<String>,
    pub(crate) metadata_source: String,
}

pub(crate) const LEGACY_AI_PROVIDER_SECRET_OWNER_ID: &str = "openai-compatible-provider";
pub(crate) const EMAIL_API_SECRET_OWNER_ID: &str = "email-tool-api-key";
pub(crate) const EMAIL_SMTP_SECRET_OWNER_ID: &str = "email-tool-smtp-password";

const AI_PROVIDER_CREDENTIALS: &[(&str, &str, &str)] = &[
    ("openai", "OpenAI", "OpenAI API key"),
    ("anthropic", "Anthropic", "Anthropic API key"),
    ("openrouter", "OpenRouter", "OpenRouter API key"),
    ("deepseek", "DeepSeek", "DeepSeek API key"),
    ("grok", "xAI Grok", "xAI API key"),
    ("azure-openai", "Azure OpenAI", "Azure OpenAI API key"),
    ("litellm", "LiteLLM", "LiteLLM key"),
    ("github-copilot", "GitHub Copilot", "GitHub OAuth token"),
    ("ollama", "Ollama", "Ollama API key"),
    ("nvidia", "NVIDIA", "NVIDIA API key"),
    ("openai-compatible", "OpenAI-compatible", "API key"),
];

pub(crate) fn ai_provider_secret_owner_id(provider_kind: &str) -> String {
    format!("ai-provider:{}", provider_kind.trim().to_lowercase())
}

#[derive(Clone)]
pub(crate) struct UrlCredentialFill {
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

    pub fn list_connection_tree(&self) -> Result<ConnectionTree, String> {
        let connection = self.lock()?;
        Ok(ConnectionTree {
            connections: list_connections_for_folder(&connection, None)?,
            folders: list_folders_for_parent(&connection, None)?,
        })
    }

    pub fn general_settings(&self) -> Result<GeneralSettings, String> {
        let connection = self.lock()?;
        let value = connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'general'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(to_storage_error)?;

        match value {
            Some(value) => serde_json::from_str(&value)
                .map(validate_general_settings)
                .map_err(|error| format!("general settings are invalid: {error}"))?,
            None => Ok(default_general_settings()),
        }
    }

    pub fn update_general_settings(
        &self,
        request: GeneralSettings,
    ) -> Result<GeneralSettings, String> {
        let settings = validate_general_settings(request)?;
        let value = serde_json::to_string(&settings)
            .map_err(|error| format!("failed to serialize general settings: {error}"))?;
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO settings (key, value, updated_at)
                 VALUES ('general', ?1, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP",
                params![value],
            )
            .map_err(to_storage_error)?;
        Ok(settings)
    }

    pub fn update_dont_sleep_enabled(&self, enabled: bool) -> Result<GeneralSettings, String> {
        let mut settings = self.general_settings()?;
        settings.dont_sleep_enabled = enabled;
        self.update_general_settings(settings)
    }

    pub fn app_launcher_settings(&self) -> Result<AppLauncherSettings, String> {
        let connection = self.lock()?;
        let value = connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'app_launcher'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(to_storage_error)?;

        match value {
            Some(value) => serde_json::from_str(&value)
                .map(validate_app_launcher_settings)
                .map_err(|error| format!("App Launcher settings are invalid: {error}"))?,
            None => Ok(default_app_launcher_settings()),
        }
    }

    pub fn update_app_launcher_settings(
        &self,
        request: AppLauncherSettings,
    ) -> Result<AppLauncherSettings, String> {
        let settings = validate_app_launcher_settings(request)?;
        let value = serde_json::to_string(&settings)
            .map_err(|error| format!("failed to serialize App Launcher settings: {error}"))?;
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO settings (key, value, updated_at)
                 VALUES ('app_launcher', ?1, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP",
                params![value],
            )
            .map_err(to_storage_error)?;
        Ok(settings)
    }

    pub fn dashboard_settings(&self) -> Result<DashboardSettings, String> {
        let connection = self.lock()?;
        let value = connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'dashboard'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(to_storage_error)?;

        match value {
            Some(value) => serde_json::from_str(&value)
                .map(validate_dashboard_settings)
                .map_err(|error| format!("Dashboard settings are invalid: {error}"))?,
            None => Ok(default_dashboard_settings()),
        }
    }

    pub fn update_dashboard_settings(
        &self,
        request: DashboardSettings,
    ) -> Result<DashboardSettings, String> {
        let settings = validate_dashboard_settings(request)?;
        let value = serde_json::to_string(&settings)
            .map_err(|error| format!("failed to serialize Dashboard settings: {error}"))?;
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO settings (key, value, updated_at)
                 VALUES ('dashboard', ?1, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP",
                params![value],
            )
            .map_err(to_storage_error)?;
        Ok(settings)
    }

    fn record_last_backup_at(&self, created_at: &str) -> Result<GeneralSettings, String> {
        let mut settings = self.general_settings()?;
        settings.last_backup_at = Some(created_at.to_string());
        self.update_general_settings(settings)
    }

    pub fn terminal_settings(&self) -> Result<TerminalSettings, String> {
        let connection = self.lock()?;
        let value = connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'terminal'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(to_storage_error)?;

        match value {
            Some(value) => serde_json::from_str(&value)
                .map(validate_terminal_settings)
                .map_err(|error| format!("terminal settings are invalid: {error}"))?,
            None => Ok(default_terminal_settings()),
        }
    }

    pub fn update_terminal_settings(
        &self,
        request: TerminalSettings,
    ) -> Result<TerminalSettings, String> {
        let settings = validate_terminal_settings(request)?;
        let value = serde_json::to_string(&settings)
            .map_err(|error| format!("failed to serialize terminal settings: {error}"))?;
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO settings (key, value, updated_at)
                 VALUES ('terminal', ?1, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP",
                params![value],
            )
            .map_err(to_storage_error)?;
        Ok(settings)
    }

    pub fn appearance_settings(&self) -> Result<AppearanceSettings, String> {
        let connection = self.lock()?;
        let value = connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'appearance'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(to_storage_error)?;

        match value {
            Some(value) => serde_json::from_str(&value)
                .map(validate_appearance_settings)
                .map_err(|error| format!("appearance settings are invalid: {error}"))?,
            None => Ok(default_appearance_settings()),
        }
    }

    pub fn update_appearance_settings(
        &self,
        request: AppearanceSettings,
    ) -> Result<AppearanceSettings, String> {
        let settings = validate_appearance_settings(request)?;
        let value = serde_json::to_string(&settings)
            .map_err(|error| format!("failed to serialize appearance settings: {error}"))?;
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO settings (key, value, updated_at)
                 VALUES ('appearance', ?1, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP",
                params![value],
            )
            .map_err(to_storage_error)?;
        Ok(settings)
    }

    pub fn ssh_settings(&self) -> Result<SshSettings, String> {
        let connection = self.lock()?;
        let value = connection
            .query_row("SELECT value FROM settings WHERE key = 'ssh'", [], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .map_err(to_storage_error)?;

        match value {
            Some(value) => serde_json::from_str(&value)
                .map(validate_ssh_settings)
                .map_err(|error| format!("SSH settings are invalid: {error}"))?,
            None => Ok(default_ssh_settings()),
        }
    }

    pub fn update_ssh_settings(&self, request: SshSettings) -> Result<SshSettings, String> {
        let settings = validate_ssh_settings(request)?;
        let value = serde_json::to_string(&settings)
            .map_err(|error| format!("failed to serialize SSH settings: {error}"))?;
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO settings (key, value, updated_at)
                 VALUES ('ssh', ?1, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP",
                params![value],
            )
            .map_err(to_storage_error)?;
        Ok(settings)
    }

    pub fn sftp_settings(&self) -> Result<SftpSettings, String> {
        let connection = self.lock()?;
        let value = connection
            .query_row("SELECT value FROM settings WHERE key = 'sftp'", [], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .map_err(to_storage_error)?;

        match value {
            Some(value) => serde_json::from_str(&value)
                .map(validate_sftp_settings)
                .map_err(|error| format!("SFTP settings are invalid: {error}"))?,
            None => Ok(default_sftp_settings()),
        }
    }

    pub fn update_sftp_settings(&self, request: SftpSettings) -> Result<SftpSettings, String> {
        let settings = validate_sftp_settings(request)?;
        let value = serde_json::to_string(&settings)
            .map_err(|error| format!("failed to serialize SFTP settings: {error}"))?;
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO settings (key, value, updated_at)
                 VALUES ('sftp', ?1, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP",
                params![value],
            )
            .map_err(to_storage_error)?;
        Ok(settings)
    }

    pub fn url_settings(&self) -> Result<UrlSettings, String> {
        let connection = self.lock()?;
        let value = connection
            .query_row("SELECT value FROM settings WHERE key = 'url'", [], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .map_err(to_storage_error)?;

        match value {
            Some(value) => serde_json::from_str(&value)
                .map(validate_url_settings)
                .map_err(|error| format!("URL settings are invalid: {error}"))?,
            None => Ok(default_url_settings()),
        }
    }

    pub fn update_url_settings(&self, request: UrlSettings) -> Result<UrlSettings, String> {
        let settings = validate_url_settings(request)?;
        let value = serde_json::to_string(&settings)
            .map_err(|error| format!("failed to serialize URL settings: {error}"))?;
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO settings (key, value, updated_at)
                 VALUES ('url', ?1, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP",
                params![value],
            )
            .map_err(to_storage_error)?;
        Ok(settings)
    }

    pub fn rdp_settings(&self) -> Result<RdpSettings, String> {
        let connection = self.lock()?;
        let value = connection
            .query_row("SELECT value FROM settings WHERE key = 'rdp'", [], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .map_err(to_storage_error)?;

        match value {
            Some(value) => serde_json::from_str(&value)
                .map(validate_rdp_settings)
                .map_err(|error| format!("RDP settings are invalid: {error}"))?,
            None => Ok(default_rdp_settings()),
        }
    }

    pub fn update_rdp_settings(&self, request: RdpSettings) -> Result<RdpSettings, String> {
        let settings = validate_rdp_settings(request)?;
        let value = serde_json::to_string(&settings)
            .map_err(|error| format!("failed to serialize RDP settings: {error}"))?;
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO settings (key, value, updated_at)
                 VALUES ('rdp', ?1, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP",
                params![value],
            )
            .map_err(to_storage_error)?;
        Ok(settings)
    }

    pub fn vnc_settings(&self) -> Result<VncSettings, String> {
        let connection = self.lock()?;
        let value = connection
            .query_row("SELECT value FROM settings WHERE key = 'vnc'", [], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .map_err(to_storage_error)?;

        match value {
            Some(value) => serde_json::from_str(&value)
                .map(validate_vnc_settings)
                .map_err(|error| format!("VNC settings are invalid: {error}"))?,
            None => Ok(default_vnc_settings()),
        }
    }

    pub fn update_vnc_settings(&self, request: VncSettings) -> Result<VncSettings, String> {
        let settings = validate_vnc_settings(request)?;
        let value = serde_json::to_string(&settings)
            .map_err(|error| format!("failed to serialize VNC settings: {error}"))?;
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO settings (key, value, updated_at)
                 VALUES ('vnc', ?1, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP",
                params![value],
            )
            .map_err(to_storage_error)?;
        Ok(settings)
    }

    pub fn screenshot_settings(&self) -> Result<ScreenshotSettings, String> {
        let connection = self.lock()?;
        let value = connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'screenshots'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(to_storage_error)?;

        match value {
            Some(value) => serde_json::from_str(&value)
                .map(validate_screenshot_settings)
                .map_err(|error| format!("Screenshot settings are invalid: {error}"))?,
            None => Ok(default_screenshot_settings()),
        }
    }

    pub fn update_screenshot_settings(
        &self,
        request: ScreenshotSettings,
    ) -> Result<ScreenshotSettings, String> {
        let settings = validate_screenshot_settings(request)?;
        let value = serde_json::to_string(&settings)
            .map_err(|error| format!("failed to serialize Screenshot settings: {error}"))?;
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO settings (key, value, updated_at)
                 VALUES ('screenshots', ?1, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP",
                params![value],
            )
            .map_err(to_storage_error)?;
        Ok(settings)
    }

    pub fn ai_provider_settings(&self) -> Result<AiProviderSettings, String> {
        let connection = self.lock()?;
        let value = connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'ai_provider'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(to_storage_error)?;

        match value {
            Some(value) => serde_json::from_str(&value)
                .map(validate_ai_provider_settings)
                .map_err(|error| format!("AI provider settings are invalid: {error}"))?,
            None => Ok(default_ai_provider_settings()),
        }
    }

    pub fn update_ai_provider_settings(
        &self,
        request: AiProviderSettings,
    ) -> Result<AiProviderSettings, String> {
        let settings = validate_ai_provider_settings(request)?;
        let value = serde_json::to_string(&settings)
            .map_err(|error| format!("failed to serialize AI provider settings: {error}"))?;
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO settings (key, value, updated_at)
                 VALUES ('ai_provider', ?1, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP",
                params![value],
            )
            .map_err(to_storage_error)?;
        Ok(settings)
    }

    pub(crate) fn main_window_settings(&self) -> Result<Option<MainWindowSettings>, String> {
        let connection = self.lock()?;
        let value = connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'main_window'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("failed to load main window settings: {error}"))?;

        value
            .map(|value| {
                serde_json::from_str::<MainWindowSettings>(&value)
                    .map_err(|error| format!("main window settings are invalid JSON: {error}"))
                    .and_then(validate_main_window_settings)
            })
            .transpose()
    }

    pub(crate) fn update_main_window_settings(
        &self,
        request: MainWindowSettings,
    ) -> Result<MainWindowSettings, String> {
        let settings = validate_main_window_settings(request)?;
        let value = serde_json::to_string(&settings)
            .map_err(|error| format!("failed to serialize main window settings: {error}"))?;
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO settings (key, value, updated_at)
                 VALUES ('main_window', ?1, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP",
                params![value],
            )
            .map_err(|error| format!("failed to update main window settings: {error}"))?;

        Ok(settings)
    }

    fn initialize_schema(&self) -> Result<(), String> {
        let connection = self.lock()?;
        let stored_version: i32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(to_storage_error)?;
        if stored_version < SCHEMA_USER_VERSION {
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
        ensure_column(&connection, "connections", "rdp_options", "TEXT")?;
        ensure_column(&connection, "connections", "vnc_options", "TEXT")?;
        ensure_column(&connection, "connections", "ftp_options", "TEXT")?;
        ensure_column(&connection, "connections", "icon_data_url", "TEXT")?;
        ensure_column(&connection, "connections", "icon_background_color", "TEXT")?;
        ensure_column(
            &connection,
            "connections",
            "local_startup_directory",
            "TEXT",
        )?;
        ensure_column(&connection, "connections", "local_startup_script", "TEXT")?;
        ensure_column(&connection, "url_credentials", "field_values", "TEXT")?;
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
        connection
            .execute_batch(&format!("PRAGMA user_version = {SCHEMA_USER_VERSION}"))
            .map_err(to_storage_error)?;
        crate::dashboard_storage::seed_default(&connection)
            .map_err(|err| format!("dashboard seed failed: {err:?}"))?;
        Ok(())
    }

    pub fn create_connection(
        &self,
        request: CreateConnectionRequest,
    ) -> Result<SavedConnection, String> {
        let connection_type = normalize_connection_type(&request.connection_type)?;
        let name = required_field("name", request.name)?;
        let url = normalize_url_field(request.url, &connection_type)?;
        let serial_line = normalize_serial_line(request.serial_line, &connection_type)?;
        let serial_speed = normalize_serial_speed(request.serial_speed, &connection_type)?;
        let port = normalize_connection_port(request.port, &connection_type);
        let host = if connection_type == "url" {
            url.as_deref()
                .and_then(|value| extract_url_host(value))
                .unwrap_or_default()
        } else if connection_type == "serial" {
            serial_line.clone().unwrap_or_else(|| "COM1".to_string())
        } else {
            required_field("host", request.host)?
        };
        let user = normalize_connection_user(request.user, &connection_type)?;
        let folder_id = normalize_optional_id(request.folder_id);
        let key_path = normalize_ssh_optional_field(request.key_path, &connection_type);
        let proxy_jump = normalize_ssh_optional_field(request.proxy_jump, &connection_type);
        let auth_method = normalize_auth_method(request.auth_method, &connection_type, &key_path)?;
        let local_shell = normalize_local_shell(request.local_shell, &connection_type)?;
        let local_startup_directory =
            normalize_local_startup_directory(request.local_startup_directory, &connection_type)?;
        let local_startup_script =
            normalize_local_startup_script(request.local_startup_script, &connection_type)?;
        let data_partition = normalize_data_partition(request.data_partition, &connection_type)?;
        let rdp_options = normalize_rdp_connection_options(request.rdp_options, &connection_type)?;
        let vnc_options = normalize_vnc_connection_options(request.vnc_options, &connection_type)?;
        let ftp_options = normalize_ftp_connection_options(request.ftp_options, &connection_type)?;
        let rdp_options_json = serialize_connection_options(&rdp_options, "RDP")?;
        let vnc_options_json = serialize_connection_options(&vnc_options, "VNC")?;
        let ftp_options_json = serialize_connection_options(&ftp_options, "FTP")?;
        let id = make_connection_id(&name);
        let use_tmux_sessions =
            normalize_use_tmux_sessions(request.use_tmux_sessions, &connection_type);
        let tmux_connection_id = if use_tmux_sessions {
            Some(make_tmux_connection_id(&id))
        } else {
            None
        };
        let tags = Vec::new();

        let mut connection = self.lock()?;
        let transaction = connection.transaction().map_err(to_storage_error)?;
        if let Some(folder_id) = folder_id.as_deref() {
            ensure_folder_exists(&transaction, folder_id, folder_name_for(folder_id))?;
        }
        let next_sort_order = next_connection_sort_order(&transaction, folder_id.as_deref())?;

        transaction
            .execute(
                "INSERT INTO connections (
                    id, folder_id, name, host, username, port, key_path, proxy_jump, auth_method, local_shell, local_startup_directory, local_startup_script, url, data_partition, use_tmux_sessions, tmux_connection_id, serial_line, serial_speed, rdp_options, vnc_options, ftp_options, connection_type, status, sort_order
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, 'idle', ?23)",
                params![
                    id,
                    folder_id,
                    name,
                    host,
                    user,
                    port,
                    key_path,
                    proxy_jump,
                    auth_method,
                    local_shell,
                    local_startup_directory,
                    local_startup_script,
                    url,
                    data_partition,
                    use_tmux_sessions,
                    tmux_connection_id,
                    serial_line,
                    serial_speed,
                    rdp_options_json,
                    vnc_options_json,
                    ftp_options_json,
                    connection_type,
                    next_sort_order
                ],
            )
            .map_err(to_storage_error)?;

        for (index, tag) in tags.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO connection_tags (connection_id, tag, sort_order)
                     VALUES (?1, ?2, ?3)",
                    params![id, tag, index as i64],
                )
                .map_err(to_storage_error)?;
        }

        transaction.commit().map_err(to_storage_error)?;

        Ok(SavedConnection {
            id,
            name,
            host,
            user,
            port,
            key_path,
            proxy_jump,
            auth_method,
            local_shell,
            local_startup_directory,
            local_startup_script,
            url,
            data_partition,
            use_tmux_sessions,
            tmux_connection_id,
            serial_line,
            serial_speed,
            url_credential_username: None,
            has_url_credential: false,
            rdp_options,
            vnc_options,
            ftp_options,
            icon_data_url: None,
            icon_background_color: None,
            connection_type,
            tags,
            status: "idle".to_string(),
        })
    }

    pub fn update_connection(
        &self,
        request: UpdateConnectionRequest,
    ) -> Result<SavedConnection, String> {
        let id = required_field("connection id", request.id)?;
        let connection_type = normalize_connection_type(&request.connection_type)?;
        let name = required_field("name", request.name)?;
        let url = normalize_url_field(request.url, &connection_type)?;
        let serial_line = normalize_serial_line(request.serial_line, &connection_type)?;
        let serial_speed = normalize_serial_speed(request.serial_speed, &connection_type)?;
        let port = normalize_connection_port(request.port, &connection_type);
        let host = if connection_type == "url" {
            url.as_deref()
                .and_then(|value| extract_url_host(value))
                .unwrap_or_default()
        } else if connection_type == "serial" {
            serial_line.clone().unwrap_or_else(|| "COM1".to_string())
        } else {
            required_field("host", request.host)?
        };
        let user = normalize_connection_user(request.user, &connection_type)?;
        let target_folder_id = normalize_optional_id(request.folder_id);
        let key_path = normalize_ssh_optional_field(request.key_path, &connection_type);
        let proxy_jump = normalize_ssh_optional_field(request.proxy_jump, &connection_type);
        let auth_method = normalize_auth_method(request.auth_method, &connection_type, &key_path)?;
        let local_shell = normalize_local_shell(request.local_shell, &connection_type)?;
        let local_startup_directory =
            normalize_local_startup_directory(request.local_startup_directory, &connection_type)?;
        let local_startup_script =
            normalize_local_startup_script(request.local_startup_script, &connection_type)?;
        let data_partition = normalize_data_partition(request.data_partition, &connection_type)?;
        let rdp_options = normalize_rdp_connection_options(request.rdp_options, &connection_type)?;
        let vnc_options = normalize_vnc_connection_options(request.vnc_options, &connection_type)?;
        let ftp_options = normalize_ftp_connection_options(request.ftp_options, &connection_type)?;
        let rdp_options_json = serialize_connection_options(&rdp_options, "RDP")?;
        let vnc_options_json = serialize_connection_options(&vnc_options, "VNC")?;
        let ftp_options_json = serialize_connection_options(&ftp_options, "FTP")?;
        let use_tmux_sessions =
            normalize_use_tmux_sessions(request.use_tmux_sessions, &connection_type);

        let mut connection = self.lock()?;
        let transaction = connection.transaction().map_err(to_storage_error)?;
        let existing = transaction
            .query_row(
                "SELECT folder_id, connection_type, tmux_connection_id FROM connections WHERE id = ?1",
                params![&id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(to_storage_error)?
            .ok_or_else(|| "connection was not found".to_string())?;

        let (source_folder_id, existing_connection_type, existing_tmux_connection_id) = existing;
        if existing_connection_type != connection_type {
            return Err("connection type cannot be changed".to_string());
        }
        if let Some(folder_id) = target_folder_id.as_deref() {
            ensure_folder_exists(&transaction, folder_id, folder_name_for(folder_id))?;
        }

        let tmux_connection_id = if use_tmux_sessions && connection_type == "ssh" {
            Some(existing_tmux_connection_id.unwrap_or_else(|| make_tmux_connection_id(&id)))
        } else {
            None
        };
        let sort_order = if source_folder_id == target_folder_id {
            transaction
                .query_row(
                    "SELECT sort_order FROM connections WHERE id = ?1",
                    params![&id],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(to_storage_error)?
        } else {
            next_connection_sort_order(&transaction, target_folder_id.as_deref())?
        };

        transaction
            .execute(
                "UPDATE connections
                 SET folder_id = ?1,
                     name = ?2,
                     host = ?3,
                     username = ?4,
                     port = ?5,
                     key_path = ?6,
                     proxy_jump = ?7,
                     auth_method = ?8,
                     local_shell = ?9,
                     local_startup_directory = ?10,
                     local_startup_script = ?11,
                     url = ?12,
                     data_partition = ?13,
                     use_tmux_sessions = ?14,
                     tmux_connection_id = ?15,
                     serial_line = ?16,
                     serial_speed = ?17,
                     rdp_options = ?18,
                     vnc_options = ?19,
                     ftp_options = ?20,
                     sort_order = ?21
                 WHERE id = ?22",
                params![
                    target_folder_id,
                    name,
                    host,
                    user,
                    port,
                    key_path,
                    proxy_jump,
                    auth_method,
                    local_shell,
                    local_startup_directory,
                    local_startup_script,
                    url,
                    data_partition,
                    use_tmux_sessions,
                    tmux_connection_id,
                    serial_line,
                    serial_speed,
                    rdp_options_json,
                    vnc_options_json,
                    ftp_options_json,
                    sort_order,
                    &id
                ],
            )
            .map_err(to_storage_error)?;

        if source_folder_id != target_folder_id {
            reorder_connection_ids(&transaction, source_folder_id.as_deref(), None)?;
            reorder_connection_ids(&transaction, target_folder_id.as_deref(), None)?;
        }

        transaction.commit().map_err(to_storage_error)?;
        get_connection_by_id(&connection, &id)
    }

    pub fn update_url_connection_icon_data_url(
        &self,
        connection_id: String,
        icon_data_url: Option<String>,
    ) -> Result<Option<SavedConnection>, String> {
        let connection_id = required_field("connection id", connection_id)?;
        let icon_data_url = normalize_connection_icon_data_url(icon_data_url)?;
        let connection = self.lock()?;
        let existing = connection
            .query_row(
                "SELECT connection_type, icon_data_url FROM connections WHERE id = ?1",
                params![&connection_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()
            .map_err(to_storage_error)?
            .ok_or_else(|| "connection was not found".to_string())?;
        let (connection_type, current_icon_data_url) = existing;
        if connection_type != "url" {
            return Err("connection icon updates only apply to URL connections".to_string());
        }
        if current_icon_data_url == icon_data_url {
            return Ok(None);
        }
        connection
            .execute(
                "UPDATE connections SET icon_data_url = ?1 WHERE id = ?2",
                params![icon_data_url, &connection_id],
            )
            .map_err(to_storage_error)?;
        get_connection_by_id(&connection, &connection_id).map(Some)
    }

    pub fn update_connection_icon_data_url(
        &self,
        connection_id: String,
        icon_data_url: Option<String>,
    ) -> Result<Option<SavedConnection>, String> {
        let connection_id = required_field("connection id", connection_id)?;
        let icon_data_url = normalize_connection_icon_data_url(icon_data_url)?;
        let connection = self.lock()?;
        let current_icon_data_url = connection
            .query_row(
                "SELECT icon_data_url FROM connections WHERE id = ?1",
                params![&connection_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(to_storage_error)?
            .ok_or_else(|| "connection was not found".to_string())?;
        if current_icon_data_url == icon_data_url {
            return Ok(None);
        }
        connection
            .execute(
                "UPDATE connections SET icon_data_url = ?1 WHERE id = ?2",
                params![icon_data_url, &connection_id],
            )
            .map_err(to_storage_error)?;
        get_connection_by_id(&connection, &connection_id).map(Some)
    }

    pub fn update_connection_icon_background_color(
        &self,
        connection_id: String,
        icon_background_color: Option<String>,
    ) -> Result<Option<SavedConnection>, String> {
        let connection_id = required_field("connection id", connection_id)?;
        let icon_background_color =
            normalize_connection_icon_background_color(icon_background_color)?;
        let connection = self.lock()?;
        let current_icon_background_color = connection
            .query_row(
                "SELECT icon_background_color FROM connections WHERE id = ?1",
                params![&connection_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(to_storage_error)?
            .ok_or_else(|| "connection was not found".to_string())?;
        if current_icon_background_color == icon_background_color {
            return Ok(None);
        }
        connection
            .execute(
                "UPDATE connections SET icon_background_color = ?1 WHERE id = ?2",
                params![icon_background_color, &connection_id],
            )
            .map_err(to_storage_error)?;
        get_connection_by_id(&connection, &connection_id).map(Some)
    }

    pub fn upsert_url_credential(
        &self,
        request: UpsertUrlCredentialRequest,
    ) -> Result<SavedConnection, String> {
        let connection_id = required_field("connection id", request.connection_id)?;
        let username = required_field("URL credential username", request.username)?;
        let page_url = normalize_optional_text(request.page_url);
        let username_selector = normalize_optional_text(request.username_selector);
        let password_selector = normalize_optional_text(request.password_selector);
        let field_values = normalize_optional_text(request.field_values);
        let connection = self.lock()?;
        let connection_type = connection
            .query_row(
                "SELECT connection_type FROM connections WHERE id = ?1",
                params![&connection_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(to_storage_error)?
            .ok_or_else(|| "connection was not found".to_string())?;
        if connection_type != "url" {
            return Err("URL credentials can only be stored for URL connections".to_string());
        }

        connection
            .execute(
                "INSERT INTO url_credentials (connection_id, username, page_url, username_selector, password_selector, field_values, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP)
                 ON CONFLICT(connection_id) DO UPDATE SET
                    username = excluded.username,
                    page_url = excluded.page_url,
                    username_selector = excluded.username_selector,
                    password_selector = excluded.password_selector,
                    field_values = excluded.field_values,
                    updated_at = CURRENT_TIMESTAMP",
                params![&connection_id, &username, page_url, username_selector, password_selector, field_values],
            )
            .map_err(to_storage_error)?;

        get_connection_by_id(&connection, &connection_id)
    }

    pub(crate) fn url_credential_fill(
        &self,
        connection_id: &str,
    ) -> Result<Option<UrlCredentialFill>, String> {
        let connection = self.lock()?;
        connection
            .query_row(
                "SELECT username, username_selector, password_selector, field_values FROM url_credentials WHERE connection_id = ?1",
                params![connection_id],
                |row| {
                    Ok(UrlCredentialFill {
                        username: row.get(0)?,
                        username_selector: row.get(1)?,
                        password_selector: row.get(2)?,
                        field_values: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(to_storage_error)
    }

    pub fn list_url_credentials(&self) -> Result<Vec<UrlCredentialSummary>, String> {
        let connection = self.lock()?;
        let mut statement = connection
            .prepare(
                "SELECT connections.id, connections.name, connections.url, url_credentials.page_url, url_credentials.username,
                        url_credentials.username_selector, url_credentials.password_selector, url_credentials.field_values, url_credentials.updated_at
                 FROM url_credentials
                 INNER JOIN connections ON connections.id = url_credentials.connection_id
                 ORDER BY lower(connections.name), lower(url_credentials.username)",
            )
            .map_err(to_storage_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok(UrlCredentialSummary {
                    connection_id: row.get(0)?,
                    connection_name: row.get(1)?,
                    url: row.get(2)?,
                    page_url: row.get(3)?,
                    username: row.get(4)?,
                    username_selector: row.get(5)?,
                    password_selector: row.get(6)?,
                    field_values: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .map_err(to_storage_error)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(to_storage_error)
    }

    pub fn delete_url_credential(&self, connection_id: String) -> Result<(), String> {
        let connection_id = required_field("connection id", connection_id)?;
        let connection = self.lock()?;
        connection
            .execute(
                "DELETE FROM url_credentials WHERE connection_id = ?1",
                params![connection_id],
            )
            .map_err(to_storage_error)?;
        Ok(())
    }

    pub fn list_url_data_partitions(&self) -> Result<Vec<UrlDataPartitionSummary>, String> {
        let connection = self.lock()?;
        let mut statement = connection
            .prepare(
                "SELECT data_partition, COUNT(*)
                 FROM connections
                 WHERE connection_type = 'url' AND data_partition IS NOT NULL AND trim(data_partition) <> ''
                 GROUP BY data_partition
                 ORDER BY lower(data_partition)",
            )
            .map_err(to_storage_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok(UrlDataPartitionSummary {
                    name: row.get(0)?,
                    connection_count: row.get::<_, i64>(1)?.max(0) as u32,
                })
            })
            .map_err(to_storage_error)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(to_storage_error)
    }

    pub fn list_stored_credential_candidates(
        &self,
    ) -> Result<Vec<StoredCredentialCandidate>, String> {
        self.with_connection(list_stored_credential_candidates)
    }

    pub fn list_assistant_chat_threads(&self) -> Result<Vec<AssistantChatThreadRecord>, String> {
        let connection = self.lock()?;
        let mut statement = connection
            .prepare(
                "SELECT id, title, context_label, messages_json, created_at, updated_at
                 FROM assistant_chat_threads
                 ORDER BY updated_at DESC, created_at DESC",
            )
            .map_err(to_storage_error)?;
        let rows = statement
            .query_map([], assistant_chat_thread_from_row)
            .map_err(to_storage_error)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(to_storage_error)
    }

    pub fn upsert_assistant_chat_thread(
        &self,
        request: AssistantChatThreadRecord,
    ) -> Result<AssistantChatThreadRecord, String> {
        let thread = validate_assistant_chat_thread(request)?;
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO assistant_chat_threads
                    (id, title, context_label, messages_json, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    context_label = excluded.context_label,
                    messages_json = excluded.messages_json,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at",
                params![
                    &thread.id,
                    &thread.title,
                    &thread.context_label,
                    &thread.messages_json,
                    &thread.created_at,
                    &thread.updated_at,
                ],
            )
            .map_err(to_storage_error)?;
        Ok(thread)
    }

    pub fn delete_assistant_chat_thread(&self, thread_id: String) -> Result<(), String> {
        let thread_id = required_field("assistant chat thread id", thread_id)?;
        let connection = self.lock()?;
        connection
            .execute(
                "DELETE FROM assistant_chat_threads WHERE id = ?1",
                params![thread_id],
            )
            .map_err(to_storage_error)?;
        Ok(())
    }

    pub fn clear_widget_secret_reference(
        &self,
        instance_id: String,
        key: String,
    ) -> Result<(), String> {
        let instance_id = required_field("widget instance id", instance_id)?;
        let key = required_field("widget secret key", key)?;
        self.with_connection(|connection| {
            let values_json: String = connection
                .query_row(
                    "SELECT settings_values_json FROM dashboard_widget_instances WHERE id = ?1",
                    params![&instance_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(to_storage_error)?
                .ok_or_else(|| "Dashboard widget instance was not found".to_string())?;
            let mut values: serde_json::Value = serde_json::from_str(&values_json)
                .map_err(|error| format!("failed to parse widget settings values: {error}"))?;
            if let Some(object) = values.as_object_mut() {
                object.insert(key, serde_json::Value::Null);
            }
            let next = serde_json::to_string(&values)
                .map_err(|error| format!("failed to serialize widget settings values: {error}"))?;
            connection
                .execute(
                    "UPDATE dashboard_widget_instances SET settings_values_json = ?1 WHERE id = ?2",
                    params![next, instance_id],
                )
                .map_err(to_storage_error)?;
            Ok(())
        })
    }

    pub fn clear_url_data_partition(&self, name: String) -> Result<(), String> {
        let name = required_field("URL data shard", name)?;
        let connection = self.lock()?;
        connection
            .execute(
                "UPDATE connections SET data_partition = NULL WHERE connection_type = 'url' AND data_partition = ?1",
                params![name],
            )
            .map_err(to_storage_error)?;
        Ok(())
    }

    pub fn create_connection_folder(
        &self,
        request: CreateConnectionFolderRequest,
    ) -> Result<ConnectionFolder, String> {
        let name = required_field("folder name", request.name)?;
        let parent_folder_id = normalize_optional_id(request.parent_folder_id);
        let id = make_folder_id(&name);
        let connection = self.lock()?;
        if let Some(parent_folder_id) = parent_folder_id.as_deref() {
            ensure_folder_exists(
                &connection,
                parent_folder_id,
                folder_name_for(parent_folder_id),
            )?;
        }
        let next_sort_order = next_folder_sort_order(&connection, parent_folder_id.as_deref())?;

        connection
            .execute(
                "INSERT INTO connection_folders (id, name, parent_folder_id, sort_order) VALUES (?1, ?2, ?3, ?4)",
                params![id, name, parent_folder_id, next_sort_order],
            )
            .map_err(to_storage_error)?;

        Ok(ConnectionFolder {
            id,
            name,
            connections: Vec::new(),
            folders: Vec::new(),
        })
    }

    pub fn rename_connection_folder(
        &self,
        request: RenameConnectionFolderRequest,
    ) -> Result<ConnectionFolder, String> {
        let id = required_field("folder id", request.id)?;
        let name = required_field("folder name", request.name)?;
        let connection = self.lock()?;
        let affected = connection
            .execute(
                "UPDATE connection_folders SET name = ?1 WHERE id = ?2",
                params![name, id],
            )
            .map_err(to_storage_error)?;

        if affected == 0 {
            return Err("connection folder was not found".to_string());
        }

        get_folder_by_id(&connection, &id, name)
    }

    pub fn delete_connection_folder(&self, folder_id: String) -> Result<(), String> {
        let folder_id = required_field("folder id", folder_id)?;
        let connection = self.lock()?;
        let affected = connection
            .execute(
                "DELETE FROM connection_folders WHERE id = ?1",
                params![folder_id],
            )
            .map_err(to_storage_error)?;

        if affected == 0 {
            return Err("connection folder was not found".to_string());
        }

        Ok(())
    }

    pub fn rename_connection(
        &self,
        request: RenameConnectionRequest,
    ) -> Result<SavedConnection, String> {
        let id = required_field("connection id", request.id)?;
        let name = required_field("name", request.name)?;
        let connection = self.lock()?;
        let affected = connection
            .execute(
                "UPDATE connections SET name = ?1 WHERE id = ?2",
                params![name, id],
            )
            .map_err(to_storage_error)?;

        if affected == 0 {
            return Err("connection was not found".to_string());
        }

        get_connection_by_id(&connection, &id)
    }

    pub fn delete_connection(&self, connection_id: String) -> Result<(), String> {
        let connection_id = required_field("connection id", connection_id)?;
        let connection = self.lock()?;
        let affected = connection
            .execute(
                "DELETE FROM connections WHERE id = ?1",
                params![connection_id],
            )
            .map_err(to_storage_error)?;

        if affected == 0 {
            return Err("connection was not found".to_string());
        }

        Ok(())
    }

    pub fn duplicate_connection(
        &self,
        request: DuplicateConnectionRequest,
    ) -> Result<SavedConnection, String> {
        let source_id = required_field("connection id", request.id)?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction().map_err(to_storage_error)?;

        let source = transaction
            .query_row(
                "SELECT folder_id, name, host, username, port, key_path, proxy_jump, auth_method, local_shell, local_startup_directory, local_startup_script, url, data_partition, use_tmux_sessions, serial_line, serial_speed, connection_type, icon_data_url, icon_background_color
                 FROM connections
                 WHERE id = ?1",
                params![source_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        optional_port(row.get::<_, Option<i64>>(4)?)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, Option<String>>(8)?,
                        row.get::<_, Option<String>>(9)?,
                        row.get::<_, Option<String>>(10)?,
                        row.get::<_, Option<String>>(11)?,
                        row.get::<_, Option<String>>(12)?,
                        row.get::<_, bool>(13)?,
                        row.get::<_, Option<String>>(14)?,
                        optional_serial_speed(row.get::<_, Option<i64>>(15)?)?,
                        row.get::<_, String>(16)?,
                        row.get::<_, Option<String>>(17)?,
                        row.get::<_, Option<String>>(18)?,
                    ))
                },
            )
            .optional()
            .map_err(to_storage_error)?
            .ok_or_else(|| "connection was not found".to_string())?;
        let (
            folder_id,
            source_name,
            host,
            user,
            port,
            key_path,
            proxy_jump,
            auth_method,
            local_shell,
            local_startup_directory,
            local_startup_script,
            url,
            data_partition,
            use_tmux_sessions,
            serial_line,
            serial_speed,
            connection_type,
            icon_data_url,
            icon_background_color,
        ) = source;
        let duplicate_name = request
            .name
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| format!("Copy of {source_name}"));
        let duplicate_id = make_connection_id(&duplicate_name);
        let tmux_connection_id = if use_tmux_sessions && connection_type == "ssh" {
            Some(make_tmux_connection_id(&duplicate_id))
        } else {
            None
        };
        let next_sort_order = next_connection_sort_order(&transaction, folder_id.as_deref())?;

        transaction
            .execute(
                "INSERT INTO connections (
                    id, folder_id, name, host, username, port, key_path, proxy_jump, auth_method, local_shell, local_startup_directory, local_startup_script, url, data_partition, use_tmux_sessions, tmux_connection_id, serial_line, serial_speed, connection_type, icon_data_url, icon_background_color, status, sort_order
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, 'idle', ?22)",
                params![
                    duplicate_id,
                    folder_id,
                    duplicate_name,
                    host,
                    user,
                    port,
                    key_path,
                    proxy_jump,
                    auth_method,
                    local_shell,
                    local_startup_directory,
                    local_startup_script,
                    url,
                    data_partition,
                    use_tmux_sessions,
                    tmux_connection_id,
                    serial_line,
                    serial_speed,
                    connection_type,
                    icon_data_url,
                    icon_background_color,
                    next_sort_order
                ],
            )
            .map_err(to_storage_error)?;

        transaction.commit().map_err(to_storage_error)?;
        get_connection_by_id(&connection, &duplicate_id)
    }

    pub fn move_connection_folder(
        &self,
        request: MoveConnectionFolderRequest,
    ) -> Result<ConnectionTree, String> {
        let id = required_field("folder id", request.id)?;
        let target_parent_folder_id = normalize_optional_id(request.parent_folder_id);
        if target_parent_folder_id.as_deref() == Some(id.as_str()) {
            return Err("a folder cannot be moved into itself".to_string());
        }
        let mut connection = self.lock()?;
        let transaction = connection.transaction().map_err(to_storage_error)?;
        let source_parent_folder_id = folder_parent_id(&transaction, &id)?
            .ok_or_else(|| "connection folder was not found".to_string())?;
        if let Some(parent_id) = target_parent_folder_id.as_deref() {
            ensure_folder_exists(&transaction, parent_id, folder_name_for(parent_id))?;
            if folder_has_descendant(&transaction, &id, parent_id)? {
                return Err("a folder cannot be moved into one of its subfolders".to_string());
            }
        }

        let target_index = if source_parent_folder_id == target_parent_folder_id {
            let folder_ids =
                list_folder_ids_for_parent(&transaction, source_parent_folder_id.as_deref())?;
            match folder_ids.iter().position(|folder_id| folder_id == &id) {
                Some(current_index) if current_index < request.target_index => {
                    request.target_index.saturating_sub(1)
                }
                _ => request.target_index,
            }
        } else {
            request.target_index
        };

        transaction
            .execute(
                "UPDATE connection_folders SET parent_folder_id = ?1 WHERE id = ?2",
                params![target_parent_folder_id, id],
            )
            .map_err(to_storage_error)?;
        reorder_folder_ids(&transaction, source_parent_folder_id.as_deref(), None)?;
        reorder_folder_ids(
            &transaction,
            target_parent_folder_id.as_deref(),
            Some((&id, target_index)),
        )?;
        transaction.commit().map_err(to_storage_error)?;
        drop(connection);
        self.list_connection_tree()
    }

    pub fn move_connection(
        &self,
        request: MoveConnectionRequest,
    ) -> Result<ConnectionTree, String> {
        let id = required_field("connection id", request.id)?;
        let target_folder_id = normalize_optional_id(request.folder_id);
        let mut connection = self.lock()?;
        let transaction = connection.transaction().map_err(to_storage_error)?;

        let source_folder_id = transaction
            .query_row(
                "SELECT folder_id FROM connections WHERE id = ?1",
                params![id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(to_storage_error)?
            .ok_or_else(|| "connection was not found".to_string())?;

        let target_index = if source_folder_id == target_folder_id {
            let connection_ids =
                list_connection_ids_for_folder(&transaction, source_folder_id.as_deref())?;
            match connection_ids
                .iter()
                .position(|connection_id| connection_id == &id)
            {
                Some(current_index) if current_index < request.target_index => {
                    request.target_index.saturating_sub(1)
                }
                _ => request.target_index,
            }
        } else {
            request.target_index
        };

        if let Some(target_folder_id) = target_folder_id.as_deref() {
            ensure_folder_exists(
                &transaction,
                target_folder_id,
                folder_name_for(target_folder_id),
            )?;
        }

        transaction
            .execute(
                "UPDATE connections SET folder_id = ?1 WHERE id = ?2",
                params![target_folder_id, id],
            )
            .map_err(to_storage_error)?;

        reorder_connection_ids(&transaction, source_folder_id.as_deref(), None)?;
        reorder_connection_ids(
            &transaction,
            target_folder_id.as_deref(),
            Some((&id, target_index)),
        )?;
        transaction.commit().map_err(to_storage_error)?;
        drop(connection);
        self.list_connection_tree()
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
                ))
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
        self.connection
            .lock()
            .map_err(|_| "SQLite connection lock is poisoned".to_string())
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
    Ok(connection)
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
            username: (!username.trim().is_empty()).then_some(username),
            updated_at: None,
            metadata_source: "connections".to_string(),
        });
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
        username: None,
        updated_at: None,
        metadata_source: "settings".to_string(),
    });

    Ok(credentials)
}

fn list_url_credential_candidates(
    connection: &SqliteConnection,
) -> Result<Vec<StoredCredentialCandidate>, String> {
    let mut statement = connection
        .prepare(
            "SELECT connections.id, connections.name, connections.url, url_credentials.page_url,
                    url_credentials.username, url_credentials.updated_at
             FROM url_credentials
             INNER JOIN connections ON connections.id = url_credentials.connection_id
             ORDER BY lower(connections.name), lower(url_credentials.username)",
        )
        .map_err(to_storage_error)?;
    let rows = statement
        .query_map([], |row| {
            let connection_id: String = row.get(0)?;
            let connection_name: String = row.get(1)?;
            let url: Option<String> = row.get(2)?;
            let page_url: Option<String> = row.get(3)?;
            let username: String = row.get(4)?;
            let updated_at: String = row.get(5)?;
            Ok(StoredCredentialCandidate {
                id: format!("url-password:{connection_id}"),
                kind: "urlPassword".to_string(),
                secret_kind: "urlPassword".to_string(),
                owner_id: connection_id,
                label: connection_name,
                detail: page_url.or(url),
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
            "SELECT connections.id, name, host, connections.username, port, key_path, proxy_jump, auth_method, local_shell, local_startup_directory, local_startup_script, url, data_partition, use_tmux_sessions, tmux_connection_id, connection_type, serial_line, serial_speed, rdp_options, vnc_options, ftp_options, icon_data_url, icon_background_color,
                    url_credentials.username
             FROM connections
             LEFT JOIN url_credentials ON url_credentials.connection_id = connections.id
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
            let name = connection
                .query_row(
                    "SELECT name FROM connection_folders WHERE id = ?1",
                    params![folder_id],
                    |row| row.get::<_, String>(0),
                )
                .map_err(to_storage_error)?;
            get_folder_by_id(connection, &folder_id, name)
        })
        .collect()
}

fn get_folder_by_id(
    connection: &SqliteConnection,
    id: &str,
    name: String,
) -> Result<ConnectionFolder, String> {
    Ok(ConnectionFolder {
        id: id.to_string(),
        name,
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

fn get_connection_by_id(
    connection: &SqliteConnection,
    connection_id: &str,
) -> Result<SavedConnection, String> {
    let saved_connection = connection
        .query_row(
            "SELECT connections.id, name, host, connections.username, port, key_path, proxy_jump, auth_method, local_shell, local_startup_directory, local_startup_script, url, data_partition, use_tmux_sessions, tmux_connection_id, connection_type, serial_line, serial_speed, rdp_options, vnc_options, ftp_options, icon_data_url, icon_background_color,
                    url_credentials.username
             FROM connections
             LEFT JOIN url_credentials ON url_credentials.connection_id = connections.id
             WHERE connections.id = ?1",
            params![connection_id],
            |row| {
                let url_credential_username: Option<String> = row.get(23)?;
                Ok(SavedConnection {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    user: row.get(3)?,
                    port: optional_port(row.get::<_, Option<i64>>(4)?)?,
                    key_path: row.get(5)?,
                    proxy_jump: row.get(6)?,
                    auth_method: row.get(7)?,
                    local_shell: row.get(8)?,
                    local_startup_directory: row.get(9)?,
                    local_startup_script: row.get(10)?,
                    url: row.get(11)?,
                    data_partition: row.get(12)?,
                    use_tmux_sessions: row.get(13)?,
                    tmux_connection_id: row.get(14)?,
                    connection_type: row.get(15)?,
                    serial_line: row.get(16)?,
                    serial_speed: optional_serial_speed(row.get::<_, Option<i64>>(17)?)?,
                    rdp_options: parse_rdp_connection_options(row.get(18)?)?,
                    vnc_options: parse_vnc_connection_options(row.get(19)?)?,
                    ftp_options: parse_ftp_connection_options(row.get(20)?)?,
                    icon_data_url: row.get(21)?,
                    icon_background_color: row.get(22)?,
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
    let url_credential_username: Option<String> = row.get(23)?;
    Ok(SavedConnection {
        id: row.get(0)?,
        name: row.get(1)?,
        host: row.get(2)?,
        user: row.get(3)?,
        port: optional_port(row.get::<_, Option<i64>>(4)?)?,
        key_path: row.get(5)?,
        proxy_jump: row.get(6)?,
        auth_method: row.get(7)?,
        local_shell: row.get(8)?,
        local_startup_directory: row.get(9)?,
        local_startup_script: row.get(10)?,
        url: row.get(11)?,
        data_partition: row.get(12)?,
        use_tmux_sessions: row.get(13)?,
        tmux_connection_id: row.get(14)?,
        connection_type: row.get(15)?,
        serial_line: row.get(16)?,
        serial_speed: optional_serial_speed(row.get::<_, Option<i64>>(17)?)?,
        rdp_options: parse_rdp_connection_options(row.get(18)?)?,
        vnc_options: parse_vnc_connection_options(row.get(19)?)?,
        ftp_options: parse_ftp_connection_options(row.get(20)?)?,
        icon_data_url: row.get(21)?,
        icon_background_color: row.get(22)?,
        url_credential_username: url_credential_username.clone(),
        has_url_credential: url_credential_username.is_some(),
        status: "idle".to_string(),
        tags: Vec::new(),
    })
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
    match value.trim().to_lowercase().as_str() {
        "local" | "ssh" | "telnet" | "serial" | "url" | "rdp" | "vnc" | "ftp" => {
            Ok(value.trim().to_lowercase())
        }
        _ => Err(
            "connection type must be local, ssh, telnet, serial, url, rdp, vnc, or ftp".to_string(),
        ),
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

fn normalize_connection_user(value: String, connection_type: &str) -> Result<String, String> {
    match connection_type {
        "serial" | "url" => Ok(String::new()),
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

    match value
        .as_deref()
        .map(str::trim)
        .filter(|shell| !shell.is_empty())
    {
        Some(shell @ ("powershell.exe" | "cmd.exe" | "wsl.exe")) => Ok(Some(shell.to_string())),
        Some(_) => {
            Err("local terminal shell must be PowerShell, Command Prompt, or WSL".to_string())
        }
        None => Ok(None),
    }
}

fn normalize_local_startup_directory(
    value: Option<String>,
    connection_type: &str,
) -> Result<Option<String>, String> {
    if connection_type != "local" {
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
    if connection_type != "local" {
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
        }));
    }
    if let Some(color_depth) = options.color_depth {
        options.color_depth = Some(validate_rdp_color_depth(color_depth)?);
    }
    if let Some(profile) = options.performance_profile {
        options.performance_profile = Some(validate_remote_desktop_performance_profile(profile)?);
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
        }));
    }
    if let Some(color_level) = options.color_level {
        options.color_level = Some(validate_vnc_color_level(color_level)?);
    }
    if let Some(encoding) = options.preferred_encoding {
        options.preferred_encoding = Some(validate_vnc_preferred_encoding(encoding)?);
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
        if !value.starts_with("data:image/") {
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
        auto_update_checks_enabled: false,
        show_connected_connections_in_rail: true,
        pinned_connection_ids: Vec::new(),
        allow_clipboard_read: default_allow_clipboard_read(),
        auto_start_with_windows: false,
        minimize_to_tray: false,
        dont_sleep_enabled: false,
        last_backup_at: None,
    }
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
    }
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
    false
}

fn default_allow_clipboard_read() -> bool {
    true
}

fn default_terminal_settings() -> TerminalSettings {
    TerminalSettings {
        font_family: "\"Cascadia Mono\", \"JetBrains Mono\", Consolas, monospace".to_string(),
        font_size: 12,
        line_height: 1.25,
        cursor_style: "block".to_string(),
        scrollback_lines: 5_000,
        copy_on_select: false,
        allow_osc52_clipboard: default_allow_osc52_clipboard(),
        confirm_multiline_paste: true,
        default_shell: if cfg!(target_os = "windows") {
            "powershell.exe".to_string()
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
        },
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
    }
}

fn default_ssh_settings() -> SshSettings {
    SshSettings {
        default_user: default_ssh_user(),
        default_port: 22,
        default_key_path: default_ssh_key_path(),
        default_proxy_jump: None,
        buffer_lines: default_ssh_buffer_lines(),
        hide_common_port_redirects: default_hide_common_port_redirects(),
        allow_osc52_clipboard: default_allow_osc52_clipboard(),
    }
}

fn default_ssh_buffer_lines() -> u32 {
    5_000
}

fn default_hide_common_port_redirects() -> bool {
    true
}

fn default_sftp_settings() -> SftpSettings {
    SftpSettings {
        overwrite_behavior: "fail".to_string(),
    }
}

fn default_url_settings() -> UrlSettings {
    UrlSettings {
        ignore_certificate_errors: false,
    }
}

fn default_rdp_settings() -> RdpSettings {
    RdpSettings {
        color_depth: default_rdp_color_depth(),
        redirect_clipboard: true,
        redirect_drives: false,
        bitmap_cache: true,
        performance_profile: default_remote_desktop_performance_profile(),
    }
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

    use windows_sys::core::GUID;
    use windows_sys::Win32::System::Com::CoTaskMemFree;
    use windows_sys::Win32::UI::Shell::SHGetKnownFolderPath;

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
        show_all_models: false,
        cli_execution_policy: default_ai_cli_execution_policy(),
        tool_permission_mode: default_ai_tool_permission_mode(),
        claude_cli_path: None,
        codex_cli_path: None,
        disabled_skill_names: Vec::new(),
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
        network: false,
        watchdog: default_ai_watchdog_tool_enabled(),
    }
}

fn default_ai_watchdog_tool_enabled() -> bool {
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

fn default_ai_api_mode() -> String {
    "chatCompletions".to_string()
}

fn validate_general_settings(mut settings: GeneralSettings) -> Result<GeneralSettings, String> {
    settings.pinned_connection_ids = unique_non_empty_strings(settings.pinned_connection_ids);
    Ok(settings)
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
    Path::new(path)
        .file_stem()
        .and_then(|name| name.to_str())
        .or_else(|| Path::new(path).file_name().and_then(|name| name.to_str()))
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("Application")
        .to_string()
}

fn validate_dashboard_settings(
    mut settings: DashboardSettings,
) -> Result<DashboardSettings, String> {
    settings.default_landing_view = required_field(
        "default Dashboard landing view",
        settings.default_landing_view,
    )?;
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

    Ok(settings)
}

fn validate_appearance_settings(
    mut settings: AppearanceSettings,
) -> Result<AppearanceSettings, String> {
    settings.app_font_family = required_field("app font family", settings.app_font_family)?;
    settings.color_scheme = required_field("color scheme", settings.color_scheme)?;
    settings.custom_font_path = trim_optional(settings.custom_font_path);
    settings.color_scheme = match settings.color_scheme.to_lowercase().as_str() {
        "default" | "dark" | "light" | "mac" | "orange" | "purple" | "pink"
        | "green-kuai-kuai" | "blue-see" | "confetti" | "bubble-tea" => {
            settings.color_scheme.to_lowercase()
        }
        _ => {
            return Err(
                "color scheme must be one of: default, dark, light, mac, orange, purple, pink, green-kuai-kuai, blue-see, confetti, bubble-tea"
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
    if !(100..=100_000).contains(&settings.buffer_lines) {
        return Err("SSH buffer must be between 100 and 100000 lines".to_string());
    }
    Ok(settings)
}

fn validate_sftp_settings(mut settings: SftpSettings) -> Result<SftpSettings, String> {
    settings.overwrite_behavior = match settings.overwrite_behavior.trim().to_lowercase().as_str() {
        "fail" | "error" | "never" => "fail".to_string(),
        "overwrite" | "replace" => "overwrite".to_string(),
        _ => return Err("SFTP overwrite behavior must be fail or overwrite".to_string()),
    };
    Ok(settings)
}

fn validate_url_settings(settings: UrlSettings) -> Result<UrlSettings, String> {
    Ok(settings)
}

fn validate_rdp_settings(mut settings: RdpSettings) -> Result<RdpSettings, String> {
    settings.color_depth = validate_rdp_color_depth(settings.color_depth)?;
    settings.performance_profile =
        validate_remote_desktop_performance_profile(settings.performance_profile)?;
    Ok(settings)
}

fn validate_vnc_settings(mut settings: VncSettings) -> Result<VncSettings, String> {
    settings.color_level = validate_vnc_color_level(settings.color_level)?;
    settings.preferred_encoding = validate_vnc_preferred_encoding(settings.preferred_encoding)?;
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
            )
        }
    };
    settings.cli_execution_policy = match settings.cli_execution_policy.trim() {
        "" | "suggestOnly" | "suggest-only" | "suggest_only" => "suggestOnly".to_string(),
        _ => {
            return Err(
                "CLI adapter policy must remain suggest-only for approval-based execution"
                    .to_string(),
            )
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
            )
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

fn make_tmux_connection_id(connection_id: &str) -> String {
    make_unique_id("kkterm", connection_id)
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
    format!(
        "{}-{unique}",
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
mod tests {
    use super::*;

    fn find_folder<'a>(
        folders: &'a [ConnectionFolder],
        folder_id: &str,
    ) -> Option<&'a ConnectionFolder> {
        folders.iter().find_map(|folder| {
            if folder.id == folder_id {
                Some(folder)
            } else {
                find_folder(&folder.folders, folder_id)
            }
        })
    }

    fn all_connections(tree: &ConnectionTree) -> impl Iterator<Item = &SavedConnection> {
        tree.connections
            .iter()
            .chain(tree.folders.iter().flat_map(folder_connections))
    }

    fn folder_connections(
        folder: &ConnectionFolder,
    ) -> Box<dyn Iterator<Item = &SavedConnection> + '_> {
        Box::new(
            folder
                .connections
                .iter()
                .chain(folder.folders.iter().flat_map(folder_connections)),
        )
    }

    fn create_test_ssh_connection(
        storage: &Storage,
        name: &str,
        host: &str,
        folder_id: Option<String>,
    ) -> SavedConnection {
        storage
            .create_connection(CreateConnectionRequest {
                name: name.to_string(),
                host: host.to_string(),
                user: "admin".to_string(),
                connection_type: "ssh".to_string(),
                folder_id,
                port: None,
                key_path: None,
                proxy_jump: None,
                auth_method: Some("agent".to_string()),
                local_shell: None,
                local_startup_directory: None,
                local_startup_script: None,
                url: None,
                data_partition: None,
                use_tmux_sessions: None,
                serial_line: None,
                serial_speed: None,
                rdp_options: None,
                vnc_options: None,
                ftp_options: None,
            })
            .expect("SSH connection is created")
    }

    fn create_test_local_connection(storage: &Storage, name: &str, shell: &str) -> SavedConnection {
        storage
            .create_connection(CreateConnectionRequest {
                name: name.to_string(),
                host: "localhost".to_string(),
                user: "local".to_string(),
                connection_type: "local".to_string(),
                folder_id: None,
                port: None,
                key_path: None,
                proxy_jump: None,
                auth_method: Some("keyFile".to_string()),
                local_shell: Some(shell.to_string()),
                local_startup_directory: None,
                local_startup_script: None,
                url: None,
                data_partition: None,
                use_tmux_sessions: None,
                serial_line: None,
                serial_speed: None,
                rdp_options: None,
                vnc_options: None,
                ftp_options: None,
            })
            .expect("local connection is created")
    }

    fn backup_filename_has_serial(filename: &str) -> bool {
        let stem = filename.strip_suffix(".zip").unwrap_or(filename);
        stem.rsplit_once('-')
            .map(|(_, serial)| serial.len() == 3 && serial.chars().all(|ch| ch.is_ascii_digit()))
            .unwrap_or(false)
    }

    #[test]
    fn schema_initializes_an_empty_connection_tree() {
        let storage = Storage::open(temp_db_path("empty")).expect("storage opens");

        let tree = storage
            .list_connection_tree()
            .expect("connection tree loads");

        assert!(tree.connections.is_empty());
        assert!(tree.folders.is_empty());
    }

    #[test]
    fn schema_initialization_is_idempotent_without_initial_data() {
        let db_path = temp_db_path("idempotent");
        let storage = Storage::open(db_path.clone()).expect("first open succeeds");
        drop(storage);

        let reopened_storage = Storage::open(db_path).expect("second open succeeds");
        let tree = reopened_storage
            .list_connection_tree()
            .expect("connection tree loads");
        let connection_count = all_connections(&tree).count();

        assert_eq!(connection_count, 0);
        assert!(tree.folders.is_empty());
    }

    #[test]
    fn create_connection_can_persist_root_ssh_connection() {
        let storage = Storage::open(temp_db_path("create")).expect("storage opens");

        let created = storage
            .create_connection(CreateConnectionRequest {
                name: "Lab Host".to_string(),
                host: "lab.internal".to_string(),
                user: "admin".to_string(),
                connection_type: "ssh".to_string(),
                folder_id: None,
                port: Some(2222),
                key_path: Some("C:\\Users\\ryan\\.ssh\\id_ed25519".to_string()),
                proxy_jump: Some("jump.internal".to_string()),
                auth_method: Some("keyFile".to_string()),
                local_shell: None,
                local_startup_directory: None,
                local_startup_script: None,
                url: None,
                data_partition: None,
                use_tmux_sessions: None,
                serial_line: None,
                serial_speed: None,
                rdp_options: None,
                vnc_options: None,
                ftp_options: None,
            })
            .expect("connection is created");

        assert_eq!(created.name, "Lab Host");
        assert_eq!(created.port, Some(2222));
        assert_eq!(created.proxy_jump.as_deref(), Some("jump.internal"));

        let tree = storage
            .list_connection_tree()
            .expect("connection tree loads");
        let root_connection = tree
            .connections
            .iter()
            .find(|connection| connection.host == "lab.internal")
            .expect("root connection exists");

        assert_eq!(root_connection.name, "Lab Host");
        assert_eq!(root_connection.tags, Vec::<String>::new());
    }

    #[test]
    fn local_connection_persists_startup_directory_and_script() {
        let storage = Storage::open(temp_db_path("local-startup-options")).expect("storage opens");

        let created = storage
            .create_connection(CreateConnectionRequest {
                name: "Project Shell".to_string(),
                host: "localhost".to_string(),
                user: "local".to_string(),
                connection_type: "local".to_string(),
                folder_id: None,
                port: None,
                key_path: None,
                proxy_jump: None,
                auth_method: None,
                local_shell: Some("powershell.exe".to_string()),
                local_startup_directory: Some("  C:\\Work\\KKTerm  ".to_string()),
                local_startup_script: Some("  npm run check  ".to_string()),
                url: None,
                data_partition: None,
                use_tmux_sessions: None,
                serial_line: None,
                serial_speed: None,
                rdp_options: None,
                vnc_options: None,
                ftp_options: None,
            })
            .expect("local connection is created");

        assert_eq!(
            created.local_startup_directory.as_deref(),
            Some("C:\\Work\\KKTerm")
        );
        assert_eq!(
            created.local_startup_script.as_deref(),
            Some("npm run check")
        );

        let tree = storage
            .list_connection_tree()
            .expect("connection tree loads");
        let reloaded = tree
            .connections
            .iter()
            .find(|connection| connection.id == created.id)
            .expect("local connection reloads");
        assert_eq!(
            reloaded.local_startup_directory.as_deref(),
            Some("C:\\Work\\KKTerm")
        );
        assert_eq!(
            reloaded.local_startup_script.as_deref(),
            Some("npm run check")
        );
    }

    #[test]
    fn create_connection_can_persist_remote_desktop_connections() {
        let storage = Storage::open(temp_db_path("remote-desktop-create")).expect("storage opens");

        let rdp = storage
            .create_connection(CreateConnectionRequest {
                name: "Jump Box".to_string(),
                host: "jumpbox.internal".to_string(),
                user: "DOMAIN\\admin".to_string(),
                connection_type: "rdp".to_string(),
                folder_id: None,
                port: Some(3389),
                key_path: Some("C:\\ignored\\id_ed25519".to_string()),
                proxy_jump: Some("ignored.internal".to_string()),
                auth_method: Some("password".to_string()),
                local_shell: None,
                local_startup_directory: None,
                local_startup_script: None,
                url: None,
                data_partition: None,
                use_tmux_sessions: Some(true),
                serial_line: None,
                serial_speed: None,
                rdp_options: None,
                vnc_options: None,
                ftp_options: None,
            })
            .expect("RDP connection is created");

        assert_eq!(rdp.connection_type, "rdp");
        assert_eq!(rdp.host, "jumpbox.internal");
        assert_eq!(rdp.user, "DOMAIN\\admin");
        assert_eq!(rdp.port, Some(3389));
        assert!(rdp.key_path.is_none());
        assert!(rdp.proxy_jump.is_none());
        assert!(!rdp.use_tmux_sessions);

        let vnc = storage
            .create_connection(CreateConnectionRequest {
                name: "Console VNC".to_string(),
                host: "console.internal".to_string(),
                user: "   ".to_string(),
                connection_type: "vnc".to_string(),
                folder_id: None,
                port: Some(5900),
                key_path: None,
                proxy_jump: None,
                auth_method: None,
                local_shell: None,
                local_startup_directory: None,
                local_startup_script: None,
                url: None,
                data_partition: None,
                use_tmux_sessions: None,
                serial_line: None,
                serial_speed: None,
                rdp_options: None,
                vnc_options: None,
                ftp_options: None,
            })
            .expect("VNC connection is created");

        assert_eq!(vnc.connection_type, "vnc");
        assert_eq!(vnc.user, "");
        assert_eq!(vnc.port, Some(5900));
    }

    #[test]
    fn create_connection_can_persist_telnet_and_serial_connections() {
        let storage = Storage::open(temp_db_path("telnet-serial-create")).expect("storage opens");

        let telnet = storage
            .create_connection(CreateConnectionRequest {
                name: "Legacy Router".to_string(),
                host: "router.internal".to_string(),
                user: "admin".to_string(),
                connection_type: "telnet".to_string(),
                folder_id: None,
                port: Some(23),
                key_path: Some("C:\\ignored\\id_ed25519".to_string()),
                proxy_jump: Some("ignored.internal".to_string()),
                auth_method: Some("agent".to_string()),
                local_shell: None,
                local_startup_directory: None,
                local_startup_script: None,
                url: None,
                data_partition: None,
                use_tmux_sessions: Some(true),
                serial_line: None,
                serial_speed: None,
                rdp_options: None,
                vnc_options: None,
                ftp_options: None,
            })
            .expect("Telnet connection is created");

        assert_eq!(telnet.connection_type, "telnet");
        assert_eq!(telnet.auth_method, "password");
        assert!(telnet.key_path.is_none());
        assert!(telnet.proxy_jump.is_none());
        assert!(!telnet.use_tmux_sessions);

        let serial = storage
            .create_connection(CreateConnectionRequest {
                name: "Console Cable".to_string(),
                host: String::new(),
                user: "ignored".to_string(),
                connection_type: "serial".to_string(),
                folder_id: None,
                port: Some(22),
                key_path: None,
                proxy_jump: None,
                auth_method: None,
                local_shell: None,
                local_startup_directory: None,
                local_startup_script: None,
                url: None,
                data_partition: None,
                use_tmux_sessions: None,
                serial_line: Some("COM7".to_string()),
                serial_speed: Some(115200),
                rdp_options: None,
                vnc_options: None,
                ftp_options: None,
            })
            .expect("Serial connection is created");

        assert_eq!(serial.connection_type, "serial");
        assert_eq!(serial.host, "COM7");
        assert_eq!(serial.user, "");
        assert_eq!(serial.port, None);
        assert_eq!(serial.serial_line.as_deref(), Some("COM7"));
        assert_eq!(serial.serial_speed, Some(115200));
    }

    #[test]
    fn url_credentials_round_trip_without_storing_passwords_in_sqlite() {
        let storage = Storage::open(temp_db_path("url-credentials")).expect("storage opens");
        let created = storage
            .create_connection(CreateConnectionRequest {
                name: "Router UI".to_string(),
                host: String::new(),
                user: String::new(),
                connection_type: "url".to_string(),
                folder_id: None,
                port: None,
                key_path: None,
                proxy_jump: None,
                auth_method: None,
                local_shell: None,
                local_startup_directory: None,
                local_startup_script: None,
                url: Some("router.internal".to_string()),
                data_partition: Some("ops".to_string()),
                use_tmux_sessions: None,
                serial_line: None,
                serial_speed: None,
                rdp_options: None,
                vnc_options: None,
                ftp_options: None,
            })
            .expect("URL connection is created");

        assert_eq!(created.url.as_deref(), Some("https://router.internal/"));
        assert!(!created.has_url_credential);

        let updated = storage
            .upsert_url_credential(UpsertUrlCredentialRequest {
                connection_id: created.id.clone(),
                username: "admin".to_string(),
                page_url: None,
                username_selector: None,
                password_selector: None,
                field_values: None,
            })
            .expect("URL credential metadata is stored");
        assert!(updated.has_url_credential);
        assert_eq!(updated.url_credential_username.as_deref(), Some("admin"));

        let tree = storage
            .list_connection_tree()
            .expect("connection tree loads");
        let reloaded = tree
            .connections
            .iter()
            .find(|connection| connection.id == created.id)
            .expect("URL connection exists");
        assert!(reloaded.has_url_credential);
        assert_eq!(reloaded.url_credential_username.as_deref(), Some("admin"));
    }

    #[test]
    fn connection_icon_data_url_updates_for_any_connection_type() {
        let storage =
            Storage::open(temp_db_path("connection-icon-data-url")).expect("storage opens");
        let created = create_test_ssh_connection(&storage, "Bastion", "bastion.internal", None);
        let icon_data_url = " data:image/png;base64,customicon ".to_string();

        let updated = storage
            .update_connection_icon_data_url(created.id.clone(), Some(icon_data_url))
            .expect("connection icon is updated")
            .expect("changed icon returns the updated connection");

        assert_eq!(
            updated.icon_data_url.as_deref(),
            Some("data:image/png;base64,customicon")
        );

        let tree = storage
            .list_connection_tree()
            .expect("connection tree loads");
        let reloaded = tree
            .connections
            .iter()
            .find(|connection| connection.id == created.id)
            .expect("connection exists");
        assert_eq!(
            reloaded.icon_data_url.as_deref(),
            Some("data:image/png;base64,customicon")
        );

        let cleared = storage
            .update_connection_icon_data_url(created.id.clone(), None)
            .expect("connection icon is cleared")
            .expect("cleared icon returns the updated connection");
        assert!(cleared.icon_data_url.is_none());
    }

    #[test]
    fn connection_icon_background_color_updates_for_any_connection_type() {
        let storage =
            Storage::open(temp_db_path("connection-icon-background")).expect("storage opens");
        let created = create_test_ssh_connection(&storage, "Bastion", "bastion.internal", None);

        let updated = storage
            .update_connection_icon_background_color(created.id.clone(), Some(" #2563eb ".to_string()))
            .expect("connection icon background is updated")
            .expect("changed background returns the updated connection");

        assert_eq!(updated.icon_background_color.as_deref(), Some("#2563eb"));

        let tree = storage
            .list_connection_tree()
            .expect("connection tree loads");
        let reloaded = tree
            .connections
            .iter()
            .find(|connection| connection.id == created.id)
            .expect("connection exists");
        assert_eq!(reloaded.icon_background_color.as_deref(), Some("#2563eb"));

        let cleared = storage
            .update_connection_icon_background_color(created.id.clone(), None)
            .expect("connection icon background is cleared")
            .expect("cleared background returns the updated connection");
        assert!(cleared.icon_background_color.is_none());
    }

    #[test]
    fn stored_credential_candidates_include_connection_url_and_widget_metadata() {
        let storage =
            Storage::open(temp_db_path("stored-credential-candidates")).expect("storage opens");

        let ssh = storage
            .create_connection(CreateConnectionRequest {
                name: "Password Host".to_string(),
                host: "password.internal".to_string(),
                user: "admin".to_string(),
                connection_type: "ssh".to_string(),
                folder_id: None,
                port: None,
                key_path: None,
                proxy_jump: None,
                auth_method: Some("password".to_string()),
                local_shell: None,
                local_startup_directory: None,
                local_startup_script: None,
                url: None,
                data_partition: None,
                use_tmux_sessions: None,
                serial_line: None,
                serial_speed: None,
                rdp_options: None,
                vnc_options: None,
                ftp_options: None,
            })
            .expect("SSH connection is created");
        let url = storage
            .create_connection(CreateConnectionRequest {
                name: "Portal".to_string(),
                host: String::new(),
                user: String::new(),
                connection_type: "url".to_string(),
                folder_id: None,
                port: None,
                key_path: None,
                proxy_jump: None,
                auth_method: None,
                local_shell: None,
                local_startup_directory: None,
                local_startup_script: None,
                url: Some("https://portal.example".to_string()),
                data_partition: None,
                use_tmux_sessions: None,
                serial_line: None,
                serial_speed: None,
                rdp_options: None,
                vnc_options: None,
                ftp_options: None,
            })
            .expect("URL connection is created");
        storage
            .upsert_url_credential(UpsertUrlCredentialRequest {
                connection_id: url.id.clone(),
                username: "web-user".to_string(),
                page_url: None,
                username_selector: None,
                password_selector: None,
                field_values: None,
            })
            .expect("URL credential metadata is stored");

        storage.with_connection(|connection| {
            connection.execute(
                "INSERT INTO dashboard_views (id, title, sort_order, grid_density)
                 VALUES ('view-1', 'Default', 0, 'default')",
                [],
            ).map_err(to_storage_error)?;
            connection.execute(
                "INSERT INTO dashboard_custom_widgets
                    (id, title, summary, category, body_json, settings_schema_json, created_by)
                 VALUES
                    ('cw-1', 'API Widget', '', 'custom',
                     '{\"source\":\"console.log(1)\",\"permissions\":{\"network\":false}}',
                     '{\"fields\":[{\"type\":\"secret\",\"key\":\"apiKey\",\"label\":\"API key\"}]}',
                     'agent')",
                [],
            ).map_err(to_storage_error)?;
            connection.execute(
                "INSERT INTO dashboard_widget_instances
                    (id, view_id, kind, source_id, preset, accent_name, icon_name, custom_title,
                     glass, action_direction, settings_values_json, body_opacity,
                     grid_x, grid_y, grid_w, grid_h, sort_order)
                 VALUES
                    ('inst-1', 'view-1', 'script', 'cw-1', 'panel', 'blue', 'Key', NULL,
                     0, NULL,
                     '{\"apiKey\":{\"type\":\"secretRef\",\"ownerId\":\"dashboard-widget-secret:inst-1:apiKey\",\"hasSecret\":true}}',
                     NULL, 0, 0, 4, 3, 0)",
                [],
            ).map_err(to_storage_error)?;
            Ok(())
        }).expect("dashboard widget metadata is inserted");

        let candidates = storage
            .list_stored_credential_candidates()
            .expect("credential candidates load");

        assert!(candidates.iter().any(|candidate| {
            candidate.kind == "connectionPassword" && candidate.owner_id == ssh.id
        }));
        assert!(candidates
            .iter()
            .any(|candidate| { candidate.kind == "urlPassword" && candidate.owner_id == url.id }));
        assert!(candidates.iter().any(|candidate| {
            candidate.kind == "widgetSecret"
                && candidate.owner_id == "dashboard-widget-secret:inst-1:apiKey"
        }));
    }

    #[test]
    fn url_credentials_reject_non_url_connections() {
        let storage = Storage::open(temp_db_path("url-credential-type")).expect("storage opens");
        let connection = create_test_ssh_connection(&storage, "Bastion", "bastion.internal", None);

        let error = match storage.upsert_url_credential(UpsertUrlCredentialRequest {
            connection_id: connection.id,
            username: "admin".to_string(),
            page_url: None,
            username_selector: None,
            password_selector: None,
            field_values: None,
        }) {
            Ok(_) => panic!("SSH connections cannot store URL credentials"),
            Err(error) => error,
        };
        assert_eq!(
            error,
            "URL credentials can only be stored for URL connections"
        );
    }

    #[test]
    fn rename_connection_updates_durable_connection_name() {
        let storage = Storage::open(temp_db_path("rename")).expect("storage opens");
        let staging = storage
            .create_connection_folder(CreateConnectionFolderRequest {
                name: "Staging".to_string(),
                parent_folder_id: None,
            })
            .expect("staging folder is created");
        let connection = create_test_ssh_connection(
            &storage,
            "API Stage",
            "api-stage.internal",
            Some(staging.id.clone()),
        );

        let renamed = storage
            .rename_connection(RenameConnectionRequest {
                id: connection.id.clone(),
                name: "API Stage Blue".to_string(),
            })
            .expect("connection is renamed");

        assert_eq!(renamed.id, connection.id);
        assert_eq!(renamed.name, "API Stage Blue");

        let tree = storage
            .list_connection_tree()
            .expect("connection tree loads");
        let staging = find_folder(&tree.folders, &staging.id).expect("staging folder exists");

        assert_eq!(staging.connections[0].name, "API Stage Blue");
    }

    #[test]
    fn update_connection_edits_fields_and_moves_folder() {
        let storage = Storage::open(temp_db_path("update")).expect("storage opens");
        let staging = storage
            .create_connection_folder(CreateConnectionFolderRequest {
                name: "Staging".to_string(),
                parent_folder_id: None,
            })
            .expect("staging folder is created");
        let production = storage
            .create_connection_folder(CreateConnectionFolderRequest {
                name: "Production".to_string(),
                parent_folder_id: None,
            })
            .expect("production folder is created");
        let connection = create_test_ssh_connection(
            &storage,
            "API Stage",
            "api-stage.internal",
            Some(staging.id.clone()),
        );

        let updated = storage
            .update_connection(UpdateConnectionRequest {
                id: connection.id.clone(),
                name: "API Production".to_string(),
                host: "api-prod.internal".to_string(),
                user: "deploy".to_string(),
                connection_type: "ssh".to_string(),
                folder_id: Some(production.id.clone()),
                port: Some(2222),
                key_path: Some("C:\\Users\\ryan\\.ssh\\prod".to_string()),
                proxy_jump: Some("jump.internal".to_string()),
                auth_method: Some("keyFile".to_string()),
                local_shell: None,
                local_startup_directory: None,
                local_startup_script: None,
                url: None,
                data_partition: None,
                use_tmux_sessions: Some(false),
                serial_line: None,
                serial_speed: None,
                rdp_options: None,
                vnc_options: None,
                ftp_options: None,
            })
            .expect("connection is updated");

        assert_eq!(updated.id, connection.id);
        assert_eq!(updated.name, "API Production");
        assert_eq!(updated.host, "api-prod.internal");
        assert_eq!(updated.user, "deploy");
        assert_eq!(updated.port, Some(2222));
        assert_eq!(
            updated.key_path.as_deref(),
            Some("C:\\Users\\ryan\\.ssh\\prod")
        );
        assert_eq!(updated.proxy_jump.as_deref(), Some("jump.internal"));
        assert_eq!(updated.auth_method, "keyFile");
        assert!(!updated.use_tmux_sessions);
        assert!(updated.tmux_connection_id.is_none());

        let tree = storage
            .list_connection_tree()
            .expect("connection tree loads");
        let staging = find_folder(&tree.folders, &staging.id).expect("staging folder exists");
        let production =
            find_folder(&tree.folders, &production.id).expect("production folder exists");

        assert!(staging.connections.is_empty());
        assert_eq!(production.connections[0].id, connection.id);
        assert_eq!(production.connections[0].name, "API Production");
    }

    #[test]
    fn delete_connection_removes_connection_and_tags() {
        let storage = Storage::open(temp_db_path("delete")).expect("storage opens");
        let production = storage
            .create_connection_folder(CreateConnectionFolderRequest {
                name: "Production".to_string(),
                parent_folder_id: None,
            })
            .expect("production folder is created");
        let connection = create_test_ssh_connection(
            &storage,
            "Bastion East",
            "bastion-east.internal",
            Some(production.id.clone()),
        );

        storage
            .delete_connection(connection.id)
            .expect("connection is deleted");

        let tree = storage
            .list_connection_tree()
            .expect("connection tree loads");
        let production =
            find_folder(&tree.folders, &production.id).expect("production folder exists");

        assert!(production.connections.is_empty());
    }

    #[test]
    fn duplicate_connection_copies_non_secret_connection_data() {
        let storage = Storage::open(temp_db_path("duplicate")).expect("storage opens");
        let production = storage
            .create_connection_folder(CreateConnectionFolderRequest {
                name: "Production".to_string(),
                parent_folder_id: None,
            })
            .expect("production folder is created");
        let connection = create_test_ssh_connection(
            &storage,
            "Bastion East",
            "bastion-east.internal",
            Some(production.id.clone()),
        );

        let duplicated = storage
            .duplicate_connection(DuplicateConnectionRequest {
                id: connection.id.clone(),
                name: Some("Bastion East Copy".to_string()),
            })
            .expect("connection is duplicated");

        assert_ne!(duplicated.id, connection.id);
        assert_eq!(duplicated.name, "Bastion East Copy");
        assert_eq!(duplicated.host, "bastion-east.internal");
        assert_eq!(duplicated.user, "admin");
        assert_eq!(duplicated.tags, Vec::<String>::new());
        assert_eq!(duplicated.status, "idle");

        let tree = storage
            .list_connection_tree()
            .expect("connection tree loads");
        let production =
            find_folder(&tree.folders, &production.id).expect("production folder exists");

        assert_eq!(production.connections.len(), 2);
        assert_eq!(production.connections[1].id, duplicated.id);
    }

    #[test]
    fn create_rename_and_delete_connection_folder() {
        let storage = Storage::open(temp_db_path("folder-crud")).expect("storage opens");

        let created = storage
            .create_connection_folder(CreateConnectionFolderRequest {
                name: "Customer A".to_string(),
                parent_folder_id: None,
            })
            .expect("folder is created");
        assert_eq!(created.name, "Customer A");
        assert!(created.connections.is_empty());

        let renamed = storage
            .rename_connection_folder(RenameConnectionFolderRequest {
                id: created.id.clone(),
                name: "Customer A Production".to_string(),
            })
            .expect("folder is renamed");
        assert_eq!(renamed.name, "Customer A Production");

        storage
            .delete_connection_folder(created.id.clone())
            .expect("folder is deleted");

        let tree = storage
            .list_connection_tree()
            .expect("connection tree loads");
        assert!(find_folder(&tree.folders, &created.id).is_none());
    }

    #[test]
    fn folders_can_contain_subfolders() {
        let storage = Storage::open(temp_db_path("folder-nesting")).expect("storage opens");
        let parent = storage
            .create_connection_folder(CreateConnectionFolderRequest {
                name: "Customer A".to_string(),
                parent_folder_id: None,
            })
            .expect("parent folder is created");
        let child = storage
            .create_connection_folder(CreateConnectionFolderRequest {
                name: "Production".to_string(),
                parent_folder_id: Some(parent.id.clone()),
            })
            .expect("child folder is created");

        let tree = storage
            .list_connection_tree()
            .expect("connection tree loads");
        let parent = find_folder(&tree.folders, &parent.id).expect("parent folder exists");

        assert_eq!(parent.folders[0].id, child.id);
        assert_eq!(parent.folders[0].name, "Production");
    }

    #[test]
    fn deleting_folder_removes_connections_in_that_folder() {
        let storage = Storage::open(temp_db_path("folder-delete-cascade")).expect("storage opens");
        let folder = storage
            .create_connection_folder(CreateConnectionFolderRequest {
                name: "Ephemeral".to_string(),
                parent_folder_id: None,
            })
            .expect("folder is created");

        storage
            .create_connection(CreateConnectionRequest {
                name: "Throwaway SSH".to_string(),
                host: "throwaway.internal".to_string(),
                user: "admin".to_string(),
                connection_type: "ssh".to_string(),
                folder_id: Some(folder.id.clone()),
                port: None,
                key_path: None,
                proxy_jump: None,
                auth_method: Some("agent".to_string()),
                local_shell: None,
                local_startup_directory: None,
                local_startup_script: None,
                url: None,
                data_partition: None,
                use_tmux_sessions: None,
                serial_line: None,
                serial_speed: None,
                rdp_options: None,
                vnc_options: None,
                ftp_options: None,
            })
            .expect("connection is created in folder");

        storage
            .delete_connection_folder(folder.id)
            .expect("folder is deleted");

        let tree = storage
            .list_connection_tree()
            .expect("connection tree loads");
        assert!(!all_connections(&tree).any(|connection| connection.host == "throwaway.internal"));
    }

    #[test]
    fn move_connection_folder_updates_durable_root_folder_order() {
        let storage = Storage::open(temp_db_path("folder-move")).expect("storage opens");
        let production = storage
            .create_connection_folder(CreateConnectionFolderRequest {
                name: "Production".to_string(),
                parent_folder_id: None,
            })
            .expect("production folder is created");
        let staging = storage
            .create_connection_folder(CreateConnectionFolderRequest {
                name: "Staging".to_string(),
                parent_folder_id: None,
            })
            .expect("staging folder is created");

        let tree = storage
            .move_connection_folder(MoveConnectionFolderRequest {
                id: staging.id.clone(),
                parent_folder_id: None,
                target_index: 0,
            })
            .expect("folder is moved");

        assert_eq!(tree.folders[0].id, staging.id);
        assert_eq!(tree.folders[1].id, production.id);

        let reloaded = storage
            .list_connection_tree()
            .expect("connection tree reloads");
        assert_eq!(reloaded.folders[0].id, staging.id);
    }

    #[test]
    fn move_connection_reorders_within_target_folder() {
        let storage = Storage::open(temp_db_path("connection-move")).expect("storage opens");
        let production = storage
            .create_connection_folder(CreateConnectionFolderRequest {
                name: "Production".to_string(),
                parent_folder_id: None,
            })
            .expect("production folder is created");
        let staging = storage
            .create_connection_folder(CreateConnectionFolderRequest {
                name: "Staging".to_string(),
                parent_folder_id: None,
            })
            .expect("staging folder is created");
        create_test_ssh_connection(
            &storage,
            "Bastion East",
            "bastion-east.internal",
            Some(production.id.clone()),
        );
        let api_stage = create_test_ssh_connection(
            &storage,
            "API Stage",
            "api-stage.internal",
            Some(staging.id.clone()),
        );

        let tree = storage
            .move_connection(MoveConnectionRequest {
                id: api_stage.id.clone(),
                folder_id: Some(production.id.clone()),
                target_index: 1,
            })
            .expect("connection is moved");

        let production =
            find_folder(&tree.folders, &production.id).expect("production folder exists");
        assert_eq!(production.connections[1].id, api_stage.id);
        assert_eq!(production.connections.len(), 2);

        let staging = find_folder(&tree.folders, &staging.id).expect("staging folder exists");
        assert!(staging.connections.is_empty());
    }

    #[test]
    fn move_connection_before_later_connection_in_root() {
        let storage =
            Storage::open(temp_db_path("connection-move-same-folder")).expect("storage opens");
        let powershell = create_test_local_connection(&storage, "PowerShell", "powershell.exe");
        let wsl = create_test_local_connection(&storage, "WSL", "wsl.exe");

        let tree = storage
            .move_connection(MoveConnectionRequest {
                id: wsl.id.clone(),
                folder_id: None,
                target_index: 0,
            })
            .expect("connection order is normalized");

        assert_eq!(tree.connections[0].id, wsl.id);
        assert_eq!(tree.connections[1].id, powershell.id);
    }

    #[test]
    fn general_settings_round_trip_through_settings_table() {
        let storage = Storage::open(temp_db_path("general-settings")).expect("storage opens");

        let defaults = storage
            .general_settings()
            .expect("default general settings load");
        assert!(defaults.auto_backup_enabled);
        assert!(!defaults.auto_update_checks_enabled);
        assert!(defaults.show_connected_connections_in_rail);
        assert!(defaults.pinned_connection_ids.is_empty());
        assert!(defaults.allow_clipboard_read);
        assert!(!defaults.auto_start_with_windows);
        assert!(!defaults.minimize_to_tray);
        assert!(!defaults.dont_sleep_enabled);
        assert!(defaults.last_backup_at.is_none());

        let updated = storage
            .update_general_settings(GeneralSettings {
                auto_backup_enabled: false,
                auto_update_checks_enabled: true,
                show_connected_connections_in_rail: true,
                pinned_connection_ids: vec![
                    " connection-a ".to_string(),
                    "connection-a".to_string(),
                    "".to_string(),
                    "connection-b".to_string(),
                ],
                allow_clipboard_read: false,
                auto_start_with_windows: true,
                minimize_to_tray: true,
                dont_sleep_enabled: true,
                last_backup_at: None,
            })
            .expect("general settings update");
        assert!(!updated.auto_backup_enabled);
        assert!(updated.show_connected_connections_in_rail);
        assert_eq!(
            updated.pinned_connection_ids,
            vec!["connection-a".to_string(), "connection-b".to_string()]
        );
        assert!(!updated.allow_clipboard_read);
        assert!(updated.auto_start_with_windows);
        assert!(updated.minimize_to_tray);
        assert!(updated.dont_sleep_enabled);

        let reloaded = storage.general_settings().expect("general settings reload");
        assert!(!reloaded.auto_backup_enabled);
        assert!(reloaded.show_connected_connections_in_rail);
        assert_eq!(
            reloaded.pinned_connection_ids,
            vec!["connection-a".to_string(), "connection-b".to_string()]
        );
        assert!(!reloaded.allow_clipboard_read);
        assert!(reloaded.auto_start_with_windows);
        assert!(reloaded.minimize_to_tray);
        assert!(reloaded.dont_sleep_enabled);
        assert!(reloaded.last_backup_at.is_none());
    }

    #[test]
    fn app_launcher_settings_round_trip_and_validation() {
        let storage = Storage::open(temp_db_path("app-launcher-settings")).expect("storage opens");

        let defaults = storage
            .app_launcher_settings()
            .expect("default app launcher settings load");
        assert!(defaults.entries.is_empty());

        let updated = storage
            .update_app_launcher_settings(AppLauncherSettings {
                entries: vec![
                    AppLauncherEntry {
                        id: " app-a ".to_string(),
                        name: " Windows Terminal ".to_string(),
                        path: " C:\\Program Files\\WindowsApps\\wt.exe ".to_string(),
                        arguments: Some(" -p PowerShell ".to_string()),
                        working_directory: Some(" C:\\Users ".to_string()),
                        icon_data_url: Some(" data:image/png;base64,abc ".to_string()),
                        rail_pinned: true,
                        created_at: "2026-05-11T00:00:00Z".to_string(),
                        updated_at: "2026-05-11T00:00:00Z".to_string(),
                    },
                    AppLauncherEntry {
                        id: "app-a".to_string(),
                        name: "Duplicate".to_string(),
                        path: "C:\\Duplicate.exe".to_string(),
                        arguments: None,
                        working_directory: None,
                        icon_data_url: None,
                        rail_pinned: false,
                        created_at: "2026-05-11T00:00:00Z".to_string(),
                        updated_at: "2026-05-11T00:00:00Z".to_string(),
                    },
                    AppLauncherEntry {
                        id: "app-b".to_string(),
                        name: "  ".to_string(),
                        path: " C:\\Tools\\tool.exe ".to_string(),
                        arguments: Some("".to_string()),
                        working_directory: Some("".to_string()),
                        icon_data_url: Some("".to_string()),
                        rail_pinned: false,
                        created_at: "2026-05-11T00:00:00Z".to_string(),
                        updated_at: "2026-05-11T00:00:00Z".to_string(),
                    },
                    AppLauncherEntry {
                        id: "".to_string(),
                        name: "Missing id".to_string(),
                        path: "C:\\Missing.exe".to_string(),
                        arguments: None,
                        working_directory: None,
                        icon_data_url: None,
                        rail_pinned: false,
                        created_at: "2026-05-11T00:00:00Z".to_string(),
                        updated_at: "2026-05-11T00:00:00Z".to_string(),
                    },
                ],
                view_mode: "details".to_string(),
                list_sort: AppLauncherSortState {
                    field: "type".to_string(),
                    direction: "desc".to_string(),
                },
                details_sort: AppLauncherSortState {
                    field: "modified".to_string(),
                    direction: "desc".to_string(),
                },
            })
            .expect("app launcher settings update");

        assert_eq!(updated.entries.len(), 2);
        assert_eq!(updated.entries[0].id, "app-a");
        assert_eq!(updated.entries[0].name, "Windows Terminal");
        assert_eq!(
            updated.entries[0].path,
            "C:\\Program Files\\WindowsApps\\wt.exe"
        );
        assert_eq!(
            updated.entries[0].arguments.as_deref(),
            Some("-p PowerShell")
        );
        assert_eq!(
            updated.entries[0].working_directory.as_deref(),
            Some("C:\\Users")
        );
        assert_eq!(
            updated.entries[0].icon_data_url.as_deref(),
            Some("data:image/png;base64,abc")
        );
        assert!(updated.entries[0].rail_pinned);
        assert_eq!(updated.entries[1].name, "tool");
        assert_eq!(updated.entries[1].path, "C:\\Tools\\tool.exe");
        assert!(updated.entries[1].arguments.is_none());
        assert!(updated.entries[1].working_directory.is_none());
        assert!(updated.entries[1].icon_data_url.is_none());
        assert_eq!(updated.view_mode, "details");
        assert_eq!(updated.list_sort.field, "type");
        assert_eq!(updated.list_sort.direction, "desc");
        assert_eq!(updated.details_sort.field, "modified");
        assert_eq!(updated.details_sort.direction, "desc");

        let reloaded = storage
            .app_launcher_settings()
            .expect("app launcher settings reload");
        assert_eq!(reloaded.entries.len(), 2);
        assert_eq!(reloaded.entries[0].id, "app-a");
        assert_eq!(reloaded.entries[1].id, "app-b");
    }

    #[test]
    fn dashboard_settings_round_trip_through_settings_table() {
        let storage = Storage::open(temp_db_path("dashboard-settings")).expect("storage opens");

        let defaults = storage
            .dashboard_settings()
            .expect("default dashboard settings load");
        assert!(defaults.confirm_remove);
        assert_eq!(defaults.default_landing_view, "lastActive");
        assert_eq!(defaults.max_active_script_widgets, 8);
        assert!(defaults.allow_widget_network_tools);

        let updated = storage
            .update_dashboard_settings(DashboardSettings {
                confirm_remove: false,
                default_landing_view: " view-default ".to_string(),
                max_active_script_widgets: 20,
                allow_widget_network_tools: true,
            })
            .expect("dashboard settings update");
        assert!(!updated.confirm_remove);
        assert_eq!(updated.default_landing_view, "view-default");
        assert_eq!(updated.max_active_script_widgets, 20);
        assert!(updated.allow_widget_network_tools);

        let reloaded = storage
            .dashboard_settings()
            .expect("dashboard settings reload");
        assert!(!reloaded.confirm_remove);
        assert_eq!(reloaded.default_landing_view, "view-default");
        assert_eq!(reloaded.max_active_script_widgets, 20);
        assert!(reloaded.allow_widget_network_tools);

        // Out-of-range values are rejected at the storage boundary.
        let too_low = storage.update_dashboard_settings(DashboardSettings {
            confirm_remove: true,
            default_landing_view: "lastActive".to_string(),
            max_active_script_widgets: 0,
            allow_widget_network_tools: true,
        });
        assert!(too_low.is_err(), "0 must be rejected");
        let too_high = storage.update_dashboard_settings(DashboardSettings {
            confirm_remove: true,
            default_landing_view: "lastActive".to_string(),
            max_active_script_widgets: 101,
            allow_widget_network_tools: true,
        });
        assert!(too_high.is_err(), "101 must be rejected");
    }

    #[test]
    fn database_backup_import_restores_app_launcher_settings() {
        let db_path = temp_db_path("database-export-import-app-launcher");
        let storage = Storage::open(db_path).expect("storage opens");
        storage
            .update_app_launcher_settings(AppLauncherSettings {
                entries: vec![AppLauncherEntry {
                    id: "launcher-entry".to_string(),
                    name: "Portable Tool".to_string(),
                    path: "Z:\\missing\\tool.exe".to_string(),
                    arguments: None,
                    working_directory: None,
                    icon_data_url: None,
                    rail_pinned: true,
                    created_at: "2026-05-11T00:00:00Z".to_string(),
                    updated_at: "2026-05-11T00:00:00Z".to_string(),
                }],
                view_mode: "list".to_string(),
                list_sort: AppLauncherSortState {
                    field: "name".to_string(),
                    direction: "desc".to_string(),
                },
                details_sort: default_app_launcher_details_sort(),
            })
            .expect("app launcher settings update");

        let backup = storage.backup_database().expect("database backup succeeds");
        storage
            .update_app_launcher_settings(AppLauncherSettings {
                entries: Vec::new(),
                view_mode: "icons".to_string(),
                list_sort: default_app_launcher_list_sort(),
                details_sort: default_app_launcher_details_sort(),
            })
            .expect("app launcher settings changes after export");

        let imported = storage
            .import_database_zip(PathBuf::from(&backup.path))
            .expect("database imports");

        assert_eq!(imported.app_launcher_settings.entries.len(), 1);
        assert_eq!(
            imported.app_launcher_settings.entries[0].id,
            "launcher-entry"
        );
        assert_eq!(
            imported.app_launcher_settings.entries[0].path,
            "Z:\\missing\\tool.exe"
        );
        assert!(imported.app_launcher_settings.entries[0].rail_pinned);
    }

    #[test]
    fn database_backup_import_restores_settings_and_connections() {
        let db_path = temp_db_path("database-export-import");
        let storage = Storage::open(db_path).expect("storage opens");
        storage
            .update_general_settings(GeneralSettings {
                auto_backup_enabled: false,
                auto_update_checks_enabled: true,
                show_connected_connections_in_rail: true,
                pinned_connection_ids: vec!["connection-pinned".to_string()],
                allow_clipboard_read: true,
                auto_start_with_windows: true,
                minimize_to_tray: true,
                dont_sleep_enabled: true,
                last_backup_at: None,
            })
            .expect("general settings update");
        let connection = create_test_ssh_connection(&storage, "Prod SSH", "prod.internal", None);

        let backup = storage.backup_database().expect("database backup succeeds");
        storage
            .update_general_settings(GeneralSettings {
                auto_backup_enabled: true,
                auto_update_checks_enabled: true,
                show_connected_connections_in_rail: false,
                pinned_connection_ids: Vec::new(),
                allow_clipboard_read: false,
                auto_start_with_windows: false,
                minimize_to_tray: false,
                dont_sleep_enabled: false,
                last_backup_at: None,
            })
            .expect("general settings changes after export");
        storage
            .delete_connection(connection.id.clone())
            .expect("connection can be removed before import");

        let imported = storage
            .import_database_zip(PathBuf::from(&backup.path))
            .expect("database imports");

        assert!(!imported.general_settings.auto_backup_enabled);
        assert!(imported.general_settings.show_connected_connections_in_rail);
        assert_eq!(
            imported.general_settings.pinned_connection_ids,
            vec!["connection-pinned".to_string()]
        );
        assert!(imported.general_settings.minimize_to_tray);
        assert!(imported.general_settings.dont_sleep_enabled);
        assert_eq!(
            imported.general_settings.last_backup_at.as_deref(),
            Some(imported.backup.created_at.as_str())
        );
        assert_eq!(imported.connection_tree.connections.len(), 1);
        assert_eq!(imported.connection_tree.connections[0].id, connection.id);
        assert!(Path::new(&imported.backup.path).exists());
        assert!(imported.backup.filename.ends_with(".zip"));
    }

    #[test]
    fn database_backup_zip_is_serialized_and_importable() {
        let db_path = temp_db_path("database-backup-importable");
        let storage = Storage::open(db_path).expect("storage opens");
        let connection = create_test_ssh_connection(&storage, "Prod SSH", "prod.internal", None);

        let first_backup = storage.backup_database().expect("database backup succeeds");
        let second_backup = storage
            .backup_database()
            .expect("second database backup succeeds");

        assert_ne!(first_backup.filename, second_backup.filename);
        assert!(backup_filename_has_serial(&first_backup.filename));
        assert!(backup_filename_has_serial(&second_backup.filename));
        assert!(Path::new(&first_backup.path).exists());
        assert!(Path::new(&second_backup.path).exists());
        let settings = storage
            .general_settings()
            .expect("general settings reloads after backup");
        assert_eq!(
            settings.last_backup_at.as_deref(),
            Some(second_backup.created_at.as_str())
        );

        storage
            .delete_connection(connection.id.clone())
            .expect("connection can be removed before import");

        let imported = storage
            .import_database_zip(PathBuf::from(&first_backup.path))
            .expect("backup imports");

        assert_eq!(imported.connection_tree.connections.len(), 1);
        assert_eq!(imported.connection_tree.connections[0].id, connection.id);
    }

    #[test]
    fn terminal_settings_round_trip_through_settings_table() {
        let storage = Storage::open(temp_db_path("terminal-settings")).expect("storage opens");

        let defaults = storage
            .terminal_settings()
            .expect("default terminal settings load");
        assert_eq!(defaults.font_size, 12);
        assert_eq!(defaults.scrollback_lines, 5_000);
        assert!(defaults.confirm_multiline_paste);

        let updated = storage
            .update_terminal_settings(TerminalSettings {
                font_family: "Cascadia Mono".to_string(),
                font_size: 14,
                line_height: 1.35,
                cursor_style: "bar".to_string(),
                scrollback_lines: 5_000,
                copy_on_select: true,
                allow_osc52_clipboard: true,
                confirm_multiline_paste: false,
                default_shell: "pwsh.exe".to_string(),
            })
            .expect("terminal settings update");

        assert_eq!(updated.cursor_style, "bar");
        assert!(updated.copy_on_select);

        let reloaded = storage
            .terminal_settings()
            .expect("terminal settings reload");
        assert_eq!(reloaded.font_family, "Cascadia Mono");
        assert_eq!(reloaded.default_shell, "pwsh.exe");
    }

    #[test]
    fn appearance_settings_round_trip_through_settings_table() {
        let db_path = temp_db_path("appearance-settings");
        let storage = Storage::open(db_path.clone()).expect("storage opens");

        let defaults = storage
            .appearance_settings()
            .expect("default appearance settings load");
        assert!(defaults.app_font_family.contains("Inter"));

        let updated = storage
            .update_appearance_settings(AppearanceSettings {
                app_font_family: "  \"Custom UI Font\", \"Segoe UI\", sans-serif  ".to_string(),
                color_scheme: "dark".to_string(),
                custom_font_path: Some("  C:/KKTerm/fonts/custom.ttf  ".to_string()),
            })
            .expect("appearance settings update");

        assert_eq!(
            updated.app_font_family,
            "\"Custom UI Font\", \"Segoe UI\", sans-serif"
        );
        assert_eq!(
            updated.custom_font_path.as_deref(),
            Some("C:/KKTerm/fonts/custom.ttf")
        );

        drop(storage);

        let reopened = Storage::open(db_path).expect("storage reopens after app restart");
        let reloaded = reopened
            .appearance_settings()
            .expect("appearance settings reload after restart");
        assert_eq!(reloaded.app_font_family, updated.app_font_family);
    }

    #[test]
    fn ssh_settings_round_trip_through_settings_table() {
        let storage = Storage::open(temp_db_path("ssh-settings")).expect("storage opens");

        let defaults = storage.ssh_settings().expect("default SSH settings load");
        assert_eq!(defaults.default_port, 22);
        assert_eq!(defaults.buffer_lines, 5_000);
        assert!(defaults.hide_common_port_redirects);
        assert!(defaults.allow_osc52_clipboard);
        assert!(defaults.default_key_path.is_some());

        let updated = storage
            .update_ssh_settings(SshSettings {
                default_user: "deploy".to_string(),
                default_port: 2200,
                default_key_path: Some("  C:\\Users\\ryan\\.ssh\\deploy_ed25519  ".to_string()),
                default_proxy_jump: Some("  bastion.internal  ".to_string()),
                buffer_lines: 12_000,
                hide_common_port_redirects: false,
                allow_osc52_clipboard: false,
            })
            .expect("SSH settings update");

        assert_eq!(updated.default_user, "deploy");
        assert_eq!(
            updated.default_key_path.as_deref(),
            Some("C:\\Users\\ryan\\.ssh\\deploy_ed25519")
        );

        let reloaded = storage.ssh_settings().expect("SSH settings reload");
        assert_eq!(reloaded.default_port, 2200);
        assert_eq!(reloaded.buffer_lines, 12_000);
        assert!(!reloaded.hide_common_port_redirects);
        assert!(!reloaded.allow_osc52_clipboard);
        assert_eq!(
            reloaded.default_proxy_jump.as_deref(),
            Some("bastion.internal")
        );
    }

    #[test]
    fn sftp_settings_round_trip_through_settings_table() {
        let storage = Storage::open(temp_db_path("sftp-settings")).expect("storage opens");

        let defaults = storage.sftp_settings().expect("default SFTP settings load");
        assert_eq!(defaults.overwrite_behavior, "fail");

        let updated = storage
            .update_sftp_settings(SftpSettings {
                overwrite_behavior: "  REPLACE  ".to_string(),
            })
            .expect("SFTP settings update");

        assert_eq!(updated.overwrite_behavior, "overwrite");

        let reloaded = storage.sftp_settings().expect("SFTP settings reload");
        assert_eq!(reloaded.overwrite_behavior, "overwrite");
    }

    #[test]
    fn url_settings_round_trip_through_settings_table() {
        let storage = Storage::open(temp_db_path("url-settings")).expect("storage opens");

        let defaults = storage.url_settings().expect("default URL settings load");
        assert!(!defaults.ignore_certificate_errors);

        let updated = storage
            .update_url_settings(UrlSettings {
                ignore_certificate_errors: true,
            })
            .expect("URL settings update");

        assert!(updated.ignore_certificate_errors);

        let reloaded = storage.url_settings().expect("URL settings reload");
        assert!(reloaded.ignore_certificate_errors);
    }

    #[test]
    fn rdp_and_vnc_settings_round_trip_through_settings_table() {
        let storage =
            Storage::open(temp_db_path("remote-desktop-settings")).expect("storage opens");

        let rdp_defaults = storage.rdp_settings().expect("default RDP settings load");
        assert_eq!(rdp_defaults.color_depth, 32);
        assert!(rdp_defaults.redirect_clipboard);
        assert!(!rdp_defaults.redirect_drives);

        storage
            .update_rdp_settings(RdpSettings {
                color_depth: 24,
                redirect_clipboard: false,
                redirect_drives: true,
                bitmap_cache: true,
                performance_profile: "quality".to_string(),
            })
            .expect("RDP settings update");

        let rdp_reloaded = storage.rdp_settings().expect("RDP settings reload");
        assert_eq!(rdp_reloaded.color_depth, 24);
        assert!(!rdp_reloaded.redirect_clipboard);
        assert!(rdp_reloaded.redirect_drives);
        assert_eq!(rdp_reloaded.performance_profile, "quality");

        let vnc_defaults = storage.vnc_settings().expect("default VNC settings load");
        assert!(vnc_defaults.shared_session);
        assert_eq!(vnc_defaults.color_level, "full");

        storage
            .update_vnc_settings(VncSettings {
                shared_session: false,
                view_only: true,
                color_level: "256".to_string(),
                preferred_encoding: "raw".to_string(),
            })
            .expect("VNC settings update");

        let vnc_reloaded = storage.vnc_settings().expect("VNC settings reload");
        assert!(!vnc_reloaded.shared_session);
        assert!(vnc_reloaded.view_only);
        assert_eq!(vnc_reloaded.color_level, "256");
        assert_eq!(vnc_reloaded.preferred_encoding, "raw");
    }

    #[test]
    fn remote_desktop_connection_options_are_optional_protocol_overrides() {
        let storage = Storage::open(temp_db_path("remote-desktop-connection-options"))
            .expect("storage opens");

        let rdp = storage
            .create_connection(CreateConnectionRequest {
                name: "Jumpbox".to_string(),
                host: "jumpbox.internal".to_string(),
                user: "DOMAIN\\admin".to_string(),
                connection_type: "rdp".to_string(),
                folder_id: None,
                port: Some(3389),
                key_path: None,
                proxy_jump: None,
                auth_method: None,
                local_shell: None,
                local_startup_directory: None,
                local_startup_script: None,
                url: None,
                data_partition: None,
                use_tmux_sessions: None,
                serial_line: None,
                serial_speed: None,
                rdp_options: Some(RdpConnectionOptions {
                    inherit_defaults: false,
                    color_depth: Some(24),
                    redirect_clipboard: Some(false),
                    redirect_drives: Some(true),
                    bitmap_cache: Some(true),
                    performance_profile: Some("quality".to_string()),
                }),
                vnc_options: Some(VncConnectionOptions {
                    inherit_defaults: false,
                    shared_session: Some(false),
                    view_only: Some(true),
                    color_level: Some("256".to_string()),
                    preferred_encoding: Some("raw".to_string()),
                }),
                ftp_options: None,
            })
            .expect("RDP connection with options is created");

        assert_eq!(rdp.connection_type, "rdp");
        assert!(rdp.rdp_options.is_some());
        assert!(rdp.vnc_options.is_none());

        let vnc = storage
            .create_connection(CreateConnectionRequest {
                name: "Console".to_string(),
                host: "console.internal".to_string(),
                user: "".to_string(),
                connection_type: "vnc".to_string(),
                folder_id: None,
                port: Some(5900),
                key_path: None,
                proxy_jump: None,
                auth_method: None,
                local_shell: None,
                local_startup_directory: None,
                local_startup_script: None,
                url: None,
                data_partition: None,
                use_tmux_sessions: None,
                serial_line: None,
                serial_speed: None,
                rdp_options: Some(RdpConnectionOptions {
                    inherit_defaults: false,
                    color_depth: Some(24),
                    redirect_clipboard: Some(false),
                    redirect_drives: Some(true),
                    bitmap_cache: Some(true),
                    performance_profile: Some("quality".to_string()),
                }),
                vnc_options: Some(VncConnectionOptions {
                    inherit_defaults: false,
                    shared_session: Some(false),
                    view_only: Some(true),
                    color_level: Some("256".to_string()),
                    preferred_encoding: Some("raw".to_string()),
                }),
                ftp_options: None,
            })
            .expect("VNC connection with options is created");

        assert_eq!(vnc.connection_type, "vnc");
        assert!(vnc.rdp_options.is_none());
        assert!(vnc.vnc_options.is_some());

        let tree = storage.list_connection_tree().expect("tree reloads");
        let saved_rdp = tree
            .connections
            .iter()
            .find(|connection| connection.id == rdp.id)
            .expect("RDP connection is listed");
        assert_eq!(
            saved_rdp
                .rdp_options
                .as_ref()
                .and_then(|options| options.color_depth),
            Some(24)
        );
    }

    #[test]
    fn ai_provider_settings_round_trip_through_settings_table() {
        let storage = Storage::open(temp_db_path("ai-provider-settings")).expect("storage opens");

        let defaults = storage
            .ai_provider_settings()
            .expect("default AI provider settings load");
        assert!(!defaults.enabled);
        assert_eq!(defaults.provider_kind, "openai");
        assert_eq!(defaults.base_url, "https://api.openai.com/v1");
        assert_eq!(defaults.model, "gpt-5.4-mini");
        assert_eq!(defaults.reasoning_effort, "medium");
        assert_eq!(defaults.custom_instructions, "");
        assert_eq!(defaults.api_mode, "chatCompletions");
        assert_eq!(defaults.extra_headers, "");
        assert_eq!(defaults.cli_execution_policy, "suggestOnly");
        assert_eq!(defaults.tool_permission_mode, "prompt");
        assert!(!defaults.allow_insecure_tls);
        assert!(!defaults.show_all_models);
        assert!(defaults.tools.web_search());
        assert!(defaults.tools.web_fetch());
        assert!(defaults.tools.shell_command());
        assert!(defaults.tools.app_data_file_search());
        assert!(defaults.tools.app_data_file_read());
        assert!(defaults.tools.current_time());
        assert!(defaults.tools.performance_counters());
        assert!(defaults.tools.dashboard());
        assert!(defaults.tools.connections());
        assert!(defaults.tools.sessions());
        assert!(defaults.tools.tutorial());
        assert!(defaults.tools.manual());
        assert!(!defaults.tools.email());

        let updated = storage
            .update_ai_provider_settings(AiProviderSettings {
                enabled: true,
                provider_kind: "  OpenRouter  ".to_string(),
                base_url: "  https://llm-gateway.internal/v1/  ".to_string(),
                model: " openai/gpt-5.5 ".to_string(),
                reasoning_effort: " XHIGH ".to_string(),
                output_language: String::new(),
                custom_instructions: String::new(),
                api_mode: " responses ".to_string(),
                extra_headers: "  sid=1, \"env\"=\"3\"  ".to_string(),
                allow_insecure_tls: true,
                show_all_models: true,
                cli_execution_policy: "suggest-only".to_string(),
                tool_permission_mode: " Allow All ".to_string(),
                claude_cli_path: Some("  C:\\Tools\\claude.exe  ".to_string()),
                codex_cli_path: Some("  codex  ".to_string()),
                disabled_skill_names: vec!["ssh-helper".to_string(), "bad name".to_string()],
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
            })
            .expect("AI provider settings update");

        assert!(updated.enabled);
        assert_eq!(updated.provider_kind, "openrouter");
        assert_eq!(updated.base_url, "https://llm-gateway.internal/v1");
        assert_eq!(updated.model, "openai/gpt-5.5");
        assert_eq!(updated.reasoning_effort, "max");
        assert_eq!(updated.api_mode, "responses");
        assert_eq!(updated.extra_headers, "sid=1, \"env\"=\"3\"");
        assert_eq!(updated.cli_execution_policy, "suggestOnly");
        assert_eq!(updated.tool_permission_mode, "allowAll");
        assert!(updated.allow_insecure_tls);
        assert!(updated.show_all_models);
        assert_eq!(
            updated.claude_cli_path.as_deref(),
            Some("C:\\Tools\\claude.exe")
        );
        assert_eq!(updated.codex_cli_path.as_deref(), Some("codex"));
        assert_eq!(updated.disabled_skill_names, vec!["ssh-helper".to_string()]);

        let reloaded = storage
            .ai_provider_settings()
            .expect("AI provider settings reload");
        assert_eq!(reloaded.base_url, "https://llm-gateway.internal/v1");
        assert_eq!(reloaded.model, "openai/gpt-5.5");
        assert_eq!(reloaded.reasoning_effort, "max");
        assert_eq!(reloaded.api_mode, "responses");
        assert_eq!(reloaded.extra_headers, "sid=1, \"env\"=\"3\"");
        assert_eq!(reloaded.tool_permission_mode, "allowAll");
        assert!(reloaded.allow_insecure_tls);
        assert!(reloaded.show_all_models);
    }

    #[test]
    fn stored_credential_candidates_include_one_ai_key_owner_per_provider() {
        let storage = Storage::open(temp_db_path("ai-provider-credential-candidates"))
            .expect("storage opens");

        let candidates = storage
            .list_stored_credential_candidates()
            .expect("credential candidates load");
        let ai_candidates = candidates
            .iter()
            .filter(|candidate| candidate.kind == "aiApiKey")
            .collect::<Vec<_>>();

        assert!(ai_candidates
            .iter()
            .any(|candidate| candidate.owner_id == "ai-provider:openai"));
        assert!(ai_candidates
            .iter()
            .any(|candidate| candidate.owner_id == "ai-provider:openrouter"));
        assert!(ai_candidates.len() > 1);
    }

    #[test]
    fn ai_provider_settings_reject_invalid_tool_permission_mode() {
        let storage =
            Storage::open(temp_db_path("ai-provider-tool-permission-mode")).expect("storage opens");

        let error = storage
            .update_ai_provider_settings(AiProviderSettings {
                enabled: true,
                provider_kind: "openai".to_string(),
                base_url: "https://api.openai.com/v1".to_string(),
                model: "gpt-5.5".to_string(),
                reasoning_effort: "medium".to_string(),
                output_language: String::new(),
                custom_instructions: String::new(),
                api_mode: default_ai_api_mode(),
                extra_headers: String::new(),
                allow_insecure_tls: false,
                show_all_models: false,
                cli_execution_policy: "suggestOnly".to_string(),
                tool_permission_mode: "autoDeleteEverything".to_string(),
                claude_cli_path: None,
                codex_cli_path: None,
                disabled_skill_names: Vec::new(),
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
            })
            .expect_err("unknown tool permission mode is rejected");

        assert_eq!(error, "AI tool permission mode must be prompt or allowAll");
    }

    #[test]
    fn ai_provider_settings_reject_invalid_base_url() {
        let storage = Storage::open(temp_db_path("ai-provider-invalid")).expect("storage opens");

        let error = storage
            .update_ai_provider_settings(AiProviderSettings {
                enabled: true,
                provider_kind: "openai".to_string(),
                base_url: "api.openai.com/v1".to_string(),
                model: "gpt-5.5".to_string(),
                reasoning_effort: "medium".to_string(),
                output_language: String::new(),
                custom_instructions: String::new(),
                api_mode: default_ai_api_mode(),
                extra_headers: String::new(),
                allow_insecure_tls: false,
                show_all_models: false,
                cli_execution_policy: "suggestOnly".to_string(),
                tool_permission_mode: "prompt".to_string(),
                claude_cli_path: None,
                codex_cli_path: None,
                disabled_skill_names: Vec::new(),
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
            })
            .expect_err("scheme-less endpoint is rejected");

        assert_eq!(
            error,
            "AI provider endpoint must start with https:// or http://"
        );
    }

    #[test]
    fn ai_provider_settings_reject_blank_model() {
        let storage =
            Storage::open(temp_db_path("ai-provider-blank-model")).expect("storage opens");

        let error = storage
            .update_ai_provider_settings(AiProviderSettings {
                enabled: true,
                provider_kind: "openai".to_string(),
                base_url: "https://api.openai.com/v1".to_string(),
                model: "   ".to_string(),
                reasoning_effort: "medium".to_string(),
                output_language: String::new(),
                custom_instructions: String::new(),
                api_mode: default_ai_api_mode(),
                extra_headers: String::new(),
                allow_insecure_tls: false,
                show_all_models: false,
                cli_execution_policy: "suggestOnly".to_string(),
                tool_permission_mode: "prompt".to_string(),
                claude_cli_path: None,
                codex_cli_path: None,
                disabled_skill_names: Vec::new(),
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
            })
            .expect_err("blank model is rejected");

        assert_eq!(error, "AI model is required");
    }

    #[test]
    fn ai_provider_settings_trim_and_limit_custom_instructions() {
        let storage =
            Storage::open(temp_db_path("ai-provider-custom-instructions")).expect("storage opens");

        let updated = storage
            .update_ai_provider_settings(AiProviderSettings {
                enabled: true,
                provider_kind: "openai".to_string(),
                base_url: "https://api.openai.com/v1".to_string(),
                model: "gpt-5.5".to_string(),
                reasoning_effort: "medium".to_string(),
                output_language: String::new(),
                custom_instructions: "  Prefer concise PowerShell examples.  ".to_string(),
                api_mode: default_ai_api_mode(),
                extra_headers: String::new(),
                allow_insecure_tls: false,
                show_all_models: false,
                cli_execution_policy: "suggestOnly".to_string(),
                tool_permission_mode: "prompt".to_string(),
                claude_cli_path: None,
                codex_cli_path: None,
                disabled_skill_names: Vec::new(),
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
            })
            .expect("custom instructions update");

        assert_eq!(
            updated.custom_instructions,
            "Prefer concise PowerShell examples."
        );

        let error = storage
            .update_ai_provider_settings(AiProviderSettings {
                custom_instructions: "x".repeat(1001),
                ..updated
            })
            .expect_err("overlong custom instructions are rejected");

        assert_eq!(
            error,
            "AI Assistant custom instructions must be 1000 characters or fewer"
        );
    }

    #[test]
    fn ai_provider_settings_keep_cli_policy_suggest_only() {
        let storage = Storage::open(temp_db_path("ai-provider-cli-policy")).expect("storage opens");

        let error = storage
            .update_ai_provider_settings(AiProviderSettings {
                enabled: true,
                provider_kind: "openai".to_string(),
                base_url: "https://api.openai.com/v1".to_string(),
                model: "gpt-5.5".to_string(),
                reasoning_effort: "medium".to_string(),
                output_language: String::new(),
                custom_instructions: String::new(),
                api_mode: default_ai_api_mode(),
                extra_headers: String::new(),
                allow_insecure_tls: false,
                show_all_models: false,
                cli_execution_policy: "executeAutomatically".to_string(),
                tool_permission_mode: "prompt".to_string(),
                claude_cli_path: Some("claude".to_string()),
                codex_cli_path: Some("codex".to_string()),
                disabled_skill_names: Vec::new(),
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
            })
            .expect_err("auto-execution policy is rejected");

        assert_eq!(
            error,
            "CLI adapter policy must remain suggest-only for approval-based execution"
        );
    }

    #[test]
    fn main_window_settings_round_trip_through_settings_table() {
        let storage = Storage::open(temp_db_path("main-window-settings")).expect("storage opens");

        assert_eq!(
            storage
                .main_window_settings()
                .expect("missing main window settings load"),
            None
        );

        let updated = storage
            .update_main_window_settings(MainWindowSettings {
                width: 1440,
                height: 900,
                maximized: true,
            })
            .expect("main window settings update");

        assert_eq!(
            updated,
            MainWindowSettings {
                width: 1440,
                height: 900,
                maximized: true,
            }
        );
        assert_eq!(
            storage
                .main_window_settings()
                .expect("main window settings reload"),
            Some(updated)
        );
    }

    #[test]
    fn assistant_chat_history_round_trips_from_sqlite_by_recent_update() {
        let storage = Storage::open(temp_db_path("assistant-chat-history")).expect("storage opens");
        let older = AssistantChatThreadRecord {
            id: "thread-older".to_string(),
            title: "Older".to_string(),
            context_label: "Workspace".to_string(),
            messages_json: r#"[{"role":"user","content":"first"}]"#.to_string(),
            created_at: "2026-05-01T00:00:00Z".to_string(),
            updated_at: "2026-05-01T00:00:00Z".to_string(),
        };
        let newer = AssistantChatThreadRecord {
            id: "thread-newer".to_string(),
            title: "Newer".to_string(),
            context_label: "Dashboard".to_string(),
            messages_json: r#"[{"role":"user","content":"second"}]"#.to_string(),
            created_at: "2026-05-02T00:00:00Z".to_string(),
            updated_at: "2026-05-03T00:00:00Z".to_string(),
        };

        storage
            .upsert_assistant_chat_thread(older.clone())
            .expect("older thread saved");
        storage
            .upsert_assistant_chat_thread(newer.clone())
            .expect("newer thread saved");

        let threads = storage
            .list_assistant_chat_threads()
            .expect("assistant chat history loads");
        assert_eq!(threads.len(), 2);
        assert_eq!(threads[0].id, newer.id);
        assert_eq!(threads[1].id, older.id);

        storage
            .delete_assistant_chat_thread(newer.id.clone())
            .expect("newer thread deleted");
        let threads = storage
            .list_assistant_chat_threads()
            .expect("assistant chat history reloads");
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].id, older.id);
    }

    #[test]
    fn assistant_chat_history_schema_has_list_indexes() {
        let storage = Storage::open(temp_db_path("assistant-chat-indexes")).expect("storage opens");
        let connection = storage.lock().expect("storage lock");
        let indexes = connection
            .prepare(
                "SELECT name FROM sqlite_master
                 WHERE type = 'index' AND tbl_name = 'assistant_chat_threads'
                 ORDER BY name",
            )
            .expect("index query prepares")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("index query runs")
            .collect::<Result<Vec<_>, _>>()
            .expect("indexes collect");

        assert!(indexes.contains(&"idx_assistant_chat_threads_created_at".to_string()));
        assert!(indexes.contains(&"idx_assistant_chat_threads_updated_at".to_string()));
    }

    fn temp_db_path(name: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock is after Unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("kkterm-storage-{name}-{unique}"));
        fs::create_dir_all(&dir).expect("temp directory is created");
        dir.join("kkterm.sqlite3")
    }
}
