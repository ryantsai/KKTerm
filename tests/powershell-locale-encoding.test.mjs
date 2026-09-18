import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Windows PowerShell 5.1 encodes redirected stdout with the host OEM code page
// unless a script forces UTF-8 first. Scripts whose output is decoded strictly
// as UTF-8 or shown as localized text must keep the preamble, so non-ASCII
// names and diagnostics survive every Windows display language and code page.
const UTF8_PREAMBLE = "[Console]::OutputEncoding";

const scripts = [
  { file: "src-tauri/src/pc_info.rs", name: "PC Info CIM query", minimum: 1 },
  { file: "src-tauri/src/net/profiles.rs", name: "Network adapter snapshot and UAC broker", minimum: 2 },
  { file: "src-tauri/src/sessions.rs", name: "Local TCP listener query", minimum: 1 },
  { file: "src-tauri/src/system_cleaner.rs", name: "System Cleaner inventory and removal scripts", minimum: 3 },
  { file: "src-tauri/src/installer/install.rs", name: "Installer environment and user-PATH scripts", minimum: 2 },
  { file: "src-tauri/src/ai.rs", name: "Assistant shell_command", minimum: 1 },
];

for (const { file, name, minimum } of scripts) {
  test(`${name} forces UTF-8 output for non-English Windows`, () => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const count = source.split(UTF8_PREAMBLE).length - 1;
    assert.ok(
      count >= minimum,
      `${file}: expected at least ${minimum} "${UTF8_PREAMBLE}" guard(s), found ${count}`,
    );
  });
}
