import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("every major Module has MCP discovery and dispatch coverage", async () => {
  const [catalog, bridge] = await Promise.all([
    read("src-tauri/src/mcp_tool_catalog.rs"),
    read("src-tauri/src/mcp_bridge.rs"),
  ]);

  for (const [moduleName, representativeTool] of [
    ["Workspace", "kkterm.workspace.connections.list"],
    ["Dashboard", "kkterm.dashboard.load_state"],
    ["Install Helper", "kkterm.installer.tools.list"],
    ["Screenshots", "kkterm.screenshots.list"],
    ["IT Ops", "kkterm.itops.sites.list"],
  ]) {
    assert.ok(
      catalog.includes(`"name": "${representativeTool}"`),
      `${moduleName} must be discoverable through tools/list`,
    );
    assert.ok(
      bridge.includes(`"${representativeTool}" =>`),
      `${moduleName} must have an MCP dispatch path`,
    );
  }
});

test("native assistant exposes every major Module and all persisted tool groups", async () => {
  const [ai, liveTools, settings] = await Promise.all([
    read("src-tauri/src/ai.rs"),
    read("src/ai/assistantLiveTools.ts"),
    read("src/modules/settings/AiSettings.tsx"),
  ]);

  for (const representativeTool of [
    "connection_list",
    "dashboard_load_state",
    "itops_list_sites",
    "installer_list_tools",
    "screenshot_list",
  ]) {
    assert.ok(
      ai.includes(`"${representativeTool}"`),
      `assistant must publish ${representativeTool}`,
    );
  }

  for (const installerTool of [
    "installer_list_tools",
    "installer_check_updates",
    "installer_install",
    "installer_uninstall",
    "installer_cancel",
    "installer_launch",
  ]) {
    assert.ok(
      liveTools.includes(`case "${installerTool}"`),
      `frontend live-tool bridge must dispatch ${installerTool}`,
    );
  }

  const configuredTools = settings.match(
    /const AI_ASSISTANT_TOOL_IDS:[\s\S]*?=\s*\[([\s\S]*?)\];/,
  )?.[1];
  assert.ok(configuredTools, "AI Assistant tool-toggle registry must exist");
  for (const toolId of [
    "dashboard",
    "itops",
    "installer",
    "screenshots",
    "connections",
    "sessions",
    "watchdog",
  ]) {
    assert.ok(
      configuredTools.includes(`"${toolId}"`),
      `${toolId} must have a visible Settings toggle`,
    );
  }
});

test("Tutorial navigation accepts the advertised Screenshots and System Cleaner Module pages", async () => {
  const ai = await read("src-tauri/src/ai.rs");
  assert.match(
    ai,
    /"page":\{"type":"string","enum":\["workspace","dashboard","itops","installer","screenshots","systemCleaner","settings"\]\}/,
  );
});
