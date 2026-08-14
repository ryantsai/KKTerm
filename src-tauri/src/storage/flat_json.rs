use super::*;
use serde::de::DeserializeOwned;

pub(crate) const ASSISTANT_CHAT_THREADS_DIR: &str = "assistant-chat-threads";
pub(crate) const SYSTEM_CLEANER_HISTORY_DIR: &str = "system-cleaner-history";
const ASSISTANT_INDEX_FILE: &str = "index.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantChatThreadSummaryRecord {
    pub id: String,
    pub title: String,
    pub context_label: String,
    pub preview: String,
    pub created_at: String,
    pub updated_at: String,
}

impl Storage {
    pub fn list_assistant_chat_thread_summaries(
        &self,
    ) -> Result<Vec<AssistantChatThreadSummaryRecord>, String> {
        let mut summaries = {
            let connection = self.lock()?;
            read_assistant_summaries_from_sql(&connection)?
        };
        let _guard = self.lock_flat_json()?;
        let file_summaries: Vec<AssistantChatThreadSummaryRecord> =
            read_json_or_default(&self.assistant_index_path())?;
        summaries.extend(file_summaries);
        summaries.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| right.created_at.cmp(&left.created_at))
        });
        let mut seen = std::collections::HashSet::new();
        summaries.retain(|summary| seen.insert(summary.id.clone()));
        Ok(summaries)
    }

    pub fn get_assistant_chat_thread(
        &self,
        thread_id: String,
    ) -> Result<AssistantChatThreadRecord, String> {
        let thread_id = required_field("assistant chat thread id", thread_id)?;
        let path = self.assistant_thread_path(&thread_id);
        if path.exists() {
            let _guard = self.lock_flat_json()?;
            return read_json(&path);
        }
        let connection = self.lock()?;
        connection
            .query_row(
                "SELECT id, title, context_label, messages_json, created_at, updated_at
                 FROM assistant_chat_threads WHERE id = ?1",
                [&thread_id],
                assistant_chat_thread_from_row,
            )
            .map_err(to_storage_error)
    }

    pub fn list_assistant_chat_threads(&self) -> Result<Vec<AssistantChatThreadRecord>, String> {
        let mut records = {
            let connection = self.lock()?;
            read_assistant_threads_from_sql(&connection)?
        };
        let _guard = self.lock_flat_json()?;
        let summaries: Vec<AssistantChatThreadSummaryRecord> =
            read_json_or_default(&self.assistant_index_path())?;
        for summary in summaries {
            records.retain(|record| record.id != summary.id);
            records.push(read_json(&self.assistant_thread_path(&summary.id))?);
        }
        records.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| right.created_at.cmp(&left.created_at))
        });
        Ok(records)
    }

    pub fn upsert_assistant_chat_thread(
        &self,
        request: AssistantChatThreadRecord,
    ) -> Result<AssistantChatThreadRecord, String> {
        let thread = validate_assistant_chat_thread(request)?;
        {
            let connection = self.lock()?;
            let legacy_exists: bool = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM assistant_chat_threads WHERE id = ?1)",
                    [&thread.id],
                    |row| row.get(0),
                )
                .map_err(to_storage_error)?;
            if legacy_exists {
                connection
                    .execute(
                        "UPDATE assistant_chat_threads
                         SET title = ?2, context_label = ?3, messages_json = ?4,
                             created_at = ?5, updated_at = ?6
                         WHERE id = ?1",
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
                return Ok(thread);
            }
        }
        let _guard = self.lock_flat_json()?;
        self.merge_assistant_threads_locked(&[thread.clone()])?;
        Ok(thread)
    }

    pub fn delete_assistant_chat_thread(&self, thread_id: String) -> Result<(), String> {
        let thread_id = required_field("assistant chat thread id", thread_id)?;
        {
            let connection = self.lock()?;
            connection
                .execute(
                    "DELETE FROM assistant_chat_threads WHERE id = ?1",
                    [&thread_id],
                )
                .map_err(to_storage_error)?;
        }
        let _guard = self.lock_flat_json()?;
        let mut summaries: Vec<AssistantChatThreadSummaryRecord> =
            read_json_or_default(&self.assistant_index_path())?;
        summaries.retain(|summary| summary.id != thread_id);
        write_json_atomic(&self.assistant_index_path(), &summaries)?;
        remove_file_if_exists(&self.assistant_thread_path(&thread_id))
    }

    pub(crate) fn system_cleaner_record_history(
        &self,
        record: &SystemCleanerHistoryRecord,
    ) -> Result<(), String> {
        let _guard = self.lock_flat_json()?;
        fs::create_dir_all(self.system_cleaner_history_dir()).map_err(|error| {
            format!("failed to create System Cleaner history directory: {error}")
        })?;
        write_json_atomic(&self.system_cleaner_history_path(&record.id), record)
    }

    pub(crate) fn system_cleaner_history(
        &self,
        limit: usize,
    ) -> Result<Vec<SystemCleanerHistoryRecord>, String> {
        let _guard = self.lock_flat_json()?;
        let directory = self.system_cleaner_history_dir();
        if !directory.exists() {
            return Ok(Vec::new());
        }
        let mut records = fs::read_dir(&directory)
            .map_err(|error| format!("failed to read System Cleaner history directory: {error}"))?
            .filter_map(Result::ok)
            .filter(|entry| {
                entry.path().extension().and_then(|value| value.to_str()) == Some("json")
            })
            .map(|entry| read_json(&entry.path()))
            .collect::<Result<Vec<SystemCleanerHistoryRecord>, String>>()?;
        records.sort_by(|left, right| right.completed_at.cmp(&left.completed_at));
        records.truncate(limit.min(200));
        Ok(records)
    }

    pub(crate) fn migrate_system_cleaner_history_to_flat_json(
        &self,
        connection: &SqliteConnection,
    ) -> Result<(), String> {
        let _guard = self.lock_flat_json()?;
        let cleaner = read_system_cleaner_history_from_sql(connection)?;
        fs::create_dir_all(self.system_cleaner_history_dir()).map_err(|error| {
            format!("failed to create System Cleaner history directory: {error}")
        })?;
        for record in cleaner {
            write_json_atomic(&self.system_cleaner_history_path(&record.id), &record)?;
        }

        connection
            .execute("DELETE FROM system_cleaner_history", [])
            .map(|_| ())
            .map_err(to_storage_error)
    }

    pub(crate) fn flush_staged_assistant_chat_threads(
        &self,
        action: &str,
        imported_ids: &[String],
    ) -> Result<(), String> {
        let connection = self.lock()?;
        let records = if action == "replace" {
            read_assistant_threads_from_sql(&connection)?
        } else {
            read_assistant_threads_from_sql_ids(&connection, imported_ids)?
        };
        let _guard = self.lock_flat_json()?;
        if action == "replace" {
            self.replace_assistant_threads_locked(&records)?;
        } else {
            self.merge_assistant_threads_locked(&records)?;
        }
        for record in &records {
            connection
                .execute(
                    "DELETE FROM assistant_chat_threads WHERE id = ?1",
                    [&record.id],
                )
                .map_err(to_storage_error)?;
        }
        Ok(())
    }

    pub(crate) fn assistant_chat_threads_export_rows(
        &self,
    ) -> Result<Vec<serde_json::Value>, String> {
        Ok(self
            .list_assistant_chat_threads()?
            .into_iter()
            .map(|record| {
                serde_json::json!({
                    "id": record.id,
                    "title": record.title,
                    "context_label": record.context_label,
                    "messages_json": record.messages_json,
                    "created_at": record.created_at,
                    "updated_at": record.updated_at,
                })
            })
            .collect())
    }

    pub(crate) fn assistant_chat_threads_dir(&self) -> PathBuf {
        self.data_root().join(ASSISTANT_CHAT_THREADS_DIR)
    }

    pub(crate) fn system_cleaner_history_dir(&self) -> PathBuf {
        self.data_root().join(SYSTEM_CLEANER_HISTORY_DIR)
    }

    fn data_root(&self) -> &Path {
        self.db_path.parent().unwrap_or_else(|| Path::new("."))
    }

    fn assistant_index_path(&self) -> PathBuf {
        self.assistant_chat_threads_dir().join(ASSISTANT_INDEX_FILE)
    }

    fn assistant_thread_path(&self, id: &str) -> PathBuf {
        self.assistant_chat_threads_dir()
            .join(format!("{}.json", stable_json_record_name(id)))
    }

    fn system_cleaner_history_path(&self, id: &str) -> PathBuf {
        self.system_cleaner_history_dir()
            .join(format!("{}.json", stable_json_record_name(id)))
    }

    pub(super) fn lock_flat_json(&self) -> Result<std::sync::MutexGuard<'_, ()>, String> {
        self.flat_json_lock
            .lock()
            .map_err(|_| "flat JSON storage lock poisoned".to_string())
    }

    fn merge_assistant_threads_locked(
        &self,
        records: &[AssistantChatThreadRecord],
    ) -> Result<(), String> {
        let mut summaries: Vec<AssistantChatThreadSummaryRecord> =
            read_json_or_default(&self.assistant_index_path())?;
        for record in records {
            write_json_atomic(&self.assistant_thread_path(&record.id), record)?;
            summaries.retain(|summary| summary.id != record.id);
            summaries.push(assistant_summary(record));
        }
        summaries.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| right.created_at.cmp(&left.created_at))
        });
        write_json_atomic(&self.assistant_index_path(), &summaries)
    }

    fn replace_assistant_threads_locked(
        &self,
        records: &[AssistantChatThreadRecord],
    ) -> Result<(), String> {
        let directory = self.assistant_chat_threads_dir();
        fs::create_dir_all(&directory)
            .map_err(|error| format!("failed to create Assistant history directory: {error}"))?;
        let keep = records
            .iter()
            .map(|record| format!("{}.json", stable_json_record_name(&record.id)))
            .collect::<std::collections::HashSet<_>>();
        for record in records {
            write_json_atomic(&self.assistant_thread_path(&record.id), record)?;
        }
        let mut summaries = records.iter().map(assistant_summary).collect::<Vec<_>>();
        summaries.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        write_json_atomic(&self.assistant_index_path(), &summaries)?;
        for entry in fs::read_dir(&directory)
            .map_err(|error| format!("failed to read Assistant history directory: {error}"))?
            .filter_map(Result::ok)
        {
            let name = entry.file_name();
            if name != ASSISTANT_INDEX_FILE && !keep.contains(&name.to_string_lossy().to_string()) {
                remove_file_if_exists(&entry.path())?;
            }
        }
        Ok(())
    }
}

