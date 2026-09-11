use super::*;

impl Storage {
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

    pub fn credential_settings(&self) -> Result<CredentialSettings, String> {
        self.credential_settings_with_default(None)
    }

    pub fn credential_settings_with_default(
        &self,
        default_secret_store: Option<&str>,
    ) -> Result<CredentialSettings, String> {
        let connection = self.lock()?;
        let value = connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'credentials'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(to_storage_error)?;

        match value {
            Some(value) => serde_json::from_str(&value)
                .map(validate_credential_settings)
                .map_err(|error| format!("credential settings are invalid: {error}"))?,
            None => {
                let mut settings = default_credential_settings();
                if let Some(secret_store) = default_secret_store {
                    settings.secret_store = secret_store.to_string();
                }
                validate_credential_settings(settings)
            }
        }
    }

    pub fn update_credential_settings(
        &self,
        request: CredentialSettings,
    ) -> Result<CredentialSettings, String> {
        let settings = validate_credential_settings(request)?;
        let value = serde_json::to_string(&settings)
            .map_err(|error| format!("failed to serialize credential settings: {error}"))?;
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO settings (key, value, updated_at)
                 VALUES ('credentials', ?1, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP",
                params![value],
            )
            .map_err(to_storage_error)?;
        Ok(settings)
    }

    pub(crate) fn prepare_for_portable_copy(&self) -> Result<(), String> {
        let mut general = self.general_settings()?;
        general.auto_start_with_windows = false;
        self.update_general_settings(general)?;

        let connection = self.lock()?;
        connection
            .execute("DELETE FROM settings WHERE key = 'credentials'", [])
            .map_err(to_storage_error)?;
        connection
            .execute("DELETE FROM encrypted_secret_store_entries", [])
            .map_err(to_storage_error)?;
        Ok(())
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

    pub(crate) fn record_last_backup_at(
        &self,
        created_at: &str,
    ) -> Result<GeneralSettings, String> {
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

    /// Absolute local paths the user pointed Settings or a saved Connection at.
    /// The Mac App Store build re-opens a security-scoped grant for each one at
    /// startup, which is what makes a stored path usable after a relaunch; other
    /// builds never call this.
    pub fn configured_local_paths(&self) -> Result<Vec<String>, String> {
        let mut paths = Vec::new();
        let mut push = |value: Option<String>| {
            if let Some(value) = value.map(|value| value.trim().to_string())
                && !value.is_empty()
                && !paths.contains(&value)
            {
                paths.push(value);
            }
        };

        push(Some(self.screenshot_settings()?.folder_path));
        push(self.general_settings()?.auto_backup_folder);
        push(self.appearance_settings()?.custom_font_path);
        let ssh = self.ssh_settings()?;
        push(ssh.default_key_path);
        push(ssh.x_server_path);

        // Saved SSH Connections keep their key beside the Connection, so the key
        // file needs its own grant before the next connect attempt reads it.
        let connection = self.lock()?;
        let mut statement = connection
            .prepare("SELECT key_path FROM connections WHERE key_path IS NOT NULL AND key_path <> ''")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        for row in rows {
            push(Some(row.map_err(|error| error.to_string())?));
        }

        Ok(paths)
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
}
