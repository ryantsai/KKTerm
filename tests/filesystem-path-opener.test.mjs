import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("local file browser opens filesystem paths through the typed Tauri command", async () => {
  const [tauriSource, rustSource, sftpSource] = await Promise.all([
    readFile(new URL("../src/lib/tauri.ts", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8"),
    readFile(
      new URL("../src/modules/workspace/connections/sftp/SftpWorkspace.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.doesNotMatch(
    tauriSource,
    /import \{[^}]*openPath[^}]*\} from "@tauri-apps\/plugin-opener"/,
    "filesystem paths should not use the frontend opener plugin path allowlist",
  );
  assert.match(
    tauriSource,
    /open_filesystem_path: \{[\s\S]*args: \{ path: string \};[\s\S]*result: null;/,
    "the typed command map should expose a backend filesystem-path opener",
  );
  assert.match(
    tauriSource,
    /export async function openFilesystemPath\(path: string\)[\s\S]*await invokeCommand\("open_filesystem_path", \{ path \}\);/,
    "the shared frontend wrapper should call the typed backend command",
  );
  assert.match(
    rustSource,
    /fn open_filesystem_path\(app: tauri::AppHandle, path: String\) -> Result<\(\), String>[\s\S]*canonicalize\(\)[\s\S]*\.open_path\(canonical_path\.to_string_lossy\(\), open_with\)/,
    "the backend opener should canonicalize and open non-executable filesystem paths",
  );
  assert.match(
    rustSource,
    /#\[cfg\(target_os = "macos"\)\][\s\S]*canonical_path\.is_dir\(\)\.then_some\("Finder"\)/,
    "macOS directories should open explicitly with Finder so .app-suffixed data folders are not launched as applications",
  );
  assert.match(
    rustSource,
    /let requested_path = PathBuf::from\(&path\)[\s\S]*requested_path[\s\S]*\.canonicalize\(\)/,
    "the backend opener should keep the requested filesystem path alongside the canonical existence check",
  );
  assert.match(
    rustSource,
    /is_windows_executable_path\(&canonical_path\)[\s\S]*open_windows_executable_path\(&requested_path\)/,
    "Windows executable files should launch through the executable branch with the non-canonical requested path",
  );
  assert.match(
    rustSource,
    /fn open_windows_executable_path\(path: &Path\) -> Result<\(\), String>[\s\S]*ShellExecuteW\(/,
    "Windows executable files should use ShellExecuteW instead of the generic opener path",
  );
  assert.match(
    rustSource,
    /open_filesystem_path,/,
    "the backend filesystem-path opener should be registered with Tauri",
  );
  assert.match(
    sftpSource,
    /const path = joinLocalPath\(localPath, file\.name\);[\s\S]*await openFilesystemPath\(path\);/,
    "double-clicking a local SFTP/File Explorer file should still fall back to the shared filesystem opener",
  );
});
