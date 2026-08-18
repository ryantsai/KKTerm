use super::*;

/// Directory under the app data root holding note images, one subdirectory per
/// Connection. Images live on the filesystem rather than in SQLite so the
/// database stays small and the files travel through the same backup/export
/// path as Assistant chats and System Cleaner history.
pub(crate) const NOTE_IMAGES_DIR: &str = "note-images";

/// Hard cap on a single note's HTML payload. Notes are operator jottings —
/// paths, restart commands, reminders — not documents, and images live beside
/// the note rather than inline, so this bounds the row without limiting
/// realistic use.
const MAX_NOTE_HTML_BYTES: usize = 2 * 1024 * 1024;

/// Hard cap on a single embedded image. The frontend downscales before upload;
/// this is the backend's independent guard.
const MAX_NOTE_ASSET_BYTES: usize = 8 * 1024 * 1024;

/// Accepted image types and the extension each is stored under.
const ALLOWED_NOTE_ASSET_MIME: [(&str, &str); 5] = [
    ("image/png", "png"),
    ("image/jpeg", "jpg"),
    ("image/gif", "gif"),
    ("image/webp", "webp"),
    ("image/svg+xml", "svg"),
];

fn extension_for_mime(mime_type: &str) -> Option<&'static str> {
    ALLOWED_NOTE_ASSET_MIME
        .iter()
        .find(|(allowed, _)| *allowed == mime_type)
        .map(|(_, extension)| *extension)
}

fn mime_for_extension(extension: &str) -> Option<&'static str> {
    ALLOWED_NOTE_ASSET_MIME
        .iter()
        .find(|(_, allowed)| *allowed == extension)
        .map(|(mime, _)| *mime)
}

/// Reject anything that is not a plain content-addressed id. Asset ids come
/// from note HTML, which is user-editable, so they are never trusted as path
/// components without this check.
fn validate_asset_id(asset_id: &str) -> Result<(&str, &str), String> {
    let (connection_id, file_name) = asset_id
        .split_once('/')
        .ok_or_else(|| format!("malformed note image id {asset_id}"))?;
    let safe = |value: &str| {
        !value.is_empty()
            && value.len() <= 128
            && value
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
            && !value.contains("..")
    };
    if !safe(connection_id) || !safe(file_name) {
        return Err(format!("malformed note image id {asset_id}"));
    }
    Ok((connection_id, file_name))
}

impl Storage {
    /// Root directory holding every Connection's note images.
    pub(crate) fn note_images_dir(&self) -> PathBuf {
        self.db_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(NOTE_IMAGES_DIR)
    }

    fn note_images_dir_for(&self, connection_id: &str) -> PathBuf {
        self.note_images_dir().join(connection_id)
    }