fn assistant_summary(record: &AssistantChatThreadRecord) -> AssistantChatThreadSummaryRecord {
    let preview = serde_json::from_str::<serde_json::Value>(&record.messages_json)
        .ok()
        .and_then(|messages| messages.as_array().and_then(|items| items.last()).cloned())
        .and_then(|message| {
            message
                .get("content")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        .unwrap_or_default()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    AssistantChatThreadSummaryRecord {
        id: record.id.clone(),
        title: record.title.clone(),
        context_label: record.context_label.clone(),
        preview: truncate_chars(&preview, 64),
        created_at: record.created_at.clone(),
        updated_at: record.updated_at.clone(),
    }
}

fn truncate_chars(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    value
        .chars()
        .take(limit.saturating_sub(3))
        .collect::<String>()
        + "..."
}

fn stable_json_record_name(id: &str) -> String {
    let digest = Sha256::digest(id.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn read_assistant_threads_from_sql(
    connection: &SqliteConnection,
) -> Result<Vec<AssistantChatThreadRecord>, String> {
    if !table_exists(connection, "assistant_chat_threads")? {
        return Ok(Vec::new());
    }
    let mut statement = connection
        .prepare(
            "SELECT id, title, context_label, messages_json, created_at, updated_at
             FROM assistant_chat_threads
             ORDER BY updated_at DESC, created_at DESC",
        )
        .map_err(to_storage_error)?;
    statement
        .query_map([], assistant_chat_thread_from_row)
        .map_err(to_storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_storage_error)
}

fn read_assistant_threads_from_sql_ids(
    connection: &SqliteConnection,
    ids: &[String],
) -> Result<Vec<AssistantChatThreadRecord>, String> {
    ids.iter()
        .map(|id| {
            connection
                .query_row(
                    "SELECT id, title, context_label, messages_json, created_at, updated_at
                     FROM assistant_chat_threads WHERE id = ?1",
                    [id],
                    assistant_chat_thread_from_row,
                )
                .map_err(to_storage_error)
        })
        .collect()
}

fn read_assistant_summaries_from_sql(
    connection: &SqliteConnection,
) -> Result<Vec<AssistantChatThreadSummaryRecord>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, title, context_label,
                    COALESCE(json_extract(messages_json, '$[#-1].content'), ''),
                    created_at, updated_at
             FROM assistant_chat_threads
             ORDER BY updated_at DESC, created_at DESC",
        )
        .map_err(to_storage_error)?;
    statement
        .query_map([], |row| {
            let preview: String = row.get(3)?;
            Ok(AssistantChatThreadSummaryRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                context_label: row.get(2)?,
                preview: truncate_chars(
                    &preview.split_whitespace().collect::<Vec<_>>().join(" "),
                    64,
                ),
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(to_storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_storage_error)
}

fn read_system_cleaner_history_from_sql(
    connection: &SqliteConnection,
) -> Result<Vec<SystemCleanerHistoryRecord>, String> {
    if !table_exists(connection, "system_cleaner_history")? {
        return Ok(Vec::new());
    }
    let mut statement = connection
        .prepare(
            "SELECT id, started_at, completed_at, origin, status,
                    recipe_versions_json, planned_bytes, freed_bytes,
                    deleted_items, skipped_items, details_json
             FROM system_cleaner_history
             ORDER BY completed_at DESC",
        )
        .map_err(to_storage_error)?;
    statement
        .query_map([], |row| {
            Ok(SystemCleanerHistoryRecord {
                id: row.get(0)?,
                started_at: row.get(1)?,
                completed_at: row.get(2)?,
                origin: row.get(3)?,
                status: row.get(4)?,
                recipe_versions_json: row.get(5)?,
                planned_bytes: row.get::<_, i64>(6)?.max(0) as u64,
                freed_bytes: row.get::<_, i64>(7)?.max(0) as u64,
                deleted_items: row.get::<_, i64>(8)?.max(0) as u64,
                skipped_items: row.get::<_, i64>(9)?.max(0) as u64,
                details_json: row.get(10)?,
            })
        })
        .map_err(to_storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_storage_error)
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("failed to read JSON file {}: {error}", path.display()))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("invalid JSON file {}: {error}", path.display()))
}

fn read_json_or_default<T: DeserializeOwned + Default>(path: &Path) -> Result<T, String> {
    match read_json(path) {
        Ok(value) => Ok(value),
        Err(_) if !path.exists() => Ok(T::default()),
        Err(error) => Err(error),
    }
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("JSON file path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "failed to create JSON directory {}: {error}",
            parent.display()
        )
    })?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("data.json"),
        std::process::id()
    ));
    let backup = parent.join(format!(
        ".{}.{}.bak",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("data.json"),
        std::process::id()
    ));
    remove_file_if_exists(&temporary)?;
    remove_file_if_exists(&backup)?;
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("failed to serialize {}: {error}", path.display()))?;
    {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| format!("failed to create {}: {error}", temporary.display()))?;
        file.write_all(&bytes)
            .map_err(|error| format!("failed to write {}: {error}", temporary.display()))?;
        file.sync_all()
            .map_err(|error| format!("failed to flush {}: {error}", temporary.display()))?;
    }
    let had_target = path.exists();
    if had_target {
        fs::rename(path, &backup).map_err(|error| {
            format!(
                "failed to stage {} for replacement: {error}",
                path.display()
            )
        })?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if had_target {
            let _ = fs::rename(&backup, path);
        }
        return Err(format!("failed to publish {}: {error}", path.display()));
    }
    if had_target {
        remove_file_if_exists(&backup)?;
    }
    Ok(())
}

