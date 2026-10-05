import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("RDP startup fullscreen uses separate default-off durable options", async () => {
  const [defaults, types, storage] = await Promise.all([
    read("src/app-defaults.ts"), read("src/types.ts"), read("src-tauri/src/storage.rs"),
  ]);
  assert.match(defaults, /defaultRdpSettings[\s\S]*?openInFullscreen: false/);
  assert.match(types, /interface RdpSettings[\s\S]*?openInFullscreen: boolean/);
  assert.match(types, /interface RdpConnectionOptions[\s\S]*?openInFullscreen\?: boolean/);
  assert.match(storage, /pub struct RdpSettings[\s\S]*?#\[serde\(default\)\]\s+open_in_fullscreen: bool/);
  assert.match(storage, /pub struct RdpConnectionOptions[\s\S]*?#\[serde\(default\)\]\s+open_in_fullscreen: Option<bool>/);
});

test("RDP startup fullscreen switches follow Remote Resolution and preserve five scaling modes", async () => {
  const settings = await read("src/modules/settings/RdpSettings.tsx");
  const editor = await read("src/modules/workspace/connections/connection-dialog/RdpConnectionFields.tsx");
  for (const source of [settings, editor]) {
    assert.ok(source.indexOf('t("settings.rdpRemoteResolution")') < source.indexOf('t("settings.rdpOpenInFullscreen")'));
    assert.match(source, /<ToggleSwitch\s+ariaLabel=\{t\("settings\.rdpOpenInFullscreen"\)\}/);
    assert.doesNotMatch(source, /t\("settings\.rdpOpenInFullscreenHint"\)/);
    assert.doesNotMatch(source, /<option value="(?:fullscreen|fullScreen)"/);
    const modes = [...source.matchAll(/<option value="(fit|stretch|actualSize|fitWidth|fitHeight)"/g)].map((match) => match[1]);
    assert.deepEqual(modes, ["fit", "stretch", "actualSize", "fitWidth", "fitHeight"]);
  }
  assert.ok(editor.indexOf('t("settings.rdpOpenInFullscreen")') < editor.indexOf('t("connections.rdpAdvancedOptions")'));
});

test("Connection startup fullscreen follows whole-group defaults and serializes the displayed switch", async () => {
  const editor = await read("src/modules/workspace/connections/connection-dialog/RdpConnectionFields.tsx");
  const sidebar = await read("src/modules/workspace/connections/ConnectionSidebar.tsx");
  assert.match(editor, /initialConnection\?\.rdpOptions\?\.inheritDefaults === false\s+\? initialConnection\.rdpOptions\.openInFullscreen \?\? false/);
  assert.match(editor, /effectiveOpenInFullscreen = rdpInheritsSettingsDefaults\s+\? rdpSettings\.openInFullscreen \?\? false\s+: openInFullscreen/);
  assert.match(editor, /checked=\{effectiveOpenInFullscreen\}\s+disabled=\{rdpInheritsSettingsDefaults\}/);
  assert.match(editor, /name="rdpOpenInFullscreen" type="hidden" value=\{effectiveOpenInFullscreen \? "on" : ""\}/);
  assert.match(sidebar, /openInFullscreen: inheritRdpDefaults\s+\? rdpSettings\.openInFullscreen \?\? false\s+: form\.get\("rdpOpenInFullscreen"\) === "on"/);
});

test("RDP startup fullscreen is discoverable in settings search, tutorial and AI metadata", async () => {
  for (const path of [
    "src/modules/settings/settingsSearch.ts",
    "src/modules/settings/settingsAssistantContext.ts",
    "src/app/tutorialNavigationModel.ts",
    "src-tauri/src/ai.rs",
    "docs/manual/09-remote-desktop.md",
    "docs/manual/15-settings.md",
  ]) {
    assert.match(await read(path), /settings\.rdpOpenInFullscreen/, path);
  }
  const schema = await read("src-tauri/src/mcp_tool_catalog.rs");
  assert.match(schema, /"openInFullscreen": \{"type": \["boolean", "null"\]/);
});