    /// Read the note bound to a Connection, or `None` when that Connection has
    /// no note yet. The editor treats `None` as "unbound": it opens on a blank
    /// note and only binds once the user saves.
    pub fn get_connection_note(&self, connection_id: String) -> Result<Option<NoteRecord>, String> {
        let connection_id = required_field("note connection id", connection_id)?;
        let connection = self.lock()?;
        connection
            .query_row(
                "SELECT connection_id, content_html, created_at, updated_at
                 FROM connection_notes WHERE connection_id = ?1",
                params![connection_id],
                |row| {
                    Ok(NoteRecord {
                        connection_id: row.get(0)?,
                        content_html: row.get(1)?,
                        created_at: row.get(2)?,
                        updated_at: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(to_storage_error)
    }

    /// Ids of every Connection that currently owns a note. Pane toolbars use
    /// this to decide whether to draw the post-it icon in its "has note" state
    /// without loading note bodies.
    pub fn list_connection_note_ids(&self) -> Result<Vec<String>, String> {
        let connection = self.lock()?;
        let mut statement = connection
            .prepare("SELECT connection_id FROM connection_notes ORDER BY connection_id ASC")
            .map_err(to_storage_error)?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(to_storage_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(to_storage_error)
    }

    /// Create or update the note bound to a Connection. Saving is what binds a
    /// note to its Connection; the row's `created_at` survives later edits.
    pub fn save_connection_note(
        &self,
        connection_id: String,
        content_html: String,
    ) -> Result<NoteRecord, String> {
        let connection_id = required_field("note connection id", connection_id)?;
        if content_html.len() > MAX_NOTE_HTML_BYTES {
            return Err(format!(
                "note content exceeds the {MAX_NOTE_HTML_BYTES} byte limit"
            ));
        }
        let connection = self.lock()?;
        // A note may only bind to a Connection that exists, so a stale editor
        // cannot resurrect rows for a deleted Connection.
        if !connection_exists(&connection, &connection_id)? {
            return Err(format!("connection {connection_id} does not exist"));
        }
        connection
            .execute(
                "INSERT INTO connection_notes (connection_id, content_html, created_at, updated_at)
                 VALUES (?1, ?2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                 ON CONFLICT(connection_id) DO UPDATE SET
                    content_html = excluded.content_html,
                    updated_at = CURRENT_TIMESTAMP",
                params![connection_id, content_html],
            )
            .map_err(to_storage_error)?;
        connection
            .query_row(
                "SELECT connection_id, content_html, created_at, updated_at
                 FROM connection_notes WHERE connection_id = ?1",
                params![connection_id],
                |row| {
                    Ok(NoteRecord {
                        connection_id: row.get(0)?,
                        content_html: row.get(1)?,
                        created_at: row.get(2)?,
                        updated_at: row.get(3)?,
                    })
                },
            )
            .map_err(to_storage_error)
    }

    /// Unbind and delete a Connection's note along with its image directory.
    /// A Connection with no note is a no-op rather than an error.
    pub fn delete_connection_note(&self, connection_id: String) -> Result<(), String> {
        let connection_id = required_field("note connection id", connection_id)?;
        {
            let connection = self.lock()?;
            connection
                .execute(
                    "DELETE FROM connection_notes WHERE connection_id = ?1",
                    params![connection_id],
                )
                .map_err(to_storage_error)?;
        }
        self.remove_note_images_for(&connection_id)
    }

    /// Remove a Connection's whole note image directory. Used by note deletion
    /// and by Connection deletion; a missing directory is not an error.
    pub(crate) fn remove_note_images_for(&self, connection_id: &str) -> Result<(), String> {
        // Guard the path component even though it comes from the database, so a
        // hand-edited id can never escape the note image root.
        if validate_asset_id(&format!("{connection_id}/x")).is_err() {
            return Ok(());
        }
        let directory = self.note_images_dir_for(connection_id);
        if !directory.exists() {
            return Ok(());
        }
        fs::remove_dir_all(&directory).map_err(|error| {
            format!(
                "failed to remove note images at {}: {error}",
                directory.display()
            )
        })
    }

    /// Store one image embedded in a Connection's note, content-addressed by
    /// SHA-256 so pasting the same screenshot twice writes one file. Returns
    /// the asset id the note HTML references.
    pub fn put_note_asset(
        &self,
        connection_id: String,
        mime_type: String,
        bytes: Vec<u8>,
    ) -> Result<String, String> {
        let connection_id = required_field("note connection id", connection_id)?;
        let mime_type = required_field("note asset mime type", mime_type)?;
        let extension = extension_for_mime(&mime_type)
            .ok_or_else(|| format!("unsupported note image type {mime_type}"))?;
        if bytes.is_empty() {
            return Err("note image is empty".to_string());
        }
        if bytes.len() > MAX_NOTE_ASSET_BYTES {
            return Err(format!(
                "note image exceeds the {MAX_NOTE_ASSET_BYTES} byte limit"
            ));
        }
        {
            let connection = self.lock()?;
            if !connection_exists(&connection, &connection_id)? {
                return Err(format!("connection {connection_id} does not exist"));
            }
            // Images can be pasted before the first save, so the note row is
            // created up front; an empty body is replaced by the eventual save.
            connection
                .execute(
                    "INSERT INTO connection_notes (connection_id, content_html, created_at, updated_at)
                     VALUES (?1, '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                     ON CONFLICT(connection_id) DO NOTHING",
                    params![connection_id],
                )
                .map_err(to_storage_error)?;
        }

        let digest = Sha256::digest(&bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let file_name = format!("{digest}.{extension}");
        let asset_id = format!("{connection_id}/{file_name}");
        validate_asset_id(&asset_id)?;

        let directory = self.note_images_dir_for(&connection_id);
        fs::create_dir_all(&directory).map_err(|error| {
            format!(
                "failed to create note image directory {}: {error}",
                directory.display()
            )
        })?;
        let path = directory.join(&file_name);
        // Content addressing makes a re-paste of the same image a no-op.
        if !path.exists() {
            write_file_atomically(&path, &bytes)?;
        }
        Ok(asset_id)
    }

    /// Read one embedded note image back for rendering.
    pub fn get_note_asset(&self, asset_id: String) -> Result<Option<NoteAssetRecord>, String> {
        let asset_id = required_field("note asset id", asset_id)?;
        let (connection_id, file_name) = validate_asset_id(&asset_id)?;
        let extension = Path::new(file_name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        let Some(mime_type) = mime_for_extension(extension) else {
            return Ok(None);
        };
        let path = self.note_images_dir_for(connection_id).join(file_name);
        if !path.exists() {
            return Ok(None);
        }
        let bytes = fs::read(&path)
            .map_err(|error| format!("failed to read note image {}: {error}", path.display()))?;
        Ok(Some(NoteAssetRecord {
            id: asset_id,
            mime_type: mime_type.to_string(),
            bytes,
        }))
    }

    /// Delete image files the saved note HTML no longer references. Called
    /// right after a save so images added and then removed in one editing pass
    /// do not linger on disk.
    pub fn prune_note_assets(
        &self,
        connection_id: String,
        referenced_ids: Vec<String>,
    ) -> Result<u64, String> {
        let connection_id = required_field("note connection id", connection_id)?;
        let directory = self.note_images_dir_for(&connection_id);
        if !directory.exists() {
            return Ok(0);
        }
        let keep: Vec<&str> = referenced_ids
            .iter()
            .filter_map(|id| id.split_once('/').map(|(_, file_name)| file_name))
            .collect();
        let entries = fs::read_dir(&directory).map_err(|error| {
            format!(
                "failed to list note images at {}: {error}",
                directory.display()
            )
        })?;
        let mut removed = 0_u64;
        for entry in entries {
            let entry =
                entry.map_err(|error| format!("failed to read a note image entry: {error}"))?;
            let file_name = entry.file_name();
            let Some(file_name) = file_name.to_str() else {
                continue;
            };
            if keep.contains(&file_name) {
                continue;
            }
            if !entry.path().is_file() {
                continue;
            }
            fs::remove_file(entry.path()).map_err(|error| {
                format!(
                    "failed to remove note image {}: {error}",
                    entry.path().display()
                )
            })?;
            removed += 1;
        }
        Ok(removed)
    }
}

fn connection_exists(connection: &SqliteConnection, connection_id: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT 1 FROM connections WHERE id = ?1",
            params![connection_id],
            |_| Ok(()),
        )
        .optional()
        .map(|row| row.is_some())
        .map_err(to_storage_error)
}

/// Write through a temp file plus rename so a crash mid-write cannot leave a
/// half-written image that the content hash claims is complete.
fn write_file_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp_path = path.with_extension("tmp");
    {
        let mut file = File::create(&temp_path).map_err(|error| {
            format!(
                "failed to create note image {}: {error}",
                temp_path.display()
            )
        })?;
        file.write_all(bytes).map_err(|error| {
            format!("failed to write note image {}: {error}", temp_path.display())
        })?;
        file.sync_all().map_err(|error| {
            format!("failed to flush note image {}: {error}", temp_path.display())
        })?;
    }
    fs::rename(&temp_path, path)
        .map_err(|error| format!("failed to store note image {}: {error}", path.display()))
}
