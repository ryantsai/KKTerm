import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("new Assistant threads use per-thread JSON and lazy transcript loading", async () => {
  const [backend, flatJson, panel, model, tauri] = await Promise.all([
    readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/storage/flat_json.rs", import.meta.url), "utf8"),
    readFile(new URL("../src/ai/AssistantPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/ai/assistantChatThreads.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/tauri.ts", import.meta.url), "utf8"),
  ]);

  assert.match(flatJson, /ASSISTANT_CHAT_THREADS_DIR: &str = "assistant-chat-threads"/);
  assert.match(flatJson, /stable_json_record_name/);
  assert.match(flatJson, /ASSISTANT_INDEX_FILE: &str = "index\.json"/);
  assert.match(flatJson, /SELECT EXISTS\(SELECT 1 FROM assistant_chat_threads/);
  assert.match(backend, /run_blocking_database_command\("list Assistant chat summaries"/);
  assert.match(backend, /run_blocking_database_command\("load Assistant chat thread"/);
  assert.match(model, /list_assistant_chat_thread_summaries/);
  assert.match(model, /get_assistant_chat_thread/);
  assert.match(panel, /thread\.messages\.length === 0/);
  assert.match(panel, /loadAssistantChatThreadFromStorage/);
  assert.match(tauri, /AssistantChatThreadSummaryRecord/);
});

test("System Cleaner history uses one atomic JSON file per run", async () => {
  const flatJson = await readFile(
    new URL("../src-tauri/src/storage/flat_json.rs", import.meta.url),
    "utf8",
  );

  assert.match(flatJson, /SYSTEM_CLEANER_HISTORY_DIR: &str = "system-cleaner-history"/);
  assert.match(flatJson, /system_cleaner_history_path\(&record\.id\)/);
  assert.match(flatJson, /write_json_atomic/);
  assert.doesNotMatch(flatJson, /INSERT INTO system_cleaner_history/);
});
