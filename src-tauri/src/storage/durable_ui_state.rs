use super::*;

impl Storage {
    /// Read one durable frontend UI-state value by key, or `None` when unset.
    pub fn get_durable_ui_state(&self, key: String) -> Result<Option<String>, String> {
        let key = required_field("durable UI state key", key)?;
        let connection = self.lock()?;
        connection
            .query_row(
                "SELECT value FROM durable_ui_state WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(to_storage_error)
    }

    /// List every durable UI-state entry whose key starts with `prefix`. An
    /// empty prefix returns all entries. Used by the frontend to hydrate its
    /// synchronous cache at startup.
    pub fn list_durable_ui_state(
        &self,
        prefix: String,
    ) -> Result<Vec<DurableUiStateRecord>, String> {
        let connection = self.lock()?;
        let pattern = format!("{}%", escape_like(&prefix));
        let mut statement = connection
            .prepare(
                "SELECT key, value FROM durable_ui_state
                 WHERE key LIKE ?1 ESCAPE '\\'
                 ORDER BY key ASC",
            )
            .map_err(to_storage_error)?;
        let rows = statement
            .query_map(params![pattern], |row| {
                Ok(DurableUiStateRecord {
                    key: row.get(0)?,
                    value: row.get(1)?,
                })
            })
            .map_err(to_storage_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(to_storage_error)
    }

    /// Upsert one durable UI-state value.
    pub fn set_durable_ui_state(&self, key: String, value: String) -> Result<(), String> {
        let key = required_field("durable UI state key", key)?;
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO durable_ui_state (key, value, updated_at)
                 VALUES (?1, ?2, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP",
                params![key, value],
            )
            .map_err(to_storage_error)?;
        Ok(())
    }

    /// Delete one durable UI-state entry. A missing key is a no-op.
    pub fn delete_durable_ui_state(&self, key: String) -> Result<(), String> {
        let key = required_field("durable UI state key", key)?;
        let connection = self.lock()?;
        connection
            .execute("DELETE FROM durable_ui_state WHERE key = ?1", params![key])
            .map_err(to_storage_error)?;
        Ok(())
    }

    /// Delete every durable UI-state entry whose key starts with `prefix`.
    /// Backs per-connection cleanup on delete ("quickCommands:<id>") and the
    /// Settings reset (whole namespaces). An empty prefix clears the table.
    pub fn delete_durable_ui_state_by_prefix(&self, prefix: String) -> Result<(), String> {
        let connection = self.lock()?;
        let pattern = format!("{}%", escape_like(&prefix));
        connection
            .execute(
                "DELETE FROM durable_ui_state WHERE key LIKE ?1 ESCAPE '\\'",
                params![pattern],
            )
            .map_err(to_storage_error)?;
        Ok(())
    }
}

/// Escape LIKE wildcards so a caller-supplied prefix matches literally.
fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}
