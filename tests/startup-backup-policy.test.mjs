import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("automatic startup backup is delayed, backgrounded, and daily-gated", async () => {
  const backend = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const storage = await readFile(new URL("../src-tauri/src/storage.rs", import.meta.url), "utf8");

  const setup = backend.slice(backend.indexOf(".setup(move |app|"));
  const manageStorage = setup.indexOf("app.manage(storage);");
  const scheduleBackup = setup.indexOf("schedule_automatic_startup_backup(app.handle().clone());");

  assert.ok(manageStorage >= 0, "setup must manage Storage");
  assert.ok(scheduleBackup > manageStorage, "backup must be scheduled after Storage is managed");
  assert.doesNotMatch(
    setup.slice(0, manageStorage),
    /backup_if_enabled_for_startup/,
    "setup must not synchronously create the automatic backup",
  );
  assert.match(backend, /tokio::time::sleep\(Duration::from_secs\(10\)\)\.await/);
  assert.match(backend, /run_blocking_database_command\(\s*"automatic settings backup"/s);
  assert.match(storage, /const AUTOMATIC_BACKUP_INTERVAL_SECONDS: i64 = 24 \* 60 \* 60/);
  assert.match(
    storage,
    /automatic_backup_is_due\(settings\.last_backup_at\.as_deref\(\), OffsetDateTime::now_utc\(\)\)/,
  );
});

test("database backup format excludes all Custom Module content", async () => {
  const storage = await readFile(new URL("../src-tauri/src/storage.rs", import.meta.url), "utf8");

  assert.match(storage, /"version": 4/);
  assert.match(storage, /"customModules": \{\s*"included": false\s*\}/s);
  assert.match(storage, /scrub_custom_module_data_from_database\(&temp_db_path\)/);
  assert.doesNotMatch(
    storage,
    /add_directory_to_settings_zip\([^;]*custom_modules/s,
    "the archive helper must never receive a Custom Modules path",
  );
  assert.match(storage, /ASSISTANT_CHAT_THREADS_DIR/);
  assert.match(storage, /SYSTEM_CLEANER_HISTORY_DIR/);
  assert.match(storage, /replace_imported_custom_module_metadata_with_current/);
});