pub(super) fn upgrade_imported_v63_history(
    database_path: &Path,
    cleaner_stage_dir: &Path,
) -> Result<(), String> {
    let connection = open_initialized_connection(database_path)?;
    let version: i32 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(to_storage_error)?;
    if version == SCHEMA_USER_VERSION {
        return Ok(());
    }
    if version != 63 {
        return Err(format!(
            "imported database schema version {version} does not match this app schema ({SCHEMA_USER_VERSION})"
        ));
    }
    fs::create_dir_all(cleaner_stage_dir).map_err(|error| {
        format!("failed to create staged System Cleaner history directory: {error}")
    })?;
    for record in read_system_cleaner_history_from_sql(&connection)? {
        let path = cleaner_stage_dir.join(format!("{}.json", stable_json_record_name(&record.id)));
        write_json_atomic(&path, &record)?;
    }
    connection
        .execute_batch(&format!(
            "DELETE FROM system_cleaner_history;
             PRAGMA user_version = {SCHEMA_USER_VERSION};
             VACUUM;"
        ))
        .map_err(to_storage_error)
}

pub(super) fn validate_flat_json_import(
    assistant_stage_dir: &Path,
    cleaner_stage_dir: &Path,
) -> Result<(), String> {
    let assistant_index = assistant_stage_dir.join(ASSISTANT_INDEX_FILE);
    let summaries: Vec<AssistantChatThreadSummaryRecord> = read_json_or_default(&assistant_index)?;
    let mut indexed_ids = std::collections::HashSet::new();
    for summary in summaries {
        if !indexed_ids.insert(summary.id.clone()) {
            return Err(format!(
                "Assistant import index contains duplicate id {}",
                summary.id
            ));
        }
        let path =
            assistant_stage_dir.join(format!("{}.json", stable_json_record_name(&summary.id)));
        let record: AssistantChatThreadRecord = read_json(&path)?;
        let record = validate_assistant_chat_thread(record)?;
        if record.id != summary.id {
            return Err(format!(
                "Assistant import record id {} does not match index id {}",
                record.id, summary.id
            ));
        }
    }
    if assistant_stage_dir.exists() {
        for entry in fs::read_dir(assistant_stage_dir)
            .map_err(|error| format!("failed to inspect staged Assistant history: {error}"))?
        {
            let entry = entry
                .map_err(|error| format!("failed to inspect staged Assistant entry: {error}"))?;
            if entry.file_name() == ASSISTANT_INDEX_FILE {
                continue;
            }
            let record: AssistantChatThreadRecord = read_json(&entry.path())?;
            let record = validate_assistant_chat_thread(record)?;
            if !indexed_ids.contains(&record.id) {
                return Err(format!(
                    "Assistant import record {} is missing from index.json",
                    record.id
                ));
            }
            let expected = format!("{}.json", stable_json_record_name(&record.id));
            if entry.file_name().to_string_lossy() != expected {
                return Err(format!(
                    "Assistant import record {} has an invalid filename",
                    record.id
                ));
            }
        }
    }
    if cleaner_stage_dir.exists() {
        for entry in fs::read_dir(cleaner_stage_dir)
            .map_err(|error| format!("failed to inspect staged System Cleaner history: {error}"))?
        {
            let entry = entry.map_err(|error| {
                format!("failed to inspect staged System Cleaner history entry: {error}")
            })?;
            let _: SystemCleanerHistoryRecord = read_json(&entry.path())?;
        }
    }
    Ok(())
}
