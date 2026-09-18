import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Network Profiles is a built-in widget with a structured privileged backend", async () => {
  const registry = await readFile(new URL("../src/modules/dashboard/registry/builtInRegistry.ts", import.meta.url), "utf8");
  const widget = await readFile(new URL("../src/modules/dashboard/widgets/builtin/network-profiles/NetworkProfilesWidget.tsx", import.meta.url), "utf8");
  const backend = await readFile(new URL("../src-tauri/src/net/profiles.rs", import.meta.url), "utf8");
  const durable = await readFile(new URL("../src/lib/durableUiState.ts", import.meta.url), "utf8");

  assert.match(registry, /id: "networkProfiles"/);
  assert.match(widget, /selectedAdapterId/);
  assert.match(widget, /adapterNicknames/);
  assert.match(widget, /network_profiles_apply/);
  assert.match(widget, /useSyncExternalStore/);
  assert.match(widget, /networkProfilesAddTitle/);
  assert.match(widget, /profileMatchesAdapter/);
  assert.doesNotMatch(widget, /networkProfilesSaveCurrent|networkProfilesSelected/);
  assert.doesNotMatch(widget, /PowerShell|networksetup|nmcli|pkexec/);
  assert.match(backend, /struct ApplyNetworkProfileRequest/);
  assert.match(backend, /fn validate_request/);
  assert.match(backend, /InterfaceGuid/);
  assert.match(backend, /EncodedCommand/);
  assert.match(backend, /ignore-auto-dns/);
  assert.match(backend, /IPv6 Prefix Length/);
  assert.match(backend, /fn windows_snapshot_command\(script: &str\) -> Command \{[\s\S]*?creation_flags\(CREATE_NO_WINDOW\)/);
  assert.match(backend, /windows_snapshot_command\(windows_snapshot_script\(\)\)/);
  assert.match(backend, /windows_snapshot_command\(&broker\)/);
  assert.match(durable, /kkterm\.dashboard\.networkProfiles\.v1/);
});
